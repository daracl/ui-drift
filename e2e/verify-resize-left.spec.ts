/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';
import { box, getItem, hasOverlap } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/editor.html');
  await page.waitForFunction(() => !!(window as any).editor);
});

const metrics = (page: any) => page.evaluate(() => (window as any).editor.getMetrics());
const swHandle = (id: string) => `[data-drift-id="${id}"] .ddr-resize-handle[data-dir="sw"]`;

async function dragLeft(page: any, id: string, dxCells: number, dyCells: number, steps = 12) {
  const m = await metrics(page);
  const g = await box(page, swHandle(id));
  const sx = g.x + g.width / 2;
  const sy = g.y + g.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dxCells * (m.cellWidth + m.gap), sy + dyCells * (m.rowHeight + m.gap), { steps });
  await page.mouse.up();
}

test.describe('[RSL] 왼쪽 리사이즈 핸들', () => {
  test('RSL-01 카드 좌하단에 핸들이 있고 모양/커서가 우하단과 구분된다', async ({ page }) => {
    const card = await box(page, '[data-drift-id="b"]');
    const g = await box(page, swHandle('b'));
    const se = await box(page, '[data-drift-id="b"] .ddr-resize-handle[data-dir="se"]');
    expect(g.x).toBeLessThan(card.x + 4); // 왼쪽
    expect(g.y + g.height).toBeGreaterThan(card.y + card.height - 4); // 아래
    expect(se.x).toBeGreaterThan(card.x + card.width - 22); // 오른쪽
    const style = await page.locator(swHandle('b')).evaluate((el: Element) => getComputedStyle(el).cursor);
    expect(style).toBe('nesw-resize');
    expect(await page.locator(swHandle('b')).evaluate((el: Element) => getComputedStyle(el).touchAction)).toBe('none');
  });

  test('RSL-02 왼쪽으로 끌면 화면에서도 오른쪽 가장자리는 고정되고 왼쪽 가장자리가 늘어난다', async ({ page }) => {
    const m = await metrics(page);
    const before = await box(page, '[data-drift-id="b"]');
    const beforeData = await getItem(page, 'b');
    await dragLeft(page, 'b', -1, 1);

    const after = await getItem(page, 'b');
    expect(after.x).toBe(beforeData.x - 1);
    expect(after.w).toBe(beforeData.w + 1);
    expect(after.h).toBe(beforeData.h + 1);
    expect(after.x + after.w).toBe(beforeData.x + beforeData.w); // 오른쪽 고정
    expect(await hasOverlap(page)).toBe(false);

    // 애니메이션이 끝난 뒤 화면 좌표: 오른쪽 가장자리는 그대로, 폭은 한 칸만큼 늘었다
    await expect
      .poll(async () => {
        const b = await box(page, '[data-drift-id="b"]');
        return [Math.round(b.x + b.width), Math.round(b.width)];
      })
      .toEqual([Math.round(before.x + before.width), Math.round(before.width + m.cellWidth + m.gap)]);
    // 인라인 위치는 정리되고 data 속성이 기준이 된다
    expect((await page.locator('[data-drift-id="b"]').getAttribute('style')) ?? '').toBe('');
  });

  test('RSL-03 드래그 중 placeholder 가 새 영역을 보여주고 모델은 drop 전까지 그대로다', async ({ page }) => {
    const m = await metrics(page);
    const g = await box(page, swHandle('b'));
    const beforeLayout = await page.evaluate(() => (window as any).editor.getLayout());
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 - 2 * (m.cellWidth + m.gap), g.y + g.height / 2, { steps: 10 });
    await expect(page.locator('.ddr-placeholder')).toBeVisible();
    await expect(page.locator('[data-drift-id="b"]')).toHaveClass(/ddr-resizing/);
    expect(await page.evaluate(() => (window as any).editor.getLayout())).toEqual(beforeLayout);
    const ph = await page
      .locator('.ddr-placeholder')
      .evaluate((el: HTMLElement) => ({ x: el.dataset.x, w: el.dataset.w }));
    expect(ph).toEqual({ x: '2', w: '6' });
    await page.mouse.up();
    await expect(page.locator('.ddr-placeholder')).toBeHidden();
  });

  test('RSL-04 경계: 왼쪽 끝까지, 화면 밖까지 끌어도 x 는 0 이고 최소 폭으로 줄일 수 있다', async ({ page }) => {
    await dragLeft(page, 'b', -30, 0);
    expect(await getItem(page, 'b')).toMatchObject({ x: 0, w: 8 });
    expect(await hasOverlap(page)).toBe(false);
    await dragLeft(page, 'b', 30, 0); // 오른쪽으로 크게 → 최소 폭 1
    const b = await getItem(page, 'b');
    expect(b.w).toBe(1);
    expect(b.x + b.w).toBe(8);
  });

  test('RSL-05 undo/redo 와 JSON 저장 복원이 동작한다', async ({ page }) => {
    await dragLeft(page, 'b', -1, 0);
    expect(await getItem(page, 'b')).toMatchObject({ x: 3, w: 5 });
    await page.click('#undo');
    expect(await getItem(page, 'b')).toMatchObject({ x: 4, w: 4 });
    await page.click('#redo');
    expect(await getItem(page, 'b')).toMatchObject({ x: 3, w: 5 });
    await page.click('#export');
    const json = JSON.parse(await page.inputValue('#json'));
    expect(json.items.find((i: any) => i.id === 'b')).toMatchObject({ x: 3, w: 5 });
  });

  test('RSL-06 locked / resizable:false 카드에는 핸들이 보이지 않아 조절할 수 없다', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).editor.updateItem('b', { resizable: false });
      (window as any).editor.updateItem('c', { locked: true });
    });
    for (const id of ['b', 'c']) {
      expect(await page.locator(swHandle(id)).evaluate((el: Element) => getComputedStyle(el).display)).toBe('none');
    }
    // 에디터 전체 resizable=false 도 sw 핸들을 숨기지만, 이 하네스는 전체 옵션을 바꾸지 않으므로 API 로 확인
    await page.evaluate(() => (window as any).editor.enableResize(false));
    expect(await page.locator(swHandle('a')).evaluate((el: Element) => getComputedStyle(el).display)).toBe('none');
    await page.evaluate(() => (window as any).editor.enableResize(true));
    expect(await page.locator(swHandle('a')).evaluate((el: Element) => getComputedStyle(el).display)).not.toBe('none');
  });

  test('RSL-07 resizeHandles 옵션으로 sw 만/se 만 표시할 수 있다', async ({ page }) => {
    await page.goto('/uitest/api.html');
    await page.waitForFunction(() => (window as any).__ready === true);
    const r = await page.evaluate(() => {
      const w = window as any;
      const host = document.getElementById('host')!;
      const dirs = (opts: any) => {
        host.innerHTML = '';
        const e = w.Drift.createDriftEditor(host, {
          layout: { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 4, h: 2 }] },
          ...opts,
        });
        const list = Array.from(host.querySelectorAll('.ddr-resize-handle')).map((n) => (n as HTMLElement).dataset.dir);
        e.destroy();
        return list;
      };
      return {
        def: dirs({}),
        sw: dirs({ resizeHandles: ['sw'] }),
        se: dirs({ resizeHandles: ['se'] }),
        none: dirs({ resizeHandles: [] }),
      };
    });
    expect(r).toEqual({ def: ['se', 'sw'], sw: ['sw'], se: ['se'], none: [] });
  });
});
