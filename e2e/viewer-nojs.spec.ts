import { Browser, expect, test } from '@playwright/test';
import { createLayout, renderViewer, renderViewerPage } from '../src/viewer';
import { box, item } from './helpers';

const layout = createLayout({
  columns: 12,
  rowHeight: 40,
  gap: 8,
  items: [
    { id: 'a', x: 0, y: 0, w: 4, h: 3, content: 'A', props: { kind: 'chart' } },
    { id: 'b', x: 4, y: 0, w: 4, h: 3, content: 'B' },
    { id: 'c', x: 8, y: 0, w: 4, h: 3, content: 'C' },
    { id: 'd', x: 0, y: 3, w: 8, h: 3, content: 'D' },
    { id: 'e', x: 8, y: 3, w: 4, h: 3, content: 'E' },
  ],
});

const PAGE = renderViewerPage(layout, { cssHref: '/viewer.css' });
// body 여백 제거도 CSS 파일에 넣어 인라인 style 속성 없이 CSP 를 통과시킨다
const CSS = `body{margin:0}\n${renderViewer(layout).css}`;
/** JavaScript 가 실행되면 <html data-js="on"> 이 된다. 비활성 검증용 프로브 */
const PROBE = PAGE.replace('</body>', "<script>document.documentElement.dataset.js='on'</script></body>");

async function open(browser: Browser, width: number, javaScriptEnabled: boolean, probe = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled });
  const page = await context.newPage();
  const requests: { url: string; type: string }[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), type: r.resourceType() }));
  await page.route('http://viewer.test/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: CSS });
    return route.fulfill({ contentType: 'text/html', body: probe ? PROBE : PAGE });
  });
  await page.goto('http://viewer.test/index.html');
  return { context, page, requests };
}

test.describe('Viewer: JavaScript 비활성', () => {
  test('프로브: javaScriptEnabled=false 이면 스크립트가 실제로 실행되지 않는다', async ({ browser }) => {
    const off = await open(browser, 1280, false, true);
    expect(await off.page.getAttribute('html', 'data-js')).toBeNull();
    await off.context.close();

    const on = await open(browser, 1280, true, true);
    expect(await on.page.getAttribute('html', 'data-js')).toBe('on');
    await on.context.close();
  });

  test('데스크톱(12열): CSS 만으로 위치와 크기가 표현된다', async ({ browser }) => {
    const { context, page } = await open(browser, 1280, false);
    const cell = (1280 - 8 * 11) / 12;
    const stride = cell + 8;

    const a = await box(page, item('a'));
    expect(a.x).toBeCloseTo(0, 0);
    expect(a.width).toBeCloseTo(4 * cell + 3 * 8, 0);
    expect(a.height).toBeCloseTo(3 * 40 + 2 * 8, 0);

    const c = await box(page, item('c'));
    expect(c.x).toBeCloseTo(8 * stride, 0);
    const d = await box(page, item('d'));
    expect(d.y).toBeCloseTo(3 * 48, 0);
    expect(d.width).toBeCloseTo(8 * cell + 7 * 8, 0);
    await context.close();
  });

  test('태블릿(8열)/모바일(4열) 전환은 CSS 미디어 쿼리로 이루어진다', async ({ browser }) => {
    const tablet = await open(browser, 900, false);
    const cell8 = (900 - 8 * 7) / 8;
    const a = await box(tablet.page, item('a'));
    expect(a.width).toBeLessThan(900 / 2);
    const c = await box(tablet.page, item('c'));
    expect(c.x + c.width).toBeLessThanOrEqual(900 + 1);
    expect(cell8).toBeGreaterThan(0);
    await tablet.context.close();

    const mobile = await open(browser, 400, false);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    let prevBottom = -1;
    for (const id of ids) {
      const b = await box(mobile.page, item(id));
      expect(b.x).toBeCloseTo(0, 0);
      expect(b.width).toBeCloseTo(400, 0); // 화면 밖으로 나가지 않고 전폭
      expect(b.y).toBeGreaterThanOrEqual(prevBottom - 1); // 겹치지 않고 세로로 쌓인다
      prevBottom = b.y + b.height;
    }
    await mobile.context.close();
  });

  test('요청에 스크립트가 없고 HTML 에 편집 관련 요소/핸들러가 없다', async ({ browser }) => {
    const { context, page, requests } = await open(browser, 1280, false);
    expect(requests.filter((r) => r.type === 'script')).toEqual([]);
    expect(requests.map((r) => r.type).sort()).toEqual(['document', 'stylesheet']);

    const html = await page.content();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(await page.locator('.ddr-handle, .ddr-resize-handle, .ddr-placeholder, .ddr-editor').count()).toBe(0);
    await context.close();
  });

  test('CSP(script-src none) 환경에서도 레이아웃이 적용된다', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); // JS 활성 상태에서 CSP 로 차단
    const page = await context.newPage();
    const violations: string[] = [];
    page.on('console', (m) => m.type() === 'error' && violations.push(m.text()));
    await page.route('http://viewer.test/**', (route) => {
      const headers = { 'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'none'" };
      if (route.request().url().endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: CSS, headers });
      return route.fulfill({ contentType: 'text/html', body: PAGE, headers });
    });
    await page.goto('http://viewer.test/index.html');
    const c = await box(page, item('c'));
    expect(c.x).toBeGreaterThan(800);
    expect(violations.filter((v) => /Content Security Policy/.test(v))).toEqual([]);
    await context.close();
  });
});
