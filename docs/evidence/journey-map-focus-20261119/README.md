# Saved route navigation map focus

Release simulator build, isolated iOS 27.0 simulator `NoLate Journey Candidate E2E 20261104`.

- `01-armed-map-focused.png`: after starting native guidance for an authenticated saved ODsay 1711 bus route and allowing location access, the route sheet automatically collapses to the current step and whole-route progress bar while the map stays visible.
- `02-riding-map-focused.png`: during independent test-vehicle and injected passenger GPS replay, the collapsed sheet shows `1711 · 버스로 이동 중`, the route bar's position marker, and the passenger point on the following map.
- `03-riding-alight-target.png`: when the saved stop and native route metadata match, the same map-focused ride shows `경복궁역3번출구에서 하차` as the next planned action. This does not claim a current bus stop or countdown.
- `04-lock-riding-permission.jpg`: the local lock-screen Live Activity shows that target and its route-position marker while iOS's first-use Live Activity permission prompt overlays the card's lower area.
- `05-lock-last-confirmed.jpg`: after permission was allowed and the test GPS stopped, the card correctly drops the position marker and changes to `마지막 확인 · 1711 / 현재 위치 재확인 중`.
- XCUITest `testIsolatedSavedRouteNavigationEntry`: the map-focus entry run and the full bus replay each passed 1 test, with 0 failures. The latter continued through alighting notice, target-stop approach, final walk, and automatic arrival.
- After the target copy change, the full bus replay and lock-screen tests each passed 1 test, with 0 failures. Run bundles: `/private/tmp/nolate-ui-real-bus-gps-v91-20261119/result.xcresult` and `/private/tmp/nolate-ui-real-bus-lock-v93-20261119/result.xcresult` (local artifacts, not committed).

The bus runs replay CoreSimulator GPS and an independent test vehicle. They do not prove physical-device GPS, live vehicle feed continuity, or physical-device APNs. The lock-screen permission prompt was approved in the detached simulator window; XCUITest can see the card text but does not independently detect that prompt, so `04` and `05` are separate visual observations.
