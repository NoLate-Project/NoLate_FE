# 장시간 안내 수명 계약 — 2026-10-13

## 구현 범위

신규 도보 계약 admission은 기존 300초 그대로다. 새 v4는 그 안에 소유권·로그인 세대·
revision·전체 원본 fingerprint 검사를 거쳐 영속 준비된 세션에만 최대 7,200초를 부여한다.
서버 재조회·전경 복귀·인증 갱신으로 preparedAt/만료를 연장하지 않는다. 보관 행의 종료는
원래 admission 만료 + 7,200초이며, 실제 세션은 preparedAt + 7,200초 중 더 이른 시각이다.
기존 v1/v2 300초 및 v3 최대 600초 계약은 그대로 해석한다.

서버의 두 신규 스위치는 모두 기본 false다. `journey.walking.extended-navigation-enabled`
와 `journey.automatic.extended-navigation-enabled`가 함께 필요하며 retained-navigation도 필요하다.
한 스위치를 끄면 기존 v4 관측 재검증도 거절한다. 운영 설정은 변경하지 않았다.
유효한 기존 세션의 stop/reconcile은 계속 가능하다. 새로운 DB 열/DDL은 필요하지 않다.

FE는 인증된 저장 경로만 긴 binding을 읽고 native는 같은 v4 snapshot 없이는 600초 초과
세션을 거절한다. 로컬/SANDBOX의 상한은 600초다. native 단조 시계 deadline과 종료도
같은 고정 수명을 사용한다. 상세 동의·잔여 시간·도보 지도 경로 표시도 v4를 구분한다.

세션 수명이 길어져도 GPS 15초 신선도, 독립 차량 원본 시각/상관 증거, 서버 30초 검증
lease, 취소·교체·소유자·로그인·경로 변경 검사를 연장하거나 완화하지 않는다. 정적 도보
형상의 수명과 현재 위치 마커 신선도는 별도다. v4는 탑승 증거 자체가 아니다.

## 자동 검사

- FE 전체 320 suites / 3,097 PASS, TypeScript PASS.
- Swift 전체 366 PASS, iOS Debug build PASS.
- BE automatic/walking 관련 32 suites / 206 PASS. 전체 BE 검사는 아니다.
- GPS replay 스크립트 3 PASS.
- 격리 H2 재시작 후 1시간 시점 재검증, 30초 lease 유지, provider 재조회 0,
  두 스위치 OFF, 원래 admission 만료, 고정 2시간 만료/취소/교체/권한/경로/시계 역행 검사.
- Swift 10분 초과 복구와 불확실 위치, 2시간 경계/잘못된 버전/늦은 admission/
  별도 snapshot 누락 거절 검사. 자동 검사의 가상 시계는 실시간 2시간 현장 시험이 아니다.

초기 FE 진단 수치의 로컬 상한 회귀 1건은 AUTHENTICATED만 7,200초로 분리해 해결했다.
초기 BE 권한 차단 사례 1건은 도보 authority만 바꾸고 automatic route authority는 그대로
두었던 시험 대역 설정 오류였다. 두 authority를 함께 차단해 재시험했다. 실패 로그는 보존했다.
첫 화면 준비 점검에서는 새 Xcode 산출물에 QA plist opt-in이 없어 검사 버튼이 disabled였다.
빌드 산출물에만 진단/인증/background 모드를 재적용해 다시 설치했다. APNs opt-in은 적용하지 않았다.
소스 Info.plist SHA-256은 `7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359` 유지다.

로그는 `/private/tmp/nolate-extended-navigation-*20261013.log`에 보존한다.

## 독립 창 GPS E2E

시험 기기는 `NoLate Mixed Journey E2E 20261012` 한 대다. detached window의
`Show in Device Hub` toolbar를 확인하고 그 창만 조작한다. 실제 ScheduleDetail 컴포넌트에
고정 loopback/H2의 합성 5구간 자료를 연결한다. 새 v4 준비 후 240초 제자리 GPS 체류,
도보→첫 버스→환승 도보→다음 버스→최종 도보·도착을 실제 시간 10분 이상 진행한다.
차량 시계와 승객 CoreLocation 입력만 바꾸며 단계 전환/탑승/도착 명령은 보내지 않는다.

첫 장시간 시험은 **FAIL**이다. 제자리 240초 동안 자동 출발하지 않았고, 이후 GPS 출발·
첫 버스 탑승·잠금 화면 첫 버스/다음 버스 대기 표시는 확인했다. 그러나 잠금 중 합성
600초 access token이 만료되어 `AUTOMATIC_AUTH_EXPIRED / STOPPED`로 안전 종료됐다.
진단 AX는 안내 잔여 6,625초·출발 반영 1회·종료 대기 0건이었다. 세션 2시간 만료에
도달한 것이 아니며 완주 성공으로 계산하지 않는다. replay는 확인된 소유 PID에 SIGTERM,
exit 143으로 중지했다. `evidence/journey-product-detail-20261013/36`–`42`번 화면과
`/private/tmp/nolate-extended-navigation-gps-e2e-20261013.log` 실패 기록을 보존한다.

후속 보강: 600초 초과 준비/명시적 복구 전에 access token이 **고정 세션 만료 + 30초**까지
유효한지 확인한다. 부족하면 전경 shared refresh를 수행하고, 갱신 후에도 짧거나 다른
로그인/소유자라면 native 입력 시작 전에 거절한다. native도 같은 경계를 재검사한다.
백그라운드에서 JWT 만료를 늘리거나 refresh secret을 저장하는 구현은 아니다.
장시간 합성 fixture만 명시적 opt-in에서 9,000초 JWT를 발급하도록 바꾼다. 이전 600초
fixture/운영 issuer 설정은 바꾸지 않는다. 이는 잠금 중 인증 갱신 시험이 아니라,
충분한 고정 인증 수명을 가진 내비게이션 지속 시험이다. 재시험 결과는 별도로 추가한다.

### 인증 horizon 보강 후 재시험 — PASS (범위 제한)

고정 9,000초 합성 인증을 사용한 새 v4 준비에서, 제자리 240초 동안 출발하지 않음→GPS
첫 도보/승차점 지도와 바→첫 버스 확인/하차 준비를 실제 상세에서 확인했다. 이후 약 6분간
중단 없이 잠근 상태에서 다음 버스 승차점/도착까지 1분/네 번째 구간 시작 마커,
10분 경계 이후 최종 도보 약 10m/마지막 구간 마커, 자동 Activity 제거를 확인했다.
잠금 해제 뒤 상세의 현재 위치/별도 보행 형상 제거와 진단 `DESTINATION_ARRIVED / STOPPED`,
자동 출발 1회/종료 대기 0을 AX로 확인했다. 종료 대기 행은 화면 아래로 잘려 있어
스크린샷만의 시각 증거라고 주장하지 않는다. 재시험 replay exit 0, 약 12분 전체 경과다.

증거는 `evidence/journey-product-detail-20261013/43`–`53`이다. 44번 파일명은 첫 도보지만
실제 캡처는 아직 출발 대기, 46/48/50번은 위치 불확실 화면이다. 이들을 첫 도보/버스의
확정 위치 증거로 계산하지 않는다. 45번은 승차점 GPS/바, 47번은 첫 버스 하차 준비,
49번은 잠금 다음 버스 대기 1분, 51번은 잠금 최종 도보 10m, 52번은 카드 제거,
53번은 terminal 진단이다. 두 번째 버스 자체의 신선한 RIDING 화면은 이번 캡처에서
누락됐으며, 이전 별도 제품 상세 시험과 혼동하지 않는다. 수동 phase/탑승/도착 명령은 없다.

보강 자동 검사: FE 전체 320 suites/3,111 PASS, Swift 367 PASS, TypeScript/iOS Debug build
PASS, BE mixed admission/ride 관련 17 PASS. 뒤이어 제품 알림 설정/복구 horizon UI 검사를
추가한 FE 320 suites/3,115 PASS는 별도 기록을 따른다. 시험 issuer 경계도 별도 검사한다.
로그: `/private/tmp/nolate-navigation-auth-horizon-*20261013.log`.

이 PASS는 충분한 인증 수명에서 10분을 초과한 합성 잠금 안내/종료 시험이다. 실제
2시간 실시간 주행, 잠금 중 자동 인증 갱신, 실제 공급자/로그인/일반 지도/APNs 성공은 아니다.

## 남는 범위

실제 신규 APNs는 별도 제한 전송 승인 대기이며 이번 전송은 0회다. 실제 로그인/지도 타일,
공식 지하철 승객 결합, 제품 native DEVICE runtime/release, 실기기 GPS·무음/음성 현장 검사는
여전히 남았다. 운영 서버는 중지 상태고 운영 ON/재배포/재기동은 하지 않았다.
