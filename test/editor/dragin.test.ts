import { createDriftEditor, DriftEditor, DriftItem } from '@/index';

const CANVAS = { left: 100, top: 100, width: 1200 };
const CELL = (CANVAS.width - 8 * 11) / 12;
const STRIDE_X = CELL + 8;
const STRIDE_Y = 48;

/** jsdom 에는 레이아웃이 없으므로 캔버스/원본의 위치를 직접 지정한다 */
function mockRects() {
  return jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.classList.contains('daracl-drift') || el.classList.contains('ddr-editor')) {
      return {
        left: CANVAS.left,
        top: CANVAS.top,
        width: CANVAS.width,
        height: 600,
        right: CANVAS.left + CANVAS.width,
        bottom: CANVAS.top + 600,
      } as DOMRect;
    }
    if (el.classList.contains('pal'))
      return { left: 10, top: 10, width: 80, height: 30, right: 90, bottom: 40 } as DOMRect;
    const d = el.dataset;
    const x = Number(d.x ?? 0);
    const y = Number(d.y ?? 0);
    return {
      left: CANVAS.left + x * STRIDE_X,
      top: CANVAS.top + y * STRIDE_Y,
      width: 100,
      height: 100,
      right: 0,
      bottom: 0,
    } as DOMRect;
  });
}

function pointer(target: Element | Document, type: string, x: number, y: number, pointerType = 'mouse', pointerId = 1) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

describe('외부에서 끌어와 추가 (setupDragIn)', () => {
  let container: HTMLElement;
  let palette: HTMLElement;
  let source: HTMLElement;
  let editor: DriftEditor;
  let spy: jest.SpyInstance;

  const create = (options = {}) => {
    editor = createDriftEditor(container, {
      layout: {
        columns: 12,
        items: [
          { id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'A' },
          { id: 'b', x: 4, y: 0, w: 4, h: 2, content: 'B' },
        ],
      },
      ...options,
    });
    return editor;
  };
  const byId = (id: string) => editor.getItems().find((i) => i.id === id) as DriftItem;
  /** 원본에서 눌러 캔버스의 (cellX, cellY) 근처로 끌어 놓는다 (포인터가 항목의 가운데에 오도록) */
  const dragTo = (cellX: number, cellY: number, wCells = 3, hCells = 2, type = 'mouse') => {
    const px = CANVAS.left + cellX * STRIDE_X + (wCells * STRIDE_X - 8) / 2;
    const py = CANVAS.top + cellY * STRIDE_Y + (hCells * STRIDE_Y - 8) / 2;
    pointer(source, 'pointerdown', 20, 20, type);
    pointer(source, 'pointermove', 40, 40, type);
    pointer(source, 'pointermove', px, py, type);
    pointer(source, 'pointerup', px, py, type);
  };

  beforeEach(() => {
    spy = mockRects();
    container = document.createElement('div');
    palette = document.createElement('div');
    palette.innerHTML =
      '<div class="pal" id="p1" data-w="3" data-h="2" data-title="Chart" data-content="New chart">Chart</div><div class="pal" id="p2">Plain</div>';
    document.body.append(palette, container);
    source = palette.querySelector('#p1') as HTMLElement;
  });
  afterEach(() => {
    editor?.destroy();
    container.remove();
    palette.remove();
    document.querySelectorAll('.ddr-dragin-ghost').forEach((n) => n.remove());
    spy.mockRestore();
  });

  it('캔버스에 놓으면 그 칸에 추가되고 data 속성의 크기/제목/내용을 사용한다', () => {
    create();
    editor.setupDragIn('.pal');
    const events: string[] = [];
    editor.on('dragInStart', () => events.push('start'));
    editor.on('dragInEnd', (item) => events.push(`end:${item ? item.id : 'null'}`));
    editor.on('add', (item) => events.push(`add:${item.id}`));
    editor.on('layoutChange', (_l, i) => events.push(`change:${i.reason}`));

    dragTo(8, 4);
    const added = editor.getItems().find((i) => !['a', 'b'].includes(i.id)) as DriftItem;
    expect(added).toMatchObject({ x: 8, w: 3, h: 2, title: 'Chart', content: 'New chart' });
    // 놓은 칸(y=4) 위가 비어 있으므로 float 가 아닌 기본 모드에서는 위로 압축된다
    expect(added.y).toBe(0);
    expect(events[0]).toBe('start');
    expect(events).toContain(`add:${added.id}`);
    expect(events).toContain('change:add');
    expect(events[events.length - 1]).toBe(`end:${added.id}`);
    expect(events.filter((e) => e === 'change:add')).toHaveLength(1); // 변경 이벤트는 drop 시 한 번
    expect(editor.canUndo()).toBe(true);
    expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
  });

  it('겹치는 칸에 놓으면 기존 항목이 비켜가고 겹침이 없다', () => {
    create();
    editor.setupDragIn('.pal');
    dragTo(0, 0);
    const list = editor.getItems();
    expect(list).toHaveLength(3);
    const added = list.find((i) => !['a', 'b'].includes(i.id)) as DriftItem;
    expect(added).toMatchObject({ x: 0, y: 0 });
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
      }
    }
  });

  it('float 모드에서는 놓은 y 가 유지된다', () => {
    create({ float: true });
    editor.setupDragIn('.pal');
    dragTo(8, 6);
    const added = editor.getItems().find((i) => !['a', 'b'].includes(i.id)) as DriftItem;
    expect(added).toMatchObject({ x: 8, y: 6 });
  });

  it('드래그 중에는 placeholder 와 복제본이 보이고 모델은 바뀌지 않는다', () => {
    create();
    editor.setupDragIn('.pal');
    const before = editor.getLayout();
    pointer(source, 'pointerdown', 20, 20);
    pointer(source, 'pointermove', 400, 200);
    const ghost = document.querySelector('.ddr-dragin-ghost') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.id).toBe(''); // 문서 내 id 중복 방지
    expect(ghost.style.left).toBe(`${400 - 10}px`);
    const placeholder = container.querySelector('.ddr-placeholder') as HTMLElement;
    expect(placeholder.hidden).toBe(false);
    expect(container.classList.contains('ddr-dragin-over')).toBe(true);
    expect(editor.getLayout()).toEqual(before);
    pointer(source, 'pointerup', 400, 200);
    expect(placeholder.hidden).toBe(true);
    expect(container.classList.contains('ddr-dragin-over')).toBe(false);
  });

  it('캔버스 밖에서 놓거나 Esc/pointercancel 이면 추가하지 않고 원래 배치로 복원된다', () => {
    create();
    editor.setupDragIn('.pal');
    const before = editor.getLayout();
    const ends: Array<DriftItem | null> = [];
    editor.on('dragInEnd', (i) => ends.push(i));

    // 1) 캔버스 위로 갔다가 밖에서 놓기: 미리보기로 밀렸던 항목도 원위치
    pointer(source, 'pointerdown', 20, 20);
    pointer(source, 'pointermove', CANVAS.left + 50, CANVAS.top + 20); // 위(a 와 겹침)
    pointer(source, 'pointermove', 5000, 5000);
    expect(container.querySelector<HTMLElement>('[data-drift-id="a"]')!.dataset.y).toBe('0');
    pointer(source, 'pointerup', 5000, 5000);
    // 2) Esc
    pointer(source, 'pointerdown', 20, 20);
    pointer(source, 'pointermove', CANVAS.left + 300, CANVAS.top + 300);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pointer(source, 'pointerup', CANVAS.left + 300, CANVAS.top + 300);
    // 3) pointercancel
    pointer(source, 'pointerdown', 20, 20);
    pointer(source, 'pointermove', CANVAS.left + 300, CANVAS.top + 300);
    pointer(source, 'pointercancel', 0, 0);

    expect(editor.getLayout()).toEqual(before);
    expect(ends).toEqual([null, null, null]);
    expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
    expect(container.querySelector<HTMLElement>('.ddr-placeholder')!.hidden).toBe(true);
  });

  it('임계값보다 적게 움직이면 아무 일도 일어나지 않는다 (클릭)', () => {
    create();
    editor.setupDragIn('.pal');
    const onStart = jest.fn();
    editor.on('dragInStart', onStart);
    pointer(source, 'pointerdown', 20, 20);
    pointer(source, 'pointermove', 21, 21);
    pointer(source, 'pointerup', 21, 21);
    expect(onStart).not.toHaveBeenCalled();
    expect(editor.getItems()).toHaveLength(2);
  });

  it('item 옵션(객체/함수)으로 정의하고 id 가 겹치면 자동으로 고유하게 만든다', () => {
    create();
    editor.setupDragIn('#p1', { item: { id: 'a', w: 2, h: 1, content: 'fixed', props: { k: 1 } } });
    dragTo(8, 0, 2, 1);
    dragTo(8, 3, 2, 1);
    const ids = editor.getItems().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length); // a 가 이미 있으므로 a-1, a-2 로 생성
    expect(ids).toEqual(expect.arrayContaining(['a', 'a-1', 'a-2']));
    expect(editor.getItem('a-1')).toMatchObject({ w: 2, h: 1, content: 'fixed', props: { k: 1 } });

    const fn = jest.fn((el: HTMLElement) => ({ id: `from-${el.id}`, w: 1, h: 1 }));
    editor.setupDragIn('#p2', { item: fn });
    source = palette.querySelector('#p2') as HTMLElement;
    dragTo(11, 8, 1, 1);
    expect(fn).toHaveBeenCalledWith(source);
    expect(editor.getItem('from-p2')).toBeTruthy();
  });

  it('min/max 크기를 지키고 컬럼 밖으로 나가지 않는다', () => {
    create();
    editor.setupDragIn('.pal', { item: { w: 99, h: 2, minW: 2, maxW: 5 } });
    dragTo(7, 6, 5, 2);
    const added = editor.getItems().find((i) => !['a', 'b'].includes(i.id)) as DriftItem;
    expect(added.w).toBe(5);
    expect(added.x + added.w).toBeLessThanOrEqual(12);
  });

  it('터치(pointerType=touch)로도 동작한다', () => {
    create();
    editor.setupDragIn('.pal');
    dragTo(8, 3, 3, 2, 'touch');
    expect(editor.getItems()).toHaveLength(3);
  });

  it('원본에는 touch-action 용 클래스가 붙고 해제하면 제거되며 이후에는 반응하지 않는다', () => {
    create();
    const dispose = editor.setupDragIn('.pal');
    expect(source.classList.contains('ddr-dragin-source')).toBe(true);
    dispose();
    expect(source.classList.contains('ddr-dragin-source')).toBe(false);
    dragTo(8, 3);
    expect(editor.getItems()).toHaveLength(2);
  });

  it('요소/요소 목록도 원본으로 쓸 수 있다', () => {
    create();
    editor.setupDragIn(source);
    dragTo(8, 3);
    expect(editor.getItems()).toHaveLength(3);
    const other = palette.querySelector('#p2') as HTMLElement;
    editor.setupDragIn([other], { item: { id: 'x', w: 1, h: 1 } });
    source = other;
    dragTo(11, 8, 1, 1);
    expect(editor.getItem('x')).toBeTruthy();
  });

  it('breakpoint 편집 중에는 해당 breakpoint 의 칸에 놓이고 기본 레이아웃에는 자동 위치로 추가된다', () => {
    create();
    editor.setBreakpoint('mobile'); // 4열 적층
    editor.setupDragIn('.pal');
    const stride4 = (CANVAS.width - 8 * 3) / 4 + 8;
    // 4열 캔버스에서 맨 위(0,0)에 놓는다
    const px = CANVAS.left + (3 * stride4 - 8) / 2;
    const py = CANVAS.top + (2 * STRIDE_Y - 8) / 2;
    pointer(source, 'pointerdown', 20, 20);
    pointer(source, 'pointermove', 40, 40);
    pointer(source, 'pointermove', px, py);
    pointer(source, 'pointerup', px, py);

    const layout = editor.getLayout();
    const added = layout.items.find((i) => !['a', 'b'].includes(i.id)) as DriftItem;
    expect(added.responsive!.mobile).toMatchObject({ x: 0, y: 0 });
    // 기본(12열) 레이아웃에서는 겹치지 않는 자동 위치
    expect(editor.canUndo()).toBe(true); // 한 번의 변경으로 커밋된다
    editor.undo();
    expect(editor.canUndo()).toBe(false);
    editor.redo();
    editor.setBreakpoint(null);
    const base = editor.getItems();
    const a = base.find((i) => i.id === added.id) as DriftItem;
    for (const o of base.filter((i) => i.id !== a.id)) {
      expect(a.x < o.x + o.w && a.x + a.w > o.x && a.y < o.y + o.h && a.y + a.h > o.y).toBe(false);
    }
  });

  it('destroy 하면 리스너/복제본/클래스가 정리되고 이후 드래그에 반응하지 않는다', () => {
    create();
    editor.setupDragIn('.pal');
    pointer(source, 'pointerdown', 20, 20);
    pointer(source, 'pointermove', 400, 200); // 드래그 도중 destroy
    editor.destroy();
    expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
    expect(source.classList.contains('ddr-dragin-source')).toBe(false);
    pointer(source, 'pointerup', 400, 200);
    pointer(source, 'pointerdown', 20, 20);
    pointer(source, 'pointermove', 400, 200);
    expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
    expect(() => editor.setupDragIn('.pal')).toThrow();
  });
});
