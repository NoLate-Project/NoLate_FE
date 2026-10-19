# 자동 세션 소유 지하철 관측 연결 — 부분 구현·검증

2026-10-13, Asia/Seoul. **열차 관측 조회를 자동 안내 세션에 연결한 단계이며,
승객 탑승/현재 역 판단·R6 전체 완료·운영 배포의 증거는 아니다.**

## 구현한 경계

BE의 명시적 `journey.subway-observation.enabled=true`에서만 아래 컨트롤러와 서비스가
등록된다. 설정 누락/false이면 둘 다 없으며 운영 `.env`/기본값을 변경하지 않았다.

`POST /api/schedules/{scheduleId}/automatic-journey/{sessionId}/subway-observation`

요청에는 세션 generation, routeRevision, clientOwnerId, routeInputDigest와 정확한
`subwayLegIndex`만 사용한다. 역/열차/방면/패턴/GPS를 클라이언트 입력에서 채우지 않는다.
구간 인덱스는 명시적인 홀수 정수 1..29여야 한다. 저장 경로도 3..31개의
WALK/(BUS 또는 SUBWAY)/WALK 교대 구조이며 해당 구간이 SUBWAY여야 한다.

`AutomaticJourneyService.requireSubwayObservationFence`는 기존 자동 세션의 로그인 세대,
소유권, 세션 세대, 경로 revision/fingerprint, 취소·교체·고정 만료, 수동 안내 충돌과 실행
환경 gate를 재사용한다. 관측 요청으로 출발/탑승 상태를 바꾸지 않는다.

실제 JPA adapter는 외부 조회 **전후 각각 짧은 REQUIRES_NEW/READ_COMMITTED 트랜잭션**에서
actor→일정/개인 경로→준비 세션 순서로 잠금·refresh한다. OSIV의 오래된 엔티티를 재사용해
로그아웃·취소·경로 수정을 놓치지 않도록 했다. 외부 조회 중에는 이 트랜잭션/잠금을 보유하지
않으며 ambient transaction도 거절한다. 동시 수정의 optimistic/pessimistic lock 실패는
`INVALID_STATE`로 안전하게 거절하고 자동 재시도하거나 이전 결과를 반환하지 않는다.

독립 catalog가 설치되지 않았으면 fallback은 빈 자료이며 외부 조회는 0회다. 공식 데이터
수집/설치 bean은 아직 없다. 공유 checker의 프로세스 내 최대 2개 동시 조회·회원별 단일
조회·10초 결과 deadline·조회 전후 catalog 유효성/저장 원본 대조를 유지한다.

응답은 정확한 세션/경로/구간 식별과 상태/관측 개수만 포함한다. 열차 ID·역 ID·패턴·좌표를
내리지 않으며 `navigationReady=false`, `passengerBoardingConfirmed=false`,
`passengerPosition=null`, `passengerRemainingStops=null`이다. native 관측 lease/승객 결합
계약을 제공하는 endpoint가 아니다.

## 자동 검사

- BE 최종 **16 suites / 152 PASS**, failure/error/skip 0. 지하철 관련 10 suites/113건과
  기존 자동 세션 서비스·인증·검증·컨트롤러·만료·종료 동기화 39건이다.
- 이어서 `com.noLate.journey.*`, `com.noLate.transit.*`, `com.noLate.notification.liveactivity.*`의
  확장 회귀 **81 suites / 593 PASS**, failure/error/skip 0(54초)를 확인했다. 위 152건을
  포함하며 별도 합산하지 않는다. 모든 BE 패키지 전체 실행을 의미하지 않는다.
  일회용 MySQL의 migration→entity validate→재시작 후 END 단발 처리도 1건 PASS이며
  해당 UUID 컨테이너는 종료·제거됐고 기존 Redis는 건드리지 않았다. 이 검사는 운영 DB의
  DDL 재실행이나 운영 서버 health 검사가 아니다.
- 새 소유 세션 서비스 10건: ARMED/ACTIVE 관측만 제공, 다음 지하철 occurrence,
  잘못된 세대/revision/owner/digest/session/index, 조회 중 취소·교체·로그아웃·경로 변경·만료.
- 실제 격리 H2/JPA 5건: Spring opt-in 구성의 서비스/컨트롤러 연결, OSIV 캐시를 둔 정상,
  동시 로그아웃·취소·경로 수정, catalog 미설치의 외부 조회 0회. 공급자 callback에서 실제
  트랜잭션 부재와 별도 수정 트랜잭션의 완료를 확인했다. 일정 가시성 loader는 mock이므로
  실제 전체 일정 접근 정책이나 운영 MySQL 부팅 검사로 계산하지 않는다.
- 컨트롤러 7건: JSON/구간 계약·미인증·generation 누락·기본 OFF·실제 JwtTokenProvider와
  JwtAuthenticationFilter/AuthenticationPrincipalArgumentResolver. 합성 현재-member 조회로
  정상 signed access를 허용하고, 누락/잘못된 토큰/refresh/만료/다른 회원/다른 서명/issuer/
  로그인 세대를 거절했다. 실제 로그인/운영 보안 filter-chain 전체 검증은 아니다.
- 합성 HTTP fixture 1건이 **22사례**를 순회한다. 기존 catalog 16사례 + 소유 자동 세션 6사례다.
- FE 전체 **323 suites / 3,169 PASS**, TypeScript PASS. native 소스 변경·새 iOS 빌드·Swift
  재실행은 없다. 기존 unsigned 시험 앱의 Keychain 경고를 인증 통과로 계산하지 않는다.

실패 이력도 보존한다. 첫 H2 동시 경로 수정 시험에서 refresh 이전 잠금의
`StaleObjectStateException`이 노출돼 알려진 lock 예외를 안전 거절로 정리했다. 후속 인증
시험 helper의 MockMvc generic 추론 컴파일 오류는 명시 타입을 넣어 수정했다.

최종 로그:

- `/private/tmp/nolate-r6-owned-subway-be-broad-final-20261013.log`
- `/private/tmp/nolate-r6-owned-subway-navigation-regression-20261013.log`
- `/private/tmp/nolate-r6-owned-subway-wiring-auth-final-20261013.log`
- `/private/tmp/nolate-r6-owned-subway-fe-full-20261013.log`
- `/private/tmp/nolate-r6-owned-subway-types-20261013.log`

## 독립 시뮬레이터 E2E

`NoLate Mixed Journey E2E 20261012`, iOS 26.5,
`4EE367B1-CDC6-4585-A64B-CB554EEB7DE2`, `deviceWindow-AppWindow-1`의 분리 창만 조작했다.
`Show in Device Hub` 툴바를 확인했으며 embedded Hub/다른 기기/실기기를 사용하지 않았다.
소유 8088 Metro와 test-source 15547만 갱신하고 Safari 딥링크/앱 열기를 UI로 수행했다.

| 신규 합성 사례 | 화면 결과 | 로컬 공급자 / 소유권 읽기 |
| --- | --- | --- |
| 자동 세션 정상 | TRAIN_REFERENCES_ONLY, 관측 1개·탑승 미확정 | 1 / 2 |
| 조회 중 취소 | AUTOMATIC_SESSION_UNAVAILABLE, 0개 | 1 / 2 |
| 조회 중 교체 | AUTOMATIC_SESSION_UNAVAILABLE, 0개 | 1 / 2 |
| 로그인 철회 | OWNER_CHANGED, 0개 | 1 / 2 |
| 경로 변경 | AUTOMATIC_SESSION_UNAVAILABLE, 0개 | 1 / 2 |
| 이전 세대 | AUTOMATIC_SESSION_UNAVAILABLE, 0개 | 0 / 1 |

새 6사례의 AX와 결과 카드를 확인했다. 앞선 16사례를 이번 최신 번들에서 전부 다시 돌렸다는
뜻은 아니다. 각 사례의 실제 공급자 0회·GPS 미사용·위치/남은 역 미표시도 확인했다.
진단 HTTP bridge는 실제 소유 자동 세션 서비스와 in-memory fence를 호출한다. **위 제품
endpoint의 실계정 JWT→JPA→실제 공급자 end-to-end 시험은 아니다.** JPA/컨트롤러 검사는
위 자동 검사와 분리한다. 화면 버튼은 합성 실패 사례 선택이지 출발/탑승/하차 명령이 아니다.

증거 폴더: `docs/evidence/journey-owned-subway-20261013`.
[정상](evidence/journey-owned-subway-20261013/01-automatic-complete-visible-result.png),
[취소](evidence/journey-owned-subway-20261013/08-automatic-stopped-full.png),
[교체](evidence/journey-owned-subway-20261013/03-automatic-replaced-visible-result.png),
[로그인 철회](evidence/journey-owned-subway-20261013/04-automatic-revoked-visible-result.png),
[경로 변경](evidence/journey-owned-subway-20261013/11-automatic-edited-final.png),
[이전 세대](evidence/journey-owned-subway-20261013/06-automatic-generation-visible-result.png),
[검증 요약](evidence/journey-owned-subway-20261013/ui-results.json).

초기 캡처 중 일부는 결과 상단이 잘렸다. 취소·경로 변경을 같은 창에서 재실행하고 위 전체
카드 증거로 대체했다. 상태 막대 탭 직후/스크롤 애니메이션 중의 잘린 화면도 보존한다.
helper의 배열 기록이 빈 파일인 것을 발견해 요약 JSON은 확인한 AX/화면을 바탕으로 별도
작성했다. 이 JSON은 자동 수집 원본 전체나 새로운 실행 횟수의 증거라고 주장하지 않는다.

## 남은 제품 연결과 환경 상태

공개 [ODsay Web 명세](https://lab.odsay.com/guide/releaseReference?platform=web)를 다시 확인했다.
`subwayStationInfo`의 출력 계약은 ODsay 역 ID·호선·좌표·환승역 등을 정의하지만 서울 열차
API `STATN_ID` 대응 필드는 명시하지 않는다. `searchStation`의 `localStationID`는 지역
**버스** 정류장 ID로 설명돼 있다. 따라서 이를 지하철 대응으로 재사용할 근거를 확인하지
못했다는 것이 현재 판단이다. 공급자의 별도 대응 자료가 존재하지 않는다고 단정하지 않는다.
개인 키를 사용하는 실제 API 조회는 추가하지 않았다.

1. 독립 공식 ODsay↔서울 역 대응·운행 계통별 정차 순서 설치와 승인 범위 내 실제 열차
   정상 응답 확인. 이름/근접 좌표/ID 숫자 정렬로 이 자료를 대신 만들지 않는다.
2. 신선도·세대·취소를 가진 서버→native 관측 계약, GPS/시간 연속성의 승객 탑승 근거.
3. 터널/복수 후보/잘못 탄 노선, 하차·다음 환승 및 상세/Activity/음성/알림 projection과
   독립 GPS·잠금 E2E. 이 관측 개수를 승객 위치로 표시하지 않는다.
4. 최신 다중 경로 실제 APNs, 현재 시험 설치의 OS 알림 허용 및 실제 청취 검증은 별도다.

운영 DB 5개 마이그레이션은 [별도 적용 완료 기록](journey-production-migration-20261013.md)을
따른다. 다시 실행하지 않았다. 운영 5522 listener는 최종 재확인에서도 없었다.
운영 재기동/배포/기본 ON/`.env`/source Info.plist/실기기/OS 권한 변경은 없다.
Info.plist SHA-256은 `7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`로
유지했다. 백업·H2·실패 자료도 보존한다. test-source 15547와 8088만 후속 확인용으로 유지하며
독립 창에는 마지막 경로 변경 차단 결과를 남겼다. 전체 기능 완료로 판정하지 않는다.
