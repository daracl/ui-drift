import { createLayout, diffItems, DriftItem, hasOverlap, itemsEqual, layoutsEqual, sanitizeItem } from '@/core';

const item = (id: string, x: number, y: number, w: number, h: number, extra: Partial<DriftItem> = {}): DriftItem => ({
  id,
  x,
  y,
  w,
  h,
  ...extra,
});

describe('itemsEqual / layoutsEqual', () => {
  it('같은 참조/같은 값은 같고, 값이 다르면 다르다', () => {
    const a = item('a', 0, 0, 2, 2, { title: 't', props: { k: 1 } });
    expect(itemsEqual(a, a)).toBe(true);
    expect(itemsEqual(a, { ...a })).toBe(true);
    expect(itemsEqual(a, { ...a, props: { k: 1 } })).toBe(true); // 참조가 달라도 내용이 같으면 같다
    expect(itemsEqual(a, { ...a, props: { k: 2 } })).toBe(false);
    expect(itemsEqual(a, { ...a, x: 1 })).toBe(false);
    expect(itemsEqual(a, { ...a, title: undefined })).toBe(false);
  });

  it('undefined 속성은 없는 속성과 같다 (양방향)', () => {
    const a = item('a', 0, 0, 2, 2);
    expect(itemsEqual(a, { ...a, locked: undefined })).toBe(true);
    expect(itemsEqual({ ...a, locked: undefined }, a)).toBe(true);
    expect(itemsEqual(a, { ...a, locked: true })).toBe(false);
    expect(itemsEqual({ ...a, locked: true }, a)).toBe(false);
  });

  it('레이아웃 비교: float false 와 없음은 같고, 항목 순서/개수/메타 변경은 다르다', () => {
    const base = createLayout({ items: [item('a', 0, 0, 2, 2), item('b', 2, 0, 2, 2)] });
    expect(layoutsEqual(base, { ...base })).toBe(true);
    expect(layoutsEqual(base, { ...base, float: false })).toBe(true);
    expect(layoutsEqual(base, { ...base, float: true })).toBe(false);
    expect(layoutsEqual(base, { ...base, gap: 9 })).toBe(false);
    expect(layoutsEqual(base, { ...base, items: [...base.items].reverse() })).toBe(false);
    expect(layoutsEqual(base, { ...base, items: base.items.slice(1) })).toBe(false);
    expect(layoutsEqual(base, { ...base, breakpoints: [{ name: 'x', maxWidth: 1, columns: 1 }] })).toBe(false);
  });
});

describe('diffItems', () => {
  const before = [item('a', 0, 0, 4, 2), item('b', 4, 0, 4, 2), item('c', 0, 2, 4, 2)];

  it('추가/제거/변경을 id 기준으로 구분하고 moved/resized 를 구분한다', () => {
    const after = [
      item('a', 0, 0, 4, 2, { title: 'new' }),
      item('b', 4, 0, 6, 2),
      item('d', 0, 2, 2, 2),
      item('x', 8, 5, 1, 1),
    ];
    // c 제거, d/x 추가, a 제목 변경, b 크기 변경
    const diff = diffItems(before, [after[0], after[1], after[2], after[3]]);
    expect(diff.added.map((i) => i.id)).toEqual(['d', 'x']);
    expect(diff.removed.map((i) => i.id)).toEqual(['c']);
    expect(diff.changed.map((c) => c.id)).toEqual(['a', 'b']);
    expect(diff.changed[0]).toMatchObject({ moved: false, resized: false });
    expect(diff.changed[0].before.title).toBeUndefined();
    expect(diff.changed[0].after.title).toBe('new');
    expect(diff.changed[1]).toMatchObject({ moved: false, resized: true });
  });

  it('위치만 바뀌면 moved, 둘 다 바뀌면 moved+resized', () => {
    const diff = diffItems(before, [item('a', 1, 0, 4, 2), item('b', 5, 1, 2, 2), item('c', 0, 2, 4, 2)]);
    expect(diff.changed.map((c) => [c.id, c.moved, c.resized])).toEqual([
      ['a', true, false],
      ['b', true, true],
    ]);
  });

  it('변경이 없으면 모두 비어 있다', () => {
    const diff = diffItems(
      before,
      before.map((i) => ({ ...i })),
    );
    expect(diff).toEqual({ added: [], removed: [], changed: [] });
  });

  it('결과는 입력과 분리된 깊은 복사본이다', () => {
    const src = [item('a', 0, 0, 2, 2, { props: { k: 1 } })];
    const diff = diffItems([], src);
    (diff.added[0].props as Record<string, unknown>).k = 99;
    diff.added[0].x = 7;
    expect(src[0]).toEqual(item('a', 0, 0, 2, 2, { props: { k: 1 } }));

    const b = [item('a', 0, 0, 2, 2, { props: { k: 1 } })];
    const a = [item('a', 3, 0, 2, 2, { props: { k: 1 } })];
    const d = diffItems(b, a);
    (d.changed[0].before.props as Record<string, unknown>).k = 5;
    (d.changed[0].after.props as Record<string, unknown>).k = 6;
    expect(b[0].props).toEqual({ k: 1 });
    expect(a[0].props).toEqual({ k: 1 });
    expect(d.changed[0].before).not.toBe(b[0]);
  });
});

describe('hasOverlap', () => {
  it('겹침 판정: 맞닿음은 겹침이 아니고, 한 칸이라도 겹치면 겹침이다', () => {
    expect(hasOverlap([])).toBe(false);
    expect(hasOverlap([item('a', 0, 0, 2, 2), item('b', 2, 0, 2, 2), item('c', 0, 2, 4, 1)])).toBe(false);
    expect(hasOverlap([item('a', 0, 0, 2, 2), item('b', 1, 1, 2, 2)])).toBe(true);
    expect(hasOverlap([item('a', 0, 0, 4, 4), item('b', 1, 1, 1, 1)])).toBe(true); // 완전히 포함
    expect(hasOverlap([item('a', 0, 0, 2, 2), item('b', 0, 0, 2, 2)])).toBe(true); // 동일 위치
  });

  it('무작위 입력에서 단순 O(n²) 검사와 같은 결과를 낸다', () => {
    let s = 12345;
    const rnd = (n: number) => (s = (s * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let k = 0; k < 500; k++) {
      const items = Array.from({ length: rnd(15) }, (_, i) => item(`i${i}`, rnd(8), rnd(10), 1 + rnd(3), 1 + rnd(3)));
      let expected = false;
      for (let i = 0; i < items.length && !expected; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) expected = true;
        }
      }
      expect(hasOverlap(items)).toBe(expected);
    }
  });
});

describe('sanitizeItem', () => {
  it('입력을 변경하지 않고 알려진 필드만 가진 새 객체를 반환한다', () => {
    const raw = Object.freeze({
      id: 'a',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      evil: 'x',
      props: Object.freeze({ k: 1, f: () => 1 }),
    }) as unknown as DriftItem;
    const clean = sanitizeItem(raw);
    expect(clean).not.toBe(raw);
    expect(clean).not.toHaveProperty('evil');
    expect(clean.props).toEqual({ k: 1 });
    expect(clean.props).not.toBe(raw.props);
  });
});
