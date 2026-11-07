import { DriftItem } from './DriftLayout';

/** `createDriftManager(options)` 옵션 */
export interface DriftManagerOptions {
  /**
   * 등록된 컨테이너 사이에서 기존 항목을 마우스/터치로 끌어 옮길 수 있게 한다 (기본 false).
   * API 이동(`transferItem`)은 이 옵션과 무관하게 가능하다. `setCrossContainerDrag()` 로 런타임 변경.
   */
  crossContainerDrag?: boolean;
}

/** `transferItem()` 요청 */
export interface DriftTransferRequest {
  /** 원본 컨테이너 id */
  from: string;
  /** 대상 컨테이너 id */
  to: string;
  /** 원본의 항목 id */
  itemId: string;
  /** 대상의 현재 편집 breakpoint(없으면 기본) 셀 좌표. x/y 를 둘 다 생략하면 자동 배치, 하나만 주면 예외 */
  x?: number;
  y?: number;
  /** 대상에서 쓸 새 id (API 전용). 빈 문자열은 예외, 대상과 충돌하면 'id-conflict' */
  newId?: string;
}

export interface DriftTransferOptions {
  /** 변경 출처 (기본 'api'). 각 에디터 layoutChange 의 info.source 와 itemTransfer.source 로 전달된다 */
  source?: 'api' | 'user';
}

/**
 * 이동 거절 사유
 * - disabled: 진행 중 포인터 이동이 옵션 해제로 취소됨
 * - destroyed: Manager 가 destroy 됨
 * - missing-container: 등록되지 않은 컨테이너
 * - same-container: 원본과 대상이 같음 (같은 컨테이너 안에서는 editor.moveItem 을 쓴다)
 * - missing-item: 원본에 항목이 없음
 * - disconnected: 원본/대상 캔버스가 문서에 연결되어 있지 않음
 * - locked: 위치 고정 항목 (isMovable 이 false)
 * - id-conflict: 대상에 같은 id 가 있음
 * - invalid-size: 대상 열 수보다 큰 minW, 만족할 수 없는 min/max
 * - blocked: 지정 위치가 대상의 locked 항목과 겹치는 등 유효한 목적지를 만들 수 없음
 * - busy: 다른 이동(또는 연결 undo/redo)을 처리하는 중의 재진입
 * - stale: 준비 후 원본/대상의 모델, 등록, breakpoint 가 바뀜
 */
export type DriftTransferRejectReason =
  | 'disabled'
  | 'destroyed'
  | 'missing-container'
  | 'same-container'
  | 'missing-item'
  | 'disconnected'
  | 'locked'
  | 'id-conflict'
  | 'invalid-size'
  | 'blocked'
  | 'busy'
  | 'stale';

export type DriftTransferResult =
  | { moved: true; transactionId: string; from: string; to: string; item: DriftItem }
  | { moved: false; reason: DriftTransferRejectReason };

/** Manager `itemTransfer` 이벤트 데이터 (항목은 모두 복사본) */
export interface DriftItemTransferEvent {
  transactionId: string;
  /** transfer: 이동, undo: 연결 undo 로 원본에 되돌림, redo: 연결 redo 로 다시 이동 */
  action: 'transfer' | 'undo' | 'redo';
  /** 항상 원래 이동 방향의 원본/대상 컨테이너 id 이다 (undo 에서도 바뀌지 않는다) */
  from: string;
  to: string;
  /** 원본에 있던 항목 (이동 전) */
  beforeItem: DriftItem;
  /** 대상에서의 항목 (이동 후) */
  afterItem: DriftItem;
  source: 'api' | 'user';
}

/** Manager `transferReject` 이벤트 데이터: 포인터로 놓은 이동이 거절되었거나 진행 중 세션이 취소됨 */
export interface DriftTransferRejectEvent {
  reason: DriftTransferRejectReason;
  from: string;
  /** 놓은(또는 마지막으로 가리킨) 컨테이너. 없으면 null */
  to: string | null;
  itemId: string;
}
