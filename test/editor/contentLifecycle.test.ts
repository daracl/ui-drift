import { createDriftEditor, DriftContentLifecycle, DriftEditor, DriftEditorOptions, DriftItem } from '@/index';
import { mockRects } from './_helpers';

describe('콘텐츠 수명 (contentLifecycle)', () => {
  let container: HTMLElement;
  let editor: DriftEditor;
  let spy: jest.SpyInstance;
  let log: string[];

  /** Grid/Chart 같은 외부 위젯 인스턴스를 흉내 낸다: 생성/해제 횟수와 시점을 기록한다 */
  const widgets = new Map<string, { id: string; el: HTMLElement; destroyed: number; updates: number }>();
  const lifecycle = (extra: Partial<DriftContentLifecycle> = {}): DriftContentLifecycle => ({
    mount(item, contentEl) {
      log.push(`mount:${item.id}`);
      const node = document.createElement('div');
      node.className = 'widget';
      node.textContent = `W(${item.content})`;
      contentEl.appendChild(node);
      const w = { id: item.id, el: node, destroyed: 0, updates: 0 };
      widgets.set(item.id, w);
      return () => {
        w.destroyed++;
        log.push(`cleanup:${item.id}`);
      };
    },
    update(item, contentEl, previous) {
      log.push(`update:${item.id}:${previous.content}->${item.content}`);
      const w = widgets.get(item.id)!;
      w.updates++;
      w.el.textContent = `W(${item.content})`;
    },
    unmount(item, contentEl) {
      // 호출 시점에 위젯 DOM 이 아직 남아 있어야 외부 인스턴스를 안전하게 해제할 수 있다
      log.push(
        `unmount:${item.id}:dom=${contentEl.querySelector('.widget') ? 'alive' : 'gone'}:connected=${
          contentEl.isConnected
        }`,
      );
    },
    ...extra,
  });

  const create = (options: DriftEditorOptions = {}, life: DriftContentLifecycle = lifecycle()) => {
    editor = createDriftEditor(container, {
      layout: {
        columns: 12,
        items: [
          { id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'ca', title: 'TA', props: { k: 1 } },
          { id: 'b', x: 4, y: 0, w: 4, h: 2, content: 'cb' },
        ],
      },
      contentLifecycle: life,
      ...options,
    });
    return editor;
  };
  const el = (id: string) => container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
  const count = (prefix: string) => log.filter((l) => l.startsWith(prefix)).length;

  beforeEach(() => {
    spy = mockRects();
    log = [];
    widgets.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    try {
      editor?.destroy();
    } catch (e) {
      /* 일부 테스트는 destroy 중 예외를 의도적으로 만든다 */
    }
    container.remove();
    spy.mockRestore();
  });

  it('항목마다 mount 가 한 번 호출되고 contentEl 은 비어 있으며 item 은 복사본이다', () => {
    let seen: DriftItem | undefined;
    let emptyAtMount = false;
    create(
      {},
      lifecycle({
        mount(item, contentEl) {
          emptyAtMount = contentEl.childNodes.length === 0;
          seen = item;
          item.x = 999; // 복사본을 바꿔도 내부 상태에는 영향이 없다
          if (item.props) (item.props as Record<string, unknown>).k = 5;
        },
      }),
    );
    expect(emptyAtMount).toBe(true);
    expect(editor.getItem('a')).toMatchObject({ x: 0, props: { k: 1 } });
    expect(seen).toBeDefined();
  });

  it('위치/크기/선택/잠금 변경만으로는 mount/update/unmount 를 호출하지 않고 DOM 도 유지한다', () => {
    create();
    log.length = 0;
    const widgetNode = widgets.get('a')!.el;
    editor.moveItem('a', 8, 4);
    editor.resizeItem('a', 6, 3);
    editor.select('a');
    editor.updateItem('a', { locked: true });
    editor.updateItem('a', { locked: false, resizable: false });
    editor.setFloat(true);
    editor.refresh();
    editor.setBreakpoint('mobile');
    editor.setBreakpoint(null);
    expect(log).toEqual([]);
    expect(widgets.get('a')!.el).toBe(widgetNode);
    expect(widgetNode.isConnected).toBe(true);
  });

  it('title/content/props 가 바뀌면 update 가 한 번 호출되고 위젯 인스턴스는 그대로다', () => {
    create();
    log.length = 0;
    editor.updateItem('a', { content: 'new' });
    expect(log).toEqual(['update:a:ca->new']);
    editor.updateItem('a', { title: 'T2' });
    expect(count('update:a')).toBe(2);
    editor.updateItem('a', { props: { k: 2 } });
    expect(count('update:a')).toBe(3);
    expect(widgets.get('a')!.destroyed).toBe(0);
    expect(count('mount:a')).toBe(0); // 다시 만들지 않았다
    expect(el('a').querySelector('.ddr-title')!.textContent).toBe('T2');
  });

  it('내용이 같은 값/같은 내용의 새 props 객체로는 update 하지 않는다', () => {
    create();
    log.length = 0;
    editor.updateItem('a', { content: 'ca' });
    editor.updateItem('a', { props: { k: 1 } });
    editor.updateItem('a', { title: 'TA' });
    expect(log).toEqual([]);
  });

  it('update 훅이 없으면 unmount → 비우기 → mount 순서로 다시 만든다', () => {
    const order: string[] = [];
    create(
      {},
      {
        mount(item, contentEl) {
          order.push(`mount(childCount=${contentEl.childNodes.length})`);
          contentEl.appendChild(document.createElement('i'));
          return () => order.push('cleanup');
        },
        unmount() {
          order.push('unmount');
        },
      },
    );
    order.length = 0;
    editor.updateItem('a', { content: 'changed' });
    expect(order).toEqual(['unmount', 'cleanup', 'mount(childCount=0)']);
  });

  it('항목 제거 시 DOM 을 지우기 전에 unmount 가 한 번 호출된다', () => {
    create();
    log.length = 0;
    editor.removeItem('b');
    expect(log).toEqual(['unmount:b:dom=alive:connected=true', 'cleanup:b']);
    expect(el('b')).toBeNull();
    editor.removeItem('b'); // 이미 없는 항목: 중복 호출 없음
    expect(count('unmount:b')).toBe(1);
  });

  it('clear/load 로 전체를 교체하면 사라지는 항목만 해제하고, 내용이 같은 항목은 유지한다', () => {
    create();
    log.length = 0;
    editor.load({
      columns: 12,
      items: [
        { id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'ca', title: 'TA', props: { k: 1 } }, // 같은 내용
        { id: 'z', x: 4, y: 0, w: 4, h: 2, content: 'cz' },
      ],
    });
    expect(log.sort()).toEqual(['cleanup:b', 'mount:z', 'unmount:b:dom=alive:connected=true']);

    log.length = 0;
    editor.clear();
    expect(count('unmount:a')).toBe(1);
    expect(count('unmount:z')).toBe(1);
    expect(count('cleanup:')).toBe(2);
    expect(container.querySelectorAll('.ddr-item')).toHaveLength(0);
  });

  it('undo/redo 로 항목이 사라지고 되살아나면 해제/재생성이 정확히 한 번씩 일어난다', () => {
    create();
    editor.addItem({ id: 'n', w: 2, h: 2, content: 'cn' });
    const first = widgets.get('n')!;
    log.length = 0;
    editor.undo(); // n 제거
    expect(log).toEqual(['unmount:n:dom=alive:connected=true', 'cleanup:n']);
    log.length = 0;
    editor.redo(); // n 복구
    expect(log).toEqual(['mount:n']);
    expect(first.destroyed).toBe(1); // 이전 인스턴스는 한 번 해제되었고
    expect(widgets.get('n')).not.toBe(first); // 새 인스턴스가 만들어졌다
    expect(widgets.get('n')!.destroyed).toBe(0);
  });

  it('destroy 는 DOM 을 지우기 전에 모든 항목을 한 번씩 해제하고, 두 번 호출해도 중복 해제하지 않는다', () => {
    create();
    log.length = 0;
    editor.destroy();
    expect(log.sort()).toEqual([
      'cleanup:a',
      'cleanup:b',
      'unmount:a:dom=alive:connected=true',
      'unmount:b:dom=alive:connected=true',
    ]);
    editor.destroy();
    expect(log).toHaveLength(4);
    expect([...widgets.values()].every((w) => w.destroyed === 1)).toBe(true);
  });

  it('반복 렌더(refresh/resize)로 mount 가 중복 호출되지 않는다', () => {
    create();
    for (let i = 0; i < 5; i++) editor.refresh();
    expect(count('mount:')).toBe(2);
  });

  it('mount/unmount 가 예외를 던져도 렌더가 끝난 뒤 첫 예외만 다시 던지고 나머지 항목은 정상 처리한다', () => {
    const calls: string[] = [];
    editor = createDriftEditor(container, {
      layout: {
        columns: 12,
        items: [
          { id: 'a', x: 0, y: 0, w: 4, h: 2 },
          { id: 'b', x: 4, y: 0, w: 4, h: 2 },
        ],
      },
      contentLifecycle: {
        mount: (item) => {
          calls.push(`mount:${item.id}`);
        },
      },
    }) as DriftEditor;
    editor.destroy();
    container.innerHTML = '';
    calls.length = 0;

    expect(() => {
      editor = createDriftEditor(container, {
        layout: {
          columns: 12,
          items: [
            { id: 'a', x: 0, y: 0, w: 4, h: 2 },
            { id: 'b', x: 4, y: 0, w: 4, h: 2 },
          ],
        },
        contentLifecycle: {
          mount: (item) => {
            calls.push(`mount:${item.id}`);
            if (item.id === 'a') throw new Error('mount-a 실패');
          },
          unmount: (item) => {
            calls.push(`unmount:${item.id}`);
            throw new Error(`unmount-${item.id} 실패`);
          },
        },
      });
    }).toThrow('mount-a 실패');
    // 첫 항목이 실패해도 두 번째 항목은 만들어졌다
    expect(calls).toEqual(['mount:a', 'mount:b']);
    expect(container.querySelectorAll('.ddr-item')).toHaveLength(2);
  });

  it('unmount 예외가 있어도 다른 항목의 해제는 계속되고 destroy 가 끝난 뒤 예외를 던진다', () => {
    const calls: string[] = [];
    editor = createDriftEditor(container, {
      layout: {
        columns: 12,
        items: [
          { id: 'a', x: 0, y: 0, w: 4, h: 2 },
          { id: 'b', x: 4, y: 0, w: 4, h: 2 },
        ],
      },
      contentLifecycle: {
        mount: () => undefined,
        unmount: (item) => {
          calls.push(`unmount:${item.id}`);
          throw new Error(`unmount-${item.id}`);
        },
      },
    });
    expect(() => editor.destroy()).toThrow('unmount-a');
    expect(calls).toEqual(['unmount:a', 'unmount:b']); // b 도 해제되었다
    expect(container.querySelector('.daracl-drift')).toBeNull(); // 정리는 끝까지 수행되었다
  });

  describe('기존 renderItem 과의 호환', () => {
    it('contentLifecycle 이 없으면 renderItem 이 기존처럼 생성/내용 변경 때만 호출된다', () => {
      const renderItem = jest.fn((item: DriftItem, contentEl: HTMLElement) => {
        contentEl.textContent = `R(${item.content})`;
      });
      editor = createDriftEditor(container, {
        layout: { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'ca' }] },
        renderItem,
      });
      editor.moveItem('a', 4, 0);
      editor.resizeItem('a', 6, 2);
      editor.select('a');
      expect(renderItem).toHaveBeenCalledTimes(1);
      editor.updateItem('a', { content: 'x' });
      expect(renderItem).toHaveBeenCalledTimes(2);
      expect(el('a').querySelector('.ddr-content')!.textContent).toBe('R(x)');
    });

    it('둘 다 지정하면 contentLifecycle 이 우선하고 renderItem 은 호출되지 않는다', () => {
      const renderItem = jest.fn();
      create({ renderItem });
      expect(renderItem).not.toHaveBeenCalled();
      expect(count('mount:')).toBe(2);
    });

    it('아무것도 지정하지 않으면 content(없으면 id)를 텍스트로 표시한다', () => {
      editor = createDriftEditor(container, {
        layout: { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 4, h: 2 }] },
      });
      expect(el('a').querySelector('.ddr-content')!.textContent).toBe('a');
    });
  });
});
