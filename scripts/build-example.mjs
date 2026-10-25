// 저장된 레이아웃(JSON)으로 JavaScript 없는 정적 Viewer 페이지를 생성한다.
// 사용: npm run build && npm run example
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderViewer, renderViewerPage } from '../dist/viewer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const layout = JSON.parse(fs.readFileSync(path.join(root, 'example/layout.json'), 'utf8'));

// CSP 에 가장 안전한 형태: 외부 CSS 파일 + 스크립트 없음
const { css } = renderViewer(layout);
fs.writeFileSync(path.join(root, 'example/viewer.css'), css + '\n');
fs.writeFileSync(
  path.join(root, 'example/viewer.html'),
  renderViewerPage(layout, { title: 'ui-drift viewer', cssHref: 'viewer.css' }) + '\n',
);
console.log('example/viewer.html, example/viewer.css 생성 완료');
