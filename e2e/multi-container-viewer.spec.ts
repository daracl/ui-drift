/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, Page, test } from '@playwright/test';
import { box } from './helpers';

test.use({ viewport: { width: 1280, height: 1000 } });

const C = (id: string) => `#viewer [data-container-id="${id}"]`;
const GAP = 12;

async function openViewer(page: Page, query = '') {
  await page.goto(`/uitest/multi-container-viewer.html${query}`);
  await page.waitForFunction(() => (window as any).ready === true);
}

/** multi-container 화면에서 저장한다. body 는 기본으로 height:'auto' 다 */
async function saveFromEditor(page: Page, setup?: () => void) {
  await page.goto('/uitest/multi-container.html');
  await page.waitForFunction(() => (window as any).ready === true);
  if (setup) await page.evaluate(setup);
  await page.click('#save');
}

test.describe('multi-container-viewer', () => {
  test('저장한 모든 컨테이너를 표시하고 같은 항목 id 도 컨테이너별로 분리된다', async ({ page }) => {
    await saveFromEditor(page);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('drift:containers') as string).containers[1].height),
    ).toBe('auto');
    await openViewer(page);
    await expect(page.locator('#viewer [data-container-id]')).toHaveCount(3);
    await expect(page.locator(`${C('header')} [data-drift-id="logo"]`)).toHaveText('Logo');
    await expect(page.locator(`${C('body')} [data-drift-id="logo"]`)).toHaveText('Same id');
    const logo = await box(page, `${C('header')} [data-drift-id="logo"]`);
    const title = await box(page, `${C('header')} [data-drift-id="title"]`);
    expect(Math.abs(logo.y - title.y)).toBeLessThan(1);
    expect(title.x).toBeGreaterThan(logo.x);
  });

  test('fitHeight: 고정 컨테이너는 rowHeight 행 높이, auto 컨테이너가 남은 높이를 채운다', async ({ page }) => {
    await saveFromEditor(page);
    await openViewer(page, '?fit=1&h=700');
    const viewer = await box(page, '#viewer');
    const header = await box(page, C('header'));
    const body = await box(page, C('body'));
    const footer = await box(page, C('footer'));
    // header: 2행 × 30 + gap 8(기본), footer: 1행 × 24
    expect(header.height).toBeCloseTo(2 * 30 + 8, 0);
    expect(footer.height).toBeCloseTo(24, 0);
    // auto(body) 는 나머지를 모두 받는다 (테두리 2px 포함)
    expect(body.height).toBeCloseTo(viewer.height - 2 - header.height - footer.height - 2 * GAP, 0);
    // body 안 항목은 행 수(5행)로 나눈 높이를 채운다: chart(3행) + logo(2행) 가 body 높이를 꽉 채운다
    const chart = await box(page, `${C('body')} [data-drift-id="chart"]`);
    const logo = await box(page, `${C('body')} [data-drift-id="logo"]`);
    expect(logo.y + logo.height).toBeCloseTo(body.y + body.height, 0);
    expect(chart.y).toBeCloseTo(body.y, 0);
    // 행 높이 = (body 높이 - 행 사이 gap(8) 4개) / 5
    const row = (body.height - 4 * 8) / 5;
    expect(chart.height).toBeCloseTo(3 * row + 2 * 8, 0);
  });

  test('fitHeight: auto 컨테이너가 여럿이면 행 수 비율로 나눈다', async ({ page }) => {
    await saveFromEditor(page, () => (window as any).manager.setContainerHeight('header', 'auto'));
    await openViewer(page, '?fit=1&h=700');
    const viewer = await box(page, '#viewer');
    const header = await box(page, C('header'));
    const body = await box(page, C('body'));
    const footer = await box(page, C('footer'));
    expect(footer.height).toBeCloseTo(24, 0);
    // header 2행 : body 5행
    expect(header.height + body.height).toBeCloseTo(viewer.height - 2 - footer.height - 2 * GAP, 0);
    expect(body.height / header.height).toBeCloseTo(5 / 2, 1);
  });

  test('fitHeight: 모바일 폭에서는 맞춤을 끄고 rowHeight 로 쌓는다', async ({ page }) => {
    await saveFromEditor(page);
    await page.setViewportSize({ width: 600, height: 900 });
    await openViewer(page, '?fit=1&h=700');
    const chart = await box(page, `${C('body')} [data-drift-id="chart"]`);
    const table = await box(page, `${C('body')} [data-drift-id="table"]`);
    expect(chart.height).toBeCloseTo(3 * 40, 0);
    expect(table.y).toBeGreaterThan(chart.y + chart.height - 1);
  });

  test('잘못된 JSON 은 기존 화면을 유지하고 오류를 표시한다', async ({ page }) => {
    await page.goto('/uitest/multi-container-viewer.html');
    await page.evaluate(() => localStorage.removeItem('drift:containers'));
    await openViewer(page);
    await expect(page.locator('#status')).toContainText('저장된 레이아웃이 없습니다');

    await page.click('summary');
    await page.fill(
      '#json',
      JSON.stringify({
        version: 1,
        containers: [{ id: 'a', layout: { items: [{ id: 'x', x: 0, y: 0, w: 2, h: 1, content: '<b>X</b>' }] } }],
      }),
    );
    await page.click('#apply');
    // 사용자 문자열은 escape 되어 텍스트로 나온다
    await expect(page.locator(`${C('a')} [data-drift-id="x"]`)).toHaveText('<b>X</b>');

    await page.fill('#json', '{bad');
    await page.click('#apply');
    await expect(page.locator('#status')).toHaveClass(/error/);
    await expect(page.locator('#viewer [data-container-id]')).toHaveCount(1);
  });
});
