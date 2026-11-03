// 호환 타입 선언 생성: Drift 소스를 src/drift/ 아래로 옮기기 전에는 dist/core, dist/editor, dist/viewer, dist/types,
// dist/constants.d.ts 로 배포되었다. package.json 의 "./dist/" export 때문에 외부에서
// `@daracl/drift/dist/types/DriftLayout` 처럼 직접 접근할 수 있으므로, 예전 경로에 새 위치를 다시 내보내는
// 선언 파일을 만들어 외부 import 가 깨지지 않게 한다. (JS 번들은 엔트리 파일명이 그대로이므로 대상이 아니다.)
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './build-files.mjs';

/** dist/drift 아래에서 예전에는 dist 바로 아래에 있던 디렉터리/파일 */
const LEGACY_DIRS = ['core', 'editor', 'viewer', 'types'];
const LEGACY_FILES = ['constants.d.ts'];

function listDts(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listDts(full));
    else if (name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

export function buildCompat(dist = join(root, 'dist')) {
  const drift = join(dist, 'drift');
  if (!existsSync(drift)) throw new Error(`호환 선언 생성 실패: ${drift} 가 없습니다. tsc 단계가 먼저 끝나야 합니다.`);

  const sources = [...LEGACY_FILES.map((f) => join(drift, f))];
  for (const dir of LEGACY_DIRS) {
    const base = join(drift, dir);
    if (existsSync(base)) sources.push(...listDts(base));
  }

  let count = 0;
  for (const source of sources) {
    if (!existsSync(source)) continue;
    const legacy = join(dist, relative(drift, source)); // 예전 위치
    const target = relative(dirname(legacy), source).split(sep).join(posix.sep).replace(/\.d\.ts$/, '');
    mkdirSync(dirname(legacy), { recursive: true });
    writeFileSync(legacy, `export * from '${target.startsWith('.') ? target : `./${target}`}';\n`);
    count += 1;
  }
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`[build-compat] 호환 선언 ${buildCompat()}개 생성`);
}
