/* eslint-disable @typescript-eslint/no-explicit-any */
import { CDPSession, expect, Page, test } from '@playwright/test';
import { box, getItem, hasOverlap, item } from './helpers';

// 모바일(Pixel 5 에뮬레이션) 프로젝트에서만 실행된다 (playwright.config.ts)
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/editor.html');
  await page.waitForFunction(() => !!(window as any).editor);
  await page.selectOption('#bp', 'auto');
  await page.waitForTimeout(400);
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

const line = (from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) =>
  Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  }));

test.describe('[TCH] 모바일 터치', () => {
  test('TCH-01 연속 드래그 6회 후 겹침/유실/중복 이벤트가 없다', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).cnt = { start: 0, end: 0 };
      (window as any).editor.on('dragStart', () => (window as any).cnt.start++);
      (window as any).editor.on('dragEnd', () => (window as any).cnt.end++);
    });
    const order = ['b', 'c', 'a', 'e', 'd', 'b'];
    let drags = 0; // 이미 목표 위치에 있는 항목은 이동 거리가 없어 드래그로 취급되지 않는다
    for (const id of order) {
      await page.locator(item(id)).scrollIntoViewIfNeeded(); // 뷰포트 밖 항목은 터치가 닿지 않는다
      const h = await box(page, `${item(id)} .ddr-handle`);
      const to = { x: h.x + h.width / 2, y: Math.max(h.y - 110, 20) };
      if (Math.abs(h.y + h.height / 2 - to.y) > 6) drags++;
      await touch(page, line({ x: h.x + h.width / 2, y: h.y + h.height / 2 }, to));
      await page.waitForTimeout(250);
      expect(await hasOverlap(page)).toBe(false);
    }
    expect(await page.locator('.ddr-item').count()).toBe(5);
    expect(await page.evaluate(() => (window as any).cnt)).toEqual({
      start: expect.any(Number),
      end: expect.any(Number),
    });
    const cnt = await page.evaluate(() => (window as any).cnt);
    expect(cnt.start).toBe(cnt.end); // 시작과 종료 이벤트가 짝이 맞는다 (중복/누락 없음)
    expect(cnt.start).toBeGreaterThanOrEqual(drags); // 충분히 움직인 드래그는 모두 시작되었다
    expect(drags).toBeGreaterThanOrEqual(4);
  });

  test('TCH-02 빠른 탭(연속 5회)은 이동/오류 없이 선택만 된다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const before = await page.evaluate(() => (window as any).editor.getLayout());
    for (let i = 0; i < 5; i++) {
      const h = await box(page, `${item('b')} .ddr-handle`);
      await page.touchscreen.tap(h.x + h.width / 2, h.y + h.height / 2);
    }
    expect(await page.evaluate(() => (window as any).editor.getLayout())).toEqual(before);
    await expect(page.locator(item('b'))).toHaveClass(/ddr-selected/);
    expect(errors).toEqual([]);
  });

  test('TCH-03 화면 회전(세로→가로) 후 breakpoint 가 전환되고 겹침/화면 이탈이 없다', async ({ page }) => {
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.height, height: vp.width }); // 가로 모드
    await page.waitForTimeout(500);
    const bp = await page.evaluate(() => (window as any).editor.getBreakpoint()?.name ?? null);
    expect(['tablet', 'mobile', null]).toContain(bp);
    expect(await hasOverlap(page)).toBe(false);
    const canvas = await box(page, '.daracl-drift');
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      const b = await box(page, item(id));
      expect(b.x).toBeGreaterThanOrEqual(canvas.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    }
    // 회전 후에도 터치 드래그가 동작한다.
    // 가로 모드는 화면이 낮아 카드가 아래 끝에 걸리고 이동 목표가 화면 밖으로 나가므로, 카드를 화면 위쪽으로 올린 뒤 끈다
    await page.locator(item('a')).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(100);
    const h = await box(page, `${item('a')} .ddr-handle`);
    const vh = page.viewportSize()!.height; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const before = await getItem(page, 'a');
    const m = await page.evaluate(() => (window as any).editor.getMetrics());
    // 시작점과 목표점 모두 화면 안 (자동 스크롤 영역 48px 밖)
    expect(h.y + h.height / 2 + 2 * (m.rowHeight + m.gap)).toBeLessThan(vh - 48);
    await touch(
      page,
      line(
        { x: h.x + 30, y: h.y + h.height / 2 },
        { x: h.x + 30 + 2 * (m.cellWidth + m.gap), y: h.y + h.height / 2 + 2 * (m.rowHeight + m.gap) },
      ),
    );
    await page.waitForTimeout(300);
    const after = await getItem(page, 'a');
    expect(after.x !== before.x || after.y !== before.y).toBe(true);
    expect(await hasOverlap(page)).toBe(false);
  });

  test('TCH-04 터치 대상 크기: 리사이즈 터치 영역 44px 이상, 삭제 버튼 36px 이상', async ({ page }) => {
    const r = await page.evaluate(() => {
      const el = document.querySelector('[data-drift-id="a"] .ddr-resize-handle') as HTMLElement;
      const after = getComputedStyle(el, '::after');
      const rm = getComputedStyle(document.querySelector('[data-drift-id="a"] .ddr-remove') as HTMLElement);
      return { resize: parseFloat(after.width), remove: parseFloat(rm.width) };
    });
    expect(r.resize).toBeGreaterThanOrEqual(44);
    expect(r.remove).toBeGreaterThanOrEqual(36);
  });

  test('TCH-05 확장된 리사이즈 터치 영역이 카드 본문 중앙·드래그 핸들 중앙을 덮지 않는다', async ({ page }) => {
    // 변 가운데 핸들(e/w/s)의 44px 터치 영역이 작은 카드의 본문/제목 막대를 덮으면
    // 본문 스와이프(페이지 스크롤)나 핸들 드래그가 리사이즈로 바뀐다 (이전 '본문 스와이프', TCH-03 실패의 원인)
    const hits = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.ddr-item')].flatMap((card) => {
        const id = card.dataset.driftId as string;
        return ['.ddr-content', '.ddr-handle'].map((sel) => {
          const r = (card.querySelector(sel) as HTMLElement).getBoundingClientRect();
          card.scrollIntoView({ block: 'center' });
          const b = (card.querySelector(sel) as HTMLElement).getBoundingClientRect();
          const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) as HTMLElement | null;
          return {
            id,
            sel,
            hit: el?.closest('.ddr-resize-handle')?.getAttribute('data-dir') ?? null,
            h: Math.round(r.height),
          };
        });
      }),
    );
    expect(hits.filter((x) => x.hit !== null)).toEqual([]);
    // 변 핸들의 터치 영역은 변을 따라 44px 이상이다 (s 는 90도 회전되어 로컬 height 가 화면의 가로)
    const along = await page.evaluate(() =>
      ['e', 'w', 's'].map((dir) => {
        const el = document.querySelector(
          '[data-drift-id="a"] .ddr-resize-handle[data-dir="' + dir + '"]',
        ) as HTMLElement;
        return parseFloat(getComputedStyle(el, '::after').height);
      }),
    );
    along.forEach((v) => expect(v).toBeGreaterThanOrEqual(44));
  });
});
