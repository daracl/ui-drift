import { createDriftEditor, DriftEditor } from '@/index';
import { resolveScrollTarget } from '@/drift/editor/scrollContainer';

/** jsdom 은 레이아웃이 없으므로 스크롤 영역의 크기/위치를 직접 지정한다 */
function makeScroller(cls: string, rect = { top: 0, bottom: 300 }, scrollHeight = 1000): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'clientHeight', { value: rect.bottom - rect.top, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  el.getBoundingClientRect = () =>
    ({ ...rect, left: 0, right: 800, width: 800, height: rect.bottom - rect.top } as DOMRect);
  document.body.appendChild(el);
  return el;
}

describe('resolveScrollTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('옵션을 생략하면 스크롤 가능한 가장 가까운 조상을 찾고, 없으면 window 를 쓴다', () => {
    const outer = makeScroller('outer', { top: 0, bottom: 400 });
    const mid = document.createElement('div');
    const editorEl = document.createElement('div');
    mid.appendChild(editorEl);
    outer.appendChild(mid);
    expect(resolveScrollTarget(editorEl).element).toBe(outer);

    const plain = document.createElement('div');
    document.body.appendChild(plain);
    const t = resolveScrollTarget(plain);
    expect(t.element).toBeUndefined();
    expect(t.top).toBe(0);
    expect(t.bottom).toBe(window.innerHeight);
  });

  it('내용이 넘치지 않는 overflow:auto 조상은 건너뛴다', () => {
    const outer = makeScroller('outer');
    const fits = makeScroller('fits', { top: 0, bottom: 300 }, 300);
    outer.appendChild(fits);
    const editorEl = document.createElement('div');
    fits.appendChild(editorEl);
    expect(resolveScrollTarget(editorEl).element).toBe(outer);
  });

  it('문자열은 컨테이너 자신을 포함해 closest 로 찾는다', () => {
    const canvas = makeScroller('drs-canvas');
    const page = document.createElement('div');
    const grid = document.createElement('div');
    grid.className = 'drs-grid';
    page.appendChild(grid);
    canvas.appendChild(page);
    expect(resolveScrollTarget(grid, '.drs-canvas').element).toBe(canvas);
    expect(resolveScrollTarget(grid, '.drs-grid').element).toBe(grid); // 자기 자신 포함
  });

  it('문자열은 전역 document 가 아니라 컨테이너의 조상에서만 찾는다', () => {
    const a = makeScroller('drs-canvas', { top: 0, bottom: 300 });
    const b = makeScroller('drs-canvas', { top: 0, bottom: 300 });
    const gridA = document.createElement('div');
    const gridB = document.createElement('div');
    a.appendChild(gridA);
    b.appendChild(gridB);
    expect(resolveScrollTarget(gridA, '.drs-canvas').element).toBe(a);
    expect(resolveScrollTarget(gridB, '.drs-canvas').element).toBe(b);
  });

  it('일치하는 요소가 없거나 잘못된 selector 면 자동 탐색으로 처리한다', () => {
    const outer = makeScroller('outer');
    const editorEl = document.createElement('div');
    outer.appendChild(editorEl);
    expect(resolveScrollTarget(editorEl, '.nothing').element).toBe(outer);
    expect(resolveScrollTarget(editorEl, '!!bad[').element).toBe(outer);
  });

  it('HTMLElement 를 직접 지정할 수 있다', () => {
    const other = makeScroller('other');
    const editorEl = document.createElement('div');
    document.body.appendChild(editorEl);
    expect(resolveScrollTarget(editorEl, other).element).toBe(other);
  });

  it('가시 영역은 대상과 viewport 가 겹치는 부분이다', () => {
    const el = makeScroller('c', { top: -200, bottom: window.innerHeight + 500 });
    const editorEl = document.createElement('div');
    el.appendChild(editorEl);
    const t = resolveScrollTarget(editorEl, el);
    expect(t.top).toBe(0);
    expect(t.bottom).toBe(window.innerHeight);
  });
});

describe('scrollContainer 자동 스크롤', () => {
  const editors: DriftEditor[] = [];
  let queue: FrameRequestCallback[];
  let rectSpy: jest.SpyInstance;
  let rafSpy: jest.SpyInstance;
  let cafSpy: jest.SpyInstance;

  const setup = (scroller: HTMLElement, options = {}) => {
    const grid = document.createElement('div');
    scroller.appendChild(grid);
    const editor = createDriftEditor(grid, {
      layout: { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 4, h: 2 }] },
      ...options,
    });
    editors.push(editor);
    return { grid, editor };
  };
  const pointer = (target: Element, type: string, x: number, y: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    target.dispatchEvent(e);
  };
  const flush = () => queue.splice(0).forEach((cb) => cb(0));

  beforeEach(() => {
    queue = [];
    rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => queue.push(cb));
    cafSpy = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const orig = Element.prototype.getBoundingClientRect;
    rectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.classList.contains('daracl-drift'))
        return { left: 0, top: 0, width: 1200, height: 1000, right: 1200, bottom: 1000 } as DOMRect;
      if (el.dataset?.driftId) return { left: 0, top: 0, width: 300, height: 90, right: 300, bottom: 90 } as DOMRect;
      return orig.call(el);
    });
  });
  afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy());
    document.body.innerHTML = '';
    rectSpy.mockRestore();
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  it('지정한 selector 의 조상만 스크롤되고, 같은 화면의 다른 편집기 영역은 영향이 없다', () => {
    const a = makeScroller('drs-canvas');
    const b = makeScroller('drs-canvas');
    const { grid } = setup(a, { scrollContainer: '.drs-canvas' });
    setup(b, { scrollContainer: '.drs-canvas' });
    const item = grid.querySelector('[data-drift-id="a"]') as HTMLElement;

    pointer(item, 'pointerdown', 10, 10);
    pointer(item, 'pointermove', 20, 295); // 가시 영역(0~300) 하단 48px 이내
    flush();
    expect(a.scrollTop).toBeGreaterThan(0);
    expect(b.scrollTop).toBe(0);
    pointer(item, 'pointerup', 20, 295);
  });

  it('스크롤 후 placeholder 위치를 다시 계산하고, 종료하면 requestAnimationFrame 을 취소한다', () => {
    const a = makeScroller('drs-canvas');
    const { grid } = setup(a, { scrollContainer: '.drs-canvas' });
    const item = grid.querySelector('[data-drift-id="a"]') as HTMLElement;

    pointer(item, 'pointerdown', 10, 10);
    pointer(item, 'pointermove', 20, 295);
    flush();
    expect(a.scrollTop).toBe(7); // 가장자리에 가까울수록 빠르다 (최대 8px/프레임)
    expect(queue.length).toBe(1); // 다음 프레임이 예약되어 있다

    pointer(item, 'pointerup', 20, 295);
    expect(cafSpy).toHaveBeenCalled();
    flush();
    expect(a.scrollTop).toBe(7); // 종료 후에는 더 스크롤되지 않는다
  });

  it('destroy 하면 진행 중인 자동 스크롤을 정리한다', () => {
    const a = makeScroller('drs-canvas');
    const { grid, editor } = setup(a, { scrollContainer: a });
    const item = grid.querySelector('[data-drift-id="a"]') as HTMLElement;

    pointer(item, 'pointerdown', 10, 10);
    pointer(item, 'pointermove', 20, 295);
    editor.destroy();
    expect(cafSpy).toHaveBeenCalled();
    flush();
    expect(a.scrollTop).toBe(0);
  });

  it('옵션 selector 가 일치하지 않으면 자동 탐색한 조상을 스크롤한다', () => {
    const a = makeScroller('wrap');
    const { grid } = setup(a, { scrollContainer: '.nothing' });
    const item = grid.querySelector('[data-drift-id="a"]') as HTMLElement;

    pointer(item, 'pointerdown', 10, 10);
    pointer(item, 'pointermove', 20, 295);
    flush();
    expect(a.scrollTop).toBeGreaterThan(0);
    pointer(item, 'pointerup', 20, 295);
  });

  it('스크롤 영역이 없으면 window 를 스크롤한다', () => {
    const wrap = document.createElement('div');
    document.body.appendChild(wrap);
    const { grid } = setup(wrap);
    const item = grid.querySelector('[data-drift-id="a"]') as HTMLElement;
    const scrollBy = jest.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

    pointer(item, 'pointerdown', 10, 10);
    pointer(item, 'pointermove', 20, window.innerHeight - 10);
    flush();
    expect(scrollBy).toHaveBeenCalledWith(0, expect.any(Number));
    pointer(item, 'pointerup', 20, window.innerHeight - 10);
    scrollBy.mockRestore();
  });
});
