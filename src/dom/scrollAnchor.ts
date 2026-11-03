/**
 * 스크롤 앵커링(overflow-anchor) 해제.
 * 브라우저는 스크롤 영역 안의 요소가 옮겨지면 보고 있던 위치가 유지되도록 scrollTop 을 자동 보정한다.
 * 드래그로 항목의 자리를 바꿀 때 이 보정이 자동 스크롤과 겹치면 항목 높이만큼 스크롤이 튀어 위아래로 흔들린다.
 * 그래서 드래그 동안만 start 요소부터 최상위까지 앵커링을 끄고, 끝나면 원래 값으로 되돌린다.
 */
export type ScrollAnchorHold = Map<HTMLElement, string>;

/** start 와 그 조상들의 overflow-anchor 를 none 으로 바꾼다. 이미 처리한 조상을 만나면 그 위는 건너뛴다 */
export function disableScrollAnchoring(start: Element | null, held: ScrollAnchorHold): void {
  for (let el = start; el instanceof HTMLElement; el = el.parentElement) {
    if (held.has(el)) return; // 이 요소를 처리했다면 조상도 이미 처리된 것이다
    held.set(el, el.style.overflowAnchor || ''); // 지원하지 않는 환경(jsdom, Safari)에서는 undefined 일 수 있다
    el.style.overflowAnchor = 'none';
  }
}

export function restoreScrollAnchoring(held: ScrollAnchorHold): void {
  held.forEach((value, el) => {
    el.style.overflowAnchor = value;
  });
  held.clear();
}
