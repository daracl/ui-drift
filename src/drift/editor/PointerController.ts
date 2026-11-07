import { firstCollision, resolveDragCell, toGridSize, toPixelRect } from '@/drift/core/geometry';
import { moveItem, resizeItem, resizeItemFromLeft } from '@/drift/core/operations';
import type { DriftResizeHandle } from '@t/DriftEditor';
import { DriftItem, DriftRect } from '@t/DriftLayout';
import type { DriftEditor } from './DriftEditor';
import { CLS } from './classNames';
import { measureScrollTarget } from './scrollContainer';

/**
 * 포인터가 원본 캔버스를 벗어났을 때의 상태
 * - source: 원본 캔버스 위(기존 드래그 그대로)
 * - away: 다른 컨테이너 위 또는 모든 캔버스 밖(이동 모드: ghost 가 따라가고 원본은 원위치 미리보기)
 * - cancel: 세션을 취소해야 함(stale, 옵션 해제)
 */
export type TransferMoveState = 'source' | 'away' | 'cancel';

/**
 * 컨테이너 간 이동을 조정하는 쪽(DriftManager 의 TransferController)이 구현한다.
 * PointerController 는 대상 판정, 대상 미리보기, 커밋을 모두 위임하고 원본 쪽 표시만 바꾼다.
 */
export interface PointerTransferHost {
  /** 드래그가 시작될 때: 이 세션을 이동 가능 세션으로 시작할지 (옵션이 꺼져 있으면 false) */
  begin(source: DriftEditor, itemId: string, el: HTMLElement): boolean;
  /** 포인터 위치를 판정하고(대상 미리보기 포함) 상태를 돌려준다 */
  move(source: DriftEditor, clientX: number, clientY: number, grabX: number, grabY: number): TransferMoveState;
  /** 세션 정리 (ghost, 대상 미리보기). 커밋 전에 호출된다 */
  end(source: DriftEditor): void;
  /** 정리가 끝난 뒤 이동을 커밋한다. 성공하면 대상의 항목(복사본), 거절/밖이면 undefined */
  drop(source: DriftEditor): DriftItem | undefined;
}

/** a 가 b 와 겹치는 면적이 a 면적에서 차지하는 비율 */
function overlapRatio(a: DriftRect, b: DriftRect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 && a.width * a.height > 0 ? (w * h) / (a.width * a.height) : 0;
}

/** 클릭과 드래그를 구분하는 이동 임계값(px) */
const DRAG_THRESHOLD = 3;
/** 가장자리 자동 스크롤 영역/속도(px) */
const SCROLL_EDGE = 48;
/** 프레임당 최대 스크롤(px). 가장자리에 가까울수록 빨라지고 영역 안쪽 끝에서는 1px 로 천천히 움직인다 */
/** 항목이 placeholder 에 이 비율 이상 겹치면 자리를 잡은 것으로 보고 이동 방향을 다시 정한다 */
const SETTLE_RATIO = 0.9;
/** 자동 스크롤 대상 요소를 다시 찾는 간격(ms) */
const SCROLL_RESOLVE_MS = 250;
const SCROLL_STEP = 8;

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
  /** 드래그 중 현재 대상 셀(세션 시작 시점 배치 기준). 50% 판정의 기준(히스테리시스)이 된다 */
  cell: { x: number; y: number };
  preview: DriftItem[];
  /** 세로 방향을 정하는 기준 top (px). 처음엔 원래 자리이고, 항목이 placeholder 에 90% 이상 겹치면 그 위치로 다시 잡는다 */
  anchorTop?: number;
  /** 직전 placeholder 의 픽셀 영역 */
  phRect?: DriftRect;
  clientX: number;
  clientY: number;
  scrollRaf: number;
  /** 드래그 중인 요소의 현재 left/top (캔버스 기준 px) */
  dragLeft: number;
  dragTop: number;
  /** 자동 스크롤 대상 요소 캐시. 스타일 계산(getComputedStyle)이 비싸므로 일정 시간마다만 다시 찾는다 */
  scrollEl?: HTMLElement;
  scrollAt: number;
  /** 컨테이너 간 이동이 가능한 세션 (DriftManager 의 crossContainerDrag) */
  transfer?: PointerTransferHost;
  /** 포인터가 원본 캔버스를 벗어나 이동 모드에 있다 */
  away: boolean;
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
      dragLeft: 0,
      dragTop: 0,
      scrollAt: -Infinity,
      away: false,
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
    // 끌다가 캔버스가 길어져 세로 스크롤바가 생기거나 사라져도 캔버스 폭(=셀 크기)이 흔들리지 않도록 세션 동안 폭을 고정한다
    const canvasEl = this.editor.element;
    canvasEl.style.width = `${canvasEl.getBoundingClientRect().width}px`;
    s.el.classList.add(s.kind === 'drag' ? CLS.dragging : CLS.resizing);
    // placeholder 가 (0, 0) 에서 날아오지 않도록 transition 없이 현재 위치에 먼저 배치한 뒤 보여준다
    const placeholder = this.editor.getPlaceholder();
    placeholder.style.transition = 'none';
    this.editor.applyRect(placeholder, s.origin);
    placeholder.hidden = false;
    void placeholder.offsetWidth; // 강제 reflow: 위치가 확정된 뒤에 transition 을 복원한다
    placeholder.style.transition = '';
    // 크기 조절 중에는 컨테이너 이동으로 바뀌지 않는다
    const host = s.kind === 'drag' ? this.editor.getTransferHost() : undefined;
    if (host && host.begin(this.editor, s.id, s.el)) {
      s.transfer = host;
      // 미리보기로 원본 캔버스가 늘어나면 아래 컨테이너가 포인터를 피해 계속 밀려나므로 세션 동안 높이를 고정한다
      this.editor.lockHeight(canvasEl.getBoundingClientRect().height);
    }
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

    if (s.kind === 'drag' && s.transfer) {
      // 다른 컨테이너 위인지, 원본 위인지 판정한다 (대상 미리보기는 host 가 맡는다)
      const state = s.transfer.move(editor, s.clientX, s.clientY, s.grabX, s.grabY);
      if (state === 'cancel') {
        this.cancel();
        return;
      }
      if (state === 'away') {
        this.setAway(s, true);
        return;
      }
      if (s.away) this.setAway(s, false);
    }

    if (s.kind === 'drag') {
      const maxLeft = Math.max(0, canvas.width - originRect.width);
      const left = Math.min(Math.max(s.clientX - canvas.left - s.grabX, 0), maxLeft);
      // 끌고 있는 요소가 캔버스 아래로 나가면 스크롤 영역이 함께 늘어나 자동 스크롤이 끝없이 이어지므로, 캔버스 높이 안으로 제한한다
      const maxTop = Math.max(0, canvas.height - originRect.height);
      const top = Math.min(Math.max(s.clientY - canvas.top - s.grabY, 0), maxTop);
      // 포인터를 따라가는 이동은 transform 으로 한다 (레이아웃을 다시 계산하지 않고 compositor 에서 처리된다).
      // 기준 위치는 data-x/y 로 정해진 원래 자리이며, 끝나면 finish 가 정리한다
      s.dragLeft = left;
      s.dragTop = top;
      s.el.style.transform = `translate3d(${left - originRect.left}px, ${top - originRect.top}px, 0)`;

      // 세로 방향은 기준 위치(처음엔 원래 자리) 대비로 정한다. 아래로 내려와 자리가 바뀐 뒤 살짝 올라가는 정도로는 위로 가는 것으로 보지 않는다.
      // 항목이 placeholder 에 90% 이상 겹치면 자리를 잡은 것이므로, 방향을 그 위치부터 다시 정한다.
      if (
        s.phRect &&
        overlapRatio({ left, top, width: originRect.width, height: originRect.height }, s.phRect) >= SETTLE_RATIO
      )
        s.anchorTop = top;
      const down = top >= (s.anchorTop ?? originRect.top);
      // 진행 방향의 끝이 겹친 항목(셀)의 50% 를 지났을 때만 대상 셀을 바꾼다
      const raw = resolveDragCell(
        s.snapshot,
        s.id,
        s.cell,
        { left, top },
        { w: s.origin.w, h: s.origin.h },
        originRect,
        metrics,
        editor.isFloat(),
        s.preview, // 판정선은 화면에 지금 보이는 위치(밀려 올라간 자리) 기준이다
        down,
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
    s.phRect = toPixelRect(moved, metrics);
    editor.renderItems(preview, s.id);
  }

  private autoScroll(s: Session): void {
    if (s.scrollRaf || typeof requestAnimationFrame === 'undefined') return;
    const step = () => {
      s.scrollRaf = 0;
      if (this.session !== s || !s.active) return;
      // 스크롤 대상(scrollContainer 옵션 또는 자동 탐색한 조상, 없으면 window)의 가시 영역 상단/하단 가장자리에서 동작한다
      if (performance.now() - s.scrollAt > SCROLL_RESOLVE_MS) {
        s.scrollEl = this.editor.getScrollElement();
        s.scrollAt = performance.now();
      }
      const box = s.scrollEl;
      const { top, bottom } = measureScrollTarget(box);
      const edge = Math.min(SCROLL_EDGE, Math.max(0, (bottom - top) / 3)); // 가시 영역이 작아도 위/아래 영역이 겹치지 않게
      const fromTop = top + edge - s.clientY; // 양수이면 위쪽 영역 안 (클수록 가장자리에 가까움)
      const fromBottom = s.clientY - (bottom - edge);
      const depth = fromTop > 0 ? fromTop : fromBottom > 0 ? fromBottom : 0;
      const speed = Math.max(1, Math.round(Math.min(depth / edge, 1) * SCROLL_STEP));
      const dy = depth === 0 ? 0 : fromTop > 0 ? -speed : speed;
      if (dy === 0) return;
      const read = () => (box ? box.scrollTop : window.scrollY);
      const before = read();
      if (box) box.scrollTop += dy;
      else window.scrollBy(0, dy);
      // 스크롤로 캔버스 기준 포인터 좌표가 바뀌므로 드래그 위치와 placeholder 를 다시 계산한다
      if (read() !== before) {
        s.lastKey = '';
        this.update(s);
      }
      s.scrollRaf = requestAnimationFrame(step);
    };
    s.scrollRaf = requestAnimationFrame(step);
  }

  // ───────────────────────────── 종료 ─────────────────────────────

  /** 이동 모드 진입/복귀: 원본에서는 항목을 원위치에 흐리게 두고 미리보기를 걷어낸다 */
  private setAway(s: Session, away: boolean): void {
    if (s.away === away) return;
    s.away = away;
    s.lastKey = '';
    const placeholder = this.editor.getPlaceholder();
    s.el.classList.toggle(CLS.transferSource, away);
    if (away) {
      s.el.style.transform = '';
      s.preview = s.snapshot;
      s.phRect = undefined;
      placeholder.hidden = true;
      placeholder.classList.remove(CLS.placeholderInvalid);
      this.editor.renderItems(s.snapshot, s.id);
    } else {
      placeholder.hidden = false;
    }
  }

  private onUp(e: PointerEvent): void {
    const s = this.session;
    if (!s || e.pointerId !== s.pointerId) return;

    if (s.active && s.transfer) {
      // 놓는 순간의 위치로 대상과 유효성을 한 번 더 확정한다 (stale/옵션 해제면 update 안에서 취소된다)
      s.clientX = e.clientX;
      s.clientY = e.clientY;
      this.update(s);
      if (this.session !== s) return;
      if (s.away) {
        const host = s.transfer;
        const { origin } = s;
        // 세션·ghost·placeholder·capture·RAF 를 정리한 뒤 한 트랜잭션으로 반영한다
        this.finish(s);
        const moved = host.drop(this.editor);
        this.editor.emit('dragEnd', moved ?? origin);
        return;
      }
    }

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
    if (s.transfer) {
      try {
        s.transfer.end(this.editor);
      } finally {
        s.el.classList.remove(CLS.transferSource);
      }
    }
    if (s.scrollRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(s.scrollRaf);
    this.session = undefined;
    try {
      s.el.releasePointerCapture?.(s.pointerId);
    } catch (err) {
      /* 이미 해제됨 */
    }
    if (s.kind === 'drag' && s.el.style.transform) {
      // transform 을 지우면 요소가 원래 자리로 튀므로, 같은 시각 위치를 left/top 으로 옮긴 뒤 스타일을 한 번 반영한다.
      // 그러면 invalidateRect 로 인라인 값이 사라질 때 현재 위치에서 새 자리로 전환(transition)된다
      s.el.style.transition = 'none'; // 따라가기용 transform 전환이 놓는 순간 되감기지 않도록 잠시 끈다
      s.el.style.left = `${s.dragLeft}px`;
      s.el.style.top = `${s.dragTop}px`;
      s.el.style.transform = '';
      void s.el.offsetWidth;
    }
    s.el.classList.remove(CLS.dragging, CLS.resizing);
    s.el.style.removeProperty('transition');
    this.editor.element.style.width = '';
    if (s.transfer) this.editor.lockHeight(undefined);
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
