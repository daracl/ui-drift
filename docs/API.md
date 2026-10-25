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
| `historyLimit` | 100 | undo 최대 개수 (`history:false` 이면 의미 없음) |
| `history` | true | **내부 undo/redo 기록**. false 이면 변경을 이력에 쌓지 않고 `undo()`/`redo()`/`canUndo()`/`canRedo()` 가 모두 false. 사용자 조작과 변경 이벤트는 그대로 동작한다. 외부 모델이 undo 를 관리할 때 끈다 |
| `keyboard` | true | **내부 키보드 처리**(방향키 이동, Shift+방향키 리사이즈, Delete 삭제, Esc 선택 해제). false 이면 모두 끈다. **진행 중인 드래그/리사이즈/외부 끌어오기의 `Esc` 취소는 이 옵션과 무관하게 항상 유지**된다. 삭제 버튼 클릭 같은 마우스 동작도 영향 없음. `setKeyboard()` 로 런타임 변경 |
| `programmaticEvents` | true | 프로그램 호출(`addItem`/`updateItem`/`load` 등)이 `layoutChange`/`add`/`remove` 를 발생시킬지. 사용자 조작(`source:'user'`)의 이벤트는 항상 발생. 호출마다 `{ emit }` 으로 덮어쓸 수 있다 |
| `sizeNotify` | `'end'` | `sizeChange` 정책. `'end'`: 사용자 리사이즈 도중에는 알리지 않고 확정 뒤 알림. `'live'`: 도중에도 프레임마다 합쳐 알림 |
| `contentLifecycle` | - | 콘텐츠 생성/갱신/해제 훅 (아래 "콘텐츠 수명"). 지정하면 `renderItem` 보다 우선 |
| `renderItem(item, contentEl)` | - | 내용 직접 렌더링(기본: `content ?? id` 텍스트) |

### DriftEditor

| 메서드 | 설명 |
| --- | --- |
| `addItem(item, opts?)` → item | `x`,`y` 생략 시 빈 자리 자동 배치. id 중복/빈 값은 예외 |
| `removeItem(id, opts?)` → boolean | |
| `updateItem(id, patch, opts?)` | title/content/props/min/max/locked 및 위치·크기(현재 breakpoint 에 저장) |
| `moveItem(id, x, y, opts?)` / `resizeItem(id, w, h, opts?)` | 충돌 시 다른 항목이 아래로 밀린다. locked 는 거부 |
| `getLayout()` / `getItems()` / `getItem(id)` | 복사본 반환. `getItems` 는 현재 breakpoint 기준 |
| `load(layout, opts?)` / `fromJSON(json)` / `toJSON(space?)` | 잘못된 데이터는 보정, 구조가 틀리면 예외 |
| `clear(opts?)` / `reset(opts?)` | 전체 삭제 / 마지막 load 상태로 (undo 가능) |
| `save()` / `isDirty()` | 저장 기준 갱신 + `save` 이벤트 / 변경 여부 |
| `undo(opts?)` / `redo(opts?)` / `canUndo()` / `canRedo()` / `isHistory()` | 내부 이력이 꺼져 있으면(`history:false`) undo/redo 는 항상 false |
| `syncItems(items, options?)` → 결과 | **외부 모델의 항목 목록을 id 기준으로 동기화** (아래 "외부 모델 연동") |
| `setKeyboard(bool)` / `isKeyboard()` | 내부 키보드 처리 전환 |
| `select(id\|null)` / `getSelected()` | |
| `setBreakpoint('auto'\|name\|null)` / `getBreakpoint()` / `getColumns()` | |
| `setFloat(bool)` / `isFloat()` | float 모드 전환(undo 가능). 끄면 위로 압축됨 |
| `setupDragIn(source, options?)` → dispose | 에디터 밖의 요소를 끌어다 놓아 추가 (아래 "외부에서 끌어와 추가" 참고). `destroy()` 시 자동 해제 |
| `setGrid(bool)` / `isGrid()` | 배경 모눈종이 격자 표시 전환 |
| `refresh()` | 컨테이너 크기 재측정 |
| `on` / `once` / `off` | `on` 은 해제 함수를 반환 |
| `destroy()` | 리스너, ResizeObserver, 예약된 크기 알림, 콘텐츠(unmount), DOM 해제 |

### 이벤트

`layoutChange(layout, {reason, source, changes})`, `sizeChange(changes)`, `add`, `remove`, `select`, `dragStart`, `dragEnd`, `resizeStart`, `resizeEnd`, `breakpointChange`, `save`, `dragInStart(source)`, `dragInEnd(item|null)` (`autoAdd:false` 에서는 항상 `null`, 위 "onDrop 과 autoAdd:false" 참고).
`reason`: `init | load | add | remove | update | move | resize | drag | clear | reset | undo | redo | sync`.
`layoutChange` 의 첫 인자(레이아웃 복사본)와 `info.reason` 은 기존과 같고, `info.source` 와 `info.changes` 가 추가되었다 (아래 "외부 모델 연동").
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
| 모델 | `createLayout`, `cloneLayout`, `validateLayout`, `parseLayout`, `serializeLayout`, `sanitizeItem`, `normalizeItem(s)` |
| 비교 | `diffItems`, `itemsEqual`, `layoutsEqual` |
| 연산 | `addItem`, `removeItem`, `moveItem`, `resizeItem`, `resizeItemFromLeft`, `updateItem`, `findFreePosition`, `compact` |
| 충돌 | `collides`, `findCollisions`, `firstCollision`, `hasOverlap` |
| 좌표 | `createMetrics`, `toPixelRect`, `toGridPosition`, `toGridSize`, `getRowCount` |
| 반응형 | `getBreakpoints`, `matchBreakpoint`, `deriveItems`, `resolveItems`, `applyItems` |

연산 함수(`addItem/removeItem/moveItem/resizeItem/updateItem/normalizeItems/deriveItems/compact`)는 마지막 선택 인자 `float` 를 받는다. `(items, columns, ...)` 형태로 항목 배열을 받아 새 배열을 반환한다. 같은 입력은 항상 같은 결과를 낸다.

## 스타일

| 파일 | 용도 |
| --- | --- |
| `dist/daracl.drift(.min).css` | Editor |
| `dist/daracl.drift.viewer.min.css` | Viewer 카드 외형(선택). 배치 CSS 는 `renderViewer().css` |

SCSS 변수: `style/_variables.scss` (`$drift-accent`, `$drift-item-bg` 등, `!default`).

## 외부 모델 연동 (ReportStudio 처럼 외부가 상태를 관리하는 환경)

외부 모델이 컴포넌트 추가·삭제·속성·배치 변경과 undo/redo 를 하나로 관리한다면, Drift 의 내부 기능과 겹치는 부분을 **독립적으로** 끌 수 있다.

```ts
const editor = createDriftEditor(el, {
  history: false,            // 내부 undo/redo 기록 끔 (외부 모델이 관리)
  keyboard: false,           // 내부 키보드 처리 끔 (호스트가 단축키 관리)
  programmaticEvents: false, // 호스트가 호출한 변경은 이벤트를 만들지 않음 (되돌림 방지)
  contentLifecycle: { mount, update, unmount },   // Grid/Chart 같은 외부 인스턴스 연결
});
editor.on('layoutChange', (layout, { reason, source, changes }) => {
  if (source === 'sync') return;           // 외부 모델 → Drift 반영으로 생긴 이벤트는 무시
  store.apply(changes);                    // 사용자 조작 결과만 모델에 반영
});
editor.on('sizeChange', (changes) => changes.forEach((c) => widgets.get(c.id)?.resize(c.width, c.height)));
```

### 변경 출처 (source) 와 호출별 옵션

`DriftApplyOptions` — `addItem/removeItem/updateItem/moveItem/resizeItem/clear/reset/load/undo/redo/setFloat` 의 마지막 인자, `syncItems` 의 옵션에 포함.

| 옵션 | 기본 | 설명 |
| --- | --- | --- |
| `source` | `'api'` (`syncItems` 는 `'sync'`) | `'user'` 사용자 조작(드래그, 리사이즈, 키보드, 삭제 버튼, 외부 끌어오기 drop), `'api'` 프로그램 호출, `'sync'` 외부 모델 동기화 |
| `emit` | 에디터 옵션 `programmaticEvents` | 이벤트 발생 여부. `source:'user'` 는 항상 발생 |
| `history` | true (`syncItems` 는 false) | 이 변경을 undo 이력에 기록할지. 에디터 옵션 `history:false` 이면 항상 기록하지 않는다 |

* 사용자 조작은 `history:false` 여도 정상 동작하고 `layoutChange` 를 발생시킨다(`source:'user'`).
* `history:false` 로 기록하지 않은 변경은 `undo()` 로 되돌릴 수 없다. `undo()` 는 **기록된 시점의 스냅샷**으로 복원하므로, 일부 변경만 기록하지 않으면 그 사이의 변경이 사라질 수 있다. 외부 모델이 undo 를 관리한다면 에디터 옵션 `history:false` 를 쓴다.

### layoutChange 의 변경 정보 (info.changes)

```ts
info.changes = {
  added:   DriftItem[],                                   // 추가된 항목
  removed: DriftItem[],                                   // 제거된 항목
  changed: { id, before, after, moved, resized }[],       // 위치/크기/내용 등이 바뀐 항목
}
```

* **현재 breakpoint 기준**이며, 사용자가 움직인 항목뿐 아니라 **충돌로 밀려난 항목도 `changed` 에 포함**된다. 실제로 값이 바뀐 항목만 들어 있다.
* `moved`: x/y 변경, `resized`: w/h 변경. 내용(title/content/props)만 바뀌면 둘 다 false.
* 모든 항목은 내부 상태와 분리된 **복사본**이다(수정해도 에디터에 영향 없음).
* 변경이 없는 호출은 이벤트도 이력도 만들지 않는다. 리스너가 없거나 `emit:false` 이면 복사/비교 자체를 건너뛴다.
* 기존 코드(`(layout, { reason }) => ...`)는 그대로 동작한다.

### 일괄 동기화: syncItems(items, options?)

`load()` 는 레이아웃을 통째로 정규화(압축)해 교체하고 이력/저장 기준을 초기화한다. `syncItems()` 는 **외부 모델의 항목 목록을 id 기준으로 맞추는 별도 API**이다 (`load()` 의 의미는 바뀌지 않았다).

| 동작 | 설명 |
| --- | --- |
| 같은 id | 항목 DOM 과 콘텐츠를 유지한다. 위치/크기만 바뀌면 콘텐츠 렌더링/훅은 호출되지 않는다 |
| 추가/제거 | 추가된 항목만 만들고 제거된 항목만 해제(unmount)한다 |
| 렌더링 | 여러 항목을 적용해도 최종 상태로 **한 번만** 렌더링, `layoutChange` 도 한 번 |
| 변경 없음 | 렌더링/이벤트/이력 없이 `changed:false`. 항목 **순서만** 다른 입력도 변경이 아니다 |
| 선택 | 선택된 항목이 남아 있으면 유지, 사라지면 해제 |
| 입력 | 변경하지 않는다(내부에서 복사·정화). 알 수 없는 필드와 잘못된 값은 버리고 좌표를 정수화/컬럼 경계/min·max 로 보정 |
| 항목 대체 | 입력 항목이 해당 항목을 통째로 대체한다(입력에 없는 속성은 제거). 단 `responsive` 는 입력에 **키가 없으면 기존 값을 보존** |
| 대상 | 현재 breakpoint 와 무관하게 **기본 레이아웃** 항목을 대상으로 한다(좌표는 기본 컬럼 기준) |
| 예외 | 배열이 아니거나, id 가 없거나, id 가 중복이면 예외(상태 불변) |
| 기본값 | `source:'sync'`, `history:false`, 이벤트는 `programmaticEvents` 를 따른다. 호출마다 `emit`/`history`/`source` 지정 |
| dirty/reset | 저장 기준(`isDirty`)과 `reset()` 기준은 바꾸지 않는다 |

**배치(`placement`)** — 충돌 정규화와 정확한 복원의 차이

| 값 | 의미 |
| --- | --- |
| `'exact'` | 입력 배치를 **그대로 복원**한다. 정수화/경계/min·max 보정만 하고 충돌 해소·압축은 하지 않는다. 입력에 겹침이 있어도 그대로 두고 `result.overlapping` 으로 알린다 |
| `'resolve'` | 충돌을 해소하고 중력(`float` 이면 놓은 자리 유지) 압축을 적용한다(`load`/`addItem` 과 같은 정규화). 결과가 입력과 다를 수 있고 달라진 항목은 `result.adjusted` 로 알린다 |
| `'auto'` (기본) | 입력에 겹침이 **없으면** `'exact'`, 있으면 `'resolve'` |

유효한 외부 배치(빈 칸이 있어도)는 `'auto'`/`'exact'` 에서 재압축되지 않으므로, "화면이 모델을 고치고 모델이 다시 화면을 고치는" 순환이 생기지 않는다. 빈 칸은 이후 사용자가 항목을 움직일 때 일반 규칙대로 압축된다. 같은 입력을 반복해서 넘겨도 두 번째부터는 아무 일도 일어나지 않는다.

`DriftSyncResult`: `changed`, `added[]`, `removed[]`, `updated[]`(id), `adjusted[]`(입력 배치와 다르게 반영된 항목 복사본), `overlapping`.

### 콘텐츠 수명 (contentLifecycle)

Grid/Chart 처럼 인스턴스와 이벤트를 가진 콘텐츠를 안전하게 연결한다. 라이브러리에는 특정 위젯에 대한 의존성이 없다.

```ts
const instances = new Map();
createDriftEditor(el, {
  contentLifecycle: {
    mount(item, contentEl) {                       // 항목당 최초 1회. contentEl 은 비어 있다
      const chart = new Chart(contentEl, item.props);
      instances.set(item.id, chart);
      return () => instances.delete(item.id);      // (선택) 해제 시 호출되는 정리 함수
    },
    update(item, contentEl, previous) {            // title/content/props 가 바뀐 때만
      instances.get(item.id).setOptions(item.props);
    },
    unmount(item, contentEl) {                     // DOM 을 비우기/지우기 전에 한 번
      instances.get(item.id)?.destroy();
    },
  },
});
```

| 상황 | 호출 |
| --- | --- |
| 항목 생성 (추가, undo/redo 복구, 동기화 추가) | `mount` 한 번 |
| title/content/props 변경 | `update` 한 번 (`update` 가 없으면 `unmount` → 콘텐츠 비우기 → `mount`) |
| 위치/크기/선택/잠금/float/breakpoint 전환/refresh/컨테이너 폭 변경 | **호출 없음** (위젯 DOM 도 그대로) |
| 항목 제거, `clear`, `load` 로 사라지는 항목, 동기화 제거, undo 로 사라짐 | `unmount` (그 뒤 정리 함수) 한 번. 호출 시점에 위젯 DOM 은 아직 남아 있다 |
| `destroy()` | 모든 항목 `unmount` 한 번씩(DOM 을 지우기 전). 두 번 호출해도 중복 해제 없음 |

* 훅에 전달되는 `item` 은 내부 상태와 분리된 복사본이다. 내용 비교에서 `props` 는 참조가 같으면 비교를 건너뛰고, 내용이 같은 새 객체는 변경으로 보지 않는다.
* `mount`/`update`/`unmount` 에서 예외가 나도 나머지 항목은 계속 처리되고, **렌더/해제가 끝난 뒤 첫 예외를 다시 던진다**. `mount` 도중 예외가 나도 `unmount` 는 한 번 호출된다(부분 생성된 자원 정리).
* `contentLifecycle` 을 지정하면 `renderItem` 은 호출되지 않는다. 지정하지 않으면 `renderItem`(생성/내용 변경 시 호출)이 기존처럼 동작한다.
* `load()` 는 같은 id 이고 내용이 같은 항목의 콘텐츠를 유지한다.

### 크기 변경 알림: sizeChange

호스트가 외부 위젯의 `resize()` 를 호출할 수 있도록 **실제로 크기가 바뀐 항목만** 알린다 (Drift 가 위젯의 `resize()` 를 직접 호출하지는 않는다).

```ts
editor.on('sizeChange', (changes) => {
  for (const { id, width, height, contentElement, cause, phase, previous } of changes) widgets.get(id)?.resize();
});
```

`DriftSizeChange`: `id`, `item`(복사본), `element`(카드), `contentElement`(콘텐츠 영역), `width`/`height`(카드의 픽셀 크기), `w`/`h`(셀 크기), `previous`(이전에 알린 크기, 처음이면 `null`), `phase`, `cause`.

| 정책 | 설명 |
| --- | --- |
| 위치 이동 | 이동만 했거나 충돌로 밀려난 항목은 **알리지 않는다** (셀 크기와 픽셀 크기가 모두 같으므로) |
| 셀 크기 변경 (`cause:'layout'`) | 리사이즈, 추가, 동기화, undo, breakpoint 의 w/h 변화 |
| 컨테이너 변화 (`cause:'container'`) | 셀 크기(w/h)는 같지만 컨테이너 폭, 컬럼 수(breakpoint), 간격 변화로 픽셀 크기가 0.5px 넘게 바뀐 항목 (ResizeObserver 로 감지) |
| 처음 알림 | 리스너를 붙이면 현재 항목들을 한 번 알린다(`previous: null`). 새로 추가된 항목도 `previous: null` |
| 프레임 합침 | `requestAnimationFrame` 한 프레임 안의 여러 변경은 **한 번의 이벤트**로 합친다. 마지막으로 알린 크기와 최종 크기를 비교하므로 원래 크기로 돌아오면 알리지 않는다 |
| 사용자 리사이즈 도중 | `sizeNotify:'end'`(기본): 알리지 않고, 확정되면 `phase:'end'` 로 한 번. `'live'`: 크기가 바뀌는 항목을 프레임마다 `phase:'live'`(포인터를 따라가는 실제 픽셀 크기)로 알리고, 종료 후 확정 크기를 `phase:'end'` 로 알린다. 취소(Esc)하면 원래 크기를 `'end'` 로 알린다 |
| 정리 | 리스너가 없으면 프레임을 예약하지 않는다. 항목 제거 시 보류 중인 알림에서 제외되고, `destroy()` 는 예약된 프레임을 취소해 이후 콜백이 실행되지 않는다. `requestAnimationFrame` 이 없는 환경은 타이머로 대체한다 |

크기 알림은 크기·위치를 DOM 에서 읽지 않고 메트릭(컨테이너 폭, 컬럼, 간격)으로 계산하므로 강제 레이아웃을 유발하지 않는다.

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
| `options.autoAdd` | 기본 `true`: 드롭 시 내부 `addItem()` 으로 추가. `false`: 내부 레이아웃/선택/undo 이력/dirty 를 바꾸지 않고 `add`/`layoutChange` 도 발생시키지 않으며 드롭 결과만 `onDrop` 으로 전달 (외부 모델이 상태를 관리하는 환경용) |
| `options.onDrop(result)` | 캔버스에 정상 드롭했을 때 **한 번** 호출 (캔버스 밖 드롭, Esc, pointercancel, 클릭 수준의 이동에서는 호출 안 됨) |
| `options.item` | 추가할 항목 정의(객체) 또는 원본 요소로부터 만드는 함수. 생략하면 원본의 `data-w`/`data-h`(기본 3x2), `data-id`, `data-title`, `data-content`(없으면 텍스트)를 사용 |
| id | 지정하지 않거나 이미 있으면 `item-1`, `item-2` … 처럼 고유하게 만든다 |

- 마우스/터치/펜을 Pointer Events 로 처리한다. 원본은 그대로 남고 복제본(`ddr-dragin-ghost`, body 에 부착)이 포인터를 따라간다. 3px 미만 이동은 클릭으로 취급한다.
- 포인터가 캔버스 위에 있으면 항목의 가운데가 포인터에 오도록 칸을 계산해 placeholder 와, 기존 항목이 비켜가는 미리보기를 보여준다(캔버스에는 `ddr-dragin-over`). 모델은 drop 시 `addItem()` 한 번만 호출되어 `add`/`layoutChange(reason:'add')` 가 한 번 발생하고 undo 한 번으로 되돌아간다.
- 캔버스 밖에서 놓기, `Esc`, `pointercancel` 은 추가하지 않고(`dragInEnd(null)`, `onDrop` 미호출) 밀렸던 항목을 원위치로 되돌린다.
- `float`, min/max, 컬럼 경계는 일반 추가와 같은 규칙을 따른다. breakpoint 를 편집 중이면 그 breakpoint 의 칸에 놓이고(`responsive[name]`), 기본 레이아웃에는 겹치지 않는 자동 위치로 추가된다.

### onDrop 과 autoAdd:false (외부 모델 연동)

```ts
// 외부 모델(예: ReportStudio)이 상태를 관리한다: Drift 는 드롭 정보만 전달한다
editor.setupDragIn('.palette .card', {
  autoAdd: false,
  onDrop: ({ source, item, breakpoint, columns }) => {
    const id = store.addComponent({ type: source.dataset.type, ...item }); // 호출자의 모델 갱신
    editor.addItem({ ...item, id });  // 필요하면 동기적으로 화면에 반영해도 된다 (정리가 이미 끝난 뒤라 안전)
  },
});
```

`DriftDragInDropResult`

| 필드 | 설명 |
| --- | --- |
| `source` | 끌어 온 원본 `HTMLElement` |
| `item` | `DriftDragInItem` 형식(id 는 선택). **x, y, w, h 는 미리보기에서 계산된 최종 값**(충돌 재배치, `float`, min/max, 컬럼 경계 반영)이다. `item` 옵션/`data-*` 에서 온 `title`, `content`, `props`, min/max 등도 포함한다. **내부 상태·옵션 객체와 분리된 깊은 복사본**이라 자유롭게 수정해도 된다 |
| `breakpoint` | x, y, w, h 의 기준이 된 breakpoint 이름. 기본 레이아웃이면 `null` |
| `columns` | 위 좌표 기준의 컬럼 수 (breakpoint 편집 중이면 그 breakpoint 의 컬럼 수) |

동작 규칙

- 호출 순서: **정리(ghost/placeholder 제거, 미리보기로 밀렸던 항목 복원) → `onDrop` → `dragInEnd`**. 정리가 콜백보다 먼저 끝나므로 `onDrop` 안에서 동기적으로 `editor.addItem()` 을 호출해도 그 결과를 이후 코드가 덮어쓰지 않는다. 콜백이 예외를 던져도 정리와 `dragInEnd` 는 보장된다(예외는 그대로 전파).
- `autoAdd:false` 에서는 `onDrop` 에 `id` 를 자동으로 만들어 넣지 않는다(옵션/`data-id` 가 있을 때만 포함). 호출자가 자기 모델의 id 를 정한다.
- **`dragInEnd` 의 의미**: 내부에 추가된 항목이 있을 때만 그 항목을 전달한다. `autoAdd:false` 에서는 추가된 항목이 없으므로 정상 드롭에서도 `null` 이며, 정상 드롭은 `onDrop` 으로 구분한다(취소/캔버스 밖도 `null`).
- `autoAdd`(기본 `true`)에서 `onDrop` 을 함께 주면 내부 추가가 끝난 뒤 호출되며 `item.id` 는 실제 추가된 id, 좌표는 추가된 항목의 값이다. `add` → ... 순서와 이벤트는 기존과 같다(`layoutChange` → `add` → `onDrop` → `dragInEnd`).
- breakpoint 를 편집 중이면 좌표는 그 breakpoint 칸 기준이다. 호출자가 그대로 `editor.addItem({ ...item, id })` 하면 해당 breakpoint 의 `responsive[name]` 에 위치·크기가 저장되고(`addItem` 은 이 경우 x, y, w, h 를 모두 breakpoint 기준으로 해석한다), 기본 레이아웃에는 겹치지 않는 자동 위치로 추가된다.
- 등록 해제(반환된 함수)와 `destroy()` 는 진행 중인 드래그까지 `onDrop` 없이 정리한다(ghost, 리스너, 원본의 `ddr-dragin-source` 클래스).

## 항목 옵션: locked / resizable

| 필드 | 기본 | 설명 |
| --- | --- | --- |
| `locked` | false | 위치 고정. 드래그/리사이즈/키보드 이동 불가, 다른 항목이 비켜가며 locked 와 겹치는 이동은 거부 |
| `resizable` | true | false 이면 크기 조절만 막는다(이동 가능). 리사이즈 핸들이 숨겨지고 `resizeItem` 이 거부. `locked` 이면 무시 |

프로그램에서는 `editor.updateItem(id, { locked: true })` 처럼 런타임에 바꿀 수 있다. 에디터 전체 옵션 `draggable`/`resizable` 과 함께 적용되며 둘 다 true 여야 조작된다.
