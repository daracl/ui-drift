import { addItem, compact, DriftItem, moveItem, normalizeItems } from '@/core';

/**
 * 성능 회귀 방지용 거친 상한 테스트. 정밀한 벤치마크가 아니다(그건 scripts/bench-core.mjs, docs/performance.md).
 * 개선 전에는 n=1000 의 tall 압축이 수 초 걸렸고, 지금은 수 ms 이다. 느린 CI 에서도 깨지지 않도록
 * 상한은 실측치의 수십~수백 배로 넉넉히 잡았다. jsdom 시간은 브라우저 드래그 성능과 무관하다.
 */
const now = () => performance.now();

const tall = (n: number): DriftItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `i${i}`, x: (i % 4) * 3, y: 200 + Math.floor(i / 4) * 4, w: 3, h: 2 }));

describe('core 성능 회귀 방지 (거친 상한)', () => {
  it('위쪽이 비어 있는 1000개 항목의 압축/이동/불러오기가 한 번에 끝난다 (y 가 커도 선형 이하)', () => {
    const items = tall(1000);
    const t0 = now();
    const packed = compact(items, undefined, false);
    const moved = moveItem(items, 12, 'i0', 9, 9999, false);
    const normalized = normalizeItems(items, 12, false);
    const elapsed = now() - t0;

    expect(elapsed).toBeLessThan(1500); // 개선 전 약 8초(3회 합계)
    expect(packed[0].y).toBe(0);
    expect(moved).toHaveLength(1000);
    expect(normalized).toHaveLength(1000);
  });

  it('빈 레이아웃에 자동 배치로 300개를 연속 추가해도 합리적인 시간에 끝난다', () => {
    let items: DriftItem[] = [];
    const t0 = now();
    for (let i = 0; i < 300; i++) items = addItem(items, 12, { id: `i${i}`, w: 1 + (i % 4), h: 1 + (i % 3) });
    const elapsed = now() - t0;
    expect(elapsed).toBeLessThan(4000);
    expect(items).toHaveLength(300);
  });

  it('같은 입력은 항상 같은 출력을 낸다 (결정성)', () => {
    const items = tall(300);
    expect(compact(items, 'i5', false)).toEqual(compact(items, 'i5', false));
  });
});
