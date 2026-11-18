# 첫 도보 경로 이탈 표시 — 2026-11-19

독립 iOS 26.5 시뮬레이터 `NoLate Notice E2E Isolated 20261119`에서 Release 앱과 격리 H2 서버를 사용했다. 실제 ODsay 1711 저장 경로의 첫 도보 구간을 시뮬레이터 GPS로 재생해 출발과 정류장 대기까지 진행한 다음, 경로 밖 좌표를 주입했다.

- [경로 이탈 화면](01-first-walk-off-route.png): `경로 확인 중`과 `경로를 벗어난 것 같아요 · 위치 확인 중` 표시. 경로 바는 남아 있고 현재 위치 마커는 숨겨졌다.
- [원래 경로 복귀 화면](02-route-recovered.png): 신선한 정류장 근처 GPS를 다시 받은 뒤 `버스 대기` 단계와 지도·경로 바의 현재 위치 마커가 복원됐다. 이전 탑승 근거는 재사용하지 않고 정류장 체류를 다시 확인했다.
- [이탈 중 실제 기기 위치](03-off-route-device-map.png): 후속 Release 빌드에서는 연속된 신선한 GPS 두 건을 확인한 뒤 지도에 기기 위치 점을 표시하고 카메라가 따라간다. 이 점은 경로 진행 마커가 아니며, 이탈 중 경로 바의 현재 위치 마커는 계속 숨긴다.
- XCUITest `testIsolatedSavedRouteNavigationEntry` 통과. 시험은 경로 이탈 문구와 현재 위치 마커 제거를 접근성 요소로도 확인했다.
- 복귀를 포함한 최종 XCUITest 1건 통과. 결과 번들: `/private/tmp/nolate-route-recovery-e2e-final-20261119/result.xcresult`. 최초 복귀 시험은 정류장명의 `거터`를 `거리`로 적은 테스트 기대값 때문에 실패했다. 실제 엔진과 제품 화면의 복귀를 확인한 뒤 기대값을 바로잡았다.
- Jest `savedJourneyStage.test.ts` 19개 통과, TypeScript 검사 통과.
- 이탈 중 기기 위치 표시 후속 검증: Swift 정책 2건, Jest 경로 위치 15건, TypeScript 검사, iOS 27.0 Release 시뮬레이터 빌드 통과. 동일한 독립 시뮬레이터에서 실제 ODsay 1711 저장 경로를 다시 열어 도보 이동 → 정류장 대기 → 경로 이탈 → 복귀 제품 E2E 1건 통과. 결과 번들: `/private/tmp/nolate-off-route-map-e2e-20261119/result.xcresult`. 지도 점은 정확도 25m 이내, 15초 이내, 연속 관측으로만 표시하며 native 경로 판정·Live Activity 위치에는 사용하지 않는다.

이 화면은 경로 밖 GPS를 안내 경로 위의 현재 위치로 잘못 표시하지 않으면서 지도에는 실제 기기 위치를 보여 주는 동작을 검증한다. 실제 재탐색, 현장 GPS, 운영 API, 실기기 잠금 화면 및 실제 APNs 전달을 검증한 결과는 아니다.
