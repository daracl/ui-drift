import { collides, createDriftEditor, DriftEditor, DriftEditorOptions, DriftItem, validateLayout } from '@/index';

const CANVAS_WIDTH = 1200; // DriftEditor 의 기본 측정 폭(jsdom 은 레이아웃이 없다)
const STRIDE_X = (CANVAS_WIDTH - 8 * 11) / 12 + 8; // 셀 너비 + gap
const STRIDE_Y = 40 + 8;

/** jsdom 에는 레이아웃이 없으므로 요소 위치를 inline style 에서 계산해 돌려준다 */
function mockRects() {
  return jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.classList.contains('daracl-drift')) {
      return { left: 0, top: 0, width: CANVAS_WIDTH, height: 1000, right: CANVAS_WIDTH, bottom: 1000 } as DOMRect;
    }
    // 위치/크기는 data-x/y/w/h 가 정한다 (실제 CSS 는 jsdom 이 계산하지 않으므로 같은 공식으로 환산).
    // 드래그/리사이즈 중에는 포인터를 따라가는 인라인 left/top/width/height 가 우선한다.
    const cell = (CANVAS_WIDTH - 8 * 11) / 12;
    const d = el.dataset;
    const x = Number(d.x ?? 0);
    const y = Number(d.y ?? 0);
    const w = Number(d.w ?? 0);
    const h = Number(d.h ?? 0);
    const left = el.style.left ? parseFloat(el.style.left) : x * (cell + 8);
    const top = el.style.top ? parseFloat(el.style.top) : y * 48;
    const width = el.style.width ? parseFloat(el.style.width) : w * cell + (w - 1) * 8;
    const height = el.style.height ? parseFloat(el.style.height) : h * 40 + (h - 1) * 8;
    return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
  });
}

function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  pointerType: 'mouse' | 'touch' = 'mouse',
  pointerId = 1,
) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

describe('DriftEditor', () => {
  let container: HTMLElement;
  let editor: DriftEditor;
  let rectSpy: jest.SpyInstance;

  const create = (options: DriftEditorOptions = {}) => {
    editor = createDriftEditor(container, {
      layout: {
        columns: 12,
        items: [
          { id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'A' },
          { id: 'b', x: 4, y: 0, w: 4, h: 2, content: 'B' },
          { id: 'c', x: 0, y: 2, w: 8, h: 2, content: 'C' },
        ],
      },
      ...options,
    });
    return editor;
  };
  const el = (id: string) => container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
  const byId = (items: DriftItem[], id: string) => items.find((i) => i.id === id) as DriftItem;
  const noOverlap = (items: DriftItem[]) => {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) expect(collides(items[i], items[j])).toBe(false);
    }
  };

  /** 항목 좌상단 근처를 눌러 (cellX, cellY) 로 드래그한다 */
  function drag(id: string, toX: number, toY: number, from: Element = el(id), type: 'mouse' | 'touch' = 'mouse') {
    const item = editor.getItem(id) as DriftItem;
    const sx = item.x * STRIDE_X + 10;
    const sy = item.y * STRIDE_Y + 10;
    pointer(from, 'pointerdown', sx, sy, type);
    pointer(from, 'pointermove', sx + 8, sy + 8, type);
    pointer(from, 'pointermove', sx + (toX - item.x) * STRIDE_X, sy + (toY - item.y) * STRIDE_Y, type);
    pointer(from, 'pointerup', sx + (toX - item.x) * STRIDE_X, sy + (toY - item.y) * STRIDE_Y, type);
  }

  beforeEach(() => {
    rectSpy = mockRects();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
    rectSpy.mockRestore();
  });

  it('레이아웃을 렌더링하고 init 이벤트 없이도 조회할 수 있다', () => {
    create();
    expect(container.querySelectorAll('.ddr-item')).toHaveLength(3);
    // 위치/크기는 data 속성으로 표현하고 인라인 style 은 쓰지 않는다
    expect(el('b').dataset).toMatchObject({ x: '4', y: '0', w: '4', h: '2' });
    ['transform', 'width', 'height', 'left', 'top'].forEach((p) => expect(el('b').style.getPropertyValue(p)).toBe(''));
    expect(el('a').textContent).toContain('A');
    expect(editor.getLayout().items).toHaveLength(3);
    expect(validateLayout(editor.getLayout()).valid).toBe(true);
  });

  it('getLayout 은 복사본을 반환한다', () => {
    create();
    const layout = editor.getLayout();
    layout.items[0].x = 99;
    expect(editor.getLayout().items[0].x).toBe(0);
  });

  describe('추가 / 삭제 / 갱신', () => {
    it('addItem 은 빈 자리에 배치하고 이벤트를 발생시킨다', () => {
      create();
      const onAdd = jest.fn();
      const onChange = jest.fn();
      editor.on('add', onAdd);
      editor.on('layoutChange', onChange);

      const added = editor.addItem({ id: 'd', w: 4, h: 2, content: 'D' });
      expect(added).toMatchObject({ x: 8, y: 0 });
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'd' }));
      // 기존 인자(레이아웃, {reason})는 그대로이고 info 에 source/changes 가 추가되었다
      expect(onChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: 'add', source: 'api' }),
      );
      expect(el('d')).toBeTruthy();
      expect(() => editor.addItem({ id: 'd', w: 1, h: 1 })).toThrow();
    });

    it('removeItem 은 요소를 제거하고 아래 항목을 끌어올린다', () => {
      create();
      const onRemove = jest.fn();
      editor.on('remove', onRemove);
      expect(editor.removeItem('a')).toBe(true);
      expect(editor.removeItem('nope')).toBe(false);
      expect(el('a')).toBeNull();
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(byId(editor.getItems(), 'c').y).toBe(2); // b 가 위에 남아 있어 올라오지 못한다
      editor.removeItem('b');
      expect(byId(editor.getItems(), 'c').y).toBe(0);
    });

    it('updateItem 은 content/props 와 크기를 갱신한다', () => {
      create();
      editor.updateItem('a', { content: 'New', props: { k: 'v' }, w: 6 });
      expect(el('a').textContent).toContain('New');
      expect(editor.getItem('a')).toMatchObject({ w: 6, props: { k: 'v' } });
      noOverlap(editor.getItems());
      expect(editor.updateItem('zz', {})).toBeUndefined();
    });

    it('renderItem 으로 내용을 직접 그릴 수 있다', () => {
      create({
        renderItem: (item, contentEl) => {
          contentEl.innerHTML = `<b>${item.id}</b>`;
        },
      });
      expect(el('a').querySelector('b')?.textContent).toBe('a');
    });

    it('content 는 텍스트로만 삽입된다(XSS 방지)', () => {
      create();
      editor.addItem({ id: 'x', w: 2, h: 2, content: '<img src=x onerror=alert(1)>' });
      expect(el('x').querySelector('img')).toBeNull();
    });
  });

  describe('마우스 드래그', () => {
    it('드래그하면 이동하고 겹친 항목은 밀린다', () => {
      create();
      const events: string[] = [];
      editor.on('dragStart', () => events.push('start'));
      editor.on('dragEnd', () => events.push('end'));
      editor.on('layoutChange', (_l, info) => events.push(info.reason));

      drag('a', 4, 0);

      const items = editor.getItems();
      expect(byId(items, 'a')).toMatchObject({ x: 4, y: 0 });
      expect(byId(items, 'b').y).toBeGreaterThanOrEqual(2);
      noOverlap(items);
      expect(events).toEqual(['start', 'drag', 'end']);
      expect(container.querySelector('.ddr-placeholder')).toHaveProperty('hidden', true);
      expect(el('a').classList.contains('ddr-dragging')).toBe(false);
    });

    it('드래그 중에는 placeholder 가 표시되고 모델은 변하지 않는다', () => {
      create();
      const placeholder = container.querySelector('.ddr-placeholder') as HTMLElement;
      pointer(el('a'), 'pointerdown', 10, 10);
      pointer(el('a'), 'pointermove', 4 * STRIDE_X + 10, 10);
      expect(placeholder.hidden).toBe(false);
      expect(placeholder.dataset).toMatchObject({ x: '4', y: '0' });
      expect(el('a').classList.contains('ddr-dragging')).toBe(true);
      expect(editor.getItem('a')).toMatchObject({ x: 0, y: 0 });
      pointer(el('a'), 'pointercancel', 0, 0);
      expect(placeholder.hidden).toBe(true);
    });

    it('임계값보다 적게 움직이면 클릭(선택)으로만 처리된다', () => {
      create();
      const onSelect = jest.fn();
      const onChange = jest.fn();
      editor.on('select', onSelect);
      editor.on('layoutChange', onChange);
      pointer(el('a'), 'pointerdown', 10, 10);
      pointer(el('a'), 'pointermove', 11, 11);
      pointer(el('a'), 'pointerup', 11, 11);
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
      expect(onChange).not.toHaveBeenCalled();
      expect(el('a').classList.contains('ddr-selected')).toBe(true);
      expect(editor.getSelected()?.id).toBe('a');
    });

    it('Esc 로 취소하면 원래 위치로 돌아간다', () => {
      create();
      const onChange = jest.fn();
      pointer(el('a'), 'pointerdown', 10, 10);
      pointer(el('a'), 'pointermove', 300, 200);
      editor.on('layoutChange', onChange);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      pointer(el('a'), 'pointerup', 300, 200);
      expect(onChange).not.toHaveBeenCalled();
      expect(editor.getItem('a')).toMatchObject({ x: 0, y: 0 });
      expect(el('a').dataset).toMatchObject({ x: '0', y: '0' });
      expect(el('a').style.left).toBe(''); // 드래그 중 인라인 위치가 제거됨
    });

    it('컬럼 범위를 벗어나게 끌어도 화면 안에 놓인다', () => {
      create();
      drag('a', 40, 0);
      expect(editor.getItem('a')!.x + editor.getItem('a')!.w).toBeLessThanOrEqual(12);
    });

    it('locked 항목은 드래그할 수 없다', () => {
      create({
        layout: { columns: 12, items: [{ id: 'l', x: 0, y: 0, w: 4, h: 2, locked: true }] },
      });
      drag('l', 6, 3);
      expect(editor.getItem('l')).toMatchObject({ x: 0, y: 0 });
    });

    it('draggable=false 이면 이동하지 않고 enableDrag 로 켤 수 있다', () => {
      create({ draggable: false });
      drag('a', 4, 0);
      expect(editor.getItem('a')).toMatchObject({ x: 0 });
      editor.enableDrag(true);
      drag('a', 4, 0);
      expect(editor.getItem('a')).toMatchObject({ x: 4 });
    });

    it('내부 버튼/입력 요소에서는 드래그가 시작되지 않는다', () => {
      create({
        renderItem: (_i, contentEl) => {
          contentEl.innerHTML = '<input class="inner">';
        },
      });
      const input = el('a').querySelector('.inner') as HTMLElement;
      drag('a', 6, 0, input);
      expect(editor.getItem('a')).toMatchObject({ x: 0 });
    });
  });

  describe('float (드롭 위치 유지)', () => {
    it('옵션을 켜면 드롭한 y 가 유지되고 레이아웃에 저장된다', () => {
      create({ float: true, layout: undefined, columns: 12 });
      editor.addItem({ id: 'a', x: 0, y: 0, w: 4, h: 2 });
      drag('a', 6, 5);
      expect(editor.getItem('a')).toMatchObject({ x: 6, y: 5 });
      expect(editor.getLayout().float).toBe(true);
    });

    it('회귀(API-01): layout 과 float 옵션을 함께 주면 layout 에 float 가 없을 때 옵션이 적용된다', () => {
      create({ float: true });
      expect(editor.isFloat()).toBe(true);
      expect(editor.getLayout().float).toBe(true);
      editor.destroy();
      container.innerHTML = '';
      create({ layout: { columns: 12, float: true, items: [] }, float: false });
      expect(editor.isFloat()).toBe(true); // layout 의 float:true 가 우선
    });

    it('기본(float 꺼짐)에서는 위로 압축된다', () => {
      create();
      drag('a', 8, 6);
      expect(editor.getItem('a')!.y).toBeLessThan(6);
    });

    it('setFloat 으로 전환하면 undo 할 수 있고, 끄면 압축된다', () => {
      create();
      editor.setFloat(true);
      editor.moveItem('c', 0, 9);
      expect(editor.getItem('c')!.y).toBe(9);
      editor.setFloat(false);
      expect(editor.isFloat()).toBe(false);
      expect(editor.getItem('c')!.y).toBeLessThan(9);
      editor.undo();
      expect(editor.isFloat()).toBe(true);
      expect(editor.getItem('c')!.y).toBe(9);
    });
  });

  describe('터치', () => {
    it('핸들에서 시작한 터치 드래그는 동작한다', () => {
      create();
      drag('a', 6, 0, el('a').querySelector('.ddr-handle') as Element, 'touch');
      expect(editor.getItem('a')).toMatchObject({ x: 6 });
    });

    it('본문에서 시작한 터치는 드래그하지 않는다 (스크롤 우선)', () => {
      create();
      drag('a', 6, 0, el('a').querySelector('.ddr-content') as Element, 'touch');
      expect(editor.getItem('a')).toMatchObject({ x: 0 });
    });

    it("dragMode 'item' 이면 터치도 본문에서 드래그된다", () => {
      create({ dragMode: 'item' });
      drag('a', 6, 0, el('a').querySelector('.ddr-content') as Element, 'touch');
      expect(editor.getItem('a')).toMatchObject({ x: 6 });
    });

    it('터치 리사이즈 핸들로 크기를 바꿀 수 있다', () => {
      create();
      const grip = el('a').querySelector('.ddr-resize-handle') as Element;
      const startX = 4 * STRIDE_X - 8 - 4;
      const startY = 2 * STRIDE_Y - 8 - 4;
      pointer(grip, 'pointerdown', startX, startY, 'touch');
      pointer(grip, 'pointermove', startX + 5, startY + 5, 'touch');
      pointer(grip, 'pointermove', startX + 2 * STRIDE_X, startY + STRIDE_Y, 'touch');
      pointer(grip, 'pointerup', startX + 2 * STRIDE_X, startY + STRIDE_Y, 'touch');
      expect(editor.getItem('a')).toMatchObject({ w: 6, h: 3 });
      noOverlap(editor.getItems());
    });
  });

  describe('리사이즈', () => {
    it('마우스로 크기를 조절하고 아래 항목이 밀린다', () => {
      create();
      const events: string[] = [];
      editor.on('resizeStart', () => events.push('start'));
      editor.on('resizeEnd', () => events.push('end'));
      const grip = el('a').querySelector('.ddr-resize-handle') as Element;
      const sx = 4 * STRIDE_X - 12;
      const sy = 2 * STRIDE_Y - 12;
      pointer(grip, 'pointerdown', sx, sy);
      pointer(grip, 'pointermove', sx + 6, sy + 6);
      pointer(grip, 'pointermove', sx, sy + 2 * STRIDE_Y);
      pointer(grip, 'pointerup', sx, sy + 2 * STRIDE_Y);
      expect(editor.getItem('a')).toMatchObject({ w: 4, h: 4 });
      expect(byId(editor.getItems(), 'c').y).toBeGreaterThanOrEqual(4);
      expect(events).toEqual(['start', 'end']);
    });

    it('min/max 크기를 지킨다', () => {
      create({ layout: { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 4, h: 2, minW: 3, maxW: 5, maxH: 2 }] } });
      editor.resizeItem('a', 1, 1);
      expect(editor.getItem('a')).toMatchObject({ w: 3, h: 1 });
      editor.resizeItem('a', 12, 9);
      expect(editor.getItem('a')).toMatchObject({ w: 5, h: 2 });
    });

    it('resizable=false 이면 핸들이 있어도 크기가 바뀌지 않는다', () => {
      create({ resizable: false });
      const grip = el('a').querySelector('.ddr-resize-handle') as Element;
      pointer(grip, 'pointerdown', 380, 90);
      pointer(grip, 'pointermove', 600, 300);
      pointer(grip, 'pointerup', 600, 300);
      expect(editor.getItem('a')).toMatchObject({ w: 4, h: 2 });
    });
  });

  describe('키보드', () => {
    const key = (target: Element, k: string, shiftKey = false) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));

    it('방향키로 이동, Shift+방향키로 리사이즈', () => {
      create();
      key(el('c'), 'ArrowRight');
      expect(editor.getItem('c')).toMatchObject({ x: 1 });
      key(el('c'), 'ArrowRight', true);
      expect(editor.getItem('c')).toMatchObject({ w: 9 });
    });

    it('Delete 는 removable 일 때만 삭제한다', () => {
      create();
      key(el('a'), 'Delete');
      expect(el('a')).toBeTruthy();
      editor.destroy();
      container.innerHTML = '';
      create({ removable: true });
      key(el('a'), 'Delete');
      expect(el('a')).toBeNull();
    });

    it('삭제 버튼 클릭으로 삭제된다', () => {
      create({ removable: true });
      (el('b').querySelector('.ddr-remove') as HTMLElement).click();
      expect(editor.getItem('b')).toBeUndefined();
    });
  });

  describe('저장 / 불러오기 / 히스토리', () => {
    it('JSON 으로 내보내고 불러와도 동일하다', () => {
      create();
      editor.addItem({ id: 'd', w: 3, h: 1, props: { a: 1 } });
      const json = editor.toJSON();

      const other = document.createElement('div');
      document.body.appendChild(other);
      const second = createDriftEditor(other, { layout: json });
      expect(second.getLayout()).toEqual(editor.getLayout());
      second.destroy();
      other.remove();

      editor.clear();
      expect(editor.getItems()).toHaveLength(0);
      editor.fromJSON(json);
      expect(editor.getItems()).toHaveLength(4);
    });

    it('잘못된 JSON 은 예외를 던지고 상태를 유지한다', () => {
      create();
      expect(() => editor.fromJSON('{bad')).toThrow();
      expect(editor.getItems()).toHaveLength(3);
    });

    it('undo / redo', () => {
      create();
      expect(editor.canUndo()).toBe(false);
      editor.moveItem('a', 8, 0);
      editor.removeItem('b');
      expect(editor.undo()).toBe(true);
      expect(editor.getItem('b')).toBeTruthy();
      expect(editor.undo()).toBe(true);
      expect(editor.getItem('a')).toMatchObject({ x: 0 });
      expect(editor.undo()).toBe(false);
      expect(editor.canRedo()).toBe(true);
      expect(editor.redo()).toBe(true);
      expect(editor.getItem('a')).toMatchObject({ x: 8 });
      editor.moveItem('c', 4, 4);
      expect(editor.canRedo()).toBe(false);
    });

    it('드래그 한 번은 undo 한 번으로 되돌아간다', () => {
      create();
      drag('a', 6, 0);
      expect(editor.getItem('a')).toMatchObject({ x: 6 });
      editor.undo();
      expect(editor.getItem('a')).toMatchObject({ x: 0 });
    });

    it('reset 은 초기 레이아웃으로 돌리고 undo 할 수 있다', () => {
      create();
      editor.removeItem('a');
      editor.addItem({ id: 'z', w: 2, h: 2 });
      editor.reset();
      expect(
        editor
          .getItems()
          .map((i) => i.id)
          .sort(),
      ).toEqual(['a', 'b', 'c']);
      editor.undo();
      expect(editor.getItem('z')).toBeTruthy();
    });

    it('save / isDirty', () => {
      create();
      expect(editor.isDirty()).toBe(false);
      editor.moveItem('a', 8, 0);
      expect(editor.isDirty()).toBe(true);
      const onSave = jest.fn();
      editor.on('save', onSave);
      const saved = editor.save();
      expect(onSave).toHaveBeenCalledWith(saved);
      expect(editor.isDirty()).toBe(false);
    });

    it('변경이 없는 연산은 이벤트와 히스토리를 만들지 않는다', () => {
      create();
      const onChange = jest.fn();
      editor.on('layoutChange', onChange);
      editor.moveItem('a', 0, 0);
      editor.moveItem('nope', 3, 3);
      expect(onChange).not.toHaveBeenCalled();
      expect(editor.canUndo()).toBe(false);
    });
  });

  describe('반응형', () => {
    it('mobile breakpoint 편집은 해당 breakpoint 에만 저장된다', () => {
      create();
      const onBp = jest.fn();
      editor.on('breakpointChange', onBp);
      editor.setBreakpoint('mobile');
      expect(onBp).toHaveBeenCalledWith(expect.objectContaining({ name: 'mobile', columns: 4 }));
      expect(editor.getColumns()).toBe(4);
      // 4열: 세로 적층 상태
      expect(editor.getItems().every((i) => i.x === 0 && i.w === 4)).toBe(true);

      editor.moveItem('c', 0, 0);
      const layout = editor.getLayout();
      expect(byId(layout.items, 'c').responsive!.mobile).toMatchObject({ x: 0, y: 0 });
      expect(byId(layout.items, 'c')).toMatchObject({ x: 0, y: 2, w: 8 }); // 기본 레이아웃은 그대로

      editor.setBreakpoint(null);
      expect(editor.getItem('c')).toMatchObject({ y: 2, w: 8 });
      expect(() => editor.setBreakpoint('nope')).toThrow();
    });

    it('기본값은 breakpoint 를 자동 선택하지 않는다 (폭이 줄어도 배치 유지)', () => {
      create();
      expect(editor.getBreakpoint()).toBeNull();
      const before = editor.getItems();
      Object.defineProperty(container.querySelector('.daracl-drift'), 'clientWidth', {
        value: 500,
        configurable: true,
      });
      editor.refresh();
      expect(editor.getBreakpoint()).toBeNull();
      expect(editor.getItems()).toEqual(before);
    });

    it('responsive:true 이면 컨테이너 폭으로 breakpoint 를 자동 선택한다', () => {
      create({ responsive: true });
      Object.defineProperty(container.querySelector('.daracl-drift'), 'clientWidth', {
        value: 500,
        configurable: true,
      });
      editor.refresh();
      expect(editor.getBreakpoint()?.name).toBe('mobile');
      editor.setBreakpoint(null);
      expect(editor.getBreakpoint()).toBeNull();
    });
  });

  describe('destroy', () => {
    it('DOM 과 이벤트 리스너를 정리한다', () => {
      create();
      const target = el('a');
      const onChange = jest.fn();
      editor.on('layoutChange', onChange);
      editor.destroy();

      expect(container.querySelector('.daracl-drift')).toBeNull();
      expect(container.classList.contains('ddr-editor')).toBe(false);

      // 제거된 후에는 이벤트를 받지 않는다
      container.appendChild(target);
      pointer(target, 'pointerdown', 10, 10);
      pointer(target, 'pointermove', 400, 400);
      pointer(target, 'pointerup', 400, 400);
      expect(onChange).not.toHaveBeenCalled();
      expect(() => editor.destroy()).not.toThrow();
      expect(editor.removeItem('a')).toBe(false);
    });

    it('존재하지 않는 컨테이너는 예외', () => {
      expect(() => createDriftEditor('#nope')).toThrow();
    });
  });
});
