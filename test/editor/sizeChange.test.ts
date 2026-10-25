import { createDriftEditor, DriftEditor, DriftEditorOptions, DriftSizeChange } from '@/index';
import { CELL, dragHandle, frames, mockRects, pointer, STRIDE_X, STRIDE_Y } from './_helpers';

const px = (w: number, cell = CELL) => w * cell + (w - 1) * 8;
const py = (h: number) => h * 40 + (h - 1) * 8;

describe('sizeChange: 크기 변경 알림', () => {
  let container: HTMLElement;
  let editor: DriftEditor;
  let spy: jest.SpyInstance;
  let events: DriftSizeChange[][];

  const create = (options: DriftEditorOptions = {}) => {
    editor = createDriftEditor(container, {
      layout: {
        columns: 12,
        items: [
          { id: 'a', x: 0, y: 0, w: 4, h: 2 },
          { id: 'b', x: 4, y: 0, w: 4, h: 2 },
          { id: 'c', x: 8, y: 0, w: 4, h: 2 },
        ],
      },
      ...options,
    });
    return editor;
  };
  const el = (id: string) => container.querySelector(`[data-drift-id="${id}"]`) as HTMLElement;
  /** 크기 알림을 구독하고 처음 알림(모든 항목, previous:null)을 비운 뒤 이후 알림만 기록한다 */
  const listen = async () => {
    events = [];
    editor.on('sizeChange', (c) => events.push(c));
    await frames(2);
    events.length = 0;
  };
  const setCanvasWidth = (w: number) =>
    Object.defineProperty(container.querySelector('.daracl-drift'), 'clientWidth', { value: w, configurable: true });
  const ids = (list: DriftSizeChange[]) => list.map((c) => c.id).sort();

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

  it('리스너를 붙이면 현재 항목들의 크기를 한 번에 알린다 (previous: null)', async () => {
    create();
    const got: DriftSizeChange[][] = [];
    editor.on('sizeChange', (c) => got.push(c));
    expect(got).toHaveLength(0); // 동기 호출이 아니라 다음 프레임에 합쳐 알린다
    await frames(2);
    expect(got).toHaveLength(1);
    expect(ids(got[0])).toEqual(['a', 'b', 'c']);
    const a = got[0].find((c) => c.id === 'a')!;
    expect(a).toMatchObject({ previous: null, w: 4, h: 2, phase: 'end', cause: 'layout' });
    expect(a.width).toBeCloseTo(px(4), 5);
    expect(a.height).toBeCloseTo(py(2), 5);
    expect(a.element).toBe(el('a'));
    expect(a.contentElement).toBe(el('a').querySelector('.ddr-content'));
  });

  it('위치 이동만 한 경우(밀려난 항목 포함)에는 알리지 않는다', async () => {
    create();
    await listen();
    editor.moveItem('a', 4, 0); // b 가 밀려난다
    editor.moveItem('c', 0, 6);
    dragHandle(container, 'b', { x: 4, y: 2 }, 0, 8); // 사용자 이동
    await frames(3);
    expect(events).toHaveLength(0);
  });

  it('실제 크기가 바뀐 항목만 전달하고 이전 크기와 셀/픽셀 값을 함께 준다', async () => {
    create();
    await listen();
    editor.resizeItem('b', 6, 3);
    await frames(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toHaveLength(1); // 변경된 항목만
    const c = events[0][0];
    expect(c).toMatchObject({ id: 'b', w: 6, h: 3, cause: 'layout', phase: 'end' });
    expect(c.previous).toMatchObject({ w: 4, h: 2 });
    expect(c.previous!.width).toBeCloseTo(px(4), 5);
    expect(c.width).toBeCloseTo(px(6), 5);
    expect(c.height).toBeCloseTo(py(3), 5);
    expect(c.item).toMatchObject({ id: 'b', w: 6, h: 3 });
  });

  it('같은 프레임의 여러 변경은 한 번의 알림으로 합치고, 원래 크기로 돌아오면 알리지 않는다', async () => {
    create();
    await listen();
    editor.resizeItem('a', 5, 2);
    editor.resizeItem('a', 6, 3);
    editor.resizeItem('c', 3, 2);
    editor.resizeItem('b', 5, 2);
    editor.resizeItem('b', 4, 2); // 원래대로
    await frames(2);
    expect(events).toHaveLength(1);
    expect(ids(events[0])).toEqual(['a', 'c']);
    expect(events[0].find((c) => c.id === 'a')).toMatchObject({ w: 6, h: 3 });
    expect(events[0].find((c) => c.id === 'a')!.previous).toMatchObject({ w: 4, h: 2 }); // 마지막으로 알린 값 기준
  });

  it('새 항목은 previous:null 로, 제거된 항목은 알리지 않는다 (예약 후 제거 포함)', async () => {
    create();
    await listen();
    editor.addItem({ id: 'n', x: 0, y: 4, w: 2, h: 2 });
    editor.resizeItem('c', 3, 3);
    editor.removeItem('c'); // 예약된 뒤에 제거
    await frames(2);
    expect(ids(events[0])).toEqual(['n']);
    expect(events[0][0].previous).toBeNull();
    // 같은 id 로 다시 추가하면 처음 알리는 항목으로 취급한다
    events.length = 0;
    editor.addItem({ id: 'c', x: 8, y: 0, w: 4, h: 2 });
    await frames(2);
    expect(events[0][0]).toMatchObject({ id: 'c', previous: null });
  });

  describe('컨테이너 폭/breakpoint 변경', () => {
    it('폭이 바뀌면 셀 크기가 같아도 픽셀 크기가 바뀐 항목을 cause:container 로 알린다', async () => {
      create();
      await listen();
      setCanvasWidth(600);
      editor.refresh();
      await frames(2);
      expect(events).toHaveLength(1);
      expect(ids(events[0])).toEqual(['a', 'b', 'c']);
      const cell = (600 - 88) / 12;
      events[0].forEach((c) => {
        expect(c.cause).toBe('container');
        expect(c.w).toBe(4);
        expect(c.width).toBeCloseTo(px(4, cell), 5);
        expect(c.previous!.width).toBeCloseTo(px(4), 5);
        expect(c.height).toBeCloseTo(py(2), 5); // 높이는 폭과 무관
      });
    });

    it('오차 이내의 폭 변화(0.5px 미만)는 알리지 않는다', async () => {
      create();
      await listen();
      setCanvasWidth(1200.2);
      editor.refresh();
      await frames(2);
      expect(events).toHaveLength(0);
    });

    it('breakpoint 전환(컬럼 수 변경)도 크기가 달라진 항목만 알린다', async () => {
      create();
      await listen();
      editor.setBreakpoint('mobile'); // 4열: 항목이 전폭으로 쌓인다
      await frames(2);
      expect(events).toHaveLength(1);
      events[0].forEach((c) => {
        expect(c.w).toBe(4);
        expect(c.cause).toBe('container'); // 셀 크기(4x2)는 같고 픽셀만 바뀜
        expect(c.width).toBeGreaterThan(px(4));
      });
      events.length = 0;
      editor.moveItem('a', 0, 0); // 위치만: 알림 없음
      await frames(2);
      expect(events).toHaveLength(0);
    });
  });

  describe('사용자 리사이즈: 도중/종료 알림 정책', () => {
    const resizeSe = (id: string, dxCells: number, dyCells: number, release = true) => {
      const item = editor.getItem(id)!;
      const grip = el(id).querySelector('.ddr-resize-handle[data-dir="se"]') as HTMLElement;
      const sx = (item.x + item.w) * STRIDE_X - 8;
      const sy = (item.y + item.h) * STRIDE_Y - 8;
      pointer(grip, 'pointerdown', sx, sy);
      pointer(grip, 'pointermove', sx + 6, sy + 6);
      pointer(grip, 'pointermove', sx + dxCells * STRIDE_X, sy + dyCells * STRIDE_Y);
      if (release) pointer(grip, 'pointerup', sx + dxCells * STRIDE_X, sy + dyCells * STRIDE_Y);
      return grip;
    };

    it("기본('end'): 리사이즈 도중에는 알리지 않고 확정된 뒤 한 번만 알린다", async () => {
      create();
      await listen();
      const grip = resizeSe('b', 2, 1, false);
      await frames(3);
      expect(events).toHaveLength(0); // 도중에는 없다
      pointer(grip, 'pointerup', 0, 0);
      await frames(3);
      expect(events).toHaveLength(1);
      expect(events[0]).toHaveLength(1);
      expect(events[0][0]).toMatchObject({ id: 'b', w: 6, h: 3, phase: 'end', cause: 'layout' });
    });

    it("'live': 도중에는 phase:live 로 포인터를 따라가는 실제 픽셀 크기를, 종료 후에는 phase:end 로 확정 크기를 알린다", async () => {
      create({ sizeNotify: 'live' });
      await listen();
      const grip = resizeSe('b', 2, 1, false);
      await frames(3);
      const live = events.flat().filter((c) => c.phase === 'live');
      expect(live.length).toBeGreaterThanOrEqual(1);
      expect(ids(live)).toEqual(['b']); // 크기가 바뀌는 항목만
      expect(live[live.length - 1].width).toBeCloseTo(parseFloat(el('b').style.width), 5);
      expect(editor.getItem('b')).toMatchObject({ w: 4, h: 2 }); // 모델은 아직 그대로

      events.length = 0;
      pointer(grip, 'pointerup', 0, 0);
      await frames(3);
      const end = events.flat();
      expect(end).toHaveLength(1);
      expect(end[0]).toMatchObject({ id: 'b', phase: 'end', w: 6, h: 3 });
      expect(end[0].width).toBeCloseTo(px(6), 5); // 스냅된 확정 크기
    });

    it("'live': 같은 프레임의 여러 move 는 한 번의 알림으로 합쳐진다", async () => {
      create({ sizeNotify: 'live' });
      await listen();
      const item = editor.getItem('b')!;
      const grip = el('b').querySelector('.ddr-resize-handle[data-dir="se"]') as HTMLElement;
      const sx = (item.x + item.w) * STRIDE_X - 8;
      const sy = (item.y + item.h) * STRIDE_Y - 8;
      pointer(grip, 'pointerdown', sx, sy);
      pointer(grip, 'pointermove', sx + 6, sy + 6);
      for (let i = 1; i <= 10; i++) pointer(grip, 'pointermove', sx + i * 10, sy + i * 5);
      await frames(2);
      expect(events.flat().filter((c) => c.phase === 'live')).toHaveLength(1);
      pointer(grip, 'pointerup', sx + 100, sy + 50);
      await frames(2);
    });

    it("'live': Esc 로 취소하면 원래 크기로 확정 알림을 보낸다", async () => {
      create({ sizeNotify: 'live' });
      await listen();
      resizeSe('b', 2, 1, false);
      await frames(2);
      events.length = 0;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await frames(3);
      const last = events.flat().pop()!;
      expect(last).toMatchObject({ id: 'b', phase: 'end', w: 4, h: 2 });
      expect(last.width).toBeCloseTo(px(4), 5);
    });

    it('왼쪽 핸들(sw) 리사이즈도 크기 변경만 알리고 이동한 위치는 알리지 않는다', async () => {
      create();
      await listen();
      const item = editor.getItem('b')!;
      const grip = el('b').querySelector('.ddr-resize-handle[data-dir="sw"]') as HTMLElement;
      const sx = item.x * STRIDE_X + 6;
      const sy = (item.y + item.h) * STRIDE_Y - 14;
      pointer(grip, 'pointerdown', sx, sy);
      pointer(grip, 'pointermove', sx - 8, sy);
      pointer(grip, 'pointermove', sx - STRIDE_X, sy);
      pointer(grip, 'pointerup', sx - STRIDE_X, sy);
      await frames(3);
      const all = events.flat();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ id: 'b', w: 5, h: 2 });
    });
  });

  describe('정리: 제거/destroy/리스너 해제', () => {
    it('예약된 뒤 destroy 하면 알림이 실행되지 않고 대기 중인 프레임도 취소한다', async () => {
      create();
      const handler = jest.fn();
      editor.on('sizeChange', handler); // 초기 알림이 예약된다
      const cancel = jest.spyOn(window, 'cancelAnimationFrame');
      editor.destroy();
      expect(cancel).toHaveBeenCalled();
      await frames(3);
      expect(handler).not.toHaveBeenCalled();
      cancel.mockRestore();
    });

    it('리스너가 없으면 프레임을 예약하지 않는다', async () => {
      create();
      const raf = jest.spyOn(window, 'requestAnimationFrame');
      editor.moveItem('a', 8, 4);
      editor.resizeItem('a', 6, 3);
      editor.addItem({ id: 'z', w: 2, h: 2 });
      editor.refresh();
      expect(raf).not.toHaveBeenCalled();
      raf.mockRestore();
    });

    it('리스너를 모두 해제하면 예약된 알림이 실행돼도 아무것도 하지 않는다', async () => {
      create();
      const handler = jest.fn();
      editor.on('sizeChange', handler);
      editor.off('sizeChange', handler);
      editor.resizeItem('a', 6, 3);
      await frames(3);
      expect(handler).not.toHaveBeenCalled();
    });

    it('destroy 이후에 프레임이 지나도 오류나 호출이 없다', async () => {
      create();
      await listen();
      editor.resizeItem('a', 6, 3);
      editor.destroy();
      await frames(3);
      expect(events).toHaveLength(0);
    });

    it('setTimeout 대체 경로(requestAnimationFrame 없음)에서도 destroy 가 예약을 취소한다', async () => {
      const realRaf = window.requestAnimationFrame;
      const realCancel = window.cancelAnimationFrame;
      // @ts-expect-error 테스트: rAF 가 없는 환경 흉내
      delete window.requestAnimationFrame;
      // @ts-expect-error 테스트: rAF 가 없는 환경 흉내
      delete window.cancelAnimationFrame;
      try {
        create();
        const handler = jest.fn();
        editor.on('sizeChange', handler);
        editor.destroy();
        await new Promise((r) => setTimeout(r, 40));
        expect(handler).not.toHaveBeenCalled();
      } finally {
        window.requestAnimationFrame = realRaf;
        window.cancelAnimationFrame = realCancel;
      }
    });
  });
});
