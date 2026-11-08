import { createSortable, createSortableManager, Sortable, SortableManager } from '@/sortable';
import type { SortableEvent, SortableItemTransferEvent } from '@/sortable/types';
import { drag, ids, ITEM_H, makeList, mockLayout, pointer } from './_helpers';

/** 목록 a(0,0) b(300,0) c(600,0) 을 가로로 놓는다. 항목은 세로로 ITEM_H 씩 쌓인다 */
describe('SortableManager', () => {
  let restore: () => void;
  let manager: SortableManager;
  let A: HTMLElement;
  let B: HTMLElement;
  let C: HTMLElement;

  /** list 의 index 번째 항목을 잡아 target 목록의 (row) 위치로 옮긴다 (놓지 않는다) */
  const dragOver = (list: HTMLElement, index: number, target: HTMLElement, row: number) => {
    const sx = Number(list.dataset.left) + 10;
    const sy = Number(list.dataset.top) + index * ITEM_H + 10;
    pointer(list.children[index], 'pointerdown', sx, sy);
    pointer(document, 'pointermove', sx + 5, sy + 5);
    const tx = Number(target.dataset.left) + 10;
    // 대상 행의 위쪽 1/4 지점: 들어오는 항목은 그 행의 항목 앞에 들어간다 (swapThreshold 0.5)
    const ty = Number(target.dataset.top) + row * ITEM_H + 10;
    pointer(document, 'pointermove', tx, ty);
    return { tx, ty };
  };
  const toList = (list: HTMLElement, index: number, target: HTMLElement, row: number) => {
    const { tx, ty } = dragOver(list, index, target, row);
    pointer(document, 'pointerup', tx, ty);
  };

  beforeEach(() => {
    restore = mockLayout();
    A = makeList(['a1', 'a2', 'a3'], 'A', 0, 0);
    B = makeList(['b1', 'b2'], 'B', 300, 0);
    C = makeList([], 'C', 600, 0);
    manager = createSortableManager();
  });
  afterEach(() => {
    try {
      manager.destroy();
    } catch {
      /* 테스트에서 일부러 던진 예외 */
    }
    restore();
    document.body.innerHTML = '';
    document.documentElement.className = '';
  });

  const registerAll = (opts = { animation: 0 }) => {
    const a = manager.register('a', A, opts);
    const b = manager.register('b', '#B', opts);
    const c = manager.register('c', C, opts);
    return { a, b, c };
  };

  // ───────────────────────────── 등록 ─────────────────────────────

  describe('등록 / 조회 / 해제', () => {
    it('등록 순서대로 관리하고 selector 도 받는다', () => {
      const { a, b, c } = registerAll();
      expect(manager.getIds()).toEqual(['a', 'b', 'c']);
      expect(manager.getAll().map((x) => x.sortable)).toEqual([a, b, c]);
      expect(manager.get('b')).toBe(b);
      expect(manager.getIdOf(C)).toBe('c');
      expect(manager.getIdOf(b)).toBe('b');
      expect(Sortable.get(A)).toBe(a);
      expect(a.option('group')).toMatchObject({ name: manager.groupName });
    });

    it('잘못된 id, 중복 id, 이미 Sortable 이 있는 요소, 없는 대상, group 이름 지정은 예외이고 상태는 그대로다', () => {
      manager.register('a', A);
      expect(() => manager.register('', B)).toThrow('Sortable: 목록 id');
      expect(() => manager.register('a', B)).toThrow('이미 등록된 목록 id');
      expect(() => manager.register('x', A)).toThrow('이미 Sortable 이 적용된 요소');
      expect(() => manager.register('x', '#nope')).toThrow('요소를 찾을 수 없습니다');
      expect(() => manager.register('x', B, { group: 'g' })).toThrow('group 이름을 지정할 수 없습니다');
      expect(() => manager.register('x', B, { group: { name: 'g' } })).toThrow('group 이름을 지정할 수 없습니다');
      expect(manager.getIds()).toEqual(['a']);
      expect(Sortable.get(B)).toBeUndefined();
      // 다른 Manager / 일반 Sortable 이 쓰는 요소도 안 된다
      const plain = createSortable(B);
      expect(() => manager.register('b', B)).toThrow('이미 Sortable 이 적용된 요소');
      plain.destroy();
      expect(() => manager.register('b', B)).not.toThrow();
    });

    it('unregister 는 Sortable 을 destroy 하고 목록 요소와 항목은 남긴다. 직접 destroy 해도 등록이 정리된다', () => {
      const { a, b } = registerAll();
      const events: string[] = [];
      manager.on('containerUnregistered', (e) => events.push(e.containerId));
      expect(manager.unregister('a')).toBe(true);
      expect(manager.unregister('a')).toBe(false);
      expect(a.isDestroyed()).toBe(true);
      expect(ids(A)).toEqual(['a1', 'a2', 'a3']);
      b.destroy();
      expect(manager.has('b')).toBe(false);
      expect(events).toEqual(['a', 'b']);
      expect(manager.getIds()).toEqual(['c']);
    });

    it('destroy 는 모든 목록을 해제하고 두 번 호출해도 안전하다. 이후 register 는 예외, 나머지는 무시/거절', () => {
      const { a, b, c } = registerAll();
      manager.destroy();
      manager.destroy();
      expect([a, b, c].every((s) => s.isDestroyed())).toBe(true);
      expect(manager.isDestroyed()).toBe(true);
      expect(() => manager.register('a', A)).toThrow('destroy 된 manager');
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'a1' })).toEqual({ moved: false, reason: 'destroyed' });
      expect(manager.fromJSON('{"version":1,"containers":[]}')).toEqual([]);
    });

    it('활성 목록: setActive / pointerdown / focusin, 해제되면 없어진다', () => {
      const { b } = registerAll();
      const log: string[] = [];
      manager.on('activeChange', (e) => log.push(`${e.previousId}->${e.containerId}`));
      manager.setActive('b');
      expect(manager.getActive()).toBe(b);
      pointer(A.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointerup', 10, 10);
      expect(manager.getActiveId()).toBe('a');
      C.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(manager.getActiveId()).toBe('c');
      manager.unregister('c');
      expect(manager.getActiveId()).toBeNull();
      expect(log).toEqual(['null->b', 'b->a', 'a->c', 'c->null']);
      expect(() => manager.setActive('zz')).toThrow('등록되지 않은 목록');
    });
  });

  // ───────────────────────────── 포인터 이동 ─────────────────────────────

  describe('목록 간 드래그', () => {
    it('같은 Manager 의 목록끼리 옮겨지고 itemTransfer(user) 와 목록별 이벤트가 한 번씩 발생한다', () => {
      registerAll();
      const transfers: SortableItemTransferEvent[] = [];
      const log: string[] = [];
      manager.on('itemTransfer', (e) => transfers.push(e));
      manager.on('sort', (e) => log.push(`sort:${e.containerId}`));
      manager.on('start', (e) => log.push(`start:${e.containerId}`));
      manager.on('end', (e) => log.push(`end:${e.containerId}:${!!e.event.cancelled}`));
      toList(A, 0, B, 1);
      expect(ids(A)).toEqual(['a2', 'a3']);
      expect(ids(B)).toEqual(['b1', 'a1', 'b2']);
      expect(transfers).toEqual([
        expect.objectContaining({
          from: 'a',
          to: 'b',
          itemId: 'a1',
          oldIndex: 0,
          newIndex: 1,
          mode: 'move',
          source: 'user',
        }),
      ]);
      expect(log).toEqual(['start:a', 'sort:a', 'sort:b', 'end:a:false']);
      expect(manager.getActiveId()).toBe('b');
      // 빈 목록으로도
      toList(B, 0, C, 0);
      expect(ids(C)).toEqual(['b1']);
    });

    it('목록 안 정렬은 itemTransfer 없이 sort 만 발생한다', () => {
      registerAll();
      const transfer = jest.fn();
      const sorted: string[] = [];
      manager.on('itemTransfer', transfer);
      manager.on('sort', (e) => sorted.push(e.containerId));
      drag(A, 0, 10, ITEM_H + 30);
      expect(ids(A)).toEqual(['a2', 'a1', 'a3']);
      expect(sorted).toEqual(['a']);
      expect(transfer).not.toHaveBeenCalled();
    });

    it('다른 Manager 나 Manager 밖의 목록과는 섞이지 않는다', () => {
      manager.register('a', A, { animation: 0 });
      const other = createSortableManager();
      other.register('b', B, { animation: 0 });
      const plain = createSortable(C, { animation: 0, group: 'shared' });
      toList(A, 0, B, 0);
      toList(A, 0, C, 0);
      expect(ids(A)).toEqual(['a1', 'a2', 'a3']);
      expect(ids(B)).toEqual(['b1', 'b2']);
      expect(ids(C)).toEqual([]);
      other.destroy();
      plain.destroy();
    });

    it('crossContainer:false 면 목록 안 정렬만 되고, setCrossContainer 로 켜고 끈다', () => {
      manager = createSortableManager({ crossContainer: false });
      registerAll();
      toList(A, 0, B, 0);
      expect(ids(B)).toEqual(['b1', 'b2']);
      drag(A, 0, 10, ITEM_H + 30);
      expect(ids(A)).toEqual(['a2', 'a1', 'a3']);
      manager.setCrossContainer(true);
      expect(manager.isCrossContainer()).toBe(true);
      toList(A, 0, B, 0);
      expect(ids(B)).toContain('a2');
    });

    it('끄는 도중 목록 간 이동을 끄면 다른 목록에 들어가 있던 항목이 원래 자리로 취소된다', () => {
      registerAll();
      const ends: SortableEvent[] = [];
      manager.on('end', (e) => ends.push(e.event));
      const { tx, ty } = dragOver(A, 1, B, 0);
      expect(ids(B)).toContain('a2');
      manager.setCrossContainer(false);
      expect(ids(A)).toEqual(['a1', 'a2', 'a3']);
      expect(ids(B)).toEqual(['b1', 'b2']);
      expect(ends.map((e) => e.cancelled)).toEqual([true]);
      pointer(document, 'pointerup', tx, ty);
      expect(Sortable.isDragging()).toBe(false);
    });

    it('목록별 put:false / pull:clone 규칙을 그대로 따른다', () => {
      manager.register('a', A, { animation: 0, group: { pull: 'clone' } });
      manager.register('b', B, { animation: 0, group: { put: false } });
      manager.register('c', C, { animation: 0 });
      const transfers: SortableItemTransferEvent[] = [];
      manager.on('itemTransfer', (e) => transfers.push(e));
      toList(A, 0, B, 0);
      expect(ids(B)).toEqual(['b1', 'b2']);
      toList(A, 0, C, 0);
      expect(ids(A)).toEqual(['a1', 'a2', 'a3']); // 복제본이 남는다
      expect(ids(C)).toEqual(['a1']);
      expect(transfers).toEqual([expect.objectContaining({ from: 'a', to: 'c', mode: 'clone' })]);
    });

    it('끄는 도중 항목이 들어가 있는 목록을 해제하면 항목은 원래 목록으로 돌아간다', () => {
      registerAll();
      const { tx, ty } = dragOver(A, 0, B, 0);
      expect(ids(B)).toContain('a1');
      manager.unregister('b');
      expect(ids(A)).toEqual(['a1', 'a2', 'a3']);
      expect(ids(B)).toEqual(['b1', 'b2']);
      pointer(document, 'pointerup', tx, ty);
      expect(document.querySelectorAll('.dsr-drag')).toHaveLength(0);
    });

    it('끄는 도중 Manager destroy 는 드래그를 취소하고 복제본을 정리한다', () => {
      registerAll();
      const { tx, ty } = dragOver(A, 0, B, 0);
      expect(document.querySelectorAll('.dsr-drag')).toHaveLength(1);
      manager.destroy();
      expect(ids(A)).toEqual(['a1', 'a2', 'a3']);
      expect(document.querySelectorAll('.dsr-drag, .dsr-ghost')).toHaveLength(0);
      pointer(document, 'pointerup', tx, ty);
      expect(ids(B)).toEqual(['b1', 'b2']);
    });
  });

  // ───────────────────────────── API 이동 ─────────────────────────────

  describe('transferItem', () => {
    it('항목을 옮기고 목록에 remove → add → sort → sort, Manager 에 itemTransfer(api) 를 낸다', () => {
      const onAdd = jest.fn();
      manager.register('a', A, { animation: 0 });
      manager.register('b', B, { animation: 0, onAdd });
      const log: string[] = [];
      manager.get('a')?.on('remove', (e) => log.push(`a:remove:${e.oldIndex}`));
      manager.get('b')?.on('add', (e) => log.push(`b:add:${e.newIndex}`));
      manager.on('sort', (e) => log.push(`sort:${e.containerId}`));
      manager.on('itemTransfer', (e) => log.push(`transfer:${e.from}->${e.to}:${e.itemId}:${e.source}`));
      const r = manager.transferItem({ from: 'a', to: 'b', itemId: 'a2', index: 1 });
      expect(r).toMatchObject({ moved: true, from: 'a', to: 'b', oldIndex: 1, newIndex: 1 });
      expect(ids(A)).toEqual(['a1', 'a3']);
      expect(ids(B)).toEqual(['b1', 'a2', 'b2']);
      expect(log).toEqual(['a:remove:1', 'b:add:1', 'sort:a', 'sort:b', 'transfer:a->b:a2:api']);
      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(manager.getActiveId()).toBe('b');
      // index 생략/초과는 맨 뒤
      manager.transferItem({ from: 'a', to: 'b', itemId: 'a1' });
      manager.transferItem({ from: 'a', to: 'b', itemId: 'a3', index: 99 });
      expect(ids(B)).toEqual(['b1', 'a2', 'b2', 'a1', 'a3']);
      // 빈 목록에서 다시 꺼낸다
      manager.transferItem({ from: 'b', to: 'a', itemId: 'b1', index: 0 });
      expect(ids(A)).toEqual(['b1']);
    });

    it('예상 가능한 거절은 결과로 돌려주고 아무것도 바꾸지 않는다', () => {
      registerAll();
      const transfer = jest.fn();
      manager.on('itemTransfer', transfer);
      expect(manager.transferItem({ from: 'a', to: 'a', itemId: 'a1' })).toEqual({
        moved: false,
        reason: 'same-container',
      });
      expect(manager.transferItem({ from: 'a', to: 'zz', itemId: 'a1' })).toEqual({
        moved: false,
        reason: 'missing-container',
      });
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'nope' })).toEqual({
        moved: false,
        reason: 'missing-item',
      });
      A.appendChild(A.children[0].cloneNode(true));
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'a1' })).toEqual({
        moved: false,
        reason: 'duplicate-item',
      });
      A.lastElementChild?.remove();
      dragOver(A, 1, A, 2);
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'a1' })).toEqual({ moved: false, reason: 'busy' });
      pointer(document, 'pointerup', 0, 0);
      B.remove();
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'a1' })).toEqual({
        moved: false,
        reason: 'disconnected',
      });
      expect(transfer).not.toHaveBeenCalled();
      // 거절은 아무것도 바꾸지 않는다 (busy 확인용 드래그도 중앙을 넘지 않아 순서가 그대로)
      expect(ids(A)).toEqual(['a1', 'a2', 'a3']);
    });

    it('입력 오류는 예외', () => {
      registerAll();
      expect(() => manager.transferItem(null as never)).toThrow('Sortable:');
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 1 as never })).toThrow('문자열');
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 'a1', index: -1 })).toThrow('index');
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 'a1', index: 1.5 })).toThrow('index');
    });

    it('리스너 예외는 완료된 이동을 되돌리지 않고 나머지 알림 뒤 첫 예외를 던진다. 재진입 이동은 busy', () => {
      registerAll();
      const nested: unknown[] = [];
      manager.get('a')?.on('remove', () => {
        nested.push(manager.transferItem({ from: 'a', to: 'c', itemId: 'a3' }));
        throw new Error('리스너 예외');
      });
      const transfer = jest.fn();
      manager.on('itemTransfer', transfer);
      expect(() => manager.transferItem({ from: 'a', to: 'b', itemId: 'a1' })).toThrow('리스너 예외');
      expect(ids(B)).toContain('a1');
      expect(transfer).toHaveBeenCalledTimes(1);
      expect(nested).toEqual([{ moved: false, reason: 'busy' }]);
    });
  });

  // ───────────────────────────── 저장 / 복원 ─────────────────────────────

  describe('순서 저장 / 복원', () => {
    it('목록 사이로 옮긴 뒤 복원하면 원래 목록·순서로 돌아간다', () => {
      registerAll();
      const saved = manager.toJSON();
      expect(JSON.parse(saved)).toEqual({
        version: 1,
        containers: [
          { id: 'a', order: ['a1', 'a2', 'a3'] },
          { id: 'b', order: ['b1', 'b2'] },
          { id: 'c', order: [] },
        ],
      });
      toList(A, 0, B, 1);
      manager.transferItem({ from: 'b', to: 'c', itemId: 'b2' });
      drag(A, 0, 10, ITEM_H + 30);
      expect(manager.fromJSON(saved)).toEqual(['a', 'b', 'c']);
      expect(ids(A)).toEqual(['a1', 'a2', 'a3']);
      expect(ids(B)).toEqual(['b1', 'b2']);
      expect(ids(C)).toEqual([]);
      expect(manager.toJSON()).toBe(saved);
    });

    it('데이터에 없는 기존 항목은 지정한 항목 뒤에 원래 순서로 남고, 데이터에 없는 목록은 그대로다', () => {
      registerAll();
      manager.fromJSON({ version: 1, containers: [{ id: 'a', order: ['a3', 'b1'] }] });
      expect(ids(A)).toEqual(['a3', 'b1', 'a1', 'a2']);
      expect(ids(B)).toEqual(['b2']);
    });

    it.each([
      ['손상된 JSON', '{bad', '해석할 수 없습니다'],
      ['지원하지 않는 version', '{"version":2,"containers":[]}', 'version: 2'],
      ['containers 없음', '{"version":1}', 'containers 는 배열'],
      ['중복 목록 id', '{"version":1,"containers":[{"id":"a","order":[]},{"id":"a","order":[]}]}', '중복된 목록 id'],
      ['order 형식', '{"version":1,"containers":[{"id":"a","order":[1]}]}', '문자열 배열'],
      [
        '데이터 안 중복 항목',
        '{"version":1,"containers":[{"id":"a","order":["a1"]},{"id":"b","order":["a1"]}]}',
        '두 번',
      ],
      ['미등록 목록', '{"version":1,"containers":[{"id":"zz","order":[]}]}', '등록되지 않은 목록'],
      ['없는 항목', '{"version":1,"containers":[{"id":"a","order":["nope"]}]}', '어느 목록에도 없는 항목'],
    ])('%s 이면 예외이고 DOM 은 그대로다', (_name, json, message) => {
      registerAll();
      const before = manager.toJSON();
      expect(() => manager.fromJSON(json)).toThrow(message);
      expect(manager.toJSON()).toBe(before);
    });

    it("unknown:'ignore' 는 미등록 목록과 없는 항목만 건너뛴다. DOM 의 중복 id 는 항상 예외", () => {
      registerAll();
      const applied = manager.fromJSON(
        {
          version: 1,
          containers: [
            { id: 'zz', order: [] },
            { id: 'b', order: ['nope', 'a1'] },
          ],
        },
        { unknown: 'ignore' },
      );
      expect(applied).toEqual(['b']);
      expect(ids(B)).toEqual(['a1', 'b1', 'b2']);
      C.appendChild(B.children[1].cloneNode(true)); // b1 이 B 와 C 에 있다
      expect(() => manager.fromJSON({ version: 1, containers: [{ id: 'a', order: ['b1'] }] })).toThrow('같은 항목 id');
    });

    it('드래그 중에는 복원할 수 없다', () => {
      registerAll();
      const { tx, ty } = dragOver(A, 0, B, 0);
      expect(() => manager.fromJSON(manager.toJSON())).toThrow('드래그 중');
      pointer(document, 'pointerup', tx, ty);
    });
  });

  // ───────────────────────────── 예외 안정성 (Sortable 본체) ─────────────────────────────

  it('드롭 시 리스너 하나가 예외를 던져도 나머지 목록 이벤트와 Manager 알림이 모두 발생한다', () => {
    manager.register('a', A, {
      animation: 0,
      onRemove: () => {
        throw new Error('onRemove 예외');
      },
    });
    const onAdd = jest.fn();
    manager.register('b', B, { animation: 0, onAdd });
    const transfer = jest.fn();
    manager.on('itemTransfer', transfer);
    const reported: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      reported.push(e.error);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    toList(A, 0, B, 0);
    window.removeEventListener('error', onError);
    expect(ids(B)).toContain('a1');
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([expect.objectContaining({ message: 'onRemove 예외' })]);
    expect(Sortable.isDragging()).toBe(false);
  });
});
