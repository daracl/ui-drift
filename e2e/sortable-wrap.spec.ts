import { expect, Page, test } from '@playwright/test';

const order = (page: Page, selector: string): Promise<string[]> =>
  page.$$eval(`${selector} > *`, (els) => els.map((e) => (e as HTMLElement).dataset.id || ''));

/** w4 를 잡고 (dx, dy) 만큼 움직인 뒤 놓을 때까지의 순서 변화를 기록한다 */
async function moveW4(page: Page, dx: number, dy: number) {
  const b = await page.locator('#wrap [data-id="w4"]').boundingBox();
  if (!b) throw new Error('w4 를 찾을 수 없습니다');
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 2, cy - 2, { steps: 2 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await page.waitForTimeout(250);
  const during = await order(page, '#wrap');
  await page.mouse.up();
  return during;
}

test.describe('Sortable flex-wrap: 같은 줄의 항목을 위로 살짝 올려도 순서가 바뀌지 않는다', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uitest/sortable.html');
    await page.waitForFunction(() => !!(window as unknown as { lists?: unknown }).lists);
  });

  const original = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'];

  for (const dy of [-6, -12, -20, -40]) {
    test(`4번을 위로 ${-dy}px 올려도 1번 자리로 가지 않는다`, async ({ page }) => {
      const during = await moveW4(page, 0, dy);
      expect(during).toEqual(original);
      expect(await order(page, '#wrap')).toEqual(original);
    });
  }

  test('같은 줄에서 옆 항목 위로 가면 그 자리로 바뀐다 (정상 동작은 유지)', async ({ page }) => {
    const w2 = await page.locator('#wrap [data-id="w2"]').boundingBox();
    const w4 = await page.locator('#wrap [data-id="w4"]').boundingBox();
    if (!w2 || !w4) throw new Error('항목을 찾을 수 없습니다');
    await moveW4(page, w2.x + w2.width * 0.3 - (w4.x + w4.width / 2), 0);
    expect(await order(page, '#wrap')).toEqual(['w1', 'w4', 'w2', 'w3', 'w5', 'w6', 'w7', 'w8']);
  });

  test('맨 위 줄 위쪽 여백까지 끌어올려도 줄 안에서 이웃 항목을 지나지 않으면 바뀌지 않는다', async ({ page }) => {
    const wrap = await page.locator('#wrap').boundingBox();
    const w4 = await page.locator('#wrap [data-id="w4"]').boundingBox();
    if (!wrap || !w4) throw new Error('요소를 찾을 수 없습니다');
    const during = await moveW4(page, 0, wrap.y + 2 - (w4.y + w4.height / 2));
    expect(during).toEqual(original);
  });
});
