/* eslint-disable @typescript-eslint/no-explicit-any */
import { CDPSession, expect, Page, test } from '@playwright/test';

// 모바일(Pixel 5 에뮬레이션) 프로젝트에서만 실행된다 (playwright.config.ts: *touch.spec.ts)
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/sortable-manager.html');
  await page.waitForFunction(() => (window as any).ready === true);
});

const order = (page: Page, selector: string): Promise<string[]> =>
  page.$$eval(`${selector} > *`, (els) => els.map((e) => (e as HTMLElement).dataset.id || ''));

async function touch(page: Page, points: { x: number; y: number }[]) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await send('touchStart', points[0]);
  for (const p of points.slice(1)) await send('touchMove', p);
  await page.waitForTimeout(250); // FLIP 애니메이션 종료 대기
  await send('touchEnd');
  await cdp.detach();
}

const line = (from: { x: number; y: number }, to: { x: number; y: number }, steps = 14) =>
  Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  }));

test.describe('[SM-T] SortableManager 터치', () => {
  test('SM-T1 grip 을 터치로 끌어 todo 의 항목을 doing 으로 옮긴다', async ({ page }) => {
    const grip = (await page.locator('#todo [data-id="t1"] .grip').boundingBox())!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const target = (await page.locator('#doing [data-id="d1"]').boundingBox())!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const vh = page.viewportSize()!.height; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const to = { x: target.x + target.width / 2, y: target.y + target.height * 0.2 };
    expect(to.y).toBeLessThan(vh - 40); // 자동 스크롤 영역 밖의 화면 안 경로
    await touch(page, line({ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, to));
    expect(await order(page, '#todo')).toEqual(['t2', 't3']);
    expect(await order(page, '#doing')).toEqual(['t1', 'd1']);
    await expect(page.locator('#events')).toContainText('itemTransfer todo→doing t1 0→0 move user');
    await expect(page.locator('.dsr-drag, .dsr-ghost')).toHaveCount(0);
  });

  test('SM-T2 handle 이 있는 목록은 항목 본문 스와이프로 드래그되지 않는다 (페이지 스크롤에 맡김)', async ({
    page,
  }) => {
    const before = await page.evaluate(() => (window as any).sm.toJSON());
    const item = (await page.locator('#todo [data-id="t2"]').boundingBox())!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    // grip(왼쪽) 이 아닌 본문 오른쪽에서 시작한다
    const from = { x: item.x + item.width - 20, y: item.y + item.height / 2 };
    await touch(page, line(from, { x: from.x, y: from.y + 120 }, 8));
    expect(await page.evaluate(() => (window as any).sm.toJSON())).toBe(before);
    await expect(page.locator('.dsr-drag')).toHaveCount(0);
  });
});
