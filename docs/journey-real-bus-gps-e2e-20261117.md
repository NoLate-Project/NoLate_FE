# 실제 ODsay 1711 저장 경로 · 버스 탑승 시뮬레이터 E2E

2026-11-17, 독립 `NoLate Journey Candidate E2E 20261104` iOS 27.0 시뮬레이터에서 확인했다. Device Hub 화면은 조작하지 않았다.

## 통과한 범위

- 격리 H2 계정의 저장된 실제 ODsay `WALK → BUS 1711 → WALK` 경로로 제품 상세 화면에 진입했다.
- 서버 소유 TMAP 도보 형상과 보관한 서울시 공식 1711 정류장 순서·노선 형상을 대조한 뒤 native 길안내 세션을 준비했다.
- CoreSimulator가 도보 구간과 승차 정류장, 버스 노선 위의 **승객 GPS 좌표를 연속 주입**했다. 별도 격리 서버는 같은 공식 노선 형상 위에서 **시험 차량 좌표**를 독립 생성했다. 탑승 버튼 없이 `버스 대기`에서 `버스로 이동 중`으로 전환됐다.
- 탑승 판단은 신선한 차량 관측 3회와 승객 위치의 동행 조건으로 `RIDING / CO_MOVEMENT_OBSERVED`에 도달했다. 제품 화면에서 안내 종료도 확인했다.
- 진단용 native 로그를 제거한 Release 시뮬레이터 빌드의 XCUITest `testIsolatedSavedRouteNavigationEntry`가 **1건 통과, 실패 0건**이었다. 결과 번들: `/private/tmp/nolate-ui-real-bus-gps-v55-20261117/result.xcresult`.

화면 근거: [버스 대기](evidence/journey-real-bus-gps-20261117/01-bus-waiting.png), [버스로 이동 중](evidence/journey-real-bus-gps-20261117/02-bus-riding.png).

## 시험 경계

ODsay 경로와 공식 버스 정류장·형상은 공급자 자료를 보관한 입력이다. 시험 차량 좌표와 승객 GPS는 시뮬레이션이다. 현장 차량 위치 API가 같은 버스를 연속 반환하는지, 실기기 GPS의 오차·백그라운드 동작, 잠금 화면 Live Activity와 실제 APNs 전달, 음성·무음 안내는 이 E2E가 증명하지 않는다. 이 Release 빌드는 `127.0.0.1:5527` 격리 API용이며 App Store 업로드 산출물이 아니다.

처음에는 시험 차량의 좌표가 선언한 관측 시각보다 앞서고 GPS 진행보다 빠른 탓에 동행 허용 거리 35m를 벗어났다. 격리 서버의 시험 차량 좌표를 원본 관측 시각에 맞춰 재생 속도를 보정했다. 이 조정은 시험 데이터에만 적용했고 제품의 탑승 허용 거리는 넓히지 않았다.

앱에 노출되던 임시 길안내 라우트는 제거했다. 남아 있던 일곱 시험 UI 자료는 `__tests__/fixtures/journey`로 옮겨 제품 라우트 밖에 두었다. 해당 Jest 7개 묶음의 103개 테스트와 TypeScript 검사가 통과했고, Release JS 번들에 기존 `__test_screens__` 경로가 없는 것을 확인했다.

## 2026-11-19 잠금 화면 후속 검증

같은 독립 시뮬레이터에서 앱 재설치 없이 Live Activity 지속 표시를 허용하고, 새 격리 H2 서버의 저장 경로로 도보 → 버스 대기 → 승객 GPS와 별도 시험 차량 위치의 동행 탑승을 재현했다. `버스로 이동 중`을 제품 경로 상세에서 확인한 다음 독립 창의 Controls → Lock으로 화면을 잠갔다. Release 시뮬레이터 XCUITest는 **1건 통과, 실패 0건**이다. 결과 번들: `/private/tmp/nolate-ui-real-bus-gps-v63-20261119/result.xcresult`.

실시간 차량 근거가 끊기면 탑승 사실을 현재 위치로 계속 표시하지 않는다. 대신 최근 확인한 버스 구간을 최대 90초 동안 `마지막 확인 · 1711 / 현재 위치 재확인 중`으로 구분하고 위치 마커를 숨긴다. [잠금 화면](evidence/journey-real-bus-gps-20261119/01-lock-last-confirmed.png)과 [탑승 경로 상세](evidence/journey-real-bus-gps-20261119/02-bus-riding.png)에서 두 상태를 확인했다. Swift 정책 테스트는 412건 중 410건 통과, 2건 건너뜀, 실패 0건이다. iOS Release 시뮬레이터 빌드도 성공했다.

격리 서버가 시험 차량 관측을 계속 생성하더라도 일부 구간은 공식 전체 노선의 중복 형상 등 매칭 조건으로 `VEHICLE_EVIDENCE_UNAVAILABLE`가 될 수 있다. 이를 실시간 위치로 추정하거나 오래된 좌표로 연장하지 않는다. 이 후속 E2E는 **실기기 GPS와 실시간 현장 차량 API의 지속성, 실제 APNs 전달, 음성·무음 안내, App Store 배포 빌드**를 검증한 결과가 아니다.
