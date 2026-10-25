/**
 * @jest-environment node
 *
 * 배포 타입 선언(dist/**\/*.d.ts) 검증.
 *  1) 내부 경로 별칭(@t/*, @/*)이 남아 있지 않고 모든 상대 import 가 해석된다 (scripts/check-dts.mjs)
 *  2) 외부 소비자 형태(npm pack 으로 설치, Drift 전용 paths 없음, skipLibCheck:false)의 TypeScript 검사가 통과한다
 * dist 가 없으면 건너뛴다 (`npm run build` 후 실행).
 */
import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');
const run = fs.existsSync(path.join(dist, 'index.d.ts')) ? describe : describe.skip;
const tscBin = path.join(root, 'node_modules/typescript/bin/tsc');
const checkScript = path.join(root, 'scripts/check-dts.mjs');

jest.setTimeout(240000);

function checkDts(dir: string): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [checkScript, dir], { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

run('dist: 배포 타입 선언에 내부 별칭이 없다', () => {
  it('scripts/check-dts.mjs: 실제 dist 는 별칭 없음 + 모든 상대 import 해석', () => {
    const r = checkDts(dist);
    expect(r.out).toMatch(/OK/);
    expect(r.status).toBe(0);
  });

  it('dist 의 모든 .d.ts 에서 @t/ 또는 @/ 를 찾을 수 없다 (직접 검색)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.d.ts') && /['"]@(t)?\//.test(fs.readFileSync(full, 'utf8')))
          hits.push(path.relative(dist, full));
      }
    };
    walk(dist);
    expect(hits).toEqual([]);
  });

  describe('검사 스크립트 자체의 유효성 (별칭/깨진 경로가 있으면 실패해야 한다)', () => {
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'drift-dts-'));

    it('@t/* 별칭이 남은 선언을 거부한다', () => {
      const dir = tmp();
      fs.writeFileSync(path.join(dir, 'a.d.ts'), "import { X } from '@t/DriftLayout';\nexport declare const a: X;\n");
      const r = checkDts(dir);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/@t\/DriftLayout/);
    });

    it("@/* 별칭과 import('@/...') 타입 표현도 거부한다", () => {
      const dir = tmp();
      fs.writeFileSync(
        path.join(dir, 'a.d.ts'),
        'export declare const a: import(\'@/core/x\').Y;\nexport * from "@/viewer";\n',
      );
      const r = checkDts(dir);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/@\/core\/x/);
      expect(r.out).toMatch(/@\/viewer/);
    });

    it('해석되지 않는 상대 경로를 거부하고, 해석되는 경로(.js 접미사/폴더 index)는 허용한다', () => {
      const dir = tmp();
      fs.mkdirSync(path.join(dir, 'sub'));
      fs.writeFileSync(path.join(dir, 'sub/index.d.ts'), 'export declare const s: 1;\n');
      fs.writeFileSync(
        path.join(dir, 'ok.d.ts'),
        "export * from './sub';\nexport * from './sub/index.js';\nexport { s as t } from './sub/index';\n",
      );
      expect(checkDts(dir).status).toBe(0);
      fs.writeFileSync(path.join(dir, 'bad.d.ts'), "export * from './missing.js';\n");
      const r = checkDts(dir);
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/missing\.js/);
    });
  });
});

run('외부 소비자 형태의 TypeScript 검사 (Drift 전용 paths 없음, skipLibCheck:false)', () => {
  let work: string;
  let consumer: string;

  /** 소비자 프로젝트: npm pack 으로 만든 패키지를 node_modules/@daracl/drift 에 설치한 것과 같은 구조 */
  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-consumer-'));
    const tgzName = execSync(`npm pack --pack-destination "${work}" --silent`, { cwd: root, encoding: 'utf8' })
      .trim()
      .split(/\r?\n/)
      .pop() as string;
    const extract = path.join(work, 'extract');
    fs.mkdirSync(extract);
    // GNU tar 는 'C:\...' 의 콜론을 원격 호스트로 해석하므로 작업 디렉터리 기준의 상대 경로로 실행한다
    execFileSync('tar', ['-xzf', tgzName, '-C', 'extract'], { cwd: work });

    consumer = path.join(work, 'consumer');
    fs.mkdirSync(path.join(consumer, 'node_modules/@daracl'), { recursive: true });
    fs.renameSync(path.join(extract, 'package'), path.join(consumer, 'node_modules/@daracl/drift'));
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
    fs.writeFileSync(path.join(consumer, 'entry-all.ts'), ALL_ENTRIES);
    fs.writeFileSync(path.join(consumer, 'entry-root.ts'), ROOT_ONLY);
  });

  afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  function tsc(configName: string, config: Record<string, unknown>): { status: number; out: string } {
    // 소비자 설정에는 paths/baseUrl 같은 별칭 설정을 넣지 않는다 (문제를 숨기지 않기 위해)
    expect(config.compilerOptions).not.toHaveProperty('paths');
    expect(config.compilerOptions).not.toHaveProperty('baseUrl');
    fs.writeFileSync(path.join(consumer, configName), JSON.stringify(config));
    try {
      const out = execFileSync(process.execPath, [tscBin, '-p', path.join(consumer, configName)], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return { status: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { status: err.status, out: err.stdout };
    }
  }

  const base = {
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    lib: ['es2020', 'dom', 'dom.iterable'],
    types: [] as string[],
  };

  it('moduleResolution: bundler — 루트/core/viewer 진입점 타입 검사 통과', () => {
    const r = tsc('tsconfig.bundler.json', {
      compilerOptions: { ...base, target: 'es2020', module: 'esnext', moduleResolution: 'bundler' },
      files: ['entry-all.ts'],
    });
    expect(r.out).toBe('');
    expect(r.status).toBe(0);
  });

  it('moduleResolution: node16 (CJS 소비자) — 루트/core/viewer 진입점 타입 검사 통과', () => {
    const r = tsc('tsconfig.node16.json', {
      compilerOptions: { ...base, target: 'es2020', module: 'node16', moduleResolution: 'node16' },
      files: ['entry-all.ts'],
    });
    expect(r.out).toBe('');
    expect(r.status).toBe(0);
  });

  it('moduleResolution: node10 (구형 설정) — 루트 진입점 타입 검사 통과', () => {
    const r = tsc('tsconfig.node10.json', {
      compilerOptions: {
        ...base,
        target: 'es2020',
        module: 'commonjs',
        moduleResolution: 'node10',
        ignoreDeprecations: '5.0',
      },
      files: ['entry-root.ts'],
    });
    expect(r.out).toBe('');
    expect(r.status).toBe(0);
  });

  it('검사 자체의 유효성: 배포 선언에 별칭을 되살리면 소비자 검사가 실패한다', () => {
    const file = path.join(consumer, 'node_modules/@daracl/drift/dist/editor/DriftEditor.d.ts');
    const original = fs.readFileSync(file, 'utf8');
    try {
      // 상대 경로로 변환된 import 하나를 원래 별칭으로 되돌린다
      const broken = original.replace(/from '\.\.\/types\/DriftLayout(\.js)?'/, "from '@t/DriftLayout'");
      expect(broken).not.toBe(original);
      fs.writeFileSync(file, broken);
      const r = tsc('tsconfig.negative.json', {
        compilerOptions: { ...base, target: 'es2020', module: 'esnext', moduleResolution: 'bundler' },
        files: ['entry-all.ts'],
      });
      expect(r.status).not.toBe(0);
      expect(r.out).toMatch(/@t\/DriftLayout/);
    } finally {
      fs.writeFileSync(file, original);
    }
  });
});

/** 세 진입점의 공개 타입을 실제로 사용한다. 잘못된 사용은 @ts-expect-error 로 막혀야 하므로 타입이 any 로 무너지면 실패한다 */
const ROOT_ONLY = `
import {
  createDriftEditor,
  renderViewer,
  createLayout,
  DriftEditor,
  DriftLayout,
  DriftItem,
  DriftChangeInfo,
  DriftSizeChange,
  DriftSyncResult,
  DriftItemState,
} from '@daracl/drift';

const layout: DriftLayout = createLayout({ items: [{ id: 'a', x: 0, y: 0, w: 2, h: 2 }] });
const el = document.createElement('div');
const editor: DriftEditor = createDriftEditor(el, {
  layout,
  history: false,
  keyboard: false,
  lockedResizable: true,
  contentLifecycle: {
    mount(item: DriftItem, contentEl: HTMLElement) {
      contentEl.textContent = item.id;
      return () => undefined;
    },
  },
});
editor.on('layoutChange', (l: DriftLayout, info: DriftChangeInfo) => {
  const count: number = info.changes.changed.length + l.items.length;
  const source: 'user' | 'api' | 'sync' = info.source;
  return [count, source];
});
editor.on('sizeChange', (changes: DriftSizeChange[]) => changes.map((c) => c.contentElement.id + c.width));
const result: DriftSyncResult = editor.syncItems([{ id: 'a', x: 0, y: 0, w: 2, h: 2 }], { placement: 'exact' });
const state: DriftItemState | undefined = editor.getItemState('a');
const resizable: boolean | undefined = state?.resizable;
const out: { html: string; css: string; scope: string } = renderViewer(layout);

// 타입이 any 로 무너지지 않았는지 확인한다: 아래는 모두 오류여야 한다
// @ts-expect-error id 는 필수
editor.addItem({ w: 1, h: 1 });
// @ts-expect-error 알 수 없는 이벤트 이름
editor.on('nope', () => undefined);
// @ts-expect-error source 는 'user' | 'api' | 'sync'
editor.moveItem('a', 1, 1, { source: 'x' });
// @ts-expect-error 레이아웃은 숫자가 아니다
const wrong: number = editor.getLayout();

export { result, resizable, out, wrong };
`;

const ALL_ENTRIES = `${ROOT_ONLY}
import { compact, parseLayout, diffItems, isResizable, DriftItem as CoreItem, DriftLayout as CoreLayout } from '@daracl/drift/core';
import { renderViewer as rv, renderViewerPage, ViewerOptions, ViewerResult } from '@daracl/drift/viewer';

const parsed: CoreLayout = parseLayout('{"items":[]}');
const packed: CoreItem[] = compact(parsed.items);
const diff = diffItems(packed, packed);
const added: CoreItem[] = diff.added;
const canResize: boolean = isResizable({ locked: true }, true);
const options: ViewerOptions = { scope: 'x' };
const viewed: ViewerResult = rv(parsed, options);
const page: string = renderViewerPage(parsed, { title: 't' });

// @ts-expect-error scope 는 문자열이다
const badOptions: ViewerOptions = { scope: 1 };
// @ts-expect-error 레이아웃 입력 없이 호출할 수 없다
rv();

export { added, canResize, viewed, page, badOptions };
`;
