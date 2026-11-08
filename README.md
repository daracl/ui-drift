# @daracl/drift

GridStack 스타일의 Drag & Drop 레이아웃 모듈. **Editor** 는 JavaScript 로 배치/크기를 편집하고, **Viewer** 는 저장된 레이아웃을 **JavaScript 없이 CSS Grid 만으로** 표시한다.

- 순수 TypeScript. 공통 유틸은 `@daracl/core/utils`를 사용하며 배포 번들에 필요한 함수만 포함한다.
- 데스크톱(마우스) + 모바일(터치) — Pointer Events
- 충돌 시 자동 재배치(세로 중력, `float` 로 드롭 위치 유지 가능), 리사이즈, undo/redo, JSON 저장/복원
- 반응형: breakpoint 별 컬럼 수와 위치/크기 재정의, 미지정 시 자동 변환
- Viewer 번들은 Editor/DOM 코드를 포함하지 않는다 (빌드 산출물로 검증)

설계 상세는 [docs/DESIGN.md](docs/DESIGN.md), API 는 [docs/API.md](docs/API.md) 를 본다.

같은 패키지에 목록 정렬용 **Sortable** 도 들어 있다(`@daracl/drift/sortable`, Drift 와 독립). 여러 목록을 하나로 관리하는 `createSortableManager()`(칸반 보드처럼 목록 간 이동 범위 격리, API 이동, 전체 순서 저장·복원)도 제공한다. 사용법은 [docs/SORTABLE.md](docs/SORTABLE.md) 를 본다.

## 설치 / 빌드

개발 환경은 Node.js 24.20.0(`.nvmrc`)과 npm 12.2.1을 사용한다. 새 팀원은 아래 순서로 시작한다.

```bash
git clone https://github.com/daracl/ui-drift.git
cd ui-drift
nvm use
npm ci
npx playwright install chromium
npm run build
npm run dev
```

`@daracl/core`는 공개 npm 레지스트리의 `0.0.12` 버전을 사용한다. 별도 corejs 체크아웃이나
`npm link`, `file:`, 로컬 경로 alias 없이 설치된다. `package-lock.json`을 함께 커밋하여 팀과 CI가
같은 의존성을 설치한다. 공통 모듈 변경 시 corejs를 먼저 배포한 뒤 여기서 버전과 lockfile을 갱신한다.
Vite는 공통 유틸을 ESM/CJS/UMD에 번들링하므로 UMD 사용자에게 별도 전역 스크립트는 필요 없다.
버전 매니저가 없다면 Node.js 24.20.0을 설치하고 `nvm use` 단계는 생략한다.

빌드는 Vite 7의 ESM 설정(`vite.config*.mjs`)을 사용한다. `npm run build`는 dist를 한 번 정리하고
ESM/CJS, UMD, CSS, 타입 선언을 병렬 생성한다. 개별 `build:esm`은 dist를 정리하므로 다른 빌드와
직접 동시에 실행하지 않는다. 빌드 스크립트 회귀 검사는 `npm run test:scripts`, 보안 검사는
`npm run audit:security`(런타임) / `npm run audit:security:all`(개발 도구 포함)로 실행한다.
변경 근거와 측정 결과는 [빌드 개선 기록](docs/build-improvements.md)에 정리했다.

```bash
npm install
npm run build        # dist/ (ESM, CJS, UMD, d.ts, css)
npm run example      # example/viewer.html + viewer.css 생성 (JavaScript 없는 Viewer)
```

패키지 entry

| import | 내용 | 용도 |
| --- | --- | --- |
| `@daracl/drift` | core + viewer + editor | 편집 화면 |
| `@daracl/drift/viewer` | core + 정적 HTML/CSS 생성 | **서버/빌드 타임** (DOM 불필요) |
| `@daracl/drift/core` | 순수 레이아웃 엔진 | 계산/검증만 필요할 때 |
| `@daracl/drift/dist/daracl.drift.css` | Editor 스타일 | 편집 화면 |

## Editor

```ts
import { createDriftEditor } from '@daracl/drift';
import '@daracl/drift/dist/daracl.drift.css';

const editor = createDriftEditor('#editor', {
  layout: { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 4, h: 2, content: 'Chart' }] },
  removable: true,
});

editor.addItem({ id: 'b', w: 4, h: 2 });           // 빈 자리에 자동 배치
editor.on('layoutChange', (layout, { reason }) => save(layout));
const json = editor.toJSON();                        // 저장
editor.fromJSON(json);                               // 복원
editor.undo(); editor.redo();
editor.destroy();                                    // 리스너/DOM 해제
```

배경은 모눈종이처럼 칸 경계를 따라 이어지는 격자선으로 표시된다(셀 간격이 있으면 선이 간격 중앙을 지난다). 색은 CSS 변수 `--ddr-grid-color`(예: `#editor{--ddr-grid-color:#9ca3af}`) 또는 `gridColor` 옵션, 기본은 얇은(0.5px) 반투명 선이다. 보이기/숨기기는 `grid: true|false` 옵션 또는 `editor.setGrid(bool)`.

크기 조절 핸들은 카드 우하단(오른쪽/아래로)과 좌하단(왼쪽/아래로 — 오른쪽 가장자리는 고정되고 위치와 폭이 함께 바뀜) 두 곳이다. `resizeHandles: ['se']` 처럼 옵션으로 고를 수 있다. 변 가운데 핸들 `'e'`(동·너비), `'w'`(서·왼쪽 너비, 오른쪽 고정), `'s'`(남·높이)도 쓸 수 있다. 예: `resizeHandles: ['e', 'w', 's', 'se', 'sw']`.

드래그·리사이즈 중 가장자리 자동 스크롤은 스크롤 가능한 상위 조상(없으면 window)을 자동으로 찾는다. 중첩 레이아웃에서 스크롤 영역을 직접 지정하려면 `scrollContainer` 를 쓴다. 문자열은 편집기 컨테이너 자신을 포함해 `closest()` 로 찾으므로 같은 화면에 편집기가 여러 개여도 각자 속한 영역만 스크롤된다.

```ts
createDriftEditor(gridEl, { scrollContainer: '.drs-canvas' });
```

조작: 마우스는 카드 전체를 끌어 이동, 우하단 핸들로 리사이즈. **터치는 상단 핸들에서만 드래그**(카드 본문은 페이지 스크롤). 키보드: 방향키 이동, Shift+방향키 리사이즈, Delete 삭제(`removable`), Esc 취소/선택 해제.

드롭 위치 유지: `createDriftEditor(el, { float: true })` 또는 `editor.setFloat(true)`. 기본(false)은 놓은 항목을 위로 자동 압축하고, `float` 는 놓은 자리에 그대로 두며 겹칠 때만 아래로 민다. 값은 레이아웃 JSON 의 `float` 에 저장되어 Viewer 도 같은 배치를 낸다.

외부에서 끌어와 추가: `editor.setupDragIn('.palette .card')` 로 에디터 밖의 요소(팔레트 등)를 캔버스로 끌어다 놓아 추가한다. 크기/제목/내용은 원본의 `data-w`, `data-h`, `data-title`, `data-content` 또는 `item` 옵션으로 정한다. 마우스와 터치 모두 동작한다.

외부 모델 연동: 외부 모델이 undo/redo 와 컴포넌트를 관리한다면 `history:false`, `keyboard:false`, `programmaticEvents:false` 로 겹치는 기능을 개별로 끄고, `layoutChange` 의 `info.source`(user/api/sync)와 `info.changes`(추가·제거·변경 항목의 before/after, 충돌로 밀려난 항목 포함)로 변경을 받으며, `syncItems()` 로 모델을 id 기준으로 한 번에 반영하고, `contentLifecycle` 로 Grid/Chart 같은 외부 위젯의 생성·갱신·해제를, `sizeChange` 로 위젯의 `resize()` 시점을 받는다. 자세한 내용은 [docs/API.md](docs/API.md)("외부 모델 연동" 절), 성능 측정은 [docs/performance.md](docs/performance.md).

외부 모델(예: ReportStudio)이 상태를 관리한다면 `setupDragIn(source, { autoAdd: false, onDrop })` 로 Drift 는 최종 위치·크기만 전달하게 하고 호출자가 직접 추가한다(`onDrop` 안에서 `editor.addItem()` 을 동기 호출해도 안전). 자세한 내용은 [docs/API.md](docs/API.md).

반응형 편집: `editor.setBreakpoint('mobile')` 로 해당 breakpoint 를 편집하면 `item.responsive.mobile` 에만 저장된다. `'auto'` 는 컨테이너 폭으로 선택(옵션 `responsive: true` 와 같음), `null`(기본)은 폭이 바뀌어도 기본 레이아웃을 유지한다.

## 여러 컨테이너 (DriftManager)

한 페이지의 여러 영역(header/body/footer 등)을 각각 독립된 에디터로 두고 하나의 관리자로 다룬다. 각 에디터의 기능은 그대로이고, Manager 는 등록/해제, 활성 컨테이너, 공통 팔레트 끌어오기, 이벤트 집계, 전체 저장·복원을 맡는다. 자세한 정책은 [docs/MULTI_CONTAINER.md](docs/MULTI_CONTAINER.md).

```ts
import { createDriftManager } from '@daracl/drift';

const manager = createDriftManager();
manager.register('header', '#header', { columns: 12 });
manager.register('body', '#body', { columns: 6 });

manager.setupDragIn('.palette .item');                       // 포인터 아래의 컨테이너 하나에만 추가
manager.on('layoutChange', ({ containerId, layout }) => save(containerId, layout));
manager.getActiveEditor()?.undo();                           // 마지막으로 조작한 컨테이너

const json = manager.toJSON();                               // { version: 1, containers: [{ id, layout }] }
manager.fromJSON(json);                                      // 등록된 컨테이너에 복원 (전체 검증 후 적용)
manager.destroy();
```

컨테이너 간 항목 이동: `createDriftManager({ crossContainerDrag: true })` 로 마우스·터치 이동을 켜고(기본 꺼짐), API 는 `manager.transferItem({ from, to, itemId, x?, y?, newId? })` 이다. 두 컨테이너의 변경은 한 트랜잭션으로 반영되고 어느 쪽 `undo()` 든 함께 되돌린다. 규칙은 [docs/MULTI_CONTAINER.md §10](docs/MULTI_CONTAINER.md).

## Viewer (JavaScript 없음)

```ts
import { renderViewer, renderViewerPage } from '@daracl/drift/viewer';

const { html, css } = renderViewer(savedLayout);                       // 조각
const page = renderViewerPage(savedLayout, { cssHref: '/layout.css' }); // 완성된 문서(스크립트 없음)
```

```html
<div class="ddr-viewer">
  <div class="ddr-item" data-drift-id="a" data-x="0" data-y="0" data-w="4" data-h="2"
       data-bp0-w="3" data-bp1-w="4"><div class="ddr-title">Sales</div>Chart</div>
</div>
```

```css
.ddr-viewer{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-auto-rows:40px;gap:8px}
/* 위치/크기는 data 속성값으로 정해진다 (같은 값은 한 규칙을 공유) */
.ddr-viewer>[data-x="0"]{grid-column-start:1}
.ddr-viewer>[data-w="4"]{grid-column-end:span 4}
.ddr-viewer>[data-y="0"]{grid-row-start:1}
.ddr-viewer>[data-h="2"]{grid-row-end:span 2}
@media (max-width:1024px){ /* 8열: data-bp0-* 가 달라진 값만 */
  .ddr-viewer>[data-bp0-w="3"]{grid-column-end:span 3}
}
```

항목의 위치/크기는 `style` 이 아니라 **`data-x`, `data-y`, `data-w`, `data-h`** 속성이 정한다(breakpoint 값은 큰 것부터 `data-bp0-*`, `data-bp1-*`). Editor 의 항목도 같은 속성을 갖고, 에디터가 만든 속성 선택자 CSS(`[data-x="3"]{left:…}`)가 배치한다.

- 출력에 `<script>`, `on*` 속성, 인라인 `style` 이 없어 CSP(`script-src 'none'`)에서 동작한다. 외부 CSS 파일(`cssHref`) 또는 `nonce` 인라인 `<style>` 선택.
- `content`/`props`/`id` 는 항상 escape. 신뢰된 HTML 은 `renderContent` 콜백으로만.
- 여러 레이아웃을 한 페이지에 둘 때는 `scope` 옵션으로 클래스를 분리한다.
- 미디어 쿼리는 **뷰포트 기준**이다(Editor 의 breakpoint 는 컨테이너 폭 기준).

## 레이아웃 데이터

```json
{
  "version": 1, "columns": 12, "rowHeight": 40, "gap": 8, "float": false,
  "breakpoints": [{ "name": "tablet", "maxWidth": 1024, "columns": 8 }, { "name": "mobile", "maxWidth": 640, "columns": 4 }],
  "items": [
    { "id": "a", "x": 0, "y": 0, "w": 4, "h": 2, "minW": 2, "maxW": 8, "title": "Sales", "locked": false, "resizable": true, "content": "Chart",
      "props": { "kind": "chart" }, "responsive": { "mobile": { "x": 0, "y": 0, "w": 4, "h": 3 } } }
  ]
}
```

`title` 은 Editor 에서는 카드 상단 핸들 바(드래그 영역)에, Viewer 에서는 본문 위 `.ddr-title` 로 표시된다(항상 텍스트로 escape).

Editor 가 `getLayout()/toJSON()` 으로 내보낸 데이터를 Viewer 가 그대로 입력으로 받는다.

## 테스트

```bash
npm test                 # Jest (core, viewer, editor(jsdom), dist 번들 검사). dist 검사는 build 후 실행됨
npm run pwtest           # Playwright (데스크톱 마우스, 모바일 터치, JS 비활성 Viewer, CSP, Editor↔Viewer 일치)
npx playwright install chromium   # 최초 1회
npm run dev              # uitest/editor.html 수동 확인 (http://127.0.0.1:5179)
                         #  - 항목을 선택하고 상단 패널의 locked(위치 고정) / resizable(크기 조절)을 독립적으로 체크하면 바로 적용된다
                         #  - 팔레트(+ Chart 등)를 캔버스로 끌어다 놓아 추가, float/격자 토글, breakpoint 선택
```

## 알려진 제약

[docs/DESIGN.md §9](docs/DESIGN.md) 참고 (세로 방향만, nested grid 없음, 고정 행 높이 등. 외부 모델 연동의 한계는 §8).

## License

MIT
