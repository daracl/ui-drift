import { DriftItem } from '@t/DriftLayout';
import { compareYX } from './geometry';

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

/**
 * 열별 배치 색인. 항목이 걸친 모든 열의 목록에 등록해 두면, 어떤 영역과의 충돌 탐색은
 * 그 영역이 걸친 열의 항목만 보면 된다 (전체 배치 항목을 훑지 않는다).
 */
/** @internal core 내부(압축/빈 자리 탐색)에서만 쓴다 */
export class ColumnIndex {
  private readonly cols: DriftItem[][] = [];

  add(item: DriftItem): void {
    for (let c = item.x; c < item.x + item.w; c++) (this.cols[c] ||= []).push(item);
  }

  /** (x, w) 열 범위에서 [y, y+h) 행 구간과 겹치는 항목을 하나 반환한다 */
  hit(x: number, w: number, y: number, h: number): DriftItem | undefined {
    for (let c = x; c < x + w; c++) {
      const list = this.cols[c];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.y < y + h && p.y + p.h > y) return p;
      }
    }
    return undefined;
  }

  /**
   * (x, w) 열 범위에서 y 위쪽에 놓인 항목들의 가장 큰 하단(y + h). 없으면 0.
   * y 에서 위로 올릴 때 처음 막히는 행이며, 한 행씩 올려 보며 충돌을 확인한 결과와 같다
   * (y 자리가 비어 있으므로 y 아래쪽 항목은 막지 않는다).
   */
  ceiling(x: number, w: number, y: number): number {
    let top = 0;
    for (let c = x; c < x + w; c++) {
      const list = this.cols[c];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const bottom = list[i].y + list[i].h;
        if (bottom <= y && bottom > top) top = bottom;
      }
    }
    return top;
  }
}

/** 겹치지 않는 가장 가까운 아래쪽 y 를 반환한다 */
function pushDown(index: ColumnIndex, item: DriftItem): number {
  let y = item.y;
  let hit = index.hit(item.x, item.w, y, item.h);
  // 충돌한 항목의 하단으로 점프해도 그 사이 위치는 모두 그 항목과 겹치므로 빈 자리를 건너뛰지 않는다
  while (hit) {
    y = hit.y + hit.h;
    hit = index.hit(item.x, item.w, y, item.h);
  }
  return y;
}

function place(items: readonly DriftItem[], anchorId: string | undefined, float: boolean): DriftItem[] {
  const index = new ColumnIndex();
  const result = new Map<string, DriftItem>();
  for (const item of items) {
    if (item.locked) {
      index.add(item);
      result.set(item.id, item);
    }
  }

  const anchor = anchorId ? items.find((item) => item.id === anchorId && !item.locked) : undefined;
  if (anchor) {
    const placedAnchor = { ...anchor, y: pushDown(index, anchor) };
    index.add(placedAnchor);
    result.set(anchor.id, placedAnchor);
  }

  const movable = items.filter((item) => !item.locked && item !== anchor).sort(compareYX);
  for (const item of movable) {
    let y = pushDown(index, item);
    if (!float && y > 0) y = index.ceiling(item.x, item.w, y);

    const next = y === item.y ? item : { ...item, y };
    index.add(next);
    result.set(item.id, next);
  }

  return items.map((item) => result.get(item.id) as DriftItem);
}
