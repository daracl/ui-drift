import {
  applyItems,
  collides,
  createLayout,
  deriveItems,
  DriftItem,
  DriftLayout,
  getBreakpoints,
  matchBreakpoint,
  moveItem,
  parseLayout,
  resolveItems,
  serializeLayout,
  validateLayout,
} from '@/core';

const sample = (): DriftLayout =>
  createLayout({
    columns: 12,
    items: [
      { id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'A', props: { kind: 'chart', n: 1, on: true } },
      { id: 'b', x: 4, y: 0, w: 8, h: 2 },
      { id: 'c', x: 0, y: 2, w: 12, h: 3 },
    ],
  });

const noOverlap = (items: DriftItem[]) => {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) expect(collides(items[i], items[j])).toBe(false);
  }
};

describe('createLayout / validateLayout', () => {
  it('빈 입력도 유효한 기본 레이아웃을 만든다', () => {
    const layout = createLayout();
    expect(layout).toMatchObject({ version: 1, columns: 12, items: [] });
    expect(validateLayout(layout).valid).toBe(true);
  });

  it('잘못된 데이터를 검증에서 모두 보고한다', () => {
    const bad = {
      version: 1,
      columns: 12,
      rowHeight: 40,
      gap: 8,
      items: [
        { id: 'a', x: 0, y: 0, w: 4, h: 2 },
        { id: 'a', x: 0, y: 0, w: 4, h: 2 },
        { id: 'b', x: 10, y: 0, w: 4, h: 2 },
        { id: 'c', x: 'x', y: 0, w: 1, h: 1 },
      ],
    };
    const result = validateLayout(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/중복/);
    expect(result.errors.join('\n')).toMatch(/범위/);
    expect(result.errors.join('\n')).toMatch(/정수/);
    expect(result.errors.join('\n')).toMatch(/겹칩니다/);
  });

  it('객체가 아닌 입력을 거부한다', () => {
    expect(validateLayout(null).valid).toBe(false);
    expect(validateLayout({ version: 1, columns: 0, rowHeight: 40, gap: 8, items: 'x' }).valid).toBe(false);
  });
});

describe('serialize / parse', () => {
  it('JSON 왕복이 동일하다', () => {
    const layout = sample();
    const restored = parseLayout(serializeLayout(layout));
    expect(restored).toEqual(layout);
    expect(validateLayout(restored).valid).toBe(true);
  });

  it('잘못된 JSON 은 예외, 잘못된 항목은 보정/제거된다', () => {
    expect(() => parseLayout('{')).toThrow();
    expect(() => parseLayout('[]')).toThrow();
    expect(() => parseLayout({ version: 2 })).toThrow();

    const layout = parseLayout({
      columns: 4,
      items: [
        { id: 'ok', x: 3, y: 0, w: 9, h: 0, evil: '<script>' },
        { id: 'ok', x: 0, y: 0, w: 1, h: 1 },
        { x: 0, y: 0, w: 1, h: 1 },
        null,
        { id: 'nan', x: NaN, y: -3, w: 'z', h: 2, props: { f: () => 1, s: 's' } },
      ],
    });
    expect(layout.items.map((i) => i.id)).toEqual(['ok', 'nan']);
    expect(layout.items[0]).not.toHaveProperty('evil');
    expect(layout.items[0].w).toBeLessThanOrEqual(4);
    expect(layout.items[0].h).toBeGreaterThanOrEqual(1);
    expect(layout.items[1].props).toEqual({ s: 's' });
    expect(validateLayout(layout).valid).toBe(true);
  });

  it('빈 items 와 경계값', () => {
    expect(parseLayout({ items: [] }).items).toEqual([]);
    expect(parseLayout({}).columns).toBe(12);
    expect(parseLayout({ columns: -3, rowHeight: -1, gap: -1 })).toMatchObject({ columns: 12, rowHeight: 40, gap: 8 });
  });
});

describe('responsive', () => {
  it('breakpoint 기본값/비활성/매칭', () => {
    expect(getBreakpoints({}).map((b) => b.name)).toEqual(['tablet', 'mobile']);
    expect(getBreakpoints({ breakpoints: [] })).toEqual([]);
    expect(matchBreakpoint({}, 500)?.name).toBe('mobile');
    expect(matchBreakpoint({}, 800)?.name).toBe('tablet');
    expect(matchBreakpoint({}, 1400)).toBeUndefined();
  });

  it('4열 이하는 세로 적층: 화면 밖으로 나가거나 겹치지 않는다', () => {
    const derived = deriveItems(sample().items, 12, 4);
    derived.forEach((i) => {
      expect(i.x).toBe(0);
      expect(i.w).toBe(4);
    });
    expect(derived.map((i) => [i.id, i.y])).toEqual([
      ['a', 0],
      ['b', 2],
      ['c', 4],
    ]);
  });

  it('8열은 비례 축소되고 겹치지 않는다', () => {
    const derived = deriveItems(sample().items, 12, 8);
    derived.forEach((i) => expect(i.x + i.w).toBeLessThanOrEqual(8));
    noOverlap(derived);
  });

  it('8열 축소 후에도 같은 행에 맞닿아 있던 항목은 같은 행에 남는다', () => {
    const row = createLayout({
      columns: 12,
      items: [
        { id: 'a', x: 0, y: 0, w: 4, h: 2 },
        { id: 'b', x: 4, y: 0, w: 4, h: 2 },
        { id: 'c', x: 8, y: 0, w: 4, h: 2 },
      ],
    });
    const derived = deriveItems(row.items, 12, 8);
    expect(derived.map((i) => i.y)).toEqual([0, 0, 0]);
    expect(derived.reduce((sum, i) => sum + i.w, 0)).toBe(8);
  });

  it('더 넓은 컬럼 수로는 그대로 유지', () => {
    expect(deriveItems(sample().items, 12, 24).map((i) => i.w)).toEqual([4, 8, 12]);
  });

  it('breakpoint 편집은 해당 breakpoint 에만 저장되고 기본 레이아웃은 그대로다', () => {
    const layout = sample();
    const mobile = getBreakpoints(layout).find((b) => b.name === 'mobile')!;
    const edited = moveItem(resolveItems(layout, mobile), mobile.columns, 'c', 0, 0);
    const next = applyItems(layout, edited, mobile);

    expect(next.items.find((i) => i.id === 'c')!.responsive!.mobile).toMatchObject({ x: 0, y: 0 });
    expect(next.items.find((i) => i.id === 'c')).toMatchObject({ x: 0, y: 2, w: 12 });
    const resolved = resolveItems(next, mobile);
    expect(resolved.find((i) => i.id === 'c')).toMatchObject({ x: 0, y: 0 });
    noOverlap(resolved);
  });

  it('일부 항목만 명시하면 명시값이 우선하고 나머지가 비켜간다', () => {
    const layout = sample();
    const mobile = getBreakpoints(layout).find((b) => b.name === 'mobile')!;
    layout.items.find((i) => i.id === 'c')!.responsive = { mobile: { x: 0, y: 0, w: 2, h: 1 } };
    const resolved = resolveItems(layout, mobile);
    expect(resolved.find((i) => i.id === 'c')).toMatchObject({ x: 0, y: 0, w: 2, h: 1 });
    noOverlap(resolved);
  });

  it('기본 레이아웃 편집은 responsive 를 건드리지 않는다', () => {
    const layout = sample();
    const next = applyItems(
      layout,
      layout.items.map((i) => (i.id === 'a' ? { ...i, content: 'new' } : i)),
    );
    expect(next.items[0].content).toBe('new');
  });
});
