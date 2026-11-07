/* eslint-disable @typescript-eslint/no-explicit-any */
import { CDPSession, expect, Page, test } from '@playwright/test';
import { box } from './helpers';

// 모바일(Pixel 5 에뮬레이션) 프로젝트에서만 실행된다 (playwright.config.ts)
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/multi-container.html');
  await page.waitForFunction(() => (window as any).ready === true);
});

async function touch(page: Page, points: { x: number; y: number }[]) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await send('touchStart', points[0]);
  for (const p of points.slice(1)) await send('touchMove', p);
  await send('touchEnd');
  await cdp.detach();
}

const line = (from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) =>
  Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  }));

const items = (page: Page, cid: string) =>
  page.evaluate((c) => (window as any).manager.get(c).getItems() as any[], cid);

test.describe('[MC-T] 여러 컨테이너 터치', () => {
  test('MC-T1 터치로 공통 팔레트 항목을 두 번째 컨테이너에 놓으면 그 컨테이너에만 추가된다', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const src = await box(page, '.pal >> nth=2'); // Small 2x1
    const header = await box(page, '#c-header .daracl-drift');
    const before = await page.evaluate(() =>
      (window as any).manager.getAll().map(({ editor }: any) => editor.getItems().length),
    );
    const target = { x: header.x + header.width / 2, y: header.y + 10 };
    await touch(page, line({ x: src.x + 10, y: src.y + 10 }, target));

    const after = await page.evaluate(() =>
      (window as any).manager.getAll().map(({ editor }: any) => editor.getItems().length),
    );
    expect(after).toEqual([before[0] + 1, before[1], before[2]]);
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).manager.getActiveId())).toBe('header');
  });

  test('MC-T2 터치로 핸들을 끌어 컨테이너 안의 항목을 옮긴다 (다른 컨테이너는 그대로)', async ({ page }) => {
    const footerBefore = await items(page, 'footer');
    const handle = await box(page, '#c-header [data-drift-id="logo"] .ddr-handle');
    const m = await page.evaluate(() => (window as any).manager.get('header').getMetrics());
    const from = { x: handle.x + 6, y: handle.y + handle.height / 2 };
    // logo(3칸)를 오른쪽으로 3칸 끈다. 오른쪽 title 과 겹치는 칸은 기존 단일 에디터의 50% 판정 규칙을 따르므로 정확한 칸 대신 이동 여부를 본다
    const to = { x: from.x + 3 * (m.cellWidth + m.gap), y: from.y };
    await touch(page, line(from, to));
    await expect.poll(async () => (await items(page, 'header')).find((i: any) => i.id === 'logo').x).toBeGreaterThan(0);
    // 모델뿐 아니라 애니메이션이 끝난 실제 DOM 위치·크기도 확인한다.
    await expect
      .poll(async () => {
        const item = (await items(page, 'header')).find((i: any) => i.id === 'logo');
        const canvas = await box(page, '#c-header .daracl-drift');
        const actual = await box(page, '#c-header [data-drift-id="logo"]');
        return Math.max(
          Math.abs(actual.x - canvas.x - item.x * (m.cellWidth + m.gap)),
          Math.abs(actual.y - canvas.y - item.y * (m.rowHeight + m.gap)),
          Math.abs(actual.width - (item.w * (m.cellWidth + m.gap) - m.gap)),
          Math.abs(actual.height - (item.h * (m.rowHeight + m.gap) - m.gap)),
        );
      })
      .toBeLessThan(1);
    expect(await items(page, 'footer')).toEqual(footerBefore);
  });
});
