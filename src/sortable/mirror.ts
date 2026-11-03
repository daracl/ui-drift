import type { SortableOptions } from '@/sortable/types';

/**
 * 복제본에 그대로 넣으면 로딩/재생/그리기 비용이 큰 요소.
 * canvas 도 포함한다: 그림을 복사하려면 getContext/drawImage 로 GPU 캔버스를 만들어야 하는데, 이 비용이 커서
 * 드래그 시작이 수백 ms 걸렸다 (3000개 목록 + canvas 1개에서 측정: 복사 켬 349~550ms, 끔 21~49ms).
 */
const HEAVY = 'iframe,video,audio,object,embed,canvas';

/**
 * 같은 크기의 가벼운 빈 상자. 원본의 class/inline style 은 유지해 여백·테두리 같은 배치는 같게 한다.
 * (복제된 iframe 은 body 에 붙는 순간 다시 로드되고 video 는 재생을 시작하므로 그대로 두면 드래그 시작이 느려진다)
 */
function placeholderFor(original: Element, copy: Element): HTMLElement {
  const rect = original.getBoundingClientRect();
  const display = getComputedStyle(original).display;
  const box = document.createElement('div');
  box.className = copy.className;
  box.style.cssText = (copy as HTMLElement).style.cssText;
  Object.assign(box.style, {
    display:
      display === 'none' ? 'none' : display === 'inline' || display === 'inline-block' ? 'inline-block' : 'block',
    boxSizing: 'border-box',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    background: 'rgba(127, 127, 127, 0.15)',
  });
  return box;
}

/** 깊은 복사본에서 무거운 요소를 가볍게 바꾼다. 해당 요소가 없으면 아무 일도 하지 않는다 */
function lighten(original: HTMLElement, copy: HTMLElement): void {
  const originals = original.querySelectorAll(HEAVY);
  if (!originals.length) return;
  const copies = copy.querySelectorAll(HEAVY); // 같은 트리 구조이므로 순서가 같다
  originals.forEach((orig, i) => {
    const dup = copies[i];
    if (!dup) return;
    dup.replaceWith(placeholderFor(orig, dup));
  });
}

/**
 * 포인터를 따라다닐 복제본(항목 부분)을 만든다.
 * - 'clone'(기본): 깊은 복사 + iframe/video/canvas 같은 무거운 요소는 가볍게 대체
 * - 'box': 내용 없이 항목 껍데기(태그, class, style)만 복사. 가장 가볍다
 * - 함수: 직접 만든 요소를 쓴다. 아무것도 돌려주지 않으면 'clone' 으로 대체한다
 */
export function createMirrorItem(item: HTMLElement, mode: SortableOptions['mirror']): HTMLElement {
  let mirror: HTMLElement | undefined;
  if (typeof mode === 'function') {
    const custom = mode(item);
    if (custom instanceof HTMLElement) mirror = custom;
  } else if (mode === 'box') {
    mirror = item.cloneNode(false) as HTMLElement;
  }
  if (!mirror) {
    mirror = item.cloneNode(true) as HTMLElement;
    lighten(item, mirror);
  }
  // 복제본은 보기만 한다: 포커스/스크린리더 대상에서 빼서 중복 노출과 접근성 트리 비용을 없앤다
  mirror.setAttribute('aria-hidden', 'true');
  mirror.setAttribute('inert', '');
  return mirror;
}
