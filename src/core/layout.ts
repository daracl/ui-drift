import { DEFAULT_COLUMNS, DEFAULT_GAP, DEFAULT_ROW_HEIGHT, LAYOUT_VERSION } from '@/constants';
import { cloneJson, isArray, isPlainObject, isString } from '@daracl/core/utils';
import {
  DriftBreakpoint,
  DriftGeometry,
  DriftItem,
  DriftLayout,
  DriftPropValue,
  DriftValidationResult,
} from '@t/DriftLayout';
import { collides } from './geometry';
import { normalizeItems } from './operations';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** 부분 입력으로 유효한 레이아웃을 만든다. 항목은 정규화/압축된다 */
export function createLayout(input: Partial<DriftLayout> = {}): DriftLayout {
  const columns = isInt(input.columns) && input.columns > 0 ? input.columns : DEFAULT_COLUMNS;
  const layout: DriftLayout = {
    version: LAYOUT_VERSION,
    columns,
    rowHeight: positive(input.rowHeight, DEFAULT_ROW_HEIGHT),
    gap: nonNegative(input.gap, DEFAULT_GAP),
    items: normalizeItems(sanitizeItems(input.items), columns, input.float === true),
  };
  if (input.float === true) layout.float = true;
  if (input.breakpoints) layout.breakpoints = input.breakpoints.map((bp) => ({ ...bp }));
  return layout;
}

function positive(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

function nonNegative(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** id 가 없거나 중복인 항목은 버린다 */
function sanitizeItems(items: unknown): DriftItem[] {
  if (!isArray(items)) return [];
  const seen = new Set<string>();
  const result: DriftItem[] = [];
  for (const raw of items) {
    if (!isPlainObject(raw) || !isString(raw.id) || raw.id === '' || seen.has(raw.id)) continue;
    seen.add(raw.id);
    result.push(raw as unknown as DriftItem);
  }
  return result;
}

/** 레이아웃을 깊은 복사한다 */
export function cloneLayout(layout: DriftLayout): DriftLayout {
  return cloneJson(layout);
}

/** 레이아웃 유효성을 검사한다. 보정 없이 문제를 모두 수집한다 */
export function validateLayout(layout: unknown): DriftValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(layout)) return { valid: false, errors: ['layout 은 객체여야 합니다.'] };

  if (layout.version !== LAYOUT_VERSION) errors.push(`지원하지 않는 version: ${String(layout.version)}`);
  if (!isInt(layout.columns) || layout.columns < 1) errors.push('columns 는 1 이상의 정수여야 합니다.');
  if (typeof layout.rowHeight !== 'number' || !(layout.rowHeight > 0)) errors.push('rowHeight 는 0 보다 커야 합니다.');
  if (typeof layout.gap !== 'number' || !(layout.gap >= 0)) errors.push('gap 은 0 이상이어야 합니다.');
  if (!isArray(layout.items)) {
    errors.push('items 는 배열이어야 합니다.');
    return { valid: false, errors };
  }

  const columns = isInt(layout.columns) ? layout.columns : 0;
  const ids = new Set<string>();
  const items = layout.items as unknown[];
  items.forEach((raw, index) => {
    if (!isPlainObject(raw)) return errors.push(`items[${index}] 는 객체여야 합니다.`);
    const label = `items[${index}](${String(raw.id)})`;
    if (!isString(raw.id) || raw.id === '') errors.push(`${label}: id 가 필요합니다.`);
    else if (ids.has(raw.id)) errors.push(`${label}: id 가 중복되었습니다.`);
    else ids.add(raw.id);

    for (const key of ['x', 'y', 'w', 'h'] as const) {
      if (!isInt(raw[key])) errors.push(`${label}: ${key} 는 정수여야 합니다.`);
    }
    if (isInt(raw.x) && isInt(raw.w)) {
      if (raw.x < 0 || raw.w < 1 || (columns > 0 && raw.x + raw.w > columns))
        errors.push(`${label}: 컬럼 범위를 벗어났습니다.`);
    }
    if (isInt(raw.y) && isInt(raw.h) && (raw.y < 0 || raw.h < 1)) errors.push(`${label}: 행 범위가 잘못되었습니다.`);
    if (raw.responsive !== undefined && !isPlainObject(raw.responsive))
      errors.push(`${label}: responsive 형식이 잘못되었습니다.`);
  });

  // 겹침 검사 (좌표가 모두 정수인 항목만)
  const geos = items.filter(
    (raw): raw is DriftItem => isPlainObject(raw) && isInt(raw.x) && isInt(raw.y) && isInt(raw.w) && isInt(raw.h),
  );
  for (let i = 0; i < geos.length; i++) {
    for (let j = i + 1; j < geos.length; j++) {
      if (collides(geos[i], geos[j])) errors.push(`items(${geos[i].id}, ${geos[j].id}): 서로 겹칩니다.`);
    }
  }

  if (layout.breakpoints !== undefined) {
    if (!isArray(layout.breakpoints)) errors.push('breakpoints 는 배열이어야 합니다.');
    else {
      (layout.breakpoints as unknown[]).forEach((bp, i) => {
        if (!isPlainObject(bp) || !isString(bp.name) || !isInt(bp.maxWidth) || !isInt(bp.columns) || bp.columns < 1) {
          errors.push(`breakpoints[${i}] 형식이 잘못되었습니다.`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/** JSON 문자열로 직렬화한다 */
export function serializeLayout(layout: DriftLayout, space?: number): string {
  return JSON.stringify(layout, null, space);
}

/**
 * JSON 문자열 또는 객체를 레이아웃으로 복원한다.
 * 잘못된 데이터는 보정(정규화)하며, 구조 자체가 올바르지 않으면 예외를 던진다.
 */
export function parseLayout(input: string | unknown): DriftLayout {
  let data: unknown = input;
  if (isString(input)) {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new Error('[drift] 레이아웃 JSON 을 해석할 수 없습니다.');
    }
  }
  if (!isPlainObject(data)) throw new Error('[drift] 레이아웃은 객체여야 합니다.');
  if (data.version !== undefined && data.version !== LAYOUT_VERSION) {
    throw new Error(`[drift] 지원하지 않는 레이아웃 version: ${String(data.version)}`);
  }

  const raw = data as Partial<DriftLayout>;
  const base = createLayout({ ...raw, items: [] });
  const items = sanitizeItems(raw.items).map((item) => sanitizeItem(item));
  const layout = { ...base, items: normalizeItems(items, base.columns, base.float === true) };
  const breakpoints = sanitizeBreakpoints(raw.breakpoints);
  if (breakpoints) layout.breakpoints = breakpoints;
  return layout;
}

function sanitizeBreakpoints(value: unknown): DriftBreakpoint[] | undefined {
  if (!isArray(value)) return undefined;
  return value
    .filter((bp) => isPlainObject(bp) && isString(bp.name) && isInt(bp.maxWidth) && isInt(bp.columns) && bp.columns > 0)
    .map((bp) => ({ name: bp.name, maxWidth: bp.maxWidth, columns: bp.columns }));
}

/**
 * 알려진 필드만 남기고 형식이 잘못된 값은 버린다. 입력을 변경하지 않고 새 객체를 반환한다.
 * (위치/크기 값은 정규화하지 않는다. normalizeItem 으로 별도 보정한다)
 */
export function sanitizeItem(raw: DriftItem): DriftItem {
  const item: DriftItem = { id: raw.id, x: raw.x, y: raw.y, w: raw.w, h: raw.h };
  for (const key of ['minW', 'minH', 'maxW', 'maxH'] as const) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) item[key] = raw[key];
  }
  if (raw.locked === true) item.locked = true;
  // true/false 모두 의미가 있다: 생략하면 locked 를 따르고, 명시하면 locked 와 무관하게 크기 조절 가능 여부를 정한다
  if (typeof raw.resizable === 'boolean') item.resizable = raw.resizable;
  if (isString(raw.title)) item.title = raw.title;
  if (isString(raw.content)) item.content = raw.content;
  if (isPlainObject(raw.props)) {
    const props: Record<string, DriftPropValue> = {};
    for (const [k, v] of Object.entries(raw.props)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) props[k] = v as DriftPropValue;
    }
    item.props = props;
  }
  if (isPlainObject(raw.responsive)) {
    const responsive: Record<string, DriftGeometry> = {};
    for (const [name, g] of Object.entries(raw.responsive)) {
      if (isPlainObject(g) && [g.x, g.y, g.w, g.h].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        responsive[name] = { x: g.x as number, y: g.y as number, w: g.w as number, h: g.h as number };
      }
    }
    item.responsive = responsive;
  }
  return item;
}
