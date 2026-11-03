import { expect, test } from '@playwright/test';

interface Sample {
  top: number;
  order: string;
  t: number;
}

/** 프레임마다 스크롤 위치와 항목 순서를 기록해 흔들림(스크롤이 되돌아감, 순서가 왔다갔다)을 측정한다 */
async function holdAtEdge(page: import('@playwright/test').Page, edge: 'bottom' | 'top', ms = 1800) {
  const box = await page.locator('#scroller').boundingBox();
  if (!box) throw new Error('#scroller 를 찾을 수 없습니다');
  const startId = edge === 'bottom' ? 'r1' : 'r10';
  if (edge === 'top')
    await page.evaluate(() => ((document.querySelector('#scroller') as HTMLElement).scrollTop = 9999));
  const item = await page.locator(`#scroller [data-id="${startId}"]`).boundingBox();
  if (!item) throw new Error('시작 항목을 찾을 수 없습니다');

  await page.evaluate(() => {
    const el = document.querySelector('#scroller') as HTMLElement;
    const w = window as unknown as { __s: Sample[]; __run: boolean };
    w.__s = [];
    w.__run = true;
    const tick = () => {
      if (!w.__run) return;
      w.__s.push({
        t: performance.now(),
        top: el.scrollTop,
        order: Array.from(el.children)
          .map((c) => (c as HTMLElement).dataset.id)
          .join(','),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2);
  await page.mouse.down();
  await page.mouse.move(item.x + item.width / 2 + 4, item.y + item.height / 2 + 6, { steps: 2 });
  const y = edge === 'bottom' ? box.y + box.height - 6 : box.y + 6;
  await page.mouse.move(item.x + item.width / 2, y, { steps: 8 });
  await page.waitForTimeout(ms);
  await page.mouse.up();

  return page.evaluate(() => {
    const w = window as unknown as { __s: Sample[]; __run: boolean };
    w.__run = false;
    return w.__s;
  });
}

/** 스크롤 방향이 바뀐 횟수와, 같은 항목 순서가 되돌아온 횟수 */
function analyze(samples: Sample[]) {
  let reversals = 0;
  let dir = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = Math.sign(samples[i].top - samples[i - 1].top);
    if (d !== 0) {
      if (dir !== 0 && d !== dir) reversals += 1;
      dir = d;
    }
  }
  const orders: string[] = [];
  samples.forEach((s) => orders[orders.length - 1] !== s.order && orders.push(s.order));
  const flipBacks = orders.filter((o, i) => orders.indexOf(o) !== i).length;
  // 200ms 구간 평균으로 본 최고 스크롤 속도(px/초)
  let maxSpeed = 0;
  for (let i = 0, j = 0; i < samples.length; i++) {
    while (samples[i].t - samples[j].t > 200) j++;
    if (samples[i].t - samples[j].t >= 150) {
      maxSpeed = Math.max(maxSpeed, (Math.abs(samples[i].top - samples[j].top) / (samples[i].t - samples[j].t)) * 1000);
    }
  }
  return {
    maxSpeed: Math.round(maxSpeed),
    reversals,
    flipBacks,
    orderChanges: orders.length - 1,
    maxTop: Math.max(...samples.map((s) => s.top)),
  };
}

test.describe('Sortable 자동 스크롤 안정성', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uitest/sortable.html');
    await page.waitForFunction(() => !!(window as unknown as { lists?: unknown }).lists);
  });

  test('아래 가장자리: 스크롤이 위로 되돌아가지 않고 항목 순서가 왔다갔다하지 않는다', async ({ page }) => {
    const r = analyze(await holdAtEdge(page, 'bottom'));
    console.log('bottom', JSON.stringify(r)); // eslint-disable-line no-console
    expect(r.maxTop).toBeGreaterThan(20);
    expect(r.maxSpeed).toBeGreaterThan(100); // 너무 느려 멈춘 것처럼 보이지 않는다
    expect(r.maxSpeed).toBeLessThan(420); // 이전(프레임당 10px ≈ 600px/초)보다 확실히 느리다
    expect(r.reversals).toBe(0);
    expect(r.flipBacks).toBe(0);
  });

  test('위 가장자리: 스크롤이 아래로 되돌아가지 않고 항목 순서가 왔다갔다하지 않는다', async ({ page }) => {
    const samples = await holdAtEdge(page, 'top');
    const r = analyze(samples);
    console.log('top', JSON.stringify(r)); // eslint-disable-line no-console
    expect(r.reversals).toBe(0);
    expect(r.flipBacks).toBe(0);
  });
});
