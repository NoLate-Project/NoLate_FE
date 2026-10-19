# 대중교통 길안내 — 이전 상태 보고 이력

2026-10-13 정리 전 원문 보존. 아래의 “최신”과 미완료 항목에는 서로 다른 시점이 섞여 있다.
[현재 상태](journey-navigation-status-20261012.md)를 완료 판정의 기준으로 사용한다.

기준: 2026-10-13 (10/12 시작 검증의 후속). 요청한 네이버 지도 수준의 실제 대중교통 내비게이션/R1–R6 전체 완료를
의미하지 않는다. 검증된 구현과 미완료·미검증 조건을 분리한다.

운영 DB 최신 상태(10/13): `late_project`에 길안내 migration **5개 실제 적용 PASS**.
운영 백업·네트워크 격리 복원·기존 테이블 행 수·최종 marker/열 수를 검증했다.
백엔드는 정상 종료 후 유지했고 배포/운영 ON/API·APNs 재시험은 하지 않았다.
과거 DB 미적용 기록은 현재 상태가 아니다.
[운영 실제 적용 기록·영구 백업 위치](journey-production-migration-20261013.md).

최신 5구간 후속: 다중 도보·다음 버스의 독립 admission/차량 결합과 현재 occurrence의 ETA(v7)를
연결했다. BE 관련 595·FE 전체 3,049·Swift 365·타입/iOS Debug build PASS.
독립 창 5차 합성 GPS E2E에서 첫 탑승/분리→환승 승차점→다음 버스 약 110초 ETA→
두 번째 탑승/하차 준비→최종 도보 30m/10m→잠금 Activity→자동 도착/카드 제거/종료 대기 0을
확인했다. 1~3차 실패와 4차 중간 화면 누락은 보존했다. 진행 중 신규 연결 만료 문구를
잘못 표시하는 결함은 수정했고 focused 15건 PASS, 수정 후 전체 FE **317 suites/3,051 PASS**,
타입 PASS. 6차 독립 GPS/잠금 재시험에서도 300초 이후 두 번째 탑승/오류 문구 없음→
잠금 최종 도보 30m/마지막 마커→자동 도착/카드 제거/종료 대기 0을 확인했다.
전체 제품 상세 지도·실제 GPS·새 APNs 전달 성공으로 계산하지 않는다. 해당 GPS 시험 당시에는
DB DDL 미실행이었으며 현재는 위 운영 실제 적용 기록이 우선한다. 아래 수치는 각 과거 단계의 기록이다.
[최신 증거·실패 이력](journey-transfer-walk-validation-20261012.md).

후속 환승 도보: 첫 버스의 같은 차량 분리 증거→연속 도보→다음 승차점 도달을 native
세션에 연결하고 v5 상세/Activity 마커·거리/승차점 이름·한 번의 환승 안내 정책을 추가했다.
환승 승차점 도달은 전체 도착/다음 차량 탑승으로 처리하지 않는다. 다음 구간 독립 admission,
지하철 승객 결합과 새 5구간 GPS/잠금 E2E는 아직 남아 전체 완료가 아니다.
최신 자동 검사 BE 76 suites/582·FE 316 suites/3,020·Swift 360·TypeScript/iOS Debug build PASS.
[환승 후속 검증](journey-transfer-walk-validation-20261012.md).

최신 R6-1: 지하철 열차 HTTP/파서·역 참조와 저장 경로 조회 전후 소유권 재검증을 추가했다.
공식 역/운행 순서 crosswalk·사용자 탑승 결합·native/환승 소비자는 미완료다. 열차 위치를
승객 위치로 출력하지 않는다. TypeScript PASS. 초기 MySQL readiness timeout 1·기존 달력
timeout 2 기록을 유지하며 순차 재실행 BE 74 suites/567·FE 313 suites/2,983 전체 PASS다.
후속 원본 ODsay 역/lane/방면 보존·서버 대조와 개발 진단 경로 등록 결함을 수정했다.
최신 BE 75 suites/579·FE 315 suites/3,003 전체 PASS, TypeScript PASS다.
중간 컴파일/테스트 작성 오류와 기존 달력 timeout 기록은 유지한다. 초기 UI timeout 뒤
후속 독립 창에서 10사례와 단절 시 이전 결과 제거를 AX/화면 확인했다.
개인 키 API/APNs 0회·공개 sample 1회(정상 목록 없음)·공유 DB DDL 미실행이다.
[새 구현·실패 기록·R6 남은 조건](journey-r6-subway-observation-validation-20261012.md).

최신 R4-4b-4: 서버 도보 계약을 공용 상세 UI·native GPS·로컬 Activity에 연결했다.
독립 창에서 GPS 자동 출발/도보 60m·위치 마커·잠금 표시·취소/통신 단절 시 제거를 확인했다.
전체 이동 두 번의 만료 실패 뒤 전경 및 출발 전 잠금 완주가 각각 통과했고,
자동 도착/Activity 제거/종료 대기 0을 확인했다. 전경 동기화·정상 종료 연결 제거도 보강했다.
BE 관련 69 suites/515·FE 311 suites/2,953·Swift 349·Node 60·타입/iOS 빌드 PASS.
격리 MySQL 5개 migration/합성 전체 백업 복원 PASS. 공유 DB는 API·worker 중지 완료 확인 대기이며 DDL 미실행이다.
전체 BE 무제한 실행은 heap/별도 DB fixture 실패로 PASS가 아니다. 실제 API/APNs 신규 전송
0회, 운영 OFF/simulator-only 유지. 실제 공급자/차량 연결·R6·제품 설정·현장 시험은 남는다.
[이번 구현·검사·GPS/잠금 증거·남은 조건](journey-r44b4-mixed-validation-20261012.md).

이전 R4-4b-3: 도보 snapshot 영속 저장·발급/재조회/취소 인증 API·FE 소비 계약을 구현했다.
재조회는 TTL 연장/공급자 호출이 없고 교체된 경로의 이전 취소를 차단한다. 만료·탈퇴 정리,
generation 0 신규 계정 검사도 보강했다. BE 67 suites / 505건·FE 310 suites / 2,932건,
Node QA/진단/compat/metrics 58건·타입 검사 PASS. 독립 창 8사례 및 서버 재시작 후 동일
계약·TTL/공급자 신규 호출 0회를 확인했다. 실제 키/API/APNs·운영 DB 변경은 없다.
운영 기본 OFF. 새 수동 migration/필수 marker를 추가했으므로 배포 전 별도 적용 검증이 필요하다.
실제 상세 화면/native mixed-provider admission은 아직 연결하지 않았다.
[이번 구현·영속/탈퇴 검사·E2E·배포 게이트](journey-r44b3-snapshot-validation-20261012.md).

이전 R4-4b-2: 고정 HTTPS 보행 HTTP 어댑터와 내부 검사 서비스, 공급자 조회 전후의 fresh
DB/로그인 재검증을 구현했다. HTTP 동안 DB 잠금은 해제하며 OSIV stale-version 잠금 실패를
안전하게 차단했다. BE 62 suites / 458건·FE 308 suites / 2,897건·QA 46건·타입 검사 PASS.
독립 창의 로컬 HTTP 합성 공급자 6사례와 서버 중단 1사례를 통과했다. 실제 H2 동시 변경
검사는 별도이며 화면의 authority는 메모리 대역이다. 실제 HTTPS/키/API/APNs 전송은 없다.
운영 기본 OFF이며 제품 API/영속 snapshot/native mixed-provider admission은 아직 없다.
[이번 구현·검사·E2E·미연결 조건](journey-r44b2-http-authority-validation-20261012.md).

이전 R4-4b-1: 서버 소유 저장 경로의 두 도보 tuple을 별도 provider 원본에 묶는 계약을
구현했다. 소유자/login/revision/fingerprint/TTL과 전체 원본 검사를 추가했으며 아직
운영 HTTP adapter/실제 서비스·영속 snapshot/native mixed-provider 연결은 없다.
BE 57 suites / 416건·FE 308 suites / 2,888건·QA 46건·타입 검사 PASS.
독립 창에서 정상 및 6가지 거부/서버 중단 시 이전 성공 제거를 확인했다. 이번 GPS/APNs
완주 시험은 아니며 source native/Info.plist 변경·새 iOS 빌드도 없다.
[이번 구현·검사·E2E·미연결 조건](journey-r44b-server-contract-validation-20261012.md).

최신 후속: 승인 후 공유 시뮬레이터 서비스를 복구하고 위치 시작/진단의 main-thread 동기
권한 조회 멈춤을 callback 값 cache로 수정했다. 최종 빌드에서 출발 전 잠금 GPS 완주
2회·자동 도착/큐 0·콜드 IDLE/OFF를 확인했고 별도 로컬 안내 알림의 실제 잠금 표시도
확인했다. FE 306 suites / 2,861건·Swift 342건·QA 46건·타입 검사·iOS 빌드 PASS.
실제 API/APNs 신규 호출은 0회이며 전체 제품 내비게이션 완료는 아니다.
[R5-2 변경·실패 이력·최종 E2E 증거](journey-r52-loader-validation-20261012.md).

## 이번에 구현·수정한 항목

- 명시적인 시험 알림 권한/채널 선택 UI, 중복 요청 및 실행 중 변경 차단.
- 미요청/거부 권한 상태 분리와 OS authorization/잠금/alert 설정 진단.
- 합성 버스 도착정보와 저장 경로의 노선 ID 불일치 수정, 도착 차량과 탑승 증거 차량 분리 유지.
- 출발 전 잠금 시 Activity 시작 실패 수정: 전경 준비 시 로컬 ‘출발 대기’ 카드,
  GPS 출발 후 같은 카드 갱신. 준비는 출발/탑승 확정이 아니며 위치 마커·알림이 없다.
- 만료/조작된 준비 입력 차단, ACTIVE GPS TTL 15초 유지, remote pilot의 로컬 UPDATE 차단 유지.
- 실제 기기 오류 재현·확인 절차 및 로드맵 갱신.
- 추가 승인 공식 7016 HTTP 2회 조회와 공개 형상만 보존하는 비식별 진단/오프라인 replay.
- 선택 밖 긴 통과 구간을 버리지 않는 interval 순서 검사, 선택 44~48번 유일 매핑 보강.
- 내부 시험 화면에 승차 후보·GPS 오차 진단 추가와 굽은 구간 합성 회귀 fixture 추가.
- 초기/변경 위치 권한 callback에서만 값을 수신하고 시작/진단은 cache를 사용해 UI 동기 조회 방지.

## 검사 결과

| 범위 | 결과 |
| --- | --- |
| FE 전체 (최신 R6-1) | 315 suites / 3,003 PASS. 중간 작성 오류/달력 timeout 기록 보존 후 최종 재실행 |
| Swift 전체 (최신) | 349 PASS |
| BE journey/transit/Live Activity + schedule unit + schema guard + 탈퇴 통합 (최신 R6-1) | 75 suites / 579 PASS, 실패·오류·skip 0. 초기 MySQL timeout/후속 fixture 컴파일 오류 기록 보존 |
| Node QA/diagnostics + simulator compat/metrics (최신) | 60 PASS, 범위 확장 |
| 최신 mixed 계약 전체 GPS E2E | 초기 2회 EXPIRED 보존. 전경 1회 및 출발 전 잠금 1회 자동 도착/카드 제거/종료 대기 0 PASS. 합성 차량·보행·authority |
| TypeScript / iOS Debug simulator build (최신) | PASS |
| 이번 서버 HTTP 계약 독립 창 E2E | 정상·경로 변경·로그인 철회·redirect·과대 본문·지연·서버 중단 7사례 PASS. 합성/진단 전용 |
| 최신 서버 저장 계약 독립 창 E2E | 저장·서버 재시작 복원·교체·취소·revision·로그인·만료·연결 실패 8사례 PASS. H2/합성 authority/loopback 공급자 |
| 이전 승인 후 독립 창 GPS 완주 | 3회 자동 출발·탑승·최종 도보·도착 종료, 각 종료 큐 0 |
| 이번 굽은 구간 합성 E2E | 첫 탑승 실패 1회 보존, 재시험 자동 탑승→잠금 최종 도보→자동 도착·큐 0 PASS |
| 출발 전 잠금 Activity | 초기 실패 수정 후 두 완주에서 갱신·도착 제거 확인 |
| 최신 출발 전 잠금 GPS | 최종 빌드 2회 자동 도착 종료·각 큐 0, 두 번째 최종 도보 60m→10m 캡처 |
| 별도 안내 알림 실제 잠금 표시 | 합성 버스 2분 도착 예상 로컬 알림 실제 표시·이후 제거 확인. 각 접수 이벤트/독립 TTL 원인 분리 미완료 |
| 실제 7016 API | 추가 승인 HTTP 2회 성공, 수정 후 오프라인 44~48번 유일 정적 매핑 PASS |
| 실제 APNs | 이번 전송 0건. 이전 R4-2 원격 UPDATE/END 결과와 구분 |
| 실기기/현장 GPS·무음·배터리 | 사용자 지정에 따라 미실행 |

단계 버튼이 아니라 CoreLocation 합성 좌표와 별도 시계의 합성 차량으로 시험했다.
최종 빌드 완주 후 STOPPED/목적지 도착·오류 없음·출발 1/알림 접수 5/음성 큐 0/
종료 대기 0/남은 기록 없음을 확인했다. 콜드 재시작에서는 IDLE/OFF/계수 0/종료 큐 0이었다.
OS는 `AUTHORIZED_LOCK_ON_ALERT_ON`이었다. 최신 후속에서 별도 로컬 알림 표시를 확인했으나
접수된 모든 이벤트의 표시·청취나 실제 APNs 전달로 확대하지 않는다.

## 남은 완료 조건

1. 실제 7016 정류장 106개/형상 1,693점에서 44~48번 정적 매핑은 보강·통과했다.
   실제 저장 ODsay 원본 tuple/형상·도로 section·실시간 차량/탑승 연결 검증은 아직 필요하다.
2. 혼합 공급자 도보 계약/HTTP/fresh DB fence와 단기 영속 snapshot·인증 API·FE 계약은
   R4-4b-4까지 구현하고 공용 상세 UI/FE/native 및 취소 종료에 연결했다. 실제 공급자
   HTTPS/키/할당량·공유 MySQL migration/전체 visibility 통합·실제 차량 연결은 남아 있다.
3. R6 열차 HTTP/파서·역 참조·저장 경로 재검증 경계는 부분 구현했다. 실제 역/운행 순서
   crosswalk·사용자 탑승 결합·터널 GPS 단절 처리·환승 도보/다음 구간 연결 및 UI E2E는 남는다.
4. 안내 이벤트 각각의 표시·청취, 독립 TTL 만료와 phase 취소의 원인 분리 검증.
5. 사용자 제품 설정·실기기 실행 경로, 전체 접근성, 실제 로그인/지도 연결 및 현장 시험.
6. 더 넓은 입력·부하에서 조기 잠금 재현 안정성. 최신 최종 빌드는 출발 전 잠금 완주를
   두 번 통과했지만 이전 실패의 모든 원인이 규명됐거나 현장 안정성이 검증된 것은 아니다.

현재 자동 runtime/안내 채널은 Debug simulator-only이며 운영 기본 OFF다.
이 제한을 제거하거나 합성 입력을 실제 운영 안내 성공으로 표시하지 않는다.

## 추가 조회 승인 처리 결과

최초 2회 승인 소모 후 사용자에게 새 승인을 받았고, 공식 `ws.bus.go.kr`의
`getStaionByRoute`/`getRoutePath` 각 1회, 총 2회 추가 조회를 완료했다. HTTP 평문 키 전송의
위험을 명시한 범위에서만 실행했고 재시도·리다이렉트·키/URL 출력은 없었다.
추가 2회 승인도 소모됐다. 이후 수정/검증은 공개 노선 형상·순서만 남긴 owner-only 임시
진단 자료를 이용했으며 추가 실제 요청은 0회다. 사람 GPS/차량/원문/실제 식별자/이름/키는
그 자료에 없다. 전체 catalog의 선택 밖 번호 오류 1개는 실패 분류를 그대로 유지한다.
[형상 매핑 수정·검사·E2E 기록](journey-r1-catalog-validation-20261012.md)을 참고한다.

자세한 실행 이력·화면 증거는 [R5 검증 기록](journey-r5-notices-validation-20261012.md),
우선순위/후속 단계는 [로드맵](journey-guidance-roadmap.md), 현장 오류 확인 절차는
[실기기 검증 runbook](journey-device-validation-runbook.md)을 따른다.

`.env` 변경/커밋·push·배포·운영 ON·실기기 설정 변경은 하지 않았다.
시험 빌드용 Info.plist는 기존 SHA-256
`7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`로 복구했다.
이전 R4-4b-3는 GPS를 주입하지 않았고 종료한 시험 서버를 최신 R4-4b-4에서 재기동해
합성 GPS를 주입했다. 별도 합성 H2 자료는 owner-only 임시 디렉터리에 보존했다.
