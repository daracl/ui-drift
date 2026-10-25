import { DriftBreakpoint } from '@t/DriftLayout';

export const LAYOUT_VERSION = 1;

export const DEFAULT_COLUMNS = 12;
export const DEFAULT_ROW_HEIGHT = 40;
export const DEFAULT_GAP = 8;

/** 타이틀 영역 높이(px). style/_variables.scss 의 $drift-title-height 와 같아야 한다 */
export const TITLE_HEIGHT = 28;

/** breakpoint 가 지정되지 않았을 때 사용하는 기본값 */
export const DEFAULT_BREAKPOINTS: DriftBreakpoint[] = [
  { name: 'tablet', maxWidth: 1024, columns: 8 },
  { name: 'mobile', maxWidth: 640, columns: 4 },
];

/** 이 컬럼 수 미만이면 비례 축소 대신 세로 적층(stack) 정책을 사용한다 */
export const STACK_THRESHOLD_COLUMNS = 6;
