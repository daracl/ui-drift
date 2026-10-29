import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAsync } from 'sass';
import { root } from './build-files.mjs';

export async function buildCss() {
  await mkdir(resolve(root, 'dist'), { recursive: true });
  await Promise.all(
    [
      ['daracl.drift.scss', 'daracl.drift.css', 'expanded'],
      ['daracl.drift.scss', 'daracl.drift.min.css', 'compressed'],
      ['daracl.drift.viewer.scss', 'daracl.drift.viewer.min.css', 'compressed'],
    ].map(async ([source, target, style]) => {
      const result = await compileAsync(resolve(root, 'style', source), { style, sourceMap: false });
      await writeFile(resolve(root, 'dist', target), result.css);
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildCss().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
