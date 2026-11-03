import { createSortable, Sortable } from '@/sortable';
import type { SortableEvent } from '@/sortable/types';
import { drag, ids, ITEM_H, LIST_W, makeList, mockLayout, pointer } from './_helpers';

describe('Sortable', () => {
  let restore: () => void;
  let created: Sortable[] = [];
  const make = (...args: Parameters<typeof createSortable>): Sortable => {
    const s = createSortable(...args);
    created.push(s);
    return s;
  };

  beforeEach(() => {
    restore = mockLayout();
  });
  afterEach(() => {
    created.forEach((s) => s.destroy());
    created = [];
    restore();
    document.body.innerHTML = '';
    document.documentElement.className = '';
  });

  describe('목록 안 정렬', () => {
    it('아래로 끌면 포인터가 대상 중앙을 넘을 때 뒤로 이동한다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      make(list, { animation: 0 });
      drag(list, 0, 10, ITEM_H + 30);
      expect(ids(list)).toEqual(['b', 'a', 'c']);
    });

    it('위로 끌면 앞으로 이동한다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      make(list, { animation: 0 });
      drag(list, 2, 10, 5);
      expect(ids(list)).toEqual(['c', 'a', 'b']);
    });

    it('중앙을 넘기 전에는 자리를 바꾸지 않는다 (swapThreshold 0.5)', () => {
      const list = makeList(['a', 'b'], 'l');
      make(list, { animation: 0 });
      drag(list, 0, 10, ITEM_H + 10);
      expect(ids(list)).toEqual(['a', 'b']);
    });

    it('swapThreshold 를 키우면 더 일찍 자리를 바꾼다', () => {
      const list = makeList(['a', 'b'], 'l');
      make(list, { animation: 0, swapThreshold: 0.9 });
      drag(list, 0, 10, ITEM_H + 10);
      expect(ids(list)).toEqual(['b', 'a']);
    });

    it('드래그 중에는 자리 표시자와 복제본이 생기고 끝나면 모두 정리된다', () => {
      const list = makeList(['a', 'b'], 'l');
      make(list, { animation: 0 });
      const item = list.children[0] as HTMLElement;
      pointer(item, 'pointerdown', 10, 10);
      expect(item.classList.contains('dsr-chosen')).toBe(true);
      pointer(document, 'pointermove', 20, 20);
      expect(item.classList.contains('dsr-ghost')).toBe(true);
      expect(document.querySelector('.dsr-drag')).not.toBeNull();
      expect(document.documentElement.classList.contains('dsr-dragging')).toBe(true);
      expect(Sortable.isDragging()).toBe(true);
      pointer(document, 'pointerup', 20, 20);
      expect(item.className).toBe('');
      expect(document.querySelector('.dsr-drag')).toBeNull();
      expect(document.documentElement.classList.contains('dsr-dragging')).toBe(false);
      expect(Sortable.isDragging()).toBe(false);
    });

    it('포인터를 따라다니는 복제본은 원래 목록과 같은 태그의 빈 홀더 안에 들어가 부모 의존 스타일을 유지한다', () => {
      const ul = document.createElement('ul');
      ul.className = 'list';
      ul.id = 'ul';
      ul.dataset.left = '0';
      ul.dataset.top = '0';
      ul.innerHTML = '<li data-id="a">a</li><li data-id="b">b</li>';
      document.body.appendChild(ul);
      make(ul, { animation: 0 });
      pointer(ul.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 30, 30);
      const drag = document.querySelector('.dsr-drag') as HTMLElement;
      const holder = drag.parentElement as HTMLElement;
      expect(drag.tagName).toBe('LI');
      expect(holder.tagName).toBe('UL'); // body 에 바로 붙으면 `.list > li` 규칙이 안 맞아 목록 점이 보인다
      expect(holder.classList.contains('list')).toBe(true);
      expect(holder.id).toBe(''); // id 중복 방지
      expect(holder.classList.contains('dsr')).toBe(false);
      expect(holder.parentElement).toBe(document.body);
      pointer(document, 'pointerup', 30, 30);
      expect(document.querySelector('.list.dsr-drag, ul > .dsr-drag')).toBeNull();
      expect(document.body.querySelectorAll('ul').length).toBe(1); // 홀더도 함께 정리된다
    });

    it('드래그 동안만 목록과 조상의 overflow-anchor 를 끄고 끝나면 복원한다', () => {
      const list = makeList(['a', 'b'], 'l');
      list.style.overflowAnchor = 'auto';
      make(list, { animation: 0 });
      pointer(list.children[0], 'pointerdown', 10, 10);
      expect(list.style.overflowAnchor).toBe('auto');
      pointer(document, 'pointermove', 30, 30);
      expect(list.style.overflowAnchor).toBe('none');
      expect(document.body.style.overflowAnchor).toBe('none');
      pointer(document, 'pointerup', 30, 30);
      expect(list.style.overflowAnchor).toBe('auto');
      expect(document.body.style.overflowAnchor).toBe('');
    });

    it('이동 거리가 distance 미만이면 드래그하지 않는다', () => {
      const list = makeList(['a', 'b'], 'l');
      const onStart = jest.fn();
      make(list, { animation: 0, distance: 10, onStart });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 14, 14);
      pointer(document, 'pointerup', 14, 14);
      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe('시작 조건', () => {
    it('handle 이 지정되면 handle 에서만 시작한다', () => {
      const list = makeList(['a', 'b'], 'l');
      list.children[0].innerHTML = '<i class="grip">⠿</i>a';
      const onStart = jest.fn();
      make(list, { animation: 0, handle: '.grip', onStart });

      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 30, 30);
      pointer(document, 'pointerup', 30, 30);
      expect(onStart).not.toHaveBeenCalled();

      pointer(list.querySelector('.grip') as Element, 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 30, 30);
      pointer(document, 'pointerup', 30, 30);
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('handle 에는 .dsr-handle(touch-action 용)이 붙고 목록에는 touch-none 이 붙지 않는다', () => {
      const list = makeList(['a'], 'l');
      list.children[0].innerHTML = '<i class="grip">g</i>';
      make(list, { handle: '.grip' });
      expect((list.querySelector('.grip') as Element).classList.contains('dsr-handle')).toBe(true);
      expect(list.classList.contains('dsr-touch-none')).toBe(false);
    });

    it('handle 이 없으면 목록에 touch-none 이 붙고, delay 가 있으면 붙지 않는다', () => {
      const a = makeList(['a'], 'a');
      const b = makeList(['b'], 'b');
      make(a);
      make(b, { delay: 100 });
      expect(a.classList.contains('dsr-touch-none')).toBe(true);
      expect(b.classList.contains('dsr-touch-none')).toBe(false);
    });

    it('filter 와 input 에서는 시작하지 않는다', () => {
      const list = makeList(['a', 'b'], 'l');
      list.children[0].innerHTML = '<input class="x" /><span class="nodrag">n</span>';
      const onStart = jest.fn();
      make(list, { animation: 0, filter: '.nodrag', onStart });
      for (const sel of ['input', '.nodrag']) {
        pointer(list.querySelector(sel) as Element, 'pointerdown', 10, 10);
        pointer(document, 'pointermove', 30, 30);
        pointer(document, 'pointerup', 30, 30);
      }
      expect(onStart).not.toHaveBeenCalled();
    });

    it('draggable 에 일치하지 않는 자식은 정렬 대상이 아니다', () => {
      const list = makeList(['a', 'b'], 'l');
      list.children[0].classList.add('fixed');
      const onStart = jest.fn();
      const s = make(list, { animation: 0, draggable: ':not(.fixed)', onStart });
      expect(s.items().map((i) => i.dataset.id)).toEqual(['b']);
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 30, 30);
      pointer(document, 'pointerup', 30, 30);
      expect(onStart).not.toHaveBeenCalled();
    });

    it('disabled 이면 시작하지 않고, option() 으로 다시 켤 수 있다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      const s = make(list, { animation: 0, disabled: true });
      drag(list, 0, 10, 2 * ITEM_H + 30);
      expect(ids(list)).toEqual(['a', 'b', 'c']);
      s.option('disabled', false);
      drag(list, 0, 10, 2 * ITEM_H + 30);
      expect(ids(list)).toEqual(['b', 'c', 'a']);
    });

    it('마우스 오른쪽 버튼으로는 시작하지 않는다', () => {
      const list = makeList(['a', 'b'], 'l');
      const onStart = jest.fn();
      make(list, { animation: 0, onStart });
      pointer(list.children[0], 'pointerdown', 10, 10, 'mouse', 2);
      pointer(document, 'pointermove', 30, 30);
      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe('delay', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('대기 시간 전에 움직이면 드래그하지 않는다', () => {
      const list = makeList(['a', 'b'], 'l');
      const onStart = jest.fn();
      make(list, { animation: 0, delay: 200, onStart });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 30, 30);
      jest.advanceTimersByTime(300);
      pointer(document, 'pointermove', 40, 40);
      expect(onStart).not.toHaveBeenCalled();
      expect(Sortable.isDragging()).toBe(false);
    });

    it('대기 시간을 채우면 chosen 이 붙고 이후 움직이면 드래그가 시작된다', () => {
      const list = makeList(['a', 'b'], 'l');
      const onStart = jest.fn();
      make(list, { animation: 0, delay: 200, onStart });
      const item = list.children[0] as HTMLElement;
      pointer(item, 'pointerdown', 10, 10);
      expect(item.classList.contains('dsr-chosen')).toBe(false);
      jest.advanceTimersByTime(200);
      expect(item.classList.contains('dsr-chosen')).toBe(true);
      pointer(document, 'pointermove', 30, 30);
      expect(onStart).toHaveBeenCalledTimes(1);
      pointer(document, 'pointerup', 30, 30);
    });

    it('delayOnTouchOnly 는 마우스에는 대기 시간을 적용하지 않는다', () => {
      const list = makeList(['a', 'b'], 'l');
      const onStart = jest.fn();
      make(list, { animation: 0, delay: 500, delayOnTouchOnly: true, onStart });
      pointer(list.children[0], 'pointerdown', 10, 10, 'mouse');
      pointer(document, 'pointermove', 30, 30);
      expect(onStart).toHaveBeenCalledTimes(1);
      pointer(document, 'pointerup', 30, 30);
    });
  });

  describe('이벤트', () => {
    it('같은 목록 정렬은 choose → start → update → sort → end 순서로 호출된다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      const calls: string[] = [];
      const evts: Record<string, SortableEvent> = {};
      const rec = (name: string) => (e: SortableEvent) => {
        calls.push(name);
        evts[name] = e;
      };
      make(list, {
        animation: 0,
        onChoose: rec('choose'),
        onStart: rec('start'),
        onUpdate: rec('update'),
        onSort: rec('sort'),
        onEnd: rec('end'),
        onAdd: rec('add'),
        onRemove: rec('remove'),
      });
      drag(list, 0, 10, 2 * ITEM_H + 30);
      expect(calls).toEqual(['choose', 'start', 'update', 'sort', 'end']);
      expect(evts.update.oldIndex).toBe(0);
      expect(evts.update.newIndex).toBe(2);
      expect(evts.end.item.dataset.id).toBe('a');
      expect(evts.end.cancelled).toBeUndefined();
    });

    it('순서가 그대로면 update/sort 는 호출되지 않고 end 만 호출된다', () => {
      const list = makeList(['a', 'b'], 'l');
      const onUpdate = jest.fn();
      const onEnd = jest.fn();
      make(list, { animation: 0, onUpdate, onEnd });
      drag(list, 0, 20, 20);
      expect(onUpdate).not.toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('on/off 로 이벤트를 구독/해제한다', () => {
      const list = makeList(['a', 'b'], 'l');
      const s = make(list, { animation: 0 });
      const handler = jest.fn();
      const off = s.on('end', handler);
      drag(list, 0, 20, 20);
      off();
      drag(list, 0, 20, 20);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('onMove 가 false 를 돌려주면 이동하지 않는다', () => {
      const list = makeList(['a', 'b'], 'l');
      const onMove = jest.fn(() => false as const);
      make(list, { animation: 0, onMove });
      drag(list, 0, 10, ITEM_H + 30);
      expect(onMove).toHaveBeenCalled();
      expect(ids(list)).toEqual(['a', 'b']);
    });

    it('onMove 의 -1 은 대상 앞에 넣도록 바꾼다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      make(list, { animation: 0, onMove: () => -1 });
      drag(list, 0, 10, 2 * ITEM_H + 30); // c 뒤로 가려 했지만 c 앞에 넣는다
      expect(ids(list)).toEqual(['b', 'a', 'c']);
    });
  });

  describe('취소', () => {
    it('Esc 를 누르면 원래 자리로 돌아가고 cancelled 로 end 가 호출된다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      const onEnd = jest.fn();
      const onUpdate = jest.fn();
      make(list, { animation: 0, onEnd, onUpdate });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', 10, 2 * ITEM_H + 30);
      expect(ids(list)).toEqual(['b', 'c', 'a']);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(ids(list)).toEqual(['a', 'b', 'c']);
      expect(onUpdate).not.toHaveBeenCalled();
      expect(onEnd.mock.calls[0][0].cancelled).toBe(true);
      expect(document.querySelector('.dsr-drag')).toBeNull();
    });

    it('pointercancel 도 취소로 처리한다', () => {
      const list = makeList(['a', 'b'], 'l');
      make(list, { animation: 0 });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', 10, ITEM_H + 30);
      expect(ids(list)).toEqual(['b', 'a']);
      pointer(document, 'pointercancel', 10, ITEM_H + 30);
      expect(ids(list)).toEqual(['a', 'b']);
      expect(Sortable.isDragging()).toBe(false);
    });
  });

  describe('목록 간 이동 (group)', () => {
    it('같은 group 이름이면 서로 이동하고 remove/add/sort/end 가 호출된다', () => {
      const a = makeList(['a1', 'a2'], 'a', 0, 0);
      const b = makeList(['b1', 'b2'], 'b', 300, 0);
      const calls: string[] = [];
      const rec = (name: string) => () => calls.push(name);
      make(a, {
        group: 'g',
        animation: 0,
        onRemove: rec('a-remove'),
        onSort: rec('a-sort'),
        onEnd: rec('a-end'),
        onAdd: rec('a-add'),
      });
      make(b, { group: 'g', animation: 0, onAdd: rec('b-add'), onSort: rec('b-sort') });
      drag(a, 0, 310, 10);
      expect(ids(a)).toEqual(['a2']);
      expect(ids(b)).toEqual(['a1', 'b1', 'b2']);
      expect(calls).toEqual(['a-remove', 'b-add', 'a-sort', 'b-sort', 'a-end']);
    });

    it('group 이 다르면 이동하지 않는다', () => {
      const a = makeList(['a1'], 'a', 0, 0);
      const b = makeList(['b1'], 'b', 300, 0);
      make(a, { group: 'x', animation: 0 });
      make(b, { group: 'y', animation: 0 });
      drag(a, 0, 310, 10);
      expect(ids(a)).toEqual(['a1']);
      expect(ids(b)).toEqual(['b1']);
    });

    it('group 이 없으면 서로 독립이다', () => {
      const a = makeList(['a1'], 'a', 0, 0);
      const b = makeList(['b1'], 'b', 300, 0);
      make(a, { animation: 0 });
      make(b, { animation: 0 });
      drag(a, 0, 310, 10);
      expect(ids(a)).toEqual(['a1']);
    });

    it('put: false 인 목록으로는 들어갈 수 없다', () => {
      const a = makeList(['a1'], 'a', 0, 0);
      const b = makeList(['b1'], 'b', 300, 0);
      make(a, { group: 'g', animation: 0 });
      make(b, { group: { name: 'g', put: false }, animation: 0 });
      drag(a, 0, 310, 10);
      expect(ids(b)).toEqual(['b1']);
    });

    it('pull: false 인 목록에서는 꺼낼 수 없다', () => {
      const a = makeList(['a1'], 'a', 0, 0);
      const b = makeList(['b1'], 'b', 300, 0);
      make(a, { group: { name: 'g', pull: false }, animation: 0 });
      make(b, { group: 'g', animation: 0 });
      drag(a, 0, 310, 10);
      expect(ids(a)).toEqual(['a1']);
    });

    it('put 에 출발 그룹 이름 배열을 지정하면 그 그룹만 받는다', () => {
      const a = makeList(['a1'], 'a', 0, 0);
      const c = makeList(['c1'], 'c', 0, 200);
      const b = makeList(['b1'], 'b', 300, 0);
      make(a, { group: 'ga', animation: 0 });
      make(c, { group: 'gc', animation: 0 });
      make(b, { group: { name: 'gb', put: ['ga'] }, animation: 0 });
      drag(a, 0, 310, 10);
      expect(ids(b)).toEqual(['a1', 'b1']);
      drag(c, 0, 310, 10);
      expect(ids(b)).toEqual(['a1', 'b1']);
      expect(ids(c)).toEqual(['c1']);
    });

    it('put 함수 결과를 따른다', () => {
      const a = makeList(['a1'], 'a', 0, 0);
      const b = makeList(['b1'], 'b', 300, 0);
      make(a, { group: 'g', animation: 0 });
      make(b, { group: { name: 'g', put: () => false }, animation: 0 });
      drag(a, 0, 310, 10);
      expect(ids(a)).toEqual(['a1']);
    });

    it('빈 목록으로도 이동한다', () => {
      const a = makeList(['a1', 'a2'], 'a', 0, 0);
      const b = makeList([], 'b', 300, 0);
      make(a, { group: 'g', animation: 0 });
      make(b, { group: 'g', animation: 0 });
      drag(a, 0, 310, 10);
      expect(ids(a)).toEqual(['a2']);
      expect(ids(b)).toEqual(['a1']);
    });

    it('sort: false 인 목록 안에서는 순서가 바뀌지 않는다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      make(list, { animation: 0, sort: false });
      drag(list, 0, 10, 2 * ITEM_H + 30);
      expect(ids(list)).toEqual(['a', 'b', 'c']);
    });

    it('sort: false 인 목록이라도 다른 목록의 항목은 맨 뒤로 받는다', () => {
      const a = makeList(['a1'], 'a', 0, 0);
      const b = makeList(['b1', 'b2'], 'b', 300, 0);
      make(a, { group: 'g', animation: 0 });
      make(b, { group: 'g', sort: false, animation: 0 });
      drag(a, 0, 310, 10);
      expect(ids(b)).toEqual(['b1', 'b2', 'a1']);
    });
  });

  describe('clone', () => {
    it('pull: clone 이면 원래 자리에 복제본이 남고 add 는 도착 목록에서만 호출된다', () => {
      const src = makeList(['k1', 'k2'], 'src', 0, 0);
      const dst = makeList(['d1'], 'dst', 300, 0);
      const onClone = jest.fn();
      const onAdd = jest.fn();
      make(src, { group: { name: 'c', pull: 'clone', put: false }, sort: false, animation: 0, onClone });
      make(dst, { group: { name: 'c', put: true }, animation: 0, onAdd });
      drag(src, 0, 310, 10);
      expect(ids(src)).toEqual(['k1', 'k2']);
      expect(ids(dst)).toEqual(['k1', 'd1']);
      expect(onClone).toHaveBeenCalledTimes(1);
      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(src.children[0]).not.toBe(dst.children[0]);
    });

    it('복제 드래그 중 출발 목록으로 되돌아오면 복제본이 사라진다', () => {
      const src = makeList(['k1', 'k2'], 'src', 0, 0);
      const dst = makeList(['d1'], 'dst', 300, 0);
      make(src, { group: { name: 'c', pull: 'clone', put: true }, animation: 0 });
      make(dst, { group: { name: 'c', put: true }, animation: 0 });
      pointer(src.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', 310, 10);
      expect(ids(src)).toEqual(['k1', 'k2']);
      expect(ids(dst)).toEqual(['k1', 'd1']);
      pointer(document, 'pointermove', 10, ITEM_H + 30);
      expect(ids(dst)).toEqual(['d1']);
      expect(src.querySelectorAll('[data-id="k1"]').length).toBe(1);
      pointer(document, 'pointerup', 10, ITEM_H + 30);
    });

    it('복제본에는 ghost/chosen 클래스가 남지 않는다', () => {
      const src = makeList(['k1'], 'src', 0, 0);
      const dst = makeList([], 'dst', 300, 0);
      make(src, { group: { name: 'c', pull: 'clone' }, animation: 0 });
      make(dst, { group: { name: 'c', put: true }, animation: 0 });
      drag(src, 0, 310, 10);
      expect(src.children[0].className).toBe('');
    });
  });

  describe('여러 줄(flex-wrap) 배치에서 빈 곳 위의 포인터', () => {
    /** 4열 x 2행 배치: 항목 100x40, 가로 간격 10, 세로 간격 10. 목록 영역은 (0,0)~(430,90) */
    function makeGrid(): HTMLElement {
      const list = document.createElement('div');
      list.id = 'grid';
      'abcdefgh'.split('').forEach((id, i) => {
        const el = document.createElement('div');
        el.dataset.id = id;
        const left = (i % 4) * 110;
        const top = Math.floor(i / 4) * 50;
        el.getBoundingClientRect = () =>
          ({ left, top, right: left + 100, bottom: top + 40, width: 100, height: 40, x: left, y: top } as DOMRect);
        list.appendChild(el);
      });
      list.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 430, bottom: 90, width: 430, height: 90, x: 0, y: 0 } as DOMRect);
      document.body.appendChild(list);
      // 항목이 아닌 빈 곳(목록 자신)이 포인터 아래에 있는 상황
      (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => list;
      return list;
    }
    const dragToPoint = (list: HTMLElement, index: number, x: number, y: number): void => {
      pointer(list.children[index], 'pointerdown', 10 + (index % 4) * 110, 10 + Math.floor(index / 4) * 50);
      pointer(document, 'pointermove', 20 + (index % 4) * 110, 20 + Math.floor(index / 4) * 50);
      pointer(document, 'pointermove', x, y);
    };

    it('첫 줄 위쪽 여백으로 올려도 같은 줄 이웃을 지나지 않으면 순서가 바뀌지 않는다 (맨 앞으로 튀지 않는다)', () => {
      const list = makeGrid();
      make(list, { animation: 0, direction: 'horizontal' });
      dragToPoint(list, 3, 385, -20); // d 의 열 위치에서 목록 위쪽 바깥
      expect(ids(list)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
      pointer(document, 'pointerup', 385, -20);
      expect(ids(list)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    });

    it('아래 줄 항목과 가로 위치가 겹쳐도 세로로 가깝다는 이유로 다른 줄로 이동하지 않는다', () => {
      const list = makeGrid();
      make(list, { animation: 0, direction: 'horizontal' });
      dragToPoint(list, 3, 385, 44); // 첫 줄과 둘째 줄 사이 틈, d 의 열 (아래에는 h 가 있다)
      expect(ids(list)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
      pointer(document, 'pointerup', 385, 44);
    });

    it('마지막 줄 아래로 내리면 맨 끝으로 이동한다', () => {
      const list = makeGrid();
      make(list, { animation: 0, direction: 'horizontal' });
      dragToPoint(list, 0, 400, 140);
      expect(ids(list)).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h', 'a']);
      pointer(document, 'pointerup', 400, 140);
    });
  });

  describe('containment (복제본 이동 범위 제한)', () => {
    /** 포인터를 따라다니는 복제본(홀더)의 현재 translate 좌표 */
    const mirrorPos = (): { x: number; y: number } => {
      const holder = (document.querySelector('.dsr-drag') as HTMLElement).parentElement as HTMLElement;
      const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(holder.style.transform);
      if (!m) throw new Error('transform 을 읽을 수 없습니다: ' + holder.style.transform);
      return { x: Number(m[1]), y: Number(m[2]) };
    };
    const rectOfBox = (left: number, top: number, right: number, bottom: number): DOMRect =>
      ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top } as DOMRect);

    it('기본값은 제한이 없어 복제본이 포인터를 그대로 따라간다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      make(list, { animation: 0 });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', 500, 700);
      expect(mirrorPos()).toEqual({ x: 500 - 10, y: 700 - 10 });
      pointer(document, 'pointerup', 500, 700);
    });

    it('true 면 복제본이 목록 영역 밖으로 나가지 않는다', () => {
      const list = makeList(['a', 'b', 'c'], 'l'); // 목록 영역: (0,0)~(200,120), 항목 200x40
      make(list, { animation: 0, containment: true });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', 900, 900); // 오른쪽 아래 멀리
      expect(mirrorPos()).toEqual({ x: 0, y: 80 }); // 항목 크기만큼 안쪽 (200-200, 120-40)
      pointer(document, 'pointermove', -500, -500); // 왼쪽 위 멀리
      expect(mirrorPos()).toEqual({ x: 0, y: 0 });
      pointer(document, 'pointerup', -500, -500);
    });

    it('범위 안에서는 포인터를 그대로 따라간다', () => {
      const list = makeList(['a', 'b', 'c', 'd', 'e'], 'l'); // 높이 200
      make(list, { animation: 0, containment: true });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', 60, 90);
      expect(mirrorPos()).toEqual({ x: 0, y: 80 }); // 가로는 항목 너비 = 목록 너비라 움직일 여유가 없고, 세로는 포인터를 따라간다
      pointer(document, 'pointerup', 60, 90);
    });

    it('포인터를 범위 밖으로 밀어도 목록의 마지막/처음 자리까지 갈 수 있다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      make(list, { animation: 0, containment: true });
      drag(list, 0, 10, 900); // 아래 멀리
      expect(ids(list)).toEqual(['b', 'c', 'a']);
      drag(list, 2, 10, -900); // 위 멀리
      expect(ids(list)).toEqual(['a', 'b', 'c']);
    });

    it('범위 밖의 다른 목록으로는 들어가지 않는다', () => {
      const a = makeList(['a1', 'a2'], 'a', 0, 0);
      const b = makeList(['b1'], 'b', 300, 0);
      make(a, { group: 'g', animation: 0, containment: true });
      make(b, { group: 'g', animation: 0 });
      drag(a, 0, 310, 10); // 포인터는 b 위지만 범위(a)로 맞춰져 a 안에서만 판정된다
      expect(ids(a)).toEqual(['a1', 'a2']);
      expect(ids(b)).toEqual(['b1']);
    });

    it('모든 목록을 포함하는 요소를 지정하면 목록 사이도 오갈 수 있고 그 밖으로는 나가지 않는다', () => {
      const wrapper = document.createElement('div');
      wrapper.id = 'zone';
      wrapper.getBoundingClientRect = () => rectOfBox(0, 0, 600, 200);
      document.body.appendChild(wrapper);
      const a = makeList(['a1'], 'a', 0, 0);
      const b = makeList(['b1'], 'b', 300, 0);
      wrapper.append(a, b);
      make(a, { group: 'g', animation: 0, containment: '#zone' });
      make(b, { group: 'g', animation: 0, containment: '#zone' });
      drag(a, 0, 310, 10);
      expect(ids(b)).toEqual(['a1', 'b1']);

      pointer(b.children[0], 'pointerdown', 310, 10);
      pointer(document, 'pointermove', 320, 20);
      pointer(document, 'pointermove', 5000, 5000);
      expect(mirrorPos().x).toBeLessThanOrEqual(600 - LIST_W);
      expect(mirrorPos().y).toBeLessThanOrEqual(200 - ITEM_H);
      pointer(document, 'pointerup', 5000, 5000);
    });

    it("'parent' 는 목록의 부모 요소를, HTMLElement 는 그 요소를 범위로 쓴다", () => {
      const parent = document.createElement('div');
      parent.getBoundingClientRect = () => rectOfBox(0, 0, 500, 300);
      document.body.appendChild(parent);
      const list = makeList(['a', 'b'], 'l');
      parent.appendChild(list);
      const s = make(list, { animation: 0, containment: 'parent' });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', 9000, 9000);
      expect(mirrorPos()).toEqual({ x: 500 - LIST_W, y: 300 - ITEM_H });
      pointer(document, 'pointerup', 9000, 9000);

      const box = document.createElement('div');
      box.getBoundingClientRect = () => rectOfBox(100, 100, 400, 400);
      document.body.appendChild(box);
      s.option('containment', box);
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', -50, -50);
      expect(mirrorPos()).toEqual({ x: 100, y: 100 });
      pointer(document, 'pointerup', -50, -50);
    });

    it('잘못된 selector 나 일치하는 요소가 없으면 제한하지 않는다', () => {
      const list = makeList(['a', 'b'], 'l');
      const s = make(list, { animation: 0, containment: '#nothing' });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', 800, 800);
      expect(mirrorPos()).toEqual({ x: 790, y: 790 });
      pointer(document, 'pointerup', 800, 800);

      s.option('containment', '###');
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      expect(() => pointer(document, 'pointermove', 800, 800)).not.toThrow();
      pointer(document, 'pointerup', 800, 800);
    });
  });

  describe('공개 API', () => {
    it('toArray 는 data-id 순서를 돌려주고 sort 로 재배치한다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      const s = make(list);
      expect(s.toArray()).toEqual(['a', 'b', 'c']);
      s.sort(['c', 'a', 'b']);
      expect(ids(list)).toEqual(['c', 'a', 'b']);
    });

    it('dataIdAttr 를 바꿀 수 있다', () => {
      const list = makeList(['a', 'b'], 'l');
      Array.from(list.children).forEach((c, i) => c.setAttribute('data-key', `k${i}`));
      expect(make(list, { dataIdAttr: 'data-key' }).toArray()).toEqual(['k0', 'k1']);
    });

    it('같은 요소에 두 번 적용하면 오류, destroy 후에는 다시 적용할 수 있다', () => {
      const list = makeList(['a'], 'l');
      const s = make(list);
      expect(() => createSortable(list)).toThrow();
      s.destroy();
      expect(list.classList.contains('dsr')).toBe(false);
      expect(Sortable.get(list)).toBeUndefined();
      expect(() => make(list)).not.toThrow();
    });

    it('destroy 후에는 드래그가 시작되지 않는다', () => {
      const list = makeList(['a', 'b'], 'l');
      const onStart = jest.fn();
      make(list, { onStart }).destroy();
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 30, 30);
      expect(onStart).not.toHaveBeenCalled();
    });

    it('드래그 중 destroy 하면 원래 자리로 되돌리고 정리한다', () => {
      const list = makeList(['a', 'b', 'c'], 'l');
      const s = make(list, { animation: 0 });
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      pointer(document, 'pointermove', 10, 2 * ITEM_H + 30);
      s.destroy();
      expect(ids(list)).toEqual(['a', 'b', 'c']);
      expect(document.querySelector('.dsr-drag')).toBeNull();
      expect(Sortable.isDragging()).toBe(false);
    });

    it('selector 문자열로 생성하고, 없으면 오류', () => {
      makeList(['a'], 'target');
      expect(() => make('#target')).not.toThrow();
      expect(() => createSortable('#nothing')).toThrow();
    });

    it('option() 으로 읽고 쓴다', () => {
      const list = makeList(['a'], 'l');
      const s = make(list);
      expect(s.option('animation')).toBe(150);
      s.option('animation', 0);
      expect(s.option('animation')).toBe(0);
    });
  });

  describe('중첩 목록', () => {
    it('안쪽 목록의 항목을 잡으면 안쪽만 시작한다', () => {
      const outer = makeList(['o1', 'o2'], 'outer', 0, 0);
      const inner = document.createElement('div');
      inner.id = 'inner';
      inner.appendChild(document.createElement('div'));
      outer.children[0].appendChild(inner);
      const onOuter = jest.fn();
      const onInner = jest.fn();
      make(outer, { animation: 0, onStart: onOuter });
      make(inner, { animation: 0, onStart: onInner });
      pointer(inner.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 30, 30);
      expect(onInner).toHaveBeenCalledTimes(1);
      expect(onOuter).not.toHaveBeenCalled();
      pointer(document, 'pointerup', 30, 30);
    });
  });
});
