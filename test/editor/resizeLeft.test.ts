import { collides, createDriftEditor, DriftEditor, DriftItem } from '@/index';

const CANVAS_WIDTH = 1200;
const CELL = (CANVAS_WIDTH - 8 * 11) / 12;
const STRIDE_X = CELL + 8;
const STRIDE_Y = 48;

function mockRects() {
  return jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.classList.contains('daracl-drift')) {
      return { left: 0, top: 0, width: CANVAS_WIDTH, height: 1000, right: CANVAS_WIDTH, bottom: 1000 } as DOMRect;
    }
    const d = el.dataset;
    const x = Number(d.x ?? 0);
    const y = Number(d.y ?? 0);
    const w = Number(d.w ?? 0);
    const h = Number(d.h ?? 0);
    const left = el.style.left ? parseFloat(el.style.left) : x * STRIDE_X;
    const top = el.style.top ? parseFloat(el.style.top) : y * STRIDE_Y;
    const width = el.style.width ? parseFloat(el.style.width) : w * CELL + (w - 1) * 8;
    const height = el.style.height ? parseFloat(el.style.height) : h * 40 + (h - 1) * 8;
    return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
  });
}

function pointer(target: Element, type: string, x: number, y: number, pointerType = 'mouse') {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

describe('왼쪽 리사이즈 핸들 (sw)', () => {
  let container: HTMLElement;
  let editor: DriftEditor;
  let spy: jest.SpyInstance;

  const create = (options = {}) => {
    editor = createDriftEditor(container, {
      layout: {
        columns: 12,
        items: [
          { id: 'a', x: 0, y: 0, w: 4, h: 2 },
          { id: 'b', x: 4, y: 0, w: 4, h: 2 },
          { id: 'c', x: 8, y: 0, w: 4, h: 2, minW: 3 },
        ],
      },
      ...options,
    });
    return editor;
  };
  const el = (id: string) => container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
  const grip = (id: string, dir: string) =>
    el(id).querySelector(`.ddr-resize-handle[data-dir="${dir}"]`) as HTMLElement;
  const get = (id: string) => editor.getItems().find((i) => i.id === id) as DriftItem;
  const noOverlap = () => {
    const list = editor.getItems();
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) expect(collides(list[i], list[j])).toBe(false);
  };

  /** b 의 좌하단 핸들을 눌러 pointer 를 (dxCells, dyCells) 만큼 옮긴다 */
  const dragLeft = (id: string, dxCells: number, dyCells: number, type = 'mouse') => {
    const it = get(id);
    const sx = it.x * STRIDE_X + 6;
    const sy = (it.y + it.h) * STRIDE_Y - 14;
    pointer(grip(id, 'sw'), 'pointerdown', sx, sy, type);
    pointer(grip(id, 'sw'), 'pointermove', sx - 10, sy + 5, type);
    pointer(grip(id, 'sw'), 'pointermove', sx + dxCells * STRIDE_X, sy + dyCells * STRIDE_Y, type);
    pointer(grip(id, 'sw'), 'pointerup', sx + dxCells * STRIDE_X, sy + dyCells * STRIDE_Y, type);
  };

  beforeEach(() => {
    spy = mockRects();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    editor?.destroy();
    container.remove();
    spy.mockRestore();
  });

  it('기본으로 우하단(se)과 좌하단(sw) 핸들이 모두 있고 resizeHandles 로 고를 수 있다', () => {
    create();
    expect(
      Array.from(el('a').querySelectorAll('.ddr-resize-handle')).map((n) => (n as HTMLElement).dataset.dir),
    ).toEqual(['se', 'sw']);
    editor.destroy();
    container.innerHTML = '';
    create({ resizeHandles: ['sw'] });
    expect(el('a').querySelectorAll('.ddr-resize-handle')).toHaveLength(1);
    expect(grip('a', 'sw')).toBeTruthy();
    editor.destroy();
    container.innerHTML = '';
    create({ resizeHandles: ['se'] });
    expect(grip('a', 'sw')).toBeNull();
  });

  it('왼쪽으로 끌면 오른쪽 가장자리는 고정되고 x 가 줄며 w 가 늘어난다', () => {
    create();
    const events: string[] = [];
    editor.on('resizeStart', () => events.push('start'));
    editor.on('resizeEnd', () => events.push('end'));
    editor.on('layoutChange', (_l, i) => events.push(i.reason));

    dragLeft('b', -2, 1);
    expect(get('b')).toMatchObject({ x: 2, w: 6, h: 3 });
    expect(get('b').x + get('b').w).toBe(8); // 오른쪽 가장자리 고정
    noOverlap();
    expect(events).toEqual(['start', 'resize', 'end']);
  });

  it('오른쪽으로 끌면 폭이 줄고 x 가 늘어난다 (오른쪽 고정)', () => {
    create();
    dragLeft('b', 2, 0);
    expect(get('b')).toMatchObject({ x: 6, w: 2 });
    expect(get('b').x + get('b').w).toBe(8);
  });

  it('왼쪽 경계와 min 폭을 지킨다', () => {
    create();
    dragLeft('b', -20, 0); // 화면 왼쪽 밖까지
    expect(get('b')).toMatchObject({ x: 0, w: 8 });
    dragLeft('c', 20, 0); // 최소 폭(3)보다 작게
    expect(get('c')).toMatchObject({ w: 3 });
    expect(get('c').x + get('c').w).toBe(12);
    noOverlap();
  });

  it('겹친 항목은 밀리고, 드래그 중에는 모델이 바뀌지 않으며 Esc 로 취소된다', () => {
    create();
    const before = editor.getLayout();
    const sx = 4 * STRIDE_X + 6;
    const sy = 2 * STRIDE_Y - 14;
    pointer(grip('b', 'sw'), 'pointerdown', sx, sy);
    pointer(grip('b', 'sw'), 'pointermove', sx - 8, sy);
    pointer(grip('b', 'sw'), 'pointermove', sx - 2 * STRIDE_X, sy);
    expect(el('b').classList.contains('ddr-resizing')).toBe(true);
    expect(el('b').style.left).not.toBe(''); // 드래그 중에는 포인터를 따라가는 인라인 위치
    expect(editor.getLayout()).toEqual(before);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pointer(grip('b', 'sw'), 'pointerup', sx - 2 * STRIDE_X, sy);
    expect(editor.getLayout()).toEqual(before);
    expect(el('b').style.left).toBe('');
    expect(el('b').style.width).toBe('');
    expect(el('b').dataset).toMatchObject({ x: '4', w: '4' });
  });

  it('위로 겹치는 항목(a)이 비켜간다', () => {
    create();
    dragLeft('b', -2, 0);
    expect(get('b')).toMatchObject({ x: 2, w: 6 });
    expect(get('a').y).toBeGreaterThanOrEqual(2);
    noOverlap();
  });

  it('locked 와 겹치게 되는 크기는 무효 placeholder 로 표시되고 적용되지 않는다', () => {
    create({
      layout: {
        columns: 12,
        items: [
          { id: 'wall', x: 2, y: 0, w: 1, h: 2, locked: true },
          { id: 'b', x: 4, y: 0, w: 4, h: 2 },
        ],
      },
    });
    const before = editor.getLayout();
    const sx = 4 * STRIDE_X + 6;
    const sy = 2 * STRIDE_Y - 14;
    pointer(grip('b', 'sw'), 'pointerdown', sx, sy);
    pointer(grip('b', 'sw'), 'pointermove', sx - 8, sy);
    pointer(grip('b', 'sw'), 'pointermove', sx - 2 * STRIDE_X, sy);
    expect(container.querySelector('.ddr-placeholder')!.classList.contains('ddr-placeholder-invalid')).toBe(true);
    pointer(grip('b', 'sw'), 'pointerup', sx - 2 * STRIDE_X, sy);
    expect(editor.getLayout()).toEqual(before);
  });

  it('locked / resizable:false 항목과 resizable=false 에디터에서는 시작되지 않는다', () => {
    create({
      layout: {
        columns: 12,
        items: [
          { id: 'l', x: 4, y: 0, w: 4, h: 2, locked: true },
          { id: 'f', x: 0, y: 3, w: 4, h: 2, resizable: false },
        ],
      },
    });
    dragLeft('l', -2, 0);
    dragLeft('f', 1, 0);
    expect(get('l')).toMatchObject({ x: 4, w: 4 });
    expect(get('f')).toMatchObject({ x: 0, w: 4 });
    expect(el('f').classList.contains('ddr-no-resize')).toBe(true);
    editor.destroy();
    container.innerHTML = '';
    create({ resizable: false });
    dragLeft('b', -2, 0);
    expect(get('b')).toMatchObject({ x: 4, w: 4 });
  });

  it('터치(pointerType=touch)로도 동작하고 undo 한 번으로 되돌아간다', () => {
    create();
    dragLeft('b', -1, 0, 'touch');
    expect(get('b')).toMatchObject({ x: 3, w: 5 });
    editor.undo();
    expect(get('b')).toMatchObject({ x: 4, w: 4 });
  });

  it('float 모드에서도 위로 끌어올려지지 않는다', () => {
    create({ layout: { columns: 12, float: true, items: [{ id: 'b', x: 4, y: 5, w: 4, h: 2 }] } });
    dragLeft('b', -2, 0);
    expect(get('b')).toMatchObject({ x: 2, y: 5, w: 6 });
  });
});
