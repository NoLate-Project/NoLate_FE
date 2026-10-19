# 길안내 엔진 P0 검증 기록

검증일: 2026-10-04 (Asia/Seoul)

상태: **P0 부분 검증 완료, 전체 게이트 미통과**. 자동 길안내 엔진은 아직 구현하지 않았다. 현재 추가한 기능은 위치·음성·설정 능력을 확인하는 개발 전용 진단 도구이며, 출발·탑승·하차·환승·도착을 자동으로 판단하는 제품 기능이 아니다.

이 기록은 [자동 길안내 로드맵](journey-guidance-roadmap.md)의 선행 검증 결과다. 실제 기기는 사용하지 않고 독립 시뮬레이터로 검증한다. `.env`는 읽거나 변경하지 않았으며 커밋·푸시는 수행하지 않았다. 기존 미커밋 작업은 보존한다.

## 1 검증 범위와 원리

P0에서는 기능을 완성했다고 주장하기 전에 다음 경계를 확인한다.

- JS 화면에서 실제 네이티브 진단 모듈까지 연결되는지.
- 개발 빌드에서만 위치·음성 진단 기능을 명시적으로 활성화할 수 있는지.
- 위치 권한과 전경·백그라운드 위치 수신을 상태·샘플 수로 관측할 수 있는지.
- 무음 존중 설정과 잠금 중 음성 재생 설정을 구분하고, 모르는 하드웨어 무음 상태를 추측하지 않는지.
- 도착 정보의 원천 시각·방면·정류소 수가 자동 안내에 사용 가능한 의미인지.
- Live Activity 권한·API 지원 여부 확인과 실제 원격 전달 성공을 혼동하지 않는지.

`NOLATE_JOURNEY_DIAGNOSTICS_BUILD=1`은 진단용 iOS 빌드 설정을 명시적으로 켠다. 이 설정만으로 위치 추적을 시작하지 않는다. 일반 빌드에서는 진단 전용 위치·음성 background mode와 설명을 남기지 않는 복원 동작을 검증한다. Expo 설정을 확인할 때는 `EXPO_NO_DOTENV=1`을 사용한다.

진단 화면의 시작·종료·음성 버튼은 개발 검증 입력이다. 제품에서 이동 단계를 수동 확정하는 버튼을 허용한다는 의미가 아니다. 로드맵의 수동 탑승·하차·환승 버튼 제거 요구는 그대로 유지된다.

좌표·push token·기기 식별자는 진단 화면으로 내보내지 않고 허용된 상태와 계수만 표시한다. 네이티브 오류 원문도 화면이나 일반 로그로 노출하지 않는다.

## 2 확인된 자동 테스트

아래 수치는 각 실행에서 확인된 결과다. 집중 FE 12개는 전체 FE 1,918개에 포함되므로 별도 합산하지 않는다.

| 검증 | 결과 | 확인한 범위와 제한 |
| --- | --- | --- |
| FE 전체 Jest | 262 suites, 1,918 tests PASS | 기존 기능 및 새 진단 bridge·화면 회귀, 실제 OS 실행과 별개 |
| 진단 집중 FE | 12 tests PASS | release·Android 차단, 명시적 호출, 노출 필드 제한, 화면 종료 cleanup, APNs 성공 오표시 방지 |
| Swift package | 30 tests PASS | 네이티브 정책·모델의 테스트, 실제 iOS 위치 수신이나 소리 출력의 증거는 아님 |
| BE 교통정보 계약 | 38 tests PASS | 신규 특성화 7개와 기존 회귀 31개, 합성 fixture·loopback HTTP·mock 사용 |
| 진단 빌드 설정 | 7 tests PASS | 일반/진단 빌드 분리, idempotency, 복원, 실제 Expo plugin chain에서 권한 문구와 mode 적용 |
| TypeScript typecheck | PASS | 정적 타입 검사 |
| ESLint | PASS, 오류 0 / 경고 145 | 전체 저장소 검사. 경고가 없는 상태를 의미하지 않음 |
| iOS Debug simulator build | PASS | 진단 권한 설명 보완 후 재빌드도 exit 0. 새 전용 시뮬레이터 설치와 실행 확인 |

백엔드 검증의 세부 입력 의미와 공급자별 한계는 [P0 교통정보 능력 검증](../../NoLate_BE/docs/schedule/journey-engine-p0-transit-capabilities.md)에 기록했다. 38개 PASS는 실제 교통 API 호출 성공이나 실제 자동 탑승 판정 정확도를 의미하지 않는다.

### 재현 명령

FE worktree에서 실행한다. 전체 테스트·집중 테스트는 목적에 맞게 선택하며, 아래 명령에 실서비스 자격증명을 추가하지 않는다.

```sh
EXPO_NO_DOTENV=1 npm test -- --runInBand --no-watchman
EXPO_NO_DOTENV=1 npm test -- --runInBand --no-watchman __tests__/journeyDiagnostics.test.ts __tests__/journeyDiagnosticsScreen.test.tsx
EXPO_NO_DOTENV=1 node --test scripts/journey-diagnostics-config.test.mjs
EXPO_NO_DOTENV=1 npm run typecheck
EXPO_NO_DOTENV=1 npm run lint
swift test --package-path modules/nolate-live-activity
```

BE worktree의 별도 명령은 위 교통정보 보고서에 있다. `--offline` Gradle과 강제 `test` profile을 사용해 외부 API·운영 DB와 구분한다.

진단 기능은 네이티브 코드와 Info.plist를 포함하므로 JS 재로딩만으로 설치되지 않는다. iOS 재현 시 진단 flag로 구성한 Debug simulator 빌드를 설치하고 아래의 지정된 simulator destination을 사용한다. 이 문서의 테스트 명령 실행만으로 네이티브 화면 E2E까지 통과했다고 판정하지 않는다.

## 3 독립 시뮬레이터 E2E

사용자 요청에 따라 Device Hub 관리 화면을 조작하는 방식이 아니라, 해당 기기의 **독립 deviceWindow 화면**을 사용한다. 실제 기기는 사용하지 않는다.

| 항목 | 지정 값 |
| --- | --- |
| 이름 | NoLate Journey P0 Isolated 20261004 |
| UDID | `2847D4CF-88EA-4DA1-87E9-FD1948F58E01` |
| 기기 | iPhone 17 Pro |
| OS | iOS 26.5 |
| 화면 | 지정 기기의 독립 deviceWindow |
| 백엔드 | 로컬 격리 harness, Firebase 비활성 |

기존 `4A6ADD7F-3CA9-4FF8-966F-3CD70952F63E`는 다른 성능 테스트가 동시에 조작 중이므로 이번 증거 수집에서 제외한다. 다른 시뮬레이터나 사용자의 실제 기기로 대상을 자동 전환하지 않는다.

아래 결과는 새 전용 기기의 독립 창에서 직접 확인했다. E2E는 부분 통과이며, 미완료 행을 전체 성공으로 합산하지 않는다.

| 시나리오 | 상태 | 증거 |
| --- | --- | --- |
| 권한 설명 보완 후 Debug 재빌드와 설치 | PASS | `nolate-journey-p0-isolated-build-20261004.log`, exit 0; 설치·실행 성공 |
| 독립 화면에서 진단 화면 진입과 네이티브 readiness | PASS | `진단 준비 완료`, 최초 `IDLE`, 전체/전경/배경 0. 진입만으로 추적하지 않음 |
| 명시적 시작·위치 권한 표시·전경 샘플 수신 | PASS | `WHEN_IN_USE`, `RUNNING`, 전경 2회, 오류 없음; [권한 설명](evidence/journey-p0-20261004/permission.jpeg) |
| 잠금/백그라운드 중 합성 위치 수신·복귀 후 계수 확인 | PASS (합성 입력) | 홈 1회·잠금 1회 주입 후 전체 4 / 전경 2 / 배경 2; [잠금 화면](evidence/journey-p0-20261004/locked.jpeg), [복귀 결과](evidence/journey-p0-20261004/background-counts.jpeg) |
| RESPECT_SILENT 음성 요청·시작/완료 상태 확인 | PASS (콜백만) | `QUEUED → COMPLETED`, 시작 1 / 완료 1 / 취소 0, 오류 없음. 실제 음향·하드웨어 무음 준수 미검증 |
| LOCK_SCREEN 음성 요청·잠금 중 완료, queued 취소·재시작 | 미완료 | 공유 시뮬레이터 앱 창을 다른 작업이 조작하여 안정적인 독립 창 입력이 유지되지 않음 |
| 중지 버튼·화면 이탈 후 재주입에도 계수 고정 | 미완료 | 같은 UI 충돌로 네이티브 수명 E2E 증거 미확보. 단위 테스트로 대체 통과하지 않음 |
| 진단 화면의 APNs 미검증·무음 상태 미확인 표시 | PASS | 접근성 트리에서 미검증 문구 확인. 원격 성공이나 무음 자동 감지 완료로 표시하지 않음 |

복귀 결과의 `최근 정확도 5.0 m`는 시뮬레이터가 제공한 값이며 실측 GPS 정확도가 아니다.
배경 수신 수는 네이티브 콜백을 처리할 당시 앱 상태로 분류한다. 이를 장시간 백그라운드 지속성으로 일반화하지 않는다.

시험 종료 시 새 전용 기기의 `com.anonymous.nolatefe`만 `simctl terminate`로 종료하고 해당 기기의
합성 위치를 `simctl location … clear`로 정리했다. 이는 중지 버튼 cleanup 시나리오의 통과 증거가 아니다.
다른 작업의 앱·기기·프로세스는 종료하지 않았다. 생성 과정에서 바뀐 `ios/`의 프로젝트·권한·아이콘·
Pod lock 등 7개 파일은 이번 빌드가 만든 변경만 원래 상태로 돌렸다. 진단은 opt-in plugin 소스에 남고,
설치된 시험 앱과 DerivedData는 진단 설정으로 빌드된 결과다.

재현 시 Metro는 길안내 worktree의 전용 포트 `8088`을 사용하고 `.env` 자동 로딩을 끈다.
`exp+nolate://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8088`로 연결한 뒤
`nolate:///internal/journey-diagnostics`를 연다. 합성 입력은 서울시청 인근 공개 좌표 네 점을 사용했다:
`37.5665,126.9780` → `37.5667,126.9783` → 홈에서 `37.5669,126.9786` → 잠금에서 `37.5671,126.9789`.
기존 사용자 경로나 위치 trace를 사용하지 않았다.

시뮬레이터 제어는 독립 창에서 `Controls → Home / Lock`으로 수행했다. 잠금 해제는 Home을 두 번
실행하고, `simctl launch <전용 UDID> com.anonymous.nolatefe`로 실행 중 앱에 복귀했다.
다른 작업의 창 조작이 멈춘 뒤 미완료 두 행 및 권한 회수·시간 제한 종료 시나리오를 재검증해야 한다.

시뮬레이터의 합성 위치는 입력을 통제한 OS 연동 테스트다. 버스에 실제로 탑승했을 때의 센서 품질, 지하철 터널, 배터리 소모를 증명하지 않는다. 음성 완료 callback 역시 물리 기기의 실제 청취나 하드웨어 무음 스위치 동작을 증명하지 않는다.

## 4 아직 통과하지 않은 게이트

| 항목 | 상태 | 이유와 후속 조건 |
| --- | --- | --- |
| 실제 FCM→APNs→ActivityKit 전달 | NOT VERIFIED | 로컬 harness에서 Firebase 비활성. 안전하게 주입된 테스트 자격증명이 없으며 운영 토큰·운영 전송을 사용하지 않음 |
| 실제 원격 갱신 후 잠금 화면 표시 | NOT VERIFIED | 로컬 preview·지원 여부·권한·모의 전송 성공으로 대체할 수 없음. 원격 전달에 대응하는 revision과 잠금 화면 증거가 필요 |
| 하드웨어 무음에 따른 자동 채널 전환 | NOT VERIFIED | 실제 기기 사용 제외. 앱 세션의 output mute 상태를 하드웨어 무음 상태로 간주하지 않음 |
| 실제 교통 API 노선별 제공·최신성·차량 추적 | NOT VERIFIED | 이번 검증은 키 없는 fixture 기반. 승인된 개발용 주입 경로와 실제 응답 검증 필요 |
| 실제 이동·탑승·하차 정확도 | NOT VERIFIED | 엔진 미구현 및 실제 기기·실주행 검증 범위 제외 |
| 자동 길안내 E2E | 미구현 | P1 이후 순수 코어·Runtime·채널을 연결한 뒤 별도로 검증 |

APNs 미검증은 “시뮬레이터에서는 원격 APNs가 절대 불가능하다”는 뜻이 아니다. 이번 환경에는 실제 테스트 전달을 실행할 안전한 자격증명·전송 경로가 준비되지 않았다. 향후에도 실제 APNs 전송과 `simctl push` 또는 로컬 Activity 생성은 서로 다른 증거로 기록한다.

기기 무음 요구사항은 삭제하지 않는다. 단, 현재 관측할 수 없는 하드웨어 상태를 추측해 “무음 모드 자동 대응 완료”로 표시하지 않는다. 이번 작업에서는 실기기를 사용하지 않고 남은 제한을 기록한다.

## 5 P1에서 안전하게 진행 가능한 범위

P0의 외부 게이트가 남아 있어도 실제 교통정보가 없는 입력을 정직하게 취급하는 순수 코어와 재생 기반 테스트는 개발할 수 있다. 이는 P0 전체 통과 선언과 구분한다.

1. `ARMED`와 실제 출발 이후 `ACTIVE`를 분리하는 순수 상태 머신.
2. 경로·위치·교통 관측의 정규화 계약과 `MATCHED / MISMATCHED / UNKNOWN` 경계.
3. 위치 관측 시각·정확도·경로 순서를 이용한 진행 후보와 신뢰도 판정.
4. `incomingVehicleStopsAway`와 엔진이 계산하는 `remainingStopsToAlight`의 분리.
5. 원천 시각 누락·stale·반대방면·경로 revision 불일치·GPS 튐을 거부하는 정책.
6. 시간 주입과 합성 fixture replay, 영속 event key·sequence를 통한 중복/역전 방지.
7. 단위 테스트 후 지정 독립 시뮬레이터에서 입력 재생과 UI 결과를 비교하는 단계별 E2E.

실시간 API를 사용하지 않은 합성 결과는 항상 재생 데이터임을 표시한다. 실제 APNs·하드웨어 무음·현장 정확도를 확인하지 못한 상태에서는 해당 기능의 출시 준비가 끝났다고 판정하지 않는다. 기능 플래그는 기본 OFF를 유지한다.
