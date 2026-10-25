import { compact, DriftItem } from '@/core';

/**
 * 최적화 전 구현(배치된 전체 항목을 선형 탐색하고 한 행씩 올리는 방식)을 그대로 보존한 참조 구현.
 * 열별 색인으로 바꾼 compact 가 모든 입력에서 같은 결과를 내는지 무작위 입력으로 비교한다.
 */
function collides(a: DriftItem, b: DriftItem): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
const firstCollision = (items: readonly DriftItem[], geo: DriftItem) => items.find((i) => collides(i, geo));
const compareYX = (a: DriftItem, b: DriftItem) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function pushDownRef(placed: readonly DriftItem[], item: DriftItem): number {
  let y = item.y;
  let hit = firstCollision(placed, { ...item, y });
  while (hit) {
    y = hit.y + hit.h;
    hit = firstCollision(placed, { ...item, y });
  }
  return y;
}

function placeRef(items: readonly DriftItem[], anchorId: string | undefined, float: boolean): DriftItem[] {
  const placed: DriftItem[] = items.filter((item) => item.locked);
  const result = new Map<string, DriftItem>();
  placed.forEach((item) => result.set(item.id, item));
  const anchor = anchorId ? items.find((item) => item.id === anchorId && !item.locked) : undefined;
  if (anchor) {
    const placedAnchor = { ...anchor, y: pushDownRef(placed, anchor) };
    placed.push(placedAnchor);
    result.set(anchor.id, placedAnchor);
  }
  const movable = items.filter((item) => !item.locked && item !== anchor).sort(compareYX);
  for (const item of movable) {
    let y = pushDownRef(placed, item);
    while (!float && y > 0 && !firstCollision(placed, { ...item, y: y - 1 })) y--;
    const next = y === item.y ? item : { ...item, y };
    placed.push(next);
    result.set(item.id, next);
  }
  return items.map((item) => result.get(item.id) as DriftItem);
}

function compactRef(items: readonly DriftItem[], anchorId?: string, float = false): DriftItem[] {
  const first = placeRef(items, anchorId, float);
  return anchorId && !float ? placeRef(first, undefined, float) : first;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

function randomItems(r: () => number, n: number, columns: number, maxY: number, lockedRatio: number): DriftItem[] {
  return Array.from({ length: n }, (_, i) => {
    const w = 1 + Math.floor(r() * 5);
    const item: DriftItem = {
      id: `i${i}`,
      x: Math.floor(r() * (columns - w + 1)),
      y: Math.floor(r() * maxY),
      w,
      h: 1 + Math.floor(r() * 4),
    };
    if (r() < lockedRatio) item.locked = true;
    return item;
  });
}

describe('compact: 열별 색인 구현이 기존(선형 탐색) 구현과 같은 결과를 낸다', () => {
  it('무작위 입력 3000건 (겹침 입력 포함, locked/anchor/float 조합)', () => {
    const r = rng(20260101);
    let cases = 0;
    for (let k = 0; k < 3000; k++) {
      const columns = 4 + Math.floor(r() * 9); // 4..12
      const n = Math.floor(r() * 40);
      const maxY = [3, 10, 60][Math.floor(r() * 3)];
      const items = randomItems(r, n, columns, maxY, [0, 0.1, 0.3][Math.floor(r() * 3)]);
      const anchorId = n > 0 && r() < 0.5 ? items[Math.floor(r() * n)].id : undefined;
      const float = r() < 0.3;
      const expected = compactRef(items, anchorId, float);
      const actual = compact(items, anchorId, float);
      expect({ k, actual }).toEqual({ k, actual: expected });
      cases++;
    }
    expect(cases).toBe(3000);
  });

  it('큰 y 와 큰 항목 수에서도 같다', () => {
    const r = rng(7);
    for (let k = 0; k < 20; k++) {
      const items = randomItems(r, 150, 12, 800, 0.05);
      const anchorId = items[Math.floor(r() * items.length)].id;
      expect(compact(items, anchorId, false)).toEqual(compactRef(items, anchorId, false));
      expect(compact(items, undefined, true)).toEqual(compactRef(items, undefined, true));
    }
  });

  it('입력을 변경하지 않고 같은 입력에는 같은 결과를 낸다', () => {
    const items = randomItems(rng(3), 50, 12, 30, 0.1);
    const snapshot = JSON.stringify(items);
    const a = compact(items, items[5].id);
    const b = compact(items, items[5].id);
    expect(a).toEqual(b);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

/** 최적화 전 findFreePosition(모든 후보를 선형 탐색)과 비교한다 */
function findFreePositionRef(items: readonly DriftItem[], columns: number, w: number, h: number) {
  const width = Math.min(w, columns);
  const maxY = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + width <= columns; x++) {
      if (!firstCollision(items, { id: '', x, y, w: width, h })) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

describe('findFreePosition: 색인/건너뛰기 구현이 기존 구현과 같은 결과를 낸다', () => {
  it('무작위 입력 2000건 (겹침 입력 포함)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { findFreePosition } = require('@/core');
    const r = rng(99);
    for (let k = 0; k < 2000; k++) {
      const columns = 4 + Math.floor(r() * 9);
      const items = randomItems(r, Math.floor(r() * 40), columns, [3, 10, 40][Math.floor(r() * 3)], 0);
      const w = 1 + Math.floor(r() * 6);
      const h = 1 + Math.floor(r() * 4);
      expect({ k, pos: findFreePosition(items, columns, w, h) }).toEqual({
        k,
        pos: findFreePositionRef(items, columns, w, h),
      });
    }
  });
});
