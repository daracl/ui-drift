import { DriftBreakpoint, DriftChanges, DriftGeometry, DriftItem, DriftLayout } from './DriftLayout';

/** 끌어오기 원본: CSS selector, 요소, 요소 목록 */
export type DriftDragInSource = string | Element | ArrayLike<Element>;

/** 끌어서 추가할 항목 정의 (id 를 생략하면 자동 생성) */
export type DriftDragInItem = Partial<DriftGeometry> & Omit<DriftItem, keyof DriftGeometry | 'id'> & { id?: string };

/** 외부에서 끌어 놓은 결과. onDrop 콜백으로 전달된다 */
export interface DriftDragInDropResult {
  /** 끌어 온 원본 요소 */
  source: HTMLElement;
  /**
   * 최종 위치·크기를 포함한 항목 정보 (내부 상태와 분리된 복사본이므로 자유롭게 수정해도 된다).
   * x, y, w, h 는 미리보기에서 계산된 값(충돌 재배치, float, min/max, 컬럼 경계 반영)이며
   * 현재 편집 중인 breakpoint(없으면 기본 레이아웃)의 칸 기준이다.
   * id 는 item 옵션이나 원본의 data-id 가 있을 때만 들어 있다 (autoAdd:false 에서는 자동 생성하지 않는다).
   */
  item: DriftDragInItem & Required<Pick<DriftGeometry, 'x' | 'y' | 'w' | 'h'>>;
  /** x, y, w, h 의 기준이 된 breakpoint 이름. 기본 레이아웃이면 null */
  breakpoint: string | null;
  /** 위 좌표 기준의 컬럼 수 */
  columns: number;
}

export interface DriftDragInOptions {
  /**
   * 드롭 시 내부 `addItem()` 으로 항목을 추가할지 여부 (기본 true).
   * false 이면 내부 레이아웃/선택/undo 이력/dirty 상태를 바꾸지 않고, add/layoutChange 이벤트도 발생시키지 않으며
   * 드롭 결과만 `onDrop` 으로 전달한다. 외부 모델이 상태를 관리하는 환경에서 사용한다.
   * 이때 `dragInEnd` 는 추가된 항목이 없으므로 null 을 전달하고, 정상 드롭은 onDrop 으로 구분한다.
   */
  autoAdd?: boolean;
  /**
   * 캔버스에 정상적으로 드롭했을 때 한 번 호출된다 (캔버스 밖 드롭, Esc, pointercancel 에서는 호출되지 않는다).
   * 호출 시점에 ghost/placeholder 는 이미 정리되고 미리보기로 밀렸던 항목은 원래 상태로 복원되어 있으므로,
   * 콜백 안에서 동기적으로 `editor.addItem()` 을 호출해도 된다.
   * autoAdd:true 이면 내부 추가가 끝난 뒤(item.id 는 실제 추가된 id) 호출된다.
   */
  onDrop?: (result: DriftDragInDropResult) => void;
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
   * `resizable` 을 명시하지 않은 **locked(위치 고정) 항목**의 크기 조절을 기본으로 허용할지 (기본 false: locked 이면 크기도 고정).
   * true 이면 locked 항목은 위치만 고정되고 (오른쪽/아래 방향의) 크기 조절은 가능하다. 항목에 `resizable` 을 명시하면 항상 그 값이 우선한다.
   * `setLockedResizable()` 로 런타임에 바꿀 수 있다.
   */
  lockedResizable?: boolean;
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
  /** undo 히스토리 최대 개수 (기본 100). `history: false` 이면 의미가 없다 */
  historyLimit?: number;
  /**
   * 내부 undo/redo 기록 (기본 true). false 이면 변경을 이력에 쌓지 않고 `undo()`/`redo()` 는 항상 false 를 반환하며
   * `canUndo()`/`canRedo()` 도 false 이다. 사용자 조작과 변경 이벤트는 그대로 동작한다.
   * 외부 모델이 undo/redo 를 관리하는 환경(ReportStudio 등)에서 끈다.
   */
  history?: boolean;
  /**
   * 항목에 포커스가 있을 때의 내부 키보드 처리 (기본 true): 방향키 이동, Shift+방향키 리사이즈, Delete 삭제, Esc 선택 해제.
   * false 이면 이 키 처리를 모두 끈다. 진행 중인 드래그/리사이즈/외부 끌어오기의 `Esc` 취소는 키보드 옵션과 무관하게 항상 유지된다.
   * 삭제 버튼(removable) 클릭 같은 마우스 동작은 영향받지 않는다. `setKeyboard()` 로 런타임에 바꿀 수 있다.
   */
  keyboard?: boolean;
  /**
   * 프로그램 호출(addItem/updateItem/load 등)로 적용한 변경에 대해 layoutChange/add/remove 이벤트를 발생시킬지 (기본 true).
   * false 이면 프로그램 호출은 이벤트 없이 적용되고, 사용자 조작(source:'user')의 이벤트는 항상 발생한다.
   * 호출마다 `{ emit }` 으로 덮어쓸 수 있다.
   */
  programmaticEvents?: boolean;
  /**
   * sizeChange 이벤트 정책 (기본 'end'). 'end': 사용자 리사이즈 도중에는 알리지 않고 확정된 뒤에 알린다.
   * 'live': 리사이즈 도중에도 프레임마다 합쳐서 알린다(phase:'live', 픽셀 크기는 포인터를 따라가는 실제 크기).
   */
  sizeNotify?: DriftSizeNotify;
  /**
   * 콘텐츠 생성/갱신/해제 훅. Grid·Chart 처럼 인스턴스와 이벤트를 가진 콘텐츠를 안전하게 연결한다.
   * 지정하면 `renderItem` 보다 우선한다. 위치/크기/선택만 바뀌면 호출되지 않는다.
   */
  contentLifecycle?: DriftContentLifecycle;
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
  | 'redo'
  | 'sync';

/**
 * 변경 출처.
 * - 'user': 사용자 조작 (드래그, 리사이즈, 키보드, 삭제 버튼, 외부 끌어오기 drop)
 * - 'api': 프로그램 호출 (기본값)
 * - 'sync': 외부 모델 동기화 (`syncItems()` 의 기본값). 호출마다 `{ source }` 로 지정할 수도 있다
 */
export type DriftChangeSource = 'user' | 'api' | 'sync';

/** 프로그램으로 변경을 적용하는 메서드의 공통 옵션 */
export interface DriftApplyOptions {
  /** 이벤트 발생 여부 (기본: 에디터 옵션 programmaticEvents). 사용자 조작(source:'user')은 항상 발생한다 */
  emit?: boolean;
  /**
   * 이 변경을 undo 이력에 기록할지 (기본 true, syncItems 는 false). 에디터 옵션 history:false 이면 항상 기록하지 않는다.
   * 기록하지 않은 변경은 이후의 undo() 로 되돌릴 수 없고, undo() 는 기록 시점의 스냅샷으로 복원하므로 주의한다.
   */
  history?: boolean;
  /** 변경 출처 (기본 'api'). layoutChange 의 info.source 로 전달된다 */
  source?: DriftChangeSource;
}

export interface DriftChangeInfo {
  reason: DriftChangeReason;
  /** 변경 출처. 외부 모델 동기화(sync)로 인한 이벤트를 걸러 순환을 막는 데 쓴다 */
  source: DriftChangeSource;
  /**
   * 이번 변경으로 추가/제거/변경된 항목 (현재 편집 중인 breakpoint 기준, 내부 상태와 분리된 복사본).
   * 사용자가 움직인 항목뿐 아니라 충돌로 밀려난 항목도 changed 에 포함된다.
   */
  changes: DriftChanges;
}

/** 콘텐츠 생명주기 훅. item 은 내부 상태와 분리된 복사본이다 */
export interface DriftContentLifecycle {
  /**
   * 콘텐츠를 처음 만든다 (항목당 한 번). 함수를 반환하면 해제 시 호출되는 정리 함수로 쓴다.
   * 이 시점의 `contentEl` 은 비어 있다.
   */
  mount(item: DriftItem, contentEl: HTMLElement): void | (() => void);
  /**
   * title/content/props 가 바뀌었을 때 호출한다 (위치/크기/선택 변경에는 호출되지 않는다).
   * 생략하면 unmount → 비우기 → mount 순으로 다시 만든다.
   */
  update?(item: DriftItem, contentEl: HTMLElement, previous: DriftItem): void;
  /**
   * 콘텐츠를 해제한다. 항목 제거, 전체 교체, destroy 에서 `contentEl` 을 비우기 **전에** 한 번만 호출된다.
   * mount 가 반환한 정리 함수가 있으면 이 훅 다음에 호출한다.
   */
  unmount?(item: DriftItem, contentEl: HTMLElement): void;
}

/** sizeChange 정책: 'end' 확정 후 알림(기본), 'live' 리사이즈 도중에도 알림 */
export type DriftSizeNotify = 'end' | 'live';

export interface DriftSizeChange {
  id: string;
  /** 현재 항목 (복사본) */
  item: DriftItem;
  /** 항목 카드 요소 */
  element: HTMLElement;
  /** 콘텐츠 영역 요소 (외부 위젯이 들어 있는 곳) */
  contentElement: HTMLElement;
  /** 항목 카드의 현재 픽셀 크기 */
  width: number;
  height: number;
  /** 현재 셀 크기 */
  w: number;
  h: number;
  /** 이전에 알린 크기. 처음 알리는 항목이면 null */
  previous: { w: number; h: number; width: number; height: number } | null;
  /** 'live': 사용자 리사이즈 진행 중(sizeNotify:'live'), 'end': 확정된 크기 */
  phase: 'live' | 'end';
  /** 'layout': 셀 크기(w/h)가 바뀌었다(리사이즈, 추가, undo, 동기화 등), 'container': 셀 크기는 같고 컨테이너 폭/컬럼 수 변화로 픽셀 크기만 바뀌었다 */
  cause: 'layout' | 'container';
}

/** syncItems 에 넘기는 항목: 일반 항목과 같고 id 와 위치/크기가 필수이다 */
export type DriftSyncItem = DriftItem;

export interface DriftSyncOptions extends DriftApplyOptions {
  /**
   * 배치 처리 방식 (기본 'auto').
   * - 'exact': 입력 배치를 그대로 복원한다. 정수화·컬럼 경계·min/max 보정만 하고 충돌 해소/압축은 하지 않는다.
   *   입력에 겹침이 있어도 그대로 두며 result.overlapping 으로 알린다.
   * - 'resolve': 충돌을 해소하고 중력(또는 float) 압축을 적용한다 (load/addItem 과 같은 정규화). 결과가 입력과 다를 수 있다.
   * - 'auto': 입력에 겹침이 없으면 'exact', 있으면 'resolve'. 유효한 외부 배치를 불필요하게 재압축하지 않는다.
   * 빈 칸(gap)이 있는 유효한 배치는 'exact'/'auto' 에서 그대로 유지되고, 이후 사용자가 항목을 움직일 때 일반 규칙대로 압축된다.
   */
  placement?: 'auto' | 'exact' | 'resolve';
}

export interface DriftSyncResult {
  /** 레이아웃이 실제로 바뀌었는지 (false 이면 DOM/이벤트/이력에 아무 일도 없었다) */
  changed: boolean;
  added: string[];
  removed: string[];
  /** 위치/크기/내용 등이 바뀐 항목 id */
  updated: string[];
  /** 입력 배치와 다른 위치/크기로 반영된 항목 (보정 또는 충돌 해소 결과, 복사본) */
  adjusted: DriftItem[];
  /** 반영된 배치에 겹침이 남아 있는지 ('exact' 에서 입력에 겹침이 있을 때만 true) */
  overlapping: boolean;
}

export interface DriftEditorEvents {
  layoutChange: (layout: DriftLayout, info: DriftChangeInfo) => void;
  add: (item: DriftItem) => void;
  remove: (item: DriftItem) => void;
  select: (item: DriftItem | null) => void;
  dragStart: (item: DriftItem) => void;
  /** 외부 요소를 끌기 시작했다 (임계값 이상 움직였을 때) */
  dragInStart: (source: HTMLElement) => void;
  /**
   * 외부에서 끌어오기가 끝났다. 캔버스에 놓아 내부에 추가되었으면 항목, 취소/캔버스 밖이면 null.
   * autoAdd:false 에서는 내부에 추가된 항목이 없으므로 정상 드롭에서도 null 이며, 정상 드롭은 onDrop 으로 구분한다
   * (onDrop 이 먼저 호출된 뒤 dragInEnd 가 발생한다).
   */
  dragInEnd: (item: DriftItem | null) => void;
  dragEnd: (item: DriftItem) => void;
  resizeStart: (item: DriftItem) => void;
  resizeEnd: (item: DriftItem) => void;
  breakpointChange: (breakpoint: DriftBreakpoint | null) => void;
  save: (layout: DriftLayout) => void;
  /**
   * 항목의 실제 크기가 바뀐 항목만 모아서 requestAnimationFrame 단위(같은 프레임은 합침)로 알린다.
   * 위치 이동만 한 항목은 포함되지 않는다. 호스트가 외부 위젯의 resize() 를 호출하는 데 쓴다.
   */
  sizeChange: (changes: DriftSizeChange[]) => void;
}

/** `getItemState()` 가 돌려주는 항목의 잠금/크기조절 상태 (위치 고정과 크기 조절은 독립) */
export interface DriftItemState {
  /** 위치 고정(고정 장애물, 이동 금지) 여부 */
  locked: boolean;
  /** 이동할 수 있는지 (= !locked) */
  movable: boolean;
  /** 크기를 조절할 수 있는지 (최종 판정: 항목의 resizable 명시값 → 없으면 locked/lockedResizable 옵션 기준) */
  resizable: boolean;
  /** 항목에 명시된 resizable 값. 명시하지 않아 locked 를 따르면 null */
  resizableOption: boolean | null;
}
