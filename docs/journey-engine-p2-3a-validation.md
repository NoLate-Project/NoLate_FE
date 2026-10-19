# P2-3a 저장 경로·경로 상세·로컬 Live Activity 검증

검증일: 2026-10-04 (Asia/Seoul). FE·BE 브랜치: `feature/transit-guidance-v1`.

## 결과와 범위

소유 저장 경로 전체와 native 입력의 일치를 서버가 검사한 뒤, 화면 밖 native GPS Runtime의
한 안내 projection을 기존 경로 상세 컴포넌트와 로컬 ActivityKit에 연결했다.
독립 시뮬레이터에서 GPS 이동에 의한 자동 출발·첫 도보·정류장 대기·신호 만료·종료를 확인했다.
단계 전환/수동 출발 버튼으로 이동 상태를 만들지 않았다. 준비·종료는 사용자 제어로 남는다.

이는 **P2-3의 첫 제한된 연결**이다. 인증된 운영 일정의 동의/준비 진입, 지도 오버레이, 도착 관측
통합, 실제 버스 탑승·하차/완주, 지하철·환승, 음성·안내 알림과 APNs는 완료하지 않았다.
정상 설정은 default-off이고 native 실행/로컬 안내는 DEBUG + simulator + 명시 opt-in + SANDBOX다.

## 변경

1. `POST /api/schedules/{scheduleId}/automatic-journey/prepare-saved`는 로그인 actor의 저장 plan으로
   native v1 allow-list를 독립 재구성한다. 원문 SHA-256, 독립 endpoints, provider/품질/형상,
   원본 정류장 순서·ID·방면, context/revision과 구조/수치 타입을 대조한다. 중복 키·후행 JSON·
   제한 초과·선택/저장 불일치·소유권/기기/generation 오류를 차단한다. 숫자 표기 1/1.0만 값으로 비교한다.
2. `savedRouteValidated` 응답이 일치해야 FE가 native를 준비한다. 기존 SAVED_ROUTE 읽기 전용
   평가를 전역 해제하지 않으며, 서버 확인과 usable 첫 WALK 형상 검사를 모두 통과해야 한다.
   ARMED는 출발 처리/알람 취소/Activity 시작이 아니다. 출발 receipt·멱등 동기화는 기존 계약을 유지한다.
3. native의 순수 공통 projection은 session/schedule/generation/revision/digest/sequence와 원본
   GPS 관측 시각을 포함한다. 첫 도보 진행률만 표시하고 버스 탑승/전체 여정 진행률로 해석하지 않는다.
   WAITING도 `boardingConfirmed=false`다. 후보·불확실·15초 만료에서는 진행률을 숨긴다.
   화면 재렌더나 타이머가 원본 관측 유효기간을 연장하지 않는다.
4. `SavedJourneyGuidanceCard`는 읽기 전용 snapshot 구독이다. 화면을 닫아도 GPS/Activity를 끄지 않고,
   새 화면 마운트로 시작하지 않는다. 기존 ScheduleDetailRouteSheet/QuickSummary에 연결하고,
   본인 일정·동일 전체 입력·검증된 안내 binding일 때만 표시/수동 출발 버튼 숨김을 적용한다.
5. 별도 `NoLateGuidanceAttributes`/위젯을 추가했다. 로컬 `pushType:nil`, staleDate=원본 관측+15초
   (세션 TTL 상한)이며 production Departure Activity와 분리한다. 종료/진단 cold-stop은 해당 안내
   Activity만 즉시 제거한다. push token이나 실제 APNs 발송은 사용하지 않았다.
6. 개발 전용 `/internal/journey-guidance`는 loopback test fixture의 전체 저장 plan으로 입력을 만든다.
   실제 기존 ScheduleDetail controller/sheet/timeline에 합성 previewItem을 전달한다. 운영 auth 우회,
   실제 사용자 일정 변경, 임의 phase 설정이나 별도 ID sidecar 사용은 하지 않는다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| FE 전체 Jest | 280 suites / **2,440 tests PASS** |
| TypeScript | PASS |
| 신규 안내 UI/상태/시험 화면 lint | errors/warnings 0 |
| BE journey 패키지 회귀 | 11 classes / **101 tests PASS**, 실패/오류/skip 0 |
| native Swift 순수 코어/계약 | **231 tests PASS** |
| CoreLocation replay + 진단 설정 | **13 tests PASS** |
| 최종 Debug iOS 앱·위젯 native build | **BUILD SUCCEEDED**, 설치 및 화면 E2E 확인 |
| FE·BE `git diff --check` | PASS |

BE 신규 8개 검사는 저장/native parity, 위조한 endpoints/geometry/IDs/context/revision/구조,
잘못된 원문 digest·중복 키·후행 JSON·크기, 소유권/플래그/generation/기기 fence, controller
인증/응답과 합성 route 표시 계약을 포함한다. FE는 stale/후보/identity mismatch, proof 없는
prepare 실패, read-only 구독 해제와 비활성 화면의 무구독을 검사한다. Swift는 saved arm 조건,
출발 전 READY, 도보 진행, 관측 TTL, 종료, 미확정 대기/탑승 후보를 검사한다.
UIKit/ActivityKit coordinator는 macOS 순수 Swift package에 포함되지 않으며 native build와
시뮬레이터 E2E로 확인했다. 위 test 수치는 실제 대중교통 정확도/운영 출시 지표가 아니다.
기존 경로 상세 두 파일까지 포함한 lint는 errors 0 / 기존 inline-style warnings 4개였다.

## 독립 시뮬레이터 E2E

기기: **NoLate Journey P0 Isolated 20261004**, iOS 26.5,
UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, detached window `deviceWindow-AppWindow-4`.
computer-use로 이 독립 창만 조작했다. Xcode 27에서 창 소유 app/menu는 Device Hub지만,
독립 창 제목과 `Show in Device Hub` 상태를 확인하고 관리 pane/다른 기기/실기기는 조작하지 않았다.

입력은 CoreSimulator 위치 → 실제 CoreLocation callback으로 들어간 합성 trace다. 출발지
`37.5665,126.978`에서 승차 지점 `37.5665,126.9795`까지 약 132m를 4초 간격으로 이동하고,
승차 지점 ±0.5m의 반복 관측으로 대기를 유지했다. 첫 도보·버스·최종 도보가 포함된 **단일 전체
합성 TMAP-shaped 저장 route**를 사용했다. 실제 공급자 응답/운행 정확도 검증이 아니며,
이전 P2-2b의 별도 ODsay 매핑 fixture와 GPS 경로 조합을 사용하지 않았다.
이 fixture에는 지원되는 실제 도착 공급자 route ID가 없어 arrival request는 **0**이다.

loopback `15543`은 test-source MockMvc/메모리 repository/합성 actor 7·generation 2를 사용한다.
실제 controller/service/domain 경로를 호출하지만 production DB/auth/외부 공급자를 호출하지 않는다.
앱 일반 API는 도달 불가능한 `127.0.0.1:15542`로 제한하고 `EXPO_NO_DOTENV=1`을 사용했다.

| 사례 | 결과 | 증거 |
| --- | --- | --- |
| 준비만 수행 | ARMED, 출발 감지 0, Activity 미시작. 이전 cold-stop의 ENDED 표시가 유지될 수 있음 | [10](evidence/journey-p2-3a-20261004/10-final-armed.png) |
| GPS 이동 → 자동 출발 → 정류장 대기 → 실제 상세 컴포넌트 | ACTIVE/WAITING, 첫 도보 100%, 탑승 미확정, Live Activity ACTIVE. 상세 타임라인 표시, 수동 출발 버튼 없음 | [13](evidence/journey-p2-3a-20261004/13-final-detail-visible.png) |
| 최종 native 바이너리 잠금 화면 | 같은 정류장 대기/첫 도보 100%의 로컬 Activity 표시. iOS 허용 요청은 미승인 | [12](evidence/journey-p2-3a-20261004/12-final-lock-local-guidance.png) |
| 위치 입력 중단 후 잠금 위젯 만료 | 위치 확인 필요, 진행률 숨김. 허용 요청은 건드리지 않음 | [06](evidence/journey-p2-3a-20261004/06-lock-gps-stale-permission-pending.png) |
| 최종 상세 화면 GPS 만료 | UNAVAILABLE/위치 확인 필요, 진행률 숨김 | [14](evidence/journey-p2-3a-20261004/14-final-detail-gps-stale.png) |
| 최종 안내 종료 | STOPPED, 안내 카드 제거, server STOPPED | [15](evidence/journey-p2-3a-20261004/15-final-stopped.png) |
| 최종 종료 후 잠금 화면 | 안내 Activity와 관련 허용 prompt가 제거됨 | [16](evidence/journey-p2-3a-20261004/16-final-lock-cleared.png) |
| orphan 정리 보완 후 cold-stop | 이전 process가 남긴 안내 Activity도 제거됨 | [09](evidence/journey-p2-3a-20261004/09-cold-stop-lock-cleared.png) |

최종 fixture 계수: prepare=1, departure=1, activation=1, mock cancel=1, arrivalRequests=0.
자동 출발은 1회이며 server ACKNOWLEDGED를 확인했다. 실제 알람/푸시가 취소됐다는 뜻은 아니다.
종료 후 위치 replay process 종료/`simctl location clear`와 fixture reset을 확인했다.
reset 후 계수 모두 0, state=NONE, transitMode=FRESH, mappingMode=MAPPED다.
앱은 STOPPED 상태이고 loopback harness·Metro는 후속 개발용으로 유지했다.

## 발견 후 수정

- 새 extension source reference를 group-relative로 만들면 경로가 중복되어 native build가 실패했다.
  plugin의 새 full-path reference를 SOURCE_ROOT로 수정하고 앱/위젯을 다시 빌드했다.
- prebuild가 앱 PRODUCT_NAME을 바꿔 Swift generated header를 찾지 못했다. 기존 이름을 복원했다.
  source Info.plist는 시험 후 원래 default-off로 복원했고, 생성 project 변경은 위젯 source refs만,
  Podfile.lock은 해당 native pod checksum만 남겼다. 설치된 시험용 바이너리만 opt-in 상태다.
- 합성 saved route에 기존 상세 UI가 요구하는 root ID/leg label이 없어 실제 상세 타임라인 진입이
  실패했다. 전체 fixture의 표시 계약을 보완하고 native/FE/BE 검사와 상세/잠금 E2E를 재실행했다.
- 진단 앱 재시작 후 coordinator가 이전 Activity handle을 잃으면 종료로 orphan이 남았다.
  종료 시 같은 안내 Activity 타입만 정리하도록 수정·native 재빌드 후 cold-stop/최종 종료를 확인했다.
- Sky의 화면 캡처가 이전 frame인 경우가 있어 잠금/해제 후 실제 pixels와 AX 상태를 대조했다.
  `11-final-detail-native-guidance.png`는 오래된 frame이므로 상세 화면 증거로 사용하지 않는다.

## 재현 시작점

BE의 `./gradlew automaticJourneyHarness --offline --no-daemon`으로 test-only server를 실행한다.
`POST /__fixture/mapping-control`에 `{"mode":"SAVED_GUIDANCE"}`를 전달한 뒤 개발 앱의
`nolate:///internal/journey-guidance`를 연다. 검사 → 최대 10분 시험 동의 → 준비를 수행한다.
GPS 입력은 기존 `scripts/qa/journey-bus-location-replay.mjs`의 walk/waiting-monitor를 사용한다.
해당 시뮬레이터에서만 진단 native opt-in 빌드를 사용하고, 실제 server/auth/provider로 연결하지 않는다.
UI는 반드시 detached 독립 창에서 조작하며, 준비 후 이동 단계를 버튼으로 설정하지 않는다.
종료 후 GPS 입력을 clear하고 fixture를 reset한다.

## 남은 게이트와 다음 단계

- **P2-3b:** 검증된 도착 feed를 같은 snapshot에 결합하고 실제 본인 일정의 명시 동의/준비 진입,
  로그인/계정/기기/경로 revision 수명과 지도 현재 위치·경로 표시를 연결한다. 지원 매핑만 ETA 표시.
- 현재 지도 설정 로딩은 실제 API를 차단해 실패했다. 경로 요약·타임라인·안내 카드는 확인했지만
  지도 타일/현재 위치 오버레이/지도상 진행은 **미검증**이다.
- iOS 실시간 현황 허용 prompt는 임의 승인하지 않았다. 표시·stale·종료는 확인했지만 승인 이후
  장시간 잠금 지속성/권한 회수 조합은 남았다. 실제 APNs 전달·실기기 잠금/종료는 별도 게이트다.
- ODsay WALK geometryInputComplete=false 차단은 그대로다. ID/방면 매핑 성공으로 형상 적격성을
  올리지 않는다. 이 전체 TMAP 합성 fixture를 실제 서울 ODsay 도착 지원으로 취급하지 않는다.
- 버스 차량 매칭·탑승 확정·잔여 하차 정류장·한 정류장 전/해당 정류장 안내, P3 지하철/환승,
  음성/무음→알림, 오디오 세션·APNs 정합성과 실제 현장 trace 정확도는 후속 개발/검증이다.
- 일반 앱의 수동 출발 버튼은 아직 전역 제거하지 않았다. 검증된 자동 안내 화면에서만 숨긴다.
  운영 자동 진입을 안전하게 대체한 뒤 최종 제거해야 한다.

`.env`, 실제 사용자 DB/공급자/API 키, 실제 APNs/알람, iPhone·Watch, 운영 플래그,
커밋·푸시는 이번 단계에서 변경/사용하지 않았다. 기존 미커밋 작업은 보존했다.
