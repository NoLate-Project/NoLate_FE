# P1-2 경로 입력 정규화·품질 계약 검증

작성일: 2026-10-04. 범위는 **읽기 전용 경로 입력 검증**이다. 실제 대중교통 자동 길안내의 완성이나 P0 외부 데이터 게이트 통과를 뜻하지 않는다.

## 구현 범위

기존 TMAP/ODsay 파서에 엔진용 원본 증거 `navigationEvidence`를 추가했다. 화면 표시용 경로·정류장 파싱은 유지한다. 반복 방문 정류장, 빈 행, 원본 배열 위치, 공급자가 명시한 순번·정류장 수·방면을 별도로 보존하고 표시용 재번호나 추정값으로 대신하지 않는다.

현재 연결은 다음과 같다.

```text
기존 공급자 파서 → navigationEvidence 포함 TransitLegDetail
→ bounded allow-list JourneyRouteInput → Foundation Swift RouteNormalizer
→ 좌표·정류장명·식별자를 제외한 품질 요약 → 개발 전용 검사 화면
```

- `journeyRouteInput.ts`: 실제 `RouteAlternativeOption`/`TransitRouteOption` 구조를 받는 순수 어댑터. 선택 출발·도착 좌표는 구간 형상과 독립적으로 전달한다. 원본 객체를 변경하지 않는다.
- `NoLateJourneyRouteNormalizer.swift`: 형상 출처·좌표·방향·구간 연결·정류장 순서/투영을 검증한다. 좌표를 보정하거나 누락점을 삭제해 선으로 연결하지 않는다.
- `journeyRouteAssessment.ts`: 개발 iOS 전용 네이티브 연결, 전송 시점 입력 snapshot, 응답 버전·revision·개수·허용 필드·판정 간 일관성 검사. 오류 문자열이나 원본 좌표를 화면으로 반환하지 않는다.
- `/internal/journey-route-quality`: 여섯 합성 예시를 명시적으로 검사하는 개발 화면. 선택 변경 시 이전 결과를 지우고 늦은 응답을 무시한다.

네이티브 호출은 `DEBUG && simulator && NoLateJourneyDiagnosticsEnabled`에서만 허용한다. 이 호출은 P1 Runtime 준비/시작·Core Location·일정·알람·서버·ActivityKit을 호출하지 않는다. `fullAutomaticGuidance`와 `fieldValidated`는 항상 false다. 검사 버튼은 개발 도구이며 출발·탑승·하차를 수동 확정하는 제품 버튼이 아니다.

## 안전하게 보류하는 조건

| 영역 | 현재 계약 |
| --- | --- |
| 형상 출처 | 도보의 직접 steps/passShape, 대중교통의 직접 passShape/graph만 허용 후보. 정류장 직선·itinerary snap·알 수 없는 별칭은 차단 |
| 원본 보존 | `geometryInputComplete=true`는 전체 원본 유효점 검사와 전달 형상 동일성을 만족해야 함. TMAP 인접 중복 제거만 허용. 점 축약·샘플링으로 루프/역행이 사라지면 false |
| 출처 버전 | 모든 구간의 geometry evidence provider가 경로 provider와 같고 version 1이어야 함. true 플래그 하나만 신뢰하지 않음 |
| 형상 이상 | 결측·범위 밖 좌표, 0길이, 중복/역행/교차, 큰 점 간격, 출발·도착 불일치는 보류. 무효 중간 점을 삭제하지 않음 |
| 정류장 | 원본 행 보존, 원본 순번의 연속 증가, 명시 stationCount와 구간 수 일치, 코드·좌표·형상 투영·진행 순서를 함께 검사. 반복 방문/평행선 투영이 모호하면 보류 |
| 도보 출발 후보 | 첫 도보 형상·독립 선택 출발/도착·구간 연결·경로 품질을 확인. 길이 70m 미만은 후보로 삼지 않음. 적격 요약도 실제 준비/시작을 수행하지 않음 |
| 저장/합성 | `SAVED_ROUTE`는 재검증 필요. `SYNTHETIC_FIXTURE`는 구조 검사만 가능. 두 context 모두 실제 출발·탑승 적격 없음 |
| 정보 의미 | provider 이름, `live_provider`, `operating`, 정류장 코드, 방면 문자열만으로 실시간 위치·차량 식별·최신성·실주행 정확도를 보증하지 않음 |

좌표 끝점 허용거리 75m, 구간 사이 연결 150m, 점 사이 간격 상한은 도보 150m / 버스 2km / 지하철 5km다. 현재 보수적인 개발 정책이며 현장 검증된 임계값이 아니다.

입력 한도: JSON 1MiB, 32구간, 구간당 형상점 2,000개(총 12,000), 구간당 정류장 500개(총 2,000), 문자열 UTF-8 256바이트. 공급자 파서는 500정류장 초과 시 증거 전체를 생략하며 부분 목록을 완전한 목록으로 보이지 않는다. 교차 검사 200,000회 상한을 넘는 복잡한 형상은 보수적으로 보류한다. 따라서 실제로 정상인 긴/복잡한 경로도 현재는 지원되지 않을 수 있다.

ODsay 도보는 기존 파서가 여러 connector를 재조립하므로 이번 계약에서 원본 완전성을 인정하지 않는다. TMAP의 현재 파서는 provider route ID를 확립하지 않아 합성 정상 사례에서도 `PROVIDER_ROUTE_ID_MISSING`을 유지한다. 외부 API 사이 ID namespace·노선 방향 매칭은 후속 과제다.

## 테스트와 시뮬레이터

Swift package 신규 normalizer 49개를 포함한 136개 PASS. iOS 16.6 simulator 대상 Swift 6 strict typecheck PASS. 최신 소스를 포함한 Debug iOS 통합 빌드 exit 0 및 진단 plist true 확인. 기존 의존성 경고/Swift 작업의 exit-0 진단 문자열은 남아 있으며 로그가 경고 없이 깨끗하다는 의미는 아니다.

| 검증 | 최종 결과 |
| --- | --- |
| Swift package | 136 PASS, 신규 normalizer 49개 포함 |
| FE 전체 Jest | 269 suites / 2,155 tests PASS, 이번 신규 216개 포함 |
| 신규 FE 구성 | 공급자 evidence 68 + 어댑터/응답/화면 142 + 실제 파서 연결 fixture 6. 전체 회귀에 포함되므로 더하지 않음 |
| TypeScript 전체 | PASS |
| 이번 수정 FE 소스·테스트 ESLint | 오류 0 / 경고 0. 저장소 전체 lint 결과를 뜻하지 않음 |
| 진단 설정 회귀 | 7 PASS |
| iOS Debug simulator 빌드 | PASS, 최종 normalizer source보다 새 object 및 설치된 바이너리 확인 |
| 독립 창 E2E | 아래 여섯 합성 입력 + 미수집 확인 PASS |

대상은 기존 **NoLate Journey P0 Isolated 20261004**, iPhone 17 Pro / iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`이다. GUI는 Computer Use로 독립 `deviceWindow-AppWindow-4`를 조작한다. Xcode 27에서 이 독립 창의 소유 프로세스 이름은 Device Hub지만 관리 패널은 사용하지 않는다. 다른 시뮬레이터·연결된 iPhone/Watch는 건드리지 않는다.

시험 입력은 **공급자 형식을 흉내 낸 합성 데이터 → 실제 TMAP 파서 → 실제 어댑터 → 실제 네이티브 코어**다. 실제 API 응답을 수집한 기록이나 실노선 E2E가 아니다. 외부 공급자 조회·비밀 값 접근 없이 수행한다. 앱 화면은 실제 네이티브 응답을 사용하며 Jest처럼 응답을 mock하지 않는다.

### 독립 창 E2E 관측

최종 코드를 반영한 Metro 재시작 후 2026-10-04 약 12:22–12:26 KST에 실행했다. 화면의 예시 선택·검사 버튼을 실제로 눌렀으며, 매 선택 후 이전 완료 결과가 사라지는 것도 확인했다. 각 검사 후 현재 AX와 안정된 스크린샷을 함께 확인했다.

| 시나리오 | 실제 관측·증거 |
| --- | --- |
| 최초 화면 | 검사 전, 자동 길안내 OFF, 합성·실주행 미검증 명시. [화면](evidence/journey-p1-2-20261004/01-initial.jpeg) |
| 직접 형상 | 도보 132.2m / 버스 881.4m / 도보 132.2m, 형상점 각 3개. 버스 원본 정류장 3개와 순서·명시 방향 검사 통과. `SYNTHETIC_FIXTURE_ONLY`, `PROVIDER_ROUTE_ID_MISSING`은 유지. [결과](evidence/journey-p1-2-20261004/02-direct-shape.jpeg) |
| 정류장 직선 대체 | BUS 형상 보완 필요, `GEOMETRY_PROVENANCE_UNTRUSTED`, `GEOMETRY_NOT_EXACT`, `GEOMETRY_INPUT_UNVERIFIED`, `STOP_GEOMETRY_UNUSABLE`. [결과](evidence/journey-p1-2-20261004/03-stop-line-blocked.jpeg) |
| 원본 정류장 순서 누락 | 형상은 통과하나 정류장 순서는 보완 필요, `STOP_SEQUENCE_UNVERIFIED`. 정류장 3행을 지우거나 재번호로 승격하지 않음. [결과](evidence/journey-p1-2-20261004/04-missing-order-blocked.jpeg) |
| 역방향 형상 | `ORIGIN_MISMATCH`, `FIRST_WALK_GEOMETRY_UNUSABLE`, `GEOMETRY_ENDPOINT_MISMATCH`. 임의 뒤집기 없음. [결과](evidence/journey-p1-2-20261004/05-reversed-shape-blocked.jpeg) |
| 이전 저장 경로 | `SAVED_ROUTE_REVALIDATION_REQUIRED`; 원본 근거 없는 geometry/stop evidence 불인정. 기존 표시용 정류장에서 증거 재생성 안 함. [결과](evidence/journey-p1-2-20261004/06-saved-route-blocked.jpeg) |
| 중간 좌표 오류 | 형상점 3개 유지, 길이 확인 불가, `GEOMETRY_COORDINATE_INVALID`. 오류점을 버린 2점 선분으로 바뀌지 않음. [결과](evidence/journey-p1-2-20261004/07-invalid-point-blocked.jpeg) |
| 검사로 Runtime을 시작하지 않음 | 검사 여섯 번 뒤 P1 화면 재진입: IDLE / 출발 0회 / 입력 NONE / sequence 0 / NOT_COLLECTING / 저장 없음. [결과](evidence/journey-p1-2-20261004/08-runtime-not-started.jpeg) |

검사 전 앱은 지난 P1 시험의 STOPPED 상태였고, 최신 바이너리/번들 재실행 뒤 IDLE이 됐다. 이번에는 위치 주입·위치 권한 조작·엔진 arm/replay/restore를 실행하지 않았다. 빠른 요청 경합·늦은 응답 차단은 Jest에서 검증했으며, OS 수준 레이스를 화면에서 재현한 것으로 보고하지 않는다. 형상 샘플링 손실·루프/평행선·입력 상한은 단위 테스트로 확인했으며 여섯 화면 예시를 모든 지리적 상황의 E2E로 일반화하지 않는다.

### 재현 명령

```sh
swift test --package-path modules/nolate-live-activity
EXPO_NO_DOTENV=1 npm run typecheck
EXPO_NO_DOTENV=1 npm test -- --runInBand --no-watchman
EXPO_NO_DOTENV=1 node --test scripts/journey-diagnostics-config.test.mjs
```

새 Swift 파일이 추가되므로 Metro만 갱신한 기존 바이너리로는 검증할 수 없다. 진단 opt-in Debug simulator 빌드와 pod source 등록이 필요하다. 일반 빌드에 진단 권한을 남기지 않도록 임시 Info.plist·Xcode project·Podfile.lock 3개 변경은 시험 후 원복했고 해당 파일 diff가 비었음을 확인했다. `.env`는 읽거나 수정하지 않았다. 커밋·푸시는 수행하지 않았다. 진단용 설치 바이너리와 8088 Metro는 재확인용으로 유지한다.

임시 로그: `/private/tmp/nolate-p1-2-normalizer-swift-tests.log`, `/private/tmp/nolate-journey-p12-build-20261004.log`, `/private/tmp/nolate-journey-p12-jest-20261004.log`, `/private/tmp/nolate-journey-p12-typecheck-20261004.log`, `/private/tmp/nolate-journey-p12-lint-20261004.log`, `/private/tmp/nolate-journey-p12-config-20261004.log`. 로그는 로컬 임시 파일로 장기 보존을 보장하지 않으며, 위 스크린샷은 저장소 문서와 함께 보관한다.

## 남은 범위와 다음 단계

이번 단계는 경로 구조의 입구를 검증한다. 기존 지도 경로 선택/실제 일정에서 자동 엔진을 준비하는 연결은 아직 없다. 버스/열차 자동 탑승, 한 정류장 전 하차 안내, 환승, 도착, 음성·무음 알림, 실제 Live Activity APNs와 잠금 화면은 미검증이다. P0 공급자·실기기 게이트와 P1-1의 전체 만료/권한 철회 미실행 항목도 그대로 남는다.

다음은 검증된 선택 경로를 Runtime 준비 계약에 연결하고, 자동 관측/출발의 서버 멱등성·오프라인 동기화를 구성하는 P1 후속 slice다. 경로 부족을 수동 단계 전환 버튼으로 대신하지 않는다. 실시간 버스·지하철 도착정보와 정류장/차량 식별이 검증되기 전에는 구조 검사를 실주행 가능 판정으로 승격하지 않는다.
