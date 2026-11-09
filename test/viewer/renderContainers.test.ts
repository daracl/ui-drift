/**
 * @jest-environment jsdom
 */
import {
  createDriftManager,
  createLayout,
  parseContainerData,
  parseLayout,
  renderContainersViewer,
  serializeContainerData,
  serializeLayout,
} from '@/index';
import type { DriftContainerData } from '@/index';

const layout = (rows: number, rowHeight = 30) =>
  createLayout({ columns: 12, rowHeight, gap: 4, breakpoints: [], items: [{ id: 'a', x: 0, y: 0, w: 12, h: rows }] });

const data: DriftContainerData = {
  version: 1,
  containers: [
    { id: 'header', layout: layout(2) },
    { id: 'body', layout: layout(3), height: 'auto' },
    { id: 'side', layout: layout(1), height: 'auto' },
    { id: 'footer<x>', layout: layout(1) },
  ],
};

describe('containers[].height 저장 포맷', () => {
  it("height:'auto' 는 직렬화/복원 왕복에서 유지되고 알 수 없는 값은 버린다", () => {
    const parsed = parseContainerData(serializeContainerData(data));
    expect(parsed.containers.map((c) => c.height)).toEqual([undefined, 'auto', 'auto', undefined]);
    const bad = parseContainerData({ version: 1, containers: [{ id: 'x', layout: layout(1), height: '100px' }] });
    expect(bad.containers[0]).not.toHaveProperty('height');
  });

  it('Manager: register 의 height 옵션과 setContainerHeight 가 getLayouts/toJSON 에 반영된다', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const manager = createDriftManager();
    manager.register('a', '#a', { layout: layout(1), height: 'auto' });
    manager.register('b', '#b', { layout: layout(1) });
    expect(manager.getContainerHeight('a')).toBe('auto');
    expect(manager.getLayouts().containers.map((c) => c.height)).toEqual(['auto', undefined]);
    // 에디터 옵션으로 새지 않는다
    expect(manager.get('a')?.getLayout()).not.toHaveProperty('height');
    expect(manager.setContainerHeight('a', undefined)).toBe(true);
    expect(manager.setContainerHeight('b', 'auto')).toBe(true);
    expect(manager.setContainerHeight('none', 'auto')).toBe(false);
    expect(parseContainerData(manager.toJSON()).containers.map((c) => c.height)).toEqual([undefined, 'auto']);
    manager.destroy();
  });
});

describe('renderContainersViewer', () => {
  it('컨테이너마다 순번 scope 로 렌더링하고 id 는 escape 된다', () => {
    const r = renderContainersViewer(data);
    expect(r.containers.map((c) => c.scope)).toEqual(['ddr-c0', 'ddr-c1', 'ddr-c2', 'ddr-c3']);
    expect(r.html.startsWith('<div class="ddr-containers">')).toBe(true);
    expect(r.html).toContain('data-container-id="footer&lt;x&gt;"');
    expect(r.html).not.toMatch(/style=|<script/);
    // fitHeight 가 아니면 높이 방식 속성/맞춤 CSS 가 없다
    expect(r.html).not.toContain('data-height');
    expect(r.css).not.toContain('grid-template-rows');
  });

  it('fitHeight: auto 컨테이너만 행 수 비율로 남은 높이를 채우고 나머지는 rowHeight 고정 높이다', () => {
    const r = renderContainersViewer(data, { fitHeight: true });
    expect(r.containers.map((c) => [c.id, c.height, c.rows])).toEqual([
      ['header', 'fixed', 2],
      ['body', 'auto', 3],
      ['side', 'auto', 1],
      ['footer<x>', 'fixed', 1],
    ]);
    expect(r.html).toContain('data-container-id="body" data-height="auto" data-rows="3"');
    expect(r.html).toContain('data-container-id="header" data-height="fixed">');
    // 비율: flex-grow = 행 수
    expect(r.css).toContain('.ddr-containers>[data-rows="3"]{flex:3 1 0px}');
    expect(r.css).toContain('.ddr-containers>[data-rows="1"]{flex:1 1 0px}');
    expect(r.css).toContain('.ddr-containers{height:100%;min-height:200px}');
    // auto 컨테이너 안은 행 수로 나눈 fr 행, 고정 컨테이너는 rowHeight 행
    expect(r.css).toContain('.ddr-c1-viewer{height:100%;min-height:0px;grid-template-rows:repeat(3,minmax(0px,1fr))}');
    expect(r.css).not.toMatch(/\.ddr-c0-viewer\{height:100%/);
    expect(r.css).toContain(
      '.ddr-c0-viewer{display:grid;box-sizing:border-box;width:100%;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:30px',
    );
    // 모바일 폭에서는 맞춤을 끈다 (고정 컨테이너도 같은 폭에서 쌓인다)
    expect(r.css).toContain('@media (max-width:767px){.ddr-containers{height:auto;min-height:0}');
    expect(r.css).toMatch(/@media \(max-width:767px\)\{\.ddr-c0-viewer\{grid-template-columns:minmax\(0,1fr\)/);
  });

  it('fitHeight 에서 auto 컨테이너가 없으면 모두 auto 로 본다', () => {
    const none = { ...data, containers: data.containers.map(({ id, layout: l }) => ({ id, layout: l })) };
    const r = renderContainersViewer(none, { fitHeight: { minRowHeight: 10, minHeight: 0 } });
    expect(r.containers.every((c) => c.height === 'auto')).toBe(true);
    expect(r.css).toContain('.ddr-containers{height:100%;min-height:0px}');
    expect(r.css).toContain('repeat(2,minmax(10px,1fr))');
  });

  it('containerGap 은 전체에 한 번 적용되고 잘못된 값이면 기본값(12)이다', () => {
    const base = renderContainersViewer(data);
    expect(base.css).toContain(
      '.ddr-containers{display:flex;flex-direction:column;box-sizing:border-box;width:100%;gap:12px}',
    );
    // containerMargin 이 없으면 margin 규칙/속성이 없다
    expect(base.css).not.toContain('data-margin');
    expect(base.html).not.toContain('data-margin');
    expect(renderContainersViewer(data, { containerGap: 16 }).css).toContain('gap:16px}');
    expect(renderContainersViewer(data, { containerGap: -3 }).css).toContain('gap:12px}');
  });

  it('layout.containerMargin 은 그 컨테이너에만 적용되고 같은 값은 한 규칙으로 묶인다', () => {
    const margins = [10, { bottom: 10 }, 10, { top: -8, left: -4 }];
    const withMargin: DriftContainerData = {
      ...data,
      containers: data.containers.map((c, i) => ({ ...c, layout: { ...c.layout, containerMargin: margins[i] } })),
    };
    const r = renderContainersViewer(withMargin);
    expect(r.containers.map((c) => c.margin)).toEqual([
      '10px 10px 10px 10px',
      '0px 0px 10px 0px',
      '10px 10px 10px 10px',
      '-8px 0px 0px -4px',
    ]);
    expect(r.css.match(/\[data-margin=/g)).toHaveLength(3);
    expect(r.css).toContain('.ddr-containers>[data-margin="0"]{margin:10px 10px 10px 10px}');
    expect(r.css).toContain('.ddr-containers>[data-margin="1"]{margin:0px 0px 10px 0px}');
    expect(r.css).toContain('.ddr-containers>[data-margin="2"]{margin:-8px 0px 0px -4px}');
    expect(r.html).toContain('data-container-id="header" data-margin="0"');
    expect(r.html).toContain('data-container-id="body" data-margin="1"');
    expect(r.html).toContain('data-container-id="side" data-margin="0"');
    expect(r.html).not.toContain('style=');
  });

  it('겹치면 위에 있는(앞 순서) 컨테이너가 위로 온다: z-index = 개수 - 순번', () => {
    const r = renderContainersViewer(data);
    expect(r.containers.map((c) => c.zIndex)).toEqual([4, 3, 2, 1]);
    expect(r.css).toContain('.ddr-containers>.ddr-container{flex:none;min-width:0;position:relative}');
    expect(r.css).toContain('.ddr-containers>:nth-child(1){z-index:4}');
    expect(r.css).toContain('.ddr-containers>:nth-child(4){z-index:1}');
  });

  it('layout.containerMargin 은 레이아웃 검증/복원에서 유지된다 (음수 허용, 잘못된 값은 버림)', () => {
    const parse = (containerMargin: unknown) =>
      parseLayout(serializeLayout(parseLayout({ items: [], containerMargin }))).containerMargin;
    expect(parse(6)).toBe(6);
    expect(parse(-1)).toBe(-1);
    expect(parse({ top: 4, left: -2, right: 'x', bottom: 0 })).toEqual({ top: 4, left: -2, bottom: 0 });
    expect(parse({ left: null, top: NaN })).toBeUndefined();
    expect(parse('8px')).toBeUndefined();
    expect(parseLayout({ items: [], containerMargin: 'x' })).not.toHaveProperty('containerMargin');
    // 컨테이너 묶음 저장 포맷에서도 유지된다
    const parsed = parseContainerData(
      serializeContainerData({
        version: 1,
        containers: [{ id: 'a', layout: { ...layout(1), containerMargin: { bottom: 10 } } }],
      }),
    );
    expect(parsed.containers[0].layout.containerMargin).toEqual({ bottom: 10 });
  });

  it('Manager: register 의 layout.containerMargin 이 에디터 레이아웃에 남고 저장/복원/undo 와 함께 움직인다', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const manager = createDriftManager();
    const a = manager.register('a', '#a', { layout: { ...layout(1), containerMargin: { bottom: 10 } } });
    manager.register('b', '#b', { layout: { columns: 12, containerMargin: 10, items: [] } });
    expect(a.getLayout().containerMargin).toEqual({ bottom: 10 });
    expect(manager.getLayouts().containers.map((c) => c.layout.containerMargin)).toEqual([{ bottom: 10 }, 10]);
    // 편집해도 유지된다
    a.addItem({ id: 'n', w: 2, h: 1 });
    a.undo();
    expect(a.getLayout().containerMargin).toEqual({ bottom: 10 });
    // 반환값을 바꿔도 내부 상태는 그대로다
    (a.getLayout().containerMargin as { bottom: number }).bottom = 99;
    expect(a.getLayout().containerMargin).toEqual({ bottom: 10 });
    // fromJSON 은 레이아웃 전체를 교체하므로 containerMargin 도 바뀐다
    const saved = JSON.parse(manager.toJSON());
    saved.containers[0].layout.containerMargin = -5;
    manager.fromJSON(saved);
    expect(a.getLayout().containerMargin).toBe(-5);
    // Viewer 에 그대로 반영된다
    expect(renderContainersViewer(manager.toJSON()).containers.map((c) => c.margin)).toEqual([
      '-5px -5px -5px -5px',
      '10px 10px 10px 10px',
    ]);
    manager.destroy();
  });

  it('renderContent 는 컨테이너 id 를 함께 받고 잘못된 scope/데이터는 예외', () => {
    const r = renderContainersViewer(data, { scope: 'pg', renderContent: (item, cid) => `<i>${cid}:${item.id}</i>` });
    expect(r.html).toContain('<i>body:a</i>');
    expect(r.css).toContain('.pg-c1-viewer');
    expect(() => renderContainersViewer(data, { scope: 'bad scope' })).toThrow();
    expect(() => renderContainersViewer('{bad')).toThrow();
  });
});
