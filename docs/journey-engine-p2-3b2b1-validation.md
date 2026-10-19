# P2-3b2b1 서버 수명 lease·화면 독립 재검증·cold 복구

2026-10-05 (Asia/Seoul). FE·BE 각각 `feature/transit-guidance-v1`.

## 결과와 범위

서버가 본인 저장 경로·계정 로그인 세대·세션 소유자/세대/경로 버전/digest·원래 만료를
재검증하는 API와 native 소유의 짧은 검증 lease를 추가했다. 상세 화면을 다시 열거나 JS가
경로를 다시 읽지 않아도 서버의 거절로 native GPS·도착 조회·로컬 Live Activity를 종료한다.
앱 재실행 후 저장 안내 복구는 명시 동의 및 서버 승인을 먼저 통과해야 한다.

이는 **P2-3b2b의 수명 연결 slice(b2b1)** 이다. 운영 인증 일정 진입과 native 인증 transport를
완료했다는 뜻이 아니다. 모든 시뮬레이터 요청은 이전 고정 loopback fixture/합성 actor를 쓴다.
실제 credentials·DB·교통 공급자·APNs·실기기는 사용하지 않았다.

## 변경

- BE `POST /api/schedules/{scheduleId}/automatic-journey/{sessionId}/validate`:
  AuthenticationPrincipal과 access-token session generation 필수. 계정 존재/삭제/현재 로그인 세대,
  본인 일정 접근, 저장 route fingerprint, 최신 세션, ARMED/ACTIVE, manual 세션 충돌,
  owner/generation/revision/digest, execution gate 및 원래 10분 TTL을 검증한다.
  응답은 identity fence와 state, validatedAt, validUntil만 반환한다.
  lease는 `min(validatedAt + 30초, 세션 expiresAt)`. 좌표 업로드·출발 활성화·알림 취소는 없다.
  기존 버스 observation fence도 동일 공통 검사를 재사용하되 첫 WALK→BUS 제약은 유지한다.
- Native worker: Debug simulator/opt-in·saved guidance·SANDBOX·일정 9001만 허용한다.
  GPS 신선도·APPROACH/WAITING·공급자 매핑 지원 여부와 독립적으로 10초 간격 single-flight 검증.
  기존 arrival clear와 lifetime clear를 분리해 GPS stale이 검증 lease를 초기화하지 않는다.
  URL/redirect/credential/cache/timeout/response-size 제한은 기존 fixed fixture transport를 유지한다.
- 신원/경로 거절 HTTP 또는 잘못된 lease 응답은 즉시 fail-closed.
  네트워크 오류/429/5xx는 마지막 승인 시각을 연장하지 않는다. 원본 server expiry와
  monotonic deadline을 검사하고 만료 시 `SAVED_SESSION_VALIDATION_EXPIRED`로 종료한다.
  초기 native bootstrap 역시 최대 30초이며 JS의 최초 서버 검증을 통과한 후에만 arm한다.
  세션 교체·종료 시 task cancel/token fence로 늦은 검증 응답을 폐기한다.
- Native revocation이 먼저 GPS·도착 polling·checkpoint/outbox·guidance position·Activity를 정리한다.
  JS lifetime 구독은 화면 밖에서도 binding을 비우고 server stop을 best-effort로 보낸다.
  계정이 이미 무효화되면 stop도 거절되므로 **서버 row STOPPED를 보장하지 않는다**.
- Cold 복구: 저장 binding/정확한 route digest 검사 → server validate → native restore.
  definitive rejection은 기존 checkpoint/binding을 revoke한다. transient failure는 위치를 시작하지
  않고 checkpoint를 격리 유지해 나중에 다시 명시 복구할 수 있다.
  내부 시험 화면에 복구 제어를 노출했으며 이동 단계/출발을 수동 확정하는 버튼은 추가하지 않았다.

이번 30초 정책은 개발용 conservative fail-closed 정책이다. 상용 오프라인 지속 안내 정책,
토큰 갱신 중 grace, 배터리/서버 호출 부하와 OS suspension 후 재획득은 다음 운영 연결 게이트에서
결정한다. 임의의 오프라인 상황에서도 안내를 무조건 계속한다는 보장이 아니다.

## 검사

| 검사 | 결과 |
| --- | --- |
| FE 전체 Jest | 283 suites / 2,500 tests PASS |
| 신규 lease/coordinator 집중 회귀 | 2 suites / 58 tests PASS |
| Swift pure package | 239 tests PASS |
| BE 전체 journey 회귀 | 12 suites / 108 tests PASS |
| 위치 replay·진단 config | 13 tests PASS |
| TypeScript·변경 파일 lint | PASS, errors/warnings 0 |
| Debug 앱/위젯 native build | BUILD SUCCEEDED |

Swift package에는 UIKit/URLSession Runtime/ActivityKit이 포함되지 않는다.
순수 정책의 session fence·state·원본 시각/TTL·HTTP 분류는 단위 테스트,
native 연결은 iOS build 및 아래 실제 시뮬레이터 동작으로 확인했다.
BE 회귀는 새 검증 6개뿐 아니라 기존 버스 binding/arrival·저장 입력·자동 출발·영속 receipt 계약도 포함한다.

## 독립 시뮬레이터 E2E

기기 `NoLate Journey P0 Isolated 20261004`, iOS 26.5,
UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, detached `deviceWindow-AppWindow-1`.
computer-use 스킬로 독립 window title/ID/`Show in Device Hub`를 검증하고 해당 phone UI만 조작했다.
Xcode 27 owner/menu 이름은 Device Hub지만 **관리 pane은 사용하지 않았다**.

단일 전체 합성 ODsay-shaped 저장 경로와 MockMvc actor 7/login generation 2를 재사용했다.
위치는 simctl replay → 실제 CoreLocation callback이며 출발지에서 승차 지점까지 약 132m,
37.5665,126.978 → 37.5665,126.9795의 합성 이동이다. phase/departure bridge는 호출하지 않았다.
일반 API는 도달 불가능한 127.0.0.1:15542, fixture는 15543, Metro는 NO_DOTENV/offline이다.

| 사례 | 관측 | 증거 |
| --- | --- | --- |
| 상세 준비 후 닫기·GPS 이동 | ACTIVE/출발 1회/ACK, 같은 첫 도보 진행과 합성 도착정보 | [01](evidence/journey-p2-3b2b1-20261005/01-active-detail-closed.png) |
| 잠금 중 저장 경로 서버 교체 | **reload/상세 재진입 없이** native/server STOPPED, 카드와 Activity 제거 | [변경 전 02](evidence/journey-p2-3b2b1-20261005/02-locked-before-route-change.png), [잠금 03](evidence/journey-p2-3b2b1-20261005/03-route-change-lock-cleared.png), [종료 04](evidence/journey-p2-3b2b1-20261005/04-route-change-native-stopped.png) |
| ARMED 프로세스 종료·재실행·명시 복구 | 자동 복구하지 않음. 검사/동의/서버 승인 뒤 ARMED, 새 GPS 전 출발/Activity 없음 | [05](evidence/journey-p2-3b2b1-20261005/05-cold-restore-authorized.png) |
| 복구 뒤 새 GPS 이동 | ACTIVE/출발 1회/ACK, prepareCount 1 유지 | [06](evidence/journey-p2-3b2b1-20261005/06-restored-gps-active.png) |
| 잠금 중 합성 계정 로그인 세대 2→3 | native STOPPED/VALIDATION_REJECTED·Activity 제거, **server stop은 인증 거절되어 row ACTIVE** | [잠금 07](evidence/journey-p2-3b2b1-20261005/07-account-revoked-lock-cleared.png), [종료 08](evidence/journey-p2-3b2b1-20261005/08-account-revoked-native-stopped.png) |
| 프로세스 종료 중 계정 무효화·재실행 복구 시도 | 서버 거절을 native restore **이전**에 처리, IDLE/출발 0, checkpoint revoke 후 복구 disabled | [09](evidence/journey-p2-3b2b1-20261005/09-cold-restore-rejected.png) |
| GPS 없는 ARMED·검증 endpoint 503·잠금 | 장애 약 6.6초 시점 잠금/서버 ARMED 확인, 약 55초 후 재진입 전 서버 STOPPED. polling 4회/arrival 0, native VALIDATION_EXPIRED | [잠금 10](evidence/journey-p2-3b2b1-20261005/10-validation-outage-lock-ended.png), [종료 11](evidence/journey-p2-3b2b1-20261005/11-validation-outage-expired.png) |

30초 lease는 계약·정책 검사의 경계값이며 위 E2E는 종료 상태를 샘플링한 것이다.
정확한 초 단위 background 종료 지연 SLA를 측정했다고 주장하지 않는다.
종료 후 validationRequests가 4에서 늘지 않는 것을 후속 확인했다.
계정 세대 무효화는 fixture principal/Member 모델 조작이며 실제 로그인·로그아웃 UI 검증이 아니다.

시뮬레이터 잠금 Activity는 **로컬 ActivityKit**이다. iOS 허용 prompt는 누르지 않았다.
실제 APNs 전달·권한 허용 후 지속 표시·실기기 잠금·무음/음성/환승/버스 탑승 검증은 남아 있다.

## 정리와 다음 단계

시험용 Info.plist opt-in/location 및 pod install의 generated project/lock 변경을 원래 상태로
복원했다. 기존 source references/checksum·미커밋 작업은 보존하고 .env는 읽거나 변경하지 않았다.
설치된 simulator binary만 opt-in이며 source/운영 기능은 default-off이다.

다음 **P2-3b2b2**: 실제 인증된 본인 일정 진입, credential/API-origin/account-generation fence가 있는
native 도착·수명 transport, refresh/logout/cold ownership/기기 이전과 실제 지도 타일 검증.
그 뒤 검증된 bus riding evidence·하차 목표까지 잔여 정류장/거리/시간, 음성/알림, 지하철/환승을 확장한다.
