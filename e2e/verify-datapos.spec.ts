/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';
import { createLayout, renderViewerPage } from '../src/viewer';
import { box } from './helpers';

const LAYOUT = {
  columns: 12,
  rowHeight: 40,
  gap: 8,
  items: [
    { id: 'a', x: 0, y: 0, w: 4, h: 3, content: 'A' },
    { id: 'b', x: 4, y: 0, w: 4, h: 3, content: 'B' },
  ],
};

test.describe('[POS] 위치/크기는 data-x/y/w/h 속성이 결정한다', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uitest/api.html');
    await page.waitForFunction(() => (window as any).__ready === true);
  });

  test('POS-01 Editor: 항목에 인라인 width/height/transform 이 없고 data 속성만 있다', async ({ page }) => {
    await page.evaluate(
      (l) => (window as any).Drift.createDriftEditor(document.getElementById('host'), { layout: l }),
      LAYOUT,
    );
    const r = await page.evaluate(() => {
      const el = document.querySelector('[data-drift-id="b"]') as HTMLElement;
      return { style: el.getAttribute('style'), data: { ...el.dataset } };
    });
    expect(r.style ?? '').toBe('');
    expect(r.data).toMatchObject({ x: '4', y: '0', w: '4', h: '3' });
  });

  test('POS-02 Editor: data 속성을 바꾸면 CSS 가 위치/크기를 따라간다', async ({ page }) => {
    await page.evaluate(
      (l) => (window as any).Drift.createDriftEditor(document.getElementById('host'), { layout: l, animate: false }),
      LAYOUT,
    );
    const m = await page.evaluate(() => {
      const ed = document.getElementById('host') as any;
      return ed ? true : false;
    });
    expect(m).toBe(true);
    const canvas = await box(page, '.daracl-drift');
    const stride = (canvas.width + 8) / 12;

    await page.evaluate(() => {
      const el = document.querySelector('[data-drift-id="b"]') as HTMLElement;
      el.dataset.x = '8';
      el.dataset.y = '2';
      el.dataset.w = '3';
      el.dataset.h = '2';
    });
    await expect
      .poll(async () => {
        const b = await box(page, '[data-drift-id="b"]');
        return [b.x - canvas.x, b.y - canvas.y, b.width, b.height].map((v) => Math.round(v));
      })
      .toEqual([Math.round(8 * stride), 2 * 48, Math.round(3 * stride - 8), 2 * 40 + 8]);
  });

  test('POS-03 Editor: 드래그 중에만 인라인 left/top 이 쓰이고 끝나면 제거되어 data 속성 기준이 된다', async ({
    page,
  }) => {
    await page.evaluate(
      (l) => (window as any).Drift.createDriftEditor(document.getElementById('host'), { layout: l }),
      LAYOUT,
    );
    const h = await box(page, '[data-drift-id="a"] .ddr-handle');
    await page.mouse.move(h.x + 20, h.y + 10);
    await page.mouse.down();
    await page.mouse.move(h.x + 300, h.y + 200, { steps: 8 });
    expect(await page.evaluate(() => document.querySelector<HTMLElement>('[data-drift-id="a"]')!.style.left)).not.toBe(
      '',
    );
    await page.mouse.up();
    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-drift-id="a"]') as HTMLElement;
      return { style: el.getAttribute('style') ?? '', x: el.dataset.x, y: el.dataset.y };
    });
    expect(after.style).toBe('');
    expect(Number(after.x)).toBeGreaterThan(0);
  });

  test('POS-04 Editor: 인스턴스별 규칙이 분리되고 destroy 하면 스타일시트가 정리된다', async ({ page }) => {
    const r = await page.evaluate((l) => {
      const w = window as any;
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="h1" style="width:600px"></div><div id="h2" style="width:1200px"></div>',
      );
      const sheets = () =>
        document.adoptedStyleSheets.length + document.querySelectorAll('style[data-ddr-style]').length;
      const base = sheets();
      const e1 = w.Drift.createDriftEditor('#h1', { layout: l, animate: false });
      const e2 = w.Drift.createDriftEditor('#h2', {
        layout: { ...l, columns: 6, items: [{ id: 'z', x: 3, y: 0, w: 3, h: 1 }] },
        animate: false,
      });
      const afterCreate = sheets() - base;
      const uid1 = document.querySelector('#h1 .daracl-drift')!.getAttribute('data-ddr');
      const uid2 = document.querySelector('#h2 .daracl-drift')!.getAttribute('data-ddr');
      const zRect = (document.querySelector('[data-drift-id="z"]') as HTMLElement).getBoundingClientRect();
      const aRect = (document.querySelector('[data-drift-id="b"]') as HTMLElement).getBoundingClientRect();
      e1.destroy();
      e2.destroy();
      return {
        afterCreate,
        uid1,
        uid2,
        afterDestroy: sheets() - base,
        zLeft: zRect.left,
        zWidth: zRect.width,
        bLeft: aRect.left,
        bWidth: aRect.width,
      };
    }, LAYOUT);
    expect(r.afterCreate).toBe(2);
    expect(r.uid1).not.toBe(r.uid2);
    expect(r.afterDestroy).toBe(0);
    // 12열(폭 600)과 6열(폭 1200)이 서로 다른 규칙으로 올바르게 계산된다
    expect(r.bWidth).toBeCloseTo(((600 + 8) * 4) / 12 - 8, 0);
    expect(r.zWidth).toBeCloseTo(((1200 + 8) * 3) / 6 - 8, 0);
  });

  test('POS-05 Editor: 위치 CSS 는 인라인 <style> 없이 생성형 스타일시트로 적용된다(CSP 안전 경로)', async ({
    page,
  }) => {
    await page.evaluate(
      (l) => (window as any).Drift.createDriftEditor(document.getElementById('host'), { layout: l }),
      LAYOUT,
    );
    const r = await page.evaluate(() => ({
      adopted: document.adoptedStyleSheets.length,
      styleElements: document.querySelectorAll('style[data-ddr-style]').length,
    }));
    expect(r.adopted).toBeGreaterThanOrEqual(1);
    expect(r.styleElements).toBe(0);
  });
});

test.describe('[POS] Viewer 도 data 속성 값으로 배치된다', () => {
  const layout = createLayout(LAYOUT);
  const page0 = renderViewerPage(layout, { cssHref: '/v.css' });
  const css = `body{margin:0}\n${
    (require('../src/viewer') as typeof import('../src/viewer')).renderViewer(layout).css
  }`;

  test('POS-06 Viewer: JS 비활성에서 data 속성 → CSS 로 위치가 정해진다 (속성 값별 규칙)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route('http://v.test/**', (route) => {
      const isCss = route.request().url().endsWith('.css');
      return route.fulfill({ contentType: isCss ? 'text/css' : 'text/html', body: isCss ? css : page0 });
    });
    await page.goto('http://v.test/i.html');
    const html = await page.content();
    expect(html).toContain('data-x="4"');
    expect(html).not.toMatch(/\sstyle=/);
    const a = await box(page, '[data-drift-id="a"]');
    const b = await box(page, '[data-drift-id="b"]');
    const cell = (1200 - 8 * 11) / 12;
    expect(b.x - a.x).toBeCloseTo(4 * (cell + 8), 0);
    expect(b.width).toBeCloseTo(4 * cell + 3 * 8, 0);
    await context.close();
  });

  test('POS-07 Viewer: data 속성 값을 바꾸면 배치가 바뀐다 (위치의 근거가 속성임을 증명)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    await page.route('http://v.test/**', (route) => {
      const isCss = route.request().url().endsWith('.css');
      return route.fulfill({ contentType: isCss ? 'text/css' : 'text/html', body: isCss ? css : page0 });
    });
    await page.goto('http://v.test/i.html');
    const before = await box(page, '[data-drift-id="b"]');
    // CSS 에 존재하는 값(x=0, w=4)으로 바꾸면 a 와 같은 열/크기가 된다
    await page.evaluate(() => {
      const el = document.querySelector('[data-drift-id="b"]') as HTMLElement;
      el.setAttribute('data-x', '0');
    });
    const after = await box(page, '[data-drift-id="b"]');
    expect(before.x).toBeGreaterThan(after.x + 100);
    expect(after.x).toBeCloseTo((await box(page, '[data-drift-id="a"]')).x, 0);
    await context.close();
  });
});
