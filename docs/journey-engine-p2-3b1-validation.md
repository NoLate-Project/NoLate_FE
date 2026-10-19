# P2-3b1 native 도착정보·상세 화면·로컬 Live Activity 검증

검증일: 2026-10-05 (Asia/Seoul). FE·BE 브랜치: `feature/transit-guidance-v1`.

## 결과와 경계

저장 전체 경로 검증 이후, native GPS Runtime이 도착정보 조회와 원본 유효기간을 관리하도록 연결했다.
기존 경로 상세 카드와 로컬 ActivityKit은 같은 안내 projection에서 버스 대기시간을 표시한다.
독립 시뮬레이터에서 위치 이동으로 자동 출발하고, 잠금 상태에서도 도착정보를 갱신/제거하는 것을 확인했다.
단계/출발 버튼으로 상태를 만들지 않았다. 준비 동의·종료는 사용자 제어로 남는다.

이번 연결은 **DEBUG + simulator + opt-in + SANDBOX, 일정 9001, 고정 loopback 15543 전용**이다.
인증된 운영 일정 진입, 실제 운행 피드, 지도 현재 위치 오버레이, 버스 탑승/하차·완주, 지하철/환승,
음성/무음→안내 알림과 실제 APNs는 완료하지 않았다. 정상 설정은 default-off다.
도착시간은 **승차 정류장으로 오는 버스**의 정보이지 사용자 차량 위치나 하차까지 남은 정류장이 아니다.

## 구현

- `NoLateSavedGuidanceArrivalPolicy`: saved-route proof, 자동 출발 ACK, ACTIVE/GPS GOOD/접근·대기,
  ODsay-shaped BUS leg 1의 명시된 local route ID/방면을 요구한다. canonical binding의 세션/
  generation/revision/digest, 원본 승차 sourceIndex·providerSequence·좌표와 입력을 대조한다.
- 도착 응답은 동일 query/fence, 공급자·ARS·방면, 원본 source/receipt/evaluation timestamp,
  최대 120초 source TTL/예정 도착 시각을 검사한다. `confirmedBoarding=false`,
  `remainingStopsToAlight=null` 계약을 유지한다. 잘못된 응답/만료/미지원은 ETA를 숨긴다.
- `NoLateSavedGuidanceArrivalTransport`: Runtime 소유의 single-flight polling, 명목 10초 간격.
  각 조회에서 저장 경로 binding을 다시 검사한다. 취소 token/binding fence, 메모리 응답만 사용,
  redirect 차단·인증/쿠키/캐시 없음·응답 256KiB 제한·timeout을 적용했다. GPS 원문을 전송하지 않는다.
  GPS/세션 부적격·종료 시 진행 중 요청과 응답을 비운다. 화면을 닫아도 조회 수명은 유지된다.
- 공통 projection에 선택적 도착 관측을 추가했다. 화면/위젯 타이머는 원본 TTL을 늘리지 않는다.
  Activity staleDate는 GPS 원본 유효기간과 도착 관측 유효기간의 최솟값이다. 위젯 업데이트 비교에도
  도착 상태를 포함해 방면 오류/회복이 잠금 화면에 반영된다. 로컬 `pushType:nil`을 유지한다.
- 상세 카드는 snapshot 구독만 한다. HTTP/GPS를 시작하지 않는다. 같은 신선한 관측의 대기시간과
  탑승 미확정을 표시하고 후보·불확실성·원본 만료에서는 ETA/진행률을 숨긴다.
- BE 변경은 이번 단계에서 test-source fixture/harness/검사에 한정했다. 기존 실제 controller/service/
  domain의 prepare-saved·canonical binding·arrival 계약을 재사용한다. 운영 공급자 연결은 바꾸지 않았다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| FE 전체 Jest | 280 suites / **2,459 tests PASS** |
| TypeScript / 변경 안내 파일 lint | PASS / errors·warnings 0 |
| BE journey 패키지 회귀 | 11 classes / **102 tests PASS**, 실패·오류·skip 0 |
| native 순수 Swift 검사 | **236 tests PASS** |
| 위치 replay·진단 설정 검사 | **13 tests PASS** |
| Debug iOS 앱·위젯 native build | **BUILD SUCCEEDED**, 설치·독립 창 E2E 확인 |

Swift 신규 검사는 조회 적격성/ACK, canonical 입력 parity, 노선·방면·원본 순번, 응답 fence,
탑승/하차의 부정 계약과 TTL을 포함한다. FE 신규 검사는 ETA 렌더링과 후보/phase/status/잘못된
시각·방면·ID의 숨김을 검사한다. BE 신규 검사는 단일 전체 합성 저장 route의 입력·지원 매핑 계약이다.
macOS 순수 Swift package는 UIKit/ActivityKit/HTTP transport를 포함하지 않는다. 해당 연결은 native
build와 아래 E2E로 확인했으며 모든 네트워크 취소 경쟁/장시간 background 동작을 증명하지 않는다.

## 독립 시뮬레이터 E2E

기기: **NoLate Journey P0 Isolated 20261004**, iOS 26.5,
UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, detached `deviceWindow-AppWindow-1`.
computer-use skill에 따라 독립 창 제목·`Show in Device Hub` 상태를 검사하고 phone UI를 조작했다.
Xcode 27의 창 owner/menu 명칭은 Device Hub다. 초기 해당 시험 기기를 분리하는 작업 외에는
관리 pane/다른 기기/실기기에서 phone 작업을 하지 않았다.

CoreSimulator 위치 → 실제 CoreLocation callback의 합성 trace를 사용했다. 출발지
`37.5665,126.978` → 승차 정류장 `37.5665,126.9795`, 약 132m를 4초 간격으로 이동했다.
정류장 ±0.5m 반복 입력으로 대기를 유지했다. 수동 phase/departure bridge는 사용하지 않았다.
도보·버스·최종 도보의 **단일 전체 합성 ODsay-shaped 저장 경로**에 시험용 가짜 운영 ID/원본 순번과
완전한 합성 형상을 명시했다. 실제 ODsay payload/형상 적격성/서울 운행 정확도의 증거가 아니다.
production ODsay WALK의 `geometryInputComplete=false` 차단은 그대로다.

loopback 15543은 MockMvc·메모리 repository·합성 actor 7/generation 2로 실제 controller/service/
domain 경로를 실행한다. 일반 API는 도달 불가능한 127.0.0.1:15542로 제한하고
`EXPO_NO_DOTENV=1`을 사용했다. 실제 DB/auth/provider/quota/APNs는 사용하지 않았다.

| 사례 | 확인 결과 | 증거 |
| --- | --- | --- |
| 준비만 수행 | ARMED, 출발 0, Activity 미시작, arrivalRequests 0 | [02](evidence/journey-p2-3b1-20261005/02-armed-no-arrival.png) |
| 위치 자동 출발·대기 | 자동 출발/ACK 1회, WAITING·GPS GOOD·첫 도보 100%, 약 115초 대기·탑승 미확정 | [03](evidence/journey-p2-3b1-20261005/03-gps-auto-departure-arrival.png) |
| 기존 상세 컴포넌트 | 동일 도착시간/탑승 미확정, 실제 상세 타임라인, 수동 출발 버튼 없음 | [04](evidence/journey-p2-3b1-20261005/04-detail-arrival.png) |
| 잠금 화면 도착정보 | 방면·버스 도착 countdown·첫 도보 100%·탑승 미확정 | [05](evidence/journey-p2-3b1-20261005/05-lock-arrival-permission-pending.png) |
| 잠금 중 반대 방면 응답 | polling 유지, ETA·방면 제거, 신선한 첫 도보 진행은 유지 | [06](evidence/journey-p2-3b1-20261005/06-lock-wrong-direction.png) |
| 원본 도착정보 STALE | GPS가 신선해도 도착시간 숨김 | [08](evidence/journey-p2-3b1-20261005/08-detail-source-stale.png) |
| 신선한 도착정보 복구 | 동일 대기 상태에서 ETA 복구 | [09](evidence/journey-p2-3b1-20261005/09-detail-fresh-recovery.png) |
| 저장 경로 변경 | ARRIVAL_UNAVAILABLE·ETA 숨김, provider 조회 40→40 | [10](evidence/journey-p2-3b1-20261005/10-detail-saved-route-changed.png) |
| 10분 native 시험 TTL 만료 | EXPIRED, 상세 안내 카드 제거 | [11](evidence/journey-p2-3b1-20261005/11-detail-trial-expired.png), [12](evidence/journey-p2-3b1-20261005/12-trial-expired.png) |
| 만료 뒤 사용자 종료·잠금 | native terminal EXPIRED 유지·sync IDLE, 서버 STOPPED, 안내 Activity/prompt 제거 | [13](evidence/journey-p2-3b1-20261005/13-stopped.png), [14](evidence/journey-p2-3b1-20261005/14-lock-stopped.png) |

위치 반복 입력이 끊긴 중간 구간에서 상세 화면 UNAVAILABLE·ETA/진행률 숨김도 AX로 확인했다.
그 후 새 GPS 입력과 도착정보 FRESH로 복구했다. 이 GPS stale 구간은 별도 스크린샷을 남기지 않았으며,
이번 최종 잠금 stale 사진으로 주장하지 않는다. P2-3a의 GPS stale 잠금 검증은 별도 기록에 있다.
잠금 중 도착 조회가 9→17회로 증가했고 잘못된 방면 응답이 위젯에 반영됐다. 이는 제한된 시험 실행의
background 조회 증거이며 앱 강제 종료/장시간 잠금 지속성이나 운영 배터리·조회 한도를 증명하지 않는다.
저장 경로 변경은 다음 binding 조회에서 ETA를 차단했지만 native GPS는 기존 입력을 계속 사용한다.
즉시 경로 invalidation/재준비 수명은 P2-3b2의 별도 작업이다.

최종 종료 직전: prepare=1/departure=1/activation=1/mock cancel=1/arrivalRequests=40.
종료 후 server STOPPED/arrivalRequests=40, 위치 replay 종료 및 `simctl location clear` 확인.
fixture reset 후 모든 계수 0/state NONE/FRESH/MAPPED다. loopback harness와 Metro는 후속 개발용으로 유지한다.

## 남은 게이트·재현

- iOS 실시간 현황 허용 요청은 승인하지 않았다. 승인 전 일시 로컬 표시/갱신/제거만 확인했다.
  실제 APNs 전달, 허용 이후 지속성/권한 회수, 실기기 무음·음성 안내는 미검증이다.
- 지도 설정은 일반 API 차단으로 불러오지 못했다. 타일/현재 위치·경로 오버레이는 미검증이다.
  기존 unsigned simulator Keychain/notification 경고도 있어 인증·알림 E2E로 취급하지 않는다.
- 다음 **P2-3b2**는 실제 본인 일정에서 동의/준비 진입, auth/account/device/route revision 수명,
  로그아웃/경로 교체 정리와 지도 현재 위치 연결이다. 실데이터 지원·배포 활성화는 별도 판단한다.
- 버스 차량 식별·탑승 확정·잔여 하차 정류장·한 정류장 전/해당 정류장 안내, P3 지하철/환승,
  음성/무음 채널 정책은 후속이다. 이번 도착정보만으로 탑승을 확정하지 않는다.

test harness를 실행하고 `POST /__fixture/mapping-control`에
`{"mode":"SAVED_GUIDANCE_MAPPED"}`를 전달한다. 진단 opt-in 앱의
`nolate:///internal/journey-guidance`에서 검사 → 10분 동의 → 준비 후 walk/waiting-monitor replay를 사용한다.
`/__fixture/transit-control`의 WRONG_DIRECTION/STALE/FRESH와 mapping-control의 CHANGED_ROUTE로
숨김/복구를 확인한다. 반드시 독립 창에서 조작하고 종료 후 GPS clear·fixture reset을 수행한다.

첫 native build의 Swift 표현식 오류는 수정 후 재빌드했다. 시험 후 source Info.plist를 원래
default-off로 복원하고 pod install의 불필요한 generated project/lock 변경도 복원했다.
기존 P2-3a의 extension source references/pod checksum과 미커밋 작업은 보존했다.
설치된 진단 바이너리만 opt-in 상태다. `.env`, 사용자 DB/실제 공급자 키, 실기기, 운영 플래그,
실제 APNs/알람, 커밋·푸시는 이번 단계에서 변경/사용하지 않았다.
