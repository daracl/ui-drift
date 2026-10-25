// 배포 타입 선언(dist/**/*.d.ts) 검사: 내부 경로 별칭(@t/*, @/*)이 남아 있거나 상대 import 가 실제 파일로 해석되지
// 않으면 실패한다. 외부 프로젝트는 이 저장소의 tsconfig paths 를 모르므로 별칭이 남으면 타입을 해석하지 못한다.
//
// 사용: node scripts/check-dts.mjs [검사할 디렉터리 (기본: dist)]
// build:tsc 의 마지막 단계로 실행되어, 변환 순서가 어긋나면 빌드가 실패한다.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] || path.join(root, 'dist'));

/** 디렉터리 아래의 모든 .d.ts 경로 */
function listDts(base) {
  const out = [];
  for (const name of fs.readdirSync(base)) {
    const full = path.join(base, name);
    if (fs.statSync(full).isDirectory()) out.push(...listDts(full));
    else if (name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** from '...', import '...', import('...'), export ... from '...' 의 모듈 지정자 */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

/** 상대 지정자가 가리키는 선언 파일이 있는지 (TS 규칙: .js 는 .d.ts 로, 확장자 없으면 .d.ts 또는 /index.d.ts) */
function resolves(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const stripped = base.replace(/\.(m|c)?js$/, '');
  return [base, `${base}.d.ts`, `${stripped}.d.ts`, path.join(base, 'index.d.ts')].some(
    (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
  );
}

if (!fs.existsSync(dir)) {
  console.error(`[check-dts] 디렉터리가 없습니다: ${dir}`);
  process.exit(1);
}

const files = listDts(dir);
const problems = [];
for (const file of files) {
  const rel = path.relative(dir, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(SPECIFIER)) {
    const spec = match[2];
    if (/^@t\/|^@\//.test(spec)) {
      problems.push(`${rel}: 내부 별칭이 남아 있습니다 → '${spec}'`);
    } else if (spec.startsWith('.') && !resolves(file, spec)) {
      problems.push(`${rel}: 상대 경로를 찾을 수 없습니다 → '${spec}'`);
    }
  }
}

if (problems.length) {
  console.error(`[check-dts] 배포 타입 선언 검사 실패 (${problems.length}건, 파일 ${files.length}개 검사)`);
  problems.forEach((p) => console.error(`  - ${p}`));
  console.error('  build:tsc 순서는 tsc → 원본 .d.ts 복사(cpx) → tsc-alias 여야 합니다.');
  process.exit(1);
}
console.log(`[check-dts] OK: ${files.length}개 .d.ts 에 내부 별칭이 없고 모든 상대 import 가 해석됩니다.`);
