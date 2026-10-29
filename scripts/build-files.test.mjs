import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { buildFiles, root } from './build-files.mjs';

function fixture(t) {
  const directory = resolve(root, '.tmp');
  mkdirSync(directory, { recursive: true });
  const project = mkdtempSync(join(directory, 'build-files-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  return project;
}

test('중첩된 원본 선언만 복사하고 이미 생성한 선언과 번들을 보존한다', (t) => {
  const project = fixture(t);
  mkdirSync(join(project, 'src/types'), { recursive: true });
  mkdirSync(join(project, 'dist'), { recursive: true });
  writeFileSync(join(project, 'src/types/Item.d.ts'), 'export interface Item {}');
  writeFileSync(join(project, 'src/index.ts'), 'export const value = 1;');
  writeFileSync(join(project, 'dist/index.d.ts'), 'export declare const value = 1;');
  writeFileSync(join(project, 'dist/index.js'), 'export const value = 1;');
  buildFiles('dts', project);
  assert.equal(readFileSync(join(project, 'dist/types/Item.d.ts'), 'utf8'), 'export interface Item {}');
  assert.equal(existsSync(join(project, 'dist/index.ts')), false);
  assert.equal(existsSync(join(project, 'dist/index.d.ts')), true);
  assert.equal(existsSync(join(project, 'dist/index.js')), true);
});

test('clean은 dist만 지우고 반복 호출해도 원본 파일을 유지한다', (t) => {
  const project = fixture(t);
  mkdirSync(join(project, 'dist/nested'), { recursive: true });
  writeFileSync(join(project, 'dist/nested/file.js'), '');
  writeFileSync(join(project, 'keep.txt'), '원본');
  buildFiles('clean', project);
  buildFiles('clean', project);
  assert.equal(existsSync(join(project, 'dist')), false);
  assert.equal(readFileSync(join(project, 'keep.txt'), 'utf8'), '원본');
});

test('알 수 없는 작업은 파일을 변경하지 않고 실패한다', (t) => {
  const project = fixture(t);
  assert.throws(() => buildFiles('unknown', project), /지원하지 않는/);
  assert.equal(existsSync(join(project, 'dist')), false);
});

test('dist가 디렉터리 링크이면 대상 파일을 삭제하거나 덮어쓰지 않는다', (t) => {
  const project = fixture(t);
  const target = join(project, 'protected');
  mkdirSync(target);
  writeFileSync(join(target, 'keep.txt'), '보존');
  symlinkSync(target, join(project, 'dist'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => buildFiles('clean', project), /심볼릭 링크/);
  assert.throws(() => buildFiles('dts', project), /심볼릭 링크/);
  assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), '보존');
});

test('원본의 디렉터리 링크를 따라 외부 선언을 복사하지 않는다', (t) => {
  const project = fixture(t);
  const target = join(project, 'external');
  mkdirSync(target);
  mkdirSync(join(project, 'src'));
  writeFileSync(join(target, 'Secret.d.ts'), 'export interface Secret {}');
  symlinkSync(target, join(project, 'src/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  buildFiles('dts', project);
  assert.equal(existsSync(join(project, 'dist/linked')), false);
});
