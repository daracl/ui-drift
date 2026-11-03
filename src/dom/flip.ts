/** FLIP 애니메이션: DOM 이 바뀌기 전/후의 위치 차이를 transform 전환으로 부드럽게 메운다 */

const timers = new WeakMap<HTMLElement, number>();

/** 각 목록의 자식 요소들의 현재 화면 위치를 기록한다 (진행 중인 transform 도 포함된 '눈에 보이는' 위치) */
export function snapshotRects(lists: Iterable<Element>): Map<HTMLElement, DOMRect> {
  const rects = new Map<HTMLElement, DOMRect>();
  for (const list of lists) {
    for (const child of Array.from(list.children)) {
      if (child instanceof HTMLElement) rects.set(child, child.getBoundingClientRect());
    }
  }
  return rects;
}

/** snapshotRects 이후 DOM 이 바뀐 결과로 움직인 요소들을 이전 위치에서 현재 위치로 애니메이션한다 */
export function playFlip(before: Map<HTMLElement, DOMRect>, duration: number, easing: string): void {
  if (!(duration > 0)) return;

  // 진행 중이던 전환의 transform 이 새 위치 측정에 섞이지 않게 먼저 걷어낸다
  before.forEach((_, el) => {
    el.style.transition = 'none';
    el.style.transform = '';
  });

  const moved: Array<{ el: HTMLElement; dx: number; dy: number }> = [];
  before.forEach((prev, el) => {
    if (!el.isConnected) return;
    const now = el.getBoundingClientRect();
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      el.style.transition = '';
      return;
    }
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    moved.push({ el, dx, dy });
  });
  if (!moved.length) return;

  void moved[0].el.offsetWidth; // 강제 reflow: 시작 transform 을 확정한 뒤 전환을 건다
  moved.forEach(({ el }) => {
    el.style.transition = `transform ${duration}ms ${easing}`;
    el.style.transform = '';
    window.clearTimeout(timers.get(el));
    timers.set(
      el,
      window.setTimeout(() => {
        el.style.transition = '';
        timers.delete(el);
      }, duration + 30),
    );
  });
}
