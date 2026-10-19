# P2-3b2b2b1 활성 상태 토큰 갱신·계정 race 보호

2026-10-05 (Asia/Seoul). FE·BE feature/transit-guidance-v1. 커밋/푸시하지 않았다.

## 결과와 범위

앱 활성 상태에서 만료 전에 토큰을 갱신하고, 같은 계정의 진행 중인 native 안내에 교체 토큰을
반영했다. 일반 API 401 복구와 길안내의 선제 갱신은 하나의 single-flight를 공유한다.
로그아웃·다른 계정 로그인 뒤 늦은 응답이 인증/안내를 되살리는 것을 차단한다.
P2-3b2b2b 전체 완료가 아닌 foreground 갱신의 첫 구현이다.

실제 로그인/본인 일정 E2E가 아니다. 별도 test issuer의 서명 JWT, 합성 전체 저장 경로,
actual journey controller/service + in-memory fixture를 사용했다. Refresh exchange는
서명/type/member/login-generation/일회 소비를 검사하는 **시험 double**이며 production
MemberUseCase/refresh-token DB transaction 전체를 실행한 것은 아니다.
실제 credentials·DB·지도 타일·교통 공급자·APNs·실기기를 사용하지 않았다.
위치 엔진 지원 범위는 첫 도보→승차 정류장 접근/대기이며 승차는 미확정이다.

## 구현

- 실인증 source는 활성 상태의 수명 pump에서 남은 access 수명이 30초 이하일 때 기존 refresh
  single-flight에 참여한다. 시뮬레이터 fixture는 45초 access/10초 여유로 같은 경계를 시험한다.
  foreground pump는 5초 간격이며, 중단/계정 변화/서버 거절은 native stop을 먼저 수행한다.
- Debug simulator의 두 native opt-in이 켜진 경우, 일반 401/선제 갱신 모두 refresh 전용 native
  client를 쓴다. fixed auth/refresh endpoint와 canonical origin만 허용한다. Access Bearer를
  붙이지 않고 기존 redirect-blocking ephemeral URLSession으로 refresh body를 전송한다.
  enabled 실패/잘못된 응답은 다른 client로 재전송하지 않는다. 명시적인 available=false
  (기능 미활성/미지원)일 때만 기존 일반 인증 통신을 유지한다.
- refresh 결과는 credential revision을 요청 전·응답 후·저장 직전/후에 대조한다. 로그인/계정
  변경/logout은 revision을 바꾼다. 내구 저장 mutation을 직렬화해 진행 중인 refresh write 뒤에
  logout deletion을 수행하며, cleanup 중 새 로그인으로 바뀐 계정은 옛 logout이 삭제하지 않는다.
  같은 회원의 profile/curation 편집만으로 일회 소비 refresh 결과를 버리지 않는다.
- 일반 401 interceptor도 late result로 새 계정을 지우거나 옛 token으로 재시도하지 않는다.
  cleanup 자체의 HTTP recovery는 flight 안에서 cleanup을 기다리지 않으며 기존 deadlock
  회귀 테스트를 유지했다. 429/5xx/통신 장애는 계정 회수와 구별한다.
- native live update는 foreground/running, 전체 binding 일치, 예상 이전 token, 계정/origin/
  login-generation, 유효한 새 exp와 만료 역행 금지를 함께 검사하는 compare-and-swap이다.
  이미 종료되거나 만료된 세션을 다시 시작하지 않는다. JS도 generation을 await 경계마다
  확인하고 stop 후의 late refresh로 update/restore/ACK하지 않는다.
- 교체는 credential 메모리만 바꾼다. GPS manager/출발 횟수/checkpoint/route session을
  재시작하지 않고 원래 10분 trial TTL 또는 30초 서버 lease를 연장하지 않는다.
  새 토큰이 있어도 서버 lease 검증은 계속 필요하다.
- 실제 인증 저장소의 기존 SecureStore/shared Keychain 토큰 저장·접근성 정책은 유지했다.
  길안내 binding/checkpoint/outbox/Activity에는 raw access/refresh token을 넣지 않는다.
  합성 E2E source는 JS/native 메모리만 쓰고 실제 authStorage/Keychain에 시험 token을 쓰지 않는다.

## 검사

| 검사 | 결과 |
| --- | --- |
| FE 전체 Jest | 285 suites / 2,557 tests PASS |
| 인증/cleanup/automatic 집중 회귀 | 8 suites / 197 tests PASS |
| Swift pure policy package | 243 tests PASS |
| BE journey 회귀 | 13 suites / 111 tests PASS |
| GPS replay/diagnostics config | 13 tests PASS |
| TypeScript·변경 파일 lint·git diff --check | PASS |
| 최종 Debug native 앱/위젯 | BUILD SUCCEEDED |

추가 테스트는 concurrent proactive + actual 401 interceptor flight 공유, old 성공/거절 응답,
write-time revision mismatch, logout 중 write, cleanup 중 새 로그인, same-member profile 편집,
native transport의 fallback 금지/응답 경계, live token 교체, source 대기 중 logout, native
rotation 거절과 원래 session TTL 유지 등을 확인한다. 실제 사용자 계정 race의 시뮬레이터
로그인 E2E를 대체하지 않는다. Swift package는 Runtime/URLSession/UIKit/ActivityKit을 포함하지
않으므로 이 연결은 실제 native build와 아래 화면 E2E로 별도 검증했다.

## 독립 시뮬레이터 E2E

NoLate Journey P0 Isolated 20261004, iOS 26.5,
UDID 2847D4CF-88EA-4DA1-87E9-FD1948F58E01.
computer-use 스킬로 title/deviceWindow-AppWindow-1/Show in Device Hub를 확인한 독립 phone
window에서만 앱 버튼을 조작했다. 설치 후 창이 관리 화면으로 잡혔을 때는 독립 창 열기/Window
메뉴로 포커스만 복구했다. Device Hub 관리 pane 안의 앱 내용이나 다른 기기는 조작하지 않았다.
simctl로 합성 GPS를 입력해 실제 CoreLocation callback을 받았으며 단계/출발 bridge 주입은 없다.

| 사례 | 최종 빌드 증거 |
| --- | --- |
| 45초 access, 준비는 출발 아님 | ARMED/출발 0/갱신 0. [09](evidence/journey-p2-3b2b2b1-20261005/09-final-short-token-armed.png) |
| GPS 자동 출발·원래 token 만료 후 유지 | ACTIVE/출발 1/ACK/갱신 1/오류 없음/WAITING. [10](evidence/journey-p2-3b2b2b1-20261005/10-final-gps-active-renewed.png) |
| 실제 상세 컴포넌트 | 신선한 동일 엔진 위치·첫 도보 100%·합성 도착 feed·로컬 Activity ACTIVE. 실제 타일 아님. [11](evidence/journey-p2-3b2b2b1-20261005/11-final-renewed-detail.png) |
| 갱신 후 잠금 표시 | 정류장 대기/첫 도보 진행/합성 도착 안내의 로컬 Activity 표시. [12](evidence/journey-p2-3b2b2b1-20261005/12-final-renewed-local-lock.png) |
| 잠금 중 server login sg 2→3 | native lease 거절로 Activity 제거와 STOPPED/VALIDATION_REJECTED. [잠금 13](evidence/journey-p2-3b2b2b1-20261005/13-final-revoked-lock-cleared.png), [종료 14](evidence/journey-p2-3b2b2b1-20261005/14-final-revoked-stopped.png) |
| refresh 503 | 갱신 0으로 유지하다 원래 access 만료에 STOPPED/AUTOMATIC_AUTH_EXPIRED, 카드/복구/위치 제거. [준비 15](evidence/journey-p2-3b2b2b1-20261005/15-final-refresh-outage-armed.png), [종료 16](evidence/journey-p2-3b2b2b1-20261005/16-final-refresh-outage-expired.png) |

[세션 비교 기록](evidence/journey-p2-3b2b2b1-20261005/renewal-session-proof.json)은 토큰 없이
ARMED→ACTIVE의 전체 binding 동일성을 보관한다. 준비 후 61.083초에도 같은 sessionId,
generation/revision/clientOwner/digest와 원래 prepared/expiry를 유지했다. 최초 access TTL은
45초이고 준비 이전에 발급됐으므로 원래 만료를 넘긴 관측이다. prepare/departure/activation/
cancel 각각 1, refresh 1, redirect trap 0이며 checkpoint에 credentials가 없다.
회수/만료 후 native store는 revoked=true/value 없음이며 server row가 ACTIVE로 남을 수 있다.
유효하지 않은 token의 best-effort stop이 성공했다고 주장하지 않는다.

잠금 화면의 iOS 허용/허용 안 함 prompt는 누르지 않았다. 이번 결과는 로컬 ActivityKit의
prompt 포함 표시이며 지속 허용/APNs 전달 또는 정확한 background 종료 SLA 검증이 아니다.
unsigned simulator의 기존 shared Keychain -34018 및 expo-notifications module 경고는 남아 있다.
이 환경으로 실제 인증 저장/로컬 push 전달 성공을 주장하지 않는다.

## 정리와 다음

- native refresh도 기존 redirect-blocking client를 재사용해 중복 통신을 늘리지 않았다.
- 이번 작업의 중간 이미지 01–08은 삭제하지 않고 Git 밖
  /Users/mac/IdeaProjects/NoLate/.qa-artifact-archive/p23renew-superseded.jd8aAK 에 README와 보관했다.
  최종 09–16과 세션 비교 JSON만 현재 증거 폴더에 남겼다. 이전 단계 fixture/증거는 유지했다.
- trial stop·GPS replay 종료/location clear·fixture counter reset을 완료했다.
  15544/15545 시험 listener를 종료했고 15543에도 listener가 없다. Metro 8088만 유지했다.
  source Info.plist의 trial/auth opt-in/location 모드는 제거했고 Podfile.lock/project.pbxproj는
  이번 턴 이전 내용으로 복원해 기존 미커밋 변경을 보존했다. 설치된 시험 binary만 opt-in이다.
  Pods는 실제 pod install로 준비했다. Manifest를 위조하지 않았으며 다음 빌드 전 pod install이 필요하다.
- 다음 P2-3b2b2b2는 **잠금/JS 중단 상태 갱신과 cold 복구·소유권**이다. native와 일반 인증이
  refresh를 경쟁 소비하지 않는 durable handoff, 현재 WhenUnlocked Keychain의 잠금 제약,
  갱신 직후 프로세스 종료와 revoked checkpoint, 한 계정/한 기기 소유권을 먼저 검증한다.
  저장소 접근성은 자동으로 완화하지 않는다.
- 현재 foreground source는 이미 만료된 access로 시작/복구하려 하면 fail-closed한다. 잠금 중
  native 자체 refresh는 아직 없으며 그동안 토큰이 만료되면 안내를 종료한다.
  실제 본인 일정/지도 타일·버스 탑승/차량 이동/한 정류장 전 안내·지하철/환승·음성/무음
  push·APNs/실주행 검증은 계속 남아 있다. 운영/실기기 기능은 default-off다.
