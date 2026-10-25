import { DriftGeometry, DriftItem, DriftMetrics, DriftRect } from '@t/DriftLayout';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const toInt = (v: unknown, fallback: number): number => (isNum(v) ? Math.round(v) : fallback);

export const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

/** 두 영역이 겹치는지 검사한다 (맞닿기만 한 경우는 겹침이 아니다) */
export function collides(a: DriftGeometry, b: DriftGeometry): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 대상과 겹치는 첫 항목을 반환한다 */
export function firstCollision(
  items: readonly DriftItem[],
  geo: DriftGeometry,
  ignoreId?: string,
): DriftItem | undefined {
  for (const item of items) {
    if (item.id !== ignoreId && collides(item, geo)) return item;
  }
  return undefined;
}

export function findCollisions(items: readonly DriftItem[], geo: DriftGeometry, ignoreId?: string): DriftItem[] {
  return items.filter((item) => item.id !== ignoreId && collides(item, geo));
}

/** (y, x) 순 비교. id 로 동률을 깨서 항상 같은 결과를 보장한다 */
export function compareYX(a: DriftItem, b: DriftItem): number {
  return a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** min/max/컬럼 범위를 적용해 위치와 크기를 유효한 정수로 만든다 */
export function normalizeItem(item: DriftItem, columns: number): DriftItem {
  const minW = Math.min(columns, Math.max(1, toInt(item.minW, 1)));
  const minH = Math.max(1, toInt(item.minH, 1));
  const maxW = Math.min(columns, Math.max(minW, toInt(item.maxW, columns)));
  const maxH = Math.max(minH, toInt(item.maxH, Number.MAX_SAFE_INTEGER));

  const w = clamp(toInt(item.w, minW), minW, maxW);
  const h = clamp(toInt(item.h, minH), minH, maxH);
  const x = clamp(toInt(item.x, 0), 0, Math.max(0, columns - w));
  const y = Math.max(0, toInt(item.y, 0));

  return { ...item, x, y, w, h };
}

/** 컨테이너 너비로부터 셀 크기를 계산한다 */
export function createMetrics(containerWidth: number, columns: number, rowHeight: number, gap: number): DriftMetrics {
  const cellWidth = Math.max(0, (containerWidth - gap * (columns - 1)) / columns);
  return { columns, cellWidth, rowHeight, gap };
}

/** 그리드 좌표 → 픽셀 영역 */
export function toPixelRect(geo: DriftGeometry, m: DriftMetrics): DriftRect {
  return {
    left: geo.x * (m.cellWidth + m.gap),
    top: geo.y * (m.rowHeight + m.gap),
    width: geo.w * m.cellWidth + (geo.w - 1) * m.gap,
    height: geo.h * m.rowHeight + (geo.h - 1) * m.gap,
  };
}

/** 픽셀 위치(컨테이너 기준 좌상단) → 가장 가까운 셀 좌표 */
export function toGridPosition(left: number, top: number, m: DriftMetrics): { x: number; y: number } {
  return {
    x: Math.round(left / (m.cellWidth + m.gap)),
    y: Math.max(0, Math.round(top / (m.rowHeight + m.gap))),
  };
}

/** 픽셀 크기 → 가장 가까운 셀 크기 */
export function toGridSize(width: number, height: number, m: DriftMetrics): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round((width + m.gap) / (m.cellWidth + m.gap))),
    h: Math.max(1, Math.round((height + m.gap) / (m.rowHeight + m.gap))),
  };
}

/**
 * 겹치는 항목이 하나라도 있는지 검사한다.
 * 열별로 y 순으로 정렬해 앞선 항목들의 가장 큰 하단과만 비교하므로 O(n·w + n log n) 이다.
 */
export function hasOverlap(items: readonly DriftItem[]): boolean {
  const cols = new Map<number, DriftItem[]>();
  for (const item of items) {
    for (let c = item.x; c < item.x + item.w; c++) {
      let list = cols.get(c);
      if (!list) cols.set(c, (list = []));
      list.push(item);
    }
  }
  for (const list of cols.values()) {
    list.sort((a, b) => a.y - b.y);
    let bottom = -Infinity;
    for (const item of list) {
      if (item.y < bottom) return true;
      bottom = Math.max(bottom, item.y + item.h);
    }
  }
  return false;
}

/** 항목들의 하단 행 (총 행 수) */
export function getRowCount(items: readonly DriftItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}
