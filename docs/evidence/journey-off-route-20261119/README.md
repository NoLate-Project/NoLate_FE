# 첫 도보 경로 이탈 표시 — 2026-11-19

독립 iOS 26.5 시뮬레이터 `NoLate Notice E2E Isolated 20261119`에서 Release 앱과 격리 H2 서버를 사용했다. 실제 ODsay 1711 저장 경로의 첫 도보 구간을 시뮬레이터 GPS로 재생해 출발과 정류장 대기까지 진행한 다음, 경로 밖 좌표를 주입했다.

- [경로 이탈 화면](01-first-walk-off-route.png): `경로 확인 중`과 `경로를 벗어난 것 같아요 · 위치 확인 중` 표시. 경로 바는 남아 있고 현재 위치 마커는 숨겨졌다.
- [원래 경로 복귀 화면](02-route-recovered.png): 신선한 정류장 근처 GPS를 다시 받은 뒤 `버스 대기` 단계와 지도·경로 바의 현재 위치 마커가 복원됐다. 이전 탑승 근거는 재사용하지 않고 정류장 체류를 다시 확인했다.
- XCUITest `testIsolatedSavedRouteNavigationEntry` 통과. 시험은 경로 이탈 문구와 현재 위치 마커 제거를 접근성 요소로도 확인했다.
- 복귀를 포함한 최종 XCUITest 1건 통과. 결과 번들: `/private/tmp/nolate-route-recovery-e2e-final-20261119/result.xcresult`. 최초 복귀 시험은 정류장명의 `거터`를 `거리`로 적은 테스트 기대값 때문에 실패했다. 실제 엔진과 제품 화면의 복귀를 확인한 뒤 기대값을 바로잡았다.
- Jest `savedJourneyStage.test.ts` 19개 통과, TypeScript 검사 통과.

이 화면은 경로 밖 GPS를 안내 경로 위의 현재 위치로 잘못 표시하지 않는 동작을 검증한다. 실제 재탐색, 현장 GPS, 운영 API, 실기기 잠금 화면 및 실제 APNs 전달을 검증한 결과는 아니다.
