import { DEFAULT_BREAKPOINTS, STACK_THRESHOLD_COLUMNS } from '@/constants';
import { DriftBreakpoint, DriftGeometry, DriftItem, DriftLayout } from '@t/DriftLayout';
import { compact } from './compact';
import { clamp, compareYX, normalizeItem } from './geometry';

/** 레이아웃의 breakpoint 목록 (미지정이면 기본값, 빈 배열이면 반응형 비활성). maxWidth 내림차순 */
export function getBreakpoints(layout: Pick<DriftLayout, 'breakpoints'>): DriftBreakpoint[] {
  const list = layout.breakpoints === undefined ? DEFAULT_BREAKPOINTS : layout.breakpoints;
  return list.slice().sort((a, b) => b.maxWidth - a.maxWidth);
}

/** 컨테이너(또는 뷰포트) 너비에 해당하는 breakpoint. 없으면 undefined(기본 레이아웃) */
export function matchBreakpoint(layout: Pick<DriftLayout, 'breakpoints'>, width: number): DriftBreakpoint | undefined {
  // maxWidth 오름차순으로 보면 CSS max-width 캐스케이드와 같은 결과(가장 작은 것이 우선)
  return getBreakpoints(layout)
    .reverse()
    .find((bp) => width <= bp.maxWidth);
}

/**
 * 기본 컬럼 수의 레이아웃을 다른 컬럼 수로 자동 변환한다.
 * - 같거나 더 넓으면 그대로 둔다.
 * - STACK_THRESHOLD_COLUMNS 미만이면 (y, x) 순서를 유지한 전폭 세로 적층.
 * - 그 외에는 비례 축소 후 충돌을 해소한다.
 */
export function deriveItems(
  items: readonly DriftItem[],
  fromColumns: number,
  toColumns: number,
  float = false,
): DriftItem[] {
  if (toColumns >= fromColumns) {
    return compact(
      items.map((item) => normalizeItem(item, toColumns)),
      undefined,
      float,
    );
  }

  if (toColumns < STACK_THRESHOLD_COLUMNS) {
    const sorted = items.slice().sort(compareYX);
    const stacked = new Map<string, DriftItem>();
    let y = 0;
    for (const item of sorted) {
      const next = normalizeItem({ ...item, x: 0, y, w: toColumns, minW: undefined, maxW: undefined }, toColumns);
      stacked.set(item.id, { ...next, minW: item.minW, maxW: item.maxW });
      y += next.h;
    }
    return items.map((item) => stacked.get(item.id) as DriftItem);
  }

  const ratio = toColumns / fromColumns;
  const scaled = items.map((item) => {
    // 시작/끝 경계를 각각 반올림해야 맞닿은 항목이 축소 후에도 맞닿는다
    const left = clamp(Math.round(item.x * ratio), 0, toColumns - 1);
    const right = clamp(Math.round((item.x + item.w) * ratio), left + 1, toColumns);
    return normalizeItem({ ...item, x: left, w: right - left }, toColumns);
  });
  return compact(scaled, undefined, float);
}

/**
 * 특정 breakpoint 에서 실제로 쓰일 위치/크기를 반환한다 (breakpoint 가 없으면 기본 레이아웃).
 * 명시된 responsive[bp] 가 있는 항목은 그 값을 쓰고, 나머지는 자동 변환값을 쓴다.
 * 명시 항목은 고정, 자동 항목이 비켜간다.
 */
export function resolveItems(layout: DriftLayout, bp?: DriftBreakpoint): DriftItem[] {
  if (!bp) return layout.items.map((item) => ({ ...item }));

  const derived = deriveItems(layout.items, layout.columns, bp.columns, !!layout.float);
  const explicitIds = new Set<string>();
  const merged = derived.map((item, i) => {
    const explicit = layout.items[i].responsive?.[bp.name];
    if (!explicit) return item;
    explicitIds.add(item.id);
    return normalizeItem({ ...item, ...pickGeometry(explicit) }, bp.columns);
  });

  if (explicitIds.size === 0) return merged;

  // 명시 항목을 locked 로 취급해 자동 항목이 비켜가게 한 뒤 원래 상태로 되돌린다
  const pinned = merged.map((item) => (explicitIds.has(item.id) ? { ...item, locked: true } : item));
  return compact(pinned, undefined, !!layout.float).map((item, i) => (explicitIds.has(item.id) ? merged[i] : item));
}

/** breakpoint(또는 기본)의 위치/크기를 items 로 덮어쓴 새 레이아웃을 반환한다 */
export function applyItems(layout: DriftLayout, items: readonly DriftItem[], bp?: DriftBreakpoint): DriftLayout {
  const byId = new Map(items.map((item) => [item.id, item]));
  const next = layout.items.map((orig) => {
    const edited = byId.get(orig.id);
    if (!edited) return orig;
    const meta = { ...orig, ...omitGeometry(edited) };
    if (!bp) return { ...meta, ...pickGeometry(edited) };
    return { ...meta, responsive: { ...orig.responsive, [bp.name]: pickGeometry(edited) } };
  });
  return { ...layout, items: next };
}

function pickGeometry(g: DriftGeometry): DriftGeometry {
  return { x: g.x, y: g.y, w: g.w, h: g.h };
}

function omitGeometry(item: DriftItem): Partial<DriftItem> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { x, y, w, h, responsive, ...rest } = item;
  return rest;
}
