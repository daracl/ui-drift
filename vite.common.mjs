import path from 'path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const topBanner = `/*!
* ${packageJson.name} v${packageJson.version}
* Copyright 2023-${new Date().getUTCFullYear()} darainfo;
* Licensed ${packageJson.license}
*/`;

export const MODULE_NAME = 'daracl.drift';

export const createCommonConfig = () => ({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@t': path.resolve(__dirname, 'src/drift/types'),
    },
    extensions: ['.js', '.ts'],
  },
  preview: { host: '127.0.0.1' },
  // Vite의 기본 압축 설정은 Rollup 배너도 제거하므로 라이선스 주석을 보존합니다.
  esbuild: { legalComments: 'inline' },
  define: {
    APP_VERSION: JSON.stringify(packageJson.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5179,
    open: '/uitest/index.html',
  },
});
