# 확정 응답 유실 뒤 경로 교체 — 독립 시뮬레이터

2026-11-19, iOS 27.0 독립 시뮬레이터에서 서명된 Release 제품 앱과 격리 H2 서버를 사용했다. 실제 ODsay 1711 저장 경로, 서버의 TMAP 도보 형상, 캡처한 공식 서울 버스 정류장·노선 형상 대조를 입력으로 사용했다. CoreSimulator 위치를 연속 주입해 자동 출발과 경로 이탈을 만들었다.

첫 시험에서는 격리 서버가 후보·도보·버스 증명 뒤 새 경로를 트랜잭션으로 확정하고 **커밋 HTTP 응답만 503으로 변경**했다. 앱은 소유자 제한 `/current`로 새 세션의 경로 JSON·digest·형상 fingerprint를 대조한 뒤 native 안내를 교체했다. 결과 번들: `/private/tmp/nolate-reroute-replylost-ui-e2e-20261119/result.xcresult`.

두 번째 시험에서는 **커밋 응답과 첫 `/current` 응답을 각각 한 번씩 503으로 변경**했다. 이전 native 세션의 서버 조회를 최대 30초간 멈추고 JS가 `/current`를 재시도했다. 서버 기록에는 다음 `/current` 200, 새 세션 `/validate` 200과 `/stop` 200이 있으며, 이전 세션의 교체 후 409·`/stop`은 없었다. XCUITest `testIsolatedSavedRouteNavigationEntry`는 **1건 통과·0건 실패**했다. 결과 번들: `/private/tmp/nolate-reroute-nativehold-ui-e2e-20261119/result.xcresult`.

- [새 경로 지도·현재 구간·경로 바 마커](01-current-position-route-map.png)
- [상세 경로의 현재 위치와 첫 도보 강조](02-current-origin-route-detail.png)

이 결과는 **잠깐의 연결 실패 뒤 30초 안에 `/current`가 성공한 경우**의 검증이다. 그 이상 지속되는 장애에서는 native 안내가 종료되며, 새 서버 세션의 원격 정리·복구는 별도 검증이 필요하다. 실기기 GPS, 실제 운행 차량의 연속 관측, 원격 APNs·잠금 화면과 음성 안내도 검증하지 않았다. 시험용 503 주입은 격리 서버의 명시 플래그가 있을 때에만 동작한다.
