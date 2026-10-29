import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import esmConfig from '../vite.config.mjs';
import umdConfig from '../vite.config.umd.mjs';
import { buildFiles } from './build-files.mjs';
import { buildTypes } from './build-types.mjs';
import { buildCss } from './build-css.mjs';

export async function buildProject() {
  const startedAt = performance.now();
  buildFiles('clean');
  // 정리는 한 번만 하고, 파일명이 겹치지 않는 출력은 함께 생성합니다.
  // 실패한 작업이 있어도 나머지 작업이 정리되기 전에 프로세스를 끝내지 않습니다.
  const results = await Promise.allSettled([
    ...[esmConfig, umdConfig].map((config) =>
      build({ ...config, configFile: false, mode: 'production', build: { ...config.build, emptyOutDir: false } }),
    ),
    buildTypes(),
    buildCss(),
  ]);
  const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (errors.length) throw new AggregateError(errors, errors.map((error) => error.message).join('\n'));
  console.log(`전체 빌드 완료: ${((performance.now() - startedAt) / 1000).toFixed(2)}초`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildProject().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
