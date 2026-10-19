# R3-3 하차 후 최종 도보 전환

2026-10-09 (Asia/Seoul). FE/BE `feature/transit-guidance-v1`. 제한된 단일 WALK-BUS-WALK 시뮬레이터 slice의 구현/자동 검사/독립 창 E2E 완료. 아래 실패·중단 이력은 삭제하지 않고 보존한다. 운영/현장 GPS/v4 실제 APNs 완료가 아니다.

## 구현 범위와 안전 경계

- 단일 `WALK-BUS-WALK`만 지원한다. 기존 저장 경로 digest/세션/세대/revision/인증 검증을 통과한 동일 경로에서 마지막 도보 geometry의 provenance·완전성·유일성·70m~10km 길이를 확인한다. 하차 정류장–도보 시작, 도보 끝–목적지, 선언 endpoint–shape 간격은 각각 최대 25m다. 누락 geometry를 직선으로 대체하지 않으며 환승/지하철 경로는 이 전환 대상이 아니다.
- 같은 차량이 먼저 떠났다는 R3-2 `SEPARATION_OBSERVED`가 신선할 때 목표 근처에서만 메모리 전용 handoff를 시작한다. 이 근거만으로 phase는 바뀌지 않는다. 최초 handoff는 최대 90초이며 반복 근거로 갱신하지 않는다.
- 8초 이내 간격의 새 GPS 관측, 정확도 25m 이내, 최종 도보 corridor 안의 연속 이동, 8m 이상 전진 표본 3개 이상·8초 이상·오차를 뺀 순전진 35m 이상을 추가로 요구한다. 차량 shape로부터 오차를 뺀 거리도 25m 이상이어야 한다. 한 번의 이동 30m 초과, 원시 속도 4m/s 초과, 오차 조정 속도 2.5m/s 초과, 역행 5m 초과는 차단한다. 정차·시계·차량 없음·과거 탑승 없는 GPS만으로는 최종 도보가 되지 않는다.
- 확정된 최종 도보도 위치 TTL 15초가 지나거나 GPS가 불량하면 마커와 잔여 거리를 숨긴다. 이때 이전 버스/첫 도보로 되돌리지 않는다. GPS gap 후에는 마지막 메모리 위치의 30m 이내에서만 재관측을 허용한다. 확정 후 차량 polling을 해제하지만 기존 인증·세션 만료 검증은 유지한다.
- 최종 도보 상태/이동 이력/handoff는 checkpoint·출발 outbox에 추가하지 않는다. 콜드 재시작에는 이전 전환을 복구하지 않는다. 차량 ID·좌표를 서버에 추가 전송하지 않는다.
- schemaVersion 4 `FINAL_WALK`는 로컬 Activity와 상세 지도/바/현재 행에 같은 신선한 위치를 투영한다. ‘목적지까지 · 도보 약 Nm’를 표시하고 도보 끝에서는 ‘목적지 근처 · 위치 확인’으로 표시한다. 100%·추정 ETA·도착 확정은 만들지 않는다. 서버 Activity 계약도 v4 표시 객체만 제한적으로 검증하고 END 시 위치 필드를 제거한다. 서버가 실제 하차를 독립 인증하거나 원격 APNs가 검증됐다는 뜻이 아니다.

## 자동 검사

- Swift 전체 323건 PASS. 경로 불완전/다른 topology/endpoint 불일치, 신선한 분리+연속 도보 양성, 정차/근거 없음/만료/잘못된 source/빠른 버스/점프/역행/정확도 불량/foreign identity·중복·미래 시각/만료·종료·gap 재획득 차단을 포함한다. 세션 통합에서 v4 상세·로컬 Activity 공통 투영과 콜드 복구 미지원도 검사했다.
- 최초 Swift 검사 2건 실패: 8m 경계의 부동소수점 누적으로 근거 수가 하나 적게 집계되고 160m 잔여 거리가 170m로 표시됐다. 1마이크로미터 수치 허용 여유로 계산 경계만 보정한 후 전체 재실행 PASS. 공간·속도 안전 기준을 줄이지 않았다.
- FE 전체 298 suites / 2,757건 PASS. 최종 도보 바·현재 행·지도 위치·잔여 거리, 다른 binding/metadata/환승 topology 차단, v1/v3/충돌 필드·ARRIVED 거부, 만료·종료 시 숨김을 포함한다. 초기 신규 검사에서 Expo SecureStore의 전이 import mock 누락과 불완전 fixture의 TypeScript 형변환 오류를 수정했다. 최종 별도 로그 전체 재실행과 TypeScript PASS.
- BE 여정/교통/LiveActivity 관련 55 suites / 419건 PASS, 실패·오류·skip 0. 격리 MySQL Testcontainers 포함. v4 충돌 필드/잘못된 phase·quality·progress·GPS/차량 원문 거부와 durable END의 제거를 추가했다. 프로젝트 무필터 전체 합격을 뜻하지 않는다.
- QA/진단 설정 34건 PASS. iOS Debug 진단 빌드 PASS. 임시 Info.plist 진단/인증·location/audio 설정은 소스에서 원복했다. `.env` 및 운영 기본 OFF는 바꾸지 않았다.

## 독립 시뮬레이터 E2E

대상은 `NoLate R2 Session E2E 20261008` / iOS 26.5 / `96AF9A48-4721-4335-B7BF-10B9382B7A30`이다. Device Hub 내장 preview가 아닌 `Show in Device Hub` 툴바가 있는 해당 기기의 독립 창만 조작한다.
서버의 차량은 승객 GPS를 읽지 않고 별도 합성 clock으로 이동·정차·출발한다. replay는 CoreSimulator GPS만 주입하며 앱 phase·하차/탑승 flag를 변경하지 않는다. 실제 공급자·실제 APNs·운영 DB는 사용하지 않는다.

첫 replay에서 ARMED 출발 0회 → GPS 이동으로 ACTIVE 출발 1회/ACK, 버스 RIDING, 목표 정류장 동시 정차와 하차 준비의 상세/잠금 카드 표시를 확인했다. 동시 정차 때 분리·최종 도보 근거는 0개로, 정차만으로 전환하지 않았다. 그러나 중간 잠금과 창 조작 오류 후 최종 도보는 끝까지 `FRESH_SEPARATION_REQUIRED`로 남았다. 이 실행은 양성 E2E 실패이며 성공으로 집계하지 않는다. 잠금 중 입력 gap 또는 다른 원인인지는 미확정이다.

첫 세션은 정상 종료(STOPPED, 서버 종료 대기 0건)했다. 독립 창을 전면에 유지하는 새 세션에서 동일 GPS/별도 차량 replay를 다시 실행했다. 출발 1회/ACK, BOARDING_CANDIDATE 2개 → RIDING 5개, 하차 준비 약 200m, 목표 동시 정차 시 RIDING 9개/분리 0개/최종 도보 0개를 확인했다.

그 다음 관찰 요청에서 CUA가 `The Mac is locked and automatic unlock could not unlock it`를 반환했다. 이후 독립 창 UI 관찰·조작을 할 수 없어 분리/FINAL_WALK, 최종 도보 상세·잠금 카드, 종료·콜드 재진입의 양성 E2E는 미검증이다. 첫 실패의 원인을 잠금으로 확정하지 않는다. replay는 자동 차량 근거 제거 구간에 도달한 상태에서 정확히 해당 소유 프로세스만 TERM으로 중단했고, 해당 기기의 CoreSimulator GPS를 clear했다. 실제 공급자/APNs 호출·운영 설정 변경은 없다. 앱의 정상 종료 버튼 조작은 잠금 해제 후 확인해야 하며 기존 최대 10분 세션 만료는 유지된다. 로컬 Metro/격리 harness는 재개 및 세션 만료 동기화를 위해 남겨 두었다.

당시 재개 계획은 Mac 잠금 해제 → 기존 세션 종료/큐 확인 → 새 전면 세션의 분리/연속 도보 → 상세·잠금 카드 → 만료/종료/콜드 미복구 확인이었다. 아래 재개 후 결과에서 각 관찰을 구분해 기록한다.

### 잠금 해제 후 재현·수정

- 재개 시 기존 세션은 `SAVED_SESSION_VALIDATION_EXPIRED`로 STOPPED, 서버 종료 대기 0건이었다. 만료된 합성 인증으로 신규 준비는 `AUTOMATIC_SERVER_REJECTED`로 차단됐다. 콜드 재진입으로 새 합성 인증을 받아 IDLE/출발 0/이전 근거 없음/동의 unchecked를 확인한 뒤 새 시험을 준비했다. 실제 로그인/Keychain 자격 증명은 사용하지 않았다.
- 수정 전 새 전면 replay에서 `SEPARATION_OBSERVED` 4개 → 최종 도보 `COLLECTING` 3개까지 관찰했고, 뒤이어 다시 `FRESH_SEPARATION_REQUIRED` 0개가 됐다. 따라서 첫 실패를 잠금 입력 gap으로 단정할 수 없다.
- Runtime `advanceClock()`가 차량 admission 없음에 대해 무조건 `disconnectRide()`를 호출했다. 최종 도보 확정 뒤 의도적으로 차량 polling을 끊는 코드와 충돌해 메모리 handoff를 삭제할 수 있었다. 회귀 테스트에서 차량 admission 소실 뒤 committed=false/UNAVAILABLE이 되는 2개 assertion 실패를 먼저 재현했다(`nolate-r33-admission-red-20261009.log`).
- 차량 lease 만료 전용 `expireRideAdmission()`을 도입했다. 미확정 handoff는 기존대로 제거하고 확정된 최종 도보만 유지한다. 명시적 disconnect/revocation, 세션 종료/만료, GPS 신선도 검사는 우회하지 않는다. 확정 도보 유지·미확정 제거·명시적 해제·세션 만료 차단을 함께 검사한 Swift 전체 323건 PASS, 수정 iOS 빌드 PASS. 임시 Info.plist 설정은 다시 원복했다.
- 수정 전 재현 세션은 정상 종료/서버 종료 대기 0건, GPS replay도 완료/clear했다. 수정 빌드를 해당 독립 기기에 설치해 양성 E2E를 다시 진행 중이다.

### 수정 빌드 E2E 관찰

- 새 전면 세션에서 GPS 출발 1회/ACK → RIDING 11개/목표 동시 정차 시 분리 0개·최종 도보 0개 → 동일 차량 분리 `SEPARATION_OBSERVED` 3개/최종 도보 `COLLECTING` 2개 → `FINAL_WALK` 10개를 관찰했다. 차량 연결이 `NOT_REQUESTED`가 되고 분리 원본 TTL이 끝난 뒤에도 신선한 최종 도보는 유지됐다. 최종 도보 잔여 50m와 마지막 회색 구간의 파란 마커를 확인했다.
- 실제 상세 컴포넌트에서 마지막 도보 행(leg 2)의 ‘현재 위치 · 목적지까지 · 도보 약 10m’를 AX로 확인했다. 경로 끝에 도달하자 ‘목적지 근처 · 위치 확인’으로 표시됐으며 ACTIVE를 유지했고 ARRIVED/일정 완료는 만들지 않았다.
- 독립 창 Controls → Lock으로 실제 시뮬레이터 잠금 화면을 열었다. 로컬 Activity에 ‘목적지까지 · 목적지 근처 · 위치 확인’과 마지막 도보 구간 마커가 표시됐다. OS의 추가 ‘항상 허용’ 권한은 누르지 않았다. GPS replay 종료/clear 뒤에는 카드가 ‘위치 확인 중’으로 바뀌고 파란 현재 위치 마커가 제거됐다. 기존 버스/첫 도보로 돌아가지 않았다.
- 잠금 중 합성 인증이 만료되자 native가 `AUTOMATIC_AUTH_EXPIRED`로 안전 종료했고 카드가 사라졌다. 서버 종료 요청은 RETRY_WAIT/1건으로 보존됐다. 만료된 인증으로 수동 재전송은 거부됐고, ‘저장 경로 다시 불러오기’로 새 합성 인증을 받은 뒤 자동 재전송돼 IDLE/0건을 확인했다. 이 결과를 정상 수동 종료 성공으로 섞어 기록하지 않는다.
- 종료 버튼과 상세 오프라인 지도 위치 점을 확인하기 위한 두 번째 수정 빌드 세션을 추가로 준비했다. GPS 출발 후 첫 도보/승차 지점 지도 점과 `엔진 위치 37.566500, 126.979500`, 접힌 상세 경로 바를 확인했다. 최종 도보 지도·정상 종료·콜드 재진입 결과는 이어서 기록한다.

### 최종 상세 지도·수동 종료·콜드 재진입

- 두 번째 수정 빌드 세션의 후속 UI 관찰은 약 4시간 뒤에 이뤄져 EXPIRED/인증 만료와 종료 대기 1건을 확인했다. 관찰 공백의 원인을 시스템 시각 변경이나 앱 결함으로 단정하지 않는다. 그 실행의 최종 도보/수동 종료는 성공으로 집계하지 않았다. 새 합성 인증 조회 후 종료 대기 0건으로 정리했다.
- 세 번째 수정 빌드 세션에서는 별도 합성 차량/GPS로 다시 출발·탑승·분리·연속 도보를 수행했다. 접힌 실제 상세 컴포넌트의 오프라인 지도에서 버스 목표 근처 위치 `37.566500,126.989495`와 파란 점을 확인했고, 이후 최종 도보의 `37.566500,126.990232`·잔여 약 70m·마지막 도보 구간의 파란 바 마커를 함께 확인했다. 이 좌표는 사람의 이동 기록이 아닌 명시적 합성 fixture다. 실제 지도 타일 조회는 하지 않았다.
- 도보 끝 근처의 위치 `37.566500,126.990998`·잔여 약 10m까지 업데이트됐다. 잠금 메뉴의 추가 캡처 시도에서 CUA stale element 오류가 발생했고, 메뉴를 Cancel로 닫았다. 이 추가 잠금 시도는 성공으로 집계하지 않는다. 실제 잠금 카드 양성/만료 UI 관찰은 첫 수정 빌드 세션에서 이미 수행했다.
- replay 완료/GPS clear 뒤에도 세션은 ACTIVE였지만 상세는 신선한 엔진 위치 없음/마커 없음으로 안전하게 표시됐다. 상세의 ‘위치 안내 종료’를 눌러 STOPPED, 근거 0개, 오류 없음, 서버 종료 대기 0건을 확인했다. 그 뒤 독립 창을 Raise하고 Controls → Lock을 실행해 실제 잠금 화면에 카드가 없는 것을 확인했다.
- 독립 기기 Home으로 앱에 복귀한 뒤 프로세스를 종료·재실행했다. 동일 시험 화면 콜드 재진입에서 IDLE/출발 0회/차량·분리·최종 도보 근거 0개/서버 종료 대기 0건/이전 안내 기록 없음/동의 unchecked를 확인했다. 이전 도보 handoff를 복구하지 않았다.
- 최종 harness 상태는 합성 ride/alighting/separation ON, 차량 mode EMPTY, 실제 push provider false, 실제 provider 시도·거절 모두 0이었다. `.env`/운영 기본 OFF/실기기 설정은 바꾸지 않았다. 커밋·푸시·배포는 수행하지 않았다.

스크린샷 디렉터리: `docs/evidence/journey-r33-final-walk-20261009/`.

- `detail-final-walk-map.png`: 최종 도보 위치 점과 마지막 도보 구간 마커의 실제 상세 캡처.
- `lock-gps-expired-first-capture.png`, `lock-gps-expired.png`: 최초 CUA 잠금 양성 관찰보다 늦게 캡처돼 이미 GPS 만료 표시였음을 파일을 열어 확인했다. 전자를 오해 소지가 있는 `lock-final-walk.png`에서 이름을 바로잡았다. 신선한 잠금 양성 파일로 제시하지 않는다. 신선한 최종 도보 잠금 화면은 CUA inline screenshot으로 확인했다.
- `stopped-queue-empty.png`, `lock-after-stop.png`, `cold-idle.png`: 정상 종료/카드 제거/콜드 미복구 캡처.

자동 검사 로그는 `/private/tmp/nolate-r33-admission-red-20261009.log`(의도한 실패 재현), `nolate-r33-admission-green-20261009.log`(323 PASS), `nolate-r33-admission-build-20261009.log`(BUILD SUCCEEDED), `nolate-r33-resume-qa-20261009.log`(34 PASS)에 남겼다. 이번 재개 수정은 native 차량 lease 처리와 Swift 회귀 assertion이며 FE/BE 계약은 직전 전체 검사 이후 변경하지 않았다.

정리: 모든 replay 완료/해당 기기 GPS clear, 정상 종료/콜드 IDLE 확인 후 소유 PID와 작업 디렉터리를 확인한 Metro 61977 및 격리 harness 62482만 TERM으로 종료했다. 8088/15544/15545 listener와 해당 PID가 남지 않았고 FE/BE `git diff --check`, Info.plist 원복 검사는 PASS였다. 다른 서버·시뮬레이터·실기기·사용자 파일은 정리 대상으로 삼지 않았다. 독립 시험 창은 IDLE 상태로 남겼다.

## 남은 게이트

R3-4에서 목적지 체류·위치 품질·최종 도보 이력을 결합한 도착 판정과 종료 동기화를 다룬다. 현재는 도보 경로 끝에 있어도 ARRIVED/일정 완료를 만들지 않는다. 실제 서울 노선 매핑, 운영 일정 진입, 현장 GPS 정확도와 지하철/환승/음성, v4 실제 원격 APNs는 별도 미완료 게이트다.
