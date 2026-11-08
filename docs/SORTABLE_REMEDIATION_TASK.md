# AI 작업지시서: Sortable 결함 수정 및 성능 문서 정합성 검증

## 1. 목표와 작업 범위

Sortable 검증에서 재현된 두 결함을 수정하고, `docs/SORTABLE.md`와 `docs/performance.md`의 설명을 실제 구현·측정 범위에 맞춘다. 구현, 회귀 테스트, 브라우저 검증, 공개 타입·문서 갱신까지 완료한다.

이 문서 작성 단계에서는 제품 코드와 테스트를 수정하지 않았다. 아래 사양은 이 문서를 전달받은 AI가 수행할 작업이다.

- 저장소 `AGENTS.md`를 먼저 읽는다. 사용자 응답·주석·오류 메시지는 한국어로 작성한다.
- 기존 미커밋 변경을 보존한다. 다른 작업자가 변경 중인 파일을 임의로 되돌리지 않는다.
- 관련 테스트와 실제 구현을 먼저 읽고 결함을 재현한다. 줄 번호보다 함수 이름으로 위치를 확인한다.
- 실패 테스트 삭제·skip·기대값 완화로 통과시키지 않는다.
- 새 의존성을 추가하지 않는다. `src/sortable`에서 `src/drift`를 import하지 않는다.
- 이번 범위는 아래 두 결함과 관련 테스트·문서·측정이다. 새로운 정렬 모드나 키보드 기능을 추가하지 않는다.

## 2. 먼저 읽을 파일

- `docs/SORTABLE.md`, `docs/performance.md`
- `src/sortable/Sortable.ts`, `SortableManager.ts`, `types.d.ts`, `group.ts`, `mirror.ts`
- `src/dom/autoScroll.ts`, `src/dom/flip.ts`, `src/event/Emitter.ts`
- `test/sortable/sortable.test.ts`, `manager.test.ts`, `_helpers.ts`, 나머지 Sortable 테스트
- `e2e/sortable.spec.ts`, `sortable-manager.spec.ts`, `sortable-manager-touch.spec.ts`
- `e2e/sortable-wrap.spec.ts`, `sortable-autoscroll.spec.ts`, `sortable-perf.spec.ts`
- `e2e/multi-container-perf.spec.ts`, `multi-container-resources.spec.ts`
- `scripts/bench-core.mjs`, `scripts/bench-editor.cjs`
- `uitest/sortable.html`, `uitest/sortable-manager.html`

## 3. 결함 A: onMove에서 취소·해제한 뒤에도 순서 변경

### 확인된 재현

세 항목 `[a,b,c]`를 가진 목록에서 a를 b 방향으로 끈다. 출발 목록의 onMove 안에서 `sortable.cancel()` 또는 `sortable.destroy()`를 호출하고 값을 반환하지 않는다.

실제 결과:

- end 이벤트는 `cancelled: true`로 발생한다.
- 전역 드래그 상태와 ghost는 정리된다.
- 그런데 최종 DOM 순서는 `[b,a,c]`다. 취소 결과와 실제 DOM이 불일치한다.

실제 Chromium에서 cancel과 destroy 경로를 각각 반복 재현했다. 기존 `onMove: () => false` 테스트만으로는 이 결함을 검출하지 못한다.

### 원인과 수정 기준

`Sortable.over()`는 사용자 onMove 콜백을 호출한 뒤 세션이 종료됐는지 검사하지 않고 `place()`를 실행한다.

- 콜백 이후 기존 세션이 여전히 현재 세션인지, 출발/현재/대상 Sortable이 유효한지 확인한다.
- 콜백이 취소·해제·등록 해제 등으로 세션을 끝냈으면 그 세션의 후속 삽입·애니메이션·복제·스크롤 처리를 실행하지 않는다.
- 단순히 onMove에서 false도 반환하라고 사용자에게 요구하는 방식으로 해결하지 않는다. cancel/destroy 자체로 안전해야 한다.
- `onChoose`, `onStart`, `onClone`, pull/put 함수, 사용자 mirror 함수 등 같은 구조의 콜백 경계를 함께 검토한다. 확인하지 않은 경로를 결함이라고 보고하지 말고 필요한 경우 별도 재현 테스트로 확정한다.
- 오래된 콜백이 새 세션을 종료하거나 원래 세션을 되살리지 않게 한다.
- 정상 onMove의 false/-1/1 삽입 제어와 drop 이벤트 계약을 유지한다.

### 필수 회귀 테스트

- onMove에서 cancel, destroy, Manager.unregister(source/target), Manager.destroy.
- onMove가 undefined를 반환하는 경우와 false를 반환하는 경우 모두 확인.
- 같은 목록 정렬과 다른 목록 이동, pull:'clone' 경로 확인.
- 취소 후 원본 순서 보존, 대상 불변, cancelled end 한 번, add/remove/update/sort/itemTransfer 성공 알림 없음.
- clone/ghost/chosen/전역 dragging 클래스·포인터 capture·RAF·임시 스타일 정리.
- 취소 뒤 새 정상 드래그 가능. destroy한 목록은 재등록 후 정상 동작.
- 브라우저에서는 실제 마우스 입력으로 원본·대상의 DOM 순서와 정리 결과를 검사한다.

## 4. 결함 B: 대상 draggable에 맞지 않는 API 이동을 성공 처리

### 확인된 재현

```ts
const manager = createSortableManager();
manager.register('a', sourceElement, { draggable: '.a' });
manager.register('b', targetElement, { draggable: '.b' });
// sourceElement: <li class="a" data-id="x">X</li>
// targetElement: <li class="b" data-id="y">Y</li>
manager.transferItem({ from: 'a', to: 'b', itemId: 'x' });
```

실제 결과:

- `moved: true`, `newIndex: -1`을 반환한다.
- x는 대상 DOM에 존재하지만 대상 items()/toArray()에는 없다.
- 전체 저장은 a:[], b:['y']가 되어 x가 누락된다.

`SortableManager.transferItem()`이 대상 관리 조건을 확인하지 않고 insertBefore한 뒤 인덱스를 계산하는 것이 직접 원인이다.

### 수정 정책

- 대상에서 정렬·조회·저장할 수 없는 항목은 성공 처리하지 않는다.
- 예상 가능한 거절 사유로 **`incompatible-item`**을 공개 결과 타입에 추가한다. 대상의 draggable 또는 dataIdAttr 규칙과 호환되지 않는 경우 사용한다.
- 항목의 class·태그·ID 속성을 자동으로 바꾸지 않는다. 호출자가 호환되게 준비한 뒤 다시 요청할 수 있게 문서화한다.
- 성공할 때는 대상 items()에 실제로 포함되고 newIndex가 0 이상이며, 요청 itemId가 대상 toArray()/저장에서 보존돼야 한다.
- 서로 다른 dataIdAttr를 사용하는 경우에도 대상 속성으로 같은 itemId를 읽을 수 있으면 허용한다. 없거나 값이 달라 식별자가 보존되지 않으면 거절한다.
- 대상에 이미 같은 ID가 있는 정책은 기존 계약을 유지한다. ID 자동 재발급 같은 별도 기능을 추가하지 않는다.
- 거절 후 최종 DOM 순서·부모·활성 목록을 보존하고 remove/add/sort/itemTransfer를 발행하지 않는다.
- `.target > .item`, `:scope` 등 부모 문맥에 의존하는 지원 selector는 대상의 실제 관리 판정과 일치해야 한다. 원본 문맥에서 matches만 검사하여 정상 항목을 잘못 거절하지 않는다. 문맥 검증을 위해 임시 삽입이 필요하면 실패 시 원래 nextSibling 위치로 복구하고 성공 알림 전에 검증을 마친다.
- 잘못된 selector의 처리 방식은 기존 옵션 정책을 확인해 유지한다. 예외를 호환성 거절로 무차별 삼키지 않는다.
- API의 pull/put/crossContainer 무시 계약은 유지한다. 그룹 정책과 항목 관리 호환성을 구분한다.
- `fromJSON()`과 포인터 이동에도 동일한 비관리 항목 유입 경로가 있는지 재현한다. 확인되면 같은 원칙으로 차단하고 문서에 범위를 명시한다. 복원 검증 실패 후 일부 목록만 바뀐 상태를 남기지 않는다.

### 필수 회귀 테스트

- .a→.b 거절: 원본에 x 보존, 대상 그대로, moved:false/incompatible-item, 성공 이벤트 0회.
- 같은 selector, 제한 없는 대상, 부모 문맥 selector의 정상 이동.
- draggable이 아닌 고정 자식이 섞인 목록의 index 0/중간/끝 처리.
- dataIdAttr가 같음 / 다르지만 같은 ID 제공 / 대상 ID 없음 / 다른 ID 제공.
- 성공 결과의 newIndex와 대상 items() 인덱스 일치, 전체 저장·복원 후 항목 누락 없음.
- 기존 source duplicate-item, missing-item, disconnected, busy, same-container 동작 유지.
- 포인터·JSON에서 같은 문제가 확인된 경우 각 경로의 실패 원자성과 정상 호환 이동 검증.

## 5. SORTABLE.md 정합성 수정

1. **자리 판정 비용**: "항목 수와 무관하며 전체를 훑지 않는다"는 절대 표현을 수정한다. 포인터 아래 항목을 사용하는 일반 경로와, 빈 공간에서 nearestItem이 전체 직계 항목의 DOMRect를 읽는 O(n) 경로를 구분한다. 애니메이션 비용은 이동 구간 크기의 영향도 받는다.
2. **터치 검증**: "Playwright는 마우스로만 검증"을 수정한다. 현재 Pixel 5 에뮬레이션 + CDP 터치 테스트가 존재한다. 실기기 터치 미검증 사실은 유지한다.
3. **부분 JSON 복원**: "데이터에 없는 목록은 그대로"에 다른 목록의 복원 항목으로 지정되어 빠져나가는 항목은 제외된다는 조건을 명시한다.
4. 결함 B의 새 거절 사유와 draggable/dataIdAttr 호환 규칙을 API 설명·타입에 함께 반영한다.
5. 복제 ID 중복, 키보드 정렬 미지원, 마지막 수용 목록에 남는 drop 정책 등 기존 명시 계약은 유지한다.

## 6. performance.md 정합성 수정와 재측정

- core 시간 상한은 실제 `BENCH_BUDGET_MS` 기본값과 일치시킨다. 검증 시 문서는 15000ms, 코드는 20000ms였다.
- 최신 다중 컨테이너 벤치의 워밍업 범위를 명시한다. 검증 시 createPlain(25)만 워밍업했으며 Manager 이동·Undo 전체 경로 워밍업은 아니었다.
- 과거 생성 44→80ms 차이가 모두 실행 편차라는 단정은 완화한다. 현재 Manager/단일 Editor 대조군은 과거 코드와의 전후 대조 실험이 아니다.
- pointermove 동기 처리 P95가 16ms 미만이라는 사실만으로 전체 프레임 60fps를 보장하지 않는다. 페인트·합성·다른 스크립트 비용을 포함하지 않는 수치임을 유지한다.
- GC 후 Editor/Manager 생존 개수와 heap 총량 증가를 구분한다. 관찰한 인스턴스 잔존이 없다는 결과를 전체 메모리 누수 부재로 확대하지 않는다.
- 과거 표를 현재 재측정값으로 조용히 대체하지 않는다. 측정일·커밋 또는 작업 트리·방법 변경을 명시한 별도 결과로 기록한다.
- 성능 숫자를 보기 좋게 만들기 위한 제품 코드 최적화는 범위에 넣지 않는다. 수정으로 새 회귀가 발생했다면 정확성을 유지하며 원인을 해결한다.

### 직전 재검증 참고값

이 수치는 비교 참고이며 다시 실행한 결과로 보고하면 안 된다. Chromium 156.0.8078.4, Node v24.20.0, i7-8565U, headless 1280×900이다.

| 검사 | 실제 관찰 |
| --- | --- |
| 기존 Sortable 단위/브라우저 | 125개 / 44개 모두 통과. 별도 재현에서 위 두 결함 발견 |
| Sortable 3000개 성능 3회 | 시작 17.2~33.6ms, 평균 1.60~1.68ms, P95 9.7~9.9ms, 최대 12.5~15.6ms |
| core | 84개 조합 측정, 시간 상한 초과·생략 0 |
| 단일 Editor n=1000 | 전체 벤치 3회 중앙값: 생성 112.8ms, moveItem 29.7ms, syncItems 24.5ms, 개별 update 1897ms |
| Manager 50개 생성 2회 | 52.0 / 89.9ms, 같은 실행 대조군 48.3 / 76.0ms |
| Manager 50개 이동 2회 | 1.0 / 1.6ms |
| GC 후 인스턴스 | Editor 0, Manager 기준값 1 유지. DOM/리스너/Observer/시트 누적 관찰 없음 |

## 7. 검증 절차

1. 변경 전 두 결함을 단위 테스트와 실제 브라우저에서 재현한다.
2. 관련 최소 수정 후 typecheck → lint → build → Jest → Playwright 순서로 실행한다.
3. 전체 Jest와 전체 Playwright를 실행하여 Drift·Viewer·Sortable 회귀를 확인한다. dist 검사 전에 재빌드한다.
4. 새 핵심 브라우저 회귀 시나리오는 --repeat-each=3으로 반복한다.
5. 성능은 기능 테스트 실행이 모두 끝난 뒤 --workers=1로 격리한다. 측정끼리도 동시에 실행하지 않는다.
6. Sortable 성능 3회, 다중 컨테이너 성능·리소스 2회, core, 단일 Editor 전체 벤치 3회를 해당 문서 조건으로 실행한다.
7. 필요할 경우 nearestItem의 좌표 읽기 횟수를 테스트에서 계측해 100/1000/3000개에서 비교한다. 코드 분석과 실측을 구분한다.

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js "src/**/*.ts"
node scripts/build.mjs
node node_modules/jest/bin/jest.js --runInBand
node node_modules/@playwright/test/cli.js test --workers=2
node node_modules/@playwright/test/cli.js test e2e/sortable-perf.spec.ts --workers=1 --repeat-each=3
node node_modules/@playwright/test/cli.js test e2e/multi-container-perf.spec.ts e2e/multi-container-resources.spec.ts --workers=1 --repeat-each=2
node scripts/bench-core.mjs .tmp/core-after.json
$env:BENCH_URL='http://127.0.0.1:5179'
node scripts/bench-editor.cjs .tmp/editor-after-1.json
node scripts/bench-editor.cjs .tmp/editor-after-2.json
node scripts/bench-editor.cjs .tmp/editor-after-3.json
```

bench-editor는 현재 소스를 제공하는 Vite 서버가 먼저 실행되어야 한다. 5199는 이전 환경에서 EACCES가 있었고 5179를 사용했다. 기존 서버의 정체를 확인하고 임의 종료하지 않는다.

NVM4306으로 npm이 차단된 이력이 있다. 차단을 우회하거나 신뢰 설정을 임의 변경하지 않는다. 로컬 도구를 node로 실행할 수 있어도 npm pack이 필요한 소비자 검사는 별도로 차단될 수 있다. 실행하지 못한 검사를 통과했다고 보고하지 않는다.

## 8. 완료 기준과 최종 보고

- 취소·해제 후 항목 순서가 바뀌지 않고 세션·리소스가 남지 않는다.
- API 이동 성공 시 대상이 항목을 정상 관리하고 newIndex와 저장 데이터가 일치한다.
- 비호환 이동 거절 후 최종 DOM·활성 상태와 성공 이벤트 수가 원래 계약대로 유지된다.
- 정상 정렬·목록 간 이동·복제·터치·containment·자동 스크롤·동적 해제·JSON 복원이 유지된다.
- 새 공개 거절 사유가 타입·문서·테스트에서 일치한다.
- SORTABLE 및 performance 문서가 실제 코드·실측 범위와 일치한다.
- 테스트 수, 통과/실패/환경 차단, 반복 재현 결과, 전후 성능 및 남은 한계를 수치로 보고한다.
- 변경 파일과 수정 이유를 설명한다. 임시 파일은 정리하고 test-results/playwright-report 등 실행 결과물은 커밋하지 않는다.
