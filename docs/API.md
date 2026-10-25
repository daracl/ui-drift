# API

## createDriftEditor(container, options) → DriftEditor

`container`: `HTMLElement` 또는 CSS selector. 내부에 `.daracl-drift` 를 만든다(컨테이너 padding/스크롤 가능).

### DriftEditorOptions

| 옵션 | 기본 | 설명 |
| --- | --- | --- |
| `layout` | - | 초기 레이아웃(객체/JSON 문자열). 지정하면 아래 columns/rowHeight/gap/breakpoints 는 무시 |
| `columns` / `rowHeight` / `gap` | 12 / 40 / 8 | `layout` 이 없을 때의 기본값 |
| `float` | false | true 이면 드롭 위치 유지(위로 압축 안 함). `layout.float` 가 있으면 그것이 우선 |
| `breakpoints` | tablet(≤1024, 8열), mobile(≤640, 4열) | `[]` 이면 반응형 비활성 |
| `grid` / `gridColor` | true / - | 배경 모눈종이 격자. 색은 CSS 변수 `--ddr-grid-color`(기본 `rgba(148,163,184,.35)` 연한 반투명, 선 두께 0.5px)로 바꾸며, `gridColor` 옵션은 캔버스에 이 변수를 설정한다(영문/숫자/`#(),.%` 만 허용, 그 외는 무시) |
| `resizeHandles` | `['se','sw']` | 표시할 리사이즈 핸들. `'se'` 우하단(오른쪽/아래로 조절), `'sw'` 좌하단(왼쪽/아래로 조절 — 오른쪽 가장자리를 고정하고 `x` 와 `w` 가 함께 바뀜). `[]` 이면 핸들 없음 |
| `draggable` / `resizable` | true | `enableDrag()`/`enableResize()` 로 변경 가능 |
| `responsive` | false | true 이면 컨테이너 폭으로 breakpoint 자동 선택. 기본은 폭이 바뀌어도 기본 레이아웃 유지(`setBreakpoint` 로 명시 전환) |
| `dragMode` | `'auto'` | `'auto'`(마우스=전체, 터치=핸들) / `'item'` / `'handle'` |
| `removable` | false | 삭제 버튼, Delete 키 |
| `extraRows` | 2 | 하단 여분 행 |
| `animate` | true | 이동 애니메이션 |
| `historyLimit` | 100 | undo 최대 개수 |
| `renderItem(item, contentEl)` | - | 내용 직접 렌더링(기본: `content ?? id` 텍스트) |

### DriftEditor

| 메서드 | 설명 |
| --- | --- |
| `addItem(item)` → item | `x`,`y` 생략 시 빈 자리 자동 배치. id 중복/빈 값은 예외 |
| `removeItem(id)` → boolean | |
| `updateItem(id, patch)` | title/content/props/min/max/locked 및 위치·크기(현재 breakpoint 에 저장) |
| `moveItem(id, x, y)` / `resizeItem(id, w, h)` | 충돌 시 다른 항목이 아래로 밀린다. locked 는 거부 |
| `getLayout()` / `getItems()` / `getItem(id)` | 복사본 반환. `getItems` 는 현재 breakpoint 기준 |
| `load(layout)` / `fromJSON(json)` / `toJSON(space?)` | 잘못된 데이터는 보정, 구조가 틀리면 예외 |
| `clear()` / `reset()` | 전체 삭제 / 마지막 load 상태로 (undo 가능) |
| `save()` / `isDirty()` | 저장 기준 갱신 + `save` 이벤트 / 변경 여부 |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | |
| `select(id\|null)` / `getSelected()` | |
| `setBreakpoint('auto'\|name\|null)` / `getBreakpoint()` / `getColumns()` | |
| `setFloat(bool)` / `isFloat()` | float 모드 전환(undo 가능). 끄면 위로 압축됨 |
| `setupDragIn(source, options?)` → dispose | 에디터 밖의 요소를 끌어다 놓아 추가 (아래 "외부에서 끌어와 추가" 참고). `destroy()` 시 자동 해제 |
| `setGrid(bool)` / `isGrid()` | 배경 모눈종이 격자 표시 전환 |
| `setGrid(bool)` / `isGrid()` | 배경 셀 격자 표시 전환 |
| `refresh()` | 컨테이너 크기 재측정 |
| `on` / `once` / `off` | `on` 은 해제 함수를 반환 |
| `destroy()` | 리스너, ResizeObserver, DOM 해제 |

### 이벤트

`layoutChange(layout, {reason})`, `add`, `remove`, `select`, `dragStart`, `dragEnd`, `resizeStart`, `resizeEnd`, `breakpointChange`, `save`, `dragInStart(source)`, `dragInEnd(item|null)`.
`reason`: `init | load | add | remove | update | move | resize | drag | clear | reset | undo | redo`.
변경이 없는 연산은 이벤트/히스토리를 만들지 않는다. 드래그 중에는 모델이 바뀌지 않고 drop 시 한 번만 `layoutChange`.

## Viewer — `@daracl/drift/viewer`

| 함수 | 설명 |
| --- | --- |
| `renderViewer(layout, {scope?, renderContent?})` → `{html, css, scope}` | 입력은 객체/JSON, `parseLayout` 으로 검증·보정 |
| `renderViewerPage(layout, {title?, lang?, cssHref?, nonce?, scope?, renderContent?})` → string | viewport meta 포함, 스크립트 없음 |

`scope` 는 `^[a-z][a-z0-9-]*$` 만 허용 (아니면 예외).

## Core — `@daracl/drift/core` (순수 함수, 불변)

| 분류 | 함수 |
| --- | --- |
| 모델 | `createLayout`, `cloneLayout`, `validateLayout`, `parseLayout`, `serializeLayout`, `normalizeItem(s)` |
| 연산 | `addItem`, `removeItem`, `moveItem`, `resizeItem`, `resizeItemFromLeft`, `updateItem`, `findFreePosition`, `compact` |
| 충돌 | `collides`, `findCollisions`, `firstCollision` |
| 좌표 | `createMetrics`, `toPixelRect`, `toGridPosition`, `toGridSize`, `getRowCount` |
| 반응형 | `getBreakpoints`, `matchBreakpoint`, `deriveItems`, `resolveItems`, `applyItems` |

연산 함수(`addItem/removeItem/moveItem/resizeItem/updateItem/normalizeItems/deriveItems/compact`)는 마지막 선택 인자 `float` 를 받는다. `(items, columns, ...)` 형태로 항목 배열을 받아 새 배열을 반환한다. 같은 입력은 항상 같은 결과를 낸다.

## 스타일

| 파일 | 용도 |
| --- | --- |
| `dist/daracl.drift(.min).css` | Editor |
| `dist/daracl.drift.viewer.min.css` | Viewer 카드 외형(선택). 배치 CSS 는 `renderViewer().css` |

SCSS 변수: `style/_variables.scss` (`$drift-accent`, `$drift-item-bg` 등, `!default`).

## 외부에서 끌어와 추가: setupDragIn

```ts
const dispose = editor.setupDragIn('.palette .card', {
  item: (el) => ({ w: 4, h: 3, title: el.dataset.title, content: el.textContent!.trim() }),
});
// <div class="card" data-w="3" data-h="2" data-title="Chart" data-content="New chart">Chart</div>
```

| 항목 | 설명 |
| --- | --- |
| `source` | CSS selector / 요소 / 요소 목록. selector 는 pointerdown 시점에 평가되므로 나중에 추가된 요소도 드래그되지만, 터치 스크롤 방지용 `touch-action: none`(`ddr-dragin-source` 클래스)은 `setupDragIn` 호출 시점의 요소에만 붙는다. 동적 요소는 CSS 로 `touch-action: none` 을 직접 주거나 다시 호출한다 |
| `options.item` | 추가할 항목 정의(객체) 또는 원본 요소로부터 만드는 함수. 생략하면 원본의 `data-w`/`data-h`(기본 3x2), `data-id`, `data-title`, `data-content`(없으면 텍스트)를 사용 |
| id | 지정하지 않거나 이미 있으면 `item-1`, `item-2` … 처럼 고유하게 만든다 |

- 마우스/터치/펜을 Pointer Events 로 처리한다. 원본은 그대로 남고 복제본(`ddr-dragin-ghost`, body 에 부착)이 포인터를 따라간다. 3px 미만 이동은 클릭으로 취급한다.
- 포인터가 캔버스 위에 있으면 항목의 가운데가 포인터에 오도록 칸을 계산해 placeholder 와, 기존 항목이 비켜가는 미리보기를 보여준다(캔버스에는 `ddr-dragin-over`). 모델은 drop 시 `addItem()` 한 번만 호출되어 `add`/`layoutChange(reason:'add')` 가 한 번 발생하고 undo 한 번으로 되돌아간다.
- 캔버스 밖에서 놓기, `Esc`, `pointercancel` 은 추가하지 않고(`dragInEnd(null)`) 밀렸던 항목을 원위치로 되돌린다.
- `float`, min/max, 컬럼 경계는 일반 추가와 같은 규칙을 따른다. breakpoint 를 편집 중이면 그 breakpoint 의 칸에 놓이고(`responsive[name]`), 기본 레이아웃에는 겹치지 않는 자동 위치로 추가된다.

## 항목 옵션: locked / resizable

| 필드 | 기본 | 설명 |
| --- | --- | --- |
| `locked` | false | 위치 고정. 드래그/리사이즈/키보드 이동 불가, 다른 항목이 비켜가며 locked 와 겹치는 이동은 거부 |
| `resizable` | true | false 이면 크기 조절만 막는다(이동 가능). 리사이즈 핸들이 숨겨지고 `resizeItem` 이 거부. `locked` 이면 무시 |

프로그램에서는 `editor.updateItem(id, { locked: true })` 처럼 런타임에 바꿀 수 있다. 에디터 전체 옵션 `draggable`/`resizable` 과 함께 적용되며 둘 다 true 여야 조작된다.
