/**
 * 빌드 산출물을 외부 프로젝트처럼 가져다 쓸 수 있는지, 문서와 구현이 일치하는지 검증한다.
 * dist 가 없으면 건너뛴다 (`npm run build` 후 실행).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { runInNewContext } from 'vm';

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');
const run = fs.existsSync(path.join(dist, 'index.cjs')) ? describe : describe.skip;

const node = (code: string, esm = false) =>
  execFileSync(process.execPath, esm ? ['--input-type=module', '-e', code] : ['-e', code], {
    cwd: root,
    encoding: 'utf8',
  }).trim();

run('dist: 외부 프로젝트에서의 사용 (Node)', () => {
  const sample = `{version:1,columns:12,rowHeight:40,gap:8,items:[{id:'a',x:0,y:0,w:4,h:2,content:'A'}]}`;

  it('CJS: viewer / core 진입점이 DOM 없이 동작한다', () => {
    const out = node(`
      const v = require('./dist/viewer.cjs'); const c = require('./dist/core.cjs');
      const r = v.renderViewer(${sample});
      console.log(JSON.stringify({ html: r.html.includes('data-x="0"'), css: r.css.includes('[data-w="4"]{grid-column-end:span 4}'),
        core: typeof c.moveItem, noDom: typeof document === 'undefined' }));`);
    expect(JSON.parse(out)).toEqual({ html: true, css: true, core: 'function', noDom: true });
  });

  it('ESM: viewer / core 를 import 할 수 있다', () => {
    const out = node(
      `import * as v from './dist/viewer.js'; import * as c from './dist/core.js';
       console.log(JSON.stringify({ viewer: typeof v.renderViewerPage, core: typeof c.createLayout, parse: c.parseLayout(${sample}).items.length }));`,
      true,
    );
    expect(JSON.parse(out)).toEqual({ viewer: 'function', core: 'function', parse: 1 });
  });

  it('index 진입점은 editor 와 viewer 를 모두 export 한다', () => {
    const out = node(
      `const m = require('./dist/index.cjs'); console.log(JSON.stringify(['createDriftEditor','DriftEditor','renderViewer','renderViewerPage','createLayout'].map(k => typeof m[k])));`,
    );
    expect(JSON.parse(out)).toEqual(['function', 'function', 'function', 'function', 'function']);
  });

  it('package.json exports 가 가리키는 파일이 모두 존재한다', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const files: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string' && v.startsWith('./dist/') && !v.endsWith('/')) files.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(pkg.exports);
    walk([pkg.main, pkg.module, pkg.types]);
    expect(files.length).toBeGreaterThan(8);
    expect(files.filter((f) => !fs.existsSync(path.join(root, f)))).toEqual([]);
    ['daracl.drift.css', 'daracl.drift.min.css', 'daracl.drift.viewer.min.css', 'daracl.drift.umd.js'].forEach((f) =>
      expect(fs.existsSync(path.join(dist, f))).toBe(true),
    );
  });

  it('Viewer 전용 CSS 에는 편집 UI 스타일이 없다', () => {
    const css = fs.readFileSync(path.join(dist, 'daracl.drift.viewer.min.css'), 'utf8');
    expect(css).not.toMatch(/ddr-handle|ddr-resize|ddr-placeholder|ddr-editor|touch-action/);
  });

  it('UMD 번들은 전역 API와 라이선스 배너를 유지한다', () => {
    const code = fs.readFileSync(path.join(dist, 'daracl.drift.umd.js'), 'utf8');
    const window = {} as { Daracl: { drift: { createLayout: () => { version: number }; renderViewer: unknown } } };
    runInNewContext(code, { window });
    expect(window.Daracl.drift.createLayout().version).toBe(1);
    expect(typeof window.Daracl.drift.renderViewer).toBe('function');
    expect(code.includes('Licensed MIT')).toBe(true);
  });

  it.each(['index.js', 'index.cjs', 'core.js', 'core.cjs', 'viewer.js', 'viewer.cjs'])(
    '%s에 라이선스 배너를 보존한다',
    (name) => {
      expect(fs.readFileSync(path.join(dist, name), 'utf8').includes('Licensed MIT')).toBe(true);
    },
  );
});

describe('문서(docs/API.md)와 구현의 일치', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/API.md'), 'utf8');
  const section = (from: string, to: string) => {
    const a = doc.indexOf(from);
    const b = doc.indexOf(to, a + 1);
    return doc.slice(a, b === -1 ? undefined : b);
  };
  const names = (md: string, column = 1) => {
    const set = new Set<string>();
    // 표의 첫 칸에 나온 `name(` 형태의 식별자
    md.split('\n')
      .filter((l) => l.startsWith('|'))
      .forEach((l) => {
        const first = l.split('|')[column] || '';
        for (const m of first.matchAll(/`([A-Za-z]\w*)(?:\(|`)/g)) set.add(m[1]);
      });
    return Array.from(set);
  };

  it('DriftEditor 표의 모든 메서드가 실제 인스턴스에 존재한다', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DriftEditor } = require('@/editor');
    const methods = names(section('### DriftEditor\n', '### 이벤트')).filter((n) => /^[a-z]/.test(n));
    expect(methods.length).toBeGreaterThan(20);
    const missing = methods.filter((m) => typeof DriftEditor.prototype[m] !== 'function');
    expect(missing).toEqual([]);
  });

  it('Core/Viewer 표의 모든 함수가 실제로 export 된다', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lib = require('@/index');
    const core = names(section('## Core', '## 스타일'), 2).filter((n) => /^[a-z]/.test(n));
    const viewer = names(section('## Viewer', '## Core')).filter((n) => /^[a-z]/.test(n));
    const missing = [...core, ...viewer].filter((n) => typeof lib[n] !== 'function');
    expect(missing).toEqual([]);
    expect(core.length + viewer.length).toBeGreaterThan(20);
  });

  it('문서화된 이벤트 이름이 타입 정의에 존재한다', () => {
    const types = fs.readFileSync(path.join(root, 'src/types/DriftEditor.d.ts'), 'utf8');
    const events = [
      'layoutChange',
      'add',
      'remove',
      'select',
      'dragStart',
      'dragEnd',
      'resizeStart',
      'resizeEnd',
      'breakpointChange',
      'save',
    ];
    events.forEach((e) => {
      expect(doc).toContain(e);
      expect(types).toMatch(new RegExp(`\\b${e}:`));
    });
  });
});
