/** 에디터 jsdom 테스트 공용 도구. jsdom 에는 레이아웃이 없으므로 요소 위치를 data 속성/인라인 값으로부터 환산해 모킹한다 */
export const CANVAS_WIDTH = 1200;
export const CELL = (CANVAS_WIDTH - 8 * 11) / 12;
export const STRIDE_X = CELL + 8;
export const STRIDE_Y = 48;

export function mockRects(): jest.SpyInstance {
  return jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.classList.contains('daracl-drift')) {
      return { left: 0, top: 0, width: CANVAS_WIDTH, height: 1000, right: CANVAS_WIDTH, bottom: 1000 } as DOMRect;
    }
    const d = el.dataset;
    const x = Number(d.x ?? 0);
    const y = Number(d.y ?? 0);
    const w = Number(d.w ?? 0);
    const h = Number(d.h ?? 0);
    const left = el.style.left ? parseFloat(el.style.left) : x * STRIDE_X;
    const top = el.style.top ? parseFloat(el.style.top) : y * STRIDE_Y;
    const width = el.style.width ? parseFloat(el.style.width) : w * CELL + (w - 1) * 8;
    const height = el.style.height ? parseFloat(el.style.height) : h * 40 + (h - 1) * 8;
    return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
  });
}

export function pointer(target: Element | Document, type: string, x: number, y: number, pointerType = 'mouse'): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

/** 실제 requestAnimationFrame 을 n 번 기다린다 (크기 알림 같은 프레임 단위 작업을 비우기 위해) */
export function frames(n = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => requestAnimationFrame(() => (left <= 1 ? resolve() : step(left - 1)));
    step(n);
  });
}

/** 항목 카드의 핸들을 잡아 (toX, toY) 칸으로 끌어 놓는다 (현재 cell 좌표 기준) */
export function dragHandle(
  container: HTMLElement,
  id: string,
  from: { x: number; y: number },
  toX: number,
  toY: number,
  type = 'mouse',
): void {
  const el = container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
  const handle = el.querySelector('.ddr-handle') as HTMLElement;
  const sx = from.x * STRIDE_X + 10;
  const sy = from.y * STRIDE_Y + 10;
  const ex = sx + (toX - from.x) * STRIDE_X;
  const ey = sy + (toY - from.y) * STRIDE_Y;
  pointer(handle, 'pointerdown', sx, sy, type);
  pointer(handle, 'pointermove', sx + 8, sy + 8, type);
  pointer(handle, 'pointermove', ex, ey, type);
  pointer(handle, 'pointerup', ex, ey, type);
}
