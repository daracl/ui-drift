/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, Page, test } from '@playwright/test';
import { box, Box } from './helpers';

// 컨테이너 여러 개와 팔레트가 한 화면에 보이도록 세로로 긴 화면을 쓴다 (팔레트에서 끌어 놓기 위해)
test.use({ viewport: { width: 1280, height: 1400 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/multi-container.html');
  await page.waitForFunction(() => (window as any).ready === true);
});

const C = (id: string) => `#c-${id}`;
const card = (cid: string, id: string) => `${C(cid)} [data-drift-id="${id}"]`;
const items = (page: Page, cid: string) =>
  page.evaluate((c) => (window as any).manager.get(c).getItems() as any[], cid);
const metrics = (page: Page, cid: string) =>
  page.evaluate((c) => (window as any).manager.get(c).getMetrics(), cid) as Promise<{
    cellWidth: number;
    rowHeight: number;
    gap: number;
  }>;
const canvasBox = (page: Page, cid: string) => box(page, `${C(cid)} .daracl-drift`);

/** 셀 (x, y) 의 좌상단 화면 좌표 */
async function cellPoint(page: Page, cid: string, x: number, y: number) {
  const m = await metrics(page, cid);
  const c = await canvasBox(page, cid);
  return { x: c.x + x * (m.cellWidth + m.gap), y: c.y + y * (m.rowHeight + m.gap) };
}

/** 카드의 실제 DOM 좌표가 셀 (x, y, w, h) 와 일치하는지 (애니메이션이 끝날 때까지 기다린다) */
async function expectAt(page: Page, cid: string, id: string, x: number, y: number, w: number, h: number) {
  const m = await metrics(page, cid);
  await expect
    .poll(async () => {
      const c = await canvasBox(page, cid);
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

/** 팔레트 원본을 (tx, ty) 화면 좌표로 끈다. drop 하지 않을 수 있다 */
async function dragPalette(page: Page, nth: number, tx: number, ty: number, drop = true) {
  const src = await box(page, `.palette > div >> nth=${nth}`);
  await page.mouse.move(src.x + 10, src.y + 10);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 10 });
  if (drop) await page.mouse.up();
}

test.describe('[MC] 여러 컨테이너', () => {
  test('MC-01 기본 3개 컨테이너가 서로 다른 컬럼 수로 독립 렌더링된다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    expect(await page.evaluate(() => (window as any).manager.getIds())).toEqual(['header', 'body', 'footer']);
    const cols = await page.evaluate(() =>
      (window as any).manager.getAll().map(({ editor }: any) => editor.getColumns()),
    );
    expect(cols).toEqual([12, 6, 24]);
    // 같은 항목 id(logo)가 header 와 body 에 각각 있다
    await expectAt(page, 'header', 'logo', 0, 0, 3, 2);
    await expectAt(page, 'body', 'logo', 0, 3, 2, 2);
    await expectAt(page, 'footer', 'page', 20, 0, 4, 1);
    expect(errors).toEqual([]);
  });

  test('MC-02 마우스 드래그/리사이즈는 그 컨테이너만 바꾸고 활성 컨테이너가 된다', async ({ page }) => {
    const headerBefore = await items(page, 'header');
    const handle = await box(page, `${card('body', 'table')} .ddr-handle`);
    // table 을 chart 아래(0,3)로: 그 자리의 logo 는 아래로 밀린다
    const to = await cellPoint(page, 'body', 0, 3);
    await page.mouse.move(handle.x + 10, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(to.x + 10, to.y + 5, { steps: 12 });
    await page.mouse.up();
    await expectAt(page, 'body', 'table', 0, 3, 3, 3);
    await expectAt(page, 'body', 'logo', 0, 6, 2, 2);
    expect(await page.evaluate(() => (window as any).manager.getActiveId())).toBe('body');
    await expect(page.locator('.box[data-box="body"]')).toHaveAttribute('data-active', '');

    // 리사이즈 (se 핸들): chart 3x3 → 2x2
    const grip = await box(page, `${card('body', 'chart')} .ddr-resize-handle[data-dir="se"]`);
    const m = await metrics(page, 'body');
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x - (m.cellWidth + m.gap), grip.y - (m.rowHeight + m.gap), { steps: 10 });
    await page.mouse.up();
    await expectAt(page, 'body', 'chart', 0, 0, 2, 2);
    expect(await items(page, 'header')).toEqual(headerBefore);
  });

  test('MC-03 클릭 선택과 키보드는 해당 컨테이너에서만 처리되고, 활성 undo/redo 가 그 컨테이너에만 적용된다', async ({
    page,
  }) => {
    await page.click(`${card('header', 'logo')} .ddr-content`);
    await expect(page.locator(card('header', 'logo'))).toHaveClass(/ddr-selected/);
    await expect(page.locator(card('body', 'logo'))).not.toHaveClass(/ddr-selected/);
    await page.keyboard.press('ArrowDown');
    await expectAt(page, 'header', 'logo', 0, 0, 3, 2); // 중력으로 다시 올라온다
    await page.keyboard.press('ArrowRight');
    await expectAt(page, 'header', 'logo', 1, 0, 3, 2);
    await expectAt(page, 'body', 'logo', 0, 3, 2, 2);
    expect(await page.evaluate(() => (window as any).manager.getActiveId())).toBe('header');

    await page.click('#activeUndo');
    await expectAt(page, 'header', 'logo', 0, 0, 3, 2);
    await page.click('#activeRedo');
    await expectAt(page, 'header', 'logo', 1, 0, 3, 2);
    expect(await page.evaluate(() => (window as any).manager.get('body').canUndo())).toBe(false);

    // 컨테이너 머리글 버튼: body 에 추가 후 undo
    await page.click('.box[data-box="body"] [data-act="add"]');
    expect(await items(page, 'body')).toHaveLength(4);
    await page.click('.box[data-box="body"] [data-act="undo"]');
    expect(await items(page, 'body')).toHaveLength(3);
  });

  test('MC-04 공통 팔레트: 포인터 아래의 컨테이너 하나에만 정확한 칸으로 한 번 추가된다', async ({ page }) => {
    const counts = () =>
      page.evaluate(() => (window as any).manager.getAll().map(({ editor }: any) => editor.getItems().length));
    const before = await counts();
    // body 의 (0..2, 6) 근처 — Chart 3x2 의 가운데를 맞춘다
    const m = await metrics(page, 'body');
    const p = await cellPoint(page, 'body', 0, 5);
    await dragPalette(page, 0, p.x + 1.5 * (m.cellWidth + m.gap), p.y + (m.rowHeight + m.gap));
    const after = await counts();
    expect(after).toEqual([before[0], before[1] + 1, before[2]]);
    const added = (await items(page, 'body')).find((i: any) => i.title === 'Chart');
    expect(added).toMatchObject({ x: 0, y: 5, w: 3, h: 2 });
    await expectAt(page, 'body', added.id, 0, 5, 3, 2);
    expect(await page.evaluate(() => (window as any).manager.getActiveId())).toBe('body');
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
    await expect(page.locator('.ddr-placeholder:visible')).toHaveCount(0);

    // footer(24열, 셀이 좁다)에도 그 컨테이너의 셀 기준으로 놓인다
    const mf = await metrics(page, 'footer');
    const pf = await cellPoint(page, 'footer', 2, 0);
    await dragPalette(page, 2, pf.x + (mf.cellWidth + mf.gap), pf.y + (mf.rowHeight + mf.gap) / 2);
    const small = (await items(page, 'footer')).find((i: any) => i.content === '+ Small (2x1)');
    expect(small).toMatchObject({ x: 2, y: 0, w: 2, h: 1 });
    // 한 번의 undo 로 되돌아간다
    await page.click('#activeUndo');
    expect(await items(page, 'footer')).toHaveLength(1);
  });

  test('MC-05 끄는 도중 대상이 바뀌면 이전 컨테이너의 미리보기가 사라지고, 밖에서 놓으면 추가되지 않는다', async ({
    page,
  }) => {
    const h = await canvasBox(page, 'header');
    await dragPalette(page, 0, h.x + 60, h.y + 20, false);
    await expect(page.locator('.box[data-box="header"] .ddr-editor, #c-header.ddr-editor')).toHaveClass(
      /ddr-dragin-over/,
    );
    await expect(page.locator(`${C('header')} .ddr-placeholder`)).toBeVisible();
    // 미리보기로 logo 가 밀린다 (모델은 그대로)
    const b = await canvasBox(page, 'body');
    await page.mouse.move(b.x + 60, b.y + 20, { steps: 10 });
    await expect(page.locator(C('header'))).not.toHaveClass(/ddr-dragin-over/);
    await expect(page.locator(`${C('header')} .ddr-placeholder`)).toBeHidden();
    await expectAt(page, 'header', 'logo', 0, 0, 3, 2);
    await expect(page.locator(C('body'))).toHaveClass(/ddr-dragin-over/);
    // 컨테이너 밖(사이드바)으로 나가서 놓는다
    const aside = await box(page, 'aside');
    await page.mouse.move(aside.x + 20, aside.y + 20, { steps: 10 });
    await expect(page.locator('.ddr-dragin-over')).toHaveCount(0);
    await page.mouse.up();
    const total = await page.evaluate(() =>
      (window as any).manager.getAll().reduce((n: number, { editor }: any) => n + editor.getItems().length, 0),
    );
    expect(total).toBe(6);
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);

    // Esc 취소
    await dragPalette(page, 0, b.x + 60, b.y + 20, false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await items(page, 'body')).toHaveLength(3);
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
  });

  test('MC-06 컨테이너 동적 추가/제거와 새 컨테이너로의 드롭', async ({ page }) => {
    await page.fill('#newId', 'side');
    await page.fill('#newCols', '4');
    await page.click('#addContainer');
    expect(await page.evaluate(() => (window as any).manager.getIds())).toEqual(['header', 'body', 'footer', 'side']);
    await page.locator(C('side')).scrollIntoViewIfNeeded();
    const s = await canvasBox(page, 'side');
    await dragPalette(page, 2, s.x + 30, s.y + 20);
    expect(await items(page, 'side')).toHaveLength(1);

    // 중복 id 는 오류를 보여 주고 등록하지 않는다
    await page.fill('#newId', 'side');
    await page.click('#addContainer');
    await expect(page.locator('#status')).toContainText('이미 등록된 컨테이너 id');
    await expect(page.locator('.box[data-box="side"]')).toHaveCount(1);

    await page.click('.box[data-box="body"] [data-act="remove"]');
    expect(await page.evaluate(() => (window as any).manager.getIds())).toEqual(['header', 'footer', 'side']);
    await expect(page.locator(C('body'))).toHaveCount(0);

    await page.click('#removeAll');
    expect(await page.evaluate(() => (window as any).manager.getIds())).toEqual([]);
    await expect(page.locator('.daracl-drift')).toHaveCount(0);
    await page.click('#reRegister');
    expect(await page.evaluate(() => (window as any).manager.getIds())).toEqual(['header', 'body', 'footer']);
    await expectAt(page, 'body', 'chart', 0, 0, 3, 3);
  });

  test('MC-07 컨테이너별 breakpoint: body 만 mobile 로 바꾸면 body 의 배치만 바뀐다', async ({ page }) => {
    await page.selectOption('.box[data-box="body"] [data-act="bp"]', 'mobile');
    expect(await page.evaluate(() => (window as any).manager.get('body').getColumns())).toBe(4);
    expect(await page.evaluate(() => (window as any).manager.get('header').getColumns())).toBe(12);
    // body 의 6열 항목들이 4열 규칙(세로 적층)으로 표시된다
    const it = await items(page, 'body');
    for (const i of it) await expectAt(page, 'body', i.id, i.x, i.y, i.w, i.h);
    expect(it.every((i: any) => i.x + i.w <= 4)).toBe(true);
    await expectAt(page, 'header', 'title', 3, 0, 9, 2);

    // breakpoint 편집 중 드롭하면 그 breakpoint 의 칸에 놓인다
    const b = await canvasBox(page, 'body');
    await dragPalette(page, 2, b.x + 20, b.y + 10);
    const added = (await items(page, 'body')).find((i: any) => i.content === '+ Small (2x1)');
    expect(added.x + added.w).toBeLessThanOrEqual(4);
    const raw = await page.evaluate(() => (window as any).manager.get('body').getLayout().items);
    expect(raw.find((i: any) => i.id === added.id).responsive.mobile).toMatchObject({ x: added.x, y: added.y });
  });

  test('MC-08 전체 JSON 저장/복원과 손상된 JSON 처리', async ({ page }) => {
    await page.click('#save');
    const saved = await page.inputValue('#json');
    const data = JSON.parse(saved);
    expect(data.containers.map((c: any) => c.id)).toEqual(['header', 'body', 'footer']);

    // 변경 후 복원
    await page.click('.box[data-box="header"] [data-act="add"]');
    await page.evaluate(() => (window as any).manager.get('footer').clear());
    await page.click('#restore');
    await expect(page.locator('#status')).toContainText('복원: header, body, footer');
    expect(JSON.parse(await page.evaluate(() => (window as any).manager.toJSON()))).toEqual(data);
    await expectAt(page, 'footer', 'page', 20, 0, 4, 1);

    // 손상된 JSON: 오류를 보여 주고 상태를 바꾸지 않는다
    const before = await page.evaluate(() => (window as any).manager.toJSON());
    await page.fill('#json', '{"version":1,"containers":[{"id":"body","layout":{}},{"id":"nope","layout":{}}]}');
    await page.click('#restore');
    await expect(page.locator('#status')).toHaveClass(/error/);
    await expect(page.locator('#status')).toContainText('등록되지 않은 컨테이너');
    expect(await page.evaluate(() => (window as any).manager.toJSON())).toBe(before);
    // 미등록 무시
    await page.check('#ignoreUnknown');
    await page.click('#restore');
    await expect(page.locator('#status')).toContainText('복원: body');
    expect(await items(page, 'body')).toEqual([]);
  });

  test('MC-09 autoAdd:false 팔레트는 onDrop 의 containerId 로 호출자가 추가한다', async ({ page }) => {
    const h = await canvasBox(page, 'header');
    await dragPalette(page, 3, h.x + 900, h.y + 20);
    const ext = (await items(page, 'header')).filter((i: any) => i.id.startsWith('ext-'));
    expect(ext).toHaveLength(1);
    await expect(page.locator('#events')).toContainText('onDrop header');
    await expect(page.locator('#events')).toContainText('dragInEnd header null');
  });

  test('MC-10 반복 등록/해제 후 document 리스너와 DOM 이 늘지 않는다 (CDP)', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    const count = async () => {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId as string });
      return listeners.length;
    };
    const base = await count();
    await page.evaluate(() => {
      const m = (window as any).manager;
      for (let i = 0; i < 30; i++) {
        const el = document.createElement('div');
        document.body.appendChild(el);
        m.register(`tmp-${i}`, el, { columns: 8 });
      }
    });
    const withMany = await count();
    await page.evaluate(() => {
      const m = (window as any).manager;
      for (let i = 0; i < 30; i++) m.unregister(`tmp-${i}`);
    });
    const after = await count();
    // 에디터 하나당 document 리스너는 Esc 취소용 keydown 하나다
    expect(withMany - base).toBe(30);
    expect(after).toBe(base);
    await cdp.detach();
  });
});
