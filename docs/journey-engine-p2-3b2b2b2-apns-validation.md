# P2-3b2b2b2 부분 구현 · cold 인증 복구 / APNs UPDATE 파일럿

2026-10-05. FE·BE `feature/transit-guidance-v1`. 커밋·푸시하지 않았다.

## 결과와 미완료 경계

독립 iOS 26.5 시뮬레이터에서 GPS 자동 출발과 ActivityKit 활동별 push token 발급을 확인했다.
현재 상태는 `TOKEN_READY_PROVIDER_NOT_CONFIGURED`다. **Firebase/FCM/APNs 실제 UPDATE 전달,
잠금 화면 원격 변경·원격 END 성공은 미검증**이다. 시뮬레이터 token 발급을 전달 성공으로 승격하지 않는다.

사용자가 개발 Firebase 환경을 아직 지정하지 않았다. 일반 Firebase 환경 변수도 현 shell에서
설정되지 않았다. 실제 전송 task는 별도 test opt-in 부재로 공급자 초기화 전에 거절됐다.
운영 설정/키나 .env를 가져와 대신 사용하지 않았고 실기기도 조작하지 않았다.

P2-3b2b2b2 전체 완료가 아니다. 잠금 중 native refresh·JS와 native의 durable rotation ownership,
회전 직후 process death/부분 credential write, 활동 토큰 교체·기기 이전·remote END의 durable
소유권은 남았다. WhenUnlocked Keychain 접근성을 완화하지 않았다. 기존 만료/회수 fail-closed를 유지한다.

## 구현

- cold source가 최근 만료된 ACCESS의 identity만 읽어 기존 refresh single-flight에 참여한다.
  만료 candidate는 native/여정 API로 전달할 수 없다. 최신 저장 토큰의 유효성, 같은 member/
  origin/login generation, credential revision과 expiry 역행을 재검사한다. malformed/24시간 이상
  오래된 token, logout 중 late reply, 갱신 실패/다른 generation은 복구를 차단한다.
- DEBUG simulator + diagnostics/authenticated/APNs 세 opt-in에서만 `.token` Activity를 시작한다.
  준비만으로 생성하지 않으며 ACTIVE와 fresh GPS를 요구한다. update token observer는 activity ID에
  묶인다. raw Activity/FCM/access token은 메모리와 제한된 HTTPS/loopback 요청에만 사용하고
  snapshot/로그/checkpoint/binding/증거에는 저장하지 않는다. UI는 존재 여부·상태·수락 횟수만 표시한다.
- APNs 파일럿은 로컬 생성 후 **remote UPDATE 단일 발행**이다. 로컬 `activity.update`를 실행하지 않아
  로컬 변화로 푸시 성공을 가장할 수 없다. 명시 종료/회수는 보안을 위해 로컬 Activity를 종료한다.
  이는 remote END 검증이 아니다. 오프라인 표시 지연이 있어 최종 내비게이션 전송 정책이 아니다.
- 의미 있는 변화만 최소 5초 간격, wall-clock 초 기준으로 병합한다. 같은 초/시계 역행에서 미래
  timestamp를 만들지 않는다. retry 시 timestamp를 바꾸지 않으며 실패/모호한 수락을 맹목 재전송하지 않는다.
- loopback authenticated harness에 test-source-only `/live-activity` UPDATE lane을 추가했다.
  signed test issuer·현재 세대·저장 경로 fingerprint·ACTIVE session·owner/digest·expiry를 검증한다.
  old/same/future timestamp, 다른 Activity/FCM/update token 재지정, GPS/알 수 없는 nested fields를 거절한다.
  토큰 교체는 아직 새 lane으로 자동 전환하지 않고 거절한다. in-memory lane이므로 서버 재시작/다중 worker에
  대한 durable 보장이 없다. **운영 Spring controller/DB에 연결한 기능이 아니다.**
- 실제 공급자용 test task는 기존 `FirebaseLiveActivityPushClient`를 주입해 server → FCM → APNs 경로를
  사용할 수 있게 했다. 실제 실행에는 사용자 지정 test 환경과 단일 installation FCM SHA-256 allowlist가
  모두 필요하다. ADC/운영 환경 자동 탐색이나 Dummy sender fallback은 없다.

## 검사

| 검사 | 결과 |
| --- | --- |
| FE 전체 Jest | 286 suites / 2,572 tests PASS |
| Swift pure policy | 246 tests PASS |
| BE journey + Firebase payload 회귀 | 15 suites / 119 tests, failures/errors 0 |
| GPS replay + opt-in config | 14 tests PASS |
| TypeScript / 변경 파일 lint | PASS, lint 경고 0 |
| Debug 앱·위젯 빌드 | BUILD SUCCEEDED, simulator signing enabled |
| 실제 APNs test task 사전 검사 | opt-in 부재로 FAIL-CLOSED, 네트워크 전송 없음 |

Swift package는 UIKit/ActivityKit/URLSession 연결을 검사하지 않으므로 native build와 화면 E2E로 분리했다.
Firebase test의 provider 수락은 mock이며 device 수신이 아니다. shared Keychain / Expo module warnings가
남아 있어 실제 본인 계정 인증 저장/알림 성공으로 주장하지 않는다.

## 독립 시뮬레이터 E2E

`NoLate Journey P0 Isolated 20261004`, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`.
computer-use 스킬의 title/deviceWindow-AppWindow-1/Show in Device Hub 가드로 독립 phone window에서만
앱 버튼을 눌렀다. Device Hub 관리 pane/실기기/다른 시뮬레이터를 조작하지 않았다.
simctl은 설치·프로세스 종료·URL·합성 GPS 입력에만 사용했고 단계/출발 상태를 bridge로 주입하지 않았다.

- [01 준비](evidence/journey-p2-3b2b2b2-apns-20261005/01-probe-armed.png): ARMED, 출발 0, Activity 미생성.
- [02 이동](evidence/journey-p2-3b2b2b2-apns-20261005/02-gps-active-token-status.png): GPS ACTIVE/출발 1/ACK,
  Activity token 발급, provider 미설정. raw token 출력 없음.
- [03 잠금](evidence/journey-p2-3b2b2b2-apns-20261005/03-probe-lock-not-remote-delivery.png): 로컬 초기 Activity 표시와
  시스템 허용 prompt. 사용자가 허용에 동의했지만 클릭 직전 prompt가 사라져 추가 클릭하지 않았다.
- [04 stale](evidence/journey-p2-3b2b2b2-apns-20261005/04-probe-lock-stale-prompt-absent.png): 원격/로컬 UPDATE가 없는
  초기 content를 계속 fresh로 표시하지 않고 확인 필요 표시. 지속 허용 설정 변경 성공을 주장하지 않는다.
- [05 cold](evidence/journey-p2-3b2b2b2-apns-20261005/05-cold-idle-before-validation.png): process 종료/재실행 후
  IDLE, 서버 재검증/명시 복구 전에 GPS·새 Activity를 자동 시작하지 않음.
- [06 복구](evidence/journey-p2-3b2b2b2-apns-20261005/06-cold-restored-token-ready.png),
  [07 fresh GPS](evidence/journey-p2-3b2b2b2-apns-20261005/07-cold-restored-fresh-gps.png): 같은 session/owner/
  generation/revision/digest/원래 TTL, 출발 1/ACK, 새 활동 token 발급. GPS로 WAITING/첫 도보 100%.
- [08 잠금 회수](evidence/journey-p2-3b2b2b2-apns-20261005/08-lock-revocation-cleared.png): server login sg 회수 후
  로컬 Activity 제거. APNs END로 제거한 것이 아니다.

[cold 비교 증거](evidence/journey-p2-3b2b2b2-apns-20261005/cold-session-proof.json): binding 모든 필드 동일,
prepare/departure/activation/cancel 각각 1, provider 수락/전송 0, checkpoint credentials 없음.
실계정/실제 지도/버스·지하철 탑승 및 현장 위치 정확도 E2E가 아니다.

## 실제 전송 재개 준비

사용자 지정 **개발 Firebase** 설정만 사용한다. 비밀값을 문서/채팅/로그에 넣지 않는다.

- BE task: `authenticatedJourneyApnsHarness`.
- 필수 환경 이름: `NOLATE_JOURNEY_APNS_TEST`, `NOLATE_JOURNEY_TEST_FIREBASE_CREDENTIALS`,
  `NOLATE_JOURNEY_TEST_FIREBASE_PROJECT`, `NOLATE_JOURNEY_TEST_FCM_SHA256`.
- FE opt-in: `NOLATE_JOURNEY_DIAGNOSTICS_BUILD`, `NOLATE_JOURNEY_AUTHENTICATED_BUILD`,
  `NOLATE_JOURNEY_APNS_PILOT_BUILD`. 모두 명시 설정하고 새 trial native build가 필요하다.
- provider 시험 화면은 `authenticated=1&pushPilot=provider`. 기존 test installation의 APNs 등록과
  FCM token만 사용하며 등록/권한 또는 운영 token API를 자동 호출하지 않는다. 일반 fixture는 실제 연결 버튼 비활성.
- 서버 수락만으로 PASS하지 않는다. 앱 엔진 변화와 **같은 활동**의 잠금 화면 원격 변화, 순서·종료·복구를
  확인해야 한다. END/토큰 교체의 구현과 시험은 후속 작업이다.

## 사용자 화면 요구 재확인 · 현재 구현 일시 중단

사용자가 2026-10-05 첨부한 참고 화면 기준: Live Activity는 전체 도보/버스/지하철/환승 구간 바 위에
현재 위치 marker를 표시하고, 상세 화면은 지도·전체 경로 바·구간 목록에 같은 현재 위치를 표시해야 한다.
현재 ‘첫 도보 100%’ 카드/기본 ProgressView는 임시 검증 UI이지 요청한 최종 UI가 아니다.
전체 경로의 current leg + 해당 leg 내 진행을 같은 native snapshot에서 투영하고 불확실한 위치는
marker를 확인 중으로 표시해야 한다. 시간 경과/버튼으로 marker를 이동시키지 않는다.
참고 이미지의 개인 위치·일정·사진은 저장소에 복사하지 않았다.

사용자의 ‘잠시만’ 요청 이후 신규 구현을 중단했다. GPS 입력을 clear하고 trial process/시험 harness를
종료했다. source Info.plist/Podfile.lock/project.pbxproj는 턴 시작 원본으로 복구해 기존 dirty 변경을
보존했다. 다음 빌드에는 실제 pod install이 필요하며 Manifest를 위조하지 않는다.
