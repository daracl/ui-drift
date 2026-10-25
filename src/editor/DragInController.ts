import { addItem } from '@/core/operations';
import { normalizeItem, toGridPosition, toPixelRect } from '@/core/geometry';
import { DriftItem } from '@t/DriftLayout';
import type { DriftDragInDropResult, DriftDragInItem, DriftDragInOptions, DriftDragInSource } from '@t/DriftEditor';
import type { DriftEditor } from './DriftEditor';
import type { DriftItemInput } from '@/core/operations';
import { CLS } from './classNames';

/** 클릭과 드래그를 구분하는 이동 임계값(px) */
const DRAG_THRESHOLD = 3;
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
    if (typeof src === 'string') return Array.from(document.querySelectorAll<HTMLElement>(src));
    if (src instanceof Element) return [src as HTMLElement];
    return Array.from(src as ArrayLike<Element>) as HTMLElement[];
  }

  private find(target: Element): { entry: Entry; el: HTMLElement } | undefined {
    for (const entry of this.entries) {
      const src = entry.source;
      if (typeof src === 'string') {
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
    const base = typeof opt === 'function' ? opt(s.el) : opt || {};
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
  }

  private activate(s: Session): void {
    s.active = true;
    s.input = this.resolveInput(s);
    s.snapshot = this.editor.getItems();

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
    const over =
      s.clientX >= canvas.left && s.clientX <= canvas.right && s.clientY >= canvas.top && s.clientY <= canvas.bottom;
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
    const key = `${x},${cell.y}`;
    if (key === s.lastKey) return;
    s.lastKey = key;
    s.cell = { x, y: cell.y };

    const preview = addItem(s.snapshot, columns, { ...input, id: TEMP_ID, x, y: cell.y }, editor.isFloat());
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
    const item = JSON.parse(JSON.stringify(input)) as DriftDragInItem;
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
