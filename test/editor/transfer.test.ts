import {
  createDriftManager,
  DriftEditor,
  DriftItemTransferEvent,
  DriftManager,
  DriftManagerOptions,
  DriftTransferRejectEvent,
  planTransfer,
  createLayout,
} from '@/index';

/**
 * jsdom 에는 레이아웃이 없으므로 컨테이너마다 data-top 으로 세로 위치를 정한다.
 * 모든 캔버스는 left 0, 폭 1200, 높이 200. 항목 요소는 컨테이너 좌상단(0, top)에 있는 것으로 본다(잡은 위치 계산용).
 */
const WIDTH = 1200;
const HEIGHT = 200;

function mockRects(): jest.SpyInstance {
  return jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const host = el.classList.contains('ddr-editor') ? el : (el.closest('.ddr-editor') as HTMLElement | null);
    const top = Number(host?.dataset.top ?? -1000);
    if (el.classList.contains('daracl-drift') || el.classList.contains('ddr-editor')) {
      return { left: 0, top, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: top + HEIGHT } as DOMRect;
    }
    return { left: 0, top, width: 100, height: 40, right: 100, bottom: top + 40 } as DOMRect;
  });
}

function pointer(target: Element | Document, type: string, x: number, y: number, pointerId = 1, pointerType = 'mouse') {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

const key = (target: Element | Document, k: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

const ids = (e: DriftEditor) =>
  e
    .getLayout()
    .items.map((i) => i.id)
    .sort();

describe('컨테이너 간 이동 (transferItem / 포인터)', () => {
  let spy: jest.SpyInstance;
  let manager: DriftManager;
  let els: Record<string, HTMLElement>;

  const makeEl = (id: string, top: number) => {
    const el = document.createElement('div');
    el.id = id;
    el.dataset.top = String(top);
    document.body.appendChild(el);
    return el;
  };

  const setup = (options: DriftManagerOptions = {}) => {
    manager = createDriftManager(options);
    const a = manager.register('a', els.a, {
      layout: {
        columns: 12,
        breakpoints: [{ name: 'mobile', maxWidth: 640, columns: 4 }],
        items: [
          { id: 'chart', x: 0, y: 0, w: 4, h: 2, title: 'Chart', props: { kind: 'chart', n: 1 } },
          { id: 'table', x: 4, y: 0, w: 4, h: 2 },
          { id: 'pin', x: 8, y: 0, w: 2, h: 2, locked: true },
        ],
      },
    });
    const b = manager.register('b', els.b, {
      layout: {
        columns: 6,
        rowHeight: 30,
        gap: 4,
        breakpoints: [{ name: 'narrow', maxWidth: 500, columns: 3 }],
        items: [{ id: 'note', x: 0, y: 0, w: 3, h: 1 }],
      },
    });
    const c = manager.register('c', els.c, { layout: { columns: 24, breakpoints: [], float: true, items: [] } });
    return { a, b, c };
  };

  beforeEach(() => {
    spy = mockRects();
    els = { a: makeEl('a', 0), b: makeEl('b', 250), c: makeEl('c', 500) };
  });

  afterEach(() => {
    try {
      manager?.destroy();
    } catch {
      /* 테스트에서 일부러 던진 예외 */
    }
    spy.mockRestore();
    document.body.innerHTML = '';
  });

  // ───────────────────────────── API 이동 ─────────────────────────────

  describe('transferItem', () => {
    it('A→B: 원본에서 한 번 제거되고 대상에 한 번 추가되며 데이터가 보존된다', () => {
      const { a, b } = setup();
      const r = manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
      expect(r).toMatchObject({ moved: true, from: 'a', to: 'b', item: { id: 'chart', title: 'Chart' } });
      expect(ids(a)).toEqual(['pin', 'table']);
      expect(ids(b)).toEqual(['chart', 'note']);
      const moved = b.getItem('chart');
      // 셀 수(w=4)를 유지하고 대상 6열 기준으로 정규화된다
      expect(moved).toMatchObject({ w: 4, h: 2, props: { kind: 'chart', n: 1 } });
      expect(els.a.querySelector('[data-drift-id="chart"]')).toBeNull();
      expect(els.b.querySelectorAll('[data-drift-id="chart"]')).toHaveLength(1);
      // 결과 항목은 복사본이다
      if (r.moved && r.item.props) r.item.props.n = 9;
      expect(b.getItem('chart')?.props?.n).toBe(1);
    });

    it('B→A, A→B→C 연쇄 이동과 다른 컨테이너 불변', () => {
      const { a, b, c } = setup();
      const cBefore = c.toJSON();
      expect(manager.transferItem({ from: 'b', to: 'a', itemId: 'note' }).moved).toBe(true);
      expect(ids(a)).toContain('note');
      expect(c.toJSON()).toBe(cBefore);
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'table' }).moved).toBe(true);
      expect(manager.transferItem({ from: 'b', to: 'c', itemId: 'table' }).moved).toBe(true);
      expect(ids(a)).toEqual(['chart', 'note', 'pin']);
      expect(ids(b)).toEqual([]);
      expect(ids(c)).toEqual(['table']);
      // 저장 데이터에도 원본 유령 항목이 없다
      const data = manager.getLayouts();
      const all = data.containers.flatMap((x) => x.layout.items.map((i) => i.id));
      expect(all.filter((id) => id === 'table')).toHaveLength(1);
    });

    it('좌표 지정, 열 수 정규화, float 대상', () => {
      const { a, c } = setup();
      // table 을 8칸으로 늘리면 locked pin 과 겹쳐 거부되므로, 왼쪽의 chart 를 늘린다
      a.updateItem('chart', { w: 8 });
      expect(a.getItem('chart')?.w).toBe(8);
      expect(manager.transferItem({ from: 'a', to: 'c', itemId: 'chart', x: 10, y: 5 }).moved).toBe(true);
      // float 대상은 놓은 y 를 유지한다
      expect(c.getItem('chart')).toMatchObject({ x: 10, y: 5, w: 8 });
      const { b } = { b: manager.get('b') as DriftEditor };
      expect(manager.transferItem({ from: 'c', to: 'b', itemId: 'chart' }).moved).toBe(true);
      // 8칸 → 대상 6열로 정규화
      expect(b.getItem('chart')?.w).toBe(6);
    });

    it('newId 와 id 충돌', () => {
      const { a, b } = setup();
      b.addItem({ id: 'chart', w: 1, h: 1 });
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' })).toEqual({
        moved: false,
        reason: 'id-conflict',
      });
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'chart', newId: 'note' })).toEqual({
        moved: false,
        reason: 'id-conflict',
      });
      const r = manager.transferItem({ from: 'a', to: 'b', itemId: 'chart', newId: 'chart-2' });
      expect(r).toMatchObject({ moved: true, item: { id: 'chart-2', title: 'Chart' } });
      expect(a.getItem('chart')).toBeUndefined();
      expect(b.getItem('chart')).toBeDefined();
      expect(b.getItem('chart-2')).toBeDefined();
    });

    it.each([
      [{ from: 'a', to: 'a', itemId: 'chart' }, 'same-container'],
      [{ from: 'a', to: 'zz', itemId: 'chart' }, 'missing-container'],
      [{ from: 'a', to: 'b', itemId: 'nope' }, 'missing-item'],
      [{ from: 'a', to: 'b', itemId: 'pin' }, 'locked'],
    ])('예상 가능한 거절 %p → %s 이며 아무것도 바뀌지 않는다', (req, reason) => {
      const { a, b } = setup();
      const before = manager.toJSON();
      const events = jest.fn();
      manager.on('layoutChange', events);
      manager.on('itemTransfer', events);
      a.select('chart');
      expect(manager.transferItem(req)).toEqual({ moved: false, reason });
      expect(manager.toJSON()).toBe(before);
      expect(events).not.toHaveBeenCalled();
      expect(a.getSelected()?.id).toBe('chart');
      expect(a.canUndo()).toBe(false);
      expect(b.canUndo()).toBe(false);
    });

    it('크기 제약을 만족할 수 없으면 invalid-size (minW 를 낮추지 않는다)', () => {
      const { a } = setup();
      a.updateItem('chart', { minW: 8 });
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' })).toEqual({
        moved: false,
        reason: 'invalid-size',
      });
      expect(a.getItem('chart')?.minW).toBe(8);
    });

    it('지정 위치가 대상의 locked 와 겹치면 blocked, locked 장애물은 그대로', () => {
      const { a, b } = setup();
      b.addItem({ id: 'wall', x: 3, y: 0, w: 3, h: 3, locked: true });
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'table', x: 3, y: 1 })).toEqual({
        moved: false,
        reason: 'blocked',
      });
      // 4칸 table 은 (0,1)에 두면 wall(x 3~5)과 겹친다. wall 아래(y 3)는 놓을 수 있다
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'table', x: 0, y: 1 })).toEqual({
        moved: false,
        reason: 'blocked',
      });
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'table', x: 0, y: 3 }).moved).toBe(true);
      expect(b.getItem('wall')).toMatchObject({ x: 3, y: 0 });
      expect(a.getItem('table')).toBeUndefined();
    });

    it('resizable 은 locked 와 독립이다: resizable:false 항목은 옮겨지고 값이 유지된다', () => {
      const { a, b } = setup();
      a.setResizable('table', false);
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'table' }).moved).toBe(true);
      expect(b.getItem('table')?.resizable).toBe(false);
    });

    it('입력 오류는 [drift] 예외', () => {
      setup();
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 'chart', x: 1 })).toThrow('[drift]');
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 'chart', x: NaN, y: 1 })).toThrow('[drift]');
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 'chart', x: Infinity, y: 0 })).toThrow('[drift]');
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 'chart', newId: '' })).toThrow('[drift]');
      expect(() => manager.transferItem(null as never)).toThrow('[drift]');
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 3 as never })).toThrow('[drift]');
    });

    it('destroy 된 Manager, 문서에서 떨어진 컨테이너', () => {
      setup();
      els.b.remove();
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' })).toEqual({
        moved: false,
        reason: 'disconnected',
      });
      manager.destroy();
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' })).toEqual({
        moved: false,
        reason: 'destroyed',
      });
    });
  });

  // ───────────────────────────── breakpoint ─────────────────────────────

  describe('breakpoint', () => {
    it('원본 breakpoint 편집 중에도 전체 레이아웃에서 빠지고 다른 항목의 responsive 는 보존된다', () => {
      const { a, b } = setup();
      a.setBreakpoint('mobile');
      a.moveItem('table', 0, 0); // mobile 명시 저장
      const pinBefore = a.getLayout().items.find((i) => i.id === 'pin')?.responsive;
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'table' }).moved).toBe(true);
      expect(a.getLayout().items.map((i) => i.id)).not.toContain('table');
      expect(a.getLayout().items.find((i) => i.id === 'pin')?.responsive).toEqual(pinBefore);
      // 원본의 responsive(mobile)는 대상에 복사하지 않는다
      expect(b.getLayout().items.find((i) => i.id === 'table')?.responsive).toBeUndefined();
      // 보이던 크기(mobile 의 w)를 시작값으로 쓴다
      expect(b.getItem('table')?.w).toBe(a.getColumns());
    });

    it('대상 breakpoint 편집 중 좌표를 주면 그 breakpoint 의 명시 위치로 저장된다', () => {
      const { b } = setup();
      b.setBreakpoint('narrow');
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'table', x: 1, y: 2 }).moved).toBe(true);
      // 3열 breakpoint 에서 w 4 → 3 으로 정규화되고 x 는 열 경계로 보정, y 는 압축 규칙을 따른다 (addItem 과 같음)
      const shown = b.getItem('table');
      expect(shown).toMatchObject({ x: 0, w: 3 });
      const saved = b.getLayout().items.find((i) => i.id === 'table');
      expect(saved?.responsive?.narrow).toEqual({ x: shown?.x, y: shown?.y, w: shown?.w, h: shown?.h });
      // 기본 레이아웃(6열)에는 자동 위치로 원래 셀 수(4)가 들어간다
      expect(saved?.w).toBe(4);
    });
  });

  // ───────────────────────────── 이벤트 ─────────────────────────────

  describe('이벤트와 순서', () => {
    it('원본 layoutChange(remove) → 대상 layoutChange(add) → 활성·선택 → itemTransfer 순서, 첫 콜백에서 양쪽 최종 모델 조회', () => {
      const { a, b } = setup();
      const log: string[] = [];
      let seen: { a: string[]; b: string[] } | undefined;
      a.on('layoutChange', (_l, info) => {
        log.push(`a:${info.reason}:${info.source}:${!!info.transactionId}`);
        seen = { a: ids(a), b: ids(b) };
      });
      b.on('layoutChange', (_l, info) => log.push(`b:${info.reason}:${!!info.transactionId}`));
      a.on('remove', (i) => log.push(`a:remove:${i.id}`));
      b.on('add', (i) => log.push(`b:add:${i.id}`));
      b.on('select', (i) => log.push(`b:select:${i?.id}`));
      manager.on('activeChange', (e) => log.push(`active:${e.containerId}`));
      const transfers: DriftItemTransferEvent[] = [];
      manager.on('itemTransfer', (e) => {
        transfers.push(e);
        log.push('itemTransfer');
      });
      const r = manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
      expect(log).toEqual([
        'a:remove:api:true',
        'a:remove:chart',
        'b:add:true',
        'b:add:chart',
        'active:b',
        'b:select:chart',
        'itemTransfer',
      ]);
      expect(seen).toEqual({ a: ['pin', 'table'], b: ['chart', 'note'] });
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({
        transactionId: r.moved ? r.transactionId : '',
        action: 'transfer',
        from: 'a',
        to: 'b',
        source: 'api',
        beforeItem: { id: 'chart', x: 0, y: 0 },
        afterItem: { id: 'chart' },
      });
      expect(b.getSelected()?.id).toBe('chart');
      expect(document.activeElement).toBe(els.b.querySelector('[data-drift-id="chart"]'));
    });

    it('API 이동은 programmaticEvents:false 인 에디터의 이벤트와 itemTransfer 를 억제한다', () => {
      manager = createDriftManager();
      const a = manager.register('a', els.a, { layout: { items: [{ id: 'x', x: 0, y: 0, w: 2, h: 2 }] } });
      const b = manager.register('b', els.b, { programmaticEvents: false });
      const aChange = jest.fn();
      const bChange = jest.fn();
      const transfer = jest.fn();
      a.on('layoutChange', aChange);
      b.on('layoutChange', bChange);
      manager.on('itemTransfer', transfer);
      manager.transferItem({ from: 'a', to: 'b', itemId: 'x' });
      expect(aChange).toHaveBeenCalledTimes(1);
      expect(bChange).not.toHaveBeenCalled();
      expect(transfer).not.toHaveBeenCalled();
      manager.transferItem({ from: 'b', to: 'a', itemId: 'x' }, { source: 'user' });
      expect(bChange).toHaveBeenCalledTimes(1);
      expect(transfer).toHaveBeenCalledTimes(1);
    });

    it('알림 콜백 예외는 완료된 이동을 되돌리지 않고 나머지 알림 후 첫 예외를 던진다', () => {
      const { a, b } = setup();
      a.on('layoutChange', () => {
        throw new Error('알림 예외');
      });
      const transfer = jest.fn();
      manager.on('itemTransfer', transfer);
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' })).toThrow('알림 예외');
      expect(ids(a)).not.toContain('chart');
      expect(ids(b)).toContain('chart');
      expect(transfer).toHaveBeenCalledTimes(1);
      expect(a.canUndo()).toBe(true);
    });

    it('알림 중 재진입 이동은 busy, 콜백 안의 해제는 안전하다', () => {
      const { a } = setup();
      const nested: unknown[] = [];
      a.on('layoutChange', () => {
        nested.push(manager.transferItem({ from: 'a', to: 'c', itemId: 'table' }));
        manager.unregister('b');
      });
      const r = manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
      expect(r.moved).toBe(true);
      expect(nested).toEqual([{ moved: false, reason: 'busy' }]);
      expect(manager.has('b')).toBe(false);
      // 해제된 대상을 다시 활성화하지 않는다
      expect(manager.getActiveId()).toBeNull();
    });
  });

  // ───────────────────────────── 콘텐츠 수명 / 롤백 ─────────────────────────────

  describe('콘텐츠 수명과 롤백', () => {
    const lifecycle = (log: string[], failMountIn?: string) => ({
      mount: (item: { id: string }) => {
        log.push(`mount:${item.id}`);
        if (failMountIn && item.id === failMountIn) throw new Error('mount 실패');
      },
      update: (item: { id: string }) => log.push(`update:${item.id}`),
      unmount: (item: { id: string }) => log.push(`unmount:${item.id}`),
    });

    it('이동 시 원본 unmount, 대상 mount 가 한 번씩이고 다른 항목은 다시 만들지 않는다', () => {
      manager = createDriftManager();
      const log: string[] = [];
      manager.register('a', els.a, {
        layout: {
          items: [
            { id: 'x', x: 0, y: 0, w: 2, h: 2 },
            { id: 'y', x: 2, y: 0, w: 2, h: 2 },
          ],
        },
        contentLifecycle: lifecycle(log),
      });
      manager.register('b', els.b, {
        layout: { items: [{ id: 'z', x: 0, y: 0, w: 2, h: 2 }] },
        contentLifecycle: lifecycle(log),
      });
      log.length = 0;
      manager.transferItem({ from: 'a', to: 'b', itemId: 'x' });
      expect(log).toEqual(['unmount:x', 'mount:x']);
    });

    it('대상 mount 실패는 두 모델·선택·이력을 되돌리고 원래 예외를 던진다 (load 로 이력을 지우지 않는다)', () => {
      manager = createDriftManager();
      const log: string[] = [];
      const a = manager.register('a', els.a, {
        layout: { items: [{ id: 'x', x: 0, y: 0, w: 2, h: 2 }] },
        contentLifecycle: lifecycle(log),
      });
      const b = manager.register('b', els.b, { contentLifecycle: lifecycle(log, 'x') });
      a.addItem({ id: 'w', w: 1, h: 1 });
      a.select('x');
      const before = manager.toJSON();
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 'x' })).toThrow('mount 실패');
      expect(manager.toJSON()).toBe(before);
      expect(a.getSelected()?.id).toBe('x');
      expect(a.canUndo()).toBe(true); // addItem 이력이 남아 있다
      expect(b.canUndo()).toBe(false);
      expect(els.a.querySelectorAll('[data-drift-id="x"]')).toHaveLength(1);
      expect(els.b.querySelector('[data-drift-id="x"]')).toBeNull();
      a.undo();
      expect(a.getItem('w')).toBeUndefined();
      expect(a.getItem('x')).toBeDefined();
    });
  });

  it('이동 후 대상 sizeChange 는 대상 메트릭으로 한 번 계산된다', async () => {
    const { b } = setup();
    const changes: { id: string; width: number; height: number }[][] = [];
    b.on('sizeChange', (list) => changes.push(list.map((c) => ({ id: c.id, width: c.width, height: c.height }))));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    changes.length = 0;
    manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const m = b.getMetrics();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual([
      expect.objectContaining({
        id: 'chart',
        width: 4 * m.cellWidth + 3 * m.gap,
        height: 2 * m.rowHeight + m.gap,
      }),
    ]);
  });

  // ───────────────────────────── 연결 undo / redo ─────────────────────────────

  describe('연결 undo / redo', () => {
    it('어느 쪽 undo 든 양쪽을 한 번에 되돌리고 redo 도 한 번에 다시 적용한다', () => {
      const { a, b } = setup();
      const events: string[] = [];
      manager.on('itemTransfer', (e) => events.push(`${e.action}:${e.from}->${e.to}`));
      const r = manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
      expect(a.canUndo()).toBe(true);
      expect(b.canUndo()).toBe(true);
      const reasons: string[] = [];
      a.on('layoutChange', (_l, info) =>
        reasons.push(`a:${info.reason}:${info.transactionId === (r.moved && r.transactionId)}`),
      );
      b.on('layoutChange', (_l, info) => reasons.push(`b:${info.reason}`));

      expect(b.undo()).toBe(true);
      expect(ids(a)).toContain('chart');
      expect(ids(b)).not.toContain('chart');
      expect(a.getItem('chart')).toMatchObject({ x: 0, y: 0, w: 4 });
      expect(a.getSelected()?.id).toBe('chart');
      expect(manager.getActiveId()).toBe('a');
      expect(a.canRedo()).toBe(true);
      expect(b.canRedo()).toBe(true);

      expect(a.redo()).toBe(true);
      expect(ids(a)).not.toContain('chart');
      expect(ids(b)).toContain('chart');
      expect(b.getSelected()?.id).toBe('chart');
      expect(reasons).toEqual(['a:undo:true', 'b:undo', 'a:redo:true', 'b:redo']);
      expect(events).toEqual(['transfer:a->b', 'undo:a->b', 'redo:a->b']);
    });

    it('일반 변경의 undo 는 그 에디터만 바꾼다', () => {
      const { a, b } = setup();
      manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
      a.moveItem('table', 0, 0);
      expect(a.undo()).toBe(true); // a 의 이동만
      expect(ids(b)).toContain('chart');
      expect(a.getItem('table')?.x).toBe(4);
    });

    it('상대 컨테이너의 후속 편집이 있으면 연결 undo 는 막히고, 그 편집을 먼저 되돌리면 가능하다', () => {
      const { a, b } = setup();
      manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
      b.moveItem('note', 4, 0);
      expect(a.canUndo()).toBe(false);
      expect(a.undo()).toBe(false);
      expect(ids(a)).not.toContain('chart');
      expect(b.undo()).toBe(true); // b 의 로컬 편집
      expect(a.canUndo()).toBe(true);
      expect(a.undo()).toBe(true);
      expect(ids(a)).toContain('chart');
      expect(ids(b)).toEqual(['note']);
    });

    it('undo 후 한쪽의 새 편집이 연결 redo 를 무효화하면 다른 쪽 redo 도 무효화된다', () => {
      const { a, b } = setup();
      manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
      a.undo();
      b.moveItem('note', 2, 0);
      expect(b.canRedo()).toBe(false);
      expect(a.canRedo()).toBe(false);
      expect(a.redo()).toBe(false);
      expect(ids(a)).toContain('chart');
      expect(ids(b)).toEqual(['note']);
    });

    it('어느 한쪽이 history:false 면 이동은 되지만 두 이력을 비우고 이동 이력을 만들지 않는다', () => {
      manager = createDriftManager();
      const a = manager.register('a', els.a, { layout: { items: [{ id: 'x', x: 0, y: 0, w: 2, h: 2 }] } });
      const b = manager.register('b', els.b, { history: false });
      a.addItem({ id: 'y', w: 1, h: 1 });
      expect(a.canUndo()).toBe(true);
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'x' }).moved).toBe(true);
      expect(a.canUndo()).toBe(false);
      expect(a.undo()).toBe(false);
      expect(ids(a)).toEqual(['y']);
      expect(ids(b)).toEqual(['x']);
    });

    it.each([
      ['load', (m: DriftManager) => m.get('b')?.load(m.get('b')?.getLayout() as never)],
      ['unregister', (m: DriftManager) => m.unregister('b')],
      ['직접 destroy', (m: DriftManager) => m.get('b')?.destroy()],
    ])('%s 로 상대 기록이 사라지면 원본은 이동을 가로질러 되돌리지 않는다 (항목 복제 없음)', (_name, act) => {
      const { a } = setup();
      a.moveItem('table', 0, 2); // 이동 전의 로컬 이력
      manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
      act(manager);
      expect(a.canUndo()).toBe(false);
      expect(a.undo()).toBe(false);
      expect(ids(a)).not.toContain('chart');
    });

    it('상대의 이력 제한 초과로 기록이 밀려나면 양쪽 연결 기록과 그 이전 이력이 절단된다', () => {
      manager = createDriftManager();
      const a = manager.register('a', els.a, { layout: { items: [{ id: 'x', x: 0, y: 0, w: 2, h: 2 }] } });
      const b = manager.register('b', els.b, { historyLimit: 1 });
      manager.transferItem({ from: 'a', to: 'b', itemId: 'x' });
      b.addItem({ id: 'n', w: 1, h: 1 }); // 이동 기록이 b 에서 밀려난다
      expect(a.canUndo()).toBe(false);
      expect(a.undo()).toBe(false);
      expect(ids(a)).toEqual([]);
      expect(b.undo()).toBe(true); // b 자신의 addItem 은 되돌릴 수 있다
      expect(ids(b)).toEqual(['x']);
    });

    it('반복 저장/복원 후 데이터가 같고 원본에 유령 항목이 없다', () => {
      const { a } = setup();
      a.setBreakpoint('mobile');
      manager.transferItem({ from: 'a', to: 'b', itemId: 'chart' });
      const json = manager.toJSON();
      manager.fromJSON(json);
      const once = manager.toJSON();
      manager.fromJSON(once);
      expect(manager.toJSON()).toBe(once);
      const data = JSON.parse(once);
      expect(JSON.stringify(data.containers[0])).not.toContain('"chart"');
      expect(data.containers[1].layout.items.filter((i: { id: string }) => i.id === 'chart')).toHaveLength(1);
    });
  });

  // ───────────────────────────── 포인터 이동 ─────────────────────────────

  describe('포인터 이동', () => {
    /** a 의 항목 핸들을 잡는다 (항목 요소는 컨테이너 좌상단에 있는 것으로 모킹: 잡은 위치 = (10, 10)) */
    const grab = (cid: string, id: string, pointerId = 1) => {
      const handle = els[cid].querySelector(`[data-drift-id="${id}"] .ddr-handle`) as HTMLElement;
      const top = Number(els[cid].dataset.top);
      pointer(handle, 'pointerdown', 10, top + 10, pointerId);
      pointer(handle, 'pointermove', 20, top + 20, pointerId);
      return handle;
    };
    /** 대상 에디터의 (x, y) 칸에 항목 좌상단이 오도록 포인터를 옮긴다 */
    const over = (handle: HTMLElement, editor: DriftEditor, x: number, y: number, pointerId = 1) => {
      const m = editor.getMetrics();
      const top = Number((editor.element.parentElement as HTMLElement).dataset.top);
      const px = x * (m.cellWidth + m.gap) + 10 + 2;
      const py = top + y * (m.rowHeight + m.gap) + 10 + 2;
      pointer(handle, 'pointermove', px, py, pointerId);
      return { px, py };
    };

    it('기본(비활성)에서는 다른 컨테이너 위로 끌어도 원본 안에서만 움직인다', () => {
      const { a, b } = setup();
      const h = grab('a', 'chart');
      const { px, py } = over(h, b, 0, 1);
      pointer(h, 'pointerup', px, py);
      expect(ids(a)).toContain('chart');
      expect(ids(b)).toEqual(['note']);
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();
    });

    it('A→B 로 놓으면 한 번 이동하고 dragStart/dragEnd 가 원본에서 한 쌍만 발생한다', () => {
      const { a, b } = setup({ crossContainerDrag: true });
      const drags: string[] = [];
      a.on('dragStart', (i) => drags.push(`start:${i.id}`));
      a.on('dragEnd', (i) => drags.push(`end:${i.id}`));
      b.on('dragStart', () => drags.push('b:start'));
      const changes: string[] = [];
      manager.on('layoutChange', (e) => changes.push(`${e.containerId}:${e.info.reason}:${e.info.source}`));
      const h = grab('a', 'chart');
      const { px, py } = over(h, b, 1, 2);
      // 드래그 중: ghost 하나, 대상 placeholder, 원본 항목은 원위치에 흐리게, 모델은 그대로
      expect(document.querySelectorAll('.ddr-transfer-ghost')).toHaveLength(1);
      expect(b.getPlaceholder().hidden).toBe(false);
      expect(a.getPlaceholder().hidden).toBe(true);
      expect(els.a.querySelector('[data-drift-id="chart"]')?.classList.contains('ddr-transfer-source')).toBe(true);
      expect(ids(b)).toEqual(['note']);
      pointer(h, 'pointerup', px, py);
      expect(ids(a)).toEqual(['pin', 'table']);
      expect(ids(b)).toEqual(['chart', 'note']);
      expect(b.getItem('chart')).toMatchObject({ x: 1, w: 4 });
      expect(drags).toEqual(['start:chart', 'end:chart']);
      expect(changes).toEqual(['a:remove:user', 'b:add:user']);
      expect(manager.getActiveId()).toBe('b');
      expect(b.getSelected()?.id).toBe('chart');
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();
      expect(b.getPlaceholder().hidden).toBe(true);
      expect(document.querySelectorAll('.ddr-dragin-over, .ddr-transfer-source, .ddr-dragging')).toHaveLength(0);
      // undo 한 번으로 양쪽이 되돌아간다
      expect(b.undo()).toBe(true);
      expect(ids(a)).toContain('chart');
    });

    it('A→B→C 를 지나가면 이전 대상의 미리보기를 원복하고, 원본 위로 돌아오면 일반 드래그가 된다', () => {
      const { a, b, c } = setup({ crossContainerDrag: true });
      const h = grab('a', 'chart');
      over(h, b, 0, 0);
      // 미리보기로 note 가 밀렸다
      expect((els.b.querySelector('[data-drift-id="note"]') as HTMLElement).dataset.y).not.toBe('0');
      over(h, c, 2, 0);
      expect(b.getPlaceholder().hidden).toBe(true);
      expect((els.b.querySelector('[data-drift-id="note"]') as HTMLElement).dataset.y).toBe('0');
      expect(els.b.classList.contains('ddr-dragin-over')).toBe(false);
      expect(c.getPlaceholder().hidden).toBe(false);
      const { px, py } = over(h, a, 0, 3);
      expect(c.getPlaceholder().hidden).toBe(true);
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();
      expect(a.getPlaceholder().hidden).toBe(false);
      pointer(h, 'pointerup', px, py);
      expect(ids(a)).toContain('chart');
      expect(ids(b)).toEqual(['note']);
      expect(ids(c)).toEqual([]);
    });

    it('모든 컨테이너 밖에서 놓으면 원래 상태로 취소된다 (가장 가까운 대상을 고르지 않는다)', () => {
      const { a, b } = setup({ crossContainerDrag: true });
      const before = manager.toJSON();
      const changes = jest.fn();
      manager.on('layoutChange', changes);
      const ends: string[] = [];
      a.on('dragEnd', (i) => ends.push(i.id));
      const h = grab('a', 'chart');
      over(h, b, 0, 0);
      pointer(h, 'pointermove', 100, 225); // a 와 b 사이
      expect(b.getPlaceholder().hidden).toBe(true);
      expect(document.querySelectorAll('.ddr-transfer-ghost')).toHaveLength(1);
      pointer(h, 'pointerup', 100, 225);
      expect(manager.toJSON()).toBe(before);
      expect(changes).not.toHaveBeenCalled();
      expect(ends).toEqual(['chart']);
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();
      expect(a.canUndo()).toBe(false);
    });

    it('Esc / pointercancel 은 이동하지 않고 정리한다. 다른 pointerId 와 중복 pointerup 은 무시된다', () => {
      const { a, b } = setup({ crossContainerDrag: true });
      const before = manager.toJSON();
      let h = grab('a', 'chart');
      over(h, b, 0, 0);
      key(document, 'Escape');
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();
      expect(b.getPlaceholder().hidden).toBe(true);
      h = grab('a', 'chart');
      over(h, b, 0, 0);
      pointer(h, 'pointercancel', 0, 0);
      expect(manager.toJSON()).toBe(before);

      h = grab('a', 'chart');
      const { px, py } = over(h, b, 0, 0);
      pointer(h, 'pointerup', px, py, 2); // 다른 포인터
      expect(ids(b)).toEqual(['note']);
      pointer(h, 'pointerup', px, py);
      pointer(h, 'pointerup', px, py);
      expect(ids(b).filter((id) => id === 'chart')).toHaveLength(1);
      expect(ids(a)).not.toContain('chart');
    });

    it('id 충돌이면 무효 placeholder 를 보이고 놓아도 거절된다 (자동 이름 변경 없음)', () => {
      const { a, b } = setup({ crossContainerDrag: true });
      b.addItem({ id: 'chart', w: 1, h: 1 });
      const rejects: DriftTransferRejectEvent[] = [];
      manager.on('transferReject', (e) => rejects.push(e));
      const h = grab('a', 'chart');
      const { px, py } = over(h, b, 2, 2);
      expect(b.getPlaceholder().classList.contains('ddr-placeholder-invalid')).toBe(true);
      pointer(h, 'pointerup', px, py);
      expect(rejects).toEqual([{ reason: 'id-conflict', from: 'a', to: 'b', itemId: 'chart' }]);
      expect(ids(a)).toContain('chart');
      expect(b.getLayout().items.filter((i) => i.id === 'chart')).toHaveLength(1);
    });

    it('끄는 도중 원본/대상 모델이 바뀌면 stale 로 취소한다', () => {
      const { a, b } = setup({ crossContainerDrag: true });
      const rejects: string[] = [];
      manager.on('transferReject', (e) => rejects.push(e.reason));
      let h = grab('a', 'chart');
      over(h, b, 0, 0);
      b.addItem({ id: 'late', w: 1, h: 1 });
      over(h, b, 1, 0);
      expect(rejects).toEqual(['stale']);
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();
      pointer(h, 'pointerup', 0, 0);
      expect(ids(a)).toContain('chart');

      h = grab('a', 'chart');
      over(h, b, 0, 0);
      a.updateItem('table', { title: 'changed' });
      const { px, py } = over(h, b, 0, 0);
      pointer(h, 'pointerup', px, py);
      expect(rejects).toEqual(['stale', 'stale']);
      expect(ids(a)).toContain('chart');
    });

    it('진행 중 옵션 해제는 disabled 로 취소한다', () => {
      const { a, b } = setup({ crossContainerDrag: true });
      const rejects: string[] = [];
      manager.on('transferReject', (e) => rejects.push(e.reason));
      const h = grab('a', 'chart');
      const { px, py } = over(h, b, 0, 0);
      manager.setCrossContainerDrag(false);
      expect(rejects).toEqual(['disabled']);
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();
      expect(document.querySelectorAll('.ddr-dragging, .ddr-transfer-source')).toHaveLength(0);
      pointer(h, 'pointerup', px, py);
      expect(ids(a)).toContain('chart');
      expect(manager.isCrossContainerDrag()).toBe(false);
    });

    it('끄는 도중 대상 해제, 원본 해제, Manager destroy 모두 안전하게 정리된다', () => {
      let { a, b } = setup({ crossContainerDrag: true });
      let h = grab('a', 'chart');
      let p = over(h, b, 0, 0);
      manager.unregister('b');
      pointer(h, 'pointerup', p.px, p.py);
      expect(ids(a)).toContain('chart');
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();

      manager.destroy();
      document.body.innerHTML = '';
      els = { a: makeEl('a', 0), b: makeEl('b', 250), c: makeEl('c', 500) };
      ({ a, b } = setup({ crossContainerDrag: true }));
      h = grab('a', 'chart');
      p = over(h, b, 0, 0);
      manager.unregister('a');
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();
      expect(b.getPlaceholder().hidden).toBe(true);
      pointer(h, 'pointerup', p.px, p.py);
      expect(ids(b)).toEqual(['note']);

      // 이동 모드 중 Manager destroy
      ({ b } = { b: manager.get('b') as DriftEditor });
      manager.register('a2', els.a, { layout: { items: [{ id: 'k', x: 0, y: 0, w: 2, h: 2 }] } });
      h = grab('a', 'k');
      over(h, b, 0, 0);
      expect(document.querySelectorAll('.ddr-transfer-ghost')).toHaveLength(1);
      manager.destroy();
      expect(document.querySelectorAll('.ddr-transfer-ghost, .daracl-drift')).toHaveLength(0);
    });

    it('리사이즈 중에는 컨테이너 이동으로 바뀌지 않는다', () => {
      const { a, b } = setup({ crossContainerDrag: true });
      const grip = els.a.querySelector('[data-drift-id="chart"] .ddr-resize-handle[data-dir="se"]') as HTMLElement;
      pointer(grip, 'pointerdown', 10, 10);
      pointer(grip, 'pointermove', 30, 30);
      pointer(grip, 'pointermove', 100, 300);
      expect(document.querySelector('.ddr-transfer-ghost')).toBeNull();
      expect(b.getPlaceholder().hidden).toBe(true);
      pointer(grip, 'pointerup', 100, 300);
      expect(ids(a)).toContain('chart');
      expect(ids(b)).toEqual(['note']);
    });
  });

  describe('planTransfer (core, DOM 없음)', () => {
    it('입력을 바꾸지 않고 결과는 입력과 참조를 공유하지 않는다', () => {
      const source = createLayout({ items: [{ id: 'x', x: 0, y: 0, w: 2, h: 2, props: { v: 1 } }] });
      const target = createLayout({ columns: 6, items: [] });
      const snap = JSON.stringify([source, target]);
      const plan = planTransfer({ source, target, itemId: 'x' });
      expect(JSON.stringify([source, target])).toBe(snap);
      expect(plan.ok).toBe(true);
      if (plan.ok) {
        expect(plan.source.items).toEqual([]);
        expect(plan.target.items[0].props).not.toBe(source.items[0].props);
      }
    });
  });
});
