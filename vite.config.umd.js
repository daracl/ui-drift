import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { createCommonConfig, MODULE_NAME } from './vite.common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 브라우저 <script> 용 UMD 빌드 (window.Daracl.drift)
export default defineConfig({
  ...createCommonConfig(),
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    minify: 'terser',
    terserOptions: { compress: { passes: 2, drop_debugger: true }, format: { comments: /^!/ } },
    lib: {
      entry: path.resolve(__dirname, 'src/index.umd.ts'),
      name: 'DaraclDrift',
      formats: ['umd'],
      fileName: () => `${MODULE_NAME}.umd.js`,
    },
  },
});
