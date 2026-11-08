/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, Page, test } from '@playwright/test';

const order = (page: Page, selector: string): Promise<string[]> =>
  page.$$eval(`${selector} > *`, (els) => els.map((e) => (e as HTMLElement).dataset.id || ''));

async function boxOf(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`요소를 찾을 수 없습니다: ${selector}`);
  return b;
}

/** from 요소를 잡아 to 요소의 (rx, ry) 비율 위치로 끌어 놓는다 */
async function dragTo(page: Page, from: string, to: string, rx = 0.5, ry = 0.75) {
  const a = await boxOf(page, from);
  const b = await boxOf(page, to);
  const sx = a.x + a.width / 2;
  const sy = a.y + a.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 6, sy + 6, { steps: 2 });
  await page.mouse.move(b.x + b.width * rx, b.y + b.height * ry, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.up();
}

/** 드래그가 끝난 뒤 남으면 안 되는 상태 */
async function expectClean(page: Page) {
  await expect(page.locator('.dsr-drag, .dsr-ghost, .dsr-chosen')).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      dragging: document.documentElement.classList.contains('dsr-dragging'),
      active: (window as any).SortableStatic.isDragging(),
      anchors: Array.from(document.querySelectorAll<HTMLElement>('body, body *')).filter(
        (el) => el.style.overflowAnchor === 'none',
      ).length,
    })),
  ).toEqual({ dragging: false, active: false, anchors: 0 });
}

test.describe('[SS] Sortable 콜백 안전성 / 호환되지 않는 항목', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uitest/sortable-safety.html');
    await page.waitForFunction(() => (window as any).ready === true);
  });

  for (const action of ['cancel', 'destroy'] as const) {
    test(`SS-01 onMove 에서 ${action}() 하면 같은 목록·다른 목록 모두 순서가 바뀌지 않고 정리된다`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.selectOption('#action', action);
      await dragTo(page, '#s1 [data-id="a"]', '#s1 [data-id="b"]');
      expect(await order(page, '#s1')).toEqual(['a', 'b', 'c']);
      await expectClean(page);
      if (action === 'destroy') await page.click('#recreate');
      await dragTo(page, '#s1 [data-id="a"]', '#s2 [data-id="d"]', 0.5, 0.25);
      expect(await order(page, '#s1')).toEqual(['a', 'b', 'c']);
      expect(await order(page, '#s2')).toEqual(['d', 'e']);
      await expectClean(page);
      await expect(page.locator('#log')).not.toContainText('itemTransfer');
      await expect(page.locator('#log')).not.toContainText('sort');

      // 다시 정상 드래그가 된다 (destroy 였다면 다시 등록한 뒤)
      await page.selectOption('#action', 'none');
      if (action === 'destroy') await page.click('#recreate');
      await dragTo(page, '#s1 [data-id="a"]', '#s1 [data-id="b"]');
      expect(await order(page, '#s1')).toEqual(['b', 'a', 'c']);
      await expectClean(page);
      expect(errors).toEqual([]);
    });
  }

  test('SS-02 onMove 에서 도착 목록을 unregister 하면 도착 목록에 들어가지 않고, 다시 등록하면 이동된다', async ({
    page,
  }) => {
    await page.selectOption('#action', 'unregister-target');
    await dragTo(page, '#s1 [data-id="a"]', '#s2 [data-id="d"]', 0.5, 0.25);
    expect(await order(page, '#s2')).toEqual(['d', 'e']);
    expect(await order(page, '#s1')).toEqual(['a', 'b', 'c']);
    expect(await page.evaluate(() => (window as any).m1.getIds())).toEqual(['s1']);
    await expectClean(page);
    await page.selectOption('#action', 'none');
    await page.click('#recreate');
    await dragTo(page, '#s1 [data-id="a"]', '#s2 [data-id="d"]', 0.5, 0.25);
    expect(await order(page, '#s2')).toEqual(['a', 'd', 'e']);
    await expect(page.locator('#log')).toContainText('itemTransfer s1→s2');
  });

  test('SS-03 draggable 이 다른 목록으로의 API 이동은 incompatible-item, 준비 후에는 이동된다', async ({ page }) => {
    await page.click('#apiAB');
    await expect(page.locator('#status2')).toHaveText('거절: incompatible-item');
    expect(await order(page, '#la')).toEqual(['x', 'x2']);
    expect(await order(page, '#lb')).toEqual(['y']);
    expect(await page.evaluate(() => (window as any).m2.getOrders().containers)).toEqual([
      { id: 'a', order: ['x', 'x2'] },
      { id: 'b', order: ['y'] },
    ]);
    await page.click('#makeB');
    await page.click('#apiAB');
    await expect(page.locator('#status2')).toHaveText('이동 (newIndex 1)');
    expect(await page.evaluate(() => (window as any).m2.get('b').toArray())).toEqual(['y', 'x']);
  });

  test('SS-04 draggable 이 맞지 않는 목록으로는 마우스로도 들어가지 않는다. :scope·부모 문맥 selector 는 도착 문맥으로 판정한다', async ({
    page,
  }) => {
    await dragTo(page, '#la [data-id="x"]', '#lb [data-id="y"]', 0.5, 0.25);
    expect(await order(page, '#lb')).toEqual(['y']);
    expect(await order(page, '#la')).toEqual(['x', 'x2']);
    await expectClean(page);

    // 실제 브라우저의 :scope / 부모 문맥 selector
    const result = await page.evaluate(() => {
      const { m2 } = window as any;
      m2.get('b').option('draggable', ':scope.b, #lb > li');
      const r = m2.transferItem({ from: 'a', to: 'b', itemId: 'x2', index: 0 });
      return { moved: r.moved, newIndex: r.newIndex, order: m2.get('b').toArray() };
    });
    expect(result).toEqual({ moved: true, newIndex: 0, order: ['x2', 'y'] });
  });
});
