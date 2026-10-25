/* eslint-disable @typescript-eslint/no-explicit-any */
import { Browser, expect, Page, test } from '@playwright/test';
import {
  createLayout,
  getBreakpoints,
  matchBreakpoint,
  renderViewer,
  renderViewerPage,
  resolveItems,
} from '../src/viewer';
import { box } from './helpers';

/** 요구사항에 정의된 기본 검증 해상도 */
const SIZES = [
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 390, height: 844 },
  { name: 'Small Mobile', width: 320, height: 568 },
];

/** 크기/위치/콘텐츠 길이/반응형 명시값/빈 콘텐츠/최소 크기를 모두 포함한 검증용 레이아웃 */
const LONG = '긴 콘텐츠 '.repeat(400);
export const RICH = createLayout({
  columns: 12,
  rowHeight: 40,
  gap: 8,
  items: [
    { id: 'hero', x: 0, y: 0, w: 12, h: 2, title: 'Hero', content: 'Welcome', props: { kind: 'banner' } },
    { id: 'chart', x: 0, y: 2, w: 8, h: 4, title: '차트', content: LONG, props: { kind: 'chart', dataSrc: '/api/a' } },
    { id: 'side', x: 8, y: 2, w: 4, h: 2, content: 'Side' },
    { id: 'kpi', x: 8, y: 4, w: 2, h: 2, content: '' },
    { id: 'tiny', x: 10, y: 4, w: 1, h: 1, content: 'x' },
    { id: 'wide', x: 0, y: 6, w: 6, h: 3, content: 'Wide', responsive: { mobile: { x: 0, y: 0, w: 4, h: 2 } } },
    { id: 'tail', x: 6, y: 6, w: 6, h: 3, content: 'Tail' },
  ],
});

const CSS = `body{margin:0}\n${renderViewer(RICH).css}`;
const HTML = renderViewerPage(RICH, { cssHref: '/viewer.css' });

async function openViewer(browser: Browser, width: number, height: number, javaScriptEnabled = false) {
  const context = await browser.newContext({ viewport: { width, height }, javaScriptEnabled });
  const page = await context.newPage();
  const failures: string[] = [];
  page.on('requestfailed', (r) => failures.push(`requestfailed ${r.url()}`));
  page.on('response', (r) => r.status() >= 400 && failures.push(`HTTP ${r.status()} ${r.url()}`));
  await page.route('http://viewer.test/**', (route) => {
    const body = route.request().url().endsWith('.css') ? CSS : HTML;
    return route.fulfill({ contentType: route.request().url().endsWith('.css') ? 'text/css' : 'text/html', body });
  });
  await page.goto('http://viewer.test/index.html');
  return { context, page, failures };
}

const ids = RICH.items.map((i) => i.id);

async function boxes(page: Page) {
  const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const id of ids) out[id] = await box(page, `[data-drift-id="${id}"]`);
  return out;
}

const intersects = (a: any, b: any) =>
  a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5 && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5;

/** 해당 폭에서 CSS 가 계산해야 하는 이론적 픽셀 좌표 */
function expectedRects(width: number) {
  const bp = matchBreakpoint(RICH, width);
  const cols = bp ? bp.columns : RICH.columns;
  const cell = (width - RICH.gap * (cols - 1)) / cols;
  const resolved = resolveItems(RICH, bp);
  return Object.fromEntries(
    resolved.map((i) => [
      i.id,
      {
        x: i.x * (cell + RICH.gap),
        y: i.y * (RICH.rowHeight + RICH.gap),
        width: i.w * cell + (i.w - 1) * RICH.gap,
        height: i.h * RICH.rowHeight + (i.h - 1) * RICH.gap,
      },
    ]),
  );
}

test.describe('[RSP] Viewer 반응형 (JavaScript 비활성)', () => {
  for (const s of SIZES) {
    test(`RSP-${s.name}: ${s.width}x${s.height} 에서 겹침/잘림/가로 스크롤 없이 계산된 좌표와 일치`, async ({
      browser,
    }) => {
      const { context, page, failures } = await openViewer(browser, s.width, s.height, false);
      const got = await boxes(page);
      const exp = expectedRects(s.width);
      const bp = matchBreakpoint(RICH, s.width);

      for (const id of ids) {
        const g = got[id];
        const e = exp[id];
        // 계산된 좌표와 실제 렌더링 결과 일치 (소수점 오차 1px)
        expect({ id, x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.width), h: Math.round(g.height) }).toEqual(
          {
            id,
            x: Math.round(e.x),
            y: Math.round(e.y),
            w: Math.round(e.width),
            h: Math.round(e.height),
          },
        );
        // 화면 밖으로 잘리지 않는다 (가로 스크롤 원인 제거)
        expect(g.x).toBeGreaterThanOrEqual(-0.5);
        expect(g.x + g.width).toBeLessThanOrEqual(s.width + 0.5);
      }
      // 서로 겹치지 않는다
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++)
          expect({ pair: [ids[i], ids[j]], hit: intersects(got[ids[i]], got[ids[j]]) }).toEqual({
            pair: [ids[i], ids[j]],
            hit: false,
          });
      }
      // 읽을 수 있는 최소 너비 (텍스트가 있는 항목)
      if (bp && bp.columns <= 4)
        for (const id of ['hero', 'chart', 'side']) expect(got[id].width).toBeGreaterThan(s.width * 0.9);
      expect(failures).toEqual([]);
      await context.close();
    });
  }

  test('RSP-SCROLL: JS 활성 상태에서 4개 해상도 모두 가로 스크롤(scrollWidth > clientWidth)이 없다', async ({
    browser,
  }) => {
    for (const s of SIZES) {
      const { context, page } = await openViewer(browser, s.width, s.height, true);
      const r = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect({ size: s.name, overflow: r.sw > r.cw }).toEqual({ size: s.name, overflow: false });
      await context.close();
    }
  });

  test('RSP-LIVE: 같은 문서에서 창 크기를 바꾸면 CSS 만으로 컬럼이 전환된다(JS 없음)', async ({ browser }) => {
    const { context, page } = await openViewer(browser, 1440, 900, false);
    const w1 = (await box(page, '[data-drift-id="side"]')).width;
    await page.setViewportSize({ width: 390, height: 844 });
    const w2 = (await box(page, '[data-drift-id="side"]')).width;
    await page.setViewportSize({ width: 1440, height: 900 });
    const w3 = (await box(page, '[data-drift-id="side"]')).width;
    expect(w2).toBeGreaterThan(380); // 모바일: 전폭
    expect(w1).toBeLessThan(600);
    expect(Math.round(w3)).toBe(Math.round(w1));
    await context.close();
  });

  test('RSP-CONTENT: 긴 콘텐츠는 항목 안에서 스크롤되고 인접 항목을 침범하지 않으며 빈/최소 콘텐츠도 표시된다', async ({
    browser,
  }) => {
    const { context, page } = await openViewer(browser, 1440, 900, true);
    const r = await page.evaluate(() => {
      const el = document.querySelector('[data-drift-id="chart"]') as HTMLElement;
      return { overflowY: getComputedStyle(el).overflowY, scrolls: el.scrollHeight > el.clientHeight };
    });
    expect(r).toEqual({ overflowY: 'auto', scrolls: true });
    const got = await boxes(page);
    expect(intersects(got.chart, got.side)).toBe(false);
    expect(got.kpi.width).toBeGreaterThan(0);
    expect(got.tiny.width).toBeGreaterThan(0);
    await context.close();
  });
});

test.describe('[CMP] Editor ↔ Viewer 동일 데이터 비교', () => {
  /** Editor 를 컨테이너 폭 width 로 만들고 breakpoint 를 지정해 각 항목의 상대 좌표를 얻는다 */
  async function editorRects(page: Page, width: number, bp: string | null) {
    await page.goto('/uitest/api.html');
    await page.waitForFunction(() => (window as any).__ready === true);
    return page.evaluate(
      ([layout, w, name]) => {
        const host = document.getElementById('host') as HTMLElement;
        host.style.width = `${w}px`;
        const ed = (window as any).Drift.createDriftEditor(host, { layout, animate: false });
        ed.setBreakpoint(name);
        const canvas = host.querySelector('.daracl-drift') as HTMLElement;
        const c = canvas.getBoundingClientRect();
        const out: any = {};
        host.querySelectorAll('.ddr-item').forEach((el) => {
          const r = el.getBoundingClientRect();
          out[(el as HTMLElement).dataset.driftId as string] = {
            x: r.left - c.left,
            y: r.top - c.top,
            width: r.width,
            height: r.height,
            text: (el.querySelector('.ddr-content') as HTMLElement).textContent,
            title: (el.querySelector('.ddr-title') as HTMLElement).textContent,
          };
        });
        return { out, layout: ed.getLayout(), count: host.querySelectorAll('.ddr-item').length };
      },
      [RICH, width, bp] as const,
    );
  }

  for (const c of [
    { name: 'base(1440)', width: 1440, bp: null as string | null },
    { name: 'tablet(768)', width: 768, bp: 'tablet' },
    { name: 'mobile(390)', width: 390, bp: 'mobile' },
    { name: 'small(320)', width: 320, bp: 'mobile' },
  ]) {
    test(`CMP-${c.name}: 개수/ID/위치/크기/콘텐츠/속성이 일치`, async ({ browser, page }) => {
      const e = await editorRects(page, c.width, c.bp);
      const { context, page: vp } = await openViewer(browser, c.width, 900, false);
      const v = await boxes(vp);

      expect(e.count).toBe(RICH.items.length);
      expect(await vp.locator('.ddr-item').count()).toBe(RICH.items.length);
      for (const it of RICH.items) {
        expect(Math.round(v[it.id].x)).toBe(Math.round(e.out[it.id].x));
        expect(Math.round(v[it.id].y)).toBe(Math.round(e.out[it.id].y));
        expect(Math.round(v[it.id].width)).toBe(Math.round(e.out[it.id].width));
        expect(Math.round(v[it.id].height)).toBe(Math.round(e.out[it.id].height));
        // 콘텐츠: Viewer 는 title 영역을 제외한 텍스트가 같아야 한다
        const vText = await vp.locator(`[data-drift-id="${it.id}"]`).evaluate((el) => {
          const clone = el.cloneNode(true) as HTMLElement;
          clone.querySelector('.ddr-title')?.remove();
          return clone.textContent;
        });
        expect(vText).toBe(it.content ?? '');
        if (it.title) expect(await vp.locator(`[data-drift-id="${it.id}"] .ddr-title`).textContent()).toBe(it.title);
        // 사용자 정의 속성: data-*
        for (const [k, val] of Object.entries(it.props || {})) {
          const attr = `data-${k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
          expect(await vp.locator(`[data-drift-id="${it.id}"]`).getAttribute(attr)).toBe(String(val));
        }
      }
      // Editor 가 내보낸 JSON 이 Viewer 입력으로 그대로 사용 가능
      expect(renderViewer(e.layout).html).toBe(renderViewer(RICH).html);
      expect(getBreakpoints(RICH).length).toBe(2);
      await context.close();
    });
  }
});
