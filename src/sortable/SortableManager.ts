import { isString } from '@daracl/core/utils';
import { playFlip, snapshotRects } from '@/dom/flip';
import { Emitter } from '@/event/Emitter';
import type {
  SortableAccessContext,
  SortableContainerData,
  SortableEvent,
  SortableItemTransferEvent,
  SortableManagerOptions,
  SortableOptions,
  SortableTransferRequest,
  SortableTransferResult,
} from '@/sortable/types';
import { evaluateAccess } from './group';
import { ErrorCollector, Sortable } from './Sortable';

let sequence = 0;

export interface SortableManagerEvents {
  /** 목록이 등록되었다 */
  containerRegistered: (event: { containerId: string; sortable: Sortable }) => void;
  /** 목록 등록이 해제되었다 (Sortable 은 이미 destroy 되었다) */
  containerUnregistered: (event: { containerId: string }) => void;
  /** 활성 목록이 바뀌었다. 활성 대상이 없어지면 containerId/sortable 이 null */
  activeChange: (event: { containerId: string | null; previousId: string | null; sortable: Sortable | null }) => void;
  /** 어느 목록에서 드래그가 시작되었다 (목록의 start 이벤트) */
  start: (event: { containerId: string; event: SortableEvent }) => void;
  /** 어느 목록의 순서가 바뀌었다 (목록의 sort 이벤트, 목록 간 이동이면 두 목록에서 한 번씩) */
  sort: (event: { containerId: string; event: SortableEvent }) => void;
  /** 어느 목록에서 시작한 드래그가 끝났다 (목록의 end 이벤트, 취소면 event.cancelled) */
  end: (event: { containerId: string; event: SortableEvent }) => void;
  /** 항목이 다른 목록으로 옮겨졌다 (포인터 드래그, transferItem) */
  itemTransfer: (event: SortableItemTransferEvent) => void;
}

/** `fromJSON()` 옵션 */
export interface SortableManagerLoadOptions {
  /**
   * 데이터에 있지만 등록되지 않은 목록, 또는 어느 목록에도 없는 항목 id 를 어떻게 처리할지.
   * 'error'(기본): 아무것도 바꾸지 않고 예외. 'ignore': 그 목록/항목만 건너뛴다.
   * 목록이나 항목 요소를 새로 만들지는 않는다 (DOM 은 데이터만으로 알 수 없다).
   */
  unknown?: 'error' | 'ignore';
}

/** `transferItem()` 옵션 */
export interface SortableTransferOptions {
  /** itemTransfer 의 source (기본 'api') */
  source?: 'api' | 'user';
  /** 자리 이동 애니메이션 (도착 목록의 animation 옵션 사용, 기본 false) */
  animate?: boolean;
}

interface Entry {
  id: string;
  sortable: Sortable;
  /** 활성 감지 리스너 해제용 */
  abort: AbortController;
  /** Sortable 이벤트 구독 해제 함수들 */
  offs: (() => void)[];
}

const fail = (message: string): never => {
  throw new Error(`Sortable: ${message}`);
};

const incompatible = (containerId: string, key: string): never =>
  fail(`목록 "${containerId}" 이 관리할 수 없는 항목입니다 (draggable/dataIdAttr 불일치): ${key}`);

/** 출발 목록 속성(fromAttr)으로 읽던 id 를 도착 목록 속성(toAttr)으로도 같게 읽을 수 있는지 (id 가 없던 항목은 그대로 허용) */
function keepsId(item: HTMLElement, fromAttr: string, toAttr: string): boolean {
  if (fromAttr === toAttr) return true;
  const id = item.getAttribute(fromAttr);
  return id === null || item.getAttribute(toAttr) === id;
}

/**
 * 여러 개의 Sortable 목록을 하나의 그룹으로 등록·관리한다 (DriftManager 와 같은 형태).
 *
 * - Manager 마다 고유한 그룹 이름(`groupName`)을 만들어 등록 목록에 준다. 같은 Manager 의 목록끼리만 항목이 오가고,
 *   다른 Manager 나 Manager 밖의 Sortable 과는 섞이지 않는다. 목록별 pull(clone 포함)/put 규칙은 그대로 따른다.
 * - Manager 가 만든 Sortable 은 Manager 가 소유한다: unregister/destroy 가 Sortable 을 destroy 한다(목록 요소와 항목은 남는다).
 *   Sortable 을 직접 destroy 해도 등록이 정리된다.
 * - 활성 목록, 목록 이벤트 집계(containerId 포함), 목록 간 이동 API, 전체 순서 저장·복원을 제공한다.
 */
export class SortableManager {
  /** 등록 목록이 공유하는 그룹 이름 (pull/put 에 그룹 이름을 지정할 때 쓴다) */
  readonly groupName = `dsr-manager-${++sequence}`;

  private readonly entries = new Map<string, Entry>();
  private readonly byEl = new Map<HTMLElement, Entry>();
  private readonly emitter = new Emitter<SortableManagerEvents>();
  private activeId: string | null = null;
  private destroyed = false;
  private cross: boolean;
  private busy = false;

  constructor(options: SortableManagerOptions = {}) {
    this.cross = options.crossContainer !== false;
  }

  // ───────────────────────────── 등록 ─────────────────────────────

  /**
   * 목록을 등록하고 Sortable 을 만든다. 반환된 Sortable 은 Manager 가 소유한다.
   * @param id 목록 id (비어 있지 않은 문자열, Manager 안에서 유일)
   * @param target 목록 요소 또는 selector (`createSortable` 과 같은 규칙)
   * @param options Sortable 옵션. `group` 은 이름 없이 `{ pull, put }` 만 줄 수 있다 (이름은 Manager 가 정한다)
   */
  register(id: string, target: string | HTMLElement, options: SortableOptions = {}): Sortable {
    if (this.destroyed) fail('이미 destroy 된 manager 입니다.');
    if (!isString(id) || id.trim() === '') fail('목록 id 는 비어 있지 않은 문자열이어야 합니다.');
    if (this.entries.has(id)) fail(`이미 등록된 목록 id 입니다: ${id}`);
    const el = isString(target) ? document.querySelector<HTMLElement>(target) : target;
    if (!el || !(el instanceof HTMLElement)) return fail(`요소를 찾을 수 없습니다: ${String(target)}`);
    if (Sortable.get(el)) fail(`이미 Sortable 이 적용된 요소입니다: ${id}`);
    const group = options.group;
    if (isString(group) || (group && group.name !== undefined)) {
      fail('Manager 에 등록하는 목록은 group 이름을 지정할 수 없습니다 (pull/put 만 지정).');
    }

    const rules = isString(group) ? undefined : group;
    const userPut = rules?.put;
    const name = this.groupName;
    // 받는 쪽 규칙: Manager 의 목록 간 이동이 켜져 있고, 출발 목록이 이 Manager 의 목록이고, 이 목록의 dataIdAttr 로
    // 같은 id 를 읽을 수 있을 때만(저장에서 빠지지 않게) 목록의 put 규칙을 따른다
    const put = (ctx: SortableAccessContext): boolean => {
      const from = this.byEl.get(ctx.from);
      return (
        this.cross &&
        !this.destroyed &&
        !!from &&
        keepsId(ctx.item, from.sortable.options.dataIdAttr, sortable.options.dataIdAttr) &&
        !!evaluateAccess(userPut, false, { from: name, to: name }, ctx)
      );
    };
    const sortable = new Sortable(el, { ...options, group: { name, pull: rules?.pull, put } });

    const abort = new AbortController();
    const entry: Entry = { id, sortable, abort, offs: [] };
    entry.offs.push(sortable.addDestroyHook(() => this.remove(entry, false)));
    entry.offs.push(sortable.on('start', (event) => this.forward('start', entry, event)));
    entry.offs.push(sortable.on('sort', (event) => this.forward('sort', entry, event)));
    entry.offs.push(sortable.on('end', (event) => this.onEnd(entry, event)));
    // 목록을 누르거나 포커스가 들어오면 활성으로 만든다
    const opts = { signal: abort.signal, capture: true };
    el.addEventListener('pointerdown', () => this.activate(id), opts);
    el.addEventListener('focusin', () => this.activate(id), opts);

    this.entries.set(id, entry);
    this.byEl.set(el, entry);
    this.emitter.emit('containerRegistered', { containerId: id, sortable });
    return sortable;
  }

  /** 목록 등록을 해제하고 Sortable 을 destroy 한다 (진행 중인 관련 드래그는 원래 자리로 취소된다). 없는 id 면 false */
  unregister(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.remove(entry, true);
    return true;
  }

  private remove(entry: Entry, destroySortable: boolean): void {
    // 재진입(콜백 안의 unregister, Sortable 직접 destroy)에도 한 번만 처리되도록 등록부터 지운다
    if (this.entries.get(entry.id) !== entry) return;
    this.entries.delete(entry.id);
    this.byEl.delete(entry.sortable.el);
    entry.abort.abort();
    const errors = new ErrorCollector();
    entry.offs.forEach((off) => errors.run(off));
    if (this.activeId === entry.id) errors.run(() => this.activate(null));
    if (destroySortable) errors.run(() => entry.sortable.destroy());
    errors.run(() => this.emitter.emit('containerUnregistered', { containerId: entry.id }));
    errors.throw();
  }

  // ───────────────────────────── 조회 / 활성 ─────────────────────────────

  get(id: string): Sortable | undefined {
    return this.entries.get(id)?.sortable;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** 등록 순서의 목록 id */
  getIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /** 등록 순서의 `{ id, sortable }` */
  getAll(): { id: string; sortable: Sortable }[] {
    return Array.from(this.entries.values(), (e) => ({ id: e.id, sortable: e.sortable }));
  }

  /** 목록 요소 또는 Sortable 의 id (이 Manager 에 없으면 undefined) */
  getIdOf(target: HTMLElement | Sortable): string | undefined {
    return this.byEl.get(target instanceof Sortable ? target.el : target)?.id;
  }

  /** 활성 목록을 지정한다. null 이면 없음. 등록되지 않은 id 는 예외 */
  setActive(id: string | null): void {
    if (this.destroyed) return;
    if (id !== null && !this.entries.has(id)) fail(`등록되지 않은 목록입니다: ${id}`);
    this.activate(id);
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getActive(): Sortable | null {
    return this.activeId ? this.entries.get(this.activeId)?.sortable ?? null : null;
  }

  private activate(id: string | null): void {
    if (this.activeId === id) return;
    const previousId = this.activeId;
    this.activeId = id;
    this.emitter.emit('activeChange', { containerId: id, previousId, sortable: this.getActive() });
  }

  // ───────────────────────────── 목록 간 이동 ─────────────────────────────

  /** 목록 사이의 포인터 이동을 켜고 끈다. 끄면 다른 목록으로 들어가 있던 진행 중 드래그는 원래 자리로 취소된다 */
  setCrossContainer(enabled: boolean): void {
    if (this.destroyed) return;
    this.cross = enabled === true;
    if (this.cross) return;
    const info = Sortable.dragInfo();
    if (info && info.source !== info.current && this.byEl.has(info.source.el)) info.source.cancel();
  }

  isCrossContainer(): boolean {
    return this.cross;
  }

  /** 이 Manager 의 목록이 관련된 진행 중 드래그를 취소한다 (원래 자리로) */
  cancelDrag(): void {
    const info = Sortable.dragInfo();
    if (info && (this.byEl.has(info.source.el) || this.byEl.has(info.current.el))) info.source.cancel();
  }

  /**
   * 항목을 다른 목록으로 옮긴다 (프로그램 이동). 포인터 이동의 옵션(crossContainer, pull/put)과 무관하다.
   * 각 목록에 드래그와 같은 remove(출발) → add(도착) → sort(출발) → sort(도착) 이벤트를 낸 뒤 itemTransfer 를 낸다.
   * 리스너 예외는 완료된 이동을 되돌리지 않고, 나머지 알림 뒤 첫 예외를 던진다.
   * - index: 도착 목록의 draggable 항목 기준 위치. 생략하면 맨 뒤, 항목 수보다 크면 맨 뒤. 음수/정수가 아니면 예외.
   * - 거절: { moved: false, reason } (아무것도 바꾸지 않는다). 도착 목록이 관리할 수 없는 항목은 incompatible-item.
   */
  transferItem(request: SortableTransferRequest, options: SortableTransferOptions = {}): SortableTransferResult {
    if (!request || typeof request !== 'object') fail('transferItem 에는 요청 객체가 필요합니다.');
    const { from, to, itemId, index } = request;
    if (!isString(from) || !isString(to) || !isString(itemId)) {
      fail('transferItem: from, to, itemId 는 문자열이어야 합니다.');
    }
    if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
      fail('transferItem: index 는 0 이상의 정수여야 합니다.');
    }
    const source = options.source ?? 'api';
    if (source !== 'api' && source !== 'user') fail(`transferItem: 알 수 없는 source 입니다: ${String(source)}`);

    const reject = (reason: Extract<SortableTransferResult, { moved: false }>['reason']): SortableTransferResult => ({
      moved: false,
      reason,
    });
    if (this.destroyed) return reject('destroyed');
    // 진행 중인 드래그의 자리 표시자와 섞이지 않게 드래그 중에는 받지 않는다
    if (this.busy || Sortable.isDragging()) return reject('busy');
    const fromEntry = this.entries.get(from);
    const toEntry = this.entries.get(to);
    if (!fromEntry || !toEntry) return reject('missing-container');
    if (fromEntry === toEntry) return reject('same-container');
    const S = fromEntry.sortable;
    const T = toEntry.sortable;
    if (!S.el.isConnected || !T.el.isConnected) return reject('disconnected');
    const attr = S.options.dataIdAttr;
    const sourceItems = S.items();
    const matches = sourceItems.filter((el) => el.getAttribute(attr) === itemId);
    if (matches.length === 0) return reject('missing-item');
    if (matches.length > 1) return reject('duplicate-item');
    const item = matches[0];
    const oldIndex = sourceItems.indexOf(item);

    const targetItems = T.items();
    // 도착 목록이 관리할 수 없는 항목(draggable 불일치, dataIdAttr 로 같은 id 를 읽을 수 없음)은 넣지 않는다.
    // 넣으면 도착 items()/toArray()/저장에서 빠진다. 항목의 class/속성은 바꾸지 않는다 (호출자가 준비 후 다시 요청)
    if (item.getAttribute(T.options.dataIdAttr) !== itemId || !T.canManage(item)) return reject('incompatible-item');
    const at = Math.min(index ?? targetItems.length, targetItems.length);
    const last = targetItems[targetItems.length - 1];
    const ref = targetItems[at] ?? (last ? last.nextSibling : null);
    const oldNext = item.nextSibling;

    this.busy = true;
    const errors = new ErrorCollector();
    let newIndex = -1;
    try {
      const before = options.animate ? snapshotRects(new Set<Element>([S.el, T.el])) : undefined;
      T.el.insertBefore(item, ref);
      newIndex = T.items().indexOf(item);
      if (newIndex < 0) {
        // 위치에 따라 판정이 달라지는 selector(:first-child 등)로 실제 자리에서 관리되지 않으면 원래 자리로 되돌린다
        S.el.insertBefore(item, oldNext);
        return reject('incompatible-item');
      }
      if (before) playFlip(before, T.options.animation, T.options.easing);
      const evt: SortableEvent = { item, from: S.el, to: T.el, oldIndex, newIndex };
      errors.run(() => S.dispatch('remove', evt));
      errors.run(() => T.dispatch('add', evt));
      errors.run(() => S.dispatch('sort', evt));
      errors.run(() => T.dispatch('sort', evt));
      if (this.entries.get(to) === toEntry) errors.run(() => this.activate(to));
      errors.run(() =>
        this.emitter.emit('itemTransfer', {
          from,
          to,
          item,
          itemId,
          oldIndex,
          newIndex,
          mode: 'move',
          source,
        }),
      );
    } finally {
      this.busy = false;
    }
    errors.throw();
    return { moved: true, from, to, item, oldIndex, newIndex };
  }

  // ───────────────────────────── 저장 / 복원 ─────────────────────────────

  /** 등록 순서대로 각 목록의 항목 순서(dataIdAttr 값)를 묶어 돌려준다 */
  getOrders(): SortableContainerData {
    return {
      version: 1,
      containers: Array.from(this.entries.values(), (e) => ({ id: e.id, order: e.sortable.toArray() })),
    };
  }

  toJSON(space?: number): string {
    return JSON.stringify(this.getOrders(), null, space);
  }

  /**
   * 저장한 순서(JSON 또는 객체)로 등록된 목록의 항목을 다시 배치한다. 목록 사이에 옮겨진 항목도 원래 목록으로 돌아간다.
   * 복원한 목록 id 를 반환한다.
   * - 전체를 먼저 검증한다: 구조, version, 빈/중복 목록 id, 데이터 안의 중복 항목 id, 미등록 목록·없는 항목(unknown:'error'),
   *   여러 목록에 같은 id 가 있어 어느 요소인지 알 수 없는 경우, 도착 목록이 관리할 수 없는 항목(dataIdAttr/draggable 불일치,
   *   unknown 과 무관하게 예외). 오류면 아무것도 바꾸지 않는다 (옮긴 뒤 draggable 판정이 깨지면 모든 목록을 되돌린 뒤 예외).
   * - 데이터에 있는 목록은 데이터 순서의 항목 뒤에, 데이터 어디에도 없는 그 목록의 기존 항목을 원래 순서대로 둔다.
   *   데이터에 없는 목록은 (다른 목록으로 옮겨진 항목을 빼면) 그대로다.
   * - 목록 이벤트(add/remove/sort)는 내지 않는다. 드래그 중에는 예외.
   */
  fromJSON(input: string | SortableContainerData, options: SortableManagerLoadOptions = {}): string[] {
    if (this.destroyed) return [];
    if (this.busy || Sortable.isDragging()) fail('드래그 중에는 순서를 복원할 수 없습니다.');
    const data = parseSortableData(input);
    const ignore = options.unknown === 'ignore';

    const missing = data.containers.filter((c) => !this.entries.has(c.id)).map((c) => c.id);
    if (missing.length && !ignore) fail(`등록되지 않은 목록입니다: ${missing.join(', ')}`);
    const targets = data.containers.filter((c) => this.entries.has(c.id));

    // 항목 id → 요소 (모든 등록 목록에서, 각 목록의 dataIdAttr 기준)
    const found = new Map<string, HTMLElement[]>();
    for (const entry of this.entries.values()) {
      const attr = entry.sortable.options.dataIdAttr;
      for (const el of entry.sortable.items()) {
        const key = el.getAttribute(attr);
        if (key === null) continue;
        const list = found.get(key);
        if (list) list.push(el);
        else found.set(key, [el]);
      }
    }
    const plan = targets.map((c) => {
      const entry = this.entries.get(c.id) as Entry;
      const elements: HTMLElement[] = [];
      for (const key of c.order) {
        const els = found.get(key);
        if (!els) {
          if (!ignore) fail(`어느 목록에도 없는 항목 id 입니다: ${key}`);
          continue;
        }
        if (els.length > 1) fail(`여러 목록(또는 한 목록)에 같은 항목 id 가 있어 복원할 수 없습니다: ${key}`);
        // 도착 목록의 dataIdAttr 로 같은 id 를 읽을 수 없으면 복원 뒤 저장에서 빠진다
        if (els[0].getAttribute(entry.sortable.options.dataIdAttr) !== key) incompatible(c.id, key);
        elements.push(els[0]);
      }
      return { entry, elements };
    });

    // 각 목록에 남길 기존 항목: 데이터 어디에서도 지정하지 않은 항목 (옮기기 전에 계산한다)
    const placed = new Set(plan.flatMap((p) => p.elements));
    const keep = plan.map((p) => p.entry.sortable.items().filter((el) => !placed.has(el)));
    const managedItems = (): Set<HTMLElement> =>
      new Set(Array.from(this.entries.values(), (e) => e.sortable.items()).flat());
    const before = managedItems();

    // 옮기기 전 각 목록의 자식 노드를 기억해 두었다가, 옮긴 뒤 관리 판정(draggable 은 부모 문맥에 따라 다를 수 있다)에서
    // 빠지는 항목이 생기면 모든 목록을 원래대로 되돌린다. 일부 목록만 바뀐 상태를 남기지 않는다
    const saved = Array.from(this.entries.values(), (e) => ({
      host: e.sortable.el,
      nodes: Array.from(e.sortable.el.childNodes),
    }));
    plan.forEach((p, i) => {
      const host = p.entry.sortable.el;
      p.elements.forEach((el) => host.appendChild(el));
      keep[i].forEach((el) => host.appendChild(el));
    });
    const after = managedItems();
    const lost = Array.from(before).find((el) => !after.has(el));
    if (lost) {
      saved.forEach(({ host, nodes }) => host.append(...nodes));
      const owner =
        plan.find((p) => p.elements.includes(lost))?.entry ?? this.byEl.get(lost.parentElement as HTMLElement);
      incompatible(owner?.id ?? '', lost.getAttribute(owner?.sortable.options.dataIdAttr ?? 'data-id') ?? '');
    }
    return plan.map((p) => p.entry.id);
  }

  // ───────────────────────────── 이벤트 ─────────────────────────────

  on<K extends keyof SortableManagerEvents>(name: K, handler: SortableManagerEvents[K]): () => void {
    return this.emitter.on(name, handler);
  }

  once<K extends keyof SortableManagerEvents>(name: K, handler: SortableManagerEvents[K]): () => void {
    return this.emitter.once(name, handler);
  }

  off<K extends keyof SortableManagerEvents>(name: K, handler?: SortableManagerEvents[K]): void {
    this.emitter.off(name, handler);
  }

  private forward(name: 'start' | 'sort', entry: Entry, event: SortableEvent): void {
    if (this.entries.get(entry.id) === entry) this.emitter.emit(name, { containerId: entry.id, event });
  }

  /** 드래그가 끝났다: end 를 전달하고, 다른 목록으로 옮겨졌으면 도착 목록을 활성으로 만들고 itemTransfer 를 낸다 */
  private onEnd(entry: Entry, event: SortableEvent): void {
    if (this.entries.get(entry.id) !== entry) return;
    const errors = new ErrorCollector();
    errors.run(() => this.emitter.emit('end', { containerId: entry.id, event }));
    const to = this.byEl.get(event.to);
    if (!event.cancelled && to && event.to !== event.from) {
      errors.run(() => this.activate(to.id));
      const attr = entry.sortable.options.dataIdAttr;
      errors.run(() =>
        this.emitter.emit('itemTransfer', {
          from: entry.id,
          to: to.id,
          item: event.item,
          itemId: event.item.getAttribute(attr) ?? '',
          oldIndex: event.oldIndex,
          newIndex: event.newIndex,
          mode: event.clone ? 'clone' : 'move',
          source: 'user',
        }),
      );
    }
    errors.throw();
  }

  // ───────────────────────────── 해제 ─────────────────────────────

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** 모든 목록의 Sortable 을 destroy 한다(진행 중 드래그는 취소). 두 번 호출해도 안전. 끝나면 모든 리스너가 제거된다 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const errors = new ErrorCollector();
    for (const entry of Array.from(this.entries.values())) errors.run(() => this.remove(entry, true));
    this.emitter.clear();
    errors.throw();
  }
}

/** 순서 저장 데이터(JSON 문자열 또는 객체)를 검증해 복사본을 돌려준다 */
export function parseSortableData(input: string | unknown): SortableContainerData {
  let data: unknown = input;
  if (isString(input)) {
    try {
      data = JSON.parse(input);
    } catch (e) {
      fail('순서 데이터 JSON 을 해석할 수 없습니다.');
    }
  }
  const obj = data as { version?: unknown; containers?: unknown };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('순서 데이터는 객체여야 합니다.');
  if (obj.version !== 1) fail(`지원하지 않는 순서 데이터 version: ${String(obj.version)}`);
  if (!Array.isArray(obj.containers)) fail('containers 는 배열이어야 합니다.');
  const ids = new Set<string>();
  const items = new Set<string>();
  const containers = (obj.containers as unknown[]).map((raw, i) => {
    const c = raw as { id?: unknown; order?: unknown };
    if (!c || typeof c !== 'object') fail(`containers[${i}] 는 객체여야 합니다.`);
    if (!isString(c.id) || c.id.trim() === '') fail('목록 id 는 비어 있지 않은 문자열이어야 합니다.');
    const id = c.id as string;
    if (ids.has(id)) fail(`중복된 목록 id 입니다: ${id}`);
    ids.add(id);
    if (!Array.isArray(c.order) || !c.order.every(isString)) fail(`목록 "${id}" 의 order 는 문자열 배열이어야 합니다.`);
    const order = (c.order as string[]).slice();
    for (const key of order) {
      if (items.has(key)) fail(`같은 항목 id 가 데이터에 두 번 있습니다: ${key}`);
      items.add(key);
    }
    return { id, order };
  });
  return { version: 1, containers };
}

/** SortableManager 를 만든다 */
export function createSortableManager(options: SortableManagerOptions = {}): SortableManager {
  return new SortableManager(options);
}
