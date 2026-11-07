import {
  CONTAINER_DATA_VERSION,
  createLayout,
  DriftContainerData,
  parseContainerData,
  renderViewer,
  serializeContainerData,
} from '@/index';

const layout = (columns: number, ids: string[]) =>
  createLayout({ columns, items: ids.map((id, i) => ({ id, x: i * 2, y: 0, w: 2, h: 1 })) });

describe('여러 컨테이너 레이아웃 저장 포맷 (core, DOM 없음)', () => {
  const data: DriftContainerData = {
    version: 1,
    containers: [
      { id: 'header', layout: layout(12, ['a', 'b']) },
      { id: 'body', layout: layout(6, ['a']) },
    ],
  };

  it('직렬화/복원 왕복에서 순서와 내용이 유지되고 같은 항목 id 를 허용한다', () => {
    const json = serializeContainerData(data, 2);
    const back = parseContainerData(json);
    expect(CONTAINER_DATA_VERSION).toBe(1);
    expect(back).toEqual(data);
    expect(back.containers.map((c) => c.id)).toEqual(['header', 'body']);
    expect(serializeContainerData(back)).toBe(serializeContainerData(data));
  });

  it('입력을 변경하지 않고, 결과는 입력과 분리된다', () => {
    const input = JSON.parse(JSON.stringify(data));
    const snapshot = JSON.stringify(input);
    const out = parseContainerData(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    out.containers[0].layout.items[0].w = 9;
    expect(input.containers[0].layout.items[0].w).toBe(2);
  });

  it('각 layout 은 parseLayout 규칙으로 보정된다 (겹침 해소)', () => {
    const out = parseContainerData({
      version: 1,
      containers: [
        {
          id: 'x',
          layout: {
            items: [
              { id: 'a', x: 0, y: 0, w: 2, h: 2 },
              { id: 'b', x: 0, y: 0, w: 2, h: 2 },
            ],
          },
        },
      ],
    });
    expect(out.containers[0].layout.items.find((i) => i.id === 'b')?.y).toBe(2);
  });

  it.each([
    ['{bad', '해석할 수 없습니다'],
    [null, '객체여야'],
    [{ version: 0, containers: [] }, 'version: 0'],
    [{ containers: [] }, 'version: undefined'],
    [{ version: 1, containers: {} }, 'containers 는 배열'],
    [{ version: 1, containers: [1] }, 'containers[0] 는 객체'],
    [{ version: 1, containers: [{ id: 3, layout: {} }] }, '컨테이너 id'],
    [
      {
        version: 1,
        containers: [
          { id: 'a', layout: {} },
          { id: 'a', layout: {} },
        ],
      },
      '중복된 컨테이너 id 입니다: a',
    ],
    [{ version: 1, containers: [{ id: 'a', layout: '{x' }] }, '"a" 의 layout 이 올바르지 않습니다'],
  ])('잘못된 입력 %p 은 예외', (input, message) => {
    expect(() => parseContainerData(input)).toThrow(message);
  });

  it('Viewer: 컨테이너마다 다른 scope 를 주면 한 페이지에서 CSS 가 섞이지 않는다', () => {
    const [header, body] = data.containers.map((c) => renderViewer(c.layout, { scope: `ddr-${c.id}` }));
    expect(header.css).toContain('.ddr-header-viewer{');
    expect(header.css).toContain('repeat(12,');
    expect(body.css).toContain('.ddr-body-viewer{');
    expect(body.css).toContain('repeat(6,');
    // 각 CSS 의 모든 규칙은 자기 scope 로만 시작한다
    const selectors = (css: string) => css.match(/(^|})\s*([^{@}]+)\{/g) || [];
    expect(selectors(header.css).every((s) => s.includes('.ddr-header-viewer'))).toBe(true);
    expect(selectors(body.css).every((s) => s.includes('.ddr-body-viewer'))).toBe(true);
    expect(body.html).toContain('class="ddr-body-viewer"');
    expect(() => renderViewer(data.containers[0].layout, { scope: 'bad scope' })).toThrow();
  });
});
