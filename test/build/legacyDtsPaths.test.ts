/**
 * 빌드 산출물(dist) 검증: Drift 소스를 src/drift/ 로 옮긴 뒤에도 예전 배포 경로의 타입 선언이 유지되는지 확인한다.
 * package.json 의 "./dist/" export 때문에 `@daracl/drift/dist/types/DriftLayout` 같은 직접 import 가 가능하므로
 * 이 경로가 사라지면 외부 프로젝트의 빌드가 깨진다. `npm run build` 이후에 실행되며 dist 가 없으면 건너뛴다.
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

const dist = path.resolve(__dirname, '../../dist');
const run = fs.existsSync(path.join(dist, 'drift')) ? describe : describe.skip;

/** 이동 전 dist 에 있던 선언 파일들 */
const LEGACY = [
  'constants.d.ts',
  'types/DriftEditor.d.ts',
  'types/DriftLayout.d.ts',
  'core/compact.d.ts',
  'core/diff.d.ts',
  'core/flags.d.ts',
  'core/geometry.d.ts',
  'core/layout.d.ts',
  'core/operations.d.ts',
  'core/responsive.d.ts',
  'editor/DragInController.d.ts',
  'editor/DriftEditor.d.ts',
  'editor/GeometryStyle.d.ts',
  'editor/History.d.ts',
  'editor/PointerController.d.ts',
  'editor/classNames.d.ts',
  'editor/scrollContainer.d.ts',
  'viewer/escape.d.ts',
  'viewer/renderViewer.d.ts',
];

run('dist: 이동 전 경로의 호환 타입 선언', () => {
  it.each(LEGACY)('%s 가 새 위치를 다시 내보낸다', (rel) => {
    const legacy = path.join(dist, rel);
    expect(fs.existsSync(legacy)).toBe(true);
    const match = /export \* from '([^']+)';/.exec(fs.readFileSync(legacy, 'utf8'));
    expect(match).not.toBeNull();
    const target = path.resolve(path.dirname(legacy), `${(match as RegExpExecArray)[1]}.d.ts`);
    expect(fs.existsSync(target)).toBe(true);
    expect(path.relative(dist, target).replace(/\\/g, '/').startsWith('drift/')).toBe(true);
  });

  it('공개 엔트리 선언 파일이 그대로 있다', () => {
    ['index.d.ts', 'core.d.ts', 'viewer.d.ts', 'editor.d.ts', 'sortable.d.ts', 'index.umd.d.ts'].forEach((f) =>
      expect(fs.existsSync(path.join(dist, f))).toBe(true),
    );
  });

  it('package.json exports 의 기존 키가 유지된다', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    ['.', './core', './viewer', './umd', './dist/', './style/'].forEach((key) =>
      expect(pkg.exports[key]).toBeDefined(),
    );
  });
});
