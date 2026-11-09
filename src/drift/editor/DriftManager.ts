import { cloneJson, isString } from '@daracl/core/utils';
import { planTransfer } from '@/drift/core/transfer';
import { assertContainerId, parseContainerData, serializeContainerData } from '@/drift/core/containers';
import { cloneLayout } from '@/drift/core/layout';
import { CONTAINER_DATA_VERSION } from '@/drift/constants';
import { Emitter } from '@/event/Emitter';
import type {
  DriftApplyOptions,
  DriftChangeInfo,
  DriftDragInDropResult,
  DriftDragInOptions,
  DriftDragInSource,
  DriftEditorOptions,
} from '@t/DriftEditor';
import type { DriftContainerData, DriftContainerHeight, DriftItem, DriftLayout } from '@t/DriftLayout';
import type {
  DriftItemTransferEvent,
  DriftManagerOptions,
  DriftTransferOptions,
  DriftTransferRejectEvent,
  DriftTransferRejectReason,
  DriftTransferRequest,
  DriftTransferResult,
} from '@t/DriftTransfer';
import { DragInController, DragInHost } from './DragInController';
import { DriftEditor, EditorTxToken, getEditorOf } from './DriftEditor';
import type { HistoryLink } from './History';
import { PendingTransfer, TransferController } from './TransferController';

/** 공통 팔레트에서 끌어 놓은 결과. 단일 에디터의 결과에 대상 컨테이너 정보가 더해진다 */
export interface DriftManagerDropResult extends DriftDragInDropResult {
  /** 드롭된 컨테이너 id */
  containerId: string;
  /** 드롭된 컨테이너의 에디터 */
  editor: DriftEditor;
}

/** `DriftManager.setupDragIn()` 옵션. `onDrop` 이 대상 컨테이너 정보를 함께 받는 것 외에는 에디터의 옵션과 같다 */
export interface DriftManagerDragInOptions extends Omit<DriftDragInOptions, 'onDrop'> {
  /**
   * 어느 한 컨테이너에 정상적으로 드롭했을 때 한 번 호출된다 (컨테이너 밖 드롭, Esc, pointercancel 에서는 호출되지 않는다).
   * 정리 순서와 autoAdd 의미는 `DriftEditor.setupDragIn()` 과 같다.
   */
  onDrop?: (result: DriftManagerDropResult) => void;
}

/** `register()` 옵션. 에디터 옵션에 컨테이너 자체의 속성이 더해진다 */
export interface DriftManagerRegisterOptions extends DriftEditorOptions {
  /**
   * Viewer fitHeight 에서의 컨테이너 높이 방식. 'auto' 면 남은 높이를 행 수 비율로 나눠 채우고, 생략하면 고정 높이다.
   * `getLayouts()`/`toJSON()` 에 함께 저장된다 (`renderContainersViewer` 가 사용). `fromJSON()` 은 바꾸지 않는다.
   */
  height?: DriftContainerHeight;
}

/** `fromJSON()` 옵션 */
export interface DriftManagerLoadOptions extends DriftApplyOptions {
  /**
   * 데이터에 있지만 등록되지 않은 컨테이너를 어떻게 처리할지.
   * - 'error'(기본): 아무것도 바꾸지 않고 예외를 던진다.
   * - 'ignore': 그 컨테이너만 건너뛴다.
   * 컨테이너를 자동으로 만들지는 않는다 (DOM 요소는 데이터만으로 알 수 없다). 먼저 `register()` 한 뒤 복원한다.
   */
  unknown?: 'error' | 'ignore';
}

export interface DriftManagerEvents {
  /** 컨테이너가 등록되었다 */
  containerRegistered: (event: { containerId: string; editor: DriftEditor }) => void;
  /** 컨테이너 등록이 해제되었다 (에디터는 이미 destroy 되었다) */
  containerUnregistered: (event: { containerId: string }) => void;
  /** 활성 컨테이너가 바뀌었다. 활성 대상이 없어지면 containerId/editor 가 null */
  activeChange: (event: { containerId: string | null; previousId: string | null; editor: DriftEditor | null }) => void;
  /**
   * 어느 컨테이너의 레이아웃이 바뀌었다. layout/info 는 그 에디터의 `layoutChange` 인자와 같다
   * (reason/source/changes 의미 동일, 내부 상태와 분리된 복사본).
   */
  layoutChange: (event: {
    containerId: string;
    editor: DriftEditor;
    layout: DriftLayout;
    info: DriftChangeInfo;
  }) => void;
  /** 공통 팔레트에서 끌기 시작 */
  dragInStart: (event: { source: HTMLElement }) => void;
  /**
   * 공통 팔레트 끌기가 끝났다. 추가된 항목과 그 컨테이너. 취소/컨테이너 밖이면 둘 다 null,
   * autoAdd:false 의 정상 드롭이면 item 은 null 이고 containerId 는 드롭한 컨테이너다.
   */
  dragInEnd: (event: { containerId: string | null; item: DriftItem | null }) => void;
  /** 컨테이너 간 이동이 완료되었다 (이동, 연결 undo, 연결 redo 마다 한 번) */
  itemTransfer: (event: DriftItemTransferEvent) => void;
  /** 포인터로 놓은 이동이 거절되었거나 진행 중인 이동 세션이 취소되었다 (API 이동은 결과 객체로만 알린다) */
  transferReject: (event: DriftTransferRejectEvent) => void;
}

interface Entry {
  id: string;
  editor: DriftEditor;
  container: HTMLElement;
  /** Viewer fitHeight 높이 방식 (생략 = 고정) */
  height?: DriftContainerHeight;
  /** 컨테이너에 붙인 리스너(활성 감지) 해제용 */
  abort: AbortController;
  /** layoutChange 전달 리스너 해제 함수 (Manager 에 layoutChange 리스너가 있을 때만 붙는다) */
  offLayout?: () => void;
  offDestroy: () => void;
}

/**
 * 여러 개의 독립된 DriftEditor 를 하나의 페이지에서 등록·관리한다.
 *
 * - 각 에디터는 레이아웃/이력/선택/breakpoint/콘텐츠 수명/이벤트를 독립적으로 가진다. Manager 는 등록과 해제,
 *   활성 컨테이너, 공통 팔레트 끌어오기, 이벤트 집계, 여러 레이아웃의 저장·복원만 맡는다.
 * - Manager 가 만든 에디터는 Manager 가 소유한다: `unregister()`/`destroy()` 가 에디터를 destroy 한다.
 *   컨테이너 요소 자체는 호출자의 것이므로 지우지 않는다 (에디터가 만든 내부 DOM 만 정리된다).
 * - 에디터를 직접 `destroy()` 해도 등록이 자동으로 해제된다.
 */
export class DriftManager {
  private readonly entries = new Map<string, Entry>();
  private readonly byEditor = new Map<DriftEditor, Entry>();
  private readonly emitter = new Emitter<DriftManagerEvents>();
  private readonly dragIn: DragInController;
  private activeId: string | null = null;
  private destroyed = false;
  /** 에디터의 layoutChange 를 Manager 로 전달 중인지 */
  private forwarding = false;
  /** 컨테이너 간 포인터 이동 허용 (옵션 crossContainerDrag) */
  private crossDrag: boolean;
  private readonly transfer: TransferController;
  /** 이동/연결 undo·redo 를 처리하는 중 (재진입 이동은 'busy' 로 거절) */
  private busy = false;
  private txSeq = 0;

  constructor(options: DriftManagerOptions = {}) {
    this.crossDrag = options.crossContainerDrag === true;
    this.transfer = new TransferController({
      enabled: () => this.crossDrag && !this.destroyed,
      targets: () => Array.from(this.entries.values(), (e) => e.editor),
      idOf: (editor) => this.byEditor.get(editor)?.id,
      commit: (request) => this.commitPointer(request),
      reject: (reason, source, target, itemId) => this.emitReject(reason, source, target, itemId),
    });
    const host: DragInHost = {
      targets: () => Array.from(this.entries.values(), (e) => e.editor),
      ignores: (target) => {
        for (const e of this.entries.values()) if (e.editor.element.contains(target)) return true;
        return false;
      },
      start: (source) => this.emitter.emit('dragInStart', { source }),
      end: (item, target) => {
        const entry = target ? this.byEditor.get(target) : undefined;
        const errors = new ErrorCollector();
        // 드롭한 컨테이너를 활성으로 만든다 (이어서 undo 등을 바로 할 수 있게).
        // activeChange 리스너가 실패해도 dragInEnd 는 발생해야 한다
        if (entry) errors.run(() => this.activate(entry.id));
        errors.run(() => this.emitter.emit('dragInEnd', { containerId: entry?.id ?? null, item }));
        errors.throw();
      },
    };
    this.dragIn = new DragInController(host);
  }

  // ───────────────────────────── 등록 ─────────────────────────────

  /**
   * 컨테이너를 등록하고 그 안에 에디터를 만든다. 반환된 에디터는 Manager 가 소유한다.
   * @param id 컨테이너 id (비어 있지 않은 문자열, Manager 안에서 유일)
   * @param container 요소 또는 CSS selector (`createDriftEditor` 와 같은 규칙)
   * @param options 이 에디터에만 적용되는 옵션
   */
  register(id: string, container: HTMLElement | string, options: DriftManagerRegisterOptions = {}): DriftEditor {
    if (this.destroyed) throw new Error('[drift] 이미 destroy 된 manager 입니다.');
    assertContainerId(id);
    if (this.entries.has(id)) throw new Error(`[drift] 이미 등록된 컨테이너 id 입니다: ${id}`);
    const el = isString(container) ? document.querySelector<HTMLElement>(container) : container;
    if (!el || !(el instanceof HTMLElement)) {
      throw new Error(`[drift] 컨테이너를 찾을 수 없습니다: ${String(container)}`);
    }
    // 같은 요소에 에디터가 겹치면 DOM/리스너가 섞이므로 금지한다 (다른 Manager 나 createDriftEditor 로 만든 경우 포함)
    if (getEditorOf(el)) throw new Error(`[drift] 이미 에디터가 사용 중인 컨테이너입니다: ${id}`);

    const { height, ...editorOptions } = options;
    let editor: DriftEditor;
    try {
      editor = new DriftEditor(el, editorOptions);
    } catch (e) {
      // 생성 도중(초기 렌더링 등) 실패하면 만들어진 리소스를 정리하고 등록하지 않는다
      const partial = getEditorOf(el);
      try {
        partial?.destroy();
      } catch (ignored) {
        /* 원래 예외를 우선한다 */
      }
      throw e;
    }

    const abort = new AbortController();
    const entry: Entry = {
      id,
      editor,
      container: el,
      height: height === 'auto' ? 'auto' : undefined,
      abort,
      // 에디터가 직접 destroy 되면 등록만 정리한다 (에디터는 이미 해제 중)
      offDestroy: editor.on('destroy', () => this.remove(entry, false)),
    };
    // 컨테이너를 누르거나 포커스가 들어오면 활성으로 만든다. capture 라 항목/핸들에서 시작해도 먼저 처리된다
    const opts = { signal: abort.signal, capture: true };
    el.addEventListener('pointerdown', () => this.activate(id), opts);
    el.addEventListener('focusin', () => this.activate(id), opts);

    this.entries.set(id, entry);
    this.byEditor.set(editor, entry);
    // 컨테이너 간 이동 조정자. 옵션이 꺼져 있으면 기존 단일 에디터 드래그만 한다
    editor.setTransferHost(this.transfer);
    if (this.forwarding) this.forward(entry);
    this.emitter.emit('containerRegistered', { containerId: id, editor });
    return editor;
  }

  /**
   * 컨테이너 등록을 해제하고 에디터를 destroy 한다. 나머지 컨테이너는 그대로다.
   * 진행 중인 공통 팔레트 끌기가 이 컨테이너를 미리보기하고 있으면 미리보기를 걷어낸다 (끌기는 계속된다).
   * 등록되지 않은 id 면 false.
   */
  unregister(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.remove(entry, true);
    return true;
  }

  private remove(entry: Entry, destroyEditor: boolean): void {
    // 재진입(이벤트 콜백 안의 unregister, 에디터 destroy 이벤트)에도 한 번만 처리되도록 먼저 등록부터 지운다
    if (this.entries.get(entry.id) !== entry) return;
    this.entries.delete(entry.id);
    this.byEditor.delete(entry.editor);
    entry.abort.abort();
    entry.offLayout?.();
    entry.offLayout = undefined;
    entry.offDestroy();
    // 이벤트 콜백이나 콘텐츠 훅이 예외를 던져도 나머지 해제 단계는 모두 실행하고, 끝난 뒤 첫 예외를 다시 던진다
    const errors = new ErrorCollector();
    errors.run(() => this.dragIn.release(entry.editor));
    errors.run(() => this.transfer.release(entry.editor));
    entry.editor.setTransferHost(undefined);
    if (this.activeId === entry.id) errors.run(() => this.activate(null));
    if (destroyEditor) errors.run(() => entry.editor.destroy());
    errors.run(() => this.emitter.emit('containerUnregistered', { containerId: entry.id }));
    errors.throw();
  }

  // ───────────────────────────── 조회 ─────────────────────────────

  get(id: string): DriftEditor | undefined {
    return this.entries.get(id)?.editor;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** 컨테이너의 Viewer fitHeight 높이 방식. 고정 높이거나 등록되지 않았으면 undefined */
  getContainerHeight(id: string): DriftContainerHeight | undefined {
    return this.entries.get(id)?.height;
  }

  /**
   * 컨테이너의 Viewer fitHeight 높이 방식을 바꾼다 ('auto' 또는 undefined = 고정). 편집 화면과 이력에는 영향이 없고
   * 이후 `getLayouts()`/`toJSON()` 결과에 반영된다. 등록되지 않은 id 면 false.
   */
  setContainerHeight(id: string, height: DriftContainerHeight | undefined): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.height = height === 'auto' ? 'auto' : undefined;
    return true;
  }

  /** 등록 순서의 컨테이너 id 목록 */
  getIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /** 등록 순서의 `{ id, editor }` 목록 */
  getAll(): { id: string; editor: DriftEditor }[] {
    return Array.from(this.entries.values(), (e) => ({ id: e.id, editor: e.editor }));
  }

  /** 에디터의 컨테이너 id (이 Manager 에 등록되지 않았으면 undefined) */
  getIdOf(editor: DriftEditor): string | undefined {
    return this.byEditor.get(editor)?.id;
  }

  // ───────────────────────────── 활성 컨테이너 ─────────────────────────────

  /** 활성 컨테이너를 지정한다. null 이면 활성 대상 없음. 등록되지 않은 id 는 예외 */
  setActive(id: string | null): void {
    if (this.destroyed) return;
    if (id !== null && !this.entries.has(id)) throw new Error(`[drift] 등록되지 않은 컨테이너입니다: ${id}`);
    this.activate(id);
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getActiveEditor(): DriftEditor | null {
    return this.activeId ? this.entries.get(this.activeId)?.editor ?? null : null;
  }

  private activate(id: string | null): void {
    if (this.activeId === id) return;
    const previousId = this.activeId;
    this.activeId = id;
    this.emitter.emit('activeChange', { containerId: id, previousId, editor: this.getActiveEditor() });
  }

  // ───────────────────────────── 공통 팔레트 ─────────────────────────────

  /**
   * 하나의 팔레트에서 등록된 모든 컨테이너로 끌어다 놓을 수 있게 한다. 포인터 아래의 컨테이너 하나에만 추가된다.
   * 나중에 등록한 컨테이너도 바로 대상이 된다. 반환된 함수로 해제한다 (`destroy()` 시에도 자동 해제).
   * 같은 원본을 에디터의 `setupDragIn()` 에도 등록하면 한 번의 끌기를 양쪽이 처리하므로 한쪽에만 등록한다.
   */
  setupDragIn(source: DriftDragInSource, options: DriftManagerDragInOptions = {}): () => void {
    if (this.destroyed) throw new Error('[drift] 이미 destroy 된 manager 입니다.');
    const { onDrop, ...rest } = options;
    return this.dragIn.setup(source, {
      ...rest,
      onDrop: onDrop
        ? (result, target) => {
            const containerId = this.byEditor.get(target)?.id;
            if (containerId !== undefined) onDrop({ ...result, containerId, editor: target });
          }
        : undefined,
    });
  }

  /** 진행 중인 공통 팔레트 끌기를 취소한다 */
  cancelDragIn(): void {
    this.dragIn.cancel();
  }

  // ───────────────────────────── 컨테이너 간 이동 ─────────────────────────────

  /**
   * 컨테이너 사이의 포인터 이동을 켜고 끈다. 끄면 진행 중인 이동(다른 컨테이너 위) 세션은 'disabled' 로 취소된다.
   * API 이동(transferItem)은 이 설정과 무관하다.
   */
  setCrossContainerDrag(enabled: boolean): void {
    if (this.destroyed) return;
    this.crossDrag = enabled === true;
    if (!this.crossDrag) this.transfer.disable();
  }

  isCrossContainerDrag(): boolean {
    return this.crossDrag;
  }

  /**
   * 항목을 다른 컨테이너로 옮긴다. 두 레이아웃을 먼저 계산·검증하고 한 트랜잭션으로 반영한다.
   *
   * - x/y 를 둘 다 생략하면 대상의 자동 배치, 둘 다 주면 대상의 현재 편집 breakpoint 셀 좌표. 하나만 주거나 유한한 숫자가 아니면 예외.
   * - 예상 가능한 거절(잠금, id 충돌, 크기, 막힘, 같은 컨테이너 등)은 `{ moved: false, reason }` 이며 아무것도 바꾸지 않는다.
   * - 성공하면 원본 layoutChange(remove) → 대상 layoutChange(add) → 대상 활성·항목 선택 → itemTransfer 순서로 알린다.
   *   알림 콜백의 예외는 완료된 이동을 되돌리지 않으며, 나머지 알림을 마친 뒤 첫 예외를 던진다.
   * - 렌더(콘텐츠 훅) 단계에서 실패하면 두 에디터의 모델·선택·이력을 이전 상태로 되돌리고 예외를 던진다.
   * - 두 에디터의 이력에 같은 transactionId 의 연결 기록을 남긴다. 어느 쪽 undo()/redo() 든 양쪽을 함께 처리한다.
   */
  transferItem(request: DriftTransferRequest, options: DriftTransferOptions = {}): DriftTransferResult {
    if (!request || typeof request !== 'object') throw new Error('[drift] transferItem 에는 요청 객체가 필요합니다.');
    const { from, to, itemId, x, y, newId } = request;
    if (typeof from !== 'string' || typeof to !== 'string' || typeof itemId !== 'string') {
      throw new Error('[drift] transferItem: from, to, itemId 는 문자열이어야 합니다.');
    }
    if ((x === undefined) !== (y === undefined))
      throw new Error('[drift] transferItem: x 와 y 는 함께 지정해야 합니다.');
    if (x !== undefined && (!Number.isFinite(x) || !Number.isFinite(y))) {
      throw new Error('[drift] transferItem: x, y 는 유한한 숫자여야 합니다.');
    }
    if (newId !== undefined && (typeof newId !== 'string' || newId.trim() === '')) {
      throw new Error('[drift] transferItem: newId 는 비어 있지 않은 문자열이어야 합니다.');
    }
    const source = options.source ?? 'api';
    if (source !== 'api' && source !== 'user')
      throw new Error(`[drift] transferItem: 알 수 없는 source 입니다: ${String(source)}`);
    return this.runTransfer({ from, to, itemId, x, y, newId }, source);
  }

  /** 포인터 drop 의 커밋. 계산 시점 이후 원본/대상이 바뀌었으면 stale */
  private commitPointer(p: PendingTransfer): DriftItem | undefined {
    const from = this.byEditor.get(p.source)?.id;
    const to = this.byEditor.get(p.target)?.id;
    if (from === undefined || to === undefined) {
      this.emitReject('missing-container', p.source, p.target, p.itemId);
      return undefined;
    }
    const result = this.runTransfer({ from, to, itemId: p.itemId, x: p.x, y: p.y }, 'user', p);
    if (result.moved) return result.item;
    this.emitReject(result.reason, p.source, p.target, p.itemId);
    return undefined;
  }

  private emitReject(
    reason: DriftTransferRejectReason,
    source: DriftEditor,
    target: DriftEditor | undefined,
    itemId: string,
  ): void {
    const from = this.byEditor.get(source)?.id;
    if (from === undefined || !this.emitter.has('transferReject')) return;
    const to = target ? this.byEditor.get(target)?.id ?? null : null;
    this.emitter.emit('transferReject', { reason, from, to, itemId });
  }

  private runTransfer(
    req: DriftTransferRequest,
    source: 'api' | 'user',
    expect?: { sourceRev: number; targetRev: number },
  ): DriftTransferResult {
    const reject = (reason: DriftTransferRejectReason): DriftTransferResult => ({ moved: false, reason });
    if (this.destroyed) return reject('destroyed');
    if (this.busy) return reject('busy');
    const fromEntry = this.entries.get(req.from);
    const toEntry = this.entries.get(req.to);
    if (!fromEntry || !toEntry) return reject('missing-container');
    if (fromEntry === toEntry) return reject('same-container');
    const S = fromEntry.editor;
    const T = toEntry.editor;
    if (S.isDestroyed() || T.isDestroyed()) return reject('missing-container');
    if (!S.element.isConnected || !T.element.isConnected) return reject('disconnected');
    if (expect && (S.getRevision() !== expect.sourceRev || T.getRevision() !== expect.targetRev)) {
      return reject('stale');
    }

    const plan = planTransfer({
      source: S.getLayout(),
      sourceBreakpoint: S.getBreakpoint() ?? undefined,
      target: T.getLayout(),
      targetBreakpoint: T.getBreakpoint() ?? undefined,
      itemId: req.itemId,
      x: req.x,
      y: req.y,
      newId: req.newId,
    });
    if (!plan.ok) return reject(plan.reason);

    const transactionId = `tx-${Date.now().toString(36)}-${++this.txSeq}`;
    const fromId = fromEntry.id;
    const toId = toEntry.id;
    this.busy = true;
    const errors = new ErrorCollector();
    try {
      // 1) 두 모델을 준비된 상태로 반영(렌더). 콘텐츠 훅 실패면 두 쪽을 모두 이전 상태로 되돌린다
      const ts = S.txBegin();
      const tt = T.txBegin();
      this.applyBoth(S, T, ts, tt, () => {
        S.txApply(plan.source);
        T.txApply(plan.target);
      });

      // 2) 이력: 양쪽 모두 이력을 쓰면 연결 기록, 아니면 두 쪽 이력을 비운다 (오래된 스냅샷 undo 로 복제되지 않게)
      const link =
        S.isHistory() && T.isHistory()
          ? new TransferLink(transactionId, S, T, {
              canRun: (l, kind) => this.canRunLink(l, kind),
              run: (l, kind, opts) => this.runLink(l, kind, opts),
            })
          : null;
      if (link) this.links.set(link, { fromId, toId, before: plan.before, after: plan.after });
      S.txRecord(ts, link);
      T.txRecord(tt, link);

      // 3) 알림: 원본 → 대상 → 활성/선택 → itemTransfer. 콜백 예외는 모아 두었다가 마지막에 던진다
      errors.run(() => S.txNotify('remove', source, ts, transactionId, { type: 'remove', item: plan.before }));
      errors.run(() => T.txNotify('add', source, tt, transactionId, { type: 'add', item: plan.after }));
      errors.run(() => this.focusMoved(toId, T, plan.after.id));
      errors.run(() =>
        this.emitTransfer(S, T, source, {
          transactionId,
          action: 'transfer',
          from: fromId,
          to: toId,
          beforeItem: plan.before,
          afterItem: plan.after,
          source,
        }),
      );
    } finally {
      this.busy = false;
    }
    errors.throw();
    return { moved: true, transactionId, from: fromId, to: toId, item: cloneJson(plan.after) };
  }

  /** 두 에디터 반영을 실행하고, 실패(예외 또는 보관된 콘텐츠 훅 예외)하면 두 쪽을 모두 되돌리고 예외를 던진다 */
  private applyBoth(S: DriftEditor, T: DriftEditor, ts: EditorTxToken, tt: EditorTxToken, apply: () => void): void {
    let failure: { error: unknown } | undefined;
    try {
      apply();
    } catch (error) {
      failure = { error };
    }
    const hookA = S.txTakeError();
    const hookB = T.txTakeError();
    failure = failure ?? hookA ?? hookB;
    if (!failure) return;
    // 복원 중의 훅 예외는 버리고 원래 예외를 전달한다 (외부 부수효과까지 되돌린다고 보장하지는 않는다)
    for (const [editor, token] of [
      [S, ts],
      [T, tt],
    ] as const) {
      try {
        editor.txRollback(token);
      } catch (ignored) {
        /* 원래 예외를 우선한다 */
      }
    }
    throw failure.error;
  }

  /** 이동이 끝난 대상을 활성으로 만들고 옮긴 항목을 선택·포커스한다 (해제되었으면 건너뛴다) */
  private focusMoved(containerId: string, editor: DriftEditor, itemId: string): void {
    if (this.entries.get(containerId)?.editor !== editor || editor.isDestroyed()) return;
    this.activate(containerId);
    if (editor.isDestroyed() || !editor.getItem(itemId)) return;
    editor.select(itemId);
    editor.getItemElement(itemId)?.focus({ preventScroll: true });
  }

  /** itemTransfer: API 변경은 두 에디터 중 하나라도 programmaticEvents:false 면 억제한다 */
  private emitTransfer(S: DriftEditor, T: DriftEditor, source: 'api' | 'user', event: DriftItemTransferEvent): void {
    if (!this.emitter.has('itemTransfer')) return;
    if (source !== 'user' && !(S.emitsProgrammatic() && T.emitsProgrammatic())) return;
    this.emitter.emit('itemTransfer', {
      ...event,
      beforeItem: cloneJson(event.beforeItem),
      afterItem: cloneJson(event.afterItem),
    });
  }

  // ───────────────────────────── 연결 undo / redo ─────────────────────────────

  /** 연결 기록별 이동 정보 (기록이 사라지면 함께 사라진다) */
  private readonly links = new WeakMap<
    TransferLink,
    { fromId: string; toId: string; before: DriftItem; after: DriftItem }
  >();

  /** 연결 기록이 양쪽 스택 맨 위에 있고 두 에디터가 모두 등록·사용 가능할 때만 실행할 수 있다 */
  private canRunLink(link: TransferLink, kind: 'undo' | 'redo'): boolean {
    if (!link.alive || this.destroyed || this.busy) return false;
    const { a, b } = link;
    if (!this.byEditor.has(a) || !this.byEditor.has(b) || a.isDestroyed() || b.isDestroyed()) return false;
    return a.txPeekLink(kind) === link && b.txPeekLink(kind) === link;
  }

  private runLink(link: TransferLink, kind: 'undo' | 'redo', opts?: DriftApplyOptions): boolean {
    if (!this.canRunLink(link, kind)) return false;
    const info = this.links.get(link);
    if (!info) return false;
    const source: 'api' | 'user' = opts?.source === 'user' ? 'user' : 'api';
    const changeSource = opts?.source ?? 'api';
    const { a, b } = link;
    this.busy = true;
    const errors = new ErrorCollector();
    try {
      const ta = a.txBegin();
      const tb = b.txBegin();
      this.applyBoth(a, b, ta, tb, () => {
        const sa = a.txHistoryStep(kind);
        const sb = b.txHistoryStep(kind);
        if (!sa || !sb) throw new Error('[drift] 연결 이력이 일치하지 않습니다.');
        a.txApply(sa);
        b.txApply(sb);
      });
      errors.run(() => a.txNotify(kind, changeSource, ta, link.id));
      errors.run(() => b.txNotify(kind, changeSource, tb, link.id));
      // undo 는 원본으로 되돌아간 항목을, redo 는 대상의 항목을 활성·선택한다
      errors.run(() =>
        kind === 'undo'
          ? this.focusMoved(info.fromId, a, info.before.id)
          : this.focusMoved(info.toId, b, info.after.id),
      );
      errors.run(() =>
        this.emitTransfer(a, b, source, {
          transactionId: link.id,
          action: kind,
          from: info.fromId,
          to: info.toId,
          beforeItem: info.before,
          afterItem: info.after,
          source,
        }),
      );
    } finally {
      this.busy = false;
    }
    errors.throw();
    return true;
  }

  // ───────────────────────────── 저장 / 복원 ─────────────────────────────

  /** 등록 순서대로 모든 컨테이너의 레이아웃 복사본을 묶어 돌려준다 */
  getLayouts(): DriftContainerData {
    return {
      version: CONTAINER_DATA_VERSION,
      containers: Array.from(this.entries.values(), (e) =>
        e.height
          ? { id: e.id, layout: e.editor.getLayout(), height: e.height }
          : { id: e.id, layout: e.editor.getLayout() },
      ),
    };
  }

  /** 모든 컨테이너의 레이아웃을 JSON 문자열로 내보낸다 */
  toJSON(space?: number): string {
    return serializeContainerData(this.getLayouts(), space);
  }

  /**
   * 저장 데이터(JSON 문자열 또는 객체)의 레이아웃을 이미 등록된 컨테이너에 복원한다. 복원한 컨테이너 id 목록을 반환한다.
   *
   * - 데이터에 있는 컨테이너만 바뀐다. 데이터에 없는 등록 컨테이너는 그대로다 (부분 갱신).
   *   각 컨테이너는 에디터의 `load()` 와 같이 통째로 교체되고 이력/저장 기준이 초기화된다.
   * - 전체를 먼저 검증한 뒤 적용한다: 구조 오류, 중복 id, 지원하지 않는 version, 미등록 컨테이너(`unknown:'error'`)면 아무것도 바꾸지 않는다.
   * - 적용 도중 예외(콘텐츠 훅 등)가 나면 이미 적용한 컨테이너를 이전 레이아웃으로 되돌린 뒤 예외를 다시 던진다.
   *   이때 되돌린 컨테이너의 undo 이력은 비워진다.
   */
  fromJSON(input: string | DriftContainerData, options: DriftManagerLoadOptions = {}): string[] {
    if (this.destroyed) return [];
    const data = parseContainerData(input);
    const { unknown = 'error', ...apply } = options;
    const missing = data.containers.filter((c) => !this.entries.has(c.id)).map((c) => c.id);
    if (missing.length && unknown !== 'ignore') {
      throw new Error(`[drift] 등록되지 않은 컨테이너입니다: ${missing.join(', ')}`);
    }
    const targets = data.containers
      .filter((c) => this.entries.has(c.id))
      .map((c) => ({ entry: this.entries.get(c.id) as Entry, layout: c.layout }));
    // 실패 시 되돌릴 이전 상태
    const previous = targets.map((t) => t.entry.editor.getLayout());

    const applied: number[] = [];
    try {
      targets.forEach((t, i) => {
        applied.push(i);
        t.entry.editor.load(cloneLayout(t.layout), apply);
      });
    } catch (e) {
      for (const i of applied) {
        try {
          targets[i].entry.editor.load(previous[i], { ...apply, emit: false });
        } catch (ignored) {
          /* 원래 예외를 우선한다 */
        }
      }
      throw e;
    }
    return targets.map((t) => t.entry.id);
  }

  // ───────────────────────────── 이벤트 ─────────────────────────────

  on<K extends keyof DriftManagerEvents>(name: K, handler: DriftManagerEvents[K]): () => void {
    this.emitter.on(name, handler);
    this.syncForward();
    return () => this.off(name, handler);
  }

  once<K extends keyof DriftManagerEvents>(name: K, handler: DriftManagerEvents[K]): () => void {
    const wrapped = ((...args: Parameters<DriftManagerEvents[K]>) => {
      this.off(name, wrapped);
      (handler as (...a: Parameters<DriftManagerEvents[K]>) => void)(...args);
    }) as DriftManagerEvents[K];
    return this.on(name, wrapped);
  }

  off<K extends keyof DriftManagerEvents>(name: K, handler?: DriftManagerEvents[K]): void {
    this.emitter.off(name, handler);
    this.syncForward();
  }

  /** Manager 에 layoutChange 리스너가 있을 때만 에디터의 layoutChange 를 구독한다 (없으면 변경 정보 계산을 건너뛴다) */
  private syncForward(): void {
    const want = !this.destroyed && this.emitter.has('layoutChange');
    if (want === this.forwarding) return;
    this.forwarding = want;
    this.entries.forEach((entry) => {
      if (want) this.forward(entry);
      else {
        entry.offLayout?.();
        entry.offLayout = undefined;
      }
    });
  }

  private forward(entry: Entry): void {
    if (entry.offLayout) return;
    entry.offLayout = entry.editor.on('layoutChange', (layout, info) => {
      // 콜백 도중 등록이 해제된 컨테이너의 늦은 이벤트는 전달하지 않는다
      if (this.entries.get(entry.id) !== entry) return;
      this.emitter.emit('layoutChange', { containerId: entry.id, editor: entry.editor, layout, info });
    });
  }

  // ───────────────────────────── 해제 ─────────────────────────────

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * 공통 팔레트, 진행 중인 끌기, 모든 컨테이너(에디터 destroy)를 해제한다. 두 번 호출해도 안전하다.
   * 해제 과정의 containerUnregistered/activeChange 이벤트는 발생하며, 끝나면 모든 리스너가 제거된다.
   * 에디터 해제 중 예외(콘텐츠 훅)가 나도 나머지를 모두 해제한 뒤 첫 예외를 다시 던진다.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // 진행 중인 끌기 취소가 dragInEnd 리스너 예외를 내도 컨테이너 해제는 계속한다
    const errors = new ErrorCollector();
    errors.run(() => this.dragIn.dispose());
    errors.run(() => this.transfer.dispose());
    for (const entry of Array.from(this.entries.values())) errors.run(() => this.remove(entry, true));
    this.emitter.clear();
    this.forwarding = false;
    errors.throw();
  }
}

/**
 * 컨테이너 간 이동의 연결 이력 기록. 원본(a)과 대상(b) 두 에디터의 이력에 같은 객체가 들어간다.
 * 어느 한쪽에서 버려지면(drop) 양쪽 스택을 그 지점까지 절단해, 이동을 가로질러 오래된 스냅샷이 복원되지 않게 한다.
 */
class TransferLink implements HistoryLink {
  private live = true;

  constructor(
    readonly id: string,
    readonly a: DriftEditor,
    readonly b: DriftEditor,
    private readonly ops: {
      canRun: (link: TransferLink, kind: 'undo' | 'redo') => boolean;
      run: (link: TransferLink, kind: 'undo' | 'redo', opts?: DriftApplyOptions) => boolean;
    },
  ) {}

  get alive(): boolean {
    return this.live;
  }

  drop(): void {
    if (!this.live) return;
    this.live = false;
    this.a.txCut(this);
    this.b.txCut(this);
  }

  canRun(kind: 'undo' | 'redo'): boolean {
    return this.ops.canRun(this, kind);
  }

  run(kind: 'undo' | 'redo', opts?: DriftApplyOptions): boolean {
    return this.ops.run(this, kind, opts);
  }
}

/** 여러 정리 단계를 모두 실행하면서 첫 예외만 보관했다가 마지막에 다시 던진다 */
class ErrorCollector {
  private first: { error: unknown } | undefined;

  run(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      if (!this.first) this.first = { error };
    }
  }

  throw(): void {
    if (this.first) throw this.first.error;
  }
}

/** DriftManager 를 만든다 */
export function createDriftManager(options: DriftManagerOptions = {}): DriftManager {
  return new DriftManager(options);
}
