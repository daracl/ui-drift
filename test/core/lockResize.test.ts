import { collides, DriftItem, isMovable, isResizable, moveItem, resizeItem, resizeItemFromLeft } from '@/core';

const item = (id: string, x: number, y: number, w: number, h: number, extra: Partial<DriftItem> = {}): DriftItem => ({
  id,
  x,
  y,
  w,
  h,
  ...extra,
});
const byId = (items: DriftItem[], id: string) => items.find((i) => i.id === id) as DriftItem;
const noOverlap = (items: DriftItem[]) => {
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) expect(collides(items[i], items[j])).toBe(false);
};

describe('위치 고정(locked)과 크기 조절(resizable)의 독립 제어', () => {
  describe('판정: isMovable / isResizable', () => {
    it.each([
      // [locked, resizable, 이동 가능, 크기 조절 가능]
      [undefined, undefined, true, true],
      [true, undefined, false, false], // 기존 동작: locked 만 지정하면 크기도 고정
      [true, true, false, true], // 위치만 고정, 크기만 조절
      [true, false, false, false],
      [false, false, true, false], // 크기만 고정, 이동 가능
      [undefined, false, true, false],
      [undefined, true, true, true],
    ])('locked=%s, resizable=%s → movable=%s, resizable=%s', (locked, resizable, movable, canResize) => {
      const it = { locked, resizable };
      expect(isMovable(it)).toBe(movable);
      expect(isResizable(it)).toBe(canResize);
    });

    it('lockedResizable 기본값은 resizable 을 명시하지 않은 locked 항목에만 적용되고 명시값이 항상 우선한다', () => {
      expect(isResizable({ locked: true }, true)).toBe(true);
      expect(isResizable({ locked: true }, false)).toBe(false);
      expect(isResizable({ locked: true, resizable: false }, true)).toBe(false); // 명시값 우선
      expect(isResizable({ locked: true, resizable: true }, false)).toBe(true);
      expect(isResizable({}, false)).toBe(true); // locked 가 아니면 영향 없음
      expect(isResizable({ resizable: false }, true)).toBe(false);
    });
  });

  describe('resizeItem', () => {
    const layout = () => [
      item('fix', 0, 0, 4, 2, { locked: true, resizable: true }),
      item('below', 0, 2, 4, 2),
      item('right', 4, 0, 4, 2),
    ];

    it('locked + resizable:true 는 위치(x, y)를 유지한 채 크기만 바뀌고 다른 항목이 비켜간다', () => {
      const result = resizeItem(layout(), 12, 'fix', 6, 4);
      expect(byId(result, 'fix')).toMatchObject({ x: 0, y: 0, w: 6, h: 4 });
      expect(byId(result, 'below').y).toBeGreaterThanOrEqual(4); // 아래 항목이 밀린다
      expect(byId(result, 'right').y).toBeGreaterThanOrEqual(0);
      noOverlap(result);
    });

    it('locked 만 지정하면 기존처럼 크기도 거부한다 (호환)', () => {
      const items = [item('fix', 0, 0, 4, 2, { locked: true })];
      expect(resizeItem(items, 12, 'fix', 6, 4)).toEqual(items);
    });

    it('locked + resizable:false 는 거부한다', () => {
      const items = [item('fix', 0, 0, 4, 2, { locked: true, resizable: false })];
      expect(resizeItem(items, 12, 'fix', 6, 4)).toEqual(items);
    });

    it('resizable:false 만 지정(위치는 고정 아님)해도 거부하지만 이동은 된다', () => {
      const items = [item('a', 0, 0, 4, 2, { resizable: false })];
      expect(resizeItem(items, 12, 'a', 6, 4)).toEqual(items);
      expect(byId(moveItem(items, 12, 'a', 4, 0), 'a')).toMatchObject({ x: 4 });
    });

    it('locked 항목은 resizable:true 여도 이동할 수 없다', () => {
      const items = layout();
      expect(moveItem(items, 12, 'fix', 8, 6)).toEqual(items);
    });

    it('크기를 키우다 다른 locked 항목과 겹치면 거부한다', () => {
      const items = [
        item('fix', 0, 0, 4, 2, { locked: true, resizable: true }),
        item('wall', 5, 0, 2, 4, { locked: true }),
      ];
      expect(resizeItem(items, 12, 'fix', 6, 2)).toEqual(items); // x=5..6 이 wall 과 겹침
      expect(byId(resizeItem(items, 12, 'fix', 5, 3), 'fix')).toMatchObject({ w: 5, h: 3 }); // 겹치지 않는 범위
    });

    it('min/max 와 컬럼 경계를 지킨다', () => {
      const items = [item('fix', 8, 0, 2, 2, { locked: true, resizable: true, minW: 2, maxW: 3, maxH: 3 })];
      expect(byId(resizeItem(items, 12, 'fix', 9, 9), 'fix')).toMatchObject({ x: 8, y: 0, w: 3, h: 3 });
      expect(byId(resizeItem(items, 12, 'fix', 1, 1), 'fix')).toMatchObject({ w: 2, h: 1 });
    });

    it('크기를 줄여도 고정 장애물의 y 는 유지된다 (위로 압축되지 않는다)', () => {
      const items = [item('fix', 0, 5, 6, 4, { locked: true, resizable: true })];
      expect(byId(resizeItem(items, 12, 'fix', 3, 2), 'fix')).toMatchObject({ x: 0, y: 5, w: 3, h: 2 });
    });

    it('lockedResizable=true 이면 resizable 을 명시하지 않은 locked 항목도 크기를 조절할 수 있다 (명시 false 는 계속 거부)', () => {
      const auto = [item('fix', 0, 0, 4, 2, { locked: true })];
      expect(resizeItem(auto, 12, 'fix', 6, 3)).toEqual(auto); // 기본: 거부
      expect(byId(resizeItem(auto, 12, 'fix', 6, 3, false, true), 'fix')).toMatchObject({ x: 0, y: 0, w: 6, h: 3 });
      const no = [item('fix', 0, 0, 4, 2, { locked: true, resizable: false })];
      expect(resizeItem(no, 12, 'fix', 6, 3, false, true)).toEqual(no);
    });

    it('float 모드에서도 위치를 유지하고 입력을 변경하지 않는다', () => {
      const items = layout();
      const snapshot = JSON.stringify(items);
      const result = resizeItem(items, 12, 'fix', 6, 4, true);
      expect(byId(result, 'fix')).toMatchObject({ x: 0, y: 0, w: 6, h: 4 });
      expect(JSON.stringify(items)).toBe(snapshot);
    });
  });

  describe('resizeItemFromLeft (왼쪽 핸들)', () => {
    it('위치 고정(locked) 항목은 resizable:true 여도 거부한다 — 왼쪽 가장자리가 움직이기 때문', () => {
      const items = [item('fix', 4, 0, 4, 2, { locked: true, resizable: true })];
      expect(resizeItemFromLeft(items, 12, 'fix', 6, 2)).toEqual(items);
    });

    it('locked 가 아니면 resizable 에 따라 동작한다', () => {
      const ok = [item('a', 4, 0, 4, 2, { resizable: true })];
      expect(byId(resizeItemFromLeft(ok, 12, 'a', 6, 2), 'a')).toMatchObject({ x: 2, w: 6 });
      const no = [item('a', 4, 0, 4, 2, { resizable: false })];
      expect(resizeItemFromLeft(no, 12, 'a', 6, 2)).toEqual(no);
    });
  });
});
