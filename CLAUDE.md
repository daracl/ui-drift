# CLAUDE.md

## 응답/코드 규칙 (ui-grid 와 동일)

- 사용자 응답과 코드 주석은 한국어. 기술 용어/식별자는 원문 유지.
- 스타일: `.prettierrc`(세미콜론, single quote, 120), `.eslintrc.json`. import 별칭 `@/`(→`src/`), `@t/`(→`src/drift/types/`).

## 명령어

- `npm run dev` : vite 개발 서버(5179), `uitest/editor.html` 수동 확인
- `npm run build` : ESM/CJS(`vite.config.js`, entry: index/core/viewer) → UMD → css(sass) → d.ts
- `npm run example` : build 후 `example/viewer.html|css` 생성 (JavaScript 없는 Viewer)
- `npm test` : Jest. `test/build/viewerBundle.test.ts` 는 dist 가 있을 때만 동작
- `npm run pwtest` : Playwright (`e2e/`), 최초 1회 `npx playwright install chromium`
- `npm run check` : typecheck + lint + test

## 아키텍처 (의존 방향을 지킬 것)

`types → core → viewer`, `core → editor`. **viewer 와 core 는 DOM/Editor 를 import 하면 안 된다** (dist 검사 테스트가 막는다).

- `src/drift/core/` 순수 함수(불변). 충돌/압축은 `compact.ts`, 연산은 `operations.ts`, 반응형은 `responsive.ts`.
- `src/drift/viewer/` 정적 HTML+CSS 문자열 생성. 사용자 문자열은 반드시 `escapeHtml`, `scope` 는 `assertScope`.
- `src/drift/editor/` DOM. 모델 변경은 `DriftEditor.commit()` 만 거친다(히스토리/이벤트). 드래그 중 미리보기는 `PointerController` 가 snapshot 기준으로 계산하고 drop 에 한 번 커밋한다.
- 소스 배치: 공통은 `src/dom`, `src/event`, Drift 는 `src/drift/`, Sortable 은 `src/sortable/`. 공개 entry(`src/index.ts` `core.ts` `viewer.ts` `editor.ts` `sortable.ts`)와 `package.json` exports, `dist` 파일명은 외부 사용자에게 영향이 있으므로 바꾸지 않는다. `src/sortable/` 은 `src/drift/` 를 import 하지 않는다.
- 클래스명은 `drift/editor/classNames.ts` 와 `style/_editor.scss` 가 일치해야 한다.
- 새 기능에는 `uitest/*.html` 데모와 Jest/Playwright 테스트를 함께 추가한다.
