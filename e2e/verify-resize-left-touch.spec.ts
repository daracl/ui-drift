/* eslint-disable @typescript-eslint/no-explicit-any */
import { CDPSession, expect, Page, test } from '@playwright/test';
import { box, getItem, hasOverlap } from './helpers';

// 모바일(Pixel 5 에뮬레이션) 프로젝트에서만 실행된다 (playwright.config.ts)
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/editor.html');
  await page.waitForFunction(() => !!(window as any).editor);
  await page.selectOption('#bp', 'mobile'); // 4열 breakpoint 에서 편집
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
const line = (a: { x: number; y: number }, b: { x: number; y: number }, n = 12) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));

test.describe('[RSL] 모바일 터치: 왼쪽 리사이즈', () => {
  test('RSL-T1 터치로 좌하단 핸들을 끌어 높이를 바꾸고 폭이 4열 안에서 유지된다', async ({ page }) => {
    // 4열 적층에서는 이미 전폭(x=0,w=4)이므로 먼저 폭을 줄여 왼쪽 여유를 만든다 (API)
    await page.evaluate(() => (window as any).editor.resizeItem('a', 2, 3));
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => (window as any).editor.getMetrics());
    const before = await getItem(page, 'a');
    expect(before).toMatchObject({ x: 0, w: 2 });

    const g = await box(page, '[data-drift-id="a"] .ddr-resize-handle[data-dir="sw"]');
    const start = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    // 오른쪽으로 한 칸 끌어 폭 줄이기 + 아래로 두 행 끌어 높이 늘리기 (오른쪽 가장자리는 고정)
    await touch(page, line(start, { x: start.x + (m.cellWidth + m.gap), y: start.y + 2 * (m.rowHeight + m.gap) }));
    await page.waitForTimeout(300);

    const after = await getItem(page, 'a');
    expect(after.x + after.w).toBe(before.x + before.w);
    expect(after.w).toBe(1);
    expect(after.h).toBe(5);
    expect(await hasOverlap(page)).toBe(false);
    // 해당 breakpoint 에만 저장
    const layout = await page.evaluate(() => (window as any).editor.getLayout());
    const stored = layout.items.find((i: any) => i.id === 'a');
    expect(stored.responsive.mobile).toMatchObject({ x: 1, w: 1, h: 5 });
    expect(stored).toMatchObject({ x: 0, w: 4 });
  });

  test('RSL-T2 터치 영역이 44px 이상이고 touch-action: none 이다', async ({ page }) => {
    const r = await page.locator('[data-drift-id="a"] .ddr-resize-handle[data-dir="sw"]').evaluate((el: Element) => {
      const after = getComputedStyle(el, '::after');
      return {
        w: parseFloat(after.width),
        h: parseFloat(after.height),
        left: after.left,
        ta: getComputedStyle(el).touchAction,
      };
    });
    expect(r.w).toBeGreaterThanOrEqual(44);
    expect(r.h).toBeGreaterThanOrEqual(44);
    expect(r.left).toBe('0px'); // 확장 영역도 왼쪽 모서리 기준
    expect(r.ta).toBe('none');
  });
});
