import { createSortable, Sortable } from '@/sortable';
import { ids, ITEM_H, makeList, mockLayout, pointer } from './_helpers';

/** 큰 목록에서 비용이 항목 수에 비례해 늘지 않도록 한 최적화를 고정하는 테스트 */
describe('Sortable 성능 최적화', () => {
  let restore: () => void;
  let created: Sortable[] = [];
  const make = (...args: Parameters<typeof createSortable>): Sortable => {
    const s = createSortable(...args);
    created.push(s);
    return s;
  };

  /** 항목마다 getBoundingClientRect 호출을 기록한다 */
  const trackMeasured = (elements: Element[]): Set<string> => {
    const measured = new Set<string>();
    elements.forEach((child) => {
      const original = child.getBoundingClientRect.bind(child);
      child.getBoundingClientRect = () => {
        measured.add((child as HTMLElement).dataset.id || '');
        return original();
      };
    });
    return measured;
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

  it('자리를 바꿀 때 실제로 움직이는 구간의 항목만 측정한다 (앞뒤의 나머지는 건드리지 않는다)', () => {
    const list = makeList(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'l');
    const measured = trackMeasured(Array.from(list.children));
    make(list, { animation: 150 });
    pointer(list.children[2], 'pointerdown', 10, 2 * ITEM_H + 10);
    pointer(document, 'pointermove', 15, 2 * ITEM_H + 15); // 드래그 시작
    measured.clear();
    pointer(document, 'pointermove', 10, 3 * ITEM_H + 30); // c 가 d 뒤로
    expect(ids(list)).toEqual(['a', 'b', 'd', 'c', 'e', 'f', 'g', 'h']);
    expect(measured.has('c')).toBe(true);
    expect(measured.has('d')).toBe(true);
    ['a', 'b', 'e', 'f', 'g', 'h'].forEach((id) => expect(measured.has(id)).toBe(false));
    pointer(document, 'pointerup', 10, 3 * ITEM_H + 30);
  });

  it('다른 목록으로 옮길 때는 출발 목록의 뒤쪽과 도착 목록의 삽입 지점 이후만 측정한다', () => {
    const a = makeList(['a1', 'a2', 'a3', 'a4'], 'a', 0, 0);
    const b = makeList(['b1', 'b2', 'b3', 'b4'], 'b', 300, 0);
    const measured = trackMeasured([...Array.from(a.children), ...Array.from(b.children)]);
    make(a, { group: 'g', animation: 150 });
    make(b, { group: 'g', animation: 150 });
    pointer(a.children[1], 'pointerdown', 10, ITEM_H + 10);
    pointer(document, 'pointermove', 15, ITEM_H + 15);
    measured.clear();
    pointer(document, 'pointermove', 310, 2 * ITEM_H + 5); // b3 의 앞쪽 절반 → b3 앞에 삽입
    expect(ids(b)).toEqual(['b1', 'b2', 'a2', 'b3', 'b4']);
    ['a2', 'a3', 'a4', 'b3', 'b4'].forEach((id) => expect(measured.has(id)).toBe(true));
    ['a1', 'b1', 'b2'].forEach((id) => expect(measured.has(id)).toBe(false));
    pointer(document, 'pointerup', 310, 2 * ITEM_H + 5);
  });

  it('항목 사이에 텍스트 노드가 있어도 움직이는 구간만 측정한다', () => {
    const list = makeList(['a', 'b', 'c', 'd', 'e', 'f'], 'l');
    Array.from(list.children).forEach((c) => c.after(document.createTextNode('\n')));
    const measured = trackMeasured(Array.from(list.children));
    make(list, { animation: 150 });
    pointer(list.children[1], 'pointerdown', 10, ITEM_H + 10);
    pointer(document, 'pointermove', 15, ITEM_H + 15);
    measured.clear();
    pointer(document, 'pointermove', 10, 2 * ITEM_H + 30); // b 가 c 뒤로
    expect(ids(list)).toEqual(['a', 'c', 'b', 'd', 'e', 'f']);
    ['a', 'd', 'e', 'f'].forEach((id) => expect(measured.has(id)).toBe(false));
    pointer(document, 'pointerup', 10, 2 * ITEM_H + 30);
  });

  it('mirror: box 이면 복제본에 내용이 없다', () => {
    const list = makeList(['a', 'b'], 'l');
    list.children[0].innerHTML = '<span>무거운 내용</span><iframe></iframe>';
    make(list, { animation: 0, mirror: 'box' });
    pointer(list.children[0], 'pointerdown', 10, 10);
    pointer(document, 'pointermove', 30, 30);
    const drag = document.querySelector('.dsr-drag') as HTMLElement;
    expect(drag.childNodes).toHaveLength(0);
    pointer(document, 'pointerup', 30, 30);
  });

  it('기본 복제본은 iframe 을 빈 상자로 바꿔 body 에 붙어도 다시 로드되지 않는다', () => {
    const list = makeList(['a', 'b'], 'l');
    list.children[0].innerHTML = '<iframe src="about:blank"></iframe>';
    make(list, { animation: 0 });
    pointer(list.children[0], 'pointerdown', 10, 10);
    pointer(document, 'pointermove', 30, 30);
    const drag = document.querySelector('.dsr-drag') as HTMLElement;
    expect(drag.querySelector('iframe')).toBeNull();
    expect(list.querySelector('iframe')).not.toBeNull(); // 원본은 그대로
    pointer(document, 'pointerup', 30, 30);
  });

  it('handle 이 있는 목록에 항목이 새로 들어오면 그 항목의 handle 만 표시한다', async () => {
    const list = makeList(['a'], 'l');
    list.children[0].innerHTML = '<i class="grip">⠿</i>';
    make(list, { handle: '.grip' });
    const added = document.createElement('div');
    added.innerHTML = '<i class="grip">⠿</i>';
    list.appendChild(added);
    await Promise.resolve(); // MutationObserver 는 마이크로태스크로 호출된다
    expect((added.querySelector('.grip') as Element).classList.contains('dsr-handle')).toBe(true);
  });

  it('delay 가 있으면 새 항목의 handle 에 touch-action 용 클래스를 붙이지 않는다', async () => {
    const list = makeList(['a'], 'l');
    make(list, { handle: '.grip', delay: 100 });
    const added = document.createElement('div');
    added.innerHTML = '<i class="grip">⠿</i>';
    list.appendChild(added);
    await Promise.resolve();
    expect((added.querySelector('.grip') as Element).classList.contains('dsr-handle')).toBe(false);
  });

  it.each([100, 1000, 3000])(
    '자리 판정의 좌표 읽기 (n=%i): 항목 위에서는 항목 수와 무관, 항목이 아닌 곳에서는 nearestItem 이 전체 항목을 읽는다 (O(n))',
    (n) => {
      const list = makeList(
        Array.from({ length: n }, (_, i) => `i${i}`),
        'l',
      );
      Array.from(list.children).forEach((c) => c.classList.add('it'));
      const foot = document.createElement('div'); // draggable 이 아닌 고정 자식 (빈 공간 역할)
      list.appendChild(foot);
      // onMove false: 삽입(FLIP 측정은 이동 구간 크기에 비례)을 빼고 자리 판정만 센다
      make(list, { animation: 0, draggable: '.it', onMove: () => false });
      // 공용 mockLayout 은 rect 마다 형제를 다시 훑어(O(n²)) 큰 n 에서 느리다. 시작 시 순서로 고정한 가벼운 레이아웃을 쓴다
      // (읽기 '횟수' 만 세므로 드래그 중 순서 변화는 영향이 없다)
      const index = new Map(Array.from(list.children, (c, i) => [c, i]));
      const box = (top: number, h: number) =>
        ({ left: 0, top, right: 200, bottom: top + h, width: 200, height: h, x: 0, y: top } as DOMRect);
      const rects = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const i = index.get(this);
        return i === undefined ? box(0, (n + 1) * ITEM_H) : box(i * ITEM_H, ITEM_H);
      });
      const doc = document as unknown as { elementFromPoint: (x: number, y: number) => Element | null };
      doc.elementFromPoint = (_x, y) => list.children[Math.floor(y / ITEM_H)] ?? list;
      const reads = (fn: () => void) => {
        const before = rects.mock.calls.length;
        fn();
        return rects.mock.calls.length - before;
      };
      pointer(list.children[0], 'pointerdown', 10, 10);
      pointer(document, 'pointermove', 15, 15);
      // 같은 항목(i5) 위에서 기준선을 넘지 않는 이동: 대상 항목과 끄는 항목만 읽는다
      const overItem = reads(() => pointer(document, 'pointermove', 10, 5 * ITEM_H + 5));
      // 고정 자식(foot) 위: 가장 가까운 항목을 찾으려고 끄는 항목을 뺀 모든 항목을 읽는다
      const overEmpty = reads(() => pointer(document, 'pointermove', 10, n * ITEM_H + 5));
      pointer(document, 'pointerup', 10, n * ITEM_H + 5);
      expect(overItem).toBeLessThanOrEqual(4);
      expect(overEmpty).toBeGreaterThanOrEqual(n - 1);
      expect(overEmpty).toBeLessThanOrEqual(n + 4);
    },
  );

  it('배치 방향은 드래그마다 한 번만 판정한다 (이동마다 getComputedStyle 을 부르지 않는다)', () => {
    const list = makeList(['a', 'b', 'c', 'd'], 'l');
    make(list, { animation: 0 });
    const spy = jest.spyOn(window, 'getComputedStyle');
    pointer(list.children[0], 'pointerdown', 10, 10);
    pointer(document, 'pointermove', 15, 15);
    pointer(document, 'pointermove', 10, ITEM_H + 5); // 방향을 처음 판정한다
    const before = spy.mock.calls.length;
    for (let i = 0; i < 20; i++) pointer(document, 'pointermove', 10, ITEM_H + 5 + (i % 2)); // 같은 항목 위에서 계속 이동
    const after = spy.mock.calls.length;
    pointer(document, 'pointerup', 10, 10);
    spy.mockRestore();
    expect(after - before).toBe(0);
  });
});
