import { createDriftEditor, createDriftManager, DriftEditor, DriftManager, DriftManagerEvents } from '@/index';

/**
 * jsdom 에는 레이아웃이 없으므로 컨테이너마다 data-top 으로 세로 위치를 정해 캔버스 위치를 모킹한다.
 * 모든 캔버스는 left 0, 폭 1200, 높이 200 이다. 팔레트(.pal)는 화면 위쪽 밖이 아닌 오른쪽에 둔다.
 */
const WIDTH = 1200;
const HEIGHT = 200;

function mockRects(): jest.SpyInstance {
  return jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const host = el.classList.contains('ddr-editor') ? el : (el.closest('.ddr-editor') as HTMLElement | null);
    if (el.classList.contains('pal')) {
      return { left: 1300, top: 10, width: 80, height: 30, right: 1380, bottom: 40 } as DOMRect;
    }
    const top = Number(host?.dataset.top ?? 0);
    if (el.classList.contains('daracl-drift') || el.classList.contains('ddr-editor')) {
      return { left: 0, top, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: top + HEIGHT } as DOMRect;
    }
    return { left: 0, top, width: 100, height: 100, right: 100, bottom: top + 100 } as DOMRect;
  });
}

function pointer(target: Element | Document, type: string, x: number, y: number, pointerType = 'mouse') {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

function key(target: Element | Document, k: string, extra: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
}

const total = (m: DriftManager) => m.getAll().reduce((n, { editor }) => n + editor.getLayout().items.length, 0);

describe('DriftManager', () => {
  let spy: jest.SpyInstance;
  let els: Record<string, HTMLElement>;
  let palette: HTMLElement;
  let source: HTMLElement;
  let manager: DriftManager;

  const makeEl = (id: string, top: number) => {
    const el = document.createElement('div');
    el.id = id;
    el.dataset.top = String(top);
    document.body.appendChild(el);
    return el;
  };

  /** 공통 팔레트를 끌어 editor 의 (cellX, cellY) 칸 근처로 옮긴다. 놓지는 않는다 */
  const dragOver = (editor: DriftEditor, cellX: number, cellY: number, w = 3, h = 2, first = true) => {
    const m = editor.getMetrics();
    const top = Number((editor.element.parentElement as HTMLElement).dataset.top);
    const px = cellX * (m.cellWidth + m.gap) + (w * (m.cellWidth + m.gap)) / 2;
    const py = top + cellY * (m.rowHeight + m.gap) + (h * (m.rowHeight + m.gap)) / 2 - 2;
    if (first) {
      pointer(source, 'pointerdown', 1310, 20);
      pointer(source, 'pointermove', 1300, 30);
    }
    pointer(source, 'pointermove', px, py);
    return { px, py };
  };
  const dropOn = (editor: DriftEditor, cellX: number, cellY: number, w = 3, h = 2) => {
    const { px, py } = dragOver(editor, cellX, cellY, w, h);
    pointer(source, 'pointerup', px, py);
  };

  beforeEach(() => {
    spy = mockRects();
    els = { a: makeEl('a', 0), b: makeEl('b', 250), c: makeEl('c', 500) };
    palette = document.createElement('div');
    palette.innerHTML = '<div class="pal" data-w="3" data-h="2" data-title="Chart">Chart</div>';
    document.body.appendChild(palette);
    source = palette.querySelector('.pal') as HTMLElement;
    manager = createDriftManager();
  });

  afterEach(() => {
    manager.destroy();
    spy.mockRestore();
    document.body.innerHTML = '';
  });

  const registerAll = () => {
    const a = manager.register('a', els.a, { columns: 12, breakpoints: [] });
    const b = manager.register('b', '#b', {
      columns: 6,
      rowHeight: 30,
      breakpoints: [{ name: 'mobile', maxWidth: 640, columns: 2 }],
    });
    const c = manager.register('c', els.c, { columns: 24, gap: 4, breakpoints: [] });
    return { a, b, c };
  };

  // ───────────────────────────── 등록 ─────────────────────────────

  describe('등록 / 조회 / 해제', () => {
    it('빈 상태', () => {
      expect(manager.getIds()).toEqual([]);
      expect(manager.getAll()).toEqual([]);
      expect(manager.getActiveId()).toBeNull();
      expect(manager.getActiveEditor()).toBeNull();
      expect(manager.get('x')).toBeUndefined();
      expect(manager.has('x')).toBe(false);
      expect(manager.unregister('x')).toBe(false);
      expect(manager.getLayouts()).toEqual({ version: 1, containers: [] });
    });

    it('여러 컨테이너를 등록 순서대로 관리하고 selector 도 받는다', () => {
      const { a, b, c } = registerAll();
      expect(manager.getIds()).toEqual(['a', 'b', 'c']);
      expect(manager.getAll().map((e) => e.editor)).toEqual([a, b, c]);
      expect(manager.get('b')).toBe(b);
      expect(manager.has('c')).toBe(true);
      expect(manager.getIdOf(c)).toBe('c');
      expect(b.getColumns()).toBe(6);
      expect(c.getColumns()).toBe(24);
      expect(els.b.querySelector('.daracl-drift')).toBe(b.element);
    });

    it('잘못된 id, 중복 id, 중복 요소, 없는 대상은 예외이며 상태는 그대로다', () => {
      manager.register('a', els.a);
      expect(() => manager.register('', els.b)).toThrow('[drift] 컨테이너 id');
      expect(() => manager.register('   ', els.b)).toThrow('[drift] 컨테이너 id');
      expect(() => manager.register(1 as unknown as string, els.b)).toThrow('[drift] 컨테이너 id');
      expect(() => manager.register('a', els.b)).toThrow('이미 등록된 컨테이너 id');
      expect(() => manager.register('a2', els.a)).toThrow('이미 에디터가 사용 중');
      expect(() => manager.register('x', '#nope')).toThrow('컨테이너를 찾을 수 없습니다');
      expect(() => manager.register('x', null as unknown as HTMLElement)).toThrow('컨테이너를 찾을 수 없습니다');
      expect(manager.getIds()).toEqual(['a']);
      expect(els.b.querySelector('.daracl-drift')).toBeNull();
    });

    it('다른 Manager 나 createDriftEditor 가 사용 중인 요소는 등록할 수 없고, 해제 후에는 가능하다', () => {
      const other = createDriftManager();
      other.register('a', els.a);
      expect(() => manager.register('a', els.a)).toThrow('이미 에디터가 사용 중');
      const plain = createDriftEditor(els.b);
      expect(() => manager.register('b', els.b)).toThrow('이미 에디터가 사용 중');
      plain.destroy();
      other.destroy();
      expect(() => manager.register('a', els.a)).not.toThrow();
      expect(() => manager.register('b', els.b)).not.toThrow();
    });

    it('에디터 생성이 실패하면 만들어진 리소스를 정리하고 등록하지 않는다', () => {
      const calls: string[] = [];
      expect(() =>
        manager.register('a', els.a, {
          layout: { items: [{ id: 'x', x: 0, y: 0, w: 2, h: 2 }] },
          contentLifecycle: {
            mount: () => {
              throw new Error('mount 실패');
            },
            unmount: (item) => calls.push(`unmount:${item.id}`),
          },
        }),
      ).toThrow('mount 실패');
      expect(manager.has('a')).toBe(false);
      expect(els.a.querySelector('.daracl-drift')).toBeNull();
      expect(els.a.classList.contains('ddr-editor')).toBe(false);
      expect(calls).toEqual(['unmount:x']);
      // 다시 등록할 수 있다
      expect(manager.register('a', els.a)).toBeInstanceOf(DriftEditor);
    });

    it('unregister 는 에디터를 destroy 하고 컨테이너 요소는 남긴다. 나머지는 정상 동작한다', () => {
      const { a, b } = registerAll();
      const events: string[] = [];
      manager.on('containerUnregistered', (e) => events.push(e.containerId));
      expect(manager.unregister('a')).toBe(true);
      expect(manager.unregister('a')).toBe(false);
      expect(a.isDestroyed()).toBe(true);
      expect(els.a.isConnected).toBe(true);
      expect(els.a.querySelector('.daracl-drift')).toBeNull();
      expect(manager.getIds()).toEqual(['b', 'c']);
      expect(events).toEqual(['a']);
      b.addItem({ id: 'x', w: 2, h: 2 });
      expect(b.getItems()).toHaveLength(1);
    });

    it('에디터를 직접 destroy 해도 등록이 정리된다', () => {
      const { b } = registerAll();
      manager.setActive('b');
      const events: string[] = [];
      manager.on('containerUnregistered', (e) => events.push(e.containerId));
      b.destroy();
      expect(manager.has('b')).toBe(false);
      expect(manager.getActiveId()).toBeNull();
      expect(events).toEqual(['b']);
    });

    it('destroy 는 모든 에디터를 해제하고 두 번 호출해도 안전하다. 이후 호출은 무시되거나 명확히 실패한다', () => {
      const { a, b, c } = registerAll();
      const events: string[] = [];
      manager.on('containerUnregistered', (e) => events.push(e.containerId));
      manager.destroy();
      manager.destroy();
      expect(events).toEqual(['a', 'b', 'c']);
      expect([a, b, c].every((e) => e.isDestroyed())).toBe(true);
      expect(manager.isDestroyed()).toBe(true);
      expect(manager.getIds()).toEqual([]);
      expect(() => manager.register('a', els.a)).toThrow('destroy 된 manager');
      expect(() => manager.setupDragIn('.pal')).toThrow('destroy 된 manager');
      expect(manager.fromJSON('{"version":1,"containers":[]}')).toEqual([]);
      expect(() => manager.setActive('a')).not.toThrow();
    });

    it('반복 등록/해제 후 남는 DOM 과 리스너가 없다', () => {
      const add = jest.spyOn(document, 'addEventListener');
      for (let i = 0; i < 20; i++) {
        registerAll();
        manager.unregister('a');
        manager.unregister('b');
        manager.unregister('c');
      }
      expect(document.querySelectorAll('.daracl-drift')).toHaveLength(0);
      expect(document.querySelectorAll('.ddr-editor')).toHaveLength(0);
      // setupDragIn 이 없으면 끌어오기용 document 리스너를 붙이지 않는다 (에디터마다 Esc 취소용 keydown 하나만)
      const types = add.mock.calls.map((c) => c[0]);
      expect(types.filter((t) => t === 'pointermove')).toHaveLength(0);
      expect(types.filter((t) => t === 'keydown')).toHaveLength(60);
      add.mockRestore();
    });
  });

  // ───────────────────────────── 독립성 ─────────────────────────────

  describe('컨테이너 독립성', () => {
    it('A 의 변경/undo/resize 가 B, C 에 영향을 주지 않는다', () => {
      const { a, b, c } = registerAll();
      b.addItem({ id: 'k', x: 0, y: 0, w: 2, h: 2 });
      c.addItem({ id: 'k', x: 0, y: 0, w: 4, h: 2 });
      const bJson = b.toJSON();
      const cJson = c.toJSON();
      a.addItem({ id: 'k', x: 0, y: 0, w: 4, h: 2 });
      a.resizeItem('k', 6, 3);
      a.moveItem('k', 2, 0);
      expect(a.getItem('k')).toMatchObject({ x: 2, y: 0, w: 6, h: 3 });
      expect(b.toJSON()).toBe(bJson);
      expect(c.toJSON()).toBe(cJson);
      expect(a.undo()).toBe(true);
      expect(a.getItem('k')).toMatchObject({ x: 0, w: 6 });
      expect(b.toJSON()).toBe(bJson);
      expect(b.canUndo()).toBe(true);
      expect(b.undo()).toBe(true);
      expect(b.getItems()).toEqual([]);
      expect(a.getItem('k')).toBeDefined();
      expect(c.getItem('k')).toBeDefined();
    });

    it('같은 항목 id 를 여러 컨테이너에서 쓰고, 각 컨테이너의 DOM 과 위치 스타일이 분리된다', () => {
      const { a, b } = registerAll();
      a.addItem({ id: 'same', x: 1, y: 0, w: 3, h: 2 });
      b.addItem({ id: 'same', x: 0, y: 1, w: 2, h: 1 });
      const ea = els.a.querySelector('[data-drift-id="same"]') as HTMLElement;
      const eb = els.b.querySelector('[data-drift-id="same"]') as HTMLElement;
      expect(ea).not.toBe(eb);
      expect(ea.dataset).toMatchObject({ x: '1', w: '3' });
      expect(eb.dataset).toMatchObject({ x: '0', w: '2' });
      // 위치 규칙은 에디터 인스턴스별(data-ddr) 범위를 가진다
      expect(a.element.dataset.ddr).toBeTruthy();
      expect(a.element.dataset.ddr).not.toBe(b.element.dataset.ddr);
    });

    it('breakpoint 와 선택이 컨테이너별로 독립이다', () => {
      const { a, b } = registerAll();
      a.addItem({ id: 'x', w: 2, h: 2 });
      b.addItem({ id: 'x', w: 2, h: 2 });
      b.setBreakpoint('mobile');
      expect(b.getColumns()).toBe(2);
      expect(a.getColumns()).toBe(12);
      expect(a.getBreakpoint()).toBeNull();
      a.select('x');
      expect(a.getSelected()?.id).toBe('x');
      expect(b.getSelected()).toBeNull();
    });

    it('키보드 조작은 포커스가 있는 컨테이너의 항목에서만 한 번 처리된다', () => {
      const { a, b } = registerAll();
      a.addItem({ id: 'x', x: 0, y: 0, w: 2, h: 2 });
      b.addItem({ id: 'x', x: 0, y: 0, w: 2, h: 2 });
      const changes: string[] = [];
      manager.on('layoutChange', (e) => changes.push(e.containerId));
      key(els.a.querySelector('[data-drift-id="x"]') as HTMLElement, 'ArrowRight');
      expect(a.getItem('x')?.x).toBe(1);
      expect(b.getItem('x')?.x).toBe(0);
      expect(changes).toEqual(['a']);
      // 항목 안의 입력 요소에서는 처리하지 않는다
      const input = document.createElement('input');
      (els.a.querySelector('.ddr-content') as HTMLElement).appendChild(input);
      key(input, 'ArrowRight');
      key(input, 'Delete');
      expect(a.getItem('x')?.x).toBe(1);
      // 전역 Esc 는 어느 에디터의 상태도 바꾸지 않는다
      key(document, 'Escape');
      expect(changes).toEqual(['a']);
    });
  });

  // ───────────────────────────── 활성 컨테이너 ─────────────────────────────

  describe('활성 컨테이너', () => {
    it('setActive / 포인터 / 포커스로 바뀌고 activeChange 가 한 번씩 발생한다', () => {
      const { b, c } = registerAll();
      const log: Parameters<DriftManagerEvents['activeChange']>[0][] = [];
      manager.on('activeChange', (e) => log.push(e));
      manager.setActive('b');
      manager.setActive('b');
      expect(manager.getActiveEditor()).toBe(b);
      pointer(c.element, 'pointerdown', 10, 510);
      expect(manager.getActiveId()).toBe('c');
      els.a.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(manager.getActiveId()).toBe('a');
      manager.setActive(null);
      expect(manager.getActiveEditor()).toBeNull();
      expect(log.map((e) => [e.previousId, e.containerId])).toEqual([
        [null, 'b'],
        ['b', 'c'],
        ['c', 'a'],
        ['a', null],
      ]);
      expect(log[0].editor).toBe(b);
      expect(() => manager.setActive('nope')).toThrow('등록되지 않은 컨테이너');
    });

    it('활성 컨테이너를 해제하면 활성 대상이 없어진다', () => {
      registerAll();
      manager.setActive('c');
      manager.unregister('c');
      expect(manager.getActiveId()).toBeNull();
      expect(manager.getActiveEditor()).toBeNull();
    });
  });

  // ───────────────────────────── 이벤트 ─────────────────────────────

  describe('이벤트 집계', () => {
    it('layoutChange 에 containerId 와 원래 info(reason/source/changes)가 실리고 에디터 이벤트도 그대로 발생한다', () => {
      const { a, b } = registerAll();
      const got: Parameters<DriftManagerEvents['layoutChange']>[0][] = [];
      const own: string[] = [];
      manager.on('layoutChange', (e) => got.push(e));
      a.on('layoutChange', (_l, info) => own.push(info.reason));
      a.addItem({ id: 'x', w: 2, h: 2 });
      b.addItem({ id: 'y', w: 2, h: 2 }, { source: 'user' });
      expect(got.map((e) => [e.containerId, e.info.reason, e.info.source])).toEqual([
        ['a', 'add', 'api'],
        ['b', 'add', 'user'],
      ]);
      expect(got[0].editor).toBe(a);
      expect(got[0].info.changes.added.map((i) => i.id)).toEqual(['x']);
      expect(got[1].layout.items[0].id).toBe('y');
      expect(own).toEqual(['add']);
      // 이벤트 데이터는 복사본이다
      got[0].layout.items[0].w = 99;
      expect(a.getItem('x')?.w).toBe(2);
    });

    it('나중에 등록한 컨테이너도 전달되고, 구독 해제 후에는 호출되지 않는다', () => {
      const handler = jest.fn();
      const off = manager.on('layoutChange', handler);
      const a = manager.register('a', els.a);
      a.addItem({ id: 'x', w: 1, h: 1 });
      expect(handler).toHaveBeenCalledTimes(1);
      off();
      a.addItem({ id: 'y', w: 1, h: 1 });
      expect(handler).toHaveBeenCalledTimes(1);
      const once = jest.fn();
      manager.once('layoutChange', once);
      a.addItem({ id: 'z', w: 1, h: 1 });
      a.removeItem('z');
      expect(once).toHaveBeenCalledTimes(1);
    });

    it('programmaticEvents:false 컨테이너의 프로그램 변경은 전달되지 않는다', () => {
      manager.register('a', els.a, { programmaticEvents: false });
      const handler = jest.fn();
      manager.on('layoutChange', handler);
      manager.get('a')?.addItem({ id: 'x', w: 1, h: 1 });
      expect(handler).not.toHaveBeenCalled();
      manager.get('a')?.addItem({ id: 'y', w: 1, h: 1 }, { source: 'user' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('이벤트 콜백에서 그 컨테이너를 해제하거나 Editor API 를 다시 호출해도 안전하다', () => {
      const { a, b } = registerAll();
      const seen: string[] = [];
      manager.on('layoutChange', (e) => {
        seen.push(`${e.containerId}:${e.info.reason}`);
        if (e.containerId === 'a') manager.unregister('a');
        if (e.containerId === 'b' && e.info.reason === 'add') e.editor.moveItem('y', 1, 0);
      });
      a.addItem({ id: 'x', w: 1, h: 1 });
      expect(manager.has('a')).toBe(false);
      b.addItem({ id: 'y', x: 0, y: 0, w: 1, h: 1 });
      expect(b.getItem('y')?.x).toBe(1);
      expect(seen).toEqual(['a:add', 'b:add', 'b:move']);
    });

    it('containerRegistered / containerUnregistered 순서', () => {
      const log: string[] = [];
      manager.on('containerRegistered', (e) => log.push(`+${e.containerId}`));
      manager.on('containerUnregistered', (e) => log.push(`-${e.containerId}`));
      manager.on('activeChange', (e) => log.push(`active:${e.containerId}`));
      registerAll();
      manager.setActive('b');
      manager.unregister('b');
      manager.destroy();
      expect(log).toEqual(['+a', '+b', '+c', 'active:b', 'active:null', '-b', '-a', '-c']);
    });
  });

  // ───────────────────────────── 저장 / 복원 ─────────────────────────────

  describe('저장 / 복원', () => {
    const fill = () => {
      const { a, b, c } = registerAll();
      a.addItem({ id: 'k', x: 0, y: 0, w: 4, h: 2, title: 'A', props: { kind: 'chart' } });
      b.addItem({ id: 'k', x: 0, y: 0, w: 2, h: 2 });
      b.addItem({ id: 'k2', x: 2, y: 0, w: 2, h: 2 });
      b.setBreakpoint('mobile');
      b.moveItem('k2', 0, 0);
      b.setBreakpoint(null);
      c.setFloat(true);
      c.addItem({ id: 'z', x: 3, y: 4, w: 2, h: 1 });
      return { a, b, c };
    };

    it('등록 순서와 기존 레이아웃 필드를 유지해 저장한다', () => {
      fill();
      const data = JSON.parse(manager.toJSON(2));
      expect(data.version).toBe(1);
      expect(data.containers.map((c: { id: string }) => c.id)).toEqual(['a', 'b', 'c']);
      expect(data.containers[0].layout.items[0]).toMatchObject({ id: 'k', title: 'A', props: { kind: 'chart' } });
      expect(data.containers[1].layout.columns).toBe(6);
      // breakpoint 편집 결과(responsive)가 보존된다: mobile 에서 k2 를 맨 위로 옮겨 k 가 아래로 밀렸다
      expect(data.containers[1].layout.items[0].responsive.mobile).toMatchObject({ x: 0, y: 2 });
      expect(data.containers[1].layout.items[1].responsive.mobile).toMatchObject({ x: 0, y: 0 });
      expect(data.containers[2].layout).toMatchObject({ float: true, columns: 24, gap: 4 });
      expect(data.containers[2].layout.items[0]).toMatchObject({ x: 3, y: 4 });
    });

    it('getLayouts 결과를 수정해도 내부 상태가 바뀌지 않는다', () => {
      const { a } = fill();
      const got = manager.getLayouts();
      got.containers[0].layout.items[0].w = 99;
      got.containers.pop();
      expect(a.getItem('k')?.w).toBe(4);
      expect(manager.getLayouts().containers).toHaveLength(3);
    });

    it('저장 → 변경 → 복원하면 같은 상태가 되고, 연속 왕복해도 데이터가 같다', () => {
      const { a, b, c } = fill();
      const json = manager.toJSON();
      a.clear();
      b.removeItem('k');
      c.addItem({ id: 'more', w: 2, h: 2 });
      expect(manager.fromJSON(json)).toEqual(['a', 'b', 'c']);
      // load 는 필드 순서를 정규화하므로 값으로 비교한다
      expect(JSON.parse(manager.toJSON())).toEqual(JSON.parse(json));
      const restored = manager.toJSON();
      for (let i = 0; i < 3; i++) manager.fromJSON(manager.toJSON());
      // 복원 이후의 왕복은 문자열까지 같다
      expect(manager.toJSON()).toBe(restored);
      // 객체로도 복원할 수 있고, 각 에디터의 load 와 같이 이력이 초기화된다
      manager.fromJSON(JSON.parse(json));
      expect(a.canUndo()).toBe(false);
      expect(a.isDirty()).toBe(false);
    });

    it('데이터에 없는 컨테이너는 그대로 두고(부분 갱신) layoutChange(reason:load)를 컨테이너별로 한 번 낸다', () => {
      const { a, b } = fill();
      const reasons: string[] = [];
      manager.on('layoutChange', (e) => reasons.push(`${e.containerId}:${e.info.reason}`));
      const bJson = b.toJSON();
      manager.fromJSON({
        version: 1,
        containers: [{ id: 'a', layout: { version: 1, columns: 12, rowHeight: 40, gap: 8, items: [] } }],
      });
      expect(a.getItems()).toEqual([]);
      expect(b.toJSON()).toBe(bJson);
      expect(reasons).toEqual(['a:load']);
    });

    it.each([
      ['손상된 JSON', '{bad', '해석할 수 없습니다'],
      ['객체가 아님', '[]', '객체여야'],
      ['지원하지 않는 version', '{"version":2,"containers":[]}', 'version: 2'],
      ['containers 없음', '{"version":1}', 'containers 는 배열'],
      ['빈 컨테이너 id', '{"version":1,"containers":[{"id":"","layout":{}}]}', '컨테이너 id'],
      [
        '중복 컨테이너 id',
        '{"version":1,"containers":[{"id":"a","layout":{}},{"id":"a","layout":{}}]}',
        '중복된 컨테이너 id',
      ],
      ['layout 없음', '{"version":1,"containers":[{"id":"a"}]}', 'layout 이 없습니다'],
      [
        'layout 구조 오류',
        '{"version":1,"containers":[{"id":"a","layout":{"version":9}}]}',
        '"a" 의 layout 이 올바르지 않습니다',
      ],
      [
        '미등록 컨테이너',
        '{"version":1,"containers":[{"id":"a","layout":{}},{"id":"zz","layout":{}}]}',
        '등록되지 않은 컨테이너입니다: zz',
      ],
    ])('%s 이면 예외를 던지고 아무것도 바꾸지 않는다', (_name, json, message) => {
      fill();
      const before = manager.toJSON();
      const handler = jest.fn();
      manager.on('layoutChange', handler);
      expect(() => manager.fromJSON(json)).toThrow(message);
      expect(manager.toJSON()).toBe(before);
      expect(handler).not.toHaveBeenCalled();
    });

    it("unknown:'ignore' 이면 미등록 컨테이너만 건너뛴다 (자동 생성하지 않는다)", () => {
      fill();
      const ids = manager.fromJSON('{"version":1,"containers":[{"id":"zz","layout":{}},{"id":"a","layout":{}}]}', {
        unknown: 'ignore',
      });
      expect(ids).toEqual(['a']);
      expect(manager.has('zz')).toBe(false);
      expect(manager.get('a')?.getItems()).toEqual([]);
    });

    it('적용 도중 실패하면 이미 적용한 컨테이너를 되돌리고 예외를 다시 던진다', () => {
      const a = manager.register('a', els.a, { layout: { items: [{ id: 'a1', x: 0, y: 0, w: 2, h: 2 }] } });
      manager.register('b', els.b, {
        contentLifecycle: {
          mount: (item) => {
            if (item.id === 'boom') throw new Error('mount boom');
          },
        },
      });
      const before = manager.toJSON();
      const data = {
        version: 1 as const,
        containers: [
          { id: 'a', layout: { version: 1 as const, columns: 12, rowHeight: 40, gap: 8, items: [] } },
          {
            id: 'b',
            layout: {
              version: 1 as const,
              columns: 12,
              rowHeight: 40,
              gap: 8,
              items: [{ id: 'boom', x: 0, y: 0, w: 1, h: 1 }],
            },
          },
        ],
      };
      expect(() => manager.fromJSON(data)).toThrow('mount boom');
      expect(manager.toJSON()).toBe(before);
      expect(a.getItem('a1')).toBeDefined();
    });
  });

  // ───────────────────────────── 공통 팔레트 끌어오기 ─────────────────────────────

  describe('공통 팔레트 끌어오기', () => {
    it('포인터 아래의 컨테이너 하나에만 정확히 한 번 추가되고 undo 한 번으로 되돌린다', () => {
      const { a, b, c } = registerAll();
      manager.setupDragIn('.pal');
      const end: Parameters<DriftManagerEvents['dragInEnd']>[0][] = [];
      manager.on('dragInEnd', (e) => end.push(e));
      const changes: string[] = [];
      manager.on('layoutChange', (e) => changes.push(e.containerId));

      dropOn(b, 1, 1);
      expect(total(manager)).toBe(1);
      expect(b.getItems()).toHaveLength(1);
      expect(b.getItems()[0]).toMatchObject({ w: 3, h: 2, title: 'Chart' });
      expect(a.getItems()).toEqual([]);
      expect(c.getItems()).toEqual([]);
      expect(changes).toEqual(['b']);
      expect(end).toEqual([{ containerId: 'b', item: expect.objectContaining({ w: 3 }) }]);
      expect(manager.getActiveId()).toBe('b');
      expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();

      dropOn(a, 4, 0);
      expect(a.getItems()).toHaveLength(1);
      expect(a.getItems()[0]).toMatchObject({ x: 4, y: 0, w: 3 });
      expect(total(manager)).toBe(2);

      expect(b.undo()).toBe(true);
      expect(b.getItems()).toEqual([]);
      expect(a.getItems()).toHaveLength(1);
    });

    it('서로 다른 컬럼 수 기준으로 위치를 계산한다', () => {
      const { c } = registerAll();
      manager.setupDragIn('.pal');
      dropOn(c, 10, 1);
      expect(c.getItems()[0]).toMatchObject({ x: 10, y: 0, w: 3 });
      expect(c.getColumns()).toBe(24);
    });

    it('끄는 도중 대상이 바뀌면 이전 컨테이너의 미리보기를 걷어낸다', () => {
      const { a, b } = registerAll();
      a.addItem({ id: 'a1', x: 0, y: 0, w: 4, h: 2 });
      manager.setupDragIn('.pal');
      dragOver(a, 0, 0);
      const phA = a.getPlaceholder();
      expect(els.a.classList.contains('ddr-dragin-over')).toBe(true);
      expect(phA.hidden).toBe(false);
      // 미리보기로 a1 이 아래로 밀렸다
      expect((els.a.querySelector('[data-drift-id="a1"]') as HTMLElement).dataset.y).not.toBe('0');
      const { px, py } = dragOver(b, 0, 0, 3, 2, false);
      expect(els.a.classList.contains('ddr-dragin-over')).toBe(false);
      expect(phA.hidden).toBe(true);
      expect((els.a.querySelector('[data-drift-id="a1"]') as HTMLElement).dataset.y).toBe('0');
      expect(els.b.classList.contains('ddr-dragin-over')).toBe(true);
      expect(b.getPlaceholder().hidden).toBe(false);
      // 드래그 중에는 모델이 바뀌지 않는다
      expect(a.getItems()).toHaveLength(1);
      expect(b.getItems()).toHaveLength(0);
      pointer(source, 'pointerup', px, py);
      expect(a.getItems()).toHaveLength(1);
      expect(b.getItems()).toHaveLength(1);
      expect(els.b.classList.contains('ddr-dragin-over')).toBe(false);
    });

    it('컨테이너 밖 drop, Esc, pointercancel 은 아무것도 추가하지 않고 모두 정리한다', () => {
      const { a } = registerAll();
      manager.setupDragIn('.pal');
      const end = jest.fn();
      manager.on('dragInEnd', end);

      // 밖 (컨테이너 사이 빈 공간 y=225)
      dragOver(a, 0, 0);
      pointer(source, 'pointermove', 100, 225);
      expect(els.a.classList.contains('ddr-dragin-over')).toBe(false);
      pointer(source, 'pointerup', 100, 225);
      // Esc
      dragOver(a, 0, 0);
      key(document, 'Escape');
      // pointercancel
      dragOver(a, 0, 0);
      pointer(source, 'pointercancel', 0, 0);

      expect(total(manager)).toBe(0);
      expect(end.mock.calls.map((c) => c[0])).toEqual([
        { containerId: null, item: null },
        { containerId: null, item: null },
        { containerId: null, item: null },
      ]);
      expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
      expect(document.querySelectorAll('.ddr-dragin-over')).toHaveLength(0);
      expect(a.getPlaceholder().hidden).toBe(true);
    });

    it('autoAdd:false 는 내부 상태를 바꾸지 않고 onDrop 에 containerId 를 준다. 콜백 안의 addItem 결과가 유지된다', () => {
      const { b } = registerAll();
      const results: { containerId: string; x: number; columns: number }[] = [];
      manager.setupDragIn('.pal', {
        autoAdd: false,
        onDrop: (r) => {
          results.push({ containerId: r.containerId, x: r.item.x, columns: r.columns });
          r.editor.addItem({ ...r.item, id: 'ext-1' });
        },
      });
      const end = jest.fn();
      manager.on('dragInEnd', end);
      dropOn(b, 2, 0);
      expect(results).toEqual([{ containerId: 'b', x: 2, columns: 6 }]);
      expect(b.getItems().map((i) => i.id)).toEqual(['ext-1']);
      expect(b.getItem('ext-1')).toMatchObject({ x: 2, y: 0 });
      expect(end).toHaveBeenCalledWith({ containerId: 'b', item: null });
      expect(total(manager)).toBe(1);
    });

    it('breakpoint 편집 중인 컨테이너에는 그 breakpoint 칸 기준으로 추가한다', () => {
      const { b } = registerAll();
      b.setBreakpoint('mobile');
      manager.setupDragIn('.pal', { item: { w: 1, h: 1 } });
      dropOn(b, 1, 0, 1, 1);
      const item = b.getItems()[0];
      expect(b.getColumns()).toBe(2);
      expect(item).toMatchObject({ x: 1, y: 0, w: 1 });
      expect(b.getLayout().items[0].responsive?.mobile).toMatchObject({ x: 1, y: 0 });
    });

    it('나중에 등록한 컨테이너에도 놓을 수 있다', () => {
      manager.setupDragIn('.pal');
      const late = manager.register('late', els.c);
      dropOn(late, 0, 0);
      expect(late.getItems()).toHaveLength(1);
    });

    it('끄는 도중 대상 컨테이너가 해제되면 미리보기를 걷어내고 거기에는 추가하지 않는다', () => {
      const { a, b } = registerAll();
      manager.setupDragIn('.pal');
      const { px, py } = dragOver(b, 0, 0);
      manager.unregister('b');
      expect(b.isDestroyed()).toBe(true);
      pointer(source, 'pointerup', px, py);
      expect(total(manager)).toBe(0);
      expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
      // 세션이 정리되어 다음 끌기가 정상 동작한다
      dropOn(a, 0, 0);
      expect(a.getItems()).toHaveLength(1);
    });

    it('끄는 도중 대상 에디터를 직접 destroy 해도 안전하다', () => {
      const { b } = registerAll();
      manager.setupDragIn('.pal');
      const { px, py } = dragOver(b, 0, 0);
      b.destroy();
      pointer(source, 'pointermove', px + 5, py);
      pointer(source, 'pointerup', px + 5, py);
      expect(total(manager)).toBe(0);
      expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
    });

    it('끄는 도중 Manager 를 destroy 하면 ghost/placeholder/리스너가 정리된다', () => {
      const { a } = registerAll();
      manager.setupDragIn('.pal');
      const { px, py } = dragOver(a, 0, 0);
      expect(document.querySelector('.ddr-dragin-ghost')).not.toBeNull();
      manager.destroy();
      expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
      expect(source.classList.contains('ddr-dragin-source')).toBe(false);
      pointer(source, 'pointerup', px, py);
      pointer(source, 'pointerdown', 1310, 20);
      pointer(source, 'pointermove', px, py);
      expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
    });

    it('해제 함수 이후에는 끌 수 없고, 에디터 개별 setupDragIn 도 그대로 동작한다', () => {
      const { a } = registerAll();
      const off = manager.setupDragIn('.pal');
      off();
      off();
      dropOn(a, 0, 0);
      expect(total(manager)).toBe(0);
      expect(source.classList.contains('ddr-dragin-source')).toBe(false);
      const ends: unknown[] = [];
      a.on('dragInEnd', (item) => ends.push(item));
      a.setupDragIn('.pal');
      dropOn(a, 0, 0);
      expect(a.getItems()).toHaveLength(1);
      expect(ends).toHaveLength(1);
    });

    it('터치 포인터로도 추가된다', () => {
      const { a } = registerAll();
      manager.setupDragIn('.pal');
      const m = a.getMetrics();
      const px = 1 * (m.cellWidth + m.gap) + (3 * (m.cellWidth + m.gap)) / 2;
      pointer(source, 'pointerdown', 1310, 20, 'touch');
      pointer(source, 'pointermove', 1300, 30, 'touch');
      pointer(source, 'pointermove', px, 40, 'touch');
      pointer(source, 'pointerup', px, 40, 'touch');
      expect(a.getItems()).toHaveLength(1);
    });
  });

  // ───────────────────────────── 예외·재진입 안정성 (docs/multi-container-audit-2026-11-07.md §1) ─────────────────────────────

  describe('콜백 예외와 재진입에도 정리가 끝까지 진행된다', () => {
    const boom = () => {
      throw new Error('검증용 예외');
    };

    it('activeChange 리스너가 예외를 던져도 unregister 는 에디터를 해제하고 예외를 다시 던진다', () => {
      const { a } = registerAll();
      manager.setActive('a');
      const unregistered = jest.fn();
      manager.on('containerUnregistered', unregistered);
      manager.on('activeChange', boom);
      expect(() => manager.unregister('a')).toThrow('검증용 예외');
      expect(manager.has('a')).toBe(false);
      expect(manager.getActiveId()).toBeNull();
      expect(a.isDestroyed()).toBe(true);
      expect(a.element.isConnected).toBe(false);
      expect(unregistered).toHaveBeenCalledWith({ containerId: 'a' });
      // 나머지 컨테이너는 그대로 동작한다
      manager.get('b')?.addItem({ id: 'x', w: 1, h: 1 });
      expect(manager.get('b')?.getItems()).toHaveLength(1);
    });

    it('containerUnregistered 리스너 예외는 Manager destroy 의 나머지 해제를 막지 않는다', () => {
      const { a, b, c } = registerAll();
      manager.on('containerUnregistered', boom);
      expect(() => manager.destroy()).toThrow('검증용 예외');
      expect(manager.getIds()).toEqual([]);
      expect([a, b, c].every((e) => e.isDestroyed())).toBe(true);
      expect(document.querySelectorAll('.daracl-drift')).toHaveLength(0);
    });

    it('드래그 중 dragInEnd 리스너가 예외를 던져도 Manager destroy 는 끝까지 해제한다', () => {
      const { a, b, c } = registerAll();
      manager.setupDragIn('.pal');
      dragOver(a, 0, 0);
      manager.on('dragInEnd', boom);
      const add = jest.spyOn(document, 'addEventListener');
      expect(() => manager.destroy()).toThrow('검증용 예외');
      expect(() => manager.destroy()).not.toThrow();
      expect(manager.getIds()).toEqual([]);
      expect([a, b, c].every((e) => e.isDestroyed())).toBe(true);
      expect(document.querySelectorAll('.daracl-drift, .ddr-dragin-ghost, .ddr-dragin-over')).toHaveLength(0);
      expect(source.classList.contains('ddr-dragin-source')).toBe(false);
      // 끌어오기 리스너가 남아 있지 않다: 다시 눌러도 세션이 시작되지 않는다
      pointer(source, 'pointerdown', 1310, 20);
      pointer(source, 'pointermove', 100, 30);
      expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
      expect(add).not.toHaveBeenCalled();
      add.mockRestore();
    });

    it('드롭 시 activeChange 리스너가 예외를 던져도 dragInEnd 는 발생하고 항목은 한 번만 추가된다', () => {
      const { b } = registerAll();
      manager.setupDragIn('.pal');
      const ends: unknown[] = [];
      manager.on('activeChange', boom);
      manager.on('dragInEnd', (e) => ends.push(e.containerId));
      const { px, py } = dragOver(b, 0, 0);
      // document 리스너 안의 예외는 dispatchEvent 가 전역 error 이벤트로 보고한다 (jsdom 도 같다)
      const reported: unknown[] = [];
      const onError = (e: ErrorEvent) => {
        reported.push(e.error);
        e.preventDefault();
      };
      window.addEventListener('error', onError);
      pointer(source, 'pointerup', px, py);
      window.removeEventListener('error', onError);
      manager.off('activeChange', boom);
      expect(reported).toEqual([expect.objectContaining({ message: '검증용 예외' })]);
      expect(b.getItems()).toHaveLength(1);
      expect(ends).toEqual(['b']);
      expect(manager.getActiveId()).toBe('b');
      expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
    });

    it('dragInStart 에서 취소하면 그 이동과 이후 이동에서 미리보기가 다시 생기지 않는다', () => {
      const { a } = registerAll();
      manager.setupDragIn('.pal');
      const end = jest.fn();
      manager.on('dragInStart', () => manager.cancelDragIn());
      manager.on('dragInEnd', end);
      // 활성화(임계값을 넘는 첫 이동)가 곧바로 캔버스 위에서 일어나게 한다: 취소 직후 같은 이동의 미리보기가 생기던 결함
      const m = a.getMetrics();
      const px = (3 * (m.cellWidth + m.gap)) / 2;
      const py = m.rowHeight;
      pointer(source, 'pointerdown', 1310, 20);
      pointer(source, 'pointermove', px, py);
      expect(a.getPlaceholder().hidden).toBe(true);
      expect(document.querySelectorAll('.ddr-dragin-over, .ddr-dragin-ghost')).toHaveLength(0);
      pointer(source, 'pointermove', px + 20, py);
      pointer(source, 'pointerup', px + 20, py);
      expect(a.getPlaceholder().hidden).toBe(true);
      expect(a.getItems()).toEqual([]);
      expect(end).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledWith({ containerId: null, item: null });
    });

    it('단일 에디터: 드래그 중 dragInEnd 리스너 예외가 있어도 destroy 는 DOM/리스너를 모두 해제한다', () => {
      const editor = createDriftEditor(els.a);
      editor.setupDragIn('.pal');
      editor.on('dragInEnd', boom);
      dragOver(editor, 0, 0);
      expect(() => editor.destroy()).toThrow('검증용 예외');
      expect(editor.isDestroyed()).toBe(true);
      expect(els.a.querySelector('.daracl-drift')).toBeNull();
      expect(document.querySelector('.ddr-dragin-ghost')).toBeNull();
      expect(source.classList.contains('ddr-dragin-source')).toBe(false);
      // 같은 요소를 Manager 에 다시 등록할 수 있다
      expect(() => manager.register('a', els.a)).not.toThrow();
    });
  });
});
