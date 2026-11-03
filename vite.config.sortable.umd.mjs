import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { createCommonConfig, topBanner } from './vite.common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 브라우저 <script> 용 Sortable UMD 빌드 (window.Daracl.sortable)
export default defineConfig({
  ...createCommonConfig(),
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    minify: 'esbuild',
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    reportCompressedSize: false,
    lib: {
      entry: path.resolve(__dirname, 'src/sortable.umd.ts'),
      name: 'DaraclSortable',
      formats: ['umd'],
      fileName: () => 'daracl.sortable.umd.js',
    },
    rollupOptions: { output: { banner: topBanner } },
  },
});
