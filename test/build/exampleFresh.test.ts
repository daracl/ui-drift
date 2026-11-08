/**
 * 커밋된 example/ 산출물이 현재 Viewer 출력과 같은지 검사한다.
 * Viewer 출력 형식을 바꾸고 `npm run example` 을 빠뜨리면(예: fitHeight minHeight 변경 후 fit.css 미갱신) 실패한다.
 * dist 가 없으면 건너뛴다 (`npm run build` 후 실행).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const run = fs.existsSync(path.join(root, 'dist/viewer.js')) ? describe : describe.skip;

run('example/ 산출물', () => {
  it('현재 dist Viewer 로 다시 만든 결과와 같다 (다르면 npm run build && npm run example)', () => {
    const r = spawnSync(process.execPath, ['scripts/build-example.mjs', '--check'], { cwd: root, encoding: 'utf8' });
    // stderr 에는 저장소 안에서 dist/*.js 를 직접 import 할 때의 Node 경고(MODULE_TYPELESS_PACKAGE_JSON)가 섞일 수 있어
    // 생성기의 판정(종료 코드, [example] 메시지)만 본다
    const staleMessage = r.stderr.split('\n').find((line) => line.startsWith('[example]')) ?? null;
    expect({ code: r.status, staleMessage }).toEqual({ code: 0, staleMessage: null });
  });
});
