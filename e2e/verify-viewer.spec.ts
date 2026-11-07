/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { createLayout, renderViewer, renderViewerPage, resolveItems, matchBreakpoint } from '../src/viewer';
import { box } from './helpers';

const layout = createLayout({
  items: [
    { id: 'a', x: 0, y: 0, w: 4, h: 3, content: 'A', title: 'TA' },
    { id: 'b', x: 4, y: 0, w: 8, h: 3, content: 'B' },
    { id: 'c', x: 0, y: 3, w: 12, h: 2, content: 'C' },
  ],
});
const { css } = renderViewer(layout);
const CSS = `body{margin:0}\n${css}`;
const PAGE = renderViewerPage(layout, { cssHref: '/layout.css' });
const SHOTS = path.resolve(__dirname, '../docs/verification');

test.describe('[VWR] Viewer: JavaScript 비실행 증거', () => {
  test('VWR-A 새로고침을 반복해도 JS 없이 동일한 레이아웃, 오류/누락 리소스 없음', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('requestfailed', (r) => problems.push(`requestfailed ${r.url()}`));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));
    await page.route('http://viewer.test/**', (route) => {
      const isCss = route.request().url().endsWith('.css');
      return route.fulfill({ contentType: isCss ? 'text/css' : 'text/html', body: isCss ? CSS : PAGE });
    });
    await page.goto('http://viewer.test/v.html');
    const first = [
      await box(page, '[data-drift-id="a"]'),
      await box(page, '[data-drift-id="b"]'),
      await box(page, '[data-drift-id="c"]'),
    ];
    const htmlBefore = await page.content();
    for (let i = 0; i < 3; i++) await page.reload();
    const again = [
      await box(page, '[data-drift-id="a"]'),
      await box(page, '[data-drift-id="b"]'),
      await box(page, '[data-drift-id="c"]'),
    ];
    expect(again).toEqual(first);
    expect(await page.content()).toBe(htmlBefore);
    expect(problems).toEqual([]);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'viewer-js-disabled-desktop.png') });
    await context.close();
  });

  test('VWR-B JS 활성 브라우저에서도 Viewer 는 리스너/스타일 변경/스크립트가 전혀 없다', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const requests: { url: string; type: string }[] = [];
    page.on('request', (r) => requests.push({ url: r.url(), type: r.resourceType() }));
    // 페이지 코드가 실행되기 전에 감시를 심는다: 이벤트 리스너 등록, DOM/style 변경
    await page.addInitScript(() => {
      const w = window as any;
      w.__listeners = [];
      w.__mutations = [];
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (this: any, type: string, ...rest: any[]) {
        w.__listeners.push(type);
        return (add as any).call(this, type, ...rest);
      } as any;
      new MutationObserver((list) =>
        list.forEach((m) => w.__mutations.push(`${m.type}:${m.attributeName ?? ''}`)),
      ).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    });
    await page.route('http://viewer.test/**', (route) => {
      const isCss = route.request().url().endsWith('.css');
      return route.fulfill({ contentType: isCss ? 'text/css' : 'text/html', body: isCss ? CSS : PAGE });
    });
    await page.goto('http://viewer.test/v.html');
    await page.waitForLoadState('load');
    await page.setViewportSize({ width: 390, height: 844 }); // 크기 변경 후에도 JS 가 개입하지 않아야 한다
    await page.waitForTimeout(200);

    const info = await page.evaluate(() => ({
      listeners: (window as any).__listeners as string[],
      // 파서가 문서를 만드는 초기 변경은 제외하고, 로드 이후 속성 변경만 본다
      scripts: document.scripts.length,
      inlineStyleAttrs: document.querySelectorAll('[style]').length,
      handlerAttrs: Array.from(document.querySelectorAll('*')).filter((el) =>
        Array.from(el.attributes).some((a) => /^on/i.test(a.name)),
      ).length,
    }));
    expect(info).toEqual({ listeners: [], scripts: 0, inlineStyleAttrs: 0, handlerAttrs: 0 });
    const afterLoad = await page.evaluate(() =>
      (window as any).__mutations.filter((m: string) => m.startsWith('attributes')),
    );
    expect(afterLoad).toEqual([]); // 로드/리사이즈 후 속성(style 등) 변경이 없다
    expect(requests.map((r) => r.type).sort()).toEqual(['document', 'stylesheet']);
    expect(requests.some((r) => /\.(js|mjs)(\?|$)/.test(r.url))).toBe(false);
    await context.close();
  });

  test('VWR-C 위치/크기가 CSS 규칙(grid-column/row)으로 표현되고 계산 값이 레이아웃과 일치', async ({ browser }) => {
    for (const width of [1440, 768, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.route('http://viewer.test/**', (route) => {
        const isCss = route.request().url().endsWith('.css');
        return route.fulfill({ contentType: isCss ? 'text/css' : 'text/html', body: isCss ? CSS : PAGE });
      });
      await page.goto('http://viewer.test/v.html');
      const bp = matchBreakpoint(layout, width);
      const expected = resolveItems(layout, bp);
      for (const it of expected) {
        const g = await page.locator(`[data-drift-id="${it.id}"]`).evaluate((el) => {
          const s = getComputedStyle(el);
          return { cs: s.gridColumnStart, ce: s.gridColumnEnd, rs: s.gridRowStart, re: s.gridRowEnd };
        });
        expect({ width, id: it.id, ...g }).toEqual({
          width,
          id: it.id,
          cs: String(it.x + 1),
          ce: `span ${it.w}`,
          rs: String(it.y + 1),
          re: `span ${it.h}`,
        });
      }
      const cols = await page
        .locator('.ddr-viewer')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(cols).toBe(bp ? bp.columns : layout.columns);
      await context.close();
    }
  });

  test('VWR-D example/viewer.html 정적 산출물: 스크립트 없음, 편집 클래스 없음, JS 없이 표시', async ({ browser }) => {
    const dir = path.resolve(__dirname, '../example');
    const html = fs.readFileSync(path.join(dir, 'viewer.html'), 'utf8');
    const exampleCss = fs.readFileSync(path.join(dir, 'viewer.css'), 'utf8');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\sstyle=|\son[a-z]+=/i);
    expect(html + exampleCss).not.toMatch(/ddr-handle|ddr-resize|ddr-placeholder|ddr-editor/);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route('http://example.test/**', (route) => {
      const isCss = route.request().url().endsWith('.css');
      return route.fulfill({ contentType: isCss ? 'text/css' : 'text/html', body: isCss ? exampleCss : html });
    });
    await page.goto('http://example.test/viewer.html');
    const a = await box(page, '[data-drift-id="a"]');
    const c = await box(page, '[data-drift-id="c"]');
    // 기대 폭은 고정값이 아니라 example/layout.json(열 수, gap, 항목 a 의 w)과 실제 그리드 폭으로 계산한다
    // (샘플이 12열 → 24열로 바뀌어 예전 고정값 300px 이 맞지 않게 되었다)
    const layout = JSON.parse(fs.readFileSync(path.join(dir, 'layout.json'), 'utf8'));
    const itemA = layout.items.find((i: { id: string }) => i.id === 'a');
    const grid = await box(page, '.ddr-viewer');
    const gap = layout.gap ?? 8;
    expect(a.width).toBeCloseTo(((grid.width + gap) * itemA.w) / layout.columns - gap, 0);
    expect(c.x).toBeGreaterThan(a.x + a.width);
    await context.close();
  });
});

test.describe('[SHOT] 증거 스크린샷', () => {
  test('SHOT-01 Editor/Viewer 모바일 스크린샷 저장', async ({ browser, page }) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/uitest/editor.html');
    await page.waitForFunction(() => !!(window as any).editor);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'editor-desktop.png') });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
    const mobile = await context.newPage();
    await mobile.route('http://viewer.test/**', (route) => {
      const isCss = route.request().url().endsWith('.css');
      return route.fulfill({ contentType: isCss ? 'text/css' : 'text/html', body: isCss ? CSS : PAGE });
    });
    await mobile.goto('http://viewer.test/v.html');
    await mobile.screenshot({ path: path.join(SHOTS, 'viewer-js-disabled-mobile.png'), fullPage: true });
    await context.close();
    expect(fs.existsSync(path.join(SHOTS, 'editor-desktop.png'))).toBe(true);
  });
});
