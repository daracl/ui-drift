import { AutoScroller } from '@/dom/autoScroll';

/** jsdom 은 레이아웃/스크롤이 없으므로 스크롤 영역의 크기와 scrollTop 을 직접 만든다 */
function makeScroller(scrollHeight = 5000, height = 300): { el: HTMLElement; top: () => number } {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  let scrollTop = 0;
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => (scrollTop = v),
    configurable: true,
  });
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 400, bottom: height, width: 400, height, x: 0, y: 0 } as DOMRect);
  document.body.appendChild(el);
  return { el, top: () => scrollTop };
}

/** 주사율 fps 로 seconds 초 동안 가장자리(y)에 머문 뒤의 scrollTop */
function scrollFor(fps: number, seconds: number, y: number, options = { sensitivity: 30, speed: 360 }): number {
  const { el, top } = makeScroller();
  const scroller = new AutoScroller(options);
  const frame = 1000 / fps;
  for (let t = 0, i = 0; t <= seconds * 1000; t += frame, i++) scroller.step(el, 100, y, 1000 + i * frame);
  return top();
}

describe('AutoScroller', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('주사율이 달라도 같은 시간에 같은 거리를 스크롤한다 (60Hz / 144Hz)', () => {
    const at60 = scrollFor(60, 1, 299);
    const at144 = scrollFor(144, 1, 299);
    expect(Math.abs(at60 - at144)).toBeLessThanOrEqual(8);
    expect(at60).toBeGreaterThan(330);
    expect(at60).toBeLessThan(380); // 최대 속도 360px/초
  });

  it('가장자리에서 멀수록 천천히 움직인다', () => {
    const edge = scrollFor(60, 1, 299);
    const inner = scrollFor(60, 1, 300 - 20); // 영역 안쪽 경계에 가까움
    const outside = scrollFor(60, 1, 150); // 가장자리 영역 밖
    expect(outside).toBe(0);
    expect(inner).toBeGreaterThan(0);
    expect(inner).toBeLessThan(edge / 2);
  });

  it('위쪽 가장자리에서는 반대 방향으로 움직인다', () => {
    const { el, top } = makeScroller();
    el.scrollTop = 1000;
    const scroller = new AutoScroller({ sensitivity: 30, speed: 360 });
    for (let i = 0; i < 30; i++) scroller.step(el, 100, 1, 1000 + i * 16);
    expect(top()).toBeLessThan(1000);
  });

  it('프레임당 1px 미만인 느린 속도도 누적되어 결국 스크롤된다', () => {
    const { el, top } = makeScroller();
    const scroller = new AutoScroller({ sensitivity: 30, speed: 30 }); // 30px/초 = 60Hz 에서 프레임당 0.5px
    for (let i = 0; i < 60; i++) scroller.step(el, 100, 299, 1000 + i * (1000 / 60));
    expect(top()).toBeGreaterThan(20);
  });

  it('프레임이 오래 멈췄다 재개되어도 한 번에 크게 튀지 않는다', () => {
    const { el, top } = makeScroller();
    const scroller = new AutoScroller({ sensitivity: 30, speed: 360 });
    scroller.step(el, 100, 299, 1000);
    const before = top();
    scroller.step(el, 100, 299, 6000); // 5초 정지 후 재개
    expect(top() - before).toBeLessThanOrEqual(Math.ceil((360 * 50) / 1000));
  });

  it('끝까지 스크롤하면 더 움직이지 않고 false 를 돌려준다', () => {
    const { el } = makeScroller(400, 300); // 최대 스크롤 100px
    const scroller = new AutoScroller({ sensitivity: 30, speed: 360 });
    let moved = true;
    for (let i = 0; i < 120; i++) moved = scroller.step(el, 100, 299, 1000 + i * 16);
    expect(el.scrollTop).toBeLessThanOrEqual(400 - 300 + 6);
    expect(moved).toBe(false);
  });
});
