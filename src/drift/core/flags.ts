import { DriftItem } from '@t/DriftLayout';

/**
 * 항목의 잠금/크기조절 플래그 해석.
 *
 * - `locked`: **위치 고정**. 이동할 수 없고, 고정 장애물이 되어 다른 항목이 비켜간다.
 * - `resizable`: **크기 조절 가능 여부**. 이동과 독립적으로 제어한다.
 *     - 명시하지 않으면(undefined) `locked` 를 따른다: locked 이면 크기도 고정(기존 동작), 아니면 조절 가능.
 *       locked 항목의 이 기본값은 `lockedResizable` 인자(에디터 옵션 `lockedResizable`)로 바꿀 수 있다(기본 false).
 *       locked 항목의 이 기본값은 `lockedResizable` 인자(에디터 옵션 `lockedResizable`)로 바꿀 수 있다(기본 false).
 *     - `true`/`false` 를 명시하면 `locked` 와 무관하게 그 값을 쓴다.
 *
 * 조합: (locked, resizable) = (true, 생략/false) 위치·크기 모두 고정 / (true, true) 위치는 고정, 크기만 조절 /
 *       (false, false) 크기만 고정, 이동 가능 / (false, 생략/true) 둘 다 가능.
 */
export function isMovable(item: Pick<DriftItem, 'locked'>): boolean {
  return !item.locked;
}

export function isResizable(item: Pick<DriftItem, 'locked' | 'resizable'>, lockedResizable = false): boolean {
  if (item.resizable !== undefined) return !!item.resizable;
  return item.locked ? lockedResizable : true;
}
