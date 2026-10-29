# 빌드 설정 개선 기록

검증일: 2026-10-29. 환경: Windows, Node.js 24.20.0, npm 12.2.1.

## 적용 범위

`corejs`의 ESM 설정, Vite 내장 배너, Node 기반 빌드 조합 방식을 참고해 `ui-drift`만 변경했다.
corejs의 미커밋 변경은 수정하지 않았다. 공개 exports 경로와 배포 파일명은 유지했다.

| 항목 | 기존 | 변경 |
| --- | --- | --- |
| Vite | 5.4.21 | 7.3.7 (`~7.3.7`) |
| 설정 로딩 | `.js`의 ESM 구문, CJS API deprecated 경고 | `.mjs`, ESM API |
| 파일 복사/정리 | cpx, rimraf | Node fs API, 링크 경로 보호 |
| 라이선스 배너 | vite-plugin-banner | Rollup banner + esbuild legalComments |
| UMD 압축 | terser, 2회 압축 | esbuild |
| CSS | Sass CLI 프로세스 3회 | Sass modern API |
| 전체 빌드 | npm 단계별 순차 실행 | 정리 1회 후 번들/CSS/타입 선언 병렬 생성 |
| 크기 리포트 | 매번 gzip 크기 계산 | `reportCompressedSize: false` |

기본 브라우저 대상이 Vite 업그레이드만으로 바뀌지 않도록 기존 Vite 5의 대상
`es2020/edge88/firefox78/chrome87/safari14`를 명시했다. 타입 생성은
`tsc → 원본 .d.ts 복사 → tsc-alias → 검사` 순서를 유지한다.
각 병렬 작업의 실패는 모두 수집한 뒤 비정상 종료한다.

개별 `build:esm`은 기존처럼 dist를 정리하므로 다른 빌드 명령과 수동으로 병렬 실행하면 안 된다.
전체 빌드 명령이 출력 정리와 병렬 생성을 조정한다.

## 보안 검사

공개 npm 레지스트리의 audit 결과이며 취약 패키지 수에는 상위 의존성의 파생 항목이 포함된다.

| 분류 | 변경 전 | 변경 후 |
| --- | ---: | ---: |
| 높음 | 3 | 0 |
| 보통 | 7 | 0 |
| 낮음 | 7 | 7 |
| 전체 | 17 | 7 |
| 런타임만 검사 | — | 0 |

- cpx를 제거하면서 오래된 chokidar/micromatch/braces 등의 취약 경로를 제거했다.
- Vite/esbuild의 개발 서버 관련 취약 경로는 Vite 7.3.7로 갱신해 해소했다.
- 직접 개발 의존성 4개(cpx, rimraf, terser, vite-plugin-banner)를 제거했다.
- 남은 낮음 7건은 Jest → jest-config → deepmerge 및 상위 의존성의 파생 경고다.
  현재 공개 최신 deepmerge 4.3.1도 권고 범위에 포함된다. npm이 제시하는 Jest 25 강제
  다운그레이드는 테스트 도구의 호환성을 깨므로 적용하지 않았다. 전체 audit은 여전히 실패 상태다.
- 서버는 loopback 바인딩을 유지하고 preview도 loopback으로 제한했다. CORS 전체 허용이나
  파일 접근 제한 해제 없이 패치 버전을 사용한다.

## 검증 방법

`npm run build` 전체를 PowerShell Stopwatch로 각각 3회 측정한다. npm 실행·Node 시작·정리를
모두 포함하며, 스크립트 내부 타이머와 구분한다. 같은 작업 디렉터리의 설치된 의존성과
운영체제 캐시를 사용했다. 시스템 부하에 따라 값은 달라질 수 있다.

보안 검사: `npm run audit:security` / `npm run audit:security:all`.
추가 회귀 검사: `npm run test:scripts`와 `test/build/distConsumer.test.ts`의 UMD/라이선스 검사.

## 측정 결과

| `npm run build` | 1회 | 2회 | 3회 | 중앙값 |
| --- | ---: | ---: | ---: | ---: |
| 변경 전 | 18.22초 | 14.72초 | 17.45초 | 17.45초 |
| 최종 변경 후 | 5.45초 | 6.11초 | 6.57초 | 6.11초 |

중앙값 기준 약 **65% 단축**됐다. 최종 빌드 로그에서 deprecated 경고는 발생하지 않았다.
UMD는 압축기 교체로 50.49 kB에서 52.28 kB로 약 3.5% 커졌다. 산출물 크기와 빌드 시간의
교환이며, 전역 API와 라이선스 배너는 회귀 테스트로 확인한다.

- typecheck, lint, 전체 build 및 배포 타입 선언 25개 검사 통과.
- Node 빌드 스크립트 테스트 5개 통과(복사·정리·원본 보존·링크 경로 보호).
- 최종 Jest: 27개 스위트, 374개 테스트 모두 통과. Viewer/core DOM 비의존성,
  npm pack 소비자 타입 검사, UMD 전역 API와 모든 진입점의 라이선스 배너 검사를 포함한다.
- `npm ci --dry-run --ignore-scripts --offline` 통과: manifest와 lockfile 일치.
- Playwright 개별 로그: 115개 중 111개 통과, 4개 실패. 모든 결과 출력 후 종료가 지연돼 실행을 중단했다.
  이번 변경 직전 실행과 같은 실패 항목은 VWR-D 정적 예제 크기, 모바일 본문 스와이프,
  DIN-T3 터치 스크롤, TCH-03 화면 회전이다. 테스트나 기대값은 변경하지 않았다.
- Node 소비자 검사에는 기존 `MODULE_TYPELESS_PACKAGE_JSON` 경고가 남는다.
  배포 파일 확장자와 package scope 전환은 이번 빌드 설정 개선에 포함하지 않았다.

## 참고 근거

- [Vite 7 마이그레이션: Node 요구 사항·기본 target·Sass API 변경](https://v7.vite.dev/guide/migration.html)
- [Vite 보안 권고](https://github.com/vitejs/vite/security/advisories)
- [braces 자원 소모 취약점](https://github.com/advisories/GHSA-grv7-fg5c-xmjg)
- [deepmerge prototype poisoning 권고](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
