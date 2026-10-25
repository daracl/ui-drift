/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, Page, test } from '@playwright/test';
import { box, getItem, hasOverlap } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/editor.html');
  await page.waitForFunction(() => !!(window as any).editor);
});

const card = (id: string) => `[data-drift-id="${id}"]`;
const select = (page: Page, id: string) => page.locator(`${card(id)} .ddr-content`).click();
const layoutItem = (page: Page, id: string) =>
  page.evaluate((i) => (window as any).editor.getLayout().items.find((x: any) => x.id === i), id);

/** 핸들을 잡아 (dx, dy) 픽셀만큼 끈다 */
async function dragHandle(page: Page, id: string, dx: number, dy: number) {
  const h = await box(page, `${card(id)} .ddr-handle`);
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 30 + dx, h.y + h.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('[OPT] 예제: 선택한 항목의 locked / resizable 옵션', () => {
  test('OPT-01 선택 전에는 비활성이고, 선택하면 항목 정보와 현재 값이 표시된다', async ({ page }) => {
    await expect(page.locator('#optName')).toHaveText('항목을 선택하세요');
    await expect(page.locator('#optLocked')).toBeDisabled();
    await expect(page.locator('#optResizable')).toBeDisabled();

    await select(page, 'a');
    await expect(page.locator('#optName')).toHaveText('선택: a (test1)');
    await expect(page.locator('#optLocked')).toBeEnabled();
    await expect(page.locator('#optResizable')).toBeEnabled();
    await expect(page.locator('#optLocked')).not.toBeChecked();
    await expect(page.locator('#optResizable')).toBeChecked();
  });

  test('OPT-02 locked 를 체크하면 즉시 적용된다: 이동/리사이즈 불가, 선택 유지, JSON 반영', async ({ page }) => {
    await select(page, 'a');
    const before = await getItem(page, 'a');
    await page.check('#optLocked');

    await expect(page.locator(card('a'))).toHaveClass(/ddr-locked/);
    await expect(page.locator(card('a'))).toHaveClass(/ddr-selected/); // 옵션을 눌러도 선택은 유지된다
    expect((await layoutItem(page, 'a')).locked).toBe(true);
    // 리사이즈 핸들이 사라진다
    for (const dir of ['se', 'sw']) {
      expect(
        await page
          .locator(`${card('a')} .ddr-resize-handle[data-dir="${dir}"]`)
          .evaluate((el: Element) => getComputedStyle(el).display),
      ).toBe('none');
    }
    // 드래그해도 움직이지 않는다
    await dragHandle(page, 'a', 300, 150);
    expect(await getItem(page, 'a')).toMatchObject({ x: before.x, y: before.y, w: before.w, h: before.h });
    // locked 이면 resizable 옵션은 흐리게 표시된다
    await expect(page.locator('#lblResizable')).toHaveClass(/off/);

    await page.click('#export');
    expect(JSON.parse(await page.inputValue('#json')).items.find((i: any) => i.id === 'a').locked).toBe(true);
  });

  test('OPT-03 locked 를 해제하면 다시 이동/리사이즈할 수 있고 JSON 에서 속성이 사라진다', async ({ page }) => {
    await select(page, 'a');
    await page.check('#optLocked');
    await page.uncheck('#optLocked');
    await expect(page.locator(card('a'))).not.toHaveClass(/ddr-locked/);
    expect(await layoutItem(page, 'a')).not.toHaveProperty('locked', true);
    await page.click('#export');
    expect(JSON.parse(await page.inputValue('#json')).items.find((i: any) => i.id === 'a')).not.toHaveProperty(
      'locked',
    );

    const m = await page.evaluate(() => (window as any).editor.getMetrics());
    const before = await getItem(page, 'a');
    await dragHandle(page, 'a', 2 * (m.cellWidth + m.gap), 0);
    expect((await getItem(page, 'a')).x).toBeGreaterThan(before.x);
  });

  test('OPT-04 resizable 을 해제하면 크기만 고정되고 이동은 가능하다', async ({ page }) => {
    await select(page, 'b');
    await page.uncheck('#optResizable');

    await expect(page.locator(card('b'))).toHaveClass(/ddr-no-resize/);
    await expect(page.locator(card('b'))).not.toHaveClass(/ddr-locked/);
    expect((await layoutItem(page, 'b')).resizable).toBe(false);
    for (const dir of ['se', 'sw']) {
      expect(
        await page
          .locator(`${card('b')} .ddr-resize-handle[data-dir="${dir}"]`)
          .evaluate((el: Element) => getComputedStyle(el).display),
      ).toBe('none');
    }
    // 크기 변경 시도는 거부된다 (API 도 동일)
    const size = await getItem(page, 'b');
    await page.evaluate(() => (window as any).editor.resizeItem('b', 9, 9));
    expect(await getItem(page, 'b')).toMatchObject({ w: size.w, h: size.h });

    // 이동은 된다
    const m = await page.evaluate(() => (window as any).editor.getMetrics());
    const x0 = (await getItem(page, 'b')).x;
    await dragHandle(page, 'b', 3 * (m.cellWidth + m.gap), 0);
    expect((await getItem(page, 'b')).x).toBeGreaterThan(x0);
    expect(await hasOverlap(page)).toBe(false);

    // 다시 체크하면 크기 조절이 가능하다
    await page.check('#optResizable');
    await expect(page.locator(card('b'))).not.toHaveClass(/ddr-no-resize/);
    await page.evaluate(() => (window as any).editor.resizeItem('b', 5, 2));
    expect(await getItem(page, 'b')).toMatchObject({ w: 5, h: 2 });
    expect(await layoutItem(page, 'b')).not.toHaveProperty('resizable');
  });

  test('OPT-05 항목을 바꿔 선택하면 체크박스가 그 항목의 값으로 바뀐다', async ({ page }) => {
    await select(page, 'a');
    await page.check('#optLocked');
    await select(page, 'b');
    await page.uncheck('#optResizable');

    await expect(page.locator('#optName')).toHaveText('선택: b');
    await expect(page.locator('#optLocked')).not.toBeChecked();
    await expect(page.locator('#optResizable')).not.toBeChecked();

    await page.locator(`${card('a')} .ddr-content`).click(); // locked 항목도 선택할 수 있다
    await expect(page.locator('#optName')).toHaveText('선택: a (test1)');
    await expect(page.locator('#optLocked')).toBeChecked();
    await expect(page.locator('#optResizable')).toBeChecked();

    await select(page, 'c'); // 다른 항목은 영향받지 않는다
    await expect(page.locator('#optLocked')).not.toBeChecked();
    await expect(page.locator('#optResizable')).toBeChecked();
  });

  test('OPT-06 undo/redo 와 JSON 불러오기에서도 체크박스가 동기화된다', async ({ page }) => {
    await select(page, 'a');
    await page.check('#optLocked');
    await expect(page.locator('#optLocked')).toBeChecked();
    await page.click('#undo');
    await expect(page.locator('#optLocked')).not.toBeChecked();
    await expect(page.locator(card('a'))).not.toHaveClass(/ddr-locked/);
    await page.click('#redo');
    await expect(page.locator('#optLocked')).toBeChecked();

    // 저장한 JSON 에서 복원하면 옵션이 그대로 살아 있다
    await page.click('#export');
    await page.evaluate(() => (window as any).editor.clear());
    await page.click('#import');
    await select(page, 'a');
    await expect(page.locator('#optLocked')).toBeChecked();
    await expect(page.locator(card('a'))).toHaveClass(/ddr-locked/);
  });

  test('OPT-07 항목을 삭제하면 패널이 선택 없음 상태로 돌아간다', async ({ page }) => {
    await select(page, 'e');
    await page.click('#remove');
    await expect(page.locator('#optName')).toHaveText('항목을 선택하세요');
    await expect(page.locator('#optLocked')).toBeDisabled();
  });

  test('OPT-08 잠긴 항목은 다른 항목이 비켜가고, 잠긴 위치로의 이동은 거부된다', async ({ page }) => {
    await select(page, 'a');
    await page.check('#optLocked');
    const locked = await getItem(page, 'a');
    const m = await page.evaluate(() => (window as any).editor.getMetrics());
    // b 를 a 위로 끌어도 a 는 그대로이고 겹치지 않는다
    const h = await box(page, `${card('b')} .ddr-handle`);
    await page.mouse.move(h.x + 20, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 20 - (m.cellWidth + m.gap) * 2, h.y + h.height / 2, { steps: 8 });
    await expect(page.locator('.ddr-placeholder')).toHaveClass(/ddr-placeholder-invalid/);
    await page.mouse.up();
    expect(await getItem(page, 'a')).toMatchObject({ x: locked.x, y: locked.y });
    expect(await hasOverlap(page)).toBe(false);
  });
});
