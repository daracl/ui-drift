# 컨테이너 간 이동 구현 후 전체 재검증

검증일: 2026-11-07 (Asia/Seoul). 대상은 현재 미커밋 작업 트리다. 이번 검증에서는 제품 코드와 테스트 기대값을 수정하지 않았다.

## 결과

| 검사 | 결과 |
| --- | --- |
| TypeScript `tsc --noEmit` | 통과 |
| ESLint `src/**/*.ts` | 통과 |
| 전체 빌드 | 통과, 5.43초 |
| 배포 선언 검사 | 67개 d.ts의 내부 별칭 제거 및 상대 import 해석 통과 |
| Jest | **613 통과 / 4 환경 차단**, 총 617개. 40 suites 중 39 통과 |
| Node 빌드 스크립트 테스트 | **5개 모두 통과** |
| 전체 Playwright | **180 통과 / 3 실패**, 총 183개, 2.4분 |
| 이동·기존 결함 재현 테스트 3회 반복 | **60개 모두 통과**, 1.5분 |
| 남은 모바일 실패 3개 별도 3회 반복 | **9회 모두 실패**, 반복 재현 확인 |
| 별도 성능·리소스 테스트 | **2개 모두 통과**, 7.1초 |

Jest의 네 실패는 `test/build/dtsConsumer.test.ts`의 공통 beforeAll에서 `npm pack`이 실행되지 않아 발생했다. NVM4306(delegated script is not trusted)이 재현되었으며 검사 본체에 도달하지 못했다. 제품 타입 오류로 확인된 실패가 아니지만 외부 설치 소비자 검증은 미완료다. NVM 신뢰 설정은 변경하지 않았다.

## 수정 확인

이전에 확인한 세 결함은 `multi-container-audit.spec.ts`에서 원래 기대값 그대로 통과했고, 각각 3회 반복에서도 통과했다.

1. activeChange 콜백 예외 후에도 unregister가 에디터·DOM을 해제한다.
2. 드래그 중 dragInEnd 콜백 예외 후에도 Manager destroy가 모든 등록을 해제한다.
3. dragInStart 콜백 취소 후 placeholder가 다시 나타나지 않는다.

Viewer VWR-D도 통과했다. 고정 폭 300px 기준을 현재 example/layout.json의 열 수·항목 폭과 실제 grid 폭으로 계산하도록 수정되어 있었다. script/인라인 style/편집 클래스 부재 및 JavaScript 비활성 표시 검사도 유지되어 있다.

## 새 이동 기능 검증

`test/editor/transfer.test.ts`의 API·연결 이력·포인터 통합 테스트가 통과했다. 브라우저 `multi-container-transfer.spec.ts` 9개, `multi-container-transfer-touch.spec.ts` 2개, audit 9개를 합쳐 20개 시나리오를 3회 반복했다.

- 마우스 body→footer 이동 및 실제 DOM 위치·크기.
- header→body→footer 대상 전환과 이전 미리보기 복원.
- 모바일 실제 CDP 터치 이동과 대상 셀 기준 DOM 좌표, 본문 스크롤.
- 같은 ID 거절, API newId, 기본 비활성 및 실행 중 옵션 변경.
- 원본 제거·대상 추가, 선택·활성·포커스, 연결 Undo/Redo와 상대 후속 편집 차단.
- 밖 drop, Esc, pointercancel, 중복 drop, resize와 이동 구분.
- 이동 도중 컨테이너 제거·Manager destroy, ghost/placeholder 정리.
- 서로 다른 크기 제약/float/breakpoint, stale 취소.
- 콘텐츠 수명·예외 롤백·이벤트 재진입, history:false 및 연결 이력 무효화.
- JSON 저장/복원과 JavaScript 없는 Viewer 표시.

기존 multi-container 하네스, 단일 Editor, Sortable, Viewer를 포함한 전체 테스트도 실행했다. 아래 세 기존 모바일 실패를 제외하고 통과했다. 이는 실행한 테스트 범위의 결과이며 작업지시서 모든 경계 조건에 대한 무결함 증명은 아니다.

## 남은 실패

| 위치 | 실패 내용 | 분류 |
| --- | --- | --- |
| `e2e/touch.spec.ts:55` | 본문 스와이프 후 layout 동일성 실패. responsive.mobile 데이터가 추가됨 | 기존 단일 Editor 모바일 실패. 이전 검증에서는 본문 중앙이 확장된 리사이즈 핸들에 걸리는 것을 확인했음 |
| `e2e/verify-dragin-touch.spec.ts:61` | DIN-T3: 페이지 scrollY 기대 0, 전체 실행에서 실제 2px | 기존 팔레트 모바일 실패. 정확한 스크롤 발생 경로는 이번 재실행에서 확정하지 않음 |
| `e2e/verify-touch.spec.ts:73` | TCH-03: 화면 회전 뒤 터치 드래그 후 x/y가 바뀌지 않음 | 기존 단일 Editor 모바일 실패. 이전 검증에서 드래그 목표가 화면 아래로 벗어나는 입력 경로 문제 가능성을 기록했음 |

이번 이동 기능에서 새로 발생한 실패로 확인된 항목은 없다. 위 항목은 제품 동작과 테스트 입력 경로를 추가 분리해서 수정해야 한다.

## 격리 성능 측정

다른 테스트 실행이 끝난 뒤 workers=1로 측정했다. 현재 테스트 정의대로 컨테이너당 초기 10개 항목, 3회 중앙값이다. 시간 단위는 ms다. 이동은 API 커밋과 DOM 반영, Undo는 연결 Undo와 DOM 반영을 포함한다.

| 컨테이너 | 생성 | 편집 | 저장 | 복원 | 제거 | 이동 | 연결 Undo | 이동 활성 pointermove P95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2.8 | 1.7 | 0.1 | 0.3 | 1.7 | 해당 없음 | 해당 없음 | 0.5 |
| 5 | 11.4 | 5.0 | 0.3 | 1.3 | 3.0 | 2.9 | 1.6 | 1.3 |
| 10 | 19.4 | 9.6 | 0.4 | 2.3 | 3.8 | 1.4 | 1.0 | 1.1 |
| 25 | 38.8 | 21.2 | 0.4 | 3.4 | 7.0 | 1.4 | 1.1 | 1.9 |
| 50 | 80.0 | 34.9 | 2.7 | 6.9 | 11.9 | 2.2 | 1.1 | 2.5 |

50개에서 기존 항목 pointermove P95는 이동 옵션 OFF 0.6ms / ON 2.5ms였다. 외부 팔레트 pointermove P95는 2.6ms였다. 합성 PointerEvent 동기 처리 시간이며 전체 프레임 지연 측정은 아니다. 별도 워밍업을 추가하지 않은 기존 테스트의 3회 중앙값이므로 소규모 수치는 타이머 해상도·JIT·시스템 부하 영향을 받는다.

이전 검증의 50개 생성 44.0ms/제거 5.9ms보다 이번 값이 높다. 현재 측정에는 새 이동·연결 이력과 추가 드래그 단계가 포함되며 이전 코드의 동일 시점 대조 실행은 하지 않았다. 증가를 기록하되 모두 새 기능의 비용이라고 단정하지 않는다. 현재 성능 테스트의 제한값은 통과했다.

## 메모리·리소스

50개 컨테이너에서 컨테이너 간 이동과 Undo/Redo를 수행하고 해제하는 과정을 6회 실행했다.

- document 리스너 추가는 컨테이너 수와 같은 1/5/10/25/50개, 제거 후 증가분 0.
- 활성 ResizeObserver 50개 → 해제 후 0, 공유 위치 CSS 1개 → 해제 후 0.
- 해제 후 에디터 DOM 0. CDP 전체 nodes 39, jsEventListeners 16이 매회 일정했다(페이지·개발 서버 잔여분 포함).
- GC 후 힙(bytes): 2,612,344 → 2,620,048 → 2,628,988 → 2,638,844 → 2,657,376 → 2,663,064.
- 힙은 첫 회 대비 50,720 bytes 증가했다. 짧은 반복에서 DOM·리스너·observer·CSS의 누적은 관찰되지 않았으나 장기 누수 부재를 단정할 수 없다. heap retaining path 분석은 수행하지 않았다.

## 재현 명령

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js "src/**/*.ts"
node scripts/build.mjs
node node_modules/jest/bin/jest.js --runInBand
node --test scripts/*.test.mjs
node node_modules/@playwright/test/cli.js test --workers=2
node node_modules/@playwright/test/cli.js test e2e/multi-container-transfer.spec.ts e2e/multi-container-transfer-touch.spec.ts e2e/multi-container-audit.spec.ts --repeat-each=3 --workers=1
node node_modules/@playwright/test/cli.js test e2e/multi-container-perf.spec.ts e2e/multi-container-resources.spec.ts --workers=1
```

## 개선 결과 (2026-11-07, 후속 작업)

### 남은 모바일 실패 3건

| 항목 | 원인 (확인 방법) | 분류 | 조치 |
| --- | --- | --- | --- |
| `touch.spec.ts` 본문 스와이프 | 첫 카드 본문 중앙 (197, 657)의 `elementFromPoint` 가 `ddr-resize-handle[data-dir=s]`. s 핸들의 실제 박스는 y 671~695 인데 터치용 `::after` 44×44 가 핸들 우하단 기준으로 붙어 본문 중앙까지 덮었다 | **제품 결함** | `style/_editor.scss` 의 `@media (pointer: coarse)`: e/w/s 핸들의 터치 영역을 핸들 중심 기준 "변을 따라 44px × 안쪽 28px" 로 변경 |
| `verify-touch.spec.ts` TCH-03 | 이벤트 추적 결과 시작 `pointerdown` 이 `ddr-resize-handle` 에 잡혀 `resizeStart` 가 발생(드래그 대신 리사이즈). 위와 같은 확장 영역 결함. 또한 시작점이 화면 아래 끝(y 372/393), 목표점이 화면 밖(y 448)이었다 | **제품 결함** + 테스트 입력 경로 | CSS 수정. 테스트는 카드를 화면 위쪽으로 스크롤한 뒤 끌고, 시작·목표가 화면 안(자동 스크롤 영역 밖)인지 검사 |
| `verify-dragin-touch.spec.ts` DIN-T3 | 목표점 y 690 이 화면 아래 48px 자동 스크롤 영역(y ≥ 679) 안이라 끌어오기 자동 스크롤이 의도대로 동작했다. 영역 밖(y 627)에 놓으면 scrollY 0, 항목 추가 | **테스트 입력 경로** | 목표점을 자동 스크롤 영역 밖으로 두고, 제목대로 "드래그되어 추가됨"도 함께 검사(기대값 완화 없음) |

검증: CSS 수정을 되돌리면 본문 스와이프와 TCH-03 이 다시 실패하고, 수정하면 통과함을 확인했다. 재발 방지용으로 **TCH-05**(모든 카드의 본문 중앙·드래그 핸들 중앙이 리사이즈 핸들에 가려지지 않는지 실제 히트 테스트, 변 핸들의 변 방향 터치 영역 ≥ 44px)를 추가했다. TCH-05 도 옛 CSS 에서는 실패(카드 5개 본문 중앙이 s 핸들)한다.

### 성능·메모리 측정 보완

[performance.md §9](performance.md): 워밍업 + 5회 중앙값 + 같은 실행 안의 대조군(Manager 없이 생성)으로 바꿨다. Manager 생성과 대조군이 편차 범위에서 엇갈려(50개 55~68ms vs 55~60ms) 이전의 44 → 80ms 차이는 실행 간 편차로 판단했다. 리소스 테스트는 GC 후 살아 있는 `DriftEditor`/`DriftManager` 인스턴스 수를 CDP `queryObjects` 로 직접 세며, 6회 반복 후에도 기준값에서 늘지 않았다.

### 손대지 않은 것

* `dtsConsumer` 의 `npm pack` 이 NVM4306 으로 막히는 것은 환경 문제다. 이 작업 환경에서는 npm 이 차단되지 않아 617/617 통과했지만, 차단 환경에서 우회하도록 테스트를 바꾸지 않았다.
