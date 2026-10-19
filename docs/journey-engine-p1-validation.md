# 길안내 엔진 P1 부분 구현 검증

기록일: 2026-10-04 (Asia/Seoul)

상태: **P1-1 순수 코어·개발 연결부 구현, 독립 시뮬레이터 주요 E2E 확인**. 이번 범위는 고정 합성 경로에서 위치 입력으로 `ARMED → ACTIVE` 자동 출발을 판정하는 첫 slice다. 버스·지하철 탑승·하차·환승·도착 안내가 완성된 상태가 아니다. 전체 P1 완료나 실주행 검증을 의미하지 않는다.

[P0 검증 기록](journey-engine-p0-validation.md)의 전체 게이트는 여전히 미통과다. 실제 교통정보·APNs·하드웨어 검증이 없어도 외부 서비스와 독립적인 순수 코어 및 합성 재생을 개발할 수 있다는 범위에서 진행한다. **P1 일부 코드·단위 테스트가 있다는 이유로 P0를 통과 처리하지 않는다.**

실제 기기와 사용자의 실제 이동 기록은 사용하지 않는다. `.env`를 읽거나 변경하지 않고, 커밋·푸시·운영 데이터 변경도 수행하지 않는다.

## 1 이번 구현의 경계

| 구성 | 이번 P1-1 범위 | 아직 포함하지 않는 것 |
| --- | --- | --- |
| Foundation Swift Core | 경로 투영, 관측 유효성, 이동 증거, 출발 판단, 종료·만료, checkpoint 복구 시 신뢰도 초기화 | Core Location·네트워크·지도 UI·실제 차량 추적 |
| iOS 개발 Runtime | 명시적 준비 후 합성 재생 또는 simulator 위치 수신, 제한 시간, 로컬 저장, 상태 이벤트 | 실제 기기 실행, 실제 일정과의 세션 연결 |
| RN bridge와 개발 화면 | 상태 조회·구독, 동의 후 준비·복구, 시험 종료, 화면만 닫기 | 단계 수동 확정, 제품용 길안내 화면 |
| 서버·안내 채널 | 기존 기능과 분리, 호출하지 않음 | 실제 schedule 출발 처리, 알람 취소, journey API mutation, 음성 안내, Live Activity/APNs 연결 |

개발 화면 경로는 `/internal/journey-engine`이다. 상태 조회나 화면 진입만으로 추적·복구를 시작하지 않는다. 준비 전 최대 10분의 개발 시험에 동의해야 하며, 준비 버튼은 출발 완료를 확정하지 않는다.

화면의 `ACTIVE`는 **이번 합성 시험에서 이동 증거가 충족됐음**을 의미한다. 서버 일정에 출발 완료를 기록하거나 기존 출발 알람을 취소하는 신호로 연결하지 않았다. `ACTIVE` 자체가 버스에 탑승했거나 선택 대중교통 경로가 맞다는 의미도 아니다.

## 2 입력과 실행 제한

- 네이티브 Runtime과 bridge 실행부는 `DEBUG && targetEnvironment(simulator)`로 제한한다.
- 진단 빌드 opt-in `NOLATE_JOURNEY_DIAGNOSTICS_BUILD=1`이 추가로 필요하다. 일반 빌드에서 활성화하지 않는다.
- JS bridge는 `__DEV__`와 iOS를 확인하고, 미지원 네이티브 빌드에서는 재빌드 필요 상태를 반환한다.
- 입력은 `SIMULATOR_LOCATION` 또는 `TIMED_REPLAY` 두 종류뿐이다.
- 두 입력 모두 합성 경로 시험용이며 실제 운행 검증으로 승격하지 않는다.
- 경로는 서울시청 인근의 공개 좌표 `37.5665,126.9780 → 37.5665,126.9880`을 잇는 고정 합성 선분이다. 실제 보행로·버스 도로 형상이라고 주장하지 않는다.
- 재생은 동일한 합성 선분을 따라 이동하는 기록이며, 사용자의 위치 trace를 가져오지 않는다.

Runtime singleton이 제한된 시험의 수명을 소유하고 화면은 구독자다. 화면만 닫거나 JS 구독을 해제할 때 `stop`을 호출하지 않는다. 명시적 ‘시험 종료’는 별도 동작이다. JS 테스트와 아래 독립 시뮬레이터의 화면 이탈·잠금·복구 시험에서 이 동작을 확인했다. OS 강제 종료 이후 무조건적인 자동 재개는 지원하지 않는다.

## 3 자동 출발 판정과 보수적 중단

현재 정책 기본값은 합성 fixture 검증용이다. 실측 튜닝이나 출시 정확도를 증명하는 임계값이 아니다.

- 출발지 반경 35m 이내의 유효 위치로 시작점을 먼저 확인한다.
- 시작점 이후 최소 70m의 전방 이동, 독립적인 이동 증거 최소 3개, 이동 증거 지속 시간 최소 8초를 함께 요구한다.
- 낮은 정확도, 오래되거나 미래인 관측, 역순·중복 관측, 다른 session/generation/routeRevision/epoch, GPS jump, 역방향·경로 이탈을 출발 증거로 누적하지 않는다.
- 짧은 간격의 작은 전방 이동은 누적할 수 있지만, 정지한 GPS 흔들림과 중복 좌표는 이동 근거를 증가시키지 않는다.
- 동일 세션의 출발 이벤트 key를 보존해 복구와 반복 입력으로 출발을 다시 발행하지 않도록 한다.

중요한 현재 한계: **GPS 신뢰도가 끊겨 이동 증거 chain이 초기화된 뒤 이미 출발지 35m 밖이라면 자동 출발 판정을 보류한다.** 위치가 다시 들어온다는 이유만으로 과거 출발을 추측하지 않는다. 시작점을 안전하게 다시 확인할 때까지 `ARMED`에 남을 수 있으며, 이것을 수동 ‘출발했어요’ 버튼으로 보완하지 않는다. 실제 경로에서의 재획득 전략은 후속 설계·현장 검증 과제다.

복구도 오래된 이동 chain을 이어 붙이지 않는다. 저장된 `ACTIVE`를 복구했더라도 새로운 위치를 받기 전까지 최신 추적이 계속됐다고 표시하거나 과거 출발 음성·알림을 재생하지 않는다.

## 4 확인된 테스트

| 검증 | 확인된 결과 | 증거의 범위 |
| --- | --- | --- |
| Swift Core 집중 테스트 | 39 PASS | 순수 판정·projection·입력 fence·복구·결정성 |
| checkpoint 실패 주입 테스트 | 18 PASS | 일회성 복구, 저장 실패, 명시 종료, 읽기 크기 제한, 파일 무효화 실패 |
| Swift package 전체 | 87 PASS | Core 39개 + checkpoint 18개 + 기존 정책·모델 30개. UIKit/Core Location Runtime은 이 package 테스트 대상에서 제외 |
| 신규 FE bridge·화면 | 21 PASS | 개발·플랫폼 guard, 허용 필드 정규화, 명시적 동의, 구독 cleanup, 늦은 응답, 서버 호출 분리 |
| P0+P1 집중 FE | 33 PASS | 기존 P0 12개와 신규 P1 21개 포함 |
| FE 전체 Jest | 264 suites / 1,939 tests PASS | `/private/tmp/nolate-journey-p1-jest-20261004.log` 최종 요약 확인 |
| TypeScript typecheck | PASS | 신규 FE 연결부 포함 |
| 소유 FE 파일 ESLint | 오류 0 / 경고 0 | bridge·화면·신규 테스트 2개·layout. 저장소 전체 경고 0을 의미하지 않음 |
| 진단 빌드 설정 회귀 | 7 PASS | 일반 빌드·진단 opt-in·일반 빌드 복원, 실제 Expo plugin chain 검사 |
| P1 iOS 통합 빌드 | PASS | 최종 Runtime와 checkpoint 포함 Debug simulator xcodebuild exit 0. 기존 의존성 경고는 남음 |
| P1 독립 시뮬레이터 E2E | 주요 시나리오 PASS | 아래 결과 표. 미실행 항목은 별도 유지 |

집중 테스트와 전체 테스트는 포함 관계이며 서로 더하지 않는다. P0 당시의 262 suites / 1,918 tests 결과는 해당 시점 기록으로 유지한다.

Runtime 리뷰에서 다음을 보강했다. Core·checkpoint·Runtime을 함께 iOS 16.6 대상으로 Swift 6 strict concurrency typecheck해 통과했다. 이 검사는 실제 위치 수명이나 화면 E2E를 대신하지 않는다.

- 복구 입력은 고정 fixture 경로와 기본 Policy가 정확히 일치해야 한다.
- 복구 파일은 읽기 전에 원본 경로에서 소비하고, 새 저장 전 이전 파일을 무효화한다. 명시 종료·만료 시 저장본을 폐기해 재개하지 않는다.
- 저장 실패 시 위치 수집을 종료하고 현재 프로세스의 복구를 차단한다. 모든 파일 변경이 실패한 경우 프로세스 재시작 후 디스크 무효화까지 보장할 수 없어 `CHECKPOINT_REVOCATION_FAILED`를 표시한다. 이 개발용 저장 방식을 제품 수준의 무결성 보장으로 취급하지 않는다.
- 세션별 UUID로 과거 위치 delegate의 늦은 콜백을 차단한다. 관측 시각은 유지하고 평가 시각은 MainActor에서 새로 얻는다.
- ContinuousClock 상한을 함께 검사하며 벽시계 역행 시 즉시 종료한다. 제한 도달 후 다음 실행·위치 콜백에서 종료를 적용하며, OS가 프로세스를 중단·정지한 동안 실행을 보장하지 않는다.
- 시간 제한으로 위치 callback 도중 종료돼도 저장본 폐기와 상태 이벤트 발행을 수행한다.

### 재현 명령

FE worktree에서 실행한다. `.env` 자동 로딩은 끈다.

```sh
swift test --package-path modules/nolate-live-activity --filter NoLateJourneyEngineCoreTests
swift test --package-path modules/nolate-live-activity
EXPO_NO_DOTENV=1 npm test -- --runInBand --no-watchman __tests__/journeyEngine.test.ts __tests__/journeyEngineScreen.test.tsx
EXPO_NO_DOTENV=1 npm test -- --runInBand --no-watchman __tests__/journeyDiagnostics.test.ts __tests__/journeyDiagnosticsScreen.test.tsx __tests__/journeyEngine.test.ts __tests__/journeyEngineScreen.test.tsx
EXPO_NO_DOTENV=1 npm test -- --runInBand --no-watchman
EXPO_NO_DOTENV=1 npm run typecheck
EXPO_NO_DOTENV=1 npx eslint src/modules/journey/journeyEngine.ts app/internal/journey-engine.tsx __tests__/journeyEngine.test.ts __tests__/journeyEngineScreen.test.tsx app/_layout.tsx
```

네이티브 Runtime·Expo bridge·Info.plist가 바뀌므로 기존 P0 바이너리에 Metro만 연결해서 P1 검증을 대신할 수 없다. 진단 opt-in을 반영한 새 Debug simulator 빌드가 필요하다.

## 5 독립 시뮬레이터 E2E 결과

2026-10-04 약 11:16–11:29 KST에 실행했다. 사용자 요청대로 Device Hub 관리 화면이 아닌 지정된 독립 deviceWindow를 조작했다. UI 조작은 Computer Use의 현재 창·접근성 정보를 확인한 뒤 수행했다. `simctl`은 이 기기의 빌드 설치·실행·위치 주입·프로세스 재실행에만 사용했다. 실기기와 다른 시뮬레이터는 조작하지 않았다.

대상: `NoLate Journey P0 Isolated 20261004`, iPhone 17 Pro / iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, 독립 창 `deviceWindow-AppWindow-4`. Xcode 27에서 독립 창의 소유 프로세스 이름은 Device Hub지만, 관리 패널이 아닌 제목·독립 toolbar가 있는 해당 기기 창을 사용했다. 창 ID가 일시적으로 누락될 때는 동일 제목·독립 toolbar·스크린샷으로 대상을 확인했다.

| 시나리오 | 결과 | 증거 |
| --- | --- | --- |
| P1 최신 네이티브 코드 빌드·설치·화면 진입 | PASS | 최신 바이너리 설치, 진단 plist true, 개발 화면 준비 완료 |
| 최초 IDLE, 화면 진입만으로 추적·복구하지 않음 | PASS | IDLE / NONE / NOT_COLLECTING / sequence 0. [초기 화면](evidence/journey-p1-20261004/01-idle.jpeg) |
| 동의 후 SIMULATOR_LOCATION 준비는 ARMED, 출발 횟수 0 | PASS | ARMED / 0회 / RUNNING / WHEN_IN_USE. 초기 cached 위치는 STALE로 거부. [준비](evidence/journey-p1-20261004/02-armed.jpeg) |
| 정지·GPS 흔들림은 ARMED 유지 | PASS | 약 0–1.8m 위치 변동 뒤 0.9m / STATIONARY / 근거 0 / 출발 0회. [정지](evidence/journey-p1-20261004/03-stationary.jpeg) |
| 연속 유효 이동 입력으로 ACTIVE 및 출발 횟수 1 | PASS | 20m씩 4초 간격 주입. 60m에서는 ARMED·근거 3, 120m에서는 ACTIVE·1회·GOOD/TRACKING. 이후 입력이 없으면 STALE로 저하. [자동 출발 후](evidence/journey-p1-20261004/04-location-active.jpeg) |
| TIMED_REPLAY의 합성 입력과 결과가 화면에 표시됨 | PASS | 별도 새 세션 ARMED·0회 → ACTIVE·1회·240m·재생 완료. 입력 종료 후 STALE 표시. [재생 완료](evidence/journey-p1-20261004/13-replay-complete.jpeg) |
| 화면만 닫은 뒤 입력 지속·재진입 시 같은 Runtime 관측 | PASS | 닫기로 로그인 화면 이동, 그 사이 140m·160m 주입. 재진입 AX에서 ACTIVE·1회·160.1m·sequence155 확인. 저장 이미지 05는 로그인 전환 프레임이므로 재진입 상태 증거로 사용하지 않음 |
| 홈·잠금·복귀 중 위치 수신과 상태 품질 | PASS (합성 입력) | 홈에서 200m, 잠금 후 220m·240m 주입. **잠금 해제 전** checkpoint 읽기에서 ACTIVE·240.0886m·관측17·출발1 확인. 복귀 후 240.1m, 무입력 시간이 지나 STALE. [잠금](evidence/journey-p1-20261004/06-locked.jpeg), [복귀](evidence/journey-p1-20261004/07-after-lock.jpeg) |
| 명시적 종료 뒤 추가 입력이 상태·출발 횟수를 변경하지 않음 | PASS | 종료 후 STOPPED / NOT_COLLECTING / 저장 없음. 추가 위치를 넣어도 260.1m·sequence355·출발1 유지. [종료](evidence/journey-p1-20261004/11-stopped.jpeg), [추가 입력 후](evidence/journey-p1-20261004/12-stopped-late-location.jpeg) |
| 만료 시 입력 수집 종료, 늦은 callback 무시 | 단위 테스트만 PASS / 화면 E2E 미실행 | Core 만료·종료 fence와 checkpoint revoke는 테스트. 실제 10분 전체 대기·OS callback 경합 E2E는 이번에 수행하지 않음 |
| 프로세스 재실행 후 명시적 복구, 신선한 위치 전 불확실 표시 | PASS | 종료·위치 주입 해제·재실행 후 IDLE/NONE/저장 있음 AX 확인. 동의·복구 후 ACTIVE·출발1이나 거리 관측 없음·UNCERTAIN. 남은 시간 약209초로 원래 만료시각 유지. [복구](evidence/journey-p1-20261004/09-restored.jpeg) |
| 복구 후 출발 상태 중복 증가 없음 | PASS | 새 260m 위치 후 GOOD/TRACKING·260.1m, 출발1 유지. [새 위치](evidence/journey-p1-20261004/10-restored-fresh.jpeg). 실제 eventKey 중복 발행 억제는 Core 테스트에서 별도 확인 |
| 실제 일정·알람·서버·Live Activity 연결 없음 | 코드·시험 범위 확인 | 개발 Runtime에 해당 호출 없음. 실제 서버·알람·APNs E2E를 통과했다는 뜻이 아님 |

위치 입력의 경도는 `126.9780 + 동쪽거리/88139`, 위도는 37.5665로 고정했다. 권한은 기존 P0 시험에서 허용한 WHEN_IN_USE를 재사용했으며 새 권한 허용/철회 E2E는 아니다. 일부 `get_app_state` 결과에서 AX는 다음 화면, 스크린샷은 직전 전환 프레임인 경우가 있어 상태 표는 AX 관측과 파일 확인을 구분했다. 05·08 이미지는 로그인 전환 프레임으로 보관하며 자동 엔진 상태의 증거로 사용하지 않는다.

시뮬레이터 위치 제공자가 한 차례 반환한 `LOCATION_TEMPORARILY_UNAVAILABLE`는 현재 개발 화면의 마지막 오류 코드로 남아 있다. 이후 GOOD/TRACKING 위치를 수신했음은 별도로 확인했다. 새 세션에서는 초기화한다. 이 진단 표시를 실시간 교통 데이터 장애로 해석하지 않는다.

마지막에는 화면의 ‘시험 종료’를 눌러 STOPPED / NOT_COLLECTING / 저장 없음 / 오류 없음 상태를 확인하고 위치 주입을 해제했다. [최종 종료](evidence/journey-p1-20261004/14-final-stopped.jpeg). 임시 진단 Info.plist·CocoaPods 생성 파일 변경 3개는 빌드 전 상태로 복원했다. 진단용으로 설치한 바이너리와 Metro 개발 서버는 해당 독립 시뮬레이터에서 재확인할 수 있도록 남겼다.

로컬 로그: `/private/tmp/nolate-journey-p1-build-final-20261004.log`, `/private/tmp/nolate-journey-p1-swift-20261004.log`, `/private/tmp/nolate-journey-p1-jest-20261004.log`, `/private/tmp/nolate-journey-p1-typecheck-20261004.log`, `/private/tmp/nolate-journey-p1-config-20261004.log`. 로컬 임시 로그는 저장소 첨부물이 아니므로 장기 보존을 보장하지 않는다.

## 6 남은 기능과 다음 단계

이번 slice에 실제 대중교통 경로 정규화, 버스/열차 식별·자동 탑승, 한 정류소 전 하차, 환승, 자동 도착, 지도 진행 화면, 음성·알림, Live Activity/APNs 연동은 포함되지 않는다. 실제 교통정보 의미와 최신성은 [BE P0 능력 보고서](../../NoLate_BE/docs/schedule/journey-engine-p0-transit-capabilities.md)의 제약을 유지한다.

다음 P1-2는 실제 경로를 안전하게 엔진 입력으로 변환하는 RouteNormalizer와 품질 계약이다. 이후 자동 관측 계약, 앱 상태·오프라인 복구, 버스 한 경로 연결을 단계별로 확장한다. 10분 전체 만료·권한 회수 화면 시험과 P0의 실제 공급자·원격 APNs·하드웨어 게이트는 별도로 남겨두며, 합성 출발 감지 성공을 실제 대중교통 길안내 완성으로 보고하지 않는다.
