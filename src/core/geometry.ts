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

/**
 * 한 축에서 이동 중인 항목의 '진행 방향 끝'이 다음 셀의 50% 를 지났을 때만 셀을 바꾼다.
 * - 양(+) 방향: 항목의 끝(pos + size)이 다음 셀의 중간을 넘으면 이동
 * - 음(-) 방향: 항목의 시작(pos)이 이전 셀의 중간을 넘으면 이동
 * @param pos 항목의 픽셀 시작 위치
 * @param size 항목의 픽셀 크기
 * @param cur 현재 대상 셀 좌표
 * @param span 항목의 셀 크기
 * @param cell 셀 한 칸의 픽셀 크기 (gap 제외)
 * @param pitch 셀 한 칸 + gap
 */
export function resolveAxisCell(
  pos: number,
  size: number,
  cur: number,
  span: number,
  cell: number,
  pitch: number,
): number {
  const curPx = cur * pitch;
  if (pos > curPx) {
    const last = Math.ceil((pos + size - cell / 2) / pitch) - 1; // 끝이 중간을 넘은 마지막 셀
    return Math.max(cur, last - span + 1);
  }
  if (pos < curPx) {
    const first = Math.floor((pos - cell / 2) / pitch) + 1; // 시작이 중간을 넘은 첫 셀
    return Math.min(cur, first);
  }
  return cur;
}

/**
 * 드래그 중 대상 셀을 계산한다. 셀 기준 50% 판정(`resolveAxisCell`) 후, 겹친 항목의 '실제 크기' 기준으로 보정한다.
 * - 왼쪽/위로 이동: 시작 가장자리가 겹친 항목의 너비/높이 50% 를 지나야 그 항목 자리로 들어간다
 * - 오른쪽/아래로 이동: 끝 가장자리가 겹친 항목의 너비/높이 50% 를 지나야 들어간다
 * 계산은 세션 시작 시점의 항목(items)을 기준으로 하며 자기 자신(selfId)은 제외한다.
 */
export function resolveDragCell(
  items: readonly DriftItem[],
  selfId: string,
  cur: { x: number; y: number },
  pos: { left: number; top: number },
  size: { w: number; h: number },
  px: { width: number; height: number },
  m: DriftMetrics,
): { x: number; y: number } {
  const others = items.filter((it) => it.id !== selfId);
  const pitchX = m.cellWidth + m.gap;
  const pitchY = m.rowHeight + m.gap;
  let x = resolveAxisCell(pos.left, px.width, cur.x, size.w, m.cellWidth, pitchX);
  let y = resolveAxisCell(pos.top, px.height, cur.y, size.h, m.rowHeight, pitchY);

  const hold = (axis: 'x' | 'y', cand: number): number => {
    const horizontal = axis === 'x';
    const sA = horizontal ? 'w' : 'h';
    const oA = horizontal ? 'y' : 'x';
    const oS = horizontal ? 'h' : 'w';
    const oCand = horizontal ? y : x;
    const oSpan = horizontal ? size.h : size.w;
    const span = horizontal ? size.w : size.h;
    const curA = horizontal ? cur.x : cur.y;
    const pitch = horizontal ? pitchX : pitchY;
    const cell = horizontal ? m.cellWidth : m.rowHeight;
    const start = horizontal ? pos.left : pos.top;
    const length = horizontal ? px.width : px.height;

    for (let n = 0; n < 16; n++) {
      let changed = false;
      for (const it of others) {
        if (!(it[oA] < oCand + oSpan && it[oA] + it[oS] > oCand)) continue;
        if (!(it[axis] < cand + span && it[axis] + it[sA] > cand)) continue;
        const mid = it[axis] * pitch + (it[sA] * cell + (it[sA] - 1) * m.gap) / 2;
        let next = cand;
        if (cand < curA && start > mid) next = Math.min(curA, it[axis] + it[sA]);
        else if (cand > curA && start + length < mid) next = Math.max(curA, it[axis] - span);
        if (next !== cand) {
          cand = next;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return cand;
  };

  x = hold('x', x);
  y = hold('y', y);
  return { x, y };
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
