import { addItem } from '@/core/operations';
import { cloneJson, isFunction, isString } from '@daracl/core/utils';
import { normalizeItem, toGridPosition, toPixelRect } from '@/core/geometry';
import { DriftItem } from '@t/DriftLayout';
import type { DriftDragInDropResult, DriftDragInItem, DriftDragInOptions, DriftDragInSource } from '@t/DriftEditor';
import type { DriftEditor } from './DriftEditor';
import type { DriftItemInput } from '@/core/operations';
import { CLS } from './classNames';
import { measureScrollTarget } from './scrollContainer';

/** 클릭과 드래그를 구분하는 이동 임계값(px) */
const DRAG_THRESHOLD = 3;
/** 자동 스크롤: 가장자리 영역 두께(px), 프레임당 최대 이동(px), 스크롤 대상 재탐색 주기(ms) */
const SCROLL_EDGE = 48;
const SCROLL_STEP = 8;
const SCROLL_RESOLVE_MS = 250;
/** 미리보기 계산에 쓰는 임시 항목 id (사용자 id 와 겹치지 않는다) */
const TEMP_ID = '\u0000ddr-dragin';

interface Entry {
  source: DriftDragInSource;
  options: DriftDragInOptions;
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
  snapshot: DriftItem[];
  lastKey: string;
  over: boolean;
  cell: { x: number; y: number };
  /** 미리보기에서 계산된 최종 위치/크기 (충돌 재배치, float, min/max 반영). 캔버스 밖이면 없다 */
  placed?: DriftItem;
  clientX: number;
  clientY: number;
  /** 활성화 시점 캔버스 높이의 행 수. 이보다 아래에는 마지막 항목 바로 아래까지만 놓을 수 있다 */
  baseRows: number;
  scrollRaf: number;
  scrollEl?: HTMLElement;
  scrollAt: number;
}

/**
 * 에디터 밖의 요소(팔레트 등)를 끌어다 놓아 컴포넌트를 추가한다. (GridStack 의 setupDragIn 에 해당)
 *
 * - Pointer Events 하나로 마우스/터치/펜을 처리한다. 원본 요소는 그대로 두고 복제본(ghost)이 포인터를 따라간다.
 * - 포인터가 캔버스 위에 있으면 placeholder 로 놓일 칸을 보여주고 기존 항목이 비켜가는 모습을 미리 보여준다.
 * - 캔버스 밖에서 놓거나 Esc/pointercancel 이면 아무것도 추가하지 않는다.
 * - 모델은 drop 시 `editor.addItem()` 한 번으로만 바뀐다(히스토리/이벤트 1회).
 */
export class DragInController {
  private readonly entries = new Set<Entry>();
  private session?: Session;
  private seq = 0;

  constructor(private readonly editor: DriftEditor, signal: AbortSignal) {
    const opts = { signal };
    document.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    document.addEventListener('pointermove', (e) => this.onMove(e), opts);
    document.addEventListener('pointerup', (e) => this.onUp(e), opts);
    document.addEventListener('pointercancel', (e) => this.onCancel(e), opts);
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.cancel(), opts);
  }

  isActive(): boolean {
    return !!this.session?.active;
  }

  /** 끌어오기 원본을 등록한다. 반환된 함수로 해제한다 */
  setup(source: DriftDragInSource, options: DriftDragInOptions = {}): () => void {
    const entry: Entry = { source, options };
    this.entries.add(entry);
    // 터치에서 브라우저 스크롤이 드래그를 가로채지 않도록 원본에 touch-action: none 을 적용한다
    this.sourcesOf(entry).forEach((el) => el.classList.add(CLS.dragInSource));
    return () => {
      this.entries.delete(entry);
      this.sourcesOf(entry).forEach((el) => el.classList.remove(CLS.dragInSource));
      if (this.session?.entry === entry) this.cancel();
    };
  }

  cancel(): void {
    const s = this.session;
    if (!s) return;
    const wasActive = s.active;
    this.finish(s);
    if (wasActive) this.editor.emit('dragInEnd', null);
  }

  /** 등록된 원본과 진행 중인 세션을 모두 정리한다 (destroy 에서 호출) */
  dispose(): void {
    this.cancel();
    this.entries.forEach((entry) => this.sourcesOf(entry).forEach((el) => el.classList.remove(CLS.dragInSource)));
    this.entries.clear();
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
    if (!target || !this.entries.size || this.editor.element.contains(target)) return;
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
      over: false,
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
    }
    this.update(s);
    this.autoScroll(s);
  }

  /** 포인터가 캔버스의 '보이는' 영역 위에 있는지. 컨테이너/스크롤 대상 밖으로 잘려 안 보이는 부분은 제외한다 */
  private isOver(s: Session, canvas: DOMRect): boolean {
    const { top, bottom } = measureScrollTarget(this.editor.getScrollElement());
    const host = (this.editor.element.parentElement ?? this.editor.element).getBoundingClientRect();
    return (
      s.clientX >= canvas.left &&
      s.clientX <= canvas.right &&
      s.clientY >= Math.max(canvas.top, host.top, top) &&
      s.clientY <= Math.min(canvas.bottom, host.bottom, bottom)
    );
  }

  /** 포인터가 보이는 영역의 위/아래 가장자리에 있으면 스크롤한다 (PointerController 와 같은 규칙) */
  private autoScroll(s: Session): void {
    if (s.scrollRaf || typeof requestAnimationFrame === 'undefined') return;
    const step = () => {
      s.scrollRaf = 0;
      if (this.session !== s || !s.active) return;
      const canvas = this.editor.element.getBoundingClientRect();
      // 보이는 캔버스 위에 있을 때만 (캔버스 밖의 팔레트 등에서 끌 때는 스크롤하지 않는다)
      if (!this.isOver(s, canvas)) return;
      if (performance.now() - s.scrollAt > SCROLL_RESOLVE_MS) {
        s.scrollEl = this.editor.getScrollElement();
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
    s.snapshot = this.editor.getItems();
    s.baseRows = toGridPosition(0, this.editor.element.getBoundingClientRect().height, this.editor.getMetrics()).y;

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

    this.editor.emit('dragInStart', s.el);
  }

  private update(s: Session): void {
    const editor = this.editor;
    if (s.ghost) {
      s.ghost.style.left = `${s.clientX - s.grabX}px`;
      s.ghost.style.top = `${s.clientY - s.grabY}px`;
    }

    const canvas = editor.element.getBoundingClientRect();
    const over = this.isOver(s, canvas);
    editor.setDragInOver(over);

    const placeholder = editor.getPlaceholder();
    if (!over) {
      if (s.over) {
        // 캔버스를 벗어나면 미리보기를 걷어내고 원래 배치로 되돌린다
        s.over = false;
        s.placed = undefined;
        s.lastKey = '';
        placeholder.hidden = true;
        editor.renderItems(s.snapshot);
      }
      return;
    }
    s.over = true;

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
    const { active, over, placed, input, el, entry } = s;
    // 콜백/추가 전에 ghost, placeholder, 밀려난 항목의 미리보기를 먼저 정리한다.
    // (이후 정리 코드가 없으므로 콜백 안에서 addItem() 을 호출해도 그 결과를 덮어쓰지 않는다)
    this.finish(s);
    if (!active) return;

    if (!over || !placed || !input) {
      this.editor.emit('dragInEnd', null);
      return;
    }

    const { autoAdd, onDrop } = entry.options;
    if (autoAdd === false) {
      // 내부 상태는 건드리지 않고 드롭 결과만 전달한다. 실제로 추가된 항목이 없으므로 dragInEnd 는 null
      try {
        onDrop?.(this.result(el, input, placed));
      } finally {
        this.editor.emit('dragInEnd', null);
      }
      return;
    }

    // 사용자가 끌어다 놓은 변경이므로 출처는 'user' 이다
    const added = this.editor.addItem(
      { ...input, id: this.uniqueId(input.id), x: placed.x, y: placed.y },
      { source: 'user' },
    );
    try {
      onDrop?.(this.result(el, { ...input, id: added.id }, added));
    } finally {
      this.editor.emit('dragInEnd', added);
    }
  }

  /** onDrop 에 전달할 결과를 만든다. 내부 상태와 분리된 깊은 복사본이다 */
  private result(source: HTMLElement, input: DriftItemInput, geo: DriftItem): DriftDragInDropResult {
    const item = cloneJson(input) as DriftDragInItem;
    if (!item.id) delete item.id;
    item.x = geo.x;
    item.y = geo.y;
    item.w = geo.w;
    item.h = geo.h;
    return {
      source,
      item: item as DriftDragInDropResult['item'],
      breakpoint: this.editor.getBreakpoint()?.name ?? null,
      columns: this.editor.getColumns(),
    };
  }

  private onCancel(e: PointerEvent): void {
    const s = this.session;
    if (!s || (e.pointerId !== undefined && e.pointerId !== s.pointerId)) return;
    this.cancel();
  }

  private uniqueId(preferred: string): string {
    const exists = (id: string) => this.editor.getLayout().items.some((item) => item.id === id);
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
    this.editor.setDragInOver(false);
    this.editor.getPlaceholder().hidden = true;
    this.editor.getPlaceholder().classList.remove(CLS.placeholderInvalid);
    // 미리보기로 밀려 있던 항목을 실제 모델 상태로 되돌린다 (drop 이면 addItem 이 이미 반영)
    this.editor.renderItems(this.editor.getItems());
  }
}
