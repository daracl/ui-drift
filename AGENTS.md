# AGENTS.md

이 문서는 `@daracl/drift`(ui-drift) 저장소에서 작업하는 AI 에이전트와 개발자를 위한 안내서다. 사실 확인은 코드/설정을 우선하며, 문서와 코드가 다르면 코드를 따르고 문서를 고친다. 사용자 응답과 코드 주석은 한국어로 작성한다(`CLAUDE.md` 와 동일).

## 1. Project Overview

GridStack 스타일의 Drag & Drop 레이아웃 모듈.

- **Editor**: JavaScript 로 컴포넌트를 추가/삭제/이동/리사이즈하고 JSON 으로 저장·복원한다. 마우스와 터치(Pointer Events)를 지원한다.
- **Viewer**: 저장된 같은 JSON 을 **JavaScript 없이 HTML + CSS(CSS Grid)만으로** 표시한다. 레이아웃 계산용 JS 가 없고 편집 코드가 번들에 포함되지 않는다.
- 같은 데이터 모델(`DriftLayout`)을 Editor 와 Viewer 가 공유한다.
- 공통 유틸은 공개 npm 패키지 `@daracl/core/utils`를 사용하고 필요한 함수만 번들링한다. 같은 조직의 `ui-grid` 의 구조와 규칙을 계승했다.

## 2. Technology Stack

| 영역 | 사용 기술 |
| --- | --- |
| 언어 | TypeScript 5 (strict, target es2017), ESM/CJS/UMD |
| 빌드 | Vite 7 (`vite.config.mjs` ESM·CJS 다중 entry, `vite.config.umd.mjs` UMD), `tsc --emitDeclarationOnly` + `tsc-alias`, Sass modern API(CSS) |
| 스타일 | SCSS (`style/`), 클래스 접두사 `ddr-`, 캔버스 `daracl-drift` |
| 단위/통합 테스트 | Jest 29 + ts-jest + jsdom (`test/`) |
| 브라우저 테스트 | Playwright (`e2e/`, Chromium; desktop 과 mobile(Pixel 5) 프로젝트) |
| 품질 | ESLint 8, Prettier 2 (세미콜론, single quote, printWidth 120, trailing comma all), typedoc |
| 런타임 | Node 24.20.0 (`.nvmrc`), npm (`package-lock.json`을 커밋하고 `npm ci`로 설치) |

import 별칭: `@/` → `src/`, `@t/` → `src/drift/types/` (Drift 타입 전용. Sortable 타입은 `@/sortable/types`) (tsconfig, jest, vite 모두 동일하게 설정).

## 3. Project Structure

```
ui-drift/
├─ src/
│  ├─ index.ts / core.ts / viewer.ts / editor.ts   Drift 공개 entry (index = viewer + editor, viewer 가 core 를 re-export). 위치를 옮기지 않는다
│  ├─ index.umd.ts                                  window.Daracl.drift 등록
│  ├─ sortable.ts / sortable.umd.ts                 Sortable 공개 entry (@daracl/drift/sortable, window.Daracl.sortable)
│  ├─ dom/         공통 DOM 유틸 (autoScroll.ts, flip.ts) — Drift 와 Sortable 이 함께 쓴다
│  ├─ event/       공통 Emitter.ts
│  ├─ drift/       Drift 전용 코드 (그리드 레이아웃 에디터/뷰어)
│  │   ├─ constants.ts           기본값, TITLE_HEIGHT, 기본 breakpoint
│  │   ├─ types/*.d.ts           DriftLayout.d.ts, DriftEditor.d.ts (@t/ 로 import)
│  │   ├─ core/        순수 함수 엔진 (DOM 없음)
│  │   │   ├─ geometry.ts     충돌, 정규화, 좌표↔픽셀 변환
│  │   │   ├─ compact.ts      세로 중력 압축 / float
│  │   │   ├─ operations.ts   add/remove/move/resize/update (불변)
│  │   │   ├─ layout.ts       create/parse/serialize/validate/clone
│  │   │   └─ responsive.ts   breakpoint 해석, 자동 변환, 편집 반영(applyItems)
│  │   ├─ viewer/      정적 HTML+CSS 문자열 생성 (DOM 없음)
│  │   │   ├─ renderViewer.ts renderViewer / renderViewerPage
│  │   │   └─ escape.ts       escapeHtml, scope 검증, data-* 속성명 변환
│  │   └─ editor/      DOM 편집기
│  │       ├─ DriftEditor.ts        퍼사드. 모델·렌더·이벤트·히스토리
│  │       ├─ PointerController.ts  드래그/리사이즈/키보드/클릭
│  │       ├─ DragInController.ts   외부 요소를 끌어와 추가 (setupDragIn). 대상 목록(DragInHost)을 받아 단일 에디터/Manager 가 공유
│       ├─ DriftManager.ts       여러 에디터 등록·활성·공통 끌어오기·이벤트 집계·전체 저장/복원·컨테이너 간 이동 트랜잭션과 연결 이력 (docs/MULTI_CONTAINER.md)
│       ├─ TransferController.ts 컨테이너 간 포인터 이동(대상 판정, ghost, 대상 미리보기). PointerController 의 host
│       ├─ canvasHit.ts          포인터 아래의 보이는 캔버스 판정 (DragIn 과 이동이 공유)
│  │       ├─ GeometryStyle.ts      data-x/y/w/h 위치 CSS 규칙 생성기 (같은 설정의 에디터끼리 시트 공유, data-ddr-geo)
│  │       ├─ History.ts            undo/redo 스택
│  │       └─ classNames.ts         CSS 클래스 상수 (style/_editor.scss 와 일치)
│  └─ sortable/    Sortable 본체와 SortableManager(여러 목록 관리, docs/SORTABLE.md) (Drift 를 import 하지 않는다). types.d.ts 는 @/sortable/types
├─ style/   daracl.drift.scss(Editor), daracl.drift.viewer.scss(선택), _editor.scss, _variables.scss
├─ test/    core, viewer, editor(jsdom), build(dist 산출물 검사)
├─ e2e/     Playwright 스펙 + helpers.ts
├─ uitest/  수동/자동 하네스 페이지 (editor.html, api.html, index.html)
├─ example/ layout.json → viewer.html/css (scripts/build-example.mjs 로 생성)
├─ docs/    DESIGN.md, API.md, verification-report.md, verification/*.png, api/(typedoc, git 제외)
└─ dist/    빌드 산출물 (git 제외)
```

## 4. Architecture & Module Responsibilities

### 의존 방향 (반드시 지킨다)

```
types → core → viewer
          └──→ editor → event
```

- `core/` 와 `viewer/` 는 **DOM/브라우저 API 를 쓰지 않는다**(`document`, `window`, `addEventListener`, `ResizeObserver`, `AbortController` 등 금지). `dist/viewer.*`, `dist/core.*` 에 이런 토큰이 있으면 `test/build/viewerBundle.test.ts` 가 실패한다.
- `viewer/` 는 `editor/` 를 import 하지 않는다. Editor 의 실행 결과(DOM)를 재사용하지 않고, 데이터에서 HTML/CSS 문자열을 별도로 만든다.
- `editor/` 만 DOM 과 Pointer Events 를 사용한다.

### 데이터 모델

`DriftLayout { version:1, columns, rowHeight, gap, float?, breakpoints?, items[] }`, `DriftItem { id, x, y, w, h, title?, minW/minH/maxW/maxH?, locked?, resizable?, content?, props?, responsive? }` (`src/drift/types/DriftLayout.d.ts`).

- 좌표는 0 기반 정수 셀 단위. 모든 core 연산은 **불변**이며 새 배열을 반환한다. 같은 입력은 같은 결과(정렬은 `compareYX` 가 id 로 동률을 깬다).
- 잠금: `locked`(위치 고정 = 이동 금지 + 고정 장애물)와 `resizable`(크기 조절)은 **독립**이다. 판정은 반드시 `core/flags.ts` 의 `isMovable`/`isResizable(item, lockedResizable)` 를 쓴다(`resizable` 명시값 → 없으면 locked 이면 `lockedResizable`(기본 false), 아니면 true). `locked` 를 직접 보고 크기 조절을 막지 않는다. 위치만 고정된 항목은 `se` 핸들/`resizeItem`/Shift+방향키로 (x, y) 유지한 채 크기만 바뀌고, `sw` 핸들/`resizeItemFromLeft` 는 locked 에 쓸 수 없다. 포인터 미리보기·무효 placeholder 판정에서 크기를 조절하는 자기 자신(locked)은 장애물에서 제외한다.
- 충돌: 이동/리사이즈 대상(anchor)을 목표 위치에 먼저 놓고 겹친 항목을 아래로 민 뒤 위로 압축한다. `locked` 항목은 장애물이며 locked 와 겹치는 이동은 거부된다. `float: true` 면 위로 올리지 않고(놓은 위치 유지) 겹칠 때만 민다. `float` 는 레이아웃 데이터에 저장되어 Editor/Viewer/반응형이 같은 정책을 쓴다.
- 반응형: `breakpoints` 미지정이면 기본값(tablet ≤1024px 8열, mobile ≤640px 4열), `[]` 이면 비활성. 우선순위는 `item.responsive[bp]` 명시값 → 자동 변환(6열 이상 비례 축소, 미만은 세로 적층). 명시값은 고정되고 나머지가 비켜간다. breakpoint 편집은 해당 breakpoint 의 전체 항목을 `responsive[name]` 에 명시 저장한다.

### 위치/크기는 data 속성으로 표현한다 (style 로 width/height 를 쓰지 않는다)

- **Viewer**: 항목에 `data-x/y/w/h`(breakpoint 값은 큰 것부터 `data-bp0-*`, `data-bp1-*`) 를 출력하고, CSS 는 값별 속성 선택자(`[data-x="3"]{grid-column-start:4}`, `[data-w="4"]{grid-column-end:span 4}`, `[data-y]`→`grid-row-start`, `[data-h]`→`grid-row-end:span`)로 만든다. `@media (max-width)` 안에는 이전 단계와 달라진 값만 쓴다. 항목별 클래스나 인라인 `style` 은 없다.
- **Editor**: 항목에 같은 `data-x/y/w/h` 를 쓰고, `GeometryStyle` 이 에디터 인스턴스별(`data-ddr`) 스타일시트에 `left/top/width/height` 규칙을 만든다(`adoptedStyleSheets` 우선, 미지원 환경만 `<style>`). 드래그/리사이즈 중에만 인라인 `left/top/width/height` 를 쓰고 끝나면 `invalidateRect` 가 지운다.
- `y`/`h` 규칙은 필요한 최대값 + 여유(30)까지 생성된다. 새 규칙 범위를 다룰 때 `GeometryStyle.update` 가 용량을 늘리는지 확인한다.

### Editor 동작 원칙

- 모델 변경은 항상 `DriftEditor.commit()` 을 거친다(히스토리, 이벤트, 렌더). 변화가 없으면 이벤트/히스토리를 만들지 않는다.
- 드래그/리사이즈 중에는 모델을 바꾸지 않고, 시작 시점 snapshot 기준으로 미리보기를 계산하여 셀이 바뀔 때만 재계산한다. drop 시 한 번 커밋한다(Esc/pointercancel 은 원복).
- 리사이즈 핸들은 `data-dir` 로 방향을 구분한다(`se` 우하단, `sw` 좌하단, `e`/`w`/`s` 동·서·남 변 가운데, 옵션 `resizeHandles`; `w` 는 `sw` 처럼 왼쪽 가장자리를 움직여 locked 에 쓸 수 없다). `sw` 는 오른쪽 가장자리를 고정하고 `x`/`w` 를 함께 바꾸며 core 의 `resizeItemFromLeft` 를 쓴다. 무효(locked 충돌) 표시는 결과가 아니라 '요청한' 크기로 판정한다(거부되면 결과가 원래 크기로 돌아가므로).
- 터치 기기의 확장 터치 영역(`style/_editor.scss` 의 `@media (pointer: coarse)`)은 카드 본문 중앙과 드래그 핸들 중앙을 덮으면 안 된다(e2e TCH-05). 변 가운데 핸들은 변을 따라서만 44px 로 넓힌다.
- 입력은 Pointer Events 하나로 처리한다. `touch-action: none` 은 **드래그 핸들과 리사이즈 핸들에만** 적용되고, `dragMode: 'auto'` 에서 터치는 핸들에서만 드래그가 시작된다(본문은 페이지 스크롤).
- `responsive` 옵션은 기본 `false`(컨테이너 폭이 바뀌어도 기본 레이아웃 유지). 자동 breakpoint 전환은 `responsive: true` 또는 `setBreakpoint('auto')`.
- `layout` 과 옵션 우선순위: `layout` 값(columns/rowHeight/gap/breakpoints/float:true)이 옵션보다 우선하며, `layout` 에 float 가 없을 때만 `options.float` 가 적용된다.
- 배경 모눈종이: 캔버스 `::before` 에 SVG 마스크(`--ddr-grid-mask/size/offset`)를 적용하고 색은 CSS 변수 `--ddr-grid-color`(기본 반투명). 옵션 `grid`/`gridColor`, `setGrid()`. 색 옵션은 안전한 문자만 허용한다.
- 외부 모델 연동(`history`/`keyboard`/`programmaticEvents`, `source`, `info.changes`, `syncItems`, `contentLifecycle`, `sizeChange`): 상세는 `docs/API.md` 와 `docs/DESIGN.md §8`. 지켜야 할 점:
  - 모델 변경은 반드시 `commit()` → `replace()` 를 거친다. 변경 비교(`layoutsEqual`)는 구조 비교이며 같으면 아무것도 하지 않는다. 사용자 조작 경로(`PointerController`/`DragInController`/키보드/삭제 버튼)는 `{ source: 'user' }` 를 넘긴다.
  - `layoutChange` 의 `changes`/복사본은 **리스너가 있을 때만** 만든다(`emitter.has`). 이벤트 데이터는 항상 복사본이다.
  - 콘텐츠 변경 감지는 `ContentState`(title/content/props 참조, props JSON)로 한다. 위치/크기/선택 변경에서 콘텐츠 훅이나 `renderItem` 이 호출되면 안 된다. 훅은 DOM 을 비우거나 지우기 **전에** `unmount` 한다(`unmountContent` 가 중복 호출을 막는다).
  - 크기 알림은 `flushSizes()` 가 마지막으로 알린 크기와 비교해 프레임당 한 번 발생시킨다. `destroy()` 는 예약된 프레임을 취소해야 한다. 크기는 DOM 을 읽지 않고 메트릭으로 계산한다.
  - `Esc` 취소(드래그/리사이즈/외부 끌어오기)는 `keyboard:false` 와 무관해야 한다. 항목 키 처리(`onKey`)만 `isKeyboard()` 로 막는다.
- 성능: `core/compact.ts` 의 `ColumnIndex` 는 선형 탐색 구현과 **결과가 같아야** 한다(`test/core/compactEquivalence.test.ts` 가 참조 구현과 비교). 압축/충돌 로직을 바꾸면 이 테스트와 `npm run bench:core` 를 함께 돌리고 `docs/performance.md` 를 갱신한다. jsdom 시간은 성능 지표로 쓰지 않는다.
- 외부 끌어오기 `autoAdd:false`/`onDrop`: drop 시 `finish()`(정리·복원)를 **먼저** 하고 그 뒤에 콜백을 호출한다. 콜백 이후에 모델/DOM 을 건드리는 정리 코드를 추가하지 않는다(콜백 안의 동기 `addItem()` 결과를 덮어쓰게 된다). 전달 항목은 JSON 깊은 복사본이며 `dragInEnd` 는 `autoAdd:false` 에서 항상 `null`.
- 외부 끌어오기(`setupDragIn`): `DragInController` 가 document 단위 Pointer 리스너 하나로 처리한다(원본이 등록되어 있거나 세션 중일 때만 부착). 컨트롤러는 `DragInHost` 의 대상 목록 중 포인터 아래의 에디터 하나를 다루며, 대상이 바뀌면 이전 대상의 미리보기를 원복한다(단일 에디터와 `DriftManager` 가 같은 코드를 쓴다). 미리보기는 임시 id 로 `addItem` 을 계산해 placeholder/기존 항목 위치만 갱신하고, 모델은 drop 시 `editor.addItem({x,y})` 한 번으로 바꾼다. breakpoint 편집 중 `addItem` 은 기본 레이아웃에 자동 위치로 추가하고 해당 breakpoint 에서 `moveItem` 한 번의 커밋으로 처리한다.
- 리소스 해제: 모든 리스너는 `AbortController` signal 로 등록하고 `destroy()` 가 리스너, `ResizeObserver`, 위치 스타일시트(공유 시트는 참조 수가 0 일 때), DOM 을 정리한다. `destroy()` 는 시작 시 `destroy` 이벤트를 낸다(`DriftManager` 가 등록을 정리).
- 컨테이너 간 이동: 두 레이아웃은 core `planTransfer` 로 먼저 계산하고, 에디터 내부 `tx*` 메서드(반영 → 실패 시 롤백 → 이력 → 알림)로 적용한다. `removeItem`+`addItem` 연속 호출로 구현하지 않는다. 이력은 `History` 항목의 `link` 로 두 에디터에 연결되며 link 가 버려지면 상대 스택을 절단한다(`cut`). `undo/redo/canUndo/canRedo` 는 맨 위가 link 면 link 에 위임한다. 포인터 이동은 기존 `PointerController` 드래그에 `PointerTransferHost` 를 붙여 처리하며 새 document 리스너를 만들지 않는다.
- `DriftManager`: 등록 요소 중복은 `getEditorOf()`(모듈 수준 WeakMap)로 막는다. `unregister` 는 등록 정보를 먼저 지운 뒤(재진입 안전) 공통 끌어오기 미리보기 해제 → 활성 해제 → 에디터 destroy → `containerUnregistered` 순서다. Manager `layoutChange` 는 Manager 에 리스너가 있을 때만 에디터를 구독한다. 저장 포맷 검증은 core `parseContainerData`.

### Viewer 보안

- `content`/`title`/`id`/`props` 값은 항상 `escapeHtml`. 신뢰된 HTML 은 `renderContent` 콜백으로만 허용(호출자 책임).
- `scope`(클래스 접두사 `ddr` 기본)는 `^[a-z][a-z0-9-]*$` 만 허용한다(CSS 주입 방지). props 키는 `data-*` 로 변환하며 허용되지 않는 키와 `drift-id` 는 버린다.
- 출력에 `<script>`, `on*`, 인라인 `style` 이 없어야 한다(CSP `script-src 'none'` 에서 동작).

## 5. Coding Conventions

- Prettier/ESLint 설정을 따른다(`npx prettier --write`). `no-console: warn`, 문자열은 single quote, 세미콜론 필수.
- 코드 주석은 한국어. 주석은 "왜"를 설명한다.
- Drift 타입은 `src/drift/types/*.d.ts` 에 두고 `@t/` 로 import 한다(`.d.ts` 안에는 값/enum 을 두지 않는다).
- 새 core 연산은 순수 함수·불변으로 만들고 `src/core.ts` 에서 export 한다. float 같은 정책 인자는 마지막 선택 인자로 전달한다.
- 클래스명은 `src/drift/editor/classNames.ts` 와 `style/_editor.scss` 가 항상 같아야 한다.

## 6. Naming Conventions

| 대상 | 규칙 |
| --- | --- |
| CSS 클래스 | `ddr-*` (예: `ddr-item`, `ddr-handle`, `ddr-title`, `ddr-viewer`). 에디터 캔버스만 `daracl-drift` |
| 속성 | `data-drift-id`(항목 id), `data-x/y/w/h`, `data-bp{n}-x/y/w/h`, `data-ddr`(에디터 인스턴스) |
| CSS 변수 | `--ddr-grid-color`, `--ddr-grid-mask`, `--ddr-grid-size`, `--ddr-grid-offset` |
| SCSS 변수 | `$drift-*` (`!default`) |
| 파일 | 클래스/컨트롤러는 PascalCase(`DriftEditor.ts`), 모듈은 camelCase, 테스트는 `*.test.ts`(Jest), `*.spec.ts`(Playwright) |
| 공개 API | `createDriftEditor`, `DriftEditor`, `renderViewer`, `renderViewerPage`, core 함수는 동사형(`moveItem` 등) |
| 패키지/전역 | `@daracl/drift`, `window.Daracl.drift`, 산출물 `daracl.drift*.css|js` |

## 7. Development Guidelines

- 변경 전에 해당 모듈의 테스트를 먼저 읽고, 변경과 함께 테스트를 추가한다. 새 기능에는 단위 테스트와 `uitest/*.html` 하네스 또는 Playwright 테스트를 같이 둔다.
- 공개 옵션/API 를 바꾸면 `src/drift/types/DriftEditor.d.ts`, `docs/API.md`, `README.md`, 필요 시 `docs/DESIGN.md` 를 같이 갱신한다. `test/build/distConsumer.test.ts` 가 `docs/API.md` 의 표(Editor 메서드, Core/Viewer 함수, 이벤트 이름)와 실제 구현의 일치를 검사하므로 표의 첫 칸 형식(`` `name(` ``)을 유지한다.
- 타이틀 영역 높이는 `$drift-title-height`(SCSS)와 `TITLE_HEIGHT`(`src/drift/constants.ts`)가 같아야 한다.
- 스타일시트 생성 로직(`GeometryStyle`)에 `data-*` 값을 CSS 에 넣을 때는 숫자만 쓴다. 사용자 문자열을 CSS/SVG 에 직접 넣지 않는다.
- `docs/DESIGN.md §9` 의 알려진 제약(세로 방향만, nested grid 없음, 고정 행 높이, Viewer `@media` 는 뷰포트 기준)을 바꾸는 작업이면 문서를 함께 고친다.

## 8. Build & Test Commands

| 명령 | 설명 |
| --- | --- |
| `npm install` | 의존성 설치. 최초 1회 `npx playwright install chromium` |
| `npm run dev` | Vite 개발 서버 (포트 5179, `uitest/index.html`) |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / `eslint "src/**/*.ts"` |
| `npm run build` | dist 정리 후 ESM/CJS(`index/core/viewer`), UMD, CSS, d.ts 병렬 생성 |
| `npm run check:dts` | `dist/**/*.d.ts` 에 내부 별칭(`@t/*`, `@/*`)이 남았거나 상대 import 가 해석되지 않으면 실패 (`build:tsc` 의 마지막 단계로도 실행됨) |
| `npm run example` | `dist` 가 있을 때 `example/viewer.html|css`, `example/fit.html|css` 생성 (JS 없는 Viewer). Viewer 출력이 바뀌면 다시 실행해 함께 커밋한다. `node scripts/build-example.mjs --check` 는 쓰지 않고 차이만 검사하며 `test/build/exampleFresh.test.ts` 가 같은 검사를 한다 |
| `npm test` | Jest. `test/build/*` 는 `dist/` 가 있어야 실행되고 없으면 skip 된다 → 빌드 후 실행할 것 |
| `npm run pwtest` | Playwright 전체 (webServer 로 `vite.config.dev.mjs` 자동 기동, 포트 5179) |
| `npx playwright test e2e/<file>` | 단일 스펙. `--repeat-each=3` 로 불안정 테스트 확인 |
| `npm run docs:gen` | typedoc → `docs/api/` (git 제외) |
| `npm run format` / `npm run format:check` | Prettier 로 정리 / 검사 (src, test, e2e, scripts, 루트 설정 파일) |
| `npm run check` | typecheck + lint + format:check + test |

권장 검증 순서: `typecheck` → `lint` → `build` → `npx jest` → `npx playwright test`. 코드를 고친 뒤 `dist` 를 쓰는 테스트(`test/build`, `example`)는 반드시 `npm run build` 를 다시 실행한다.

테스트 구성: Jest(jsdom) 는 레이아웃을 계산하지 않으므로 `editor.test.ts` 가 `getBoundingClientRect` 를 data 속성 기반으로 모킹한다. 실제 위치·반응형·터치·JS 비활성·CSP 는 Playwright 가 검증한다(JS 비활성은 `javaScriptEnabled:false` 컨텍스트, 터치는 CDP `Input.dispatchTouchEvent`). 애니메이션(0.15s) 도중 좌표를 읽으면 불안정하므로 `expect.poll` 이나 대기를 쓴다.

저장소 안에서 `dist/*.js`(ESM)를 Node 로 직접 import 하면 `MODULE_TYPELESS_PACKAGE_JSON` 경고가 나온다(package.json 에 `type` 이 없어 CJS 로 먼저 해석). npm pack 으로 설치한 외부 프로젝트(node_modules)에서는 경고 없이 ESM/CJS 모두 동작함을 확인했다. `"type": "module"` 을 넣으면 CJS 청크(`*.js`)와 `.d.ts` 형식이 바뀌어 require/node16 CJS 소비자가 깨지고, 진입점을 `.mjs` 로 바꾸면 공개 dist 파일명이 바뀌므로 하지 않는다.

### 배포 타입 선언(d.ts) 규칙

`build:tsc` 의 순서는 **`tsc` → 원본 `src/**/*.d.ts` 복사(Node fs) → `tsc-alias` → `check-dts`** 이다. `tsc-alias` 는 별칭이 가리키는 파일이 실제로 있을 때만 상대 경로로 바꾸는데, `src/drift/types/*.d.ts` 는 `tsc` 가 출력하지 않고 복사 단계에서 `dist` 에 들어가므로, 복사 전에 `tsc-alias` 를 실행하면 `@t/*` 가 그대로 남아 외부 프로젝트가 타입을 해석하지 못한다. 순서를 바꾸지 않는다. 회귀 검사: `scripts/check-dts.mjs`, `test/build/dtsConsumer.test.ts`(npm pack 으로 설치한 소비자, `skipLibCheck:false`, Drift 전용 `paths` 없음).

## 9. Error Handling & Logging

- 잘못된 입력은 조용히 보정하는 쪽(좌표/크기 정규화, 중복·빈 id 항목 제거, 알 수 없는 필드 제거)과 예외를 던지는 쪽을 구분한다. 예외: 빈/중복 id 의 `addItem`, 손상된 JSON·지원하지 않는 version 의 `parseLayout`/`load`, 존재하지 않는 컨테이너, 알 수 없는 breakpoint 이름, 잘못된 Viewer `scope`. 예외 메시지는 `[drift] ...` 형식의 한국어로 쓴다.
- `destroy()` 후 호출은 예외 없이 무시되어야 한다(두 번 호출해도 안전).
- 라이브러리 코드에서 `console` 로그를 남기지 않는다.

## 10. AI Agent Instructions

- 요청한 범위만 구현하고, 결과는 **실행해서 확인**한다. 실행하지 않은 테스트를 통과했다고 보고하지 않는다. 테스트를 삭제하거나 기대값을 낮춰 통과시키지 않는다. 실패하면 원인(제품 결함인지 테스트 문제인지)을 구분해 기록한다.
- 기능을 바꿀 때는 위 §8 의 검증 순서를 따르고 결과를 수치로 보고한다.
- 의존성은 꼭 필요할 때만 추가한다(공통 유틸은 `@daracl/core/utils`). 새로운 기술 스택을 임의로 도입하지 않는다. 로컬 경로 의존성을 추가하지 않는다.
- `F:\09.opensource\daracl\ui-grid` 는 참고용이며 수정하지 않는다.
- 파일 편집은 Edit/Write 도구를 우선한다. 긴 스크립트나 여러 줄 문자열은 셸 heredoc 대신 파일로 작성해 실행한다(Windows Git Bash 에서 인용 문제가 반복되었다). Python 은 이 환경에서 쓸 수 없으므로 Node 스크립트를 쓴다.
- 임시 파일은 `.tmp/`(git 제외)에 두고 작업 후 정리한다. 테스트 결과물(`test-results/`, `playwright-report/`)은 커밋하지 않는다.
- 사용자와의 대화에서 확정된 결정(예: `responsive` 기본 false, 클래스 접두사 `ddr`, 캔버스 `daracl-drift`, `float` 의미, 데이터 속성 기반 위치)을 되돌리지 않는다.

## 11. Restrictions & Precautions

- `dist/`, `docs/api/`, `node_modules/`, `.tmp/`, `test-results/` 는 git 에서 제외된다. `docs/verification/*.png` 는 Playwright 테스트가 갱신하는 증거 이미지이며 `docs/verification-report.md` 의 수치는 작성 시점 기준이다(기능이 바뀌면 재실행 후 갱신).
- Viewer 에 편집 코드/DOM 접근을 넣지 않는다. Viewer 출력 형식(`data-*` 속성, 선택자 구조)을 바꾸면 e2e `verify-viewer`/`verify-datapos`/`verify-responsive` 와 `example/` 를 함께 갱신한다.
- 클래스 접두사나 속성 이름을 바꾸면 소스, SCSS, 테스트, 문서, `example/` 전부에 영향이 있다. 일괄 변경 시 `data-drift-id`(속성)와 `$drift-*`(SCSS 변수)는 클래스가 아니므로 구분한다.
- 브라우저 검증은 현재 Chromium 만 수행했다. Firefox/WebKit, 실기기 터치, UMD 직접 로드, 가장자리 자동 스크롤, 대량 항목 성능은 아직 검증하지 않았다(`docs/verification-report.md §D`).
- 비밀 값, 개인 정보, 외부 서비스 키를 코드·테스트·문서에 넣지 않는다.
