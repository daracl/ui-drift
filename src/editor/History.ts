/** 불변 스냅샷 기반 undo/redo 스택 */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  constructor(private limit = 100) {}

  /** 변경 직전 상태를 기록한다 (redo 는 비워진다) */
  push(snapshot: T): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: T): T | undefined {
    const prev = this.undoStack.pop();
    if (prev === undefined) return undefined;
    this.redoStack.push(current);
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.redoStack.pop();
    if (next === undefined) return undefined;
    this.undoStack.push(current);
    return next;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
