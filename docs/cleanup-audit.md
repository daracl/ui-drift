# 미사용 코드 정리 검토 기록

분석일: 2026-10-27. 시작 시 `git status --short` 출력은 없었으며 기존 사용자 변경 사항은 없었다.

## 분석 범위와 방법

- Git 추적 파일 112개를 대상으로 소스 25개, 타입 선언, SCSS, 테스트, 하네스, 예제, 문서, 빌드·배포·벤치마크 설정의 참조 경로를 조사했다.
- TypeScript AST로 import/export 관계와 선언을 조사하고, `tsc --noEmit --noUnusedLocals --noUnusedParameters`로 지역 선언을 추가 검사했다. 검색 결과만으로 삭제하지 않고 초기화 부작용, 공개 export, 테스트 호출, 설정과 생성 경로를 확인했다.
- TypeScript 모듈 해석기로 공개 진입점 4개에서 도달 여부를 확인했다. 소스 25개 중 도달하지 못하는 파일은 0개였다.
- `index → viewer/core + editor`, 별도 core/viewer entry, `index.umd.ts`의 전역 등록, 이벤트 리스너·콜백, HTML의 모듈 스크립트, 배포 소비자 테스트의 require/import 경로를 확인했다.
- npm scripts, Vite의 세 설정과 공통 설정, Jest/Playwright 자동 탐색, TypeDoc, Sass `@use`, 예제 생성과 스크린샷 출력 경로를 확인했다. Git 제외 디렉터리의 기존 임시 파일은 소유권과 사용 여부를 보장할 수 없어 정리 대상에서 제외했다.

## 변경 전 후보 검토

| 파일 | 후보 및 근거 | 결정 / 예상 영향 |
| --- | --- | --- |
| `test/editor/dragin-autoadd.test.ts` | `STRIDE_X`는 TS6133. 그 초기화에만 쓰이는 `CELL`도 연쇄 미사용. 실제 좌표는 `strideOf()`와 `columnsOf()`로 계산한다. 두 초기화는 숫자 산술뿐이다. | 두 상수 삭제. 테스트 입력·기대값과 제품 코드에 영향 없음. |
| `test/editor/dragin.test.ts` | `byId`는 TS6133이며 테스트에서 호출하지 않는 화살표 함수 선언이다. `DriftItem` 타입은 다른 테스트가 사용한다. | 도우미만 삭제, 타입 import 유지. 테스트 실행 경로에 영향 없음. |
| `test/editor/contentLifecycle.test.ts` | update의 중간 인자 `contentEl`, 특정 mount의 첫 인자 `item`은 TS6133. 뒤 인자를 받기 위해 인자 위치는 필요하다. | `_contentEl`, `_item`으로 이름만 변경. 콜백 계약과 인자 순서 유지. |

테스트 케이스와 assertion은 삭제·수정하지 않는다. 제품 소스, 공개 API, 설정, 의존성, 리소스 파일 삭제는 하지 않는다.

## 유지한 항목과 이유

| 항목 | 근거 / 남은 검토 사항 |
| --- | --- |
| 공개 core 함수, Editor 메서드와 타입 | 저장소 내 호출이 없어도 패키지 소비자가 사용한다. 공개 entry와 배포 선언을 유지한다. |
| `resolveScrollTarget` | 현재 제품 경로는 `resolveScrollElement`와 `measureScrollTarget`을 따로 사용하지만 `test/editor/scrollContainer.test.ts`가 조합 함수를 직접 검증한다. 테스트 경로 변경은 제외한다. |
| `APP_VERSION` define 및 전역 선언 | 제품 내 사용은 발견되지 않았으나 개발·빌드에 주입하는 설정 계약이므로 유지한다. 외부 하네스 사용 여부는 확인할 수 없다. |
| 반응형 `deriveItems` / `reflowByOrder` | 배치 반복문이 유사하나 전자는 열 변환, 후자는 편집 순서 반영이며 입력 순서·폭 정책이 다르다. 통합은 리팩터링이므로 제외한다. |
| 두 컨트롤러의 자동 스크롤 | 유사하지만 드래그와 외부 끌어오기 세션·종료·미리보기 경로가 다르다. 통합하지 않는다. |
| SCSS, 예제 HTML/CSS, 검증 PNG | npm 배포 `files`와 CSS 빌드, 예제 생성 스크립트, Playwright 출력 및 검증 문서에서 사용한다. 선택적 Viewer 스타일도 유지한다. |
| Vite 세 설정 및 공통 설정 | 라이브러리 ESM/CJS, UMD, 테스트 개발 서버의 각 진입 경로가 다르다. 공통 설정도 import된다. |
| 테스트 간 유사 도우미와 검증 스펙 | 좌표·캔버스·시나리오가 다르고 자동 탐색 대상이다. 테스트 재구성은 제외한다. |
| 스크립트의 console 출력 | 검사 실패 안내, 예제 생성 완료, 벤치마크 결과 출력이다. 제품 소스의 디버깅 로그는 발견되지 않았다. |

런타임 의존성은 0개다. 개발 의존성은 TypeScript·Node/Jest 타입, ESLint parser/plugin/Prettier 연동, Jest/jsdom/ts-jest, Playwright, Vite/banner/terser, Sass, rimraf, cpx, tsc-alias, TypeDoc 및 포매터의 직접·설정·CLI 사용이 확인되어 제거하지 않았다.

## 검증

기본 Node shim은 활성 버전 미설정으로 실패했다. 설치된 Node v24.20.0 디렉터리를 검증 프로세스의 PATH 앞에만 추가했다. PowerShell 실행 정책에 막힌 `npm.ps1` 대신 `npm.cmd`를 사용했으며 시스템 설정은 변경하지 않았다.

- 변경 전: typecheck, lint, 전체 build 통과. 배포 타입 검사 25개 통과.
- 변경 전 추가 미사용 검사: 테스트 3개 파일에서 TS6133 4건. 이 중 상수의 연쇄 의존 선언까지 검토했다.
- 변경 전 Jest: 26개 스위트 중 25개 통과, 364개 테스트 중 360개 통과·4개 실패. `npm pack`이 기본 npm 캐시 쓰기에서 EPERM으로 실패했다. 프로세스의 `npm_config_cache`를 `.tmp/npm-cache`로 지정한 재검증에서 배포 타입 테스트 9개 모두 통과했다.
- 변경 후: `npm.cmd run typecheck`, `npm.cmd run lint`, `tsc --noEmit --noUnusedLocals --noUnusedParameters` 모두 통과. 추가 미사용 진단은 4건에서 0건으로 줄었다. 수정 중 다른 mount 인자의 이름을 바꾼 실수는 타입 검사에서 발견해 바로잡았고 이후 재검증했다.
- 변경 후 `npm.cmd run build`: ESM/CJS, UMD, CSS, 타입 선언 생성 및 배포 타입 검사 25개 모두 통과. Vite CJS Node API 사용 중단 예정 경고는 기존 구성에서 발생하며 이번 범위에서는 변경하지 않았다.
- 변경 후 Jest(`--runInBand --silent`): 26개 스위트, 364개 테스트 모두 통과, skip 0개.
- 수정한 테스트 3개에 Prettier 검사 통과. `git diff --check` 통과.
- Playwright 전체(`--workers=2`): 115개 중 111개 통과·4개 실패. 실패 항목만 `--workers=1 --repeat-each=2`로 재실행한 8회 모두 실패하여 재현됐다. 실패를 성공으로 처리하거나 기대값을 낮추지 않았다.

## 발견된 기존 검증 문제

| 실패 항목 | 관찰 결과와 분류 |
| --- | --- |
| VWR-D 정적 예제 | a의 폭이 300px 초과여야 한다는 기대에 실제 204px. 예제는 24열 중 4열 폭이므로 테스트의 고정 폭 기대와 맞지 않는다. 기존 예제/테스트 불일치로 판단하며 수정하지 않았다. |
| 모바일 본문 스와이프 | 스와이프 후 레이아웃이 변경되어 동일성 검증 실패. 제품 동작과 터치 시작 좌표·입력 시뮬레이션 중 어느 쪽이 원인인지는 미확정. |
| DIN-T3 팔레트 터치 | 페이지 scrollY 기대 0, 실제 2. 자동 스크롤·브라우저 스크롤 원인 구분은 미확정. |
| TCH-03 회전 후 드래그 | 항목 a의 좌표가 바뀌어야 한다는 검증 실패. 이동 거부와 입력 시뮬레이션 원인 구분은 미확정. |

E2E가 읽는 `src/`, `style/`, `uitest/`, `example/`, `e2e/`, 설정과 의존성에는 diff가 없다. 수정된 Jest 파일은 E2E 진입 경로에 포함되지 않으므로 이번 정리가 브라우저 실행 코드를 바꾸지는 않는다. 다만 변경 전 전체 E2E를 별도 실행하지 않았으므로 실패의 과거 발생 빈도까지 단정하지 않는다.

## 최종 변경 요약

- 삭제 파일 0개, 제거 의존성 0개, 제품 소스·API·설정 변경 0개.
- 테스트 3개 파일: 미사용 선언 3개 삭제, 콜백 인자 2개 이름 변경. 기존 테스트 diff는 2줄 추가·5줄 삭제다.
- `docs/cleanup-audit.md`: 분석 방법, 후보 사전 검토, 파일별 변경 근거, 유지 대상, 검증과 미해결 사항을 기록했다.
- 테스트가 덮어쓴 검증 PNG는 실행 전 백업한 바이트로 복원하고 분석용 임시 파일은 제거한다. 기존 Git 제외 파일은 삭제하지 않는다.

외부 소비자의 비공개 사용 경로, Firefox/WebKit 및 실기기 동작은 이번 정적 분석으로 증명할 수 없다. 미확인 경로를 근거로 코드를 삭제하지 않았다.
