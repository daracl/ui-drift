/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from '@playwright/test';

/**
 * 컨테이너 수(1, 5, 10, 25, 50)에 따른 DriftManager 비용과 리소스를 실제 Chromium 에서 측정한다.
 * - 시간: 생성(register), 편집(컨테이너마다 addItem + moveItem), 저장(toJSON), 복원(fromJSON), 제거(unregister)
 *   각 단계 직후 offsetHeight 로 스타일/레이아웃을 강제해 DOM 반영 비용까지 포함한다. 3회 측정의 중앙값.
 * - 공통 팔레트 끌기: 포인터 이동 이벤트 하나의 동기 처리 시간(대상 판정 + 미리보기) 중앙값/상위 5%.
 * - 리소스: document 리스너 수(CDP), 해제 후 남은 DOM/리스너.
 * 수치는 노트북/CI 편차를 감안해 넉넉한 회귀 한도만 검사하고, 실제 값은 콘솔 표로 남긴다(docs/performance.md §7, §8).
 * 측정 전 한 번 워밍업(버리는 실행)하고, 각 개수를 5회 측정해 중앙값을 쓴다. 생성 비용은 같은 실행 안에서
 * Manager 없이 createDriftEditor 로 만드는 대조군(createPlain)과 번갈아 재서, 실행 간 편차와 Manager 비용을 구분한다.
 */
test.use({ viewport: { width: 1280, height: 900 } });

test('여러 컨테이너: 생성/편집/저장/제거 비용과 리소스', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/uitest/multi-container.html');
  await page.waitForFunction(() => (window as any).ready === true);
  // 데모의 기본 컨테이너는 비우고 측정 전용 영역을 쓴다
  await page.evaluate(() => {
    (window as any).manager.destroy();
    document.body.innerHTML =
      '<div id="pal" style="position:fixed;right:0;top:0;width:60px;height:30px">P</div><div id="host"></div>';
  });
  const cdp = await page.context().newCDPSession(page);
  const docListeners = async () => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId as string });
    return listeners.length;
  };
  const baseListeners = await docListeners();

  /** 대조군: 같은 구조의 에디터를 Manager 없이 만든다 (생성 경로 비용만) */
  const createPlain = (count: number) =>
    page.evaluate((cnt) => {
      const { createDriftEditor } = (window as any).Drift;
      const host = document.getElementById('host') as HTMLElement;
      const items = Array.from({ length: 10 }, (_, i) => ({
        id: `i${i}`,
        x: (i % 4) * 3,
        y: Math.floor(i / 4) * 2,
        w: 3,
        h: 2,
        content: `I${i}`,
      }));
      const t = performance.now();
      const eds: any[] = [];
      for (let i = 0; i < cnt; i++) {
        const el = document.createElement('div');
        el.style.cssText = 'height:180px;overflow:auto';
        host.appendChild(el);
        eds.push(createDriftEditor(el, { layout: { columns: 12, rowHeight: 20, items } }));
      }
      void host.offsetHeight;
      const ms = performance.now() - t;
      eds.forEach((e) => e.destroy());
      host.innerHTML = '';
      return ms;
    }, count);

  // 워밍업: JIT/스타일 캐시를 데운 뒤 측정한다 (결과는 버린다)
  await createPlain(25);

  const rows: any[] = [];
  const REPEAT = 5;
  for (const n of [1, 5, 10, 25, 50]) {
    const runs: any[] = [];
    for (let r = 0; r < REPEAT; r++) {
      // 대조군과 Manager 측정의 순서를 번갈아 바꿔 순서 효과를 줄인다
      const plainBefore = r % 2 === 0 ? await createPlain(n) : undefined;
      const created = await page.evaluate((count) => {
        const { createDriftManager } = (window as any).Drift;
        const host = document.getElementById('host') as HTMLElement;
        const m = createDriftManager();
        (window as any).bench = m;
        const items = Array.from({ length: 10 }, (_, i) => ({
          id: `i${i}`,
          x: (i % 4) * 3,
          y: Math.floor(i / 4) * 2,
          w: 3,
          h: 2,
          content: `I${i}`,
        }));
        const force = () => host.offsetHeight;
        let t = performance.now();
        for (let i = 0; i < count; i++) {
          const el = document.createElement('div');
          el.style.cssText = 'height:180px;overflow:auto';
          host.appendChild(el);
          m.register(`c${i}`, el, { layout: { columns: 12, rowHeight: 20, items } });
        }
        force();
        const create = performance.now() - t;
        return { create };
      }, n);
      const listenersWith = await docListeners();
      const timed = await page.evaluate(() => {
        const m = (window as any).bench;
        const host = document.getElementById('host') as HTMLElement;
        const force = () => host.offsetHeight;
        let t = performance.now();
        for (const { editor } of m.getAll()) {
          editor.addItem({ id: 'new', w: 2, h: 2 });
          editor.moveItem('i0', 6, 0);
        }
        force();
        const edit = performance.now() - t;
        t = performance.now();
        const json = m.toJSON();
        const save = performance.now() - t;
        t = performance.now();
        m.fromJSON(json);
        force();
        const restore = performance.now() - t;

        // 공통 팔레트 끌기: 포인터 이동 처리 시간 (컨테이너 수만큼 대상 후보가 있다)
        m.setupDragIn('#pal');
        const pal = document.getElementById('pal') as HTMLElement;
        const ev = (type: string, x: number, y: number, target: Element) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              pointerId: 7,
              pointerType: 'mouse',
              isPrimary: true,
              button: 0,
            }),
          );
        ev('pointerdown', 1250, 10, pal);
        ev('pointermove', 1240, 20, pal);
        const moves: number[] = [];
        for (let i = 0; i < 60; i++) {
          const x = 50 + ((i * 97) % 1100);
          const y = 40 + ((i * 53) % 820);
          const s = performance.now();
          ev('pointermove', x, y, pal);
          moves.push(performance.now() - s);
        }
        ev('pointercancel', 0, 0, pal);
        moves.sort((a, b) => a - b);
        const moveMedian = moves[Math.floor(moves.length / 2)];
        const moveP95 = moves[Math.floor(moves.length * 0.95)];

        // 컨테이너 간 이동 커밋 (API, 두 레이아웃 계산 + 두 에디터 렌더 + 연결 이력)
        let transfer = NaN;
        let undo = NaN;
        const ids = m.getIds();
        if (ids.length > 1) {
          t = performance.now();
          const r = m.transferItem({ from: ids[0], to: ids[1], itemId: 'i1', newId: 'moved' });
          force();
          transfer = performance.now() - t;
          if (!r.moved) throw new Error('transfer 실패: ' + r.reason);
          t = performance.now();
          m.get(ids[1]).undo();
          force();
          undo = performance.now() - t;
        }

        // 포인터 이동 비용: 같은 항목 드래그를 이동 비활성/활성으로 각각 측정 (포인터가 다른 컨테이너 위를 지나간다)
        const dragMoves = (cross: boolean) => {
          m.setCrossContainerDrag(cross);
          const editor = m.get(ids[0]);
          const handle = editor.element.querySelector('[data-drift-id="i2"] .ddr-handle') as HTMLElement;
          const r0 = handle.getBoundingClientRect();
          const pev = (type: string, x: number, y: number) =>
            handle.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                pointerId: 9,
                pointerType: 'mouse',
                isPrimary: true,
                button: 0,
              }),
            );
          pev('pointerdown', r0.left + 5, r0.top + 5);
          pev('pointermove', r0.left + 20, r0.top + 20);
          const list: number[] = [];
          for (let i = 0; i < 60; i++) {
            const x = 50 + ((i * 97) % 1100);
            const y = 40 + ((i * 53) % 820);
            const st = performance.now();
            pev('pointermove', x, y);
            list.push(performance.now() - st);
          }
          pev('pointercancel', 0, 0);
          list.sort((a, b) => a - b);
          return { med: list[30], p95: list[57] };
        };
        const crossOff = dragMoves(false);
        const crossOn = dragMoves(true);
        m.setCrossContainerDrag(false);

        t = performance.now();
        for (const id of m.getIds()) m.unregister(id);
        force();
        const remove = performance.now() - t;
        m.destroy();
        const leftover = document.querySelectorAll('.daracl-drift, .ddr-editor, .ddr-dragin-ghost').length;
        host.innerHTML = '';
        return {
          edit,
          save,
          restore,
          remove,
          moveMedian,
          moveP95,
          leftover,
          transfer,
          undo,
          itemMoveOffMedian: crossOff.med,
          itemMoveOffP95: crossOff.p95,
          itemMoveOnMedian: crossOn.med,
          itemMoveOnP95: crossOn.p95,
        };
      });
      const listenersAfter = await docListeners();
      const createPlainMs = plainBefore ?? (await createPlain(n));
      runs.push({ ...created, ...timed, listenersWith, listenersAfter, createPlain: createPlainMs });
    }
    const med = (k: string) => {
      const v = runs.map((x) => x[k]).sort((a, b) => a - b);
      return Math.round(v[Math.floor(v.length / 2)] * 100) / 100;
    };
    rows.push({
      containers: n,
      createMs: med('create'),
      createPlainMs: med('createPlain'),
      editMs: med('edit'),
      saveMs: med('save'),
      restoreMs: med('restore'),
      removeMs: med('remove'),
      dragMoveMedianMs: med('moveMedian'),
      dragMoveP95Ms: med('moveP95'),
      transferMs: med('transfer'),
      transferUndoMs: med('undo'),
      itemMoveCrossOffMedianMs: med('itemMoveOffMedian'),
      itemMoveCrossOffP95Ms: med('itemMoveOffP95'),
      itemMoveCrossOnMedianMs: med('itemMoveOnMedian'),
      itemMoveCrossOnP95Ms: med('itemMoveOnP95'),
      docListenersAdded: runs[0].listenersWith - baseListeners,
      docListenersLeft: runs[REPEAT - 1].listenersAfter - baseListeners,
      leftoverDom: Math.max(...runs.map((x) => x.leftover)),
    });
  }
  await cdp.detach();
  console.log('[multi-container-perf]\n' + JSON.stringify(rows, null, 1)); // eslint-disable-line no-console

  for (const row of rows) {
    // 리소스: 에디터 하나당 document 리스너는 Esc 취소용 keydown 하나, 해제 후에는 남지 않는다
    expect(row.docListenersAdded).toBe(row.containers);
    expect(row.docListenersLeft).toBe(0);
    expect(row.leftoverDom).toBe(0);
  }
  const big = rows[rows.length - 1];
  // 회귀 한도 (넉넉하게): 50개 컨테이너에서도 포인터 이동 하나가 한 프레임(16ms) 안
  expect(big.dragMoveP95Ms).toBeLessThan(16);
  // 컨테이너 간 이동을 켜도 50개에서 항목 드래그 포인터 이동 하나가 한 프레임(16ms) 안
  expect(big.itemMoveCrossOnP95Ms).toBeLessThan(16);
  expect(big.transferMs).toBeLessThan(100);
  expect(big.createMs).toBeLessThan(3000);
});
