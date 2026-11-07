import { CONTAINER_DATA_VERSION } from '@/drift/constants';
import { isArray, isPlainObject, isString } from '@daracl/core/utils';
import { DriftContainerData, DriftContainerLayout, DriftLayout } from '@t/DriftLayout';
import { parseLayout } from './layout';

/**
 * 컨테이너 id 를 검사한다. 비어 있지 않은 문자열이어야 한다.
 * id 는 DOM/CSS 에 그대로 쓰이지 않으므로(맵의 키로만 쓴다) 문자 종류는 제한하지 않는다.
 */
export function assertContainerId(id: unknown): asserts id is string {
  if (!isString(id) || id.trim() === '') throw new Error('[drift] 컨테이너 id 는 비어 있지 않은 문자열이어야 합니다.');
}

/**
 * 여러 컨테이너의 레이아웃 묶음(JSON 문자열 또는 객체)을 검증·복원한다. 입력은 변경하지 않는다.
 * - 구조(version, containers 배열, 컨테이너 id, 중복 id)가 틀리면 예외를 던진다.
 * - 각 layout 은 `parseLayout` 과 같은 규칙으로 보정되며 구조가 틀리면 어느 컨테이너인지 밝혀 예외를 던진다.
 * - 전체를 검증한 뒤에만 결과를 돌려준다 (일부만 해석된 결과는 없다).
 */
export function parseContainerData(input: string | unknown): DriftContainerData {
  let data: unknown = input;
  if (isString(input)) {
    try {
      data = JSON.parse(input);
    } catch (e) {
      throw new Error('[drift] 컨테이너 레이아웃 JSON 을 해석할 수 없습니다.');
    }
  }
  if (!isPlainObject(data)) throw new Error('[drift] 컨테이너 레이아웃 데이터는 객체여야 합니다.');
  if (data.version !== CONTAINER_DATA_VERSION) {
    throw new Error(`[drift] 지원하지 않는 컨테이너 레이아웃 version: ${String(data.version)}`);
  }
  if (!isArray(data.containers)) throw new Error('[drift] containers 는 배열이어야 합니다.');

  const seen = new Set<string>();
  const containers: DriftContainerLayout[] = (data.containers as unknown[]).map((raw, index) => {
    if (!isPlainObject(raw)) throw new Error(`[drift] containers[${index}] 는 객체여야 합니다.`);
    const id = raw.id;
    assertContainerId(id);
    if (seen.has(id)) throw new Error(`[drift] 중복된 컨테이너 id 입니다: ${id}`);
    seen.add(id);
    if (raw.layout === undefined || raw.layout === null) {
      throw new Error(`[drift] 컨테이너 "${id}" 의 layout 이 없습니다.`);
    }
    let layout: DriftLayout;
    try {
      layout = parseLayout(raw.layout);
    } catch (e) {
      throw new Error(`[drift] 컨테이너 "${id}" 의 layout 이 올바르지 않습니다: ${(e as Error).message}`);
    }
    return { id, layout };
  });
  return { version: CONTAINER_DATA_VERSION, containers };
}

/** 컨테이너 레이아웃 묶음을 JSON 문자열로 직렬화한다 (컨테이너 순서 유지) */
export function serializeContainerData(data: DriftContainerData, space?: number): string {
  return JSON.stringify(
    {
      version: CONTAINER_DATA_VERSION,
      containers: data.containers.map((c) => ({ id: c.id, layout: c.layout })),
    },
    null,
    space,
  );
}
