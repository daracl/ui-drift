import { expect, Page, test } from '@playwright/test';

const order = (page: Page, selector: string): Promise<string[]> =>
  page.$$eval(`${selector} > *`, (els) => els.map((e) => (e as HTMLElement).dataset.id || ''));

/** w4 를 잡고 (dx, dy) 만큼 움직인 뒤 놓을 때까지의 순서 변화를 기록한다 */
async function moveW4(page: Page, dx: number, dy: number) {
  const b = await page.locator('#wrap [data-id="w4"]').boundingBox();
  if (!b) throw new Error('w4 를 찾을 수 없습니다');
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 2, cy - 2, { steps: 2 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await page.waitForTimeout(250);
  const during = await order(page, '#wrap');
  await page.mouse.up();
  return during;
}

test.describe('Sortable flex-wrap: 같은 줄의 항목을 위로 살짝 올려도 순서가 바뀌지 않는다', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uitest/sortable.html');
    await page.waitForFunction(() => !!(window as unknown as { lists?: unknown }).lists);
  });

  const original = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'];

  for (const dy of [-6, -12, -20, -40]) {
    test(`4번을 위로 ${-dy}px 올려도 1번 자리로 가지 않는다`, async ({ page }) => {
      const during = await moveW4(page, 0, dy);
      expect(during).toEqual(original);
      expect(await order(page, '#wrap')).toEqual(original);
    });
  }

  test('같은 줄에서 옆 항목 위로 가면 그 자리로 바뀐다 (정상 동작은 유지)', async ({ page }) => {
    const w2 = await page.locator('#wrap [data-id="w2"]').boundingBox();
    const w4 = await page.locator('#wrap [data-id="w4"]').boundingBox();
    if (!w2 || !w4) throw new Error('항목을 찾을 수 없습니다');
    await moveW4(page, w2.x + w2.width * 0.3 - (w4.x + w4.width / 2), 0);
    expect(await order(page, '#wrap')).toEqual(['w1', 'w4', 'w2', 'w3', 'w5', 'w6', 'w7', 'w8']);
  });

  test('맨 위 줄 위쪽 여백까지 끌어올려도 줄 안에서 이웃 항목을 지나지 않으면 바뀌지 않는다', async ({ page }) => {
    const wrap = await page.locator('#wrap').boundingBox();
    const w4 = await page.locator('#wrap [data-id="w4"]').boundingBox();
    if (!wrap || !w4) throw new Error('요소를 찾을 수 없습니다');
    const during = await moveW4(page, 0, wrap.y + 2 - (w4.y + w4.height / 2));
    expect(during).toEqual(original);
  });
});

/** 프레임마다 #wrap 의 항목 순서를 기록한다 (흔들림 = 짧은 시간에 순서가 왔다갔다하는 것) */
async function recordOrder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __o: string[]; __run: boolean };
    w.__o = [];
    w.__run = true;
    const el = document.querySelector('#wrap') as HTMLElement;
    const tick = () => {
      if (!w.__run) return;
      const o = Array.from(el.children)
        .map((c) => (c as HTMLElement).dataset.id)
        .join(',');
      if (w.__o[w.__o.length - 1] !== o) w.__o.push(o);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopRecord(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __o: string[]; __run: boolean };
    w.__run = false;
    return w.__o;
  });
}

/** from 항목을 잡아 to 항목 위(비율 rx, ry)로 끌어올리고 hold ms 동안 가만히 둔다 */
async function dragOnto(page: Page, from: string, to: string, rx: number, ry: number, hold = 700) {
  const a = await page.locator(`#wrap [data-id="${from}"]`).boundingBox();
  const b = await page.locator(`#wrap [data-id="${to}"]`).boundingBox();
  if (!a || !b) throw new Error('항목을 찾을 수 없습니다');
  await recordOrder(page);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 3, a.y + a.height / 2 - 3, { steps: 2 });
  await page.mouse.move(b.x + b.width * rx, b.y + b.height * ry, { steps: 12 });
  await page.waitForTimeout(hold);
  const settled = await order(page, '#wrap');
  await page.mouse.up();
  return { settled, history: await stopRecord(page) };
}

test.describe('Sortable flex-wrap: 아래 줄 항목을 위 줄로 올릴 때', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uitest/sortable.html');
    await page.waitForFunction(() => !!(window as unknown as { lists?: unknown }).lists);
  });

  for (const [rx, label] of [
    [0.25, '왼쪽'],
    [0.5, '가운데'],
    [0.75, '오른쪽'],
  ] as const) {
    test(`8번을 4번 위(${label})로 올리면 4번 자리로 교체되고 안정된다`, async ({ page }) => {
      const { settled, history } = await dragOnto(page, 'w8', 'w4', rx, 0.5);
      console.log('w8→w4', rx, history.length, settled.join(',')); // eslint-disable-line no-console
      expect(settled).toEqual(['w1', 'w2', 'w3', 'w8', 'w4', 'w5', 'w6', 'w7']);
      expect(history.length).toBeLessThanOrEqual(3); // 원래 → 교체 (흔들리면 순서가 여러 번 바뀐다)
    });

    test(`7번을 3번 위(${label})로 올리면 3번 자리로 교체되고 흔들리지 않는다`, async ({ page }) => {
      const { settled, history } = await dragOnto(page, 'w7', 'w3', rx, 0.5);
      console.log('w7→w3', rx, history.length, settled.join(',')); // eslint-disable-line no-console
      expect(settled).toEqual(['w1', 'w2', 'w7', 'w3', 'w4', 'w5', 'w6', 'w8']);
      expect(history.length).toBeLessThanOrEqual(3);
    });
  }
});

test.describe('Sortable flex-wrap: 모든 칸 사이 이동', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uitest/sortable.html');
    await page.waitForFunction(() => !!(window as unknown as { lists?: unknown }).lists);
  });

  // 4열 x 2행의 8칸. 출발/도착 칸의 모든 조합에서 항목이 포인터가 있는 칸에 도착하고, 멈춘 뒤에는 흔들리지 않아야 한다
  for (const from of [0, 3, 4, 7]) {
    test(`${from + 1}번 칸의 항목을 다른 모든 칸으로 끌어도 도착한 칸에서 안정된다`, async ({ page }) => {
      const cells = await page.$$eval('#wrap > *', (els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
      );
      const id = `w${from + 1}`;
      for (let to = 0; to < cells.length; to++) {
        if (to === from) continue;
        const current = await order(page, '#wrap');
        const start = cells[current.indexOf(id)];
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 3, start.y - 3, { steps: 2 });
        // 정확한 중앙선은 '넘은 것'이 아니므로 이동 방향으로 조금 더 간다
        await page.mouse.move(cells[to].x + (to > current.indexOf(id) ? 6 : -6), cells[to].y, { steps: 14 });
        await page.waitForTimeout(450); // 마지막 이동 애니메이션과 미뤄진 판정이 끝나길 기다린다

        await recordOrder(page);
        await page.waitForTimeout(500); // 포인터를 가만히 두고 흔들림이 없는지 본다
        const hold = await stopRecord(page);
        await page.mouse.up();

        const after = await order(page, '#wrap');
        expect(
          hold.length,
          `${id} → 칸 ${to + 1} 에서 멈춘 동안 순서가 바뀌었다: ${hold.join(' | ')}`,
        ).toBeLessThanOrEqual(1);
        expect(after.indexOf(id), `${id} 가 칸 ${to + 1} 에 도착하지 않았다: ${after.join(',')}`).toBe(to);
        expect([...after].sort()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8']);
        await page.waitForTimeout(220);
      }
    });
  }
});
