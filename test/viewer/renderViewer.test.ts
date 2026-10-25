import { createLayout, renderViewer, renderViewerPage } from '@/viewer';

const layout = createLayout({
  columns: 12,
  rowHeight: 48,
  gap: 10,
  items: [
    { id: 'b', x: 4, y: 0, w: 8, h: 2, content: 'B' },
    { id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'A', props: { kind: 'chart', dataSrc: 'x', on: true, nil: null } },
    { id: 'c', x: 0, y: 2, w: 12, h: 3, content: 'C' },
  ],
});

describe('renderViewer', () => {
  const { html, css } = renderViewer(layout);

  it('(y, x) 순서로 정적 HTML 을 만든다', () => {
    expect(html.indexOf('data-drift-id="a"')).toBeLessThan(html.indexOf('data-drift-id="b"'));
    expect(html.indexOf('data-drift-id="b"')).toBeLessThan(html.indexOf('data-drift-id="c"'));
    // 위치/크기는 data 속성으로 표현한다 (인라인 style/항목별 클래스 없음)
    expect(html).toContain('<div class="ddr-item" data-drift-id="a" data-x="0" data-y="0" data-w="4" data-h="2"');
    expect(html).toContain('data-drift-id="b" data-x="4" data-y="0" data-w="8" data-h="2"');
    expect(html).not.toMatch(/style=|ddr-i\d/);
  });

  it('props 는 data-* 속성으로 출력되고 null 은 생략된다', () => {
    expect(html).toContain('data-kind="chart"');
    expect(html).toContain('data-data-src="x"');
    expect(html).toContain('data-on="true"');
    expect(html).not.toContain('data-nil');
  });

  it('CSS Grid 로 위치와 크기를 표현한다', () => {
    expect(css).toContain('.ddr-viewer{display:grid');
    expect(css).toContain('grid-template-columns:repeat(12,minmax(0,1fr))');
    expect(css).toContain('grid-auto-rows:48px;gap:10px');
    // data 속성값 선택자: x→시작 열(1 기반), w→span, y→시작 행, h→span. 같은 값은 한 규칙으로 공유
    expect(css).toContain('.ddr-viewer>[data-x="0"]{grid-column-start:1}');
    expect(css).toContain('.ddr-viewer>[data-x="4"]{grid-column-start:5}');
    expect(css).toContain('.ddr-viewer>[data-w="4"]{grid-column-end:span 4}');
    expect(css).toContain('.ddr-viewer>[data-w="8"]{grid-column-end:span 8}');
    expect(css).toContain('.ddr-viewer>[data-y="0"]{grid-row-start:1}');
    expect(css).toContain('.ddr-viewer>[data-h="2"]{grid-row-end:span 2}');
    expect(css.match(/\[data-h="2"\]/g)).toHaveLength(1);
  });

  it('breakpoint 별 미디어 쿼리를 큰 것부터 만든다', () => {
    const tablet = css.indexOf('@media (max-width:1024px)');
    const mobile = css.indexOf('@media (max-width:640px)');
    expect(tablet).toBeGreaterThan(0);
    expect(mobile).toBeGreaterThan(tablet);
    expect(css).toContain('repeat(4,minmax(0,1fr))');
    // 4열에서는 세로 적층: 두 번째 항목(b)은 3행부터 전폭. breakpoint 값은 data-bp{n}-* 속성에 담긴다
    expect(html).toContain('data-bp1-x="0" data-bp1-y="2" data-bp1-w="4"');
    expect(css).toMatch(/@media \(max-width:640px\)\{[^@]*\[data-bp1-y="2"\]\{grid-row-start:3\}/);
    expect(css).toMatch(/@media \(max-width:640px\)\{[^@]*\[data-bp1-w="4"\]\{grid-column-end:span 4\}/);
  });

  it('breakpoints: [] 이면 미디어 쿼리가 없다', () => {
    expect(renderViewer({ ...layout, breakpoints: [] }).css).not.toContain('@media');
  });

  it('명시한 responsive 값을 사용한다', () => {
    const custom = createLayout({
      columns: 12,
      breakpoints: [{ name: 'phone', maxWidth: 500, columns: 2 }],
      items: [{ id: 'a', x: 0, y: 0, w: 6, h: 2, responsive: { phone: { x: 1, y: 3, w: 1, h: 1 } } }],
    });
    const r = renderViewer(custom);
    expect(r.html).toContain('data-bp0-x="1" data-bp0-y="3" data-bp0-w="1" data-bp0-h="1"');
    expect(r.css).toContain(
      '@media (max-width:500px){.ddr-viewer{grid-template-columns:repeat(2,minmax(0,1fr))}.ddr-viewer>[data-bp0-x="1"]{grid-column-start:2}.ddr-viewer>[data-bp0-y="3"]{grid-row-start:4}.ddr-viewer>[data-bp0-w="1"]{grid-column-end:span 1}.ddr-viewer>[data-bp0-h="1"]{grid-row-end:span 1}}',
    );
  });

  it('scope 로 클래스 충돌을 피하고 위험한 scope 는 거부한다', () => {
    const r = renderViewer(layout, { scope: 'my-board' });
    expect(r.html).toContain('my-board-viewer');
    expect(r.css).toContain('.my-board-viewer');
    expect(() => renderViewer(layout, { scope: 'a{}b' })).toThrow();
    expect(() => renderViewer(layout, { scope: '1a' })).toThrow();
  });

  it('JSON 문자열도 입력으로 받는다 (Editor 저장 데이터 호환)', () => {
    expect(renderViewer(JSON.stringify(layout)).html).toBe(html);
  });

  it('빈 레이아웃도 렌더링한다', () => {
    const empty = renderViewer(createLayout());
    expect(empty.html).toBe('<div class="ddr-viewer"></div>');
    expect(empty.css).toContain('.ddr-viewer');
  });
});

describe('보안', () => {
  const evil = createLayout({
    items: [
      {
        id: '"><script>alert(1)</script>',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        content: '<img src=x onerror=alert(1)>',
        props: { 'x" onload="evil': 'v', title: '" onmouseover="alert(1)', onclick: 'alert(1)' },
      },
    ],
  });
  const { html, css } = renderViewer(evil);

  it('content, id, props 가 escape 된다', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toMatch(/\sonmouseover="/);
    expect(html).not.toContain('onload=');
  });

  it('onclick 도 data-onclick 으로만 출력되어 이벤트 핸들러가 되지 않는다', () => {
    expect(html).toContain('data-onclick="alert(1)"');
    expect(html).not.toMatch(/\sonclick=/);
  });

  it('CSS 에는 사용자 문자열이 들어가지 않는다', () => {
    expect(css).not.toMatch(/script|alert|onerror/i);
  });

  it('페이지는 script 와 인라인 style 속성이 없다', () => {
    const page = renderViewerPage(evil, { title: '<b>t</b>' });
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/\sstyle="/i);
    expect(page).toContain('name="viewport"');
    expect(page).toContain('&lt;b&gt;t&lt;/b&gt;');
  });

  it('cssHref / nonce 모드', () => {
    expect(renderViewerPage(layout, { cssHref: 'a.css' })).toContain('<link rel="stylesheet" href="a.css">');
    expect(renderViewerPage(layout, { cssHref: 'a.css' })).not.toContain('<style');
    expect(renderViewerPage(layout, { nonce: 'n1' })).toContain('<style nonce="n1">');
  });

  it('renderContent 로 신뢰된 HTML 을 직접 만들 수 있다', () => {
    const r = renderViewer(layout, { renderContent: (item) => `<b>${item.id}</b>` });
    expect(r.html).toContain('<b>a</b>');
  });
});
