import { createDriftEditor, DriftChangeInfo, DriftEditor, DriftEditorOptions, DriftItem, DriftLayout } from '@/index';
import { dragHandle, mockRects, pointer, STRIDE_X, STRIDE_Y } from './_helpers';

type Change = { layout: DriftLayout; info: DriftChangeInfo };

describe('외부 모델 연동 옵션', () => {
  let container: HTMLElement;
  let editor: DriftEditor;
  let spy: jest.SpyInstance;

  const LAYOUT = {
    columns: 12,
    items: [
      { id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'A' },
      { id: 'b', x: 4, y: 0, w: 4, h: 2, content: 'B' },
      { id: 'c', x: 0, y: 2, w: 8, h: 2, content: 'C' },
    ],
  };
  const create = (options: DriftEditorOptions = {}) => {
    editor = createDriftEditor(container, { layout: LAYOUT, ...options });
    return editor;
  };
  const el = (id: string) => container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
  const record = (): Change[] => {
    const list: Change[] = [];
    editor.on('layoutChange', (layout, info) => list.push({ layout, info }));
    return list;
  };
  const key = (target: Element, k: string, shiftKey = false) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));

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

  describe('내부 undo/redo 기록 비활성화 (history:false)', () => {
    it('이력이 쌓이지 않고 undo/redo 는 false 이지만 사용자 조작과 변경 이벤트는 정상이다', () => {
      create({ history: false });
      const changes = record();
      expect(editor.isHistory()).toBe(false);

      dragHandle(container, 'a', { x: 0, y: 0 }, 8, 0); // 사용자 드래그
      expect(editor.getItem('a')).toMatchObject({ x: 8 });
      expect(changes).toHaveLength(1);
      expect(changes[0].info).toMatchObject({ reason: 'drag', source: 'user' });

      editor.moveItem('b', 0, 6);
      editor.addItem({ id: 'z', w: 2, h: 2 });
      expect(changes.map((c) => c.info.reason)).toEqual(['drag', 'move', 'add']);
      expect(editor.canUndo()).toBe(false);
      expect(editor.canRedo()).toBe(false);
      expect(editor.undo()).toBe(false);
      expect(editor.redo()).toBe(false);
      expect(editor.getItems()).toHaveLength(4); // undo 호출이 모델을 바꾸지 않았다
    });

    it('기본값(history 생략)은 기존처럼 기록한다', () => {
      create();
      expect(editor.isHistory()).toBe(true);
      editor.moveItem('a', 8, 0);
      expect(editor.canUndo()).toBe(true);
      expect(editor.undo()).toBe(true);
      expect(editor.getItem('a')).toMatchObject({ x: 0 });
    });

    it('호출별 history:false 는 그 변경만 기록하지 않는다', () => {
      create();
      editor.moveItem('a', 8, 0, { history: false });
      expect(editor.canUndo()).toBe(false);
      editor.updateItem('b', { title: 'T' }); // 기록됨
      expect(editor.canUndo()).toBe(true);
      editor.updateItem('c', { title: 'U' }, { history: false });
      editor.undo();
      expect(editor.canUndo()).toBe(false);
    });

    it('이력을 끄면 변경마다 이전 레이아웃 참조를 보관하지 않는다 (메모리 누적 없음)', () => {
      create({ history: false });
      for (let i = 0; i < 50; i++) editor.moveItem('a', i % 2 ? 8 : 0, 0);
      // 내부 스택을 직접 들여다보는 대신 공개 동작으로 확인: 되돌릴 이력이 전혀 없다
      expect(editor.canUndo()).toBe(false);
      expect(editor.undo()).toBe(false);
    });
  });

  describe('내부 키보드 처리 비활성화 (keyboard:false)', () => {
    it('방향키 이동/리사이즈/Delete/Esc 선택 해제를 모두 처리하지 않는다', () => {
      create({ keyboard: false, removable: true });
      const changes = record();
      editor.select('c');
      key(el('c'), 'ArrowRight');
      key(el('c'), 'ArrowDown', true);
      key(el('c'), 'Delete');
      key(el('c'), 'Escape');
      expect(editor.getItem('c')).toMatchObject({ x: 0, y: 2, w: 8, h: 2 });
      expect(editor.getSelected()?.id).toBe('c'); // Esc 로 선택이 해제되지 않는다
      expect(changes).toHaveLength(0);
      expect(editor.isKeyboard()).toBe(false);
    });

    it('기본값은 기존처럼 처리하며 출처는 user 이다', () => {
      create({ removable: true });
      const changes = record();
      key(el('c'), 'ArrowRight');
      expect(editor.getItem('c')).toMatchObject({ x: 1 });
      key(el('c'), 'Delete');
      expect(editor.getItem('c')).toBeUndefined();
      expect(changes.map((c) => [c.info.reason, c.info.source])).toEqual([
        ['move', 'user'],
        ['remove', 'user'],
      ]);
    });

    it('setKeyboard 로 런타임에 켜고 끌 수 있다', () => {
      create();
      editor.setKeyboard(false);
      key(el('c'), 'ArrowRight');
      expect(editor.getItem('c')).toMatchObject({ x: 0 });
      editor.setKeyboard(true);
      key(el('c'), 'ArrowRight');
      expect(editor.getItem('c')).toMatchObject({ x: 1 });
    });

    it('키보드를 꺼도 진행 중인 드래그의 Esc 취소는 유지된다', () => {
      create({ keyboard: false });
      const changes = record();
      const sx = 10;
      const sy = 10;
      const handle = el('a').querySelector('.ddr-handle') as HTMLElement;
      pointer(handle, 'pointerdown', sx, sy);
      pointer(handle, 'pointermove', sx + 8, sy + 8);
      pointer(handle, 'pointermove', sx + 8 * STRIDE_X, sy + STRIDE_Y);
      expect(el('a').classList.contains('ddr-dragging')).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      pointer(handle, 'pointerup', sx + 8 * STRIDE_X, sy + STRIDE_Y);
      expect(el('a').classList.contains('ddr-dragging')).toBe(false);
      expect(editor.getItem('a')).toMatchObject({ x: 0, y: 0 });
      expect(changes).toHaveLength(0);
    });

    it('키보드를 꺼도 리사이즈 도중 Esc 취소와 삭제 버튼 클릭(마우스)은 유지된다', () => {
      create({ keyboard: false, removable: true });
      const changes = record();
      const grip = el('b').querySelector('.ddr-resize-handle[data-dir="se"]') as HTMLElement;
      pointer(grip, 'pointerdown', 8 * STRIDE_X - 8, 2 * STRIDE_Y - 8);
      pointer(grip, 'pointermove', 8 * STRIDE_X, 2 * STRIDE_Y);
      pointer(grip, 'pointermove', 9 * STRIDE_X, 3 * STRIDE_Y);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      pointer(grip, 'pointerup', 9 * STRIDE_X, 3 * STRIDE_Y);
      expect(editor.getItem('b')).toMatchObject({ w: 4, h: 2 });
      expect(changes).toHaveLength(0);

      (el('c').querySelector('.ddr-remove') as HTMLElement).click();
      expect(editor.getItem('c')).toBeUndefined();
      expect(changes[0].info).toMatchObject({ reason: 'remove', source: 'user' });
    });
  });

  describe('프로그램 변경의 이벤트 발생 여부 / 변경 출처', () => {
    it('programmaticEvents:false: 프로그램 호출은 이벤트 없이 적용되고 사용자 조작은 계속 발생한다', () => {
      create({ programmaticEvents: false });
      const changes = record();
      const adds: string[] = [];
      const removes: string[] = [];
      editor.on('add', (i) => adds.push(i.id));
      editor.on('remove', (i) => removes.push(i.id));

      editor.addItem({ id: 'z', w: 2, h: 2 });
      editor.updateItem('a', { title: 'T' });
      editor.moveItem('b', 8, 4);
      editor.removeItem('z');
      editor.undo();
      expect(changes).toHaveLength(0);
      expect(adds).toEqual([]);
      expect(removes).toEqual([]);
      expect(editor.getItem('a')).toMatchObject({ title: 'T' }); // 모델과 화면은 정상 갱신
      expect(el('a').querySelector('.ddr-title')!.textContent).toBe('T');

      dragHandle(container, 'a', { x: 0, y: 0 }, 8, 6); // 사용자 조작
      expect(changes).toHaveLength(1);
      expect(changes[0].info.source).toBe('user');
    });

    it('호출별 emit 옵션이 에디터 기본값을 덮어쓴다', () => {
      create();
      const changes = record();
      editor.moveItem('a', 8, 4, { emit: false });
      expect(changes).toHaveLength(0);
      editor.moveItem('a', 0, 0); // 기본: 발생
      expect(changes).toHaveLength(1);

      editor.destroy();
      container.innerHTML = '';
      create({ programmaticEvents: false });
      const quiet = record();
      editor.moveItem('a', 8, 4);
      editor.moveItem('a', 0, 0, { emit: true });
      expect(quiet).toHaveLength(1);
    });

    it('source 기본값은 api, 호출별로 sync/user 를 지정할 수 있다', () => {
      create();
      const changes = record();
      editor.moveItem('a', 8, 4);
      editor.moveItem('a', 0, 0, { source: 'sync' });
      editor.updateItem('b', { title: 'x' }, { source: 'user' });
      editor.undo();
      expect(changes.map((c) => c.info.source)).toEqual(['api', 'sync', 'user', 'api']);
    });

    it("source:'user' 는 emit:false 를 지정해도 이벤트를 막지 않는다", () => {
      create({ programmaticEvents: false });
      const changes = record();
      editor.moveItem('a', 8, 4, { source: 'user', emit: false });
      expect(changes).toHaveLength(1);
    });

    it('이벤트를 끄면 변경 비교(changes) 계산도 하지 않는다 — 리스너가 없을 때와 같다', () => {
      create({ programmaticEvents: false });
      const handler = jest.fn();
      editor.on('layoutChange', handler);
      editor.moveItem('a', 8, 4);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('변경된 항목 정보 (layoutChange 의 info.changes)', () => {
    it('이동: 조작한 항목과 충돌로 밀려난 항목이 before/after 와 함께 changed 에 들어 있다', () => {
      create();
      const changes = record();
      editor.moveItem('a', 4, 0); // b 자리로: b 와 c 가 밀린다

      const { changes: diff, reason, source } = changes[0].info;
      expect(reason).toBe('move');
      expect(source).toBe('api');
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      const byId = Object.fromEntries(diff.changed.map((c) => [c.id, c]));
      expect(Object.keys(byId).sort()).toEqual(['a', 'b', 'c'].filter((id) => byId[id]));
      expect(byId.a).toMatchObject({ moved: true, resized: false });
      expect(byId.a.before).toMatchObject({ x: 0, y: 0 });
      expect(byId.a.after).toMatchObject({ x: 4, y: 0 });
      // 밀려난 항목
      expect(byId.b).toBeDefined();
      expect(byId.b.before).toMatchObject({ x: 4, y: 0 });
      expect(byId.b.after.y).toBeGreaterThanOrEqual(2);
      expect(byId.b).toMatchObject({ moved: true, resized: false });
    });

    it('실제로 변하지 않은 항목은 changed 에 포함되지 않는다', () => {
      create({
        layout: {
          columns: 12,
          items: [
            { id: 'a', x: 0, y: 0, w: 2, h: 2 },
            { id: 'far', x: 10, y: 0, w: 2, h: 2 },
          ],
        },
      });
      const changes = record();
      editor.moveItem('a', 4, 0);
      expect(changes[0].info.changes.changed.map((c) => c.id)).toEqual(['a']);
    });

    it('추가: added 에 새 항목, 밀려난 기존 항목은 changed 에 들어 있다', () => {
      create();
      const changes = record();
      editor.addItem({ id: 'z', x: 0, y: 0, w: 4, h: 2, content: 'Z' });
      const { changes: diff } = changes[0].info;
      expect(diff.added.map((i) => i.id)).toEqual(['z']);
      expect(diff.added[0]).toMatchObject({ x: 0, y: 0, content: 'Z' });
      expect(diff.removed).toEqual([]);
      expect(diff.changed.map((c) => c.id)).toContain('a');
    });

    it('제거: removed 에 제거된 항목, 위로 올라온 항목은 changed 에 들어 있다', () => {
      // c 는 b 바로 아래(같은 열)에 있어 b 를 지우면 위로 올라온다
      create({
        layout: {
          columns: 12,
          items: [
            { id: 'a', x: 0, y: 0, w: 4, h: 2 },
            { id: 'b', x: 4, y: 0, w: 4, h: 2, content: 'B' },
            { id: 'c', x: 4, y: 2, w: 4, h: 2 },
          ],
        },
      });
      const changes = record();
      editor.removeItem('b');
      const { changes: diff } = changes[0].info;
      expect(diff.removed.map((i) => i.id)).toEqual(['b']);
      expect(diff.removed[0]).toMatchObject({ x: 4, y: 0, content: 'B' });
      expect(diff.changed.map((c) => c.id)).toEqual(['c']);
      expect(diff.changed[0]).toMatchObject({ moved: true, resized: false, before: { y: 2 }, after: { y: 0 } });
      expect(diff.added).toEqual([]);
    });

    it('리사이즈/내용 변경: resized/moved 플래그와 before/after 값이 정확하다', () => {
      create();
      const changes = record();
      editor.resizeItem('a', 6, 3);
      expect(changes[0].info.changes.changed.find((c) => c.id === 'a')).toMatchObject({
        moved: false,
        resized: true,
        before: { w: 4, h: 2 },
        after: { w: 6, h: 3 },
      });
      editor.updateItem('c', { title: 'Hello', props: { k: 1 } });
      const last = changes[changes.length - 1].info.changes.changed.find((c) => c.id === 'c');
      expect(last).toMatchObject({ moved: false, resized: false });
      expect(last!.before.title).toBeUndefined();
      expect(last!.after).toMatchObject({ title: 'Hello', props: { k: 1 } });
    });

    it('사용자 드래그: source 가 user 이고 밀려난 항목도 포함된다', () => {
      create();
      const changes = record();
      dragHandle(container, 'a', { x: 0, y: 0 }, 4, 0);
      expect(changes).toHaveLength(1);
      expect(changes[0].info).toMatchObject({ reason: 'drag', source: 'user' });
      const ids = changes[0].info.changes.changed.map((c) => c.id);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });

    it('undo/redo/clear/load/reset 의 변경 정보', () => {
      create();
      editor.moveItem('a', 8, 4);
      const changes = record();
      editor.undo();
      expect(changes[0].info.changes.changed.find((c) => c.id === 'a')).toMatchObject({
        before: { x: 8 },
        after: { x: 0 },
      });
      editor.redo();
      expect(changes[1].info).toMatchObject({ reason: 'redo' });
      editor.clear();
      expect(changes[2].info.changes.removed.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
      editor.reset();
      expect(changes[3].info.changes.added.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
      editor.load({ columns: 12, items: [{ id: 'n', x: 0, y: 0, w: 2, h: 2 }] });
      expect(changes[4].info).toMatchObject({ reason: 'load' });
      expect(changes[4].info.changes.added.map((i) => i.id)).toEqual(['n']);
      expect(changes[4].info.changes.removed.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('이벤트 데이터는 내부 상태와 분리된 복사본이다', () => {
      create();
      let captured: DriftChangeInfo | undefined;
      editor.on('layoutChange', (layout, info) => {
        captured = info;
        layout.items[0].x = 99; // 첫 인자(레이아웃 복사본)를 망가뜨려도
      });
      editor.addItem({ id: 'z', w: 2, h: 2, props: { k: 1 } });
      const added = captured!.changes.added[0];
      added.x = 77;
      (added.props as Record<string, unknown>).k = 5;
      captured!.changes.changed.forEach((c) => {
        c.after.x = -1;
        c.before.x = -1;
      });
      expect(editor.getItem('z')).toMatchObject({ props: { k: 1 } });
      expect(editor.getItem('z')!.x).not.toBe(77);
      expect(editor.getLayout().items.every((i) => i.x !== 99 && i.x !== -1)).toBe(true);
    });

    it('변경이 없는 호출은 이벤트도 이력도 만들지 않는다', () => {
      create();
      const changes = record();
      editor.moveItem('a', 0, 0);
      editor.resizeItem('a', 4, 2);
      editor.updateItem('a', { w: 4 });
      editor.moveItem('nope', 1, 1);
      editor.setFloat(false);
      expect(changes).toHaveLength(0);
      expect(editor.canUndo()).toBe(false);
    });

    it('기존 사용자 코드(레이아웃 + {reason} 구조 분해)가 그대로 동작한다', () => {
      create();
      const seen: string[] = [];
      editor.on('layoutChange', (layout: DriftLayout, { reason }: { reason: string }) =>
        seen.push(`${reason}:${layout.items.length}`),
      );
      editor.addItem({ id: 'z', w: 2, h: 2 });
      expect(seen).toEqual(['add:4']);
    });

    it('내용이 같은 새 props 객체로 갱신하면 변경으로 보지 않는다', () => {
      create({ layout: { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 2, h: 2, props: { k: 1 } }] } });
      const changes = record();
      editor.updateItem('a', { props: { k: 1 } });
      expect(changes).toHaveLength(0);
      editor.updateItem('a', { props: { k: 2 } });
      expect(changes).toHaveLength(1);
    });
  });

  describe('외부 모델과의 순환 방지', () => {
    /** 호스트: layoutChange(user) 로 자기 모델을 갱신하고, 같은 모델을 다시 syncItems 로 되돌려 주는 전형적인 양방향 연동 */
    it('사용자 조작 → 모델 반영 → syncItems 되돌림이 추가 이벤트 없이 끝난다', () => {
      create();
      const model = new Map<string, DriftItem>(editor.getItems().map((i) => [i.id, i]));
      let syncCalls = 0;
      let events = 0;
      editor.on('layoutChange', (_layout, info) => {
        events++;
        if (info.source === 'sync') throw new Error('동기화 이벤트가 다시 호스트로 돌아왔다');
        info.changes.added.forEach((i) => model.set(i.id, i));
        info.changes.changed.forEach((c) => model.set(c.id, c.after));
        info.changes.removed.forEach((i) => model.delete(i.id));
        // 호스트가 모델을 화면에 다시 반영한다 (대부분의 연동 코드가 하는 일)
        syncCalls++;
        const result = editor.syncItems([...model.values()]);
        expect(result.changed).toBe(false);
      });

      dragHandle(container, 'a', { x: 0, y: 0 }, 4, 0);
      editor.addItem({ id: 'z', w: 2, h: 2 }, { source: 'api' });
      expect(events).toBe(2); // 사용자 이벤트 1 + 프로그램 이벤트 1: 되돌림(sync)은 이벤트를 만들지 않았다
      expect(syncCalls).toBe(2);
      expect(editor.getItems().length).toBe(model.size);
    });

    it('유효한 외부 배치는 재압축하지 않아 같은 입력을 반복해도 변하지 않는다', () => {
      create({ layout: { columns: 12, items: [] } });
      const handler = jest.fn();
      editor.on('layoutChange', handler);
      // 위쪽이 비어 있는(중력상 압축 가능한) 유효한 배치
      const external: DriftItem[] = [
        { id: 'a', x: 0, y: 5, w: 4, h: 2 },
        { id: 'b', x: 4, y: 9, w: 4, h: 2 },
      ];
      const first = editor.syncItems(external);
      expect(first.changed).toBe(true);
      expect(editor.getItems().map((i) => i.y)).toEqual([5, 9]); // 압축되지 않았다
      expect(first.adjusted).toEqual([]);
      for (let i = 0; i < 5; i++) expect(editor.syncItems(external).changed).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
