# R6 지하철 관측 연결 — 부분 구현 및 검증

2026-10-12. **전체 지하철 내비게이션/환승 완료가 아니다.** 실제 사용자 위치·탑승·현재 역을
열차 위치 API만으로 확정하지 않는다. 개인 키를 사용한 교통 API/APNs 신규 호출은 0회다.
공식 문서의 공개 `sample` 요청은 후속에서 1회 실시했고 정상 열차 목록을 얻지 못했다.

10/13 후속: 독립 catalog resolver/분기·급행·만료 경계를 구현하고 독립 화면 16사례와 서버
단절을 확인했다. [최신 부분 구현·검사 기록](journey-subway-catalog-validation-20261013.md)이
이 문서의 과거 10사례/port-only 상태보다 우선한다. 공식 운영 catalog 설치·승객 결합은 아직 아니다.
아래 DB 중지 대기 기록도 당시 상태다. 운영 DB의 실제 5개 적용 완료는
[10/13 운영 마이그레이션 기록](journey-production-migration-20261013.md)을 따른다.

추가 후속: [소유 자동 세션 관측 endpoint·조회 전후 실제 JPA fence](journey-owned-subway-observation-validation-20261013.md)를
구현했다. BE 152·FE 3,169 PASS 및 신규 독립 화면 6사례를 확인했다. 기본 OFF이며
열차 관측 개수만 제공한다. 아래 endpoint 미구현 기록은 과거 상태이고, native admission/
승객 탑승/현재 역·지하철 환승 projection은 아직 완료되지 않았다.

## 최신 후속: 저장 원본 식별자 보존·진단 경로 수정

- FE ODsay 파서는 원본 `stationID`, `startID/endID`, `wayCode`, 모든 `lane`의
  `subwayCode/subwayCityCode/sourceIndex`를 별도 navigation evidence에 보존한다.
  표시 코드·버스 localStationID·배열 위치로 누락 값을 복원하지 않는다. 중복 역/누락 행과
  원본 순서를 보존하며 64개 초과 lane은 임의 절단하지 않는다.
- BE `JourneySubwaySavedLegEvidence`는 서버 저장 원본과 정규화된 동일 구간을 대조한다.
  provider/city/line/ODsay 방면·원본 역 ID·명시 순서/개수·양 끝 좌표 일치를 검사한다.
  이 결과는 ODsay metadata일 뿐 서울 역 ID 대응이나 탑승 확인이 아니다. 원본이 없는
  legacy 경로는 `RAW_SUBWAY_IDENTIFIERS_REQUIRED`로 catalog/열차 HTTP 모두 0회다.
- 새 진단 화면의 로그인 회귀 원인을 별도로 확인했다. root 개발 공개 경로/Stack 등록에서
  화면이 누락돼 있었다. `internalPreviewRoutes` 한 목록을 두 곳에서 사용하며 production,
  미등록 경로, 추가 하위 경로는 공개하지 않는다. Metro manifest/OS 실행 지연 문제와
  이 코드 결함을 구분한다. root 수정은 운영 인증을 우회하지 않는다.
- 기존 9개에 원본 누락 사례를 추가해 test-source HTTP fixture는 **10사례**다.
  모든 사례는 합성 HTTP/저장 authority이고 GPS·실제 열차 API·APNs를 사용하지 않는다.

### 최신 자동 검사 (실패 기록 포함)

- BE 원본 resolver 11·저장 경로의 원본 누락 검사 1 추가. targeted 검사/타입 검사 PASS.
  후속 fixture의 nullable test node 접근 컴파일 오류 1회는 수정했다.
  최종 관련 broad **75 suites / 579 PASS**, 실패·오류·skip 0, 격리 MySQL 포함이다.
- FE 원본 파싱 13·진단 원본 누락 1·개발 공개 경로 6 추가. 최초 타입 선언을 잘못된
  display interface에 넣은 오류와 `test.each` 배열 인수 작성 오류를 수정했다.
  첫 전체 실행은 **3,003 중 3,001 PASS/2 실패**(새 테스트 작성 오류 1, 기존 달력 timeout 1),
  다음 실행은 **3,002 PASS/기존 달력 timeout 1**이었다. 관련 제품 달력 코드나 5초 제한을
  변경하지 않았다. 후속 focused 5 suites/126 PASS 후, UI/컴파일을 겹치지 않은 최종 실행은
  **315 suites / 3,003 전체 PASS**(58.292초)다. 이전 실패를 삭제하지 않는다.
- TypeScript 및 양 저장소 `git diff --check` PASS. 이번 native 소스 변경/새 iOS 빌드/Swift 실행은 없다.

### 최신 독립 창 검사

후속에서 창이 다시 선택됐으며 동일한 **독립 창의 10사례와 서버 단절 1사례**를 AX/화면으로 확인했다.
창 `NoLate Mixed Journey E2E 20261012`, `deviceWindow-AppWindow-2`, 기기
`4EE367B1-CDC6-4585-A64B-CB554EEB7DE2`이며 `Show in Device Hub` 툴바로 분리 창임을 확인했다.
embedded 허브/실기기를 조작하지 않았다. 정상/복수는 관측 1/2개·탑승 미확정이고,
반대 방면은 `SERVICE_PATTERN_OR_FRESHNESS_MISMATCH`, 오래된/부분 목록은
`TRAIN_OBSERVATIONS_UNAVAILABLE`, 변경/철회는 `SAVED_ROUTE_CHANGED`/`OWNER_CHANGED`,
catalog/원본 누락은 각각 `STATION_CROSSWALK_REQUIRED`/`RAW_SUBWAY_IDENTIFIERS_REQUIRED`와
공급자 0회를 표시했다. redirect는 `PROVIDER_UNAVAILABLE`다.
자체 test-source 15547 서버만 정확한 PID/cwd/main-class 확인 후 중단해,
기존 정상 결과가 `서버 연결 실패 · 이전 결과 사용 안 함`으로 제거됨을 확인했다. 이후 같은 서버를 복구했다.
실제 공급자·GPS·APNs 호출은 없고 이 통과는 **관측 연결 UI E2E이지 실제 지하철 주행 E2E가 아니다.**
증거: [복수](evidence/journey-r6-subway-20261012/03-multiple.png),
[반대 방면](evidence/journey-r6-subway-20261012/04-direction.png),
[오래된 관측](evidence/journey-r6-subway-20261012/05-stale.png),
[일부 목록](evidence/journey-r6-subway-20261012/06-partial.png),
[경로 변경](evidence/journey-r6-subway-20261012/07-edited.png),
[로그인 철회](evidence/journey-r6-subway-20261012/08-revoked.png),
[catalog 누락](evidence/journey-r6-subway-20261012/09-catalog-missing.png),
[redirect](evidence/journey-r6-subway-20261012/10-redirect.png),
[원본 누락](evidence/journey-r6-subway-20261012/11-raw-missing.png),
[서버 단절](evidence/journey-r6-subway-20261012/12-server-unavailable.png).

이전 실패 기록: root 등록 수정 후 정확한 분리 창에서 화면 진입과 **정상 1사례**를 확인했다.
`complete / TRAIN_REFERENCES_ONLY`, 합성 관측 1개·탑승 미확정·로컬 공급자 1회·소유권
재검사 2회·위치/남은 역 미표시를 AX와 [화면](evidence/journey-r6-subway-20261012/02-complete.png)에서 확인했다.
당시 복수 열차 버튼 시도는 빈 AX 상태를 반환해 결과를 확인하지 못했다. 당시 나머지 9사례 및
서버 단절 UI 검사는 미검증이었다. 창 메뉴에서 정확한 대상 선택/메뉴 닫기도
`noWindowsAvailable`/capture timeout으로 실패했다. 다른 기기·공유 GUI/CoreSimulator 서비스를
중지하거나 embedded Device Hub로 전환하지 않았다. HTTP/Jest 통과를 이 E2E로 대체하지 않는다.

### 공식 역정보 원본 확인

공식 [서울시 도착정보 자료](https://data.seoul.go.kr/dataList/OA-12764/A/1/datasetView.do)의
2026-09-02 역정보 Excel을 공개 HTTPS 다운로드로 읽기만 했다. `Data!A1:D697`은 header와
696개 역 참조(19개 호선)이며 열은 `SUBWAY_ID`, `STATN_ID`, `STATN_NM`, 호선이름이다.
역 ID 중복/잘못된 숫자 행은 없지만 **ODsay 대응 ID·좌표·운행 계통별 정차 순서가 없다.**
행 순서/ID 숫자 정렬을 운행 순서로 사용하거나 지원 열차 API 호선을 자동 확장하지 않았다.
이 자료만으로 운영 crosswalk가 완료됐다고 할 수 없다. Spreadsheets 스킬의 읽기 전용
원본/단위 보존 절차로 확인했고 workbook 수정/재내보내기·운영 catalog 등록은 없다.
원본 SHA-256: `537c1ab9f58b9b4d9bf35c34ac5d9de2e8b24bc25e3058d726f4a5bbae787da8`.
ODsay 원본 필드의 근거는 [공식 Web API 명세](https://lab.odsay.com/guide/releaseReference?platform=web)다.
개인 키를 사용한 교통 API/APNs 신규 호출은 여전히 0회다.

### 개인 키 없는 공개 샘플 확인

OA-12601 공식 문서에 공개된 `sample` 키·1호선·1~5 범위로 HTTP 요청을 **1회** 했다.
개인 인증키·로그인·사람 위치를 전송하지 않았고 redirect/retry/원문 저장은 없었다.
HTTP 응답은 받았지만 기대한 정상 열차 목록은 없었다(`PROVIDER_REJECTED`, row 0).
집계만 출력했으며 원문/열차 ID를 출력·보존하지 않았다. 이 결과로 날짜·시간의 실제
정상 응답 형식이 검증됐다고 할 수 없다. 신규 개인 키 API 승인 범위를 사용하거나
실제 길안내·APNs 전달 성공으로 계산하지 않는다.

## 구현한 경계

- BE `SeoulSubwayTrainObservationParser`: 공식 호선 ID·방면·종착역·열차 상태·급행 코드,
  중복 열차·부분 목록·잘못된 시각·미래/오래된 원본 관측 차단. 수신 시각으로 원본을 갱신하지 않는다.
- `SeoulSubwayTrainHttpTransport`와 기존 Seoul client의 on-demand 메서드: 전체 본문 포함 4초,
  1MiB, 동시 2개/대기열 없음, redirect 거절, HTTP 200만 허용. 공유 quota/circuit/고정 metrics를 사용한다.
  본문·키·URL·원래 예외 원인은 노출하지 않는다. 기존 도착정보 조회의 방면 fallback을 재사용하지 않는다.
- `JourneySubwayTrainStationMatcher`: 정확한 호선/방면/종착역/운행 종류의 **열차 측 역 참조**만
  계산한다. 급행의 실제 정차 순서와 일반 순서를 혼용하지 않고, 순환선 중복 역·복수 열차는 추측하지 않는다.
  도착 상태만 다음 정차 횟수를 계산하며 이것을 승객의 남은 역 수로 출력하지 않는다.
- `SavedJourneySubwayObservationCheck`: 서버 소유 저장 SUBWAY 구간을 선택하고 조회 전후의
  소유권/login/revision/전체 경로를 재검증한다. 외부 I/O 동안 DB transaction/잠금을 유지하지 않는다.
  전역 동시 2개·회원별 single flight·10초 검사 수명을 둔다. 경로 변경/철회 후 성공 결과를 버린다.
  독립 역/운행 순서 catalog가 없으면 열차 API를 호출하지 않는다. 기본 OFF이며 제품 endpoint,
  scheduler, automatic-session/native 소비자는 아직 등록하지 않았다.
- 개발 전용 `internal/journey-subway-observation`: 고정 loopback 15547의 test-source-only 서버만
  사용한다. 명시적 진단 실행 시 이전 성공을 제거하고 실패/늦은 응답/중복 요청을 처리한다.
  시험 버튼은 **관측 사례 선택**이며 출발·탑승·하차·도착을 전환하는 버튼이 아니다.

## 계약 근거와 한계

공식 [서울 실시간 열차 위치정보 OA-12601 명세](https://data.seoul.go.kr/dataList/openApiView.do?infId=OA-12601&srvType=A)를
읽었다. 명세의 역 ID/상하행/종착역/상태/급행 필드를 사용하며, 명세에 없는 승객 위치 필드를 만들지 않는다.
문서만으로 날짜·시간의 실제 응답 문자열 형식까지 검증된 것은 아니다. 현재 strict 지원 형식은
날짜 `yyyyMMdd` 또는 `yyyy-MM-dd`, 시간 `HH:mm:ss` 또는 날짜 포함 시각이다. 다른 형식은 거절한다.
원본 관측 30초 TTL은 NoLate 정책이며 공급자의 보장 SLA가 아니다.

서버 catalog port와 시험용 합성 순서는 **공식 catalog crosswalk 구현을 대체하지 않는다.**
실제 ODsay 원본 역 tuple ↔ 서울 역 ID, 운행 계통/분기/종착/급행 정차 순서를 독립 자료로
검증하는 운영 구현이 필요하다. 이름/근접 좌표만으로 매핑하거나 노선 전체 열차를 특정 승객에
연결하지 않는다. 열차 정보의 정상 수신으로 터널의 GPS 단절이 해결되었다고 표시하지 않는다.

## 자동 검사 기록

- 초기 관련 broad: BE **72 suites / 553 PASS**, 실패·오류·skip 0. 열차 파서 20·HTTP transport 6·역 참조 matcher 12 포함.
- 후속 saved-route check 12, 합성 HTTP 전체 사례 1(9사례 순회), partial/204 HTTP 거절 1 추가.
- 후속 broad 첫 실행: **74 suites / 567 중 566 PASS, MySQL readiness timeout 1 실패**.
  격리 container는 정리됐다. 공유 DB에 접근한 테스트가 아니며 실패를 삭제하거나 PASS로 계산하지 않는다.
- FE 신규 2 suites / 30 PASS. 전체 첫 실행은 **313 suites / 2,983 중 2,981 PASS, 기존 달력
  테스트 2건의 5초 timeout**이다. 관련 제품 코드를 변경하거나 시간 제한을 늘려 우회하지 않는다.
- TypeScript PASS. native/Activity 소스 변경이 없어 이번 변경의 새 iOS 빌드나 새 Swift 실행으로
  표현하지 않는다. 이전 R4-4b-4의 Swift 349 PASS·native 빌드/잠금 완주 증거는 별도 기록이다.
- 순차 재실행: BE **74 suites / 567 PASS**, 실패·오류·skip 0, 격리 MySQL 포함.
  FE **313 suites / 2,983 PASS**, 실패 0. 시간 제한/관련 제품 코드 변경 없이 다시 실행했다.
  초기 실패 이력은 위에 유지한다. 두 저장소 `git diff --check` PASS.
- 마이그레이션 operator helper의 무접속 안전성 검사 3 PASS. 한 번의 잘못된 FE 작업 디렉터리
  실행은 파일 없음으로 종료했고 BE에서 정확히 재실행했다. 이를 DB migration 적용 성공으로 계산하지 않는다.

## 독립 시뮬레이터 E2E 최초 차단 이력 (최신 결과는 위 절)

대상: `NoLate Mixed Journey E2E 20261012`, iOS 26.5,
`4EE367B1-CDC6-4585-A64B-CB554EEB7DE2`의 분리 창. embedded Device Hub 화면은 조작하지 않았다.
새 경로 최초 시도는 개발 서버의 manifest 미갱신으로 Unmatched Route였다. 해당 task의 Metro 8088만
재시작했고 이전 합성 H2 자료·기타 서버/기기에는 변경하지 않았다. 재연결 후 화면 도구가
AX 빈 목록/스크린샷 timeout을 반환했다. **이 시점 새 화면 9사례의 UI E2E는 미검증**이며
HTTP/Jest 통과를 독립 시뮬레이터 E2E로 바꾸어 보고하지 않는다. 이번 task의 시험 기기만
shutdown/boot했고 데이터는 지우지 않았다. 독립 창 캡처/toolbar 접근은 복구됐지만 이후
app openurl이 OS timeout으로 실패했고 직접 launch도 지연됐다. 다른 시뮬레이터·Device Hub
프로세스·공용 CoreSimulator 서비스를 중단하지 않았다.
복구 뒤 toolbar Home은 응답했지만 기기 화면의 좌표 입력은 `noWindowsAvailable`로 실패했고,
NoLate 아이콘 직접 실행도 확인되지 않았다. SpringBoard 로그는 동일 앱의 pending bootstrap을
표시했다. 원인 확정/복구 완료는 아니다. [독립 창 Home 차단 상태](evidence/journey-r6-subway-20261012/01-independent-home-ui-blocked.png)는
앱 내 R6 화면 증거가 아니라 **시험 환경 차단 증거**다. 새 화면의 정상/거부 9사례와
서버 단절 시 이전 성공 제거 UI 검사는 재개 후 반드시 실행한다.

## 남은 R6 완료 조건

1. 승인된 실제 열차 응답의 날짜·시각·전체 목록·노선 운영 범위 계약 확인.
2. 독립 공식 역/운행 계통 catalog 수집·검증과 저장 ODsay 원본 crosswalk.
3. owned automatic-session fence, 서버/native 전송 계약, 사용자 탑승 근거와 열차 후보의 별도 결합.
4. 터널 GPS 단절 시 위치 마커 숨김/불확실성, 최신성 만료, 복수 후보, 잘못 탄 노선 처리.
5. 환승 도보→다음 승차 구간 자동 연결과 노선별 안내/음성/알림/상세/Activity의 동일 projection.
6. 독립 창의 새 R6 정상·부정 E2E 및 GPS/잠금 전체 완주. 이후 승인된 실제 API/APNs 재검증.

## DB 게이트

사용자는 `late_project`가 대상이며 API·worker를 중지하겠다고 확인했다. **중지 완료 확인은 아직 없다.**
이번 read-only 검사도 다른 연결 12개, TLS 연결이었다. DDL·공유 DB 백업·서비스 중지·운영 ON·배포를
실행하지 않았다. 중지 완료와 잔여 연결 0 확인 후 준비된 전체 backup/격리 restore 검증을 거쳐
선행 5개 migration을 적용한다. `.env` 변경/원문 출력·커밋/push도 없다.
최신 후속의 read-only 재검사에서도 연결 12개이며 journey table/marker는 없다.
