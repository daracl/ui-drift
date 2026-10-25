/**
 * 빌드 산출물(dist) 검증: Viewer 번들이 편집/DOM 코드를 포함하지 않는지 확인한다.
 * `npm run build` 이후에 실행되며, dist 가 없으면 건너뛴다.
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

const dist = path.resolve(__dirname, '../../dist');
const hasDist = fs.existsSync(path.join(dist, 'viewer.js'));
const run = hasDist ? describe : describe.skip;

/** entry 에서 상대 import/require 로 도달 가능한 모든 파일의 소스를 모은다 */
function collect(entry: string, seen = new Set<string>()): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8');
    files.set(path.basename(file), code);
    const re = /(?:from\s*|require\()\s*["'](\.[^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(entry);
  return files;
}

const FORBIDDEN = [
  'addEventListener',
  'pointerdown',
  'pointermove',
  'setPointerCapture',
  'ResizeObserver',
  'document.',
  'window.',
  'requestAnimationFrame',
  'AbortController',
];

run('dist: viewer 번들', () => {
  it.each(['viewer.js', 'viewer.cjs'])('%s 는 editor 모듈에 의존하지 않는다', (name) => {
    const files = collect(path.join(dist, name));
    const names = Array.from(files.keys());
    expect(names.some((n) => /^(index|editor)/.test(n))).toBe(false);
    expect(names).toEqual(expect.arrayContaining([name]));
  });

  it.each(['viewer.js', 'viewer.cjs'])('%s 에는 DOM/이벤트/편집 관련 코드가 없다', (name) => {
    const files = collect(path.join(dist, name));
    files.forEach((code, file) => {
      FORBIDDEN.forEach((token) => {
        expect({ file, token, found: code.includes(token) }).toEqual({ file, token, found: false });
      });
    });
  });

  it('core 번들도 DOM 에 의존하지 않는다', () => {
    const files = collect(path.join(dist, 'core.js'));
    files.forEach((code) => FORBIDDEN.forEach((token) => expect(code.includes(token)).toBe(false)));
  });

  it('editor 가 포함된 index 번들에는 포인터 처리 코드가 있다 (검사 자체의 유효성)', () => {
    const files = collect(path.join(dist, 'index.js'));
    const all = Array.from(files.values()).join('\n');
    expect(all).toContain('pointerdown');
  });
});
