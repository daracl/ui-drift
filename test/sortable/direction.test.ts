import { isAnimating, playFlip } from '@/dom/flip';
import { decideSide } from '@/sortable/direction';

const rect = (left: number, top: number, width = 100, height = 40): DOMRect =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top } as DOMRect);

describe('decideSide', () => {
  describe('세로 / 한 줄 배치', () => {
    it('다른 목록에서 들어오는 항목은 중앙을 기준으로 앞/뒤를 정한다', () => {
      expect(decideSide('vertical', rect(0, 0), 10, 10, null, 0.5)).toBe('before');
      expect(decideSide('vertical', rect(0, 0), 10, 30, null, 0.5)).toBe('after');
    });

    it('내려가는 중이면 대상 중앙을 넘어야 뒤로, 올라가는 중이면 중앙을 넘어야 앞으로 간다', () => {
      expect(decideSide('vertical', rect(0, 0), 10, 15, true, 0.5)).toBeNull();
      expect(decideSide('vertical', rect(0, 0), 10, 25, true, 0.5)).toBe('after');
      expect(decideSide('vertical', rect(0, 0), 10, 25, false, 0.5)).toBeNull();
      expect(decideSide('vertical', rect(0, 0), 10, 15, false, 0.5)).toBe('before');
    });

    it('가로 배치는 가로 위치로 판정한다', () => {
      expect(decideSide('horizontal', rect(0, 0), 70, 20, true, 0.5, rect(-110, 0))).toBe('after');
      expect(decideSide('horizontal', rect(0, 0), 30, 20, true, 0.5, rect(-110, 0))).toBeNull();
    });
  });

  describe('여러 줄 배치에서 다른 줄 항목', () => {
    const upper = rect(0, 0); // 위 줄
    const lower = rect(0, 50); // 아래 줄 (끌고 있는 항목이 있는 줄)

    it('위 줄로 올라가면 가로 위치와 상관없이 항목에 들어서면 앞에 넣는다', () => {
      for (const x of [5, 50, 95]) expect(decideSide('horizontal', upper, x, 20, false, 0.5, lower)).toBe('before');
    });

    it('항목의 아래쪽 가장자리를 막 스친 정도로는 바꾸지 않는다 (기본 임계값 0.75)', () => {
      expect(decideSide('horizontal', upper, 50, 37, false, 0.5, lower)).toBeNull(); // 92% 지점
      expect(decideSide('horizontal', upper, 50, 28, false, 0.5, lower)).toBe('before'); // 70% 지점
    });

    it('아래 줄로 내려가면 항목에 들어서면 뒤에 넣는다', () => {
      for (const x of [5, 50, 95]) expect(decideSide('horizontal', lower, x, 80, true, 0.5, upper)).toBe('after');
      expect(decideSide('horizontal', lower, 50, 52, true, 0.5, upper)).toBeNull(); // 위쪽 가장자리를 막 스침
    });

    it('같은 줄이면 가로 중앙 기준이 그대로 적용된다', () => {
      const same = rect(-110, 0); // 같은 줄의 왼쪽 이웃
      expect(decideSide('horizontal', upper, 70, 20, false, 0.5, same)).toBeNull(); // 내가 뒤에 있는데 중앙 오른쪽
      expect(decideSide('horizontal', upper, 30, 20, false, 0.5, same)).toBe('before');
    });

    it('swapThreshold 를 키우면 줄을 넘나드는 판정도 더 일찍 일어난다', () => {
      expect(decideSide('horizontal', upper, 50, 37, false, 1, lower)).toBe('before');
    });
  });
});

describe('isAnimating (FLIP)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  it('위치가 바뀐 요소는 애니메이션이 끝날 때까지 true 이고, 움직이지 않은 요소는 false 이다', () => {
    const moved = document.createElement('div');
    const still = document.createElement('div');
    document.body.append(moved, still);
    moved.getBoundingClientRect = () => rect(100, 0); // 이동 후 위치
    still.getBoundingClientRect = () => rect(0, 0);
    const before = new Map<HTMLElement, DOMRect>([
      [moved, rect(0, 0)],
      [still, rect(0, 0)],
    ]);
    playFlip(before, 150, 'ease');
    expect(isAnimating(moved)).toBe(true);
    expect(isAnimating(still)).toBe(false);
    jest.advanceTimersByTime(200);
    expect(isAnimating(moved)).toBe(false);
  });

  it('duration 이 0 이면 애니메이션하지 않는다', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.getBoundingClientRect = () => rect(100, 0);
    playFlip(new Map([[el, rect(0, 0)]]), 0, 'ease');
    expect(isAnimating(el)).toBe(false);
  });
});
