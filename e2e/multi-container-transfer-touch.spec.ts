/* eslint-disable @typescript-eslint/no-explicit-any */
import { CDPSession, expect, Page, test } from '@playwright/test';
import { box, Box } from './helpers';

// 모바일(Pixel 5 에뮬레이션) 프로젝트에서만 실행된다 (playwright.config.ts: *touch.spec.ts)
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/multi-container.html?cross=1');
  await page.waitForFunction(() => (window as any).ready === true);
  // header 와 body 가 한 화면에 들어오게 header 를 맨 위로
  await page.locator('#c-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
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

const line = (from: { x: number; y: number }, to: { x: number; y: number }, steps = 14) =>
  Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  }));

const ids = (page: Page, cid: string) =>
  page.evaluate(
    (c) =>
      (window as any).manager
        .get(c)
        .getItems()
        .map((i: any) => i.id)
        .sort(),
    cid,
  );

test.describe('[MCT-T] 컨테이너 간 이동 (터치)', () => {
  test('MCT-T1 핸들을 터치로 끌어 header 의 title 을 body 로 옮기면 실제 위치·크기가 body 셀 기준이다', async ({
    page,
  }) => {
    const handle = await box(page, '#c-header [data-drift-id="title"] .ddr-handle');
    const canvas = await box(page, '#c-body .daracl-drift');
    const m = await page.evaluate(() => (window as any).manager.get('body').getMetrics());
    // 핸들 막대의 가운데를 잡는다 (터치 기기에서는 리사이즈 핸들이 28px 로 커져 양 끝을 덮는다)
    const grabX = handle.width / 2;
    const from = { x: handle.x + grabX, y: handle.y + handle.height / 2 };
    // body 의 (0, 6) 칸 근처: 잡은 지점을 기준으로 항목 좌상단이 그 칸에 오게 한다
    const to = { x: canvas.x + grabX + 4, y: canvas.y + 6 * (m.rowHeight + m.gap) + handle.height / 2 + 4 };
    expect(to.y).toBeLessThan(page.viewportSize()!.height - 50); // 화면 안의 유효한 경로
    await touch(page, line(from, to));

    expect(await ids(page, 'header')).toEqual(['logo']);
    expect(await ids(page, 'body')).toEqual(['chart', 'logo', 'table', 'title']);
    const it = await page.evaluate(() => (window as any).manager.get('body').getItem('title'));
    expect(it.w).toBe(6); // 9칸 → body 6열로 정규화
    await expect
      .poll(async () => {
        const c = await box(page, '#c-body .daracl-drift');
        const b = (await page.locator('#c-body [data-drift-id="title"]').boundingBox()) as Box;
        return [
          Math.round((b.x - c.x) / (m.cellWidth + m.gap)),
          Math.round((b.y - c.y) / (m.rowHeight + m.gap)),
          Math.round((b.width + m.gap) / (m.cellWidth + m.gap)),
        ];
      })
      .toEqual([it.x, it.y, 6]);
    await expect(page.locator('.ddr-transfer-ghost')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).manager.getActiveId())).toBe('body');
  });

  test('MCT-T2 이동이 켜져 있어도 카드 본문 스와이프는 드래그가 아니라 페이지 스크롤이다', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => (window as any).manager.toJSON());
    const content = await box(page, '#c-body [data-drift-id="chart"] .ddr-content');
    const start = { x: content.x + content.width / 2, y: content.y + 10 };
    await touch(page, line(start, { x: start.x, y: start.y - 150 }, 10));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).manager.toJSON())).toBe(before);
    await expect(page.locator('.ddr-transfer-ghost')).toHaveCount(0);
  });
});
