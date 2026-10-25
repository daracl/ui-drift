import { createDriftEditor, createLayout, parseLayout, renderViewer, serializeLayout } from '@/index';

describe('item title', () => {
  const layout = createLayout({
    items: [
      { id: 'a', x: 0, y: 0, w: 4, h: 2, title: 'Sales <b>', content: 'body' },
      { id: 'b', x: 4, y: 0, w: 4, h: 2 },
    ],
  });

  it('JSON 왕복에서 유지되고 문자열이 아닌 값은 버려진다', () => {
    expect(parseLayout(serializeLayout(layout)).items[0].title).toBe('Sales <b>');
    const parsed = parseLayout({ items: [{ id: 'x', x: 0, y: 0, w: 1, h: 1, title: 123 }] });
    expect(parsed.items[0]).not.toHaveProperty('title');
  });

  it('Viewer 는 title 을 escape 해 본문 위에 출력하고 없으면 출력하지 않는다', () => {
    const { html, css } = renderViewer(layout);
    expect(html).toContain('<div class="ddr-title">Sales &lt;b&gt;</div>body');
    expect(html.match(/ddr-title/g)).toHaveLength(1);
    expect(css).toContain('.ddr-viewer>.ddr-item>.ddr-title');
  });

  describe('Editor', () => {
    let container: HTMLElement;
    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });
    afterEach(() => container.remove());

    it('핸들 바에 텍스트로 표시되고 updateItem 으로 바꿀 수 있다', () => {
      const editor = createDriftEditor(container, { layout });
      const titleOf = (id: string) => container.querySelector(`[data-drift-id="${id}"] .ddr-title`) as HTMLElement;
      const handleOf = (id: string) => container.querySelector(`[data-drift-id="${id}"] .ddr-handle`) as HTMLElement;

      expect(titleOf('a').textContent).toBe('Sales <b>');
      expect(titleOf('a').querySelector('b')).toBeNull();
      expect(handleOf('a').classList.contains('ddr-handle-empty')).toBe(false);
      expect(handleOf('b').classList.contains('ddr-handle-empty')).toBe(true);
      expect(container.querySelector('[data-drift-id="a"]')!.getAttribute('aria-label')).toBe('Sales <b>');

      editor.updateItem('b', { title: 'New' });
      expect(titleOf('b').textContent).toBe('New');
      expect(editor.getLayout().items[1].title).toBe('New');

      editor.updateItem('b', { title: '' });
      expect(handleOf('b').classList.contains('ddr-handle-empty')).toBe(true);
      editor.destroy();
    });
  });
});
