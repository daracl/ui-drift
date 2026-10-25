# ui-drift 검증 보고서

> 판정 근거는 모두 실제 실행 결과이다. 실행하지 않은 항목은 PASS 로 표기하지 않았다.

## A. 실행 환경

| 항목 | 값 |
| --- | --- |
| 실행 일시 | 2026-10-25 |
| OS | Windows 11 Pro (10.0.26200, win32) |
| Node.js / npm | v24.20.0 / 11.19.0 |
| 브라우저 | Playwright Chromium Headless Shell 156.0.8078.4 (`chromium_headless_shell-1248`) |
| 모바일 에뮬레이션 | Playwright `devices['Pixel 5']` (hasTouch, isMobile) + CDP `Input.dispatchTouchEvent` |
| 도구 | TypeScript 5.6.3, Vite 5.4.21, Jest 29.7.0 (ts-jest, jsdom), @playwright/test 1.64.1, ESLint 8, Prettier 2 |
| 참고 프로젝트 | `ui-grid` 는 읽기만 했고 수정하지 않음 |

### 실제 실행한 명령어

```bash
npm install
npm run typecheck          # tsc --noEmit
npm run lint               # eslint "src/**/*.ts"
npx prettier --check "src/**/*.ts" "test/**/*.ts" "e2e/**/*.ts"
npm run build              # vite(esm/cjs) + vite(umd) + sass + tsc d.ts
npm run example            # example/viewer.html|css 생성 (JS 없는 Viewer)
npx jest                   # 단위/통합 (jsdom) + dist 산출물 검사
npx playwright test        # 실제 브라우저 (desktop + mobile 프로젝트)
npx playwright test --repeat-each=3   # 안정성(불안정 테스트 확인)
npm run docs:gen           # typedoc
```

## B. 테스트 결과 요약

최종 실행 결과: **Jest 118/118 PASS, Playwright 60/60 PASS** (`--repeat-each=3` 180/180 PASS, flaky 0).
typecheck, lint, prettier, build, typedoc 모두 종료 코드 0.

| 상태 | 개수 | 비고 |
| --- | --- | --- |
| PASS | 178 (자동화) + 정적 검사 5 | Jest 118 + Playwright 60 |
| FAIL | 0 (최종) | 중간 실패 7건은 §C 에 기록, 모두 수정/해결 후 재검증 |
| BLOCKED | 2 | Firefox, WebKit (이 Playwright 버전용 바이너리가 설치되어 있지 않아 실행하지 않음) |
| NOT TESTED | 7 | §D 참고 |

| 검증 영역 | 결과 | 근거 (테스트 ID) |
| --- | --- | --- |
| 빌드/타입/린트 | PASS | `npm run build`, `typecheck`, `lint` 종료 코드 0 |
| 외부 프로젝트 import (CJS/ESM/exports) | PASS | `distConsumer.test.ts` — Node 에서 `dist/viewer.cjs|js`, `core`, `index` 실행, `package.json exports` 파일 존재 |
| 문서 ↔ 구현 일치 | PASS | `distConsumer.test.ts` — API.md 표의 Editor 메서드/Core/Viewer 함수/이벤트가 실제로 존재 |
| Editor 추가/삭제 | PASS | EDT-01, EDT-02 (중복/빈 ID/null/비정상 값, 전체 삭제 후 undo/redo/clear) |
| Editor Drag & Drop | PASS | DND-01~07 + editor.spec (DOM 위치=그리드 좌표, 이벤트 1회, 화면 밖 포인터, locked 무효 드롭, Esc 취소, 25회 연속 무작위 드래그, 충돌 후 데이터 보존) |
| Resize | PASS | RSZ-01~03 (실제 px 크기=데이터, min/max/컨테이너 경계, 1x1 및 전폭) |
| 충돌/그리드 | PASS | engine.test.ts 21건, DND-01/06/07 |
| JSON 저장/복원 | PASS | DAT-01 (필수 시나리오 3개 → 이동/리사이즈 → JSON → destroy → 복원, 의미 비교), DAT-02 (손상/누락/비정상 값) |
| 모바일 터치 | PASS | TCH-01~04, touch.spec (실제 터치 이벤트 드래그/리사이즈, 본문 스와이프=스크롤, 연속 6회 드래그, 빠른 탭 5회, 회전, 터치 영역 크기) |
| 반응형 (1440/768/390/320) | PASS | RSP-Desktop/Tablet/Mobile/Small Mobile (이론 좌표와 실측 일치, 겹침/화면 이탈 없음), RSP-SCROLL, RSP-LIVE, RSP-CONTENT |
| Viewer JavaScript 비활성화 | PASS | VWR-A (새로고침 3회 동일, 요청 실패 0), VWR-C, VWR-D, viewer-nojs.spec (프로브로 JS 비실행 입증) |
| Viewer 번들 분리 | PASS | VWR-B, viewerBundle.test.ts, viewer-nojs.spec (§E 증거) |
| Editor ↔ Viewer 일치 | PASS | CMP-base/tablet/mobile/small (개수, ID, 위치/크기, 콘텐츠, title, data-* 속성) |
| API/리소스 관리 | PASS | API-01~04 (인스턴스 독립성, 50회 생성·파괴 후 리스너/ResizeObserver/DOM 잔여 0, 잘못된 옵션, 이벤트 on/once/off) |
| 회귀 | PASS | 수정 후 Jest/Playwright 전체 재실행 + 3회 반복 |

## C. 발견된 결함/실패 항목

### 제품 결함 (수정함)

**BUG-01 — `layout` 과 함께 준 `float: true` 옵션이 무시됨**

- 재현: `createDriftEditor(el, { layout: { columns: 6, items: [...] }, float: true })` 후 `editor.isFloat()`
- 기대: `layout` 이 float 를 지정하지 않았으면 옵션이 적용됨 (문서: "layout.float 가 있으면 그것이 우선")
- 실제: `false` (옵션 무시). 발견 테스트: API-01
- 원인: 생성자가 `layout` 이 있으면 `options.float` 를 읽지 않음
- 수정: `src/editor/DriftEditor.ts` 생성자 — `layout` 에 float 가 없고 `options.float === true` 면 float 를 적용(layout 의 `float:true` 는 항상 우선)
- 재검증: API-01 PASS, 회귀 테스트 `editor.test.ts` "회귀(API-01)" 추가, Jest/Playwright 전체 재실행 PASS

### 테스트 측 오류 (제품 결함 아님, 테스트를 고쳤고 기준은 낮추지 않음)

| ID | 증상 | 원인 | 조치 |
| --- | --- | --- | --- |
| T-01 | docs 일치 테스트가 옵션 표를 메서드로 오인 | 문서 파서가 `### DriftEditorOptions` 를 매칭 | 섹션 경계 수정 |
| T-02 | Core 표 함수 개수 2 | Core 표는 함수명이 2열 | 열 인덱스 지정 |
| T-03 | EDT-02 가 1개 대신 5개 | 테스트 시퀀스의 `reset()` 이 초기 레이아웃을 복원(정상 동작) | 시퀀스에서 `reset()` 분리 |
| T-04 | RSP-CONTENT 스크롤 없음 | 테스트 콘텐츠가 항목 높이를 넘지 않음 | 콘텐츠 길이 증가 |
| T-05 | TCH-01 드래그 4/6 | (1) 이미 맨 위인 항목은 이동 거리 0 (2) 4열 적층에서 5번째 항목이 뷰포트 밖이라 터치가 닿지 않음 | 기대 횟수를 동적 계산, `scrollIntoView` 후 터치 |
| T-06 | breakpoint 전환 테스트가 간헐 실패 | 0.15s 전환 애니메이션 도중 좌표 측정 | 전환 종료 대기 추가 |

(참고: 직전 작업에서 `responsive` 기본값을 `false` 로 바꾼 변경 — 컨테이너 폭이 1024px 이하가 되면 편집 화면의 배치가 자동 변환본으로 바뀌던 문제 — 이 이번 검증의 기준선에 포함되어 있다.)

## D. 미검증 항목 및 미해결 사항

| 상태 | 항목 | 사유 |
| --- | --- | --- |
| BLOCKED | Firefox | Playwright 1.64.1 용 바이너리 미설치, 실행하지 않음 |
| BLOCKED | WebKit(Safari 엔진) | 위와 동일. iOS Safari 의 터치/스크롤 정책은 확인하지 못함 |
| NOT TESTED | 실제 모바일 기기 터치 | 에뮬레이션(CDP 터치)만 사용 |
| NOT TESTED | UMD 번들을 `<script>` 로 직접 로드 (`window.Daracl.drift`) | 테스트 미작성 (파일 생성만 확인) |
| NOT TESTED | 드래그 중 화면 가장자리 자동 스크롤 | 테스트 미작성 |
| NOT TESTED | 대량 항목(수백 개) 브라우저 성능, 힙 메모리 누적 | 코어 200개 연산(Jest)과 리스너/ResizeObserver/DOM 잔여만 측정, 힙은 미측정 |
| NOT TESTED | 스크린샷 픽셀 비교 | 좌표(boundingBox) 비교로 대체. 스크린샷은 증거용으로만 저장 |
| NOT TESTED | 키보드 접근성 전체(스크린 리더) | 방향키/Shift+방향키/Delete 만 검증 |

알려진 제약(설계): Viewer 의 `@media` 는 뷰포트 기준이라 컨테이너 폭 기준인 Editor breakpoint 와 좁은 패널에서는 다를 수 있다. 세로 방향 배치만 지원한다. 상세는 `docs/DESIGN.md §8`.

## E. Viewer 의 JavaScript 비실행 검증 증거

1. **프로브**(viewer-nojs.spec): 같은 페이지에 `<script>document.documentElement.dataset.js='on'</script>` 를 넣고 `javaScriptEnabled:false` 컨텍스트에서 `data-js` 속성이 **없음**, 활성 컨텍스트에서 `on` 임을 확인 → JS 비활성 환경이 실제로 구성됨을 입증.
2. **JS 비활성 렌더링**(VWR-A, RSP-*): 비활성 컨텍스트에서 4개 해상도의 모든 항목 좌표/크기가 `resolveItems` 로 계산한 이론값과 ±0.5px 이내로 일치, 겹침 0, 화면 이탈 0, 새로고침 3회 후 좌표와 HTML 동일, 요청 실패/오류 0. 스크린샷: `docs/verification/viewer-js-disabled-desktop.png`, `viewer-js-disabled-mobile.png`.
3. **JS 활성 브라우저에서도 JS 개입 없음**(VWR-B): 페이지 로드 **이전**에 `addEventListener` 후킹과 `MutationObserver` 를 설치한 뒤 Viewer 를 로드하고 창 크기를 390px 로 변경 → `addEventListener` 호출 0회, `document.scripts` 0개, `[style]` 속성 0개, `on*` 속성 0개, 로드 이후 속성 변경 0건. 네트워크 요청은 `document` + `stylesheet` 뿐이며 `.js` 요청 없음.
4. **CSS 로 위치/크기 표현**(VWR-C): 4개 해상도에서 각 항목의 `getComputedStyle` 의 `grid-column-start/end`, `grid-row-start/end` 가 레이아웃 데이터(`x+1`, `span w`, `y+1`, `span h`)와 일치하고, `grid-template-columns` 의 열 수가 breakpoint(12/8/4)와 일치. 화면 크기 변경은 `@media` 로만 전환(RSP-LIVE).
5. **CSP**(viewer-nojs.spec): `script-src 'none'; style-src 'self'` 응답 헤더 환경에서 레이아웃이 적용되고 CSP 위반 콘솔 오류 0 (초기에는 테스트 하네스가 넣은 인라인 `style` 속성이 위반으로 잡혔고, 하네스를 CSS 파일로 옮겨 해결 — Viewer 출력 자체의 위반은 없음).
6. **번들 분리**(viewerBundle.test.ts, distConsumer.test.ts): `dist/viewer.js|cjs` 가 도달하는 모든 파일에 `addEventListener`, `pointerdown`, `pointermove`, `setPointerCapture`, `ResizeObserver`, `document.`, `window.`, `requestAnimationFrame`, `AbortController` 가 없고 `index`/`editor` 모듈을 import 하지 않음. 반대로 `index.js` 에는 `pointerdown` 이 있음(검사 자체의 유효성). Viewer 전용 CSS(`daracl.drift.viewer.min.css`)에도 `ddr-handle|resize|placeholder|editor|touch-action` 이 없음. `example/viewer.html|css` 정적 산출물은 `<script>`, `style=`, `on*=`, 편집 클래스가 없고 JS 비활성에서 표시됨(VWR-D).

## F. 산출물 위치

- 보고서: `docs/verification-report.md`
- 증거 스크린샷: `docs/verification/*.png`
- 테스트: `test/**` (Jest), `e2e/**` (Playwright), 하네스 `uitest/api.html`
- 원시 결과(로컬, git 제외): `.tmp/jest.json`, `.tmp/pw.json`

## G. 최종 판정

**부분 완료.** 필수 기능(Editor 편집, JSON 저장/복원, 반응형, 모바일 터치 에뮬레이션, Viewer JS 비실행, 번들 분리, API/리소스 정리) 은 Chromium 에서 실제 실행으로 모두 PASS 했다. 다만 Firefox/WebKit 미실행(BLOCKED), 실기기 터치와 일부 항목 NOT TESTED(§D)가 남아 있어 "검증 완료"로 판정하지 않는다.
