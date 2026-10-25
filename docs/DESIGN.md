# ui-drift 설계 문서

## 1. ui-grid 분석 결과 (계승 항목)

| 항목 | ui-grid | ui-drift 적용 |
| --- | --- | --- |
| 언어 | TypeScript (strict, target es2017) | 동일 |
| 빌드 | Vite 5 lib (ESM/CJS) + UMD 별도 설정, `tsc --emitDeclarationOnly` + `tsc-alias` | 동일 (+ 다중 entry) |
| 스타일 | SCSS → `daracl.grid(.min).css` | SCSS → `daracl.drift(.min).css`, `daracl.drift.viewer.min.css` |
| 테스트 | Jest(ts-jest, jsdom) + Playwright, `uitest/*.html` 수동 페이지 | 동일 |
| 별칭 | `@/` → `src/`, `@t/` → `src/types/` | 동일 |
| 타입 | `src/types/*.d.ts` | 동일 |
| 포맷 | prettier(세미콜론, single quote, 120), eslint | 설정 파일 그대로 복사 |
| 포인터 | `PointerContext/Handler/Session` 상태 머신 | Pointer Events 기반 `DragSession` / `ResizeSession` |
| 의존성 | 런타임 의존성 없음(@daracl/core는 external) | 런타임 의존성 **없음** |

참고 프로젝트의 원본 소스는 수정하지 않았고 코드를 복사하지 않았다(설정 파일 제외).

## 2. 모듈 구조와 의존 방향

```
types ─▶ core ─▶ viewer           (viewer 는 core 의 순수 함수만 사용, DOM/Editor 비의존)
           └───▶ editor ─▶ event  (editor 만 DOM/Pointer 사용)
index.ts = core + viewer + editor      core.ts = core      viewer.ts = core + viewer
```

| 모듈 | 책임 | DOM |
| --- | --- | --- |
| `core/` | 데이터 정규화/검증, 충돌, 압축(compact, 열별 색인), 이동/리사이즈/추가/삭제, 좌표 변환, 반응형 변환, 직렬화, 변경 비교(diff) | X |
| `viewer/` | 레이아웃 → 정적 HTML + CSS 문자열 생성(SSR/빌드 타임) | X |
| `editor/` | DOM 렌더, Drag/Resize(마우스·터치), 외부 요소 끌어오기(drag-in), 키보드, 선택, 히스토리, 이벤트 | O |
| `event/` | 소형 Emitter | X |

배포 entry: `@daracl/drift`(전체), `@daracl/drift/core`, `@daracl/drift/viewer`.
`viewer` entry 번들에는 editor/pointer/addEventListener 코드가 포함되지 않으며 `test/build/viewerBundle.test.ts` 가 빌드 산출물을 검사한다.

## 3. 레이아웃 데이터 모델

```ts
interface DriftLayout { version: 1; columns: number; rowHeight: number; gap: number;
                        breakpoints?: DriftBreakpoint[]; items: DriftItem[] }
interface DriftItem   { id; x; y; w; h; title?; minW?; minH?; maxW?; maxH?; locked?;
                        content?: string; props?: Record<string, string|number|boolean|null>;
                        responsive?: Record<breakpointName, {x,y,w,h}> }
interface DriftBreakpoint { name; maxWidth; columns }
```

* 좌표는 0 기반 정수 셀 단위. 항목의 위치/크기는 `style` 이 아니라 **data 속성**(`data-x`, `data-y`, `data-w`, `data-h`)으로 표현한다.
  * Viewer: `[data-x="3"]{grid-column-start:4}`, `[data-w="4"]{grid-column-end:span 4}`, `[data-y]`→`grid-row-start`, `[data-h]`→`grid-row-end:span`. 같은 값은 규칙을 공유하며, breakpoint 값은 `data-bp{n}-*` 속성과 `@media` 안의 같은 형태 규칙으로 덮어쓴다.
  * Editor(GridStack 의 `gs-x` 방식): 에디터 인스턴스별(`data-ddr`) 스타일시트에 `[data-x="3"]{left:calc((100% + gap) * 3 / cols)}`, `[data-w]`→`width`, `[data-y]`→`top`, `[data-h]`→`height` 규칙을 생성한다. 생성형(adoptedStyleSheets) 스타일시트를 우선 써서 CSP 에서도 인라인 `<style>` 이 필요 없다(미지원 환경에서만 `<style>` 대체). 드래그/리사이즈 중에만 포인터를 따라가는 인라인 `left/top/width/height` 를 쓰고 끝나면 제거한다.
* `breakpoints` 미지정 시 기본값 `tablet(≤1024px, 8열)`, `mobile(≤640px, 4열)`. `[]` 이면 반응형 비활성.
* JSON 직렬화는 이 구조 그대로이며 Editor/Viewer 가 같은 모델을 쓴다.

## 4. 충돌/재배치 정책 (GridStack 방식, 세로 중력)

1. 이동/리사이즈 대상(anchor)을 목표 좌표에 먼저 놓는다.
2. 나머지를 `(y, x)` 순으로 배치하면서 이미 놓인 항목과 겹치면 아래로 민다.
3. 전체를 한 번 더 위로 압축(compact)한다. `locked` 항목은 고정 장애물이며, locked 와 겹치는 이동은 거부된다.
4. `layout.float = true` 이면 위로 올리는 압축(2~3 의 상향 이동)을 하지 않는다. 놓은 위치를 유지하고 겹칠 때만 아래로 민다. 값은 레이아웃에 저장되어 Editor/Viewer/반응형 변환이 같은 정책을 쓴다.
5. 동일 입력 → 동일 출력(안정 정렬, 순수 함수).

## 5. 반응형 정책

* 우선순위: `item.responsive[bp]` 명시값 → 자동 변환.
* 자동 변환: 열 수가 6 이상이면 비례 축소(scale), 6 미만이면 세로 적층(stack: 전폭, `y,x` 순서 유지, 높이 유지). 이후 충돌 해소. 항목이 화면 밖으로 나가거나 겹치지 않는다.
* Viewer: 큰 breakpoint 부터 `@media (max-width)` 블록을 생성하고, 이전 단계와 달라진 규칙만 출력한다. 화면 전환은 CSS 만으로 이루어진다.
* Editor: `setBreakpoint(name | 'auto' | null)`. 편집한 breakpoint 의 전체 항목이 `responsive[name]` 에 명시 저장된다.

## 6. Viewer 의 JavaScript 비실행 전략

* Viewer 는 Editor 결과(DOM)를 재사용하지 않고 `renderViewer(layout)` 로 **정적 HTML + CSS 문자열**을 별도 경로로 생성한다.
* 출력 HTML 에 `<script>`, `on*` 속성, 인라인 `style` 속성이 없다 → CSP(`script-src 'none'`, `style-src` nonce/해시 또는 외부 파일)에서 동작한다.
* 클래스는 `{scope}-viewer / -item / -i{n}`. `scope` 는 `^[a-z][a-z0-9-]*$` 만 허용(CSS 주입 방지)해 충돌을 막는다.
* `content` 와 `props` 는 항상 HTML escape. 신뢰된 HTML 이 필요하면 `renderContent` 콜백으로 호출자가 책임진다.
* 숫자 값은 정수/유한수 검증 후에만 CSS 에 삽입한다.
* DOM 순서는 `(y, x)` 정렬이라 CSS 가 없는 환경(리더, 텍스트 브라우저)에서도 읽기 순서가 합리적이다.
* 검증: Playwright 에서 `javaScriptEnabled:false` 컨텍스트로 위치/크기/반응형 전환을 실측하고, 요청 목록에 script 가 없음을 확인한다.

## 7. Editor 입력 정책 (데스크톱 + 모바일)

* Pointer Events 단일 경로(mouse/touch/pen). 세션은 `pointerdown` 에서 시작, `setPointerCapture`.
* **스크롤 충돌 방지**: `touch-action: none` 은 *드래그 핸들*과 *리사이즈 핸들*에만 적용한다. 카드 본문은 터치 스크롤이 그대로 동작한다.
  * `dragMode: 'auto'`(기본): 마우스/펜은 카드 전체, 터치는 핸들에서만 드래그.
* 3px 이동 임계값 전에는 클릭(선택)으로 취급. `Esc`/`pointercancel` 로 취소하면 원위치.
* 드래그 중 모델은 변경하지 않고 snapshot 기준으로 미리보기만 계산(셀이 바뀔 때만 재계산) → drop 시 1회 커밋.
* 화면 가장자리에서 자동 스크롤. 코어스 포인터에서 핸들/리사이즈 대상 최소 크기 44px.
* 리사이즈 핸들은 카드 우하단(`se`: 오른쪽/아래로 조절)과 좌하단(`sw`: 왼쪽/아래로 조절, 오른쪽 가장자리 고정하고 `x`/`w` 가 함께 바뀜) 두 곳이다(`resizeHandles` 옵션). `sw` 의 무효 표시(locked 충돌)는 거부 후의 결과가 아니라 요청한 크기로 판정한다.
* **외부 drag-in(`setupDragIn`)**: 에디터 밖 요소(팔레트 등)를 끌어다 캔버스에 놓아 추가한다. 별도 `DragInController` 가 document 단위 Pointer 리스너로 처리하며 원본은 그대로 두고 복제본(ghost)이 따라간다. 미리보기는 임시 id 로 `addItem` 을 계산해 placeholder 와 기존 항목의 비켜가는 모습만 보여주고(모델 불변), 놓는 순간 최종 위치/크기를 한 번 더 확정한다.
  * 기본(`autoAdd:true`): 정리 후 `editor.addItem()` 한 번 → `add`/`layoutChange` 1회, undo 1단계.
  * `autoAdd:false`: 외부 모델이 상태를 관리하는 환경용. 정리(ghost, placeholder, 밀린 항목 복원) 후 `onDrop` 으로 최종 위치·크기(복사본)만 전달하고 레이아웃/선택/이력/dirty/이벤트는 건드리지 않는다. 정리가 콜백보다 먼저이므로 콜백 안의 동기 `addItem()` 이 안전하다. `dragInEnd` 는 항상 `null`(추가된 항목 없음)이고 정상 드롭은 `onDrop` 으로 구분한다.
* 키보드: 방향키 이동, Shift+방향키 리사이즈(오른쪽/아래 기준), Delete 삭제, Esc 선택 해제.
* `destroy()` 는 AbortController 로 모든 리스너/ResizeObserver 를 해제한다.

## 8. 외부 모델 연동 설계

외부 모델(예: ReportStudio)이 컴포넌트와 undo/redo 를 관리하는 환경에서 Drift 의 기능과 겹치지 않도록, 아래 항목을 **서로 독립적으로** 제어한다.

| 관심사 | 수단 | 정책 |
| --- | --- | --- |
| undo/redo 중복 | 옵션 `history:false` (호출별 `{history:false}`) | 이력 스택에 쌓지 않고 `undo/redo/canUndo/canRedo` 는 false. `historyLimit:0` 같은 우회에 의존하지 않는다. 사용자 조작·이벤트는 정상 |
| 키보드 중복 | 옵션 `keyboard:false`, `setKeyboard()` | 항목 키 처리(방향키/Shift+방향키/Delete/Esc 선택 해제)만 끈다. 진행 중 세션의 `Esc` 취소는 `document` 수준의 별도 리스너라서 항상 유지(드래그, 리사이즈, 외부 끌어오기) |
| 프로그램 변경의 이벤트 | 옵션 `programmaticEvents`, 호출별 `{emit}` | `source:'user'` 는 항상 발생. 프로그램 호출만 억제 |
| 변경 출처 | `info.source`: `'user' | 'api' | 'sync'` | 사용자 조작은 `'user'`(드래그/리사이즈/키보드/삭제 버튼/외부 끌어오기 drop), 프로그램 호출은 `'api'`, 동기화는 `'sync'`. 호출별 `{source}` 로 지정 |
| 변경 항목 | `info.changes` (added/removed/changed{before,after,moved,resized}) | 변경 전/후 **효과적인 항목 목록**(현재 breakpoint)을 id 로 비교(`core/diff.ts`). 충돌로 밀려난 항목 포함, 변경 없는 항목 제외, 복사본 |
| 일괄 동기화 | `syncItems()` | 단일 커밋(렌더 1회, 이벤트 1회), id 기준 DOM 유지, `placement` 로 정확한 복원/충돌 정규화 선택 |
| 콘텐츠 수명 | `contentLifecycle` | id 별 요소와 `ContentState` 로 mount/update/unmount 를 정확히 한 번씩, DOM 을 비우기 전에 해제 |
| 크기 알림 | `sizeChange`, 옵션 `sizeNotify` | 마지막으로 알린 크기와 비교(셀 크기 + 픽셀), rAF 로 프레임당 한 번, 리스너 없으면 예약 안 함 |

### 순환 방지 원칙

* 변경 감지는 **구조 비교**(`layoutsEqual`)이며 값이 같으면 어떤 것도 하지 않는다(렌더/이벤트/이력 없음).
* `syncItems` 의 기본 `placement:'auto'` 는 겹침이 없는 입력을 압축하지 않고 그대로 복원한다. 그래서 `layoutChange(user)` → 호스트가 모델 갱신 → `syncItems(모델)` 이 **추가 이벤트 없이 끝난다**.
* 동기화로 생긴 이벤트는 `source:'sync'` 로 구분되어 호스트가 걸러낼 수 있다.
* `load()` 는 의미를 바꾸지 않았다(정규화/압축, 이력·저장 기준 초기화). 외부 모델과 맞출 때는 `syncItems()`.

### 알려진 한계 (이 영역)

* `syncItems` 는 항상 **기본 레이아웃** 항목을 대상으로 한다(breakpoint 편집 중에도). breakpoint 별 배치는 `responsive` 필드로 전달한다.
* 호출별 `history:false` 로 일부 변경만 기록하지 않으면, `undo()` 가 기록 시점의 스냅샷으로 되돌려 그 사이의 변경이 사라질 수 있다. 외부 모델이 undo 를 관리하면 에디터 옵션 `history:false` 를 쓴다.
* `sizeChange` 의 크기는 메트릭으로 계산한 카드 크기이며 콘텐츠 영역(패딩/타이틀 제외)의 실제 크기가 아니다. 필요하면 호스트가 `contentElement` 를 측정한다.
* 콘텐츠 훅의 예외는 렌더/해제가 끝난 뒤 첫 예외를 다시 던진다(이벤트 발생 전에 던져질 수 있다).

성능 측정과 개선 내용은 [performance.md](performance.md).

## 9. 알려진 제약

* 세로 방향만 지원한다(기본 중력 압축, 옵션 `float`). 가로 중력은 없음.
* 레이아웃 중첩(nested grid)은 범위 밖. 그리드 간(에디터 ↔ 에디터) 항목 이동도 지원하지 않는다. 외부 요소 → 에디터 drag-in 은 `setupDragIn` 으로 지원한다(§7).
* drag-in 중 화면 가장자리 자동 스크롤은 없다(캔버스가 화면에 보이는 상태에서 놓아야 한다). 동적으로 추가된 원본에 터치 스크롤 방지(`touch-action: none`)는 `setupDragIn` 호출 시점의 요소에만 자동 적용된다.
* 리사이즈 핸들은 우하단(`se`)과 좌하단(`sw`) 두 곳이다. 위쪽/오른쪽·왼쪽 가장자리 단독 핸들(n, e, w, ne, nw)은 없다. 키보드 리사이즈는 오른쪽/아래 기준(Shift+방향키)만 있고 왼쪽 기준은 없다.
* Viewer 의 행 높이는 고정(`rowHeight` px). 콘텐츠가 넘치면 항목 내부 스크롤(`overflow:auto`).
