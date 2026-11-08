// 저장된 레이아웃(JSON)으로 JavaScript 없는 정적 Viewer 페이지를 생성한다.
// 사용: npm run build && npm run example
//       node scripts/build-example.mjs --check  → 파일을 쓰지 않고, 커밋된 example 이 현재 Viewer 출력과 다르면 실패(종료 코드 1)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderViewer, renderViewerPage } from '../dist/viewer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

/** 생성할 파일 목록: 경로 → 내용 */
const outputs = {};

// CSP 에 가장 안전한 형태: 외부 CSS 파일 + 스크립트 없음
const layout = readJson('example/layout.json');
const viewerOptions = { mobileMaxWidth: 767 }; // 767px 이하는 한 줄 적층, 태블릿은 데스크톱 배치
outputs['example/viewer.css'] = renderViewer(layout, viewerOptions).css + '\n';
outputs['example/viewer.html'] =
  renderViewerPage(layout, { ...viewerOptions, title: 'ui-drift viewer', cssHref: 'viewer.css' }) + '\n';

// 높이 100% 예제: 컨테이너 높이를 행 수로 나눠 채우고, 767px 이하에서는 한 줄로 위에서 아래로 쌓는다.
// 부모(html/body)에 정해진 높이가 있어야 하므로 페이지 CSS 가 높이를 준다.
const fit = renderViewer(readJson('example/fit-layout.json'), { fitHeight: true });
const pageCss = 'html,body{height:100%;margin:0}body{box-sizing:border-box;padding:12px;background:#f3f4f6}';
outputs['example/fit.css'] = `${pageCss}\n${fit.css}\n`;
outputs[
  'example/fit.html'
] = `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>ui-drift fit height</title>\n<link rel="stylesheet" href="fit.css">\n</head>\n<body>\n${fit.html}\n</body>\n</html>\n`;

if (check) {
  // 줄바꿈(CRLF/LF) 차이는 무시한다 (Windows 체크아웃 설정에 따라 달라질 수 있다)
  const norm = (s) => s.replace(/\r\n/g, '\n');
  const stale = Object.entries(outputs)
    .filter(([file, content]) => {
      const full = path.join(root, file);
      return !fs.existsSync(full) || norm(fs.readFileSync(full, 'utf8')) !== norm(content);
    })
    .map(([file]) => file);
  if (stale.length) {
    console.error(`[example] 현재 Viewer 출력과 다른 파일: ${stale.join(', ')} → npm run build && npm run example`);
    process.exit(1);
  }
  console.log('[example] 모든 예제가 현재 Viewer 출력과 같습니다.');
} else {
  for (const [file, content] of Object.entries(outputs)) fs.writeFileSync(path.join(root, file), content);
  console.log('example/viewer.html, example/viewer.css 생성 완료');
  console.log('example/fit.html, example/fit.css 생성 완료');
}
