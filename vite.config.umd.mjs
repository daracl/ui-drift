import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { createCommonConfig, MODULE_NAME, topBanner } from './vite.common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 브라우저 <script> 용 UMD 빌드 (window.Daracl.drift)
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
      entry: path.resolve(__dirname, 'src/index.umd.ts'),
      name: 'DaraclDrift',
      formats: ['umd'],
      fileName: () => `${MODULE_NAME}.umd.js`,
    },
    rollupOptions: { output: { banner: topBanner } },
  },
});
