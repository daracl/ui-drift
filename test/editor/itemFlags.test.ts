import { createDriftEditor, createLayout, parseLayout, renderViewer, resizeItem, updateItem } from '@/index';

describe('item locked / resizable', () => {
  const items = () => [
    { id: 'a', x: 0, y: 0, w: 4, h: 2, resizable: false },
    { id: 'l', x: 4, y: 0, w: 4, h: 2, locked: true },
    { id: 'n', x: 8, y: 0, w: 4, h: 2 },
  ];

  it('core: resizable:false 는 resizeItem 이 거부하지만 updateItem 으로는 바꿀 수 있다', () => {
    expect(resizeItem(items(), 12, 'a', 6, 3)[0]).toMatchObject({ w: 4, h: 2 });
    expect(resizeItem(items(), 12, 'l', 6, 3)[1]).toMatchObject({ w: 4, h: 2 });
    expect(resizeItem(items(), 12, 'n', 3, 3)[2]).toMatchObject({ w: 3, h: 3 });
    expect(updateItem(items(), 12, 'a', { w: 3 })[0].w).toBe(3);
  });

  it('JSON 보정: resizable 은 false 만 보존된다', () => {
    const layout = parseLayout({
      items: [
        { id: 'a', x: 0, y: 0, w: 1, h: 1, resizable: false, locked: true },
        { id: 'b', x: 1, y: 0, w: 1, h: 1, resizable: true },
      ],
    });
    expect(layout.items[0]).toMatchObject({ resizable: false, locked: true });
    expect(layout.items[1]).not.toHaveProperty('resizable');
  });

  it('Viewer 출력에는 영향이 없다', () => {
    expect(renderViewer(createLayout({ items: items() })).html).not.toMatch(/resizable|locked/);
  });

  describe('Editor', () => {
    let container: HTMLElement;
    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });
    afterEach(() => container.remove());

    it('리사이즈 핸들 숨김 클래스와 API 동작', () => {
      const editor = createDriftEditor(container, { layout: { columns: 12, items: items() } });
      const el = (id: string) => container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
      expect(el('a').classList.contains('ddr-no-resize')).toBe(true);
      expect(el('l').classList.contains('ddr-no-resize')).toBe(true);
      expect(el('l').classList.contains('ddr-locked')).toBe(true);
      expect(el('n').classList.contains('ddr-no-resize')).toBe(false);

      editor.resizeItem('a', 6, 3);
      expect(editor.getItem('a')).toMatchObject({ w: 4, h: 2 });
      editor.moveItem('a', 0, 4); // resizable:false 여도 이동은 가능 (아래가 비어 있어 위로 압축됨)
      editor.moveItem('n', 4, 0); // locked 와 겹치는 이동은 거부
      expect(editor.getItem('n')).toMatchObject({ x: 8 });

      // 런타임에 잠금/해제
      editor.updateItem('n', { locked: true });
      expect(el('n').classList.contains('ddr-locked')).toBe(true);
      editor.updateItem('n', { locked: false, resizable: false });
      expect(el('n').classList.contains('ddr-locked')).toBe(false);
      expect(el('n').classList.contains('ddr-no-resize')).toBe(true);
      editor.destroy();
    });
  });
});
