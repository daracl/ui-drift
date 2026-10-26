import { createDriftEditor, DriftEditor, DriftItem } from '@/index';

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

function pointer(target: Element, type: string, x: number, y: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  target.dispatchEvent(e);
}

describe('동/서/남 리사이즈 핸들 (e, w, s)', () => {
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
          { id: 'fix', x: 8, y: 0, w: 4, h: 2, locked: true, resizable: true },
        ],
      },
      resizeHandles: ['e', 'w', 's'],
      ...options,
    });
  };
  const el = (id: string) => container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
  const grip = (id: string, dir: string) =>
    el(id).querySelector(`.ddr-resize-handle[data-dir="${dir}"]`) as HTMLElement | null;
  const get = (id: string) => editor.getItems().find((i) => i.id === id) as DriftItem;

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

  it('resizeHandles 로 지정한 핸들만 만들어진다', () => {
    create();
    expect(
      Array.from(el('a').querySelectorAll('.ddr-resize-handle')).map((n) => (n as HTMLElement).dataset.dir),
    ).toEqual(['e', 'w', 's']);
  });

  it('e 는 너비만, 높이는 유지한다', () => {
    create({ resizeHandles: ['e'] });
    const h = grip('a', 'e') as HTMLElement;
    // 시작 시 a 의 오른쪽 가장자리 근처에서 끌어 오른쪽으로 1칸 늘린다 (b 는 밀려난다)
    const startX = 4 * STRIDE_X - 8;
    pointer(h, 'pointerdown', startX, 40);
    pointer(h, 'pointermove', startX + 10, 80);
    pointer(h, 'pointermove', startX + STRIDE_X, 120);
    pointer(h, 'pointerup', startX + STRIDE_X, 120);
    expect(get('a')).toMatchObject({ x: 0, w: 5, h: 2 });
  });

  it('s 는 높이만, 너비는 유지한다', () => {
    create({ resizeHandles: ['s'] });
    const h = grip('a', 's') as HTMLElement;
    pointer(h, 'pointerdown', 100, 90);
    pointer(h, 'pointermove', 110, 120);
    pointer(h, 'pointermove', 600, 90 + STRIDE_Y);
    pointer(h, 'pointerup', 600, 90 + STRIDE_Y);
    expect(get('a')).toMatchObject({ x: 0, w: 4, h: 3 });
  });

  it('w 는 오른쪽 가장자리를 고정한 채 왼쪽 너비를 바꾸고 높이는 유지한다', () => {
    create({ resizeHandles: ['w'] });
    const h = grip('b', 'w') as HTMLElement;
    const startX = 4 * STRIDE_X + 6;
    pointer(h, 'pointerdown', startX, 40);
    pointer(h, 'pointermove', startX - 10, 80);
    pointer(h, 'pointermove', startX - 2 * STRIDE_X, 120);
    pointer(h, 'pointerup', startX - 2 * STRIDE_X, 120);
    expect(get('b')).toMatchObject({ x: 2, w: 6, h: 2 });
    expect(get('b').x + get('b').w).toBe(8);
  });

  it('위치가 고정된(locked) 항목은 w 로 조절할 수 없다', () => {
    create({ resizeHandles: ['w'] });
    const before = { ...get('fix') };
    const h = grip('fix', 'w') as HTMLElement;
    pointer(h, 'pointerdown', 8 * STRIDE_X + 6, 40);
    pointer(h, 'pointermove', 8 * STRIDE_X - 100, 40);
    pointer(h, 'pointerup', 8 * STRIDE_X - 100, 40);
    expect(get('fix')).toMatchObject(before);
  });
});
