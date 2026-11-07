import type { DriftApplyOptions } from '@t/DriftEditor';

/**
 * 이력 항목에 붙는 연결 기록. 두 에디터가 같은 작업(컨테이너 간 이동)을 함께 되돌리거나 다시 적용할 때 쓴다.
 * 구현은 DriftManager 가 제공한다. History 는 연결 기록이 스택에서 사라질 때 `drop()` 을 알려 주기만 한다.
 */
export interface HistoryLink {
  readonly id: string;
  /** 이 연결 기록이 아직 유효한지 (무효화되면 어느 쪽에서도 실행할 수 없다) */
  readonly alive: boolean;
  /** 한쪽 스택에서 이 기록이 버려졌다 (redo 무효화, 이력 제한 초과, clear). 상대 스택을 안전하게 절단해야 한다 */
  drop(): void;
  /** 이 기록이 양쪽 스택의 맨 위에 있어 지금 undo/redo 할 수 있는지 */
  canRun(kind: 'undo' | 'redo'): boolean;
  /** 양쪽 에디터를 한 번에 undo/redo 한다. 실행하지 못하면 false */
  run(kind: 'undo' | 'redo', opts?: DriftApplyOptions): boolean;
}

export interface HistoryEntry<T> {
  state: T;
  link?: HistoryLink;
}

/** 내보낸 스택 (트랜잭션 실패 시 그대로 복원하기 위한 복사본) */
export interface HistorySnapshot<T> {
  undo: HistoryEntry<T>[];
  redo: HistoryEntry<T>[];
}

/** 불변 스냅샷 기반 undo/redo 스택 */
export class History<T> {
  private undoStack: HistoryEntry<T>[] = [];
  private redoStack: HistoryEntry<T>[] = [];

  constructor(private limit = 100) {}

  /** 변경 직전 상태를 기록한다 (redo 는 비워진다) */
  push(snapshot: T, link?: HistoryLink): void {
    this.undoStack.push(link ? { state: snapshot, link } : { state: snapshot });
    const dropped: HistoryEntry<T>[] = [];
    if (this.undoStack.length > this.limit) dropped.push(this.undoStack.shift() as HistoryEntry<T>);
    dropped.push(...this.redoStack);
    this.redoStack = [];
    this.dropLinks(dropped);
  }

  undo(current: T): T | undefined {
    const prev = this.undoStack.pop();
    if (prev === undefined) return undefined;
    // 연결 기록은 redo 쪽으로 함께 옮겨 간다 (다시 적용할 때도 양쪽을 한 번에)
    this.redoStack.push(prev.link ? { state: current, link: prev.link } : { state: current });
    return prev.state;
  }

  redo(current: T): T | undefined {
    const next = this.redoStack.pop();
    if (next === undefined) return undefined;
    this.undoStack.push(next.link ? { state: current, link: next.link } : { state: current });
    return next.state;
  }

  /** 다음 undo/redo 항목의 연결 기록 */
  peekLink(kind: 'undo' | 'redo'): HistoryLink | undefined {
    const stack = kind === 'undo' ? this.undoStack : this.redoStack;
    return stack[stack.length - 1]?.link;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    const dropped = [...this.undoStack, ...this.redoStack];
    this.undoStack = [];
    this.redoStack = [];
    this.dropLinks(dropped);
  }

  /**
   * 연결 기록 link 와, 그것을 가로질러야만 도달하는 항목을 버린다.
   * undo 스택에서는 link 와 그보다 오래된 항목, redo 스택에서는 link 와 그보다 먼 미래의 항목이다.
   * (상대 컨테이너가 이 작업을 되돌릴 수 없게 된 뒤 이쪽만 그 이전 상태로 돌아가면 항목이 복제되거나 사라진다)
   */
  cut(link: HistoryLink): void {
    const cutStack = (stack: HistoryEntry<T>[]) => {
      // 스택은 바닥(index 0)이 가장 멀다. link 가 있는 가장 위쪽 위치까지 바닥부터 버린다
      let at = -1;
      stack.forEach((entry, i) => entry.link === link && (at = i));
      return at < 0 ? { kept: stack, dropped: [] } : { kept: stack.slice(at + 1), dropped: stack.slice(0, at + 1) };
    };
    const u = cutStack(this.undoStack);
    const r = cutStack(this.redoStack);
    this.undoStack = u.kept;
    this.redoStack = r.kept;
    // 함께 버려진 다른 연결 기록도 상대 쪽에서 절단해야 한다
    this.dropLinks([...u.dropped, ...r.dropped].filter((entry) => entry.link !== link));
  }

  /** 스택 복사본 (트랜잭션 롤백용) */
  export(): HistorySnapshot<T> {
    return { undo: this.undoStack.slice(), redo: this.redoStack.slice() };
  }

  /** export() 로 받은 스택을 그대로 되돌린다. 연결 기록 무효화는 하지 않는다 */
  restore(snapshot: HistorySnapshot<T>): void {
    this.undoStack = snapshot.undo.slice();
    this.redoStack = snapshot.redo.slice();
  }

  private dropLinks(entries: HistoryEntry<T>[]): void {
    const seen = new Set<HistoryLink>();
    for (const entry of entries) {
      if (entry.link && !seen.has(entry.link)) {
        seen.add(entry.link);
        entry.link.drop();
      }
    }
  }
}
