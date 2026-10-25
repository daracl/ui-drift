/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, Page, test } from '@playwright/test';
import { box } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/api.html');
  await page.waitForFunction(() => (window as any).__ready === true);
});

const LAYOUT = {
  columns: 12,
  items: [
    { id: 'a', x: 0, y: 0, w: 4, h: 3, content: 'A' },
    { id: 'b', x: 4, y: 0, w: 4, h: 3, content: 'B' },
    { id: 'c', x: 8, y: 0, w: 4, h: 3, content: 'C' },
  ],
};

/** 에디터를 만들고 layoutChange/sizeChange 를 window.log 에 기록한다 */
async function make(page: Page, options: any = {}, layout: any = LAYOUT) {
  await page.evaluate(
    ([l, o]) => {
      const w = window as any;
      w.log = { change: [], size: [] };
      const host = document.getElementById('host')!;
      host.innerHTML = '';
      const opts = { ...o };
      if (opts.__widgets) {
        // 외부 위젯 흉내: 생성/갱신/해제 호출을 window.life 에 기록한다
        delete opts.__widgets;
        w.life = [];
        opts.contentLifecycle = {
          mount: (item: any, el: HTMLElement) => {
            w.life.push('mount:' + item.id);
            el.innerHTML = '<span class="widget"></span>';
            return () => w.life.push('cleanup:' + item.id);
          },
          update: (item: any) => w.life.push('update:' + item.id),
        };
      }
      w.ed = w.Drift.createDriftEditor(host, { layout: l, animate: false, ...opts });
      w.ed.on('layoutChange', (_l: any, info: any) =>
        w.log.change.push({
          reason: info.reason,
          source: info.source,
          added: info.changes.added.map((i: any) => i.id),
          removed: info.changes.removed.map((i: any) => i.id),
          changed: info.changes.changed.map((c: any) => [c.id, c.moved, c.resized]),
        }),
      );
    },
    [layout, options],
  );
}
const log = (page: Page) => page.evaluate(() => (window as any).log);
const frames = (page: Page, n = 3) =>
  page.evaluate(
    (k) =>
      new Promise<void>((res) => {
        const step = (left: number) => requestAnimationFrame(() => (left <= 1 ? res() : step(left - 1)));
        step(k);
      }),
    n,
  );

test.describe('[EXT] 외부 모델 연동 (실제 브라우저)', () => {
  test('EXT-01 history:false: 마우스 드래그는 정상 반영/이벤트(source:user)가 발생하고 이력은 쌓이지 않는다', async ({
    page,
  }) => {
    await make(page, { history: false });
    const m = await page.evaluate(() => (window as any).ed.getMetrics());
    const h = await box(page, '[data-drift-id="a"] .ddr-handle');
    await page.mouse.move(h.x + 20, h.y + 10);
    await page.mouse.down();
    await page.mouse.move(h.x + 20 + 4 * (m.cellWidth + m.gap), h.y + 10, { steps: 8 });
    await page.mouse.up();

    const l = await log(page);
    expect(l.change).toHaveLength(1);
    expect(l.change[0]).toMatchObject({ reason: 'drag', source: 'user' });
    // 사용자가 옮긴 a 와 충돌로 밀려난 b 가 모두 changed 에 있다
    expect(l.change[0].changed.map((c: any) => c[0]).sort()).toEqual(['a', 'b']);
    expect(await page.evaluate(() => ({ undo: (window as any).ed.canUndo(), did: (window as any).ed.undo() }))).toEqual(
      {
        undo: false,
        did: false,
      },
    );
    expect((await page.evaluate(() => (window as any).ed.getItem('a'))).x).toBe(4);
  });

  test('EXT-02 keyboard:false: 방향키/Delete 는 무시하지만 드래그 도중 Esc 취소는 동작한다', async ({ page }) => {
    await make(page, { keyboard: false, removable: true });
    await page.locator('[data-drift-id="b"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Delete');
    expect(await page.evaluate(() => (window as any).ed.getItem('b'))).toMatchObject({ x: 4, w: 4, h: 3 });
    expect((await log(page)).change).toHaveLength(0);

    const h = await box(page, '[data-drift-id="a"] .ddr-handle');
    await page.mouse.move(h.x + 20, h.y + 10);
    await page.mouse.down();
    await page.mouse.move(h.x + 400, h.y + 200, { steps: 6 });
    await expect(page.locator('[data-drift-id="a"]')).toHaveClass(/ddr-dragging/);
    await page.keyboard.press('Escape'); // 키보드를 꺼도 필수 취소 동작은 유지된다
    await page.mouse.up();
    await expect(page.locator('[data-drift-id="a"]')).not.toHaveClass(/ddr-dragging/);
    expect(await page.evaluate(() => (window as any).ed.getItem('a'))).toMatchObject({ x: 0, y: 0 });
    expect((await log(page)).change).toHaveLength(0);

    // 같은 에디터에서 런타임으로 켜면 다시 동작한다
    await page.evaluate(() => (window as any).ed.setKeyboard(true));
    await page.locator('[data-drift-id="b"]').focus();
    await page.keyboard.press('ArrowRight');
    expect((await page.evaluate(() => (window as any).ed.getItem('b'))).x).toBe(5);
    expect((await log(page)).change[0]).toMatchObject({ reason: 'move', source: 'user' });
  });

  test('EXT-03 순수 이동은 sizeChange 가 없고, 실제 리사이즈만 확정 후 한 번 알린다 (마우스)', async ({ page }) => {
    await make(page);
    await page.evaluate(() => {
      const w = window as any;
      w.log.size = [];
      w.ed.on('sizeChange', (c: any[]) =>
        w.log.size.push(
          c.map((x) => ({
            id: x.id,
            w: x.w,
            h: x.h,
            phase: x.phase,
            cause: x.cause,
            prev: x.previous && { w: x.previous.w, h: x.previous.h },
          })),
        ),
      );
    });
    await frames(page);
    await page.evaluate(() => ((window as any).log.size = [])); // 초기 알림 비우기

    // 순수 이동(충돌로 밀려난 항목 포함)
    const m = await page.evaluate(() => (window as any).ed.getMetrics());
    const h = await box(page, '[data-drift-id="a"] .ddr-handle');
    await page.mouse.move(h.x + 20, h.y + 10);
    await page.mouse.down();
    await page.mouse.move(h.x + 20 + 4 * (m.cellWidth + m.gap), h.y + 10, { steps: 8 });
    await page.mouse.up();
    await frames(page);
    expect((await log(page)).size).toEqual([]);

    // 리사이즈: 도중에는 없고 종료 후 한 번
    const g = await box(page, '[data-drift-id="c"] .ddr-resize-handle[data-dir="se"]');
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 - (m.cellWidth + m.gap), g.y + g.height / 2 + (m.rowHeight + m.gap), {
      steps: 8,
    });
    await frames(page);
    expect((await log(page)).size).toEqual([]);
    await page.mouse.up();
    await frames(page);
    expect((await log(page)).size).toEqual([
      [{ id: 'c', w: 3, h: 4, phase: 'end', cause: 'layout', prev: { w: 4, h: 3 } }],
    ]);
  });

  test("EXT-04 sizeNotify:'live': 도중에는 live 로 프레임마다 합쳐 알리고 종료 후 end 로 확정한다", async ({
    page,
  }) => {
    await make(page, { sizeNotify: 'live' });
    await page.evaluate(() => {
      const w = window as any;
      w.live = [];
      w.ed.on('sizeChange', (c: any[]) => c.forEach((x) => w.live.push({ id: x.id, phase: x.phase, width: x.width })));
    });
    await frames(page);
    await page.evaluate(() => ((window as any).live = []));

    const m = await page.evaluate(() => (window as any).ed.getMetrics());
    const g = await box(page, '[data-drift-id="b"] .ddr-resize-handle[data-dir="se"]');
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 2 * (m.cellWidth + m.gap), g.y + g.height / 2, { steps: 12 });
    await frames(page);
    const during = await page.evaluate(() => (window as any).live);
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((e: any) => e.phase === 'live' && e.id === 'b')).toBe(true);
    expect(during.length).toBeLessThanOrEqual(12); // move 하나당 최대 한 번
    const liveWidth = await page
      .locator('[data-drift-id="b"]')
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    expect(during[during.length - 1].width).toBeCloseTo(liveWidth, 0);

    // 같은 프레임(같은 태스크) 안의 여러 move 는 한 번의 알림으로 합쳐진다
    await page.evaluate(() => ((window as any).live = []));
    await page.evaluate(
      ([x, y]) => {
        const grip = document.querySelector('[data-drift-id="b"] .ddr-resize-handle[data-dir="se"]')!;
        for (let i = 1; i <= 10; i++) {
          grip.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              clientX: x + i * 4,
              clientY: y,
              pointerId: 1,
              pointerType: 'mouse',
            }),
          );
        }
      },
      [g.x + g.width / 2 + 2 * (m.cellWidth + m.gap), g.y + g.height / 2],
    );
    await frames(page);
    expect(await page.evaluate(() => (window as any).live.length)).toBe(1);

    await page.evaluate(() => ((window as any).live = []));
    await page.mouse.up();
    await frames(page);
    const after = await page.evaluate(() => (window as any).live);
    expect(after.pop()).toMatchObject({ id: 'b', phase: 'end' });
  });

  test('EXT-05 컨테이너 폭 변경(ResizeObserver)은 cause:container 로 알리고, 항목별 픽셀 크기가 실제와 맞는다', async ({
    page,
  }) => {
    await make(page);
    await page.evaluate(() => {
      const w = window as any;
      w.ed.on('sizeChange', (c: any[]) =>
        w.log.size.push(c.map((x) => ({ id: x.id, cause: x.cause, width: x.width, height: x.height, w: x.w }))),
      );
    });
    await frames(page);
    await page.evaluate(() => ((window as any).log.size = []));

    await page.evaluate(() => {
      document.getElementById('host')!.style.width = '700px';
    });
    await expect.poll(async () => (await log(page)).size.length).toBeGreaterThan(0);
    await frames(page);
    const events = (await log(page)).size.flat();
    expect(events.map((e: any) => e.id).sort()).toEqual(['a', 'b', 'c']);
    for (const e of events) {
      expect(e.cause).toBe('container');
      const real = await page.locator(`[data-drift-id="${e.id}"]`).evaluate((el) => el.getBoundingClientRect().width);
      expect(e.width).toBeCloseTo(real, 0); // 알린 폭이 실제 렌더링 폭과 같다
    }
    await page.evaluate(() => (document.getElementById('host')!.style.width = ''));
  });

  test('EXT-06 destroy 후에는 예약된 크기 알림이 실행되지 않는다', async ({ page }) => {
    await make(page);
    const called = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const w = window as any;
          let n = 0;
          w.ed.on('sizeChange', () => n++);
          w.ed.resizeItem('a', 6, 3);
          w.ed.destroy(); // 같은 프레임 안에서 파괴
          setTimeout(() => resolve(n), 120);
        }),
    );
    expect(called).toBe(0);
  });

  test('EXT-07 syncItems: DOM 요소와 외부 위젯 인스턴스를 유지하고 추가/제거만 생성·해제한다', async ({ page }) => {
    await make(page, { __widgets: true });
    const ref = await page.evaluate(() => {
      const w = window as any;
      w.life = [];
      w.keep = Array.from(document.querySelectorAll('.ddr-item')).map((e) => e);
      w.widgets = Array.from(document.querySelectorAll('.widget'));
      w.log.change = [];
      return true;
    });
    expect(ref).toBe(true);

    const result = await page.evaluate(() =>
      (window as any).ed.syncItems([
        { id: 'a', x: 0, y: 0, w: 4, h: 3, content: 'A' }, // 변경 없음
        { id: 'b', x: 6, y: 5, w: 6, h: 4, content: 'B' }, // 위치/크기만
        { id: 'd', x: 0, y: 3, w: 4, h: 3, content: 'D' }, // 추가 (c 는 제거)
      ]),
    );
    expect(result).toMatchObject({ changed: true, added: ['d'], removed: ['c'], updated: ['b'] });
    expect(await page.evaluate(() => (window as any).life.sort())).toEqual(['cleanup:c', 'mount:d']);
    const kept = await page.evaluate(() => {
      const w = window as any;
      const els = Array.from(document.querySelectorAll('.ddr-item')) as HTMLElement[];
      return {
        aSame: els.find((e) => e.dataset.driftId === 'a') === w.keep[0],
        bSame: els.find((e) => e.dataset.driftId === 'b') === w.keep[1],
        widgetA: document.querySelector('[data-drift-id="a"] .widget') === w.widgets[0],
        widgetB: document.querySelector('[data-drift-id="b"] .widget') === w.widgets[1],
        cGone: !document.querySelector('[data-drift-id="c"]'),
      };
    });
    expect(kept).toEqual({ aSame: true, bSame: true, widgetA: true, widgetB: true, cGone: true });
    // 한 번의 이벤트, 출처 sync, 이력 없음
    expect((await log(page)).change).toEqual([
      expect.objectContaining({ reason: 'sync', source: 'sync', added: ['d'], removed: ['c'] }),
    ]);
    expect(await page.evaluate(() => (window as any).ed.canUndo())).toBe(false);

    // 화면의 실제 위치도 입력대로 (정확한 복원: 빈 칸이 있어도 압축하지 않는다)
    const bBox = await box(page, '[data-drift-id="b"]');
    const canvas = await box(page, '.daracl-drift');
    const m = await page.evaluate(() => (window as any).ed.getMetrics());
    await expect
      .poll(async () => Math.round((await box(page, '[data-drift-id="b"]')).y - canvas.y))
      .toBe(5 * (m.rowHeight + m.gap));
    expect(Math.round(bBox.x - canvas.x)).toBeGreaterThan(5 * m.cellWidth);
  });

  test('EXT-08 외부 동기화 반복(같은 입력)은 이벤트/DOM 변경 없이 끝난다 (순환 방지)', async ({ page }) => {
    await make(page, {}, { columns: 12, items: [] });
    const mutations = await page.evaluate(() => {
      const w = window as any;
      const items = [
        { id: 'a', x: 0, y: 6, w: 4, h: 2 },
        { id: 'b', x: 4, y: 9, w: 4, h: 2 },
      ];
      w.ed.syncItems(items);
      let count = 0;
      const mo = new MutationObserver((list) => (count += list.length));
      mo.observe(document.getElementById('host')!, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
      for (let i = 0; i < 20; i++) w.ed.syncItems(items);
      const records = mo.takeRecords().length + count;
      mo.disconnect();
      return records;
    });
    expect(mutations).toBe(0);
    expect((await log(page)).change).toHaveLength(1);
    expect(await page.evaluate(() => (window as any).ed.getItems().map((i: any) => i.y))).toEqual([6, 9]);
  });

  test('EXT-09 programmaticEvents:false 는 프로그램 변경을 조용히 적용하고 사용자 조작 이벤트는 유지한다', async ({
    page,
  }) => {
    await make(page, { programmaticEvents: false });
    await page.evaluate(() => {
      const ed = (window as any).ed;
      ed.moveItem('a', 8, 6);
      ed.updateItem('b', { title: 'T' });
      ed.addItem({ id: 'z', w: 2, h: 2 });
    });
    expect((await log(page)).change).toHaveLength(0);
    await expect(page.locator('[data-drift-id="b"] .ddr-title')).toHaveText('T');

    const m = await page.evaluate(() => (window as any).ed.getMetrics());
    const h = await box(page, '[data-drift-id="c"] .ddr-handle');
    await page.mouse.move(h.x + 20, h.y + 10);
    await page.mouse.down();
    await page.mouse.move(h.x + 20 - 2 * (m.cellWidth + m.gap), h.y + 10 + 4 * (m.rowHeight + m.gap), { steps: 8 });
    await page.mouse.up();
    const l = await log(page);
    expect(l.change).toHaveLength(1);
    expect(l.change[0]).toMatchObject({ reason: 'drag', source: 'user' });
  });
});
