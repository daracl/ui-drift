import { DriftItem } from '@t/DriftLayout';
import { compareYX, firstCollision } from './geometry';

/**
 * 세로 중력으로 압축한다.
 * - locked 항목은 고정 장애물로 먼저 배치된다.
 * - 나머지는 (y, x) 순으로 겹치면 아래로 밀고, 비어 있으면 위로 올린다.
 * - anchorId 가 있으면 그 항목은 현재 y 를 유지한 채 가장 먼저 배치되어 겹치는 항목이 아래로 밀려난다.
 *   이후 anchor 도 포함해 한 번 더 압축한다.
 * - float 가 true 이면 위로 올리지 않는다(놓은 위치 유지). 겹칠 때만 아래로 민다.
 * 입력 배열 순서는 유지하며 새 배열을 반환한다.
 */
export function compact(items: readonly DriftItem[], anchorId?: string, float = false): DriftItem[] {
  const first = place(items, anchorId, float);
  // float 모드는 위로 올리지 않으므로 한 번의 배치로 충분하다
  return anchorId && !float ? place(first, undefined, float) : first;
}

function place(items: readonly DriftItem[], anchorId: string | undefined, float: boolean): DriftItem[] {
  const placed: DriftItem[] = items.filter((item) => item.locked);
  const result = new Map<string, DriftItem>();
  placed.forEach((item) => result.set(item.id, item));

  const anchor = anchorId ? items.find((item) => item.id === anchorId && !item.locked) : undefined;
  if (anchor) {
    const placedAnchor = { ...anchor, y: pushDown(placed, anchor) };
    placed.push(placedAnchor);
    result.set(anchor.id, placedAnchor);
  }

  const movable = items.filter((item) => !item.locked && item !== anchor).sort(compareYX);
  for (const item of movable) {
    let y = pushDown(placed, item);
    while (!float && y > 0 && !firstCollision(placed, { ...item, y: y - 1 })) y--;

    const next = y === item.y ? item : { ...item, y };
    placed.push(next);
    result.set(item.id, next);
  }

  return items.map((item) => result.get(item.id) as DriftItem);
}

/** 겹치지 않는 가장 가까운 아래쪽 y 를 반환한다 */
function pushDown(placed: readonly DriftItem[], item: DriftItem): number {
  let y = item.y;
  let hit = firstCollision(placed, { ...item, y });
  while (hit) {
    y = hit.y + hit.h;
    hit = firstCollision(placed, { ...item, y });
  }
  return y;
}
