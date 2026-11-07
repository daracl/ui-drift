/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';

test('반복 등록·해제: GC 후 힙, DOM, 리스너, ResizeObserver, 공유 CSS 측정', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const Native = window.ResizeObserver;
    (window as any).observerStats = { created: 0, active: 0 };
    window.ResizeObserver = class extends Native {
      private live = true;
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        (window as any).observerStats.created++;
        (window as any).observerStats.active++;
      }
      disconnect() {
        if (this.live) (window as any).observerStats.active--;
        this.live = false;
        super.disconnect();
      }
    };
  });
  await page.goto('/uitest/multi-container.html');
  await page.waitForFunction(() => (window as any).ready);
  await page.evaluate(() => {
    (window as any).manager.destroy();
    document.body.innerHTML = '<div id="host"></div><div id="pal">팔레트</div>';
    (window as any).manager = null;
  });
  const cdp = await page.context().newCDPSession(page);
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const counters = await cdp.send('Memory.getDOMCounters');
    return { heapBytes: heap.usedSize, ...counters };
  };
  /** GC 후 살아 있는 클래스 인스턴스 수 (prototype 으로 queryObjects) */
  const liveCount = async (expr: string) => {
    await cdp.send('HeapProfiler.collectGarbage');
    const proto = await cdp.send('Runtime.evaluate', { expression: `${expr}.prototype` });
    const found = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId as string });
    const len = await cdp.send('Runtime.callFunctionOn', {
      objectId: found.objects.objectId as string,
      functionDeclaration: 'function () { return this.length; }',
      returnByValue: true,
    });
    await cdp.send('Runtime.releaseObject', { objectId: found.objects.objectId as string });
    await cdp.send('Runtime.releaseObject', { objectId: proto.result.objectId as string });
    return len.result.value as number;
  };
  // 기준: 하네스 모듈이 들고 있는 (destroy 된) manager 등 반복 전부터 있던 인스턴스
  const base = {
    editors: await liveCount('window.Drift.DriftEditor'),
    managers: await liveCount('window.Drift.DriftManager'),
  };
  const rows = [];
  for (let round = 0; round < 6; round++) {
    const live = await page.evaluate(() => {
      const m = (window as any).Drift.createDriftManager({ crossContainerDrag: true });
      const host = document.getElementById('host')!;
      for (let i = 0; i < 50; i++) {
        const el = document.createElement('div');
        host.append(el);
        m.register(String(i), el, { columns: 12, layout: { items: [{ id: 'same', x: 0, y: 0, w: 2, h: 2 }] } });
      }
      m.setupDragIn('#pal');
      // 컨테이너 간 이동(연결 이력 포함)을 반복한 뒤에도 해제되어야 한다
      for (let i = 0; i < 49; i++)
        m.transferItem({ from: String(i), to: String(i + 1), itemId: 'same', newId: `same-${i}` });
      m.get('49').undo();
      m.get('48').redo();
      const stats = { ...(window as any).observerStats, sheets: document.adoptedStyleSheets.length };
      m.destroy();
      host.replaceChildren();
      return stats;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await page.evaluate(() => ({
      active: (window as any).observerStats.active,
      sheets: document.adoptedStyleSheets.length,
      editors: document.querySelectorAll('.daracl-drift').length,
    }));
    const instances = {
      editors: await liveCount('window.Drift.DriftEditor'),
      managers: await liveCount('window.Drift.DriftManager'),
    };
    rows.push({ round, live, after, instances, ...(await sample()) });
    // 해제된 에디터/Manager 가 어디에서도 참조되지 않는다: 반복해도 기준보다 늘지 않는다
    expect(instances).toEqual(base);
    expect(live.active).toBe(50);
    expect(live.sheets).toBe(1);
    expect(after).toEqual({ active: 0, sheets: 0, editors: 0 });
  }
  console.log('[multi-container-resources]', JSON.stringify({ base, rows }));
  expect(rows[5].jsEventListeners).toBe(rows[1].jsEventListeners);
  expect(rows[5].nodes).toBe(rows[1].nodes);
  await cdp.detach();
});
