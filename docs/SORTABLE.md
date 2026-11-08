# Sortable

SortableJS 와 같은 용도의 정렬(Drag & Drop) 모듈. Drift 와 독립적이며 `@daracl/drift/sortable` 로 사용한다.
Pointer Events 하나로 마우스/터치/펜을 처리하고, 목록 안 정렬·목록 간 이동·복제를 지원한다.

```ts
import { createSortable } from '@daracl/drift/sortable';
import '@daracl/drift/style/daracl.sortable.scss'; // 또는 dist/daracl.sortable.min.css

const sortable = createSortable('#list', {
  handle: '.grip',
  group: 'tasks',
  onUpdate: (evt) => console.log(evt.oldIndex, '→', evt.newIndex),
});
sortable.destroy();
```

브라우저 `<script>` 로는 `dist/daracl.sortable.umd.js` 를 불러 `Daracl.sortable.createSortable` 을 쓴다.

## 동작 방식

- 잡은 항목은 목록 안에서 **자리 표시자**(`ghostClass`)로 남아 이동하고, 포인터를 따라다니는 것은 **복제본**(`dragClass`, `document.body` 하위 fixed)이다.
- 이동 판정은 포인터 아래 항목의 `swapThreshold` 지점을 넘었는지로 한다(기본 0.5, 중앙). 이동하는 방향으로만 판정하므로 크기가 다른 항목 사이에서도 떨리지 않는다.
- 배치 방향은 `direction: 'auto'` 가 목록의 flex/grid, 항목의 float/inline 여부로 판단한다. flex-wrap·grid 같은 여러 줄 배치도 처리한다.
- 항목 이동은 FLIP 애니메이션(`animation` ms)으로 부드럽게 보인다.
- 가장자리 자동 스크롤은 가로·세로, 중첩 스크롤 영역, window 를 모두 지원한다(`src/dom/autoScroll.ts`).

## 옵션

| 옵션 | 기본 | 설명 |
|---|---|---|
| `group` | - | 문자열(그룹 이름) 또는 `{ name, pull, put }`. 이름이 같으면 서로 이동한다 |
| `sort` | `true` | `false` 면 목록 안 순서를 바꿀 수 없다(다른 목록에서 들어오는 항목은 맨 뒤에 받는다) |
| `disabled` | `false` | |
| `handle` | - | 드래그를 시작할 수 있는 영역 selector |
| `draggable` | 모든 자식 | 정렬 대상 selector (목록의 직계 자식만) |
| `filter` | - | 일치하면 드래그를 시작하지 않는다. `input/textarea/select/[contenteditable]/[data-sortable-no-drag]` 는 항상 제외 |
| `direction` | `'auto'` | `'vertical' \| 'horizontal'` 로 고정할 수 있다 |
| `animation` / `easing` | `150` / `cubic-bezier(0.2,0.8,0.2,1)` | 0 이면 애니메이션 없음 |
| `delay` / `delayOnTouchOnly` | `0` / `false` | 누르고 있어야 시작되는 시간(ms). 그 전에 움직이면 스크롤에 맡긴다 |
| `distance` | `3` | 드래그로 인정하는 이동 거리(px) |
| `swapThreshold` | `0.5` | 0~1. 클수록 일찍 자리를 바꾼다(1 에 가까우면 크기가 다른 항목에서 떨릴 수 있다) |
| `ghostClass` / `chosenClass` / `dragClass` | `dsr-ghost` / `dsr-chosen` / `dsr-drag` | |
| `containment` | `false` | 포인터를 따라다니는 복제본이 움직일 수 있는 범위. `true`(이 목록) · `'parent'`(부모 요소) · selector(`closest`) · `HTMLElement`. 아래 설명 참고 |
| `mirror` | `'clone'` | 포인터를 따라다니는 복제본을 만드는 방식. `'clone'`(가볍게 정리한 깊은 복사) · `'box'`(내용 없이 껍데기만) · `(item) => HTMLElement`(직접 만든 미리보기). 아래 [성능](#성능) 참고 |
| `appendTo` | `document.body` | 복제본을 붙일 요소. 복제본은 원래 목록과 같은 태그/클래스의 빈 홀더 안에 들어가므로 `.list > li` 같은 부모 의존 스타일은 그대로 적용된다 |
| `scroll` / `scrollSensitivity` / `scrollSpeed` | `true` / `30` / `360` | 가장자리 자동 스크롤. `scrollSpeed` 는 가장자리에 완전히 붙었을 때의 최대 속도(px/초)이며 화면 주사율과 무관하다. 가장자리 영역 안쪽 경계에서는 천천히 시작해 제곱 곡선으로 빨라진다 |
| `dataIdAttr` | `data-id` | `toArray()` / `sort()` 가 쓰는 속성 |

### containment

복제본(`dragClass`)이 지정한 요소의 영역 밖으로 나가지 못하게 가둔다.

```ts
import { createSortable } from '@daracl/drift/sortable';

createSortable('#list', { containment: true });            // 이 목록 안에서만
createSortable('#list', { containment: 'parent' });        // 목록의 부모 요소 안에서만
createSortable('#a', { group: 'g', containment: '.zone' }); // closest('.zone') 안에서만
```

- **가두는 것은 복제본뿐이고 포인터는 자유롭다.** 위치 판정은 포인터를 범위 가장자리로 맞춘 좌표로 하므로, 포인터를 범위 밖으로 더 밀면 목록의 맨 앞/맨 끝 자리까지 닿는다.
- 범위 밖에 있는 다른 목록으로는 들어가지 않는다. 여러 목록 사이를 오가게 하려면 **모든 목록을 포함하는 요소**를 지정하고, 목록마다 같은 `containment` 를 준다(드래그를 시작한 목록의 옵션이 쓰인다).
- 범위 요소가 없거나 selector 가 잘못되었거나 크기가 0 이면 제한하지 않는다.
- 자동 스크롤은 실제 포인터 위치를 기준으로 하므로 `containment` 와 함께 써도 동작한다.

### group

- `pull`: `true`(이동, 기본) · `false` · `'clone'` · 대상 그룹 이름(들) · 함수
- `put`: `true` · `false` · 출발 그룹 이름(들) · 함수. **생략하면 같은 그룹 이름일 때만** 받는다
- 함수는 `({ to, from, item, originalEvent })` 를 받아 같은 종류의 값을 돌려준다

`pull: 'clone'` 은 항목이 출발 목록을 떠나는 순간 원래 자리에 복제본을 남긴다. 출발 목록으로 되돌아오면 복제본은 사라진다.
복제본은 `cloneNode(true)` 이므로 `id` 가 중복될 수 있다. `onClone` 에서 정리한다.

## 이벤트

옵션 콜백(`onChoose` `onStart` `onClone` `onMove` `onAdd` `onUpdate` `onRemove` `onSort` `onEnd`)과 `sortable.on(name, handler)` 를 모두 쓸 수 있다(`onMove` 는 콜백만).

| 이벤트 | 호출 위치 | 시점 |
|---|---|---|
| `choose` | 출발 목록 | 항목을 잡았을 때(`delay` 후) |
| `start` | 출발 목록 | 드래그가 시작됐을 때 |
| `clone` | 출발 목록 | 복제본이 처음 만들어졌을 때 |
| `onMove` | 출발 목록 | 이동하려 할 때. `false` 로 막고 `-1`/`1` 로 앞/뒤 삽입을 강제. 콜백 안에서 `cancel()`/`destroy()`(또는 Manager `unregister`/`destroy`)로 드래그를 끝내면 반환값과 무관하게 그 이동은 하지 않는다 |
| `remove` / `add` | 출발 / 도착 목록 | 다른 목록으로 옮겼을 때 |
| `update` | 출발 목록 | 같은 목록 안에서 순서가 바뀌었을 때 |
| `sort` | 관련된 목록 모두 | add/update/remove 어느 쪽이든 |
| `end` | 출발 목록 | 놓았을 때(항상). Esc/취소면 `evt.cancelled === true` |

이벤트 객체: `{ item, clone, from, to, oldIndex, newIndex, cancelled, originalEvent }`. 인덱스는 `draggable` 항목 기준.

드래그 중의 사용자 콜백(`onChoose` `onStart` `onClone` `onMove`, pull/put 함수, `mirror` 함수) 안에서 `cancel()`/`destroy()` 로 드래그를 끝내도 안전하다. 콜백이 돌아온 뒤 그 드래그의 삽입·복제·애니메이션·자동 스크롤은 이어지지 않고, 항목은 원래 자리에 남으며 `end` 는 `cancelled: true` 로 한 번만 호출된다. 끝난 드래그의 콜백이 그 뒤에 시작한 드래그를 건드리지도 않는다.

다른 목록으로 들어갈 때는 도착 목록이 그 항목을 관리할 수 있는지 확인한다: 도착 목록의 자식 자리에서 `draggable` 에 맞지 않는 항목은 그 목록에 들어가지 않는다(넣으면 `items()`/`toArray()` 에서 빠져 다시 끌 수도 저장할 수도 없다). `.list > li` 처럼 부모 문맥에 의존하는 selector 는 도착 목록 문맥으로 판정한다.

## 메서드

`Sortable.get(el)` · `Sortable.isDragging()` · `sortable.items()` · `toArray()` · `sort(order, animate?)` · `option(name[, value])` · `on/off` · `cancel()` · `destroy()` · `isDestroyed()`

드롭 때 리스너 하나가 예외를 던져도 나머지 이벤트(remove/add/sort/end)는 모두 호출되고, 끝난 뒤 첫 예외가 전달된다. `destroy()` 도 같은 방식으로 끝까지 해제한다.

## 여러 목록 관리 (SortableManager)

`DriftManager` 와 같은 형태로 여러 Sortable 목록을 하나의 관리자에 등록한다(칸반 보드 같은 화면).
각 목록은 일반 Sortable 과 같고, Manager 는 등록/해제, 목록 간 이동 범위, 활성 목록, 이벤트 집계, API 이동, 전체 순서 저장·복원을 맡는다.

```ts
import { createSortableManager } from '@daracl/drift/sortable';

const board = createSortableManager(); // { crossContainer: false } 면 목록 안 정렬만
board.register('palette', '#palette', { group: { pull: 'clone', put: false }, sort: false });
board.register('todo', '#todo', { handle: '.grip' });
board.register('done', '#done');

board.on('itemTransfer', ({ from, to, itemId, mode, source }) => console.log(from, '→', to, itemId, mode, source));

const r = board.transferItem({ from: 'todo', to: 'done', itemId: 't1', index: 0 });
if (!r.moved) console.log('거절:', r.reason);

const saved = board.toJSON(); // { version: 1, containers: [{ id, order: ['t1', ...] }] }
board.fromJSON(saved);
board.destroy();
```

| 메서드 | 설명 |
| --- | --- |
| `register(id, target, options?)` → Sortable | 목록(요소/selector)에 Sortable 을 만들어 등록. 빈/중복 id, 없는 요소, 이미 Sortable 이 있는 요소(다른 Manager 포함)는 예외. `options.group` 은 이름 없이 `{ pull, put }` 만 줄 수 있다 |
| `unregister(id)` → boolean | 등록 해제 + Sortable destroy (목록 요소와 항목은 남는다). 진행 중인 관련 드래그는 원래 자리로 취소된다 |
| `get(id)` / `has(id)` / `getIds()` / `getAll()` / `getIdOf(el\|sortable)` | 조회 (등록 순서) |
| `setActive(id\|null)` / `getActiveId()` / `getActive()` | 활성 목록. 목록을 누르거나 포커스가 들어오면, 다른 목록으로 옮겨 놓으면 자동으로 바뀐다 |
| `setCrossContainer(bool)` / `isCrossContainer()` | 목록 사이 포인터 이동 켜기/끄기(기본 켜짐). 끄면 다른 목록에 들어가 있던 진행 중 드래그는 원래 자리로 취소 |
| `cancelDrag()` | 이 Manager 의 목록이 관련된 진행 중 드래그 취소 |
| `transferItem({ from, to, itemId, index? }, { source?, animate? })` → 결과 | 프로그램 이동. 성공 `{ moved: true, from, to, item, oldIndex, newIndex }`, 거절 `{ moved: false, reason }` |
| `getOrders()` / `toJSON(space?)` / `fromJSON(json\|data, { unknown? })` | 전체 순서 저장·복원 |
| `on` / `once` / `off` | Manager 이벤트 |
| `destroy()` / `isDestroyed()` / `groupName` | 전체 해제(두 번 호출해도 안전) / 등록 목록이 공유하는 그룹 이름 |

### 이동 범위와 규칙

- Manager 마다 고유한 그룹 이름(`groupName`, 예: `dsr-manager-1`)을 만들어 등록 목록에 준다. **같은 Manager 의 목록끼리만** 항목이 오가고, 다른 Manager 나 Manager 밖의 Sortable 과는 섞이지 않는다.
- 목록별 `pull`(이동/`'clone'`/false/그룹 이름/함수)과 `put` 규칙은 그대로 적용된다. 그 위에 Manager 의 `crossContainer` 가 꺼져 있으면 어떤 목록도 다른 목록의 항목을 받지 않는다(목록 안 정렬은 된다).
- 도착 목록이 관리할 수 없는 항목은 받지 않는다: `draggable` 불일치(위 [이벤트](#이벤트) 참고), 또는 도착 목록의 `dataIdAttr` 로 출발 목록에서와 같은 id 를 읽을 수 없는 항목(id 가 없던 항목은 제한하지 않는다).
- 끄는 경로가 여러 목록을 지나면 항목은 지나간 목록으로 옮겨 다니며, 받지 않는 목록 위에서 놓으면 **마지막으로 받아 준 목록**에 남는다(일반 Sortable 과 같은 동작).

### transferItem

- 포인터 이동 옵션(`crossContainer`, pull/put)과 무관하게 옮긴다. 다만 도착 목록이 관리할 수 없는 항목은 옮기지 않는다(`incompatible-item`, 아래).
- `itemId` 는 출발 목록의 `dataIdAttr` 값이다. `index` 는 도착 목록의 draggable 항목 기준 위치이고, 생략하거나 항목 수보다 크면 맨 뒤다. 음수나 정수가 아니면 예외.
- 출발 목록에 `remove`, 도착 목록에 `add`, 두 목록에 `sort` 를 드래그와 같은 순서로 낸다(옵션 콜백과 `on` 구독 모두). 그 뒤 도착 목록을 활성으로 만들고 Manager `itemTransfer`(source:'api')를 낸다.
- 거절 사유: `destroyed`, `busy`(드래그 중이거나 이동 처리 중의 재진입), `missing-container`, `same-container`, `missing-item`, `duplicate-item`(출발 목록에 같은 id 가 여럿), `disconnected`, `incompatible-item`. 거절이면 DOM 순서·부모·활성 목록이 그대로이고 remove/add/sort/itemTransfer 도 내지 않는다.
- `incompatible-item`: 도착 목록 자식 자리에서 그 목록의 `draggable` 에 맞지 않거나(부모 문맥 selector 는 도착 문맥으로 판정하고, 판정 뒤 항목은 원래 자리로 돌아간다), 도착 목록의 `dataIdAttr` 로 같은 `itemId` 를 읽을 수 없는 경우. 두 목록의 `dataIdAttr` 가 달라도 도착 속성에 같은 값이 있으면 허용한다. 항목의 class·태그·속성은 자동으로 바꾸지 않으므로, 호출자가 호환되게 준비한 뒤 다시 요청한다. 성공이면 항목은 도착 `items()` 에 있고 `newIndex` 는 그 위치(0 이상)다.
- 도착 목록에 이미 같은 id 의 항목이 있어도 옮긴다(복제 id 와 같은 기존 계약, id 를 새로 만들지 않는다). 이때 `fromJSON` 은 어느 요소인지 알 수 없어 예외가 된다.
- 리스너 예외는 완료된 이동을 되돌리지 않고, 나머지 알림을 마친 뒤 첫 예외를 던진다.

### 순서 저장 / 복원

```json
{ "version": 1, "containers": [{ "id": "todo", "order": ["t2", "t1"] }, { "id": "done", "order": [] }] }
```

- `fromJSON` 은 전체를 먼저 검증한다: 구조, version, 빈/중복 목록 id, 데이터 안의 중복 항목 id, 미등록 목록과 어느 목록에도 없는 항목 id(기본 `unknown:'error'`, `'ignore'` 면 건너뜀), 여러 목록에 같은 id 가 있어 어느 요소인지 알 수 없는 경우, 도착 목록이 관리할 수 없는 항목(`dataIdAttr` 로 같은 id 를 읽을 수 없거나 옮긴 자리에서 `draggable` 에 맞지 않음 — `unknown:'ignore'` 여도 예외). 오류면 **DOM 을 바꾸지 않는다**(옮긴 뒤에야 알 수 있는 `draggable` 판정이 실패하면 모든 목록을 원래 자식 순서로 되돌린 뒤 예외).
- 목록 사이로 옮겨진 항목도 원래 목록으로 돌아간다. 데이터에 있는 목록은 데이터 순서의 항목 뒤에 데이터 어디에도 없는 기존 항목을 원래 순서로 둔다. 데이터에 없는 목록은 순서를 그대로 두지만, 그 목록의 항목이 다른 목록의 복원 항목으로 지정되어 있으면 그 항목은 빠져나간다.
- 항목 요소를 새로 만들거나 지우지 않는다. 목록 이벤트(add/remove/sort)는 내지 않는다. 드래그 중에는 예외.

### Manager 이벤트

| 이벤트 | 인자 |
| --- | --- |
| `containerRegistered` / `containerUnregistered` | `{ containerId, sortable }` / `{ containerId }` |
| `activeChange` | `{ containerId, previousId, sortable }` |
| `start` / `sort` / `end` | `{ containerId, event }` — 목록의 같은 이름 이벤트 (`sort` 는 목록 간 이동이면 두 목록에서 한 번씩) |
| `itemTransfer` | `{ from, to, item, itemId, oldIndex, newIndex, mode: 'move'\|'clone', source: 'user'\|'api' }` |

- 등록/해제 순서와 재진입은 `DriftManager` 와 같다: 해제는 등록 정보를 먼저 지우고, 활성이었다면 `activeChange(null)` → Sortable destroy → `containerUnregistered`. 정리 단계는 리스너 예외가 있어도 끝까지 하고 첫 예외를 던진다.
- Sortable 을 직접 `destroy()` 해도 등록이 정리된다.

## 입력/접근성 정책

- 터치: `handle` 이 있으면 handle 에만, 없으면 목록 항목 전체에 `touch-action: none` 이 적용된다(`style/_sortable.scss`). `delay` 를 쓰면 대기 중에는 스크롤이 가능하고, 대기를 채운 뒤에는 `touchmove` 를 막아 스크롤이 드래그를 끊지 않게 한다.
- 드래그 중 `Esc` 로 취소하면 원래 자리로 돌아간다. `pointercancel`(브라우저가 제스처를 가져간 경우)도 취소로 처리한다.
- 키보드만으로 순서를 바꾸는 기능은 아직 없다.

## 구조와 의존 방향

```
src/dom/autoScroll.ts   공통: 가장자리 자동 스크롤
src/dom/flip.ts         공통: FLIP 애니메이션
src/event/Emitter.ts    공통: 이벤트 발행기
src/sortable/           Sortable 본체와 SortableManager (src/drift 를 import 하지 않는다), types.d.ts 는 공개 타입
src/sortable.ts         공개 엔트리, src/sortable.umd.ts 는 UMD 엔트리
```

`src/sortable/` 은 `src/dom`, `src/event`, `@daracl/core/utils` 에만 의존하므로 나중에 폴더째 별도 패키지로 분리할 수 있다.

## 성능

항목이 수천 개이거나 항목 안에 무거운 내용(표, iframe, canvas)이 있어도 드래그가 끊기지 않도록 다음과 같이 처리한다.
3000개 목록 + 무거운 항목에서 실제 브라우저로 잰 값이다(`e2e/sortable-perf.spec.ts` 가 회귀를 막는다).

| 지표 | 최적화 전 | 최적화 후 |
|---|---|---|
| 드래그 시작 | 60~116ms | 약 30ms |
| 이동 이벤트 평균 / 상위 5% / 최대 | 11~14 / 130~150 / 225~263ms | 약 2 / 14 / 23ms |

- **복제본은 드래그 시작 때 한 번만 만든다.** 이후에는 `transform` 만 바꾼다(합성 레이어, `contain: layout style`).
- **무거운 요소는 빈 상자로 바꾼다.** 복제된 `iframe` 은 body 에 붙는 순간 다시 로드되고 `video` 는 재생을 시작하므로, `iframe/video/audio/object/embed/canvas` 는 같은 크기의 빈 상자로 대체한다.
  `canvas` 그림을 복사하지 않는 것도 의도다. `getContext`/`drawImage` 가 GPU 캔버스를 초기화하는 비용이 커서 드래그 시작이 수백 ms 걸렸다.
  그림이 꼭 필요하면 `mirror: (item) => ...` 로 직접 만든다.
- **`mirror: 'box'`** 는 내용을 복사하지 않아 가장 가볍다. 항목이 아주 무겁거나 내용이 복제본에 필요 없을 때 쓴다.
- **복제본은 `aria-hidden` + `inert`** 라서 접근성 트리와 포커스를 늘리지 않는다.
- **이동 애니메이션은 실제로 자리가 바뀌는 구간의 항목만** 측정하고 `transform` 을 쓴다(앞뒤 나머지는 건드리지 않는다).
- **포인터가 항목 위에 있으면 자리 판정은 항목 수와 무관하다.** 포인터 아래 항목과 끄는 항목의 위치만 읽는다. 포인터가 항목이 아닌 곳(목록 여백, 항목 사이 틈, draggable 이 아닌 자식)에 있으면 가장 가까운 항목을 찾으려고 모든 직계 항목의 `getBoundingClientRect` 를 읽는다(O(n)). `test/sortable/perf.test.ts` 가 n=100/1000/3000 에서 항목 위 4회 이하, 빈 곳 약 n회임을 계측한다(jsdom 의 호출 횟수, 실제 시간이 아니다). 배치 방향은 드래그마다 한 번만 판정한다.
- 자리를 바꿀 때의 애니메이션 비용은 항목 수가 아니라 **이동 구간의 크기**(같은 목록에서 이전 자리와 새 자리 사이, 다른 목록이면 출발 목록의 뒤쪽과 도착 목록의 삽입 지점 이후)에 비례한다. 3000개 목록의 맨 앞 항목을 맨 뒤로 보내면 그 사이 전부를 측정한다.
- **자동 스크롤은 스크롤 가능한 조상 목록을 캐시**해 프레임마다 `getComputedStyle` 을 부르지 않는다.
- **`html` 이나 목록의 상속 속성(`cursor`, `user-select`)을 바꾸지 않는다.** 드래그를 시작하는 순간 문서의 모든 요소가 스타일을 다시 계산되어 3000개 기준 수십 ms 가 더 걸린다.
  텍스트 선택은 `selectstart` 를 막고 선택 영역을 지워서 처리하고, `grabbing` 커서는 복제본에만 준다. `html.dsr-dragging` 클래스는 사용자 코드를 위해 붙지만 `daracl.sortable.css` 의 규칙은 이 클래스에 의존하지 않는다.
  직접 `html.dsr-dragging *` 같은 전역 규칙을 만들면 같은 비용을 치르게 된다.

## 알려진 한계

- HTML5 Drag and Drop 폴백이 없다(Pointer Events 전용). 파일을 목록에 끌어 놓는 용도는 지원하지 않는다.
- multi-drag, swap, 그리드 좌표 정렬은 없다.
- 중첩 목록은 안쪽 목록의 항목을 잡으면 안쪽만 드래그되는 것까지만 테스트했다. 중첩 목록 사이의 이동은 검증하지 않았다.
- 복제본에서 `canvas`/`iframe`/`video` 는 빈 상자로 보인다(위 [성능](#성능) 참고).
- 터치는 Playwright 의 Pixel 5 에뮬레이션 + CDP 터치 입력(`e2e/*touch.spec.ts`)으로 검증한다. 실제 터치 기기에서의 동작은 자동 테스트로 검증하지 못했다.
