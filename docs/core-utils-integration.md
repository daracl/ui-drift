# 공통 유틸 연동 검증

검증일: 2026-10-29. 환경: Node.js 24.20.0, npm 12.2.1.

## 의존성과 구현

- 공개 npm의 `@daracl/core@0.0.12`를 고정 버전으로 설치한다(최초 연동 0.0.9에서 갱신).
- `@daracl/core/utils`의 `cloneJson`, `clamp`, `camelToKebab`를 사용한다.
- 레이아웃·변경 이벤트·외부 끌어오기 복사는 기존 JSON 직렬화 계약을 유지한다.
- Viewer의 HTML 이스케이프는 작은따옴표와 백틱까지 보호하는 기존 구현을 유지한다.
- ESM/CJS/UMD는 사용한 공통 함수만 번들링한다. Viewer/core의 DOM 비의존성 검사는 통과했다.
- package.json, lockfile, npm 설정에는 로컬 파일·링크·인접 저장소 의존성이 없다.
- lockfile을 Git 추적 대상으로 바꾸고 Node/npm 버전과 팀원 설치 순서를 README에 명시했다.

## 실행 결과

- typecheck, lint, 전체 build 통과.
- 배포 타입 선언 25개 검사 통과.
- Jest: 27개 스위트, 367개 테스트 통과(신규 회귀 테스트 3개 포함).
- `npm ci --dry-run --ignore-scripts --offline` 통과: manifest와 lockfile 일치.
- 빈 임시 디렉터리에 manifest, lockfile, npm 설정만 복사한 `npm ci --ignore-scripts` 통과: 733개 패키지 설치. 설치 스크립트 실행은 이 검증에서 제외했다.
- Playwright: 개별 결과 로그상 115개 중 111개 통과, 4개 실패. 모든 테스트 결과 출력 후 종료가 지연되어 실행을 중단했다.
- 실패 항목은 기존 `cleanup-audit.md`에도 기록된 VWR-D 정적 예제 크기, 모바일 본문 스와이프, DIN-T3 터치 스크롤, TCH-03 화면 회전이다. 이번 작업에서 이 테스트나 기대값은 변경하지 않았다. 기존 기록과 실패 항목이 같다는 사실만 확인했으며 변경 전 대조 실행은 하지 않았다.

압축·충돌 알고리즘과 공개 API는 변경하지 않았다.

## 0.0.12 갱신 검증

공개 npm의 최신 배포 버전 0.0.12로 package.json과 lockfile을 갱신했다(0.0.10에서 갱신).
typecheck, lint, 전체 build, 배포 타입 선언 25개 검사 및 Jest 27개 스위트·374개 테스트가
모두 통과했다. 이번 버전 갱신에서는 Playwright를 다시 실행하지 않았다.
