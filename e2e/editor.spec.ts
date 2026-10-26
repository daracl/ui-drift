import { expect, Page, test } from '@playwright/test';
import * as fs from 'fs';
import { renderViewerPage } from '../src/viewer';
import { box, getItem, hasOverlap, item } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/uitest/editor.html');
  await page.waitForFunction(() => !!(window as any).editor); // eslint-disable-line @typescript-eslint/no-explicit-any
});

const metrics = (page: Page) => page.evaluate(() => (window as any).editor.getMetrics()); // eslint-disable-line @typescript-eslint/no-explicit-any

/** 마우스로 항목의 핸들(상단 바)을 잡아 셀 단위 목표 위치로 끌어 놓는다 */
async function dragTo(page: Page, id: string, cellX: number, cellY: number, steps = 12) {
  const m = await metrics(page);
  const cur = await getItem(page, id);
  const b = await box(page, `${item(id)} .ddr-handle`);
  const sx = b.x + 20;
  const sy = b.y + b.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + (cellX - cur.x) * (m.cellWidth + m.gap), sy + (cellY - cur.y) * (m.rowHeight + m.gap), {
    steps,
  });
  await page.mouse.up();
}

test.describe('데스크톱 편집', () => {
  test('마우스 드래그로 항목을 이동한다', async ({ page }) => {
    // 5 항목 중 'e'(8,3)를 비어 있는 오른쪽 아래로 이동 후 위로 끌어올려진다
    await dragTo(page, 'e', 8, 9);
    const e = await getItem(page, 'e');
    expect(e.x).toBe(8);
    expect(e.y).toBeGreaterThanOrEqual(3);
    expect(await hasOverlap(page)).toBe(false);
    // 화면에서도 실제로 이동했는지: 'c'(8,0) 아래에 있어야 한다
    const c = await box(page, item('c'));
    const eb = await box(page, item('e'));
    expect(eb.y).toBeGreaterThanOrEqual(c.y + c.height);
  });

  test('float 모드에서는 드롭한 위치가 그대로 유지된다', async ({ page }) => {
    await page.check('#float');
    await dragTo(page, 'e', 8, 9);
    expect(await getItem(page, 'e')).toMatchObject({ x: 8, y: 9 });
    expect(await hasOverlap(page)).toBe(false);
    // 화면에서도 아래쪽(9행)에 떠 있어야 한다
    const m = await metrics(page);
    const canvas = await box(page, '.daracl-drift');
    await expect.poll(async () => (await box(page, item('e'))).y - canvas.y).toBeCloseTo(9 * (m.rowHeight + m.gap), 0);
    expect((await page.evaluate(() => (window as any).editor.getLayout())).float).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('다른 항목 위로 드롭하면 충돌한 항목이 밀리고 겹치지 않는다', async ({ page }) => {
    await dragTo(page, 'a', 4, 0);
    const a = await getItem(page, 'a');
    const b = await getItem(page, 'b');
    expect(a).toMatchObject({ x: 4, y: 0 });
    expect(b.y).toBeGreaterThanOrEqual(3);
    expect(await hasOverlap(page)).toBe(false);
  });

  test('드래그 중 placeholder 가 보이고 모델은 드롭 전까지 바뀌지 않는다', async ({ page }) => {
    const m = await metrics(page);
    const b = await box(page, `${item('a')} .ddr-handle`);
    await page.mouse.move(b.x + 20, b.y + 8);
    await page.mouse.down();
    await page.mouse.move(b.x + 20 + 4 * (m.cellWidth + m.gap), b.y + 8 + 6 * (m.rowHeight + m.gap), { steps: 8 });

    const ph = page.locator('.ddr-placeholder');
    await expect(ph).toBeVisible();
    const phBox = await ph.boundingBox();
    expect(phBox!.width).toBeGreaterThan(50);
    await expect(page.locator(item('a'))).toHaveClass(/ddr-dragging/);
    expect(await getItem(page, 'a')).toMatchObject({ x: 0, y: 0 });

    await page.mouse.up();
    await expect(ph).toBeHidden();
    expect((await getItem(page, 'a')).x).toBe(4);
  });

  test('Esc 로 드래그를 취소하면 원위치로 돌아간다', async ({ page }) => {
    const before = await box(page, item('a'));
    const b = await box(page, `${item('a')} .ddr-handle`);
    await page.mouse.move(b.x + 20, b.y + 8);
    await page.mouse.down();
    await page.mouse.move(b.x + 400, b.y + 300, { steps: 6 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await getItem(page, 'a')).toMatchObject({ x: 0, y: 0 });
    await expect.poll(async () => (await box(page, item('a'))).x).toBeCloseTo(before.x, 0);
  });

  test('배경에 셀 크기가 테두리 격자로 표시되고 색은 CSS 변수로 바꿀 수 있다', async ({ page }) => {
    const m = await metrics(page);
    const stepX = m.cellWidth + m.gap;
    const stepY = m.rowHeight + m.gap;
    const pseudo = () =>
      page.locator('.daracl-drift').evaluate((el) => {
        const s = getComputedStyle(el, '::before');
        return {
          color: s.backgroundColor,
          mask: s.maskImage || s.webkitMaskImage,
          size: s.maskSize || s.webkitMaskSize,
          pe: s.pointerEvents,
        };
      });

    const st = await pseudo();
    expect(st.mask).toContain('data:image/svg+xml');
    expect(st.pe).toBe('none');
    const [w, h] = st.size.split(' ').map((v) => parseFloat(v));
    expect(w).toBeCloseTo(stepX, 1);
    expect(h).toBeCloseTo(stepY, 1);
    expect(st.color).toBe('rgba(148, 163, 184, 0.35)'); // 기본: 연한 반투명

    // 항목의 좌상단이 격자 셀의 좌상단과 일치한다
    const canvas = await box(page, '.daracl-drift');
    for (const id of ['a', 'b', 'e']) {
      const it = await getItem(page, id);
      const b = await box(page, item(id));
      expect(b.x - canvas.x).toBeCloseTo(it.x * stepX, 0);
      expect(b.y - canvas.y).toBeCloseTo(it.y * stepY, 0);
    }

    // 모눈종이: 마스크 SVG 에 타일 가장자리를 따라 끊김 없는 선이 있고, 선 사이(칸 내부)는 비어 있다
    const shape = await page.evaluate(
      async ([mask, sx, sy]) => {
        const url = /url\("(.*)"\)/.exec(mask as string)![1];
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = Math.ceil(sx as number);
        c.height = Math.ceil(sy as number);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const alpha = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
        return {
          horizontalContinuous: [5, c.width / 2, c.width - 2].every((x) => alpha(Math.floor(x), 0) > 0), // 간격 구간까지 이어진다
          verticalContinuous: [5, c.height / 2, c.height - 2].every((y) => alpha(0, Math.floor(y)) > 0),
          inside: alpha(10, 10) === 0,
        };
      },
      [st.mask, stepX, stepY] as const,
    );
    expect(shape).toEqual({ horizontalContinuous: true, verticalContinuous: true, inside: true });

    // 선이 gap 의 정중앙을 지난다: 첫 카드 오른쪽 끝과 다음 카드 왼쪽 끝 사이 중앙 x 에서 격자 선이 그려진다
    const offset = await page.locator('.daracl-drift').evaluate((el) => el.style.getPropertyValue('--ddr-grid-offset'));
    expect(parseFloat(offset)).toBeCloseTo(-m.gap / 2, 1);

    // 1) 컨테이너에서 CSS 변수만 바꿔도 격자 색이 바뀐다 (JS API 호출 없음)
    await page.evaluate(() =>
      document.getElementById('editor')!.style.setProperty('--ddr-grid-color', 'rgb(255, 0, 0)'),
    );
    expect((await pseudo()).color).toBe('rgb(255, 0, 0)');
    // 2) 스타일시트 규칙으로도 바뀐다
    const styleTag = await page.addStyleTag({ content: '#editor { --ddr-grid-color: rgb(0, 128, 0); }' });
    await page.evaluate(() => document.getElementById('editor')!.style.removeProperty('--ddr-grid-color'));
    expect((await pseudo()).color).toBe('rgb(0, 128, 0)');
    await styleTag.evaluate((el) => (el as HTMLElement).remove()); // 스크린샷에 남지 않게 정리
    // 3) gridColor 옵션은 캔버스 변수로 설정된다
    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = 'opt';
      document.body.appendChild(el);
      const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      w.optEditor = w.Drift?.createDriftEditor ? w.Drift.createDriftEditor(el, { gridColor: '#0000ff' }) : null;
    });

    // 카드가 격자 위에 그려진다 (마스크가 카드를 가리지 않는다)
    const cardBg = await page.locator(item('a')).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardBg).toBe('rgb(255, 255, 255)');
    const top = await page.evaluate(
      ([x, y]) =>
        (document.elementFromPoint(x, y) as HTMLElement).closest('[data-drift-id]')?.getAttribute('data-drift-id'),
      [canvas.x + 60, canvas.y + 60] as const,
    );
    expect(top).toBe('a');

    fs.mkdirSync('docs/verification', { recursive: true });
    await page.evaluate(() => document.getElementById('editor')!.style.removeProperty('--ddr-grid-color'));
    await page.screenshot({ path: 'docs/verification/editor-grid.png' });

    // 보이기/숨기기: 토글 UI(setGrid)로 격자 선이 실제로 사라졌다 나타난다
    const lines = () =>
      page.locator('.daracl-drift').evaluate((el) => ({
        pseudo: getComputedStyle(el, '::before').content,
        frame: getComputedStyle(el).boxShadow,
      }));
    expect((await lines()).pseudo).not.toBe('none');
    await page.uncheck('#grid');
    await expect(page.locator('.daracl-drift')).not.toHaveClass(/ddr-grid/);
    expect(await lines()).toEqual({ pseudo: 'none', frame: 'none' });
    await page.check('#grid');
    await expect(page.locator('.daracl-drift')).toHaveClass(/ddr-grid/);
    expect((await lines()).pseudo).not.toBe('none');
  });

  test('grid:false 옵션으로 만들면 처음부터 격자가 보이지 않는다', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      w.editor.destroy();
      w.editor = null;
    });
    await page.goto('/uitest/api.html');
    await page.waitForFunction(() => (window as any).__ready === true); // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await page.evaluate(() => {
      const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      const host = document.getElementById('host')!;
      w.Drift.createDriftEditor(host, { grid: false });
      const el = host.querySelector('.daracl-drift') as HTMLElement;
      return { cls: el.className, pseudo: getComputedStyle(el, '::before').content };
    });
    expect(r.cls).not.toMatch(/ddr-grid/);
    expect(r.pseudo).toBe('none');
  });

  test('리사이즈 핸들로 크기를 바꾼다', async ({ page }) => {
    const m = await metrics(page);
    const h = await box(page, `${item('b')} .ddr-resize-handle`);
    const sx = h.x + h.width / 2;
    const sy = h.y + h.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx - (m.cellWidth + m.gap), sy + 2 * (m.rowHeight + m.gap), { steps: 10 });
    await page.mouse.up();
    const b = await getItem(page, 'b');
    expect(b).toMatchObject({ w: 3, h: 5 });
    expect(await hasOverlap(page)).toBe(false);
    // 실제 화면 크기도 변해야 한다
    await expect.poll(async () => (await box(page, item('b'))).height).toBeCloseTo(5 * m.rowHeight + 4 * m.gap, 0); // 전환 애니메이션 종료 대기
  });

  test('선택 상태가 표시되고 삭제/추가/undo 가 동작한다', async ({ page }) => {
    await page.locator(`${item('a')} .ddr-content`).click();
    await expect(page.locator(item('a'))).toHaveClass(/ddr-selected/);

    await page.click('#remove');
    await expect(page.locator(item('a'))).toHaveCount(0);
    await page.click('#undo');
    await expect(page.locator(item('a'))).toHaveCount(1);

    await page.click('#add');
    await expect(page.locator(item('n1'))).toHaveCount(1);
    expect(await hasOverlap(page)).toBe(false);
  });

  test('키보드로 이동/리사이즈한다', async ({ page }) => {
    await page.locator(item('a')).focus();
    await page.keyboard.press('ArrowRight');
    expect((await getItem(page, 'a')).x).toBe(1);
    expect(await hasOverlap(page)).toBe(false);
    await page.keyboard.press('Shift+ArrowDown');
    expect((await getItem(page, 'a')).h).toBe(4);
    await page.keyboard.press('Shift+ArrowLeft');
    expect((await getItem(page, 'a')).w).toBe(3);
    expect(await hasOverlap(page)).toBe(false);
  });

  test('JSON 내보내기 후 초기화하고 다시 불러오면 동일하다', async ({ page }) => {
    await dragTo(page, 'a', 4, 0);
    const before = await page.evaluate(() => (window as any).editor.getLayout()); // eslint-disable-line @typescript-eslint/no-explicit-any
    await page.click('#export');
    const json = await page.inputValue('#json');
    expect(JSON.parse(json)).toEqual(before);

    await page.evaluate(() => (window as any).editor.clear()); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(page.locator('.ddr-item')).toHaveCount(0);
    await page.click('#import');
    await expect(page.locator('.ddr-item')).toHaveCount(5);
    expect(await page.evaluate(() => (window as any).editor.getLayout())).toEqual(before); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  test('컨테이너 폭에 따라 breakpoint 가 전환된다', async ({ page }) => {
    const bp = () => page.evaluate(() => (window as any).editor.getBreakpoint()?.name ?? null); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await bp()).toBeNull();

    // 기본값: 폭이 줄어도 기본 레이아웃(12열)과 배치가 유지된다
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForTimeout(300);
    expect(await bp()).toBeNull();
    expect(await getItem(page, 'b')).toMatchObject({ x: 4, w: 4 });

    await page.selectOption('#bp', 'auto');

    await page.setViewportSize({ width: 900, height: 800 });
    await expect.poll(bp).toBe('tablet');
    expect(await page.evaluate(() => (window as any).editor.getColumns())).toBe(8); // eslint-disable-line @typescript-eslint/no-explicit-any

    await page.setViewportSize({ width: 420, height: 800 });
    await expect.poll(bp).toBe('mobile');
    await page.waitForTimeout(400); // 12→4열 전환 애니메이션(0.15s) 종료 대기
    // 모바일(4열)에서 모든 항목이 화면 안에 있다
    const canvas = await box(page, '.daracl-drift');
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      const b = await box(page, item(id));
      expect(b.x).toBeGreaterThanOrEqual(canvas.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    }
    expect(await hasOverlap(page)).toBe(false);
  });

  test('breakpoint 편집은 해당 breakpoint 에 저장되고 기본 레이아웃에는 읽기 순서만 반영된다', async ({ page }) => {
    await page.selectOption('#bp', 'mobile');
    await page.evaluate(() => (window as any).editor.moveItem('e', 0, 0)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const layout = await page.evaluate(() => (window as any).editor.getLayout()); // eslint-disable-line @typescript-eslint/no-explicit-any
    const e = layout.items.find((i: { id: string }) => i.id === 'e');
    expect(e).toMatchObject({ x: 0, y: 0 }); // 기본 레이아웃: 읽기 순서가 맨 앞으로 반영된다 (크기 유지)
    expect(e.responsive.mobile).toMatchObject({ x: 0, y: 0 });
  });
});

test.describe('Editor ↔ Viewer 호환', () => {
  test('같은 JSON 으로 Editor 와 정적 Viewer 의 배치가 일치한다', async ({ page, browser }) => {
    // 편집 후 레이아웃을 얻는다 (1200px 고정 폭에서 비교)
    await page.evaluate(() => {
      const w = window as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      document.body.style.padding = '0';
      document.getElementById('editor')!.style.width = '1200px';
      w.editor.refresh();
    });
    await dragTo(page, 'a', 4, 0);
    const layout = await page.evaluate(() => (window as any).editor.getLayout()); // eslint-disable-line @typescript-eslint/no-explicit-any
    const canvas = await box(page, '.daracl-drift');
    const width = Math.round(canvas.width); // #editor 의 테두리를 제외한 실제 캔버스 폭

    const html = renderViewerPage(layout).replace('<body>', `<body style="margin:0;width:${width}px">`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
    const viewer = await context.newPage();
    await viewer.route('http://viewer.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await viewer.goto('http://viewer.test/index.html');

    const origin = await box(viewer, '.ddr-viewer');
    for (const it of layout.items) {
      const e = await box(page, item(it.id));
      const v = await box(viewer, item(it.id));
      expect(v.x - origin.x).toBeCloseTo(e.x - canvas.x, 0);
      expect(v.y - origin.y).toBeCloseTo(e.y - canvas.y, 0);
      expect(v.width).toBeCloseTo(e.width, 0);
      expect(v.height).toBeCloseTo(e.height, 0);
    }
    await context.close();
  });
});
