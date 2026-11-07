import { cloneJson } from '@daracl/core/utils';
import { DriftBreakpoint, DriftItem, DriftLayout } from '@t/DriftLayout';
import { compact } from './compact';
import { isMovable } from './flags';
import { firstCollision, hasOverlap, normalizeItem } from './geometry';
import { addItem, removeItem, updateItem } from './operations';
import { applyItems, resolveItems } from './responsive';

/** planTransfer 가 계산할 수 없는(예상 가능한) 거절 사유 */
export type DriftTransferPlanReject = 'missing-item' | 'locked' | 'id-conflict' | 'invalid-size' | 'blocked';

export interface DriftTransferPlanInput {
  /** 원본 레이아웃과 원본에서 지금 편집 중인 breakpoint (없으면 기본 레이아웃) */
  source: DriftLayout;
  sourceBreakpoint?: DriftBreakpoint;
  /** 대상 레이아웃과 대상에서 지금 편집 중인 breakpoint */
  target: DriftLayout;
  targetBreakpoint?: DriftBreakpoint;
  itemId: string;
  /** 대상의 현재 편집 breakpoint(없으면 기본) 셀 좌표. 둘 다 생략하면 자동 배치 */
  x?: number;
  y?: number;
  /** 대상에서 쓸 id (생략하면 원래 id) */
  newId?: string;
}

export type DriftTransferPlan =
  | {
      ok: true;
      /** 항목을 뺀 원본 레이아웃 (원본 정책으로 재배치) */
      source: DriftLayout;
      /** 항목을 넣은 대상 레이아웃 (대상 정책으로 배치) */
      target: DriftLayout;
      /** 원본에 있던 항목 (기본 레이아웃 값, 복사본) */
      before: DriftItem;
      /** 대상에서 보이는 항목 (대상의 현재 breakpoint 기준, 복사본) */
      after: DriftItem;
    }
  | { ok: false; reason: DriftTransferPlanReject };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 항목 하나를 다른 레이아웃으로 옮긴 결과를 계산한다. 입력 레이아웃은 바꾸지 않는다 (순수 함수).
 *
 * - 원본: 에디터 `removeItem` 과 같은 규칙(현재 breakpoint 기준 제거 후 원본 float 정책으로 재배치).
 *   breakpoint 편집 중이어도 항목은 전체 레이아웃에서 빠지므로 다른 breakpoint 에 남지 않는다.
 * - 대상: 에디터 `addItem` 과 같은 규칙. 크기는 원본에서 보이던 셀 수(w/h)를 시작값으로 대상 열 수와 min/max 로 정규화한다.
 *   원본의 `responsive` 값은 컨테이너마다 breakpoint 의미가 달라 복사하지 않는다(대상에서는 새 항목). 좌표를 주면
 *   대상 breakpoint 편집 중에는 기본 레이아웃 자동 배치 + 그 breakpoint 의 명시 위치로 저장한다.
 * - 거절: 항목 없음(missing-item), 위치 고정(locked), 대상 id 충돌(id-conflict),
 *   대상 열 수보다 큰 minW 나 만족할 수 없는 min/max(invalid-size), 지정 위치가 대상의 locked 와 겹침(blocked).
 */
export function planTransfer(input: DriftTransferPlanInput): DriftTransferPlan {
  const { source, sourceBreakpoint: sbp, target, targetBreakpoint: tbp, itemId } = input;
  const base = source.items.find((item) => item.id === itemId);
  if (!base) return { ok: false, reason: 'missing-item' };
  if (!isMovable(base)) return { ok: false, reason: 'locked' };
  const id = input.newId ?? base.id;
  if (target.items.some((item) => item.id === id)) return { ok: false, reason: 'id-conflict' };

  // 크기 제약: minW 를 몰래 낮추지 않는다 (normalizeItem 은 열 수로 보정하므로 먼저 원래 값으로 검사한다)
  const columns = tbp ? Math.min(tbp.columns, target.columns) : target.columns;
  const minW = isInt(base.minW) ? Math.max(1, Math.round(base.minW)) : 1;
  const minH = isInt(base.minH) ? Math.max(1, Math.round(base.minH)) : 1;
  if (minW > columns) return { ok: false, reason: 'invalid-size' };
  if (isInt(base.maxW) && Math.round(base.maxW) < minW) return { ok: false, reason: 'invalid-size' };
  if (isInt(base.maxH) && Math.round(base.maxH) < minH) return { ok: false, reason: 'invalid-size' };

  // 원본에서 보이던 크기를 시작값으로 쓴다 (원래 기본 크기와 responsive 는 원본 undo 스냅샷에 남는다)
  const visible = resolveItems(source, sbp).find((item) => item.id === itemId) as DriftItem;
  const nextSource = removeFrom(source, sbp, itemId);

  const moved = cloneJson(base) as DriftItem;
  delete moved.responsive;
  moved.id = id;
  const hasPosition = input.x !== undefined && input.y !== undefined;
  const sized = { ...moved, w: visible.w, h: visible.h };
  const float = !!target.float;

  let nextTarget: DriftLayout;
  if (hasPosition) {
    const x = input.x as number;
    const y = input.y as number;
    if (tbp) {
      // 기본 레이아웃에는 자동 위치로 넣고, 지정 좌표는 현재 breakpoint 의 명시 위치로 저장한다 (addItem 과 같다)
      const { x: _x, y: _y, ...rest } = sized; // eslint-disable-line @typescript-eslint/no-unused-vars
      const withBase: DriftLayout = { ...target, items: addItem(target.items, target.columns, rest, float) };
      const effective = resolveItems(withBase, tbp);
      const wanted = normalizeItem({ ...sized, x, y }, tbp.columns);
      if (
        firstCollision(
          effective.filter((item) => item.locked && item.id !== id),
          wanted,
        )
      ) {
        return { ok: false, reason: 'blocked' };
      }
      const placed = updateItem(effective, tbp.columns, id, { x, y, w: sized.w, h: sized.h }, float);
      nextTarget = applyItems(withBase, placed, tbp);
    } else {
      const wanted = normalizeItem({ ...sized, x, y }, target.columns);
      if (
        firstCollision(
          target.items.filter((item) => item.locked),
          wanted,
        )
      )
        return { ok: false, reason: 'blocked' };
      nextTarget = { ...target, items: addItem(target.items, target.columns, { ...sized, x, y }, float) };
    }
  } else {
    const { x: _x, y: _y, ...rest } = sized; // eslint-disable-line @typescript-eslint/no-unused-vars
    nextTarget = { ...target, items: addItem(target.items, target.columns, rest, float) };
  }

  // 최종 배치가 겹치면(이론상 압축이 막지만) 받아들이지 않는다
  const shown = resolveItems(nextTarget, tbp);
  if (hasOverlap(shown) || hasOverlap(nextTarget.items)) return { ok: false, reason: 'blocked' };
  const after = shown.find((item) => item.id === id) as DriftItem;
  return { ok: true, source: nextSource, target: nextTarget, before: cloneJson(base), after: cloneJson(after) };
}

/** 에디터 removeItem 과 같은 규칙으로 항목을 뺀 레이아웃 */
function removeFrom(layout: DriftLayout, bp: DriftBreakpoint | undefined, id: string): DriftLayout {
  const remaining: DriftLayout = { ...layout, items: layout.items.filter((item) => item.id !== id) };
  if (bp) return applyItems(remaining, removeItem(resolveItems(layout, bp), id, !!layout.float), bp);
  return { ...remaining, items: compact(remaining.items, undefined, !!layout.float) };
}
