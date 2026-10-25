import { compact } from '@/core/compact';
import { addItem, moveItem, normalizeItems, removeItem, resizeItem, updateItem } from '@/core/operations';
import { createMetrics, getRowCount, toPixelRect } from '@/core/geometry';
import { cloneLayout, createLayout, parseLayout, serializeLayout } from '@/core/layout';
import { applyItems, getBreakpoints, matchBreakpoint, resolveItems } from '@/core/responsive';
import { Emitter } from '@/event/Emitter';
import {
  DriftChangeReason,
  DriftDragInOptions,
  DriftDragInSource,
  DriftEditorEvents,
  DriftEditorOptions,
  DriftResizeHandle,
} from '@t/DriftEditor';
import { DriftBreakpoint, DriftGeometry, DriftItem, DriftLayout, DriftMetrics } from '@t/DriftLayout';
import { History } from './History';
import { GeometryStyle } from './GeometryStyle';
import { DragInController } from './DragInController';
import { PointerController } from './PointerController';
import { CLS } from './classNames';

const DEFAULT_WIDTH = 1200;
const DEFAULT_RESIZE_HANDLES: DriftResizeHandle[] = ['se', 'sw'];

/** SVG 속성에 들어가므로 따옴표/꺾쇠 등이 없는 안전한 색 문자열만 허용한다 */
function sanitizeColor(color?: string): string | undefined {
  return color && /^[#\w(),.%\s-]+$/.test(color) ? color : undefined;
}

export type DriftItemPatch = Partial<Omit<DriftItem, 'id'>>;

/**
 * 편집 모드 컨트롤러. 레이아웃 데이터(core)와 DOM 사이를 연결한다.
 * - 모델은 불변 객체로 교체되며, 변경은 항상 commit() 을 거쳐 히스토리/이벤트와 함께 반영된다.
 * - 드래그/리사이즈 중에는 모델을 바꾸지 않고 미리보기만 렌더링한다 (PointerController).
 */
export class DriftEditor {
  /** 항목이 배치되는 캔버스 요소 */
  readonly element: HTMLElement;

  private readonly container: HTMLElement;
  private readonly emitter = new Emitter<DriftEditorEvents>();
  private readonly history: History<DriftLayout>;
  private readonly abort = new AbortController();
  private readonly itemEls = new Map<string, HTMLElement>();
  private readonly rectCache = new WeakMap<HTMLElement, string>();
  private readonly geo: GeometryStyle;
  private readonly contentCache = new WeakMap<HTMLElement, string>();
  private readonly placeholder: HTMLElement;
  private readonly options: Required<Pick<DriftEditorOptions, 'extraRows' | 'dragMode'>> & DriftEditorOptions;

  private layout: DriftLayout;
  private initial: DriftLayout;
  private baseline: string;
  private width = DEFAULT_WIDTH;
  private breakpointMode: 'auto' | string | null;
  private activeBreakpoint: DriftBreakpoint | undefined;
  private selectedId: string | null = null;
  private resizeObserver?: ResizeObserver;
  private destroyed = false;
  private pointer: PointerController;
  private dragIn: DragInController;
  private gridEnabled: boolean;
  private gridKey = '';
  private draggable: boolean;
  private resizable: boolean;

  constructor(container: HTMLElement, options: DriftEditorOptions = {}) {
    this.container = container;
    this.options = { extraRows: 2, dragMode: 'auto', ...options };
    this.gridEnabled = options.grid !== false;
    this.draggable = options.draggable !== false;
    this.resizable = options.resizable !== false;
    this.history = new History<DriftLayout>(options.historyLimit ?? 100);

    // layout 이 float 를 지정하지 않았다면 options.float 를 적용한다 (layout 의 float:true 는 항상 우선)
    const given = options.layout ? parseLayout(options.layout) : undefined;
    this.layout = given
      ? options.float === true && !given.float
        ? parseLayout({ ...given, float: true })
        : given
      : createLayout({
          columns: options.columns,
          rowHeight: options.rowHeight,
          gap: options.gap,
          breakpoints: options.breakpoints,
          float: options.float,
        });
    this.initial = this.layout;
    this.baseline = serializeLayout(this.layout);
    // 편집 중 컨테이너 폭이 바뀌어도 배치가 바뀌지 않도록 자동 전환은 옵트인이다
    this.breakpointMode = options.responsive === true ? 'auto' : null;

    container.classList.add(CLS.editor);
    if (options.animate === false) container.classList.add(CLS.noAnimate);

    this.element = document.createElement('div');
    this.element.className = CLS.canvas;
    const gridColor = sanitizeColor(options.gridColor);
    if (gridColor) this.element.style.setProperty('--ddr-grid-color', gridColor);
    this.placeholder = document.createElement('div');
    this.placeholder.className = CLS.placeholder;
    this.placeholder.hidden = true;
    this.element.appendChild(this.placeholder);
    container.appendChild(this.element);
    this.geo = new GeometryStyle(this.element);

    this.measure();
    this.watchSize();
    this.pointer = new PointerController(this, this.abort.signal);
    this.dragIn = new DragInController(this, this.abort.signal);
    this.updateBreakpoint(false);
    this.render();
    this.emitter.emit('layoutChange', cloneLayout(this.layout), { reason: 'init' });
  }

  // ───────────────────────────── 조회 ─────────────────────────────

  /** 현재 레이아웃의 복사본 (JSON 직렬화 가능) */
  getLayout(): DriftLayout {
    return cloneLayout(this.layout);
  }

  /** 현재 breakpoint 기준으로 화면에 표시되는 항목들 */
  getItems(): DriftItem[] {
    return resolveItems(this.layout, this.activeBreakpoint);
  }

  getItem(id: string): DriftItem | undefined {
    return this.getItems().find((item) => item.id === id);
  }

  getSelected(): DriftItem | null {
    return this.selectedId ? this.getItem(this.selectedId) || null : null;
  }

  getBreakpoint(): DriftBreakpoint | null {
    return this.activeBreakpoint || null;
  }

  /** 현재 편집 중인 컬럼 수 */
  getColumns(): number {
    return this.activeBreakpoint ? this.activeBreakpoint.columns : this.layout.columns;
  }

  getMetrics(): DriftMetrics {
    return createMetrics(this.width, this.getColumns(), this.layout.rowHeight, this.layout.gap);
  }

  // ───────────────────────────── 이벤트 ─────────────────────────────

  on<K extends keyof DriftEditorEvents>(name: K, handler: DriftEditorEvents[K]): () => void {
    return this.emitter.on(name, handler);
  }

  once<K extends keyof DriftEditorEvents>(name: K, handler: DriftEditorEvents[K]): () => void {
    return this.emitter.once(name, handler);
  }

  off<K extends keyof DriftEditorEvents>(name: K, handler?: DriftEditorEvents[K]): void {
    this.emitter.off(name, handler);
  }

  /** @internal PointerController 가 사용한다 */
  emit<K extends keyof DriftEditorEvents>(name: K, ...args: Parameters<DriftEditorEvents[K]>): void {
    this.emitter.emit(name, ...args);
  }

  // ───────────────────────────── 편집 API ─────────────────────────────

  /** 컴포넌트를 추가한다. x/y 가 없으면 빈 자리에 배치한다 */
  addItem(input: Partial<DriftGeometry> & Omit<DriftItem, keyof DriftGeometry>): DriftItem {
    if (this.destroyed) throw new Error('[drift] 이미 destroy 된 editor 입니다.');
    const bp = this.activeBreakpoint;
    const hasPosition = Number.isFinite(input.x) && Number.isFinite(input.y);
    let next: DriftLayout;
    if (bp && hasPosition) {
      // 위치(x,y)는 현재 편집 중인 breakpoint 의 칸 기준이다. 기본 레이아웃에는 자동 위치로 추가하고,
      // 해당 breakpoint 에서 지정한 칸으로 옮겨 한 번의 변경으로 커밋한다
      const { x, y, ...rest } = input;
      const base = { ...this.layout, items: addItem(this.layout.items, this.layout.columns, rest, this.isFloat()) };
      const effective = moveItem(
        resolveItems(base, bp),
        bp.columns,
        input.id,
        x as number,
        y as number,
        this.isFloat(),
      );
      next = applyItems(base, effective, bp);
    } else {
      next = { ...this.layout, items: addItem(this.layout.items, this.layout.columns, input, this.isFloat()) };
    }
    this.commit(next, 'add');
    const added = this.getItem(input.id) as DriftItem;
    this.emitter.emit('add', added);
    return added;
  }

  removeItem(id: string): boolean {
    const target = this.layout.items.find((item) => item.id === id);
    if (this.destroyed || !target) return false;

    const remaining = { ...this.layout, items: this.layout.items.filter((item) => item.id !== id) };
    let next: DriftLayout;
    if (this.activeBreakpoint) {
      const effective = removeItem(resolveItems(this.layout, this.activeBreakpoint), id, this.isFloat());
      next = applyItems(remaining, effective, this.activeBreakpoint);
    } else {
      next = { ...remaining, items: compact(remaining.items, undefined, this.isFloat()) };
    }

    if (this.selectedId === id) this.setSelected(null);
    this.commit(next, 'remove');
    this.emitter.emit('remove', target);
    return true;
  }

  /** 속성(title/content/props/min/max/locked/resizable)이나 위치/크기를 갱신한다. 위치/크기는 현재 breakpoint 에 적용된다 */
  updateItem(id: string, patch: DriftItemPatch): DriftItem | undefined {
    if (this.destroyed || !this.layout.items.some((item) => item.id === id)) return undefined;
    const effective = updateItem(
      resolveItems(this.layout, this.activeBreakpoint),
      this.getColumns(),
      id,
      patch,
      this.isFloat(),
    );
    this.commit(applyItems(this.layout, effective, this.activeBreakpoint), 'update');
    return this.getItem(id);
  }

  moveItem(id: string, x: number, y: number): void {
    this.commitEffective(moveItem(this.getItems(), this.getColumns(), id, x, y, this.isFloat()), 'move');
  }

  resizeItem(id: string, w: number, h: number): void {
    this.commitEffective(resizeItem(this.getItems(), this.getColumns(), id, w, h, this.isFloat()), 'resize');
  }

  /** @internal 현재 breakpoint 의 항목 배열로 모델을 갱신한다 */
  commitEffective(items: DriftItem[], reason: DriftChangeReason): void {
    if (this.destroyed) return;
    this.commit(applyItems(this.layout, items, this.activeBreakpoint), reason);
  }

  /** 모든 컴포넌트를 삭제한다 */
  clear(): void {
    this.setSelected(null);
    this.commit({ ...this.layout, items: [] }, 'clear');
  }

  /** 마지막으로 load/생성된 레이아웃으로 되돌린다 (undo 가능) */
  reset(): void {
    this.setSelected(null);
    this.commit(this.initial, 'reset');
  }

  /** 레이아웃을 불러온다 (객체 또는 JSON). 히스토리는 초기화된다 */
  load(layout: DriftLayout | Partial<DriftLayout> | string): void {
    if (this.destroyed) return;
    this.layout = parseLayout(layout);
    this.initial = this.layout;
    this.baseline = serializeLayout(this.layout);
    this.history.clear();
    this.selectedId = null;
    this.updateBreakpoint(false);
    this.render();
    this.emitter.emit('layoutChange', cloneLayout(this.layout), { reason: 'load' });
  }

  /** 현재 레이아웃을 JSON 문자열로 내보낸다 */
  toJSON(space?: number): string {
    return serializeLayout(this.layout, space);
  }

  fromJSON(json: string): void {
    this.load(json);
  }

  /** 현재 상태를 저장 기준으로 삼고 save 이벤트를 발생시킨다. 저장 데이터를 반환한다 */
  save(): DriftLayout {
    this.baseline = serializeLayout(this.layout);
    const saved = cloneLayout(this.layout);
    this.emitter.emit('save', saved);
    return saved;
  }

  /** 마지막 save/load 이후 변경되었는지 */
  isDirty(): boolean {
    return serializeLayout(this.layout) !== this.baseline;
  }

  // ───────────────────────────── undo / redo ─────────────────────────────

  undo(): boolean {
    const prev = this.history.undo(this.layout);
    if (!prev) return false;
    this.replace(prev, 'undo');
    return true;
  }

  redo(): boolean {
    const next = this.history.redo(this.layout);
    if (!next) return false;
    this.replace(next, 'redo');
    return true;
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  // ───────────────────────────── 선택 / 옵션 ─────────────────────────────

  select(id: string | null): void {
    this.setSelected(id && this.itemEls.has(id) ? id : null);
  }

  enableDrag(enable: boolean): void {
    this.draggable = enable;
    this.syncItemState();
  }

  enableResize(enable: boolean): void {
    this.resizable = enable;
    this.syncItemState();
  }

  isDraggable(): boolean {
    return this.draggable;
  }

  isResizable(): boolean {
    return this.resizable;
  }

  getDragMode(): NonNullable<DriftEditorOptions['dragMode']> {
    return this.options.dragMode;
  }

  /** 드롭 위치 유지(float) 모드 여부 */
  isFloat(): boolean {
    return !!this.layout.float;
  }

  /** float 모드를 바꾼다. 켜면 현재 배치를 그대로 두고, 끄면 위로 압축된다 (undo 가능) */
  setFloat(float: boolean): void {
    if (this.destroyed || this.isFloat() === float) return;
    const next: DriftLayout = { ...this.layout, float };
    if (!float) delete next.float;
    this.commit({ ...next, items: normalizeItems(next.items, next.columns, float) }, 'update');
  }

  /**
   * 에디터 밖의 요소를 끌어다 놓아 컴포넌트를 추가할 수 있게 한다.
   * source 는 CSS selector / 요소 / 요소 목록이며, 반환된 함수로 해제한다 (destroy 시에도 자동 해제).
   */
  setupDragIn(source: DriftDragInSource, options: DriftDragInOptions = {}): () => void {
    if (this.destroyed) throw new Error('[drift] 이미 destroy 된 editor 입니다.');
    return this.dragIn.setup(source, options);
  }

  /** @internal 외부 요소를 캔버스 위로 끌고 있는 동안의 표시 */
  setDragInOver(over: boolean): void {
    this.container.classList.toggle(CLS.dragInOver, over);
  }

  /** 배경 셀 격자 표시 여부를 바꾼다 */
  setGrid(enable: boolean): void {
    if (this.destroyed || this.gridEnabled === enable) return;
    this.gridEnabled = enable;
    this.applyGrid(this.getMetrics());
  }

  isGrid(): boolean {
    return this.gridEnabled;
  }

  isRemovable(): boolean {
    return !!this.options.removable;
  }

  /**
   * breakpoint 를 지정한다. 'auto' 는 컨테이너 너비로 자동 선택, null 은 기본(desktop) 레이아웃 고정,
   * 이름을 주면 해당 breakpoint 를 편집/미리보기한다.
   */
  setBreakpoint(mode: 'auto' | string | null): void {
    if (mode !== null && mode !== 'auto' && !getBreakpoints(this.layout).some((bp) => bp.name === mode)) {
      throw new Error(`[drift] 알 수 없는 breakpoint 입니다: ${mode}`);
    }
    this.breakpointMode = mode;
    this.updateBreakpoint(true);
    this.render();
  }

  /** 컨테이너 크기를 다시 측정해 렌더링한다 (자동 감지가 안 되는 환경에서 수동 호출) */
  refresh(): void {
    this.measure();
    this.updateBreakpoint(true);
    this.render();
  }

  /** 이벤트 리스너, ResizeObserver, DOM 을 모두 해제한다 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pointer.cancel();
    this.dragIn.dispose();
    this.abort.abort();
    this.resizeObserver?.disconnect();
    this.geo.destroy();
    this.emitter.clear();
    this.element.remove();
    this.container.classList.remove(CLS.editor, CLS.noAnimate);
    this.itemEls.clear();
  }

  // ───────────────────────────── 렌더링 (내부) ─────────────────────────────

  /** @internal */
  getItemElement(id: string): HTMLElement | undefined {
    return this.itemEls.get(id);
  }

  /** @internal */
  getPlaceholder(): HTMLElement {
    return this.placeholder;
  }

  /**
   * @internal 항목들을 현재 메트릭으로 배치한다. skipId 는 드래그 중인 요소처럼 건드리지 않을 항목.
   * 모델이 아닌 임의의 items(미리보기)도 받을 수 있다.
   */
  renderItems(items: readonly DriftItem[], skipId?: string): void {
    const metrics = this.getMetrics();
    this.ensureGeometry(items, metrics);
    for (const item of items) {
      const el = this.itemEls.get(item.id);
      if (el && item.id !== skipId) this.applyRect(el, item);
    }
    this.applyCanvasHeight(items, metrics);
  }

  /** @internal 캔버스 높이를 항목 하단 + 여분 행에 맞춘다 */
  applyCanvasHeight(items: readonly DriftItem[], metrics = this.getMetrics()): void {
    const rows = getRowCount(items) + this.options.extraRows;
    this.element.style.height = `${Math.max(0, rows * (metrics.rowHeight + metrics.gap) - metrics.gap)}px`;
  }

  /**
   * @internal 항목의 위치/크기를 data-x, data-y, data-w, data-h 속성으로 기록한다.
   * 실제 left/top/width/height 는 GeometryStyle 이 만든 속성 선택자 CSS 가 정한다 (인라인 style 을 쓰지 않는다).
   */
  applyRect(el: HTMLElement, geo: DriftGeometry): void {
    const key = `${geo.x}|${geo.y}|${geo.w}|${geo.h}`;
    if (this.rectCache.get(el) === key) return;
    this.rectCache.set(el, key);
    el.dataset.x = String(geo.x);
    el.dataset.y = String(geo.y);
    el.dataset.w = String(geo.w);
    el.dataset.h = String(geo.h);
  }

  /** @internal 드래그/리사이즈 중 포인터를 따라가던 인라인 left/top/width/height 를 제거해 data 속성 기준으로 되돌린다 */
  invalidateRect(el: HTMLElement): void {
    this.rectCache.delete(el);
    for (const prop of ['left', 'top', 'width', 'height']) el.style.removeProperty(prop);
  }

  /** @internal 항목이 사용하는 최대 y/h 에 맞춰 위치 CSS 규칙을 보장한다 */
  ensureGeometry(items: readonly DriftItem[], metrics = this.getMetrics()): void {
    let maxY = 0;
    let maxH = 1;
    for (const item of items) {
      if (item.y > maxY) maxY = item.y;
      if (item.h > maxH) maxH = item.h;
    }
    this.geo.update(metrics, maxY, maxH);
  }

  private render(): void {
    const items = this.getItems();
    const metrics = this.getMetrics();
    const alive = new Set<string>();
    this.ensureGeometry(items, metrics);

    for (const item of items) {
      alive.add(item.id);
      let el = this.itemEls.get(item.id);
      if (!el) {
        el = this.createItemElement(item);
        this.itemEls.set(item.id, el);
        this.element.appendChild(el);
      }
      this.renderContent(el, item);
      this.applyRect(el, item);
      el.classList.toggle(CLS.locked, !!item.locked);
      el.classList.toggle(CLS.noResize, !!item.locked || item.resizable === false);
    }

    this.itemEls.forEach((el, id) => {
      if (!alive.has(id)) {
        el.remove();
        this.itemEls.delete(id);
      }
    });

    this.applyCanvasHeight(items, metrics);
    this.applyGrid(metrics);
    this.syncItemState();
  }

  /**
   * 캔버스 배경을 모눈종이처럼 만든다: 칸 경계를 따라 끊김 없이 이어지는 가로/세로 선.
   * 셀 간격(gap)이 있으면 선이 간격의 정중앙을 지나, 카드가 칸 안에 들어앉은 모양이 된다.
   * 모양은 SVG 마스크(--ddr-grid-mask/--ddr-grid-size/--ddr-grid-offset)로, 색은 CSS 변수 --ddr-grid-color 로 정해진다.
   */
  private applyGrid(metrics: DriftMetrics): void {
    const el = this.element;
    const on = this.gridEnabled && metrics.cellWidth > 0;
    el.classList.toggle(CLS.grid, on);
    if (!on) {
      if (this.gridKey) {
        el.style.removeProperty('--ddr-grid-mask');
        el.style.removeProperty('--ddr-grid-size');
        el.style.removeProperty('--ddr-grid-offset');
        this.gridKey = '';
      }
      return;
    }

    const stepX = metrics.cellWidth + metrics.gap;
    const stepY = metrics.rowHeight + metrics.gap;
    const key = `${stepX}|${stepY}|${metrics.gap}`;
    if (key === this.gridKey) return;
    this.gridKey = key;

    // 마스크는 알파값만 쓰므로 선 색은 의미가 없다 (검정). 선 두께는 0.5px 로 얇게 그린다
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${stepX}" height="${stepY}">` +
      `<path d="M0 0.25H${stepX}M0.25 0V${stepY}" fill="none" stroke="#000" stroke-width="0.5"/></svg>`;
    // 괄호/따옴표도 인코딩해 url() 안에서 안전하게 만든다
    const encoded = encodeURIComponent(svg).replace(
      /[()'!*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    el.style.setProperty('--ddr-grid-mask', `url("data:image/svg+xml,${encoded}")`);
    el.style.setProperty('--ddr-grid-size', `${stepX}px ${stepY}px`);
    // 타일의 선(좌/상 가장자리)이 gap 의 정중앙에 오도록 반 칸 간격만큼 당긴다
    el.style.setProperty('--ddr-grid-offset', `${-metrics.gap / 2}px`);
  }

  private createItemElement(item: DriftItem): HTMLElement {
    const el = document.createElement('div');
    el.className = CLS.item;
    el.dataset.driftId = item.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', item.title || item.id);

    const handle = document.createElement('div');
    handle.className = CLS.handle;
    const title = document.createElement('span');
    title.className = CLS.title;
    handle.appendChild(title);

    const content = document.createElement('div');
    content.className = CLS.content;

    el.append(handle, content);

    if (this.options.removable) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = CLS.remove;
      btn.setAttribute('aria-label', '삭제');
      btn.textContent = '×';
      el.appendChild(btn);
    }

    // 리사이즈 핸들: 방향(data-dir)별로 하나씩. 'sw' 는 왼쪽에서 크기를 조절한다
    for (const dir of this.options.resizeHandles ?? DEFAULT_RESIZE_HANDLES) {
      const grip = document.createElement('div');
      grip.className = CLS.resizeHandle;
      grip.dataset.dir = dir;
      grip.setAttribute('aria-hidden', 'true');
      el.appendChild(grip);
    }

    return el;
  }

  private renderContent(el: HTMLElement, item: DriftItem): void {
    const key = `${item.title ?? ''}\u0000${item.content ?? ''}\u0000${JSON.stringify(item.props || {})}`;
    if (this.contentCache.get(el) === key) return;
    this.contentCache.set(el, key);

    const handle = el.querySelector(`.${CLS.handle}`) as HTMLElement;
    (handle.querySelector(`.${CLS.title}`) as HTMLElement).textContent = item.title ?? '';
    handle.classList.toggle(CLS.handleEmpty, !item.title);
    el.setAttribute('aria-label', item.title || item.id);

    const contentEl = el.querySelector(`.${CLS.content}`) as HTMLElement;
    if (this.options.renderItem) {
      contentEl.textContent = '';
      this.options.renderItem(item, contentEl);
    } else {
      contentEl.textContent = item.content ?? item.id;
    }
  }

  private syncItemState(): void {
    this.container.classList.toggle(CLS.dragDisabled, !this.draggable);
    this.container.classList.toggle(CLS.resizeDisabled, !this.resizable);
    this.itemEls.forEach((el, id) => el.classList.toggle(CLS.selected, id === this.selectedId));
  }

  private setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.syncItemState();
    this.emitter.emit('select', id ? this.getItem(id) || null : null);
  }

  /** @internal */
  selectFromPointer(id: string): void {
    this.setSelected(id);
  }

  /** @internal 캔버스 빈 곳 클릭 */
  clearSelection(): void {
    this.setSelected(null);
  }

  // ───────────────────────────── 모델 갱신 (내부) ─────────────────────────────

  private commit(next: DriftLayout, reason: DriftChangeReason): void {
    if (serializeLayout(next) === serializeLayout(this.layout)) {
      this.render();
      return;
    }
    this.history.push(this.layout);
    this.replace(next, reason);
  }

  private replace(next: DriftLayout, reason: DriftChangeReason): void {
    this.layout = next;
    if (this.selectedId && !next.items.some((item) => item.id === this.selectedId)) this.selectedId = null;
    this.updateBreakpoint(true);
    this.render();
    this.emitter.emit('layoutChange', cloneLayout(next), { reason });
  }

  // ───────────────────────────── 반응형 / 크기 감지 ─────────────────────────────

  private measure(): boolean {
    const width = this.element.clientWidth || this.element.getBoundingClientRect().width;
    if (width > 0 && width !== this.width) {
      this.width = width;
      return true;
    }
    return false;
  }

  private watchSize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.pointer.isActive() || this.dragIn.isActive()) return;
      if (this.measure()) {
        this.updateBreakpoint(true);
        this.render();
      }
    });
    this.resizeObserver.observe(this.element);
  }

  private updateBreakpoint(notify: boolean): void {
    const prev = this.activeBreakpoint;
    const mode = this.breakpointMode;
    if (mode === null) this.activeBreakpoint = undefined;
    else if (mode === 'auto') this.activeBreakpoint = matchBreakpoint(this.layout, this.width);
    else this.activeBreakpoint = getBreakpoints(this.layout).find((bp) => bp.name === mode);

    if (notify && prev !== this.activeBreakpoint && prev?.name !== this.activeBreakpoint?.name) {
      this.emitter.emit('breakpointChange', this.activeBreakpoint || null);
    }
  }
}

export function createDriftEditor(container: HTMLElement | string, options: DriftEditorOptions = {}): DriftEditor {
  const el = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container;
  if (!el) throw new Error(`[drift] 컨테이너를 찾을 수 없습니다: ${String(container)}`);
  return new DriftEditor(el, options);
}
