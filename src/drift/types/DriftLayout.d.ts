/** 그리드 셀 단위 위치/크기 */
export interface DriftGeometry {
  /** 가로 위치 (0 기반 컬럼) */
  x: number;
  /** 세로 위치 (0 기반 행) */
  y: number;
  /** 가로 크기 (컬럼 수) */
  w: number;
  /** 세로 크기 (행 수) */
  h: number;
}

export type DriftPropValue = string | number | boolean | null;

export interface DriftItem extends DriftGeometry {
  /** 컴포넌트 고유 ID */
  id: string;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  /**
   * true 이면 **위치 고정**: 이동할 수 없고 고정 장애물이 되어 다른 항목이 비켜간다.
   * 크기 조절은 `resizable` 로 독립 제어한다 (`resizable` 을 생략하면 locked 이면 크기도 고정).
   */
  locked?: boolean;
  /**
   * 크기 조절 가능 여부 (이동/잠금과 독립). 생략하면 `locked` 를 따른다(locked 이면 false, 아니면 true).
   * `true` 이면 locked 항목도 크기를 조절할 수 있다(위치는 고정, 오른쪽/아래 방향만; 왼쪽 가장자리 핸들은 쓸 수 없다).
   * `false` 이면 locked 여부와 무관하게 크기를 조절할 수 없다.
   */
  resizable?: boolean;
  /** 컴포넌트 제목. Editor 에서는 상단 핸들 바에, Viewer 에서는 본문 위에 텍스트로 표시된다 */
  title?: string;
  /** 컴포넌트 콘텐츠 또는 렌더링 참조 정보 (Viewer 에서는 텍스트로 escape 된다) */
  content?: string;
  /** 사용자 정의 속성 (Viewer 에서는 data-* 속성으로 출력된다) */
  props?: Record<string, DriftPropValue>;
  /** breakpoint 이름별 위치/크기 재정의 */
  responsive?: Record<string, DriftGeometry>;
}

/** 변경 전/후가 모두 있는 항목 (before/after 는 내부 상태와 분리된 복사본) */
export interface DriftItemChange {
  id: string;
  before: DriftItem;
  after: DriftItem;
  /** x 또는 y 가 바뀌었다 */
  moved: boolean;
  /** w 또는 h 가 바뀌었다 */
  resized: boolean;
}

/** 두 항목 목록의 차이 (모두 내부 상태와 분리된 복사본) */
export interface DriftChanges {
  added: DriftItem[];
  removed: DriftItem[];
  /** 위치/크기/내용 등이 바뀐 항목. 사용자가 조작한 항목과 충돌로 밀려난 항목을 모두 포함한다 */
  changed: DriftItemChange[];
}

export interface DriftBreakpoint {
  /** breakpoint 이름 (responsive 키) */
  name: string;
  /** 이 너비(px) 이하에서 적용 (max-width) */
  maxWidth: number;
  /** 컬럼 수 */
  columns: number;
}

export interface DriftLayout {
  version: 1;
  columns: number;
  /** 행 높이(px) */
  rowHeight: number;
  /** 셀 간격(px) */
  gap: number;
  /** true 이면 놓은 위치를 유지한다(위로 자동 압축하지 않음). 겹칠 때만 아래로 밀린다. 기본 false */
  float?: boolean;
  /** 미지정이면 기본 breakpoint(tablet 8열, mobile 4열), 빈 배열이면 반응형 비활성 */
  breakpoints?: DriftBreakpoint[];
  items: DriftItem[];
}

export interface DriftValidationResult {
  valid: boolean;
  errors: string[];
}

/** 컨테이너 크기로부터 계산한 셀 크기 정보 */
export interface DriftMetrics {
  columns: number;
  cellWidth: number;
  rowHeight: number;
  gap: number;
}

export interface DriftRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 여러 컨테이너의 레이아웃을 묶은 저장 데이터 안의 컨테이너 하나 (DriftManager) */
export interface DriftContainerLayout {
  /** 컨테이너 id (항목 id 와 별개. 서로 다른 컨테이너는 같은 항목 id 를 써도 된다) */
  id: string;
  layout: DriftLayout;
  /**
   * Viewer `fitHeight` 에서의 컨테이너 높이 방식 (`renderContainersViewer`).
   * - 'auto': 고정 컨테이너를 뺀 나머지 높이를 auto 컨테이너끼리 행 수 비율로 나눠 채운다.
   * - 생략: 고정 높이. 행 수 × rowHeight (+ 행 사이 gap) 로 정해진다.
   * auto 컨테이너가 하나도 없으면 모든 컨테이너를 auto 로 본다.
   */
  height?: DriftContainerHeight;
}

/** 컨테이너 높이 방식. 현재는 'auto' 만 있고 생략하면 고정(행 수 × rowHeight) 높이다 */
export type DriftContainerHeight = 'auto';

/** 여러 컨테이너의 레이아웃 저장 포맷. 각 layout 은 단일 에디터의 DriftLayout 과 같다 */
export interface DriftContainerData {
  version: 1;
  /** 저장 순서 = 등록 순서 */
  containers: DriftContainerLayout[];
}
