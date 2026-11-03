import { AutoScroller } from '@/dom/autoScroll';

/** jsdom 은 레이아웃/스크롤이 없으므로 스크롤 영역의 크기와 scrollTop 을 직접 만든다 */
function makeScroller(): { el: HTMLElement; top: () => number } {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  let scrollTop = 0;
  Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => (scrollTop = v),
    configurable: true,
  });
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0 } as DOMRect);
  document.body.appendChild(el);
  return { el, top: () => scrollTop };
}

describe('AutoScroller 스크롤 조상 캐시', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('프레임마다 getComputedStyle 을 다시 부르지 않고 일정 간격으로만 갱신한다', () => {
    const { el } = makeScroller();
    const scroller = new AutoScroller({ sensitivity: 30, speed: 360 });
    const spy = jest.spyOn(window, 'getComputedStyle');
    scroller.step(el, 100, 299, 1000);
    const first = spy.mock.calls.length;
    expect(first).toBeGreaterThan(0); // 처음에는 조사한다
    for (let i = 1; i <= 10; i++) scroller.step(el, 100, 299, 1000 + i * 16);
    expect(spy.mock.calls.length).toBe(first); // 300ms 안에서는 캐시를 쓴다
    scroller.step(el, 100, 299, 1000 + 400);
    expect(spy.mock.calls.length).toBeGreaterThan(first); // 간격이 지나면 다시 조사한다
    spy.mockRestore();
  });

  it('출발 요소가 바뀌면 바로 다시 조사한다', () => {
    const a = makeScroller();
    const b = makeScroller();
    const scroller = new AutoScroller({ sensitivity: 30, speed: 360 });
    scroller.step(a.el, 100, 299, 1000);
    const spy = jest.spyOn(window, 'getComputedStyle');
    scroller.step(b.el, 100, 299, 1016);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    spy.mockRestore();
    expect(b.top()).toBeGreaterThan(0); // 새 요소가 실제로 스크롤된다
  });

  it('reset 하면 다음 프레임에 다시 조사한다', () => {
    const { el } = makeScroller();
    const scroller = new AutoScroller({ sensitivity: 30, speed: 360 });
    scroller.step(el, 100, 299, 1000);
    scroller.reset();
    const spy = jest.spyOn(window, 'getComputedStyle');
    scroller.step(el, 100, 299, 1016);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
