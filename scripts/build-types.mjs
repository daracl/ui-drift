import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFiles, root } from './build-files.mjs';

const require = createRequire(import.meta.url);

export function runNode(script, args = []) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) done();
      else reject(new Error(`빌드 단계 실패: ${script} (종료 코드 ${code}, 신호 ${signal ?? '없음'})`));
    });
  });
}

export async function buildTypes() {
  await runNode(require.resolve('typescript/bin/tsc'), ['-p', 'tsconfig-build.json', '--emitDeclarationOnly']);
  // 별칭 대상인 원본 선언이 존재한 뒤에만 tsc-alias를 실행해야 합니다.
  buildFiles('dts');
  await runNode(require.resolve('tsc-alias/dist/bin/index.js'), ['-p', 'tsconfig-build.json']);
  await runNode(resolve(root, 'scripts/check-dts.mjs'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildTypes().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
