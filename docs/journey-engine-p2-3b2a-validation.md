# P2-3b2a 상세 시험 진입·엔진 위치 지도 연결·저장 경로 수명

2026-10-05 (Asia/Seoul). FE·BE 브랜치 `feature/transit-guidance-v1`.

## 결과와 범위

기존 일정 상세 컴포넌트 안에서 경로 검사 → 최대 10분 명시 동의 → 준비/종료를 연결했다.
준비는 ARMED일 뿐 출발 처리가 아니며 GPS 관측으로만 자동 출발한다. 수동 출발/단계 버튼은
이 시험 상세 흐름에서 표시하지 않는다. 정상 제품의 기존 출발 흐름은 아직 전역 제거하지 않았다.

native가 수용한 현재 GPS 위치를 지도용 읽기 전용 snapshot에 추가하고 동일 상세 지도 marker에 연결했다.
독립 시뮬레이터에서 오프라인 전체 경로와 위치 점, GPS stale/회복, 저장 경로 교체 후 자동 종료,
로컬 잠금 Live Activity 표시/제거를 확인했다. 운영 인증 연결은 **아직 완료하지 않았다**.
이번 범위는 P2-3b2 전체가 아니라 **b2a 지원 범위 구현**이다.

## 변경

- native Runtime의 마지막 수용 GPS sample은 메모리에만 유지한다. `guidancePosition`은 공통
  projection ACTIVE/GOOD·원본 observation/TTL 일치·좌표/정확도 검사에서만 반환한다.
  위치 원문은 Activity content, checkpoint, outbox, HTTP arrival 요청에 추가하지 않는다.
  arm/restore/stop/release 또는 GPS 거절 시 기존 sample을 비우고 restore에는 새 GPS가 필요하다.
- `useSavedJourneyPosition`은 bridge 읽기/구독과 원본 TTL만 소비한다. 늦은 initial read가 새 event를
  덮지 못하게 fence하고 마운트/언마운트로 GPS/세션/HTTP를 시작·종료하지 않는다.
  세션·일정·generation/revision/digest mismatch, 후보/불확실·stale·잘못된 좌표/정확도에서는 숨긴다.
- 기존 ScheduleDetail map controller가 본인 저장 경로의 신선한 엔진 위치를
  `schedule-detail-guidance-location` marker로 전달한다. 참여자 경로에는 내 위치 안내를 붙이지 않는다.
  기존 TMap renderer로도 같은 marker가 전달되지만 이번 E2E는 공급자 키/타일 없이 오프라인으로 수행했다.
- 상세 controller에서 authoritative 본인 저장 입력이 바뀌거나 없어지면 기존 검증 세션을 정리한다.
  다른 일정 보기/참여자 경로 보기/화면 닫기는 종료 사유가 아니다. 새 경로를 자동 준비하지 않는다.
  coordinator는 준비 중 입력 교체도 generation으로 취소하고 늦은 성공 응답이 native를 arm하지 못하게 한다.
  기존 auth invalidation 구독의 revoke 처리는 유지한다. 실제 로그인/계정 교체 E2E는 수행하지 않았다.
- `SavedJourneyTrialControls`와 오프라인 경로는 **DEV·명시 preview·합성 일정 9001/actor 7**의 상세
  시험 진입에만 연결한다. 정상 일정/서버의 인증을 우회하거나 사용자 DB를 갱신하지 않는다.
- 오프라인 표시에는 저장 input의 모든 leg 선을 그린다. numeric SVG·JS 비활성 WebView·about:blank만
  사용하며 외부 지도 타일/리소스/키를 요구하지 않는다. 지도 타일/축척·카메라 추적 제품 구현의 대체물이 아니다.

## 검사

| 검사 | 결과 |
| --- | --- |
| FE 전체 Jest, 최종 코드 | **282 suites / 2,478 tests PASS** |
| TypeScript | PASS |
| 이번 위치/시험 진입·controller 변경 파일 lint | errors/warnings 0 |
| native 순수 Swift 계약 | **237 tests PASS** |
| 위치 replay·진단 config | **13 tests PASS** |
| 최종 Debug 앱·위젯 build | **BUILD SUCCEEDED** |
| FE·BE diff whitespace | PASS |

신규 FE 검사는 위치 coordinate/accuracy/TTL와 세션 fence, stale/후보 숨김, 늦은 read 경쟁,
읽기 전용 cleanup, 동의/준비/종료 UI, 전체 leg의 안전한 오프라인 선 표현,
준비 중/실행 중 authoritative 경로 교체 취소를 포함한다. Swift 신규 1개 검사는 같은 원본 관측·
신선도·정확도·종료와 ephemeral 위치 계약이다. HTTP/ActivityKit/Runtime은 순수 Swift package에
포함되지 않아 native build·시뮬레이터 연결로 검증했다. BE 코드는 이번 단계에서 변경하지 않았으며,
직전 P2-3b1 journey 회귀 102 tests PASS 기록을 재실행 결과로 주장하지 않는다.

## 독립 시뮬레이터 E2E

기기 `NoLate Journey P0 Isolated 20261004`, iOS 26.5,
UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, detached `deviceWindow-AppWindow-1`.
computer-use skill을 사용해 독립 창 제목/ID/`Show in Device Hub`를 확인한 뒤 phone UI를 조작했다.
Device Hub 관리 pane/다른 기기/실기기는 조작하지 않았다. owner/menu 이름이 Device Hub인 것은
Xcode 27의 독립 창 구조이며 관리 pane 조작으로 대체하지 않았다.

P2-3b1의 단일 전체 합성 ODsay-shaped 저장 route, 가짜 시험 ID/형상, MockMvc loopback 15543을 재사용했다.
실제 CoreLocation callback으로 합성 위치를 4초 간격 주입했다. 출발지 37.5665,126.978에서
승차 정류장 37.5665,126.9795까지 약 132m를 이동했다. 원본 provider 정확도/실제 버스 탑승 검증이 아니다.
Metro/native build는 `EXPO_NO_DOTENV=1`, 일반 API는 도달 불가능한 127.0.0.1:15542로 제한했다.

| 사례 | 확인 | 증거 |
| --- | --- | --- |
| 상세 시험 진입 | 검사 전 동의·준비 disabled, 수동 출발 버튼 없음 | [01](evidence/journey-p2-3b2a-20261005/01-detail-consent-gated.png) |
| 상세에서 검사/동의/준비 | ARMED·READY, 출발/Activity 미시작, arrivalRequests 0 | [02](evidence/journey-p2-3b2a-20261005/02-detail-armed.png) |
| 최종 UI 준비·GPS 전 지도 | 도보·버스·최종 도보 선은 있고 현재 위치 점 없음 | [09](evidence/journey-p2-3b2a-20261005/09-final-map-ready.png) |
| GPS 자동 출발 후 위치 | 동일 route 위 파란 GPS 점, AX 좌표 37.566500,126.979500, 출발 감지/ACK 1회 | [10](evidence/journey-p2-3b2a-20261005/10-final-map-moving.png) |
| 상세 닫기 | native ACTIVE/WAITING·ACK·arrival 유지, 화면이 세션을 소유하지 않음 | [06](evidence/journey-p2-3b2a-20261005/06-screen-closed-native-active.png) |
| 서버 저장 route 교체·reload·상세 재진입 | 합성 MAPPED 전체 → 다른 SAVED_GUIDANCE 전체 input. 기존 native/server STOPPED, 카드·위치 제거 | [07](evidence/journey-p2-3b2a-20261005/07-route-replacement-stopped.png) |
| 위 경로 교체 뒤 잠금 | 이전 안내 Activity/prompt 제거 | [08](evidence/journey-p2-3b2a-20261005/08-route-replacement-lock-cleared.png) |
| 최종 GPS 입력 중단 | 파란 점 제거, 선은 유지 | [11](evidence/journey-p2-3b2a-20261005/11-final-map-gps-stale.png) |
| 최종 상세 GPS stale | UNAVAILABLE·위치 확인 필요, ETA/진행률/위치 숨김 | [12](evidence/journey-p2-3b2a-20261005/12-final-detail-gps-stale.png) |
| GPS 반복 입력 회복 | WAITING·첫 도보 100%·ETA 복구, native 위치 회복 | [13](evidence/journey-p2-3b2a-20261005/13-final-detail-recovered.png) |
| 최종 빌드 잠금 안내 | 같은 대기/ETA/첫 도보의 로컬 Activity. iOS 허용 prompt 미승인 | [14](evidence/journey-p2-3b2a-20261005/14-final-lock-guidance.png) |
| 최종 상세에서 사용자 종료 | native/server STOPPED, 안내 카드·위치 제거 | [15](evidence/journey-p2-3b2a-20261005/15-final-detail-stopped.png) |

첫 성공 세션 종료 시 prepare/departure/activation/mock cancel 각 1, arrivalRequests 7.
fixture reset 뒤 최종 배치의 두 번째 세션도 각 1, 최종 arrivalRequests 15/server STOPPED를 확인했다.
이는 합성 controller 부작용 계수이며 실제 알람/푸시 취소 횟수가 아니다. 위치 replay 종료·location clear,
최종 fixture reset 뒤 계수 0/state NONE/FRESH/MAPPED를 확인했다. Metro/harness는 후속 개발용으로 유지한다.

## 보완과 남은 범위

- 첫 native build는 기존 복원된 Podfile.lock과 로컬 Pods Manifest 불일치로 거절됐다. pod install 후
  앱·위젯 build를 확인했다. 첫 시험 실행은 background location capability 누락으로 fail-closed
  STOPPED였고 server stop/자동 출발 0을 확인했다. 시험 Info.plist에 opt-in·location을 명시 후 재빌드했다.
- 초기 오프라인 heading이 헤더에 가려져 배치를 수정하고 최종 bundle로 GPS/map E2E를 재실행했다.
  위치 숫자 caption은 AX에서 확인했으며 제품 지도 UI 디자인 검증으로 승격하지 않는다.
- Sky가 창 root를 일시 `unknown`으로 반환했다. 해당 상태에서 phone action을 보류하고 확인된
  독립 standard-window 상태에서만 종료했다. 캡처가 빠진 구간은 다시 읽어 stale/종료 증거를 남겼다.
- 시험 후 source Info.plist·pod install의 불필요한 generated project/lock 변화를 원래 상태로 복원했다.
  기존 P2-3a source references/checksum과 기존 미커밋 작업은 보존했다. 설치된 바이너리만 opt-in이다.
- **P2-3b2b:** 인증된 본인 일정/arrival transport, 화면이 없는 동안 authoritative route invalidation,
  account/device/권한 회수/cold restore 수명과 실제 지도 타일·marker 전달 E2E가 남는다.
  현재 route 변경 종료는 앱이 authoritative input 갱신을 받았을 때의 처리이며 서버 push invalidation이 아니다.
- default-off·DEBUG/simulator/SANDBOX와 고정 합성 일정 연결을 유지한다. 실제 DB/auth/provider/quota,
  실제 지도 키, 실기기, APNs/음성/무음 알림, 버스 승하차·완주/지하철·환승은 이번에 검증하지 않았다.
  unsigned simulator Keychain·notification module 경고도 인증/알림 완료로 처리하지 않는다.

재현: fixture `SAVED_GUIDANCE_MAPPED`, 진단 opt-in 앱
`nolate:///internal/journey-guidance?showDetail=1`에서 상세 검사 → 10분 동의 → 준비 후
walk/waiting-monitor replay. 시트 접기로 전체 경로/위치 점을 보고 GPS clear로 stale를 확인한다.
경로 교체는 fixture를 SAVED_GUIDANCE로 바꾸고 시험 화면에서 reload → 상세 재진입한다.
준비/종료 외 수동 phase 버튼은 사용하지 않는다. 종료·GPS clear·fixture reset 후 정리한다.

`.env`, 운영 플래그/사용자 데이터/실제 공급자 키/실기기는 변경하지 않았다. 커밋·푸시하지 않았다.
