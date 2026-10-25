import {
  collides,
  createDriftEditor,
  DriftChangeInfo,
  DriftContentLifecycle,
  DriftEditor,
  DriftEditorOptions,
  DriftItem,
} from '@/index';
import { mockRects } from './_helpers';

/** 깊은 freeze: syncItems 가 입력을 변경하면 (strict mode 에서) 예외가 난다 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('syncItems: 외부 모델 일괄 동기화', () => {
  let container: HTMLElement;
  let editor: DriftEditor;
  let spy: jest.SpyInstance;

  const base = (): DriftItem[] => [
    { id: 'a', x: 0, y: 0, w: 4, h: 2, title: 'A', content: 'ca', props: { k: 1 } },
    { id: 'b', x: 4, y: 0, w: 4, h: 2, content: 'cb' },
    { id: 'c', x: 8, y: 0, w: 4, h: 2, content: 'cc' },
  ];
  const create = (options: DriftEditorOptions = {}, items: DriftItem[] = base()) => {
    editor = createDriftEditor(container, { layout: { columns: 12, items }, ...options });
    return editor;
  };
  const el = (id: string) => container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
  const noOverlap = () => {
    const list = editor.getItems();
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) expect(collides(list[i], list[j])).toBe(false);
  };

  beforeEach(() => {
    spy = mockRects();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    editor?.destroy();
    container.remove();
    spy.mockRestore();
  });

  it('같은 id 의 DOM 은 유지하고 추가된 항목만 만들며 제거된 항목만 해제한다', () => {
    create();
    const [a, b, c] = [el('a'), el('b'), el('c')];
    const result = editor.syncItems([
      { id: 'a', x: 0, y: 0, w: 4, h: 2, title: 'A', content: 'ca', props: { k: 1 } }, // 변경 없음
      { id: 'b', x: 4, y: 0, w: 6, h: 3, content: 'cb' }, // 크기만 변경
      { id: 'd', x: 8, y: 0, w: 2, h: 2, content: 'cd' }, // 추가 (c 는 제거)
    ]);

    expect(result).toMatchObject({ changed: true, added: ['d'], removed: ['c'], updated: ['b'], overlapping: false });
    expect(el('a')).toBe(a); // 같은 DOM 요소
    expect(el('b')).toBe(b);
    expect(el('c')).toBeNull();
    expect(c.isConnected).toBe(false);
    expect(el('d')).not.toBeNull();
    expect(editor.getItem('b')).toMatchObject({ w: 6, h: 3 });
    expect(container.querySelectorAll('.ddr-item')).toHaveLength(3);
  });

  it('위치/크기만 바뀐 항목은 콘텐츠를 다시 렌더링하지 않는다 (renderItem 호출 수로 확인)', () => {
    const renderItem = jest.fn((item: DriftItem, contentEl: HTMLElement) => {
      contentEl.textContent = `[${item.content}]`;
    });
    create({ renderItem });
    expect(renderItem).toHaveBeenCalledTimes(3);
    const inner = el('a').querySelector('.ddr-content')!.firstChild;

    editor.syncItems([
      { id: 'a', x: 2, y: 3, w: 6, h: 4, title: 'A', content: 'ca', props: { k: 1 } },
      { id: 'b', x: 4, y: 0, w: 4, h: 2, content: 'cb' },
      { id: 'c', x: 8, y: 0, w: 4, h: 2, content: 'cc' },
    ]);
    expect(renderItem).toHaveBeenCalledTimes(3); // 재호출 없음
    expect(el('a').querySelector('.ddr-content')!.firstChild).toBe(inner); // 콘텐츠 DOM 노드도 그대로

    editor.syncItems([
      { id: 'a', x: 2, y: 3, w: 6, h: 4, title: 'A', content: 'CHANGED', props: { k: 1 } },
      { id: 'b', x: 4, y: 0, w: 4, h: 2, content: 'cb' },
      { id: 'c', x: 8, y: 0, w: 4, h: 2, content: 'cc' },
    ]);
    expect(renderItem).toHaveBeenCalledTimes(4); // 내용이 바뀐 항목만
    expect(el('a').querySelector('.ddr-content')!.textContent).toBe('[CHANGED]');
  });

  it('여러 항목을 적용해도 렌더링/이벤트는 최종 상태로 한 번만 발생한다', () => {
    create();
    const renderSpy = jest.spyOn(editor as unknown as { render: () => void }, 'render');
    const infos: DriftChangeInfo[] = [];
    editor.on('layoutChange', (_l, info) => infos.push(info));

    const many: DriftItem[] = Array.from({ length: 60 }, (_, i) => ({
      id: `n${i}`,
      x: (i % 4) * 3,
      y: Math.floor(i / 4) * 2,
      w: 3,
      h: 2,
    }));
    editor.syncItems(many);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatchObject({ reason: 'sync', source: 'sync' });
    expect(infos[0].changes.added).toHaveLength(60);
    expect(infos[0].changes.removed.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
    expect(container.querySelectorAll('.ddr-item')).toHaveLength(60);
  });

  it('변경이 없으면 렌더링/이벤트/이력/DOM 접근 없이 changed:false 를 반환한다', () => {
    create();
    const renderSpy = jest.spyOn(editor as unknown as { render: () => void }, 'render');
    const handler = jest.fn();
    editor.on('layoutChange', handler);
    const result = editor.syncItems(base());
    expect(result).toEqual({ changed: false, added: [], removed: [], updated: [], adjusted: [], overlapping: false });
    expect(renderSpy).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(editor.canUndo()).toBe(false);
    // 항목 순서만 다른 입력도 변경이 아니다
    expect(editor.syncItems(base().reverse()).changed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('기본 옵션: source/reason 은 sync, 이력은 기록하지 않는다. history:true 를 주면 한 단계로 기록한다', () => {
    create();
    const infos: DriftChangeInfo[] = [];
    editor.on('layoutChange', (_l, info) => infos.push(info));
    editor.syncItems([{ id: 'a', x: 5, y: 0, w: 2, h: 2 }]);
    expect(infos[0]).toMatchObject({ reason: 'sync', source: 'sync' });
    expect(editor.canUndo()).toBe(false);

    editor.syncItems([{ id: 'a', x: 6, y: 0, w: 2, h: 2 }], { history: true });
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    expect(editor.getItem('a')).toMatchObject({ x: 5 });
  });

  it('이벤트 발생 여부와 출처는 호출자가 지정한다 (emit/source)', () => {
    create();
    const infos: DriftChangeInfo[] = [];
    editor.on('layoutChange', (_l, info) => infos.push(info));
    editor.syncItems([{ id: 'a', x: 5, y: 0, w: 2, h: 2 }], { emit: false });
    expect(infos).toHaveLength(0);
    expect(editor.getItem('a')).toMatchObject({ x: 5 }); // 적용은 된다
    editor.syncItems([{ id: 'a', x: 6, y: 0, w: 2, h: 2 }], { source: 'api' });
    expect(infos[0].source).toBe('api');

    editor.destroy();
    container.innerHTML = '';
    create({ programmaticEvents: false });
    const quiet: DriftChangeInfo[] = [];
    editor.on('layoutChange', (_l, info) => quiet.push(info));
    editor.syncItems([{ id: 'a', x: 5, y: 0, w: 2, h: 2 }]);
    expect(quiet).toHaveLength(0);
    editor.syncItems([{ id: 'a', x: 6, y: 0, w: 2, h: 2 }], { emit: true });
    expect(quiet).toHaveLength(1);
  });

  it('선택된 항목이 남아 있으면 선택을 유지하고, 사라지면 해제한다', () => {
    create();
    editor.select('a');
    editor.syncItems([
      { id: 'a', x: 6, y: 4, w: 2, h: 2 },
      { id: 'b', x: 0, y: 0, w: 2, h: 2 },
    ]);
    expect(editor.getSelected()?.id).toBe('a');
    expect(el('a').classList.contains('ddr-selected')).toBe(true);
    editor.syncItems([{ id: 'b', x: 0, y: 0, w: 2, h: 2 }]);
    expect(editor.getSelected()).toBeNull();
  });

  it('외부 입력을 변경하지 않는다 (깊은 freeze 입력)', () => {
    create();
    const input = deepFreeze([
      { id: 'a', x: -3, y: 2.6, w: 99, h: 0, props: { k: 1 }, evil: 'x' } as unknown as DriftItem,
      { id: 'n', x: 0, y: 0, w: 2, h: 2, responsive: { mobile: { x: 0, y: 0, w: 1, h: 1 } } },
    ]);
    const snapshot = JSON.stringify(input);
    expect(() => editor.syncItems(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(editor.getItem('a')).not.toHaveProperty('evil');
  });

  it('잘못된 입력은 예외를 던지고 상태를 바꾸지 않는다 (id 없음/중복/배열 아님)', () => {
    create();
    const before = editor.getLayout();
    expect(() => editor.syncItems([{ x: 0, y: 0, w: 1, h: 1 } as unknown as DriftItem])).toThrow();
    expect(() => editor.syncItems([{ id: '', x: 0, y: 0, w: 1, h: 1 }])).toThrow();
    expect(() =>
      editor.syncItems([
        { id: 'a', x: 0, y: 0, w: 1, h: 1 },
        { id: 'a', x: 1, y: 0, w: 1, h: 1 },
      ]),
    ).toThrow(/중복/);
    expect(() => editor.syncItems(null as unknown as DriftItem[])).toThrow();
    expect(editor.getLayout()).toEqual(before);
  });

  it('값 정규화: 좌표 정수화/컬럼 경계/최소 크기를 보정하고 adjusted 로 알린다', () => {
    create({}, []);
    const result = editor.syncItems([{ id: 'a', x: -3, y: 2.6, w: 99, h: 0 }], { placement: 'exact' });
    expect(editor.getItem('a')).toMatchObject({ x: 0, y: 3, w: 12, h: 1 });
    expect(result.adjusted).toHaveLength(1);
    expect(result.adjusted[0]).toMatchObject({ id: 'a', x: 0, y: 3, w: 12, h: 1 });
  });

  describe('placement: 정확한 복원 vs 충돌 정규화', () => {
    const overlapping: DriftItem[] = [
      { id: 'a', x: 0, y: 0, w: 4, h: 2 },
      { id: 'b', x: 2, y: 1, w: 4, h: 2 },
    ];
    const withGaps: DriftItem[] = [
      { id: 'a', x: 0, y: 6, w: 4, h: 2 },
      { id: 'b', x: 4, y: 9, w: 4, h: 2 },
    ];

    it("'exact': 빈 칸이 있는 유효한 배치를 그대로 복원하고 압축하지 않는다", () => {
      create({}, []);
      const r = editor.syncItems(withGaps, { placement: 'exact' });
      expect(editor.getItems().map((i) => i.y)).toEqual([6, 9]);
      expect(r.adjusted).toEqual([]);
      expect(r.overlapping).toBe(false);
    });

    it("'exact': 겹치는 입력도 그대로 복원하고 overlapping 으로 알린다", () => {
      create({}, []);
      const r = editor.syncItems(overlapping, { placement: 'exact' });
      expect(editor.getItems().map((i) => [i.x, i.y])).toEqual([
        [0, 0],
        [2, 1],
      ]);
      expect(r.overlapping).toBe(true);
      expect(r.adjusted).toEqual([]);
    });

    it("'resolve': 충돌을 해소하고 중력 압축을 적용하며 달라진 항목을 adjusted 로 알린다", () => {
      create({}, []);
      const r = editor.syncItems(withGaps, { placement: 'resolve' });
      expect(editor.getItems().map((i) => i.y)).toEqual([0, 0]); // 위로 압축
      expect(r.adjusted.map((i) => i.id).sort()).toEqual(['a', 'b']);
      expect(r.overlapping).toBe(false);

      editor.syncItems(overlapping, { placement: 'resolve' });
      noOverlap();
    });

    it("'auto'(기본): 겹침이 없으면 exact, 있으면 resolve", () => {
      create({}, []);
      editor.syncItems(withGaps); // 유효 → exact
      expect(editor.getItems().map((i) => i.y)).toEqual([6, 9]);

      const r = editor.syncItems(overlapping); // 겹침 → resolve
      noOverlap();
      expect(r.adjusted.length).toBeGreaterThan(0);
      expect(r.overlapping).toBe(false);
    });

    it('resolve 는 locked, float, min/max 제약을 유지한다', () => {
      create({ float: true }, []);
      editor.syncItems(
        [
          { id: 'wall', x: 0, y: 0, w: 4, h: 4, locked: true },
          { id: 'a', x: 2, y: 2, w: 99, h: 1, minW: 2, maxW: 5 },
          { id: 'g', x: 8, y: 7, w: 2, h: 2 },
        ],
        { placement: 'resolve' },
      );
      const items = editor.getItems();
      expect(items.find((i) => i.id === 'wall')).toMatchObject({ x: 0, y: 0 }); // locked 는 움직이지 않는다
      expect(items.find((i) => i.id === 'a')!.w).toBe(5); // maxW
      expect(items.find((i) => i.id === 'g')).toMatchObject({ x: 8, y: 7 }); // float: 위로 올라가지 않는다
      noOverlap();
    });
  });

  it('responsive 는 입력에 키가 없으면 기존 값을 보존하고, 있으면 입력으로 대체한다', () => {
    create({}, [{ id: 'a', x: 0, y: 0, w: 4, h: 2, responsive: { mobile: { x: 0, y: 0, w: 4, h: 3 } } }]);
    editor.syncItems([{ id: 'a', x: 0, y: 0, w: 5, h: 2 }]);
    expect(editor.getLayout().items[0].responsive).toEqual({ mobile: { x: 0, y: 0, w: 4, h: 3 } });
    editor.syncItems([{ id: 'a', x: 0, y: 0, w: 5, h: 2, responsive: { mobile: { x: 0, y: 1, w: 4, h: 1 } } }]);
    expect(editor.getLayout().items[0].responsive).toEqual({ mobile: { x: 0, y: 1, w: 4, h: 1 } });
  });

  it('입력에 없는 속성은 제거된다 (항목 단위 대체)', () => {
    create();
    editor.syncItems([{ id: 'a', x: 0, y: 0, w: 4, h: 2 }]);
    expect(editor.getItem('a')).not.toHaveProperty('title');
    expect(editor.getItem('a')).not.toHaveProperty('props');
    expect(el('a').querySelector('.ddr-title')!.textContent).toBe('');
  });

  it('breakpoint 편집 중에도 기본 레이아웃 항목을 대상으로 동기화한다', () => {
    create();
    editor.setBreakpoint('mobile');
    editor.syncItems([{ id: 'a', x: 8, y: 0, w: 4, h: 2 }]);
    expect(editor.getLayout().items).toEqual([expect.objectContaining({ id: 'a', x: 8, y: 0, w: 4 })]);
    expect(editor.getBreakpoint()?.name).toBe('mobile'); // 편집 중인 breakpoint 는 바뀌지 않는다
  });

  it('dirty 기준/reset 기준은 바꾸지 않는다 (load 와 다른 점)', () => {
    create();
    expect(editor.isDirty()).toBe(false);
    editor.syncItems([{ id: 'z', x: 0, y: 0, w: 2, h: 2 }]);
    expect(editor.isDirty()).toBe(true);
    editor.reset({ emit: false });
    expect(
      editor
        .getItems()
        .map((i) => i.id)
        .sort(),
    ).toEqual(['a', 'b', 'c']);
  });

  it('destroy 후에는 아무 일도 하지 않는다', () => {
    create();
    editor.destroy();
    expect(editor.syncItems(base())).toMatchObject({ changed: false });
  });

  it('load() 의 의미는 그대로다: 정규화(압축)하고 이력/기준을 초기화한다', () => {
    create({}, []);
    editor.moveItem('nope', 0, 0);
    editor.load({ columns: 12, items: [{ id: 'g', x: 0, y: 8, w: 2, h: 2 }] });
    expect(editor.getItem('g')).toMatchObject({ y: 0 }); // load 는 압축한다
    expect(editor.canUndo()).toBe(false);
    expect(editor.isDirty()).toBe(false);
  });

  describe('콘텐츠 훅과 함께: 외부 인스턴스 유지', () => {
    it('동기화에서 같은 id 의 인스턴스는 유지되고 추가/제거된 항목만 mount/unmount 된다', () => {
      const log: string[] = [];
      const lifecycle: DriftContentLifecycle = {
        mount: (item) => {
          log.push(`mount:${item.id}`);
          return () => log.push(`cleanup:${item.id}`);
        },
        update: (item) => log.push(`update:${item.id}`),
        unmount: (item) => log.push(`unmount:${item.id}`),
      };
      create({ contentLifecycle: lifecycle });
      log.length = 0;

      editor.syncItems([
        { id: 'a', x: 0, y: 4, w: 4, h: 2, title: 'A', content: 'ca', props: { k: 1 } }, // 위치만
        { id: 'b', x: 4, y: 0, w: 8, h: 4, content: 'cb' }, // 크기만
        { id: 'd', x: 8, y: 6, w: 2, h: 2, content: 'cd' }, // 추가, c 는 제거
      ]);
      expect(log.sort()).toEqual(['cleanup:c', 'mount:d', 'unmount:c']);
    });
  });
});
