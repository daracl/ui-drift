import { createDriftEditor } from '@/index';

describe('배경 셀 격자 (CSS 변수)', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => container.remove());

  const canvas = () => container.querySelector('.daracl-drift') as HTMLElement;
  const prop = (name: string) => canvas().style.getPropertyValue(name);
  const svgOf = () => decodeURIComponent(/data:image\/svg\+xml,(.*?)"?\)$/.exec(prop('--ddr-grid-mask'))![1]);

  it('기본으로 켜져 있고 모양은 마스크/크기 CSS 변수, 격자 클래스로 표현된다', () => {
    const editor = createDriftEditor(container, { layout: { columns: 12, rowHeight: 40, gap: 8, items: [] } });
    const m = editor.getMetrics();
    expect(editor.isGrid()).toBe(true);
    expect(canvas().classList.contains('ddr-graph-lines')).toBe(true);
    expect(prop('--ddr-grid-size')).toBe(`${m.cellWidth + m.gap}px 48px`);
    const svg = svgOf();
    expect(svg).toContain(`width="${m.cellWidth + m.gap}"`);
    expect(svg).toContain('height="48"');
    // 모눈종이: 타일의 위/왼쪽 가장자리를 따라 끊김 없는 가로·세로 선
    expect(svg).toContain(`M0 0.25H${m.cellWidth + m.gap}M0.25 0V48`);
    // 얇은 선 (0.5px)
    expect(svg).toContain('stroke-width="0.5"');
    // 선이 간격(gap=8)의 정중앙을 지나도록 반 간격만큼 당긴다
    expect(prop('--ddr-grid-offset')).toBe('-4px');
    // 색은 SVG 에 들어가지 않고 CSS 변수로만 정해진다
    expect(prop('--ddr-grid-color')).toBe('');
    // 예전 방식(인라인 background-image)은 쓰지 않는다
    expect(canvas().style.backgroundImage).toBe('');
    editor.destroy();
  });

  it('grid:false / setGrid 로 끄고 켤 수 있다', () => {
    const editor = createDriftEditor(container, { grid: false });
    expect(canvas().classList.contains('ddr-graph-lines')).toBe(false);
    expect(prop('--ddr-grid-mask')).toBe('');
    editor.setGrid(true);
    expect(canvas().classList.contains('ddr-graph-lines')).toBe(true);
    expect(prop('--ddr-grid-mask')).toContain('svg');
    editor.setGrid(false);
    expect(canvas().classList.contains('ddr-graph-lines')).toBe(false);
    expect(prop('--ddr-grid-mask')).toBe('');
    expect(prop('--ddr-grid-size')).toBe('');
    expect(prop('--ddr-grid-offset')).toBe('');
    editor.destroy();
  });

  it('rowHeight/gap 이 다르면 격자 크기가 따라가고 breakpoint 전환 시 컬럼 수에 맞게 갱신된다', () => {
    const editor = createDriftEditor(container, { layout: { columns: 12, rowHeight: 30, gap: 4, items: [] } });
    expect(prop('--ddr-grid-size').endsWith(' 34px')).toBe(true);
    const before = prop('--ddr-grid-size');
    editor.setBreakpoint('mobile'); // 4열 → 셀 너비가 커진다
    expect(prop('--ddr-grid-size')).not.toBe(before);
    editor.destroy();
  });

  it('gridColor 옵션은 --ddr-grid-color 로 설정되고, 위험한 값은 무시된다', () => {
    const ok = createDriftEditor(container, { gridColor: 'rgb(1, 2, 3)' });
    expect(prop('--ddr-grid-color')).toBe('rgb(1, 2, 3)');
    ok.destroy();

    const evil = createDriftEditor(container, { gridColor: 'red; background:url(//evil)' });
    expect(prop('--ddr-grid-color')).toBe('');
    evil.destroy();

    const quote = createDriftEditor(container, { gridColor: '#fff"/><script>' });
    expect(prop('--ddr-grid-color')).toBe('');
    quote.destroy();
  });

  it('destroy 후에는 DOM 이 정리된다', () => {
    const editor = createDriftEditor(container, {});
    editor.destroy();
    expect(container.querySelector('.daracl-drift')).toBeNull();
  });
});
