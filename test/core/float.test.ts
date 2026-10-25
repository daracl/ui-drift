import {
  addItem,
  collides,
  compact,
  createLayout,
  DriftItem,
  moveItem,
  parseLayout,
  removeItem,
  resizeItem,
  resolveItems,
  serializeLayout,
} from '@/core';
import { renderViewer } from '@/viewer';

const item = (id: string, x: number, y: number, w: number, h: number): DriftItem => ({ id, x, y, w, h });
const byId = (items: DriftItem[], id: string) => items.find((i) => i.id === id) as DriftItem;

describe('float (드롭 위치 유지)', () => {
  it('compact: 기본은 위로 올리고 float 는 그대로 둔다', () => {
    const items = [item('a', 0, 5, 4, 2)];
    expect(compact(items)[0].y).toBe(0);
    expect(compact(items, undefined, true)[0].y).toBe(5);
  });

  it('moveItem: float 이면 놓은 y 가 유지된다', () => {
    const items = [item('a', 0, 0, 4, 2), item('b', 4, 0, 4, 2)];
    expect(byId(moveItem(items, 12, 'a', 8, 6), 'a').y).toBe(0); // 중력: 위로 올라간다
    expect(byId(moveItem(items, 12, 'a', 8, 6, true), 'a')).toMatchObject({ x: 8, y: 6 });
  });

  it('float 에서도 겹치면 충돌한 항목만 아래로 밀리고 겹침이 없다', () => {
    const items = [item('a', 0, 0, 4, 2), item('b', 4, 5, 4, 2)];
    const moved = moveItem(items, 12, 'a', 4, 4, true);
    expect(byId(moved, 'a')).toMatchObject({ x: 4, y: 4 });
    expect(byId(moved, 'b').y).toBe(6);
    expect(collides(byId(moved, 'a'), byId(moved, 'b'))).toBe(false);
  });

  it('removeItem/resizeItem 도 위로 끌어올리지 않는다', () => {
    const items = [item('a', 0, 0, 4, 2), item('b', 0, 6, 4, 2)];
    expect(byId(removeItem(items, 'a', true), 'b').y).toBe(6);
    expect(byId(resizeItem(items, 12, 'a', 4, 3, true), 'b').y).toBe(6);
  });

  it('addItem: 위치를 지정하면 그 자리에 놓인다', () => {
    const items = addItem([], 12, { id: 'a', x: 2, y: 7, w: 2, h: 2 }, true);
    expect(items[0]).toMatchObject({ x: 2, y: 7 });
  });

  it('float 는 레이아웃에 저장되고 JSON 왕복/반응형/Viewer 에 반영된다', () => {
    const layout = createLayout({ float: true, items: [item('a', 0, 5, 4, 2)] });
    expect(layout.float).toBe(true);
    expect(layout.items[0].y).toBe(5);

    const restored = parseLayout(serializeLayout(layout));
    expect(restored).toEqual(layout);

    expect(createLayout({ items: [item('a', 0, 5, 4, 2)] }).float).toBeUndefined();

    const bp = { name: 'tablet', maxWidth: 1024, columns: 8 };
    expect(resolveItems(layout, bp)[0].y).toBe(5);

    expect(renderViewer(layout).css).toContain('[data-y="5"]{grid-row-start:6}');
    expect(renderViewer({ ...layout, float: false }).css).toContain('[data-y="0"]{grid-row-start:1}');
  });
});
