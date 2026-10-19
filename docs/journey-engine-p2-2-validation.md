# P2-2a 도착 관측 연결 검증 — 2026-10-04

이 문서는 P2-2a 당시 기록이다. 후속 저장 경로 메타데이터 매핑의 현재 범위는 [P2-2b 검증 기록](journey-engine-p2-2b-validation.md)을 따른다.

## 범위와 결과

GPS 기반 P2-1 정류장 접근·대기 관측에 도착정보 신선도/요청 식별자 매칭을 연결했다.
독립 시뮬레이터 + 합성 응답 수직 시험 통과이며 실제 공급자 데이터 정확도 또는 실제 경로 매핑 통과는 아니다.
P2-2b와 P2-3, 버스 한 경로 완주·음성·APNs·현장 검증은 남아 있다.

## 연결 계약

- 서울 `busRouteId`, `vehId1/vehId2`와 TAGO `routeid`를 arrival-provider namespace에 보존한다.
  잘못된/0 차량 ID는 제거한다. TAGO 도착 피드가 제공하지 않는 차량/원천 시각은 만들지 않는다.
- `POST /api/schedules/{scheduleId}/automatic-journey/{sessionId}/bus-arrivals`는 읽기 전용이다.
  인증·로그인 세대·본인 일정 접근·세션 소유·digest/revision/generation·TTL·최신 세션·저장 경로 fingerprint·첫 도보 다음 버스를 검사한다.
  공급자 조회 전후에 검사하여 늦은 결과도 폐기한다. 운영 자동 안내 플래그와 실행 환경 게이트는 유지한다.
- 현재 쿼리는 명시적 `SEOUL_BUS` namespace, 5자리 ARS, 공급자 노선 ID, 방면 label, legIndex=1만 허용한다.
  ID 숫자열이 같아도 TMAP/ODSAY ID로 자동 치환하지 않는다. 정류장 이름 fallback은 사용하지 않는다.
  기존 공급자 조회의 deadline/rate-limit 및 10개 결과 상한을 유지한다. 상한 밖 목표 노선은 안내 가능으로 추정하지 않는다.
- 매칭 증거는 `REQUEST_IDENTIFIERS_ONLY`이다. 서버가 저장 경로의 공급자 교차 매핑을 인증했다는 의미가 아니다.
  방면도 요청/공급자 label의 명시적 일치만 검사한다. 정류장 발생 순서/회차의 완전한 증거는 아직 아니다.
- 어댑터의 원천 시각 + 최대 120초 / 예상 도착시각 중 빠른 값을 exclusive expiry로 사용한다.
  수신 시각으로 원천 freshness나 ETA를 새로 시작하지 않는다. FE도 원래 timestamp를 재검사한다.
- `incomingVehicleId`는 정류장으로 오는 차량이다. `confirmedBoarding=false`, 하차 잔여 정류장 null,
  차량 추적/발화 false를 유지한다. 기존 P2-1 시간 어댑터의 상수 null ID 필드는 그대로이며 raw ID는 별도 매처가 소비한다.

## FE 시험 수명

`JourneyBusArrivalTrial`은 개발용 foreground 카드다. 현재 선택 input의 JSON과 준비된 digest의 원본 JSON이
정확히 같고, 네이티브 세션이 유효한 SANDBOX이며 버스 품질 GOOD / APPROACHING_STOP 또는 WAITING일 때만 조회한다.
1초마다 표시/위치 유효성을 확인하고 최대 10초에 한 번 single-flight 조회한다. 요청 timeout은 4초, 응답 상한은 64KiB다.
좌표·토큰·실제 API 설정은 전송하지 않으며 고정 loopback fixture(15543/9001)에만 요청한다.
위치 불확실 이벤트, background, 경로 변경, 종료, unmount에서 요청/캐시를 취소하고 늦은 결과를 버린다.
화면을 닫으면 이 도착 조회는 중단되지만 기존 네이티브 위치 시험의 수명은 유지된다.
화면 밖 도착 조회/안내 지속성은 공통 상태 수명으로 이전하는 P2-3 작업이다.

실제 선택 경로의 LOCAL_ONLY 카드에는 `PROVIDER_ID_MAPPING_REQUIRED`를 표시하고 서버를 호출하지 않는다.
합성 ID는 별도 sidecar에만 존재한다. 기존 합성 입력에 노선/차량 ID를 만들지 않는다.
출발/탑승/다음 단계 진행 버튼은 없으며, 검사·동의·준비·복구·종료는 개발 시험 제어이다.

## 자동 테스트

| 검증 | 결과 |
| --- | --- |
| FE 전체 Jest | 277 suites / 2,360 tests PASS |
| 새 순수 도착 경계 + UI 경계 | 28 + 8 = 36 tests PASS (전체에 포함) |
| TypeScript / 변경 소유 파일 lint | PASS / 오류·경고 0 |
| BE 신규 매처·서비스·인증 경계 | 12 tests PASS (다수 입력 변형 포함) |
| BE 관련 전체 실행 | 93 tests PASS / 실패·오류 0 |
| 위치 replay + 진단 설정 | 6 + 7 = 13 tests PASS |

BE에는 늦은 응답 도중 종료, 잘못된 소유자/actor/세대/revision/digest, 저장 경로 변경, TTL 만료, 플래그 off를 포함한다.
FE는 응답 식별자·원천 expiry·조회 single-flight·late reply, 후보/미접근 차단, unmount abort,
LOCAL_ONLY 차단과 다른 경로 선택 시 이전 차량 정보의 즉시 숨김을 포함한다.
이번 작업에서 Swift/네이티브 소스를 바꾸거나 새 iOS 바이너리를 빌드하지 않았다. 이전 P2-1 바이너리에 최종 JS를 다시 로드했다.
P2-1 Swift 227개 결과를 이번 재실행 결과로 세지 않는다.

## 독립 시뮬레이터 위치 E2E

대상 UDID: `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, 이름 `NoLate Journey P0 Isolated 20261004`, iOS 26.5.
조작 대상은 `deviceWindow-AppWindow-4`의 독립 창이고 `Show in Device Hub` 도구막대로 구분했다.
Device Hub 관리 창/다른 시뮬레이터/실제 iPhone·Watch는 조작하지 않았다.
computer-use의 최신 AX 요소로 화면을 조작했고, 위치 입력은 simctl → 실제 CoreLocation 콜백을 사용했다.
phase 주입이나 출발/탑승 버튼으로 상태를 넘기지 않았다. 실제 관측된 수평 위치 오차는 5m다.

1. 검사/동의/준비 후 첫 도보 좌표로 자동 출발 1회, 정류장 접근에서 자동 HTTP 조회와 대기시간 표시.
2. 정류장 부근 0~0.5m 체류 좌표 유지 → WAITING/GOOD, 합성 버스 도착 117초와 도착 예정 차량 ID 표시.
3. 좌표는 계속 유효하게 유지하면서 공급자 fixture만 변경:
   WRONG_ROUTE / WRONG_DIRECTION → IDENTITY_MISMATCH, STALE → STALE, EMPTY → NO_ARRIVAL.
   모두 대기시간/도착 예정 차량을 숨김. FRESH 복구 시 자동 재표시.
4. 1Hz 10m 이동 좌표 → BOARDING_CANDIDATE/GOOD. 탑승은 미확정이고 정류장 대기정보는 즉시 숨김.
5. 오래된 위치와 종료 상태에서 대기정보가 없음. 종료 후 fixture의 출발/활성화/알람 취소 각 1회이며 실제 사용자 데이터 변경 없음.
6. 최종 소스 재시작 후 같은 GPS 출발·대기·도착 관측을 재확인. 마무리는 STOPPED, 위치 clear, fixture reset이다.

증거 폴더: [journey-p2-2-20261004](evidence/journey-p2-2-20261004/).
`01-location-stale`는 신선한 접근 증거가 아니다. AX 접근 116초는 확인했지만 첫 캡처 전에 위치가 오래되어
stale로 표시됐고 그 상태 그대로 이름/기록을 수정했다. `02`~`08`은 각 상태의 실제 화면을 저장했다.
최종 소스 재시작에서도 짧은 체류 trace 종료 후 캡처 지연으로 stale가 된 화면은 `10-final-location-stale`로 보존했다.
연속 체류 좌표로 다시 검증한 `11-final-fresh-waiting`은 WAITING/GOOD 및 도착 115초,
`12-final-stopped`는 신선한 도착정보가 있던 상태에서 종료해 대기시간/차량 ID가 제거된 결과다.
최종 fixture reset 후 prepare/departure/activation/cancel/arrivalRequests=0, lastState=NONE, transitMode=FRESH를 확인했다.

## 발견한 실패와 수정

- 기존 bus UI 테스트가 새 도착 카드의 실제 storage/native 의존성을 불러 초기 Jest 파싱 실패:
  기존 panel 단위 테스트는 자식 카드를 분리하고 새 카드 자체의 경계 테스트를 별도로 추가했다.
- 전체 Jest에서 기존 virtual module mock과 새 non-virtual mock의 해석이 충돌해 자동 시험/브리지 테스트 35개 실패:
  동일 경계 mock을 virtual 방식으로 통일한 뒤 전체 277 suites 재실행 PASS.
- 카드가 LOCAL_ONLY/다른 선택으로 바뀔 때 이전 차량 ID를 보여줄 가능성을 발견:
  input/scope 기준 캐시 표시 fence와 UI 회귀 테스트를 추가했다.
- 서버 세션뿐 아니라 저장 경로 fingerprint와 실제 첫 버스 구간도 검사하도록 보강했다.

## 남은 게이트

P2-2b: 실제 선택·저장 경로 ↔ 공급자 ID/승차 정류장 발생 순서/방면 매핑을 서버에서 검증하고 입력과 결합.
지원되지 않는 공급자는 계속 fail-closed. 실 공급자 호출/계약·요금·쿼터·원천 timestamp 정확도는 미검증이다.
P2-3: 공통 엔진 snapshot을 실제 경로 상세 및 Live Activity에 연결, foreground 밖 수명과 ActivityKit 로컬 표시 테스트.
이후 특정 차량 탑승·하차 확정, 한 정류장 전 안내와 TTS/알림, APNs 실제 전달/잠금 상태 실기기 검증, 현장 정확도 표본.
현재 기록으로 이 항목들을 완료 처리하지 않는다. `.env`/운영 플래그/사용자 데이터는 변경하지 않았고 커밋·푸시는 하지 않았다.
