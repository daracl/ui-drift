import { isFunction, isString } from '@daracl/core/utils';
import type { SortableAccessContext, SortableAccessValue, SortableGroupOptions } from '@/sortable/types';

export interface ResolvedGroup {
  name?: string;
  pull?: SortableAccessValue<boolean | 'clone'>;
  put?: SortableAccessValue<boolean>;
}

export function resolveGroup(group?: string | SortableGroupOptions): ResolvedGroup {
  if (!group) return {};
  return isString(group) ? { name: group } : { ...group };
}

interface Names {
  to?: string;
  from?: string;
}

/**
 * pull/put 값 하나를 평가한다.
 * - 생략: pull 은 허용, put 은 같은 그룹 이름일 때만 허용
 * - true/false, 'clone'(pull 전용), 상대 그룹 이름 또는 이름 배열, 함수(결과를 다시 평가)
 */
function evaluate(
  value: SortableAccessValue<boolean | 'clone'> | undefined,
  pull: boolean,
  names: Names,
  ctx: SortableAccessContext,
): boolean | 'clone' {
  const sameGroup = !!names.to && !!names.from && names.to === names.from;
  if (value == null) return pull || sameGroup;
  if (value === false) return false;
  if (pull && value === 'clone') return 'clone';
  if (isFunction(value)) return evaluate((value as (c: SortableAccessContext) => never)(ctx), pull, names, ctx);

  const other = pull ? names.to : names.from; // 상대 목록의 그룹 이름
  if (value === true) return true;
  if (isString(value)) return other != null && value === other;
  return Array.isArray(value) && other != null && value.indexOf(other) > -1;
}

/**
 * from 목록의 항목을 to 목록으로 옮길 수 있는지 판정한다. 허용이면 true('이동') 또는 'clone'(복제), 아니면 false.
 */
export function checkTransfer(from: ResolvedGroup, to: ResolvedGroup, ctx: SortableAccessContext): boolean | 'clone' {
  const names: Names = { from: from.name, to: to.name };
  const pull = evaluate(from.pull, true, names, ctx);
  if (!pull) return false;
  return evaluate(to.put, false, names, ctx) ? pull : false;
}
