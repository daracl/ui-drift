# AI 작업지시서: 컨테이너 간 컴포넌트 이동

이 문서는 구현 요청서다. 아래 API와 동작은 새로 구현할 사양이며 현재 제공되는 기능으로 설명하면 안 된다.

## 1. 목표와 작업 원칙

`@daracl/drift`의 같은 `DriftManager`에 등록된 컨테이너 사이에서 기존 컴포넌트를 마우스·터치로 이동하고 API로도 이동할 수 있게 구현한다. 예: A의 Chart를 B에 드롭하면 A에서 사라지고 B에 한 개만 존재한다.

- 저장소 `AGENTS.md`를 먼저 읽고 따른다. 사용자 응답, 주석, 오류 메시지는 한국어로 작성한다.
- 기존 미커밋 변경을 보존한다. `ui-grid`는 참고만 하고 수정하지 않는다.
- 관련 테스트와 구현을 먼저 읽는다. 코드와 문서가 다르면 확인한 구현을 기준으로 문서를 수정한다.
- 구현·테스트·하네스·문서 갱신까지 완료한다. 단순 설계나 일부 정상 경로 구현으로 종료하지 않는다.
- 실패 테스트 삭제, 기대값 완화, 임의의 대기로 통과시키지 않는다. 제품 결함·테스트 결함·환경 문제를 구분한다.
- 새 의존성을 추가하지 않는다. core/viewer에 DOM 또는 편집 코드를 넣지 않는다.
- 이 지시서의 정책으로 진행하고, 기존 계약과 양립 불가능한 경우에만 구체적인 충돌과 대안을 설명한다.

## 2. 먼저 읽을 파일

- `docs/MULTI_CONTAINER.md`, `docs/API.md`, `docs/DESIGN.md`
- `docs/multi-container-audit-2026-11-07.md`
- `src/drift/editor/DriftManager.ts`, `DriftEditor.ts`, `PointerController.ts`, `DragInController.ts`, `History.ts`, `GeometryStyle.ts`
- `src/drift/core/operations.ts`, `responsive.ts`, `flags.ts`, `containers.ts`
- `src/drift/types/DriftEditor.d.ts`, `DriftLayout.d.ts`
- `test/editor/manager.test.ts`, 기존 Editor/History/DragIn 테스트
- `e2e/multi-container*.spec.ts`, `uitest/multi-container.html`

## 3. 선행 수정: 검증에서 발견한 세 결함

다음 결함을 먼저 고치고 `e2e/multi-container-audit.spec.ts`의 재현 테스트를 통과시킨다.

1. `activeChange` 콜백 예외로 `unregister()`가 에디터 destroy 전에 중단되는 문제.
2. 드래그 중 `dragInEnd` 콜백 예외로 Manager/DragInController destroy가 중단되는 문제.
3. `dragInStart` 콜백에서 취소해도 이전 세션의 update가 실행되어 placeholder가 다시 생기는 문제.

정리 작업은 끝까지 수행한 뒤 첫 예외를 전달한다. 콜백 이후에는 세션·등록·destroy 상태를 재검증한다. 같은 결함을 새 이동 컨트롤러에 복제하지 않는다.

## 4. 범위와 기본 정책

| 항목 | 구현 기준 |
| --- | --- |
| 대상 | 같은 Manager에 등록되고 DOM에 연결된 컨테이너 |
| 기본값 | 컨테이너 간 포인터 이동은 비활성. 명시적으로 활성화한 경우만 동작 |
| 작업 | 단일 항목 이동. 복제·다중 선택 이동·다른 Manager 간 이동은 이번 범위 밖 |
| 동일 컨테이너 drop | 기존 PointerController의 이동·압축·히스토리 동작 유지 |
| Resize | 크기 조절 중에는 컨테이너 이동으로 전환하지 않음 |
| locked | `isMovable()` 기준으로 이동 거절. locked/resizable 독립성 유지 |
| 외부 팔레트 | 기존 setupDragIn과 autoAdd:false 계약 유지. 기존 컴포넌트 이동과 구분 |
| 밖 drop | 원래 컨테이너의 이동 전 상태로 취소. 삭제나 가장 가까운 대상 자동 선택 금지 |
| 입력 | Pointer Events 사용. 터치는 기존 dragMode 정책 준수, 본문 스크롤 유지 |
| 저장 | 기존 DriftContainerData version 1 유지. 이동 후 두 layout에 결과 반영 |
| 콘텐츠 | 데이터 이동. 기존 DOM을 appendChild로 다른 에디터에 이식하지 않음 |

## 5. 공개 API

기존 `createDriftManager()` 호출은 그대로 동작해야 한다. 다음 계약을 추가한다. 새 공개 타입은 Drift 전용 `.d.ts`에 두고 기존 공개 entry에서 export한다.

```ts
interface DriftManagerOptions {
  crossContainerDrag?: boolean; // 기본 false
}

interface DriftTransferRequest {
  from: string;
  to: string;
  itemId: string;
  x?: number;
  y?: number;
  newId?: string;
}

interface DriftTransferOptions {
  source?: 'api' | 'user'; // 기본 api
}

type DriftTransferRejectReason =
  | 'disabled'
  | 'destroyed'
  | 'missing-container'
  | 'same-container'
  | 'missing-item'
  | 'disconnected'
  | 'locked'
  | 'id-conflict'
  | 'invalid-size'
  | 'blocked'
  | 'busy'
  | 'stale';

type DriftTransferResult =
  | { moved: true; transactionId: string; from: string; to: string; item: DriftItem }
  | { moved: false; reason: DriftTransferRejectReason };

createDriftManager(options?: DriftManagerOptions): DriftManager;
manager.setCrossContainerDrag(enabled: boolean): void;
manager.transferItem(request: DriftTransferRequest, options?: DriftTransferOptions): DriftTransferResult;
```

- `crossContainerDrag`는 포인터 이동만 제어하며, API 이동은 이 옵션과 무관하게 가능하다.
- x/y는 둘 다 생략하면 대상의 자동 배치, 둘 다 지정하면 대상의 현재 편집 breakpoint 셀 좌표다. 하나만 지정하거나 NaN/Infinity 등 잘못된 입력은 `[drift] ...` 한국어 예외다.
- 같은 컨테이너를 API from/to로 지정하면 same-container 반환. 기존 moveItem을 사용하도록 문서화한다.
- ID 충돌·잠금·불가능한 크기 등 예상 가능한 거절은 결과 객체로 반환하고 모델·선택·히스토리·변경 이벤트를 만들지 않는다.
- newId는 API에서만 명시적으로 지정 가능하다. 빈 ID는 입력 오류, 대상과 충돌하면 id-conflict다. 포인터 이동은 자동 이름 변경 없이 ID 충돌을 거절한다.
- destroyed Manager의 이동은 destroyed 반환. 성공 결과와 이벤트의 item은 내부 데이터와 분리된 복사본이다.
- disabled는 진행 중 옵션 해제로 취소된 포인터 세션의 사유다. stale은 준비 후 모델·등록·breakpoint가 바뀐 경우다.

## 6. 데이터·크기·반응형 규칙

- id, title, content, props, min/max 크기, locked, resizable 등 의미 있는 데이터를 보존한다. JSON 중첩 데이터가 원본과 참조를 공유하지 않게 한다.
- 폭/높이는 픽셀 비율이 아닌 셀 수를 우선 유지한다. 대상 columns와 min/max 제약을 기존 core 규칙으로 검증·정규화한다.
- 대상 열 수보다 minW가 크거나 제약을 동시에 만족할 수 없으면 invalid-size로 거절한다. minW를 몰래 낮추지 않는다.
- 기존 충돌·float·압축 정책을 재사용한다. 원본은 제거 후 원본 정책으로 재배치하고, 대상은 대상 정책으로 배치한다.
- 유효한 목적지를 만들 수 없는 경우 blocked로 거절한다. locked 항목을 이동시키거나 겹친 최종 layout을 허용하지 않는다.
- breakpoint 편집 중에도 항목의 소속은 전체 layout에서 이동한다. 원본의 다른 breakpoint에 유령 항목을 남기지 않는다.
- 컨테이너마다 breakpoint 의미가 다르므로 이동 항목의 기존 `responsive` 위치는 대상에 그대로 복사하지 않는다. 대상에서는 새로 추가된 항목처럼 처리한다.
- 대상 breakpoint 편집 중에는 기존 addItem 경로의 기본 layout 자동 배치 + 현재 breakpoint 명시 저장 정책을 따른다. 다른 항목의 responsive 데이터는 불필요하게 삭제하지 않는다.
- 원본에서 보이던 유효 w/h를 대상 배치의 시작값으로 사용한다. 원래 base 크기와 responsive 데이터는 undo snapshot에 보존한다.
- 원본/대상의 breakpoint 또는 모델이 드래그 중 바뀌면 세션을 stale로 취소한다. 과거 snapshot으로 최신 변경을 덮어쓰지 않는다.

## 7. 포인터 세션과 미리보기

1. 시작 시 원본 editor/item, 두 컨테이너의 등록 식별자, layout revision, breakpoint, 선택 상태를 기록한다.
2. 같은 컨테이너에서는 기존 이동을 유지한다. 다른 대상 진입 시 Manager가 이동 세션을 조정한다.
3. 대상은 화면에서 실제 보이는 캔버스와 포인터 위치로 고른다. 겹친 컨테이너, 스크롤 clipping, 연결 해제 DOM을 고려한다.
4. A→B→C 이동 시 이전 대상의 미리보기를 원복한다. 원본 및 대상 모델은 drop 전 변경하지 않는다.
5. ghost는 하나, 유효 대상 placeholder는 하나만 표시한다. ID 충돌·잠금·크기 거절은 무효 상태를 시각적으로 표시한다.
6. 같은 셀·같은 revision이면 레이아웃을 재계산하지 않는다. 활성 대상 외 모든 Editor를 렌더하지 않는다.
7. drop 시 최종 좌표와 유효성을 다시 검사한다. 세션·ghost·placeholder·capture·RAF를 정리한 뒤 한 트랜잭션으로 반영한다.
8. 성공하면 대상이 활성화되고 옮긴 항목이 선택된다. 키보드 포커스를 대상 항목으로 옮기되 불필요한 페이지 스크롤을 피한다.
9. Esc/pointercancel/옵션 해제/대상 또는 원본 해제/Manager destroy는 정리 후 취소한다. keyboard:false여도 Esc 취소는 동작한다.

한 pointerId는 하나의 세션만 소유한다. 기존 PointerController, 외부 DragIn, 새 이동 처리가 동시에 같은 drop을 커밋하면 안 된다. Manager마다 필요한 공통 document 리스너만 유지하고 항목별 리스너를 추가하지 않는다.

## 8. 원자적 변경과 콜백 예외

단순히 `source.removeItem()` 후 `target.addItem()`을 연달아 호출하는 구현은 불합격이다. 중간 실패·이벤트·undo 때문에 항목 소실 또는 중복이 발생할 수 있다.

- 두 layout을 먼저 순수 계산하고 검증한다. 적용 직전 두 editor가 같은 등록 인스턴스인지, revision이 동일한지 확인한다.
- 두 editor 모델을 준비된 상태로 반영한 뒤에만 외부 변경 이벤트를 발행한다. 첫 layoutChange 콜백에서도 양쪽 최종 모델을 조회할 수 있어야 한다.
- 기존 commit/replace 책임을 확장하는 내부 트랜잭션 경로를 만든다. Manager에서 private layout/itemEls를 직접 조작하지 않는다.
- 적용·콘텐츠 렌더 단계 실패는 모델·선택·히스토리를 이전 상태로 복원한다. `load()`로 되돌려 기존 undo 이력을 지우는 방식은 금지한다.
- 콘텐츠 외부 부수효과까지 자동 롤백할 수 있다고 주장하지 않는다. mount/unmount 실패에서도 가능한 DOM·리스너 정리를 완료하고 원래 예외를 전달한다.
- 성공 확정 뒤 알림 콜백 예외는 이미 완료된 이동을 롤백하지 않는다. 나머지 필수 알림·정리를 완료한 뒤 첫 예외를 전달한다. 호출자는 결과 상태를 조회할 수 있다.
- 준비/적용/알림 중 재진입 transferItem은 busy로 거절한다. unregister/destroy는 처리 가능해야 하며 삭제된 editor를 후속 코드가 다시 렌더하거나 활성화하지 않는다.

## 9. Undo/Redo: 두 컨테이너를 한 작업으로 처리

원본·대상에 독립된 remove/add 이력을 남겨 한쪽 undo로 복제되는 구현은 금지한다.

- 두 Editor의 History에 같은 transactionId를 참조하는 연결 기록을 남긴다.
- 어느 쪽 editor.undo()를 호출해도 양쪽을 한 번에 되돌린다. redo도 양쪽을 한 번에 다시 적용한다.
- 기존 단일 Editor 변경은 기존처럼 해당 editor만 변경한다.
- 연결 기록이 양쪽 undo/redo 스택의 현재 최상단일 때만 실행 가능하다. 상대 컨테이너에 후속 로컬 편집이 있으면 해당 이동 undo/redo와 canUndo/canRedo는 false다. 상대의 후속 편집을 먼저 되돌리면 이동을 다시 되돌릴 수 있다.
- undo 이후 어느 한쪽의 새 편집이 연결 redo를 무효화하면 다른 쪽의 연결 redo도 무효화한다.
- history:false가 어느 한쪽에 있으면 이동은 허용하지만 두 컨테이너 모두 이전 내부 이력을 명시적으로 비우고 이동 이력을 생성하지 않는다. 이전 snapshot undo로 항목이 복제되지 않게 하는 보수적 정책이며 문서·테스트에 반드시 명시한다.
- load/reset/이력 초기화/히스토리 제한 초과/unregister/destroy로 연결 기록이 사라질 때 상대 기록도 안전하게 무효화한다. 오래된 snapshot을 독립적으로 실행하게 하지 않는다.
- 무효화된 이동을 가로질러 이전 snapshot을 복원하면 중복이 생길 수 있으므로 관련 스택을 안전하게 절단하거나 비운다. 해당 정책과 이력 손실 범위를 문서화한다.
- Undo/Redo는 두 layout뿐 아니라 관련 선택 상태도 일관되게 복구한다. 제거된 컨테이너를 자동 재생성하지 않는다.

## 10. 이벤트·콘텐츠 수명

- Manager에 `itemTransfer` 이벤트를 추가한다. 성공한 이동 및 연결 undo/redo마다 한 번 발생하며 transactionId, action(transfer/undo/redo), from/to, beforeItem/afterItem, source를 제공한다.
- 각 editor의 layoutChange는 이동 시 원본 remove 1회, 대상 add 1회 발생한다. 기존 changes 형식을 유지하고 선택적 transactionId로 연관시킨다. undo/redo는 기존 reason 의미를 따른다.
- 일반 성공 순서: 두 모델 반영 및 렌더 → 원본 layoutChange → 대상 layoutChange → 활성/선택 반영 → itemTransfer. 재진입으로 해제된 대상의 알림은 생존 검증 후 안전하게 처리한다.
- 포인터 이동은 source:user, API는 기본 source:api. programmaticEvents와 리스너가 있을 때만 payload를 만드는 기존 정책을 유지한다. itemTransfer의 API 알림 억제는 두 editor 중 하나라도 programmaticEvents:false면 억제한다.
- 외부 팔레트용 dragInStart/dragInEnd를 기존 항목 이동에 재사용하지 않는다. 기존 항목 dragStart/dragEnd는 원본에서 한 쌍만 발생하도록 통합하고 취소 시 계약도 문서화한다.
- preview 중에는 콘텐츠 mount/update/unmount를 호출하지 않는다. 성공 시 원본 unmount 후 대상 mount를 각각 한 번 호출한다. 다른 항목의 콘텐츠는 다시 만들지 않는다.
- 이동 후 대상 sizeChange는 대상 메트릭으로 계산하고 프레임당 중복 알림을 피한다.

## 11. 하네스와 문서

`uitest/multi-container.html`에 다음을 추가한다.

- 컨테이너 간 이동 활성화 체크박스와 현재 상태 표시.
- 선택 항목을 지정한 컨테이너로 이동하는 API 실행 UI.
- 동일 ID 충돌, 다른 열/행 높이/gap/float/breakpoint 사례.
- 거절 사유, transactionId, from/to, undo/redo 이벤트 표시(textContent 사용).
- 연결 undo/redo가 막힌 경우 그 이유를 확인할 수 있는 설명.

README, API 표, DESIGN, MULTI_CONTAINER 문서와 공개 타입을 갱신한다. Viewer 출력 형식은 유지한다. JSON을 저장한 후 JS 없는 Viewer에서 이동 결과가 맞는지 검증한다.

## 12. 필수 테스트

### 단위·통합

- A→B, B→A, A→B→C, 같은 컨테이너 기존 이동.
- 원본 제거·대상 추가 정확히 한 번, props 깊은 복사, ID 보존/충돌/newId.
- locked 거절, resizable 독립성, min/max 불가능, 대상 locked 장애물, float 조합.
- 서로 다른 열/행 높이/gap, 기본↔breakpoint, 서로 다른 이름의 breakpoint.
- 시작·진행·drop 중 모델 또는 breakpoint 변경에 따른 stale 취소.
- 밖 drop, Esc, pointercancel, 중복 pointerup, 다른 pointerId 무시, 옵션 해제.
- 원본/대상 unregister 및 직접 destroy, Manager destroy, DOM 직접 분리.
- 콘텐츠 mount/unmount 예외, 알림 예외, 콜백 내 취소/해제/새 이동 재진입.
- 일반 undo/redo 독립성, 연결 undo/redo, 상대 후속 편집, redo 무효화, history:false, load/reset/제한 초과/해제.
- 실패·취소 시 두 모델/이력/선택 보존, 성공 시 이벤트 수·순서·복사본 검증.
- 반복 저장/복원 동일성, 원본에 유령 항목 없음, 다른 컨테이너 불변.

### 실제 Playwright

- 마우스·CDP 터치 A→B 이동. 실제 boundingBox 위치·폭·높이를 expect.poll로 검사.
- A→B→C hover와 원본 복귀, clipping/겹친 컨테이너에서 올바른 대상 선택.
- 자동 스크롤, 모바일 본문 스크롤, resize와 이동 충돌 방지.
- ID 충돌 UI, 무효 placeholder, 성공/취소 후 ghost와 임시 인라인 위치 정리.
- 이동 중 동적 추가/제거와 Manager destroy.
- 활성/선택/포커스, 연결 undo/redo, JSON 저장/복원 및 JS 비활성 Viewer.
- 전체 multi-container 하네스 버튼과 기존 단일 Editor·팔레트·Sortable 회귀 테스트.
- 새 핵심 시나리오는 --repeat-each=3으로 반복한다.

기존 보고서의 터치·Viewer 실패는 별도로 원인을 재확인한다. 이번 작업에서 고친 실패와 남은 기존 실패를 구분하고, 실패가 있다는 사실을 숨기지 않는다.

## 13. 성능·메모리

같은 Chromium·환경·항목 수로 구현 전후 1/5/10/25/50개 컨테이너를 측정한다. 컨테이너당 10개 항목을 기본 조건으로 한다.

- 생성/편집/저장/제거, 이동 commit 시간, pointermove 중앙값/P95.
- 공통 document pointer 리스너 수와 해제 후 잔존 수.
- observer·위치 CSS 수, 불필요한 전체 렌더/DOM 탐색, 동일 셀 계산 횟수.
- 원본/대상 변경에 따른 강제 동기 layout은 가능하면 trace로 확인한다.
- 50개 컨테이너를 반복 등록/이동/해제하고 GC 후 heap·DOM·리스너 수를 기록한다.
- 타이밍은 다른 테스트와 분리하고 워밍업·반복 횟수·중앙값·브라우저 버전을 보고한다.
- 개선이 필요하면 정확성 테스트를 유지하며 최적화한다. 측정하지 않은 값이나 장기 누수 부재를 주장하지 않는다.

## 14. 완료 기준과 결과 보고

1. 선행 세 결함과 새 이동 기능 테스트가 통과한다.
2. 포인터 이동은 기본 비활성이고 기존 단일 Editor/팔레트 동작을 유지한다.
3. 이동·취소·예외·undo/redo 중 항목 소실·중복·상대 데이터 덮어쓰기가 없다.
4. 리소스 정리와 Viewer의 DOM 없는 의존 구조를 유지한다.
5. typecheck → lint → build → Jest → Playwright 순서로 실제 실행한다. dist 사용 테스트 전에 반드시 재빌드한다.
6. 테스트 수, 통과/실패/환경 차단, 반복 결과, 전후 실측, 변경 파일과 남은 제약을 보고한다.
7. 구현 예제와 새 계약이 문서·타입·실제 코드에 일치한다. 임시 파일은 정리하고 테스트 결과물은 커밋하지 않는다.

현재 환경에서 npm은 NVM4306으로 차단된 이력이 있다. 다시 확인하고, 차단되면 신뢰 설정을 우회하지 않는다. 실행 가능한 로컬 도구는 node로 직접 실행하되 npm pack 등 환경에 막힌 검증을 통과했다고 보고하지 않는다.
