# R3-4 목적지 도착·종료 동기화 검증

날짜: 2026-10-09, Asia/Seoul. 제한된 독립 시뮬레이터 slice 검증 완료.

## 범위와 도착 계약

DEBUG 시뮬레이터의 단일 WALK-BUS-WALK 경로만 대상으로 한다. 같은 차량 분리와
연속 저속 전진으로 최종 도보가 확정된 이후에만 도착 근거를 수집한다.

- 검증된 최종 geometry의 잔여 길이, geometry 끝, 저장 경로의 실제 destination 모두 검사한다.
- 정확도 10m 이하이며 오차 반경까지 각 20m 범위 안에 들어와야 한다.
- 기존 도보 검증(같은 세션/세대/revision, 원본 시각, 입력 출처, 신선도 8초,
  연속 관측 간격 8초 이하, 점프·속도·역주행·회랑 검증)을 통과한 GPS만 센다.
- 연속 20초 이상, 서로 다른 원본 관측 5회 이상이 필요하다. 시계 tick은 근거가 아니다.
- 범위 이탈·정확도 저하·관측 단절·잘못된 출처는 체류 근거를 초기화한다.
- `STOPPED / DESTINATION_ARRIVED`로 길안내만 종료한다. 서버 일정 완료 요청은 만들지 않는다.
- 기존 terminal 처리로 위치 관리자/차량·도착정보 polling/로컬 Activity를 종료하고,
  JS의 세션 소유권으로 묶인 서버 stop outbox를 재사용한다. 원격 APNs 계약은 확장하지 않는다.
- 최종 도보·도착 체류 근거는 메모리 전용이다. 복구 후 오래된 위치로 도착시키지 않는다.

## 중단된 종료 동기화 복구

native 종료·checkpoint tombstone 뒤 JS stop 큐 기록 전에 프로세스가 끝날 수 있다.
콜드 시작에 native IDLE/checkpoint 없음 + JS의 정확한 인증 소유 binding이 남아 있으면,
같은 계정/로그인 세대 검증 후 먼저 durable stop intent를 기록한다. 그 뒤 binding을 제거하고
기존 stop retry를 수행한다. 오프라인은 pending이며 성공으로 보고하지 않는다.
정상 native checkpoint가 있으면 기존 서버 재검증 흐름을 유지하고 자동 복구/새 위치 동의를 하지 않는다.
다른 로그인, 변경된 binding, 저장 실패는 근거를 버리지 않고 차단한다.

## 자동 검사

Swift 327건 PASS: 도착 근접만으로 전환 금지, 최종 도보 없는 목적지 GPS/점프 금지,
시간만 흐른 경우 금지, 범위/정확도/단절/출처 실패 초기화, geometry 끝과 destination 별도 검사,
전체 세션의 목적지 종료·반복 종료·terminal 복구 후 재활성화 금지를 포함한다.

FE 298 suites / 2,762건 PASS (최종 전체 재검사 40초). cold interrupted cleanup/오프라인 retry/로그인 변경 차단,
terminal event의 동일 stop lane 사용, readonly 체류 근거 경계를 검사한다.
QA 34건·타입 검사·iOS Debug 빌드 PASS. 이번 BE 소스 변경 없음.
시험 빌드에만 diagnostics/authenticated/background location·audio를 임시 적용하고
소스 Info.plist는 복구했다. .env·운영 기본 OFF는 바꾸지 않았다.

## 실행 중 실패와 재시험

1. 최초 컴파일에서 private 거리 함수 참조를 수정했다.
2. 체류 양성 테스트가 이미 도착 반경에 들어온 이전 관측 2개를 누락해 계산했다.
   경계 앞 근거를 명시적으로 초기화한 뒤 16초와 20초를 분리 검사했고 327건 PASS다.
3. 첫 시뮬레이터 실행은 `SAVED_SESSION_VALIDATION_EXPIRED`로 도착 전 안전 종료됐다.
   서버 stop/큐 0은 확인했으나 도착 성공으로 집계하지 않았다.
4. 같은 시간 전체 FE 검사에서 기존 calendar swipe 1건이 5초 제한을 초과했다
   (해당 suite 실행 324초). 단독 재검사 76건 PASS. 시스템 실행 지연의 원인은 확정하지 않았다.
5. CI Metro 캐시에 이전 JS 설명이 남아 있어 Metro를 clear로 다시 시작했다.
   최신 화면 문구 확인 후 새 세션에서 재시험했다. 재시험 동안에만 일시적인 idle-sleep
   방지 프로세스를 replay에 묶었다. 지속 OS 설정 변경은 하지 않는다.

## E2E 결과

대상: `NoLate R2 Session E2E 20261008`, iOS 26.5,
UDID `96AF9A48-4721-4335-B7BF-10B9382B7A30`. CUA의 실제 독립 기기 창
`deviceWindow-AppWindow-9` / `Show in Device Hub` toolbar를 확인했다. 내장 Hub 패널을 조작하지 않았다.
`journey-final-walk-location-replay.mjs`는 CoreSimulator GPS만 주입하며 서버 차량은 독립 시계로 이동한다.

첫 재시험(전경):

1. ARMED / 출발 0 → GPS 이동 → ACTIVE / 출발 1 / ACKNOWLEDGED.
2. 별도 차량 동행 → RIDING / 근거 3. 목표 정류장 근처도 도착으로 오인하지 않고 하차 준비.
3. 같은 차량 분리 근거 3 → 최종 도보 COLLECTING → FINAL_WALK / 근거 8.
4. 실제 경로 상세 컴포넌트의 마지막 도보 현재 행, 경로 바 마커·잔여 거리,
   AX의 엔진 위치를 확인했다. 캡처는 도보 약 30m 상태다. 지도는 오프라인 시험용이며 실제 타일 검증이 아니다.
5. 종료 버튼 없이 목적지 체류 후 `STOPPED / DESTINATION_ARRIVED`, 오류 없음,
   서버 stop 후 종료 대기 0건. 상세의 신선한 위치/현재 행도 제거됐다.
6. 이후 잠금 화면에 Activity 없음. 다만 잠금 메뉴의 stale accessibility ID 오류 때문에
   이 실행에서는 도착 전 카드→제거 순간을 포착하지 못했다. 연결 재선택 후 메뉴 조작을 복구했다.
7. 앱 terminate/launch 후 IDLE / 출발 0 / 체류 근거 0 / 종료 대기 0, checkpoint 복구 없음.

확인한 파일: `docs/evidence/journey-r34-arrival-20261009/`의
`bus-before-arrival.png`, `detail-final-walk.png`, `arrived-queue-empty.png`,
`lock-after-arrival.png`, `cold-idle.png`. 원본을 직접 열어 상태와 이름을 확인했다.

두 번째 재시험(잠금 상태):

1. 새 세션의 GPS 출발 1 / ACK 이후 독립 창의 Controls → Lock으로 잠갔다.
2. 실제 잠금 화면의 버스 이동 카드와 버스 구간 마커를 확인했다.
3. 잠금을 풀지 않은 채 정류장 근처 하차 준비 → 목적지까지 최종 도보 카드로 갱신됐다.
   CUA 화면은 도보 약 80m, 저장된 원본 캡처는 뒤이어 갱신된 도보 약 60m다.
4. 목적지 체류 뒤 잠금 카드가 사라졌다. 그 뒤에만 Home으로 잠금을 풀었다.
5. `목적지 도착 · 길안내 종료`, STOPPED / 오류 없음 / 서버 종료 대기 0건을 확인했다.
   종료 버튼과 단계 변경 입력은 사용하지 않았다. 단순 카드 소실만을 도착 근거로 집계하지 않았다.
6. replay가 vehicle EMPTY 및 GPS clear까지 정상 종료했다.

추가 확인 파일: `background-lock-riding.png`, `background-lock-final-walk.png`,
`background-lock-ended.png`, `background-arrived-queue-empty.png`.
fixture 최종 카운터 prepare 3 / departure 3 / cancel 3 / lastState STOPPED:
검증 lease 만료로 중단된 첫 실행 1개와 정상 도착 재시험 2개를 합한 값이다.
실제 APNs provider attempt/accepted는 0건이며 실제 공급자 호출도 없다.
오프라인 stop 큐와 프로세스 중단 복구는 자동 테스트로 검증했고, 해당 장애를 이번 시뮬레이터에서
실제 강제 재현했다고 주장하지 않는다. 재시작 E2E는 정상 종료 후 cold IDLE 확인이다.

## 정리와 다음 단계

GPS 주입과 replay 전용 idle-sleep 방지 프로세스가 종료된 것을 확인했다.
이번 작업이 시작한 Metro(8088)와 합성 harness(15544/15545)만 작업 디렉터리·PID를 대조해 종료했다.
기존 다른 시뮬레이터·사용자 데이터·.env는 건드리지 않았으며 커밋/푸시/배포하지 않았다.
Info.plist 기본 OFF 복구와 diff whitespace 검사 PASS다. BE 구현 변경/새 BE 회귀 실행은 없었다.
다음 R4-1은 지원 경로의 제품 상세 진입·미지원 차단·표시 계약 통합이며,
R1 실제 공급자 유일 매핑과 R4 실제 타일/v4 원격 APNs는 별도 합격 조건이다.

## 남은 경계

합성 GPS와 별도 합성 차량 입력이다. 실제 현장 GPS/지하철 음영·실제 공급자 API·실제 APNs
전달·실제 지도 타일·환승·지하철·음성·운영 일정 진입 완료를 의미하지 않는다.
목적지 radius/dwell 값은 현장 오탐/미탐 측정 후 조정할 정책이며 제품 보장은 아니다.
