# R4-4b-1 서버 소유 도보 계약 — 구현·검증 기록

기준: 2026-10-12. **계약 기반 slice 완료이며 실제 혼합 공급자 길안내 연결 완료는 아니다.**
운영 기본 OFF, 실제 공급자/APNs 호출 0회, 실기기 변경 0회다.

## 구현 범위

BE `ServerOwnedWalkingSnapshotFactory`가 서버가 읽은 본인 저장 ODsay WALK-BUS-WALK의
첫·마지막 도보를 별도 `ServerPedestrianProvider` 포트로 요청한다. 클라이언트가 전달한
형상·출처·receipt를 받아서 신뢰하는 API는 추가하지 않았다. 운영 HTTP adapter/endpoint도
아직 연결하지 않았다. 현재 호출자는 test-source-only harness/단위 검사다.

- 일정/소유자·로그인 세대·revision을 묶고 저장 경로 전체 fingerprint를 보존한다.
- 저장 origin→첫 도보→버스→마지막 도보→destination의 원본 요청 tuple을 정확히 비교한다.
  이름/근접 비교, 순서 정렬·역전, 연결선 삽입으로 누락을 보완하지 않는다.
- 서버 adapter의 원본 WGS84/index FeatureCollection을 별도로 파싱한다. 중복 JSON 키,
  후행 JSON, 잘못된 좌표·순서·형상 단절·150m 초과 segment·30m 초과 endpoint 차이,
  1MiB/4,096 features/2,000 raw line points 제한을 검사한다.
- 두 도보 모두 통과해야 객체를 발급한다. 한 구간 실패 시 부분 발급하지 않는다.
  전체 취득 30초 deadline/시계 역행을 거부하고 최초 발급 기준 300초에 만료한다.
  이 deadline은 **동기 HTTP 작업 자체를 취소하는 기능이 아니므로** 후속 HTTP adapter는
  자체 timeout/body bound/redirect 차단을 구현해야 한다.
- 재사용 시 서버에서 새로 읽은 plan·현재 로그인·revision·시각을 다시 확인해야 한다.
  현재 factory의 발급 후 비교는 전달된 JsonNode 변경을 검출하며 DB 동시 수정/로그인
  철회를 자동 조회하지 않는다. 이를 보장하는 실제 서비스/짧은 트랜잭션 연결은 남아 있다.
- 저장 ODsay 형상/출처와 `geometryInputComplete`를 덮어쓰지 않는다. 반환 path는 복사해
  내부 보존 자료의 사후 변조를 차단한다. 이 서버 메모리 객체는 서명된 bearer token이 아니다.

FE 기존 개발 전용 도보 검사 화면에 별도 서버 계약 모드를 추가했다. 명시적 버튼만 시험
loopback 서버를 호출하고 시험 issuer JWT는 호출 메모리에만 둔다. 실제 로그인 저장소와
native transport/위치 추적을 사용하지 않는다. 실패/새 검사 시 이전 성공 결과를 지운다.
표시 응답에 `navigationReady=false`가 없거나 사례/출처/계수가 다르면 표시도 차단한다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| BE journey/transit/Live Activity 관련 최종 회귀 | 57 suites / 416 PASS, 실패·오류·skip 0 |
| 새 서버 계약 단위 검사 | 위 회귀에 포함, 10건 PASS (각 테스트의 여러 거부 변형 포함) |
| FE 전체 최종 회귀 | 308 suites / 2,888 PASS |
| 새 FE transport/summary·컴포넌트 | 위 회귀에 포함, 2 suites / 27 PASS |
| Node QA 및 diagnostics 설정 | 46 PASS |
| TypeScript 최종 / 두 repo diff whitespace | PASS |
| HTTP 시험 endpoint | 7사례 일치, 인증 누락 401 |

초기 FE 검사에서는 사용하지 않는 testing-library import, 대소문자만 다른 파일의 resolver
충돌, RN RequestInit 타입과 test global 타입 오류가 발생했다. 기존 react-test-renderer로
교체하고 component 파일명을 구분하며 요청 타입/globalThis를 수정한 후 재실행했다.
최종 전체 검사와 타입 검사는 모두 통과했다. 통과 뒤 추가한 개발 화면 전환 UI도 최종
전체 재실행에 포함했다.

Swift/native 소스·Info.plist 변경은 없고 iOS 새 빌드/Swift 검사도 이번에는 수행하지 않았다.
이전 R5-2 최종 Debug simulator binary에서 최신 Metro JS를 실행했다. source Info.plist SHA는
`7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`로 동일하다.

## 독립 시뮬레이터 E2E

대상: `NoLate R2 Session E2E 20261008`, iOS 26.5,
`96AF9A48-4721-4335-B7BF-10B9382B7A30`.
실제 조작 대상은 `deviceWindow-AppWindow-1` 분리 창이었다. 툴바의
`Show in Device Hub`를 확인했다. host 앱 이름은 Device Hub지만 embedded preview가 아니다.
다른 시뮬레이터/공유 서비스를 재시작하지 않았다.

각 버튼은 단계를 강제로 진행하는 버튼이 아니라 **서버 계약의 정상/거부 조건**을 검사하는
개발 진단이다. 실제 GPS 완주나 교통 공급자 성공으로 해석하지 않는다.

| 사례 | 관측 | 화면 |
| --- | --- | --- |
| 정상 | 도보 2개/6점, 합성 provider 2회, TRANSIT_ADMISSION_PENDING, 안내 OFF | [정상](evidence/journey-r44b-contract-20261012/01-server-bound.png) |
| 다른 소유자 | OWNER_CHANGED, provider 0회 | [소유자](evidence/journey-r44b-contract-20261012/02-owner-blocked.png) |
| revision 변경 | REVISION_CHANGED | [revision](evidence/journey-r44b-contract-20261012/03-revision-blocked.png) |
| 저장 경로 변경 | SAVED_ROUTE_CHANGED | [원본 변경](evidence/journey-r44b-contract-20261012/04-saved-route-blocked.png) |
| 만료 경계 | EXPIRED (합성 서버 시각 +300초, 실제 5분 대기 시험 아님) | [만료](evidence/journey-r44b-contract-20261012/05-expired-blocked.png) |
| 선형 단절 | DISCONNECTED_LINES, 한 번째 요청 뒤 전체 차단 | [단절](evidence/journey-r44b-contract-20261012/06-disconnected-blocked.png) |
| 공급자 불일치 | UNSUPPORTED_SAVED_ROUTE, provider 0회 | [출처](evidence/journey-r44b-contract-20261012/07-source-blocked.png) |
| 시험 서버 중단 | 정상 결과 재확인 후 이번 harness만 종료. 이전 성공/계수 제거, 서버 검사 불가·안내 차단 | [네트워크 실패](evidence/journey-r44b-contract-20261012/08-server-unavailable-no-stale-success.png) |

시험 endpoint는 서버 공용 계약 코드를 사용하되 provider와 원본 저장 경로는 합성이다.
타 소유자 사례는 실제 다른 사용자의 데이터를 읽지 않는다. 살아 있는 실제 여정도 바꾸지
않는다. 종료 전 readiness 검사에서 prepare/departure/activation/cancel/arrival/실제 push
계수 모두 0, redirect trap 0/Authorization 미전달을 확인했다.

## 남은 R4-4b 게이트

1. 기존 실제 저장 ODsay 원본 tuple/버스 형상·도로 section과 공식 catalog/차량 binding 연결.
2. 제한된 서버 HTTPS TMAP adapter, 인증된 실제 서비스의 저장 경로·로그인·revision 재조회 및
   동시 수정 fence. 네트워크 동안 DB lock을 잡는 형태로 우회하지 않는다.
3. 별도 TMAP 도보 provenance/TTL을 보존하는 서버 snapshot 저장·수명 관리와 FE/native 입력
   schema. 현재 `SavedJourneyInputValidator`/native 기존 단일 공급자 검사를 완화하지 않는다.
4. 위 조건을 모두 연결한 실제 경로 상세·Live Activity의 GPS E2E. 이번 계약 검사 결과로
   버스 탑승/하차·사용자 위치·지하철/환승·현장 GPS·실제 APNs를 통과 처리하지 않는다.

이번 시험 앱과 이번 Metro/harness만 종료했다. `.env` 변경·커밋·push·배포·운영 ON은 없다.
