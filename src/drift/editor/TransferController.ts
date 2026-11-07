import { toGridPosition, toPixelRect } from '@/drift/core/geometry';
import { planTransfer } from '@/drift/core/transfer';
import { resolveItems } from '@/drift/core/responsive';
import type { DriftTransferRejectReason } from '@t/DriftTransfer';
import type { DriftItem } from '@t/DriftLayout';
import { pickCanvas } from './canvasHit';
import { CLS } from './classNames';
import type { DriftEditor } from './DriftEditor';
import type { PointerTransferHost, TransferMoveState } from './PointerController';

/** 놓았을 때 커밋할 이동 요청과, 그 요청을 계산한 시점의 revision (커밋 직전 stale 판정용) */
export interface PendingTransfer {
  source: DriftEditor;
  target: DriftEditor;
  itemId: string;
  x: number;
  y: number;
  sourceRev: number;
  targetRev: number;
}

/** TransferController 가 DriftManager 에 요구하는 연결점 */
export interface TransferHooks {
  /** crossContainerDrag 옵션 */
  enabled(): boolean;
  /** 등록 순서의 에디터들 */
  targets(): readonly DriftEditor[];
  idOf(editor: DriftEditor): string | undefined;
  /** 이동을 트랜잭션으로 커밋한다. 성공하면 대상 항목, 거절이면 undefined (거절 알림은 Manager 가 낸다) */
  commit(request: PendingTransfer): DriftItem | undefined;
  /** 포인터 세션의 거절/취소를 알린다 */
  reject(reason: DriftTransferRejectReason, source: DriftEditor, target: DriftEditor | undefined, itemId: string): void;
}

interface Target {
  editor: DriftEditor;
  rev: number;
  /** 들어온 시점 캔버스 높이의 행 수. 이보다 아래에는 마지막 항목 바로 아래까지만 놓을 수 있다 */
  baseRows: number;
}

interface Session {
  source: DriftEditor;
  itemId: string;
  el: HTMLElement;
  sourceRev: number;
  away: boolean;
  ghost?: HTMLElement;
  target?: Target;
  /** 마지막으로 계산한 대상 셀 (같은 셀·같은 revision 이면 다시 계산하지 않는다) */
  key: string;
  pending?: PendingTransfer;
  reject?: { reason: DriftTransferRejectReason; target: DriftEditor };
}

/**
 * 컨테이너 간 이동의 포인터 부분. 원본 에디터의 PointerController 가 드래그를 소유하고,
 * 포인터가 다른 컨테이너 위로 가면 이 컨트롤러가 ghost(하나)와 대상의 placeholder(하나)·미리보기를 맡는다.
 *
 * - 대상 판정은 외부 끌어오기와 같은 규칙(canvasHit): 보이는 영역, 겹친 캔버스, 연결 해제/destroy 제외.
 * - 미리보기는 core `planTransfer` 로 계산한다(모델 불변). 대상이 바뀌면 이전 대상의 미리보기를 원복한다.
 *   원본과 현재 대상 외의 에디터는 렌더하지 않는다. 같은 셀이면 다시 계산하지 않는다.
 * - 원본/대상의 모델이나 breakpoint 가 바뀌면(revision) 'stale' 로 세션을 취소한다.
 * - document 리스너를 따로 두지 않는다 (원본 PointerController 의 캔버스 리스너와 포인터 캡처를 그대로 쓴다).
 */
export class TransferController implements PointerTransferHost {
  private session?: Session;
  /** end() 로 정리된 뒤 drop() 이 쓸 결과 */
  private settled?: Session;

  constructor(private readonly hooks: TransferHooks) {}

  /** 진행 중인 세션이 이동 모드(원본 밖)인지 */
  isAway(): boolean {
    return !!this.session?.away;
  }

  getSource(): DriftEditor | undefined {
    return this.session?.source;
  }

  begin(source: DriftEditor, itemId: string, el: HTMLElement): boolean {
    this.settled = undefined;
    if (!this.hooks.enabled() || this.hooks.idOf(source) === undefined) return false;
    this.session = { source, itemId, el, sourceRev: source.getRevision(), away: false, key: '' };
    return true;
  }

  move(source: DriftEditor, clientX: number, clientY: number, grabX: number, grabY: number): TransferMoveState {
    const s = this.session;
    if (!s || s.source !== source) return 'source';
    if (!this.hooks.enabled()) {
      // 이동 모드 중에 옵션이 꺼지면 세션을 취소한다. 원본 위의 일반 드래그는 그대로 둔다
      if (!s.away) return 'source';
      this.abort(s, 'disabled');
      return 'cancel';
    }
    if (source.getRevision() !== s.sourceRev) {
      this.abort(s, 'stale');
      return 'cancel';
    }

    const hit = pickCanvas(this.hooks.targets(), clientX, clientY, s.target?.editor ?? source);
    if (hit?.editor === source) {
      this.leave(s);
      this.removeGhost(s);
      s.away = false;
      return 'source';
    }
    s.away = true;
    this.placeGhost(s, clientX - grabX, clientY - grabY);
    if (!hit) {
      // 모든 캔버스 밖: 놓으면 원래 상태로 취소된다 (가장 가까운 대상을 고르지 않는다)
      this.leave(s);
      return 'away';
    }
    if (s.target?.editor !== hit.editor) {
      this.leave(s);
      this.enter(s, hit.editor, hit.canvas);
    }
    const target = s.target as Target;
    if (target.editor.getRevision() !== target.rev) {
      this.abort(s, 'stale');
      return 'cancel';
    }

    const editor = target.editor;
    const visible = source.getItem(s.itemId);
    if (!visible) {
      this.abort(s, 'stale');
      return 'cancel';
    }
    const metrics = editor.getMetrics();
    const columns = editor.getColumns();
    const w = Math.min(visible.w, columns);
    const cell = toGridPosition(clientX - grabX - hit.canvas.left, clientY - grabY - hit.canvas.top, metrics);
    const items = editor.getItems();
    const maxY = Math.max(
      target.baseRows,
      items.reduce((max, item) => Math.max(max, item.y + item.h), 0),
    );
    const x = Math.min(Math.max(cell.x, 0), Math.max(0, columns - w));
    const y = Math.min(Math.max(cell.y, 0), maxY);
    const key = `${x},${y}`;
    if (key === s.key) return 'away';
    s.key = key;

    const bp = editor.getBreakpoint() ?? undefined;
    const plan = planTransfer({
      source: source.getLayout(),
      sourceBreakpoint: source.getBreakpoint() ?? undefined,
      target: editor.getLayout(),
      targetBreakpoint: bp,
      itemId: s.itemId,
      x,
      y,
    });
    const placeholder = editor.getPlaceholder();
    placeholder.hidden = false;
    if (plan.ok) {
      s.pending = { source, target: editor, itemId: s.itemId, x, y, sourceRev: s.sourceRev, targetRev: target.rev };
      s.reject = undefined;
      placeholder.classList.remove(CLS.placeholderInvalid);
      editor.applyRect(placeholder, plan.after);
      editor.renderItems(resolveItems(plan.target, bp));
    } else {
      // ID 충돌·잠금·크기·막힘: 놓을 수 없는 자리를 무효 표시하고 대상은 원래 배치로 둔다
      s.pending = undefined;
      s.reject = { reason: plan.reason, target: editor };
      placeholder.classList.add(CLS.placeholderInvalid);
      editor.applyRect(placeholder, { x, y, w, h: visible.h });
      editor.renderItems(items);
    }
    return 'away';
  }

  end(source: DriftEditor): void {
    const s = this.session;
    if (!s || s.source !== source) return;
    this.session = undefined;
    this.settled = s;
    this.leave(s, true);
    this.removeGhost(s);
  }

  drop(source: DriftEditor): DriftItem | undefined {
    const s = this.settled;
    this.settled = undefined;
    if (!s || s.source !== source || !s.away) return undefined;
    if (s.pending) return this.hooks.commit(s.pending);
    if (s.reject) this.hooks.reject(s.reject.reason, source, s.reject.target, s.itemId);
    return undefined;
  }

  /** 대상 에디터가 해제되었다: 그 미리보기를 걷어낸다 (세션은 계속된다) */
  release(editor: DriftEditor): void {
    const s = this.session;
    if (s?.target?.editor === editor) this.leave(s);
    if (this.settled?.target?.editor === editor || this.settled?.source === editor) this.settled = undefined;
  }

  /** 옵션이 꺼졌다: 이동 모드에 있는 세션을 바로 취소한다 */
  disable(): void {
    const s = this.session;
    if (!s?.away) return;
    this.abort(s, 'disabled');
    s.source.cancelPointer();
  }

  /** Manager destroy: 진행 중인 세션의 원본 드래그를 취소하고 ghost/미리보기를 정리한다 */
  dispose(): void {
    const s = this.session;
    this.settled = undefined;
    if (!s) return;
    try {
      if (!s.source.isDestroyed()) s.source.cancelPointer();
    } finally {
      this.session = undefined;
      this.leave(s, true);
      this.removeGhost(s);
    }
  }

  // ───────────────────────────── 내부 ─────────────────────────────

  private abort(s: Session, reason: DriftTransferRejectReason): void {
    const target = s.target?.editor;
    this.hooks.reject(reason, s.source, target, s.itemId);
  }

  private enter(s: Session, editor: DriftEditor, canvas: DOMRect): void {
    s.target = {
      editor,
      rev: editor.getRevision(),
      baseRows: toGridPosition(0, canvas.height, editor.getMetrics()).y,
    };
    s.key = '';
    // 대상 표시 + 미리보기 중 크기 변화로 다시 그려지지 않게 한다 (외부 끌어오기와 같은 장치)
    editor.setDragInOver(true);
    // 미리보기로 대상 캔버스가 늘어나 아래 컨테이너가 움직이면 포인터가 겨냥한 위치가 어긋나므로 높이를 고정한다
    editor.lockHeight(canvas.height);
  }

  /** 현재 대상의 미리보기를 걷어내고 실제 모델 상태로 되돌린다. keepResult 면 drop 이 쓸 결과는 남긴다 */
  private leave(s: Session, keepResult = false): void {
    const t = s.target;
    s.target = undefined;
    s.key = '';
    if (!keepResult) {
      s.pending = undefined;
      s.reject = undefined;
    }
    if (!t || t.editor.isDestroyed()) return;
    t.editor.setDragInOver(false);
    t.editor.lockHeight(undefined);
    const placeholder = t.editor.getPlaceholder();
    placeholder.hidden = true;
    placeholder.classList.remove(CLS.placeholderInvalid);
    t.editor.renderItems(t.editor.getItems());
  }

  private placeGhost(s: Session, left: number, top: number): void {
    if (!s.ghost) {
      const rect = s.el.getBoundingClientRect();
      const metrics = s.source.getMetrics();
      const item = s.source.getItem(s.itemId);
      const size = item ? toPixelRect(item, metrics) : { width: rect.width, height: rect.height };
      const ghost = s.el.cloneNode(true) as HTMLElement;
      // 복제본은 항목으로 인식되지 않게 식별 속성/클래스를 지운다 (위치 CSS, 쿼리 대상에서 제외)
      ghost.className = CLS.transferGhost;
      [
        'id',
        'data-drift-id',
        'data-x',
        'data-y',
        'data-w',
        'data-h',
        'tabindex',
        'role',
        'aria-label',
        'style',
      ].forEach((name) => ghost.removeAttribute(name));
      ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = `${size.width}px`;
      ghost.style.height = `${size.height}px`;
      document.body.appendChild(ghost);
      s.ghost = ghost;
    }
    s.ghost.style.left = `${left}px`;
    s.ghost.style.top = `${top}px`;
  }

  private removeGhost(s: Session): void {
    s.ghost?.remove();
    s.ghost = undefined;
  }
}
