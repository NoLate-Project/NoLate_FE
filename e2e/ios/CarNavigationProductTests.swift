import CoreLocation
import XCTest

private struct DrivingTripReplay: Decodable {
    struct Point: Decodable {
        let latitude: Double
        let longitude: Double
    }
    let firstInstruction: String
    let secondInstruction: String
    let thirdInstruction: String
    struct Alternative: Decodable {
        let firstInstruction: String
        let secondInstruction: String
        let acquire: [Point]
        let crossing: [Point]
        let finish: [Point]
    }
    let alternative: Alternative?
    let handoff: [Point]
    let lockedCrossing: [Point]
    let approach: [Point]
    let crossing: [Point]
    let reacquire: [Point]
    let detour: [Point]
    let rejoin: [Point]
    let finish: [Point]
}

extension NoLateE2ETests {
    @MainActor
    func testSavedDrivingRouteFollowsLocationThroughTurns() throws {
        try driveSavedRoute(checkSourceLoss: false)
    }

    @MainActor
    func testLockedDrivingRouteWithdrawsGuidanceWhenLocationIsRevoked() throws {
        try driveSavedRoute(checkSourceLoss: true)
    }

    @MainActor
    func testSavedDrivingRouteAutomaticallyFollowsReplacementRoad() throws {
        try driveSavedRoute(checkSourceLoss: false, checkReroute: true)
    }

    @MainActor
    func testSavedDrivingVoiceSurvivesRelaunchAndRespectsMute() throws {
        try driveSavedRoute(checkSourceLoss: false, checkVoice: true)
    }

    /// The production watcher consumes real simulator Core Location events. The runner
    /// derives fixes and maneuver assertions from the original saved TMAP response.
    @MainActor
    private func driveSavedRoute(checkSourceLoss: Bool, checkReroute: Bool = false, checkVoice: Bool = false) throws {
        #if targetEnvironment(simulator)
        let env = ProcessInfo.processInfo.environment
        guard let itinerary = env["E2E_CAR_REPLAY"] else { throw XCTSkip("Requires an isolated saved driving schedule") }
        let trip = try JSONDecoder().decode(DrivingTripReplay.self, from: Data(itinerary.utf8))
        let schedule = try XCTUnwrap(env["E2E_SCHEDULE_ID"])
        let expectedEmail = try XCTUnwrap(env["E2E_EMAIL"])
        XCTAssertNotNil(schedule.range(of: "^[1-9][0-9]{0,15}$", options: .regularExpression))
        XCTAssertTrue(expectedEmail.hasPrefix("car-guide-") && expectedEmail.hasSuffix("@example.test"))
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        func dismissPermission() {
            guard alert.exists else { return }
            for label in ["앱에 추적 금지 요청", "Ask App Not to Track", "앱을 사용하는 동안 허용", "앱 사용 중에만 허용", "Allow While Using App"] {
                if alert.buttons[label].exists { alert.buttons[label].tap(); return }
            }
            let notification = alert.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "알림","notifications")).firstMatch
            if notification.exists {
                let allow = alert.buttons["허용"].exists ? alert.buttons["허용"] : alert.buttons["Allow"]
                if allow.exists { allow.tap() }
            }
        }
        func inject(_ point: DrivingTripReplay.Point) {
            let fix = CLLocation(coordinate: CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude),
                                 altitude: 0, horizontalAccuracy: 4, verticalAccuracy: 6, course: -1, speed: -1, timestamp: Date())
            XCUIDevice.shared.location = XCUILocation(location: fix)
            RunLoop.current.run(until: Date().addingTimeInterval(1.1))
        }
        func drive(_ points: [DrivingTripReplay.Point]) { for point in points { inject(point) } }
        func element(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }
        let instruction = element("driving-navigation-instruction")
        let summary = element("driving-navigation-arrival-summary")
        let heading = element("drive-position-heading")
        func expectHeading(_ compass: String) {
            XCTAssertTrue(heading.waitForExistence(timeout: 3), "The native direction arrow must be on the visible map")
            XCTAssertEqual(heading.value as? String, compass + "쪽으로 이동 중")
            // The camera looks ahead on the road. The actual projected vehicle must
            // therefore lie below the screen center, including on a westbound road.
            let camera = app.buttons["현재 위치 따라가기"]
            XCTAssertTrue((camera.value as? String)?.contains("지도 기울기 40도") == true,
                          "The map SDK must report the settled pitch on the visible map: \(camera.value ?? "")")
            let frame = heading.frame
            XCTAssertLessThan(abs(frame.midX - app.frame.midX), 24)
            XCTAssertGreaterThan(frame.midY, app.frame.midY + 12)
        }
        func waitForInstruction(_ text: String, at point: DrivingTripReplay.Point) {
            for _ in 0..<16 {
                dismissPermission()
                inject(point)
                if instruction.exists && instruction.label.contains(text) { return }
            }
            XCTFail("Expected driving instruction \(text), got \(instruction.exists ? instruction.label : "no instruction element")")
        }
        defer { XCUIDevice.shared.location = nil }
        let origin = try XCTUnwrap(trip.approach.first)
        // setUp already launched the installed app. Keep that session for the saved trip.
        inject(origin)
        dismissTrackingPermissionIfPresent(); dismissPermission()
        let email = app.textFields["이메일"]
        var needsLogin = true
        if !email.waitForExistence(timeout: 5) {
            let priorEmail = try XCTUnwrap(env["E2E_PREVIOUS_FIXTURE_EMAIL"])
            XCTAssertTrue(priorEmail.hasSuffix("@example.test"))
            app.open(try XCTUnwrap(URL(string: "nolate://profile")))
            let account = app.descendants(matching: .any).matching(NSPredicate(
                format: "label CONTAINS %@ OR label CONTAINS %@", priorEmail, expectedEmail)).firstMatch
            XCTAssertTrue(account.waitForExistence(timeout: 15), "Only switch from the scoped simulator fixture member")
            if account.label.contains(expectedEmail) {
                needsLogin = false
            } else {
                let logout = app.buttons["로그아웃"]
                for _ in 0..<8 where !logout.isHittable { app.swipeUp() }
                XCTAssertTrue(logout.isHittable)
                logout.tap()
                XCTAssertTrue(app.staticTexts["로그아웃할까요?"].waitForExistence(timeout: 8))
                app.buttons["로그아웃"].tap()
            }
        }
        if needsLogin {
            XCTAssertTrue(email.waitForExistence(timeout: 30), "Use the normal signed-out login screen")
            replace(email, with: expectedEmail)
            replaceSecure(app.secureTextFields["비밀번호"], with: try XCTUnwrap(env["E2E_PASSWORD"]))
            app.staticTexts["NoLate"].firstMatch.tap()
            let login = app.buttons["로그인"]
            XCTAssertTrue(login.isEnabled)
            let frame = login.frame
            app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width, dy: frame.midY / app.frame.height)).tap()
            dismissSyntheticPasswordSavePrompt(); dismissPermission()
            let skip = app.buttons["일정 없이 시작하기"]
            if skip.waitForExistence(timeout: 3) { skip.tap() }
            let intro = app.buttons["사용법 건너뛰고 NoLate 시작하기"]
            if intro.waitForExistence(timeout: 2) { intro.tap() }
        }
        app.open(try XCTUnwrap(URL(string: "nolate://schedule/\(schedule)")))
        dismissPermission()
        let depart = app.buttons["schedule-route-departure-action"]
        XCTAssertTrue(depart.waitForExistence(timeout: 30))
        XCTAssertEqual(depart.label, "지금 출발")
        let screen = element("driving-navigation-screen")
        // The schedule sheet animates into place after the route deep link. XCUI can
        // expose its final frame before Reanimated finishes moving the hit target.
        var previousFrame = CGRect.null
        for _ in 0..<12 {
            let frame = depart.frame
            if frame == previousFrame && depart.isHittable && depart.isEnabled { break }
            previousFrame = frame
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        capture("car-before-departure")
        depart.tap()
        dismissPermission()
        if !screen.waitForExistence(timeout: 4) && depart.isHittable && depart.label == "지금 출발" {
            let r = depart.frame
            app.coordinate(withNormalizedOffset: CGVector(dx:r.midX / app.frame.width, dy:r.midY / app.frame.height)).tap()
        }
        XCTAssertTrue(screen.waitForExistence(timeout: 15))
        if checkVoice {
            var times: [String: Double] = [:]
            func mark(_ name: String) { times[name] = Date().timeIntervalSince1970 }
            let toggle = app.switches["주행 음성 안내"]
            func checkSwitch(_ enabled: Bool) {
                let match = XCTNSPredicateExpectation(predicate: NSPredicate(
                    format: "value == %@", enabled ? "1" : "0"), object: toggle)
                XCTAssertEqual(XCTWaiter.wait(for: [match], timeout: 4), .completed)
            }
            func hold(_ point: DrivingTripReplay.Point) {
                for _ in 0..<8 { inject(point) }
            }
            let first = try XCTUnwrap(trip.approach.last)
            let second = try XCTUnwrap(trip.crossing.last)
            mark("initial")
            checkSwitch(false)
            drive(trip.approach)
            waitForInstruction(trip.firstInstruction, at: first)
            mark("enabled")
            toggle.tap()
            checkSwitch(true)
            hold(first)
            capture("car-voice-first-turn")
            toggle.tap()
            checkSwitch(false)
            mark("muted")
            drive(trip.crossing)
            waitForInstruction(trip.secondInstruction, at: second)
            capture("car-voice-muted-turn")
            mark("enabledAgain")
            toggle.tap()
            checkSwitch(true)
            hold(second)
            mark("closing")
            app.buttons["driving-navigation-exit"].tap()
            XCTAssertTrue(depart.waitForExistence(timeout: 10))
            app.terminate()
            app.activate()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
            app.open(try XCTUnwrap(URL(string: "nolate://schedule/\(schedule)")))
            XCTAssertTrue(depart.waitForExistence(timeout: 20))
            mark("relaunched")
            depart.tap()
            XCTAssertTrue(screen.waitForExistence(timeout: 12))
            checkSwitch(true)
            drive(trip.reacquire)
            let resume = try XCTUnwrap(trip.reacquire.last)
            waitForInstruction(trip.secondInstruction, at: resume)
            hold(resume)
            capture("car-voice-restored")
            toggle.tap()
            checkSwitch(false)
            mark("finalMute")
            app.buttons["driving-navigation-exit"].tap()
            XCTAssertTrue(depart.waitForExistence(timeout: 10))
            depart.tap()
            XCTAssertTrue(screen.waitForExistence(timeout: 12))
            checkSwitch(false)
            drive(trip.reacquire)
            waitForInstruction(trip.secondInstruction, at: resume)
            hold(resume)
            mark("end")
            app.buttons["driving-navigation-exit"].tap()
            let proof = XCTAttachment(data: try JSONEncoder().encode(times), uniformTypeIdentifier: "public.json")
            proof.name = "driving-speech-windows"
            proof.lifetime = .keepAlways
            add(proof)
            return
        }
        drive(trip.approach)
        waitForInstruction(trip.firstInstruction, at: try XCTUnwrap(trip.approach.last))
        XCTAssertTrue(element("driving-navigation-following").exists)
        XCTAssertTrue(summary.label.contains("세종문화회관") && summary.label.contains("도착 예정"))
        let approachLabel = instruction.label
        XCTAssertNotEqual(approachLabel, trip.firstInstruction)
        expectHeading("남")
        capture("car-first-turn")
        if env["E2E_CAR_LOCK"] == "1" { NSLog("E2E_CAR_LOCK_APPROACHING") }
        drive(trip.crossing)
        let checkpoint = try XCTUnwrap(trip.crossing.last)
        waitForInstruction(trip.secondInstruction, at: checkpoint)
        XCTAssertNotEqual(approachLabel, instruction.label)
        expectHeading("북")
        capture("car-second-turn")
        if env["E2E_CAR_LOCK"] != "1" {
            let follow = app.buttons["현재 위치 따라가기"]
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.48))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.17, dy: 0.66))
            start.press(forDuration: 0.1, thenDragTo: end)
            let browsing = XCTNSPredicateExpectation(predicate: NSPredicate(
                format: "value CONTAINS %@", "지도를 둘러보는 중"), object: follow)
            XCTAssertEqual(XCTWaiter.wait(for: [browsing], timeout: 4), .completed)
            follow.tap()
            let resumed = XCTNSPredicateExpectation(predicate: NSPredicate(
                format: "value CONTAINS %@", "현재 위치를 따라가는 중"), object: follow)
            XCTAssertEqual(XCTWaiter.wait(for: [resumed], timeout: 3), .completed)
            inject(checkpoint)
            expectHeading("북")
        }
        var resumedPosition = checkpoint
        var resumedInstruction = trip.secondInstruction
        if env["E2E_CAR_LOCK"] == "1" {
            let turn = springboard.descendants(matching: .any)["driving-lock-instruction"].firstMatch
            let distance = springboard.descendants(matching: .any)["driving-lock-distance"].firstMatch
            let destination = springboard.descendants(matching: .any)["driving-lock-destination"].firstMatch
            let following = springboard.descendants(matching: .any)["driving-lock-following"].firstMatch
            let footer = springboard.descendants(matching: .any)["driving-lock-summary"].firstMatch
            let approval = springboard.staticTexts.matching(NSPredicate(
                format: "label CONTAINS %@ AND label CONTAINS %@", "NoLate", "실시간 현황")).firstMatch
            func allowLiveActivityIfAsked() {
                guard approval.exists else { return }
                // iOS can ask again on the card after the first Allow; the
                // simulator user has also approved ongoing activity display.
                for label in ["항상 허용", "허용"] where springboard.buttons[label].exists {
                    springboard.buttons[label].tap()
                    return
                }
            }
            func captureLock(_ name: String) {
                let item = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                item.name = name
                item.lifetime = .keepAlways
                add(item)
            }
            let moving = env["E2E_CAR_LOCK_MOVING"] == "1"
            var nextHandoff = 0
            func continueHandoff() {
                if moving && nextHandoff < trip.handoff.count {
                    inject(trip.handoff[nextHandoff])
                    nextHandoff += 1
                } else { inject(moving ? trip.handoff.last ?? checkpoint : checkpoint) }
            }
            NSLog("E2E_CAR_LOCK_READY foreground instruction=%@", instruction.label)
            let deadline = Date().addingTimeInterval(55)
            repeat {
                allowLiveActivityIfAsked()
                if turn.exists && turn.label == "오른쪽 방향" { break }
                // Maintain actual movement during first-run consent and WidgetKit's foreground handoff.
                if moving || app.state == .runningForeground { continueHandoff() }
                else { RunLoop.current.run(until: Date().addingTimeInterval(0.3)) }
            } while Date() < deadline
            XCTAssertTrue(turn.exists)
            XCTAssertEqual(turn.label, "오른쪽 방향")
            XCTAssertTrue(distance.exists && distance.label.contains("m"))
            XCTAssertTrue(destination.label.contains("세종문화회관"))
            XCTAssertTrue(following.exists && footer.exists)
            captureLock("car-lock-rightward-turn")
            if moving {
                // Continue from the actual handoff offset with monotonic real route fixes.
                // Do not teleport back to the point at which the operator was prompted.
                drive(Array(trip.handoff.dropFirst(nextHandoff).enumerated().compactMap { $0.offset % 4 == 0 ? $0.element : nil }))
                drive(trip.lockedCrossing)
                resumedPosition = try XCTUnwrap(trip.lockedCrossing.last)
                resumedInstruction = trip.thirdInstruction
                // Verify a different real maneuver while SpringBoard still owns the screen.
                // Continue sending native fixes while waiting for WidgetKit to render.
                let until = Date().addingTimeInterval(12)
                while turn.label != "왼쪽 방향" && Date() < until { inject(resumedPosition) }
                XCTAssertEqual(turn.label, "왼쪽 방향")
                XCTAssertTrue(distance.exists && distance.label.contains("m"))
                XCTAssertTrue(destination.label.contains("세종문화회관"))
                XCTAssertNotEqual(app.state, .runningForeground)
                captureLock("car-lock-next-maneuver-after-movement")
                NSLog("E2E_CAR_LOCK_MOVEMENT_VERIFIED")
            }
            if checkSourceLoss {
                // Releasing an XCTest location override can resume valid system fixes.
                // The host instead revokes location for this app on this device and
                // records the successful OS operation separately from any widget result.
                NSLog("E2E_CAR_LOCK_REVOKE_LOCATION")
                XCUIDevice.shared.location = nil
                let limit = Date().addingTimeInterval(75)
                repeat {
                    allowLiveActivityIfAsked()
                    if turn.exists && turn.label == "현재 위치를 확인하는 중" { break }
                    RunLoop.current.run(until: Date().addingTimeInterval(0.4))
                } while Date() < limit
                XCTAssertEqual(turn.label, "현재 위치를 확인하는 중")
                XCTAssertFalse(distance.exists)
                XCTAssertFalse(following.exists)
                XCTAssertFalse(footer.exists)
                XCTAssertTrue(destination.exists)
                captureLock("car-lock-refresh-needed-after-revocation")
                NSLog("E2E_CAR_LOCK_LOSS_VERIFIED")
                return
            }
            // A foreground activation would bypass WidgetKit's destination URL. Tap
            // the real SpringBoard card and require the active trip to survive it.
            XCTAssertTrue(destination.isHittable)
            destination.tap()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
            XCTAssertTrue(screen.waitForExistence(timeout: 15), "The card should resume this saved driving trip")
            // Continue driving along the actual saved road through the app transition.
            drive(trip.reacquire)
            resumedPosition = try XCTUnwrap(trip.reacquire.last)
            waitForInstruction(resumedInstruction, at: resumedPosition)
            capture("car-reopened-from-lock-card")
            NSLog("E2E_CAR_LOCK_TAP_RESUMED")
        }
        if env["E2E_CAR_LOCK"] != "1" {
            drive(trip.reacquire)
            resumedPosition = try XCTUnwrap(trip.reacquire.last)
        }
        drive(trip.detour)
        let offRoute = XCTNSPredicateExpectation(predicate: NSPredicate(
            format: "label CONTAINS %@", "경로를 벗어났어요"), object: instruction)
        XCTAssertEqual(XCTWaiter.wait(for: [offRoute], timeout: 2), .completed)
        XCTAssertFalse(element("driving-navigation-following").exists)
        capture("car-off-route")
        if checkReroute {
            let newRoad = try XCTUnwrap(trip.alternative)
            let follow = app.buttons["현재 위치 따라가기"]
            // Continue receiving slightly different physical fixes near the side street.
            // App-side TMAP receives the real HTTP request without any action on the banner.
            let limit = Date().addingTimeInterval(45)
            var index = 0
            while !instruction.label.contains(newRoad.firstInstruction) && Date() < limit {
                inject(newRoad.acquire[index % newRoad.acquire.count])
                XCTAssertTrue(follow.exists, "The car location must survive the route request")
                index += 1
            }
            XCTAssertTrue(instruction.label.contains(newRoad.firstInstruction),
                          "Expected the side-street maneuver, got " + instruction.label)
            XCTAssertTrue(summary.label.contains("도착 예정"))
            capture("car-automatic-replacement-road")
            drive(newRoad.crossing)
            waitForInstruction(newRoad.secondInstruction, at: try XCTUnwrap(newRoad.crossing.last))
            capture("car-replacement-next-turn")
            drive(newRoad.finish)
            waitForInstruction("목적지에 도착했어요", at: try XCTUnwrap(newRoad.finish.last))
            capture("car-replacement-arrival")
            app.buttons["driving-navigation-exit"].tap()
            XCTAssertTrue(depart.waitForExistence(timeout: 15))
            XCTAssertFalse(screen.exists)
            return
        }
        drive(trip.rejoin)
        waitForInstruction(resumedInstruction, at: try XCTUnwrap(trip.rejoin.last))
        capture("car-back-on-route")
        var capturedWestbound = false
        for (index, point) in trip.finish.enumerated() {
            inject(point)
            guard !capturedWestbound, index >= 2 else { continue }
            let previous = trip.finish[index - 2]
            let west = (previous.longitude - point.longitude) * cos(point.latitude * .pi / 180)
            if west > 0.00033 && abs(point.latitude - previous.latitude) < west * 0.15 {
                expectHeading("서")
                capture("car-westbound-heading")
                capturedWestbound = true
            }
        }
        XCTAssertTrue(capturedWestbound)
        waitForInstruction("목적지에 도착했어요", at: try XCTUnwrap(trip.finish.last))
        XCTAssertTrue(summary.label.contains("도착"))
        capture("car-arrived")
        app.buttons["driving-navigation-exit"].tap()
        XCTAssertTrue(depart.waitForExistence(timeout: 15))
        XCTAssertFalse(screen.exists)
        #else
        throw XCTSkip("Simulator location replay")
        #endif
    }
}
