// 저장된 레이아웃(JSON)으로 JavaScript 없는 정적 Viewer 페이지를 생성한다.
// 사용: npm run build && npm run example
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderViewer, renderViewerPage } from '../dist/viewer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const layout = JSON.parse(fs.readFileSync(path.join(root, 'example/layout.json'), 'utf8'));

// CSP 에 가장 안전한 형태: 외부 CSS 파일 + 스크립트 없음
const viewerOptions = { mobileMaxWidth: 767 }; // 767px 이하는 한 줄 적층, 태블릿은 데스크톱 배치
const { css } = renderViewer(layout, viewerOptions);
fs.writeFileSync(path.join(root, 'example/viewer.css'), css + '\n');
fs.writeFileSync(
  path.join(root, 'example/viewer.html'),
  renderViewerPage(layout, { ...viewerOptions, title: 'ui-drift viewer', cssHref: 'viewer.css' }) + '\n',
);
console.log('example/viewer.html, example/viewer.css 생성 완료');

// 높이 100% 예제: 컨테이너 높이를 행 수로 나눠 채우고, 767px 이하에서는 한 줄로 위에서 아래로 쌓는다.
// 부모(html/body)에 정해진 높이가 있어야 하므로 페이지 CSS 가 높이를 준다.
const fitLayout = JSON.parse(fs.readFileSync(path.join(root, 'example/fit-layout.json'), 'utf8'));
const fit = renderViewer(fitLayout, { fitHeight: true });
const pageCss = 'html,body{height:100%;margin:0}body{box-sizing:border-box;padding:12px;background:#f3f4f6}';
fs.writeFileSync(path.join(root, 'example/fit.css'), `${pageCss}\n${fit.css}\n`);
fs.writeFileSync(
  path.join(root, 'example/fit.html'),
  `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>ui-drift fit height</title>\n<link rel="stylesheet" href="fit.css">\n</head>\n<body>\n${fit.html}\n</body>\n</html>\n`,
);
console.log('example/fit.html, example/fit.css 생성 완료');
