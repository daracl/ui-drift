/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, Page, test } from '@playwright/test';

const order = (page: Page, selector: string): Promise<string[]> =>
  page.$$eval(`${selector} > *`, (els) => els.map((e) => (e as HTMLElement).dataset.id || ''));

async function boxOf(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`요소를 찾을 수 없습니다: ${selector}`);
  return b;
}

/** from 요소(또는 그 안의 grip)를 잡아 to 요소의 (rx, ry) 비율 위치로 끈다 */
async function dragTo(page: Page, from: string, to: string, rx = 0.5, ry = 0.25, drop = true) {
  const a = await boxOf(page, from);
  const b = await boxOf(page, to);
  const sx = a.x + Math.min(10, a.width / 2);
  const sy = a.y + a.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 6, sy + 6, { steps: 2 });
  await page.mouse.move(b.x + b.width * rx, b.y + b.height * ry, { steps: 14 });
  await page.waitForTimeout(250); // FLIP 애니메이션이 끝나 위치가 안정되길 기다린다
  if (drop) await page.mouse.up();
}

test.describe('[SM] SortableManager', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uitest/sortable-manager.html');
    await page.waitForFunction(() => (window as any).ready === true);
  });

  test('SM-01 같은 Manager 의 목록 사이를 마우스로 옮기면 한 번만 이동하고 이벤트·활성이 맞다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await dragTo(page, '#todo [data-id="t2"] .grip', '#doing [data-id="d1"]', 0.5, 0.2);
    expect(await order(page, '#todo')).toEqual(['t1', 't3']);
    expect(await order(page, '#doing')).toEqual(['t2', 'd1']);
    await expect(page.locator('#events')).toContainText('itemTransfer todo→doing t2 1→0 move user');
    await expect(page.locator('#activeId')).toHaveText('doing');
    await expect(page.locator('.dsr-drag, .dsr-ghost')).toHaveCount(0);
    // 빈 목록(done)으로도 옮겨진다
    await dragTo(page, '#doing [data-id="d1"] .grip', '#done', 0.5, 0.5);
    expect(await order(page, '#done')).toEqual(['d1']);
    expect(errors).toEqual([]);
  });

  test('SM-02 다른 Manager 의 목록과는 섞이지 않는다 (양방향)', async ({ page }) => {
    await dragTo(page, '#todo [data-id="t1"] .grip', '#other [data-id="o1"]', 0.5, 0.5);
    expect(await order(page, '#other')).toEqual(['o1', 'o2']);
    // 끄는 경로가 doing/done 위를 지나므로 항목은 받아 준 마지막 목록에 남는다(Sortable 기본 동작). 이 Manager 안에 한 번만 있다
    const all = await page.evaluate(() => (window as any).sm.getOrders().containers.flatMap((c: any) => c.order));
    expect(all.filter((id: string) => id === 't1')).toHaveLength(1);
    await dragTo(page, '#other [data-id="o1"]', '#done', 0.5, 0.5);
    expect(await order(page, '#done')).not.toContain('o1');
    expect(await order(page, '#other')).toEqual(['o1', 'o2']);
  });

  test('SM-03 목록 간 이동을 끄면 목록 안 정렬만 되고, 끄는 도중 끄면 원래 자리로 취소된다', async ({ page }) => {
    await page.uncheck('#cross');
    await expect(page.locator('#crossState')).toHaveText('꺼짐');
    await dragTo(page, '#todo [data-id="t1"] .grip', '#doing', 0.5, 0.9);
    expect(await order(page, '#doing')).toEqual(['d1']);
    await dragTo(page, '#todo [data-id="t1"] .grip', '#todo [data-id="t3"]', 0.5, 0.8);
    expect(await order(page, '#todo')).toEqual(['t2', 't3', 't1']);

    await page.check('#cross');
    await dragTo(page, '#todo [data-id="t2"] .grip', '#doing [data-id="d1"]', 0.5, 0.2, false);
    expect(await order(page, '#doing')).toEqual(['t2', 'd1']); // 드래그 중 미리보기로 들어가 있다
    await page.evaluate(() => (window as any).sm.setCrossContainer(false));
    expect(await order(page, '#doing')).toEqual(['d1']);
    expect(await order(page, '#todo')).toEqual(['t2', 't3', 't1']);
    await page.mouse.up();
    await expect(page.locator('#events')).toContainText('end todo (cancelled)');
  });

  test('SM-04 palette 는 복제로만 꺼내지고(받지 않음) 복제 항목에 새 id 가 붙는다', async ({ page }) => {
    await dragTo(page, '#palette [data-id="tpl-bug"]', '#todo [data-id="t1"]', 0.5, 0.2);
    expect(await order(page, '#palette')).toEqual(['tpl-bug', 'tpl-task']);
    const todo = await order(page, '#todo');
    expect(todo).toHaveLength(4);
    expect(todo[0]).toMatch(/^tpl-bug-\d+$/);
    await expect(page.locator('#events')).toContainText('itemTransfer palette→todo tpl-bug 0→0 clone user');
    // palette 로는 넣을 수 없다
    await dragTo(page, '#todo [data-id="t1"] .grip', '#palette', 0.5, 0.5);
    expect(await order(page, '#palette')).toEqual(['tpl-bug', 'tpl-task']);
  });

  test('SM-05 API 이동, 거절 사유, 입력 오류를 UI 에서 확인한다', async ({ page }) => {
    await page.selectOption('#trItem', JSON.stringify(['todo', 't3']));
    await page.selectOption('#trTo', 'done');
    await page.click('#trRun');
    await expect(page.locator('#status')).toHaveText('이동: todo → done (2 → 0)');
    expect(await order(page, '#done')).toEqual(['t3']);
    await expect(page.locator('#events')).toContainText('itemTransfer todo→done t3 2→0 move api');

    await page.selectOption('#trItem', JSON.stringify(['done', 't3']));
    await page.selectOption('#trTo', 'done');
    await page.click('#trRun');
    await expect(page.locator('#status')).toHaveText('거절: same-container');

    await page.selectOption('#trTo', 'todo');
    await page.fill('#trIndex', '-1');
    await page.click('#trRun');
    await expect(page.locator('#status')).toContainText('index 는 0 이상의 정수');
    await page.fill('#trIndex', '0');
    await page.click('#trRun');
    expect(await order(page, '#todo')).toEqual(['t3', 't1', 't2']);
  });

  test('SM-06 순서 저장 → 목록 사이 이동 → 복원하면 원래 목록·순서로 돌아간다. 손상 데이터는 그대로 둔다', async ({
    page,
  }) => {
    await page.click('#save');
    const saved = await page.inputValue('#json');
    await dragTo(page, '#todo [data-id="t1"] .grip', '#done', 0.5, 0.5);
    await page.evaluate(() => (window as any).sm.transferItem({ from: 'doing', to: 'todo', itemId: 'd1', index: 0 }));
    expect(await order(page, '#todo')).toEqual(['d1', 't2', 't3']);
    await page.click('#restore');
    await expect(page.locator('#status')).toHaveText('복원: palette, todo, doing, done');
    expect(await order(page, '#todo')).toEqual(['t1', 't2', 't3']);
    expect(await order(page, '#doing')).toEqual(['d1']);
    expect(await order(page, '#done')).toEqual([]);

    const before = await page.evaluate(() => (window as any).sm.toJSON());
    await page.fill('#json', '{"version":1,"containers":[{"id":"todo","order":["t1","nope"]}]}');
    await page.click('#restore');
    await expect(page.locator('#status')).toHaveClass(/error/);
    await expect(page.locator('#status')).toContainText('어느 목록에도 없는 항목 id 입니다: nope');
    expect(await page.evaluate(() => (window as any).sm.toJSON())).toBe(before);
    await page.check('#ignoreUnknown');
    await page.fill('#json', '{"version":1,"containers":[{"id":"done","order":["t1","nope"]}]}');
    await page.click('#restore');
    expect(await order(page, '#done')).toEqual(['t1']);
  });

  test('SM-07 드래그 중 대상 목록 해제·Manager destroy 를 안전하게 정리한다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await dragTo(page, '#todo [data-id="t1"] .grip', '#done', 0.5, 0.5, false);
    expect(await order(page, '#done')).toEqual(['t1']);
    await page.evaluate(() => (window as any).sm.unregister('done'));
    expect(await order(page, '#done')).toEqual([]);
    expect(await order(page, '#todo')).toEqual(['t1', 't2', 't3']);
    await page.mouse.up();
    await expect(page.locator('.dsr-drag, .dsr-ghost')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).sm.getIds())).toEqual(['palette', 'todo', 'doing']);
    await page.click('#reRegister');
    expect(await page.evaluate(() => (window as any).sm.getIds())).toEqual(['palette', 'todo', 'doing', 'done']);

    await dragTo(page, '#todo [data-id="t2"] .grip', '#doing', 0.5, 0.9, false);
    await page.evaluate(() => (window as any).sm.destroy());
    await expect(page.locator('.dsr-drag, .dsr-ghost')).toHaveCount(0);
    expect(await order(page, '#todo')).toEqual(['t1', 't2', 't3']);
    await page.mouse.up();
    expect(errors).toEqual([]);
  });

  test('SM-08 반복 등록/해제 후 document 리스너가 늘지 않는다 (CDP)', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    const count = async () => {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId as string });
      return listeners.length;
    };
    const base = await count();
    await page.evaluate(() => {
      const { createSortableManager } = (window as any).SortableApi;
      for (let r = 0; r < 20; r++) {
        const m = createSortableManager();
        for (let i = 0; i < 5; i++) {
          const ul = document.createElement('ul');
          ul.innerHTML = '<li data-id="x">x</li>';
          document.body.appendChild(ul);
          m.register(String(i), ul);
        }
        m.transferItem({ from: '0', to: '1', itemId: 'x' });
        m.destroy();
      }
    });
    expect(await count()).toBe(base);
    await cdp.detach();
  });
});
