import { compact } from '@/core/compact';
import { isMovable, isResizable as isItemResizable } from '@/core/flags';
import { diffItems, itemsEqual, layoutsEqual } from '@/core/diff';
import { addItem, moveItem, normalizeItems, removeItem, resizeItem, updateItem } from '@/core/operations';
import { createMetrics, getRowCount, hasOverlap, normalizeItem, toPixelRect } from '@/core/geometry';
import { cloneLayout, createLayout, parseLayout, sanitizeItem, serializeLayout } from '@/core/layout';
import { applyItems, getBreakpoints, matchBreakpoint, resolveItems } from '@/core/responsive';
import { Emitter } from '@/event/Emitter';
import {
  DriftApplyOptions,
  DriftChangeReason,
  DriftChangeSource,
  DriftDragInOptions,
  DriftDragInSource,
  DriftEditorEvents,
  DriftEditorOptions,
  DriftItemState,
  DriftResizeHandle,
  DriftSizeChange,
  DriftSyncItem,
  DriftSyncOptions,
  DriftSyncResult,
} from '@t/DriftEditor';
import { DriftBreakpoint, DriftGeometry, DriftItem, DriftLayout, DriftMetrics } from '@t/DriftLayout';
import { History } from './History';
import { GeometryStyle } from './GeometryStyle';
import { DragInController } from './DragInController';
import { PointerController } from './PointerController';
import { CLS } from './classNames';
import { resolveScrollTarget, type ScrollTarget } from './scrollContainer';

const DEFAULT_WIDTH = 1200;
const DEFAULT_RESIZE_HANDLES: DriftResizeHandle[] = ['se', 'sw'];
/** 크기 변경으로 보는 픽셀 오차 (소수점 반올림 차이로 알림이 반복되지 않게 한다) */
const SIZE_EPSILON = 0.5;

/** SVG 속성에 들어가므로 따옴표/꺾쇠 등이 없는 안전한 색 문자열만 허용한다 */
function sanitizeColor(color?: string): string | undefined {
  return color && /^[#\w(),.%\s-]+$/.test(color) ? color : undefined;
}

/** 내부 상태와 분리된 깊은 복사 (콜백/이벤트로 내보내는 항목용) */
const cloneItem = (item: DriftItem): DriftItem => JSON.parse(JSON.stringify(item)) as DriftItem;

/** requestAnimationFrame 이 없는 환경(SSR, 일부 테스트)에서는 타이머로 대체한다 */
const raf = (cb: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number);
const cancelRaf = (id: number): void =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id);

export type DriftItemPatch = Partial<Omit<DriftItem, 'id'>>;

/** 호출별 옵션을 에디터 기본값과 합쳐 확정한 값 */
interface Applied {
  source: DriftChangeSource;
  emit: boolean;
  history: boolean;
}

/** 항목 콘텐츠 DOM 의 상태. 변경 감지와 생성/갱신/해제의 중복 호출 방지에 쓴다 */
interface ContentState {
  initialized: boolean;
  /** 콘텐츠 훅(mount)이 호출되어 아직 해제되지 않았다 */
  mounted: boolean;
  cleanup?: () => void;
  title?: string;
  content?: string;
  props?: DriftItem['props'];
  propsJson: string;
  /** 훅에 마지막으로 전달한 항목 복사본 (update 의 previous, unmount 의 item) */
  item?: DriftItem;
}

interface SizeRecord {
  w: number;
  h: number;
  width: number;
  height: number;
}

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
  private readonly historyEnabled: boolean;
  private readonly programmaticEvents: boolean;
  private readonly abort = new AbortController();
  private readonly itemEls = new Map<string, HTMLElement>();
  private readonly rectCache = new WeakMap<HTMLElement, string>();
  private readonly geo: GeometryStyle;
  private readonly contentStates = new WeakMap<HTMLElement, ContentState>();
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
  private keyboard: boolean;
  private lockedResizable: boolean;
  /** 콘텐츠 훅에서 발생한 첫 예외 (렌더가 끝난 뒤 다시 던진다) */
  private hookError: { error: unknown } | undefined;

  /** 크기 알림: 마지막으로 알린 크기, 예약 상태, 리사이즈 진행 중(live)의 실제 픽셀 크기 */
  private readonly sizeLast = new Map<string, SizeRecord>();
  private readonly liveSizes = new Map<string, { width: number; height: number }>();
  private sizeRaf = 0;
  private sizeScheduled = false;

  constructor(container: HTMLElement, options: DriftEditorOptions = {}) {
    this.container = container;
    this.options = { extraRows: 2, dragMode: 'auto', ...options };
    this.gridEnabled = options.grid !== false;
    this.draggable = options.draggable !== false;
    this.resizable = options.resizable !== false;
    this.keyboard = options.keyboard !== false;
    this.lockedResizable = options.lockedResizable === true;
    this.historyEnabled = options.history !== false;
    this.programmaticEvents = options.programmaticEvents !== false;
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
    this.throwHookError();
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
    const off = this.emitter.on(name, handler);
    // 첫 sizeChange 리스너가 붙으면 현재 항목들의 크기를 한 번 알린다 (previous: null)
    if (name === 'sizeChange') this.scheduleSizeCheck();
    return off;
  }

  once<K extends keyof DriftEditorEvents>(name: K, handler: DriftEditorEvents[K]): () => void {
    const off = this.emitter.once(name, handler);
    if (name === 'sizeChange') this.scheduleSizeCheck();
    return off;
  }

  off<K extends keyof DriftEditorEvents>(name: K, handler?: DriftEditorEvents[K]): void {
    this.emitter.off(name, handler);
  }

  /** @internal PointerController 가 사용한다 */
  emit<K extends keyof DriftEditorEvents>(name: K, ...args: Parameters<DriftEditorEvents[K]>): void {
    this.emitter.emit(name, ...args);
  }

  // ───────────────────────────── 편집 API ─────────────────────────────

  /** 호출별 옵션을 에디터 기본값과 합쳐 확정한다. 사용자 조작(source:'user')의 이벤트는 항상 발생한다 */
  private applied(opts?: DriftApplyOptions, defaults: Partial<DriftApplyOptions> = {}): Applied {
    const source = opts?.source ?? defaults.source ?? 'api';
    return {
      source,
      emit: source === 'user' ? true : opts?.emit ?? defaults.emit ?? this.programmaticEvents,
      history: opts?.history ?? defaults.history ?? true,
    };
  }

  /** 컴포넌트를 추가한다. x/y 가 없으면 빈 자리에 배치한다 */
  addItem(input: Partial<DriftGeometry> & Omit<DriftItem, keyof DriftGeometry>, opts?: DriftApplyOptions): DriftItem {
    if (this.destroyed) throw new Error('[drift] 이미 destroy 된 editor 입니다.');
    const r = this.applied(opts);
    const bp = this.activeBreakpoint;
    const hasPosition = Number.isFinite(input.x) && Number.isFinite(input.y);
    let next: DriftLayout;
    if (bp && hasPosition) {
      // 위치/크기(x,y,w,h)는 현재 편집 중인 breakpoint 의 칸 기준이다. 기본 레이아웃에는 자동 위치로 추가하고,
      // 해당 breakpoint 에서 지정한 위치/크기로 바꿔 한 번의 변경으로 커밋한다.
      // (자동 변환이 먼저 적용되므로 w/h 도 함께 지정해야 미리보기와 같은 크기가 된다)
      const { x, y, ...rest } = input;
      const base = { ...this.layout, items: addItem(this.layout.items, this.layout.columns, rest, this.isFloat()) };
      const patch: Partial<DriftGeometry> = { x, y };
      if (Number.isFinite(input.w)) patch.w = input.w;
      if (Number.isFinite(input.h)) patch.h = input.h;
      const effective = updateItem(resolveItems(base, bp), bp.columns, input.id, patch, this.isFloat());
      next = applyItems(base, effective, bp);
    } else {
      next = { ...this.layout, items: addItem(this.layout.items, this.layout.columns, input, this.isFloat()) };
    }
    this.commit(next, 'add', r);
    const added = this.getItem(input.id) as DriftItem;
    if (r.emit) this.emitter.emit('add', added);
    return added;
  }

  removeItem(id: string, opts?: DriftApplyOptions): boolean {
    const target = this.layout.items.find((item) => item.id === id);
    if (this.destroyed || !target) return false;
    const r = this.applied(opts);

    const remaining = { ...this.layout, items: this.layout.items.filter((item) => item.id !== id) };
    let next: DriftLayout;
    if (this.activeBreakpoint) {
      const effective = removeItem(resolveItems(this.layout, this.activeBreakpoint), id, this.isFloat());
      next = applyItems(remaining, effective, this.activeBreakpoint);
    } else {
      next = { ...remaining, items: compact(remaining.items, undefined, this.isFloat()) };
    }

    if (this.selectedId === id) this.setSelected(null);
    this.commit(next, 'remove', r);
    if (r.emit) this.emitter.emit('remove', target);
    return true;
  }

  /** 속성(title/content/props/min/max/locked/resizable)이나 위치/크기를 갱신한다. 위치/크기는 현재 breakpoint 에 적용된다 */
  updateItem(id: string, patch: DriftItemPatch, opts?: DriftApplyOptions): DriftItem | undefined {
    if (this.destroyed || !this.layout.items.some((item) => item.id === id)) return undefined;
    const effective = updateItem(
      resolveItems(this.layout, this.activeBreakpoint),
      this.getColumns(),
      id,
      patch,
      this.isFloat(),
    );
    this.commit(applyItems(this.layout, effective, this.activeBreakpoint), 'update', this.applied(opts));
    return this.getItem(id);
  }

  moveItem(id: string, x: number, y: number, opts?: DriftApplyOptions): void {
    this.commitEffective(moveItem(this.getItems(), this.getColumns(), id, x, y, this.isFloat()), 'move', opts);
  }

  resizeItem(id: string, w: number, h: number, opts?: DriftApplyOptions): void {
    this.commitEffective(
      resizeItem(this.getItems(), this.getColumns(), id, w, h, this.isFloat(), this.lockedResizable),
      'resize',
      opts,
    );
  }

  /** @internal 현재 breakpoint 의 항목 배열로 모델을 갱신한다 */
  commitEffective(items: DriftItem[], reason: DriftChangeReason, opts?: DriftApplyOptions): void {
    if (this.destroyed) return;
    this.commit(applyItems(this.layout, items, this.activeBreakpoint), reason, this.applied(opts));
  }

  /** 모든 컴포넌트를 삭제한다 */
  clear(opts?: DriftApplyOptions): void {
    this.setSelected(null);
    this.commit({ ...this.layout, items: [] }, 'clear', this.applied(opts));
  }

  /** 마지막으로 load/생성된 레이아웃으로 되돌린다 (undo 가능) */
  reset(opts?: DriftApplyOptions): void {
    this.setSelected(null);
    this.commit(this.initial, 'reset', this.applied(opts));
  }

  /**
   * 레이아웃을 통째로 불러온다 (객체 또는 JSON). 히스토리는 초기화되고 저장 기준(dirty)과 reset 기준이 바뀐다.
   * 입력은 정규화되어 충돌이 해소·압축된다. 같은 id 의 항목은 DOM/콘텐츠가 유지되고 콘텐츠 정보가 바뀐 경우에만 갱신된다.
   * 외부 모델과 id 기준으로 맞출 때는 `syncItems()` 를 쓴다.
   */
  load(layout: DriftLayout | Partial<DriftLayout> | string, opts?: DriftApplyOptions): void {
    if (this.destroyed) return;
    const r = this.applied(opts);
    const wantEvent = r.emit && this.emitter.has('layoutChange');
    const before = wantEvent ? this.getItems() : [];
    this.layout = parseLayout(layout);
    this.initial = this.layout;
    this.baseline = serializeLayout(this.layout);
    this.history.clear();
    this.selectedId = null;
    this.updateBreakpoint(false);
    const after = this.render();
    this.scheduleSizeCheck();
    if (wantEvent) this.emitChange(this.layout, 'load', r, before, after);
    this.throwHookError();
  }

  /**
   * 외부 모델의 항목 목록을 id 기준으로 동기화한다 (현재 breakpoint 와 무관하게 기본 레이아웃 항목을 대상으로 한다).
   *
   * - 같은 id 의 항목과 콘텐츠 DOM 은 유지하고, 위치/크기만 바뀌면 콘텐츠를 다시 만들지 않는다.
   *   추가된 항목만 만들고 제거된 항목만 해제한다. 여러 항목의 변경은 최종 상태로 한 번만 렌더링한다.
   * - 입력 항목은 해당 항목을 통째로 대체한다(입력에 없는 속성은 제거). 단 `responsive` 는 입력에 키가 없으면 기존 값을 보존한다.
   * - 입력은 변경하지 않는다. 선택된 항목이 남아 있으면 선택이 유지된다.
   * - 변경이 없으면 렌더링/이벤트/이력 없이 `changed:false` 를 반환한다. 항목 순서만 다른 경우도 변경으로 보지 않는다.
   * - 기본값: `source:'sync'`, `history:false`(외부 모델이 undo 를 관리), 이벤트는 programmaticEvents 를 따른다.
   * - 배치(`placement`): 'exact' 는 입력 배치를 그대로 복원, 'resolve' 는 충돌 해소+압축, 'auto'(기본) 는 겹침이 없으면 exact.
   *   유효한 외부 배치를 불필요하게 재압축하지 않아 모델과 화면이 서로를 계속 고치는 순환을 막는다.
   */
  syncItems(items: readonly DriftSyncItem[], options: DriftSyncOptions = {}): DriftSyncResult {
    const result: DriftSyncResult = {
      changed: false,
      added: [],
      removed: [],
      updated: [],
      adjusted: [],
      overlapping: false,
    };
    if (this.destroyed) return result;
    if (!Array.isArray(items)) throw new Error('[drift] syncItems 에는 항목 배열이 필요합니다.');

    const columns = this.layout.columns;
    const existing = new Map(this.layout.items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const sanitized: DriftItem[] = [];
    for (const raw of items) {
      if (!raw || typeof raw.id !== 'string' || raw.id === '') {
        throw new Error('[drift] syncItems: id 가 없는 항목이 있습니다.');
      }
      if (seen.has(raw.id)) throw new Error(`[drift] syncItems: 중복된 id 입니다: ${raw.id}`);
      seen.add(raw.id);

      // 입력을 변경하지 않도록 새 객체로 정화/정규화한다 (좌표 정수화, 컬럼 경계, min/max)
      let item = normalizeItem(sanitizeItem(raw), columns);
      const prev = existing.get(raw.id);
      if (prev) {
        if (!('responsive' in raw) && prev.responsive) item.responsive = prev.responsive;
        // 값이 같으면 기존 객체를 그대로 쓴다: 참조가 유지되어 변경 비교와 콘텐츠 변경 감지가 가볍다
        if (itemsEqual(prev, item)) item = prev;
      }
      sanitized.push(item);
    }

    const placement = options.placement ?? 'auto';
    let finalItems = sanitized;
    let resolved = false;
    if (placement === 'resolve' || (placement === 'auto' && hasOverlap(sanitized))) {
      finalItems = normalizeItems(sanitized, columns, this.isFloat());
      resolved = true;
    }
    result.overlapping = !resolved && placement === 'exact' && hasOverlap(finalItems);

    // 입력 배치와 다르게 반영된 항목 (정규화/충돌 해소 결과)
    items.forEach((raw, i) => {
      const f = finalItems[i];
      if (raw.x !== f.x || raw.y !== f.y || raw.w !== f.w || raw.h !== f.h) result.adjusted.push(cloneItem(f));
    });

    const diff = diffItems(this.layout.items, finalItems);
    if (!diff.added.length && !diff.removed.length && !diff.changed.length) return result;
    result.changed = true;
    result.added = diff.added.map((i) => i.id);
    result.removed = diff.removed.map((i) => i.id);
    result.updated = diff.changed.map((c) => c.id);

    const r = this.applied(options, { source: 'sync', history: false });
    this.commit({ ...this.layout, items: finalItems }, 'sync', r);
    return result;
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

  /** 내부 이력이 꺼져 있으면(`history:false`) 항상 false 를 반환한다 */
  undo(opts?: DriftApplyOptions): boolean {
    if (!this.historyEnabled) return false;
    const prev = this.history.undo(this.layout);
    if (!prev) return false;
    this.replace(prev, 'undo', this.applied(opts));
    return true;
  }

  redo(opts?: DriftApplyOptions): boolean {
    if (!this.historyEnabled) return false;
    const next = this.history.redo(this.layout);
    if (!next) return false;
    this.replace(next, 'redo', this.applied(opts));
    return true;
  }

  canUndo(): boolean {
    return this.historyEnabled && this.history.canUndo();
  }

  canRedo(): boolean {
    return this.historyEnabled && this.history.canRedo();
  }

  /** 내부 undo/redo 기록 사용 여부 (옵션 history) */
  isHistory(): boolean {
    return this.historyEnabled;
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

  // ───────────────────────────── 잠금 / 크기 조절 (독립 제어) ─────────────────────────────

  /**
   * 항목의 **위치 고정**(locked: 이동 금지 + 고정 장애물)을 켜고 끈다. 크기 조절 가능 여부(resizable)는 건드리지 않는다.
   * 끄면 `locked` 속성이 제거되어 JSON 에 남지 않는다. 존재하지 않는 id 이면 undefined.
   */
  setLocked(id: string, locked: boolean, opts?: DriftApplyOptions): DriftItem | undefined {
    return this.updateItem(id, { locked: locked ? true : undefined }, opts);
  }

  /**
   * 항목의 **크기 조절 가능 여부**를 위치 고정(locked)과 독립적으로 정한다.
   * `true`/`false` 는 명시값, `null` 은 명시를 지워 기본 규칙(locked 이면 고정, 에디터 옵션 `lockedResizable`)을 따르게 한다.
   * 예) `setLocked(id, true); setResizable(id, true)` → 위치는 고정, 크기만 조절 가능.
   */
  setResizable(id: string, resizable: boolean | null, opts?: DriftApplyOptions): DriftItem | undefined {
    return this.updateItem(id, { resizable: resizable === null ? undefined : resizable }, opts);
  }

  /** 항목의 잠금/크기조절 상태를 한 번에 조회한다. 존재하지 않는 id 이면 undefined */
  getItemState(id: string): DriftItemState | undefined {
    const item = this.layout.items.find((i) => i.id === id);
    if (!item) return undefined;
    return {
      locked: !!item.locked,
      movable: isMovable(item),
      resizable: this.canResize(item),
      resizableOption: item.resizable === undefined ? null : !!item.resizable,
    };
  }

  /** @internal 이 항목의 크기를 조절할 수 있는지 (항목의 resizable 명시값 → locked/lockedResizable 옵션 순) */
  canResize(item: Pick<DriftItem, 'locked' | 'resizable'>): boolean {
    return isItemResizable(item, this.lockedResizable);
  }

  /** `resizable` 을 명시하지 않은 locked 항목의 크기 조절 기본 허용 여부 (옵션 lockedResizable) */
  isLockedResizable(): boolean {
    return this.lockedResizable;
  }

  /** locked 항목의 크기 조절 기본 허용 여부를 바꾼다. 명시한 항목별 resizable 은 영향받지 않는다 */
  setLockedResizable(enable: boolean): void {
    if (this.destroyed || this.lockedResizable === enable) return;
    this.lockedResizable = enable;
    this.render(); // 핸들 표시(ddr-no-resize)를 다시 계산한다
  }

  /** 내부 키보드 처리(방향키 이동, Shift+방향키 리사이즈, Delete, Esc 선택 해제)를 켜고 끈다. 진행 중 드래그의 Esc 취소는 영향받지 않는다 */
  setKeyboard(enable: boolean): void {
    this.keyboard = enable;
  }

  isKeyboard(): boolean {
    return this.keyboard;
  }

  getDragMode(): NonNullable<DriftEditorOptions['dragMode']> {
    return this.options.dragMode;
  }

  /** 드롭 위치 유지(float) 모드 여부 */
  isFloat(): boolean {
    return !!this.layout.float;
  }

  /** float 모드를 바꾼다. 켜면 현재 배치를 그대로 두고, 끄면 위로 압축된다 (undo 가능) */
  setFloat(float: boolean, opts?: DriftApplyOptions): void {
    if (this.destroyed || this.isFloat() === float) return;
    const next: DriftLayout = { ...this.layout, float };
    if (!float) delete next.float;
    this.commit({ ...next, items: normalizeItems(next.items, next.columns, float) }, 'update', this.applied(opts));
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
    this.scheduleSizeCheck();
    this.throwHookError();
  }

  /** 컨테이너 크기를 다시 측정해 렌더링한다 (자동 감지가 안 되는 환경에서 수동 호출) */
  refresh(): void {
    this.measure();
    this.updateBreakpoint(true);
    this.render();
    this.scheduleSizeCheck();
    this.throwHookError();
  }

  /**
   * 이벤트 리스너, ResizeObserver, 예약된 작업, DOM 을 모두 해제한다.
   * 콘텐츠 훅의 unmount 는 콘텐츠 DOM 을 비우기 전에 모든 항목에 대해 한 번씩 호출된다.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pointer.cancel();
    this.dragIn.dispose();
    // 예약된 크기 알림은 실행되지 않게 취소한다
    if (this.sizeScheduled) cancelRaf(this.sizeRaf);
    this.sizeScheduled = false;
    this.sizeLast.clear();
    this.liveSizes.clear();
    // 외부 인스턴스를 가진 콘텐츠는 DOM 을 지우기 전에 해제한다
    this.itemEls.forEach((el) => this.unmountContent(el));
    this.abort.abort();
    this.resizeObserver?.disconnect();
    this.geo.destroy();
    this.emitter.clear();
    this.element.remove();
    this.container.classList.remove(CLS.editor, CLS.noAnimate);
    this.itemEls.clear();
    this.throwHookError();
  }

  // ───────────────────────────── 렌더링 (내부) ─────────────────────────────

  /** @internal */
  getItemElement(id: string): HTMLElement | undefined {
    return this.itemEls.get(id);
  }

  /** @internal 드래그/리사이즈 자동 스크롤 대상 (옵션 `scrollContainer`, 생략하면 자동 탐색) */
  getScrollTarget(): ScrollTarget {
    return resolveScrollTarget(this.container, this.options.scrollContainer);
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

  /** 현재 모델을 DOM 에 반영하고 반영한 항목 목록을 반환한다 */
  private render(): DriftItem[] {
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
      el.classList.toggle(CLS.noResize, !this.canResize(item));
      // 위치가 고정된 항목은 왼쪽 가장자리를 움직이는 sw 핸들만 숨긴다 (resizable:true 면 se 핸들은 남는다)
      el.classList.toggle(CLS.noResizeLeft, !!item.locked);
    }

    this.itemEls.forEach((el, id) => {
      if (!alive.has(id)) {
        // 외부 인스턴스는 DOM 이 지워지기 전에 해제한다
        this.unmountContent(el);
        el.remove();
        this.itemEls.delete(id);
        this.sizeLast.delete(id);
        this.liveSizes.delete(id);
      }
    });

    this.applyCanvasHeight(items, metrics);
    this.applyGrid(metrics);
    this.syncItemState();
    return items;
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

  // ───────────────────────────── 콘텐츠 수명 ─────────────────────────────

  private captureHookError(error: unknown): void {
    if (!this.hookError) this.hookError = { error };
  }

  /** 콘텐츠 훅에서 발생한 예외를 모두 처리한 뒤(렌더/해제가 끝난 뒤) 첫 예외를 다시 던진다 */
  private throwHookError(): void {
    if (!this.hookError) return;
    const { error } = this.hookError;
    this.hookError = undefined;
    throw error;
  }

  private contentState(el: HTMLElement): ContentState {
    let st = this.contentStates.get(el);
    if (!st) this.contentStates.set(el, (st = { initialized: false, mounted: false, propsJson: '' }));
    return st;
  }

  /**
   * 콘텐츠 정보(title/content/props)가 바뀐 경우에만 콘텐츠를 만들거나 갱신한다.
   * 위치/크기/선택 변경은 여기서 걸러져 콘텐츠를 건드리지 않는다. props 는 참조가 같으면 비교를 건너뛴다.
   */
  private renderContent(el: HTMLElement, item: DriftItem): void {
    const st = this.contentState(el);
    let changed = !st.initialized || st.title !== item.title || st.content !== item.content;
    let propsJson = st.propsJson;
    if (!changed && st.props !== item.props) {
      propsJson = JSON.stringify(item.props || {});
      if (propsJson !== st.propsJson) changed = true;
      else st.props = item.props; // 내용이 같은 새 객체: 다음부터 참조 비교만 한다
    }
    if (!changed) return;
    if (!st.initialized) propsJson = JSON.stringify(item.props || {}); // title/content 변경이면 props 는 같은 참조다

    const handle = el.querySelector(`.${CLS.handle}`) as HTMLElement;
    (handle.querySelector(`.${CLS.title}`) as HTMLElement).textContent = item.title ?? '';
    handle.classList.toggle(CLS.handleEmpty, !item.title);
    el.setAttribute('aria-label', item.title || item.id);

    const contentEl = el.querySelector(`.${CLS.content}`) as HTMLElement;
    const life = this.options.contentLifecycle;
    if (life) {
      const snapshot = cloneItem(item);
      if (!st.mounted) {
        this.mountContent(st, contentEl, snapshot);
      } else if (life.update) {
        try {
          life.update(snapshot, contentEl, st.item as DriftItem);
        } catch (e) {
          this.captureHookError(e);
        }
        st.item = snapshot;
      } else {
        // update 훅이 없으면 해제 후 다시 만든다 (이전 콘텐츠를 비우기 전에 해제한다)
        this.unmountContent(el);
        contentEl.textContent = '';
        this.mountContent(st, contentEl, snapshot);
      }
    } else if (this.options.renderItem) {
      contentEl.textContent = '';
      this.options.renderItem(item, contentEl);
    } else {
      contentEl.textContent = item.content ?? item.id;
    }

    st.initialized = true;
    st.title = item.title;
    st.content = item.content;
    st.props = item.props;
    st.propsJson = propsJson;
  }

  /** mount 를 호출한다. 상태를 먼저 mounted 로 기록해, mount 도중 예외가 나도 unmount 가 한 번 호출되게 한다 */
  private mountContent(st: ContentState, contentEl: HTMLElement, snapshot: DriftItem): void {
    st.mounted = true;
    st.item = snapshot;
    try {
      const cleanup = (this.options.contentLifecycle as NonNullable<DriftEditorOptions['contentLifecycle']>).mount(
        snapshot,
        contentEl,
      );
      if (typeof cleanup === 'function') st.cleanup = cleanup;
    } catch (e) {
      this.captureHookError(e);
    }
  }

  /** 아직 해제되지 않은 콘텐츠만 해제한다 (중복 호출 방지). 콘텐츠 DOM 을 비우거나 지우기 전에 호출해야 한다 */
  private unmountContent(el: HTMLElement): void {
    const st = this.contentStates.get(el);
    if (!st || !st.mounted) return;
    st.mounted = false;
    const cleanup = st.cleanup;
    st.cleanup = undefined;
    const contentEl = el.querySelector(`.${CLS.content}`) as HTMLElement;
    try {
      this.options.contentLifecycle?.unmount?.(st.item as DriftItem, contentEl);
    } catch (e) {
      this.captureHookError(e);
    }
    try {
      cleanup?.();
    } catch (e) {
      this.captureHookError(e);
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

  private commit(next: DriftLayout, reason: DriftChangeReason, r: Applied): void {
    if (layoutsEqual(next, this.layout)) {
      this.render();
      this.throwHookError();
      return;
    }
    // 내부 이력이 꺼져 있거나 이 변경을 기록하지 않기로 했다면 이전 상태를 쌓지 않는다
    if (this.historyEnabled && r.history) this.history.push(this.layout);
    this.replace(next, reason, r);
  }

  private replace(next: DriftLayout, reason: DriftChangeReason, r: Applied): void {
    // 이벤트 리스너가 없으면 변경 전/후 비교와 복사본 생성을 건너뛴다
    const wantEvent = r.emit && this.emitter.has('layoutChange');
    const before = wantEvent ? this.getItems() : [];
    this.layout = next;
    if (this.selectedId && !next.items.some((item) => item.id === this.selectedId)) this.selectedId = null;
    this.updateBreakpoint(true);
    const after = this.render();
    this.scheduleSizeCheck();
    if (wantEvent) this.emitChange(next, reason, r, before, after);
    this.throwHookError();
  }

  /**
   * layoutChange 를 발생시킨다. 첫 인자(레이아웃 복사본)와 info.reason 은 기존과 같고,
   * info.source / info.changes 가 추가되었다. 모두 내부 상태와 분리된 복사본이다.
   */
  private emitChange(
    layout: DriftLayout,
    reason: DriftChangeReason,
    r: Applied,
    before: readonly DriftItem[],
    after: readonly DriftItem[],
  ): void {
    if (!r.emit || !this.emitter.has('layoutChange')) return;
    this.emitter.emit('layoutChange', cloneLayout(layout), {
      reason,
      source: r.source,
      changes: diffItems(before, after),
    });
  }

  // ───────────────────────────── 크기 변경 알림 ─────────────────────────────

  /** @internal sizeNotify:'live' 일 때 사용자 리사이즈 도중의 실제 픽셀 크기를 알린다 */
  notifyLiveSize(id: string, width: number, height: number): void {
    if (this.options.sizeNotify !== 'live') return;
    this.liveSizes.set(id, { width, height });
    this.scheduleSizeCheck();
  }

  /** @internal 리사이즈가 끝나거나 취소되었다: live 크기를 걷어내고 확정된 크기를 다시 확인한다 */
  endLiveSize(id: string): void {
    if (this.liveSizes.delete(id)) this.scheduleSizeCheck();
  }

  /** 다음 프레임에 크기 변경을 한 번만 확인하도록 예약한다 (같은 프레임의 변경은 합쳐진다) */
  private scheduleSizeCheck(): void {
    if (this.destroyed || this.sizeScheduled || !this.emitter.has('sizeChange')) return;
    this.sizeScheduled = true;
    this.sizeRaf = raf(() => this.flushSizes());
  }

  /**
   * 마지막으로 알린 크기와 비교해 실제로 크기가 바뀐 항목만 알린다. 위치만 바뀐 항목은 포함되지 않는다.
   * 셀 크기(w/h)가 같아도 컨테이너 폭/컬럼 수 변화로 픽셀 크기가 바뀌면 cause:'container' 로 포함된다.
   */
  private flushSizes(): void {
    this.sizeScheduled = false;
    this.sizeRaf = 0;
    if (this.destroyed || !this.emitter.has('sizeChange')) return;

    const metrics = this.getMetrics();
    const seen = new Set<string>();
    const changes: DriftSizeChange[] = [];
    for (const item of this.getItems()) {
      seen.add(item.id);
      const live = this.liveSizes.get(item.id);
      const rect = toPixelRect(item, metrics);
      const width = live ? live.width : rect.width;
      const height = live ? live.height : rect.height;
      const prev = this.sizeLast.get(item.id);
      const cellsSame = !!prev && prev.w === item.w && prev.h === item.h;
      if (
        prev &&
        cellsSame &&
        Math.abs(prev.width - width) <= SIZE_EPSILON &&
        Math.abs(prev.height - height) <= SIZE_EPSILON
      ) {
        continue;
      }
      const el = this.itemEls.get(item.id);
      if (!el) continue;
      this.sizeLast.set(item.id, { w: item.w, h: item.h, width, height });
      changes.push({
        id: item.id,
        item: cloneItem(item),
        element: el,
        contentElement: el.querySelector(`.${CLS.content}`) as HTMLElement,
        width,
        height,
        w: item.w,
        h: item.h,
        previous: prev ? { ...prev } : null,
        phase: live ? 'live' : 'end',
        cause: cellsSame ? 'container' : 'layout',
      });
    }
    this.sizeLast.forEach((_v, id) => {
      if (!seen.has(id)) this.sizeLast.delete(id);
    });
    if (changes.length) this.emitter.emit('sizeChange', changes);
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
      if (this.destroyed || this.pointer.isActive() || this.dragIn.isActive()) return;
      if (this.measure()) {
        this.updateBreakpoint(true);
        this.render();
        this.scheduleSizeCheck();
        this.throwHookError();
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
