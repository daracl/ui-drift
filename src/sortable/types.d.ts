/** 목록 간 이동 허용 값. 함수는 (to, from, item, evt) 를 받아 같은 종류의 값을 돌려준다 */
export type SortableAccessValue<T> = T | string | string[] | ((ctx: SortableAccessContext) => T | string | string[]);

export interface SortableAccessContext {
  to: HTMLElement;
  from: HTMLElement;
  item: HTMLElement;
  originalEvent: PointerEvent;
}

export interface SortableGroupOptions {
  /** 그룹 이름. 이름이 같은 목록끼리는 pull/put 을 생략해도 서로 이동할 수 있다 */
  name?: string;
  /**
   * 이 목록에서 항목을 꺼내 갈 수 있는지.
   * true(이동) | false(불가) | 'clone'(복제) | 허용할 대상 그룹 이름(들) | 함수
   */
  pull?: SortableAccessValue<boolean | 'clone'>;
  /** 이 목록이 다른 목록의 항목을 받을 수 있는지. true | false | 허용할 출발 그룹 이름(들) | 함수 */
  put?: SortableAccessValue<boolean>;
}

export type SortableDirection = 'auto' | 'vertical' | 'horizontal';

/** 드래그 생명주기 이벤트 페이로드 */
export interface SortableEvent {
  /** 끌고 있는(또는 놓은) 항목 */
  item: HTMLElement;
  /** pull: 'clone' 일 때 원래 자리에 남은 복제본 */
  clone?: HTMLElement;
  /** 출발 목록 */
  from: HTMLElement;
  /** 도착 목록 (end 에서는 마지막으로 놓인 목록) */
  to: HTMLElement;
  /** 출발 목록 안에서의 순서 (draggable 항목 기준) */
  oldIndex: number;
  /** 도착 목록 안에서의 순서 (draggable 항목 기준) */
  newIndex: number;
  /** Esc 등으로 취소되어 원래 자리로 돌아갔는지 (end 에서만 의미가 있다) */
  cancelled?: boolean;
  originalEvent?: PointerEvent;
}

export interface SortableMoveEvent {
  dragged: HTMLElement;
  from: HTMLElement;
  to: HTMLElement;
  /** 포인터 아래에 있는 기준 항목 (빈 목록이면 null) */
  related: HTMLElement | null;
  willInsertAfter: boolean;
  originalEvent: PointerEvent;
}

export interface SortableEventMap {
  choose: (evt: SortableEvent) => void;
  start: (evt: SortableEvent) => void;
  clone: (evt: SortableEvent) => void;
  add: (evt: SortableEvent) => void;
  update: (evt: SortableEvent) => void;
  remove: (evt: SortableEvent) => void;
  sort: (evt: SortableEvent) => void;
  end: (evt: SortableEvent) => void;
}

export interface SortableOptions {
  /** 목록 간 이동 규칙. 문자열이면 그룹 이름 */
  group?: string | SortableGroupOptions;
  /** false 면 목록 안에서 순서를 바꿀 수 없다 (다른 목록으로 꺼내는 것은 group 규칙을 따른다). 기본 true */
  sort?: boolean;
  disabled?: boolean;
  /** 드래그를 시작할 수 있는 영역 selector (항목 안쪽). 생략하면 항목 전체 */
  handle?: string;
  /** 정렬 대상 selector. 목록의 직계 자식 중 일치하는 요소만 대상이 된다. 생략하면 모든 자식 */
  draggable?: string;
  /** 일치하는 요소에서는 드래그를 시작하지 않는다 (input, textarea, select 는 항상 제외) */
  filter?: string;
  /** 배치 방향. 'auto' 는 flex/grid/float/inline 여부로 판단한다 */
  direction?: SortableDirection;
  /** 자리 이동 애니메이션(ms). 0 이면 끈다. 기본 150 */
  animation?: number;
  /** 애니메이션 easing. 기본 'cubic-bezier(0.2, 0.8, 0.2, 1)' */
  easing?: string;
  /** 누르고 있어야 드래그가 시작되는 시간(ms). 이 시간 전에 움직이면 드래그하지 않고 스크롤에 맡긴다. 기본 0 */
  delay?: number;
  /** delay 를 터치 입력에만 적용한다 */
  delayOnTouchOnly?: boolean;
  /** 드래그로 인정하는 이동 거리(px). 기본 3 */
  distance?: number;
  /** 0~1. 대상 항목의 어느 지점을 넘어야 자리를 바꾸는지. 0.5 는 중앙 */
  swapThreshold?: number;
  /** 원래 자리(자리 표시자)에 붙는 클래스. 기본 'dsr-ghost' */
  ghostClass?: string;
  /** 누른 항목에 붙는 클래스. 기본 'dsr-chosen' */
  chosenClass?: string;
  /** 포인터를 따라다니는 복제본에 붙는 클래스. 기본 'dsr-drag' */
  dragClass?: string;
  /** 포인터를 따라다니는 복제본을 붙일 요소. 기본 document.body */
  appendTo?: HTMLElement;
  /**
   * 포인터를 따라다니는 복제본이 움직일 수 있는 범위. 기본 false(제한 없음).
   * true: 이 목록 자신 · 'parent': 목록의 부모 요소 · 문자열: 목록에서 closest(selector) · HTMLElement: 그 요소.
   * 복제본만 가두며 포인터는 자유롭다. 위치 판정은 포인터를 범위 가장자리로 맞춘 좌표로 하므로, 범위 밖의 다른 목록으로는
   * 이동할 수 없다. 여러 목록 사이를 오가게 하려면 모든 목록을 포함하는 요소를 지정한다.
   */
  containment?: boolean | 'parent' | string | HTMLElement;
  /** 가장자리 자동 스크롤. 기본 true */
  scroll?: boolean;
  /** 가장자리로부터 이 거리(px) 안에서 자동 스크롤. 기본 30 */
  scrollSensitivity?: number;
  /** 가장자리에 붙었을 때의 최대 스크롤 속도(px/초). 화면 주사율과 무관하며 가장자리에서 멀수록 느려진다. 기본 360 */
  scrollSpeed?: number;
  /** toArray()/sort() 가 사용하는 항목 식별 속성. 기본 'data-id' */
  dataIdAttr?: string;

  onChoose?: (evt: SortableEvent) => void;
  onStart?: (evt: SortableEvent) => void;
  onClone?: (evt: SortableEvent) => void;
  /** 이 목록에서 시작한 드래그가 다른 위치로 움직이려 할 때. false 면 막고, -1 은 앞에, 1 은 뒤에 넣는다 */
  onMove?: (evt: SortableMoveEvent) => boolean | -1 | 1 | void;
  /** 다른 목록에서 항목이 들어왔을 때 (도착 목록) */
  onAdd?: (evt: SortableEvent) => void;
  /** 같은 목록 안에서 순서가 바뀌었을 때 */
  onUpdate?: (evt: SortableEvent) => void;
  /** 항목이 다른 목록으로 나갔을 때 (출발 목록) */
  onRemove?: (evt: SortableEvent) => void;
  /** add / update / remove 어느 쪽이든 순서가 바뀌었을 때 */
  onSort?: (evt: SortableEvent) => void;
  /** 드래그가 끝났을 때 (출발 목록에서 호출) */
  onEnd?: (evt: SortableEvent) => void;
}
