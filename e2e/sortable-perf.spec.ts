import { expect, test } from '@playwright/test';

/**
 * 큰 목록(3000개) + 무거운 항목(표, iframe, canvas)에서의 드래그 비용 회귀 검사.
 * 이벤트 핸들러가 동기로 실행되는 시간만 잰다. 수치는 CI 편차를 감안해 넉넉하게 잡았다.
 * (최적화 전 측정값: 이동 상위 5% 130~150ms, 최대 225~263ms, canvas 복사를 켜면 시작이 350~550ms)
 */
test('큰 목록에서도 드래그 시작과 이동이 빠르다', async ({ page }) => {
  await page.goto('/uitest/sortable.html');
  await page.waitForFunction(() => !!(window as unknown as { lists?: unknown }).lists);

  const r = await page.evaluate(async () => {
    const SortableCtor = (window as any).lists.basic.constructor; // eslint-disable-line @typescript-eslint/no-explicit-any
    const ul = document.createElement('ul');
    ul.style.cssText = 'width:420px;margin:0;padding:0;list-style:none';
    const heavy = `<div style="padding:6px"><table>${'<tr><td>cell</td><td>cell</td><td>cell</td></tr>'.repeat(
      30,
    )}</table><iframe src="about:blank" style="width:100%;height:60px"></iframe><canvas width="300" height="80"></canvas></div>`;
    for (let i = 0; i < 3000; i++) {
      const li = document.createElement('li');
      li.dataset.id = 'b' + i;
      li.style.cssText = 'height:34px;border:1px solid #ccc;box-sizing:border-box;overflow:hidden';
      li.innerHTML = i === 0 ? heavy : `<span>Item ${i}</span>`;
      ul.appendChild(li);
    }
    const holder = document.createElement('div');
    holder.style.cssText = 'height:300px;overflow:auto;width:440px';
    holder.appendChild(ul);
    document.body.prepend(holder);
    const sortable = new SortableCtor(ul, { animation: 150 });
    await new Promise((resolve) => setTimeout(resolve, 300)); // 첫 레이아웃이 끝나도록

    const ev = (type: string, x: number, y: number, target: Element | Document) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
        }),
      );
    const first = ul.children[0] as HTMLElement;
    const rect = first.getBoundingClientRect();
    const x = rect.left + 20;
    const y0 = rect.top + 10;
    ev('pointerdown', x, y0, first);
    let t = performance.now();
    ev('pointermove', x + 5, y0 + 5, document);
    const start = performance.now() - t;

    const times: number[] = [];
    let y = y0 + 5;
    for (let i = 0; i < 120; i++) {
      y += 4;
      t = performance.now();
      ev('pointermove', x, Math.min(y, holder.getBoundingClientRect().bottom - 40), document);
      times.push(performance.now() - t);
      if (i % 10 === 9) await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
    ev('pointerup', x, y, document);
    sortable.destroy();
    const sorted = [...times].sort((a, b) => a - b);
    return {
      start,
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted[sorted.length - 1],
      moved: (ul.children[0] as HTMLElement).dataset.id !== 'b0', // 실제로 항목이 교체되었는지
    };
  });

  console.log('perf', JSON.stringify(r)); // eslint-disable-line no-console
  expect(r.moved).toBe(true);
  expect(r.start).toBeLessThan(250); // 복제 비용(canvas 복사 등)이 되살아나면 수백 ms
  expect(r.avg).toBeLessThan(8);
  expect(r.p95).toBeLessThan(60); // 전체 목록 측정/애니메이션이 되살아나면 130~150ms
  expect(r.max).toBeLessThan(150);
});
