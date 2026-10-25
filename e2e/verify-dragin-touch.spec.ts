/* eslint-disable @typescript-eslint/no-explicit-any */
import { CDPSession, expect, Page, test } from '@playwright/test';
import { box, hasOverlap } from './helpers';

// 모바일(Pixel 5 에뮬레이션) 프로젝트에서만 실행된다 (playwright.config.ts)
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/editor.html');
  await page.waitForFunction(() => !!(window as any).editor);
  await page.selectOption('#bp', 'auto'); // 모바일 폭(4열)에서 편집
  await page.waitForTimeout(400);
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

test.describe('[DIN] 모바일 터치로 외부 요소를 끌어서 추가', () => {
  test('DIN-T1 터치로 팔레트 항목을 캔버스에 놓으면 해당 breakpoint(4열)의 칸에 추가된다', async ({ page }) => {
    // 팔레트는 캔버스 위에 있으므로, 캔버스가 화면에 보이도록 스크롤을 맨 위에 둔다
    await page.evaluate(() => window.scrollTo(0, 0));
    const src = await box(page, '.pal >> nth=2'); // Small 2x2
    const canvas = await box(page, '.daracl-drift');
    const before = await page.evaluate(() => (window as any).editor.getLayout().items.length);
    const target = { x: canvas.x + canvas.width / 2, y: Math.min(canvas.y + 80, 700) };

    await touch(page, line({ x: src.x + 10, y: src.y + 10 }, target));
    await page.waitForTimeout(300);

    const layout = await page.evaluate(() => (window as any).editor.getLayout());
    expect(layout.items).toHaveLength(before + 1);
    const added = layout.items[layout.items.length - 1];
    expect(added.responsive?.mobile).toBeTruthy(); // 4열 breakpoint 의 칸으로 저장
    expect(await hasOverlap(page)).toBe(false);
    await expect(page.locator(`[data-drift-id="${added.id}"]`)).toBeVisible();
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
  });

  test('DIN-T2 캔버스 밖(위쪽)에서 놓으면 추가되지 않는다', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const src = await box(page, '.pal >> nth=0');
    const before = await page.evaluate(() => (window as any).editor.getLayout());
    await touch(page, line({ x: src.x + 10, y: src.y + 10 }, { x: src.x + 150, y: 10 }));
    expect(await page.evaluate(() => (window as any).editor.getLayout())).toEqual(before);
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
  });

  test('DIN-T3 팔레트 항목은 touch-action: none 이라 터치로 스크롤되지 않고 드래그된다', async ({ page }) => {
    const ta = await page
      .locator('.pal')
      .first()
      .evaluate((el) => getComputedStyle(el).touchAction);
    expect(ta).toBe('none');
    await page.evaluate(() => window.scrollTo(0, 0));
    const src = await box(page, '.pal >> nth=0');
    const canvas = await box(page, '.daracl-drift');
    await touch(page, line({ x: src.x + 10, y: src.y + 10 }, { x: canvas.x + 100, y: canvas.y + 100 }));
    expect(await page.evaluate(() => window.scrollY)).toBe(0); // 페이지가 스크롤되지 않았다
  });
});
