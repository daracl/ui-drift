import { createDriftEditor, DriftChangeInfo, DriftEditor, DriftEditorOptions } from '@/index';
import { dragHandle, mockRects, pointer, STRIDE_X, STRIDE_Y } from './_helpers';

describe('위치 고정(locked)과 크기 조절(resizable) 독립 제어: 옵션 / API / 조작', () => {
  let container: HTMLElement;
  let editor: DriftEditor;
  let spy: jest.SpyInstance;

  const LAYOUT = {
    columns: 12,
    items: [
      { id: 'fix', x: 0, y: 0, w: 4, h: 2, locked: true, resizable: true }, // 위치만 고정, 크기 조절 가능
      { id: 'size', x: 4, y: 0, w: 4, h: 2, resizable: false }, // 크기만 고정, 이동 가능
      { id: 'all', x: 8, y: 0, w: 4, h: 2, locked: true }, // 위치·크기 모두 고정(기존 동작)
      { id: 'free', x: 0, y: 2, w: 4, h: 2 }, // 둘 다 가능
    ],
  };
  const create = (options: DriftEditorOptions = {}, layout: DriftEditorOptions['layout'] = LAYOUT) => {
    editor = createDriftEditor(container, { layout, ...options });
    return editor;
  };
  const el = (id: string) => container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
  const grip = (id: string, dir: 'se' | 'sw') =>
    el(id).querySelector(`.ddr-resize-handle[data-dir="${dir}"]`) as HTMLElement;
  const get = (id: string) => editor.getItems().find((i) => i.id === id)!;
  const key = (target: Element, k: string, shiftKey = false) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));

  /** 우하단(se) 핸들을 눌러 (dxCells, dyCells) 만큼 끌어 놓는다 */
  const resizeSe = (id: string, dxCells: number, dyCells: number) => {
    const it = get(id);
    const sx = (it.x + it.w) * STRIDE_X - 8;
    const sy = (it.y + it.h) * STRIDE_Y - 8;
    pointer(grip(id, 'se'), 'pointerdown', sx, sy);
    pointer(grip(id, 'se'), 'pointermove', sx + 6, sy + 6);
    pointer(grip(id, 'se'), 'pointermove', sx + dxCells * STRIDE_X, sy + dyCells * STRIDE_Y);
    pointer(grip(id, 'se'), 'pointerup', sx + dxCells * STRIDE_X, sy + dyCells * STRIDE_Y);
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

  describe('조합별 상태 (getItemState)', () => {
    it('네 가지 조합이 독립적으로 판정된다', () => {
      create();
      expect(editor.getItemState('fix')).toEqual({
        locked: true,
        movable: false,
        resizable: true,
        resizableOption: true,
      });
      expect(editor.getItemState('all')).toEqual({
        locked: true,
        movable: false,
        resizable: false,
        resizableOption: null,
      });
      expect(editor.getItemState('size')).toEqual({
        locked: false,
        movable: true,
        resizable: false,
        resizableOption: false,
      });
      expect(editor.getItemState('free')).toEqual({
        locked: false,
        movable: true,
        resizable: true,
        resizableOption: null,
      });
      expect(editor.getItemState('nope')).toBeUndefined();
    });

    it('카드 클래스: 크기 조절 불가는 ddr-no-resize, 위치 고정은 ddr-locked + 왼쪽 핸들만 숨김(ddr-no-resize-left)', () => {
      create();
      const cls = (id: string) => ({
        locked: el(id).classList.contains('ddr-locked'),
        noResize: el(id).classList.contains('ddr-no-resize'),
        noLeft: el(id).classList.contains('ddr-no-resize-left'),
      });
      expect(cls('fix')).toEqual({ locked: true, noResize: false, noLeft: true });
      expect(cls('all')).toEqual({ locked: true, noResize: true, noLeft: true });
      expect(cls('size')).toEqual({ locked: false, noResize: true, noLeft: false });
      expect(cls('free')).toEqual({ locked: false, noResize: false, noLeft: false });
    });
  });

  describe('API: setLocked / setResizable', () => {
    it('setLocked 는 위치 고정만 바꾸고 크기 조절 설정은 건드리지 않는다', () => {
      create();
      editor.setLocked('free', true);
      expect(editor.getItemState('free')).toEqual({
        locked: true,
        movable: false,
        resizable: false,
        resizableOption: null,
      });
      editor.setLocked('free', false);
      expect(editor.getItemState('free')).toEqual({
        locked: false,
        movable: true,
        resizable: true,
        resizableOption: null,
      });
      // 명시한 resizable 은 잠금을 바꿔도 유지된다
      editor.setLocked('size', true);
      expect(editor.getItemState('size')).toMatchObject({ locked: true, resizable: false, resizableOption: false });
      editor.setLocked('fix', false);
      expect(editor.getItemState('fix')).toMatchObject({ locked: false, resizable: true, resizableOption: true });
    });

    it('setResizable(true/false/null): 위치 고정과 독립이고 null 은 명시를 지운다', () => {
      create();
      editor.setResizable('all', true); // 고정 항목의 크기만 조절 가능하게
      expect(editor.getItemState('all')).toMatchObject({ locked: true, resizable: true, resizableOption: true });
      editor.setResizable('all', false);
      expect(editor.getItemState('all')).toMatchObject({ locked: true, resizable: false, resizableOption: false });
      editor.setResizable('all', null);
      expect(editor.getItemState('all')).toMatchObject({ locked: true, resizable: false, resizableOption: null });
      editor.setResizable('free', false);
      expect(editor.getItemState('free')).toMatchObject({ locked: false, resizable: false });
      editor.setResizable('free', null);
      expect(editor.getItemState('free')).toMatchObject({ locked: false, resizable: true, resizableOption: null });
    });

    it('반환값/예외 처리: 없는 id 는 undefined, 변경 항목을 돌려준다', () => {
      create();
      expect(editor.setLocked('nope', true)).toBeUndefined();
      expect(editor.setResizable('nope', true)).toBeUndefined();
      expect(editor.setResizable('free', false)).toMatchObject({ id: 'free', resizable: false });
    });

    it('기본값으로 되돌리면 JSON 에 속성이 남지 않는다', () => {
      create();
      editor.setLocked('free', true);
      editor.setResizable('free', true);
      editor.setLocked('free', false);
      editor.setResizable('free', null);
      const free = editor.getLayout().items.find((i) => i.id === 'free')!;
      expect(JSON.parse(JSON.stringify(free))).toEqual({ id: 'free', x: 0, y: 2, w: 4, h: 2 });
    });

    it('이벤트/이력/출처: 일반 변경과 같고 호출별 옵션을 지원한다', () => {
      create();
      const infos: DriftChangeInfo[] = [];
      editor.on('layoutChange', (_l, info) => infos.push(info));
      editor.setLocked('free', true);
      editor.setResizable('free', true, { source: 'sync', history: false });
      editor.setLocked('free', false, { emit: false });
      expect(infos.map((i) => [i.reason, i.source])).toEqual([
        ['update', 'api'],
        ['update', 'sync'],
      ]);
      expect(infos[0].changes.changed[0]).toMatchObject({ id: 'free', moved: false, resized: false });
      expect(infos[0].changes.changed[0].after.locked).toBe(true);
      expect(editor.canUndo()).toBe(true);
      editor.undo(); // setLocked(free, true) 한 단계만 기록됨 (나머지는 history:false / emit:false 와 별개로 기록 여부만 다르다)
    });

    it('변경이 없으면 이벤트도 이력도 만들지 않는다', () => {
      create();
      const handler = jest.fn();
      editor.on('layoutChange', handler);
      editor.setLocked('all', true);
      editor.setResizable('fix', true);
      editor.setResizable('free', null);
      expect(handler).not.toHaveBeenCalled();
      expect(editor.canUndo()).toBe(false);
    });

    it('destroy 후 호출은 아무 일도 하지 않는다', () => {
      create();
      editor.destroy();
      expect(editor.setLocked('free', true)).toBeUndefined();
      expect(editor.setResizable('free', true)).toBeUndefined();
    });
  });

  describe('조작: 마우스 / 키보드', () => {
    it('위치만 고정(locked + resizable:true): 드래그 이동은 안 되고 우하단 핸들로 크기는 조절된다', () => {
      create();
      dragHandle(container, 'fix', { x: 0, y: 0 }, 6, 4);
      expect(get('fix')).toMatchObject({ x: 0, y: 0, w: 4, h: 2 });

      resizeSe('fix', 2, 1);
      expect(get('fix')).toMatchObject({ x: 0, y: 0, w: 6, h: 3 });
      // 고정 장애물이므로 그 자리를 차지하던 항목들이 비켜갔고 겹치지 않는다
      expect(get('free').y).toBeGreaterThanOrEqual(3);
      expect(el('fix').style.left).toBe('');
    });

    it('위치만 고정: 왼쪽(sw) 핸들은 쓸 수 없다 (왼쪽 가장자리가 움직이기 때문)', () => {
      create({}, { columns: 12, items: [{ id: 'fix', x: 4, y: 0, w: 4, h: 2, locked: true, resizable: true }] });
      const sx = 4 * STRIDE_X + 6;
      const sy = 2 * STRIDE_Y - 14;
      pointer(grip('fix', 'sw'), 'pointerdown', sx, sy);
      pointer(grip('fix', 'sw'), 'pointermove', sx - 8, sy);
      pointer(grip('fix', 'sw'), 'pointermove', sx - 2 * STRIDE_X, sy);
      pointer(grip('fix', 'sw'), 'pointerup', sx - 2 * STRIDE_X, sy);
      expect(get('fix')).toMatchObject({ x: 4, w: 4 });
      expect(el('fix').classList.contains('ddr-resizing')).toBe(false);
    });

    it('위치·크기 모두 고정(locked 만 지정): 이동도 리사이즈도 안 된다 (기존 호환)', () => {
      create();
      dragHandle(container, 'all', { x: 8, y: 0 }, 2, 6);
      resizeSe('all', 1, 2);
      expect(get('all')).toMatchObject({ x: 8, y: 0, w: 4, h: 2 });
    });

    it('크기만 고정(resizable:false): 리사이즈는 안 되고 이동은 된다', () => {
      create();
      resizeSe('size', 2, 2);
      expect(get('size')).toMatchObject({ w: 4, h: 2 });
      editor.destroy();
      container.innerHTML = '';
      create({}, { columns: 12, items: [{ id: 'size', x: 0, y: 0, w: 4, h: 2, resizable: false }] });
      dragHandle(container, 'size', { x: 0, y: 0 }, 6, 0);
      expect(get('size')).toMatchObject({ x: 6, w: 4 });
    });

    it('고정 항목을 키우다 다른 locked 항목과 겹치면 무효 placeholder 로 표시되고 적용되지 않는다', () => {
      create(
        {},
        {
          columns: 12,
          items: [
            { id: 'fix', x: 0, y: 0, w: 4, h: 2, locked: true, resizable: true },
            { id: 'wall', x: 5, y: 0, w: 2, h: 4, locked: true },
          ],
        },
      );
      const before = editor.getLayout();
      const sx = 4 * STRIDE_X - 8;
      const sy = 2 * STRIDE_Y - 8;
      const g = grip('fix', 'se');
      pointer(g, 'pointerdown', sx, sy);
      pointer(g, 'pointermove', sx + 6, sy);
      pointer(g, 'pointermove', sx + 2 * STRIDE_X, sy);
      expect(container.querySelector('.ddr-placeholder')!.classList.contains('ddr-placeholder-invalid')).toBe(true);
      pointer(g, 'pointerup', sx + 2 * STRIDE_X, sy);
      expect(editor.getLayout()).toEqual(before);
    });

    it('겹치지 않는 크기로 키우는 동안에는 자기 자신 때문에 무효 표시가 되지 않는다', () => {
      create();
      const it = get('fix');
      const g = grip('fix', 'se');
      const sx = (it.x + it.w) * STRIDE_X - 8;
      const sy = (it.y + it.h) * STRIDE_Y - 8;
      pointer(g, 'pointerdown', sx, sy);
      pointer(g, 'pointermove', sx + 6, sy);
      pointer(g, 'pointermove', sx + STRIDE_X, sy);
      expect(container.querySelector('.ddr-placeholder')!.classList.contains('ddr-placeholder-invalid')).toBe(false);
      pointer(g, 'pointerup', sx + STRIDE_X, sy);
    });

    it('사용자 리사이즈의 변경 정보: source:user, 크기가 바뀐 고정 항목과 밀려난 항목이 모두 changed 에 있다', () => {
      create();
      const infos: DriftChangeInfo[] = [];
      editor.on('layoutChange', (_l, info) => infos.push(info));
      resizeSe('fix', 0, 3);
      expect(infos).toHaveLength(1);
      expect(infos[0]).toMatchObject({ reason: 'resize', source: 'user' });
      const ids = infos[0].changes.changed.map((c) => c.id);
      expect(ids).toContain('fix');
      expect(ids).toContain('free');
      expect(infos[0].changes.changed.find((c) => c.id === 'fix')).toMatchObject({ moved: false, resized: true });
    });

    it('키보드: 위치만 고정이면 방향키 이동은 무시하고 Shift+방향키 리사이즈는 동작한다', () => {
      create();
      key(el('fix'), 'ArrowRight');
      key(el('fix'), 'ArrowDown');
      expect(get('fix')).toMatchObject({ x: 0, y: 0 });
      key(el('fix'), 'ArrowRight', true);
      key(el('fix'), 'ArrowDown', true);
      expect(get('fix')).toMatchObject({ x: 0, y: 0, w: 5, h: 3 });
      // 둘 다 고정/크기만 고정/둘 다 가능
      key(el('all'), 'ArrowRight', true);
      expect(get('all').w).toBe(4);
      key(el('size'), 'ArrowRight', true); // 크기만 고정: 리사이즈 무시
      expect(get('size').w).toBe(4);
      editor.destroy();
      container.innerHTML = '';
      create({}, { columns: 12, items: [{ id: 'size', x: 4, y: 0, w: 4, h: 2, resizable: false }] });
      key(el('size'), 'ArrowLeft'); // 이동은 가능
      expect(get('size').x).toBe(3);
    });

    it('에디터 전체 resizable=false 이면 위치만 고정 항목의 크기 조절도 막는다', () => {
      create({ resizable: false });
      resizeSe('fix', 2, 1);
      expect(get('fix')).toMatchObject({ w: 4, h: 2 });
    });
  });

  describe('옵션: lockedResizable', () => {
    const items = {
      columns: 12,
      items: [
        { id: 'auto', x: 0, y: 0, w: 4, h: 2, locked: true }, // resizable 명시 없음
        { id: 'off', x: 8, y: 0, w: 4, h: 2, locked: true, resizable: false }, // 명시 false
      ],
    };

    it('기본(false): resizable 을 명시하지 않은 locked 항목은 크기도 고정', () => {
      create({}, items);
      expect(editor.isLockedResizable()).toBe(false);
      expect(editor.getItemState('auto')).toMatchObject({ resizable: false, resizableOption: null });
      resizeSe('auto', 1, 1);
      expect(get('auto')).toMatchObject({ w: 4, h: 2 });
    });

    it('true: 명시하지 않은 locked 항목의 크기를 조절할 수 있고, 명시한 false 는 우선한다', () => {
      create({ lockedResizable: true }, items);
      expect(editor.isLockedResizable()).toBe(true);
      expect(editor.getItemState('auto')).toMatchObject({ locked: true, resizable: true, resizableOption: null });
      expect(editor.getItemState('off')).toMatchObject({ locked: true, resizable: false, resizableOption: false });
      expect(el('auto').classList.contains('ddr-no-resize')).toBe(false);
      expect(el('off').classList.contains('ddr-no-resize')).toBe(true);

      resizeSe('auto', 1, 1);
      expect(get('auto')).toMatchObject({ x: 0, y: 0, w: 5, h: 3 }); // 위치는 그대로
      resizeSe('off', 1, 1);
      expect(get('off')).toMatchObject({ w: 4, h: 2 });
      // 프로그램 호출/키보드도 같은 기준을 따른다
      editor.resizeItem('auto', 6, 3);
      expect(get('auto').w).toBe(6);
      key(el('auto'), 'ArrowRight', true);
      expect(get('auto').w).toBe(7);
      dragHandle(container, 'auto', { x: 0, y: 0 }, 8, 6); // 이동은 여전히 불가
      expect(get('auto')).toMatchObject({ x: 0, y: 0 });
    });

    it('setLockedResizable 로 런타임에 바꾸면 핸들 표시와 동작이 즉시 바뀐다 (이벤트/이력 없음)', () => {
      create({}, items);
      const handler = jest.fn();
      editor.on('layoutChange', handler);
      editor.setLockedResizable(true);
      expect(el('auto').classList.contains('ddr-no-resize')).toBe(false);
      resizeSe('auto', 1, 0);
      expect(get('auto').w).toBe(5);
      handler.mockClear();
      editor.setLockedResizable(false);
      expect(el('auto').classList.contains('ddr-no-resize')).toBe(true);
      resizeSe('auto', 1, 0);
      expect(get('auto').w).toBe(5); // 다시 고정
      expect(handler).not.toHaveBeenCalled(); // 옵션 변경 자체는 레이아웃 변경이 아니다
      expect(editor.getLayout().items.find((i) => i.id === 'auto')).not.toHaveProperty('resizable');
    });
  });

  it('JSON 저장/복원: 조합이 그대로 보존된다', () => {
    create();
    const restoredEditor = createDriftEditor(document.createElement('div'), { layout: editor.toJSON() });
    ['fix', 'all', 'size', 'free'].forEach((id) => {
      expect(restoredEditor.getItemState(id)).toEqual(editor.getItemState(id));
    });
    restoredEditor.destroy();
  });
});
