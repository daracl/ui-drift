/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, Page, test } from '@playwright/test';
import { box } from './helpers';

/** 검증용 하네스 페이지(uitest/api.html)를 열고 콘솔/페이지 오류를 수집한다 */
async function open(page: Page, viewport?: { width: number; height: number }) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  if (viewport) await page.setViewportSize(viewport);
  await page.goto('/uitest/api.html');
  await page.waitForFunction(() => (window as any).__ready === true);
  return errors;
}

const SETUP = `
  window.make = (layout, options) => {
    const host = document.getElementById('host');
    host.innerHTML = '';
    window.events = [];
    window.ed = Drift.createDriftEditor(host, { layout, ...options });
    for (const n of ['dragStart','dragEnd','resizeStart','resizeEnd','add','remove']) window.ed.on(n, () => window.events.push(n));
    window.ed.on('layoutChange', (_l, i) => window.events.push('change:' + i.reason));
    return window.ed;
  };
`;

const LAYOUT = {
  columns: 12,
  items: [
    { id: 'a', x: 0, y: 0, w: 4, h: 3, content: 'A' },
    { id: 'b', x: 4, y: 0, w: 4, h: 3, content: 'B' },
    { id: 'c', x: 8, y: 0, w: 4, h: 3, content: 'C' },
    { id: 'd', x: 0, y: 3, w: 6, h: 2, content: 'D' },
  ],
};

async function init(page: Page, layout: any = LAYOUT, options: any = {}) {
  await page.evaluate(SETUP);
  await page.evaluate(([l, o]) => (window as any).make(l, o), [layout, options]);
}
const ed = <T>(page: Page, fn: string): Promise<T> =>
  page.evaluate(`(() => { const ed = window.ed; return ${fn}; })()`) as Promise<T>;
const metrics = (page: Page) => ed<any>(page, 'ed.getMetrics()');
const items = (page: Page) => ed<any[]>(page, 'ed.getItems()');

async function dragCells(page: Page, id: string, toX: number, toY: number) {
  const m = await metrics(page);
  const cur = (await items(page)).find((i) => i.id === id);
  const h = await box(page, `[data-drift-id="${id}"] .ddr-handle`);
  const sx = h.x + 20;
  const sy = h.y + h.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + (toX - cur.x) * (m.cellWidth + m.gap), sy + (toY - cur.y) * (m.rowHeight + m.gap), {
    steps: 8,
  });
  await page.mouse.up();
}

const overlaps = (list: any[]) =>
  list.some((a, i) =>
    list.slice(i + 1).some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y),
  );

test.describe('[EDT] Editor: 추가/삭제', () => {
  test('EDT-01 추가: ID 구분, DOM 과 데이터 일치, 중복 ID/잘못된 데이터 안전 처리', async ({ page }) => {
    const errors = await open(page);
    await init(page, { columns: 12, items: [] });
    await ed(
      page,
      `(ed.addItem({id:'x',w:3,h:2,content:'X'}), ed.addItem({id:'y',w:3,h:2}), ed.addItem({id:'z',w:3,h:2,props:{k:1}}), 0)`,
    );
    expect(await page.locator('.ddr-item').count()).toBe(3);
    const layout = await ed<any>(page, 'ed.getLayout()');
    expect(layout.items.map((i: any) => i.id).sort()).toEqual(['x', 'y', 'z']);
    expect(overlaps(layout.items)).toBe(false);

    // 중복 ID / 잘못된 입력은 예외로 거부되고 상태가 유지된다
    for (const bad of [`{id:'x',w:1,h:1}`, `{id:'',w:1,h:1}`, `null`, `{w:1,h:1}`]) {
      expect(
        await page.evaluate(
          `(() => { try { window.ed.addItem(${bad}); return 'no-throw'; } catch (e) { return 'throw'; } })()`,
        ),
      ).toBe('throw');
    }
    expect(await page.locator('.ddr-item').count()).toBe(3);

    // 비정상 크기/좌표는 보정된다 (음수, 컬럼 초과, NaN)
    await ed(page, `ed.addItem({id:'odd',x:-5,y:-5,w:-3,h:0})`);
    await ed(page, `ed.addItem({id:'wide',w:99,h:2})`);
    const odd = (await items(page)).find((i) => i.id === 'odd');
    const wide = (await items(page)).find((i) => i.id === 'wide');
    expect(odd.x).toBeGreaterThanOrEqual(0);
    expect(odd.w).toBeGreaterThanOrEqual(1);
    expect(odd.h).toBeGreaterThanOrEqual(1);
    expect(wide.x + wide.w).toBeLessThanOrEqual(12);
    expect(errors).toEqual([]);
  });

  test('EDT-02 삭제: 화면과 데이터에서 모두 제거, 전체 삭제(빈 레이아웃) 후에도 오류 없음', async ({ page }) => {
    const errors = await open(page);
    await init(page);
    await ed(page, `ed.removeItem('a')`);
    await expect(page.locator('[data-drift-id="a"]')).toHaveCount(0);
    expect((await ed<any>(page, 'ed.getLayout()')).items.some((i: any) => i.id === 'a')).toBe(false);
    for (const id of ['b', 'c', 'd']) await ed(page, `ed.removeItem('${id}')`);
    expect(await page.locator('.ddr-item').count()).toBe(0);
    expect((await ed<any>(page, 'ed.getLayout()')).items).toEqual([]);
    // 빈 상태에서의 동작
    await ed(page, `(ed.undo(), ed.redo(), ed.clear(), ed.toJSON())`);
    await ed(page, `ed.addItem({id:'again',w:2,h:2})`);
    expect(await page.locator('.ddr-item').count()).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('[DND] Editor: Drag & Drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
  });

  test('DND-01 드롭 후 DOM 위치와 저장 좌표가 그리드에 정확히 일치한다', async ({ page }) => {
    const errors = await open(page);
    await init(page);
    await dragCells(page, 'd', 6, 5);
    const m = await metrics(page);
    const canvas = await box(page, '.daracl-drift');
    for (const it of await items(page)) {
      await expect
        .poll(async () => {
          const b = await box(page, `[data-drift-id="${it.id}"]`);
          return [b.x - canvas.x, b.y - canvas.y, b.width, b.height].map((v) => Math.round(v));
        })
        .toEqual([
          Math.round(it.x * (m.cellWidth + m.gap)),
          Math.round(it.y * (m.rowHeight + m.gap)),
          Math.round(it.w * m.cellWidth + (it.w - 1) * m.gap),
          Math.round(it.h * m.rowHeight + (it.h - 1) * m.gap),
        ]);
    }
    expect(errors).toEqual([]);
  });

  test('DND-02 이벤트는 1회씩만 발생하고 컴포넌트가 복제/유실되지 않는다', async ({ page }) => {
    await open(page);
    await init(page);
    await dragCells(page, 'a', 4, 6);
    const events = await page.evaluate(() => (window as any).events as string[]);
    expect(events.filter((e) => e === 'dragStart')).toHaveLength(1);
    expect(events.filter((e) => e === 'dragEnd')).toHaveLength(1);
    expect(events.filter((e) => e === 'change:drag')).toHaveLength(1);
    expect(await page.locator('.ddr-item').count()).toBe(4);
    expect((await items(page)).map((i) => i.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  test('DND-03 포인터가 컨테이너/화면 밖으로 나가도 안정적이며 컨테이너를 벗어나지 않는다', async ({ page }) => {
    const errors = await open(page, { width: 1280, height: 800 });
    await init(page);
    const h = await box(page, '[data-drift-id="b"] .ddr-handle');
    await page.mouse.move(h.x + 20, h.y + 10);
    await page.mouse.down();
    for (const [x, y] of [
      [2000, 300],
      [-500, 400],
      [600, 3000],
      [600, -200],
      [400, 300],
    ]) {
      await page.mouse.move(x, y, { steps: 3 });
      const cur = await items(page);
      expect(cur.every((i) => i.x >= 0 && i.x + i.w <= 12 && i.y >= 0)).toBe(true);
    }
    // 화면 밖(오른쪽 아래)에서 놓기
    await page.mouse.move(2000, 3000, { steps: 3 });
    await page.mouse.up();
    const after = await items(page);
    expect(after).toHaveLength(4);
    expect(after.every((i) => i.x >= 0 && i.x + i.w <= 12 && i.y >= 0)).toBe(true);
    expect(overlaps(after)).toBe(false);
    const canvas = await box(page, '.daracl-drift');
    const b = await box(page, '[data-drift-id="b"]');
    await expect
      .poll(async () => (await box(page, '[data-drift-id="b"]')).x + b.width)
      .toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    expect(errors).toEqual([]);
  });

  test('DND-04 locked 위에 놓는 유효하지 않은 드롭은 거부되고 상태가 유지되며 placeholder 가 무효 표시된다', async ({
    page,
  }) => {
    await open(page);
    await init(page, {
      columns: 12,
      items: [
        { id: 'l', x: 4, y: 0, w: 4, h: 3, locked: true },
        { id: 'a', x: 0, y: 0, w: 4, h: 3 },
      ],
    });
    const before = await ed<any>(page, 'ed.getLayout()');
    const m = await metrics(page);
    const h = await box(page, '[data-drift-id="a"] .ddr-handle');
    await page.mouse.move(h.x + 20, h.y + 10);
    await page.mouse.down();
    await page.mouse.move(h.x + 20 + 4 * (m.cellWidth + m.gap), h.y + 10, { steps: 8 });
    await expect(page.locator('.ddr-placeholder')).toHaveClass(/ddr-placeholder-invalid/);
    await page.mouse.up();
    expect(await ed<any>(page, 'ed.getLayout()')).toEqual(before);
  });

  test('DND-05 Esc 취소와 pointercancel 모두 원위치로 복구된다', async ({ page }) => {
    await open(page);
    await init(page);
    const before = await ed<any>(page, 'ed.getLayout()');
    const h = await box(page, '[data-drift-id="a"] .ddr-handle');
    await page.mouse.move(h.x + 20, h.y + 10);
    await page.mouse.down();
    await page.mouse.move(h.x + 500, h.y + 300, { steps: 6 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await ed<any>(page, 'ed.getLayout()')).toEqual(before);
    await expect(page.locator('.ddr-placeholder')).toBeHidden();
    await expect(page.locator('.ddr-dragging')).toHaveCount(0);
  });

  test('DND-06 연속 드래그 25회(무작위 셀) 후에도 겹침/유실/오류가 없다', async ({ page }) => {
    const errors = await open(page);
    await init(page);
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let i = 0; i < 25; i++) {
      const id = ['a', 'b', 'c', 'd'][rnd(4)];
      const it = (await items(page)).find((x) => x.id === id);
      await dragCells(page, id, rnd(13 - it.w), rnd(8));
      const cur = await items(page);
      expect(cur).toHaveLength(4);
      expect(overlaps(cur)).toBe(false);
      expect(cur.every((c: any) => c.x >= 0 && c.x + c.w <= 12 && c.y >= 0)).toBe(true);
    }
    expect(await page.locator('.ddr-item').count()).toBe(4);
    const dragEnds = (await page.evaluate(() => (window as any).events as string[])).filter(
      (e) => e === 'dragEnd',
    ).length;
    const dragStarts = (await page.evaluate(() => (window as any).events as string[])).filter(
      (e) => e === 'dragStart',
    ).length;
    expect(dragEnds).toBe(dragStarts);
    expect(errors).toEqual([]);
  });

  test('DND-07 충돌 시 재배치 후 다른 컴포넌트의 데이터(content/props/크기)가 유실되지 않는다', async ({ page }) => {
    await open(page);
    await init(page, {
      columns: 12,
      items: [
        { id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'A', props: { k: 'v' }, title: 'TA' },
        { id: 'b', x: 4, y: 0, w: 4, h: 2, content: 'B', props: { n: 2 } },
      ],
    });
    await dragCells(page, 'a', 4, 0);
    const layout = await ed<any>(page, 'ed.getLayout()');
    const b = layout.items.find((i: any) => i.id === 'b');
    const a = layout.items.find((i: any) => i.id === 'a');
    expect(b).toMatchObject({ content: 'B', props: { n: 2 }, w: 4, h: 2 });
    expect(a).toMatchObject({ content: 'A', props: { k: 'v' }, title: 'TA', x: 4 });
    expect(overlaps(layout.items)).toBe(false);
  });
});

test.describe('[RSZ] Editor: Resize', () => {
  const L = {
    columns: 12,
    items: [
      { id: 'r', x: 2, y: 0, w: 4, h: 3, minW: 2, minH: 2, maxW: 6, maxH: 4, content: 'R' },
      { id: 'u', x: 0, y: 3, w: 12, h: 2 },
    ],
  };

  async function resizeBy(page: Page, id: string, dxCells: number, dyCells: number) {
    const m = await metrics(page);
    const g = await box(page, `[data-drift-id="${id}"] .ddr-resize-handle`);
    const sx = g.x + g.width / 2;
    const sy = g.y + g.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + dxCells * (m.cellWidth + m.gap), sy + dyCells * (m.rowHeight + m.gap), { steps: 10 });
    await page.mouse.up();
  }

  test('RSZ-01 크기 변경: 실제 크기와 데이터가 일치하고 아래 항목이 밀린다', async ({ page }) => {
    await open(page);
    await init(page, L);
    await resizeBy(page, 'r', 1, 1);
    const r = (await items(page)).find((i) => i.id === 'r');
    expect(r).toMatchObject({ w: 5, h: 4 });
    const m = await metrics(page);
    await expect
      .poll(async () => Math.round((await box(page, '[data-drift-id="r"]')).width))
      .toBe(Math.round(5 * m.cellWidth + 4 * m.gap));
    await expect
      .poll(async () => Math.round((await box(page, '[data-drift-id="r"]')).height))
      .toBe(4 * m.rowHeight + 3 * m.gap);
    expect(overlaps(await items(page))).toBe(false);
    expect((await items(page)).find((i) => i.id === 'u')!.y).toBeGreaterThanOrEqual(4);
  });

  test('RSZ-02 최소/최대/컨테이너 경계에서 제한이 적용된다', async ({ page }) => {
    await open(page);
    await init(page, L);
    await resizeBy(page, 'r', -10, -10); // 최소보다 작게
    expect((await items(page)).find((i) => i.id === 'r')).toMatchObject({ w: 2, h: 2 });
    await resizeBy(page, 'r', 20, 20); // 최대보다 크게(화면 밖까지)
    const r = (await items(page)).find((i) => i.id === 'r');
    expect(r.w).toBeLessThanOrEqual(6);
    expect(r.h).toBeLessThanOrEqual(4);
    expect(r.x + r.w).toBeLessThanOrEqual(12);
    expect(overlaps(await items(page))).toBe(false);
  });

  test('RSZ-03 1x1 최소 크기와 전체 폭 크기에서도 레이아웃이 깨지지 않는다', async ({ page }) => {
    const errors = await open(page);
    await init(page, {
      columns: 12,
      items: [
        { id: 's', x: 0, y: 0, w: 1, h: 1, content: 'tiny' },
        { id: 'f', x: 0, y: 1, w: 12, h: 1, content: 'full' },
      ],
    });
    const canvas = await box(page, '.daracl-drift');
    const s = await box(page, '[data-drift-id="s"]');
    const f = await box(page, '[data-drift-id="f"]');
    await expect
      .poll(async () => Math.round((await box(page, '[data-drift-id="f"]')).width))
      .toBe(Math.round(canvas.width));
    expect(s.width).toBeGreaterThan(10);
    expect(f.x).toBeCloseTo(canvas.x, 0);
    expect(errors).toEqual([]);
  });
});

test.describe('[DAT] 레이아웃 데이터', () => {
  test('DAT-01 필수 시나리오: 3개 생성→이동/리사이즈→JSON 저장→destroy→복원 후 의미 동일', async ({ page }) => {
    const errors = await open(page);
    await init(page, { columns: 12, items: [] });
    await ed(
      page,
      `(ed.addItem({id:'p',x:0,y:0,w:4,h:2,content:'P',props:{kind:'chart',n:1,on:true},title:'TP'}), ed.addItem({id:'q',x:4,y:0,w:4,h:2,content:'Q',minW:2,maxW:8}), ed.addItem({id:'r',x:8,y:0,w:4,h:2,props:{s:'x'}}), 0)`,
    );
    await dragCells(page, 'p', 2, 4);
    await ed(page, `ed.resizeItem('q', 6, 3)`);
    await ed(page, `ed.setBreakpoint('mobile')`);
    await ed(page, `ed.moveItem('r', 0, 0)`);
    await ed(page, `ed.setBreakpoint(null)`);
    const before = await ed<any>(page, 'ed.getLayout()');
    const json = await ed<string>(page, 'ed.toJSON()');
    const beforeItems = await items(page);

    await ed(page, 'ed.destroy()');
    expect(await page.locator('.ddr-item').count()).toBe(0);

    await page.evaluate((j) => {
      (window as any).make(j, {});
    }, json);
    const after = await ed<any>(page, 'ed.getLayout()');
    const norm = (l: any) => ({ ...l, items: [...l.items].sort((a: any, b: any) => a.id.localeCompare(b.id)) });
    expect(norm(after)).toEqual(norm(before));
    // ID, 위치, 크기, 속성, 반응형 개별 비교
    for (const b of beforeItems) {
      const a = (await items(page)).find((i) => i.id === b.id);
      expect(a).toMatchObject({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h });
    }
    const p = after.items.find((i: any) => i.id === 'p');
    expect(p).toMatchObject({ props: { kind: 'chart', n: 1, on: true }, title: 'TP', content: 'P' });
    expect(after.items.find((i: any) => i.id === 'r').responsive.mobile).toMatchObject({ x: 0, y: 0 });
    expect(await page.locator('.ddr-item').count()).toBe(3);
    expect(errors).toEqual([]);
  });

  test('DAT-02 손상/잘못된 데이터: 손상 JSON 은 예외+상태 유지, 중복 ID/누락 필드/비정상 값은 보정', async ({
    page,
  }) => {
    await open(page);
    await init(page);
    const before = await ed<any>(page, 'ed.getLayout()');
    for (const bad of [`'{'`, `'[]'`, `'null'`, `'{"version":9}'`, `'not json'`]) {
      expect(
        await page.evaluate(
          `(() => { try { window.ed.fromJSON(${bad}); return 'no-throw'; } catch (e) { return 'throw'; } })()`,
        ),
      ).toBe('throw');
    }
    expect(await ed<any>(page, 'ed.getLayout()')).toEqual(before);

    await ed(
      page,
      `ed.load({columns:6, items:[
        {id:'k',x:0,y:0,w:2,h:2},{id:'k',x:2,y:0,w:2,h:2},{x:1,y:1,w:1,h:1},
        {id:'neg',x:-4,y:-1,w:-2,h:-2},{id:'big',x:5,y:0,w:99,h:1},{id:'nan',x:'a',y:null,w:'b',h:NaN}]})`,
    );
    const list = await items(page);
    expect(list.map((i) => i.id).sort()).toEqual(['big', 'k', 'nan', 'neg']);
    expect(
      list.every(
        (i) =>
          Number.isInteger(i.x) &&
          Number.isInteger(i.y) &&
          i.w >= 1 &&
          i.h >= 1 &&
          i.x >= 0 &&
          i.y >= 0 &&
          i.x + i.w <= 6,
      ),
    ).toBe(true);
    expect(overlaps(list)).toBe(false);
    expect(await ed<any>(page, 'Drift.validateLayout(ed.getLayout())')).toMatchObject({ valid: true });
    // 빈 배열 / 빈 객체
    await ed(page, `ed.load({items:[]})`);
    expect(await items(page)).toEqual([]);
    await ed(page, `ed.load({})`);
    expect(await items(page)).toEqual([]);
  });
});

test.describe('[API] 공개 API / 리소스 관리', () => {
  test('API-01 인스턴스 독립성: 두 에디터가 서로 영향을 주지 않는다', async ({ page }) => {
    const errors = await open(page);
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="h1" style="width:600px"></div><div id="h2" style="width:600px"></div>',
      );
      const w = window as any;
      w.e1 = w.Drift.createDriftEditor('#h1', {
        layout: { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 4, h: 2 }] },
      });
      w.e2 = w.Drift.createDriftEditor('#h2', {
        layout: { columns: 6, items: [{ id: 'a', x: 0, y: 0, w: 2, h: 2 }] },
        float: true,
      });
      w.log1 = [];
      w.log2 = [];
      w.e1.on('layoutChange', () => w.log1.push(1));
      w.e2.on('layoutChange', () => w.log2.push(1));
    });
    await page.evaluate(() => (window as any).e1.moveItem('a', 6, 0));
    const r = await page.evaluate(() => {
      const w = window as any;
      return {
        a1: w.e1.getItem('a'),
        a2: w.e2.getItem('a'),
        l1: w.log1.length,
        l2: w.log2.length,
        f1: w.e1.isFloat(),
        f2: w.e2.isFloat(),
      };
    });
    expect(r.a1).toMatchObject({ x: 6 });
    expect(r.a2).toMatchObject({ x: 0 });
    expect([r.l1, r.l2]).toEqual([1, 0]);
    expect([r.f1, r.f2]).toEqual([false, true]);
    // 하나를 destroy 해도 다른 하나는 동작한다
    await page.evaluate(() => (window as any).e1.destroy());
    await page.evaluate(() => (window as any).e2.moveItem('a', 3, 0));
    expect(await page.evaluate(() => (window as any).e2.getItem('a').x)).toBe(3);
    expect(errors).toEqual([]);
  });

  test('API-02 create/destroy 50회 반복: 리스너/ResizeObserver/DOM 이 누적되지 않는다', async ({ page }) => {
    // 페이지 스크립트보다 먼저 EventTarget / ResizeObserver 를 감시한다
    await page.addInitScript(() => {
      const w = window as any;
      w.__active = new Set<any>();
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function (this: any, type: string, fn: any, opt?: any) {
        if (fn && opt && typeof opt === 'object' && opt.signal) {
          const rec = { target: this, type, fn, signal: opt.signal };
          w.__active.add(rec);
        } else if (fn) {
          w.__active.add({ target: this, type, fn, signal: null });
        }
        return add.call(this, type, fn, opt);
      } as any;
      EventTarget.prototype.removeEventListener = function (this: any, type: string, fn: any, opt?: any) {
        for (const r of Array.from(w.__active) as any[])
          if (r.target === this && r.type === type && r.fn === fn) w.__active.delete(r);
        return remove.call(this, type, fn, opt);
      } as any;
      w.__live = 0;
      const RO = w.ResizeObserver;
      w.ResizeObserver = class extends RO {
        constructor(cb: any) {
          super(cb);
          w.__live++;
          this.__on = true;
        }
        disconnect() {
          if (this.__on) w.__live--;
          this.__on = false;
          super.disconnect();
        }
      };
    });
    const errors = await open(page);
    const result = await page.evaluate(() => {
      const w = window as any;
      const live = () =>
        Array.from(w.__active)
          .filter((r: any) => r.target !== window || true)
          .filter((r: any) => !(r.signal && r.signal.aborted)).length;
      const baseline = live();
      const host = document.getElementById('host')!;
      for (let i = 0; i < 50; i++) {
        const e = w.Drift.createDriftEditor(host, {
          layout: {
            columns: 12,
            items: [
              { id: 'a', x: 0, y: 0, w: 4, h: 2 },
              { id: 'b', x: 4, y: 0, w: 4, h: 2 },
            ],
          },
          removable: true,
        });
        e.on('layoutChange', () => undefined);
        e.moveItem('a', 6, 0);
        e.destroy();
      }
      // 이벤트가 중복 등록되었다면 destroy 후 키/포인터 입력에도 반응한다
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return {
        listenersLeft: live() - baseline,
        observersLive: w.__live,
        hostChildren: host.children.length,
        hostClass: host.className,
        items: document.querySelectorAll('.ddr-item').length,
      };
    });
    expect(result).toEqual({ listenersLeft: 0, observersLive: 0, hostChildren: 0, hostClass: '', items: 0 });
    expect(errors).toEqual([]);
  });

  test('API-03 잘못된 옵션/입력 오류 처리', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const t = (fn: () => unknown) => {
        try {
          fn();
          return 'ok';
        } catch (e) {
          return 'throw';
        }
      };
      const host = document.getElementById('host')!;
      return {
        noContainer: t(() => w.Drift.createDriftEditor('#does-not-exist')),
        badLayoutString: t(() => w.Drift.createDriftEditor(host, { layout: '{bad' })),
        weirdNumbers: t(() => {
          const e = w.Drift.createDriftEditor(host, { columns: -5, rowHeight: 0, gap: -3 });
          const l = e.getLayout();
          e.destroy();
          if (l.columns !== 12 || l.rowHeight !== 40 || l.gap !== 8) throw new Error('보정 실패');
        }),
        badBreakpoint: t(() => {
          const e = w.Drift.createDriftEditor(host, {});
          try {
            e.setBreakpoint('zz');
          } finally {
            e.destroy();
          }
        }),
        viewerBadScope: t(() => w.Drift.renderViewer({}, { scope: 'a b' })),
        viewerBadJson: t(() => w.Drift.renderViewer('{')),
        afterDestroyNoThrow: t(() => {
          const e = w.Drift.createDriftEditor(host, {});
          e.destroy();
          e.destroy();
          e.removeItem('x');
          e.getLayout();
        }),
      };
    });
    expect(r).toEqual({
      noContainer: 'throw',
      badLayoutString: 'throw',
      weirdNumbers: 'ok',
      badBreakpoint: 'throw',
      viewerBadScope: 'throw',
      viewerBadJson: 'throw',
      afterDestroyNoThrow: 'ok',
    });
  });

  test('API-04 이벤트 등록/해제: off, once, 해제 함수가 동작한다', async ({ page }) => {
    await open(page);
    await init(page);
    const r = await page.evaluate(() => {
      const w = window as any;
      const calls: string[] = [];
      const h = () => calls.push('on');
      const off = w.ed.on('layoutChange', h);
      w.ed.once('layoutChange', () => calls.push('once'));
      w.ed.moveItem('a', 8, 6); // on + once
      w.ed.moveItem('a', 0, 6); // on
      off();
      w.ed.moveItem('a', 4, 6); // 없음
      w.ed.on('layoutChange', h);
      w.ed.off('layoutChange', h);
      w.ed.moveItem('a', 6, 6); // 없음
      return calls;
    });
    expect(r).toEqual(['on', 'once', 'on']);
  });
});
