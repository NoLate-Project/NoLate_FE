# R1 실응답 진단 보강 — 2026-10-08 후속

## 결과와 검증 경계

실제 서울 7016 정류장 **106개**, 노선 형상점 **1,693개**를 진단용으로 파싱했다.
번호 형식이 잘못된 정류장 행 1개가 있으므로 결과는
`DIAGNOSTIC_CATALOG_WITH_INVALID_STOP_NUMBERS`이며 **navigationReady=false**다.
자료 조회 성공을 R1 전체 합격, 차량 동행, 탑승 확정 또는 R2 Runtime 연결로 간주하지 않는다.

| 항목 | 실제 응답 진단 |
| --- | --- |
| 정류장 순번 | 1~106, 106개 |
| 노선 형상점 | 1,693개 |
| 공개 정류장 번호 형식 오류 | 1행, 번호 매핑에서 제외 |
| 시험 대상 순번 44~48 | 서로 다른 정류장 5개, 공개 번호 누락·오류 0 |
| section 누락 | 0; 정류장 순번과 도로 구간 순번의 crosswalk 검증을 의미하지 않음 |
| stopSectionCrosswalkVerified / passengerVehicleAssociation | false / false |

공식 [노선정보조회 명세](https://www.data.go.kr/data/15000193/openapi.do)는
`arsId`를 선택값으로 명시하고 `stationNo`는 5자리 번호로 설명한다.
실응답의 **응답 행 위치 20**에서 빈 `arsId`와 숫자가 아닌 `stationNo`를 구분했다.
응답 행 위치는 검증된 정류장 `seq`가 아니며, 이 행의 실제 이름·원본 값은 기록하지 않았다.
이를 회차/차고지 등 특정 정류장 유형이라고 추정하지 않는다.

## 수정

- 안전한 진단 enum으로 필드 이름·문제 종류·응답 행 위치만 반환한다. 원문 값·응답·URI·키·예외 cause를 남기지 않는다.
- 선택 필드가 비었으면 공식 `stationNo`가 유효한 경우에만 사용한다. 둘 다 없거나 `0`/`00000`이면 공개 번호 없음으로 보존한다. 이 값들을 공식 sentinel 정의로 인증한 것은 아니다.
- 번호 앞에 0을 붙이거나 이웃 정류장의 번호를 상속하지 않는다. 두 유효 번호가 충돌하면 거부한다.
- 기본 strict parser는 잘못된 번호를 계속 거부한다. 별도 내부 진단 경로만 해당 행을 `publicStopNumberInvalid=true`, 공개 번호 null로 보존한다. 실제 승차 번호 매핑으로 사용하지 않는다.
- 진단 경로도 ID·순서·중복·중첩·좌표계·범위·응답 크기 검증은 낮추지 않는다.
- probe는 부분 결과에서 exit 2(Gradle 실패)를 유지한다. 이를 정상 readiness PASS로 처리하지 않는다.

## 외부 호출 이력

이 후속 작업에서는 코드 수정·로컬 회귀 확인 뒤 **수동으로 시작한 정류장 조회 5회와 형상 조회 1회, 총 6회 HTTP 요청**을 실행했다.
앞선 재검사 문서의 정류장 조회 1회와 별개다. 각 실행 안에서 자동 재시도·리다이렉트·polling은 없다.
사용자가 승인한 같은 버스 키를 공식 `ws.bus.go.kr`에 평문 HTTP로 전송한 시험이며, 다른 키/차량/지하철/APNs 호출은 하지 않았다.
단계별 수동 재실행을 포함한 총 호출 수를 1회 또는 재시도 0회로 축약하지 않는다.

| 실행 | 정류장 결과 | 형상 요청 |
| --- | --- | --- |
| 1 | `arsId / EMPTY / responseRowOrdinal=20` | 0 |
| 2 | 빈 선택값 처리 후 공개 번호 계약 실패 | 0 |
| 3 | 번호 없는 행 표현 보강 후 공개 번호 계약 실패 | 0 |
| 4 | `stationNo / INVALID_NUMBER / NON_NUMERIC / responseRowOrdinal=20` | 0 |
| 5 | 진단 모드: 정류장 106개, 번호 오류 1개 | 1; 형상점 1,693개 |

실제 응답 본문이나 좌표 목록은 저장하지 않았다. 지속 catalog cache를 구현한 것은 아니다.
안전한 마지막 집계:

```json
{
  "status": "DIAGNOSTIC_CATALOG_WITH_INVALID_STOP_NUMBERS",
  "networkAttempts": 2,
  "stopCount": 106,
  "shapePointCount": 1693,
  "firstStopSequence": 1,
  "lastStopSequence": 106,
  "targetWindowSequences": [44, 45, 46, 47, 48],
  "targetWindowDistinctStations": 5,
  "missingSectionCount": 0,
  "missingPublicStopNumberCount": 1,
  "invalidPublicStopNumberCount": 1,
  "targetWindowMissingPublicStopNumberCount": 0,
  "targetWindowInvalidPublicStopNumberCount": 0,
  "allPublicStopNumbersAvailable": false,
  "coordinateContract": "OFFICIAL_GPS_WGS84",
  "navigationReady": false,
  "stopSectionCrosswalkVerified": false,
  "passengerVehicleAssociation": false
}
```

## 자동 검사

- BE 교통·여정·Live Activity: **50 suites / 352 tests PASS**, 실패·오류·skip 0. MySQL-tag 제외. 이전 344건 대비 진단 회귀 8건 추가.
- Swift: **285 tests PASS**, 실패 0. native/FE 제품 코드 변경 없음.
- FE 295 suites / 2,700건·타입 검사·QA 17건·설정 16건은 같은 날짜 앞선 재검사 결과다. 이번 후속 실행에서 재실행하지 않았다.
- 실제 APNs 전송은 이번 후속에서 0회다. 과거 APNs 성공을 이번 검사 성공으로 합산하지 않는다.

로컬 로그: `/private/tmp/nolate-r1-diagnostic-catalog-20261008.log`,
`/private/tmp/nolate-r1-followup-swift-20261008.log`.
`.env`·운영 설정/DB·기존 사용자 데이터는 변경하지 않았고 commit/push/deploy하지 않았다.

## 독립 시뮬레이터 재검사

대상은 `NoLate Journey P0 Isolated 20261004`, iOS 26.5,
UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, detached `deviceWindow-AppWindow-8`이다.
`Show in Device Hub` 컨트롤로 분리 창을 식별하며 embedded 관리 화면/실기기는 조작하지 않는다.

첫 재검사에서 재진입·경로 검사·동의·준비를 수행했지만 IDLE/BLOCKED였다.
서버는 prepare/departure/activation 0, authenticatedRequests 1, rejectedRequests 0이었다.
실행 중 harness의 classpath를 회귀 빌드가 재생성하여 `ClassNotFoundException`이 발생한 시험 환경 충돌을 확인했다.
이 결과를 제품 서버 오류 또는 E2E 통과로 인증하지 않는다. 이후 회귀 빌드와 harness 실행을 분리했다.
선택 창이 다른 XCUITest 창으로 바뀌면 해당 기기 조작을 중단하고 목표 창을 다시 확인한다.

최종 재검사에서는 목표 독립 창을 다시 선택했고 서버 실행 중 빌드를 하지 않았다.
provider OFF·DB 없음·합성 JWT인 loopback harness(15544/15545)와 기존 Metro(8088), 기존 설치 앱만 사용했다.
다른 시뮬레이터의 휴대폰 UI는 조작하지 않았다.

| 시나리오 | 관측 결과 |
| --- | --- |
| 검사·동의·준비, GPS 원점 | ARMED, 출발 0회 |
| `marker-walk` 연속 CoreSimulator GPS | ACTIVE, 출발 1회, ACKNOWLEDGED |
| 실제 상세 컴포넌트 | 도보 약 60m, 경로 바 위치 화살표, 첫 도보 목록의 현재 위치 표시 |
| `marker-finish` | 승차 지점 근처, 마커가 승차 경계로 이동 |
| `dwell` | 버스 대기, 현재 위치 목록이 버스 승차 행으로 이동 |
| GPS 입력 중단 | 상세 화면의 위치 확인 중, 현재 위치 마커/정밀 거리 제거 |
| 재입력 후 시험 기기 잠금 | 로컬 Live Activity의 승차 지점 근처·경로 바 화살표 표시를 스크린샷으로 확인 |
| 잠금 상태에서 GPS 입력 중단 | 위치 확인 중·위치 정보 업데이트 필요로 변경, 화살표 제거를 스크린샷으로 확인 |
| 잠금 해제 후 앱에서 종료 | STOPPED, 서버 종료 대기 0건, 오류 없음, 이전 안내 남은 기록 없음 |
| 다시 잠금 | Live Activity 카드 제거를 스크린샷으로 확인 |

마지막 서버 집계: prepare/departure/activation 각각 1, authenticatedRequests 47,
arrivalRequests 12(합성), rejectedRequests/trapRequests/실제 push 시도 각각 0, lastState=STOPPED.
준비·동의·종료는 UI로 조작했지만 출발/탑승/단계 변경 bridge는 호출하지 않았다.
위치 입력은 합성 CoreSimulator GPS이며 현장 GPS 정확도 검증이 아니다.
지도는 명시적 offline fixture라 실제 지도 타일·도로 정확도도 인증하지 않는다.
잠금 카드 관측은 **로컬 ActivityKit** 검증으로, APNs 원격 UPDATE/END 수신 성공이 아니다.
서버 provider는 OFF였고 실제 발송 시도는 0이다.
새 R2 코어의 Runtime 연결·재빌드·버스 주행 E2E는 수행하지 않았다.
화면 증거는 이 작업의 CUA AX/스크린샷 출력이며 별도 이미지 파일로 저장했다고 기록하지 않는다.
한 번의 ScreenCaptureKit 오류 후 최신 AX로 재연결하여 정상 복귀했다. 오류 난 동작 자체는 통과로 세지 않았다.

정리 완료: STOPPED·큐 0·카드 제거를 확인한 뒤 합성 GPS를 clear하고 해당 시험 앱 프로세스를 종료했다.
Metro PID 6168과 harness JVM PID 14653의 cwd를 각각 FE/BE worktree로 확인한 후 종료했다.
8088/15544/15545 listener 없음과 FE·BE diff whitespace PASS를 확인했다.
데이터·키·DB·다른 시뮬레이터는 삭제하지 않았다.

## 다음 구현 게이트

1. 선택 정류장 occurrence와 노선 형상상의 유일한 위치를 검증한다. 가장 가까운 점 하나만으로 회차/교차 구간을 인증하지 않는다.
2. 실제 도보 geometry와 canonical provider ID/방면/도로 구간 계약을 연결한다. Seoul 형상을 TMAP/ODsay 자료라고 표시하거나 직선을 실제 도보 경로로 삽입하지 않는다.
3. 같은 소유권·revision·TTL로 GPS와 독립 차량 관측을 Runtime의 R2 코어에 연결한다.
4. 확정/반대 방향/평행 도로/오래된 관측/재시작 시나리오를 순수 정책과 독립 시뮬레이터 E2E로 각각 확인한다.

R2 Runtime·버스 완주·R3/R5/R6 전체 구현은 아직 완료되지 않았다.
