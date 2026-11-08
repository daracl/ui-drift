/**
 * 도착 목록이 관리(정렬·조회·저장)할 수 없는 항목을 받아들이지 않는다.
 * draggable(도착 목록 문맥에서 판정) 또는 dataIdAttr(같은 id 로 읽히는지) 규칙과 맞지 않으면 transferItem 은
 * 'incompatible-item' 으로 거절하고, fromJSON 은 아무것도 바꾸지 않고 예외, 포인터 드래그는 그 목록에 넣지 않는다.
 */
import { createSortable, createSortableManager, Sortable, SortableManager } from '@/sortable';
import type { SortableOptions } from '@/sortable/types';
import { drag, ids, makeItem, makeList, mockLayout } from './_helpers';

describe('도착 목록과 호환되지 않는 항목', () => {
  let restore: () => void;
  let manager: SortableManager;
  let A: HTMLElement;
  let B: HTMLElement;
  let log: string[];
  let created: Sortable[] = [];

  const cls = (list: HTMLElement, name: string) => {
    Array.from(list.children).forEach((c) => c.classList.add(name));
    return list;
  };
  /** 이벤트를 모두 기록하는 옵션 */
  const opts = (name: string, extra: SortableOptions = {}): SortableOptions => ({
    animation: 0,
    onAdd: () => log.push(`${name}:add`),
    onRemove: () => log.push(`${name}:remove`),
    onUpdate: () => log.push(`${name}:update`),
    onSort: () => log.push(`${name}:sort`),
    ...extra,
  });
  const children = (list: HTMLElement) => Array.from(list.childNodes);

  beforeEach(() => {
    restore = mockLayout();
    log = [];
    A = cls(makeList(['x', 'x2'], 'A', 0), 'a');
    B = cls(makeList(['y'], 'B', 300), 'b');
    B.classList.add('box');
    manager = createSortableManager();
    manager.on('itemTransfer', (e) => log.push(`transfer:${e.itemId}`));
  });
  afterEach(() => {
    manager.destroy();
    created.forEach((s) => s.destroy());
    created = [];
    restore();
    document.body.innerHTML = '';
    document.documentElement.className = '';
  });

  describe('transferItem', () => {
    it('.a → .b 는 incompatible-item 으로 거절하고 DOM·활성·이벤트를 그대로 둔다', () => {
      manager.register('a', A, opts('a', { draggable: '.a' }));
      const b = manager.register('b', B, opts('b', { draggable: '.b' }));
      manager.setActive('a');
      const beforeA = children(A);
      const beforeB = children(B);
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'x' })).toEqual({
        moved: false,
        reason: 'incompatible-item',
      });
      expect(children(A)).toEqual(beforeA);
      expect(children(B)).toEqual(beforeB);
      expect(b.toArray()).toEqual(['y']);
      expect(manager.getActiveId()).toBe('a');
      expect(log).toEqual([]);
      expect(manager.getOrders().containers).toEqual([
        { id: 'a', order: ['x', 'x2'] },
        { id: 'b', order: ['y'] },
      ]);
      // 호출자가 항목을 호환되게 준비하면 다시 요청할 수 있다
      A.children[0].classList.add('b');
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'x' })).toMatchObject({ moved: true, newIndex: 1 });
    });

    it.each([
      ['같은 selector', { draggable: '.a, .b' }, { draggable: '.a, .b' }],
      ['제한 없는 도착 목록', { draggable: '.a' }, {}],
      ['부모 문맥 selector (#A > div → #B > div)', { draggable: '#A > div' }, { draggable: '#B > div' }],
      ['부모 문맥 selector (도착 목록 클래스)', {}, { draggable: '.box > div' }],
    ] as const)('%s 이면 정상 이동하고 newIndex 가 도착 items() 의 위치와 같다', (_t, from, to) => {
      manager.register('a', A, opts('a', from));
      const b = manager.register('b', B, opts('b', to));
      const result = manager.transferItem({ from: 'a', to: 'b', itemId: 'x', index: 0 });
      expect(result).toMatchObject({ moved: true, oldIndex: 0, newIndex: 0 });
      const item = A.ownerDocument.querySelector('[data-id="x"]') as HTMLElement;
      expect(b.items().indexOf(item)).toBe(0);
      expect(b.toArray()).toEqual(['x', 'y']);
      expect(log).toEqual(['a:remove', 'b:add', 'a:sort', 'b:sort', 'transfer:x']);
    });

    it('draggable 이 아닌 고정 자식이 섞인 목록에서 index 0 / 중간 / 끝을 draggable 기준으로 넣는다', () => {
      const head = document.createElement('header');
      const foot = document.createElement('footer');
      B.insertBefore(head, B.firstChild);
      B.appendChild(makeItem('y2')).classList.add('b');
      B.appendChild(foot);
      A.appendChild(makeItem('x3')).classList.add('a');
      manager.register('a', A, opts('a', { draggable: '.a, .b' }));
      const b = manager.register('b', B, opts('b', { draggable: '.a, .b' }));
      const at = (itemId: string, index?: number) => {
        const r = manager.transferItem({ from: 'a', to: 'b', itemId, index });
        if (!r.moved) throw new Error(r.reason);
        expect(b.items().indexOf(r.item)).toBe(r.newIndex);
        return r.newIndex;
      };
      expect(at('x', 0)).toBe(0);
      expect(at('x2', 2)).toBe(2);
      expect(at('x3')).toBe(4);
      expect(Array.from(B.children).map((c) => c.getAttribute('data-id') ?? c.tagName)).toEqual([
        'HEADER',
        'x',
        'y',
        'x2',
        'y2',
        'x3',
        'FOOTER',
      ]);
      const saved = manager.toJSON();
      manager.fromJSON('{"version":1,"containers":[{"id":"a","order":["x","x2","x3"]}]}');
      expect(manager.getOrders().containers).toEqual([
        { id: 'a', order: ['x', 'x2', 'x3'] },
        { id: 'b', order: ['y', 'y2'] },
      ]);
      manager.fromJSON(saved);
      expect(manager.toJSON()).toBe(saved);
    });

    it('dataIdAttr: 같음 / 다르지만 같은 id 제공은 이동, 도착 속성 없음 / 다른 값은 거절', () => {
      const key = (id: string, value?: string) => {
        const el = A.querySelector(`[data-id="${id}"]`) as HTMLElement;
        if (value !== undefined) el.setAttribute('data-key', value);
      };
      A.appendChild(makeItem('x3'));
      key('x', 'x'); // 같은 id 를 대상 속성으로도 제공
      key('x2', 'other'); // 다른 값
      // x3: 대상 속성 없음
      manager.register('a', A, opts('a'));
      const b = manager.register('b', B, opts('b', { dataIdAttr: 'data-key' }));
      manager.register('c', makeList([], 'C', 600), opts('c'));
      expect(manager.transferItem({ from: 'a', to: 'c', itemId: 'x3' })).toMatchObject({ moved: true });
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'x' })).toMatchObject({ moved: true });
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'x2' })).toEqual({
        moved: false,
        reason: 'incompatible-item',
      });
      expect(manager.transferItem({ from: 'c', to: 'b', itemId: 'x3' })).toEqual({
        moved: false,
        reason: 'incompatible-item',
      });
      expect(b.toArray()).toEqual(['', 'x']); // y 에는 data-key 가 없다 (기존 항목은 그대로)
      expect(ids(A)).toEqual(['x2']);
    });

    it('기존 거절 사유의 우선순위를 유지한다 (missing/duplicate 은 호환성보다 먼저)', () => {
      A.appendChild(makeItem('x')).classList.add('a');
      manager.register('a', A, opts('a', { draggable: '.a' }));
      manager.register('b', B, opts('b', { draggable: '.b' }));
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'x' })).toEqual({
        moved: false,
        reason: 'duplicate-item',
      });
      expect(manager.transferItem({ from: 'a', to: 'b', itemId: 'nope' })).toEqual({
        moved: false,
        reason: 'missing-item',
      });
      expect(manager.transferItem({ from: 'a', to: 'a', itemId: 'x2' })).toEqual({
        moved: false,
        reason: 'same-container',
      });
    });

    it('잘못된 draggable selector 는 기존처럼 예외이고, 비어 있는 도착 목록이어도 항목을 원래 자리로 되돌린다', () => {
      const C = makeList([], 'C', 600);
      manager.register('a', A, opts('a'));
      manager.register('c', C, opts('c', { draggable: '[[bad' }));
      const before = children(A);
      expect(() => manager.transferItem({ from: 'a', to: 'c', itemId: 'x' })).toThrow();
      expect(children(A)).toEqual(before);
      expect(C.children).toHaveLength(0);
      expect(log).toEqual([]);
    });
  });

  describe('포인터 드래그', () => {
    it('Manager: .a → .b 목록에는 들어가지 않는다', () => {
      manager.register('a', A, opts('a', { draggable: '.a' }));
      manager.register('b', B, opts('b', { draggable: '.b' }));
      drag(A, 0, 310, 10);
      expect(ids(A)).toEqual(['x', 'x2']);
      expect(ids(B)).toEqual(['y']);
      expect(log).toEqual([]);
    });

    it('Manager: dataIdAttr 로 같은 id 를 읽을 수 없는 목록에는 들어가지 않는다', () => {
      manager.register('a', A, opts('a'));
      manager.register('b', B, opts('b', { dataIdAttr: 'data-key' }));
      drag(A, 0, 310, 10);
      expect(ids(B)).toEqual(['y']);
      A.children[0].setAttribute('data-key', 'x');
      drag(A, 0, 310, 10);
      expect(ids(B)).toEqual(['x', 'y']);
      expect(log).toEqual(['a:remove', 'b:add', 'a:sort', 'b:sort', 'transfer:x']);
    });

    it('일반 Sortable(같은 group): draggable 이 맞지 않으면 넣지 않고, 부모 문맥 selector 는 도착 문맥으로 판정한다', () => {
      created.push(createSortable(A, opts('a', { group: 'g', draggable: '.a' })));
      const b = createSortable(B, opts('b', { group: 'g', draggable: '.b' }));
      created.push(b);
      drag(A, 0, 310, 10);
      expect(ids(B)).toEqual(['y']);
      expect(ids(A)).toEqual(['x', 'x2']);
      b.option('draggable', '#B > div');
      created[0].option('draggable', '#A > div');
      drag(A, 0, 310, 10);
      expect(ids(B)).toEqual(['x', 'y']);
      expect(b.toArray()).toEqual(['x', 'y']);
      expect(log).toEqual(['a:remove', 'b:add', 'a:sort', 'b:sort']);
    });
  });

  describe('fromJSON', () => {
    it('도착 목록이 관리할 수 없는 항목을 지정하면 예외이고 어떤 목록도 바꾸지 않는다', () => {
      const C = cls(makeList(['z'], 'C', 600), 'a');
      manager.register('a', A, opts('a', { draggable: '.a' }));
      manager.register('b', B, opts('b', { draggable: '.b' }));
      manager.register('c', C, opts('c', { draggable: '.a' }));
      const before = [children(A), children(B), children(C)];
      // c 는 정상으로 바뀔 수 있는 데이터지만, b 의 x 때문에 전체를 거절한다
      const data = '{"version":1,"containers":[{"id":"c","order":["x2","z"]},{"id":"b","order":["x","y"]}]}';
      expect(() => manager.fromJSON(data)).toThrow('관리할 수 없는 항목');
      expect(() => manager.fromJSON(data, { unknown: 'ignore' })).toThrow('관리할 수 없는 항목');
      expect([children(A), children(B), children(C)]).toEqual(before);
      expect(log).toEqual([]);
    });

    it('dataIdAttr 로 같은 id 를 읽을 수 없는 목록으로는 복원하지 않는다', () => {
      manager.register('a', A, opts('a'));
      manager.register('b', B, opts('b', { dataIdAttr: 'data-key' }));
      const before = [children(A), children(B)];
      expect(() => manager.fromJSON({ version: 1, containers: [{ id: 'b', order: ['x'] }] })).toThrow(
        '관리할 수 없는 항목',
      );
      expect([children(A), children(B)]).toEqual(before);
    });

    it('부모 문맥 selector 는 도착 문맥으로 판정해 정상 복원한다', () => {
      manager.register('a', A, opts('a', { draggable: '#A > div' }));
      manager.register('b', B, opts('b', { draggable: '#B > div' }));
      expect(manager.fromJSON({ version: 1, containers: [{ id: 'b', order: ['x', 'y'] }] })).toEqual(['b']);
      expect(manager.getOrders().containers).toEqual([
        { id: 'a', order: ['x2'] },
        { id: 'b', order: ['x', 'y'] },
      ]);
    });
  });
});
