import { addItem } from '@/drift/core/operations';
import { cloneJson, isFunction, isString } from '@daracl/core/utils';
import { normalizeItem, toGridPosition, toPixelRect } from '@/drift/core/geometry';
import { DriftItem } from '@t/DriftLayout';
import type { DriftDragInDropResult, DriftDragInItem, DriftDragInOptions, DriftDragInSource } from '@t/DriftEditor';
import type { DriftEditor } from './DriftEditor';
import type { DriftItemInput } from '@/drift/core/operations';
import { CLS } from './classNames';
import { measureScrollTarget } from './scrollContainer';
import { CanvasHit, isOverCanvas, pickCanvas } from './canvasHit';

/** 클릭과 드래그를 구분하는 이동 임계값(px) */
const DRAG_THRESHOLD = 3;
/** 자동 스크롤: 가장자리 영역 두께(px), 프레임당 최대 이동(px), 스크롤 대상 재탐색 주기(ms) */
const SCROLL_EDGE = 48;
const SCROLL_STEP = 8;
const SCROLL_RESOLVE_MS = 250;
/** 미리보기 계산에 쓰는 임시 항목 id (사용자 id 와 겹치지 않는다) */
const TEMP_ID = '\u0000ddr-dragin';

/**
 * 끌어오기 컨트롤러를 소유한 쪽(단일 에디터 또는 DriftManager)이 제공하는 연결점.
 * 컨트롤러는 대상이 몇 개인지 모른 채 "포인터 아래의 대상 에디터" 하나만 다룬다.
 */
export interface DragInHost {
  /** 드롭 대상 후보 (앞에 있는 것이 우선. 화면에서 겹치면 실제로 포인터 아래에 있는 것을 고른다) */
  targets(): readonly DriftEditor[];
  /** 이 요소에서 시작한 pointerdown 은 끌어오기로 보지 않는다 (에디터 캔버스 내부 등) */
  ignores(target: Element): boolean;
  /** 끌기 시작 (임계값 이상 움직였을 때) */
  start(source: HTMLElement): void;
  /** 끌기 종료. 추가된 항목(없으면 null)과 드롭한 대상(취소/대상 밖이면 null) */
  end(item: DriftItem | null, target: DriftEditor | null): void;
}

/** 내부 옵션: onDrop 이 대상 에디터를 함께 받는다 (단일 에디터용 공개 옵션과 호환된다) */
export interface DragInEntryOptions extends Omit<DriftDragInOptions, 'onDrop'> {
  onDrop?: (result: DriftDragInDropResult, target: DriftEditor) => void;
}

interface Entry {
  source: DriftDragInSource;
  options: DragInEntryOptions;
}

interface Session {
  entry: Entry;
  el: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  active: boolean;
  ghost?: HTMLElement;
  input?: DriftItemInput;
  /** 포인터 아래의 대상 에디터. 없으면 어느 캔버스 위에도 있지 않다 */
  target?: DriftEditor;
  /** 대상 에디터에 들어온 시점의 항목 목록 (미리보기의 기준) */
  snapshot: DriftItem[];
  lastKey: string;
  cell: { x: number; y: number };
  /** 미리보기에서 계산된 최종 위치/크기 (충돌 재배치, float, min/max 반영). 캔버스 밖이면 없다 */
  placed?: DriftItem;
  clientX: number;
  clientY: number;
  /** 대상에 들어온 시점 캔버스 높이의 행 수. 이보다 아래에는 마지막 항목 바로 아래까지만 놓을 수 있다 */
  baseRows: number;
  scrollRaf: number;
  scrollEl?: HTMLElement;
  scrollAt: number;
}

/** 단일 에디터용 연결점: 대상은 자기 자신 하나이고 이벤트는 에디터의 dragInStart/dragInEnd 로 낸다 */
export function editorDragInHost(editor: DriftEditor): DragInHost {
  const targets = [editor];
  return {
    targets: () => targets,
    ignores: (target) => editor.element.contains(target),
    start: (source) => editor.emit('dragInStart', source),
    end: (item) => editor.emit('dragInEnd', item),
  };
}

/**
 * 에디터 밖의 요소(팔레트 등)를 끌어다 놓아 컴포넌트를 추가한다. (GridStack 의 setupDragIn 에 해당)
 *
 * - Pointer Events 하나로 마우스/터치/펜을 처리한다. 원본 요소는 그대로 두고 복제본(ghost)이 포인터를 따라간다.
 * - 포인터가 대상 캔버스 위에 있으면 placeholder 로 놓일 칸을 보여주고 기존 항목이 비켜가는 모습을 미리 보여준다.
 *   대상이 여러 개(DriftManager)이면 포인터 아래의 캔버스 하나만 미리보기하며, 대상이 바뀌면 이전 대상의 미리보기를 걷어낸다.
 * - 캔버스 밖에서 놓거나 Esc/pointercancel 이면 아무것도 추가하지 않는다.
 * - 모델은 drop 시 대상 에디터의 `addItem()` 한 번으로만 바뀐다(히스토리/이벤트 1회).
 * - document 리스너는 등록된 원본이 있거나 세션이 진행 중일 때만 붙어 있다 (에디터가 많아도 리스너가 늘지 않게).
 */
export class DragInController {
  private readonly entries = new Set<Entry>();
  private session?: Session;
  private seq = 0;
  private listening?: AbortController;
  private disposed = false;

  /** 소유자(에디터/Manager)가 해제 시 dispose() 를 호출해 리스너를 정리한다 */
  constructor(private readonly host: DragInHost) {}

  isActive(): boolean {
    return !!this.session?.active;
  }

  /** 진행 중인 세션의 대상 에디터 */
  getTarget(): DriftEditor | undefined {
    return this.session?.target;
  }

  /** 끌어오기 원본을 등록한다. 반환된 함수로 해제한다 */
  setup(source: DriftDragInSource, options: DragInEntryOptions = {}): () => void {
    const entry: Entry = { source, options };
    this.entries.add(entry);
    this.listen();
    // 터치에서 브라우저 스크롤이 드래그를 가로채지 않도록 원본에 touch-action: none 을 적용한다
    this.sourcesOf(entry).forEach((el) => el.classList.add(CLS.dragInSource));
    return () => {
      if (!this.entries.delete(entry)) return;
      this.sourcesOf(entry).forEach((el) => el.classList.remove(CLS.dragInSource));
      try {
        if (this.session?.entry === entry) this.cancel();
      } finally {
        this.unlisten();
      }
    };
  }

  cancel(): void {
    const s = this.session;
    if (!s) return;
    const wasActive = s.active;
    this.finish(s);
    if (wasActive) this.host.end(null, null);
  }

  /**
   * 대상 에디터가 더 이상 쓰일 수 없게 되었다(등록 해제/destroy). 진행 중인 세션이 그 에디터를 미리보기하고 있으면
   * 미리보기를 걷어내고 대상 없음 상태로 둔다. 세션은 계속되며 포인터가 다른 대상 위로 가면 그 대상에 놓을 수 있다.
   */
  release(editor: DriftEditor): void {
    const s = this.session;
    if (s?.target === editor) this.leave(s);
  }

  /** 등록된 원본과 진행 중인 세션을 모두 정리한다 (destroy 에서 호출) */
  dispose(): void {
    // 취소 알림(host.end)의 리스너가 예외를 던져도 원본 표시와 document 리스너는 반드시 정리한다
    try {
      this.cancel();
    } finally {
      this.entries.forEach((entry) => this.sourcesOf(entry).forEach((el) => el.classList.remove(CLS.dragInSource)));
      this.entries.clear();
      this.unlisten(true);
    }
  }

  // ───────────────────────────── document 리스너 ─────────────────────────────

  private listen(): void {
    if (this.listening || this.disposed) return;
    const ctrl = new AbortController();
    this.listening = ctrl;
    const opts = { signal: ctrl.signal };
    document.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    document.addEventListener('pointermove', (e) => this.onMove(e), opts);
    document.addEventListener('pointerup', (e) => this.onUp(e), opts);
    document.addEventListener('pointercancel', (e) => this.onCancel(e), opts);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.cancel(), opts);
  }

  /** 원본도 세션도 없으면 리스너를 뗀다. final 이면 다시 붙지 않는다 */
  private unlisten(final = false): void {
    if (final) this.disposed = true;
    if (!final && (this.entries.size || this.session)) return;
    this.listening?.abort();
    this.listening = undefined;
  }

  // ───────────────────────────── 원본 탐색 ─────────────────────────────

  private sourcesOf(entry: Entry): HTMLElement[] {
    const src = entry.source;
    if (isString(src)) return Array.from(document.querySelectorAll<HTMLElement>(src));
    if (src instanceof Element) return [src as HTMLElement];
    return Array.from(src as ArrayLike<Element>) as HTMLElement[];
  }

  private find(target: Element): { entry: Entry; el: HTMLElement } | undefined {
    for (const entry of this.entries) {
      const src = entry.source;
      if (isString(src)) {
        const el = target.closest<HTMLElement>(src);
        if (el) return { entry, el };
      } else {
        const el = this.sourcesOf(entry).find((candidate) => candidate === target || candidate.contains(target));
        if (el) return { entry, el };
      }
    }
    return undefined;
  }

  // ───────────────────────────── 시작 ─────────────────────────────

  private onDown(e: PointerEvent): void {
    if (this.session || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as Element | null;
    if (!target || !this.entries.size || this.host.ignores(target)) return;
    const hit = this.find(target);
    if (!hit) return;

    const rect = hit.el.getBoundingClientRect();
    this.session = {
      entry: hit.entry,
      el: hit.el,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      active: false,
      snapshot: [],
      lastKey: '',
      cell: { x: 0, y: 0 },
      clientX: e.clientX,
      clientY: e.clientY,
      baseRows: 0,
      scrollRaf: 0,
      scrollAt: -Infinity,
    };
    try {
      hit.el.setPointerCapture?.(e.pointerId);
    } catch (err) {
      /* 이미 해제된 포인터 등은 무시한다 */
    }
  }

  /** 옵션/데이터 속성으로부터 추가할 항목 정의를 만든다 */
  private resolveInput(s: Session): DriftItemInput {
    const opt = s.entry.options.item;
    const base = isFunction(opt) ? opt(s.el) : opt || {};
    const d = s.el.dataset;
    const num = (v?: string) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const w = base.w ?? num(d.w) ?? 3;
    const h = base.h ?? num(d.h) ?? 2;
    const input = { ...base, w, h } as DriftItemInput;
    if (input.title === undefined && d.title) input.title = d.title;
    if (input.content === undefined) input.content = d.content ?? (s.el.textContent || '').trim();
    input.id = base.id || d.id || '';
    return input;
  }

  // ───────────────────────────── 진행 ─────────────────────────────

  private onMove(e: PointerEvent): void {
    const s = this.session;
    if (!s || e.pointerId !== s.pointerId) return;
    s.clientX = e.clientX;
    s.clientY = e.clientY;

    if (!s.active) {
      if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DRAG_THRESHOLD) return;
      this.activate(s);
      // 시작 알림(dragInStart) 콜백 안에서 취소되었으면 끝난 세션으로 미리보기/자동 스크롤을 이어가지 않는다
      if (this.session !== s) return;
    }
    this.update(s);
    this.autoScroll(s);
  }

  /** 포인터가 캔버스의 '보이는' 영역 위에 있는지 (canvasHit 의 공통 규칙) */
  private isOver(s: Session, editor: DriftEditor, canvas: DOMRect): boolean {
    return isOverCanvas(editor, s.clientX, s.clientY, canvas);
  }

  /** 포인터 아래의 대상 에디터 (canvasHit 의 공통 규칙: 겹치면 실제로 그려진 쪽, 연결 해제된 캔버스 제외) */
  private pick(s: Session): CanvasHit | undefined {
    return pickCanvas(this.host.targets(), s.clientX, s.clientY, s.target);
  }

  /** 포인터가 보이는 영역의 위/아래 가장자리에 있으면 스크롤한다 (PointerController 와 같은 규칙) */
  private autoScroll(s: Session): void {
    if (s.scrollRaf || typeof requestAnimationFrame === 'undefined') return;
    const step = () => {
      s.scrollRaf = 0;
      const editor = s.target;
      if (this.session !== s || !s.active || !editor) return;
      const canvas = editor.element.getBoundingClientRect();
      // 보이는 캔버스 위에 있을 때만 (캔버스 밖의 팔레트 등에서 끌 때는 스크롤하지 않는다)
      if (!this.isOver(s, editor, canvas)) return;
      if (performance.now() - s.scrollAt > SCROLL_RESOLVE_MS) {
        s.scrollEl = editor.getScrollElement();
        s.scrollAt = performance.now();
      }
      const box = s.scrollEl;
      // 스크롤 영역(대상 요소 또는 viewport)의 가장자리만 기준이다. 캔버스/컨테이너의 가장자리는 스크롤 가장자리가 아니다
      // (페이지가 스크롤될 때 캔버스 위쪽 경계로 들어오는 중에 위로 스크롤되던 문제)
      const { top, bottom } = measureScrollTarget(box);
      const edge = Math.min(SCROLL_EDGE, Math.max(0, (bottom - top) / 3));
      const fromTop = top + edge - s.clientY;
      const fromBottom = s.clientY - (bottom - edge);
      const depth = fromTop > 0 ? fromTop : fromBottom > 0 ? fromBottom : 0;
      if (depth === 0 || edge === 0) return;
      const speed = Math.max(1, Math.round(Math.min(depth / edge, 1) * SCROLL_STEP));
      const dy = fromTop > 0 ? -speed : speed;
      const read = () => (box ? box.scrollTop : window.scrollY);
      const before = read();
      if (box) box.scrollTop += dy;
      else window.scrollBy(0, dy);
      if (read() !== before) {
        s.lastKey = '';
        this.update(s);
      }
      s.scrollRaf = requestAnimationFrame(step);
    };
    s.scrollRaf = requestAnimationFrame(step);
  }

  private activate(s: Session): void {
    s.active = true;
    s.input = this.resolveInput(s);

    const rect = s.el.getBoundingClientRect();
    const ghost = s.el.cloneNode(true) as HTMLElement;
    // 복제본 안의 id 는 문서에서 중복되지 않게 제거한다
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    ghost.classList.remove(CLS.dragInSource);
    ghost.classList.add(CLS.dragInGhost);
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    s.ghost = ghost;

    this.host.start(s.el);
  }

  /** 대상 에디터에 들어왔다: 미리보기 기준(항목 목록, 놓을 수 있는 높이)을 이 에디터 기준으로 잡는다 */
  private enter(s: Session, editor: DriftEditor): void {
    s.target = editor;
    s.snapshot = editor.getItems();
    s.baseRows = toGridPosition(0, editor.element.getBoundingClientRect().height, editor.getMetrics()).y;
    s.lastKey = '';
    editor.setDragInOver(true);
  }

  /** 대상 에디터를 벗어났다: 미리보기를 걷어내고 실제 모델 상태로 되돌린다 */
  private leave(s: Session): void {
    const editor = s.target;
    s.target = undefined;
    s.placed = undefined;
    s.lastKey = '';
    s.snapshot = [];
    if (!editor) return;
    editor.setDragInOver(false);
    const placeholder = editor.getPlaceholder();
    placeholder.hidden = true;
    placeholder.classList.remove(CLS.placeholderInvalid);
    editor.renderItems(editor.getItems());
  }

  private update(s: Session): void {
    // 읽기(대상 판정)를 먼저 하고 쓰기(ghost 이동)를 나중에 해서 포인터 이동마다 강제 레이아웃이 반복되지 않게 한다
    const hit = this.pick(s);
    if (s.ghost) {
      s.ghost.style.left = `${s.clientX - s.grabX}px`;
      s.ghost.style.top = `${s.clientY - s.grabY}px`;
    }
    if (hit?.editor !== s.target) {
      this.leave(s);
      if (hit) this.enter(s, hit.editor);
    }
    if (!hit) return;

    const { editor, canvas } = hit;
    const metrics = editor.getMetrics();
    const columns = editor.getColumns();
    const input = s.input as DriftItemInput;
    const size = normalizeItem(
      {
        x: 0,
        y: 0,
        w: input.w ?? 2,
        h: input.h ?? 2,
        minW: input.minW,
        minH: input.minH,
        maxW: input.maxW,
        maxH: input.maxH,
      } as DriftItem,
      columns,
    );
    // 포인터가 항목의 한가운데에 오도록 좌상단 칸을 계산한다
    const px = toPixelRect({ x: 0, y: 0, w: size.w, h: size.h }, metrics);
    const cell = toGridPosition(
      s.clientX - canvas.left - px.width / 2,
      s.clientY - canvas.top - px.height / 2,
      metrics,
    );
    const x = Math.min(Math.max(cell.x, 0), Math.max(0, columns - size.w));
    // 처음 보이던 캔버스 높이 또는 마지막 항목 바로 아래까지만 놓을 수 있다 (캔버스가 늘어나며 자동 스크롤이 끝없이 이어지는 것을 막는다)
    const maxY = Math.max(
      s.baseRows,
      s.snapshot.reduce((max, item) => Math.max(max, item.y + item.h), 0),
    );
    const y = Math.min(Math.max(cell.y, 0), maxY);
    const key = `${x},${y}`;
    if (key === s.lastKey) return;
    s.lastKey = key;
    s.cell = { x, y };

    const preview = addItem(s.snapshot, columns, { ...input, id: TEMP_ID, x, y }, editor.isFloat());
    const placed = preview.find((item) => item.id === TEMP_ID) as DriftItem;
    s.placed = placed;
    const placeholder = editor.getPlaceholder();
    placeholder.hidden = false;
    placeholder.classList.remove(CLS.placeholderInvalid);
    editor.applyRect(placeholder, placed);
    editor.renderItems(preview);
  }

  // ───────────────────────────── 종료 ─────────────────────────────

  private onUp(e: PointerEvent): void {
    const s = this.session;
    if (!s || e.pointerId !== s.pointerId) return;

    // 놓는 순간의 포인터 위치로 최종 위치/크기를 한 번 더 확정한다 (마지막 move 이후 이동이 있을 수 있다)
    if (s.active) {
      s.clientX = e.clientX;
      s.clientY = e.clientY;
      this.update(s);
    }
    const { active, target, placed, input, el, entry } = s;
    // 콜백/추가 전에 ghost, placeholder, 밀려난 항목의 미리보기를 먼저 정리한다.
    // (이후 정리 코드가 없으므로 콜백 안에서 addItem() 을 호출해도 그 결과를 덮어쓰지 않는다)
    this.finish(s);
    if (!active) return;

    if (!target || target.isDestroyed() || !placed || !input) {
      this.host.end(null, null);
      return;
    }

    const { autoAdd, onDrop } = entry.options;
    if (autoAdd === false) {
      // 내부 상태는 건드리지 않고 드롭 결과만 전달한다. 실제로 추가된 항목이 없으므로 dragInEnd 는 null
      try {
        onDrop?.(this.result(target, el, input, placed), target);
      } finally {
        this.host.end(null, target);
      }
      return;
    }

    // 사용자가 끌어다 놓은 변경이므로 출처는 'user' 이다
    const added = target.addItem(
      { ...input, id: this.uniqueId(target, input.id), x: placed.x, y: placed.y },
      { source: 'user' },
    );
    try {
      onDrop?.(this.result(target, el, { ...input, id: added.id }, added), target);
    } finally {
      this.host.end(added, target);
    }
  }

  /** onDrop 에 전달할 결과를 만든다. 내부 상태와 분리된 깊은 복사본이다 */
  private result(
    editor: DriftEditor,
    source: HTMLElement,
    input: DriftItemInput,
    geo: DriftItem,
  ): DriftDragInDropResult {
    const item = cloneJson(input) as DriftDragInItem;
    if (!item.id) delete item.id;
    item.x = geo.x;
    item.y = geo.y;
    item.w = geo.w;
    item.h = geo.h;
    return {
      source,
      item: item as DriftDragInDropResult['item'],
      breakpoint: editor.getBreakpoint()?.name ?? null,
      columns: editor.getColumns(),
    };
  }

  private onCancel(e: PointerEvent): void {
    const s = this.session;
    if (!s || (e.pointerId !== undefined && e.pointerId !== s.pointerId)) return;
    this.cancel();
  }

  /** 대상 에디터 안에서 겹치지 않는 id (다른 에디터의 id 와는 겹쳐도 된다) */
  private uniqueId(editor: DriftEditor, preferred: string): string {
    const exists = (id: string) => editor.getLayout().items.some((item) => item.id === id);
    if (preferred && !exists(preferred)) return preferred;
    let id: string;
    do id = `${preferred || 'item'}-${++this.seq}`;
    while (exists(id));
    return id;
  }

  private finish(s: Session): void {
    this.session = undefined;
    if (s.scrollRaf) cancelAnimationFrame(s.scrollRaf);
    s.scrollRaf = 0;
    try {
      s.el.releasePointerCapture?.(s.pointerId);
    } catch (err) {
      /* 이미 해제됨 */
    }
    s.ghost?.remove();
    // 미리보기로 밀려 있던 항목을 실제 모델 상태로 되돌린다 (drop 이면 이후 addItem 이 반영)
    this.leave(s);
    this.unlisten();
  }
}
