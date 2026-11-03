/** Sortable 이 사용하는 CSS 클래스 (style/_sortable.scss 와 일치해야 한다) */
export const CLS = {
  sortable: 'dsr',
  /** handle 이 없고 delay 도 없을 때 항목 전체가 터치 드래그 영역이 된다 */
  touchNone: 'dsr-touch-none',
  handle: 'dsr-handle',
  ghost: 'dsr-ghost',
  chosen: 'dsr-chosen',
  drag: 'dsr-drag',
  dragging: 'dsr-dragging',
} as const;
