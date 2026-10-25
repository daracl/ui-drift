import {
  addItem,
  collides,
  compact,
  createMetrics,
  DriftItem,
  findCollisions,
  moveItem,
  removeItem,
  resizeItem,
  toGridPosition,
  toGridSize,
  toPixelRect,
  updateItem,
} from '@/core';

const item = (id: string, x: number, y: number, w: number, h: number, extra: Partial<DriftItem> = {}): DriftItem => ({
  id,
  x,
  y,
  w,
  h,
  ...extra,
});

const byId = (items: DriftItem[], id: string) => items.find((i) => i.id === id) as DriftItem;

function expectNoOverlap(items: DriftItem[]) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      expect(collides(items[i], items[j])).toBe(false);
    }
  }
}

describe('collision', () => {
  it('맞닿기만 한 영역은 겹치지 않는다', () => {
    expect(collides(item('a', 0, 0, 2, 2), item('b', 2, 0, 2, 2))).toBe(false);
    expect(collides(item('a', 0, 0, 2, 2), item('b', 0, 2, 2, 2))).toBe(false);
  });

  it('겹치는 영역을 찾는다', () => {
    const items = [item('a', 0, 0, 2, 2), item('b', 4, 0, 2, 2)];
    expect(findCollisions(items, { x: 1, y: 1, w: 2, h: 2 }).map((i) => i.id)).toEqual(['a']);
    expect(findCollisions(items, { x: 0, y: 0, w: 2, h: 2 }, 'a')).toEqual([]);
  });
});

describe('compact', () => {
  it('빈 공간을 위로 압축한다', () => {
    const result = compact([item('a', 0, 5, 4, 2), item('b', 0, 9, 4, 2)]);
    expect(byId(result, 'a').y).toBe(0);
    expect(byId(result, 'b').y).toBe(2);
  });

  it('입력 배열 순서와 원본을 유지한다', () => {
    const input = [item('b', 0, 3, 2, 2), item('a', 0, 0, 2, 2)];
    const result = compact(input);
    expect(result.map((i) => i.id)).toEqual(['b', 'a']);
    expect(input[0].y).toBe(3);
  });

  it('동일 입력에 항상 같은 결과를 낸다', () => {
    const input = [item('a', 0, 0, 4, 2), item('b', 2, 1, 4, 2), item('c', 1, 0, 3, 3)];
    expect(compact(input, 'b')).toEqual(compact(input, 'b'));
  });

  it('locked 항목은 움직이지 않고 다른 항목이 비켜간다', () => {
    const result = compact([item('lock', 0, 2, 4, 2, { locked: true }), item('a', 0, 2, 4, 2)]);
    expect(byId(result, 'lock').y).toBe(2);
    expect(byId(result, 'a').y).toBe(4);
  });
});

describe('addItem / removeItem', () => {
  it('위치를 지정하지 않으면 빈 자리에 배치한다', () => {
    let items: DriftItem[] = [];
    items = addItem(items, 12, { id: 'a', w: 6, h: 2 });
    items = addItem(items, 12, { id: 'b', w: 6, h: 2 });
    items = addItem(items, 12, { id: 'c', w: 6, h: 2 });
    expect(byId(items, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(byId(items, 'b')).toMatchObject({ x: 6, y: 0 });
    expect(byId(items, 'c')).toMatchObject({ x: 0, y: 2 });
  });

  it('위치를 지정하면 겹친 항목이 아래로 밀린다', () => {
    let items = addItem([], 12, { id: 'a', x: 0, y: 0, w: 4, h: 2 });
    items = addItem(items, 12, { id: 'b', x: 0, y: 0, w: 4, h: 2 });
    expect(byId(items, 'b').y).toBe(0);
    expect(byId(items, 'a').y).toBe(2);
    expectNoOverlap(items);
  });

  it('중복/빈 id 는 예외', () => {
    const items = addItem([], 12, { id: 'a', w: 2, h: 2 });
    expect(() => addItem(items, 12, { id: 'a', w: 2, h: 2 })).toThrow();
    expect(() => addItem(items, 12, { id: '', w: 2, h: 2 })).toThrow();
  });

  it('삭제 후 아래 항목이 올라오고 정합성이 유지된다', () => {
    let items = addItem([], 12, { id: 'a', x: 0, y: 0, w: 12, h: 2 });
    items = addItem(items, 12, { id: 'b', x: 0, y: 2, w: 12, h: 2 });
    items = removeItem(items, 'a');
    expect(items).toHaveLength(1);
    expect(items[0].y).toBe(0);
    expect(removeItem(items, 'none')).toHaveLength(1);
  });
});

describe('moveItem / resizeItem', () => {
  const base = () => [item('a', 0, 0, 4, 2), item('b', 4, 0, 4, 2), item('c', 0, 2, 4, 2)];

  it('이동 시 겹친 항목을 밀어내고 겹침이 없다', () => {
    const moved = moveItem(base(), 12, 'a', 4, 0);
    expect(byId(moved, 'a')).toMatchObject({ x: 4, y: 0 });
    expect(byId(moved, 'b').y).toBeGreaterThanOrEqual(2);
    expectNoOverlap(moved);
  });

  it('컬럼 범위를 벗어나는 이동은 보정된다', () => {
    const moved = moveItem(base(), 12, 'a', 99, 0);
    expect(byId(moved, 'a').x).toBe(8);
    expect(moveItem(base(), 12, 'a', -5, -5)[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('존재하지 않는 id 는 변경 없음', () => {
    expect(moveItem(base(), 12, 'zzz', 1, 1)).toEqual(base());
  });

  it('locked 항목은 이동/리사이즈할 수 없고 locked 와 겹치는 이동은 거부된다', () => {
    const items = [item('lock', 4, 0, 4, 2, { locked: true }), item('a', 0, 0, 4, 2)];
    expect(moveItem(items, 12, 'lock', 0, 4)).toEqual(items);
    expect(resizeItem(items, 12, 'lock', 6, 6)).toEqual(items);
    expect(moveItem(items, 12, 'a', 4, 0)).toEqual(items);
  });

  it('리사이즈는 min/max/컬럼 범위를 지킨다', () => {
    const items = [item('a', 8, 0, 2, 2, { minW: 2, minH: 2, maxW: 4, maxH: 3 })];
    expect(resizeItem(items, 12, 'a', 1, 1)[0]).toMatchObject({ w: 2, h: 2 });
    expect(resizeItem(items, 12, 'a', 10, 10)[0]).toMatchObject({ w: 4, h: 3, x: 8 });
    const wide = [item('a', 10, 0, 2, 2)];
    expect(resizeItem(wide, 12, 'a', 6, 2)[0]).toMatchObject({ x: 6, w: 6 });
  });

  it('리사이즈로 아래 항목이 밀린다', () => {
    const resized = resizeItem(base(), 12, 'a', 4, 4);
    expect(byId(resized, 'c').y).toBe(4);
    expectNoOverlap(resized);
  });

  it('많은 항목에서도 겹침 없이 안정적으로 동작한다', () => {
    let items: DriftItem[] = [];
    for (let i = 0; i < 200; i++) items = addItem(items, 12, { id: `n${i}`, w: (i % 4) + 1, h: (i % 3) + 1 });
    items = moveItem(items, 12, 'n100', 0, 0);
    expect(items).toHaveLength(200);
    expectNoOverlap(items);
  });

  it('updateItem 은 content/props 와 위치를 갱신한다', () => {
    const updated = updateItem(base(), 12, 'a', { content: 'hi', props: { k: 1 }, w: 6 });
    expect(byId(updated, 'a')).toMatchObject({ content: 'hi', props: { k: 1 }, w: 6 });
    expectNoOverlap(updated);
  });
});

describe('pixel conversion', () => {
  const m = createMetrics(1200 + 8 * 11 - 8 * 11, 12, 40, 8); // 1200px
  it('그리드 ↔ 픽셀 변환이 왕복 가능하다', () => {
    const rect = toPixelRect({ x: 3, y: 2, w: 4, h: 3 }, m);
    expect(toGridPosition(rect.left, rect.top, m)).toEqual({ x: 3, y: 2 });
    expect(toGridSize(rect.width, rect.height, m)).toEqual({ w: 4, h: 3 });
  });

  it('셀 너비 계산 (gap 포함)', () => {
    const metrics = createMetrics(1192, 12, 40, 8);
    expect(metrics.cellWidth).toBeCloseTo((1192 - 88) / 12);
    expect(toPixelRect({ x: 0, y: 0, w: 12, h: 1 }, metrics).width).toBeCloseTo(1192);
  });

  it('음수 위치는 0 으로, 최소 크기는 1 로 보정된다', () => {
    expect(toGridPosition(-100, -100, m).y).toBe(0);
    expect(toGridSize(0, 0, m)).toEqual({ w: 1, h: 1 });
  });
});
