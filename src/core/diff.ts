import { DriftChanges, DriftItem, DriftItemChange, DriftLayout } from '@t/DriftLayout';
import { cloneJson, isObject } from '@daracl/core/utils';

/** 값 비교: 원시값은 ===, 객체(props, responsive 등)는 참조가 같으면 같고 아니면 JSON 으로 비교한다 */
function valueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isObject(a) && isObject(b)) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/**
 * 두 항목이 같은지 비교한다. 값이 undefined 인 속성은 없는 속성과 같게 본다.
 * 변경되지 않은 항목은 같은 객체(참조)를 공유하므로 대부분 첫 줄에서 끝난다.
 */
export function itemsEqual(a: DriftItem, b: DriftItem): boolean {
  if (a === b) return true;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const key in ra) if (!valueEqual(ra[key], rb[key])) return false;
  for (const key in rb) if (!(key in ra) && rb[key] !== undefined) return false;
  return true;
}

/** 레이아웃이 같은지 비교한다 (항목 순서 포함). JSON 직렬화 두 번보다 가볍고 변경이 없으면 일찍 끝난다 */
export function layoutsEqual(a: DriftLayout, b: DriftLayout): boolean {
  if (a === b) return true;
  if (a.version !== b.version || a.columns !== b.columns || a.rowHeight !== b.rowHeight || a.gap !== b.gap)
    return false;
  if (!!a.float !== !!b.float) return false;
  if (a.items.length !== b.items.length) return false;
  if (JSON.stringify(a.breakpoints) !== JSON.stringify(b.breakpoints)) return false;
  for (let i = 0; i < a.items.length; i++) if (!itemsEqual(a.items[i], b.items[i])) return false;
  return true;
}

/** 내부 상태와 분리된 깊은 복사 */
const copy = (item: DriftItem): DriftItem => cloneJson(item);

/**
 * 변경 전/후 항목 목록을 id 기준으로 비교해 추가·제거·변경된 항목을 반환한다.
 * 변경된 항목은 직접 조작한 항목뿐 아니라 충돌로 밀려난 항목도 포함한다.
 * 반환하는 항목은 모두 복사본이다 (변경 없는 항목은 복사하지 않아 비용이 변경 수에 비례한다).
 */
export function diffItems(before: readonly DriftItem[], after: readonly DriftItem[]): DriftChanges {
  const prev = new Map<string, DriftItem>();
  for (const item of before) prev.set(item.id, item);

  const added: DriftItem[] = [];
  const changed: DriftItemChange[] = [];
  const seen = new Set<string>();
  for (const item of after) {
    seen.add(item.id);
    const old = prev.get(item.id);
    if (!old) {
      added.push(copy(item));
    } else if (!itemsEqual(old, item)) {
      changed.push({
        id: item.id,
        before: copy(old),
        after: copy(item),
        moved: old.x !== item.x || old.y !== item.y,
        resized: old.w !== item.w || old.h !== item.h,
      });
    }
  }
  const removed = before.filter((item) => !seen.has(item.id)).map(copy);
  return { added, removed, changed };
}
