import { createDriftEditor, DriftDragInDropResult, DriftEditor, DriftItem } from '@/index';

const CANVAS = { left: 100, top: 100, width: 1200 };
const CELL = (CANVAS.width - 8 * 11) / 12;
const STRIDE_X = CELL + 8;
const STRIDE_Y = 48;

/** jsdom 에는 레이아웃이 없으므로 캔버스/원본의 위치를 직접 지정한다 */
function mockRects(columnsOf: () => number) {
  return jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.classList.contains('daracl-drift')) {
      return {
        left: CANVAS.left,
        top: CANVAS.top,
        width: CANVAS.width,
        height: 800,
        right: CANVAS.left + CANVAS.width,
        bottom: CANVAS.top + 800,
      } as DOMRect;
    }
    if (el.classList.contains('pal'))
      return { left: 10, top: 10, width: 80, height: 30, right: 90, bottom: 40 } as DOMRect;
    const stride = (CANVAS.width - 8 * (columnsOf() - 1)) / columnsOf() + 8;
    const d = el.dataset;
    return {
      left: CANVAS.left + Number(d.x ?? 0) * stride,
      top: CANVAS.top + Number(d.y ?? 0) * STRIDE_Y,
      width: 100,
      height: 100,
      right: 0,
      bottom: 0,
    } as DOMRect;
  });
}

function pointer(target: Element | Document, type: string, x: number, y: number, pointerType = 'mouse') {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

describe('setupDragIn: autoAdd / onDrop', () => {
  let container: HTMLElement;
  let palette: HTMLElement;
  let source: HTMLElement;
  let editor: DriftEditor;
  let spy: jest.SpyInstance;
  let columns = 12;

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
  const strideOf = () => (CANVAS.width - 8 * (columns - 1)) / columns + 8;
  /** 원본에서 눌러 캔버스의 (cellX, cellY) 근처에 놓는다 (포인터가 항목의 가운데에 오도록) */
  const drag = (cellX: number, cellY: number, wCells = 3, hCells = 2, type = 'mouse', release = true) => {
    const stride = strideOf();
    const px = CANVAS.left + cellX * stride + (wCells * stride - 8) / 2;
    const py = CANVAS.top + cellY * STRIDE_Y + (hCells * STRIDE_Y - 8) / 2;
    pointer(source, 'pointerdown', 20, 20, type);
    pointer(source, 'pointermove', 40, 40, type);
    pointer(source, 'pointermove', px, py, type);
    if (release) pointer(source, 'pointerup', px, py, type);
    return { px, py };
  };
  const overlap = (list: DriftItem[]) =>
    list.some((a, i) =>
      list.slice(i + 1).some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y),
    );
  const ghosts = () => document.querySelectorAll('.ddr-dragin-ghost').length;
  const placeholder = () => container.querySelector('.ddr-placeholder') as HTMLElement;

  beforeEach(() => {
    columns = 12;
    spy = mockRects(() => columns);
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

  describe('기본 모드 (호환성)', () => {
    it.each([
      ['옵션 생략', {}],
      ['autoAdd:true', { autoAdd: true }],
    ])('%s: 드롭당 정확히 한 번만 추가되고 add/layoutChange/dragInEnd 가 한 번씩 발생한다', (_name, options) => {
      create();
      editor.setupDragIn('.pal', options);
      const log: string[] = [];
      editor.on('add', (i) => log.push(`add:${i.id}`));
      editor.on('layoutChange', (_l, info) => log.push(`change:${info.reason}`));
      editor.on('dragInEnd', (i) => log.push(`end:${i ? i.id : 'null'}`));

      drag(8, 3);
      expect(editor.getItems()).toHaveLength(3);
      const added = editor.getItems().find((i) => !['a', 'b'].includes(i.id)) as DriftItem;
      // 기존 동작 유지: layoutChange 가 먼저, 그 다음 add, 마지막에 dragInEnd
      expect(log).toEqual(['change:add', `add:${added.id}`, `end:${added.id}`]);
      expect(editor.canUndo()).toBe(true);
      editor.undo();
      expect(editor.getItems()).toHaveLength(2);
      expect(editor.canUndo()).toBe(false); // 한 번의 변경이었다
    });

    it('autoAdd 기본값에서 onDrop 은 추가가 끝난 뒤 한 번 호출되고 실제 id 를 전달한다', () => {
      create();
      const results: DriftDragInDropResult[] = [];
      const order: string[] = [];
      editor.on('add', () => order.push('add'));
      editor.setupDragIn('.pal', {
        item: { id: 'mine' },
        onDrop: (r) => {
          order.push('onDrop');
          results.push(r);
          expect(editor.getItem('mine')).toBeTruthy(); // 이미 추가되어 있다
        },
      });
      drag(8, 3);
      expect(results).toHaveLength(1);
      expect(results[0].item).toMatchObject({ id: 'mine', x: 8, w: 3, h: 2 });
      expect(order).toEqual(['add', 'onDrop']);
      expect(editor.getItems()).toHaveLength(3);
    });
  });

  describe('외부 모델 연동 정보 (source / changes)', () => {
    it('autoAdd:true 드롭의 layoutChange 는 source:user 이고 added 에 새 항목, changed 에 밀려난 항목이 들어 있다', () => {
      create();
      const infos: Array<{ source: string; reason: string; added: string[]; changed: string[] }> = [];
      editor.on('layoutChange', (_l, info) =>
        infos.push({
          source: info.source,
          reason: info.reason,
          added: info.changes.added.map((i) => i.id),
          changed: info.changes.changed.map((c) => c.id),
        }),
      );
      editor.setupDragIn('.pal', { item: { id: 'dropped' } });
      drag(0, 0); // a 위에 놓아 a 가 밀린다
      expect(infos).toEqual([
        { source: 'user', reason: 'add', added: ['dropped'], changed: expect.arrayContaining(['a']) },
      ]);
    });

    it('autoAdd:false 는 layoutChange 를 발생시키지 않고, onDrop 에서 호출자가 추가하면 source 를 지정해 구분할 수 있다', () => {
      create();
      const sources: string[] = [];
      editor.on('layoutChange', (_l, info) => sources.push(info.source));
      editor.setupDragIn('.pal', {
        autoAdd: false,
        onDrop: (r) => {
          editor.addItem({ ...r.item, id: 'ext' }, { source: 'sync', history: false });
        },
      });
      drag(8, 3);
      expect(sources).toEqual(['sync']);
      expect(editor.canUndo()).toBe(false);
    });
  });

  describe('autoAdd:false', () => {
    it('onDrop 만 한 번 호출되고 레이아웃/선택/이력/dirty 와 이벤트가 그대로다', () => {
      create();
      editor.select('a');
      const before = editor.getLayout();
      const onDrop = jest.fn();
      editor.setupDragIn('.pal', { autoAdd: false, onDrop });
      const events: string[] = [];
      for (const name of ['add', 'remove', 'select', 'layoutChange', 'dragInStart', 'dragInEnd'] as const) {
        editor.on(name, ((arg: unknown) =>
          events.push(`${name}${name === 'dragInEnd' ? `:${arg === null ? 'null' : 'item'}` : ''}`)) as never);
      }

      drag(8, 3);

      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(editor.getLayout()).toEqual(before);
      expect(editor.getItems()).toHaveLength(2);
      expect(editor.canUndo()).toBe(false);
      expect(editor.canRedo()).toBe(false);
      expect(editor.isDirty()).toBe(false);
      expect(editor.getSelected()?.id).toBe('a');
      // add / layoutChange 는 없고, dragInEnd 는 null
      expect(events).toEqual(['dragInStart', 'dragInEnd:null']);
      expect(ghosts()).toBe(0);
    });

    it('결과에는 원본 요소와 미리보기로 계산된 최종 위치·크기가 들어 있고 id 는 자동 생성하지 않는다', () => {
      create();
      let result!: DriftDragInDropResult;
      editor.setupDragIn('.pal', { autoAdd: false, onDrop: (r) => (result = r) });
      drag(8, 3);
      expect(result.source).toBe(source);
      // (8,3) 에 놓았지만 위가 비어 있어 기본(중력) 모드에서는 y=0 으로 압축된 위치가 최종 위치다
      expect(result.item).toEqual({ x: 8, y: 0, w: 3, h: 2, title: 'Chart', content: 'New chart' });
      expect(result.item).not.toHaveProperty('id');
      expect(result.breakpoint).toBeNull();
      expect(result.columns).toBe(12);
    });

    it('item 옵션의 id 가 있으면 그대로 전달하고, 함수형 item 도 지원한다', () => {
      create();
      const results: DriftDragInDropResult[] = [];
      editor.setupDragIn('#p1', {
        autoAdd: false,
        item: { id: 'fixed', props: { k: 1 } },
        onDrop: (r) => results.push(r),
      });
      editor.setupDragIn('#p2', {
        autoAdd: false,
        item: (el) => ({ id: `from-${el.id}`, w: 1, h: 1 }),
        onDrop: (r) => results.push(r),
      });
      drag(8, 3);
      source = palette.querySelector('#p2') as HTMLElement;
      drag(11, 5, 1, 1);
      expect(results.map((r) => r.item.id)).toEqual(['fixed', 'from-p2']);
      expect(results[0].item.props).toEqual({ k: 1 });
      expect(results[1].item).toMatchObject({ w: 1, h: 1 });
    });

    it('콜백 호출 전에 ghost/placeholder/하이라이트가 정리되고 밀려난 항목이 원래 상태로 복원되어 있다', () => {
      create();
      const snapshot: Record<string, unknown> = {};
      editor.setupDragIn('.pal', {
        autoAdd: false,
        onDrop: () => {
          snapshot.ghosts = ghosts();
          snapshot.placeholderHidden = placeholder().hidden;
          snapshot.over = container.classList.contains('ddr-dragin-over');
          snapshot.a = { ...container.querySelector<HTMLElement>('[data-drift-id="a"]')!.dataset };
          snapshot.b = { ...container.querySelector<HTMLElement>('[data-drift-id="b"]')!.dataset };
        },
      });
      // a 위에 놓아 미리보기에서는 a 가 아래로 밀리는 상황
      drag(0, 0);
      expect(snapshot.ghosts).toBe(0);
      expect(snapshot.placeholderHidden).toBe(true);
      expect(snapshot.over).toBe(false);
      expect(snapshot.a).toMatchObject({ x: '0', y: '0' });
      expect(snapshot.b).toMatchObject({ x: '4', y: '0' });
    });

    it('충돌: 놓은 칸이 최종 위치로 전달되고 내부의 기존 항목은 이동하지 않는다', () => {
      create();
      let result!: DriftDragInDropResult;
      editor.setupDragIn('.pal', { autoAdd: false, onDrop: (r) => (result = r) });
      drag(0, 0);
      expect(result.item).toMatchObject({ x: 0, y: 0, w: 3, h: 2 });
      expect(editor.getItem('a')).toMatchObject({ x: 0, y: 0 });
      expect(editor.getItem('b')).toMatchObject({ x: 4, y: 0 });
    });

    it('onDrop 안에서 동기적으로 addItem() 을 호출하면 항목이 정확히 하나만 생기고 이후 정리 코드가 덮어쓰지 않는다', () => {
      create();
      const adds: string[] = [];
      const changes: string[] = [];
      editor.on('add', (i) => adds.push(i.id));
      editor.on('layoutChange', (_l, info) => changes.push(info.reason));
      editor.setupDragIn('.pal', {
        autoAdd: false,
        onDrop: (r) => {
          editor.addItem({ ...r.item, id: 'external-1' });
        },
      });

      drag(0, 0); // 충돌 위치: 기존 a 가 실제로 밀려난다 (내부 addItem 의 결과)
      const items = editor.getItems();
      expect(items.map((i) => i.id).sort()).toEqual(['a', 'b', 'external-1']);
      expect(adds).toEqual(['external-1']);
      expect(changes).toEqual(['add']);
      expect(container.querySelectorAll('.ddr-item')).toHaveLength(3);
      expect(overlap(items)).toBe(false);
      // 화면(DOM)이 모델과 일치한다 = 이후 정리 코드가 미리보기 상태로 되돌리거나 덮어쓰지 않았다
      for (const item of items) {
        const el = container.querySelector<HTMLElement>(`[data-drift-id="${item.id}"]`)!;
        expect(el.dataset).toMatchObject({
          x: String(item.x),
          y: String(item.y),
          w: String(item.w),
          h: String(item.h),
        });
      }
      expect(editor.getItem('external-1')).toMatchObject({ x: 0, y: 0 });
      expect(editor.getItem('a')!.y).toBeGreaterThanOrEqual(2);
      expect(ghosts()).toBe(0);
      expect(placeholder().hidden).toBe(true);
      expect(editor.canUndo()).toBe(true);
      editor.undo();
      expect(editor.getItems()).toHaveLength(2); // 호출자의 addItem 한 번이 이력 한 단계
    });

    it('전달한 항목은 내부 상태/옵션과 분리된 복사본이다', () => {
      create();
      const shared = { props: { k: 1 }, content: 'orig' };
      const results: DriftDragInDropResult[] = [];
      const received: unknown[] = []; // 콜백이 값을 바꾸기 전의 모습
      editor.setupDragIn('.pal', {
        autoAdd: false,
        item: shared,
        onDrop: (r) => {
          results.push(r);
          received.push(JSON.parse(JSON.stringify(r.item)));
          r.item.content = 'mutated';
          (r.item.props as Record<string, unknown>).k = 999;
          r.item.x = 11;
        },
      });
      const before = editor.getLayout();
      drag(8, 3);
      expect(shared).toEqual({ props: { k: 1 }, content: 'orig' }); // 옵션 객체가 변하지 않는다
      expect(editor.getLayout()).toEqual(before); // 내부 상태도 그대로
      drag(8, 3); // 두 번째 드롭은 변경 없는 값으로 시작한다
      expect(received[1]).toMatchObject({ content: 'orig', props: { k: 1 }, x: 8 });
      expect(received[0]).toEqual(received[1]);
      expect(results[0].item).not.toBe(results[1].item);
    });

    it('콜백이 예외를 던져도 상태는 정리되고 dragInEnd 가 발생하며 다음 드래그가 정상 동작한다', () => {
      create();
      const errors: string[] = [];
      const onError = (e: ErrorEvent) => {
        e.preventDefault();
        errors.push(e.message);
      };
      window.addEventListener('error', onError);
      const ends: unknown[] = [];
      editor.on('dragInEnd', (i) => ends.push(i));
      let first = true;
      const onDrop = jest.fn(() => {
        if (first) {
          first = false;
          throw new Error('boom');
        }
      });
      editor.setupDragIn('.pal', { autoAdd: false, onDrop });
      drag(8, 3);
      expect(ghosts()).toBe(0);
      expect(placeholder().hidden).toBe(true);
      expect(ends).toEqual([null]);
      drag(8, 3);
      expect(onDrop).toHaveBeenCalledTimes(2);
      window.removeEventListener('error', onError);
      expect(errors.some((m) => m.includes('boom'))).toBe(true);
    });

    it('터치(pointerType=touch)로도 동작한다', () => {
      create();
      const onDrop = jest.fn();
      editor.setupDragIn('.pal', { autoAdd: false, onDrop });
      drag(8, 3, 3, 2, 'touch');
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(editor.getItems()).toHaveLength(2);
    });

    it('원본마다 다른 옵션을 독립적으로 적용한다 (autoAdd 혼합)', () => {
      create();
      const dropped: string[] = [];
      editor.setupDragIn('#p1', { onDrop: () => dropped.push('p1') }); // 기본: 내부 추가
      editor.setupDragIn('#p2', { autoAdd: false, item: { w: 2, h: 2 }, onDrop: () => dropped.push('p2') });
      drag(8, 3);
      expect(editor.getItems()).toHaveLength(3);
      source = palette.querySelector('#p2') as HTMLElement;
      drag(8, 6, 2, 2);
      expect(editor.getItems()).toHaveLength(3); // p2 는 추가하지 않는다
      expect(dropped).toEqual(['p1', 'p2']);
    });
  });

  describe('취소 / 캔버스 밖 / 임계값: onDrop 호출 없음', () => {
    it.each([
      ['캔버스 밖에서 놓기', (_p: { px: number; py: number }) => pointer(source, 'pointerup', 5000, 5000)],
      [
        'Esc',
        (_p: { px: number; py: number }) =>
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      ],
      ['pointercancel', (_p: { px: number; py: number }) => pointer(source, 'pointercancel', 0, 0)],
    ])('%s', (_name, finish) => {
      create();
      const onDrop = jest.fn();
      const ends: unknown[] = [];
      editor.on('dragInEnd', (i) => ends.push(i));
      editor.setupDragIn('.pal', { autoAdd: false, onDrop });
      const before = editor.getLayout();
      const pos = drag(0, 0, 3, 2, 'mouse', false); // a 위: 미리보기에서 a 가 밀려 있다
      expect(container.querySelector<HTMLElement>('[data-drift-id="a"]')!.dataset.y).not.toBe('0');
      finish(pos);
      pointer(source, 'pointerup', pos.px, pos.py); // 취소 후의 pointerup 은 무시된다
      expect(onDrop).not.toHaveBeenCalled();
      expect(ends).toEqual([null]);
      expect(editor.getLayout()).toEqual(before);
      expect(container.querySelector<HTMLElement>('[data-drift-id="a"]')!.dataset.y).toBe('0'); // 복원
      expect(ghosts()).toBe(0);
      expect(placeholder().hidden).toBe(true);
    });

    it('임계값 미만 이동(클릭)과 등록 해제 후에는 호출하지 않는다', () => {
      create();
      const onDrop = jest.fn();
      const dispose = editor.setupDragIn('.pal', { autoAdd: false, onDrop });
      pointer(source, 'pointerdown', 20, 20);
      pointer(source, 'pointermove', 21, 21);
      pointer(source, 'pointerup', 21, 21);
      expect(onDrop).not.toHaveBeenCalled();
      dispose();
      drag(8, 3);
      expect(onDrop).not.toHaveBeenCalled();
    });

    it('드래그 도중 등록 해제하면 onDrop 없이 정리된다', () => {
      create();
      const onDrop = jest.fn();
      const dispose = editor.setupDragIn('.pal', { autoAdd: false, onDrop });
      const pos = drag(0, 0, 3, 2, 'mouse', false);
      expect(ghosts()).toBe(1);
      dispose();
      expect(ghosts()).toBe(0);
      pointer(source, 'pointerup', pos.px, pos.py);
      expect(onDrop).not.toHaveBeenCalled();
      expect(container.querySelector<HTMLElement>('[data-drift-id="a"]')!.dataset.y).toBe('0');
    });

    it('드래그 도중 destroy 하면 onDrop 없이 모든 리소스가 정리된다', () => {
      create();
      const onDrop = jest.fn();
      editor.setupDragIn('.pal', { autoAdd: false, onDrop });
      const pos = drag(8, 3, 3, 2, 'mouse', false);
      editor.destroy();
      expect(ghosts()).toBe(0);
      expect(source.classList.contains('ddr-dragin-source')).toBe(false);
      pointer(source, 'pointerup', pos.px, pos.py);
      drag(8, 3);
      expect(onDrop).not.toHaveBeenCalled();
      expect(ghosts()).toBe(0);
    });
  });

  describe('float / 크기 제한 / breakpoint', () => {
    it('float 모드: 놓은 y 가 최종 위치로 전달된다 (중력 모드에서는 압축)', () => {
      create({ float: true });
      let result!: DriftDragInDropResult;
      editor.setupDragIn('.pal', { autoAdd: false, onDrop: (r) => (result = r) });
      drag(8, 6);
      expect(result.item).toMatchObject({ x: 8, y: 6 });
      expect(editor.getItems()).toHaveLength(2);
    });

    it('float 모드 충돌: 놓은 칸이 유지된다', () => {
      create({ float: true, layout: { columns: 12, float: true, items: [{ id: 'a', x: 0, y: 3, w: 4, h: 2 }] } });
      let result!: DriftDragInDropResult;
      editor.setupDragIn('.pal', { autoAdd: false, onDrop: (r) => (result = r) });
      drag(0, 3);
      expect(result.item).toMatchObject({ x: 0, y: 3 });
      expect(editor.getItem('a')).toMatchObject({ x: 0, y: 3 });
    });

    it('min/max 크기와 컬럼 경계가 최종 크기/위치에 반영된다', () => {
      create();
      let result!: DriftDragInDropResult;
      editor.setupDragIn('.pal', {
        autoAdd: false,
        item: { w: 99, h: 1, minW: 2, maxW: 5, minH: 3, maxH: 4 },
        onDrop: (r) => (result = r),
      });
      drag(9, 6, 5, 3); // 오른쪽 끝에 가깝게
      expect(result.item.w).toBe(5);
      expect(result.item.h).toBe(3); // minH
      expect(result.item.x + result.item.w).toBeLessThanOrEqual(12);
      expect(result.item.x).toBe(7);
    });

    it('breakpoint 편집 중에는 해당 breakpoint 의 칸 기준으로 전달하고 모델은 변하지 않는다', () => {
      create();
      editor.setBreakpoint('mobile'); // 4열
      columns = 4;
      let result!: DriftDragInDropResult;
      editor.setupDragIn('.pal', { autoAdd: false, onDrop: (r) => (result = r) });
      const before = editor.getLayout();
      drag(0, 6, 3, 2);
      expect(result.breakpoint).toBe('mobile');
      expect(result.columns).toBe(4);
      expect(result.item.x + result.item.w).toBeLessThanOrEqual(4);
      expect(editor.getLayout()).toEqual(before);
      expect(editor.isDirty()).toBe(false);

      // 호출자가 그대로 addItem 하면 해당 breakpoint 의 칸에 저장된다
      editor.addItem({ ...result.item, id: 'ext' });
      const stored = editor.getLayout().items.find((i) => i.id === 'ext')!;
      expect(stored.responsive!.mobile).toMatchObject({
        x: result.item.x,
        y: result.item.y,
        w: result.item.w,
        h: result.item.h,
      });
      expect(result.item.w).toBe(3); // 4열 자동 변환(전폭)이 아니라 지정한 폭이 유지된다
    });
  });
});
