# 환승 도보 handoff와 현재 구간 표시 — 부분 구현

2026-10-12. 실제 대중교통 내비게이션 전체 완료나 지하철 승객 위치 검증이 아니다.

## 후속: 다중 도보·다음 버스 occurrence 연결

### 최신: 다음 버스 ETA(v7)와 5차 GPS/잠금 완주

최종 후속(2026-10-13 00시대): 만료 문구 수정 후 FE 전체 **317 suites / 3,051 PASS**,
타입 PASS, 유지보수 helper 무접속 안전성 3 PASS, 합성 replay 입력 2 PASS다.
6차 독립 창 GPS/잠금 E2E도 자동 도착까지 통과했다. 다음 승차점 ETA 약 114초,
300초 이후 두 번째 버스 `RIDING`/하차 준비와 잘못된 admission 만료 문구 없음을 확인했다.
잠금에서 불확실 마커 숨김→목적지 도보 약 30m/마지막 구간 마커→목적지 근처→카드 제거,
복귀 `DESTINATION_ARRIVED/STOPPED`·자동 출발 1·종료 대기 0을 확인했다.
다음 ETA의 잠금 표시를 시도했으나 메뉴 조작 시점에는 이미 두 번째 RIDING으로 바뀌었으므로
**새 v7 ETA 잠금 화면은 미검증**이며 이를 최종 도보 잠금 검사로 대체하지 않는다.
한 번 Window 메뉴가 열렸지만 설정을 바꾸지 않고 Cancel했다. 다른 기기는 조작하지 않았다.
최종 로그: `/private/tmp/nolate-next-arrival-fe-final-ui-20261012.log`,
`/private/tmp/nolate-retained-preflight-types-20261012.log`,
`/private/tmp/nolate-transfer-gps-e2e-v6-20261012.log`.
지속 증거: `24-v6-second-ride-no-admission-error.png`,
`26-v6-lock-1791817431256.png`(최종 도보 30m/마커),
`26-v6-lock-1791817448134.png`(목적지 근처),
`26-v6-lock-1791817456494.png`(카드 제거), `27-v6-destination-arrived-terminal.png`.
이하 "진행 중"은 5차 직후 시점 기록이며 위 결과가 최신이다.

다음 버스의 query/admission/arrival은 해당 홀수 legIndex(1~29)에 묶는다. 이전 구간의
query/늦은 응답/같은 노선의 다른 occurrence는 재사용하지 않는다. v7은 접근/대기 단계와
일치하는 `arrival.busLegIndex`만 표시하며 v6의 ETA 금지는 유지한다. ETA는 탑승 확정이 아니다.
서버 fresh ownership fence, native source TTL, Activity 3,800byte 제한은 유지했다.
새 v7 서버 delivery→대역 sender→재생성 service→END 검사는 실제 APNs 검사가 아니다.

최신 자동 검사: BE **77 suites / 595 PASS**, FE **317 suites / 3,049 PASS**,
Swift **365 PASS**, TypeScript/iOS Debug build PASS. v6에서 next ETA를 허용하지 않아 발생한
초기 Swift 실패는 v7을 별도 도입하여 해결했고 실패 로그를 보존했다. 이후 E2E에서 발견한
진행 중 초기 admission 만료 문구는 표시만 수정했고 focused **15 PASS**, 타입 PASS다.
새 admission 차단/실제 runtime rejection 표시·서버/native 권한 검사는 그대로다.

3차는 전경 재개가 만료된 planning current를 조회해 `AUTOMATIC_SERVER_REJECTED`로 종료했다.
v3 기존 준비는 영속 준비 `/validate`를 조회하도록 수정했다. 신규 준비/legacy TTL은 연장하지 않는다.
4차는 `DESTINATION_ARRIVED`/카드 제거/종료 큐 0을 확인했지만 중간 환승·두 번째 탑승 화면을
놓쳤다. 차량 분리 fixture의 과도한 출발 속도도 4→1.5m/s로 수정했고 생산 임계값은 바꾸지 않았다.
두 변경을 함께 적용했으므로 한 변경만으로 모든 과거 실패 원인이 증명됐다고 주장하지 않는다.

5차는 같은 독립 `NoLate Mixed Journey E2E 20261012` 창(`Show in Device Hub` 툴바)에서
CoreLocation 합성 좌표와 독립 시계의 합성 차량만으로 다음을 확인했다. 단계 전환 버튼은 없다.

- 자동 출발 1회, 첫 차량 `RIDING/CO_MOVEMENT_OBSERVED`.
- 같은 차량 분리 4회, 연속 환승 도보, 다음 승차점 `합성 환승 정류장 3-0`.
- 다음 구간 마커와 `버스 도착까지 약 110초` 실제 화면. 초기 연결 만료 문구가 함께 표시되는
  UI 결함도 캡처했으며 이 부분은 성공으로 숨기지 않는다.
- 두 번째 차량 `RIDING`, 다음 정류장/약 70m/하차 준비.
- 두 번째 같은 차량 분리 뒤 최종 도보 30m→10m→목적지 근처, 마지막 구간 마커.
- 잠금 로컬 Activity의 목적지 근처/마지막 마커를 도구 화면에서 관찰한 직후 카드 제거.
  파일 `18-v5-final-walk-lock.png`는 촬영 시 이미 카드가 제거됐으므로 표시 증거가 아니라 제거
  증거다. 잠금 표시 관찰과 지속 PNG 증거를 혼동하지 않는다.
- 앱 복귀 `STOPPED/DESTINATION_ARRIVED`, 자동 출발 1, 종료 대기 0, 오류 코드 없음.

이는 공용 상세 안내 카드/controls의 합성 전체 연쇄 E2E이며 전체 제품 상세 지도·실제
위치/API/음성 청취/새 APNs 전달 성공은 아니다. 수정된 만료 문구의 전체 FE/독립 창 검증은 진행 중이다.
1~3차 실패 증거를 삭제하지 않는다. 최신 read-only 공유 DB는 다른 연결 **13개**이며
사용자의 중지 예정 확인만 있어 공유 백업/DDL/서비스 강제 종료를 실행하지 않았다.

로그: `/private/tmp/nolate-next-arrival-be-v7-full-20261012.log`,
`/private/tmp/nolate-next-arrival-fe-full-20261012.log`,
`/private/tmp/nolate-next-arrival-swift-v7-20261012.log`,
`/private/tmp/nolate-next-arrival-ios-build-20261012.log`,
`/private/tmp/nolate-transfer-gps-e2e-v5-20261012.log`,
`/private/tmp/nolate-retained-preflight-ui-20261012.log`.
화면 파일은 `docs/evidence/journey-transfer-bus-20261012/11-v5-*`~`20-v5-*`이며,
AX와 촬영 순간이 다른 이미지는 별도 시간의 화면으로만 사용한다.

### 준비 창과 시험 세션 수명 분리 (v3, 검증 진행)

후속 v3는 새 준비 가능 창 300초를 그대로 유지하고, 그 안에 서버가 영속 준비한 세션에만
최대 600초 수명을 별도로 부여한다. 저장 보행 자료는 최장 발급+900초에 제거되며 재조회는
어느 시각도 연장하지 않는다. API current/새 prepare는 300초 이후 거절한다. 기존 세션
검증만 준비 시각으로 불변 형상을 검증하되 현재 소유자/login/revision/fingerprint/같은 snapshot ID,
취소·교체·현재 세션 수명·시계 역행을 계속 검사한다. 네트워크 lease는 여전히 30초다.
설정 `journey.walking.retained-navigation-enabled`는 기본 false이며 이 시험 harness만 opt-in이다.
운영을 켜거나 실사용 1시간 여정 수명을 해결했다고 주장하지 않는다.

v3 후속 Swift **365 PASS**, FE **317 suites / 3,045 PASS**, BE 관련 **77 suites / 591 PASS**,
타입/iOS Debug build PASS. BE 새 반례 시험 최초에는 login fixture의 authority 변수만 바꾸고
실제 actor 세대를 바꾸지 않은 작성 오류 1건이 있었고 actor 세대까지 변경해 broad 재검증했다.
로그: `/private/tmp/nolate-retained-navigation-{be-full,fe-full,swift,types,ios-build}-20261012.log`.

5구간 E2E 2차도 완주 실패로 보존한다. AX에서는 첫 RIDING/하차 준비를 확인했으나 차량의
첫 분리 관측이 이미 최대 이동 위치에 도달하면 이후 전진량을 모을 수 없었다. 일부 화면
캡처는 이전 앱 프레임과 현재 AX가 불일치해 시각적 성공 증거로 사용하지 않는다.
홈 전환 후 독립 창의 앱 아이콘으로 직접 실행해 실제 전경 화면을 다시 확인한다.
합성 차량 동승 50초/정차 10초/출발 속도 4m/s, 환승 대기·목적지 체류 시간을 충분히 둔
v3 3차 실행을 준비했다. 생산 evidence 임계값은 변경하지 않았다.

서버/FE/native가 최대 31개 교대 구간의 모든 도보를 별도 v2 계약으로 검사한다. 다음 버스
admission·형상·차량 polling은 홀수 legIndex에 묶고, 이전 구간의 지연 응답은 버린다.
환승 승차점의 fresh ready 증거 뒤 새 접근/동승 reducer를 생성하며 증거를 재사용하지 않는다.
마지막 버스 뒤 최종 도보 index, v6 상세/Activity 위치·이름·하차 안내, 구간별 음성 중복 방지와
누적 sequence를 연결했다. 다음 버스의 ETA는 아직 미연결이며 이전 버스 ETA를 재사용하지 않는다.

Swift **364 PASS**, BE 관련 **77 suites / 589 PASS**, FE **317 suites / 3,039 PASS**,
TypeScript와 iOS Debug build PASS. 이 broad FE 기록 뒤 추가한 다중 구간 연결 UI 회귀
4건은 focused 12건 PASS이며 정상 만료 문구 수정 후 broad/type 재실행 중이다.
BE 시험 fixture 조정 뒤 MixedWalkingAdmissionTest/JourneyBusOccurrenceTest 재실행 PASS.
소스 Info.plist는 변경하지 않았고 시험 설치 산출물에만 진단/background 플래그를 적용했다.
공유 DDL·개인 키 API·실제 APNs 신규 전송은 없다.

새 5구간 독립 창 GPS E2E 1차는 **완주 실패**다. 자동 출발 1회·첫 차량 분리 3회·다음 버스
승차점 전환과 마커를 확인했다. 잠금 Activity는 위치 불확실 시 마커를 숨겼다. 두 번째 동승은
충분한 증거를 확보하지 못했고 300초 계약이 도착 전에 만료됐다. 만료 뒤 카드 제거·종료 대기
0은 확인했다. 이것을 도착 성공이나 실제 GPS/API/APNs 증거로 계산하지 않는다.
시험 차량의 두 번째 co-movement 시간을 늘리고 정상 만료를 연결 실패로 표시하던 문구를 수정해
재실행한다. 생산 증거 임계값·300초 수명은 완화하지 않았다. 장시간 여정의 별도 수명 계약은 남았다.

로그: `/private/tmp/nolate-next-bus-swift-all-20261012.log`,
`/private/tmp/nolate-next-bus-be-full-repair1-20261012.log`,
`/private/tmp/nolate-next-bus-fe-full-20261012.log`,
`/private/tmp/nolate-next-bus-ios-build-20261012.log`,
`/private/tmp/nolate-transfer-gps-e2e-20261012.log`.
독립 창 증거: `docs/evidence/journey-transfer-bus-20261012/01-first-wait.png`부터
`04-expired-cleanup.png`까지. 첫 실행의 실패 자료도 보존한다.

## 구현

- Native `NoLateJourneyTransferWalkCore`는 불변 경로의 현재 BUS 다음 WALK와 다음 BUS/SUBWAY
  승차 occurrence를 검증한다. revision/전체 정상 provider 경로/형상/명시 정류장 순서·방면·양 끝
  연속성을 검사하며 다음 승차점을 전체 목적지와 혼동하지 않는다.
- 세션 자체의 같은 차량 분리 reducer 관측 뒤 원래 CoreLocation 관측만 소비한다. 새 phase
  버튼/GPS 업로드/좌표 checkpoint는 없다. 다음 차량 탑승·도착 명령 입력도 없다.
- 8초 이하 연속 관측/불확실성 포함 corridor·속도/역행/점프 차단, 고정 handoff 수명,
  stale 숨김·제한된 재획득을 최종 도보와 공유한다. 환승은 버스 도로와 평행한 도보도 가능하다.
  40m 이하 짧은 환승은 신선한 분리 증거 후 다음 승차점 불확실성 원 안에서 5회·20초
  연속 체류가 있어야 ready다. 시간 tick/정지 GPS만으로 버스에서 내렸다고 판단하지 않는다.
- `readyForNextTransit`는 다음 승차점에 대한 로컬 증거일 뿐 boardingConfirmed/전체 ARRIVED가 아니다.
  복원 시 분리/환승 evidence는 보존하지 않는다. 만료/로그아웃/명시 종료는 모두 정리한다.
- v5 `TRANSFER_WALK`는 해당 중간 도보 구간 위의 위치, 남은 도보 거리와 다음 승차점 이름을
  상세/Activity 공통 정책에 연결한다. 100%도 전체 도착이 아니며 stale은 마커를 제거한다.
  Activity 접근성 문구도 첫 도보가 아닌 환승 도보로 표시한다. 새 승차점 이름은 검증된
  원본 정류장과 연속 도보에만 붙는다. 한 번의 환승 안내는 표시와 같은 fresh 위치를 사용한다.
- 서버 v5는 크기 제한된 **native 표시 보고**만 허용한다. GPS/차량 ID/탑승·도착 claim은 거절하며
  서버 상태 머신의 이동 판정으로 사용하지 않는다. 실제 APNs 호출은 이 후속에서 하지 않았다.

## 검사 기록

초기 native reducer 10개와 전체 359개 PASS 뒤 wire 연결 과정에서 기존 정류장 이름 비공개
조건 회귀 1개를 발견했다. 첫 승차점의 원래 연속성 조건을 복구하고 다음 승차점도 연속성을
검사해 전체 359개를 다시 통과했다. 후속 wire 반례 검사 1개를 추가했다.
FE 최초 focused는 부동소수 0.44의 strict equality 작성 오류 1개였고 근사 비교로 수정했다.
최종 FE **316 suites / 3,020 전체 PASS**(48.329초), 실패 기록을 삭제하지 않는다.
BE targeted 새 contract 2개 PASS. 최종 관련 broad **76 suites / 582 PASS**, 실패·오류·skip 0이다.
서버의 실제 delivery service→대역 push sender→영속 END dispatch에서도 v5 전달/종료 시 마커
제거를 검사했다. 대역 sender이므로 실제 APNs 전달 증거가 아니다.
후속 Swift **360 PASS**, TypeScript PASS다. iOS Debug build PASS 후, 환승 handoff 이후 이전
버스 polling도 중지하도록 transport guard를 맞춘 마지막 소스의 iOS Debug build도 PASS다.
Info.plist 원문 SHA-256 `7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`는 유지했다.
양 저장소 `git diff --check` PASS이며 공유 DB DDL/개인 키 외부 호출은 없다.

실행 로그: `/private/tmp/nolate-transfer-fe-full-20261012.log`,
`/private/tmp/nolate-transfer-be-full-20261012.log`,
`/private/tmp/nolate-transfer-swift-final-20261012.log`,
`/private/tmp/nolate-transfer-typecheck-20261012.log`,
`/private/tmp/nolate-transfer-ios-build-transport-final-20261012.log`.

## E2E와 남은 연결

초기 변경 당시 새 5구간 GPS·잠금 화면 E2E는 미실행이었다. Swift session trajectory는
자동 출발/첫 차량 동승/같은 차량 분리/짧은 환승점 도달까지 원래 관측으로 검사했지만
독립 시뮬레이터 UI E2E라고 계산하지 않는다. 기존 3구간 완주 증거를 새 5구간 증거로 재사용하지 않는다.
별도 R6 관측 연결 UI는 같은 독립 창에서 10사례와 서버 단절 1사례까지 후속 확인했다.

후속으로 leg-scoped admission/차량 polling 교체, 마지막 버스 후 동적 최종 도보와 다중 보행
계약을 구현했다. 다음 버스 ETA, 지하철 승객 탑승/하차 결합, 장시간 수명과 전체 UI 완주가 남았다.
공유 DB는 사용자가 target을 확인하고 중지를 예정했지만, 중지 완료 메시지는 아직 없고
읽기 전용 검사에 다른 연결 12개가 남았다. 공유 DDL/백업/서비스 강제 종료는 하지 않았다.
