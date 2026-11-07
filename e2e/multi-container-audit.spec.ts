/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1400 } });
test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/multi-container.html');
  await page.waitForFunction(() => (window as any).ready);
});

test('전수: 활성 추가, 선택 삭제, 개별 redo, 격자, 이벤트 지우기', async ({ page }) => {
  const head = page.locator('.box[data-box="header"]');
  await head.locator('[data-act="active"]').click();
  await expect(page.locator('#activeId')).toHaveText('header');
  await page.locator('#activeAdd').click();
  await expect(head.locator('[data-drift-id]')).toHaveCount(3);
  await head.locator('[data-drift-id="n1"] .ddr-content').click();
  await head.locator('[data-act="del"]').click();
  await expect(head.locator('[data-drift-id]')).toHaveCount(2);
  await head.locator('[data-act="undo"]').click();
  await expect(head.locator('[data-drift-id]')).toHaveCount(3);
  await head.locator('[data-act="redo"]').click();
  await expect(head.locator('[data-drift-id]')).toHaveCount(2);
  const grid = () => head.locator('.daracl-drift').evaluate((el) => getComputedStyle(el, '::before').display);
  const before = await grid();
  await head.locator('[data-act="grid"]').uncheck();
  expect(await grid()).not.toBe(before);
  await head.locator('[data-act="grid"]').check();
  expect(await grid()).toBe(before);
  await page.locator('#clearEvents').click();
  await expect(page.locator('#events li')).toHaveCount(0);
});

test('전수: 특수문자 ID를 표시·활성·제거해도 HTML이 실행되지 않는다', async ({ page }) => {
  const id = '<img src=x onerror=alert(1)>"[]\\';
  await page.locator('#newId').fill(id);
  await page.locator('#addContainer').click();
  const last = page.locator('.box').last();
  await expect(last.locator('.cid')).toContainText(id);
  await expect(last.locator('img')).toHaveCount(0);
  await last.locator('[data-act="active"]').click();
  await expect(page.locator('#activeId')).toHaveText(id);
  await last.locator('[data-act="remove"]').click();
  await expect(page.locator('.box')).toHaveCount(3);
});

for (const mode of ['pointercancel', 'remove', 'destroy', 'duplicate'] as const) {
  test(`전수: DragIn ${mode} 후 잔여 미리보기와 중복 추가 없음`, async ({ page }) => {
    const src = await page.locator('.pal').first().boundingBox();
    const target = await page.locator('#c-header .daracl-drift').boundingBox();
    await page.mouse.move(src!.x + 10, src!.y + 10);
    await page.mouse.down();
    await page.mouse.move(target!.x + 100, target!.y + 20, { steps: 10 });
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(1);
    await page.evaluate((mode) => {
      const m = (window as any).manager;
      if (mode === 'remove') m.unregister('header');
      if (mode === 'destroy') m.destroy();
      if (mode === 'pointercancel') document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    }, mode);
    await page.mouse.up();
    if (mode === 'duplicate') {
      await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })));
      expect(await page.evaluate(() => (window as any).manager.get('header').getItems().length)).toBe(3);
    }
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
    await expect(page.locator('.ddr-placeholder:visible')).toHaveCount(0);
    if (mode === 'pointercancel') {
      expect(await page.evaluate(() => (window as any).manager.get('header').getItems().length)).toBe(2);
    }
  });
}

test('안정성: activeChange 예외가 발생해도 unregister는 에디터를 해제한다', async ({ page }) => {
  const state = await page.evaluate(() => {
    const m = (window as any).manager;
    const editor = m.get('header');
    m.setActive('header');
    m.on('activeChange', () => {
      throw new Error('검증용 예외');
    });
    try {
      m.unregister('header');
    } catch {
      /* 해제 결과를 검사한다 */
    }
    return { registered: m.has('header'), destroyed: editor.isDestroyed(), connected: editor.element.isConnected };
  });
  expect(state).toEqual({ registered: false, destroyed: true, connected: false });
});

test('안정성: 드래그 중 dragInEnd 예외가 발생해도 Manager destroy는 완료된다', async ({ page }) => {
  const src = await page.locator('.pal').first().boundingBox();
  const target = await page.locator('#c-header .daracl-drift').boundingBox();
  await page.mouse.move(src!.x + 10, src!.y + 10);
  await page.mouse.down();
  await page.mouse.move(target!.x + 100, target!.y + 20, { steps: 10 });
  const ids = await page.evaluate(() => {
    const m = (window as any).manager;
    m.on('dragInEnd', () => {
      throw new Error('검증용 예외');
    });
    try {
      m.destroy();
    } catch {
      /* 해제 결과를 검사한다 */
    }
    m.destroy();
    return m.getIds();
  });
  expect(ids).toEqual([]);
  await expect(page.locator('.daracl-drift')).toHaveCount(0);
});

test('안정성: dragInStart에서 취소한 미리보기는 다시 나타나지 않는다', async ({ page }) => {
  await page.evaluate(() => {
    const m = (window as any).manager;
    m.on('dragInStart', () => m.cancelDragIn());
  });
  const src = await page.locator('.pal').first().boundingBox();
  const target = await page.locator('#c-header .daracl-drift').boundingBox();
  await page.mouse.move(src!.x + 10, src!.y + 10);
  await page.mouse.down();
  await page.mouse.move(target!.x + 100, target!.y + 20);
  await page.mouse.up();
  await expect(page.locator('.ddr-placeholder:visible')).toHaveCount(0);
  await expect(page.locator('.ddr-dragin-over')).toHaveCount(0);
});
