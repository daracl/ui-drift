/** 가장자리 자동 스크롤 옵션 */
export interface AutoScrollOptions {
  /** 가장자리로부터 이 거리(px) 안에 들어오면 스크롤한다 */
  sensitivity: number;
  /** 가장자리에 완전히 붙었을 때의 최대 속도(px/초). 화면 주사율과 무관하다 */
  speed: number;
}

type Axis = 'x' | 'y';

/** 한 프레임에서 인정하는 최대 경과 시간(ms). 탭 전환 등으로 프레임이 오래 멈췄다가 재개될 때 한꺼번에 튀지 않게 한다 */
const MAX_FRAME_MS = 50;
/** 스크롤 가능한 조상 목록을 다시 조사하는 간격(ms). 드래그 중 내용 크기가 바뀌어 스크롤 여부가 달라질 수 있어 가끔 갱신한다 */
const CHAIN_REFRESH_MS = 300;
/** 첫 프레임에 가정하는 경과 시간(ms) */
const FIRST_FRAME_MS = 16;

const isPageRoot = (el: Element): boolean =>
  el === document.body || el === document.documentElement || el === document.scrollingElement;

function canScroll(el: Element, axis: Axis): boolean {
  const cs = getComputedStyle(el);
  const overflow = axis === 'y' ? cs.overflowY : cs.overflowX;
  if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') return false;
  return axis === 'y' ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth;
}

/** 해당 방향(부호)으로 더 스크롤할 여지가 있는지 */
function canMove(el: Element, axis: Axis, direction: number): boolean {
  if (axis === 'y') {
    return direction < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  }
  return direction < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

/**
 * pos 가 [min, max] 의 가장자리에 가까울수록 빠른 속도(px/초, 앞쪽이면 음수)를 돌려준다. 가장자리가 아니면 0.
 * 속도는 가장자리 영역 안쪽 경계에서 0 에 가깝게 시작해 제곱 곡선으로 커지므로, 영역에 막 들어섰을 때는 천천히 움직이고
 * 가장자리에 붙을수록 빨라진다.
 */
function edgeVelocity(pos: number, min: number, max: number, { sensitivity, speed }: AutoScrollOptions): number {
  if (pos < min + sensitivity) return -speed * ease((min + sensitivity - pos) / sensitivity);
  if (pos > max - sensitivity) return speed * ease((pos - (max - sensitivity)) / sensitivity);
  return 0;
}

function ease(ratio: number): number {
  const r = Math.min(1, Math.max(0, ratio));
  return r * r;
}

/**
 * 포인터가 스크롤 영역의 가장자리에 있으면 경과 시간에 비례해 스크롤한다.
 * start 요소에서 위로 올라가며 스크롤 가능한 조상(가로/세로 독립)과 마지막에 window 를 차례로 검사하므로
 * 중첩된 스크롤 영역에서도 가장 안쪽부터 움직인다.
 *
 * 속도는 px/초이고 경과 시간(rAF 타임스탬프)으로 환산하므로 60Hz 와 144Hz 에서 같은 속도로 움직인다.
 * 한 프레임에 1px 미만인 이동은 버리지 않고 다음 프레임에 누적한다.
 */
interface ScrollLink {
  el: Element;
  y: boolean;
  x: boolean;
}

export class AutoScroller {
  private last = 0;
  /** start 에서 위로 올라가며 찾은, 실제로 스크롤 가능한 조상들. 프레임마다 getComputedStyle 을 부르지 않도록 캐시한다 */
  private chain: ScrollLink[] = [];
  private chainStart: Element | null = null;
  private chainAt = -Infinity;
  private remainder: Record<Axis, number> = { x: 0, y: 0 };

  constructor(private readonly options: AutoScrollOptions) {}

  /** 드래그가 새로 시작될 때 이전 프레임 기록을 지운다 */
  reset(): void {
    this.last = 0;
    this.remainder = { x: 0, y: 0 };
    this.chainStart = null;
    this.chainAt = -Infinity;
  }

  private refreshChain(start: Element | null, now: number): void {
    if (start === this.chainStart && now - this.chainAt < CHAIN_REFRESH_MS) return;
    this.chainStart = start;
    this.chainAt = now;
    this.chain = [];
    for (let el = start; el && !isPageRoot(el); el = el.parentElement) {
      const y = canScroll(el, 'y');
      const x = canScroll(el, 'x');
      if (y || x) this.chain.push({ el, y, x });
    }
  }

  /** now: requestAnimationFrame 이 전달하는 타임스탬프(ms). 실제로 스크롤했으면 true */
  step(start: Element | null, x: number, y: number, now: number): boolean {
    const dt = this.last ? Math.min(Math.max(now - this.last, 0), MAX_FRAME_MS) : FIRST_FRAME_MS;
    this.last = now;

    const moved = { x: false, y: false };
    const wanted = { x: false, y: false }; // 가장자리 영역 안에 있어 스크롤이 필요한 축

    const tryScroll = (el: Element, axis: Axis, velocity: number, apply: (px: number) => void): void => {
      if (moved[axis] || !velocity || !canMove(el, axis, velocity)) return;
      wanted[axis] = true;
      const total = this.remainder[axis] + (velocity * dt) / 1000;
      const whole = Math.trunc(total);
      this.remainder[axis] = total - whole;
      if (whole !== 0) {
        apply(whole);
        moved[axis] = true;
      }
    };

    this.refreshChain(start, now);
    for (const { el, x: scrollX, y: scrollY } of this.chain) {
      if (moved.x && moved.y) break;
      const rect = el.getBoundingClientRect();
      if (!moved.y && scrollY) {
        const v = edgeVelocity(y, Math.max(rect.top, 0), Math.min(rect.bottom, window.innerHeight), this.options);
        tryScroll(el, 'y', v, (px) => ((el as Element).scrollTop += px));
      }
      if (!moved.x && scrollX) {
        const v = edgeVelocity(x, Math.max(rect.left, 0), Math.min(rect.right, window.innerWidth), this.options);
        tryScroll(el, 'x', v, (px) => ((el as Element).scrollLeft += px));
      }
    }

    // 마지막으로 페이지(window) 자체
    const root = document.scrollingElement || document.documentElement;
    if (!moved.y)
      tryScroll(root, 'y', edgeVelocity(y, 0, window.innerHeight, this.options), (px) => window.scrollBy(0, px));
    if (!moved.x)
      tryScroll(root, 'x', edgeVelocity(x, 0, window.innerWidth, this.options), (px) => window.scrollBy(px, 0));

    // 가장자리를 벗어나 더 이상 스크롤할 필요가 없으면 누적하던 소수 이동량을 버린다
    if (!wanted.x) this.remainder.x = 0;
    if (!wanted.y) this.remainder.y = 0;
    return moved.x || moved.y;
  }
}
