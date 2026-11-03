import { isString } from '@daracl/core/utils';

/** 스크롤 영역 해석 결과. element 가 없으면 window(페이지)를 스크롤한다 */
export interface ScrollTarget {
  element?: HTMLElement;
  /** 대상의 가시 영역(대상과 브라우저 viewport 가 겹치는 부분)의 상단/하단 (viewport 좌표) */
  top: number;
  bottom: number;
}

const isPageRoot = (el: Element): boolean => el === document.body || el === document.documentElement;

/** 세로로 스크롤되는 상태(overflow auto/scroll 이고 내용이 넘침)인지 */
function isScrollable(el: HTMLElement): boolean {
  const overflow = getComputedStyle(el).overflowY;
  return (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && el.scrollHeight > el.clientHeight;
}

/** 편집기 컨테이너부터 위로 올라가며 지금 스크롤되는 첫 조상을 찾는다 */
function findScrollParent(start: HTMLElement): HTMLElement | undefined {
  for (let el: HTMLElement | null = start; el && !isPageRoot(el); el = el.parentElement) {
    if (isScrollable(el)) return el;
  }
  return undefined;
}

/**
 * 자동 스크롤 대상을 정한다. 인스턴스마다 자기 컨테이너를 기준으로 찾으므로 전역 querySelector 는 쓰지 않는다.
 * - HTMLElement: 그 요소
 * - 문자열: 편집기 컨테이너 자신을 포함해 closest(selector). 일치하는 요소가 없거나 selector 가 잘못되면 자동 탐색
 * - 생략: 스크롤 가능한 상위 조상을 자동 탐색, 없으면 window
 */
export function resolveScrollElement(container: HTMLElement, option?: string | HTMLElement): HTMLElement | undefined {
  let found: HTMLElement | undefined;
  if (option instanceof HTMLElement) {
    found = option;
  } else if (isString(option) && option) {
    try {
      found = container.closest<HTMLElement>(option) ?? undefined;
    } catch (err) {
      /* 잘못된 selector 는 자동 탐색으로 처리한다 */
    }
  }
  return found ? (isPageRoot(found) ? undefined : found) : findScrollParent(container);
}

/** 스크롤 대상(element, 없으면 window)의 가시 영역 상단/하단을 잰다 */
export function measureScrollTarget(element?: HTMLElement): ScrollTarget {
  // 대상과 viewport 가 겹치는 가시 영역만 기준으로 삼는다 (컨테이너가 화면 밖으로 길게 나가도 가장자리가 보이는 곳에서 동작)
  const view = window.innerHeight;
  if (!element) return { top: 0, bottom: view };
  const rect = element.getBoundingClientRect();
  return { element, top: Math.max(rect.top, 0), bottom: Math.min(rect.bottom, view) };
}

export function resolveScrollTarget(container: HTMLElement, option?: string | HTMLElement): ScrollTarget {
  return measureScrollTarget(resolveScrollElement(container, option));
}
