# R1 정류장 occurrence–노선 형상 검증 — 2026-10-08

## 결과

[실제 APNs UPDATE/END 재검증](journey-apns-revalidation-20261008.md)을 먼저 통과한 뒤 다음 slice를 구현했다.
**정적 매핑 검증기와 단위/계약 검사는 통과했지만, 실제 7016의 유일한 매핑은 미확보다.**
최종 실응답 결과는 `STOP_SHAPE_AMBIGUOUS`, 성공 투영 0, navigationReady=false다.
R2 탑승/주행 Runtime이나 정상 경로/Live Activity 버스 진행을 활성화하지 않았다.

## 구현

BE main-source `SeoulBusStopShapeMatcher`는 HTTP·GPS·차량 동행 판단이 없는 순수 정적 검증기다.
입력은 같은 공식 노선 요청에 연결된 전체 정류장 catalog와 노선 형상, 선택한 정류장 순번 구간이다.
노선 이름을 ID로 쓰지 않으며, stop sequence·shape order·road section은 서로 다른 namespace로 유지한다.

- ID/순서/좌표계/유한값/크기/선택 구간 번호·방면을 검증한다. 실패 시 부분 성공 projection을 반환하지 않는다.
- 인접한 조밀한 형상점의 후보를 같은 passage로 묶되, 멀리 떨어진 다른 passage는 가장 가까운 하나로 덮어쓰지 않는다.
- 전체 catalog의 정류장 순서를 유지하는 가능한 매핑을 동적 계획법으로 계산한다. 후보 수는 32개/정류장, 전체 매핑 수는 2에서 포화시킨다.
- 전체 매핑이 **정확히 하나**일 때만 선택 구간 projection을 반환한다. 시작/끝 anchor를 강제하거나 정류장을 건너뛰거나 순서를 순환시켜 맞추지 않는다.
- 번호가 없는 선택 구간 밖의 행은 검증된 ID/좌표로 정적 순서를 제약할 수 있지만, 승차 번호 매핑으로 반환하지 않는다. 선택 구간의 번호 누락/오류는 계속 거부한다.
- 수용 범위: cross-track ≤40m, 같은 passage 후보 간 along gap ≤20m/총 span ≤100m,
  정류장 간 전진 ≥5m, 단일 segment ≤1,500m, 전체 길이 20m~100km.
  이는 보수적인 내부 시험 정책이며 실제 위치 정확도/SLA나 전국 노선 합격 기준으로 인증한 값이 아니다.
- 로컬 단거리 평면 투영으로 형상 일관성을 검사한다. 실제 도보 경로 생성·도로 네트워크 연결·공식 section crosswalk를 구현한 것이 아니다.

test-source catalog probe에는 고정 7016 시험 순번 44~48의 매핑 상태·성공 개수·순번만 추가했다.
원본 좌표·정류장/차량 식별자·번호·키·URI·응답 본문을 진단 출력에 추가하지 않았다.
자료 조회/형상 일관성 결과가 navigationReady 또는 passengerVehicleAssociation을 true로 만들지 않는다.

## 실제 공식 API 검사

기존 사용자 승인 범위의 같은 `SEOUL_BUS_API_KEY`를 공식 `ws.bus.go.kr`에 평문 HTTP로 전달했다.
이번 턴은 수동으로 시작한 **정류장 2회 + 형상 2회, 합계 4회**다. 각 실행 안에서 자동 재시도·redirect·polling은 없다.
앞선 R1 진단 문서의 요청 수와 별개이며 다른 키·차량·지하철 호출은 0이다.

| 실행 | 구현 시점 | 결과 |
| --- | --- | --- |
| 1 | 각 정류장의 형상 passage를 독립 검사 | 106 stops / 1,693 points, 선택 구간 `STOP_SHAPE_AMBIGUOUS` |
| 2 | 전체 catalog 순서의 유일 매핑 검증 추가 후 | 같은 개수, 여전히 `STOP_SHAPE_AMBIGUOUS`; 성공 projection 0 |

두 응답 모두 공개 번호 오류 행 1개, 선택 순번 44~48의 누락/오류 0이었다.
최종 안전한 집계:

```json
{
  "status": "DIAGNOSTIC_CATALOG_WITH_INVALID_STOP_NUMBERS",
  "networkAttempts": 2,
  "stopCount": 106,
  "shapePointCount": 1693,
  "targetWindowSequences": [44, 45, 46, 47, 48],
  "targetShapeMatchStatus": "STOP_SHAPE_AMBIGUOUS",
  "targetShapeMatchedStopCount": 0,
  "targetShapeStopSequences": [],
  "targetShapeUniquelyProjected": false,
  "navigationReady": false,
  "stopSectionCrosswalkVerified": false,
  "passengerVehicleAssociation": false
}
```

probe 내부 exit 2/Gradle exit 1은 부분 자료의 readiness 차단을 유지한 결과다.
전체 catalog의 어느 행/어떤 후보 분기가 모호한지 원본 응답 없이 특정하지 않는다.
이를 특정 도로·회차 지점의 실제 오차라고 단정하거나 허용 거리를 늘려 통과시키지 않았다.
실제 좌표 목록을 저장하거나 지속 cache를 구현하지 않았다.

## 자동 검사 및 E2E 경계

- 최종 BE 교통·여정·Live Activity: **51 suites / 368 tests PASS**, failures/errors/skipped 0, MySQL-tag 제외.
- 새 mapper 14건 + probe 2건 = 16건 추가. 조밀한 점, namespace/순서/번호/방면,
  이탈/평행·반복 passage, 전체 순서로 유일하게 풀리는 회차, 풀리지 않는 회차,
  역순/중복 위치, 잘못된 좌표/범위·크기, 원문 비노출을 검사했다.
- Swift **285 tests PASS**, QA END/replay/readiness **15 tests PASS**를 이번 턴에 재실행했다.
- FE 전체 Jest/TypeScript는 이번 턴에 재실행하지 않았다. FE/native 제품 코드 변경 없음.
- FE·BE diff whitespace PASS. 로그는 `/private/tmp/nolate-global-shape-regression-20261008.log`,
  `/private/tmp/nolate-apns-recheck-swift-20261008.log`, `/private/tmp/nolate-apns-recheck-qa-20261008.log`.

APNs는 별도 문서의 실제 독립 창 E2E다. mapper는 아직 HTTP 내부 계약/순수 정책 단계이며
UI에 연결하지 않았으므로 **새 버스 주행/매핑 화면 E2E를 통과했다고 기록하지 않는다**.
기존 첫 도보 UI/APNs 시험을 새 매핑 E2E 증거로 전용하지 않는다.

## 다음 게이트

1. 모호한 정류장 occurrence/passage를 안전한 ordinal·후보 개수로 진단하고,
   공식 도로 구간 연결 또는 선택 경로 공급자의 검증된 geometry로 유일한 매핑을 확보한다.
2. 실제 도보 geometry와 canonical provider ID/방면·section 계약을 연결한다.
3. 그 후 같은 소유권/revision/TTL로 실제 차량 관측과 R2 Runtime을 연결하고 독립 GPS+차량 입력 E2E를 수행한다.

운영 기본 OFF·simulator-only는 유지했다. `.env`, 운영 DB/일정·자격증명·기존 미커밋 변경을 보존했고 commit/push/deploy하지 않았다.
