# NoLate 길안내 현재 상태 — 전체 기능 미완료

마지막 정리: 2026-10-20. 파일명 날짜는 기존 링크 호환용이다.
이 표만 현재 완료 판단에 사용한다. 실행 순서는 [로드맵](journey-guidance-roadmap.md)을 따른다.
[이전 상태 원문](journey-navigation-status-history-through-20261013.md)은 이력이며 현재 상태가 아니다.

## 요구사항과 실제 검증 범위

| 사용자 기능 / 기반 | 구현·연결 상태 | 확인된 증거 | 남은 필수 확인 |
| --- | --- | --- | --- |
| 이동으로 자동 출발 | Debug 시뮬레이터 runtime 연결 | 단계 버튼 없는 CoreLocation 합성 좌표 시험 | 실제 제품 계정/경로·현장 GPS |
| 버스 탑승·하차·도보 환승·도착 | 5구간 WALK/BUS/WALK/BUS/WALK 시험 구현 | 독립 차량 시계+주입 GPS로 완주, 도착/카드 제거/종료 확인 | 실제 저장 경로와 공식 공급자 전체 연결·현장 판단 |
| 상세 지도·경로 바·현재 구간 | 실제 상세 렌더러 연결, QA 데이터 사용 | 현재 구간/거리/마커·자동 도착 시 제거 | 실제 로그인/일정/일반 지도 타일 E2E |
| Live Activity | 로컬 표시와 최신 다중 구간 서버 API/영속 END 구현 | **v8 첫 지하철 구간과 합성 5구간의 실제 Firebase/APNs UPDATE·END**: 독립 잠금 카드의 단계/마커 갱신, 앱 종료 뒤 카드 유지, 원격 END 뒤 제거 | 실제 사용자 저장 경로, 5구간의 서버 재시작/교체/취소/만료 조합 |
| 음성·안내 알림 | 이벤트 정책·제품 시험 채널 설정 연결 | 전경 음성 큐, 과거 별도 로컬 잠금 알림 표시 | 최신 설치 권한/각 이벤트 표시·실제 청취·무음/잠금 실기기 |
| 지하철 현재 위치·탑승·환승 | **첫 구간의 native HTTP→승객 판단→상세/Activity 연결**. 서버의 공식 경로·좌표와 실시간 열차 위치 대조 adapter는 기본 OFF. 일반 제품 진입·하차 확정/환승은 미연결 | 주입 GPS+합성 열차의 화면 E2E, v8 실제 APNs 잠금 갱신/종료. 2026-10-15 공식 열차 `2243`의 독립 시뮬레이터 `RIDING`·현재역 `역삼` 확인. 별도 합성 피드 E2E에서 피드 공백 중 상세·잠금 카드의 **마지막 확인 역**과 90초 뒤 제거 확인 | **공식 열차의 신선한 현재역·마커가 상세와 잠금 화면에 동시에 표시되는 조건 미통과**. 합성 피드의 이력 표시는 이 조건을 대체하지 않는다. 실제 사용자 저장 경로, 현장 GPS/탑승, 하차 확정/최종 도보/환승 |
| 실기기/Release 실행 | 별도 브랜치에서 opt-in Release 런타임·네이티브 권한 후보를 컴파일. 공개 기본 OFF, `main` 미병합 | iOS 27 독립 시뮬레이터에서 격리 H2 시험 계정 로그인→온보딩→저장 합성 경로→상세 시트 길안내 영역 XCUITest 통과. 단, Xcode 27 시뮬레이터의 Release 키체인 권한 문제를 피하려고 이 회차에만 시험 전용 저장소 대체를 사용했으며 후보 코드에서는 제거했다. 화면은 공식 ODsay 서울 버스 원본 식별자·정류장 매핑 부재로 안내 준비 불가를 명시했다. 기존 ATT·재시작/Swift·JS 검사는 유지. | 실제 공급자 원본 경로의 자동 출발→탑승·환승→도착, 상세·Live Activity·APNs/종료 전체 E2E는 미통과. 정상 서명 빌드와 현장 GPS·알림/무음·백그라운드 출시 게이트도 별도 확인 필요 |
| 운영 DB migration | **5개 적용 완료** | 전체 백업·격리 복원·적용 이력/열 수·기존 행 수 확인 | 운영 서버 부팅/health는 별도 미검증; migration을 다시 할 일이 아님 |
| 종료/인증/취소 복구 | 서버 영속 END와 세대/신선도 차단 등 구현 | 격리 DB 재시작·단발 END, v8·합성 5구간 실제 APNs 원격 END/앱 종료 뒤 카드 제거 | 5구간 실제 제품 경로, 원격 서버 재시작/교체·취소·만료 조합과 현장 장애 |
| 전체 접근성·이탈/잘못 탄 차량·재탐색·배터리 | 부분 또는 미검증 | 개별 기존 회귀만 존재 | 제품 전체 시나리오/현장 품질 합격 |

합성 GPS는 CoreLocation에 좌표를 주입한 것이며 실제 수신 GPS가 아니다.
실제 GPS 정확도·승객 동행 검증은 사용자가 실기기에서만 수행한다. 독립 시뮬레이터
E2E는 주입 위치로 화면·상태 전달을 확인하되 이를 실기기 GPS 합격으로 세지 않는다.
독립 창에서 실제 상세 컴포넌트를 조작했어도 QA 인증/합성 일정/공급자이면 **합성 제품 화면 E2E**다.
열차 관측 개수는 승객 위치가 아니다. 토큰 발급·provider 수락·큐 0·replay exit 0도 각각 수신/화면/완주 증명이 아니다.
기존 v1~v4·v8 첫 지하철 구간과 이번 **합성 5구간**의 실제 APNs 기록은 서로 구분한다.
합성 5구간의 수신 성공을 실제 사용자 저장 경로·공식 교통 공급자·실기기 전달 성공으로 전용하지 않는다.

## 실기기 전 단계 보강 — 2026-10-15

- JS 제품 진입·준비·복구는 실기기에서 `DEVICE`를 요구하고, native는 Debug 진단 앱의
  `NoLateJourneyDeviceFieldTestEnabled` opt-in 없이 이를 받지 않는다. 기존 시뮬레이터는
  `SIMULATOR` 계약을 유지한다. 서버의 `journey.automatic.device-enabled`는 기본 OFF다.
  실제 운영 설정을 변경하거나 실기기에 앱을 설치하지 않았다.
- v4 서버 보행 계약의 `DEVICE` 세션도 최대 7,200초를 사용하도록 10분 불일치를 수정했다.
  v4가 아닌 `DEVICE` 세션은 600초이며 인증/GPS·검증 lease를 연장하지 않는다.
  iOS device용 Debug **비서명 컴파일**, Swift 정책 385건, JS 전체 3,194건,
  서버의 `DEVICE` 기본 차단/v4 수명·원격 Activity 표적 44건, Expo 플러그인 opt-in 및
  실제 Expo introspection의 세 플래그 결과를 통과했다. 서명된 설치·실기기 권한은 미검증이다.
- 독립 창 `NoLate Subway Saved E2E 20261014`와 격리 H2 서버에서 이번 회차도
  CoreSimulator 연속 주입 위치로 자동 출발 1회, 공식 열차 조회→native 입력을 확인했다.
  그 시점의 같은 열차에서 연속 대기 근거가 부족해 `TRAIN_ASSOCIATION_AMBIGUOUS`였고,
  신선한 공식 현재역이 상세·잠금 카드에 동시에 표시되는 조건은 **여전히 미통과**다.
  열차 원문/키/승객 좌표는 증거로 남기지 않았다. 이전 `RIDING` 회차를 지우거나
  이번 실패를 실제 GPS 문제로 단정하지 않는다.
- 최신 합성 5구간 계약을 서명된 Debug 시뮬레이터 앱·격리 H2 서버·승인된 단일 시험
  설치로 재실행했다. 저장 fixture의 실제 APNs 연결 후 CoreSimulator 연속 주입 위치로
  `ARMED→ACTIVE`와 자동 출발 1회를 확인했다. provider 시도/수락은 종료 전
  `39/39`, 거절 `0`이었고, 독립 창 잠금 카드에 `버스 대기 · 도착하면 탑승 준비`,
  현재 화살표와 5구간 색상 바, `버스 도착까지 1분`이 표시됐다. 앱 프로세스를 종료한
  뒤에도 카드가 유지됐으며 인증된 서버 원격 END HTTP 200/`STOPPED` 후 provider
  누적 `40/40`, END 수락 `1`, 거절 `0`, 잠금 카드 제거를 직접 확인했다. 같은 END를
  한 번 더 보내도 HTTP 200/`STOPPED`였고 provider 시도·수락·END 계수는 그대로였다. 응답의
  `deviceVerified=false`는 별도 값이므로 수락 카운터와 잠금 화면을 함께 판정했다.
  이는 **합성 일정·주입 위치의 단일 독립 시뮬레이터 실제 APNs E2E**다. 실제 사용자
  로그인·저장 일정/공식 공급자 완주·실기기 GPS나 실제 단말 수신으로 승격하지 않는다.
- 시험 상세 화면의 terminal effect가 같은 `STOPPED`/`EXPIRED` snapshot 새 객체마다
  종료 callback을 다시 부를 수 있던 점을 1회 처리로 정리하고 회귀 테스트를 추가했다.

## 지하철 피드 공백 표시 보강 — 2026-10-15

- native가 승객 GPS와 열차 정차 순서로 **검증한 마지막 역과 확인 시각**만 최대 90초 보존한다.
  신선한 엔진 위치가 끊기면 상세·Live Activity에 `마지막 확인 · 역명`과 재확인 중 문구를
  표시하되, 경로 바의 **현재 위치 마커와 현재역 단정은 제거**한다. 다른 경로의 역·오래된
  이력·승차 미확정 상태는 이 표시로 승격하지 않는다. 서버 원격 Activity 계약에서도
  같은 소유 저장 경로의 원본 정차 순서·역명·90초 경계를 검사한다.
- 독립 창 `NoLate Subway Saved E2E 20261014`(iOS 26.5), 격리 H2 서버의 합성 열차,
  CoreSimulator 연속 주입 GPS로 버튼 없이 `ARMED→ACTIVE`, `WAITING→RIDING`,
  `합성 중간역`을 확인했다. 이후 실제 상세 컴포넌트의 `마지막 확인 · 합성 중간역`,
  `현재 위치 재확인 중`, `신선한 엔진 위치 없음`을 접근성 트리에서 확인했다.
  [잠금 카드의 마지막 확인 역](evidence/journey-subway-last-verified-20261015/01-lock-last-confirmed.png)은
  현재 위치 마커 없이 표시됐고, [90초 이후 카드](evidence/journey-subway-last-verified-20261015/02-lock-history-expired.png)는
  이력 역명을 지웠다. 합성 피드/주입 GPS의 **화면 상태 전환 E2E**이며 공식 열차·현장 GPS·
  이번 회차의 실제 APNs 전달 증거가 아니다.
- Swift 정책 384 test, 상세·위치·접근성 관련 JS 6 suite/77 test·TypeScript 검사, 서버 원격 Activity 계약 테스트,
  iOS Simulator Debug 빌드를 통과했다. Live Activity 경로 바 접근성 문구는 지하철
  탑승 시 `버스 이동 구간`으로 읽던 오류를 `지하철 이동 구간`으로 수정했다.

## 공식 열차·독립 시뮬레이터 재검증 — 2026-10-15

- 기존 독립 창 `NoLate Subway Saved E2E 20261014`(iOS 26.5), 격리 H2 시험 서버,
  서울 공식 실시간 열차 응답, CoreSimulator 연속 주입 GPS를 사용했다. 운영 DB·실사용
  일정·실기기 GPS·이번 회차의 실제 APNs는 사용하지 않았다.
- 위치 이동만으로 `ARMED→ACTIVE` 및 자동 출발 1회를 확인했다. 공식 열차 `2243`의
  강남역 방면 일치·도착 행(04:30:21 UTC), 역삼역 도착 행(04:32:08 UTC)이 같은
  소유 세션에 들어왔고, 독립 창에서 **`RIDING · STATION_SEQUENCE_AND_TRAIN_CORRELATED`,
  현재역 `역삼`, `다음 역 하차 · 하차 준비`**가 표시됐다. 이전 회차의
  `RIDING` 미통과 항목은 이 시험 범위에서 해소됐다.
- 상세 화면을 열었을 때는 공식 열차 행의 유효 시간이 지나 `신선한 엔진 위치 없음`과
  `위치 확인 중`이었다. 독립 창의 잠금 화면 **로컬 Live Activity 카드가 표시**되고
  탭으로 앱에 복귀했지만, 카드 역시 `위치 확인 중`/`위치 정보 업데이트 필요`를 보였다.
  따라서 **실제 열차의 동일 현재역·마커가 상세와 잠금 카드에 함께 표시되는 조건은
  이번 회차 미통과**다. 신선도 하락 시 현재역을 계속 단정하지 않는 실패 안전 동작만
  확인했다. 기존 v8 실제 APNs 시험을 이번 로컬 카드 관측으로 대체하지 않는다.
- 상세 화면에서 홈 화면·Safari를 거쳐 시험 화면에 재진입한 뒤
  `LOCATION_TEMPORARILY_UNAVAILABLE`과 새 GPS 근거 부족이 관측됐다. 이 절차가
  원인인지 확정하지 못했으며, 선릉역에서도 같은 열차의 현재역 표시를 재확정하지
  못했다. 시험 종료 요청은 격리
  서버에서 인증된 `stop` HTTP 200으로 확인했다. 코드 변경 없이 E2E만 다시 실행했으며,
  현장 GPS·Release 제품 경로 검증은 여전히 남는다.

## 이전 공식 열차·독립 시뮬레이터 회차 — 2026-10-15

아래 `RIDING` 미통과는 바로 앞선 회차의 기록이다. 현재 판정은 위 재검증과 표를 따른다.

- 같은 독립 창 `NoLate Subway Saved E2E 20261014`(iOS 26.5)과 격리 H2 서버를 사용했다.
  공식 서울 열차 응답과 CoreSimulator의 **연속 보간 GPS**를 결합했고, 버튼 없이
  `ARMED→ACTIVE` 자동 출발 및 실제 열차 행에 따른 `WAITING · SUBWAY_BOARDING_NOT_CONFIRMED`를
  화면에서 재확인했다. Device Hub 내장 화면, 실기기 GPS, 운영 DB, 실제 APNs는 쓰지 않았다.
- 오류를 재현해 native에서 수정했다. 위치 콜백의 중복/역순 시각은 새 이동 증거로
  세지 않되 검증된 이력을 지우지 않는다. 열차 공급자 응답이 비는 동안에도 원본 GPS를
  빈 열차 입력으로 처리해 연속성을 유지한다. 이미 검증된 승차역 대기 이력은 열차 행
  소실 후 승차역 반경을 벗어날 시간을 최대 90초 준다. 이 세 경우 모두 **같은 열차의
  다음 역 정차와 승객 GPS가 함께 나오기 전에는 `RIDING`으로 승격하지 않는다**.
- Swift 정책 전체 **384 test/0 failure**, iOS Simulator Debug 빌드 성공,
  `git diff --check` 통과. 짧은 피드 공백·중복 시각·90초 이후 폐기 회귀를 포함한다.
- 최종 실제 피드에서 열차 `3177`의 강남역 행으로 `WAITING`을 보았고, 출발 뒤
  응답 공백/주입 GPS 이동 중 `TRAIN_PASSENGER_CORRELATION_REQUIRED`를 유지했다.
  이후 같은 열차의 **역삼역 도착 행을 확보하지 못한 채 선릉역 행**이 관측됐다. 초기 탑승 확인에 필요한
  `index 1` 역삼 정차 증거가 없어서 `RIDING`은 표시하지 않았고, 상세와 잠금 카드의
  현재역 일치도 합격으로 판정하지 않았다. 이는 피드가 그 시점의 중간역 행을 제공하지
  않은 관측 결과이며 엔진 성공으로 둔갑시키지 않는다.
- 다음 실제 피드 수용 조건은 같은 열차의 **승차역 대기→역삼 정차**가 한 소유 세션에서
  신선하게 연속 관측되고, 그때 원본 GPS가 역삼 인근에 있어 native `RIDING`과 상세·잠금
  카드의 동일 현재역/마커를 확인하는 것이다. 합성 응답 E2E와 이전 v8 APNs 검증은
  별도 증거로 유지한다.

## 공식 열차→native→화면 연속 검증 — 2026-10-14

- 독립 창 `NoLate Subway Saved E2E 20261014`(iOS 26.5)과 격리 H2 시험 서버에서
  공식 서울 2호선 강남→역삼→선릉 경로, 실시간 열차 응답, 시뮬레이터 주입 GPS를
  같은 자동 안내 세션에 연결했다. 운영 DB·실사용 일정·실기기 GPS·실제 APNs는
  이 시험에 사용하지 않았다.
- 이전 반복 실패의 직접 원인은 시험 서버의 요청 시작 시각 고정 시계였다. 공식
  공급자 응답 수신 시각이 그 고정 시각보다 뒤여서 matcher가 모든 열차를 거부했다.
  시험 전용 공식 adapter의 검사 시계를 실제 시각으로 바꾼 뒤, 강남역 신선한
  공식 열차 행(원천 시각 15초 경과)이 `TRAIN_REFERENCES_ONLY`, native 입력 생성,
  독립 시뮬레이터 `WAITING · SUBWAY_BOARDING_NOT_CONFIRMED`로 연결됐다.
- 이후 같은 열차의 역삼역 도착 응답과 연속 주입 GPS를 제공했으나 native 결과는
  `BOARDING_HISTORY_REQUIRED`였고 `RIDING`은 확인되지 않았다. 상세 경로와
  잠금 화면의 **로컬** Live Activity는 모두 `위치 확인 중`/`위치 정보 업데이트 필요`로
  미확정 상태를 표시했으며 승객 마커를 임의로 전진시키지 않았다. 이는 화면 간
  실패 안전성 증거이지 실제 열차 탑승·중간역 위치 표시 성공 증거가 아니다.
- `automaticJourney`, `liveActivityRoute`, `liveActivityVisualContract` JS 회귀
  3 suite/70 test와 서버 matcher·공식 catalog·열차 parser 3 suite/41 test가 통과했다.
  이번 원격 APNs 전달/실기기 GPS는 범위 밖이다.

## 열차 위치 연결 방식 수정 — 2026-10-14

- `realtimeStationArrival/ALL`이 전체 역 사전일 것이라는 가정을 제거했다. 저장 구간과
  같은 날 공식 경로의 역명·역 코드·정차 순서·방면·종착 및 공식 역사 좌표를 먼저 검증한다.
  공식 경로 API가 야간 현재 시각에 빈 경로를 줄 수 있어, 정차 계통 조회만 서울 현지
  날짜 정오로 고정한다. **열차 관측 시각·신선도는 현재 시각 그대로** 판정한다.
- `realtimePosition`의 신선한 열차 행에서 현재 역의 호선·역명·코드 끝자리와 종착역
  이름·코드를 모두 맞춘다. 코드 끝자리만 맞거나 역명·종착이 다르면 후보가 아니다.
  코드를 합성해 열차 ID로 저장하지 않으며, 원본 승객 GPS와 native 탑승 판단은 별도다.
- 실제 키를 넣은 opt-in 시험에서 강남→선릉 저장 fixture의 공식 경로가 도착정보
  일괄 조회 없이 생성됐고, 서울 실시간 열차 위치 응답 `AVAILABLE` 14행 중 경로
  조건에 맞는 열차로 `TRAIN_REFERENCES_ONLY`, `nativeInput=true`를 확인했다.
  **실제 사용자 탑승·승객 위치 확인이나 시뮬레이터 화면 E2E가 아니다.**
- BE 저장 소유 경로/JPA·역명/종착 불일치 차단 등 관련 46 suite/303 test,
  native 4자리 공식 역 코드 입력 소비를 포함한 Swift 378 test를 통과했다.
  실제 열차→독립 시뮬레이터 화면 E2E는 이 시점에 아직 실행하지 않았다. 운영 플래그,
  운영 DB, `.env`, 실기기는 변경하지 않았다.

## 공식 열차 피드·독립 시뮬레이터 연결 재시험 — 2026-10-14

- 격리 H2 서버의 opt-in 저장 경로를 강남→역삼→선릉 2호선으로 만들었다. 저장 원본
  `routingStationID` 222/223/224와 서울 공식 역 코드 0222/0221/0220은 다른
  namespace로 유지한다. 초기 시험에서 이를 혼동해 공식 조회 전에 차단된 결함을 고쳤다.
  공식 경로·역 좌표·현재 열차 위치는 실제 서울 API를 조회하고, 승객 경로와 GPS는
  시험용이다. 키·운영 DB·실사용 일정은 변경하지 않았다.
- 실제 키를 사용하는 opt-in 백엔드 검사 2건은 통과했다. 새 저장 경로 검사에서
  `pattern=true`, `TRAIN_REFERENCES_ONLY`, `nativeInput=true`를 한 시점에 확인했다.
  이는 공식 열차 관측을 native 입력으로 변환할 수 있다는 증거이지 승객 탑승 증거가 아니다.
- 독립 창 `NoLate Subway Saved E2E 20261014`에서 시험 경로를 연결한 후 CoreSimulator
  주입 좌표 이동만으로 `ARMED→ACTIVE` 자동 출발을 확인했다. 서버의 공식 열차 조회도
  호출됐다. 그러나 화면에서 공식 열차에 따른 `RIDING`/현재역 갱신은 확인하지 못했다.
  이어진 실제 응답은 원천 수신 시각이 30초 조건을 넘거나 저장 구간과 맞지 않아
  `SERVICE_PATTERN_OR_FRESHNESS_MISMATCH`, native 입력 없음으로 안전 차단됐고
  시험 세션은 만료됐다. 호출 횟수만으로 안내 성공을 주장하지 않는다.
- 이 검증은 **독립 시뮬레이터 전체 공식 피드 E2E 미통과**다. 실제 GPS 시험은 사용자가
  실기기에서 진행할 예정이며 이번에 시도하지 않았다. 다음 수용 조건은 운행 중 신선한
  실제 응답을 native가 소비해 상세·잠금 화면까지 상태가 바뀌는 장면을 같은 소유 세션에서
  확인하는 것이다. 신선도 기준을 낮추거나 재생 데이터를 실시간 응답으로 표기하지 않는다.
- 이번 변경 후 FE fixture 인증 12개, 추가 관련 FE 101개 및 TypeScript 검사,
  BE 공식 패턴/서비스/소유권 관련 4개 테스트 클래스를 통과했다. 실제 APNs·실기기·
  운영 설정은 이번 시험의 범위에 포함하지 않았다.

## 저장 경로 연결·새 독립 시뮬레이터 재검증 — 2026-10-14

- 소유 계정의 일정 상세에서 단일 지하철 구간도 내부 미리보기 자격증명 없이
  도보 공급자 연결·안내 경로 검사로 진입하도록 연결했다. `__DEV__`, iOS, 명시적인
  `EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED=true` 및 기존 서버·native
  소유권/경로 fence는 유지한다. 일반 출시 화면이나 실기기 runtime을 연 것은 아니다.
- 독립 창 `NoLate Subway Saved E2E 20261014`(iOS 26.5, 새 설치)에서 합성 소유 경로를
  H2 격리 서버에 연결했다. CoreSimulator GPS로 `ARMED → ACTIVE` 자동 출발을 확인했고,
  별도 열차 시계와 승차역 정차 이력을 준 뒤 `RIDING · STATION_SEQUENCE_AND_TRAIN_CORRELATED`,
  [중간역·다음 역 하차·경로 바 마커](evidence/journey-subway-saved-20261014/01-mid-station.png)를 확인했다.
  이 입력은 실제 사용자 일정/현장 GPS/서울 실시간 열차가 아니다.
- 같은 실행에서 상세 화면의 신선한 엔진 위치는 유지되지 않았다. 현재 위치는 숨기고
  “위치 정보 업데이트 필요”로 전환했으며 [잠금 카드도 마커를 숨겼다](evidence/journey-subway-saved-20261014/02-lock-stale.png).
  따라서 **상세+잠금 화면의 연속 위치 표시 E2E는 이번 재검증에서 미통과**다.
  600초짜리 시험 인증 토큰이 만료되자 `AUTOMATIC_AUTH_EXPIRED`로 종료·카드 제거됐다.
  이 새 설치에서는 실제 APNs를 재발송하지 않았다.
- 공식 최단경로 키로 강남→역삼→선릉 및 성수행 전체 정차 순서를 주간 시각에 재조회했고,
  저장 구간 이름·호선·방면·역 좌표 비교를 통과했다. 새벽의 현재 시각 조회는 HTTP 200/성공
  안에 경로가 없었으며, 실시간 ALL 도착 피드의 전체 역 ID 대응은 성립하지 않았다.
  따라서 이번 실요청은 `realtimeCrosswalk=UNAVAILABLE`, native 입력 없음으로 안전 차단됐다.
  주간 경로 계약 성공을 실제 열차 탑승·실시간 안내 성공으로 세지 않는다.
- 관련 FE Jest 4 suites/58 tests와 TypeScript, BE 격리 JPA 및 실공급자 진단 테스트,
  양쪽 `git diff --check` 통과. 새 실공급자 진단은 주간 경로/좌표와 야간 fail-closed를
  구분한다. 운영 DB·운영 설정·`.env`·실기기는 변경하지 않았다.

## 이번 실제 APNs 잠금 화면 검증 — 2026-10-13

지정된 독립 `NoLate Mixed Journey E2E 20261012` 시뮬레이터의 설치 한 대를 지문으로 고정하고,
현재 제품 `JourneyActivityDeliveryService`의 v8 계약을 실제 Firebase/APNs sender에 연결했다.
Debug 시험에서 첫 카드 생성 뒤 로컬 `Activity.update`를 꺼 두었다. CoreLocation에 주입한
GPS와 독립 합성 열차 시계로 만든 상태만 사용했으며, 실제 서울 열차 응답/현장 GPS는 아니다.

- [초기 잠금 카드](evidence/journey-v8-real-apns-20261013/01-lock-initial-card.png)에서
  [승차역 원격 갱신](evidence/journey-v8-real-apns-20261013/02-lock-remote-boarding-update.png),
  [v8 합성 중간역·다음 역 하차·마커 이동](evidence/journey-v8-real-apns-20261013/03-lock-remote-v8-middle-station.png)을 독립 창에서 확인했다.
- 종료 직전 서버 실제 provider 결과는 UPDATE 19건(상태 스키마 1 13건·v8 6건), 거절 0건이었다.
  앱을 전환기에서 닫은 뒤에도 [잠금 카드가 유지](evidence/journey-v8-real-apns-20261013/04-lock-card-after-app-closed.png)됐다.
- 앱을 다시 실행하지 않고 같은 소유 세션에 원격 END를 요청했다. 서버 `STOPPED` 및 영속 END
  `ACCEPTED`, 실제 발송 총 20건/END 1건을 확인했고 [잠금 카드가 제거](evidence/journey-v8-real-apns-20261013/05-lock-card-removed-after-remote-end.png)됐다.
  동일 END 재요청은 200을 반환하며 발송은 20건/END 1건 그대로였다.
- 첫 재캡처에서 QA 화면의 “원격 연결 설정됨” 표시가 이전 종료 세션의 값으로 남았지만 native pilot은
  `OFF`여서 원격 카드가 생성되지 않았다. 새 세션 시작 전에 실제 APNs를 다시 설정해 위 결과를
  얻었고, 종료·경로 재불러오기 시 QA 표시도 초기화하도록 수정했다.
- 이 검증은 한 설치의 합성 경로 v8 UPDATE/END 수신과 잠금 화면 제거를 닫는다. 서버 재시작 중
  실제 APNs 전달, 다중 구간 v7, 실기기 잠금/무음 및 실제 교통 데이터는 이 결과에 포함되지 않는다.
- Swift 378개, 관련 FE 82개와 TypeScript, 관련 BE 7개 및 iOS 서명 시뮬레이터 빌드가 통과했다.
  종료 후 QA 표시 수정과 provider 오류 비노출 검사를 더한 뒤 FE 73개/TypeScript 및 BE 3개를
  다시 통과했고 양쪽 `git diff --check`도 통과했다. source Info.plist 해시는 기존 값 그대로다.

## 남은 필수 연결

**실제 사용자 저장 경로와 운행 시간의 신선한 열차 관측으로 상세·잠금 화면의 연속 위치를
재검증해야 한다. 그 후 별도 제한 실기기 Debug 빌드가 필요하다. 현재 native는
`DEBUG && targetEnvironment(simulator)`에 묶여 있으므로 이번 결과만으로 실기기 시험은 할 수 없다.**
아래는 이 연결의 2026-10-13 기준 기반 구현 설명이다.
공식 HTTPS 최단경로, 서울시 실시간 도착정보의 역 ID 및
[서울교통공사 1~8호선 공식 역 좌표](https://www.data.go.kr/data/15099316/fileData.do)를 저장 구간에 대조하는
기본 OFF의 on-demand catalog를 서버에 연결했다. 전체 저장 역명·호선·순서,
ODsay 방면/역 좌표, 공식 종착역까지의 정차 순서 및 역 ID가 모두 맞을 때만 열차
관측 후보를 만든다. 강남→선릉 저장 fixture로 실서비스 계약은 통과했지만,
실제 사용자 저장 경로나 승객 탑승·화면 E2E를 증명한 것은 아니다.
`SubwayObservationConfiguration`에 서버 소유 검토 파일을 읽는 `journey.subway-observation.catalog-file` 연결을 추가했다.
파일 크기·출처/해시 메타데이터·검토 시각·유효기간·역/계통 구조를 검증하지만,
**해시나 loader만으로 공식 대응이 인증되는 것은 아니다. 실제 검토 파일은 아직 설치하지 않았다.**
catalog가 없으면 빈 fallback을 사용하며,
기존 조회 응답은 `navigationReady=false`, 승객 탑승 false/위치 null이다.
새 `/subway-observation/input`은 같은 소유권·세대·변경/취소 fence를 통과한 경우에만 원래
열차 시각과 저장 경로에 대응한 역 목록을 native에 전달한다. 이 입력도 승객 탑승 판정은 아니다.
native는 승차역 대기 이력, 연속 GPS 이동과 같은 열차의 다음 역 도착을 함께 확인하며,
초기 연결은 첫 지하철 구간만 지원한다. 터널에서 열차 시계만으로 승객 마커를 전진시키지 않는다.
첫 지하철 구간의 소비 화면은 v8 현재역/다음역 상태에 연결했다. 환승·하차 확정/최종 도보는
아직 연결하지 않았고 일반 제품 진입의 지하철 차단도 유지했다. 합성 경로는 내부 QA에서만 허용한다.
endpoint 성공만으로 길안내 완료가 될 수 없다.
실제 조회에서는 근처 열차 응답의 원천 시각이 30초 신선도 기준을 넘는 경우가 있었다.
이때 탑승 후보를 만들지 않는 정책을 유지한다. 열차 행이 보인다는 이유로 기준을 완화하지 않는다.
실서비스 opt-in 검사는 공식 경로→저장 fixture→일괄 도착 ID→열차 공급자까지 통과했고,
관련 BE 회귀는 94개 suite/630개 test, 실패 0건이었다(실서비스 opt-in 3건은 이 회귀에서
건너뛰어 별도로 실행). 이는 독립 시뮬레이터 제품 경로 E2E가 아니다.
마지막 실서비스 조회의 열차 공급자는 `AVAILABLE`이었지만 해당 저장 구간과 신선도 조건을
동시에 만족하는 열차는 없어 `SERVICE_PATTERN_OR_FRESHNESS_MISMATCH`, native 입력 없음이었다.
독립 `NoLate Mixed Journey E2E 20261012` 기기는 Device Hub 내장 화면이 아닌 분리 창으로
다시 열었다. 이후 별도 독립 창에서 공식 adapter와 시험 저장 일정·주입 GPS를 연결해
자동 출발 및 공식 조회 호출까지 실행했으나, 실제 응답 기반 화면 전환은 위 재시험처럼 미통과다.

2026-10-13 실제 공급자 확인에서 ODsay의 [관리자 답변](https://lab.odsay.com/community/boardView?seq=699)은
길찾기 지하철역 ID를 내부 ID로 설명하고 외부 공공 API 호출에는 사용할 수 없다고 명시했다.
현재 iOS 키의 서버측 `subwayStationInfo` 세 번은 모두 HTTP 200 안의 `ApiKeyAuthFailed`였다.
반면 서울 실시간 열차 API `realtimePosition/2호선`은 한 번의 공식 HTTP 요청에서
`INFO-000`, 총 45행, `statnId`·`statnTid`·방면·정차상태와 날짜/시간 필드를 반환했다.
이 확인은 **열차 공급자 응답 계약 일부**이며 승객 탑승/경로 대조/잠금 화면의 실제 노선 E2E가 아니다.
서울 공식 HTTPS 경로 두 방식은 제한 시간 내 응답하지 않았다. 현재 서버의
`SEOUL_ALLOW_INSECURE_HTTP=false` 경계는 유지하며 운영에서 평문 키 전송을 자동 허용하지 않았다.
별도 [서울교통공사 최단경로이동정보](https://www.data.go.kr/data/15143842/openapi.do)가
정차역과 환승을 제공한다. 공개 Swagger에서 `getShtrmPath2` 요청·응답 계약을 확인해
서버의 별도 HTTPS 조회·보수적 파서를 구현하고 로컬 HTTP 계약 검사를 통과했다.
2026-10-13 사용자가 `NoLate_BE/env.local.properties`에 등록한 키로 공식 HTTPS를
실제 조회했다. 강남→역삼은 `0222→0221`, 강남→서울역은 12개 구간과
2호선 사당 `0226`→4호선 사당 `0433` 환승 구간을 반환했다. 실제 성공 코드는
문자열 `"00"`이고 역 코드는 0으로 시작하므로 파서의 이전 잘못된 가정을 수정했다.
BE 회귀 테스트와 opt-in 실서비스 계약 검사 1건(`skipped=0`)을 통과했다.
이후 저장 구간의 전체 역명/노선/순서와 공식 경로를 대조하는 후보 검사와,
서울시 일괄 도착 API의 역명/호선/실시간 ID 충돌·코드 불일치를 거부하는 일회성
correlator를 추가했다. 두 로컬 계약 검사도 통과했다. 아직 해당 일괄 API의
인증된 실응답·일반 제품 진입·독립 시뮬레이터 경로 E2E는 확인하지 않았다.
관련 BE 회귀 실행은 45개 suite/284개 test, 실패 0건이었다. 이 실행에서
실서비스 키가 필요한 opt-in 검사는 건너뛰었고, 별도 키 주입 실행은 앞서 1건 통과했다.
이후 BE 로컬 설정의 `SEOUL_SUBWAY_API_KEY`로 서울시 `realtimeStationArrival/ALL`을
재조회했다. 첫 응답은 HTTP 307로 같은 공식 호스트의 키가 없는 데이터 파일을 가리켰고,
그 대상만 별도 조회해 `INFO-000`·2,994행을 확인했다. 갱신 중인 실시간 피드라 다음
조회는 2,983행이었다. 이전의 짧은 HTTP 200 응답만 보고 키가 무효라고 판단한 것은
잘못이었다. 인증 키·원문 응답·전체 리다이렉트 URL은 기록하지 않았다.
추가한 opt-in 실서비스 계약 검사와 기존 단위 검사 4건은 실제 응답으로 통과했다.
검사는 기존에 확인된 공식 경로 강남 `0222`→역삼 `0221`과 2호선 사당 `0226`→4호선
사당 `0433`에 대해 각각 `1002000222`→`1002000221`, `1002000226`→`1004000433`을
호선·역명·코드 끝자리로 대조한다. 동일 역명인 사당의 호선 충돌도 분리된다.
이후 기본 OFF on-demand catalog가 강남→선릉 저장 fixture의 모든 역과 성수 종착까지의
공식 정차 순서·방면, 공식 역사 좌표를 실서비스 응답으로 대조하도록 연결했다. 이는 **한 구간의
실데이터 후보 대조**이지 전체 노선 승인이나 승객 탑승 판정이 아니다. 서버 운영 기본
HTTP 거부는 유지했고 일반 제품 진입·독립 시뮬레이터의 실제 경로 E2E는 아직 연결하지 않았다.
서울 공식 역 목록의 2호선 역삼은 `STATION_CD=0221`, 열차 위치의 역삼은
`statnId=1002000221`이었다. **두 값의 관계를 추정해 제품에 연결하지 않는다.**
ODsay 내부 ID를 추측으로 매핑하는 대신 지하철 구간만 독립 공급자 경로로 전환하려면,
공식 코드 대응과 실제 저장 경로/열차 대조가 여전히 필요하다. 실서비스 **경로 API 조회**는
완료했지만 일반 제품 지하철 진입·독립 시뮬레이터 경로 E2E 완료로 세지 않는다.

ODsay 공식 `subwayStationInfo`의 이전/다음 역 ID·좌표 계약을 확인했다.
이는 인접 순서 검증 후보 자료이지, 서울 STATN_ID나 완전한 종착/급행 계통 대응의 증명이 아니다.
당시 기록에서는 키 조회를 실행하지 않았고, 이후 위에 적은 서버측 iOS 키 진단 3회를 수행했다.
뒤의 순서는 실제 자료/응답 대조→하차·최종 도보·환승 완성→실제 제품 경로→남은 다중 구간 APNs·재시작 시나리오→실기기 시험 경로다.
운영 ON으로 simulator-only 코드나 없는 데이터를 해결하지 않는다.

## 기준 증거 — 재실행이 아닌 기존 기록

- [공식 지하철 자료/소유 세션 조회의 범위·미연결 조건](journey-owned-subway-observation-validation-20261013.md)
- [독립 역/분기/급행 resolver 범위](journey-subway-catalog-validation-20261013.md)
- [실제 상세 렌더러의 합성 GPS·지도·잠금 E2E](journey-product-detail-validation-20261013.md)
- [최신 혼합 Activity API·가짜 sender·영속 종료 E2E](journey-mixed-activity-offline-validation-20261013.md)
- [제품 채널 설정 및 권한 검증](journey-product-notice-controls-validation-20261013.md)
- [장시간 시험과 인증 만료 실패/후속 수정](journey-extended-navigation-validation-20261013.md)
- [운영 DB 적용 완료·백업 위치](journey-production-migration-20261013.md)
- [실기기 오류 확인 절차](journey-device-validation-runbook.md)

직전 자동 검사의 범위: BE journey/transit/Live Activity 관련 회귀, FE 전체/타입 검사 PASS.
검사 개수는 각 기록의 실행 이력으로 보존하며 기능 완성률로 환산하지 않는다.
새 변경에는 필요한 관련 검사를 다시 실행하고 그 변경의 증거만 추가한다.

## 이번 반복 원인 수정

1. 핵심 연결 지연: 다음 작업을 위 공식 데이터 연결로 고정했다. 연결되지 않은 지하철
   승객 판단과 simulator-only 경계를 명시했다. **그 기술적 미연결 자체가 해결된 것은 아니다.**
2. 증거 혼동: 현재 표에서 구현/합성/실제 공급자/APNs/현장을 분리했다. 앱 진단의
   “모든 탑승/환승 미지원” 문구도 버스 시험 부분 구현·지하철 미연결·실기기 미연결로 분리했다.
3. 끝없는 세분화: 누적 “최신” 기록은 원문 그대로 별도 보존하고, 현재 표를 갱신하는 방식과
   고정 완료 조건을 채택했다. 핵심 의존성이 막히면 무관한 작은 작업을 만들어 계속하지 않는다.

현재 전체 기능 완료/실기기 시험 준비 완료로 보고하지 않는다.

## 이번 핵심 연결 수정과 검증 — 2026-10-13

실제 실행 중 발견해 고친 결함은 다음과 같다. 단순 테스트 추가를 연결 완료로 세지 않는다.

- native 공통 HTTP allow-list가 `/subway-observation/input`을 누락해 서버 요청이 전혀 발생하지 않았다.
  인증 세션에서만 이 정확한 경로를 허용하고 임의 suffix/다른 scope는 계속 거부한다.
- 서버 저장 입력 검사가 지하철 `routingStationId`를 누락해 정상 native 입력의 prepare를 거부했다.
  저장 원본 ID와의 정확 비교를 추가했다. ID 변경 입력은 여전히 거부한다.
- 지하철 근거가 만료됐는데 첫 도보 표시로 되돌아갈 수 있었다. 지하철 판단을 시작한 뒤에는
  근거가 없으면 마커 없는 불확실 표시로 전환한다.
- 탑승 확정 뒤에도 최초 대기부터의 평균 속도를 계속 검사해 오래 정차하면 탑승이 풀렸다.
  최초 탑승에만 속도 증거를 요구하며, 확정 후에도 같은 열차/역·신선한 GPS 조건은 유지한다.

새 native v8 상태를 FE 상세/목록/경로 바·로컬 Activity와 서버 Activity 계약에 연결했다.
서버는 소유 세션 fence뿐 아니라 저장 경로의 해당 지하철 구간·역 수·현재/다음역 이름도 대조한다.
일반 제품의 지하철 진입 차단이나 운영 기본값은 변경하지 않았다.

최종 새 빌드의 독립 창 `NoLate Mixed Journey E2E 20261012`에서:

- 준비는 ARMED, 출발 버튼 없이 주입 GPS 이동으로 ACTIVE. 서버 prepare 4회 중 최종 세션의
  출발은 1회이며 누적 departureCount는 3이다. 이전 시험 세션은 정상 종료했다.
- 인증 native HTTP가 실제 loopback 서버의 지하철 provider를 호출했다(관찰 시 누적 53회).
  이 숫자는 실제 서울 API 호출이나 승객 탑승 성공 개수가 아니다.
- 별도 합성 열차 시계 + 승차역 대기/GPS 연속 이동으로 `RIDING`, `STATION_SEQUENCE_AND_TRAIN_CORRELATED`.
  [현재역·한 역 전 안내](evidence/journey-subway-connected-20261013/02-final-current-station.png),
  [실제 상세·목록·엔진 좌표](evidence/journey-subway-connected-20261013/03-real-detail-current-station.png),
  [독립 잠금 카드의 같은 현재역/마커](evidence/journey-subway-connected-20261013/04-lock-current-station.png).
- 잠금 상태에서도 다음 GPS/열차 대응을 받아
  [하차역 위치·하차 확인 중](evidence/journey-subway-connected-20261013/05-lock-alighting-station.png)으로 갱신했다.
  **하차역 위치와 실제 하차 확정은 다르다.**
- 주입 GPS를 끊은 뒤 [잠금 카드 마커 숨김](evidence/journey-subway-connected-20261013/06-lock-location-stale.png),
  [상세의 엔진 위치 제거](evidence/journey-subway-connected-20261013/07-detail-location-stale.png),
  `SUBWAY_EVIDENCE_STALE`을 확인했다. 열차 시계만으로 승객 마커를 전진시키지 않았다.
- 정상 종료 후 native STOPPED·종료 대기 0, 서버 `lastState=STOPPED`와
  [잠금 카드 제거](evidence/journey-subway-connected-20261013/10-lock-card-removed.png)를 확인했다.
  마지막 서버 provider 요청 누적은 64회이며 종료 후 새 요청이 필요한 상태는 아니다.
- 음성+알림 채널의 시스템 알림 접수 3회·음성 큐 2회를 확인했다.
  실제 음성 청취·알림 표시·실제 APNs 성공 증거로는 세지 않는다.
- Swift 377 tests, 최신 변경 BE 4 suites/47 tests, FE 상태/소비·채널 검사 10 suites/215 tests,
  TypeScript 및 iOS Debug build PASS. catalog loader 관련 3 tests도 별도 PASS.
  검사 개수는 기능 완성률이 아니다. 최초 E2E prepare/전송 실패를 위 수정 뒤 다시 확인했다.
- 새 빌드 artifact에만 시험 gate와 location/audio background mode를 적용했다.
  source Info.plist SHA-256 `7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359` 유지.
  `.env`·운영 DB·운영 재기동/ON·실기기는 변경하지 않았다.

## 이전 수정 검증 — 범위 참고

- 지하철 초기 native 연결: Swift 전체 회귀 및 iOS simulator Debug 빌드 확인.
  서버 관련 4 suites/43 tests, FE 관련 3 suites/70 tests 및 TypeScript PASS.
  새 native 테스트의 최초 2건은 합성 도보 fixture의 필수 공급자 증거 누락으로 실패했고,
  fixture를 수정했다. 실제 admission 검사는 완화하지 않았다. 대기 후 GPS가 끊겼다가
  다음 역에 나타나는 경우 탑승을 잘못 확정하지 않도록 이력 초기화도 검사했다.
  열차 ID/실시간 역 대응은 checkpoint에 저장하지 않으며 복원 후 새 증거가 필요하다.
  **이 변경은 실제 공급자 조회·native HTTP 왕복·독립 시뮬레이터 화면 E2E/APNs 통과가 아니다.**
  새 빌드 설치나 기존 시뮬레이터 상태 변경, 운영 설정/DB 변경은 하지 않았다.
- 상태 판정/화면 관련 Jest 2 suites / 15 tests PASS, TypeScript PASS, `git diff --check` PASS.
  최초 명령은 셸 PATH에 npm이 없어 실행되지 않았고, 설치된 Homebrew 경로를 지정해 실행했다.
- 지정된 `NoLate Mixed Journey E2E 20261012` 독립 창에서 새 번들로 재실행했다.
  딥링크 첫 입력이 `internal/journey`로 잘려 Unmatched Route가 표시됐으며, 전체 URL을
  입력 필드에서 확인한 뒤 재진입했다. 새로고침으로 IDLE/안내 관측 없음/APNs 미검증과
  버스 PARTIAL·지하철 UNSUPPORTED·실기기/Release UNSUPPORTED를 AX 및 실제 화면에서 확인했다.
  [읽기 전용 상태](evidence/journey-delivery-reset-20261013/01-readonly-current-state.png),
  [버스/지하철/실기기 범위 분리](evidence/journey-delivery-reset-20261013/02-transit-subway-device-scope.png).
- 이번 E2E는 **상태 표시 수정** 검증이다. 새 GPS 완주/실제 공급자/APNs/실기기 검증은 아니다.
  DB 재마이그레이션·운영 재기동/ON·`.env`·source Info.plist 변경은 하지 않았다.
