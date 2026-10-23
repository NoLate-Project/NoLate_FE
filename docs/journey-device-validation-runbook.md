# 대중교통 길안내 실기기 오류·검증 절차

## 2026-10-22 제품 후보 인계 — 이전 Debug 전용 절보다 우선

현재 iOS 제품 후보는 Debug 현장 시험 플래그가 아니라 `NOLATE_JOURNEY_PRODUCT_BUILD=1`,
`EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED=true`, `EXPO_PUBLIC_JOURNEY_PRODUCT_ENABLED=true`,
`EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED=true`로 빌드한다. QA 진단·APNs pilot·
device field-test 플래그는 모두 OFF다. `scripts/verify-release-config.mjs --platform ios
--journey-candidate`를 통과하고 실제 archive의 Info.plist/entitlement/API HTTPS 주소를
확인한다. 이 opt-in 빌드는 기본 공개 Release 구성이 아니며, 빌드 성공만으로 배포를 승인하지 않는다.

서버의 `DEVICE` 준비는 저장된 ODsay 원본·서버 소유 보행 형상을 재검증한다. 단일 지하철
`WALK/SUBWAY/WALK`는 공식 역 대응·정차 순서 live catalog의 증명이 있을 때만
`officialSubwayAdmission`을 발급한다. 앱은 그 증명의 노선 ID·양끝 역 ID·정차 수가
준비된 원본 경로와 일치할 때만 native 입력을 허용한다. 공식 catalog 또는 별도 서버
opt-in이 없으면 준비 실패가 정상이다. 이 증명은 승객 탑승이나 열차 현재 위치의 증거가 아니다.

실기기 TestFlight 전에 서버 배포 버전·`journey.automatic.device-enabled`·지하철
observation/공식 catalog/admission opt-in·health를 함께 확인한다. 서버가 아직 기본 OFF라면
앱만 배포해도 `DEVICE` 길안내는 시작되지 않는다. 실제 본인 계정/저장 ODsay 일정으로
보행→역 접근→GPS 자동 출발→신선한 열차 현재역/승객 판단→하차 1정거장 전→최종 도보→
도착/종료를 확인하고, 각 단계의 상세 화면·잠금 Live Activity·음성/무음 알림을 대조한다.
위치·열차 신선도·권한이 부족하면 확정 안내를 숨기는지도 확인한다. 좌표, 토큰, 키,
원시 열차 ID는 공유 기록에 남기지 않는다. 이전 합성 시뮬레이터·APNs 결과를 이 현장
완주 증거로 대체하지 않는다.

## 최신 기준 — 2026-10-15

제한된 실기기 현장 시험용 `DEVICE` 실행 경로는 **Debug 전용·기본 OFF**로 분리했다.
시험 앱은 `NOLATE_JOURNEY_DIAGNOSTICS_BUILD=1`, `NOLATE_JOURNEY_AUTHENTICATED_BUILD=1`,
`NOLATE_JOURNEY_DEVICE_FIELD_TEST_BUILD=1`을 함께 주고 네이티브 빌드해야 한다.
JS에도 `EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED=true`와
`EXPO_PUBLIC_AUTOMATIC_JOURNEY_DEVICE_FIELD_TEST_ENABLED=true`가 필요하다.
서버 `journey.automatic.device-enabled=true`는 별도 선택이며 이번 작업에서 운영에 켜지 않았다.
네이티브 세 플래그는 Expo config plugin이 **prebuild 시** Info.plist에 넣는다.
기존 `ios/` 프로젝트를 플래그 없이 단순 `xcodebuild`한 결과물은 여전히 기본 OFF다.
시험용 prebuild 후 빌드된 앱의 Info.plist에 세 플래그가 모두 true인지 확인하고,
서명/entitlement도 별도로 검사한다. 기존 프로젝트 변경을 검토 없이 덮어쓰지 않는다.
한 플래그만 켜거나 `SIMULATOR` 실행을 휴대폰에 보내면 준비/복구가 실패해야 한다.
v4 보행 계약만 서버의 최대 7,200초 수명을 사용하고 나머지 `DEVICE`는 600초다.
실제 본인 계정·저장 경로·서명된 **실기기 앱**·현장 GPS/잠금/무음/배터리는 아직 검증되지 않았다.

실기기 검증과 별개로, 10/15 서명된 **시뮬레이터** Debug 앱·단일 시험 설치·격리 H2
서버에서 합성 5구간의 실제 Firebase/APNs 잠금 UPDATE와 앱 종료 후 원격 END를 재검증했다.
잠금 화면의 현재 단계/5구간 바를 직접 보고, 앱 프로세스 종료 중 카드 유지→인증된
서버 END 수락→카드 제거를 확인했다. provider 누적 수락 `40/40`, END `1`, 거절 `0`.
CoreSimulator 위치 주입과 합성 일정이므로 실제 사용자 경로·실기기 GPS/수신/무음
합격 증거는 아니다. [현재 판정](journey-navigation-status-20261012.md#실기기-전-단계-보강--2026-10-15).

아래 10/12 절의 DDL 미실행/중지 대기는 당시 이력이다. 실제 `late_project`에는 10/13
백업·격리 복원·기존 행 수/marker 검증 후 5개 migration을 적용했다. 운영 서버는 중지
상태이며 재배포/재기동/운영 ON은 하지 않았다. [실제 적용 기록](journey-production-migration-20261013.md).

도보 v4는 신규 연결 300초 안에 준비된 인증 소유 세션에만 최대 7,200초를 허용한다.
v3 600초/기존 계약과 GPS 15초·서버 검증 30초·차량 원본 신선도 경계는 그대로다.
두 extended-navigation 스위치는 기본 OFF다. 긴 세션을 켜는 것이 탑승 검증을 켜는 것은 아니다.

- `AUTOMATIC_AUTH_LIFETIME_INSUFFICIENT`: 긴 안내 준비/명시적 복구 전에 인증이 세션
  만료+30초까지 유효하지 않다. 전경 갱신 후에도 부족하면 native 입력을 시작하면 안 된다.
  새 준비는 서버 취소 outbox가 처리되고, 복구는 기존 checkpoint를 격리한 채 유지돼야 한다.
- `AUTOMATIC_AUTH_EXPIRED`: 실행 중 원래 JWT가 만료됐다. 세션 잔여 시간이 많아도 GPS/
  Activity를 종료해야 한다. 10/13 첫 장시간 잠금 시험에서 STOPPED/잔여 6,625초/종료 대기
  0을 확인했다. 이 실패를 2시간 안내 성공으로 계산하지 않는다.
- 준비 전 인증 horizon 검사는 JWT나 세션 만료를 늘리지 않는다. 잠금 중 자동 refresh가
  구현됐다는 뜻도 아니다. 시험용 v4 opt-in issuer만 9,000초 합성 access를 사용한다.
- 제품 상세의 음성·알림 설정은 준비 전에만 명시적으로 선택한다. 표시된 설정과 실제
  native `guidanceNoticeMode`, OS 권한/잠금 표시, 알림 표시/청취를 각각 확인한다.
  알림 접수/음성 큐 숫자만으로 실제 표시/청취나 APNs 수신을 합격 처리하지 않는다.
- 새 GPS E2E는 실제 상세 컴포넌트에 합성 자료·로컬 인증·타일 없는 지도를 주입한다.
  실제 로그인/일반 지도 타일/공급자/실기기 GPS 성공으로 승격하지 않는다. 실제 지하철
  승객 결합/DEVICE release runtime·실제 제품 경로 APNs는 여전히 별도 게이트다.

[장시간 계약·실패 및 재시험](journey-extended-navigation-validation-20261013.md).

## R6-1 지하철 관측 연결의 추가 확인

- 새 loopback 진단 화면의 열차 수는 합성 열차 관측 수다. 승객의 현재 역·탑승·남은 역 수가 아니다.
- `STATION_CROSSWALK_REQUIRED`: 독립 공식 역/운행 순서 catalog가 없다. 열차 조회 0회여야 하며
  역 이름·근접 위치·사용자가 보낸 provider ID로 fallback하지 않는다.
- `RAW_SUBWAY_IDENTIFIERS_REQUIRED`: 저장 ODsay 원본 역/lane/방면 근거가 없다.
  catalog/열차 조회 모두 0회여야 한다. legacy 표시 코드로 재구성하지 않는다.
  명시적인 새 경로 조회·저장 후 동일 소유자/revision에서 원본 tuple을 다시 검사한다.
- `TRAIN_REFERENCES_ONLY`: 정확한 운행 계통의 열차 측 참조다. 복수 후보는 복수 그대로이며
  내 위치 마커나 하차 알림을 발생시키는 근거로 단독 사용하지 않는다.
- `TRAIN_OBSERVATIONS_UNAVAILABLE`/`SERVICE_PATTERN_OR_FRESHNESS_MISMATCH`: 원본 시각 만료,
  부분 목록, 방면/종착/급행 불일치 등을 검사한다. 수신 시각/노선 이름으로 신선도를 대체하지 않는다.
- `SAVED_ROUTE_CHANGED`/`OWNER_CHANGED`/`REVISION_CHANGED`: 조회 중 변경·철회 후 성공 결과를
  제거한다. `PROVIDER_UNAVAILABLE`은 redirect/HTTP/본문/통신 실패의 안전한 분류다.
- 실제 열차 응답의 날짜·시간 문자열은 아직 미검증이다. 지원 형식을 넓히기 전에 승인된
  응답 계약을 확인하며 원문·키·열차 ID·사람 GPS를 로그/문서/스크린샷에 보존하지 않는다.
- 개발 경로 root 등록 누락을 수정한 후 초기 화면 도구 timeout을 겪었다. 후속의 같은 독립 창에서
  합성 관측 10사례와 서버 단절 시 이전 결과 제거까지 AX/화면 확인했다. 이 결과는 관측 연결
  UI E2E이며 지하철 GPS 주행·탑승 E2E가 아니다. [새 구현 및 검사 기록](journey-r6-subway-observation-validation-20261012.md).

## 환승 도보 후속 확인

- v5 `TRANSFER_WALK`는 다음 승차점으로 가는 중간 도보 위치다. 최종 도보/전체 도착/다음 차량
  탑승으로 표시하면 실패다. stale/변경/로그아웃 뒤 위치가 유지되는지도 검사한다.
- 짧은 환승은 fresh 같은 차량 분리 이후 다음 승차점의 불확실성 원 안에서 연속 체류가
  필요하다. GPS 이동 시간을 빠르게 돌리거나 phase 버튼으로 통과시키지 않는다.
- Native/FE 표시 계약·서버 대역 전달/END 검사는 통과했지만 다음 구간 admission 연결과
  새 5구간 독립 GPS/잠금 E2E는 아직 남았다. 기존 3구간 완주와 혼동하지 않는다.
  [구현·검사·남은 연결](journey-transfer-walk-validation-20261012.md).

## 10/12 도보 계약의 native 소비·종료 및 배포 전 확인 (R4-4b-4)

공용 상세 카드/준비 UI에서 별도 서버 보행 계약을 소비한다. 저장 ODsay 원본을 덮어쓰지
않으며 실제 공급자·차량/현장 GPS 완료가 아니다. 혼합 준비는 snapshot의 300초 TTL로
상한을 제한한다. 서버 재검증 실패를 캐시 성공으로 연장하지 않는다.

- `SAVED_SESSION_VALIDATION_REJECTED`: 취소·교체·소유자/revision 변경 등 확정 거부.
  native 종료/Activity 제거/화면의 이전 연결 제거 후 명시적 재연결부터 다시 검사한다.
- `SAVED_SESSION_VALIDATION_EXPIRED`: 통신 오류로 검증 lease가 만료됐다. 서버 복구만으로
  자동 재시작하지 않는다. 종료 outbox 재전송과 새 안내 준비를 구분한다.
- 잠금 중 snapshot 취소와 시험 서버 일시 중지에서 카드가 사라지는지, 잠금 해제 뒤
  STOPPED·기존 연결 제거·재준비 차단을 확인한다. 콜드 재시작은 별도로 검사한다.
- native 이벤트가 누락돼도 전경에서 2초 간격 읽기만으로 terminal 상태가 반영되는지 확인한다.
  백그라운드 JS polling이나 수동 단계 전환으로 복구하면 안 된다. 정상 도착/취소에서도
  이전 도보 연결 문구를 제거하고 검증 실패 오류를 새로 표시하지 않아야 한다.
- 혼합 계약의 전체 이동 첫 두 시험은 EXPIRED였고, 보정된 합성 입력의 전경 및 출발 전
  잠금 완주는 각각 자동 도착/Activity 제거/종료 대기 0을 통과했다. 잠금 완주의 도착 시
  잔여 시간은 약 3초이므로 실사용 여정 수명·위치 오차·망 지연의 안정성 근거는 아니다.

기존 선행 4개와 `2026-10-12-mixed-walking-binding.sql`까지 총 5개 migration이 필요하다.
대상 `late_project`는 확인됐지만 API·worker 중지 완료 확인 전에는 DDL을 수행하지 않는다.
BE의 `scripts/qa/journey-migrate-confirmed-maintenance.mjs`는 operator-only이며 잔여 연결0,
owner-only 전체 backup/fsync/hash, 네트워크 격리 MySQL 복원, 순서 적용/row/marker 검사를
준비했다. 실패 시 자동 rollback/drop을 하지 않으며 서버는 중지 상태를 유지한다.
현재 공유 DB 적용·실제 backup 복원은 미실행이다. 운영 OFF여도 새 marker 없이 배포하지 않는다.
별도 network-none MySQL 8.4 합성 백업의 데이터/뷰/프로시저/트리거/이벤트 복원 리허설은
통과했지만 실제 대상 백업 복원 성공과 혼동하지 않는다. 마지막 read-only 대상 검사에서
다른 연결 12개가 남았다. ‘중지할게’가 아닌 ‘중지 완료’ 확인과 잔여 연결 0이 모두 필요하다.
[이번 GPS/잠금/실패 포함 검증 기록](journey-r44b4-mixed-validation-20261012.md).

## 10/12 도보 저장 API·TTL·배포 전 확인 (R4-4b-3)

`/api/schedules/{scheduleId}/walking-snapshot`의 POST는 `expectedRevision`만 받으며 도보
형상/소유자/공급자 증명을 클라이언트에서 받지 않는다. GET은 최신 인증·저장 경로를
재검증하되 공급자 호출이나 TTL 연장이 없다. DELETE는 opaque snapshot ID를 요구하며
이전 ID로 교체된 새 snapshot을 지우지 못한다. 모든 정상 경로 응답은 `Cache-Control:no-store`다.
ID를 안다고 경로를 읽을 수 없으며 매번 현재 인증과 서버 authority가 필요하다.

- `SNAPSHOT_NOT_FOUND`: 취소/만료 정리 후 없어진 경로다. 캐시 형상으로 fallback하지 않는다.
- `SNAPSHOT_REPLACED`: 오래된 취소 요청이다. 새 경로를 건드리지 않고 최신 snapshot을
  명시적으로 다시 읽는다. 재발급 POST를 조용히 반복하지 않는다.
- `STORED_SNAPSHOT_INVALID`: 저장 JSON/identity/TTL/형상/row metadata 계약 불일치다.
  원문을 로그에 남기거나 보정하지 말고 차단한다. 서버 보관 자료도 native admission 증명이 아니다.
- `EXPIRED`/`REVISION_CHANGED`/`OWNER_CHANGED`: 도보 0/사용 불가로 처리한다. 앱은
  요청 전후와 body 수신 후 인증 identity도 확인하며 실패 시 이전 화면 요약을 제거한다.

새 `journey_walking_snapshots` 테이블과 `2026-10-12-journey-walking-snapshots-v1` 필수
production marker가 있다. **현재 migration은 파일만 작성했으며 운영 DB에는 적용하지 않았다.**
배포 전 API/worker 중지·백업·수동 migration pre/postcondition·MySQL 검증·탈퇴/TTL 정리를
확인해야 한다. flag OFF도 schema 검증/marker를 생략하는 수단이 아니다.
`journey.walking.enabled`/`journey.walking.snapshots-enabled`/`journey.guidance.enabled`는
별도 opt-in이며 이번에 설정하지 않았다. snapshot API ON은 자동 탑승/native ON이 아니다.

계획 경로 좌표만 보관하며 GPS/공급자 원문/키/토큰은 보관하지 않는다. TTL 300초 이후
GET은 즉시 거절하며 기본 60초 주기 정리가 물리 삭제한다. 정리 worker 지연/DB 장애 때는
물리 보관이 길어질 수 있으므로 운영에서 purge 오류/지연을 별도 확인해야 한다. 탈퇴는
회원 본인과 소유 일정의 참여자 snapshot도 같은 cleanup 트랜잭션에서 삭제한다.
실제 노선 연결/native 소비/현장 GPS는 아직 미완료다.
[저장·재시작·교체·취소·만료 E2E 및 미검증 조건](journey-r44b3-snapshot-validation-20261012.md).

## 10/12 서버 보행 HTTP·재검증 오류 확인 (R4-4b-2)

내부 검사 서비스만 구현됐으며 아직 제품 API/영속 snapshot/native 입력에 연결하지 않았다.
실기기 제한이나 운영 OFF를 제거해 시험하지 않는다. 서버 키는 backend secret 주입으로만
관리하며 FE 공개 변수/앱 bundle/채팅/명령 인자에 복사하지 않는다. 이번 검사는 실제 키를 읽거나 전송하지 않았다.

- `SAVED_ROUTE_CHANGED`: 공급자 조회 사이 저장 원본/revision이 변경됐거나 오래된 OSIV
  엔티티의 잠금이 실패했다. 이전 성공을 폐기한다. 최신 경로를 확인하고 사용자가 다시 선택한
  뒤 새 검사로 시작하며 이전 snapshot을 조용히 재사용/재발급하지 않는다.
- `OWNER_CHANGED`: 최신 로그인 세대/소유자가 맞지 않는다. 안내를 차단하고 재인증·소유권을
  확인한다. 오래된 JWT의 성공 응답만으로 통과시키지 않는다.
- `PROVIDER_UNAVAILABLE`: redirect/status/부분 응답/크기/UTF-8/시간 초과를 포함한 안전한
  상위 분류다. 이전 형상으로 fallback하거나 자동 재시도하지 않는다. 시험의 고정 분류만
  기록하고 응답 본문·키·URL·원시 GPS·토큰을 로그에 남기지 않는다.
- `PROVIDER_BUSY`/`ROUTE_BUSY`: 동시 요청 또는 잠금 경쟁이다. 대기열 없이 거절하며
  `AMBIENT_TRANSACTION`은 HTTP 호출 전에 트랜잭션 경계를 수정해야 하는 구현 오류다.
- 화면의 `서버 검사 불가 · 안내 차단`: 응답 오류 시 이전 성공 요약/형상이 사라져야 한다.
  진단 화면 성공은 제품 경로 admission이나 실제 GPS 길안내 성공이 아니다.

연결 3초·전체 응답 8초·1MiB 한도를 유지한다. 로컬 지연 fixture의 350ms는 시험 전용이다.
현장 전에는 실제 HTTPS 인증/할당량, 전체 MySQL/visibility 동시 변경, snapshot 저장·TTL·
revision/native 소비 계약을 따로 검증해야 한다.
[R4-4b-2 검사 결과·독립 화면 7사례](journey-r44b2-http-authority-validation-20261012.md).

## 10/12 공식 형상 보강 후 추가 확인

추가 승인 7016 HTTP 2회 조회 후 같은 공개 형상 자료를 오프라인으로 재생해
44~48번 정적 유일 매핑을 통과했다. 실제 저장 경로/차량/도보 연결 합격은 아니므로
실기기 제한을 해제하지 않는다. [형상 수정·실패 포함 E2E 기록](journey-r1-catalog-validation-20261012.md).

내부 화면의 `승차 후보` phase/reason/이동 근거와 별도 `자동 탑승`의 차량 동행 근거를
함께 확인한다. 후보 GPS 오차가 확인 불가인 것은 후보 snapshot을 사용할 수 없다는 뜻이며
전체 위치 수신이 끊겼다는 증거로 해석하지 않는다. 차량 수신만으로 탑승을 확정하지 않는다.
조기 잠금에서는 후보가 누적되지 않은 실행이 있었고, 전경 탑승 후 잠금 재시험은
최종 도보/목적지 종료/카드 제거/큐 0을 통과했다. 조기 잠금 재현 안정성은 미해소다.

향후 현장 승인 시험은 첫 도보→정류장 체류→승차 후보→차량 동행 확정→분리→최종 도보
각 경계 전후로 잠금/해제를 분리해서 반복한다. 위치/방면/차량 근거가 부족하면 현재 위치
마커와 하차 확정이 숨겨지는지 확인하고, 실패 상태·시각·잠금 시점을 기록한다.
GPS/차량/키/토큰 원문은 로그나 보고서에 첨부하지 않는다.

Metro Watchman 종료는 이번 개발 환경 실패로 별도 기록했다. 기존 QA 전용
`NOLATE_QA_NO_WATCHMAN=1`로 재시험했으며 현장 GPS 문제의 원인으로 단정하지 않는다.
Expo listener/handler-only 동적 import 경고도 별도 알림 전경 경로의 조사 단서다.
권한 허용·알림 접수 5건만으로 잠금 표시 합격 처리하지 않는다.

2026-10-12 최신: 단일 **합성** WALK-BUS-WALK는 자동 출발/버스 이동/하차 접근/최종 도보/
목적지 종료까지 시뮬레이터에서 검증했다. 전경 음성 이벤트 큐와 알림 권한 거부 분기도 추가했다.
실제 공급자 경로 연결·R6 지하철/환승·실기기 execution은 미완료다.
[현재 안내 채널 검증과 제약](journey-r5-notices-validation-20261012.md),
[최신 로드맵](journey-guidance-roadmap.md)을 우선한다. 아래 과거 날짜의 기록은 해당 실행의 범위다.

10/08 후속: 실제 7016 catalog는 정류장 106개·형상점 1,693개를 진단용으로 읽었으나
공개 번호 오류 1행이 있어 navigationReady=false다. 조회 성공만으로 실기기 제한을 제거하지 않는다.
[최신 진단·시험 경계](journey-r1-catalog-diagnostics-validation-20261008.md).

같은 날짜 후속에서 실제 APNs의 잠금 중 새 접근/대기 안내와 앱 terminate 뒤 END/카드 제거를 재검증했다.
단일 시험 설치 시도·수락 16건, END 1/중복 추가 전송 0. 이번 cold 재진입은 창 조작 오류로 미완료다.
[APNs 재검증](journey-apns-revalidation-20261008.md),
[정류장–형상 유일 매핑 차단 결과](journey-r1-stop-shape-validation-20261008.md)를 함께 따른다.

기준: 2026-10-07. 이 문서는 **시험 준비와 재현 방법**이다. 현장 테스트 성공 기록이 아니다.
자동 엔진은 Debug에서만 빌드된다. 시뮬레이터 경로와 별도 실기기 `DEVICE` 시험 경로는
각각의 빌드/JS/서버 opt-in을 요구한다. 기본 빌드에서 실기기 차단은 정상이며 Release 플래그나
`SIMULATOR` 제한만 제거해 현장 시험하지 않는다.

## 1. 증거와 판정

- 단위 테스트 PASS, 합성 서버 PASS, 시뮬레이터 GPS PASS, 실기기 수신 PASS, 실제 노선 완주 PASS를 구분한다.
- `OBSERVED`: 읽힌 사실. `ATTENTION`: 추가 확인이 필요한 상태. `UNVERIFIED`: 미검증. `UNSUPPORTED`: 미구현. 전체 합격을 뜻하는 녹색 신호로 사용하지 않는다.
- 앱의 `internal/journey-readiness`는 읽기 전용 DEBUG 화면이다. 새로고침은 엔진/진단 snapshot만 읽고 위치·음성·APNs를 시작하지 않는다. 안내 시험 화면의 **길안내 검증 상태**로 진입한다.
- 이 화면은 좌표·JWT·FCM/APNs 토큰·계정/세션 식별자·원본 경로를 표시하지 않는다. P0 위치 probe의 샘플은 길안내 엔진의 수용 샘플과 다르다. probe 성공을 길안내 성공으로 대체하지 않는다.
- 시각적 GPS 마커는 유효한 엔진 관측이 있을 때만 표시한다. 예정 시간 비례 바는 전체 여정 완료율/실측 ETA가 아니다.

## 2. 실기기 시작 전 필수 게이트

1. 사용할 Firebase/APNs 환경, 시험 앱 bundle/team/provisioning, 단일 시험 설치 범위를 명시적으로 선택한다. 원칙적으로 별도 개발 환경을 사용한다. 2026-10-06 사용자는 기존 개발·운영 겸용 `nolate-cbdf2` 프로젝트의 시험 사용을 승인했다. 이 예외도 단일 시뮬레이터 FCM 지문 allowlist·합성 일정·분리된 loopback 서버에만 적용하며 운영 일정/다른 설치로 발송하지 않는다.
2. 제한된 Debug `DEVICE` 실행과 인증 소유권·실제 본인 저장 일정·서버 검증 계약을 사용한다.
   v4가 아니면 10분 상한이므로 완주 시험에 쓰지 않는다. 실제 앱/서버 opt-in과 서명·권한을 별도 확인한다.
3. 실제 공급자의 노선 ID·정류장 순서/중복 occurrence·방면·차량 관측 시각·geometry의 가용성과 사용 권한을 확인한다. 이름·속도만으로 탑승을 확정하지 않는다.
4. 확정 승차→차량 진행→하차→환승→최종 도착과 과거 revision 차단을 구현하고 순수 정책/통합/replay 검사를 먼저 통과시킨다.
5. 안내 이벤트를 TTS·일반 알림·Activity에 연결한다. 기존 음성 probe는 실제 안내 모듈이 아니다. 무음/음성/이어폰 정책을 명시적으로 설정한다.
6. 실제 본인 개발 계정과 비공유 시험 일정을 준비한다. 개발 계정 로그인·장소 검색·저장 경로 선택부터 종료까지 독립 UI E2E를 수행한다. 합성 JWT/오프라인 지도는 대체 증거가 아니다.
7. 시험자가 정차 지점에서 조작한다. 도보/탑승 중 화면 조작을 요구하지 않는다. 동행 관측자가 안전하게 안내 시각을 기록한다.

### 2.1a R1 공식 서울 버스 정류장·형상 계약 사전 검사

BE test-source `seoulBusRouteCatalogReadinessProbe`는 `.env`를 읽지 않는다. 소유자가 준비한
`SEOUL_BUS_API_KEY` **해당 키만** 검사해 일회 프로세스에 주입한다. 중복 선언의 값이 다르면 임의로
첫/마지막 값을 선택하지 말고 소유자가 정리한다. 모두 동일함을 원문 출력 없이 확인한 경우에는 한 값으로만
주입할 수 있다. 키를 FE 공개 환경 변수나 명령 인자에 복사하지 않는다.

```sh
NOLATE_JOURNEY_SEOUL_CATALOG_PROBE=1 ./gradlew --no-daemon seoulBusRouteCatalogReadinessProbe
```

기본 HTTPS다. HTTP 시험은 고정 7016의 `getStaionByRoute`와 `getRoutePath` 각 1회, 최대 2회에 대한
명시 승인을 먼저 받은 뒤 해당 프로세스에만 `NOLATE_JOURNEY_SEOUL_BUS_HTTP_TEST=1`을 추가한다.
첫 실패/빈 정류장 응답이면 중단하며 재시도·리다이렉트·자동 fallback은 없다. 차량 관측 API는 호출하지 않는다.
2026-10-07 정류장 첫 조회 **1회가 HTTP 401로 거절**돼 중단했다. 형상 조회는 미실행이다.
이후 사용자가 추가 정류장 1회를 승인해 2026-10-08 재조회했으나 `INVALID_RESPONSE / FIELD_MISSING`으로
중단됐다. 형상은 여전히 미호출이다. 401과 이번 필드 검증 실패를 혼동하거나 특정 원인으로 단정하지 않는다.
자동 재시도 없이 필드/행 수준의 안전한 진단과 실제 공급자 계약 검증이 먼저 필요하다.

`CATALOG_CONTRACT_VALID`는 XML/ID/순서/WGS84 계약만 통과한 것이다. `navigationReady=false`,
`stopSectionCrosswalkVerified=false`, `passengerVehicleAssociation=false`를 유지한다.
정류장/형상 좌표의 WGS84 명세를 차량 응답 좌표계로 확대하지 않는다. 계약 실패의 고정 분류만 기록하고
원문 응답·키·네트워크 예외 URI는 저장하지 않는다. 운영 설정·DB·앱 polling에는 연결하지 않는다.
2026-10-08 BE 회귀는 교통·여정·Live Activity를 포함해 344건 통과이며 UI E2E나 실제 APNs 전달로 표기하지 않는다.
[단계별 재검사 결과](journey-r1-r6-test-validation-20261008.md)의 Mac 잠금·미구현 항목을 먼저 확인한다.

### 2.1 R1 공식 서울 버스 차량 관측 사전 검사

2026-10-07 차량 관측 계약/HTTP 어댑터를 추가했다. **아직 엔진에 연결하지 않았으며 실응답
좌표계·도로 구간↔정류장 매핑·방면은 미검증**이다. 공개 웹 화면 조회와 공식 OpenAPI 사용 승인은 다르다.
[공식 차량 위치 API](https://www.data.go.kr/data/15000332/openapi.do)의 사용 승인과
승인된 키의 시험 프로세스 주입을 소유자가 확인한다. 키 원문을 채팅/명령 인자/로그/FE에 넣지 않는다.

BE의 `seoulBusVehicleReadinessProbe`는 Spring 앱/DB/위치/APNs를 시작하지 않는 test-source 도구다.
`.env`를 읽지 않으며, `SEOUL_BUS_API_KEY`가 해당 프로세스 환경에 안전하게 주입돼 있어야 한다.
실제 조회는 opt-in 이후 **서울 7016, 정류장 순번 44~48**로 기본 한 번만 수행한다. 다른 노선/임의 서버는 받지 않는다.

```sh
NOLATE_JOURNEY_SEOUL_BUS_PROBE=1 ./gradlew seoulBusVehicleReadinessProbe
```

기본 전송은 HTTPS이며 실패해도 HTTP로 자동 전환하지 않는다. 공식 HTTP 주소의 시험이 필요한 경우에는
키 평문 전송 위험과 **고정 노선 일회 조회** 범위에 대해 먼저 소유자의 명시적 승인을 받는다.
승인된 실행 프로세스에만 `NOLATE_JOURNEY_SEOUL_BUS_HTTP_TEST=1`을 추가한다. 이 설정은 test-source
도구 전용이며 운영 Spring 설정·`.env`를 바꾸지 않는다. 리다이렉트와 애플리케이션 자동 재시도는 차단하며,
실패·빈 응답·파싱 거절을 이유로 승인 없이 다시 호출하지 않는다. 결과의 `transport`로 두 시험을 구분한다.

갱신 주기 조사를 위한 별도 승인이 있을 때만 같은 프로세스에 `NOLATE_JOURNEY_SEOUL_BUS_SAMPLE=1`을
추가한다. 고정 노선/구간만 **최대 6회, 시작 간격 최소 10초, 첫 시작 후 60초 미만**으로 조회한다.
타임아웃/HTTP/제공처/파싱 오류는 즉시 중단하고 재시도하지 않는다. 정상 빈 응답·만료 응답도 표본이며
사용 가능성을 부여하지 않는다. 진단은 `sampleIndex`·`elapsedMillis`·`requestDurationMillis`와
`sourceAgeSummary`(유효 필드/시각을 가진 비중복 행의 count/minAgeMillis/maxAgeMillis)만 집계한다.
미래 시각은 음수 나이로 보이지만 기존 정책에 따라 거부된다. 형식 불일치·중복·잘못된 ID 행은 이 나이 집계에서 제외된다.
각 표본의 차량 구성이 달라질 수 있으므로 최소/최대 나이 변화만으로 특정 차량의 갱신 주기를 확정하지 않는다.
실시간 표시는 기존 source TTL 15초를 그대로 적용하며, 샘플러는 서버/앱 엔진의 polling 기능이 아니다.

- opt-in/키 누락: `EXPLICIT_OPT_IN_REQUIRED`/`CREDENTIAL_UNAVAILABLE`, networkAttempted=false, exit 2.
- 성공한 빈 응답: `NO_VEHICLES`. 운행 종료/공급자 상태를 확인한다. 탑승 가능/불가능의 판정이 아니다.
- 시각·ID 검증 탈락: `NO_USABLE_OBSERVATIONS`. 원본 제공 시각 형식과 TTL을 공급자 계약과 재검증한다.
  현재 compact KST `uuuuMMddHHmmss`만 수용한다. 이번 고정 7016 공식 API 실응답에서도 파싱됐으며 다른 서비스/전 노선 형식 보장은 아니다.
  `rejectionCounts`에는 고정 분류별 건수만 기록한다. 만료/미래/형식 불일치/노선 불일치/중복 등의
  이유를 구분하며 원본 시각·차량 ID·응답 본문을 진단 로그에 복사하지 않는다.
- 네트워크/HTTP/제공처/XML 오류: `PROVIDER_CHECK_FAILED`, exit 2. 고정 failureCategory로
  TRANSPORT_UNAVAILABLE/PROVIDER_APPLICATION_REJECTED/HTTP_REJECTED/INVALID_RESPONSE/UNCLASSIFIED를 구분한다.
  제공처 코드는 1–2자리 숫자 또는 UNKNOWN만 표시한다. 자격 증명/원문 응답은 출력하지 않는다.
  이 코드만으로 키 오류라고 단정하지 않는다. HTTPS 실패를 plaintext 전송 허용으로 우회하지 않는다.
- `AVAILABLE`/exit 0도 **관측 계약 검사만 성공**이다. navigationReady·차량 동행·정류장 매핑·좌표 인증은 false다.
  SAMPLE 모드의 exit 0은 오류 없이 적어도 한 표본에서 신선 관측을 얻었음을 뜻한다. 개별 상태와 실제 표본 수를 함께 확인한다.

`sectOrd`는 도로 구간 순번이다. 요청 startOrd/endOrd(정류장 순번)와 같은 번호로 자르지 않는다.
원본 `dataTm` 기준 15초를 넘기면 폐기하며 로컬 수신 시각으로 연장하지 않는다. 차량 번호는 보관하지 않고
차량 ID는 내부 메모리 증거에만 남기며 JSON/문자열 로그에서는 제외한다. 좌표계/거리 단위의 추정 변환도 하지 않는다.
추가 확인한 [공식 상세 명세](http://api.bus.go.kr/contents/sub02/getBusPosByRouteSt.html)는 `tmX/tmY=WGS84`,
`posX/posY=GRS80`을 구분한다. 새 어댑터는 tmX/tmY의 올바른 한 쌍만 내부에서 읽으며 없으면 좌표 없음,
잘못된 쌍이면 행을 거부한다. 좌표는 JSON/로그에서 제외하고 건수만 집계한다. 명세/합성 파싱 통과를
실응답 좌표 정확도·실제 탑승·도로 구간 crosswalk 인증으로 확대하지 않는다.
공유 provider rate-limit/deadline/circuit 보호는 있으나 일일 quota 예산·polling/cache는 연결 전 후속 작업이다.

2026-10-07 승인된 일회 HTTP 결과: 정상 API 응답 3행 모두 `TIMESTAMP_STALE`, 사용 가능한 최신 관측 0.
갱신 주기·나이 분포는 미확정이며 TTL을 임의 완화하지 않았다. 이 일회 승인은 사용 완료다.
이후 별도 승인된 60초 이내 추가 6회는 5회 fresh 확보, 반복 관측 12행 중 9 수용/3 만료,
관측 나이 7.281~22.199초였다. 마지막 표본은 모두 만료로 거부했고 source TTL 15초를 유지했다.
차량별 고정 갱신 주기는 미확정이다. 추가 6회 승인도 사용 완료했으며 운영 polling은 활성화하지 않았다.
추가 HTTP 표본 수집은 기간·최대 호출 수·동일 노선·키 평문 전송 범위를 먼저 승인받는다.
상세 결과와 이전 HTTPS 실패 기록: [R1 검증 기록](journey-r1-vehicle-contract-validation-20261007.md).

## 3. APNs: 로컬 표시와 실제 전달을 분리

현재 `JourneyGuidanceRealApnsHarness`는 외부 전송을 명시적으로 선택한 시험 태스크다. .env/ADC/운영 Spring 설정은 읽지 않는다. 아래 네 설정이 필요하다.

| 설정 | 용도 |
| --- | --- |
| `NOLATE_JOURNEY_APNS_TEST=1` | 실제 전송 시험 opt-in |
| `NOLATE_JOURNEY_TEST_FIREBASE_PROJECT` | 사용자가 명시적으로 선택한 시험 프로젝트 |
| `NOLATE_JOURNEY_TEST_FIREBASE_CREDENTIALS` | 승인된 서버 인증 JSON의 로컬 파일 경로. 키 내용 공유 금지·FE 복사 금지 |
| `NOLATE_JOURNEY_TEST_FCM_SHA256` | 단일 시험 설치 FCM 토큰의 SHA-256 allowlist. 원문 토큰 로그 금지 |

BE 태스크는 `authenticatedJourneyApnsHarness`다. 설정이 빠지면 **미검증/차단**으로 남긴다. 별도 승인을 받지 않은 운영 환경에 발송하지 않는다.

최신 혼합 5구간(v7) 원격 카드 시험은 별도 격리 `walkingSnapshotHarness`에서
`NOLATE_WALKING_TRANSFER_FIXTURE=true`, `NOLATE_WALKING_EXTENDED_FIXTURE=true`,
`NOLATE_WALKING_REAL_APNS=true`를 함께 선택한다. 위 네 APNs 설정과
owner-only `/private/tmp/nolate-walking-e2e-*` 저장 경로가 추가로 필요하다.
지하철 v8 시험(`NOLATE_WALKING_SUBWAY_FIXTURE=true`)과 동시에 켜지지 않는다.
이는 **시험 모드의 연결 가능성**이지 실제 APNs 수신 합격 기록이 아니다.

`authenticated=1&renewToken=1&pushPilot=provider` 시험 화면의 **시험 시뮬레이터 APNs 등록 · 설치 지문 확인**은 DEBUG iOS 시뮬레이터와 선택된 프로젝트에서만 실행한다. 일반 계정/운영 token API·알림 권한 prompt를 호출하지 않는다. APNs 등록 여부→진짜 일반 APNs token 존재→SDK에 그 token의 sandbox 환경 명시→FCM token→SHA-256을 검사하며 UI에는 원문이 아닌 지문만 표시한다. 임의 APNs token은 만들지 않는다. 각 단계는 12초로 제한한다. 이 지문을 서버 allowlist에 지정한 뒤 서버가 `guidancePushRealProvider=true`인 경우에만 연결 버튼을 사용한다. 지문 변경 시 다시 범위를 지정한다.

시험 `/__fixture/state`의 `guidancePushProviderAttemptCount`, `guidancePushProviderRejectedCount`, `guidancePushFailureCode`는 전송 도달 여부와 고정 코드만 제공한다. `ARRIVAL_REJECTED`를 APNs 인증 오류로 오해하지 않는다. 도착정보 source TTL 120초, 계정/세션 lease 30초, GPS content TTL 15초는 서로 다른 계약이다. 도착정보 필드 자체를 30초 lease로 잘라 거절하지 않되 전체 content의 fresh 표시·전송 만료는 짧은 GPS/lease fence를 유지한다.

검증 순서:

1. 시험 앱이 올바른 Firebase 프로젝트와 APNs entitlement/environment로 빌드됐는지 확인한다.
2. 앱을 통해 Activity를 생성하고 Activity별 update token의 최초 발급/갱신을 관측한다. FCM token, 일반 APNs token, Activity update token, push-to-start token은 서로 다르다.
3. 서버에서 token-generation/owner/revision 일치 여부를 검증한다. 허용된 설치만 사용하고 푸시 요청 본문/토큰을 콘솔에 출력하지 않는다.
4. 잠금 상태에서 기존 로컬 내용과 **구분 가능한 합성 다음 상태**를 한 번 보내고 provider 응답, 실제 잠금 카드 내용, 수신 시각을 각각 기록한다. 동일한 로컬 내용 캡처만으로 원격 수신을 판정하지 않는다.
5. 오래된/뒤섞인 sequence, 다른 세션/revision, stale payload가 현재 내용을 되돌리지 않는지 검사한다.
6. 실제 원격 END를 보내고 잠금 카드 종료를 확인한다. 앱 재시작 후 과거 Activity가 재생성되지 않아야 한다.
7. 토큰 교체·네트워크 단절 후 최신 토큰으로 회복하고, 무효 토큰을 계속 재전송하지 않는지 확인한다.

Apple은 ActivityKit에서 token을 얻고 변화를 관측하도록 설명한다. `liveactivity` push type, `<bundleID>.push-type.liveactivity` topic, 올바른 content-state/timestamp가 필요하다. provider 수락과 화면 수신은 별도로 검증한다. [Apple ActivityKit 원격 푸시 문서](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications).

### 3.1 실제 관측된 환경 불일치 점검

2026-10-06 기존 프로젝트로 실제 전송을 시도했으나 provider 원인의 `BadEnvironmentKeyInToken`을 고정 코드 `APNS_ENVIRONMENT_MISMATCH`로 분류했다. 명시적 topic 및 genuine APNs sandbox 등록 후에도 같았다. 이것만으로 Firebase 콘솔의 특정 키 설정이 원인이라고 확정하지 않는다. [실행 증거](journey-apns-connected-validation-20261006.md).

후속 사용자 화면에서 Firebase 개발 슬롯과 프로덕션 슬롯이 같은 Production 전용 키를 가리킨 것을 확인했다. 사용자가 Sandbox 인증 키 설정을 완료한 뒤 같은 설치에서 실제 전송 24회 수락/거절 0 및 잠금 중 원격 UPDATE 수신을 확인했다. 새 키 원문/ID는 읽지 않았고 콘솔은 직접 수정하지 않았다. 환경 불일치는 재검증에서 사라졌지만 위치 만료 시 이전 잠금 안내 유지 문제는 남았다. [키 수정 후 증거](journey-apns-sandbox-validation-20261006.md).

1. Firebase 프로젝트의 **해당 iOS 앱** bundle ID, 설치 빌드 bundle, 확장/본앱 signing team을 대조한다. Android 설정·서버 서비스 계정 존재만으로 iOS APNs 구성이 맞다고 판단하지 않는다.
2. Firebase 콘솔 Cloud Messaging의 Apple 앱 APNs 인증 key/certificate·team·환경 범위를 소유자가 확인한다. 서비스 계정 JSON은 Firebase 서버 인증이며 Apple APNs 키와 다르다. 키 원문을 채팅·FE·로그에 복사하지 않는다. 콘솔 설정/새 키 발급은 별도 승인 후 수행한다.
3. 일반 APNs token→FCM 설치 매핑과 Activity별 update token을 구분한다. simulator sandbox 매핑은 시험 helper에서만 수행하며 운영 SDK 정책을 변경하지 않는다. 필요시 소유자 승인으로 시험 설치의 token 재발급 범위를 정하고 allowlist를 다시 지정한다. 다른 설치 token으로 대체하지 않는다.
4. 오류 수정 후 **새 시험 세션**에서 GPS 출발 ACK, token 발급, provider 시도/수락/실패 코드, 잠금 화면의 구분 가능한 새 상태를 함께 기록한다. 확정 HTTP 거절 뒤에는 같은 token epoch를 새 timestamp로 반복 전송하지 않는다.
5. 원격 전용 시험은 로컬 UPDATE를 끈다. provider 거절 시 초기 카드를 보는 것을 수신 성공으로 처리하지 않는다. 이번에는 앱이 위치 확인 중으로 바뀐 뒤 잠금 카드가 초기 도보 약 60m를 유지했다. `staleDate`/`context.isStale` 코드가 있어도 OS 화면의 만료 전환은 별도 재검증하고, 확인 전 합격 처리하지 않는다. 운영 fallback은 순서/소유권 정책을 먼저 설계한다.

FCM의 Live Activity 전송에는 FCM 설치 token과 별도의 Activity token이 사용된다. APNs 등록과 FCM 매핑 및 Apple 인증 설정도 각각 확인한다. [Firebase Live Activity](https://firebase.google.com/docs/cloud-messaging/customize-messages/live-activity), [Firebase Apple client 설정](https://firebase.google.com/docs/cloud-messaging/ios/get-started).

### 3.2 온라인 위치 만료·앱 미실행 END 재현

최신 [실제 END 검증](journey-apns-end-validation-20261006.md)에서 온라인 precision 제거/회복와 원격-only END 수신을 확인했다. 위 이전 stale 실패 이력은 당시 결과이며, 오프라인에서 OS 자체 만료 전환이 해결됐다는 뜻은 아니다.

1. 시험 앱/확장을 simulator ad-hoc 서명으로 빌드한다. unsigned 등록 실패·Keychain -34018이 나오면 Firebase 키를 바꾸기 전에 서명을 검사한다. `NoLateFE.app-Simulated.xcent`의 `aps-environment=development`도 확인한다. 시뮬레이터의 빈 codesign entitlement 출력만으로 권한 부재를 확정하지 않는다.
2. 같은 승인 설치 지문을 확인하고 실제 provider를 명시 선택한 새 세션을 준비한다. GPS replay로 출발/대기한다. 로컬 UPDATE는 계속 차단한다.
3. GPS replay 중단·clear 뒤 15초 TTL을 넘겨 잠금/상세에서 화살표·거리·도착시간 제거를 확인한다. 다시 GPS를 넣어 회복한다. 이 검사는 연결이 살아 있어 invalidation 전송 가능할 때만 해당한다.
4. **앱이 실행되지 않은 상태**에서 카드가 남아 있는 잠금 화면을 먼저 기록한다. 아직 앱을 다시 열지 않는다. 단일 pinned lane의 고정 loopback 시험 서버가 살아 있을 때 `node scripts/qa/journey-apns-end.mjs --send-end`를 명시 실행한다. 원문 JWT/토큰 인자나 임의 origin은 지원하지 않는다.
5. provider END 수락·앱 재실행 전 카드 제거를 별도 확인한다. 같은 명령 반복은 duplicate=true이고 추가 provider 시도가 없어야 한다. 스크립트의 deviceVerified=false는 그대로 유지하고 육안 증거를 따로 저장한다. 여러 lane이 있으면 이 단일-lane QA 도구는 차단된다.
6. 재시작 뒤 서버 STOPPED·추적 재개 없음·큐 0·카드 미재생성을 확인한다. 동일 인증 세대의 checkpoint는 상태 조회에서 정확한 terminal receipt를 받은 뒤 자동 정리돼야 한다. 내부 화면의 `종료 확인 · 자동 정리 완료`와 새 준비 가능/복구 비활성도 확인한다. 복구 버튼이나 무조건 로컬 기록 삭제로 우회하지 않는다. 다른 로그인/조회 실패는 아래 3.3처럼 보존한다.
7. terminal 회수 뒤 provider opt-in은 OFF다. 새 시험에서 다시 설치 확인/명시 provider 선택→GPS ACTIVE→UI 종료를 수행해 `/stop` END 통합을 확인한다. UI 종료에는 local end도 있으므로 원격-only 제거 증거는 4~5를 따른다.

운영 durable ownership/END outbox·token 회전·server restart·오프라인 fallback은 이 테스트 메모리 sender의 성공과 구분한다. provider 수락이 불확실한 종료는 STOPPED를 유지하고 무조건 재전송/재활성화하지 않는다.

### 3.3 cold/foreground 종료 기록 자동 정리 재현

[자동 정리 검증](journey-checkpoint-reconciliation-validation-20261006.md)에서 동일 인증 binding의 진행 기록 보존/terminal 정리/조회 장애 회복을 통과했다. 실행 중인 native 세션을 복구하거나 위치 동의를 추가하는 API가 아니다. 내부 합성 인증 화면 E2E와 실제 로그인 완료 뒤 root 진입은 별도로 검증한다.

1. GPS ACTIVE/ACK 뒤 앱을 종료하고 서버 ACTIVE 상태로 cold 진입한다. `기록 보존 · 복구 전 검증 필요`, native IDLE, 출발 계수 불변을 확인한다. 명시 복구 없이 GPS/Activity를 재개하면 실패다.
2. 앱 미실행 원격 END→잠금 카드 제거를 먼저 확인한다. 같은 계정/로그인 세대/origin으로 재진입하면 복구 버튼 없이 `종료 확인 · 자동 정리 완료`가 되어야 한다. 새 준비 가능·복구 비활성·큐 0을 확인한다.
3. 테스트 전용 loopback `POST http://127.0.0.1:15544/__fixture/reconciliation-control`에 `{"unavailable":true}`를 보내 조회 503을 주입한 뒤 cold 진입한다. `서버 연결 대기 · 기록 보존`·새 준비 차단·추적 미재개여야 한다. 이 고정 fixture 조작은 production에 존재하지 않으며 OS 전체 offline 시험이 아니다.
4. 같은 fixture에 `{"unavailable":false}`를 보내고 앱 foreground를 유지한다. 5초 재시도 뒤 버튼/재시작 없이 정확한 terminal receipt로만 정리돼야 한다. 앱 background에서는 JS 재시도 보장을 주장하지 않는다.
5. 실기기에서는 합성 503 대신 연결 단절/cold 진입→foreground 연결 회복도 확인한다. 401/404·새 로그인 세대/다른 계정·삭제된 일정·잘못된 binding은 종료로 추정하지 않고 보존/차단해야 한다. 변경된 소유권의 자동 회수는 후속 정책이다.
6. 새 세션 준비→ARMED 출발 0회·이전 provider opt-in OFF→종료 큐 0·카드 없음으로 마무리한다. 기록 원문/토큰 대신 고정 상태·오류 코드·계수만 수집한다. 설치 시험 플래그와 운영 source default-off도 구분한다.

### 3.4 서버 만료 → 자동 END 시험

[자동 END 검증](journey-expiry-auto-end-validation-20261006.md)은 test-source 메모리 sender 첫 slice다. 운영 worker에는 아직 END가 연결되지 않았다. 실제 APNs 전송은 승인된 단일 시험 설치에만 사용한다.

1. 기존 signed DEBUG simulator opt-in·단일 설치 allowlist·합성 인증 APNs harness를 확인한다. harness에 `NOLATE_JOURNEY_TEST_EXPIRY_END=1`을 명시한다. 격리 60초 시험에는 `NOLATE_JOURNEY_TEST_SHORT_TTL=1`도 사용한다. 운영 `.env`나 모든 사용자 기본 ON으로 대체하지 않는다.
2. 설치 지문 확인→provider 명시 선택→검사/동의/준비→GPS replay로 ACTIVE/ACK를 만든다. 로컬 UPDATE는 provider 시험에서 차단된 상태여야 한다. 준비 버튼은 이동 단계 입력이 아니다.
3. 독립 잠금 카드가 남은 상태에서 앱 terminate·GPS clear, app service 부재와 ACTIVE/인증 요청/자동 END 계수를 기록한다. 수동 END·UI stop·시계 점프·fixture reset을 사용하지 않는다.
4. 실제 TTL과 timer 간격이 지난 뒤 사용자 재진입 전에 EXPIRED/만료 증가·자동 END 수락·카드 제거를 각각 확인한다. 인증 요청 불변과 후속 tick의 추가 provider 전송 없음도 확인한다. provider 수락만으로 카드 제거 PASS를 주지 않는다.
5. 푸시 후 앱 프로세스가 재생성될 수 있으므로 PID 관측을 함께 기록한다. 이번 시험에서도 새 PID가 관측됐지만 앱 HTTP 요청은 늘지 않았다. “사용자 재진입 없음”과 “OS가 프로세스를 전혀 생성하지 않음”을 같은 조건으로 쓰지 않는다. 실기기 wake 원인은 별도 추적한다.
6. 동일 인증 재진입에서 terminal 자동 정리·native IDLE·큐 0·provider OFF·추가 출발 없음, 새 ARMED 준비/종료를 확인한다. GPS clear·이번 서버/Metro 종료로 마무리한다.
7. 오류는 safe blocked/failed/unknown 계수와 고정 failure code로 구분한다. 소유권 불일치/잘못된 terminal 시각은 전송 차단, 같은 초는 지연, 모호한 수락·무효 token은 무조건 반복 금지다. 이 부정 경로는 unit 검증이며 실제 provider에 잘못된 token을 보내 시험한 것은 아니다.

메모리 lane을 잃는 서버 재시작/Activity token 회전·운영 durable outbox는 아직 미구현이다. 단순 재시작으로 시험을 성공시키거나 다른 설치 token으로 우회하지 않는다.

### 3.5 영속 저장·실제 process restart 시험

[2026-10-07 검증](journey-durable-end-validation-20261007.md)은 main-source durable lane/END dispatcher를 격리 file DB에 연결한 후속 단계다. 3.4의 메모리 lane 제약은 당시 결과다. 운영 DB 적용이나 token 회전 완료는 아니다.

1. `mktemp -d /private/tmp/nolate-journey-durable-XXXXXXXX`로 이번 시험 전용 0700 디렉터리를 만들고 그 절대 경로를 `NOLATE_JOURNEY_DURABLE_DIR`에 지정한다. 같은 경로를 모든 restart에 사용한다. harness는 그 안에 랜덤 32-byte 시험 키(0600)와 encrypted lane DB를 만들며 `.env`/운영 DB를 읽지 않는다. 둘 다 원문 출력·Git 추가 금지다.
2. 기존 승인 단일 설치 allowlist와 `NOLATE_JOURNEY_TEST_SHORT_TTL=1`, `NOLATE_JOURNEY_TEST_EXPIRY_END=1`을 명시한다. 새 앱 진입에서 시험 인증을 갱신하고 provider 선택→검사/동의/준비→GPS ACTIVE/ACK·lane 1을 확인한다. 오래 열린 화면의 만료 JWT 거절을 DB reset으로 우회하지 않는다.
3. 독립 잠금 카드 유지→앱 terminate/GPS clear→app service 부재를 기록한다. fixture reset/수동 END/UI stop 없이 BE listener PID/cwd를 확인하고 해당 시험 process만 TERM한다. port 부재 확인 후 같은 DB/키로 새 process를 시작한다.
4. 재진입 전에 EXPIRED/DB 준비·lane 복원/`durableEndAcceptedCount=1`·provider 수락과 카드 제거를 확인한다. authenticated/reconciliation 요청은 0이어야 한다. APNs 후 OS가 새 앱 PID를 생성할 수 있으므로 사용자 재진입 없음과 프로세스 영구 부재를 구분한다.
5. 후속 tick 뒤 ACCEPTED 상태에서 서버를 다시 restart한다. DB ACCEPTED=1 유지와 새 process provider attempts=0, 카드 미재생성을 확인한다. `guidancePushProviderAttemptCount` 등은 process별이고 durable END 상태는 DB 누적이다. 이전 메모리 `automaticEndAcceptedCount`/`guidancePushEndAcceptedCount`는 이 모드의 판정값이 아니다.
6. 같은 인증 cold 진입에서 버튼 없는 terminal 정리·provider OFF·큐 0, 새 ARMED/정상 종료를 확인한다. UNKNOWN/REJECTED/BLOCKED는 성공이 아니며 무조건 재전송하지 않는다.
7. 실제 MySQL 검사는 별도 `./gradlew test --tests '*JourneyActivityMySqlTest'`다. disposable MySQL 8.4/합성 sender만 사용한다. skip 0·migration+Hibernate validate·동시 claim·재시작 결과를 기록하고 실제 APNs DB 통합과 구분한다.
8. 종료 후 이번 서버/Metro만 중지하고 정확한 시험 디렉터리의 credential key/DB를 정리한다. 운영 적용에는 검토된 수동 migration+schema marker, 외부 `journey.activity.encryption-key`, `journey.activity.enabled=true` 명시와 부하/키 교체/모니터링이 필요하다. 이 절차는 운영 적용 권한이 아니다.

## 4. 오류별 재현과 확인

아래는 **발생 가능한 오류 후보**다. 재현 완료 목록이 아니다. 지원되지 않은 기능은 선행 구현 전 PASS 판정하지 않는다.

| 증상/위험 | 재현 방법 | 확인 위치·통과 기준 |
| --- | --- | --- |
| 위치 거부/정확한 위치 OFF | 시험 앱 권한을 거부/축소하고 안내 요청 | LOCATION_AUTH/PRECISION. 정밀 마커·거리와 확정 단계 숨김, 이해 가능한 복구 안내. 권한 변경은 시험자 승인 후 |
| 위치 서비스 OFF | 시험 기기의 위치 서비스 OFF 후 복귀 | OS/진단 snapshot. stale 위치를 새 위치처럼 쓰지 않음. 설정 복원 후 수신/회복 확인 |
| 도심 GPS 튐/평행 도로 | 실제 튐 표본 또는 noisy/off-route replay | 관측 quality, cross-track, sequence. 순간 샘플로 출발/탑승/하차 확정 금지, 안정 표본 후 회복 |
| 지하철/터널 GPS 단절 | 터널·지하역 구간과 30초 이상 무수신 replay | GUIDANCE_FRESHNESS와 지도/바. 관측 만료 시 정확한 마커 제거, GPS 단절을 하차·도착으로 해석하지 않음 |
| 같은 정류장 이름·순환 노선 | occurrence가 반복되는 원본 경로 | 원본 index/방면/sequence 일치. 이름만으로 다른 occurrence로 점프 금지 |
| 다른 버스/놓친 탑승 | 동일 정류장 다른 노선 승차, 대기 중 차량 통과 | 차량/노선/방면/시각 증거. 미지원 현재 엔진에서는 후보만 표시; 확정 탑승·하차 안내 금지 |
| 하차 한 정류장 전/거리·시간 경계 누락 | 확정 승차 후 전전/직전/목표 정류장 통과 및 경계 양쪽 replay | 정류장 잔여 수·경로 투영·유효 ETA 근거, 중복 없는 예고, 목표 직전/목표 안내. 현재 미지원 |
| 공급자 지연/429/정보 없음 | observation timeout·stale·rate-limit fixture | 실제 수신 시각/validUntil, reason code. 예정 시간을 실시간 도착으로 포장하지 않음; bounded retry |
| 네트워크 단절 중 종료 | 시험 서버 연결을 끊고 종료·앱 재시작·재연결 | native 추적/Activity 먼저 종료, STOP_SYNC 대기 보존, 동일 인증/receipt 후 큐 제거. 현재 JS 재진입/foreground 재시도이며 무기한 백그라운드 보장 아님 |
| 로그아웃/다른 계정 로그인 | A 종료 대기 상태에서 B로 변경 | A 종료 요청이 B 자격증명으로 전송되지 않음. 재로그인 generation 불일치 시 전송 차단; 서버 TTL/소유권 취소·별도 복구 필요 |
| 앱 강제 종료/OS 재실행 | 활성 중 종료, 앱 재열기, 복구/종료 | checkpoint 격리·서버 재검증 전 추적 재개 금지, 출발 이벤트 중복 금지, 종료 의도 영속 보존 |
| 앱 만료 후 서버 ACTIVE 잔류 | 시험 서버 expiry opt-in ON에서 앱 종료 후 expiresAt+worker 간격까지 대기. 격리 60초/일반 600초 구분 | ARMED/ACTIVE→EXPIRED·endedAt·receipt 보존, 앱 요청 증가 없이 만료. cold 진입 자동 정리·추적/출발 중복 없음. TTL worker의 원격 END·운영 DB/process restart/새 로그인 세대는 별도 게이트. [검증](journey-server-expiry-validation-20261006.md) |
| 저장소 손상/쓰기 실패 | unit fixture로 invalid JSON/full queue/ACK 뒤 저장 실패 | STOP_OUTBOX_INVALID/FULL, 이전 binding 보존, 재시도 idempotent. 문제 기록을 조용히 삭제하지 않음 |
| APNs 토큰 미발급/권한 OFF | 허용 안 함·지원 안 되는 빌드·발급 지연 | 토큰 여부/Activity authorization/entitlement. 발급 대기를 실제 전달 성공으로 표시하지 않음 |
| APNs 인증/환경/topic 오류 | 개발 환경에서만 잘못된 설정/무효 시험 토큰 | provider reason과 retryability. bundle/topic/environment/project 구분, 자격증명/원문 토큰 로그 금지 |
| 서명/Keychain 불일치 | 실기기 개발 서명과 앱/확장 access group 비교 | native credential 접근 실패와 DEVELOPMENT fallback을 구분. unsigned 시뮬레이터의 Keychain 경고는 실기기 성공 증거가 아님. 문제 해결을 위해 제품 자격증명을 일반 저장소로 옮기지 않음 |
| APNs 수락했지만 카드 불변 | 잠금 후 식별 가능한 새 상태 UPDATE | provider receipt + 카드의 새 sequence/문구. 각각 증거 없으면 수신 미검증 유지 |
| 무음인데 음성/알림 둘 다 누락 | 실기기 Ring/Silent, 사용자 음성 OFF, 알림 거부·집중 모드 | 실제 청취·알림 표시·시각 안내 별도 확인. 물리 무음 자동 판독 성공 주장 금지; 알림 권한 없으면 화면 안내로 명시 |
| 전화/다른 오디오/이어폰 변경 | 발화 중 전화·오디오 중단·Bluetooth 분리 | TTS 시작/완료/취소, interruption 복구, 과거 revision 발화 금지. probe 완료 카운트는 가청 성공 증거 아님 |
| 최대 글자·긴 이름 잘림 | 최댓값 Dynamic Type, long-name/32-legs, 밝은 노선색 | 상세/축소/잠금 각각 육안 + AX + VoiceOver. 전체 이름·다음 행동·현재 행 읽힘, 색만으로 의미 전달 금지 |
| 위치 배터리/열/저전력 | 추후 실제 30~60분 노선 완주, 잠금/저전력 조건 | Instruments Energy/CPU·샘플 간격·갱신 횟수. 시뮬레이터로 배터리 수치 합격 판정 금지 |
| 경로 변경/환승 실패 | 서버 revision 변경·잘못된 하차·재탐색 | 새 revision 소유권 확인, 과거 GPS/음성/푸시 무효화, 새 경로 준비 전 잘못된 마커 제거. 현재 미지원 |

`secondaryAudioShouldBeSilencedHint`는 다른 앱의 nonmixable 오디오 재생 여부 힌트이지 물리 무음 스위치 판독 API가 아니다. 무음 분기를 그것으로 구현하지 않는다. [Apple 오디오 문서](https://developer.apple.com/documentation/avfaudio/avaudiosession/secondaryaudioshouldbesilencedhint).

## 5. 지금 바로 재현할 수 있는 독립 시뮬레이터 절차

최신 대상 UDID: `96AF9A48-4721-4335-B7BF-10B9382B7A30`, `NoLate R2 Session E2E 20261008` iOS 26.5.
Device Hub의 embedded 화면이 아닌 detached 창 이름·window ID·`Show in Device Hub`를 확인한다. 그 버튼을 누르지 않는다. 다른 사용자의 기기/시뮬레이터는 조작하지 않는다.

1. BE `authenticatedJourneyHarness`(loopback 15544, 실제 provider OFF, 합성 ride/alight/separation opt-in), dotenv 비활성 Metro를 띄운다. 내부 시험 화면만 사용한다.
2. `nolate:///internal/journey-guidance?authenticated=1&renewToken=1` 진입 → 검사·범위 동의·준비. 준비는 출발이 아니다.
3. `node scripts/qa/journey-final-walk-location-replay.mjs --device <UDID>`로 CoreSimulator 승객 GPS를 이동한다. 별도 fixture 시계가 합성 차량을 제공하며 phase 강제 주입/다음 단계 버튼을 쓰지 않는다. 실제 APNs opt-in은 이 절차에 추가하지 않는다.
4. ACTIVE·출발 1회·server activation 1회 확인. `GET http://127.0.0.1:15544/__fixture/state`는 토큰 없는 시험 카운터만 반환한다. `/context` 응답은 JWT를 포함하므로 터미널/증거 파일에 출력하지 않는다.
5. 기본 완주는 자동 도착 종료와 큐 0을 확인한다. 재시작/오프라인 종료 검사는 별도 실행에서 수행한다. 앱 재시작 → 복구하지 않고 종료 → 서버 ACTIVE/큐 1건 보존 → 다시 재시작/동일 인증 연결 → server STOPPED/큐 0건을 확인한다. 중간 fixture reset으로 불일치를 숨기지 않는다.
6. 긴 이름/32구간 표시는 별도 읽기 전용 fixture 시험이다. 상세·축소·잠금·큰 글자·stale 표시를 각각 검사하되 미지원 topology에 안내 준비를 요구하지 않는다. metadata fallback을 차량 진행 지원으로 해석하지 않는다.
7. 진단 화면 새로고침 전후 서버 카운터가 변하지 않고 위치/음성/푸시가 시작되지 않는지 확인한다.
8. 시험 종료, 서버 STOPPED, 종료 큐 0건을 확인한 뒤 GPS clear·font `large` 복원. 이번 시험 서버/Metro만 종료한다. `.env`, 실기기, 기존 미커밋 작업은 보존한다.

서버 상태를 비밀정보 없이 확인하는 명령:

```sh
node scripts/qa/journey-readiness-check.mjs --expect-stopped
node --test scripts/qa/journey-readiness-check.test.mjs
```

첫 명령은 고정된 loopback 시험 서버의 카운터만 읽는다. ACTIVE·불완전 응답·trap 요청이 있으면 exit 1, STOPPED/정상 카운터면 exit 0이다. 성공 출력에도 실제 APNs/운영 길안내는 `UNVERIFIED`로 남긴다. 운영 서버 상태 조회 도구가 아니다.

종료 큐는 같은 member/origin/login generation의 성공 receipt만으로 제거한다. 다른 계정/새 로그인 세대는 대신 전송하지 않는다. 그 때문에 오래된 종료 의도가 남으면 새 준비/복구를 차단할 수 있다. 로그인 세대 변경 뒤의 서버 권위 terminal 재조정은 **미구현**이며, 이 상황을 임의 큐 삭제나 client 시각 만료로 우회하지 않는다.

### 5.1 안내 채널 검사 추가 (2026-10-12)

준비 전에 내부 시험 화면에서 채널을 명시적으로 선택한다. 콜드 시작 OFF와 실행 중 변경 차단을
먼저 확인한다. OS 알림 권한을 자동 요청/변경하지 않는다. 시험 기기 사용 승인이 있을 때만
명시적 ‘시험 안내 알림 권한 요청’ 버튼을 누른다. 이 버튼은 remote token 등록과 분리돼 있다.
미요청은 `VOICE_QUEUED_PERMISSION_REQUIRED`, 거부는 `VOICE_QUEUED_NOTIFICATION_DENIED`로
구분한다(음성 없는 미허용은 `NOTIFICATION_PERMISSION_REQUIRED`).
실제 잠금 알림 표시는 UNVERIFIED로 남긴다. 10초 후 `NOTICE_EXPIRED`는 정상 만료다.

`OS 알림 설정`의 authorization/LOCK/ALERT 코드를 먼저 확인한다. `AUTHORIZED_LOCK_ON_ALERT_ON`도
실제 표시 증거가 아니다. 잠금 화면 표시·알림 센터·집중 모드·미리보기·요약 전달과
앱의 foreground notification delegate 처리를 구분해 확인한다. 시스템 설정 링크가 해결돼도
실제 앱 설정 페이지가 열렸는지 직접 확인한다(시뮬레이터에서는 기존 검색 화면에 남을 수 있다).
권한 재요청·토큰 재등록·Firebase 키 교체를 표시 문제의 자동 복구로 실행하지 않는다.

별도 회귀 사례로 **출발 전 ARMED에서 잠근다**. 로컬 모드의 전경 준비 카드는 ‘출발 대기’이며
출발 0/현재 위치 마커 없음/음성·알림 0이어야 한다. 이후 GPS 출발/서버 ACK로 도보 카드와
위치 마커가 나타나야 한다. 대기 lease를 GPS 최신성으로 쓰면 실패다. remote APNs pilot에는
이 로컬 대기 카드 규칙을 적용하지 않고 기존 ACTIVE 시작/원격 전용 UPDATE를 유지한다.

허용된 시험 기기에서는 한 정류장 전/근접/최종 도보마다 본문·표시 시각을 확인하고, 단계가
바뀌거나 위치가 만료되거나 안내가 종료되면 이전 안내 알림이 제거되는지 본다. 출발/승차 버튼으로
이벤트를 대신 만들지 않는다. 음성 큐 계수와 UN 알림 접수 계수는 실제 청취/표시와 별도 증거다.
locked 상태에서는 새 ambient 음성을 시작하지 않는 것이 현재 정책이다.

실기기 단계에서는 물리 무음 ON/OFF, 집중 모드, 잠금 알림 미리보기 설정, 알림/음성 OFF,
전화·다른 오디오·이어폰 변경, 발화 도중 종료/경로 변경을 각각 시험한다. 무음 스위치 자동 조회를
전제로 하지 않는다. 잠금 상태의 음성 내비게이션을 제공하려면 별도 사용자 선택·오디오 정책·
백그라운드 수명 구현과 실제 기기 검증을 먼저 완료해야 한다.

## 6. 현장 결과 기록 형식

### 위치 안내 준비에서 화면이 멈출 때 (2026-10-12 후속)

최신 시뮬레이터 시험에서는 준비의 전역 위치 서비스 조회와 진단 getter의 초기 권한
조회가 main-thread 동기 XPC에서 기다리는 두 경로를 샘플로 확인했다. 자동 runtime은
초기/변경 authorization delegate에서 값을 받아 cache하고 시작/화면 진단에 사용하도록
보강했다. 권한 값이 없으면 `CHECKING_PERMISSION`이며 허용을 추측하지 않는다.
이후 출발 전 잠금 GPS 완주 2회·로컬 안내 알림 실제 표시·콜드 큐 0을 확인했다.
이는 실기기 검증 완료가 아니다. [실패 이력과 화면 증거](journey-r52-loader-validation-20261012.md).

같은 증상이 실기기에서 나오면 권한을 무조건 다시 켜거나 추적 임계치를 바꾸지 않는다.
먼저 OS/빌드·마지막 상태·UI 반응·권한 callback 수신 여부를 기록하고, 개발용 디버거의
메인 스레드 stack에서 동기 시스템 조회 대기인지 확인한다. 원문 Console/좌표/토큰을
공유하지 말고 함수 경로와 고정 오류 코드만 남긴다. callback 지연, 실제 권한 거부,
GPS 표본 없음, 교통 API 장애는 서로 다른 결과로 분리한다. 공유 시뮬레이터 서비스
재시작은 다른 시험도 중단하므로 매번 범위를 조율하고 승인받는다. 기기 erase나 앱
데이터 삭제를 기본 복구 절차로 사용하지 않는다.

### 기록 항목

각 사례에 빌드 commit/dirty 기준, OS·기기 모델, 권한/무음/저전력/연결 상태, 합성/실제 공급자 구분, 기대 결과, 관측 시각/sequence, 서버 receipt·화면·청취 결과, PASS/FAIL/UNVERIFIED를 적는다.
개인 좌표/경로/토큰은 기본 기록에서 제외한다. 위치 표본 수집이 꼭 필요하면 사용자 동의·최소 범위·암호화·보존 기간·삭제 절차를 별도로 정한다. 전체 Console 로그를 그대로 올리지 않는다.

단일 시뮬레이터 실제 APNs UPDATE·온라인 위치 만료 제거/회복·앱 미실행 END의 독립 잠금 수신 및 동일 인증 세대 checkpoint의 자동 terminal 정리/조회 장애 회복은 확인했다. 오프라인 만료·운영 영속 소유권/회전/실제 망 역전·새 로그인 세대/장시간 안내 수명·실제 로그인 root 진입·VoiceOver·실기기는 별도 게이트다. P2 버스 완주·P3 지하철/환승·P4 재탐색·장시간 검증을 완료로 표시하지 않는다.

후속 [서버 TTL 검증](journey-server-expiry-validation-20261006.md)에서 앱 미실행 ARMED/ACTIVE 만료와 cold 자동 정리를 통과했다. 시험 바이너리와 loopback gate는 ON이며 source/운영 기본은 OFF다. 서버 worker를 실제 배포에 시험 적용할 때는 guidance/automatic/expiry 세 opt-in을 명시하고, default 10초 worker 간격/600초 수명 및 DB 부하를 확인한다. SIMULATOR 단축 수명은 격리 profile에서만 허용하고 DEVICE에는 적용하지 않는다. 플래그만으로 현재 DEBUG/simulator 전용 기능이 실기기 Release에서 지원되는 것은 아니다. TTL→durable remote END·실제 process restart·장시간 안내 수명 정책은 여전히 미완료다.

최신 [자동 END 시험](journey-expiry-auto-end-validation-20261006.md)은 메모리 test-source sender에서 자연 만료→실제 APNs END→독립 잠금 카드 제거를 2회 확인했다. 운영 TTL worker의 원격 전달·영속 token/outbox·서버 재시작 복원과 구분한다. 최종 provider 수락 11/실패 0/자동 END 2, STOPPED/큐 0이다.
