# 저장 ODsay 지하철 경로의 최종 도보 잠금 화면 검증

2026-11-16, 독립 창 `NoLate Journey Candidate E2E 20261104` (iPhone 17 Pro, iOS Simulator 27.0)의 설치된 Release 앱에서 확인했다. 일반 앱의 저장된 ODsay WALK/SUBWAY/WALK 경로를 열고, 격리 H2 서버와 시험용 loopback proxy의 합성 열차 응답 및 CoreSimulator 연속 GPS를 사용했다. 시험 전용 앱 화면은 열지 않았다.

- 제품 화면 XCUITest가 자동 출발 후 중간역 `역삼`, 하차역 `선릉`, 최종 도보 `목적지까지`를 같은 경로에서 순서대로 확인했다.
- 최종 도보에서 독립 시뮬레이터 창의 `Controls → Lock`을 실행했다. 시험 시뮬레이터의 Live Activity 허용 뒤 잠금 카드에 `목적지까지 · 도보 약 90m`, 2호선 구간과 마지막 도보에 놓인 현재 위치 마커가 표시됐다. XCTest의 잠금 화면 제목 검사도 통과했다.
- [XCTest 잠금 화면 캡처](evidence/journey-subway-final-walk-lock-20261116/D5883539-E548-4313-96AB-AE32681B5E88.png)와 [허용 뒤 잠금 카드 캡처](evidence/journey-subway-final-walk-lock-20261116/lock-after-permission.png)를 보존했다. 뒤 캡처는 GPS 주입이 끝난 다음의 `위치 확인 중` 상태로, 신선한 위치가 없을 때 현재 위치 마커가 사라진 것도 보여 준다.
- `NoLateE2ETests/testIsolatedSavedRouteNavigationEntry()` 1/1 통과. 결과 번들: `/private/tmp/nolate-full-subway-lock-20261116/result.xcresult`. 이후 남은 시험 세션을 복원·종료한 별도 XCUITest도 1/1 통과했다 (`/private/tmp/nolate-full-subway-lock-cleanup-20261116/result.xcresult`). 시험 proxy는 종료했다.

이 검증은 **로컬 ActivityKit 갱신과 잠금 화면 표시**에 한정한다. 열차 단계 0/1/2와 GPS는 주입값이었다. 이 결과는 같은 저장 경로의 실제 APNs UPDATE/END, 실제 열차의 연속 관측, 실기기 GPS·무음·음성 전달 또는 현장 도착 정확도를 증명하지 않는다.
