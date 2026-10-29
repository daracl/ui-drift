import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function assertDirectory(path) {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error(`빌드 경로에 심볼릭 링크를 사용할 수 없습니다: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function buildFiles(command, projectRoot = root) {
  const dist = join(projectRoot, 'dist');
  assertDirectory(dist);
  if (command === 'clean') {
    rmSync(dist, { recursive: true, force: true });
  } else if (command === 'dts') {
    const copy = (source, destination) => {
      assertDirectory(destination);
      mkdirSync(destination, { recursive: true });
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const target = join(destination, entry.name);
        assertDirectory(target);
        if (entry.isDirectory()) copy(join(source, entry.name), target);
        else if (entry.name.endsWith('.d.ts')) copyFileSync(join(source, entry.name), target);
      }
    };
    copy(join(projectRoot, 'src'), dist);
  } else {
    throw new Error(`지원하지 않는 빌드 파일 작업: ${command}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('빌드 파일 작업을 하나만 지정하세요.');
  buildFiles(process.argv[2]);
}
