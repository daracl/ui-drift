/**
 * 사용자 콜백(onMove, onChoose, onStart, onClone, pull/put 함수, mirror 함수) 안에서 cancel/destroy/unregister 로
 * 드래그 세션을 끝내면, 콜백이 돌아온 뒤에 그 세션의 삽입·복제·애니메이션·자동 스크롤이 이어지지 않아야 한다.
 */
import { createSortable, createSortableManager, Sortable, SortableManager } from '@/sortable';
import type { SortableEvent, SortableMoveEvent, SortableOptions } from '@/sortable/types';
import { drag, ids, ITEM_H, makeList, mockLayout, pointer } from './_helpers';

const EVENTS = ['onChoose', 'onStart', 'onClone', 'onAdd', 'onUpdate', 'onRemove', 'onSort', 'onEnd'] as const;

describe('콜백 안에서 세션을 끝내도 안전하다', () => {
  let restore: () => void;
  let created: Sortable[] = [];
  let manager: SortableManager | undefined;
  let log: string[];
  let rafCalls: number;
  let rafSpy: jest.SpyInstance;

  /** 모든 이벤트를 log 에 "목록id:이벤트" (취소면 end! ) 로 기록하는 옵션 */
  const logging = (name: string, extra: SortableOptions = {}): SortableOptions => {
    const opts: SortableOptions = { animation: 0, ...extra };
    EVENTS.forEach((key) => {
      const user = extra[key] as ((e: SortableEvent) => void) | undefined;
      (opts as Record<string, unknown>)[key] = (e: SortableEvent) => {
        log.push(`${name}:${key.slice(2).toLowerCase()}${e.cancelled ? '!' : ''}`);
        user?.(e);
      };
    });
    return opts;
  };
  const make = (el: HTMLElement, opts: SortableOptions) => {
    const s = createSortable(el, opts);
    created.push(s);
    return s;
  };

  /** 드래그가 끝난 뒤 남아 있으면 안 되는 상태 */
  const expectClean = () => {
    expect(Sortable.isDragging()).toBe(false);
    expect(Sortable.dragInfo()).toBeNull();
    expect(document.querySelectorAll('.dsr-drag, .dsr-ghost, .dsr-chosen')).toHaveLength(0);
    expect(document.documentElement.classList.contains('dsr-dragging')).toBe(false);
    document
      .querySelectorAll<HTMLElement>('body, body *')
      .forEach((el) => expect(el.style.overflowAnchor || '').toBe(''));
    const before = rafCalls;
    pointer(document, 'pointermove', 400, 400); // 끝난 세션의 리스너·RAF 가 남아 있지 않다
    expect(rafCalls).toBe(before);
  };

  beforeEach(() => {
    restore = mockLayout();
    log = [];
    rafCalls = 0;
    rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => {
      rafCalls++;
      return rafCalls;
    });
  });
  afterEach(() => {
    created.forEach((s) => s.destroy());
    created = [];
    manager?.destroy();
    manager = undefined;
    rafSpy.mockRestore();
    restore();
    document.body.innerHTML = '';
    document.body.removeAttribute('style'); // 앞 테스트의 overflow-anchor 가 다음 테스트를 가리지 않게 한다
    document.documentElement.className = '';
  });

  describe('결함 A: onMove 안의 cancel / destroy', () => {
    it.each([
      ['cancel, 반환값 없음', 'cancel', undefined],
      ['cancel 후 false', 'cancel', false],
      ['destroy, 반환값 없음', 'destroy', undefined],
      ['destroy 후 false', 'destroy', false],
    ] as const)('같은 목록 정렬: %s → 원래 순서, cancelled end 한 번, 정리 완료', (_t, action, ret) => {
      const list = makeList(['a', 'b', 'c'], 'l');
      const ref: { s?: Sortable } = {};
      const onMove = jest.fn(() => {
        if (action === 'cancel') ref.s?.cancel();
        else ref.s?.destroy();
        return ret;
      });
      ref.s = make(list, logging('l', { onMove }));
      drag(list, 0, 10, ITEM_H + 30);
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(ids(list)).toEqual(['a', 'b', 'c']);
      expect(log).toEqual(['l:choose', 'l:start', 'l:end!']);
      expectClean();
    });

    it('cancel 뒤 새 정상 드래그가 되고, destroy 한 목록은 다시 만들면 정상 동작한다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      let once = true;
      const s = make(
        list,
        logging('l', {
          onMove: () => {
            if (once) {
              once = false;
              s.cancel();
            }
          },
        }),
      );
      drag(list, 0, 10, ITEM_H + 30);
      expect(ids(list)).toEqual(['a', 'b', 'c']);
      drag(list, 0, 10, ITEM_H + 30);
      expect(ids(list)).toEqual(['b', 'a', 'c']);
      expect(log.filter((l) => l.startsWith('l:end'))).toEqual(['l:end!', 'l:end']);

      let d: Sortable | undefined;
      d = make(makeList(['x', 'y'], 'm', 300), { animation: 0, onMove: () => d?.destroy() });
      const m = document.getElementById('m') as HTMLElement;
      drag(m, 0, 310, ITEM_H + 30);
      expect(ids(m)).toEqual(['x', 'y']);
      d = make(m, { animation: 0 });
      drag(m, 0, 310, ITEM_H + 30);
      expect(ids(m)).toEqual(['y', 'x']);
      expectClean();
    });

    it.each(['cancel', 'destroy-source', 'destroy-target'] as const)(
      '다른 목록으로 이동: onMove 에서 %s → 출발/도착 모두 그대로, 성공 알림 없음',
      (action) => {
        const A = makeList(['a1', 'a2'], 'A', 0);
        const B = makeList(['b1', 'b2'], 'B', 300);
        const ref: { a?: Sortable; b?: Sortable } = {};
        const onMove = jest.fn((e: SortableMoveEvent) => {
          if (e.to !== B) return;
          if (action === 'cancel') ref.a?.cancel();
          else if (action === 'destroy-source') ref.a?.destroy();
          else ref.b?.destroy();
        });
        ref.a = make(A, logging('A', { group: 'g', onMove }));
        ref.b = make(B, logging('B', { group: 'g' }));
        drag(A, 0, 310, 10);
        expect(ids(A)).toEqual(['a1', 'a2']);
        expect(ids(B)).toEqual(['b1', 'b2']);
        expect(log.filter((l) => /add|remove|update|sort/.test(l))).toEqual([]);
        // 도착 목록만 destroy 하면 세션은 계속되므로 놓을 때 정상 end(이동 없음)다
        expect(log.filter((l) => l.startsWith('A:end'))).toEqual([action === 'destroy-target' ? 'A:end' : 'A:end!']);
        expectClean();
      },
    );

    it("pull:'clone' 경로: onMove 에서 cancel 하면 복제본이 남지 않고 clone 이벤트도 없다", () => {
      const A = makeList(['a1', 'a2'], 'A', 0);
      const B = makeList(['b1'], 'B', 300);
      const ref: { a?: Sortable } = {};
      ref.a = make(
        A,
        logging('A', {
          group: { name: 'g', pull: 'clone' },
          onMove: (e) => {
            if (e.to === B) ref.a?.cancel();
          },
        }),
      );
      make(B, logging('B', { group: 'g' }));
      drag(A, 0, 310, 10);
      expect(ids(A)).toEqual(['a1', 'a2']);
      expect(ids(B)).toEqual(['b1']);
      expect(log).toEqual(['A:choose', 'A:start', 'A:end!']);
      expectClean();
    });
  });

  describe('같은 구조의 다른 콜백 경계', () => {
    it('onChoose 에서 cancel: 드래그가 시작되지 않는다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      const s: Sortable = make(list, logging('l', { onChoose: () => s.cancel() }));
      drag(list, 0, 10, ITEM_H + 30);
      expect(ids(list)).toEqual(['a', 'b', 'c']);
      expect(log).toEqual(['l:choose']);
      expectClean();
    });

    it.each(['cancel', 'destroy'] as const)('onStart 에서 %s: 그 이동 판정·RAF 가 이어지지 않는다', (action) => {
      const list = makeList(['a', 'b', 'c'], 'l');
      const s: Sortable = make(list, logging('l', { onStart: () => (action === 'cancel' ? s.cancel() : s.destroy()) }));
      const item = list.children[0];
      pointer(item, 'pointerdown', 10, 10);
      // 첫 이동이 거리 조건을 넘으면서 바로 b 의 중앙을 넘는다
      pointer(document, 'pointermove', 10, ITEM_H + 30);
      pointer(document, 'pointerup', 10, ITEM_H + 30);
      expect(ids(list)).toEqual(['a', 'b', 'c']);
      expect(log).toEqual(['l:choose', 'l:start', 'l:end!']);
      expect(rafCalls).toBe(0);
      expectClean();
    });

    it('mirror 함수에서 cancel: 복제본·자리 표시자·dragging 클래스가 남지 않고 start 도 없다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      const s: Sortable = make(
        list,
        logging('l', {
          mirror: (item) => {
            s.cancel();
            return item.cloneNode(true) as HTMLElement;
          },
        }),
      );
      drag(list, 0, 10, ITEM_H + 30);
      expect(ids(list)).toEqual(['a', 'b', 'c']);
      expect(log).toEqual(['l:choose', 'l:end!']);
      expectClean();
    });

    it('onClone 에서 cancel: 항목이 도착 목록으로 들어가지 않고 복제본이 남지 않는다', () => {
      const A = makeList(['a1', 'a2'], 'A', 0);
      const B = makeList(['b1'], 'B', 300);
      const a: Sortable = make(A, logging('A', { group: { name: 'g', pull: 'clone' }, onClone: () => a.cancel() }));
      make(B, logging('B', { group: 'g' }));
      drag(A, 0, 310, 10);
      expect(ids(A)).toEqual(['a1', 'a2']);
      expect(ids(B)).toEqual(['b1']);
      expect(log).toEqual(['A:choose', 'A:start', 'A:clone', 'A:end!']);
      expectClean();
    });

    it.each(['pull', 'put'] as const)('%s 함수에서 cancel: 도착 목록에 넣지 않는다', (which) => {
      const A = makeList(['a1', 'a2'], 'A', 0);
      const B = makeList(['b1'], 'B', 300);
      const ref: { a?: Sortable } = {};
      const rule = () => {
        ref.a?.cancel();
        return true;
      };
      ref.a = make(A, logging('A', { group: which === 'pull' ? { name: 'g', pull: rule } : 'g' }));
      make(B, logging('B', { group: which === 'put' ? { name: 'g', put: rule } : 'g' }));
      drag(A, 0, 310, 10);
      expect(ids(A)).toEqual(['a1', 'a2']);
      expect(ids(B)).toEqual(['b1']);
      expect(log).toEqual(['A:choose', 'A:start', 'A:end!']);
      expectClean();
    });

    it('끝난 세션의 콜백이 나중에 시작한 새 세션을 건드리지 않는다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      let inner = false;
      const s: Sortable = make(
        list,
        logging('l', {
          onMove: () => {
            if (inner) return;
            inner = true;
            s.cancel();
            // 콜백 안에서 새 세션을 시작한다 (c 를 잡는다). 이전 세션의 삽입이 이 세션에 섞이면 안 된다
            pointer(list.children[2], 'pointerdown', 10, 2 * ITEM_H + 10);
          },
        }),
      );
      drag(list, 0, 10, ITEM_H + 30);
      // drag() 의 pointerup 이 새 세션을 끝낸다. 새 세션은 거리 조건을 넘지 않아 순서를 바꾸지 않는다
      expect(ids(list)).toEqual(['a', 'b', 'c']);
      expect(log).toEqual(['l:choose', 'l:start', 'l:end!', 'l:choose']);
      expectClean();
    });
  });

  describe('SortableManager: onMove 에서 unregister / destroy', () => {
    let A: HTMLElement;
    let B: HTMLElement;
    let events: string[];
    beforeEach(() => {
      A = makeList(['a1', 'a2'], 'A', 0);
      B = makeList(['b1', 'b2'], 'B', 300);
      manager = createSortableManager();
      events = [];
      (['itemTransfer', 'sort', 'end'] as const).forEach((n) =>
        manager?.on(n, (e: { event?: SortableEvent }) => events.push(`${n}${e.event?.cancelled ? '!' : ''}`)),
      );
    });
    const register = (onMove: (e: SortableMoveEvent) => unknown) => {
      manager?.register('a', A, logging('A', { onMove: onMove as SortableOptions['onMove'] }));
      manager?.register('b', B, logging('B'));
    };

    it.each(['source', 'target', 'manager'] as const)('%s 해제: 원래 자리, 성공 알림·itemTransfer 없음', (which) => {
      register((e) => {
        if (e.to !== B) return;
        if (which === 'source') manager?.unregister('a');
        else if (which === 'target') manager?.unregister('b');
        else manager?.destroy();
      });
      drag(A, 0, 310, 10);
      expect(ids(A)).toEqual(['a1', 'a2']);
      expect(ids(B)).toEqual(['b1', 'b2']);
      expect(log.filter((l) => /add|remove|update|sort/.test(l))).toEqual([]);
      expect(events.filter((e) => e !== 'end' && e !== 'end!')).toEqual([]);
      expectClean();
    });

    it('대상 해제 후 같은 요소를 다시 등록하면 정상 이동한다', () => {
      let first = true;
      register((e) => {
        if (first && e.to === B) {
          first = false;
          manager?.unregister('b');
        }
      });
      drag(A, 0, 310, 10);
      manager?.register('b', B, { animation: 0 });
      drag(A, 0, 310, 10);
      expect(ids(A)).toEqual(['a2']);
      expect(ids(B)).toEqual(['a1', 'b1', 'b2']);
      expect(events).toContain('itemTransfer');
      expectClean();
    });
  });
});
