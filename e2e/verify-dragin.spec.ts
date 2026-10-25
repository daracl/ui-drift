/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';
import { box, getItem, hasOverlap } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/editor.html');
  await page.waitForFunction(() => !!(window as any).editor);
});

const count = (page: any) => page.evaluate(() => (window as any).editor.getItems().length);

test.describe('[DIN] 외부 요소를 끌어서 추가', () => {
  test('DIN-01 팔레트 항목을 캔버스 빈 칸으로 끌어 놓으면 data 속성의 크기로 추가된다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const m = await page.evaluate(() => (window as any).editor.getMetrics());
    const canvas = await box(page, '.daracl-drift');
    const src = await box(page, '.pal >> nth=0'); // Chart 3x2
    const before = await count(page);

    await page.mouse.move(src.x + 10, src.y + 10);
    await page.mouse.down();
    // 오른쪽 위 빈 영역(8..10열)의 한가운데로
    const tx = canvas.x + 9 * (m.cellWidth + m.gap) + (3 * (m.cellWidth + m.gap)) / 2;
    const ty = canvas.y + 8 * (m.rowHeight + m.gap) + 40;
    await page.mouse.move(tx, ty, { steps: 12 });

    // 드래그 중: 복제본과 placeholder 가 보이고, 캔버스 하이라이트가 켜진다
    await expect(page.locator('.ddr-dragin-ghost')).toBeVisible();
    await expect(page.locator('.ddr-placeholder')).toBeVisible();
    await expect(page.locator('#editor')).toHaveClass(/ddr-dragin-over/);
    expect(await count(page)).toBe(before); // 모델은 아직 그대로
    expect(
      await page
        .locator('.pal')
        .first()
        .evaluate((el) => el.id),
    ).toBe(''); // 원본은 그대로 남아 있다

    await page.mouse.up();
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
    await expect(page.locator('.ddr-placeholder')).toBeHidden();
    expect(await count(page)).toBe(before + 1);

    const added = await page.evaluate(() => {
      const items = (window as any).editor.getItems();
      return items.find((i: any) => i.title === 'Chart' && i.content === 'New chart');
    });
    expect(added).toMatchObject({ w: 3, h: 2 });
    expect(await hasOverlap(page)).toBe(false);
    // 화면에도 실제로 그려진다 (data 속성 기반 위치)
    await expect(page.locator(`[data-drift-id="${added.id}"]`)).toBeVisible();
    expect(await page.locator('.pal').count()).toBe(3);
    expect(errors).toEqual([]);
  });

  test('DIN-02 기존 항목 위에 놓으면 기존 항목이 비켜가고, 이동 중 미리보기가 보인다', async ({ page }) => {
    const canvas = await box(page, '.daracl-drift');
    const src = await box(page, '.pal >> nth=1'); // Table 4x3
    const a = await getItem(page, 'a');
    await page.mouse.move(src.x + 10, src.y + 10);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 120, canvas.y + 60, { steps: 10 });
    // 미리보기: 모델은 그대로지만 a 의 화면 위치는 아래로 밀려 있다 (data-y 가 바뀜)
    expect(await getItem(page, 'a')).toMatchObject({ x: a.x, y: a.y });
    await expect
      .poll(() => page.locator('[data-drift-id="a"]').evaluate((el) => Number((el as HTMLElement).dataset.y)))
      .toBeGreaterThan(0);
    await page.mouse.up();

    expect(await hasOverlap(page)).toBe(false);
    expect((await getItem(page, 'a')).y).toBeGreaterThan(0);
    expect(await count(page)).toBe(6);
  });

  test('DIN-03 캔버스 밖에서 놓거나 Esc 로 취소하면 추가되지 않고 밀린 항목이 원위치로 돌아온다', async ({ page }) => {
    const canvas = await box(page, '.daracl-drift');
    const src = await box(page, '.pal >> nth=0');
    const before = await page.evaluate(() => (window as any).editor.getLayout());

    // 캔버스 위로 갔다가 밖에서 놓기
    await page.mouse.move(src.x + 10, src.y + 10);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 100, canvas.y + 40, { steps: 8 });
    await page.mouse.move(canvas.x + 100, canvas.y + canvas.height + 300, { steps: 8 });
    await expect(page.locator('#editor')).not.toHaveClass(/ddr-dragin-over/);
    await page.mouse.up();
    expect(await page.evaluate(() => (window as any).editor.getLayout())).toEqual(before);

    // Esc
    await page.mouse.move(src.x + 10, src.y + 10);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 100, canvas.y + 40, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await page.evaluate(() => (window as any).editor.getLayout())).toEqual(before);
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
    // 화면상의 위치도 원래대로
    expect(await page.locator('[data-drift-id="a"]').evaluate((el) => (el as HTMLElement).dataset.y)).toBe('0');
  });

  test('DIN-04 연속으로 여러 개를 끌어다 놓아도 고유 id 로 겹침 없이 추가되고 undo 로 하나씩 되돌아간다', async ({
    page,
  }) => {
    const canvas = await box(page, '.daracl-drift');
    const before = await count(page);
    for (let i = 0; i < 4; i++) {
      const src = await box(page, `.pal >> nth=${i % 3}`);
      await page.mouse.move(src.x + 10, src.y + 10);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 150 + i * 120, canvas.y + 80 + i * 40, { steps: 6 });
      await page.mouse.up();
    }
    const ids = await page.evaluate(() => (window as any).editor.getItems().map((i: any) => i.id));
    expect(ids).toHaveLength(before + 4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(await hasOverlap(page)).toBe(false);
    await page.click('#undo');
    expect(await count(page)).toBe(before + 3);
  });

  test('DIN-05 추가된 항목은 일반 항목처럼 다시 드래그/삭제할 수 있다', async ({ page }) => {
    const canvas = await box(page, '.daracl-drift');
    const src = await box(page, '.pal >> nth=2');
    await page.mouse.move(src.x + 10, src.y + 10);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 1000, canvas.y + 100, { steps: 8 });
    await page.mouse.up();
    const id = await page.evaluate(() => {
      const items = (window as any).editor.getItems();
      return items[items.length - 1].id;
    });
    const h = await box(page, `[data-drift-id="${id}"] .ddr-handle`);
    const x0 = (await getItem(page, id)).x;
    await page.mouse.move(h.x + 15, h.y + 10);
    await page.mouse.down();
    await page.mouse.move(h.x - 200, h.y + 10, { steps: 8 });
    await page.mouse.up();
    expect((await getItem(page, id)).x).toBeLessThan(x0);
    await page.evaluate((i) => (window as any).editor.removeItem(i), id);
    await expect(page.locator(`[data-drift-id="${id}"]`)).toHaveCount(0);
  });

  test('DIN-06 setupDragIn 해제(dispose)와 destroy 후에는 반응하지 않는다', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as any;
      const dispose = w.editor.setupDragIn('.pal');
      dispose(); // 데모가 등록한 것과 별개로 추가 등록 후 해제
    });
    await page.evaluate(() => (window as any).editor.destroy());
    const src = await box(page, '.pal >> nth=0');
    await page.mouse.move(src.x + 10, src.y + 10);
    await page.mouse.down();
    await page.mouse.move(src.x + 300, src.y + 200, { steps: 6 });
    await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
    await page.mouse.up();
    expect(await page.locator('.ddr-item').count()).toBe(0);
  });

  test('DIN-07 원본 요소에 touch-action: none 이 적용된다 (터치 스크롤이 드래그를 가로채지 않음)', async ({ page }) => {
    const ta = await page
      .locator('.pal')
      .first()
      .evaluate((el) => getComputedStyle(el).touchAction);
    expect(ta).toBe('none');
  });

  test.describe('autoAdd:false (외부 모델이 상태를 관리)', () => {
    const dropLog = (page: any) => page.locator('#dropLog');

    async function dragExt(page: any, cellX: number, cellY: number, release = true) {
      const m = await page.evaluate(() => (window as any).editor.getMetrics());
      const canvas = await box(page, '.daracl-drift');
      const src = await box(page, '.pal-ext');
      await page.mouse.move(src.x + 10, src.y + 10);
      await page.mouse.down();
      const stride = m.cellWidth + m.gap;
      await page.mouse.move(
        canvas.x + cellX * stride + (3 * stride) / 2,
        canvas.y + cellY * (m.rowHeight + m.gap) + 40,
        {
          steps: 10,
        },
      );
      if (release) await page.mouse.up();
    }

    test('DIN-08 autoAdd:false: onDrop 정보만 기록되고 레이아웃/이력/dirty/선택이 그대로다', async ({ page }) => {
      await page.uncheck('#extAdd'); // 호출자가 추가하지 않는 모드
      await page.click('[data-drift-id="e"] .ddr-content'); // 선택 상태를 만들어 둔다
      const before = await page.evaluate(() => (window as any).editor.getLayout());
      const events: string[] = [];
      await page.evaluate(() => {
        const w = window as any;
        w.evs = [];
        for (const n of ['add', 'layoutChange', 'select']) w.editor.on(n, () => w.evs.push(n));
        w.editor.on('dragInEnd', (i: any) => w.evs.push(i === null ? 'end:null' : 'end:item'));
      });
      await dragExt(page, 9, 6);

      await expect(dropLog(page)).toContainText('"x":9');
      await expect(dropLog(page)).toContainText('"w":3');
      await expect(dropLog(page)).toContainText('breakpoint=desktop');
      expect(await page.evaluate(() => (window as any).editor.getLayout())).toEqual(before);
      const state = await page.evaluate(() => ({
        undo: (window as any).editor.canUndo(),
        dirty: (window as any).editor.isDirty(),
        sel: (window as any).editor.getSelected()?.id,
        evs: (window as any).evs,
      }));
      expect(state).toEqual({ undo: false, dirty: false, sel: 'e', evs: ['end:null'] });
      expect(events).toEqual([]);
      await expect(page.locator('.ddr-dragin-ghost')).toHaveCount(0);
      await expect(page.locator('.ddr-placeholder')).toBeHidden();
    });

    test('DIN-09 onDrop 안에서 addItem() 을 호출하면 항목이 정확히 하나만 생기고 한 번의 undo 로 되돌아간다', async ({
      page,
    }) => {
      const before = await count(page);
      await page.evaluate(() => {
        (window as any).adds = 0;
        (window as any).editor.on('add', () => (window as any).adds++);
      });
      await dragExt(page, 9, 6);
      expect(await count(page)).toBe(before + 1);
      expect(await page.evaluate(() => (window as any).adds)).toBe(1);
      expect(await hasOverlap(page)).toBe(false);
      const ids = await page.evaluate(() => (window as any).editor.getItems().map((i: any) => i.id));
      expect(ids.filter((i: string) => i.startsWith('ext-'))).toEqual(['ext-1']);
      await expect(page.locator('[data-drift-id="ext-1"]')).toBeVisible();
      await page.click('#undo');
      expect(await count(page)).toBe(before);
    });

    test('DIN-10 충돌 위치에 놓아도 콜백 전에 밀린 항목이 복원되고, 추가하지 않으면 모두 그대로다', async ({
      page,
    }) => {
      await page.uncheck('#extAdd');
      const a = await getItem(page, 'a');
      await dragExt(page, 0, 0); // a 위
      await expect(dropLog(page)).toContainText('onDrop:');
      expect(await getItem(page, 'a')).toMatchObject({ x: a.x, y: a.y });
      await expect(page.locator('[data-drift-id="a"]')).toHaveAttribute('data-y', String(a.y));
      expect(await hasOverlap(page)).toBe(false);
    });

    test('DIN-11 Esc / 캔버스 밖 드롭에서는 onDrop 이 호출되지 않는다', async ({ page }) => {
      await page.uncheck('#extAdd');
      const canvas = await box(page, '.daracl-drift');
      await dragExt(page, 9, 6, false);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(dropLog(page)).toHaveText('onDrop: -');

      const src = await box(page, '.pal-ext');
      await page.mouse.move(src.x + 10, src.y + 10);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 100, canvas.y + 50, { steps: 6 });
      await page.mouse.move(canvas.x + 100, canvas.y + canvas.height + 300, { steps: 6 });
      await page.mouse.up();
      await expect(dropLog(page)).toHaveText('onDrop: -');
      expect(await page.evaluate(() => (window as any).editor.canUndo())).toBe(false);
    });

    test('DIN-12 기본 모드(.pal)는 그대로 드롭당 한 번만 추가된다', async ({ page }) => {
      const before = await count(page);
      const m = await page.evaluate(() => (window as any).editor.getMetrics());
      const canvas = await box(page, '.daracl-drift');
      const src = await box(page, '.pal >> nth=0');
      await page.mouse.move(src.x + 10, src.y + 10);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 9 * (m.cellWidth + m.gap), canvas.y + 6 * (m.rowHeight + m.gap), { steps: 8 });
      await page.mouse.up();
      expect(await count(page)).toBe(before + 1);
      await expect(dropLog(page)).toHaveText('onDrop: -'); // .pal 은 onDrop 이 없다
    });
  });
});
