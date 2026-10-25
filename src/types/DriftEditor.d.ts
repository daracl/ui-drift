import { DriftBreakpoint, DriftGeometry, DriftItem, DriftLayout } from './DriftLayout';

/** 끌어오기 원본: CSS selector, 요소, 요소 목록 */
export type DriftDragInSource = string | Element | ArrayLike<Element>;

/** 끌어서 추가할 항목 정의 (id 를 생략하면 자동 생성) */
export type DriftDragInItem = Partial<DriftGeometry> & Omit<DriftItem, keyof DriftGeometry | 'id'> & { id?: string };

export interface DriftDragInOptions {
  /**
   * 추가할 항목 정의 또는 원본 요소로부터 만드는 함수.
   * 생략하면 원본의 data-w/data-h(기본 3x2), data-id, data-title, data-content(없으면 텍스트)를 사용한다.
   */
  item?: DriftDragInItem | ((source: HTMLElement) => DriftDragInItem);
}

/** 리사이즈 핸들 위치: 'se' 우하단, 'sw' 좌하단 */
export type DriftResizeHandle = 'se' | 'sw';

export type DriftDragMode = 'auto' | 'item' | 'handle';

export interface DriftEditorOptions {
  /** 초기 레이아웃(객체 또는 JSON 문자열). 지정하면 columns/rowHeight/gap/breakpoints 는 레이아웃 값이 우선한다 */
  layout?: DriftLayout | Partial<DriftLayout> | string;
  columns?: number;
  rowHeight?: number;
  gap?: number;
  breakpoints?: DriftBreakpoint[];
  /** 드롭한 위치를 그대로 유지한다 (기본 false: 위로 자동 압축). `layout` 이 있으면 layout.float 가 우선 */
  float?: boolean;
  /** 엑셀처럼 배경에 셀 크기를 테두리로 표시한다 (기본 true). `setGrid()` 로 전환 가능 */
  grid?: boolean;
  /**
   * 셀 테두리 색. 지정하면 캔버스의 CSS 변수 `--ddr-grid-color` 로 설정된다 (영문/숫자/#,()%., 공백만 허용).
   * 지정하지 않으면 CSS 에서 `--ddr-grid-color` 를 직접 바꿀 수 있다 (기본 #d5dbe3).
   */
  gridColor?: string;
  /** 드래그 이동 허용 (기본 true) */
  draggable?: boolean;
  /** 리사이즈 허용 (기본 true) */
  resizable?: boolean;
  /**
   * 표시할 리사이즈 핸들 (기본 ['se', 'sw']).
   * 'se' 는 우하단(오른쪽/아래로 조절), 'sw' 는 좌하단(왼쪽/아래로 조절. 오른쪽 가장자리는 고정되고 x 와 w 가 함께 바뀐다)
   */
  resizeHandles?: DriftResizeHandle[];
  /**
   * 컨테이너 너비에 따라 breakpoint 를 자동 선택한다 (기본 false).
   * false 이면 폭이 바뀌어도 기본 레이아웃을 유지하고, setBreakpoint(name) 으로 명시적으로 전환한다.
   */
  responsive?: boolean;
  /**
   * 드래그 시작 영역.
   * 'auto'(기본): 마우스/펜은 항목 전체, 터치는 핸들에서만 (스크롤 충돌 방지)
   */
  dragMode?: DriftDragMode;
  /** 항목에 삭제 버튼 표시 및 Delete 키 삭제 허용 (기본 false) */
  removable?: boolean;
  /** 하단에 항상 비워 둘 여분 행 수 (기본 2) */
  extraRows?: number;
  /** 위치/크기 변경 애니메이션 (기본 true) */
  animate?: boolean;
  /** undo 히스토리 최대 개수 (기본 100) */
  historyLimit?: number;
  /** 항목 내용을 직접 그린다. 지정하지 않으면 content(없으면 id)를 텍스트로 출력한다 */
  renderItem?: (item: DriftItem, contentEl: HTMLElement) => void;
}

export type DriftChangeReason =
  | 'init'
  | 'load'
  | 'add'
  | 'remove'
  | 'update'
  | 'move'
  | 'resize'
  | 'drag'
  | 'clear'
  | 'reset'
  | 'undo'
  | 'redo';

export interface DriftChangeInfo {
  reason: DriftChangeReason;
}

export interface DriftEditorEvents {
  layoutChange: (layout: DriftLayout, info: DriftChangeInfo) => void;
  add: (item: DriftItem) => void;
  remove: (item: DriftItem) => void;
  select: (item: DriftItem | null) => void;
  dragStart: (item: DriftItem) => void;
  /** 외부 요소를 끌기 시작했다 (임계값 이상 움직였을 때) */
  dragInStart: (source: HTMLElement) => void;
  /** 외부에서 끌어오기가 끝났다. 캔버스에 놓아 추가되었으면 항목, 취소/캔버스 밖이면 null */
  dragInEnd: (item: DriftItem | null) => void;
  dragEnd: (item: DriftItem) => void;
  resizeStart: (item: DriftItem) => void;
  resizeEnd: (item: DriftItem) => void;
  breakpointChange: (breakpoint: DriftBreakpoint | null) => void;
  save: (layout: DriftLayout) => void;
}
