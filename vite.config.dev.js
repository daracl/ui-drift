import { defineConfig } from 'vite';
import { createCommonConfig } from './vite.common.js';

// 개발 서버 / Playwright 전용 (open 옵션 없음)
const common = createCommonConfig();

export default defineConfig({
  ...common,
  server: { ...common.server, open: false },
});
