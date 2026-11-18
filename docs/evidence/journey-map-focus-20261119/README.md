# Saved route navigation map focus

Release simulator build, isolated iOS 27.0 simulator `NoLate Journey Candidate E2E 20261104`.

- `01-armed-map-focused.png`: after starting native guidance for an authenticated saved ODsay 1711 bus route and allowing location access, the route sheet automatically collapses to the current step and whole-route progress bar while the map stays visible.
- `02-riding-map-focused.png`: during independent test-vehicle and injected passenger GPS replay, the collapsed sheet shows `1711 · 버스로 이동 중`, the route bar's position marker, and the passenger point on the following map.
- XCUITest `testIsolatedSavedRouteNavigationEntry`: the map-focus entry run and the full bus replay each passed 1 test, with 0 failures. The latter continued through alighting notice, target-stop approach, final walk, and automatic arrival.
- Run bundles: `/private/tmp/nolate-ui-map-focus-v89-20261119/result.xcresult` and `/private/tmp/nolate-ui-real-bus-gps-v90-20261119/result.xcresult` (local artifacts, not committed).

The second run replays CoreSimulator GPS and an independent test vehicle. Neither run proves physical-device GPS, live vehicle feed continuity, or physical-device APNs.
