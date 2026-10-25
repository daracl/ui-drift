import { collides, DriftItem, resizeItemFromLeft } from '@/core';

const item = (id: string, x: number, y: number, w: number, h: number, extra: Partial<DriftItem> = {}): DriftItem => ({
  id,
  x,
  y,
  w,
  h,
  ...extra,
});
const byId = (items: DriftItem[], id: string) => items.find((i) => i.id === id) as DriftItem;

describe('resizeItemFromLeft (왼쪽에서 크기 조절)', () => {
  it('오른쪽 가장자리를 고정하고 x 와 w 가 함께 바뀐다', () => {
    const items = [item('a', 4, 0, 4, 2)];
    const wider = byId(resizeItemFromLeft(items, 12, 'a', 6, 2), 'a');
    expect(wider).toMatchObject({ x: 2, w: 6, h: 2 });
    expect(wider.x + wider.w).toBe(8);
    const narrower = byId(resizeItemFromLeft(items, 12, 'a', 1, 2), 'a');
    expect(narrower).toMatchObject({ x: 7, w: 1 });
    expect(narrower.x + narrower.w).toBe(8);
  });

  it('높이도 함께 바꾼다', () => {
    expect(byId(resizeItemFromLeft([item('a', 4, 0, 4, 2)], 12, 'a', 4, 5), 'a')).toMatchObject({ x: 4, w: 4, h: 5 });
  });

  it('왼쪽 경계(x ≥ 0)를 넘지 않는다', () => {
    const r = byId(resizeItemFromLeft([item('a', 2, 0, 2, 2)], 12, 'a', 10, 2), 'a');
    expect(r).toMatchObject({ x: 0, w: 4 }); // 오른쪽(4) 고정, 가능한 최대 폭
  });

  it('min/max 폭을 지킨다', () => {
    const items = [item('a', 4, 0, 4, 2, { minW: 3, maxW: 5 })];
    expect(byId(resizeItemFromLeft(items, 12, 'a', 1, 2), 'a')).toMatchObject({ x: 5, w: 3 });
    expect(byId(resizeItemFromLeft(items, 12, 'a', 9, 2), 'a')).toMatchObject({ x: 3, w: 5 });
  });

  it('locked / resizable:false 항목은 거부한다', () => {
    const locked = [item('a', 4, 0, 4, 2, { locked: true })];
    const fixed = [item('a', 4, 0, 4, 2, { resizable: false })];
    expect(resizeItemFromLeft(locked, 12, 'a', 6, 2)).toEqual(locked);
    expect(resizeItemFromLeft(fixed, 12, 'a', 6, 2)).toEqual(fixed);
    expect(resizeItemFromLeft(fixed, 12, 'none', 6, 2)).toEqual(fixed);
  });

  it('locked 항목과 겹치게 되면 거부한다', () => {
    const items = [item('wall', 2, 0, 1, 2, { locked: true }), item('a', 4, 0, 4, 2)];
    expect(resizeItemFromLeft(items, 12, 'a', 6, 2)).toEqual(items); // x=2 가 wall 과 겹침
    expect(byId(resizeItemFromLeft(items, 12, 'a', 5, 2), 'a')).toMatchObject({ x: 3, w: 5 }); // 겹치지 않는 범위
  });

  it('겹친 다른 항목은 아래로 밀리고 겹침이 없다', () => {
    const items = [item('l', 0, 0, 4, 2), item('a', 4, 0, 4, 2)];
    const r = resizeItemFromLeft(items, 12, 'a', 6, 2);
    expect(byId(r, 'a')).toMatchObject({ x: 2, w: 6 });
    expect(byId(r, 'l').y).toBeGreaterThanOrEqual(2);
    expect(collides(byId(r, 'a'), byId(r, 'l'))).toBe(false);
  });

  it('float 모드에서는 위로 끌어올리지 않는다', () => {
    const items = [item('a', 4, 5, 4, 2)];
    expect(byId(resizeItemFromLeft(items, 12, 'a', 6, 2, true), 'a')).toMatchObject({ x: 2, y: 5 });
    expect(byId(resizeItemFromLeft(items, 12, 'a', 6, 2, false), 'a').y).toBe(0);
  });

  it('입력을 변경하지 않는다(불변)', () => {
    const items = [item('a', 4, 0, 4, 2)];
    resizeItemFromLeft(items, 12, 'a', 6, 2);
    expect(items[0]).toEqual(item('a', 4, 0, 4, 2));
  });
});
