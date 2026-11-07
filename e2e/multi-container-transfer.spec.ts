/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, Page, test } from '@playwright/test';
import { box, Box } from './helpers';

// 컨테이너 여러 개와 사이드바가 한 화면에 보이도록 세로로 긴 화면을 쓴다
test.use({ viewport: { width: 1280, height: 1400 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/multi-container.html?cross=1');
  await page.waitForFunction(() => (window as any).ready === true);
});

const C = (id: string) => `#c-${id}`;
const card = (cid: string, id: string) => `${C(cid)} [data-drift-id="${id}"]`;
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
const item = (page: Page, cid: string, id: string) =>
  page.evaluate(([c, i]) => (window as any).manager.get(c).getItem(i), [cid, id]);
const metrics = (page: Page, cid: string) =>
  page.evaluate((c) => (window as any).manager.get(c).getMetrics(), cid) as Promise<{
    cellWidth: number;
    rowHeight: number;
    gap: number;
  }>;

/** 셀 (x, y) 의 좌상단 화면 좌표 */
async function cellPoint(page: Page, cid: string, x: number, y: number) {
  const m = await metrics(page, cid);
  const c = await box(page, `${C(cid)} .daracl-drift`);
  return { x: c.x + x * (m.cellWidth + m.gap), y: c.y + y * (m.rowHeight + m.gap) };
}

/** 카드의 실제 DOM 좌표·크기가 셀 (x, y, w, h) 와 일치하는지 (애니메이션이 끝날 때까지 기다린다) */
async function expectAt(page: Page, cid: string, id: string, x: number, y: number, w: number, h: number) {
  const m = await metrics(page, cid);
  await expect
    .poll(async () => {
      const c = await box(page, `${C(cid)} .daracl-drift`);
      const b = (await page.locator(card(cid, id)).boundingBox()) as Box;
      return [
        Math.round((b.x - c.x) / (m.cellWidth + m.gap)),
        Math.round((b.y - c.y) / (m.rowHeight + m.gap)),
        Math.round((b.width + m.gap) / (m.cellWidth + m.gap)),
        Math.round((b.height + m.gap) / (m.rowHeight + m.gap)),
      ];
    })
    .toEqual([x, y, w, h]);
}

/** 핸들을 잡아 (to) 로 끈다. 항목 좌상단에서 (8, 6) 지점을 잡는다 */
async function dragHandle(page: Page, cid: string, id: string, to: { x: number; y: number }, drop = true) {
  const h = await box(page, `${card(cid, id)} .ddr-handle`);
  await page.mouse.move(h.x + 8, h.y + 6);
  await page.mouse.down();
  await page.mouse.move(to.x + 8 + 4, to.y + 6 + 4, { steps: 14 });
  if (drop) await page.mouse.up();
}

test.describe('[MCT] 컨테이너 간 이동', () => {
  test('MCT-01 마우스로 body 의 table 을 footer(24열, float)로 옮기면 실제 위치·크기가 맞고 한 번만 존재한다', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const to = await cellPoint(page, 'footer', 2, 1);
    await dragHandle(page, 'body', 'table', to);
    expect(await ids(page, 'body')).toEqual(['chart', 'logo']);
    expect(await ids(page, 'footer')).toEqual(['page', 'table']);
    // 셀 수(w3, h3)를 유지하고 footer 의 셀 크기로 표시된다. float 이므로 놓은 y 를 유지한다
    await expectAt(page, 'footer', 'table', 2, 1, 3, 3);
    await expect(page.locator('.ddr-transfer-ghost')).toHaveCount(0);
    await expect(page.locator('.ddr-placeholder:visible')).toHaveCount(0);
    await expect(page.locator('.ddr-transfer-source, .ddr-dragging, .ddr-dragin-over')).toHaveCount(0);
    // 활성·선택·포커스
    expect(await page.evaluate(() => (window as any).manager.getActiveId())).toBe('footer');
    await expect(page.locator(card('footer', 'table'))).toHaveClass(/ddr-selected/);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-drift-id'))).toBe('table');
    await expect(page.locator('#events')).toContainText('itemTransfer transfer body→footer table→table user');
    // 연결 undo/redo (활성 = footer 의 undo 로 양쪽이 되돌아간다)
    await page.click('#activeUndo');
    expect(await ids(page, 'footer')).toEqual(['page']);
    await expectAt(page, 'body', 'table', 3, 0, 3, 3);
    expect(await page.evaluate(() => (window as any).manager.getActiveId())).toBe('body');
    await page.click('#activeRedo');
    expect(await ids(page, 'body')).toEqual(['chart', 'logo']);
    await expectAt(page, 'footer', 'table', 2, 1, 3, 3);
    expect(errors).toEqual([]);
  });

  test('MCT-02 header→body→footer 를 지나가면 이전 대상 미리보기를 원복하고 원본으로 돌아오면 일반 드래그다', async ({
    page,
  }) => {
    const bodyTo = await cellPoint(page, 'body', 0, 0);
    await dragHandle(page, 'header', 'title', bodyTo, false);
    await expect(page.locator('.ddr-transfer-ghost')).toHaveCount(1);
    await expect(page.locator(`${C('body')} .ddr-placeholder`)).toBeVisible();
    await expect(page.locator(C('body'))).toHaveClass(/ddr-dragin-over/);
    const footerTo = await cellPoint(page, 'footer', 0, 0);
    await page.mouse.move(footerTo.x + 12, footerTo.y + 10, { steps: 10 });
    await expect(page.locator(`${C('body')} .ddr-placeholder`)).toBeHidden();
    await expect(page.locator(C('body'))).not.toHaveClass(/ddr-dragin-over/);
    await expectAt(page, 'body', 'chart', 0, 0, 3, 3); // body 는 원래 배치
    await expect(page.locator(`${C('footer')} .ddr-placeholder`)).toBeVisible();
    // 원본(header)으로 돌아오면 ghost 가 사라지고 원본의 placeholder 가 보인다
    const back = await cellPoint(page, 'header', 3, 0);
    await page.mouse.move(back.x + 12, back.y + 10, { steps: 10 });
    await expect(page.locator('.ddr-transfer-ghost')).toHaveCount(0);
    await expect(page.locator(`${C('footer')} .ddr-placeholder`)).toBeHidden();
    await expect(page.locator(`${C('header')} .ddr-placeholder`)).toBeVisible();
    await page.mouse.up();
    expect(await ids(page, 'header')).toEqual(['logo', 'title']);
    expect(await ids(page, 'footer')).toEqual(['page']);
    // 인라인 임시 위치가 남지 않는다
    expect(await page.locator(card('header', 'title')).evaluate((el) => (el as HTMLElement).style.transform)).toBe('');
  });

  test('MCT-03 같은 id(logo) 로 옮기면 무효 placeholder 를 보이고 거절 사유를 표시한다', async ({ page }) => {
    const to = await cellPoint(page, 'body', 3, 5);
    await dragHandle(page, 'header', 'logo', to, false);
    await expect(page.locator(`${C('body')} .ddr-placeholder`)).toHaveClass(/ddr-placeholder-invalid/);
    await page.mouse.up();
    await expect(page.locator('#trResult')).toHaveText('거절: id-conflict (header → body, logo)');
    await expect(page.locator('#events')).toContainText('transferReject id-conflict header→body logo');
    expect(await ids(page, 'header')).toEqual(['logo', 'title']);
    expect((await ids(page, 'body')).filter((i: string) => i === 'logo')).toHaveLength(1);
    await expect(page.locator('.ddr-transfer-ghost')).toHaveCount(0);
  });

  test('MCT-04 밖 drop / Esc 는 원래 상태로 취소하고 ghost·임시 위치를 정리한다', async ({ page }) => {
    const before = await page.evaluate(() => (window as any).manager.toJSON());
    const aside = await box(page, 'aside');
    await dragHandle(page, 'body', 'chart', { x: aside.x + 10, y: aside.y + 200 });
    expect(await page.evaluate(() => (window as any).manager.toJSON())).toBe(before);
    const to = await cellPoint(page, 'footer', 0, 0);
    await dragHandle(page, 'body', 'chart', to, false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await page.evaluate(() => (window as any).manager.toJSON())).toBe(before);
    await expect(page.locator('.ddr-transfer-ghost, .ddr-transfer-source')).toHaveCount(0);
    await expectAt(page, 'body', 'chart', 0, 0, 3, 3);
    expect(await page.locator(card('body', 'chart')).getAttribute('style')).toBeFalsy();
  });

  test('MCT-05 옵션을 끄면 다른 컨테이너 위로 끌어도 원본 안에서만 움직인다', async ({ page }) => {
    await page.uncheck('#crossDrag');
    await expect(page.locator('#crossState')).toHaveText('꺼짐');
    const to = await cellPoint(page, 'footer', 0, 0);
    await dragHandle(page, 'body', 'table', to, false);
    await expect(page.locator('.ddr-transfer-ghost')).toHaveCount(0);
    await page.mouse.up();
    expect(await ids(page, 'footer')).toEqual(['page']);
    expect(await ids(page, 'body')).toContain('table');
  });

  test('MCT-06 리사이즈 중에는 이동으로 바뀌지 않는다', async ({ page }) => {
    const grip = await box(page, `${card('body', 'chart')} .ddr-resize-handle[data-dir="se"]`);
    const footer = await cellPoint(page, 'footer', 2, 0);
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(footer.x, footer.y, { steps: 12 });
    await expect(page.locator('.ddr-transfer-ghost')).toHaveCount(0);
    await expect(page.locator(`${C('footer')} .ddr-placeholder`)).toBeHidden();
    await page.mouse.up();
    expect(await ids(page, 'footer')).toEqual(['page']);
    expect(await ids(page, 'body')).toContain('chart');
  });

  test('MCT-07 이동 중 대상 제거와 Manager destroy 를 안전하게 정리한다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const to = await cellPoint(page, 'footer', 0, 0);
    await dragHandle(page, 'body', 'table', to, false);
    await expect(page.locator(`${C('footer')} .ddr-placeholder`)).toBeVisible();
    await page.evaluate(() => (window as any).manager.unregister('footer'));
    await page.mouse.move(to.x + 30, to.y + 12, { steps: 3 });
    await page.mouse.up();
    expect(await ids(page, 'body')).toContain('table');

    const head = await cellPoint(page, 'header', 0, 2);
    await dragHandle(page, 'body', 'chart', head, false);
    await expect(page.locator('.ddr-transfer-ghost')).toHaveCount(1);
    await page.evaluate(() => (window as any).manager.destroy());
    await expect(page.locator('.ddr-transfer-ghost, .daracl-drift')).toHaveCount(0);
    await page.mouse.move(head.x + 40, head.y + 40, { steps: 3 });
    await page.mouse.up();
    expect(errors).toEqual([]);
  });

  test('MCT-08 API UI: 이동, 거절 사유, newId, 연결 undo 차단 표시', async ({ page }) => {
    await page.selectOption('#trItem', JSON.stringify(['header', 'logo']));
    await page.selectOption('#trTo', 'body');
    await page.click('#trRun');
    await expect(page.locator('#trResult')).toHaveText('거절: id-conflict');
    await page.fill('#trNewId', 'logo-2');
    await page.click('#trRun');
    await expect(page.locator('#trResult')).toContainText('이동: header → body logo-2 (tx-');
    expect(await ids(page, 'body')).toEqual(['chart', 'logo', 'logo-2', 'table']);
    // 입력 오류 (x 만 지정)
    await page.fill('#trNewId', '');
    await page.selectOption('#trItem', JSON.stringify(['header', 'title']));
    await page.selectOption('#trTo', 'footer');
    await page.fill('#trX', '1');
    await page.click('#trRun');
    await expect(page.locator('#trResult')).toContainText('[drift] transferItem: x 와 y 는 함께 지정해야 합니다.');
    // 상대(body)의 후속 편집이 있으면 header 의 연결 undo 가 막힌 것을 목록에서 확인할 수 있다
    await page.evaluate(() => (window as any).manager.get('body').moveItem('chart', 3, 6));
    await expect(page.locator('#list li', { hasText: 'header' })).toContainText('undo ✗');
    await page.evaluate(() => (window as any).manager.get('body').undo());
    await expect(page.locator('#list li', { hasText: 'header' })).toContainText('undo ✓');
  });

  test('MCT-09 이동 결과를 JSON 으로 저장·복원하고 JavaScript 없는 Viewer 에서 확인한다', async ({ page, browser }) => {
    await page.evaluate(() =>
      (window as any).manager.transferItem({ from: 'body', to: 'footer', itemId: 'table', x: 4, y: 0 }),
    );
    await page.click('#save');
    const saved = JSON.parse(await page.inputValue('#json'));
    expect(saved.containers[1].layout.items.map((i: any) => i.id)).not.toContain('table');
    const footerItem = saved.containers[2].layout.items.find((i: any) => i.id === 'table');
    expect(footerItem).toMatchObject({ x: 4, y: 0, w: 3, h: 3 });
    await page.evaluate(() => (window as any).manager.get('footer').clear());
    await page.click('#restore');
    expect(await ids(page, 'footer')).toEqual(['page', 'table']);
    await expectAt(page, 'footer', 'table', 4, 0, 3, 3);

    // Viewer(정적 HTML+CSS)로 footer 를 렌더링해 JS 를 끈 브라우저에서 같은 위치인지 본다
    const html = await page.evaluate(async (layout) => {
      const v = await import('/src/viewer.ts' as string);
      return v.renderViewerPage(layout, { scope: 'ddr-footer' }) as string;
    }, saved.containers[2].layout);
    expect(html).not.toMatch(/<script/i);
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 600 }, javaScriptEnabled: false });
    const vp = await ctx.newPage();
    await vp.setContent(html);
    const grid = (await vp.locator('.ddr-footer-viewer').boundingBox()) as Box;
    const t = (await vp.locator('[data-drift-id="table"]').boundingBox()) as Box;
    const gap = 4;
    const cell = (grid.width - gap * 23) / 24;
    expect(Math.round((t.x - grid.x) / (cell + gap))).toBe(4);
    expect(Math.round((t.width + gap) / (cell + gap))).toBe(3);
    await ctx.close();
  });
});
