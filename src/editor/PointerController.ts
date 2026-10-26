import { firstCollision, resolveDragCell, toGridSize, toPixelRect } from '@/core/geometry';
import { moveItem, resizeItem, resizeItemFromLeft } from '@/core/operations';
import type { DriftResizeHandle } from '@t/DriftEditor';
import { DriftItem } from '@t/DriftLayout';
import type { DriftEditor } from './DriftEditor';
import { CLS } from './classNames';

/** 클릭과 드래그를 구분하는 이동 임계값(px) */
const DRAG_THRESHOLD = 3;
/** 가장자리 자동 스크롤 영역/속도(px) */
const SCROLL_EDGE = 48;
const SCROLL_STEP = 14;

const INTERACTIVE = 'input,textarea,select,button,a,[contenteditable="true"],[data-drift-no-drag]';

type SessionKind = 'drag' | 'resize';
type ResizeDir = DriftResizeHandle;

const RESIZE_DIRS: readonly ResizeDir[] = ['se', 'sw', 'e', 'w', 's'];
/** 왼쪽 가장자리를 움직이는 방향 (오른쪽 가장자리 고정, x 와 w 가 함께 바뀐다) */
const fromLeft = (dir: ResizeDir): boolean => dir === 'sw' || dir === 'w';

interface Session {
  kind: SessionKind;
  /** 리사이즈 방향 (se: 오른쪽/아래, sw: 왼쪽/아래, e/w: 너비만, s: 높이만) */
  dir: ResizeDir;
  id: string;
  el: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  /** 항목 좌상단 기준 포인터 오프셋 (드래그) */
  grabX: number;
  grabY: number;
  /** 세션 시작 시점의 항목 목록. 미리보기는 항상 이것을 기준으로 계산한다 */
  snapshot: DriftItem[];
  origin: DriftItem;
  active: boolean;
  lastKey: string;
  /** 드래그 중 현재 대상 셀. 50% 판정의 기준(히스테리시스)이 된다 */
  cell: { x: number; y: number };
  preview: DriftItem[];
  clientX: number;
  clientY: number;
  scrollRaf: number;
}

/**
 * 마우스/터치/펜 입력을 Pointer Events 하나로 처리하는 드래그·리사이즈 컨트롤러.
 *
 * 모바일 정책
 * - touch-action: none 은 드래그 핸들/리사이즈 핸들에만 적용된다(스타일). 카드 본문은 터치 스크롤이 동작한다.
 * - dragMode 'auto' 에서 터치 입력은 핸들에서만 드래그가 시작된다.
 */
export class PointerController {
  private session?: Session;

  constructor(private readonly editor: DriftEditor, signal: AbortSignal) {
    const canvas = editor.element;
    const opts = { signal };
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    canvas.addEventListener('pointermove', (e) => this.onMove(e), opts);
    canvas.addEventListener('pointerup', (e) => this.onUp(e), opts);
    canvas.addEventListener('pointercancel', (e) => this.onCancel(e), opts);
    canvas.addEventListener('lostpointercapture', (e) => this.onCancel(e as PointerEvent), opts);
    canvas.addEventListener('keydown', (e) => this.onKey(e), opts);
    canvas.addEventListener('click', (e) => this.onClick(e), opts);
    // 길게 눌러 나타나는 컨텍스트 메뉴가 터치 드래그를 끊지 않도록 핸들에서는 막는다
    canvas.addEventListener(
      'contextmenu',
      (e) => {
        if ((e.target as Element).closest(`.${CLS.handle},.${CLS.resizeHandle}`)) e.preventDefault();
      },
      opts,
    );
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.cancel(), opts);
  }

  isActive(): boolean {
    return !!this.session?.active;
  }

  /** 진행 중인 세션을 취소하고 원래 위치로 되돌린다 */
  cancel(): void {
    const s = this.session;
    if (!s) return;
    this.finish(s);
  }

  // ───────────────────────────── 시작 ─────────────────────────────

  private onDown(e: PointerEvent): void {
    if (this.session) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const target = e.target as Element;
    const el = target.closest(`.${CLS.item}`) as HTMLElement | null;
    if (!el || !this.editor.element.contains(el)) {
      if (target === this.editor.element) this.editor.clearSelection();
      return;
    }

    const id = el.dataset.driftId as string;
    this.editor.selectFromPointer(id);
    if (document.activeElement !== el && !target.closest(INTERACTIVE)) el.focus({ preventScroll: true });
    if (target.closest(`.${CLS.remove}`)) return;

    const snapshot = this.editor.getItems();
    const origin = snapshot.find((item) => item.id === id);
    if (!origin) return;

    let kind: SessionKind | undefined;
    const grip = target.closest<HTMLElement>(`.${CLS.resizeHandle}`);
    const gripDir = grip?.dataset.dir as ResizeDir | undefined;
    const dir: ResizeDir = gripDir && RESIZE_DIRS.includes(gripDir) ? gripDir : 'se';
    if (grip) {
      // 크기 조절은 위치 고정(locked)과 독립이다. 단 왼쪽 핸들은 x 가 바뀌므로 위치가 고정된 항목에는 쓸 수 없다
      if (this.editor.isResizable() && this.editor.canResize(origin) && !(fromLeft(dir) && origin.locked))
        kind = 'resize';
    } else if (!origin.locked && this.editor.isDraggable() && this.canStartDrag(e, target)) {
      kind = 'drag';
    }
    if (!kind) return;

    const rect = el.getBoundingClientRect();
    this.session = {
      kind,
      dir,
      id,
      el,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      snapshot,
      origin,
      active: false,
      lastKey: '',
      cell: { x: origin.x, y: origin.y },
      preview: snapshot,
      clientX: e.clientX,
      clientY: e.clientY,
      scrollRaf: 0,
    };
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch (err) {
      /* 캡처 실패는 무시한다 (이미 해제된 포인터 등) */
    }
  }

  private canStartDrag(e: PointerEvent, target: Element): boolean {
    if (target.closest(INTERACTIVE)) return false;
    const mode = this.editor.getDragMode();
    const onHandle = !!target.closest(`.${CLS.handle}`);
    if (mode === 'handle') return onHandle;
    if (mode === 'item') return true;
    return e.pointerType === 'touch' ? onHandle : true;
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

  private activate(s: Session): void {
    s.active = true;
    s.el.classList.add(s.kind === 'drag' ? CLS.dragging : CLS.resizing);
    // placeholder 가 (0, 0) 에서 날아오지 않도록 transition 없이 현재 위치에 먼저 배치한 뒤 보여준다
    const placeholder = this.editor.getPlaceholder();
    placeholder.style.transition = 'none';
    this.editor.applyRect(placeholder, s.origin);
    placeholder.hidden = false;
    void placeholder.offsetWidth; // 강제 reflow: 위치가 확정된 뒤에 transition 을 복원한다
    placeholder.style.transition = '';
    this.editor.emit(s.kind === 'drag' ? 'dragStart' : 'resizeStart', s.origin);
  }

  /** 포인터 위치로부터 대상 셀을 계산하고, 셀이 바뀐 경우에만 미리보기를 다시 계산한다 */
  private update(s: Session): void {
    const editor = this.editor;
    const metrics = editor.getMetrics();
    const columns = editor.getColumns();
    const canvas = editor.element.getBoundingClientRect();
    const originRect = toPixelRect(s.origin, metrics);
    let key: string;
    let preview: DriftItem[];
    let target: { x: number; y: number; w: number; h: number };

    if (s.kind === 'drag') {
      const maxLeft = Math.max(0, canvas.width - originRect.width);
      const left = Math.min(Math.max(s.clientX - canvas.left - s.grabX, 0), maxLeft);
      const top = Math.max(s.clientY - canvas.top - s.grabY, 0);
      // 드래그 중에만 포인터를 따라가도록 인라인 left/top 을 쓰고, 끝나면 invalidateRect 가 제거한다
      s.el.style.left = `${left}px`;
      s.el.style.top = `${top}px`;

      // 진행 방향의 끝이 겹친 항목(셀)의 50% 를 지났을 때만 대상 셀을 바꾼다
      const raw = resolveDragCell(
        s.snapshot,
        s.id,
        s.cell,
        { left, top },
        { w: s.origin.w, h: s.origin.h },
        originRect,
        metrics,
      );
      const cell = {
        x: Math.min(Math.max(raw.x, 0), Math.max(0, columns - s.origin.w)),
        y: Math.max(0, raw.y),
      };
      s.cell = cell;
      target = { ...cell, w: s.origin.w, h: s.origin.h };
      key = `${cell.x},${cell.y}`;
      if (key === s.lastKey) return;
      preview = moveItem(s.snapshot, columns, s.id, cell.x, cell.y, editor.isFloat());
    } else if (fromLeft(s.dir)) {
      // 왼쪽에서 조절: 오른쪽 가장자리를 고정하고 포인터 위치를 새 왼쪽 가장자리로 삼는다
      const rightPx = originRect.left + originRect.width;
      const leftPx = Math.min(Math.max(s.clientX - canvas.left, 0), rightPx - metrics.cellWidth);
      const width = rightPx - leftPx;
      const height =
        s.dir === 'w' ? originRect.height : Math.max(metrics.rowHeight, s.clientY - canvas.top - originRect.top);
      s.el.style.left = `${leftPx}px`;
      s.el.style.width = `${width}px`;
      s.el.style.height = `${height}px`;
      editor.notifyLiveSize(s.id, width, height);

      const size = toGridSize(width, height, metrics);
      const right = s.origin.x + s.origin.w;
      key = `w${size.w},${size.h}`;
      if (key === s.lastKey) return;
      preview = resizeItemFromLeft(s.snapshot, columns, s.id, size.w, size.h, editor.isFloat());
      // 무효 표시는 '요청한' 크기(경계/min/max 보정 후)로 판정한다. 거부되면 결과는 원래 크기로 돌아가기 때문
      const minW = Math.max(1, s.origin.minW ?? 1);
      const maxW = Math.max(minW, Math.min(right, columns, s.origin.maxW ?? columns));
      const w = Math.min(Math.max(size.w, minW), maxW);
      target = { x: right - w, y: s.origin.y, w, h: size.h };
    } else {
      // e: 너비만, s: 높이만 바꾸고 다른 축은 원래 크기를 유지한다
      const width =
        s.dir === 's' ? originRect.width : Math.max(metrics.cellWidth, s.clientX - canvas.left - originRect.left);
      const height =
        s.dir === 'e' ? originRect.height : Math.max(metrics.rowHeight, s.clientY - canvas.top - originRect.top);
      const liveWidth = Math.min(width, canvas.width - originRect.left);
      s.el.style.width = `${liveWidth}px`;
      s.el.style.height = `${height}px`;
      editor.notifyLiveSize(s.id, liveWidth, height);

      const size = toGridSize(width, height, metrics);
      target = { x: s.origin.x, y: s.origin.y, ...size };
      key = `${size.w},${size.h}`;
      if (key === s.lastKey) return;
      preview = resizeItem(s.snapshot, columns, s.id, size.w, size.h, editor.isFloat(), editor.isLockedResizable());
    }

    s.lastKey = key;
    s.preview = preview;
    const moved = preview.find((item) => item.id === s.id) as DriftItem;
    const lockedHit = firstCollision(
      s.snapshot.filter((item) => item.locked && item.id !== s.id), // 크기를 조절하는 자기 자신(locked)은 제외한다
      target,
    );

    const placeholder = editor.getPlaceholder();
    placeholder.classList.toggle(CLS.placeholderInvalid, !!lockedHit);
    editor.applyRect(placeholder, moved);
    editor.renderItems(preview, s.id);
  }

  private autoScroll(s: Session): void {
    if (s.scrollRaf || typeof requestAnimationFrame === 'undefined') return;
    const step = () => {
      s.scrollRaf = 0;
      if (this.session !== s || !s.active) return;
      const dy =
        s.clientY < SCROLL_EDGE ? -SCROLL_STEP : s.clientY > window.innerHeight - SCROLL_EDGE ? SCROLL_STEP : 0;
      if (dy === 0) return;
      const before = window.scrollY;
      window.scrollBy(0, dy);
      if (window.scrollY !== before) {
        s.lastKey = '';
        this.update(s);
      }
      s.scrollRaf = requestAnimationFrame(step);
    };
    s.scrollRaf = requestAnimationFrame(step);
  }

  // ───────────────────────────── 종료 ─────────────────────────────

  private onUp(e: PointerEvent): void {
    const s = this.session;
    if (!s || e.pointerId !== s.pointerId) return;

    const { active, kind, preview, origin, id } = s;
    this.finish(s);

    if (!active) return; // 이동하지 않았으면 클릭(선택)으로 끝난다

    this.editor.commitEffective(preview, kind === 'drag' ? 'drag' : 'resize', { source: 'user' });
    const item = this.editor.getItem(id) || origin;
    this.editor.emit(kind === 'drag' ? 'dragEnd' : 'resizeEnd', item);
  }

  private onCancel(e: PointerEvent): void {
    const s = this.session;
    if (!s || (e.pointerId !== undefined && e.pointerId !== s.pointerId)) return;
    this.cancel();
  }

  /** 세션 상태를 정리한다. 요소의 최종 위치는 호출한 쪽에서 render 로 맞춘다 */
  private finish(s: Session): void {
    if (s.scrollRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(s.scrollRaf);
    this.session = undefined;
    try {
      s.el.releasePointerCapture?.(s.pointerId);
    } catch (err) {
      /* 이미 해제됨 */
    }
    s.el.classList.remove(CLS.dragging, CLS.resizing);
    this.editor.getPlaceholder().hidden = true;
    this.editor.getPlaceholder().classList.remove(CLS.placeholderInvalid);
    this.editor.invalidateRect(s.el);
    this.editor.endLiveSize(s.id);
    this.editor.renderItems(this.editor.getItems());
  }

  // ───────────────────────────── 키보드 / 클릭 ─────────────────────────────

  private onClick(e: MouseEvent): void {
    const btn = (e.target as Element).closest(`.${CLS.remove}`);
    if (!btn) return;
    const id = (btn.closest(`.${CLS.item}`) as HTMLElement | null)?.dataset.driftId;
    if (id) this.editor.removeItem(id, { source: 'user' });
  }

  private onKey(e: KeyboardEvent): void {
    // 내부 키보드 처리를 끈 경우(keyboard:false)에는 항목 키 처리를 모두 건너뛴다.
    // 진행 중인 드래그/리사이즈/외부 끌어오기의 Esc 취소는 document 리스너에서 따로 처리하므로 영향받지 않는다
    if (!this.editor.isKeyboard()) return;
    const el = e.target as HTMLElement;
    // 항목 자체에 포커스가 있을 때만 처리한다 (내부 입력 요소의 키 입력은 건드리지 않는다)
    if (!el.classList?.contains(CLS.item)) return;
    const id = el.dataset.driftId as string;
    const item = this.editor.getItem(id);
    if (!item) return;

    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const dir = arrows[e.key];
    if (dir) {
      e.preventDefault();
      if (e.shiftKey) {
        if (this.editor.isResizable() && this.editor.canResize(item))
          this.editor.resizeItem(id, item.w + dir[0], item.h + dir[1], { source: 'user' });
      } else if (!item.locked && this.editor.isDraggable()) {
        this.editor.moveItem(id, item.x + dir[0], item.y + dir[1], { source: 'user' });
      }
      this.editor.getItemElement(id)?.focus({ preventScroll: true });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.editor.isRemovable()) {
      e.preventDefault();
      this.editor.removeItem(id, { source: 'user' });
    } else if (e.key === 'Escape') {
      this.editor.clearSelection();
    }
  }
}
