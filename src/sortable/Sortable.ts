import { AutoScroller } from '@/dom/autoScroll';
import { isAnimating, playFlip, snapshotElements, snapshotRects } from '@/dom/flip';
import { disableScrollAnchoring, restoreScrollAnchoring, ScrollAnchorHold } from '@/dom/scrollAnchor';
import { Emitter } from '@/event/Emitter';
import type { SortableEvent, SortableEventMap, SortableMoveEvent, SortableOptions } from '@/sortable/types';
import { CLS } from './classNames';
import { Axis, detectAxis, decideSide, InsertSide } from './direction';
import { checkTransfer, resolveGroup, ResolvedGroup } from './group';
import { createMirrorItem } from './mirror';

/** 어떤 설정이든 항상 드래그를 시작하지 않는 입력 요소 */
const NO_DRAG = 'input,textarea,select,option,[contenteditable="true"],[data-sortable-no-drag]';

const DEFAULTS = {
  sort: true,
  disabled: false,
  direction: 'auto',
  animation: 150,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  delay: 0,
  delayOnTouchOnly: false,
  distance: 3,
  swapThreshold: 0.5,
  ghostClass: 'dsr-ghost',
  chosenClass: 'dsr-chosen',
  dragClass: 'dsr-drag',
  scroll: true,
  scrollSensitivity: 30,
  scrollSpeed: 360,
  dataIdAttr: 'data-id',
} as const;

type ResolvedOptions = SortableOptions & {
  [K in keyof typeof DEFAULTS]-?: SortableOptions[K] extends undefined ? never : NonNullable<SortableOptions[K]>;
};

const HANDLERS: { [K in keyof SortableEventMap]: keyof SortableOptions } = {
  choose: 'onChoose',
  start: 'onStart',
  clone: 'onClone',
  add: 'onAdd',
  update: 'onUpdate',
  remove: 'onRemove',
  sort: 'onSort',
  end: 'onEnd',
};

/** 진행 중인 드래그 한 건. 포인터는 하나뿐이므로 모듈 전체에서 한 번에 하나만 존재한다 */
interface Session {
  /** 드래그를 시작한 목록 */
  source: Sortable;
  /** 항목이 지금 들어 있는 목록 */
  current: Sortable;
  item: HTMLElement;
  clone?: HTMLElement;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  /** 목록별 배치 방향 캐시 (드래그 중에는 바뀌지 않으므로 getComputedStyle 을 매 이동마다 부르지 않는다) */
  axes: Map<HTMLElement, Axis>;
  /** 애니메이션 때문에 판정을 미룬 경우 true. 다음 프레임에 다시 판정한다 */
  retry?: boolean;
  /** 위치 판정에 쓰는 좌표. containment 가 있으면 포인터를 범위 안으로 맞춘 값이다 */
  px: number;
  py: number;
  /** 포인터를 따라다니는 복제본의 크기 */
  width: number;
  height: number;
  /** containment 로 정한 복제본 이동 범위 요소 */
  bounds?: HTMLElement | null;
  grabX: number;
  grabY: number;
  /** 누르고 있는 시간(delay) 조건을 채웠는지 */
  ready: boolean;
  /** 실제 드래그가 시작됐는지 */
  active: boolean;
  timer?: number;
  raf: number;
  mirror?: HTMLElement;
  /** 포인터 아래에 있던 마지막 요소 (자동 스크롤의 출발점) */
  hit?: Element | null;
  oldIndex: number;
  oldNext: Node | null;
  lastEvent: PointerEvent;
  abort: AbortController;
  /** 드래그 동안 overflow-anchor 를 끈 요소들 (끝나면 원래 값으로 복원) */
  anchors: ScrollAnchorHold;
}

const registry = new WeakMap<HTMLElement, Sortable>();
let activeSession: Session | undefined;

function clampRange(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max); // 범위가 항목보다 작으면 시작점에 붙인다
}

const splitClasses = (value: string): string[] => value.split(/\s+/).filter(Boolean);

function toggleClasses(el: Element, value: string, on: boolean): void {
  splitClasses(value).forEach((c) => el.classList.toggle(c, on));
}

/**
 * Pointer Events 기반 정렬(Drag & Drop) 목록.
 * 마우스/터치/펜을 하나의 코드로 처리하며, 목록 안 정렬과 목록 간 이동(group)·복제(clone)를 지원한다.
 * 항목이 정렬되는 방식은 SortableJS 와 같다: 원래 항목은 자리 표시자(ghostClass)로 목록 안에서 움직이고,
 * 포인터를 따라다니는 것은 복제본(dragClass)이다.
 */
export class Sortable {
  readonly el: HTMLElement;
  readonly options: ResolvedOptions;
  private group: ResolvedGroup;
  private readonly emitter = new Emitter<SortableEventMap>();
  private readonly abort = new AbortController();
  private observer?: MutationObserver;
  private destroyed = false;

  constructor(el: HTMLElement, options: SortableOptions = {}) {
    if (!(el instanceof HTMLElement)) throw new TypeError('Sortable: HTMLElement 가 필요합니다.');
    if (registry.has(el)) throw new Error('Sortable: 이미 Sortable 이 적용된 요소입니다.');
    this.el = el;
    const given: Record<string, unknown> = {};
    Object.keys(options).forEach((k) => {
      if ((options as Record<string, unknown>)[k] !== undefined) given[k] = (options as Record<string, unknown>)[k];
    });
    this.options = { ...DEFAULTS, ...given } as ResolvedOptions;
    this.group = resolveGroup(this.options.group);
    registry.set(el, this);

    el.classList.add(CLS.sortable);
    this.syncTouch(true);

    const opts = { signal: this.abort.signal };
    el.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    // 이미지/링크의 브라우저 기본 드래그가 포인터 드래그를 가로채지 않도록 막는다
    el.addEventListener(
      'dragstart',
      (e) => {
        if (e.target instanceof Element && this.findItem(e.target)) e.preventDefault();
      },
      opts,
    );
    // 길게 눌러 나타나는 컨텍스트 메뉴가 터치 드래그를 끊지 않도록 한다
    el.addEventListener(
      'contextmenu',
      (e) => activeSession && activeSession.pointerType !== 'mouse' && e.preventDefault(),
      opts,
    );

    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver((records) => this.markAdded(records));
      this.observer.observe(el, { childList: true });
    }
  }

  static create(el: HTMLElement, options?: SortableOptions): Sortable {
    return new Sortable(el, options);
  }

  /** 요소에 적용된 Sortable 인스턴스 */
  static get(el: Element | null | undefined): Sortable | undefined {
    return el ? registry.get(el as HTMLElement) : undefined;
  }

  /** 지금 드래그 중인지 */
  static isDragging(): boolean {
    return !!activeSession?.active;
  }

  // ───────────────────────────── 공개 API ─────────────────────────────

  on<K extends keyof SortableEventMap>(name: K, handler: SortableEventMap[K]): () => void {
    return this.emitter.on(name, handler);
  }

  off<K extends keyof SortableEventMap>(name: K, handler?: SortableEventMap[K]): void {
    this.emitter.off(name, handler);
  }

  /** 옵션을 읽거나(값 생략) 바꾼다 */
  option<K extends keyof SortableOptions>(name: K): SortableOptions[K];
  option<K extends keyof SortableOptions>(name: K, value: SortableOptions[K]): void;
  option<K extends keyof SortableOptions>(name: K, value?: SortableOptions[K]): SortableOptions[K] | void {
    if (arguments.length < 2) return this.options[name];
    (this.options as SortableOptions)[name] = value;
    if (name === 'group') this.group = resolveGroup(this.options.group);
    if (name === 'handle' || name === 'delay') this.syncTouch(true);
  }

  /** 정렬 대상 항목들 (목록의 직계 자식 중 draggable 에 일치하는 것) */
  items(): HTMLElement[] {
    const { draggable } = this.options;
    return Array.from(this.el.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement && (!draggable || c.matches(draggable)),
    );
  }

  /** 항목들의 dataIdAttr 값을 순서대로 */
  toArray(): string[] {
    return this.items().map((item) => item.getAttribute(this.options.dataIdAttr) ?? '');
  }

  /** dataIdAttr 값의 배열 순서대로 항목을 재배치한다. 배열에 없는 항목은 뒤로 밀리지 않고 그대로 둔다 */
  sort(order: string[], animate = false): void {
    const byId = new Map<string, HTMLElement>();
    this.items().forEach((item) => byId.set(item.getAttribute(this.options.dataIdAttr) ?? '', item));
    const before = animate ? snapshotRects([this.el]) : undefined;
    order.forEach((id) => {
      const item = byId.get(id);
      if (item) this.el.appendChild(item);
    });
    if (before) playFlip(before, this.options.animation, this.options.easing);
  }

  /** 진행 중인 드래그를 취소하고 원래 자리로 되돌린다 */
  cancel(): void {
    const s = activeSession;
    if (s && (s.source === this || s.current === this)) this.finish(s, true);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancel();
    this.destroyed = true;
    this.abort.abort();
    this.observer?.disconnect();
    this.emitter.clear();
    registry.delete(this.el);
    this.el.classList.remove(CLS.sortable, CLS.touchNone);
    this.el.querySelectorAll(`.${CLS.handle}`).forEach((h) => h.classList.remove(CLS.handle));
  }

  // ───────────────────────────── 항목 탐색 ─────────────────────────────

  /** target 이 속한 이 목록의 항목 (없으면 null) */
  private findItem(target: Element): HTMLElement | null {
    let node: Element | null = target;
    while (node && node.parentElement !== this.el) node = node.parentElement;
    if (!node || !(node instanceof HTMLElement)) return null;
    const { draggable } = this.options;
    return !draggable || node.matches(draggable) ? node : null;
  }

  /** 터치 입력의 스크롤 간섭을 막는 touch-action 클래스를 맞춘다 */
  private syncTouch(reset: boolean): void {
    const { handle, delay } = this.options;
    // delay 가 있으면 대기 시간 동안은 스크롤이 가능해야 하므로 touch-action 을 잠그지 않는다
    const lock = !(delay > 0);
    this.el.classList.toggle(CLS.touchNone, lock && !handle);
    if (reset) this.el.querySelectorAll(`.${CLS.handle}`).forEach((h) => h.classList.remove(CLS.handle));
    if (lock && handle) {
      this.items().forEach((item) => item.querySelectorAll(handle).forEach((h) => h.classList.add(CLS.handle)));
    }
  }

  /** 순서가 바뀔 때마다 모든 항목을 다시 훑지 않고, 새로 들어온 항목의 handle 만 표시한다 */
  private markAdded(records: MutationRecord[]): void {
    const { handle, delay, draggable } = this.options;
    if (!handle || delay > 0) return;
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement && (!draggable || node.matches(draggable))) {
          node.querySelectorAll(handle).forEach((h) => h.classList.add(CLS.handle));
        }
      });
    }
  }

  private fire<K extends keyof SortableEventMap>(name: K, evt: SortableEvent): void {
    const cb = this.options[HANDLERS[name]] as ((e: SortableEvent) => void) | undefined;
    if (typeof cb === 'function') cb.call(this, evt);
    (this.emitter as Emitter<Record<string, (e: SortableEvent) => void>>).emit(name, evt);
  }

  private indexOf(item: HTMLElement): number {
    return this.items().indexOf(item);
  }

  private makeEvent(s: Session): SortableEvent {
    return {
      item: s.item,
      clone: s.clone,
      from: s.source.el,
      to: s.current.el,
      oldIndex: s.oldIndex,
      newIndex: s.current.indexOf(s.item),
      originalEvent: s.lastEvent,
    };
  }

  // ───────────────────────────── 시작 ─────────────────────────────

  private onDown(e: PointerEvent): void {
    // 중첩 목록에서는 안쪽 목록이 먼저 세션을 만들므로 바깥 목록은 건너뛴다
    if (this.options.disabled || activeSession || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;

    const item = this.findItem(target);
    if (!item) return;
    const { handle, filter } = this.options;
    const inside = (selector: string): boolean => {
      const hit = target.closest(selector);
      return !!hit && item.contains(hit);
    };
    if (handle && !inside(handle)) return;
    if ((filter && inside(filter)) || inside(NO_DRAG)) return;

    const abort = new AbortController();
    const s: Session = {
      source: this,
      current: this,
      item,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      px: e.clientX,
      py: e.clientY,
      axes: new Map(),
      width: 0,
      height: 0,
      grabX: 0,
      grabY: 0,
      ready: false,
      active: false,
      raf: 0,
      oldIndex: this.indexOf(item),
      oldNext: item.nextSibling,
      lastEvent: e,
      abort,
      anchors: new Map(),
    };
    activeSession = s;

    const opts = { signal: abort.signal };
    const mine = (ev: PointerEvent): boolean => ev.pointerId === s.pointerId;
    document.addEventListener('pointermove', (ev) => mine(ev) && this.onMove(s, ev), opts);
    document.addEventListener('pointerup', (ev) => mine(ev) && this.onUp(s, ev), opts);
    document.addEventListener('pointercancel', (ev) => mine(ev) && this.onCancel(s), opts);
    document.addEventListener('keydown', (ev) => ev.key === 'Escape' && this.finish(s, true), opts);
    document.addEventListener('selectstart', (ev) => ev.preventDefault(), opts);
    // 대기 시간을 채운 뒤에는 브라우저가 터치로 스크롤을 시작하지 못하게 한다 (cancelable 일 때만 막을 수 있다)
    document.addEventListener('touchmove', (ev) => s.ready && ev.cancelable && ev.preventDefault(), {
      signal: abort.signal,
      passive: false,
    });

    const { delay, delayOnTouchOnly } = this.options;
    const wait = delayOnTouchOnly && e.pointerType !== 'touch' ? 0 : delay;
    if (wait > 0) {
      s.timer = window.setTimeout(() => {
        s.timer = undefined;
        this.choose(s);
      }, wait);
    } else {
      this.choose(s);
    }
  }

  private choose(s: Session): void {
    s.ready = true;
    toggleClasses(s.item, this.options.chosenClass, true);
    this.fire('choose', this.makeEvent(s));
  }

  private onMove(s: Session, e: PointerEvent): void {
    s.clientX = e.clientX;
    s.clientY = e.clientY;
    s.lastEvent = e;

    if (!s.active) {
      if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < this.options.distance) return;
      // 대기 시간 전에 움직였다면 드래그가 아니라 스크롤/제스처로 보고 물러난다
      if (!s.ready) return this.finish(s, true);
      this.startDrag(s);
    }
    this.follow(s);
    this.hitTest(s);
  }

  private onUp(s: Session, e: PointerEvent): void {
    s.lastEvent = e;
    this.finish(s, false);
  }

  /** 브라우저가 제스처를 가져가면(예: 터치 스크롤) 드래그를 취소한다 */
  private onCancel(s: Session): void {
    this.finish(s, true);
  }

  private startDrag(s: Session): void {
    const { item } = s;
    const rect = item.getBoundingClientRect();
    s.active = true;
    s.width = rect.width;
    s.height = rect.height;
    s.bounds = this.containmentElement();
    s.grabX = s.startX - rect.left;
    s.grabY = s.startY - rect.top;
    s.oldIndex = this.indexOf(item);
    s.oldNext = item.nextSibling;

    const mirrorItem = createMirrorItem(item, this.options.mirror);
    toggleClasses(mirrorItem, this.options.chosenClass, false);
    toggleClasses(mirrorItem, this.options.ghostClass, false);
    toggleClasses(mirrorItem, this.options.dragClass, true);
    Object.assign(mirrorItem.style, {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      boxSizing: 'border-box',
    });

    // 복제본을 body 에 그대로 붙이면 `.list > li` 같은 부모 의존 규칙이 적용되지 않아 <li> 의 목록 점(marker)이 보이거나
    // 테두리·배경이 사라진다. 그래서 원래 목록과 같은 태그/클래스의 빈 홀더(목록 껍데기)에 넣어 같은 스타일 맥락을 유지한다.
    // 홀더 자체의 여백/테두리/배경은 지워서 항목만 보이게 한다.
    const mirror = this.el.cloneNode(false) as HTMLElement;
    mirror.removeAttribute('id');
    mirror.classList.remove(CLS.sortable, CLS.touchNone);
    mirror.appendChild(mirrorItem);
    Object.assign(mirror.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      display: 'block',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      minHeight: '0',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'none',
      boxShadow: 'none',
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '2147483647',
      transition: 'none',
      // 복제본은 이동만 하므로 자기 합성 레이어로 올리고(transform 만 바뀜), 내부 레이아웃을 바깥과 격리한다
      willChange: 'transform',
      cursor: 'grabbing',
      contain: 'layout style',
      transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
    });
    (this.options.appendTo || document.body).appendChild(mirror);
    s.mirror = mirror;
    try {
      // 항목이 목록 사이를 옮겨 다녀도 포인터 이벤트가 끊기지 않도록 이동하지 않는 복제본이 포인터를 잡는다
      mirror.setPointerCapture(s.pointerId);
    } catch (err) {
      /* 지원하지 않거나 이미 끝난 포인터면 document 리스너만으로 동작한다 */
    }

    toggleClasses(item, this.options.ghostClass, true);
    disableScrollAnchoring(this.el, s.anchors);
    document.documentElement.classList.add(CLS.dragging);
    window.getSelection()?.removeAllRanges();
    this.fire('start', this.makeEvent(s));

    // 드래그 중에 option() 으로 바꾼 값도 바로 반영되도록 getter 로 읽는다
    const opts = this.options;
    const scroller = new AutoScroller({
      get sensitivity() {
        return opts.scrollSensitivity;
      },
      get speed() {
        return opts.scrollSpeed;
      },
    });
    const tick = (now: number): void => {
      if (activeSession !== s || !s.active) return;
      if (s.retry) {
        s.retry = false;
        this.hitTest(s); // 이동 애니메이션 때문에 미뤘던 판정을 다시 한다 (아직 진행 중이면 over() 가 다시 미룬다)
      }
      if (opts.scroll && scroller.step(s.hit ?? s.item, s.clientX, s.clientY, now)) {
        this.follow(s); // 스크롤로 범위 요소/항목 위치가 바뀌었을 수 있으므로 복제본 위치와 판정을 다시 계산한다
        this.hitTest(s);
      }
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  }

  /**
   * containment 에 지정한 요소(drag 시작 시 확정)의 화면 영역. 요소가 없거나 크기가 0(숨김)이면 제한하지 않는다.
   * - true: 이 목록 자신, 'parent': 목록의 부모, 문자열: 목록에서 closest(selector), HTMLElement: 그 요소
   */
  private containmentElement(): HTMLElement | null {
    const c = this.options.containment;
    if (!c) return null;
    if (c instanceof HTMLElement) return c;
    if (c === true) return this.el;
    if (c === 'parent') return this.el.parentElement;
    try {
      return this.el.closest<HTMLElement>(c);
    } catch (err) {
      return null; // 잘못된 selector 는 제한 없음으로 처리한다
    }
  }

  /** 복제본을 포인터에 맞춰 옮긴다. containment 가 있으면 복제본이 범위 밖으로 나가지 않게 가둔다 */
  private follow(s: Session): void {
    let left = s.clientX - s.grabX;
    let top = s.clientY - s.grabY;
    s.px = s.clientX;
    s.py = s.clientY;

    const box = s.bounds ? s.bounds.getBoundingClientRect() : undefined;
    if (box && (box.width > 0 || box.height > 0)) {
      left = clampRange(left, box.left, box.right - s.width);
      top = clampRange(top, box.top, box.bottom - s.height);
      // 복제본은 가두되 포인터는 자유롭게 움직인다. 위치 판정은 포인터를 범위 가장자리로 맞춘 좌표로 하므로
      // 포인터를 범위 밖으로 더 밀면 목록의 처음/끝 자리까지 닿을 수 있고, 범위 밖의 다른 목록에는 들어가지 않는다.
      s.px = clampRange(s.clientX, box.left, box.right - 1);
      s.py = clampRange(s.clientY, box.top, box.bottom - 1);
    }
    if (s.mirror) s.mirror.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  // ───────────────────────────── 위치 판정 ─────────────────────────────

  /** 포인터 아래의 목록을 찾아 그 목록이 항목을 받아들이게 한다 */
  private hitTest(s: Session): void {
    const hit = s.item.ownerDocument.elementFromPoint(s.px, s.py);
    s.hit = hit;
    let node: Element | null = hit;
    while (node) {
      const target = registry.get(node as HTMLElement);
      if (target && !s.item.contains(target.el) && target.accepts(s)) {
        target.over(s, hit as Element);
        return;
      }
      node = node.parentElement;
    }
  }

  /** 이 목록이 s 의 항목을 받을 수 있는지 (출발 목록은 언제든 돌아올 수 있다) */
  private accepts(s: Session): boolean {
    return !this.options.disabled && (this === s.source || !!this.transferMode(s));
  }

  private transferMode(s: Session): boolean | 'clone' {
    return checkTransfer(s.source.group, this.group, {
      from: s.source.el,
      to: this.el,
      item: s.item,
      originalEvent: s.lastEvent,
    });
  }

  private over(s: Session, hit: Element): void {
    const dragged = s.item;
    const inThisList = dragged.parentElement === this.el;
    if (inThisList && !this.options.sort) return; // 정렬이 꺼진 목록 안에서는 순서를 바꾸지 않는다

    const mode = this === s.source ? true : this.transferMode(s);
    if (!mode) return;

    const x = s.px;
    const y = s.py;
    const target = this.findItem(hit);
    if (target === dragged) return;

    let side: InsertSide;
    let ref: Node | null;

    // 포인터가 항목이 아닌 곳(여백, 항목 사이 틈, 목록 가장자리)에 있으면 가장 가까운 항목을 기준으로 삼는다.
    // 이렇게 하면 빈 곳에서도 일반 항목 위와 같은 '이동하는 방향으로 기준선을 넘었을 때만' 규칙이 적용되어,
    // 여러 줄 배치에서 같은 줄 이웃을 지나지 않았는데 맨 앞/맨 뒤로 튀는 일이 없다.
    const anchor =
      target ??
      this.nearestItem(dragged, x, y);

    if (!this.options.sort || !anchor) {
      // 정렬 없이 들어오는 목록이거나 비어 있는 목록: 맨 뒤에 넣는다
      const last = this.lastItem(dragged);
      side = 'after';
      ref = last ? last.nextSibling : null;
    } else {
      let axis = s.axes.get(this.el);
      if (!axis) {
        axis = detectAxis(this.el, anchor, this.options.direction);
        s.axes.set(this.el, axis);
      }
      const draggedBefore = inThisList
        ? !!(dragged.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)
        : null;
      // 이동 애니메이션 중인 요소의 위치는 이동 중간값이라 판정이 앞뒤로 뒤집혀 흔들린다. 끝난 뒤 다시 판정한다.
      if (isAnimating(anchor) || (inThisList && axis === 'horizontal' && isAnimating(dragged))) {
        s.retry = true;
        return;
      }
      const decided = decideSide(
        axis,
        anchor.getBoundingClientRect(),
        x,
        y,
        draggedBefore,
        this.options.swapThreshold,
        inThisList ? dragged.getBoundingClientRect() : undefined,
      );
      if (!decided) return;
      side = decided;
      ref = side === 'after' ? anchor.nextSibling : anchor;
    }

    const move: SortableMoveEvent = {
      dragged,
      from: s.source.el,
      to: this.el,
      related: anchor,
      willInsertAfter: side === 'after',
      originalEvent: s.lastEvent,
    };
    const veto = s.source.options.onMove?.call(s.source, move);
    if (veto === false) return;
    if (anchor && (veto === 1 || veto === -1)) ref = veto === 1 ? anchor.nextSibling : anchor;

    this.place(s, ref, mode);
  }

  /** excluded 를 뺀 마지막 항목. 끝에서부터 찾으므로 목록이 커도 거의 상수 시간이다 */
  private lastItem(excluded: HTMLElement): HTMLElement | undefined {
    const { draggable } = this.options;
    for (let el = this.el.lastElementChild; el; el = el.previousElementSibling) {
      if (el !== excluded && el instanceof HTMLElement && (!draggable || el.matches(draggable))) return el;
    }
    return undefined;
  }

  /**
   * (x, y) 에 가장 가까운 항목. 항목이 없으면 null.
   * 여러 줄로 배치된 목록에서는 유클리드 거리로 고르면 같은 줄의 이웃보다 세로로 가까운 다른 줄 항목이 뽑혀 엉뚱한 곳으로
   * 이동한다. 그래서 먼저 세로 거리가 가장 가까운 줄을 고르고(세로 목록에서는 항목마다 달라 그대로 가장 가까운 항목),
   * 같은 줄 안에서 가로 거리가 가장 가까운 항목을 고른다.
   */
  private nearestItem(excluded: HTMLElement, x: number, y: number): HTMLElement | null {
    const { draggable } = this.options;
    let best: HTMLElement | null = null;
    let bestDy = Infinity;
    let bestDx = Infinity;
    // 항목 배열을 따로 만들지 않고 자식을 직접 순회한다 (측정은 항목마다 한 번)
    for (let el = this.el.firstElementChild; el; el = el.nextElementSibling) {
      if (el === excluded || !(el instanceof HTMLElement) || (draggable && !el.matches(draggable))) continue;
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const sameRow = Math.abs(dy - bestDy) < 0.5; // 같은 줄은 세로 거리가 (거의) 같다
      if (dy < bestDy - 0.5 || (sameRow && dx < bestDx)) {
        best = el;
        bestDy = dy;
        bestDx = dx;
      }
    }
    return best;
  }

  /** 항목을 ref 앞에 넣는다 (ref 가 null 이면 맨 뒤). 이동 애니메이션과 복제본 처리를 함께 한다 */
  private place(s: Session, ref: Node | null, mode: boolean | 'clone'): void {
    const { item } = s;
    const fromEl = item.parentElement;
    if (fromEl === this.el && (ref === item || ref === item.nextSibling)) return; // 이미 그 자리

    const before = snapshotElements(this.movingElements(item, fromEl, ref));

    if (this === s.source || mode !== 'clone') this.removeClone(s);
    else this.putClone(s);

    disableScrollAnchoring(this.el, s.anchors); // 다른 목록(과 그 스크롤 조상)으로 들어올 때도 앵커링을 끈다
    this.el.insertBefore(item, ref);
    s.current = this;
    playFlip(before, s.source.options.animation, s.source.options.easing);
  }

  /**
   * item 을 ref 앞으로 옮길 때 자리가 달라지는 요소들. 큰 목록에서 전체를 측정하고 transform 을 쓰면 교체마다 수천 개를
   * 건드리므로, 위치가 실제로 바뀌는 구간만 고른다.
   * - 같은 목록: 이전 자리와 새 자리 사이의 요소들
   * - 다른 목록: 출발 목록에서 item 뒤의 요소들, 도착 목록에서 ref 와 그 뒤의 요소들
   * (item 앞쪽 요소는 줄바꿈이 있어도 누적 너비가 같아 움직이지 않는다)
   */
  private movingElements(item: HTMLElement, fromEl: HTMLElement | null, ref: Node | null): HTMLElement[] {
    const result: HTMLElement[] = [];
    // 목록 전체를 배열로 만들지 않고 형제 포인터만 따라가므로 비용이 이동 구간의 크기에만 비례한다
    const collect = (start: Element | null, stop: Element | null, includeStop: boolean): void => {
      for (let el = start; el; el = el.nextElementSibling) {
        if (el === stop && !includeStop) return;
        if (el instanceof HTMLElement) result.push(el);
        if (el === stop) return;
      }
    };
    // ref 가 텍스트/주석 노드일 수 있으므로 그 뒤의 첫 요소를 기준으로 삼는다
    let refEl: Node | null = ref;
    while (refEl && refEl.nodeType !== 1) refEl = refEl.nextSibling;
    const refElement = refEl as Element | null;

    if (fromEl === this.el) {
      // item 은 ref '앞'에 들어가므로 ref 자신은 움직이지 않는다.
      // 뒤로 가면 item 과 그 뒤 ~ ref 직전까지, 앞으로 가면 ref 부터 item 까지가 자리가 바뀐다
      if (!refElement || item.compareDocumentPosition(refElement) & Node.DOCUMENT_POSITION_FOLLOWING) {
        collect(item, refElement, false);
      } else {
        collect(refElement, item, true);
      }
    } else {
      if (fromEl) collect(item, null, true);
      collect(refElement, null, true);
    }
    return result;
  }

  /** pull: 'clone' — 항목이 출발 목록을 떠나는 순간 원래 자리에 복제본을 남긴다 */
  private putClone(s: Session): void {
    let created = false;
    if (!s.clone) {
      const clone = s.item.cloneNode(true) as HTMLElement;
      const { chosenClass, ghostClass } = s.source.options;
      toggleClasses(clone, chosenClass, false);
      toggleClasses(clone, ghostClass, false);
      s.clone = clone;
      created = true;
    }
    if (!s.clone.parentNode) {
      const home = s.source.el;
      // 항목이 아직 출발 목록에 있으면 그 자리에, 이미 다른 목록에 있으면 처음 자리(oldNext)에 둔다
      const ref =
        s.item.parentElement === home ? s.item : s.oldNext && s.oldNext.parentNode === home ? s.oldNext : null;
      home.insertBefore(s.clone, ref);
    }
    if (created) s.source.fire('clone', this.makeEvent(s));
  }

  private removeClone(s: Session): void {
    s.clone?.remove();
  }

  // ───────────────────────────── 종료 ─────────────────────────────

  private finish(s: Session, cancelled: boolean): void {
    if (activeSession !== s) return;
    activeSession = undefined;

    s.abort.abort();
    restoreScrollAnchoring(s.anchors);
    window.clearTimeout(s.timer);
    cancelAnimationFrame(s.raf);
    s.mirror?.remove();
    document.documentElement.classList.remove(CLS.dragging);

    const { source, item } = s;
    toggleClasses(item, source.options.chosenClass, false);
    toggleClasses(item, source.options.ghostClass, false);
    if (!s.active) return; // 드래그가 시작되지 않은 단순 클릭/취소

    if (cancelled) {
      const before = snapshotRects(new Set<Element>([s.current.el, source.el]));
      s.clone?.remove();
      const ref = s.oldNext && s.oldNext.parentNode === source.el ? s.oldNext : null;
      source.el.insertBefore(item, ref);
      s.current = source;
      playFlip(before, source.options.animation, source.options.easing);
      source.fire('end', { ...source.makeEvent(s), cancelled: true });
      return;
    }

    const evt = source.makeEvent(s);
    const target = s.current;
    if (target !== source) {
      source.fire('remove', evt);
      target.fire('add', evt);
      source.fire('sort', evt);
      target.fire('sort', evt);
    } else if (evt.newIndex !== evt.oldIndex) {
      source.fire('update', evt);
      source.fire('sort', evt);
    }
    source.fire('end', evt);
  }
}

/** selector 또는 요소에 Sortable 을 적용한다 */
export function createSortable(target: string | HTMLElement, options?: SortableOptions): Sortable {
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`Sortable: 요소를 찾을 수 없습니다: ${String(target)}`);
  return new Sortable(el, options);
}
