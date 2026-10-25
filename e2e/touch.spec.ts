import { CDPSession, expect, Page, test } from '@playwright/test';
import { box, getItem, hasOverlap, item } from './helpers';

test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/editor.html');
  await page.waitForFunction(() => !!(window as any).editor); // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.selectOption('#bp', 'auto'); // 모바일 폭에 맞는 breakpoint 로 편집
  await page.waitForTimeout(400); // 12열 → 4열 전환 애니메이션 종료 대기
});

/** CDP 로 실제 터치 이벤트를 만든다 (touchstart → pointerdown/pointermove 로 변환된다) */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await send('touchStart', from);
  for (let i = 1; i <= steps; i++) {
    await send('touchMove', {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
  }
  await send('touchEnd');
  await cdp.detach();
}

test.describe('모바일 터치 편집', () => {
  test('모바일 viewport 에서는 4열 breakpoint 가 선택된다', async ({ page }) => {
    expect(await page.evaluate(() => (window as any).editor.getBreakpoint()?.name)).toBe('mobile'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const canvas = await box(page, '.daracl-drift');
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      const b = await box(page, item(id));
      expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    }
  });

  test('핸들을 터치로 끌어 순서를 바꾼다 (해당 breakpoint 에만 저장)', async ({ page }) => {
    const h = await box(page, `${item('b')} .ddr-handle`);
    const a = await box(page, item('a'));
    await swipe(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2, y: a.y + 6 });

    const b = await getItem(page, 'b');
    expect(b.y).toBe(0);
    expect((await getItem(page, 'a')).y).toBeGreaterThan(0);
    expect(await hasOverlap(page)).toBe(false);

    const layout = await page.evaluate(() => (window as any).editor.getLayout()); // eslint-disable-line @typescript-eslint/no-explicit-any
    const stored = layout.items.find((i: { id: string }) => i.id === 'b');
    expect(stored.responsive.mobile.y).toBe(0);
    expect(stored).toMatchObject({ x: 4, y: 0 }); // 기본 레이아웃 유지
  });

  test('본문을 터치로 스와이프하면 드래그 대신 페이지가 스크롤된다', async ({ page }) => {
    const before = await page.evaluate(() => (window as any).editor.getLayout()); // eslint-disable-line @typescript-eslint/no-explicit-any
    // 맨 위에서 시작해 첫 카드의 본문 한가운데를 잡는다 (핸들/리사이즈 핸들/다른 카드와 겹치지 않는 지점)
    await page.evaluate(() => window.scrollTo(0, 0));
    const body = await box(page, `${item('a')} .ddr-content`);
    const from = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await swipe(page, from, { x: from.x, y: Math.max(from.y - 250, 20) });

    expect(await page.evaluate(() => (window as any).editor.getLayout())).toEqual(before); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test('리사이즈 핸들을 터치로 끌어 높이를 바꾼다', async ({ page }) => {
    const m = await page.evaluate(() => (window as any).editor.getMetrics()); // eslint-disable-line @typescript-eslint/no-explicit-any
    const g = await box(page, `${item('a')} .ddr-resize-handle`);
    const start = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    await swipe(page, start, { x: start.x, y: start.y + 2 * (m.rowHeight + m.gap) });

    expect((await getItem(page, 'a')).h).toBe(5);
    expect(await hasOverlap(page)).toBe(false);
  });

  test('핸들/리사이즈 터치 영역이 최소 크기를 만족한다', async ({ page }) => {
    const handle = await box(page, `${item('a')} .ddr-handle`);
    expect(handle.height).toBeGreaterThanOrEqual(24);
    const target = await page.evaluate(() => {
      const el = document.querySelector('[data-drift-id="a"] .ddr-resize-handle') as HTMLElement;
      const after = getComputedStyle(el, '::after');
      return { w: parseFloat(after.width), h: parseFloat(after.height) };
    });
    expect(target.w).toBeGreaterThanOrEqual(44);
    expect(target.h).toBeGreaterThanOrEqual(44);
  });
});
