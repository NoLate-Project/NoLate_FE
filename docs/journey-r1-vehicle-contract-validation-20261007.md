# R1 서울 버스 차량 관측 계약 — 2026-10-07

최신 후속(10/08): 안전한 필드·응답 행 진단과 별도 부분 catalog 경로를 추가했다.
실제 정류장 106개·형상점 1,693개, 공개 번호 오류 1행, BE 352건 PASS.
navigationReady=false이며 R2 Runtime은 미연결이다.
[후속 검증](journey-r1-catalog-diagnostics-validation-20261008.md).
아래 FIELD_MISSING/형상 미호출은 이전 실행 이력이다.

## 2026-10-08 승인 후 재조회 결과

추가 정류장 1회 조회 승인을 받아 같은 공식 7016 endpoint에 HTTP 요청 1회를 실행했다.
결과는 `PROVIDER_CHECK_FAILED`, `INVALID_RESPONSE`, `FIELD_MISSING`, `failedOperation=STOPS`,
`networkAttempts=1`이다. 앞선 HTTP 401과 다른 결과이며 정상 정류장 목록 확보 성공은 아니다.
형상·자동 재시도·리다이렉트·추가 차량/지하철 호출은 0회다. 원문 응답·키·예외 URI는 저장/출력하지 않았다.
현재 진단은 누락/빈 필드의 이름·행까지 반환하지 않으므로 특정 필드나 키 오류로 원인을 단정할 수 없다.
필수 검증을 제거하거나 추정 좌표/순서를 넣어 통과시키지 않았다.
같은 날짜 교통·여정·Live Activity BE 회귀는 50 suites / 344건 PASS다(MySQL-tag 제외).
[R1–R6 재검사 및 독립 시뮬레이터 결과](journey-r1-r6-test-validation-20261008.md).

## 후속: 공식 차량 WGS84 계약 확인·암호화 전송 경로 검사

공식 public API 안내 문서를 credential 없이 추가 확인했다.
[서울 버스 getBusPosByRouteSt 명세](http://api.bus.go.kr/contents/sub02/getBusPosByRouteSt.html)는
`tmX/tmY`를 WGS84 맵매칭 좌표, `posX/posY`를 GRS80 맵매칭 좌표로 구분한다.
이는 앞선 data.go.kr 메타데이터에 없던 좌표계 설명을 보완한다. 실제 위치 정확도를 인증한 것은 아니다.
[정류장 조회 공식 명세](http://api.bus.go.kr/contents/sub02/getStaionByRoute.html)에서
`serviceKey` 소문자 표기도 확인했다. 이 확인만으로 HTTP 401의 원인을 확정하지 않는다.

- vehicle parser에 `tmX/tmY`의 유효한 WGS84 한 쌍만 읽는 내부 필드를 추가했다.
  둘 다 없으면 좌표 없음, 한 쪽 누락/중복/중첩/잘못된 범위/축 교환/GRS80 투입은 행을 거부한다.
- `posX/posY`로 대체하거나 변환하지 않는다. 좌표와 차량 ID는 JSON/문자열 진단에서 제외한다.
  `wgs84CoordinateCount`만 집계한다. 기존 geographicCoordinatesVerified·차량 동행·정류장 crosswalk는 false다.
- 실제 차량 위치 API는 새로 호출하지 않았다. 이전 차량 응답 원문을 보관하지 않았으므로
  이 새 좌표 필드의 실제 응답 수용 여부는 후속 승인 범위의 검증이 필요하다.
- **31 suites / 263 PASS / 실패·오류·skip 0**, MySQL-tag 제외.
  로그: `/private/tmp/nolate-r1-wgs84-regression-20261007.log`.

사용자의 R6까지 재진행 요청 범위에서, 평문 fallback 없이 동일 공식 정류장 endpoint의 HTTPS를 한 번 검사했다.
결과는 `transport=HTTPS`, `status=PROVIDER_CHECK_FAILED`, `networkAttempts=1`,
`failedOperation=STOPS`, `failureCategory=TRANSPORT_OR_INTERNAL_FAILURE`, navigationReady=false다.
이 고정 분류만으로 세부 transport 원인/키 오류를 확정하지 않는다. probe exit 2 / Gradle exit 1.
정류장 정상 목록은 얻지 못했고 형상은 조회하지 않았다. HTTP 자동 전환/재시도는 없다.
당시 추가 평문 HTTP 정류장 1회 재조회 승인을 질문했다. 이후 승인·실행 결과는 문서 상단 10/08 기록을 따른다.

R2의 순수 Swift 동행 코어는 새 15건/전체 285건을 통과했다.
[R2 결과와 독립 시뮬레이터 baseline 검증 경계](journey-r2-bus-ride-core-validation-20261007.md)를 따른다.
정상 경로/Runtime/Activity에 새 코어를 연결한 E2E, R3–R6, 실제 내비게이션 완주는 여전히 미완료다.

## 승인된 정류장 실조회 — HTTP 401로 중단

사용자가 `.env` 수정 완료를 알린 뒤 재확인했다. `SEOUL_BUS_API_KEY`는 두 줄이었으나 **값은 동일**했다.
파일을 수정하거나 첫/마지막의 다른 값을 선택하지 않고 동일한 단일 값만 별도 프로세스에 전달했다.
`SEOUL_SUBWAY_API_KEY`는 한 항목의 존재만 확인했으며 네트워크로 전송하지 않았다.
버스·지하철 키가 서로 같지는 않았고 버스 키에 명백히 잘못된 percent escape도 없었다.
이 로컬 형식 점검은 실제 서비스 권한 확인이 아니다.

승인된 공식 `http://ws.bus.go.kr/api/rest/busRouteInfo/getStaionByRoute`에 7016/100100447 요청 **1회**:

```json
{
  "probe": "SEOUL_7016_ROUTE_CATALOG",
  "transport": "HTTP_EXPLICIT_TEST",
  "status": "PROVIDER_CHECK_FAILED",
  "networkAttempts": 1,
  "failedOperation": "STOPS",
  "failureCategory": "HTTP_REJECTED",
  "httpStatus": 401,
  "navigationReady": false
}
```

- HTTP 401 수신 후 중단. 정류장 목록/좌표/순서의 실응답 파싱은 하지 못했다.
  형상 `getRoutePath` 호출, 재시도, 리다이렉트, 차량 위치 조회는 각각 **0회**다.
- probe exit 2 / Gradle exit 1. 계약상 실패 종료이며 성공으로 처리하지 않았다.
- 요청 경로는 [공식 노선정보조회 명세](https://www.data.go.kr/data/15000193/openapi.do)와 재대조했다.
  credential 단일 encoding은 loopback 회귀로 확인했지만, 현재 키의 해당 서비스 접근 권한/승인 상태는 미확인이다.
  HTTP 401만으로 키 값 오류, 승인 미완료, gateway 정책 등 특정 원인을 확정하지 않는다.
- 승인된 정류장 각 1회 범위는 소진했다. 형상 각 1회 범위는 미사용이지만 첫 실패 후 불필요하게 호출하지 않았다.
  정류장 재검증은 권한/키 상태 확인 뒤 새 조회 승인이 필요하다. 기존 승인을 반복 실행 예산으로 사용하지 않는다.
- credential/원문 응답/예외 URI를 출력·파일 저장하지 않았다. 운영 `.env`/설정/DB/앱은 변경하지 않았다.
  이 절차는 실응답 HTTP 검증이지 독립 시뮬레이터 E2E나 실제 APNs 검증이 아니다.
  R1 전체/R2–R6/내비게이션 완성으로 보고하지 않는다.

401 즉시 중단·형상 미호출·원문 오류 비노출 합성 회귀를 추가한 뒤 **31 suites / 260 PASS / 실패·오류·skip 0**.
MySQL-tag 제외. 로그: `/private/tmp/nolate-r1-catalog-401-regression-20261007.log`.
이 테스트를 위해 공식 API를 다시 호출한 것은 아니다.

## 정류장·형상 계약 추가 — 실응답 조회 전

R1의 다음 선행 작업으로 BE 내부 정류장·형상 어댑터를 추가했다.
[공식 버스 노선 정보 명세](https://www.data.go.kr/data/15000193/openapi.do)의
`getStaionByRoute`(공식 철자)와 `getRoutePath`를 사용한다.

- `SeoulBusRouteCatalogParser`: 최대 2 MiB, 정류장 최대 999행/형상 최대 20,000행, XXE 차단.
  노선 ID·정류장 occurrence 연속 순번·station/ARS·방면·구간 ID와 WGS84 범위를 검사한다.
  순환 노선의 같은 station ID라도 다른 occurrence는 유지한다. 중복·역순·누락 순번은 거부한다.
- 정류장/형상 `gpsX/gpsY`만 공식 WGS84 계약으로 읽는다. GRS80 `posX/posY`로 대체하지 않는다.
  형상 `no`, 정류장 `seq`, 차량 `sectOrd`는 별도 namespace다. 차량 좌표계 인증·탑승 판정은 하지 않는다.
- 기존 provider deadline/quota/timeout을 공유하고, 리다이렉트·자동 재시도는 차단한다.
  HTTP 오류 본문/URI·XML 원문·키를 예외/결과에 남기지 않는다.
- test-source `seoulBusRouteCatalogReadinessProbe`: opt-in + 키가 있을 때만 고정 7016 노선에서
  정류장 1회 → 형상 1회, 최대 2회. 첫 실패/빈 정류장 응답이면 중단한다. polling·HTTP fallback은 없다.
  결과는 건수·고정 계약 오류 코드만 표시하며 `navigationReady=false`를 유지한다.

검증: **31 suites / 259 PASS / 실패·오류·skip 0**, MySQL-tag 제외.
로그: `/private/tmp/nolate-r1-catalog-regression-20261007.log`.
새 테스트는 WGS84/GRS80 혼동, ARS 충돌, 같은 역의 중복 occurrence, 순번 오류, XXE/크기 제한,
키/opt-in 누락 0호출, 고정 최대 2회·실패 후 중단, credential 단일 인코딩, redirect 목적지 0호출,
공유 quota, 원문 비노출을 포함한다. 이 검사는 합성 XML·loopback HTTP이지 공식 실응답 검증이 아니다.
독립 CLI 무동의 실행도 `EXPLICIT_OPT_IN_REQUIRED`, `networkAttempts=0`, 의도된 exit 2로 차단됐다.
로그: `/private/tmp/nolate-r1-catalog-no-optin-20261007.log`.

이 절의 시점에는 정류장/형상 API의 고정 HTTP 각 1회(합계 최대 2회) 승인이 아직 미사용이었다.
새 지하철 키는 존재 여부만 확인했다. 버스 키 중복 선언 정리를 요청했고 실제 credential 조회는 보류했다.
이후 동일 값임을 확인하고 조회한 최신 결과는 위 HTTP 401 절을 따른다. `.env`를 수정/복사하지 않았다.
UI/Swift/위치/APNs/앱 설치는 변경하지 않았고 이번에 독립 시뮬레이터 E2E를 재실행하지 않았다.
R1 전체, R2–R6, 실제 버스/지하철 내비게이션 완료로 보고하지 않는다.

## 추가 승인 후 60초 이내·최대 6회 HTTP 표본 — 최신 결과

사용자는 동일 노선의 HTTP 평문 조건을 유지한 1분·최대 6회 추가 조회에 `응 그렇게 진행해줘`로 승인했다.
17:48 KST경 결과 확인. 공식 `getBusPosByRouteSt`의 7016/100100447/정류장 순번 44~48만 호출했다.
첫 시작 기준 0~50.021초에 **정확히 6회**, 시작 간격 최소 10초. 재시도·리다이렉트·다른 노선 호출은 0회다.

| 표본 | 시작 경과(초) | 응답 소요(ms) | 관측 행 | 수용 / 만료 | 원본 관측 나이 최소~최대(초) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 0.000 | 151 | 2 | 2 / 0 | 7.281~8.281 |
| 2 | 10.005 | 16 | 2 | 2 / 0 | 12.181~14.181 |
| 3 | 20.010 | 16 | 2 | 2 / 0 | 8.187~10.187 |
| 4 | 30.015 | 18 | 2 | 1 / 1 | 12.192~16.192 |
| 5 | 40.017 | 24 | 2 | 2 / 0 | 12.202~12.202 |
| 6 | 50.021 | 16 | 2 | 0 / 2 | 22.199~22.199 |

결론:

- 정상 API 응답 6/6, `AVAILABLE` 5/6, `NO_USABLE_OBSERVATIONS` 1/6.
  12개 **반복 관측 행** 중 수용 9/만료 3이며 12대의 고유 차량을 뜻하지 않는다. 다른 거부 사유·실행기 오류는 없었다.
- source 시각은 compact KST 형식으로 파싱됐고, 로컬 수신 시각과 비교한 관측 나이는 7.281~22.199초였다.
  최초 단일 호출의 전부 만료가 키 오류/항상 만료를 의미하지 않음이 확인됐다.
- 표본 간 최소/최대 관측 시각의 변화는 보이지만, 집계만 수집했고 차량별 연속 식별을 하지 않았다.
  **제공처 전체/특정 차량의 고정 갱신 주기나 운영 SLA를 확정하지 않는다.** 서버와 로컬 시계 차이도 독립 인증한 것은 아니다.
- 기존 source TTL 15초를 유지했다. 4번의 만료 1행·6번의 만료 2행은 fresh로 승격하지 않았다.
  단일 수신 시각·예상 시간으로 오래된 관측을 연장하지 않는다.
- probe/Gradle exit 0은 이번 표본에 신선 관측이 있었다는 뜻이지 모든 표본의 최신성 보장이 아니다.
  전 표본 `navigationReady=false`, 차량 동행/방면/정류장 매핑/좌표 인증 false 유지.
- 6회 승인 범위는 사용 완료했다. 추가 호출·운영 HTTP 전환·앱 polling 활성화는 하지 않았다.
  `.env`·운영 설정·DB·UI/Swift·APNs·위치·앱 설치도 변경하지 않았다.

추가 구현: 차량 ID/원본 시각 없는 `sourceAgeSummary` 집계, test-source 전용 6회/60초/10초 간격 샘플러.
집계에는 유효 필드/시각을 가진 비중복 행만 포함하고 미래 시각은 음수 나이로 진단하되 거부한다.
잘못된 시각/ID·중복은 나이 집계에서 제외한다. 테스트는 가상 시계로 횟수·간격·60초 cutoff·오류 즉시 중단·
키/opt-in 누락 시 0호출·stale/future/중복 집계와 freshness 불변을 검사했다.
집계 Map의 숫자 타입을 비교하던 테스트 기대값 1건을 수정한 뒤 **29 suites / 244 PASS / 실패·오류·skip 0**.
합성 회귀 로그: `/private/tmp/nolate-r1-sampling-final-regression.log`.
이어 신선 관측 뒤 발생한 provider 오류도 CLI 실패로 종료하도록 보강하고 같은 244건을 재통과했다.
최종 로그: `/private/tmp/nolate-r1-sampling-exit-regression.log`. 외부 조회를 재실행한 것은 아니다. MySQL-tag 검사는 제외했다.
외부 응답 원문·원본 시각·차량 ID·키를 파일로 저장하지 않았다. 위 표는 비식별 집계 결과다.
UI 변경이 없는 공급자 내부 계약 단계로, 독립 시뮬레이터 E2E·실제 APNs를 이번에 재실행한 것은 아니다.

**다음 순서:** R1의 신선 관측 수신 선행 조건은 제한된 표본에서 확인했다. 좌표계·도로 구간/정류장 occurrence·
방면 매핑과 도보 geometry, 일일 quota/polling/cache 예산을 검증한 뒤 R2 차량 동행에 연결한다.
간헐적 만료를 전제로 최신 관측이 없으면 주행 확정/마커 갱신을 중단하는 계약이 필요하다.
R1 전체 또는 실제 내비게이션 완성으로 보고하지 않는다.

## 사용자 승인 후 일회 HTTP 실응답 검사 — 추가 표본 전 기록

사용자가 키 평문 전송 위험을 설명받은 뒤 `허용할게`로 승인했다. 승인 범위는 공식 서버의
7016 고정 노선/44~48 일회 조회이며, 운영 HTTP 활성화·반복 polling·다른 노선 조회로 확장하지 않았다.
17:24 KST경 결과를 확인했다. 해당 키 항목만 일회 프로세스로 주입했고 자동 재시도·리다이렉트는 차단했다.
`.env`·운영 설정·DB·앱 설치는 변경하지 않았다.

```json
{
  "transport": "HTTP_EXPLICIT_TEST",
  "status": "NO_USABLE_OBSERVATIONS",
  "networkAttempted": true,
  "usableObservations": 0,
  "rejectedObservations": 3,
  "rejectionCounts": { "TIMESTAMP_STALE": 3 },
  "freshSourceObservationAvailable": false,
  "navigationReady": false
}
```

- 공식 HTTP 호출은 정상 성공 envelope/headerCd=0과 관측 3행을 반환했다. 앞선 HTTPS 연결 실패와 구분한다.
- 3행 모두 ID·노선·구간·정류장 필드와 compact KST 시각 검증을 지났으나 **원본 시각 기준 TTL 15초 만료**로 제외됐다.
  원본 시각/좌표/차량 식별자는 로그·파일에 저장하지 않았다. 만료 나이 분포·제공처 갱신 주기는 이번 결과만으로 확정하지 못한다.
- Java probe는 신선 관측 없음으로 exit 2, Gradle은 exit 1. 실행기 오류는 없었다.
  HTTP/API 호출 성공과 길안내에 사용할 최신 관측 확보를 구분한 의도된 결과다.
- 추가 호출은 0회. 수신 시각으로 freshness를 바꾸거나 TTL을 늘려 통과시키지 않았다.
  일회 성공을 HTTPS 가용성·좌표계·차량 동행·방면·자동 탑승 인증으로 취급하지 않는다.

차량 호출 전용 리다이렉트 차단, test-source HTTP 이중 opt-in, 고정 거부 사유별 건수를 추가했다.
loopback 302 시험에서 최초 호출 1회/리다이렉트 목적지 0회였고, 기본 HTTPS·키/opt-in 없는 호출 차단을 검사했다.
당시 회귀: **29 suites / 239 PASS / 실패·오류·skip 0**, MySQL-tag 제외.
로그: `/private/tmp/nolate-r1-http-final-regression.log` (외부 키 호출 로그가 아닌 합성 회귀 로그).
이번 단계는 공급자 내부 계약만 변경했으며 UI/Swift/APNs/위치를 시작하거나 독립 시뮬레이터 E2E를 재실행하지 않았다.

**당시 선행 조건:** 공급자의 갱신 주기·실제 원본 관측 나이 분포를 확인하고 차량 관측 freshness 정책을 근거에 맞게 검증한다.
HTTP 추가 관측은 새로 범위를 정해 소유자 승인을 받아야 한다. 현재 일회 승인은 사용 완료이며 재사용하지 않는다.
좌표계·도로 구간/정류장 매핑·polling 예산·도보 geometry·차량 동행 연결은 여전히 미완료다.

## 키 연결 후속 검사 — HTTP 승인 전 기록

사용자가 공식 차량 위치 서비스 사용 신청과 `SEOUL_BUS_API_KEY` 추가를 알린 뒤 실행했다.
키는 primary FE `.env`에 있었으며, BE `.env` 두 후보에는 파일이 없었다.
사용자 요청 범위의 해당 키 항목만 선택해 일회 test process 환경으로 전달했다. `.env`를 수정/복사하지 않았고
다른 설정을 로드하지 않았다. 키는 명령 인자/로그/결과 파일/Git에 출력하지 않았다.
primary FE `.env`는 Git ignored=true/tracked=false였다. 서버 전용 보관 위치로의 분리는 후속 소유자 작업이다.

- 기존 사전 검사와 오류 분류 보강 후 재검사 모두 `PROVIDER_CHECK_FAILED`.
- 보강 후 고정 실패 분류는 **TRANSPORT_UNAVAILABLE**, navigationReady=false.
- 자격 증명 없는 Node HTTPS(IPv4 포함)와 curl HTTPS도 각각 시간 초과. 이를 키 오류나 승인 거절로 단정하지 않는다.
- 자격 증명 없는 HTTP 요청은 401이었다. 이 응답은 인증 성공/키 유효성/차량 실응답 증거가 아니다.
- [공식 서울시 명세](https://data.seoul.go.kr/dataList/OA-15338/F/1/datasetView.do)는 HTTP 주소를 안내한다.
  이 실행 환경의 HTTPS 실패가 제공처 전체의 영구 HTTPS 미지원임을 입증하지는 않는다.
- 인증서 검증 비활성화/키를 담은 HTTP 호출/운영 플래그 변경은 하지 않았다.
  일회 HTTP 시험도 키 평문 전송 위험을 설명하고 사용자 선택 전에는 실행하지 않는다.

사전 검사에 `TRANSPORT_UNAVAILABLE`/`PROVIDER_APPLICATION_REJECTED`/`HTTP_REJECTED`/
`INVALID_RESPONSE`/`UNCLASSIFIED` 고정 분류를 추가했다. 제공처 코드도 1–2자리 숫자 또는 UNKNOWN만 노출한다.
원문 예외·URI·응답 메시지는 계속 제외한다. 오류/키 비노출 회귀를 포함해 **29 suites / 236 PASS / 실패·skip 0**.
로그: `/private/tmp/nolate-r1-live-response-regression.log`. MySQL-tag 검사는 제외했다.
이번 후속에서는 UI/위치/APNs를 시작하지 않았고 독립 시뮬레이터 E2E를 재실행하지 않았다.
아래 초기 단계의 E2E 증거를 실제 차량 수신 E2E로 바꿔 표기하지 않는다.

**당시 선행 조건:** 안전한 HTTPS 접속 경로 확보 또는 사용자의 명시적 일회 HTTP 시험 결정.
키 인증·실제 차량 관측 시각/좌표계·정류장 매핑·자동 탑승은 여전히 미검증이다.

## 초기 구현 결론 (키 연결 전 기록)

실기기 시험 전 로드맵을 R1–R8로 재정렬한 뒤 **R1의 내부 HTTP/관측 계약**을 구현했다.
실제 API 인증 호출·정류장/구간 매핑·좌표계·차량 동행·자동 탑승·하차는 아직 검증하지 않았다.
R1 전체 또는 실기기 시험 전 전체 과정의 완료 기록이 아니다. 제품 경로/Activity에 차량 위치를 연결하지 않았다.

## 구현

BE main source:

- `SeoulBusVehicleQuery`: 9자리 서울 노선 ID, 시작/끝 정류장 occurrence와 bounded 조회 범위.
- `SeoulTransitArrivalClient.getBusVehicleObservations`: 공식 `/buspos/getBusPosByRouteSt` 요청.
  기존 endpoint HTTPS 검증·2초 connect/4초 read timeout·deadline·provider circuit/bulkhead·공유 wire quota를 재사용한다.
  `vehicle_position` 고정 지표를 추가했다. 자동 polling이나 사용자 API는 추가하지 않았다.
- `SeoulBusVehicleObservationParser`: 최대 1 MiB/500행, XXE 차단, envelope/성공 코드 검증,
  노선·차량·도로 구간 ID/순번·stopFlag·원본 시각 검증. 중복 차량은 신선/오래된 행이 섞여도 모두 제거한다.
- source `dataTm` 기준 TTL 15초. 미래/잘못된 달력/지원하지 않는 시각 형식/만료 데이터는 폐기한다.
  로컬 수신 시각은 freshness 증거로 바꾸지 않는다. 현재 KST compact `uuuuMMddHHmmss`만 수용한다.
- `sectOrd`를 정류장 순번으로 해석하지 않는다. `posX/posY/tmX/tmY`는 미검증 좌표계이므로 전달/변환하지 않는다.
  sectionOffset의 거리 단위도 확정하지 않았다. 방면/현재 정류장/탑승 여부를 생성하지 않는다.
- 차량 번호는 저장하지 않는다. 차량 ID는 내부 메모리 증거에만 있으며 JSON/문자열 표현에서 제외한다.
  network 예외의 serviceKey 포함 URI와 XML 오류 원문도 외부 오류 메시지에 남기지 않는다.

출처: [서울시 공식 차량 위치 API의 요청/응답 명세](https://www.data.go.kr/data/15000332/openapi.do).
명세 확인과 실제 API 응답 검증은 구분한다. 공개 화면의 기존 7016 관측을 공식 API 인증 응답으로 위장하지 않았다.

test-source `seoulBusVehicleReadinessProbe`:

- 명시 opt-in과 프로세스의 `SEOUL_BUS_API_KEY`가 있어야 조회한다. 기본 1회이며 별도 승인된 SAMPLE 모드만 최대 6회다.
- 고정 노선 100100447/정류장 순번 44~48을 사용한다. 기본 HTTPS이며 이후 명시 승인 전용 HTTP 시험 모드를 추가했다.
  임의 호스트·좌표·토큰 입력은 없다. 전송 실패 시 HTTP 자동 전환은 없다.
- Spring 앱/DB/위치/APNs를 시작하거나 `.env`를 읽지 않는다. 키/차량/원문 응답을 출력하지 않는다.
- 신선 관측을 받아도 navigationReady/차량 동행/정류장 매핑/좌표 인증은 false다.
- 키 누락/오류/빈 관측은 exit 2. [실행·해석 절차](journey-device-validation-runbook.md#21-r1-공식-서울-버스-차량-관측-사전-검사).

## 자동 검증

```sh
./gradlew test --tests 'com.noLate.transit.*' --tests 'com.noLate.journey.*' \
  -Pkotlin.incremental=false -PexcludeMysqlTests=true
```

**29 suites / 235 PASS / 실패 0 / skip 0**.
MySQL-tag 시험은 이번 명령의 범위에서 제외했다. 실제 MySQL/실제 APNs를 이번 단계에서 재검증했다는 뜻이 아니다.
로그: `/private/tmp/nolate-r1-complete-contract-regression.log`.

새 계약은 합성 XML과 loopback HTTP server로 검사했다. 실제 외부 provider 호출은 0이다.
시각 경계/역순 query/잘못된 ID·상태·header/envelope/중복/XXE/과대 본문/429/제공처 quota 오류,
단일 encoding/공유 local quota/키 없는 호출 차단/오류·JSON의 식별자 제거를 포함한다.
사전 검사 CLI에도 빈 키를 명시 주입해 CREDENTIAL_UNAVAILABLE/networkAttempted=false/exit 2를 확인했다.

FE/Swift source 변경 없음. 이번에는 FE 전체 회귀·네이티브 빌드를 재실행하지 않았다.
기존 설치의 최신 FE 표시와 이번 BE test issuer로 아래 회귀를 확인했다.

## 독립 시뮬레이터 회귀 E2E

대상: `NoLate Journey P0 Isolated 20261004`, iOS 26.5,
UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, detached `deviceWindow-AppWindow-8`.
`Show in Device Hub` toolbar를 확인했으며 embedded Hub/실기기는 조작하지 않았다.

1. 실제 push OFF인 새 loopback test issuer와 dotenv 비활성 Metro를 실행했다.
2. 기존 `seoul-7016-preview`를 다시 불러오고 실제 승차 정류장 좌표를 CoreLocation에 합성 주입했다.
3. 경로 검사 실패 사유가 표시되고 시험 동의 후에도 준비/복구가 비활성이다.
4. 실제 상세 컴포넌트가 crash 없이 7016·4정거장·시간 미확인·`--:--`를 표시했다.
   IDLE 상태에서 현재 주행/도착 마커를 생성하지 않았다. 지도는 검증된 geometry가 없어서 비어 있다.
5. 목적지 좌표로 합성 점프를 넣어도 IDLE/출발 감지 0을 유지했다.
   연속 이동이나 실제 탑승/도착 판정 성공 검사가 아니다.
6. 잠금 화면에서 미지원 Activity 카드가 없음을 육안 확인했다.
   실제 APNs update/end 전달 성공 시험으로 대체하지 않는다.
7. 서버 prepare/departure/activation/arrival/provider-push 시도 모두 0, lastState=NONE.
8. GPS 주입 해제와 이번 시험 서비스 종료. 기존 데이터·실기기·`.env`·운영 기본 OFF는 보존했다.

증거: `docs/evidence/journey-r1-vehicle-contract-20261007/`의 PNG 3개.
이는 기존 미지원 경로의 안전 차단/표시 회귀이며 새 차량 어댑터의 화면 E2E가 아니다.
어댑터가 엔진에 연결되지 않았으므로 차량 주행 표시 E2E는 미완료로 남긴다.

## 다음 선행 조건

1. 공식 HTTP 응답/키 주입 및 추가 6회에서 신선 관측과 간헐적 만료를 확인했다. 두 승인 범위는 사용 완료다.
   후속 외부 시험은 기간·횟수·전송 위험 범위를 별도 승인받는다. 키를 채팅/로그로 보내거나 `.env` 전체를 로드하지 않는다.
2. 다음 구현은 좌표계·route/section/stop 연결과 최신 관측 부재 시의 안전한 중단 계약이다.
   15초를 임의 완화하거나 빈/오래된 응답을 탑승 증거로 취급하지 않는다. 고정 갱신 주기/SLA는 미확정이다.
3. 공식 노선/정류장 자료 및 실제 경로 공급자와 ID·방면·도로 구간 geometry crosswalk를 검증한다.
   일일 quota 예산·캐시·활성 세션 polling도 연결 전에 추가한다.
4. 검증된 입력을 확보한 뒤 R2 연속 GPS/차량 동행 판정과 R3 이후 단계로 진행한다.

공식 신선 관측 수신은 제한된 표본에서 확인했으나 geometry/방면 연결은 아직 미검증이다. 가짜 선을 만들어 R1 합격이나
자동 탑승·하차를 활성화하지 않는다. 실기기 시험은 별도 승인 전까지 수행하지 않는다.
