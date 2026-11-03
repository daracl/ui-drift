import type { SortableDirection } from '@/sortable/types';

export type Axis = 'vertical' | 'horizontal';
export type InsertSide = 'before' | 'after';

/** 목록의 배치 방향을 정한다. 'auto' 는 목록의 flex/grid 설정, 대상 항목의 float/inline 여부로 판단한다 */
export function detectAxis(list: HTMLElement, target: HTMLElement, option: SortableDirection): Axis {
  if (option === 'vertical' || option === 'horizontal') return option;

  const ls = getComputedStyle(list);
  if (ls.display === 'flex' || ls.display === 'inline-flex') {
    return ls.flexDirection.indexOf('column') === 0 ? 'vertical' : 'horizontal';
  }
  if (ls.display === 'grid' || ls.display === 'inline-grid') {
    // 계산된 값은 트랙 크기 목록("120px 120px")이므로 열이 둘 이상이면 가로로 채워진다고 본다
    const columns = (ls.gridTemplateColumns || '').split(/\s+/).filter(Boolean).length;
    return columns > 1 ? 'horizontal' : 'vertical';
  }
  const ts = getComputedStyle(target);
  if (ts.float === 'left' || ts.float === 'right' || ts.display.indexOf('inline') === 0) return 'horizontal';
  return 'vertical';
}

/**
 * 포인터가 대상 항목 위에 있을 때 끌고 있는 항목을 어느 쪽에 넣을지 정한다. 자리를 바꿀 필요가 없으면 null.
 *
 * - draggedBeforeTarget === null: 다른 목록에서 들어오는 항목이므로 중앙을 기준으로 항상 어느 한쪽에 넣는다
 * - 같은 목록: 이동하는 방향으로 threshold 지점을 넘었을 때만 자리를 바꾼다.
 *   threshold 0.5 는 대상 중앙. 반대 방향 판정과 겹치지 않아 크기가 다른 항목 사이에서도 떨리지 않는다.
 */
export function decideSide(
  axis: Axis,
  rect: DOMRect,
  x: number,
  y: number,
  draggedBeforeTarget: boolean | null,
  threshold: number,
): InsertSide | null {
  const size = axis === 'vertical' ? rect.height : rect.width;
  if (!(size > 0)) return null;
  const ratio = ((axis === 'vertical' ? y - rect.top : x - rect.left) / size) as number;
  if (draggedBeforeTarget === null) return ratio > 0.5 ? 'after' : 'before';
  if (draggedBeforeTarget) return ratio > 1 - threshold ? 'after' : null;
  return ratio < threshold ? 'before' : null;
}
