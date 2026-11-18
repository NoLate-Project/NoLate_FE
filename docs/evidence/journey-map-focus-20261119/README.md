# Saved route navigation map focus

Release simulator build, isolated iOS 27.0 simulator `NoLate Journey Candidate E2E 20261104`.

- `01-armed-map-focused.png`: after starting native guidance for an authenticated saved ODsay 1711 bus route and allowing location access, the route sheet automatically collapses to the current step and whole-route progress bar while the map stays visible.
- XCUITest `testIsolatedSavedRouteNavigationEntry`: 1 passed, 0 failed. It also reopens the detailed route sheet and checks that the active guidance controls remain available.
- Run bundle: `/private/tmp/nolate-ui-map-focus-v89-20261119/result.xcresult` (local test artifact, not committed).

This run does not replay GPS or test physical-device APNs. The separate full bus GPS replay evidence is in `journey-real-bus-gps-20261119`.
