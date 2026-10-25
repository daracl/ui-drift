type Handler = (...args: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

/** 외부 의존성 없는 소형 이벤트 발행기 */
export class Emitter<Events extends { [K in keyof Events]: Handler }> {
  private handlers = new Map<keyof Events, Set<Handler>>();

  on<K extends keyof Events>(name: K, handler: Events[K]): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(handler);
    return () => this.off(name, handler);
  }

  once<K extends keyof Events>(name: K, handler: Events[K]): () => void {
    const off = this.on(name, ((...args: unknown[]) => {
      off();
      handler(...args);
    }) as Events[K]);
    return off;
  }

  off<K extends keyof Events>(name: K, handler?: Events[K]): void {
    if (!handler) this.handlers.delete(name);
    else this.handlers.get(name)?.delete(handler);
  }

  emit<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>): void {
    // 핸들러 안에서 off 해도 안전하도록 복사본을 순회한다
    Array.from(this.handlers.get(name) || []).forEach((handler) => handler(...args));
  }

  /** 해당 이름의 리스너가 있는지 (없으면 이벤트 페이로드 생성을 건너뛰기 위해 사용) */
  has<K extends keyof Events>(name: K): boolean {
    const set = this.handlers.get(name);
    return !!set && set.size > 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
