import { expect, Page, test } from '@playwright/test';

const order = (page: Page, selector: string): Promise<string[]> =>
  page.$$eval(`${selector} > *`, (els) => els.map((e) => (e as HTMLElement).dataset.id || ''));

async function center(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`요소를 찾을 수 없습니다: ${selector}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}

/** from 요소를 잡아 to 요소의 (rx, ry 비율) 위치까지 여러 단계로 끌어 놓는다 */
async function dragTo(page: Page, from: string, to: string, rx = 0.5, ry = 0.75) {
  const a = await center(page, from);
  const b = await center(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 6, a.y + 6, { steps: 2 });
  await page.mouse.move(b.box.x + b.box.width * rx, b.box.y + b.box.height * ry, { steps: 12 });
  await page.waitForTimeout(250); // FLIP 애니메이션이 끝나 위치가 안정되길 기다린다
  await page.mouse.up();
}

test.describe('Sortable', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/uitest/sortable.html');
    await page.waitForFunction(() => !!(window as unknown as { lists?: unknown }).lists);
  });

  test('목록 안에서 위에서 아래로 끌면 순서가 바뀐다', async ({ page }) => {
    await dragTo(page, '#basic [data-id="a"]', '#basic [data-id="c"]');
    expect(await order(page, '#basic')).toEqual(['b', 'c', 'a', 'd']);
  });

  test('아래에서 위로 끌면 앞으로 이동한다', async ({ page }) => {
    await dragTo(page, '#basic [data-id="d"]', '#basic [data-id="a"]', 0.5, 0.25);
    expect(await order(page, '#basic')).toEqual(['d', 'a', 'b', 'c']);
  });

  test('드래그 중 포인터를 따라다니는 복제본이 있고 놓으면 사라진다', async ({ page }) => {
    const a = await center(page, '#basic [data-id="a"]');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + 60, { steps: 5 });
    await expect(page.locator('.dsr-drag')).toHaveCount(1);
    await expect(page.locator('#basic .dsr-ghost')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('.dsr-drag')).toHaveCount(0);
    await expect(page.locator('.dsr-ghost')).toHaveCount(0);
  });

  test('드래그 중인 <li> 복제본에 목록 점이 보이지 않고 원본과 같은 스타일이다', async ({ page }) => {
    const a = await center(page, '#basic [data-id="a"]');
    const original = await page.$eval('#basic [data-id="a"]', (el) => {
      const cs = getComputedStyle(el);
      return {
        listStyleType: cs.listStyleType,
        border: cs.borderTopWidth,
        bg: cs.backgroundColor,
        padding: cs.paddingLeft,
      };
    });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 30, a.y + 40, { steps: 4 });
    const mirror = await page.$eval('.dsr-drag', (el) => {
      const cs = getComputedStyle(el);
      const holder = el.parentElement as HTMLElement;
      const marker = getComputedStyle(el, '::marker');
      return {
        tag: el.tagName,
        holderTag: holder.tagName,
        listStyleType: cs.listStyleType,
        border: cs.borderTopWidth,
        bg: cs.backgroundColor,
        padding: cs.paddingLeft,
        markerContent: marker.content,
        holderPadding: getComputedStyle(holder).paddingLeft,
        holderBorder: getComputedStyle(holder).borderTopWidth,
      };
    });
    await page.mouse.up();
    expect(mirror.tag).toBe('LI');
    expect(mirror.holderTag).toBe('UL'); // 원래 목록과 같은 태그의 홀더 안에 있다
    expect(mirror.listStyleType).toBe('none'); // `.list > li { list-style: none }` 가 복제본에도 적용된다
    expect(mirror.border).toBe(original.border);
    expect(mirror.bg).toBe(original.bg);
    expect(mirror.padding).toBe(original.padding);
    expect(mirror.holderPadding).toBe('0px'); // 홀더의 여백/테두리는 보이지 않는다
    expect(mirror.holderBorder).toBe('0px');
  });

  test('Esc 로 취소하면 원래 순서로 돌아간다', async ({ page }) => {
    const a = await center(page, '#basic [data-id="a"]');
    const c = await center(page, '#basic [data-id="c"]');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 6, a.y + 6, { steps: 2 });
    await page.mouse.move(c.x, c.box.y + c.box.height * 0.8, { steps: 10 });
    await page.waitForTimeout(250);
    expect(await order(page, '#basic')).not.toEqual(['a', 'b', 'c', 'd']);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await order(page, '#basic')).toEqual(['a', 'b', 'c', 'd']);
  });

  test('handle 이 아닌 곳을 잡으면 드래그되지 않는다', async ({ page }) => {
    const row = await center(page, '#handle [data-id="h2"]');
    const target = await center(page, '#handle [data-id="h3"]');
    await page.mouse.move(row.x + 20, row.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.box.y + target.box.height * 0.8, { steps: 8 });
    await page.mouse.up();
    expect(await order(page, '#handle')).toEqual(['h1', 'h2', 'h3']);

    await dragTo(page, '#handle [data-id="h1"] .grip', '#handle [data-id="h2"]');
    expect(await order(page, '#handle')).toEqual(['h2', 'h1', 'h3']);
  });

  test('같은 group 의 두 목록 사이를 오간다', async ({ page }) => {
    await dragTo(page, '#shared-a [data-id="s1"]', '#shared-b [data-id="s4"]', 0.5, 0.75);
    expect(await order(page, '#shared-a')).toEqual(['s2', 's3']);
    expect(await order(page, '#shared-b')).toEqual(['s4', 's1', 's5']);
    await dragTo(page, '#shared-b [data-id="s5"]', '#shared-a [data-id="s2"]', 0.5, 0.25);
    expect(await order(page, '#shared-a')).toEqual(['s5', 's2', 's3']);
  });

  test('group 이 다른 목록 사이에는 이동하지 않는다', async ({ page }) => {
    await dragTo(page, '#basic [data-id="a"]', '#shared-a [data-id="s1"]');
    expect(await order(page, '#basic')).toEqual(['a', 'b', 'c', 'd']);
    expect(await order(page, '#shared-a')).toEqual(['s1', 's2', 's3']);
  });

  test('clone: 원본은 남고 복제본이 대상에 들어가며 대상 쪽에서는 소스로 못 돌려보낸다', async ({ page }) => {
    await dragTo(page, '#clone-src [data-id="k1"]', '#clone-dst [data-id="k9"]');
    expect(await order(page, '#clone-src')).toEqual(['k1', 'k2']);
    // 들어오는 순간 k9 가 밀려나므로 포인터가 자리 표시자 위에 놓인다. 순서가 아니라 구성만 확인한다
    expect((await order(page, '#clone-dst')).sort()).toEqual(['k1', 'k9']);
    await dragTo(page, '#clone-dst [data-id="k1"]', '#clone-src [data-id="k2"]');
    expect(await order(page, '#clone-src')).toEqual(['k1', 'k2']); // put: false
  });

  test('flex-wrap 목록에서 줄을 넘어 이동한다', async ({ page }) => {
    // 1행 첫 칸(w1) 을 2행 항목(w8) 근처로
    const before = await order(page, '#wrap');
    await dragTo(page, '#wrap [data-id="w1"]', '#wrap [data-id="w8"]', 0.8, 0.5);
    const after = await order(page, '#wrap');
    expect(after).not.toEqual(before);
    expect(after.indexOf('w1')).toBeGreaterThan(before.indexOf('w1'));
    expect([...after].sort()).toEqual([...before].sort());
  });

  test('스크롤 영역 가장자리에서 자동 스크롤된다', async ({ page }) => {
    const box = (await center(page, '#scroller')).box;
    const first = await center(page, '#scroller [data-id="r1"]');
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(first.x + 4, first.y + 6, { steps: 2 });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8, { steps: 6 });
    await page.waitForTimeout(700);
    const top = await page.$eval('#scroller', (e) => e.scrollTop);
    await page.mouse.up();
    expect(top).toBeGreaterThan(20);
  });

  test('containment: 포인터를 멀리 밀어도 복제본이 목록 영역 안에 머문다', async ({ page }) => {
    const list = await center(page, '#contained');
    const a = await center(page, '#contained [data-id="c2"]');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 5, a.y + 5, { steps: 2 });
    for (const [dx, dy] of [
      [600, 600],
      [-600, -600],
      [600, -600],
      [-600, 600],
    ]) {
      await page.mouse.move(list.x + dx, list.y + dy, { steps: 6 });
      const m = await page.locator('.dsr-drag').boundingBox();
      if (!m) throw new Error('복제본이 없습니다');
      expect(m.x).toBeGreaterThanOrEqual(list.box.x - 1);
      expect(m.y).toBeGreaterThanOrEqual(list.box.y - 1);
      expect(m.x + m.width).toBeLessThanOrEqual(list.box.x + list.box.width + 1);
      expect(m.y + m.height).toBeLessThanOrEqual(list.box.y + list.box.height + 1);
    }
    await page.mouse.up();
  });

  test('containment: 포인터를 범위 밖으로 밀면 목록의 맨 끝/맨 앞까지 이동한다', async ({ page }) => {
    const list = await center(page, '#contained');
    const first = await center(page, '#contained [data-id="c1"]');
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(first.x + 5, first.y + 5, { steps: 2 });
    await page.mouse.move(list.x, list.box.y + list.box.height + 200, { steps: 12 });
    await page.waitForTimeout(250);
    await page.mouse.up();
    expect(await order(page, '#contained')).toEqual(['c2', 'c3', 'c4', 'c1']);

    const last = await center(page, '#contained [data-id="c1"]');
    await page.mouse.move(last.x, last.y);
    await page.mouse.down();
    await page.mouse.move(last.x + 5, last.y - 5, { steps: 2 });
    await page.mouse.move(list.x, list.box.y - 200, { steps: 12 });
    await page.waitForTimeout(250);
    await page.mouse.up();
    expect(await order(page, '#contained')).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  test("containment: '.zone' 안의 두 목록 사이는 오가고 zone 밖 shared 목록으로는 나가지 못한다", async ({ page }) => {
    await dragTo(page, '#zone-a [data-id="z1"]', '#zone-b [data-id="z3"]');
    expect(await order(page, '#zone-a')).toEqual(['z2']);
    expect((await order(page, '#zone-b')).sort()).toEqual(['z1', 'z3']);

    // zone 밖의 shared-a 위로 끌어도 들어가지 않는다 (같은 group 이지만 범위 밖)
    await dragTo(page, '#zone-a [data-id="z2"]', '#shared-a [data-id="s2"]');
    expect(await order(page, '#shared-a')).toEqual(['s1', 's2', 's3']);
    expect(await order(page, '#zone-a')).toEqual(['z2']);
  });

  test('이벤트 로그: add/remove/update 가 기록된다', async ({ page }) => {
    await dragTo(page, '#shared-a [data-id="s1"]', '#shared-b [data-id="s4"]');
    const log = await page.locator('#log').textContent();
    expect(log).toContain('shared-a→shared-b remove');
    expect(log).toContain('shared-a→shared-b add');
    expect(log).toContain('end');
  });
});
