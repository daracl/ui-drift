/** Sortable jsdom 테스트 공용 도구. jsdom 에는 레이아웃이 없으므로 목록 항목을 세로로 쌓은 것처럼 위치를 모킹한다 */
export const ITEM_H = 40;
export const LIST_W = 200;

export function makeItem(id: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.id = id;
  el.textContent = id;
  return el;
}

/** 목록 하나 만들기. 각 항목은 data-id 를 갖고, 목록은 (left, top) 에서 세로로 항목을 쌓는다 */
export function makeList(itemIds: string[], id: string, left = 0, top = 0): HTMLElement {
  const list = document.createElement('div');
  list.id = id;
  list.dataset.left = String(left);
  list.dataset.top = String(top);
  itemIds.forEach((i) => list.appendChild(makeItem(i)));
  document.body.appendChild(list);
  return list;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top } as DOMRect;
}

function rectOf(el: Element): DOMRect {
  const parent = el.parentElement;
  if (parent && parent.dataset.left !== undefined) {
    const index = Array.from(parent.children).indexOf(el);
    return rect(Number(parent.dataset.left), Number(parent.dataset.top) + index * ITEM_H, LIST_W, ITEM_H);
  }
  const own = el as HTMLElement;
  if (own.dataset && own.dataset.left !== undefined) {
    return rect(Number(own.dataset.left), Number(own.dataset.top), LIST_W, Math.max(own.children.length, 1) * ITEM_H);
  }
  return rect(0, 0, 0, 0);
}

/** 현재 DOM 순서를 기준으로 rect 를 계산해 getBoundingClientRect 와 elementFromPoint 를 모킹한다 */
export function mockLayout(): () => void {
  const spy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(this);
  });
  const doc = document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null };
  doc.elementFromPoint = (x, y) => {
    for (const list of Array.from(document.querySelectorAll<HTMLElement>('[data-left]'))) {
      const lr = rectOf(list);
      if (x < lr.left || x >= lr.right || y < lr.top || y >= lr.bottom) continue;
      const child = Array.from(list.children).find((c) => {
        const r = rectOf(c);
        return y >= r.top && y < r.bottom;
      });
      return child || list;
    }
    return document.body;
  };
  return () => {
    spy.mockRestore();
    delete doc.elementFromPoint;
  };
}

export function pointer(
  target: Element | Document,
  type: string,
  x: number,
  y: number,
  pointerType = 'mouse',
  button = 0,
): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'isPrimary', { value: true });
  target.dispatchEvent(e);
}

/** 목록의 index 번째 항목을 잡아 (toX, toY) 로 끌어 놓는다 */
export function drag(list: HTMLElement, index: number, toX: number, toY: number): void {
  const left = Number(list.dataset.left);
  const sx = left + 10;
  const sy = Number(list.dataset.top) + index * ITEM_H + 10;
  pointer(list.children[index], 'pointerdown', sx, sy);
  pointer(document, 'pointermove', sx + 5, sy + 5);
  pointer(document, 'pointermove', toX, toY);
  pointer(document, 'pointerup', toX, toY);
}

export const ids = (list: HTMLElement): string[] =>
  Array.from(list.children).map((c) => (c as HTMLElement).dataset.id || '');
