# R4-4b-2 — 서버 보행 HTTP·fresh DB 재검증

기준: 2026-10-12. 이 제한된 단계의 구현/자동 검사/독립 시뮬레이터 E2E를 완료했다.
R1–R6 전체나 네이버 지도 수준의 실제 내비게이션 완료 보고가 아니다.

## 구현 범위

- BE `TmapServerPedestrianProvider`: 목적지를 공식 HTTPS 보행 endpoint로 고정한다.
  임의 목적지 설정은 없고, internal 생성자의 127.0.0.1 HTTP만 socket 검사에 사용한다.
  appKey는 header에만 넣으며 URL/body/log에 넣지 않는다. 요청 형식은
  [TMAP 공식 보행 경로 문서](https://tmap-skopenapi.readme.io/reference/%EB%B3%B4%ED%96%89%EC%9E%90-%EA%B2%BD%EB%A1%9C%EC%95%88%EB%82%B4)의
  WGS84GEO req/res, sort=index, searchOption=0, URL-encoded startName/endName에 맞췄다.
- 연결 3초/헤더와 스트리밍 본문 전체 8초, 스트리밍 1MiB, 동시 2개/no queue.
  status 200만 수용하며 redirect/206/429/빈 본문/잘못된 UTF-8/인코딩/과대 본문을 차단한다.
  애플리케이션 재시도·cookie handler·TLS 우회는 없다. 취소 시 subscription/future를 끝내며
  서비스/fixture 종료 시 HTTP client를 종료한다. 실패 예외 원문/공급자 본문을 보존하지 않는다.
- `SavedJourneyWalkingCheckService`: off 기본값, 유효 actor/login 요구, 멤버별 single-flight와
  전체 동시 2개 제한. 공급자 호출 전후 같은 evidence를 fresh authority로 확인한다.
  첫 읽기에서 mutable JSON을 분리하며, 변경 시 조용한 재조회/재발급 없이 거절한다.
- `JpaWalkingRouteAuthority`: actor→schedule→personal-plan 순서의 짧은 별도 트랜잭션.
  READ_COMMITTED/5초, 명시 refresh와 최신 로그인·접근권한 검사를 수행한다. HTTP 동안 DB
  잠금을 잡지 않으며 ambient transaction이면 HTTP 전에 거절한다.
- 저장 개인 경로 helper: 실제 persisted version+1을 revision으로 사용하고 legacy/missing/
  deleted/범위 초과 입력을 거절한다. 스케줄/개인 경로 refresh 후 visibility를 다시 평가한다.
- `WalkingCheckConfiguration`: `journey.walking.enabled=true`일 때만 내부 bean을 만들며
  기존 `routing.tmap.app-key`를 backend에서 받는다. `journey.guidance.enabled`도 별도 준수한다.
  운영 기본 ON, 새 production endpoint, native allowlist 완화, schema 변경은 없다.
- FE: DEV-only 계약 검사에 명시적 HTTP 모드를 추가했다. 고정 loopback 시험 JWT와 요약만
  사용하며 자동 시작·실제 인증 저장소·형상 반환·native/GPS/APNs 연결이 없다. 모드 변경 및
  실패 시 이전 결과를 제거한다. `navigationReady=false`를 강제한다.

## 자동 검사

| 범위 | 최종 결과 |
| --- | --- |
| BE journey/transit/Live Activity + ScheduleTravelPlanServiceUnitTest | 62 suites / 458 PASS, 실패·오류·skip 0 |
| FE 전체 | 308 suites / 2,897 PASS |
| Node QA/diagnostics | 46 PASS |
| TypeScript / 양쪽 git diff --check | PASS |
| Swift/iOS 새 빌드 | 이번 미실행. 기존 R5-2 최종 simulator binary + 최신 Metro JS 사용 |

BE 이번 새 검사는 16개다: HTTP adapter 6, service 3, 실제 H2 authority 3,
configuration 2, 저장 경로 helper unit 2. 이전 416건과 이번 458건 차이에는 이번 검사
범위에 추가한 기존 schedule unit 26건도 포함되므로 42개 신규 검사로 계산하지 않는다.
FE는 이전 2,888건에서 9건 증가했다.

HTTP 검사는 실제 localhost socket을 통과하며 exact form/header·키 body 누출 없음·
redirect trap 0·status/고정 및 chunked 크기·header 및 slow-body timeout·UTF-8·동시 2개/
추가 요청 즉시 거절·permit 반환을 확인했다. timeout fixture는 350ms이며 운영 8초를 바꾸지 않는다.
기존 7개 계약 사례와 HTTP 6개를 수동 loopback matrix에서도 확인했고, 인증 누락/잘못된
시험 JWT는 HTTP 401이었다. 외부 API/실제 키 사용은 없다.

H2 검사는 실제 Member/PersonalPlan row와 EntityManager/transaction/lock을 사용한다.
OSIV처럼 오래된 persistence context를 의도적으로 재사용하고, 공급자 callback 동안
다른 thread의 변경 commit이 2초 이내에 끝남을 확인했다. 정상 통과, 로그인 철회 차단,
개인 경로 변경 차단을 검증했다. plan visibility loader는 대역이며 production helper는
별도 unit 검사다. 전체 MySQL/실제 visibility 경로 통합 성공으로 확대하지 않는다.

최초 targeted 실패는 H2 naming fixture·시험 owner/stub 설정을 보정했다. 이어 stale-version
엔티티가 refresh 전에 잠금 upgrade에서 실패하는 실제 경로를 발견했다. OSIV context를
임의로 clear/retry하지 않고 optimistic 실패를 `SAVED_ROUTE_CHANGED`로 차단하도록 수정했다.
최종 전체 범위를 다시 실행해 PASS했다. 실패 로그는 `/private/tmp/nolate-r44b2-authority-targeted*`
에 보존했고 최종 BE는 `/private/tmp/nolate-r44b2-be-final3-20261012.log`, FE는
`/private/tmp/nolate-r44b2-fe-full-20261012.log`다. 임시 로그는 영구 증거 파일이 아니다.

## 독립 화면 E2E

대상 `NoLate R2 Session E2E 20261008`, iOS 26.5,
UDID `96AF9A48-4721-4335-B7BF-10B9382B7A30`.
화면에 띄운 분리 창 `deviceWindow-AppWindow-1`을 직접 조작했다. 호스트 앱 이름은
Device Hub이지만 toolbar가 `Show in Device Hub`인 detached 창이며 embedded preview가 아니다.

이는 테스트 소스 서버·인공 좌표/키·메모리 authority·실제 loopback HTTP adapter의 진단 E2E다.
실제 DB 동시 변경은 앞의 별도 H2 자동 검사가 담당한다. 단계 전환 버튼이나 GPS 주입으로
실제 내비게이션을 완주한 시험이 아니다. 정상도 transit admission은 미완료다.

| 조작 | 실제 화면 결과 | 증거 |
| --- | --- | --- |
| HTTP 도보 연결 | TRANSIT_ADMISSION_PENDING, 도보 2/형상 6점/provider 2/재검증 2, 안내 OFF | [01](evidence/journey-r44b2-http-20261012/01-http-bound.png) |
| 조회 중 경로 변경 | SAVED_ROUTE_CHANGED, 도보/형상 0, 재검증 2 | [02](evidence/journey-r44b2-http-20261012/02-http-route-changed.png) |
| 조회 중 로그인 철회 | OWNER_CHANGED, 도보/형상 0, 재검증 2 | [03](evidence/journey-r44b2-http-20261012/03-http-login-revoked.png) |
| HTTP redirect | PROVIDER_UNAVAILABLE, provider/재검증 1, trap 0 | [04](evidence/journey-r44b2-http-20261012/04-http-redirect-blocked.png) |
| 본문 크기 초과 | PROVIDER_UNAVAILABLE, 도보/형상 0 | [05](evidence/journey-r44b2-http-20261012/05-http-body-limit-blocked.png) |
| 본문 응답 지연 | PROVIDER_UNAVAILABLE, 도보/형상 0 | [06](evidence/journey-r44b2-http-20261012/06-http-body-timeout-blocked.png) |
| 정상 재확인→시험 서버 종료→재검사 | 서버 검사 불가·안내 차단, 이전 성공/형상 요약 제거 | [07](evidence/journey-r44b2-http-20261012/07-http-server-unavailable.png) |

readiness에서 prepare/departure/activation/cancel/arrival/refresh/안내 push/trap은 0,
real provider=false였다. 해당 counter는 이 계약 진단의 HTTP 요청 횟수를 세지 않는다.
APNs/productionNavigation은 UNVERIFIED다. 시험 앱 종료 후 독립 창 홈 복귀를 확인했다.
이번 프로세스로 확인한 8088 Metro/15544·15545 harness만 종료했고 다른 시뮬레이터는 건드리지 않았다.

## 미연결 조건과 다음 단계

1. 서버 소유 mixed-provider snapshot 영속 저장, TTL/revision 및 교체·취소·재시작 정책,
   제품 인증 API와 FE/native admission schema를 연결한다. 현재 snapshot은 검사 후 요약만
   반환하며 저장/발급 endpoint나 native 소비자가 없다.
2. 실제 저장 ODsay tuple/형상과 서울 catalog/도로 section/실시간 차량 매핑을 검증한다.
   아직 이름/속도만으로 탑승하지 않으며 기존 정적 catalog 매핑 성공과 구분한다.
3. 승인된 실제 TMAP HTTPS 호출로 인증/할당량/응답 호환성을 별도 확인한다. 이번 socket
   검사로 실제 TLS/서비스 키 유효성/공급자 데이터 품질이 입증되지는 않는다.
4. R6 지하철 방면·열차·터널 GPS 불확실성/환승, 제품 설정·전체 접근성·실기기/현장 GPS를 완료한다.

`.env` 값은 읽거나 수정/출력하지 않았다. 커밋/push/배포/운영 ON/실기기 설정 변경과
실제 API/APNs 신규 전송은 없다. source native는 변경하지 않았고 main Info.plist SHA-256은
`7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`로 유지됐다.
