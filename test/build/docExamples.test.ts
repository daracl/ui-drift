/**
 * docs/MULTI_CONTAINER.md 의 ```ts 예제가 실제 공개 API 로 컴파일되는지 검사한다 (문서와 구현의 불일치 방지).
 * 각 예제를 별도 모듈로 만들어 `@daracl/drift`, `@daracl/drift/viewer` 를 소스 entry 로 연결해 타입 검사만 한다.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const root = path.resolve(__dirname, '../..');
const docs = ['docs/MULTI_CONTAINER.md'];

function blocks(file: string): string[] {
  const md = fs.readFileSync(path.join(root, file), 'utf8');
  return Array.from(md.matchAll(/```ts\n([\s\S]*?)```/g), (m) => m[1]);
}

describe('문서 예제 컴파일', () => {
  it.each(docs)(
    '%s 의 TypeScript 예제가 타입 검사를 통과한다',
    (doc) => {
      const snippets = blocks(doc);
      expect(snippets.length).toBeGreaterThan(5);

      const dir = path.join(root, '.tmp', 'doc-examples');
      fs.mkdirSync(dir, { recursive: true });
      const files = snippets.map((code, i) => {
        const file = path.join(dir, `${path.basename(doc, '.md')}-${i}.ts`);
        // CSS import 는 번들러가 처리하므로 타입 검사에서는 뺀다. 각 파일을 모듈로 만든다
        fs.writeFileSync(file, `${code.replace(/^import '.*\.css';$/gm, '')}\nexport {};\n`);
        return file;
      });

      const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2017,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        lib: ['lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.esnext.d.ts'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        types: [],
        baseUrl: root,
        paths: {
          '@daracl/drift': ['src/index.ts'],
          '@daracl/drift/viewer': ['src/viewer.ts'],
          '@daracl/drift/core': ['src/core.ts'],
          '@/*': ['src/*'],
          '@t/*': ['src/drift/types/*'],
        },
      };
      const program = ts.createProgram(files, options);
      const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .filter((d) => d.file && files.includes(path.resolve(d.file.fileName)))
        .map((d) => {
          const file = d.file as ts.SourceFile;
          const { line } = file.getLineAndCharacterOfPosition(d.start ?? 0);
          const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
          return `${path.basename(file.fileName)}:${line + 1} ${message}`;
        });
      expect(diagnostics).toEqual([]);
    },
    60000,
  );
});
