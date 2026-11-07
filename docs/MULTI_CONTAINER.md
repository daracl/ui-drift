# 여러 컨테이너 (DriftManager)

하나의 페이지에 **독립된 DriftEditor 여러 개**(예: 보고서의 header / body / footer 영역)를 두고 하나의 관리자로 다룬다.
한 캔버스 안의 다중 선택 기능이 아니다.

```text
DriftManager
 ├── 등록(Map, 등록 순서 유지) ── Container A ─ DriftEditor A (항목·이력·선택·breakpoint·콘텐츠 수명)
 │                              ├ Container B ─ DriftEditor B
 │                              └ Container C ─ DriftEditor C
 ├── 활성 컨테이너 (pointerdown/focusin/드롭으로 갱신)
 ├── 공통 끌어오기 (DragInController 하나, 대상 = 등록된 에디터들)
 ├── 이벤트 집계 (containerId 를 붙여 전달)
 └── 저장/복원 ({ version, containers: [{ id, layout }] })
```

- 각 에디터는 단일 에디터와 **완전히 같다**. Manager 를 쓰지 않는 기존 코드(`createDriftEditor`)는 그대로 동작한다.
- 컨테이너 사이의 항목 이동은 §10(옵션 `crossContainerDrag`, API `transferItem`). 중첩 그리드(nested grid)는 지원하지 않는다.

## 1. 기본 사용

```ts
import { createDriftManager } from '@daracl/drift';
import '@daracl/drift/dist/daracl.drift.css';

const manager = createDriftManager();

manager.register('header', '#header', { columns: 12 });
manager.register('body', document.getElementById('body') as HTMLElement, { columns: 6 });
manager.register('footer', '#footer', { columns: 12, removable: true });

manager.get('body')?.addItem({ id: 'chart-1', w: 3, h: 2 });

const json = manager.toJSON();
manager.fromJSON(json);

manager.destroy();
```

## 2. 등록과 해제

| 규칙 | 동작 |
| --- | --- |
| id | 비어 있지 않은 문자열. 같은 Manager 안에서 유일 (아니면 예외). 항목 id 와는 별개라 컨테이너마다 같은 항목 id 를 써도 된다 |
| 요소 | `HTMLElement` 또는 CSS selector(`createDriftEditor` 와 같은 `document.querySelector`). 찾지 못하면 예외 |
| 같은 요소 | 이미 에디터가 있는 요소(다른 Manager, `createDriftEditor` 포함)는 예외 |
| 옵션 | 에디터마다 독립 (`columns`, `breakpoints`, `history`, `contentLifecycle` …) |
| 생성 실패 | 초기 렌더링(콘텐츠 훅 등)에서 예외가 나면 만든 DOM/리스너를 해제하고 등록하지 않은 채 예외를 다시 던진다 |
| 소유권 | Manager 가 만든 에디터는 Manager 가 소유한다. `unregister()` 와 `destroy()` 가 에디터를 destroy 한다. 컨테이너 요소는 지우지 않는다 |
| 직접 destroy | `manager.get(id).destroy()` 도 안전하다. 에디터의 `destroy` 이벤트로 등록이 자동 해제된다 |
| 반복 호출 | `unregister()` 두 번(두 번째는 false), `destroy()` 두 번 모두 안전. destroy 이후 `register()`/`setupDragIn()` 은 예외, 나머지는 무시된다 |

```ts
import { createDriftManager } from '@daracl/drift';

const manager = createDriftManager();
const panel = document.createElement('section');
document.body.appendChild(panel);

const editor = manager.register('panel-1', panel, { columns: 8, breakpoints: [] });
editor.addItem({ id: 'note', w: 4, h: 2, content: 'Note' });

manager.unregister('panel-1'); // 에디터 destroy, panel 요소는 남는다
panel.remove(); // 요소는 호출자가 정리한다
```

## 3. 활성 컨테이너

```ts
import { createDriftManager } from '@daracl/drift';

const manager = createDriftManager();
manager.register('a', '#a');
manager.register('b', '#b');

manager.on('activeChange', ({ containerId, previousId }) => {
  document.querySelectorAll('[data-active]').forEach((el) => el.removeAttribute('data-active'));
  if (containerId) document.getElementById(containerId)?.setAttribute('data-active', '');
  console.log(previousId, '→', containerId);
});

manager.setActive('b');
// 툴바의 undo 버튼은 활성 에디터에만 적용한다
document.querySelector('#undo')?.addEventListener('click', () => manager.getActiveEditor()?.undo());
```

- 컨테이너 안을 누르거나(`pointerdown`, capture) 포커스가 들어오거나(`focusin`), 공통 팔레트로 드롭하면 그 컨테이너가 활성이 된다.
- 활성 컨테이너를 해제하면 활성 대상은 `null` 이 된다. 처음에는 활성 대상이 없다.
- 키보드 처리(방향키/Delete)는 원래부터 **포커스된 항목의 캔버스**에서만 동작하므로 여러 에디터가 같은 키를 중복 처리하지 않는다. 항목 안의 `input`/`textarea` 같은 입력 요소의 키는 처리하지 않는다. 진행 중 세션의 `Esc` 취소는 세션을 가진 에디터에만 영향을 준다.
- Manager 는 전역 키보드 단축키를 등록하지 않는다. `Ctrl+Z` 같은 단축키는 호스트가 `getActiveEditor()` 로 연결한다.

## 4. 공통 팔레트 끌어오기

```ts
import { createDriftManager } from '@daracl/drift';

const manager = createDriftManager();
manager.register('header', '#header', { columns: 12 });
manager.register('body', '#body', { columns: 6 });

const dispose = manager.setupDragIn('.component-palette .item', {
  item: (el) => ({ w: 4, h: 3, title: el.dataset.title }),
});

manager.on('dragInEnd', ({ containerId, item }) => {
  if (item) console.log(`${containerId} 에 ${item.id} 추가`);
});

dispose(); // 해제 (manager.destroy() 에서도 자동 해제)
```

- 팔레트의 포인터 입력은 **컨트롤러 하나**가 처리한다. 포인터 아래의 컨테이너 하나만 미리보기(placeholder, 밀려나는 항목, `ddr-dragin-over`)하고, 다른 컨테이너로 옮겨 가면 이전 컨테이너의 미리보기를 걷어낸다.
- 컨테이너가 화면에서 겹치면 실제로 포인터 아래에 그려진 쪽을 고른다.
- 칸 계산, 충돌 재배치, `float`, min/max 는 **대상 에디터의 설정**(컬럼 수, 행 높이, 간격, 편집 중인 breakpoint)을 따른다.
- 드래그 중에는 모델이 바뀌지 않는다. drop 시 대상 에디터의 `addItem()` 이 한 번 호출되므로 `add`/`layoutChange(reason:'add', source:'user')` 가 한 번 발생하고 undo 한 번으로 되돌아간다.
- 컨테이너 밖 drop, `Esc`, `pointercancel` 은 아무것도 추가하지 않는다 (`dragInEnd` 의 `containerId`/`item` 이 null).
- 끄는 도중 대상 컨테이너를 해제하면 그 미리보기를 걷어내고, 그 컨테이너에는 추가하지 않는다. Manager 를 destroy 하면 ghost/placeholder/리스너가 모두 정리된다.
- 나중에 `register()` 한 컨테이너도 바로 대상이 된다.
- 기존 `editor.setupDragIn()` 은 그대로 동작한다. 같은 원본을 Manager 와 에디터 양쪽에 등록하면 한 번의 끌기를 둘 다 처리하므로 한쪽에만 등록한다.

### 외부 모델 연동: autoAdd:false

```ts
import { createDriftManager } from '@daracl/drift';

const manager = createDriftManager();
manager.register('body', '#body', { history: false });

let seq = 0;
manager.setupDragIn('.palette .item', {
  autoAdd: false,
  onDrop: ({ containerId, editor, item, breakpoint }) => {
    // 콜백 시점에 ghost/placeholder 는 이미 정리되어 있으므로 여기서 동기적으로 추가해도 결과가 유지된다
    const id = `${containerId}-${++seq}`;
    editor.addItem({ ...item, id }, { source: 'user' });
    console.log('breakpoint', breakpoint);
  },
});
```

`onDrop` 결과는 에디터의 `setupDragIn` 결과(`source`, `item`, `breakpoint`, `columns`)에 `containerId`, `editor` 가 더해진 깊은 복사본이다. `autoAdd:false` 에서 `dragInEnd` 는 `{ containerId, item: null }` 이다.

## 5. 이벤트

```ts
import { createDriftManager } from '@daracl/drift';

const manager = createDriftManager();
manager.register('header', '#header');

const off = manager.on('layoutChange', ({ containerId, layout, info }) => {
  if (info.source === 'sync') return; // 동기화로 생긴 변경은 무시하는 식으로 구분할 수 있다
  localStorage.setItem(`layout:${containerId}`, JSON.stringify(layout));
});
manager.on('containerRegistered', ({ containerId }) => console.log('+', containerId));
manager.on('containerUnregistered', ({ containerId }) => console.log('-', containerId));

off();
```

| 정책 | 내용 |
| --- | --- |
| 데이터 | `layoutChange` 의 `layout`/`info` 는 에디터 `layoutChange` 의 인자 그대로다(`reason`/`source`/`changes` 의미 동일, 복사본) |
| 중복 | 에디터 변경 1회 → Manager `layoutChange` 1회. 에디터 자체의 이벤트는 변형·누락 없이 그대로 발생한다 |
| 비용 | Manager 에 `layoutChange` 리스너가 없으면 에디터를 구독하지 않는다(변경 정보 계산 생략) |
| 프로그램 변경 | 에디터의 `programmaticEvents`/호출별 `{ emit }` 정책을 그대로 따른다 |
| 순서 | 등록: `containerRegistered`. 해제: 활성이었다면 `activeChange(null)` → 에디터 destroy → `containerUnregistered` |
| 재진입 | 콜백 안에서 `unregister()` 나 에디터 API 를 호출해도 된다. 해제된 컨테이너의 늦은 이벤트는 전달하지 않는다 |
| destroy | 해제 과정의 이벤트를 낸 뒤 모든 리스너를 제거한다 |

`select`, `sizeChange`, `breakpointChange` 같은 나머지 이벤트는 `manager.get(id)?.on(...)` 으로 에디터에서 직접 받는다.

## 6. 저장과 복원

```json
{
  "version": 1,
  "containers": [
    { "id": "header", "layout": { "version": 1, "columns": 12, "rowHeight": 40, "gap": 8, "items": [] } },
    { "id": "body", "layout": { "version": 1, "columns": 6, "rowHeight": 40, "gap": 8, "items": [] } }
  ]
}
```

- `layout` 은 단일 에디터의 `DriftLayout` 과 **같다**(필드 손실 없음). 컨테이너 순서는 등록 순서다.
- `getLayouts()` 는 복사본이므로 수정해도 에디터에 영향이 없다.
- `fromJSON(json | data, options)` 의 정책
  1. 전체를 파싱·검증한다(`parseContainerData`): 손상된 JSON, 지원하지 않는 version, `containers` 구조, 빈/중복 컨테이너 id, 각 `layout` 구조(`parseLayout`). 오류면 **아무것도 바꾸지 않고** 예외.
  2. 등록되지 않은 컨테이너가 있으면 기본(`unknown:'error'`)은 예외, `unknown:'ignore'` 는 그 컨테이너만 건너뛴다. 컨테이너를 **자동으로 만들지 않는다**(DOM 은 데이터만으로 알 수 없다). 먼저 `register()` 한 뒤 복원한다.
  3. 데이터에 있는 컨테이너만 에디터 `load()` 로 통째로 교체한다(부분 갱신). 각 에디터의 이력과 저장 기준(`isDirty`)은 `load()` 와 같이 초기화된다. 이벤트는 컨테이너마다 `layoutChange(reason:'load')` 한 번(옵션 `{ emit, source }` 로 제어).
  4. 적용 도중 예외(콘텐츠 훅 등)가 나면 이미 적용한 컨테이너를 이전 레이아웃으로 되돌리고(이벤트 없이) 예외를 다시 던진다. 이때 되돌린 에디터의 undo 이력은 비어 있다(완전한 원자성의 한계).
- 반환값은 복원한 컨테이너 id 목록이다.

```ts
import { createDriftManager, parseContainerData } from '@daracl/drift';

const manager = createDriftManager();
const saved = localStorage.getItem('report');
if (saved) {
  const data = parseContainerData(saved); // 검증만 먼저 할 수도 있다
  // 저장된 컨테이너를 모두 등록한 뒤 복원한다 (자동 생성은 하지 않는다)
  for (const { id } of data.containers) {
    const el = document.createElement('section');
    el.id = id;
    document.body.appendChild(el);
    manager.register(id, el);
  }
  manager.fromJSON(data);
}
```

## 7. Viewer 와의 관계

Viewer 는 Manager 와 무관하다(JavaScript/DOM 없음). 저장 데이터의 각 `layout` 을 `renderViewer` 로 따로 렌더링하고,
**컨테이너마다 다른 `scope`** 를 준다(같은 scope 면 `grid-template-columns` 같은 규칙이 서로 덮어쓴다).
`parseContainerData` 는 core 함수라 `@daracl/drift/viewer`, `@daracl/drift/core` 에서도 쓸 수 있다.

```ts
import { parseContainerData, renderViewer } from '@daracl/drift/viewer';

declare const json: string; // manager.toJSON() 으로 저장한 데이터

const data = parseContainerData(json);
const parts = data.containers.map(({ id, layout }) => {
  const scope = `rpt-${id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`; // scope 는 ^[a-z][a-z0-9-]*$
  return renderViewer(layout, { scope });
});
const html = parts.map((p) => p.html).join('\n');
const css = parts.map((p) => p.css).join('\n');
```

## 8. Report Studio 연동 예

외부 모델(Report Studio)이 상태와 undo 를 관리하고, Drift 는 화면 편집만 맡는 구성.

```ts
import { createDriftManager, DriftItem } from '@daracl/drift';

interface Section {
  id: string;
  columns: number;
  items: DriftItem[];
}
interface Studio {
  sections: Section[];
  update(sectionId: string, items: DriftItem[]): void;
  add(sectionId: string, item: DriftItem): void;
  subscribe(fn: (sectionId: string) => void): void;
  get(sectionId: string): Section;
}
declare const studio: Studio;

const manager = createDriftManager();
for (const section of studio.sections) {
  const el = document.querySelector<HTMLElement>(`[data-section="${section.id}"]`);
  if (!el) continue;
  manager.register(section.id, el, {
    layout: { columns: section.columns, items: section.items },
    history: false, // undo 는 Studio 가 관리
    keyboard: true,
  });
}

// 사용자의 편집 → Studio 모델
manager.on('layoutChange', ({ containerId, layout, info }) => {
  if (info.source === 'user') studio.update(containerId, layout.items);
});

// 팔레트 드롭 → Studio 가 id 를 정하고 추가한 뒤, 모델 변경 알림으로 화면이 맞춰진다
manager.setupDragIn('.studio-palette [data-component]', {
  autoAdd: false,
  item: (el) => ({ w: Number(el.dataset.w) || 4, h: Number(el.dataset.h) || 3, title: el.dataset.component }),
  onDrop: ({ containerId, item }) => studio.add(containerId, { ...item, id: `cmp-${Date.now()}` }),
});

// Studio 모델(undo/redo 포함) → 화면. 같은 배치면 아무 일도 없다 (순환 없음)
studio.subscribe((sectionId) => {
  manager.get(sectionId)?.syncItems(studio.get(sectionId).items);
});
```

## 10. 컨테이너 간 이동

같은 Manager 에 등록된 컨테이너 사이에서 기존 항목을 옮긴다(예: body 의 Chart 를 footer 로). 원본에서 사라지고 대상에 한 개만 남는다.
복제, 다중 선택 이동, 다른 Manager 사이의 이동은 지원하지 않는다.

```ts
import { createDriftManager } from '@daracl/drift';

// 포인터(마우스·터치) 이동은 기본 꺼짐. 켜야만 다른 컨테이너로 끌어 놓을 수 있다
const manager = createDriftManager({ crossContainerDrag: true });
manager.register('body', '#body', { columns: 6 });
manager.register('footer', '#footer', { columns: 24, float: true });

// API 이동은 옵션과 무관하게 가능하다
const result = manager.transferItem({ from: 'body', to: 'footer', itemId: 'chart', x: 4, y: 0 });
if (result.moved) console.log(result.transactionId, result.item.w);
else console.log('거절:', result.reason); // 'id-conflict' | 'locked' | 'invalid-size' | 'blocked' | ...

manager.get('footer')?.undo(); // 어느 쪽 undo 든 두 컨테이너를 함께 되돌린다
manager.setCrossContainerDrag(false);
```

### 규칙

| 항목 | 동작 |
| --- | --- |
| 좌표 | x/y 를 둘 다 생략하면 대상의 자동 배치, 둘 다 주면 **대상의 현재 편집 breakpoint 셀**. 하나만 주거나 NaN/Infinity 면 `[drift]` 예외 |
| 같은 컨테이너 | `same-container` 거절. 같은 컨테이너 안에서는 `editor.moveItem()` (포인터는 기존 드래그 그대로) |
| 크기 | 원본에서 **보이던 셀 수(w/h)** 를 시작값으로 대상 열 수·min/max 로 정규화한다(픽셀 비율이 아님). 대상 열 수보다 큰 `minW`, `maxW < minW` 같이 만족할 수 없으면 `invalid-size` (minW 를 낮추지 않는다) |
| 잠금 | `isMovable()` 이 false(locked)면 `locked`. `resizable` 은 그대로 따라간다. 지정 위치가 대상의 locked 와 겹치면 `blocked` |
| id | 기본은 원래 id. 대상에 같은 id 가 있으면 `id-conflict`. API 는 `newId` 로 바꿀 수 있다(빈 문자열은 예외). 포인터 이동은 자동으로 이름을 바꾸지 않고 거절한다 |
| 데이터 | id, title, content, props, min/max, locked, resizable 등은 깊은 복사로 보존된다. **원본의 `responsive` 값은 복사하지 않는다**(컨테이너마다 breakpoint 의미가 다르다). 대상에서는 새로 추가된 항목처럼 배치된다 |
| breakpoint | 원본이 breakpoint 편집 중이어도 항목은 전체 레이아웃에서 빠진다(다른 breakpoint 에 유령 항목이 남지 않음). 대상이 breakpoint 편집 중이고 좌표를 주면 기본 레이아웃에는 자동 위치로, 그 breakpoint 에는 지정 위치로 저장된다(`addItem` 과 같다) |
| 배치 정책 | 원본은 항목을 뺀 뒤 원본의 압축/float 정책, 대상은 대상의 충돌·압축/float 정책을 그대로 쓴다 |
| 저장 | 저장 포맷(`DriftContainerData` version 1)은 그대로이며 두 layout 에 결과가 반영된다 |

### 원자성과 이벤트

1. 두 레이아웃을 core `planTransfer()` 로 먼저 계산·검증한다(거절이면 아무것도 바뀌지 않음: 모델·선택·이력·이벤트 없음).
2. 두 에디터에 준비된 모델을 반영하고 렌더한다. 콘텐츠 훅(mount 등)이 실패하면 **두 에디터의 모델·선택·이력을 이전 상태로 되돌리고** 원래 예외를 던진다(`load()` 로 되돌리지 않으므로 기존 undo 이력이 남는다). 콘텐츠의 외부 부수효과까지 되돌린다고 보장하지는 않는다.
3. 이력을 기록한다(아래 "Undo/Redo").
4. 알린다: 원본 `layoutChange(reason:'remove')`·`remove` → 대상 `layoutChange(reason:'add')`·`add` → 대상 활성·항목 선택(포커스, 스크롤 없이) → Manager `itemTransfer`. 두 `layoutChange` 의 `info.transactionId` 가 같다. 첫 콜백에서도 양쪽 최종 모델을 조회할 수 있다.
   알림 콜백의 예외는 완료된 이동을 되돌리지 않으며 나머지 알림을 마친 뒤 첫 예외를 던진다.
5. 처리 중(계산·반영·알림)의 재진입 `transferItem()` 은 `busy`. 콜백 안의 `unregister()`/`destroy()` 는 처리되며 해제된 에디터는 다시 렌더·활성화되지 않는다.

포인터 이동은 `source:'user'`, API 는 기본 `source:'api'` 이다. `programmaticEvents` 와 "리스너가 있을 때만 데이터를 만든다"는 기존 정책을 따르며, API 이동의 `itemTransfer` 는 두 에디터 중 하나라도 `programmaticEvents:false` 면 억제된다.
콘텐츠 수명: 미리보기 중에는 mount/update/unmount 를 호출하지 않고, 성공하면 원본 unmount → 대상 mount 가 한 번씩 호출된다. 이동 후 `sizeChange` 는 대상 메트릭으로 계산된다.

### Undo / Redo

- 두 에디터의 이력에 같은 `transactionId` 의 **연결 기록**을 남긴다. 어느 쪽 `undo()`/`redo()` 든 양쪽을 한 번에 처리하고(각각 `layoutChange(reason:'undo'|'redo', transactionId)`), `itemTransfer(action:'undo'|'redo')` 가 한 번 발생한다. undo 는 원본으로 돌아간 항목을, redo 는 대상의 항목을 활성·선택한다.
- 연결 기록이 **양쪽 스택의 맨 위일 때만** 실행된다. 상대 컨테이너에 그 뒤의 로컬 편집이 있으면 `canUndo()`/`undo()` 는 false 이고, 그 편집을 먼저 되돌리면 다시 가능하다.
- undo 후 어느 한쪽의 새 편집이 redo 를 지우면 상대의 연결 redo 도 무효화된다.
- 어느 한쪽이 `history:false` 면 이동은 하지만 **두 컨테이너의 이전 이력을 모두 비우고** 이동 이력을 만들지 않는다(오래된 스냅샷 undo 로 항목이 복제되지 않게 하는 보수적 정책).
- `load()`/`fromJSON()`/이력 제한 초과/`unregister()`/`destroy()` 로 한쪽 기록이 사라지면, 상대 쪽 스택을 그 연결 기록까지(undo 쪽은 그보다 오래된 이력, redo 쪽은 그보다 먼 이력 포함) **절단**한다. 이동을 가로질러 이전 스냅샷을 복원하면 항목이 복제·소실되기 때문이다. 해제된 컨테이너를 다시 만들지는 않는다.

### 포인터 세션

- 기존 드래그(같은 핸들/`dragMode` 정책, 터치는 핸들에서만 시작)로 시작한다. 크기 조절 중에는 이동으로 바뀌지 않는다.
- 포인터가 **다른 컨테이너의 보이는 캔버스** 위로 가면 이동 모드가 된다: 복제본(`ddr-transfer-ghost`) 하나가 포인터를 따라가고, 원본 항목은 원위치에 흐리게(`ddr-transfer-source`) 남으며, 대상에는 placeholder 하나와 비켜가는 미리보기가 보인다. 놓을 수 없으면(id 충돌·잠금·크기·막힘) placeholder 가 무효 표시(`ddr-placeholder-invalid`)된다. 원본 위로 돌아오면 일반 드래그로 돌아간다.
- 대상 판정은 외부 끌어오기와 같다(겹친 캔버스는 실제로 그려진 쪽, 스크롤로 잘린 부분·연결 해제·destroy 된 캔버스 제외). 같은 셀이면 다시 계산하지 않고, 원본과 현재 대상 외의 에디터는 렌더하지 않는다.
- 세션 동안 원본과 현재 대상의 **캔버스 높이를 고정**한다. 미리보기로 캔버스가 늘어 아래 컨테이너가 포인터를 피해 밀려나지 않게 하기 위해서이며, 그동안 밀려난 항목은 캔버스 아래로 넘쳐 보일 수 있다.
- 모든 캔버스 밖에서 놓으면 원래 상태로 취소된다(삭제하거나 가장 가까운 대상을 고르지 않음). `Esc`(keyboard:false 여도)·`pointercancel`·옵션 해제(`disabled`)·원본/대상 해제·Manager destroy 는 정리 후 취소한다. 원본/대상의 모델이나 breakpoint 가 바뀌면 `stale` 로 취소한다.
- 놓은 이동이 거절되거나 세션이 `stale`/`disabled` 로 취소되면 Manager `transferReject` 가 발생한다.
- 원본 에디터의 `dragStart`/`dragEnd` 는 한 쌍만 발생한다. 놓았을 때(`pointerup`) `dragEnd` 의 항목은 이동했으면 대상의 항목, 아니면 원래 항목이다. `Esc`/`pointercancel`/`stale`/`disabled` 취소는 기존처럼 `dragEnd` 를 내지 않는다. 외부 팔레트용 `dragInStart`/`dragInEnd` 는 쓰지 않는다.
- 새 document 리스너를 추가하지 않는다(원본 캔버스의 Pointer 리스너와 포인터 캡처를 그대로 쓴다).

## 9. 오류 처리와 주의사항

- 예외 메시지는 `[drift] ...` 형식이다. 등록(빈/중복 id, 없는 요소, 이미 사용 중인 요소), `setActive` 의 미등록 id, `fromJSON` 의 데이터/미등록 컨테이너 오류가 예외다.
- 컨테이너 id 는 DOM/CSS 에 쓰이지 않는다(맵의 키). Viewer `scope` 로 쓸 때는 직접 `^[a-z][a-z0-9-]*$` 형태로 바꾼다.
- Manager 는 `document` 에 전역 리스너를 두지 않는다. 공통 팔레트가 등록되어 있거나 끌기가 진행 중일 때만 끌어오기용 리스너가 붙는다(에디터 개별 `setupDragIn` 도 같은 방식). 에디터 하나마다 남는 document 리스너는 진행 중 세션 `Esc` 취소용 `keydown` 하나다.
- 각 에디터는 자기 `ResizeObserver` 를 가진다. 위치 스타일시트는 설정(컬럼 수, gap, rowHeight, 행 범위)이 같은 에디터끼리 하나를 공유하고 마지막 사용자가 해제될 때 제거된다. 측정 결과는 [performance.md §7](performance.md).
- 콘텐츠 훅(`contentLifecycle`)의 예외는 해당 에디터의 규칙대로 렌더/해제가 끝난 뒤 다시 던져진다. `manager.destroy()` 는 나머지 컨테이너를 모두 해제한 뒤 첫 예외를 던진다.
- 같은 요소를 다시 쓰려면 먼저 `unregister()`(또는 에디터 `destroy()`)한다.
- 이벤트 리스너가 예외를 던져도 해제는 끝까지 진행된다. `unregister()`/`destroy()`(Manager, 에디터 모두)는 모든 정리 단계(공통 끌기 미리보기, 활성 해제, 에디터 destroy, `containerUnregistered`)를 마친 뒤 첫 예외를 다시 던진다. 드롭 시 `activeChange` 리스너가 실패해도 `dragInEnd` 는 발생한다.
- `dragInStart` 리스너 안에서 `cancelDragIn()` 을 호출하면 그 끌기는 즉시 끝나며 미리보기가 다시 생기지 않는다.
