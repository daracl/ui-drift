import { DriftGeometry, DriftItem } from '@t/DriftLayout';
import { compact } from './compact';
import { firstCollision, getRowCount, normalizeItem } from './geometry';

export type DriftItemInput = Partial<DriftGeometry> & Omit<DriftItem, keyof DriftGeometry>;

/** 빈 자리를 위에서 아래, 왼쪽에서 오른쪽 순으로 찾는다 */
export function findFreePosition(
  items: readonly DriftItem[],
  columns: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const width = Math.min(w, columns);
  const maxY = getRowCount(items);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + width <= columns; x++) {
      if (!firstCollision(items, { x, y, w: width, h })) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

/**
 * 항목을 추가한다. x/y 가 없으면 빈 자리에 자동 배치하고, 있으면 그 자리에 놓고 겹친 항목을 민다.
 * id 가 비어 있거나 이미 있으면 예외를 던진다.
 */
export function addItem(
  items: readonly DriftItem[],
  columns: number,
  input: DriftItemInput,
  float = false,
): DriftItem[] {
  if (!input || typeof input.id !== 'string' || input.id === '') {
    throw new Error('[drift] item.id 는 비어 있지 않은 문자열이어야 합니다.');
  }
  if (items.some((item) => item.id === input.id)) {
    throw new Error(`[drift] 이미 존재하는 id 입니다: ${input.id}`);
  }

  const sized = normalizeItem({ x: 0, y: 0, w: 2, h: 2, ...input } as DriftItem, columns);
  const hasPosition = Number.isFinite(input.x) && Number.isFinite(input.y);
  const placed = hasPosition ? sized : { ...sized, ...findFreePosition(items, columns, sized.w, sized.h) };

  return compact([...items, placed], placed.locked ? undefined : placed.id, float);
}

export function removeItem(items: readonly DriftItem[], id: string, float = false): DriftItem[] {
  return compact(
    items.filter((item) => item.id !== id),
    undefined,
    float,
  );
}

/** 위치를 변경한다. locked 항목과 겹치게 되면 변경을 거부하고 사본을 반환한다 */
export function moveItem(
  items: readonly DriftItem[],
  columns: number,
  id: string,
  x: number,
  y: number,
  float = false,
): DriftItem[] {
  return transform(items, columns, id, (item) => ({ ...item, x, y }), false, float);
}

/** 크기를 변경한다. min/max/컬럼 범위로 보정된다. locked 또는 resizable:false 항목은 거부한다 */
export function resizeItem(
  items: readonly DriftItem[],
  columns: number,
  id: string,
  w: number,
  h: number,
  float = false,
): DriftItem[] {
  // resizable:false 항목은 크기를 바꿀 수 없다 (updateItem 으로 프로그램에서 바꾸는 것은 허용)
  if (items.some((item) => item.id === id && item.resizable === false)) return items.slice();
  return transform(items, columns, id, (item) => ({ ...item, w, h }), false, float);
}

/**
 * 왼쪽 모서리에서 크기를 변경한다: 오른쪽 가장자리(x + w)를 고정하고 x 와 w 가 함께 바뀐다.
 * min/max 폭과 왼쪽 경계(x ≥ 0)를 지키며, locked 또는 resizable:false 항목은 거부한다.
 */
export function resizeItemFromLeft(
  items: readonly DriftItem[],
  columns: number,
  id: string,
  w: number,
  h: number,
  float = false,
): DriftItem[] {
  const target = items.find((item) => item.id === id);
  if (!target || target.locked || target.resizable === false) return items.slice();

  const right = target.x + target.w;
  const minW = Math.max(1, Math.min(columns, Math.round(target.minW ?? 1)));
  const maxW = Math.max(minW, Math.min(right, columns, Math.round(target.maxW ?? columns)));
  const width = Math.min(Math.max(Math.round(w), minW), maxW);
  return transform(items, columns, id, (item) => ({ ...item, x: right - width, w: width, h }), false, float);
}

/** 임의 속성을 갱신한다 (위치/크기가 바뀌면 재배치). locked 항목도 프로그램에서는 갱신할 수 있다 */
export function updateItem(
  items: readonly DriftItem[],
  columns: number,
  id: string,
  patch: Partial<Omit<DriftItem, 'id'>>,
  float = false,
): DriftItem[] {
  return transform(items, columns, id, (item) => ({ ...item, ...patch, id: item.id }), true, float);
}

function transform(
  items: readonly DriftItem[],
  columns: number,
  id: string,
  fn: (item: DriftItem) => DriftItem,
  allowLocked = false,
  float = false,
): DriftItem[] {
  const target = items.find((item) => item.id === id);
  if (!target || (target.locked && !allowLocked)) return items.slice();

  const next = normalizeItem(fn(target), columns);
  const locked = items.filter((item) => item.id !== id && item.locked);
  if (firstCollision(locked, next)) return items.slice();

  return compact(
    items.map((item) => (item.id === id ? next : item)),
    next.locked ? undefined : id,
    float,
  );
}

/** 모든 항목을 정규화하고 압축한다 (불러오기 직후 호출) */
export function normalizeItems(items: readonly DriftItem[], columns: number, float = false): DriftItem[] {
  return compact(
    items.map((item) => normalizeItem(item, columns)),
    undefined,
    float,
  );
}
