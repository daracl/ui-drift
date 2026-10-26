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

/** 이동 판정 비율: 진행 방향의 가장자리가 대상 크기의 60% 를 지나야 자리를 바꾼다 */
export const MOVE_THRESHOLD = 0.6;

/**
 * 한 축에서 이동 중인 항목의 '진행 방향 끝'이 다음 셀의 60% 를 지났을 때만 셀을 바꾼다.
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
    const last = Math.ceil((pos + size - cell * MOVE_THRESHOLD) / pitch) - 1; // 끝이 60% 를 넘은 마지막 셀
    return Math.max(cur, last - span + 1);
  }
  if (pos < curPx) {
    const first = Math.floor((pos - cell * (1 - MOVE_THRESHOLD)) / pitch) + 1; // 시작이 60% 를 넘은 첫 셀
    return Math.min(cur, first);
  }
  return cur;
}

/**
 * 드래그 중 대상 셀을 계산한다. 셀 기준 60% 판정(`resolveAxisCell`) 후, 겹친 항목의 '실제 크기' 기준으로 보정한다.
 * - 왼쪽/위로 이동: 시작 가장자리가 겹친 항목의 너비/높이 60% 를 지나야 그 항목 자리로 들어간다
 * - 오른쪽/아래로 이동: 끝 가장자리가 겹친 항목의 너비/높이 60% 를 지나야 들어간다
 * - 아래로 이동(압축 모드): 드래그 항목의 아래쪽 가장자리가 겹친 항목의 높이 60% 를 지나면 그 항목의 바로 아래 칸으로 넘긴다.
 *   겹친 자리에 놓으면 아래로 밀린 항목 때문에 압축 후 원래 자리로 돌아오므로, 항목 아래로 건너가야 둘의 순서가 바뀐다.
 *   float 모드는 압축하지 않으므로 겹친 자리에 그대로 놓는다.
 * 계산은 세션 시작 시점의 항목(items)을 기준으로 하며 자기 자신(selfId)은 제외한다.
 * 단 60% 선(mid)은 화면에 지금 보이는 배치(shown, 직전 미리보기)에서 그 항목이 있는 자리 기준이다.
 * 항목이 압축으로 밀려 올라가 있으면 원래 자리가 아니라 보이는 자리의 60% 를 지나야 반응한다.
 */
export function resolveDragCell(
  items: readonly DriftItem[],
  selfId: string,
  cur: { x: number; y: number },
  pos: { left: number; top: number },
  size: { w: number; h: number },
  px: { width: number; height: number },
  m: DriftMetrics,
  float = false,
  shown: readonly DriftItem[] = items,
  down = true,
): { x: number; y: number } {
  const others = items.filter((it) => it.id !== selfId);
  const shownById = new Map(shown.map((it) => [it.id, it]));
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

    // 세로(압축 모드): 열이 겹치는 항목마다 '내 위에 놓일지, 아래에 놓일지'를 화면에 보이는 배치 기준으로 정하고,
    // 그 순서가 되는 칸을 세션 시작 시점 배치에서 한 번에 구한다.
    // - 보이는 배치에서 아래에 있는 항목: 드래그 항목의 아래쪽 가장자리(bottom)가 그 항목의 60% 를 지나면 위로 간다
    // - 보이는 배치에서 위에 있는 항목: 드래그 항목의 위쪽 가장자리가 그 항목의 60% 를 지나기 전까지는 위에 남는다
    // 위에 놓일 항목들의 하단 중 가장 아래(lower) 이상, 아래에 놓일 항목들과 겹치지 않는 가장 높은 칸이 목표이다.
    // 항목마다 따로 보정하면 서로를 번갈아 되돌리거나, 압축으로 밀려 올라간 항목의 원래 자리를 기준으로 오판한다.
    if (!horizontal && !float) {
      const selfShown = shownById.get(selfId);
      const shownY = selfShown ? selfShown.y : curA;
      const bottom = start + length;
      let lower = 0;
      let upper = Infinity;
      for (const it of others) {
        if (!(it.x < oCand + oSpan && it.x + it.w > oCand)) continue;
        const d = shownById.get(it.id) ?? it;
        const len = d.h * cell + (d.h - 1) * m.gap;
        const mark = d.y * pitch + len * (1 - MOVE_THRESHOLD); // 항목의 40% 지점
        const line = d.y * pitch + len * MOVE_THRESHOLD; // 항목의 60% 지점
        // 끌고 있는 방향의 가장자리(아래로: bottom, 위로: top)로만 판정해 두 상태의 경계를 겹치지 않게 한다.
        // 반대쪽 가장자리를 섞으면 항목에 걸친 채 지날 때(top 은 위, bottom 은 아래) 위/아래 placeholder 가 번갈아 생긴다
        //  - 아래로: 아래에 있는 항목은 bottom > 60%, 이미 위에 있는 항목은 bottom > 40% 이면 위에 둔다
        //  - 위로:   아래에 있는 항목은 top >= 60%, 이미 위에 있는 항목은 top >= 40% 이면 위에 둔다
        const edge = down ? bottom : start;
        const above = d.y > shownY ? edge >= line : d.y < shownY ? edge >= mark : start >= mark;
        if (above) lower = Math.max(lower, it.y + it.h);
        else upper = Math.min(upper, it.y);
      }
      return Math.max(Math.min(cand, upper - span), lower);
    }

    for (let n = 0; n < 16; n++) {
      let changed = false;
      for (const it of others) {
        if (!(it[oA] < oCand + oSpan && it[oA] + it[oS] > oCand)) continue;
        if (!(it[axis] < cand + span && it[axis] + it[sA] > cand)) continue;
        const d = shownById.get(it.id) ?? it; // 화면에 보이는 위치
        const len = d[sA] * cell + (d[sA] - 1) * m.gap;
        const fwd = d[axis] * pitch + len * MOVE_THRESHOLD; // 아래/오른쪽으로 지나는 선
        const back = d[axis] * pitch + len * (1 - MOVE_THRESHOLD); // 위/왼쪽으로 지나는 선
        let next = cand;
        // 위/왼쪽: 드래그 항목의 시작 가장자리가 대상의 60% 를 지나야 한다
        if (cand < curA && start > back) next = Math.min(curA, it[axis] + it[sA]);
        // 아래/오른쪽: 드래그 항목의 끝 가장자리(bottom/right)가 대상의 60% 를 지나야 한다
        else if (cand > curA && start + length < fwd) next = Math.max(curA, it[axis] - span);
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
