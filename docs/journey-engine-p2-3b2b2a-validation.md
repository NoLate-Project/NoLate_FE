# P2-3b2b2a 인증 transport 첫 연결과 시험 정리

2026-10-05 (Asia/Seoul). FE·BE `feature/transit-guidance-v1`. 커밋/푸시하지 않았다.

## 결과와 정확한 범위

기존 자동 엔진에 AUTHENTICATED scope를 추가했다. Debug 본인 저장 일정의 opt-in 진입 코드를
연결하고, 준비·자동 출발 동기화·종료·cold 복구·native 도착/수명 조회가 같은 인증 경계를 사용한다.
실제 사용자의 로그인·일정을 시뮬레이터에서 검증한 것은 아니다. E2E는 test issuer가 서명한
합성 JWT와 전체 합성 저장 경로, actual controller/service + in-memory fixture로 실행했다.
실제 credentials, DB, 교통 공급자, 지도 타일, APNs, 실기기를 사용하지 않았다.

첫 도보→정류장 접근/대기 지원 범위를 유지한다. 탑승은 미확정이며 승하차/환승 확정·하차 전
정류장/거리/시간 안내·음성/무음 알림·실주행 정확도는 아직 다음 단계다.

## 구현과 경계

- 일반 상세의 본인 경로만 대상으로 한다. 참가자 검사/preview는 운영 인증 진입에서 제외한다.
  `__DEV__`, iOS, `EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED=true`가 모두 필요하다.
  native는 DEBUG simulator, diagnostics opt-in과 별도 `NoLateJourneyAuthenticatedEnabled=true`
  Info.plist opt-in을 요구한다. source 기본값에는 두 opt-in/location 모드를 남기지 않았다.
  BE 실행/profile gate도 그대로 유지한다. 실기기·운영 활성화는 허용하지 않는다.
- 위 opt-in 경로에서는 수동 출발 제어를 숨기고 검사/위치 시험 동의/준비/종료만 노출한다.
  준비는 출발이 아니다. 이동 단계 bridge를 호출하지 않고 CoreLocation 관측으로만 감지한다.
- 기존 authStorage에서 읽은 access JWT와 최소 계정 정보를 JS/native **메모리**로 전달한다.
  binding에는 apiOrigin/memberId/login-generation만 더하며 raw token·refresh token은
  JS 저장소/native checkpoint/outbox/Activity 내용에 넣지 않는다.
  cold 복구는 새 credential 읽기→같은 account/origin/generation 검사→서버 검증→native 구성/복구 순서다.
- JWT decoding은 로컬 신원·ACCESS type·sg·iat/exp fence이지 서명 검증이 아니다.
  서버가 모든 요청의 서명/issuer/type와 현재 계정 세대·일정 접근·경로·세션 fence를 검증한다.
  신규 계정의 유효한 로그인 세대 **0**도 허용한다. receipt generation은 계속 양수다.
- canonical HTTPS origin 또는 Debug localhost/127.0.0.1 HTTP origin만 허용한다.
  credentials 없는 기존 fixture 포트 15543은 auth origin으로 거절한다.
  userinfo/path/query/fragment/noncanonical port 등도 차단한다.
- 인증된 준비/출발/종료 요청도 native URLSession ephemeral client로 통합했다.
  RN fetch의 redirect 옵션에 의존하지 않는다. redirect delegate 차단, 최종 URL 검사,
  cookie/credential storage/cache 없음, timeout/본문 크기/endpoint allowlist를 적용한다.
  background lease/arrival도 같은 client를 재사용한다. 잘못된 요청/응답은 private body 없이 오류 코드만 반환한다.
- JS는 요청 전후와 foreground 수명 pump에서 계정 경계를 다시 검사한다.
  **출발 outbox ACK 후 비어 있어도** 계정 교체 검사/정리를 실행한다. 계정/인증 오류는 native stop 먼저,
  binding/checkpoint/outbox 제거 다음, 서버 stop best-effort 순서다.
- native 메모리 token은 원래 exp까지만 쓴다. **이 단계에는 자동 refresh가 없다.**
  exp/로그인 세대/lease 오류 시 fail-closed한다. 동일 계정 토큰 교체의 grace/백그라운드 refresh는 후속이다.
  이미 만료/회수된 토큰이면 server stop도 거절되므로 server row STOPPED를 보장하지 않는다.

## 검사

| 검사 | 결과 |
| --- | --- |
| FE 전체 Jest | 284 suites / 2,532 tests PASS |
| 인증·coordinator·saved UI 집중 회귀 | 9 suites / 212 tests PASS |
| Swift pure package | 242 tests PASS |
| BE 전체 journey 회귀 | 13 suites / 111 tests PASS |
| 위치 replay·diagnostic config | 13 tests PASS |
| TypeScript·신규/변경 journey 파일 lint | PASS, errors/warnings 0 |
| 실제 detail sheet lint | errors 0, 기존 inline-style warnings 2 유지 |
| Debug native 앱/위젯 | BUILD SUCCEEDED |
| 기존 15543 HTTP smoke | PASS, reset 후 모든 counter 0 |

순수 Swift package에는 URLSession Runtime/Expo bridge/UIKit/ActivityKit이 들어가지 않는다.
auth identity/origin/expiry 정책은 단위 테스트, native HTTP·위치·Activity 연결은 실제 build와 E2E로 확인했다.
BE 3개 신규 테스트는 missing/malformed/foreign signature/wrong issuer/refresh/wrong account/sg 및
서명된 access identity/current-generation/신규 generation 0을 실제 controller에 적용한다.
일반 production SecurityFilterChain 전체 로그인 E2E를 대신하지 않는다.

## 독립 시뮬레이터 E2E

`NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`.
computer-use로 detached `deviceWindow-AppWindow-1` title/ID/Show in Device Hub를 확인하고
그 독립 phone window만 조작했다. Device Hub 관리 pane은 사용하지 않았다.
simctl 위치 replay→실제 CoreLocation callback으로 합성 132m 도보와 정류장 dwell을 재생했다.
GPS/시간·품질 fence는 앞선 단계와 같으며 phase/departure 수동 주입은 없다.

| 사례 | 관측과 최종 증거 |
| --- | --- |
| 다른 origin으로 HTTP 307 | native 준비 실패, IDLE/출발 0. trapRequests=0, trapAuthorizationSeen=false. [07](evidence/journey-p2-3b2b2a-20261005/07-native-redirect-blocked.png) |
| 인증 native 준비 | ARMED/출발 0, arrival 0. [08](evidence/journey-p2-3b2b2a-20261005/08-native-authenticated-armed.png) |
| 프로세스 종료/새 토큰 읽기/명시 복구 | 자동 시작 없음. 서버 validate 뒤 ARMED/출발 0/Activity 없음. [09](evidence/journey-p2-3b2b2a-20261005/09-authenticated-cold-restored.png) |
| 새 GPS 도보·정류장 대기 | ACTIVE/출발 1/ACK, WAITING/첫 도보 100%/합성 도착정보. prepare/departure/activation/cancel 각각 1 유지. [10](evidence/journey-p2-3b2b2a-20261005/10-native-auth-restored-gps-active.png) |
| 상세와 로컬 잠금 Activity | 같은 엔진 위치·진행·도착 관측. [상세 11](evidence/journey-p2-3b2b2a-20261005/11-native-auth-route-detail.png), [잠금 12](evidence/journey-p2-3b2b2a-20261005/12-native-auth-lock-before-revoke.png) |
| 잠금 중 로그인 sg 2→3 | 상세 reload 없이 native STOPPED/VALIDATION_REJECTED, 위치/Activity 제거. server stop도 거절되어 row ACTIVE 유지. [잠금 13](evidence/journey-p2-3b2b2a-20261005/13-native-auth-revoked-lock-cleared.png), [종료 14](evidence/journey-p2-3b2b2a-20261005/14-native-auth-revoked-stopped.png) |
| 45초 token, GPS 없는 ARMED·잠금 | 잠금 후 재진입 시 STOPPED/AUTOMATIC_AUTH_EXPIRED, 복구 disabled/카드 없음, 서버 row는 ARMED. [준비 15](evidence/journey-p2-3b2b2a-20261005/15-short-token-armed.png), [종료 16](evidence/journey-p2-3b2b2a-20261005/16-short-token-expired-stopped.png) |
| 기존 credential-free SANDBOX | GPS 출발 1/ACK 유지. 샘플 종료 후 stale은 위치 확인 필요로 표시. [17](evidence/journey-p2-3b2b2a-20261005/17-sandbox-regression-active.png) |
| 최종 명시 stop | STOPPED/오류 없음, 카드/복구 제거. [18](evidence/journey-p2-3b2b2a-20261005/18-cleaned-stopped.png) |

JWT는 실제 JwtTokenProvider의 **별도 test key/issuer**로 서명한다. 15544는 해당 test issuer만
허용하고 actual principal/service를 호출한다. 15545는 redirect trap이다. 기존 15543은 여전히 모든
Authorization을 거절한다. 일반 API는 15542 unreachable, Metro는 NO_DOTENV/offline으로 유지했다.
합성 credential을 실제 authStorage/Keychain에 쓰지 않았다. 서버 state 출력에도 토큰은 없다.
잠금 Activity는 로컬 ActivityKit이며 iOS 허용 prompt는 누르지 않았다. 지속 허용 후 표시/APNs 검증이 아니다.
토큰 만료 E2E는 잠금 후 상태 샘플링이며 정확한 background 종료 SLA를 측정한 것은 아니다.

## 정리와 다음

- 내부 saved 화면과 coordinator의 중복 fetch/timeout/response parse를 공통 credential-free helper로 통합했다.
  인증 요청은 별도 공통 native client로 정리했다. 쓰는 회귀 fixture/replay/이전 단계 증거는 유지했다.
- 새 native client로 다시 E2E한 뒤, 이번 작업의 중간 빌드 스크린샷 6개를 Git 밖의
  `/Users/mac/IdeaProjects/NoLate/.qa-artifact-archive/p23auth-superseded.0eugXt`에 보관했다.
  최종 기록에는 07–18만 사용한다. README/원본 이미지로 복구 가능하며 사용자 파일은 삭제하지 않았다.
- 안내 stop·GPS replay 종료/location clear·fixture reset을 완료하고 15543/15544/15545 시험 listener를 종료했다.
  시험 Info.plist와 pod install generated project/lock 변경은 작업 전 내용으로 복원했다.
  기존 미커밋 변경은 보존했고 `.env`는 읽거나 바꾸지 않았다. 설치된 simulator binary만 opt-in이다.
- 복구 방지용 native tombstone은 삭제하지 않았다. 최종 디스크 확인은 `revoked=true`,
  `value` 없음, 34 bytes였다. 경로/토큰이 아니라 종료된 세션의 복구를 막는 유효한 안전장치다.

다음 P2-3b2b2b는 token refresh single-flight와 native credential 갱신·logout/계정 변경 race·cold/기기
소유권 이전을 다룬다. 실제 본인 일정/지도 타일 E2E는 별도 isolated-authority 환경에서 수행한다.
그 후 지원 노선의 ride evidence·승하차/잔여 정류장·거리/시간 안내·음성/알림을 확장한다.
