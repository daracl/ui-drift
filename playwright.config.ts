import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5179',
    trace: 'off',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config vite.config.dev.mjs --port 5179 --host 127.0.0.1',
    url: 'http://127.0.0.1:5179/uitest/editor.html',
    reuseExistingServer: true,
    timeout: 60000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      testIgnore: /touch\.spec\.ts$/,
    },
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /touch\.spec\.ts$/ },
  ],
});
