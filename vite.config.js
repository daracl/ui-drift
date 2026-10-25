import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { createCommonConfig } from './vite.common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ESM / CJS 라이브러리 빌드. entry 별로 분리해 viewer 번들이 editor 코드를 포함하지 않게 한다.
export default defineConfig({
  ...createCommonConfig(),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: 'esbuild',
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        core: path.resolve(__dirname, 'src/core.ts'),
        viewer: path.resolve(__dirname, 'src/viewer.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, name) => (format === 'es' ? `${name}.js` : `${name}.cjs`),
    },
    rollupOptions: {
      treeshake: { moduleSideEffects: false },
    },
  },
});
