# R4-4b-3 — 서버 도보 snapshot 영속 저장·앱 계약

기준: 2026-10-12. 이 단계의 구현/자동 검사/독립 화면 E2E를 완료했다.
전체 내비게이션/R1–R6 또는 실기기 완료가 아니다. 정상 응답도 `navigationReady=false`다.

## 구현

- BE `JourneyWalkingSnapshot`/repository: `(member,schedule)`당 한 개의 단기 계획 도보 경로.
  별도 opaque ID·version·만료 epoch ms·strict 서버 JSON만 보관한다. 실제 GPS/공급자 원문/
  API key/JWT/APNs token은 보관하지 않는다. 저장 ODsay 경로 형상은 덮어쓰지 않는다.
- `WalkingSnapshotCodec`: 512KiB/도보 두 구간(index 0,2)/각 2~2,000점·WGS84·인접 150m/
  중복·identity 수치·fingerprint·schema/중복 JSON key·300초 TTL을 검사한다. 손상은 안전한
  `STORED_SNAPSHOT_INVALID`만 반환하며 cause/원문을 첨부하지 않는다. DB는 서버 신뢰 경계이며
  이 형식은 클라이언트 발급 receipt/HMAC/native admission 토큰이 아니다.
- `SavedJourneyWalkingSnapshotService`: 기존 checker의 두 번째 fresh authority fence 안에서
  검증한 snapshot만 저장한다. HTTP 동안 DB 잠금을 잡지 않는 기존 경계는 유지한다.
  클라이언트 expectedRevision이 다르면 HTTP 전에 거절한다. 부분 pair/변경된 evidence는 저장하지 않는다.
- 현재 경로 읽기는 fresh authority/로그인/접근권한/revision/fingerprint/TTL을 다시 확인한다.
  공급자 호출·자동 재발급·TTL 연장이 없다. 교체는 새 UUID, 지연된 이전 ID 취소는
  `SNAPSHOT_REPLACED`; 현재 취소는 물리 삭제하고 반복 취소는 안전하게 끝낸다.
- `JourneyWalkingSnapshotController`: 조건부 인증 POST/GET/DELETE
  `/api/schedules/{scheduleId}/walking-snapshot`. POST는 `expectedRevision`만 사용한다.
  principal은 기존 security pipeline에서 받으며 서비스가 최신 login/권한을 재검증한다.
  응답은 `Cache-Control:no-store`; ID 자체가 읽기 권한은 아니다.
- `WalkingSnapshotConfiguration`: 별도 `journey.walking.snapshots-enabled=true` opt-in.
  기존 walking checker 설정과 guidance flag도 필요하다. 기본 OFF이며 이번에 변경하지 않았다.
- 만료 이후 읽기는 즉시 거절한다. `WalkingSnapshotRetention`은 runtime OFF 후에도 기본
  60초마다 만료 row를 삭제한다. DB/worker 장애 시 물리 정리 지연은 별도 운영 관측이 필요하다.
  탈퇴 cleanup에 본인/소유 일정 snapshot 삭제를 추가했다.
- 기존 factory/checker의 `login<=0` 제한은 신규 계정 generation 0을 잘못 막았다. 기존
  인증 계약에 맞춰 0을 수용하고 음수/초과/현재 generation 불일치는 계속 거절한다.
- FE `serverWalkingSnapshot.ts`: 별도 형상/출처 계약 파서 및 명시적인 인증 API consumer.
  member/schedule/login/revision/fingerprint/TTL/형상·source·navigation false를 검사한다.
  요청 전후·본문 수신 후 authentication source를 재검증한다. redirect/cookie/retry/native
  write가 없고 발급 body에는 revision만 있다. 재조회/취소는 형상 업로드를 하지 않는다.
- 내부 화면 `서버 저장 검사로 전환`: 명시 조작만 실행, single-flight, pending/실패 때
  이전 결과 제거. 좌표/ID/토큰은 표시하지 않고 형상 개수와 안전한 이유만 표시한다.

## 검사 결과와 범위

| 검사 | 최종 결과 |
| --- | --- |
| BE journey/transit/Live Activity + schedule unit + schema guard + 탈퇴 통합 | 67 suites / 505 PASS, 실패·오류·skip 0 |
| FE 전체 | 310 suites / 2,932 PASS |
| Node QA/diagnostics + xcode compat/metrics | 58 PASS, 실패·skip 0 |
| TypeScript / 양쪽 git diff --check | PASS |
| Swift/iOS 새 빌드 | 이번 미실행. R5-2 최종 simulator binary + 최신 Metro JS 사용 |

BE 신규 검사는 14건이다: 저장/codec 9, controller 1, configuration 2,
실제 JPA authority+저장 조합 1, migration guard 1. 이전 458건→505건에는 이번 범위에
추가된 기존 guard 23·탈퇴 통합 10건도 포함한다. 탈퇴 기존 두 사례에 snapshot 삭제
검증을 보강했다. FE 신규 parser/API 33·화면 2건이며 2,897→2,932다.
Node는 이전 46건보다 범위를 넓혔으며 증가분 전체를 새 기능 검사로 세지 않는다.

주요 검사: 실제 H2 파일 close/reopen 뒤 정확한 계약/TTL 복원·공급자 재조회 0,
교체/지연 취소/반복 취소, TTL 경계·시계 역행·login/revision/원본/visibility 거절,
손상 JSON·metadata·중복 key/잘못된 schema·단절 형상 차단, 실패 pair 미저장,
만료 physical purge 및 owner/schedule cleanup. 실제 Member/PersonalPlan/JPA authority와
새 저장 repository의 같은 post-fetch 트랜잭션 조합도 검증했다. production plan loader는
대역이며 전체 실제 visibility/MySQL 트랜잭션 통합 검증은 아니다.

실제 controller를 통과하는 MockMvc에 시험 issuer 인증을 사용해 무인증 401,
정상 발급/재조회 no-store/navigation false, revision 409/login 철회 403/취소 후 404를 확인했다.
FE는 인증 교체가 header 수신 중/본문 수신 중 발생하는 경우, 잘못된 출처·범위·TTL·
응답 크기/JSON/redirect/알 수 없는 private error를 검사했다. raw body가 UI 오류로 전파되지 않는다.

최초 controller 테스트는 H2 memory DB가 마지막 connection close 때 사라지는 fixture
설정으로 500이 발생했다. 인증 누락 검사는 이미 401로 통과했고 정상 저장에서 실패한 것이었다.
DB_CLOSE_DELAY를 시험 fixture에 추가한 뒤 최종 전체 검사 PASS다. 최초 타입 검사에서는
RN RequestInit redirect 확장 타입·null narrowing 및 test Buffer import를 보완했다.
정책/인증/형상 한도를 완화하지 않았다.

최종 로그: `/private/tmp/nolate-r44b3-be-final3-20261012.log`,
`/private/tmp/nolate-r44b3-fe-final-20261012.log`,
`/private/tmp/nolate-r44b3-types-final2-20261012.log`,
`/private/tmp/nolate-r44b3-qa-final-20261012.log`.
최초 실패도 별도 targeted/types 로그에 보존했다. 임시 로그는 영구 증거 보관소가 아니다.

## 독립 시뮬레이터 E2E

대상 `NoLate R2 Session E2E 20261008`, iOS 26.5,
UDID `96AF9A48-4721-4335-B7BF-10B9382B7A30`.
`deviceWindow-AppWindow-1`의 detached 화면을 직접 조작했다. 호스트 앱 이름은 Device Hub이나
toolbar가 `Show in Device Hub`인 독립 분리 창이며 embedded preview를 사용하지 않았다.

새 test-source `walkingSnapshotHarness`만 127.0.0.1:15546에서 실행했다. 실제 controller/
service/JPA repository/H2 파일과 localhost HTTP 공급자를 통과한다. 인증 issuer·저장 경로/
authority·좌표/공급자 키는 합성이다. 화면의 ‘실제 저장 API’는 이 로컬 API이며 실제 외부
TMAP/ODsay/서울 API를 호출했다는 의미가 아니다. expire는 시험 시계 +301초로 재현했다.
운영 retention scheduler를 이 harness에서 실행하지 않으며 physical purge는 별도 자동 검사다.

| 사례 | 화면/관측 결과 | 증거 |
| --- | --- | --- |
| 서버에 도보 저장 | SAVED, 도보 2/형상 6점 | [01](evidence/journey-r44b3-store-20261012/01-stored.png) |
| 서버 종료→같은 H2로 재시작→저장 경로 읽기 | RELOADED, 동일 계약/TTL·공급자 호출 0 | [02](evidence/journey-r44b3-store-20261012/02-reloaded-after-server-restart.png) |
| 교체 후 이전 ID 취소 | REPLACEMENT_PROTECTED, 새 도보 2/6점 유지 | [03](evidence/journey-r44b3-store-20261012/03-replacement-protected.png) |
| 취소 후 읽기 | SNAPSHOT_NOT_FOUND, 도보/형상 0 | [04](evidence/journey-r44b3-store-20261012/04-cancelled.png) |
| 저장 후 revision 변경 | REVISION_CHANGED, 도보/형상 0 | [05](evidence/journey-r44b3-store-20261012/05-revision-changed.png) |
| 저장 후 login 철회 | OWNER_CHANGED, 도보/형상 0 | [06](evidence/journey-r44b3-store-20261012/06-login-revoked.png) |
| 저장 TTL 만료 | EXPIRED, 도보/형상 0 | [07](evidence/journey-r44b3-store-20261012/07-expired.png) |
| 새 정상 저장→서버 중단→재조회 | 서버 저장 검사 불가·안내 차단, 이전 성공/형상 개수 제거 | [08](evidence/journey-r44b3-store-20261012/08-server-unavailable.png) |

재시작 전후 계약 전체의 SHA-256 비교가 같고 issuedAt/expiresAt도 같았다. ID/좌표/JWT는
출력하지 않았다. 전에는 provider 2회/row 1, 재시작 뒤에는 provider 0회/row 1이었다.
마지막 codec 검토에서 큰 정수의 schema/index overflow와 epoch 범위도 거절하도록 보강했다.
동일 505건 전체 범위를 재실행해 PASS했고 최종 코드의 독립 창 정상 저장/재조회도 다시 확인했다:
[최종 저장](evidence/journey-r44b3-store-20261012/09-final-code-stored.png),
[최종 재조회](evidence/journey-r44b3-store-20261012/10-final-code-reloaded.png).
모든 성공 화면도 자동 길안내 OFF다. 이번 GPS 주입·잠금 Live Activity/APNs E2E는 아니다.
다른 기기/공유 서비스는 건드리지 않았다. 시험 앱 종료 후 홈 복귀를 확인했고 이번
8088 Metro/15546 harness 및 내부 ephemeral 공급자 socket을 종료했다.
합성 DB는 `/private/tmp/nolate-walking-e2e-2A3wak`(owner-only 디렉터리)에 재현용으로 보존했다.

## 배포와 남은 단계

새 MySQL migration은 BE `docs/schedule/migrations/2026-10-12-journey-walking-snapshots.sql`이다.
precondition/새 table·unique·expiry index/postcondition 뒤 필수 marker를 기록한다.
`ProductionSchemaVersionGuard`는 feature OFF여도 이 marker를 요구한다. **실제 DB에는
적용하지 않았다.** 배포 전 API/worker 중지·백업·검토된 수동 적용·MySQL schema 및
cleanup 검증이 필요하다. H2 PASS/SQL source 검사는 MySQL migration 실행 성공이 아니다.
불완전 migration을 자동 재시도하거나 테이블/marker를 임의로 drop하지 않는다.

다음은 별도 mixed-provider 계약을 실제 상세 화면과 native 소비/교체/종료 경계에 연결하는
R4-4b-4다. 기존 ODsay geometry/provenance나 native WALK_STEPS 허용 목록을 위장해
재사용하지 않는다. 실제 ODsay tuple/버스 catalog/도로 section/차량 동행 연결, 승인된
공급자 HTTPS/키/할당량, R6 지하철·환승·터널 불확실성, 제품 설정·접근성·현장 GPS는 남는다.
소비 시점의 fresh 검증/활성 세션 종료 정책 없이 현재 DTO만 native에 넘기지 않는다.
발급 POST는 매번 새 pair를 조회하며 자동 재시도하지 않는다. 운영 enablement 전에는
계정별 발급 rate/quota·idempotency 및 네트워크 응답 유실의 재조회 복구 정책도 검증해야 한다.

`.env` 읽기/변경·커밋/push·배포·운영 ON·실기기 변경·실제 키/API/APNs 전송은 없다.
source native/Info.plist는 변경하지 않았고 main Info.plist SHA-256은
`7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`로 유지됐다.
