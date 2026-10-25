import path from 'path';
import { fileURLToPath } from 'url';
import banner from 'vite-plugin-banner';
import packageJson from './package.json';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const topBanner = `/*!
* ${packageJson.name} v${packageJson.version}
* Copyright 2023-${new Date().getUTCFullYear()} darainfo;
* Licensed ${packageJson.license}
*/`;

export const MODULE_NAME = 'daracl.drift';

export const createCommonConfig = () => ({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@t': path.resolve(__dirname, 'src/types'),
    },
    extensions: ['.js', '.ts'],
  },
  plugins: [banner(topBanner)],
  define: {
    APP_VERSION: JSON.stringify(packageJson.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5179,
    open: '/uitest/index.html',
  },
});
