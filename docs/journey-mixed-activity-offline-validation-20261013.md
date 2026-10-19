# 5구간 GPS → Activity API/영속 저장 연결 — 2026-10-13

## 검증 경계

실제 APNs 전송 승인을 기다리는 동안, 별도의 내부 시험 모드로 실제
`JourneyActivityController`·`JourneyActivityDeliveryService`·H2 영속 lane/END 처리를
합성 5구간 안내 엔진과 연결했다. Firebase 클라이언트는 만들지 않는다. sender는 고정
합성 FCM 문자열과 합성 Activity 토큰만 허용하며 UPDATE/END 합계 100회로 제한한다.
실제 설치 토큰·인증 저장소·운영 DB·실사용 경로에는 접근하지 않는다.

이는 APNs 전달 성공이나 기기 수신 증거가 아니다. 응답의 `providerAccepted=true`는
이번 모드의 오프라인 sender 접수이며 `deviceVerified=false`다. 화면도
`OFFLINE_ACCEPTED_NOT_APNS`라고 구분한다. 실제 APNs 승인은 별도 대기다.

## 구현

- test-source harness에서만 별도 opt-in으로 실제 Activity API를 노출한다.
  transfer/extended fixture가 모두 켜져 있어야 하며 loopback 15546에만 바인딩한다.
- 내부 FE 화면에서 명시적으로 시작하는 전경 게시기다. 안내의 ARMED/ACTIVE 상태를 읽을
  뿐 출발·탑승·환승·도착 명령을 만들지 않는다. GPS 자동 출발 ACK 뒤 신선한 표시 계약만
  보낸다. 실제 상세 화면으로 전환해도 상위 화면의 게시기를 유지한다.
- 정확한 원본·member/login/session/revision/binding fence, 단일 요청, 15초 간격,
  20분/UPDATE 최대 80회, END 1회로 제한한다. 좌표·차량 ID·비밀 필드 등 비허용 키는
  전송 전에 거절한다. 불명확한 실패는 재전송하지 않고 BLOCKED로 종료한다.
- 도착 후 native 현재 binding이 해제돼도 캡처했던 자기 binding으로 END를 요청하고,
  실제 저장된 종료 상태를 조회해 ACCEPTED를 확인한다. 자동 세션 만료/END worker는
  test-source 전용 단일 executor에서 실행한다. 전경 게시기이므로 잠금 중 전송을
  보장하지 않으며, 제품 백그라운드 APNs 구현을 대체하지 않는다.

## 자동 검사

최종 FE 전체 **323 suites / 3,159 PASS**, 최종 TypeScript PASS. 새 게시기 검사 25건은 생성 무부작용,
ACK 전 대기, 신선도/중복/간격/예산, 고정 합성 토큰만 사용, raw GPS·차량·secret 거절,
세션 교체/늦은 응답 fence, END 단발/ACK, 불명확한 실패의 재전송 금지를 포함한다.
중첩 arrival에도 allowlist/primitive 제한을 적용해 좌표·차량·secret 또는 허용 키 안에 숨긴
객체를 전송 전에 거절한다. 정상 native v7 ETA/v6 하차 계약의 통과 검사도 포함한다.
후속 UI lifecycle 검사 5건도 PASS다. 렌더링 무부작용/명시적 시작 단발,
background·inactive 표본 금지/전경 복귀, context 교체 후 늦은 응답 무시,
unmount 시 timer/게시기 정지, 입력 누락/실패 원문 미노출을 확인한다.

최종 타입 검사에서 QA `fetch`의 `redirect`가 RN `RequestInit` 선언에 없는 오류를 발견했다.
기존 QA 어댑터와 같은 교차 타입으로 수정하고 DEV path guard의 괄호도 명확히 했다.
RN fetch가 redirect:error를 보장한다는 뜻은 아니다. 고정 합성 인증/loopback 시험 전용이며
제품의 native 인증 transport를 대체하거나 실사용 인증을 전달하지 않는다. 최초 타입 실패
로그는 보존했다. 마지막 중첩 필드 보강 뒤 전체 GPS UI 완주를 새로 돌린 것은 아니며,
위 독립 화면 실행과 자동 회귀 검사를 구분한다.

서버 새 검사 4건은 실제 mixed admission/HTTP controller·파일 DB 재시작 이후 v4 수명,
다음 버스 v7 ETA/최종 도보 표시, encrypted lane, snapshot 취소/교체/revision 거절,
재시작 후 END 단발 및 잔여 위치·ETA·탑승 상태 제거를 확인한다. 별도로 정확한 만료 직전에는
종료하지 않고 만료 시점에는 앱의 END 없이 서버 TTL worker→END 접수 단발/잔여 위치 제거를
확인한다. 기존 durability/admission 검사와 함께 최종 **3 suites / 38 PASS**다.
초기 HTTP raw-field 거절 기대값 400/실제 409 불일치는 테스트를
계약에 맞춰 수정했고 실패 로그를 보존했다. 후속 재실행 중 잘못된 admission test filter로
24건만 실행된 로그도 보존하며, `be-tests-final4`의 4+13+21건 XML/성공 결과를 기준으로 한다.

## 독립 시뮬레이터 E2E

**GPS/로컬 잠금/오프라인 API 종료 연결 확인.** `NoLate Mixed Journey E2E 20261012` 독립 창(Show in Device Hub toolbar)을
직접 조작하며 고정 합성 CoreLocation과 독립 차량 clock을 재생한다. 수동 phase 명령은 없다.
안내 방식은 OFF이고 권한 요청·새 실제 API/APNs 전송은 없다.

실제 상세에서 서버 도보 연결→검사/동의→ARMED 후 GPS 재생을 시작했다. 버튼으로 출발하지
않았다. 전경의 자동 출발 1, APPROACHING_STOP 게시, 첫 차량 RIDING 게시, 실제 상세의
다음 승차점 현재 위치/경로 바 및 두 번째 버스 별도 ETA, 두 번째 차량 RIDING 게시를
확인했다. 화면이 실제 상세로 전환돼도 상위 게시기는 유지됐다.

잠금 화면에서 두 번째 하차 정류장/현재 구간 마커의 **로컬** Activity 표시를 확인했다.
그 뒤 Controls→Lock 메뉴가 조작 도구에서 반복 `element ID is no longer valid`를 냈다.
최신 AX 재조회·취소·제어 세션 재연결도 실패했고, 독립 창 소유 앱을 다시 활성화하는
API는 지원되지 않았다. embedded Hub나 다른 기기로 우회하지 않았고 사용자에게 이 독립
창 메뉴 닫기/잠금 해제를 요청했다. 재설치/OS 권한 변경/앱 강제 종료도 하지 않았다.

GPS replay는 exit 0으로 정상 종료했다. 최종 읽기 전용 loopback 상태는
`prepareCount=1, departureCount=1, cancelCount=1, lastState=STOPPED,
offlineActivityUpdates=14, offlineActivityEnds=1, offlineActivityRows=1,
offlineActivityEndState=ACCEPTED, guidancePushRealProvider=false`다. 전경 게시기는 잠금 뒤
멈췄으므로 이 END는 native의 자동 세션 종료 동기화와 서버 worker 경로가 처리했다.
이 시점에는 서버 종료 접수만 확인했으며 최종 화면은 보류했다. 다음 턴의 실제 상태
재조회에서 독립 창 제어가 복구돼 아래 최종 증거를 추가했다. 사용자의 추가 조작/권한
승인을 받았다고 가정하거나 embedded Hub로 우회한 것이 아니다.

09:31~09:32 독립 잠금 화면에서 카드 제거를 확인하고 같은 창의 Lock→스와이프로
앱에 복귀했다. AX 및 하단 진단 화면은 **DESTINATION_ARRIVED / STOPPED / 자동 출발 1 /
종료 대기 0**이다. 전경 게시기는 기존 캡처 binding으로 END를 한 번 요청하고
`END_ACCEPTED / UPDATE 14 / END 1`을 표시했다. 서버가 이미 처리한 END와 중복 전송하지
않았는지 최종 상태를 재조회했고 UPDATE 14/END 1/ACCEPTED 유지로 확인했다. 최종 도보 중간 구간의 화면은 이번 실행에서 캡처하지
않았으므로 해당 거리의 시각적 증거로 계산하지 않는다. 새 nested rejection 보강은
별도 자동 회귀이며 최신 번들의 전체 GPS 재시험과 구분한다.

로그: `/private/tmp/nolate-mixed-activity-offline-*20261013.log`.
H2: `/private/tmp/nolate-walking-e2e-HZZZH4` (삭제하지 않음).
화면: `docs/evidence/journey-product-detail-20261013/63-*.png` 이후.

63번은 자동 출발 뒤 APPROACHING_STOP 게시를 보여준다. 64번 파일명에는 first-bus-riding이
있지만 화면의 현재 안내는 위치 확인 중이며, 상단의 마지막 게시 상태만 RIDING이다.
따라서 64번을 신선한 탑승 위치의 화면 증거로 계산하지 않는다.
65번은 실제 상세의 다음 승차점/경로 바, 66번은 WAITING 게시/다음 버스 ETA,
67번은 두 번째 RIDING 게시/하차 정류장 마커, 68번은 로컬 잠금 Activity다.
69번은 잠금 카드 제거, 70번은 전경 게시기 END_ACCEPTED, 71번은 전체 하단 도착/큐 0 진단이다.

## 남은 범위

실제 Firebase/APNs 전달·잠금 알림 허용/표시·음성 청취·실제 로그인/일반 지도 타일·
현장 GPS·Release/실기기 및 지하철 독립 운행 catalog/승객 결합은 이 검사의 PASS 범위가 아니다.
운영 서비스 재기동/배포/기본 ON/추가 마이그레이션은 하지 않는다.
최종 화면/서버 재확인 뒤 이 시험의 loopback harness(15546)와 Metro(8088)는 정상 중단했다.
후속 지하철 시험은 별도 15547 fixture와 다시 시작한 8088 Metro를 사용한다.
운영 5522 listener는 없고, 다른 서버/Redis/실기기는 변경하지 않았다. `.env`와 source
Info.plist는 변경하지 않았으며 H2·스크린샷·실패 로그와 운영 백업은 보존한다.
