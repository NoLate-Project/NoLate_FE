import XCTest
import CoreLocation

/// Runs against the installed app; the server and app build are managed separately.
final class NoLateE2ETests: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe")

    override func setUpWithError() throws {
        continueAfterFailure = false
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let open = springboard.alerts.buttons["열기"]
        if open.waitForExistence(timeout: 2) { open.tap() }
        if name.contains("testIsolatedSavedRouteNavigationEntry") { dismissTrackingPermissionIfPresent() }
        app.activate()
        for title in ["로그인을 확인해 주세요", "연결을 확인해 주세요"] {
            if app.alerts[title].exists { app.alerts[title].buttons["확인"].tap() }
        }
    }

    func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func stopSavedNavigation() throws {
        let stop = app.buttons["saved-detail-stop"]
        if !stop.exists {
            let menu = app.buttons["journey-navigation-menu"]
            XCTAssertTrue(menu.waitForExistence(timeout: 15))
            menu.tap()
        }
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        if !stop.isHittable { try reveal(stop) }
        stop.tap()
    }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            if ProcessInfo.processInfo.environment["E2E_BUS_REMOTE_ACTIVITY_END"] == "1" {
                // This case deliberately kills the app on the lock screen. Asking
                // the stopped/background app for a hierarchy can relaunch it.
                let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                shot.name = "product-remote-lock-failure"; shot.lifetime = .keepAlways; add(shot)
                return
            }
            if name.contains("testTrainTicketWebPageShareReviewAndURLOnlyRecovery") || name.contains("testSmartTicket") || name.contains("testTicketLabelled") {
                // The foreground app varies between Photos, Files, the fixture and NoLate.
                let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                shot.name = "ticket-webpage-host-failure"; shot.lifetime = .keepAlways; add(shot)
                return
            }
            capture("failure")
            print(app.debugDescription)
            // A failed assertion after ARMED must not leave a server session
            // that rejects the next isolated Release run.
            if name.contains("testIsolatedOdsaySubwayAutomaticPreparation") ||
               name.contains("testIsolatedSavedRouteNavigationEntry") {
                let menu = app.buttons["journey-navigation-menu"]
                if menu.exists || app.buttons["saved-detail-stop"].exists { try? stopSavedNavigation() }
            }
        }
    }

    private func focusForTextEntry(_ field: XCUIElement) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            field.exists && field.isEnabled && field.isHittable
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
        XCTAssertTrue(app.frame.contains(field.frame))
        // A fresh runtime can expose the field before it accepts input. Use
        // the observed visible frame rather than XCTest's inferred hit point.
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    func replace(_ field: XCUIElement, with text: String) {
        focusForTextEntry(field)
        // A tap can place the caret in the middle of existing text. Select all
        // rather than deleting only the characters before that caret.
        field.typeKey("a", modifierFlags: .command)
        field.typeText(XCUIKeyboardKey.delete.rawValue)
        // Controlled React Native fields can drop batched keystrokes while
        // their value is being reconciled. Let XCTest idle between characters.
        for character in text { field.typeText(String(character)) }
    }

    func replaceSecure(_ field: XCUIElement, with text: String) {
        var secureField = field
        for _ in 0..<3 {
            focusForTextEntry(secureField)
            secureField.typeKey("a", modifierFlags: .command)
            secureField.typeText(XCUIKeyboardKey.delete.rawValue)
            for character in text { secureField.typeText(String(character)) }

            let show = app.buttons["비밀번호 표시하기"]
            if show.exists { show.tap() }
            let revealed = app.textFields["비밀번호"]
            let matches = revealed.waitForExistence(timeout: 2)
                && revealed.value as? String == text
            let hide = app.buttons["비밀번호 숨기기"]
            if hide.exists { hide.tap() }
            if matches { return }
            secureField = app.secureTextFields["비밀번호"]
        }
        XCTFail("Secure field did not receive the exact synthetic password")
    }

    func dismissSyntheticPasswordSavePrompt() {
        let roots = [app, XCUIApplication(bundleIdentifier: "com.apple.springboard")]
        var dismiss: XCUIElement?
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            for root in roots {
                let prompt = root.sheets.matching(NSPredicate(format: "label BEGINSWITH %@", "암호를 저장하")).firstMatch
                let later = prompt.buttons["지금 안 함"].firstMatch
                if later.exists && !later.frame.isEmpty { dismiss = later; return true }
            }
            return false
        }, object: nil)
        guard XCTWaiter.wait(for: [visible], timeout: 3) == .completed, let dismiss else { return }
        dismiss.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !dismiss.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed)
    }

    func dismissTrackingPermissionIfPresent() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deny = springboard.buttons["앱에 추적 금지 요청"]
        if deny.waitForExistence(timeout: 2) { deny.tap() }
    }

    func testLoginInputAndValidation() throws {
        let email = app.textFields["이메일"]
        XCTAssertTrue(email.waitForExistence(timeout: 30), "Start on the signed-out login screen")
        replace(email, with: "invalid-email")
        let password = app.secureTextFields["비밀번호"]
        XCTAssertTrue(password.exists)
        replace(password, with: "ValidationOnly1!")
        let login = app.buttons["로그인"]
        XCTAssertTrue(login.isEnabled)
        login.tap()
        XCTAssertTrue(app.staticTexts["올바른 이메일 주소를 입력해 주세요."].firstMatch.waitForExistence(timeout: 10),
                      "Invalid email feedback appears inline on the current login screen")
        capture("login-validation")
    }

    /// Run only on a fresh dedicated simulator with tracking requests enabled.
    func testAppReviewFreshInstallATTAndRestart() throws {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let denyInSpringboard = springboard.buttons["앱에 추적 금지 요청"]
        let denyInApp = app.buttons["앱에 추적 금지 요청"]
        if denyInSpringboard.waitForExistence(timeout: 15) {
            denyInSpringboard.tap()
        } else if denyInApp.waitForExistence(timeout: 2) {
            denyInApp.tap()
        } else {
            XCTFail("Fresh install did not present the ATT permission request")
            return
        }

        XCTAssertTrue(app.textFields["이메일"].waitForExistence(timeout: 30))
        capture("app-review-att-denied-login")
        app.terminate()
        app.activate()
        XCTAssertTrue(app.textFields["이메일"].waitForExistence(timeout: 30))
        XCTAssertFalse(springboard.buttons["앱에 추적 금지 요청"].exists)
        capture("app-review-ipad-relaunch")
    }

    func testNewMemberScheduleJourney() throws {
        let environment = ProcessInfo.processInfo.environment
        let emailValue = try XCTUnwrap(environment["E2E_EMAIL"], "Pass credentials using run.py")
        let passwordValue = try XCTUnwrap(environment["E2E_PASSWORD"])
        let email = app.textFields["이메일"]
        XCTAssertTrue(email.waitForExistence(timeout: 30), "Use a signed-out dedicated simulator")
        replace(email, with: emailValue)
        XCTAssertEqual(email.value as? String, emailValue)
        replaceSecure(app.secureTextFields["비밀번호"], with: passwordValue)
        app.buttons["로그인"].tap()

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["나중에", "지금 안 함", "허용 안 함", "Don't Allow", "Not Now"] {
            let button = springboard.alerts.buttons[label]
            if button.exists { button.tap() }
        }
        let skipImport = app.buttons["일정 없이 시작하기"]
        XCTAssertTrue(skipImport.waitForExistence(timeout: 45), "New member should enter onboarding")
        dismissSyntheticPasswordSavePrompt()
        capture("new-member-onboarding")
        try tap(skipImport)
        let skipTour = app.buttons["사용법 건너뛰고 NoLate 시작하기"]
        XCTAssertTrue(skipTour.waitForExistence(timeout: 20))
        try tap(skipTour)
        let add = app.buttons["일정 추가"]
        XCTAssertTrue(add.waitForExistence(timeout: 20))
        capture("calendar-after-login")
        try createAndEditSchedule()
    }

    /// Fresh synthetic member on the loopback-only H2 server in a Release build.
    func testIsolatedReleaseMemberLoginAndOnboarding() throws {
        let environment = ProcessInfo.processInfo.environment
        let emailValue = try XCTUnwrap(environment["E2E_EMAIL"])
        let passwordValue = try XCTUnwrap(environment["E2E_PASSWORD"])
        XCTAssertTrue(emailValue.hasSuffix("@example.test"))
        let email = app.textFields["이메일"]
        if email.waitForExistence(timeout: 5) {
            replace(email, with: emailValue)
            XCTAssertEqual(email.value as? String, emailValue)
            replaceSecure(app.secureTextFields["비밀번호"], with: passwordValue)
            // A focused secure field can consume the first outside tap as keyboard dismissal.
            app.staticTexts["NoLate"].firstMatch.tap()
            let login = app.buttons["로그인"]
            XCTAssertTrue(login.isEnabled)
            login.tap()
            // In a bundled Release app, the first tap can only resign the
            // secure keyboard. Retry once only if the idle Login button is
            // still present; never double-submit an in-flight request.
            if login.waitForExistence(timeout: 3) && login.isEnabled {
                login.tap()
            }
            let loginAlert = app.alerts.firstMatch
            if loginAlert.waitForExistence(timeout: 12) {
                if loginAlert.label == "공유 캘린더" && loginAlert.staticTexts["현재 사용할 수 없는 기능입니다."].exists {
                    // The isolated backend intentionally disables sharing; this alert is
                    // unrelated to authentication or the saved journey under test.
                    loginAlert.buttons["확인"].tap()
                } else {
                    capture("isolated-release-login-alert")
                    XCTFail("Isolated login returned an alert: \(loginAlert.label)")
                    return
                }
            }
        }
        let skipImport = app.buttons["일정 없이 시작하기"]
        if skipImport.waitForExistence(timeout: 5) {
            // An ad-hoc-signed simulator Debug client can surface an Expo notification
            // Keychain error toast directly over this footer. Dismiss only that
            // development overlay; it is not part of the onboarding flow.
            let notificationToast = app.otherElements.matching(
                NSPredicate(format: "label CONTAINS %@", "[expo-notifications]")
            ).firstMatch
            if notificationToast.exists {
                let frame = notificationToast.frame
                app.coordinate(withNormalizedOffset: CGVector(dx: (frame.maxX - 20) / app.frame.width,
                                                              dy: frame.midY / app.frame.height)).tap()
            }
            // Tap the actual control first. A coordinate-only tap has occasionally
            // landed on the footer boundary without activating the handler.
            skipImport.tap()
            if skipImport.waitForExistence(timeout: 2) {
                let frame = skipImport.frame
                app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width,
                                                              dy: frame.midY / app.frame.height)).tap()
            }
        }
        let skipTour = app.buttons["사용법 건너뛰고 NoLate 시작하기"]
        if skipTour.waitForExistence(timeout: 5) {
            skipTour.tap()
            if skipTour.waitForExistence(timeout: 2) {
                // iOS 27 can report a (-1, -1) hit point after auto-scrolling
                // this visible header button. Its accessibility frame is valid.
                let frame = skipTour.frame
                XCTAssertGreaterThanOrEqual(frame.minX, 0)
                XCTAssertGreaterThanOrEqual(frame.minY, 0)
                app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width,
                                                              dy: frame.midY / app.frame.height)).tap()
            }
        }
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 20))
        // Fresh installs can show the system password-save sheet after the
        // calendar becomes visible. Decline only this exact prompt before
        // interacting with the saved route beneath it.
        let passwordSave = app.sheets["암호를 저장하겠습니까?"]
        if passwordSave.buttons["지금 안 함"].waitForExistence(timeout: 3) {
            passwordSave.buttons["지금 안 함"].tap()
        }
        let sharingNotice = app.alerts["공유 캘린더"]
        if sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].exists {
            sharingNotice.buttons["확인"].tap()
        }
        capture("isolated-release-calendar")
        let saved = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "격리 실제 ODsay 지하철 경로")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 20), "The actual saved route must appear in the calendar")
        if sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].exists {
            sharingNotice.buttons["확인"].tap()
        }
        // iOS 27 XCTest can report an invalid (-1, -1) hit point after it
        // auto-scrolls this nested agenda card. Tap its visible frame directly.
        let frame = saved.frame
        app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width,
                                                      dy: frame.midY / app.frame.height)).tap()
        let expand = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "일정 상세 시트 펼치기")).firstMatch
        XCTAssertTrue(expand.waitForExistence(timeout: 20))
        expand.tap()
        XCTAssertTrue(app.otherElements["saved-detail-controls"].waitForExistence(timeout: 15),
                      "Release must expose the authenticated saved-route guidance entry")
        XCTAssertFalse(app.staticTexts["지도 설정을 불러오지 못했습니다. 앱을 최신 버전으로 업데이트해 주세요."].exists,
                       "Release route detail must receive the map configuration")
        capture("isolated-release-saved-route-guidance")
    }

    private func isolatedSavedJourneyCard(expectedTitle: String? = nil) -> XCUIElement {
        let title=expectedTitle ?? ProcessInfo.processInfo.environment["E2E_EXPECTED_SCHEDULE_TITLE"]
        guard let title else { return app.buttons["selected-day-agenda-card"] }
        return app.buttons.matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@",
            "selected-day-agenda-card", title)).firstMatch
    }

    private func assertGuidanceHeading(_ title: String, timeout: TimeInterval) {
        let heading = app.staticTexts["saved-detail-guidance-heading"]
        XCTAssertTrue(heading.waitForExistence(timeout: timeout), "The saved-route guidance heading is missing")
        let updated = expectation(for: NSPredicate(format: "label == %@", title), evaluatedWith: heading)
        XCTAssertEqual(XCTWaiter().wait(for: [updated], timeout: timeout), .completed,
            "The saved-route guidance state did not become \(title)")
    }

    /// The saved-route departure action enters guidance on the same map. This
    /// tap must not record a departure or arm the GPS session by itself.
    func testIsolatedNavigationExpandedSheetKeepsMapVisible() throws {
        let environment = ProcessInfo.processInfo.environment
        let scheduleId = try XCTUnwrap(environment["E2E_SCHEDULE_ID"])
        let routeURL = try XCTUnwrap(URL(string: "nolate://schedule/\(scheduleId)"))
        app.open(routeURL)
        let email = app.textFields["이메일"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        let fixtureEmail = try XCTUnwrap(environment["E2E_EMAIL"])
        replace(email, with: fixtureEmail)
        XCTAssertEqual(email.value as? String, fixtureEmail)
        replaceSecure(app.secureTextFields["비밀번호"], with: try XCTUnwrap(environment["E2E_PASSWORD"]))
        app.staticTexts["NoLate"].firstMatch.tap()
        app.buttons["로그인"].tap()
        dismissSyntheticPasswordSavePrompt()
        let skipImport = app.buttons["일정 없이 시작하기"]
        if skipImport.waitForExistence(timeout: 5) { skipImport.tap() }
        let skipTour = app.buttons["사용법 건너뛰고 NoLate 시작하기"]
        if skipTour.waitForExistence(timeout: 5) { skipTour.tap() }
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 30))
        app.open(routeURL)
        let settings = app.buttons["schedule-route-guidance-settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 20))
        settings.tap()
        app.buttons["journey-options-prepare"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["schedule-navigation-header"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.otherElements["schedule-route-navigation-ready"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["schedule-navigation-next-step"].firstMatch.exists,
                       "Before preparation, the route sheet owns the instruction")
        let handle = app.buttons["schedule-route-sheet-handle"]
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        handle.tap()
        XCTAssertTrue(app.otherElements["saved-journey-route-bar"].waitForExistence(timeout: 5))
        capture("navigation-map-compact")
        handle.tap()
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        XCTAssertTrue(handle.frame.minY >= app.frame.height * 0.44,
                      "Expanded route details must leave a substantial visible map viewport")
        XCTAssertFalse(app.descendants(matching: .any)["schedule-navigation-next-step"].firstMatch.exists,
                       "The expanded route sheet owns the instruction")
        capture("navigation-map-expanded")
    }

    /// The product session decides every transition. Passenger and train movement are supplied
    /// separately by the isolated driver. A train at another station cannot pass this flow.
    private func verifySavedSubwayTransfer(sheetHandle: XCUIElement) throws {
        let instruction = app.staticTexts["saved-journey-instruction"]
        let action = app.staticTexts["saved-journey-progress"]
        func stage(_ title: String, containing hint: String? = nil, timeout: TimeInterval = 115) {
            let condition = NSPredicate { _, _ in
                guard instruction.exists, instruction.label == title else { return false }
                guard let hint else { return true }
                return action.exists && action.label.contains(hint)
            }
            let reached = XCTNSPredicateExpectation(predicate: condition, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [reached], timeout: timeout), .completed,
                           "Expected the active itinerary to display \(title) · \(hint ?? "")")
        }
        NSLog("E2E_SUBWAY_TRANSFER_ARMED")
        if ProcessInfo.processInfo.environment["E2E_SUBWAY_PLATFORM_NOTICE"] == "1" {
            // The saved route may show a platform ETA on the final walking meters, before
            // independent train position evidence is available to advance to the waiting stage.
            let eta = app.staticTexts["saved-journey-instruction-arrival"]
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let notice = springboard.descendants(matching: .any).matching(
                NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "진접행", "약 2분 후 도착")).firstMatch
            XCTAssertTrue(notice.waitForExistence(timeout: 300), "SpringBoard should show the approaching Jinjeop train")
            let banner = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            banner.name = "platform-two-minute-ios-notification"
            banner.lifetime = .keepAlways
            add(banner)
            func expectArrival(_ minutes: Int, timeout: TimeInterval) {
                let text = "진접행 열차 약 \(minutes)분 뒤 도착"
                let condition = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", text), object: eta)
                XCTAssertEqual(XCTWaiter.wait(for: [condition], timeout: timeout), .completed)
                let title = instruction.label, progress = action.label
                let walking = title == "서울역까지" && (progress.hasPrefix("도보 ") || progress.contains("승차 지점"))
                let waiting = title == "서울역" && (progress.contains("탑승 확인 전") || progress.contains("열차 대기"))
                XCTAssertTrue(walking || waiting, "Expected a walking or waiting passenger, got \(title) · \(progress)")
            }
            expectArrival(2, timeout: 10)
            capture("platform-two-minute-arrival")
            expectArrival(1, timeout: 85)
            capture("platform-one-minute-arrival")
            let returnsFromNotice = ProcessInfo.processInfo.environment["E2E_SUBWAY_NEXT_TRAIN"] == "1"
            if returnsFromNotice {
                app.open(try XCTUnwrap(URL(string: "nolate://schedule")))
                XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 12))
                XCTAssertFalse(eta.exists)
                XCUIDevice.shared.press(.home)
                XCTAssertTrue(app.wait(for: .runningBackground, timeout: 10))
                XCTAssertTrue(notice.waitForExistence(timeout: 125), "The following train must reach the passenger on the Home Screen")
                let nextBanner = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                nextBanner.name = "following-train-home-notification"
                nextBanner.lifetime = .keepAlways
                add(nextBanner)
                notice.tap()
                XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
                let restored = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label IN %@",
                    ["저장 경로 보기", "저장 경로 접기"]), object: sheetHandle)
                XCTAssertEqual(XCTWaiter.wait(for: [restored], timeout: 20), .completed,
                               "The notice must open the running trip from the calendar")
                if sheetHandle.label == "저장 경로 보기" { sheetHandle.tap() }
                expectArrival(2, timeout: 10)
                capture("following-train-platform-arrival")
                expectArrival(1, timeout: 75)
            }
            try stopSavedNavigation()
            if returnsFromNotice {
                XCTAssertTrue(app.staticTexts["위치 안내를 종료했어요"].waitForExistence(timeout: 15))
                XCTAssertTrue(app.buttons["schedule-guidance-ended-route-button"].exists)
                XCTAssertFalse(app.buttons["journey-navigation-menu"].exists)
                capture("following-train-ended-saved-trip")
            } else {
                let stopped = app.staticTexts["schedule-navigation-state"]
                let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "안내 종료"), object: stopped)
                XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 15), .completed)
            }
            NSLog("E2E_SUBWAY_PLATFORM_NOTICE_VERIFIED")
            return
        }
        let person = app.descendants(matching: .any)["schedule-detail-guidance-location-heading"].firstMatch
        XCTAssertTrue(person.waitForExistence(timeout: 100), "The walk to the platform must show a direction from passenger fixes")
        XCTAssertTrue((person.value as? String)?.contains("쪽으로 이동 중") == true)
        XCTAssertEqual(sheetHandle.label, "저장 경로 접기")
        XCTAssertTrue(instruction.exists && action.exists)
        XCTAssertFalse(app.staticTexts["saved-detail-subway-signal"].exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "탑승은 확인되지 않았어요")).firstMatch.exists)
        capture("walking-route-without-boarding-status")
        let camera = app.buttons["지도에서 내 현재 위치 보기"]
        let verifyWalk = ProcessInfo.processInfo.environment["E2E_SUBWAY_WALKING_HEADING_ONLY"] == "1"
        if verifyWalk {
            sheetHandle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let tilted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "지도 기울기 28도"), object: camera)
            XCTAssertEqual(XCTWaiter.wait(for: [tilted], timeout: 12), .completed, "The walking map must settle at the SDK-reported pitch")
        }
        capture("transfer-walking-passenger-heading")
        if verifyWalk {
            let initialDirection = person.value as? String
            sheetHandle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let nextDirection = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard person.exists, let value = person.value as? String else { return false }
                return value != initialDirection && ["동쪽으로 이동 중", "북동쪽으로 이동 중"].contains(value)
            }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [nextDirection], timeout: 155), .completed, "The arrow must turn with the actual sidewalk")
            XCTAssertLessThan(person.frame.midY, sheetHandle.frame.minY, "The marker must stay on the exposed part of the map")
            NSLog("E2E_WALKING_MAP %@ → %@, %@", initialDirection ?? "", person.value as? String ?? "", camera.value as? String ?? "")
            capture("transfer-walking-after-turn")
        }
        if ProcessInfo.processInfo.environment["E2E_SUBWAY_TRANSFER_COPY_ONLY"] == "1" {
            stage("서울역까지", containing: "도보", timeout: 90)
            let currentWalk = app.buttons["route-step-row-leg-0"]
            XCTAssertTrue(currentWalk.label.contains("현재 구간"))
            XCTAssertFalse(app.staticTexts["schedule-navigation-state"].exists)
            XCTAssertFalse(app.staticTexts["schedule-navigation-route-summary"].exists)
            XCTAssertFalse(app.descendants(matching: .any)["saved-journey-instruction-panel"].firstMatch.exists)
            let footer = app.descendants(matching: .any)["journey-navigation-footer"].firstMatch
            XCTAssertTrue(footer.frame.contains(action.frame), "The walking instruction should sit inside the fixed footer")
            capture("walking-rail-expanded")
            sheetHandle.tap()
            XCTAssertTrue(app.staticTexts["schedule-navigation-state"].waitForExistence(timeout: 6))
            XCTAssertTrue(app.descendants(matching: .any)["schedule-navigation-next-step"].firstMatch.exists)
            capture("walking-rail-collapsed")
            sheetHandle.tap()
            XCTAssertTrue(currentWalk.waitForExistence(timeout: 6))
        }
        stage("서울역", containing: "열차 대기", timeout: 290)
        XCTAssertFalse(person.exists, "Waiting for a train has no direction of travel")
        if verifyWalk {
            sheetHandle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let flat = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "평면 지도"), object: camera)
            XCTAssertEqual(XCTWaiter.wait(for: [flat], timeout: 12), .completed, "The platform should return to an overhead map")
            sheetHandle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            capture("transfer-platform-without-heading")
            try stopSavedNavigation()
            let stopped = app.staticTexts["schedule-navigation-state"]
            let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "안내 종료"), object: stopped)
            XCTAssertEqual(XCTWaiter.wait(for: [done], timeout: 15), .completed)
            NSLog("E2E_SUBWAY_WALKING_HEADING_VERIFIED")
            return
        }
        stage("회현")
        let marker = app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch
        sheetHandle.tap()
        stage("회현 → 명동")
        let firstLineRail = app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@ AND label CONTAINS %@", "현재 위치는", "4호선 구간입니다")).firstMatch
        XCTAssertTrue(firstLineRail.exists)
        XCTAssertTrue(marker.waitForExistence(timeout: 5))
        let firstX = marker.frame.midX
        let firstMeasurement = Date()
        capture("transfer-measured-segment-before")
        let movingWithinSamePair = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            instruction.exists && instruction.label == "회현 → 명동" && marker.exists && marker.frame.midX > firstX + 2
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [movingWithinSamePair], timeout: 25), .completed)
        let secondX = marker.frame.midX
        NSLog("E2E_SUBWAY_SEGMENT_MOVEMENT first=%.2f at=%.3f second=%.2f at=%.3f",
              firstX, firstMeasurement.timeIntervalSince1970, secondX, Date().timeIntervalSince1970)
        capture("transfer-measured-segment-after")
        sheetHandle.tap()
        stage("명동", containing: "환승")
        capture("transfer-first-train-one-station-before-change")
        sheetHandle.tap()
        stage("명동 → 충무로")
        XCTAssertTrue(marker.exists)
        let lossBegan = Date()
        NSLog("E2E_SUBWAY_SEGMENT_GPS_GAP")
        let losesFreshPosition = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            Date().timeIntervalSince(lossBegan) >= 16 && instruction.exists &&
                instruction.label == "마지막 확인 · 명동" && !marker.exists
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [losesFreshPosition], timeout: 30), .completed)
        capture("transfer-measured-segment-gps-lapse")
        NSLog("E2E_SUBWAY_SEGMENT_GPS_GAP_VERIFIED")
        sheetHandle.tap()
        stage("충무로")
        stage("충무로 환승", containing: "3호선 승차 · 환승 도보")
        // The first line's failed validation has already succeeded on retry. This
        // recovered transfer must have neither an obsolete warning nor a provider code.
        let staleWarning = app.staticTexts["saved-detail-runtime-error"]
        let warningCleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: staleWarning)
        XCTAssertEqual(XCTWaiter.wait(for: [warningCleared], timeout: 5), .completed)
        let codePattern = #"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b"#
        func assertPassengerCopy(_ node: XCUIElementSnapshot) {
            for text in [node.label, node.value as? String, node.title, node.placeholderValue].compactMap({ $0 }) {
                XCTAssertNil(text.range(of: codePattern, options: .regularExpression),
                             "Technical diagnostic in the passenger accessibility tree: \(text)")
            }
            node.children.forEach(assertPassengerCopy)
        }
        assertPassengerCopy(try app.snapshot())
        capture("transfer-walking-to-line-three")
        if ProcessInfo.processInfo.environment["E2E_SUBWAY_TRANSFER_COPY_ONLY"] == "1" {
            let stop = app.buttons["saved-detail-stop"]
            try stopSavedNavigation()
            let state = app.staticTexts["schedule-navigation-state"]
            let stopped = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "안내 종료"), object: state)
            XCTAssertEqual(XCTWaiter.wait(for: [stopped], timeout: 15), .completed)
            XCTAssertFalse(stop.exists)
            capture("transfer-user-stopped")
            NSLog("E2E_SUBWAY_TRANSFER_COPY_COMPLETE")
            return
        }
        stage("충무로", containing: "열차 대기")
        capture("transfer-second-platform-waiting")
        stage("을지로3가")
        sheetHandle.tap()
        let rail = app.descendants(matching: .any).matching(NSPredicate(
            format: "label CONTAINS %@ AND label CONTAINS %@", "현재 위치는", "3호선 구간입니다")).firstMatch
        XCTAssertTrue(rail.waitForExistence(timeout: 8))
        XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.exists)
        capture("transfer-second-train-map-and-current-marker")
        if ProcessInfo.processInfo.environment["E2E_SUBWAY_TRANSFER_LOCK"] == "1" {
            NSLog("E2E_SUBWAY_TRANSFER_LOCK_READY")
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let prompt = springboard.buttons["허용"]
            let approval = springboard.staticTexts.matching(NSPredicate(
                format: "label CONTAINS %@ AND label CONTAINS %@", "NoLate", "실시간 현황")).firstMatch
            let lock = springboard.staticTexts["guidance-lock-instruction"]
            let onLock = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                lock.exists || approval.exists
            }, object: springboard)
            XCTAssertEqual(XCTWaiter.wait(for: [onLock], timeout: 60), .completed)
            if approval.exists, prompt.exists { prompt.tap() }
            let measured = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "을지로3가 → 종로3가"), object: lock)
            XCTAssertEqual(XCTWaiter.wait(for: [measured], timeout: 65), .completed)
            let between = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            between.name = "transfer-measured-segment-on-lock"; between.lifetime = .keepAlways; add(between)
            // Progressing to the second line's next station while locked proves that the
            // lock card is following the new train, even where both lines share an interchange name.
            let advanced = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "종로3가"), object: lock)
            XCTAssertEqual(XCTWaiter.wait(for: [advanced], timeout: 85), .completed)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "transfer-second-line-lock-screen"; screenshot.lifetime = .keepAlways; add(screenshot)
            NSLog("E2E_SUBWAY_TRANSFER_LOCK_VERIFIED")
            app.activate()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        }
        sheetHandle.tap()
        stage("안국", containing: "하차")
        stage("경복궁", containing: "하차")
        stage("목적지까지")
        capture("transfer-final-walk")
        XCTAssertTrue(app.staticTexts["목적지에 도착했어요"].waitForExistence(timeout: 340))
        XCTAssertFalse(app.buttons["journey-navigation-menu"].exists)
        capture("transfer-automatic-arrival")
        NSLog("E2E_SUBWAY_TRANSFER_COMPLETE")
    }

    @MainActor
    func testIsolatedSavedRouteNavigationEntry() throws {
        func remoteControl(_ action: String, method: String = "GET") throws -> [String: Any] {
            let environment = ProcessInfo.processInfo.environment
            let nonce = try XCTUnwrap(environment["E2E_REMOTE_CONTROL_NONCE"])
            XCTAssertNotNil(nonce.range(of: "^[a-f0-9]{64}$", options: .regularExpression))
            var request = URLRequest(url: URL(string: "http://127.0.0.1:5535/_isolated-product-guidance/\(action)")!)
            request.httpMethod = method; request.timeoutInterval = 10
            request.setValue(nonce, forHTTPHeaderField: "X-NoLate-Isolated-Control")
            let result = expectation(description: "Isolated product guidance control")
            var data: Data?, status: Int?
            URLSession(configuration: .ephemeral).dataTask(with: request) { body, response, _ in
                data = body; status = (response as? HTTPURLResponse)?.statusCode; result.fulfill()
            }.resume()
            XCTAssertEqual(XCTWaiter().wait(for: [result], timeout: 12), .completed)
            guard status == 200, let data,
                  let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw NSError(domain: "NoLateIsolatedRemoteControl", code: 1)
            }
            return value
        }
        addUIInterruptionMonitor(withDescription: "Allow isolated route permissions") { alert in
            for label in ["앱을 사용하는 동안 허용", "앱 사용 중에만 허용", "Allow While Using App"] {
                let allow = alert.buttons[label]
                if allow.exists { allow.tap(); return true }
            }
            let notification = alert.staticTexts.matching(NSPredicate(
                format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "알림", "notifications")).firstMatch
            if notification.exists {
                for label in ["허용", "Allow"] {
                    if alert.buttons[label].exists { alert.buttons[label].tap(); return true }
                }
            }
            return false
        }
        app.terminate()
        app.activate()
        dismissTrackingPermissionIfPresent()
        let sharingNotice = app.alerts["공유 캘린더"]
        if sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].waitForExistence(timeout: 3) {
            sharingNotice.buttons["확인"].tap()
        }
        let environment = ProcessInfo.processInfo.environment
        if let id = environment["E2E_SCHEDULE_ID"], id.range(of: "^[1-9][0-9]{0,15}$", options: .regularExpression) != nil {
            let routeURL = URL(string: "nolate://schedule/\(id)")!
            app.open(routeURL)
            let email = app.textFields["이메일"]
            var loggedIn = false
            if email.waitForExistence(timeout: 10) {
                replace(email, with: try XCTUnwrap(environment["E2E_EMAIL"]))
                replaceSecure(app.secureTextFields["비밀번호"], with: try XCTUnwrap(environment["E2E_PASSWORD"]))
                app.staticTexts["NoLate"].firstMatch.tap()
                let login = app.buttons["로그인"]
                XCTAssertTrue(login.isEnabled, "The isolated login action must be enabled after exact credential entry")
                let loginFrame = login.frame
                app.coordinate(withNormalizedOffset: CGVector(dx: loginFrame.midX / app.frame.width,
                                                              dy: loginFrame.midY / app.frame.height)).tap()
                capture("isolated-login-action-tapped")
                loggedIn = true
            }
            dismissSyntheticPasswordSavePrompt()
            let notificationAlert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
            if notificationAlert.waitForExistence(timeout: 3),
               notificationAlert.staticTexts.matching(NSPredicate(
                format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@", "알림", "notifications")).firstMatch.exists {
                let allow = notificationAlert.buttons["허용"].exists ? notificationAlert.buttons["허용"] : notificationAlert.buttons["Allow"]
                if allow.exists { allow.tap() }
            }
            let skipImport = app.buttons["일정 없이 시작하기"]
            let hadOnboarding = skipImport.waitForExistence(timeout: 5)
            if hadOnboarding {
                skipImport.tap()
                if skipImport.waitForExistence(timeout: 2) {
                    let frame = skipImport.frame
                    app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width,
                                                                  dy: frame.midY / app.frame.height)).tap()
                }
            }
            let skipTour = app.buttons["사용법 건너뛰고 NoLate 시작하기"]
            let hadTour = skipTour.waitForExistence(timeout: 5)
            if hadTour { skipTour.tap() }
            if loggedIn || hadOnboarding || hadTour {
                // iOS can show the password-save sheet after onboarding settles.
                dismissSyntheticPasswordSavePrompt()
                XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 30))
                app.open(routeURL)
            }
        } else {
            if app.staticTexts["위치 안내가 끝났어요"].exists {
                let back = app.buttons["이전 화면으로 돌아가기"]
                XCTAssertTrue(back.waitForExistence(timeout: 5))
                back.tap()
            }
            let saved = isolatedSavedJourneyCard(expectedTitle: environment["E2E_EXPECTED_SCHEDULE_TITLE"]
                ?? "격리 실제 ODsay 지하철 경로")
            XCTAssertTrue(saved.waitForExistence(timeout: 25), "The isolated saved route must be visible")
            let frame = saved.frame
            app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width,
                                                          dy: frame.midY / app.frame.height)).tap()
        }
        let depart = app.buttons["schedule-route-departure-action"]
        if !depart.waitForExistence(timeout: 20) { dismissTrackingPermissionIfPresent() }
        XCTAssertTrue(depart.waitForExistence(timeout: 20), "The saved transit route needs its primary departure action")
        XCTAssertTrue(["지금 출발", "길안내 보기"].contains(depart.label),
                      "A reopened saved route may preserve its navigation entry label")
        XCTAssertTrue(depart.isEnabled, "The saved-route departure action must be tappable")
        let bongcheonFirstWalk = environment["E2E_BONGCHEON_FIRST_WALK"] == "1"
        struct WalkingFix: Decodable { let latitude: Double; let longitude: Double }
        var walkingFixes: [WalkingFix] = []
        let device = XCUIDevice.shared
        func simulatePosition(_ point: WalkingFix) {
            let location = CLLocation(coordinate: .init(latitude: point.latitude, longitude: point.longitude),
                                      altitude: 0, horizontalAccuracy: 5, verticalAccuracy: 5, timestamp: Date())
            device.location = XCUILocation(location: location)
        }
        defer { if bongcheonFirstWalk { device.location = nil } }
        if bongcheonFirstWalk {
            XCTAssertEqual(environment["E2E_SCHEDULE_ID"], "563")
            let replay = try XCTUnwrap(environment["E2E_FIRST_WALK_FIXES"])
            walkingFixes = try JSONDecoder().decode([WalkingFix].self, from: Data(replay.utf8))
            simulatePosition(try XCTUnwrap(walkingFixes.first))
            let routeTitle = app.descendants(matching: .any).matching(
                NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "봉천동", "강남역")).firstMatch
            XCTAssertTrue(routeTitle.waitForExistence(timeout: 10))
            capture("bongcheon-saved-route")
        }
        let needsSettings = ["E2E_CLEAR_PENDING_GUIDANCE", "E2E_NOTICE_PERSISTENCE", "E2E_LOCKED_DEPARTURE_NOTICE",
                             "E2E_SUBWAY_PLATFORM_NOTICE", "E2E_BUS_REMOTE_ACTIVITY_END"].contains { environment[$0] == "1" }
        if needsSettings {
            let settingsEntry = app.buttons["schedule-route-guidance-settings"]
            XCTAssertTrue(settingsEntry.waitForExistence(timeout: 10))
            settingsEntry.tap()
            if app.buttons["journey-options-prepare"].waitForExistence(timeout: 3) { app.buttons["journey-options-prepare"].tap() }
            let navigationReady = app.otherElements["schedule-route-navigation-ready"]
            if !navigationReady.waitForExistence(timeout: 2), settingsEntry.exists {
                // The compact scroll area can consume a tap while settling after
                // the deep link. Use the same product action in the expanded sheet.
                let handle = app.buttons["schedule-route-sheet-handle"]
                XCTAssertTrue(handle.waitForExistence(timeout: 5))
                handle.tap()
                let expandedDepart = app.buttons["schedule-route-guidance-settings"]
                XCTAssertTrue(expandedDepart.waitForExistence(timeout: 5))
                expandedDepart.tap()
                app.buttons["journey-options-prepare"].tap()
            }
            let locationPermission = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["앱을 사용하는 동안 허용"]
            if locationPermission.waitForExistence(timeout: 2) { locationPermission.tap() }
            XCTAssertTrue(navigationReady.waitForExistence(timeout: 10))
            XCTAssertTrue(app.descendants(matching: .any)["schedule-navigation-header"].firstMatch.waitForExistence(timeout: 5),
                          "Departure must switch the top chrome to the map guidance screen")
            XCTAssertTrue(app.staticTexts["schedule-navigation-state"].waitForExistence(timeout: 5),
                          "The guidance header must expose its live state")
            XCTAssertTrue(app.otherElements["saved-detail-controls"].waitForExistence(timeout: 10),
                          "Departure must reveal consent and guidance settings without a second preparation-entry tap")
            let entryHandle = app.buttons["schedule-route-sheet-handle"]
            XCTAssertTrue(entryHandle.frame.minY >= app.frame.height * 0.44,
                          "The preparation sheet must retain a substantial map viewport")
            XCTAssertFalse(app.buttons["journey-navigation-menu"].exists,
                           "Entering navigation must not start the GPS session")
            capture("isolated-navigation-ready-on-route-map")
            if environment["E2E_CLEAR_PENDING_GUIDANCE"] == "1" {
                if app.buttons["journey-navigation-menu"].exists || app.buttons["saved-detail-stop"].exists {
                    try stopSavedNavigation()
                    capture("isolated-navigation-live-session-cleared")
                    return
                }
                let restoreConsent = app.descendants(matching: .any)["saved-detail-restore-consent"].firstMatch
                XCTAssertTrue(restoreConsent.waitForExistence(timeout: 10), "A pending guidance checkpoint must be present")
                restoreConsent.tap()
                let restore = app.buttons["saved-detail-restore"]
                XCTAssertTrue(restore.waitForExistence(timeout: 10) && restore.isEnabled)
                restore.tap()
                try stopSavedNavigation()
                capture("isolated-navigation-pending-checkpoint-cleared")
                return
            }
            XCTAssertTrue(app.staticTexts["saved-detail-walking-connected"].waitForExistence(timeout: 30),
                          "Navigation entry must fetch the owned walking path without another button tap")
            if environment["E2E_BUS_REMOTE_ACTIVITY_END"] == "1" {
                let deadline = Date().addingTimeInterval(45)
                var ready = false
                repeat {
                    ready = (try? remoteControl("ready")["ready"] as? Bool) == true
                    if !ready { Thread.sleep(forTimeInterval: 0.5) }
                } while !ready && Date() < deadline
                XCTAssertTrue(ready, "The normal app bootstrap must register its own FCM route before remote guidance is armed")
                NSLog("E2E_PRODUCT_FCM_ROUTE_REGISTERED")
            }
            capture("isolated-navigation-preparation-in-route-sheet")
            if environment["E2E_NOTICE_PERSISTENCE"] == "1" {
                let settings = app.buttons["saved-guidance-notice-expand"]
                XCTAssertTrue(settings.waitForExistence(timeout: 10))
                settings.tap()
                let voice = app.buttons["saved-guidance-notice-voice"]
                XCTAssertTrue(voice.waitForExistence(timeout: 5))
                voice.tap()
                let selected = expectation(for: NSPredicate(format: "label CONTAINS %@", "음성 + 알림"),
                                           evaluatedWith: settings)
                XCTAssertEqual(XCTWaiter().wait(for: [selected], timeout: 10), .completed)
                app.terminate()
                // A separate UI test process verifies restore after a real cold launch.
                // Re-activating the app in this invocation can time out in CoreSimulator
                // even after the app has reached its calendar screen.
                return
            }
            let platformNotice = environment["E2E_SUBWAY_PLATFORM_NOTICE"] == "1"
            if environment["E2E_LOCKED_DEPARTURE_NOTICE"] == "1" || platformNotice {
                let noticeSettings = app.buttons["saved-guidance-notice-expand"]
                XCTAssertTrue(noticeSettings.waitForExistence(timeout: 10))
                noticeSettings.tap()
                let permission = app.buttons["saved-guidance-notice-permission"]
                XCTAssertTrue(permission.waitForExistence(timeout: 5))
                permission.tap()
                let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                let allow = springboard.alerts.buttons["허용"]
                if allow.waitForExistence(timeout: 5) { allow.tap() }
                let notifications = app.buttons[platformNotice ? "saved-guidance-notice-voice" : "saved-guidance-notice-notifications"]
                XCTAssertTrue(notifications.waitForExistence(timeout: 5))
                notifications.tap()
                let selected = expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: notifications)
                XCTAssertEqual(XCTWaiter().wait(for: [selected], timeout: 10), .completed,
                               "The product route sheet must select local notification guidance")
                capture("isolated-navigation-notifications-selected")
                if platformNotice { noticeSettings.tap() }
            }
            let consent = app.descendants(matching: .any)["saved-detail-consent"].firstMatch
            XCTAssertTrue(consent.waitForExistence(timeout: 10))
            if environment["E2E_EXPECT_OFFICIAL_BUS"] == "1" {
                let assessed = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: consent)
                XCTAssertEqual(XCTWaiter().wait(for: [assessed], timeout: 20), .completed,
                               "The real ODsay bus route must finish automatic native assessment")
            }
            consent.tap()
            let startGuidance = app.buttons["saved-detail-prepare"]
            XCTAssertTrue(startGuidance.waitForExistence(timeout: 10))
            if !startGuidance.isEnabled && environment["E2E_EXPECT_OFFICIAL_BUS"] == "1" {
                let enabled = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: startGuidance)
                XCTAssertEqual(XCTWaiter().wait(for: [enabled], timeout: 10), .completed,
                               "Consent must unlock the assessed bus guidance session")
            }
            if !startGuidance.isEnabled && environment["E2E_EXPECT_OFFICIAL_BUS"] != "1" {
                let enabled = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: startGuidance)
                _ = XCTWaiter().wait(for: [enabled], timeout: 15)
            }
            if !startGuidance.isEnabled && environment["E2E_EXPECT_OFFICIAL_BUS"] != "1" {
                let assess = app.buttons["saved-detail-assess"]
                if assess.exists && assess.isEnabled {
                    assess.tap()
                    let enabled = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: startGuidance)
                    _ = XCTWaiter().wait(for: [enabled], timeout: 15)
                }
            }
            XCTAssertTrue(startGuidance.isEnabled, "Consent and automatic assessment should unlock guidance")
            startGuidance.tap()
        } else {
            if environment["E2E_SUBWAY_WALKING_HEADING_ONLY"] == "1" {
                app.buttons["schedule-route-guidance-settings"].tap()
                XCTAssertTrue(app.buttons["journey-options-prepare"].waitForExistence(timeout: 8))
                XCTAssertFalse(app.buttons["saved-detail-stop"].exists)
                app.buttons["journey-options-close"].tap()
            }
            capture("saved-route-before-one-tap-departure")
            NSLog("E2E_TRANSIT_DEPARTURE_REQUESTED")
            depart.tap()
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let handle = app.buttons["schedule-route-sheet-handle"]
            let walkingRetry = app.buttons["saved-detail-connect-walking"]
            var retriedWalking = false
            let started = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                if bongcheonFirstWalk && !retriedWalking && walkingRetry.isHittable
                    && walkingRetry.label == "도보 경로 다시 시도" {
                    self.capture("bongcheon-walking-request")
                    retriedWalking = true
                    walkingRetry.tap()
                }
                let location = springboard.alerts.firstMatch
                for label in ["앱을 사용하는 동안 허용", "앱 사용 중에만 허용", "Allow While Using App"] {
                    if location.buttons[label].exists { location.buttons[label].tap(); break }
                }
                return handle.exists && handle.label == "저장 경로 보기"
            }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [started], timeout: 50), .completed,
                           "One departure tap and any iOS permission must open the active route")
            NSLog("E2E_TRANSIT_ONE_TAP_DEPARTURE")
        }
        let activeSheetHandle = app.buttons["schedule-route-sheet-handle"]
        XCTAssertTrue(activeSheetHandle.waitForExistence(timeout: 25))
        let mapFocused = expectation(for: NSPredicate(format: "label == %@", "저장 경로 보기"),
                                     evaluatedWith: activeSheetHandle)
        XCTAssertEqual(XCTWaiter().wait(for: [mapFocused], timeout: 10), .completed,
                       "A new guidance session must reveal the map and compact current-stage sheet")
        XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-bar"].firstMatch.waitForExistence(timeout: 5),
                      "Map-focused guidance must retain the whole-route progress bar")
        XCTAssertTrue(app.descendants(matching: .any)["schedule-navigation-next-step"].firstMatch.waitForExistence(timeout: 5),
                      "The map-focused route sheet must show the current instruction")
        let guidanceLocationAlert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.matching(
            NSPredicate(format: "label CONTAINS %@", "위치를 사용하도록 허용")).firstMatch
        if guidanceLocationAlert.waitForExistence(timeout: 8) {
            for label in ["앱을 사용하는 동안 허용", "앱 사용 중에만 허용", "Allow While Using App"] {
                let allow = guidanceLocationAlert.buttons[label]
                if allow.exists { allow.tap(); break }
            }
        }
        if bongcheonFirstWalk {
            let instruction = app.staticTexts["saved-journey-instruction"]
            let state = app.staticTexts["schedule-navigation-state"]
            XCTAssertTrue(instruction.waitForExistence(timeout: 20))
            XCTAssertTrue(instruction.label.contains("봉천"))
            XCTAssertEqual(state.label, "출발 대기")
            let clock = app.staticTexts["schedule-navigation-route-summary"]
            let currentEstimate = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                clock.label.contains("출발 기준") && clock.label.contains("도착 예상")
            }, object: clock)
            XCTAssertEqual(XCTWaiter.wait(for: [currentEstimate], timeout: 25), .completed)
            capture("bongcheon-ready-to-walk")
            NSLog("E2E_BONGCHEON_ARMED")
            // Replay the first walking leg only, with fixes spaced 9 m and 6 s apart.
            simulatePosition(try XCTUnwrap(walkingFixes.first))
            for fix in walkingFixes.dropFirst() {
                RunLoop.current.run(until: Date().addingTimeInterval(6))
                simulatePosition(fix)
                if state.label == "안내 중" { break }
            }
            let walking = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                state.label == "안내 중" && instruction.label.contains("봉천") &&
                    self.app.staticTexts["saved-journey-progress"].label.contains("도보")
            }, object: app)
            XCTAssertEqual(XCTWaiter.wait(for: [walking], timeout: 120), .completed)
            capture("bongcheon-walking-active")
            activeSheetHandle.tap()
            XCTAssertFalse(state.exists)
            XCTAssertFalse(app.staticTexts["schedule-navigation-route-summary"].exists)
            XCTAssertFalse(app.staticTexts["미래 시간표 예측 · 실시간 미확인"].exists)
            capture("bongcheon-guidance-expanded")
            try stopSavedNavigation()
            return
        }
        if environment["E2E_SUBWAY_WALKING_HEADING_ONLY"] == "1" {
            let camera = app.buttons["지도에서 내 현재 위치 보기"]
            let atOrigin = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "지도 기울기 28도"), object: camera)
            XCTAssertEqual(XCTWaiter.wait(for: [atOrigin], timeout: 40), .completed,
                           "The map must focus on the measured passenger fix before walking")
            XCTAssertEqual(app.staticTexts["schedule-navigation-state"].label, "출발 대기")
            XCTAssertEqual(app.staticTexts["saved-journey-instruction"].label, "서울역까지 걷기")
            XCTAssertTrue(app.staticTexts["saved-journey-progress"].label.contains("첫 구간 도보"))
            capture("saved-route-first-walk-before-departure")
            let menu = app.buttons["journey-navigation-menu"]
            let footer = app.descendants(matching: .any)["journey-navigation-footer"].firstMatch
            XCTAssertTrue(menu.isHittable && footer.frame.midY > app.frame.maxY * 0.80)
            XCTAssertFalse(app.buttons["saved-detail-stop"].exists)
            menu.tap()
            let notifications = app.descendants(matching: .any)["journey-option-NOTIFICATIONS"].firstMatch
            XCTAssertTrue(notifications.waitForExistence(timeout: 8))
            notifications.tap()
            let checked = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                notifications.isSelected || ["1", "checked"].contains(notifications.value as? String ?? "")
            }, object: notifications)
            XCTAssertEqual(XCTWaiter.wait(for: [checked], timeout: 8), .completed)
            capture("running-transit-navigation-options")
            app.buttons["journey-options-close"].tap()
            XCTAssertTrue(app.staticTexts["saved-journey-instruction"].waitForExistence(timeout: 8))
            NSLog("E2E_TRANSIT_READY_AT_MEASURED_ORIGIN")
        }
        capture("isolated-navigation-map-focused-on-start")
        activeSheetHandle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let expandedAgain = expectation(for: NSPredicate(format: "label == %@", "저장 경로 접기"),
                                        evaluatedWith: activeSheetHandle)
        XCTAssertEqual(XCTWaiter().wait(for: [expandedAgain], timeout: 10), .completed,
                       "The user must be able to reopen route details after map focus")
        XCTAssertFalse(app.descendants(matching: .any)["schedule-navigation-next-step"].firstMatch.exists,
                       "The expanded route sheet owns the instruction without a duplicate in the header")
        let runningMenu = app.buttons["journey-navigation-menu"]
        XCTAssertTrue(runningMenu.waitForExistence(timeout: 25),
                      "The authenticated saved route must arm a native GPS guidance session")
        XCTAssertTrue(app.staticTexts["saved-journey-instruction"].waitForExistence(timeout: 5),
                      "Current guidance remains available in the expanded route footer")
        XCTAssertFalse(app.staticTexts["saved-detail-guidance-heading"].exists,
                       "The expanded route sheet must not repeat the header's running status")
        if environment["E2E_SUBWAY_WALKING_HEADING_ONLY"] == "1" {
            let bars = app.descendants(matching: .any).matching(identifier: "saved-journey-route-bar")
            XCTAssertEqual(bars.count, 1)
            XCTAssertTrue(runningMenu.isHittable)
            runningMenu.tap()
            let selected = app.descendants(matching: .any)["journey-option-NOTIFICATIONS"].firstMatch
            let persisted = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                selected.exists && (selected.isSelected || ["1", "checked"].contains(selected.value as? String ?? ""))
            }, object: selected)
            XCTAssertEqual(XCTWaiter.wait(for: [persisted], timeout: 10), .completed)
            app.buttons["journey-options-close"].tap()
            XCTAssertTrue(app.staticTexts["saved-journey-instruction"].waitForExistence(timeout: 5))
            capture("expanded-transit-route-with-fixed-footer")
        }
        if environment["E2E_SUBWAY_TRANSFER_FULL_TRIP"] == "1" {
            try verifySavedSubwayTransfer(sheetHandle: activeSheetHandle)
            return
        }
        if environment["E2E_BUS_TRANSFER_FULL_TRIP"] == "1" {
            let instruction = app.staticTexts["saved-journey-instruction"]
            let progress = app.staticTexts["saved-journey-progress"]
            func awaitStage(_ title: String, action: String? = nil, timeout: TimeInterval = 200) {
                let stage = expectation(for: NSPredicate { _, _ in
                    instruction.exists && instruction.label == title
                        && (action == nil || progress.exists && progress.label.contains(action!))
                }, evaluatedWith: app)
                XCTAssertEqual(XCTWaiter().wait(for: [stage], timeout: timeout), .completed,
                               "The ordinary saved-route screen must reach the independently observed transfer stage: \(title)")
            }
            NSLog("E2E_TRANSFER_GPS_ARMED")
            awaitStage("합성 환승 정류장 1-0", action: "버스 대기")
            capture("isolated-transfer-first-bus-waiting")
            NSLog("E2E_TRANSFER_FIRST_WAITING")
            awaitStage("합성 환승 정류장 1-2", timeout: 120)
            capture("isolated-transfer-first-bus-riding")
            NSLog("E2E_TRANSFER_FIRST_RIDING")
            awaitStage("합성 환승 정류장 3-0 환승", timeout: 220)
            capture("isolated-transfer-walking")
            NSLog("E2E_TRANSFER_WALK_VISIBLE")
            awaitStage("합성 환승 정류장 3-0", action: "버스 대기", timeout: 120)
            capture("isolated-transfer-second-bus-waiting")
            NSLog("E2E_TRANSFER_SECOND_WAITING")
            awaitStage("합성 환승 정류장 3-2", timeout: 150)
            capture("isolated-transfer-second-bus-riding")
            activeSheetHandle.tap()
            XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-bar"].firstMatch.waitForExistence(timeout: 5))
            XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.waitForExistence(timeout: 10),
                          "Fresh independent second-bus evidence must place the current marker on the collapsed route bar")
            capture("isolated-transfer-second-bus-map-and-bar")
            activeSheetHandle.tap()
            NSLog("E2E_TRANSFER_SECOND_RIDING")
            awaitStage("목적지까지", timeout: 220)
            capture("isolated-transfer-final-walk")
            NSLog("E2E_TRANSFER_FINAL_WALK")
            XCTAssertTrue(app.staticTexts["목적지에 도착했어요"].waitForExistence(timeout: 150),
                          "The second bus must hand off to a GPS-confirmed final walk and automatic arrival")
            XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-bar"].firstMatch.waitForExistence(timeout: 15),
                           "Automatic arrival must compact the sheet and leave the destination map visible")
            XCTAssertFalse(app.buttons["journey-navigation-menu"].exists,
                           "Automatic arrival must release the active guidance session")
            capture("isolated-transfer-automatic-arrival")
            NSLog("E2E_TRANSFER_DESTINATION_ARRIVED")
            return
        }
        if environment["E2E_EXPECT_OFFICIAL_BUS"] == "1" {
            let detailedBus = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label CONTAINS %@", "1711")).firstMatch
            XCTAssertTrue(detailedBus.waitForExistence(timeout: 5),
                          "The expanded time rail must show the actual bus line")
            let sheetHandle = app.buttons["schedule-route-sheet-handle"]
            XCTAssertTrue(sheetHandle.waitForExistence(timeout: 5))
            sheetHandle.tap()
            let routeBar = app.descendants(matching: .any)["saved-journey-route-bar"].firstMatch
            XCTAssertTrue(routeBar.waitForExistence(timeout: 10),
                          "The collapsed sheet must show whole-route progress during guidance")
            XCTAssertTrue(app.descendants(matching: .any)
                .matching(NSPredicate(format: "label CONTAINS %@", "1711 예정")).firstMatch.exists,
                          "The collapsed route bar must retain the bus line in its accessible summary")
            capture("isolated-navigation-real-odsay-bus-armed")
            sheetHandle.tap()
            if environment["E2E_VERIFY_ACTIVE_REENTRY"] == "1" {
                app.buttons["길안내 화면에서 돌아가기"].tap()
                XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 15))
                let savedId = try XCTUnwrap(environment["E2E_SCHEDULE_ID"])
                let routeURL = try XCTUnwrap(URL(string: "nolate://schedule/\(savedId)"))
                app.open(routeURL)
                XCTAssertTrue(app.descendants(matching: .any)["schedule-navigation-header"].firstMatch.waitForExistence(timeout: 20),
                              "An active saved journey must reopen in its navigation map from the calendar")
                XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-bar"].firstMatch.waitForExistence(timeout: 10))
                capture("isolated-navigation-active-route-reentered")
                let reopenedHandle = app.buttons["schedule-route-sheet-handle"]
                XCTAssertTrue(reopenedHandle.waitForExistence(timeout: 5))
                reopenedHandle.tap()
                try stopSavedNavigation()
                let endedState = app.staticTexts["schedule-navigation-state"]
                XCTAssertTrue(endedState.waitForExistence(timeout: 10), "The ended journey remains on its map")
                XCTAssertEqual(endedState.label, "안내 종료")
                let endedHandle = app.buttons["schedule-route-sheet-handle"]
                XCTAssertTrue(endedHandle.waitForExistence(timeout: 5))
                endedHandle.tap()
                let endedStep = app.descendants(matching: .any)["schedule-navigation-next-step"].firstMatch
                XCTAssertTrue(endedStep.waitForExistence(timeout: 10))
                XCTAssertTrue(app.staticTexts["위치 안내가 끝났어요"].waitForExistence(timeout: 5))
                XCTAssertFalse(app.descendants(matching: .any)["schedule-route-navigation-ready"].firstMatch.exists)
                capture("isolated-navigation-ended-on-map")
                return
            }
            if environment["E2E_BUS_GPS_REPLAY"] == "1" {
                if environment["E2E_BUS_COMPACT_REENTRY_ARRIVAL"] == "1" {
                    app.buttons["길안내 화면에서 돌아가기"].tap()
                    XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 15))
                    let savedId = try XCTUnwrap(environment["E2E_SCHEDULE_ID"])
                    app.open(try XCTUnwrap(URL(string: "nolate://schedule/\(savedId)")))
                    XCTAssertTrue(app.descendants(matching: .any)["schedule-navigation-header"].firstMatch.waitForExistence(timeout: 20))
                    XCTAssertTrue(routeBar.waitForExistence(timeout: 10))
                    XCTAssertFalse(app.buttons["saved-detail-stop"].exists,
                                   "A reentered compact detail must not require opening the settings sheet")
                    capture("isolated-navigation-compact-reentry-before-gps")
                    let compactProgress = app.staticTexts["saved-journey-progress"].firstMatch
                    NSLog("E2E_BUS_GPS_ARMED")
                    let waiting = expectation(for: NSPredicate(format: "label CONTAINS %@", "버스 대기"), evaluatedWith: compactProgress)
                    XCTAssertEqual(XCTWaiter().wait(for: [waiting], timeout: 180), .completed)
                    NSLog("E2E_BUS_WAITING")
                    let riding = expectation(for: NSPredicate(format: "label CONTAINS %@", "경복궁역3번출구에서 하차"), evaluatedWith: compactProgress)
                    XCTAssertEqual(XCTWaiter().wait(for: [riding], timeout: 180), .completed)
                    XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.waitForExistence(timeout: 90),
                                  "A fresh correlated bus fix must show the passenger on the compact route bar")
                    capture("isolated-navigation-compact-reentry-riding")
                    let alighting = expectation(for: NSPredicate(format: "label CONTAINS %@", "하차 준비"), evaluatedWith: compactProgress)
                    XCTAssertEqual(XCTWaiter().wait(for: [alighting], timeout: 420), .completed)
                    let nearStop = expectation(for: NSPredicate(format: "label CONTAINS %@", "정류장 근처"), evaluatedWith: compactProgress)
                    XCTAssertEqual(XCTWaiter().wait(for: [nearStop], timeout: 180), .completed)
                    NSLog("E2E_BUS_NEAR_STOP")
                    let instruction = app.staticTexts["saved-journey-instruction"].firstMatch
                    let walking = expectation(for: NSPredicate(format: "label == %@", "목적지까지"), evaluatedWith: instruction)
                    XCTAssertEqual(XCTWaiter().wait(for: [walking], timeout: 180), .completed)
                    NSLog("E2E_BUS_FINAL_WALK")
                    capture("isolated-navigation-compact-reentry-final-walk")
                    XCTAssertTrue(app.staticTexts["목적지에 도착했어요"].waitForExistence(timeout: 240),
                                  "Automatic arrival must keep the reentered compact screen in navigation without mounting settings")
                    XCTAssertEqual(app.staticTexts["schedule-navigation-state"].label, "안내 종료")
                    XCTAssertTrue(routeBar.exists)
                    XCTAssertFalse(app.buttons["saved-detail-stop"].exists)
                    XCTAssertFalse(app.buttons["schedule-route-guidance-entry"].exists)
                    XCTAssertFalse(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.exists)
                    NSLog("E2E_BUS_COMPACT_REENTRY_ARRIVED")
                    capture("isolated-navigation-compact-reentry-arrived")
                    return
                }
                let progress = app.staticTexts["saved-journey-progress"].firstMatch
                NSLog("E2E_BUS_GPS_ARMED")
                if environment["E2E_EXPECT_REROUTE_TIMEOUT"] == "1" {
                    let endedState = app.staticTexts["schedule-navigation-state"]
                    let ended = expectation(for: NSPredicate(format: "label == %@", "안내 종료"),
                                            evaluatedWith: endedState)
                    XCTAssertEqual(XCTWaiter().wait(for: [ended], timeout: 180), .completed,
                                   "A reroute whose server confirmation is lost beyond the native deadline must end guidance")
                    XCTAssertFalse(app.buttons["journey-navigation-menu"].exists,
                                   "Timed-out guidance must not leave an active stop control")
                    capture("isolated-navigation-reroute-confirmation-timeout")
                    NSLog("E2E_REROUTE_TIMEOUT_ENDED")
                    return
                }
                if environment["E2E_EXPECT_REROUTE_COMMIT"] == "1" {
                    let origin = app.descendants(matching: .any)["route-step-row-origin"].firstMatch
                    if !origin.exists { sheetHandle.tap() }
                    let replaced = expectation(for: NSPredicate(format: "label CONTAINS %@", "현재 위치"),
                                               evaluatedWith: origin)
                    XCTAssertEqual(XCTWaiter().wait(for: [replaced], timeout: 180), .completed,
                                   "A deliberate off-route GPS fix must commit and display the new origin")
                    capture("isolated-navigation-reroute-current-origin-detail")
                    if !routeBar.exists { sheetHandle.tap() }
                    XCTAssertTrue(routeBar.waitForExistence(timeout: 10),
                                  "The committed route must show its whole-route summary when collapsed")
                    let currentSegment = app.descendants(matching: .any)
                        .matching(NSPredicate(format: "label CONTAINS %@", "현재 위치는")).firstMatch
                    XCTAssertTrue(currentSegment.waitForExistence(timeout: 90),
                                  "Fresh GPS on the committed route must restore the current segment marker")
                    XCTAssertFalse(app.staticTexts["위치 확인 중"].exists,
                                   "The new GPS evidence must restore the current navigation step")
                    capture("isolated-navigation-verified-reroute-on-map")
                    NSLog("E2E_REROUTE_DISPLAY_COMMITTED")
                    try stopSavedNavigation()
                    return
                }
                let waiting = expectation(for: NSPredicate(format: "label CONTAINS %@", "버스 대기"), evaluatedWith: progress)
                XCTAssertEqual(XCTWaiter().wait(for: [waiting], timeout: 180), .completed,
                               "Owned walking GPS must reach the actual 1711 boarding stop")
                capture("isolated-navigation-real-odsay-bus-waiting")
                NSLog("E2E_BUS_WAITING")
                if environment["E2E_OFF_ROUTE_GPS"] == "1" {
                    let instruction = app.staticTexts["saved-journey-instruction"]
                    let recovering = expectation(for: NSPredicate(format: "label == %@", "경로 확인 중"),
                                                 evaluatedWith: instruction)
                    XCTAssertEqual(XCTWaiter().wait(for: [recovering], timeout: 90), .completed,
                                   "A rejected passenger GPS fix must explain the uncertain saved route")
                    sheetHandle.tap()
                    XCTAssertTrue(routeBar.waitForExistence(timeout: 5))
                    XCTAssertFalse(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.exists,
                                   "An off-route fix must not place a current-position marker on the route")
                    capture("isolated-navigation-real-odsay-bus-off-route")
                    NSLog("E2E_OFF_ROUTE_VISIBLE")
                    sheetHandle.tap()
                    let recovered = expectation(for: NSPredicate(format: "label == %@", "서울역버스환승센터.강우규의거터"),
                                                evaluatedWith: instruction)
                    XCTAssertEqual(XCTWaiter().wait(for: [recovered], timeout: 90), .completed,
                                   "Fresh GPS back at the saved boarding stop must restore the route stage")
                    sheetHandle.tap()
                    XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.waitForExistence(timeout: 5),
                                  "The route bar must restore the current-position marker only after route recovery")
                    capture("isolated-navigation-real-odsay-bus-route-recovered")
                    sheetHandle.tap()
                    try stopSavedNavigation()
                    return
                }
                let riding = expectation(for: NSPredicate(format: "label == %@", "경복궁역3번출구에서 하차"), evaluatedWith: progress)
                XCTAssertEqual(XCTWaiter().wait(for: [riding], timeout: 150), .completed,
                               "Independent bus motion and passenger GPS must confirm a shared ride with its verified alighting stop")
                capture("isolated-navigation-real-odsay-bus-riding")
                sheetHandle.tap()
                XCTAssertTrue(routeBar.waitForExistence(timeout: 5),
                              "The map-focused ride must keep the whole-route bar visible")
                XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.waitForExistence(timeout: 60),
                              "A fresh confirmed ride must place the passenger marker on the collapsed route bar")
                XCTAssertEqual(app.staticTexts["schedule-navigation-state"].label, "안내 중")
                XCTAssertTrue(app.descendants(matching: .any)
                    .matching(NSPredicate(format: "label CONTAINS %@", "1711")).firstMatch.exists,
                    "The compact route summary must retain the current bus line")
                capture("isolated-navigation-real-odsay-bus-riding-map-focused")
                if environment["E2E_BUS_DELAYED_CADENCE"] == "1" {
                    let lastConfirmed = app.staticTexts["마지막 확인 · 1711"]
                    XCTAssertTrue(lastConfirmed.waitForExistence(timeout: 90),
                                  "A provider gap must retain the verified bus context without claiming a current fix")
                    XCTAssertFalse(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.exists,
                                   "A stale vehicle source cannot leave a live route marker")
                    capture("isolated-navigation-real-odsay-bus-source-gap")
                }
                sheetHandle.tap()
                if environment["E2E_BUS_FULL_TRIP"] == "1" {
                    let alighting = expectation(for: NSPredicate(format: "label CONTAINS %@", "하차 준비"),
                                                evaluatedWith: progress)
                    XCTAssertEqual(XCTWaiter().wait(for: [alighting], timeout: 420), .completed,
                                   "The verified 1711 journey must warn before the selected alighting stop")
                    NSLog("E2E_BUS_ALIGHTING_NOTICE")
                    capture("isolated-navigation-real-odsay-bus-alighting-notice")
                    let nearStop = expectation(for: NSPredicate(format: "label CONTAINS %@", "정류장 근처"),
                                               evaluatedWith: progress)
                    XCTAssertEqual(XCTWaiter().wait(for: [nearStop], timeout: 180), .completed,
                                   "The same vehicle must reach the selected alighting stop")
                    NSLog("E2E_BUS_NEAR_STOP")
                    capture("isolated-navigation-real-odsay-bus-near-stop")
                    if environment["E2E_BUS_LOCK_FULL_TRIP"] == "1" {
                        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                        NSLog("E2E_BUS_LOCK_BEFORE_HANDOFF_READY")
                        let nearStopCard = springboard.staticTexts["정류장 근처 · 하차 준비"].firstMatch
                        XCTAssertTrue(nearStopCard.waitForExistence(timeout: 75),
                                      "The independent simulator must be locked with the current alighting notice visible")
                        let nearAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                        nearAttachment.name = "isolated-navigation-bus-locked-near-stop"
                        nearAttachment.lifetime = .keepAlways
                        add(nearAttachment)
                        let finalWalkCard = springboard.staticTexts["목적지까지"].firstMatch
                        XCTAssertTrue(finalWalkCard.waitForExistence(timeout: 150),
                                      "Independent separation and walking must update the lock-screen Activity")
                        let walkingAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                        walkingAttachment.name = "isolated-navigation-bus-locked-final-walk"
                        walkingAttachment.lifetime = .keepAlways
                        add(walkingAttachment)
                        NSLog("E2E_BUS_LOCK_FINAL_WALK_VISIBLE")
                        let routeIdentity = springboard.descendants(matching: .any)
                            .matching(NSPredicate(format: "label CONTAINS %@", "1711")).firstMatch
                        XCTAssertTrue(routeIdentity.waitForExistence(timeout: 10),
                                      "The visible Activity must expose its saved route identity")
                        let arrivalHandoff = springboard.staticTexts["위치 안내를 종료했어요"].firstMatch
                        XCTAssertTrue(arrivalHandoff.waitForExistence(timeout: 180),
                                      "Automatic arrival must replace walking with the bounded arrival handoff card")
                        let handoffAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                        handoffAttachment.name = "isolated-navigation-bus-locked-arrival-handoff"
                        handoffAttachment.lifetime = .keepAlways
                        add(handoffAttachment)
                        NSLog("E2E_BUS_LOCK_ARRIVAL_HANDOFF_VISIBLE")
                        var absentSince: Date?
                        let removed = expectation(for: NSPredicate { _, _ in
                            if finalWalkCard.exists || routeIdentity.exists || arrivalHandoff.exists {
                                absentSince = nil
                                return false
                            }
                            if absentSince == nil { absentSince = Date() }
                            return Date().timeIntervalSince(absentSince!) >= 30
                        }, evaluatedWith: springboard)
                        XCTAssertEqual(XCTWaiter().wait(for: [removed], timeout: 180), .completed,
                                       "After the 90-second arrival handoff, all Activity content must remain absent for 30 seconds")
                        let endedAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                        endedAttachment.name = "isolated-navigation-bus-locked-after-arrival"
                        endedAttachment.lifetime = .keepAlways
                        add(endedAttachment)
                        NSLog("E2E_BUS_LOCK_CARD_REMOVED")
                        app.activate()
                        XCTAssertTrue(app.staticTexts["목적지에 도착했어요"].waitForExistence(timeout: 90),
                                      "Unlocking must reopen the automatically arrived journey")
                        capture("isolated-navigation-bus-arrived-after-unlock")
                        NSLog("E2E_BUS_DESTINATION_ARRIVED")
                        return
                    }
                    let instruction = app.staticTexts["saved-journey-instruction"]
                    let finalWalking = expectation(for: NSPredicate(format: "label == %@", "목적지까지"),
                                                   evaluatedWith: instruction)
                    XCTAssertEqual(XCTWaiter().wait(for: [finalWalking], timeout: 150), .completed,
                                   "Passenger dwell and independently departing bus must open final walking")
                    NSLog("E2E_BUS_FINAL_WALK")
                    capture("isolated-navigation-real-odsay-bus-final-walk")
                    let ended = app.staticTexts["목적지에 도착했어요"]
                    XCTAssertTrue(ended.waitForExistence(timeout: 180),
                                  "Continuous final-walk GPS must complete without a manual stop")
                    XCTAssertFalse(app.buttons["saved-detail-connect-walking"].exists,
                                   "Completed guidance must not prompt for a new walking route")
                    XCTAssertFalse(app.staticTexts["saved-detail-unsupported"].exists,
                                   "Completed guidance must not present the preflight error")
                    XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-bar"].firstMatch.waitForExistence(timeout: 10),
                                  "Automatic arrival must reveal the destination map and compact route summary")
                    XCTAssertFalse(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.exists,
                                   "Completed guidance must not retain a live passenger position claim")
                    XCTAssertFalse(app.buttons["saved-detail-view-saved-route"].exists,
                                   "The same sheet already contains the saved route; arrival must not add a duplicate action")
                    XCTAssertFalse(app.buttons["schedule-route-guidance-entry"].exists,
                                   "Arrived guidance must not offer a new preparation flow")
                    NSLog("E2E_BUS_DESTINATION_ARRIVED")
                    capture("isolated-navigation-real-odsay-bus-arrived")
                    return
                }
                if environment["E2E_BUS_REMOTE_ACTIVITY_END"] == "1" {
                    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                    NSLog("E2E_PRODUCT_REMOTE_LOCK_READY")
                    let liveRoute = springboard.descendants(matching: .any)
                        .matching(NSPredicate(format: "label CONTAINS %@", "1711")).firstMatch
                    let approval = springboard.staticTexts["NoLate의 실시간 현황을 허용하겠습니까?"]
                    let lockReady = expectation(for: NSPredicate { _, _ in approval.exists || liveRoute.exists }, evaluatedWith: springboard)
                    XCTAssertEqual(XCTWaiter().wait(for: [lockReady], timeout: 90), .completed)
                    if approval.exists { springboard.buttons["허용"].firstMatch.tap() }
                    XCTAssertFalse(approval.exists, "First-use approval must be dismissed before checking the card")
                    XCTAssertTrue(liveRoute.waitForExistence(timeout: 10), "The independent simulator must show the product Live Activity on its lock screen")
                    let locked = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                    locked.name = "product-remote-guidance-lock-before-process-exit"; locked.lifetime = .keepAlways; add(locked)
                    app.terminate()
                    XCTAssertEqual(app.state, .notRunning)
                    Thread.sleep(forTimeInterval: 3)
                    XCTAssertEqual(app.state, .notRunning, "The process must still be absent immediately before the server request")
                    XCTAssertTrue(liveRoute.exists, "The card must survive actual process exit before server END")
                    let retained = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                    retained.name = "product-remote-guidance-lock-after-process-exit"; retained.lifetime = .keepAlways; add(retained)
                    NSLog("E2E_PRODUCT_REMOTE_PROCESS_EXITED")
                    XCTAssertEqual(try remoteControl("cancel", method: "POST")["stopped"] as? Bool, true)
                    let removed = expectation(for: NSPredicate { _, _ in !liveRoute.exists }, evaluatedWith: springboard)
                    XCTAssertEqual(XCTWaiter().wait(for: [removed], timeout: 90), .completed,
                                   "The real provider END must remove the product card after actual process exit")
                    // iOS 27 was observed waking the app through liveactivitiesd's
                    // `Activity ended` assertion. The Mac driver must independently
                    // verify that daemon event if the process wakes in background.
                    let afterEnd = app.state
                    XCTAssertNotEqual(afterEnd, .runningForeground)
                    NSLog("E2E_PRODUCT_REMOTE_END_APP_STATE_%ld", afterEnd.rawValue)
                    let ended = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                    ended.name = "product-remote-guidance-lock-after-server-end"; ended.lifetime = .keepAlways; add(ended)
                    NSLog("E2E_PRODUCT_REMOTE_END_REMOVED_AFTER_PROCESS_EXIT")
                    return
                }
                if environment["E2E_BUS_LOCK_ACTIVITY"] == "1" {
                    NSLog("E2E_BUS_LOCK_READY")
                    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                    let lockInstruction = springboard.staticTexts.matching(NSPredicate(
                        format: "label == %@ OR label CONTAINS %@", "경복궁역3번출구에서 하차", "마지막 확인 · 1711")).firstMatch
                    XCTAssertTrue(lockInstruction.waitForExistence(timeout: 60),
                                  "The lock-screen Live Activity must show the verified alighting stop or its explicitly stale 1711 label")
                    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                    attachment.name = "isolated-navigation-real-odsay-bus-lock-screen"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    NSLog("E2E_BUS_LOCK_RIDE_CONTEXT_VISIBLE")
                    return
                }
            }
            try stopSavedNavigation()
            XCTAssertFalse(runningMenu.waitForExistence(timeout: 10),
                           "The isolated bus guidance session must stop cleanly")
            return
        }
        let arrivalHint = app.staticTexts["saved-journey-instruction-arrival"]
        XCTAssertTrue(app.staticTexts["saved-journey-instruction"].exists)
        capture("isolated-navigation-gps-session-armed")
        let locationAlert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.matching(
            NSPredicate(format: "label CONTAINS %@", "위치를 사용하도록 허용")).firstMatch
        if locationAlert.waitForExistence(timeout: 5) {
            let choices = locationAlert.buttons.matching(NSPredicate(
                format: "label CONTAINS %@ AND NOT label CONTAINS %@", "허용", "안 함")).allElementsBoundByIndex
            XCTAssertFalse(choices.isEmpty, "The simulator must offer a location permission choice")
            let allowed = choices.first(where: { $0.label.contains("사용") || $0.label.contains("동안") }) ?? choices[0]
            allowed.tap()
        }
        if environment["E2E_SIMULATE_MOVEMENT"] == "1" {
            let sheetHandle = app.buttons["schedule-route-sheet-handle"]
            XCTAssertTrue(sheetHandle.waitForExistence(timeout: 5))
            sheetHandle.tap()
            capture("isolated-navigation-map-before-movement")
            XCTAssertFalse(app.staticTexts["위치 안내가 끝났어요"].exists,
                           "The native guidance session must remain active before replaying GPS")
            NSLog("E2E_GPS_ARMED")
            if environment["E2E_LOCKED_DEPARTURE_NOTICE"] == "1" {
                NSLog("E2E_NOTICE_LOCK_READY")
                let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                let stageNotice = springboard.staticTexts.matching(NSPredicate(
                    format: "label CONTAINS %@ OR label CONTAINS %@ OR label CONTAINS %@",
                    "이동을 감지했습니다. 강남까지 안내합니다.",
                    "탑승할 노선을 확인해 주세요.", "탑승을 준비해 주세요.")).firstMatch
                XCTAssertTrue(stageNotice.waitForExistence(timeout: 150),
                              "Fresh background GPS must deliver the current boarding-stage notice to the lock screen")
                XCTAssertTrue(springboard.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "강남")).firstMatch.exists,
                              "The saved ODsay boarding station must appear in the lock-screen stage")
                let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                attachment.name = "isolated-navigation-locked-departure-notice"
                attachment.lifetime = .keepAlways
                add(attachment)
                NSLog("E2E_LOCKED_DEPARTURE_NOTICE_VISIBLE")
                return
            }
            if environment["E2E_FULL_SUBWAY_FINAL_WALK"] == "1" {
                let instruction = app.staticTexts["saved-journey-instruction"]
                if let intermediate = environment["E2E_FULL_SUBWAY_INTERMEDIATE_NAME"] {
                    let ended = app.staticTexts["위치 안내가 끝났어요"]
                    let reached = expectation(for: NSPredicate { _, _ in
                        (instruction.exists && instruction.label == intermediate) || ended.exists
                    }, evaluatedWith: app)
                    let initialTimeout: TimeInterval = environment["E2E_OFFICIAL_SUBWAY_FULL_TRIP"] == "1" ? 900 : 180
                    XCTAssertEqual(XCTWaiter().wait(for: [reached], timeout: initialTimeout), .completed,
                                   "Correlated passenger GPS and train must reach the intermediate station")
                    XCTAssertFalse(ended.exists,
                                   "Guidance must remain active while waiting for the correlated intermediate station")
                    XCTAssertEqual(instruction.label, intermediate)
                    NSLog("E2E_SUBWAY_INTERMEDIATE_REACHED")
                    capture("isolated-navigation-subway-intermediate-station")
                    if environment["E2E_OFFICIAL_SUBWAY_FULL_TRIP"] == "1" {
                        sheetHandle.tap()
                        XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-marker"].firstMatch.waitForExistence(timeout: 5),
                                      "Fresh official train correlation must reach the collapsed product route marker")
                        capture("official-subway-current-station-map-and-bar")
                        if environment["E2E_OFFICIAL_SUBWAY_LOCK_SCREEN"] == "1" {
                            NSLog("E2E_OFFICIAL_SUBWAY_RIDING_LOCK_READY")
                            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                            let title = springboard.staticTexts["guidance-lock-instruction"]
                            XCTAssertTrue(title.waitForExistence(timeout: 60))
                            XCTAssertEqual(title.label, intermediate,
                                           "The lock card must show the fresh current station, not a historical or uncertain label")
                            let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                            attachment.name = "official-subway-current-station-lock-screen"; attachment.lifetime = .keepAlways; add(attachment)
                            NSLog("E2E_OFFICIAL_SUBWAY_RIDING_LOCK_VISIBLE")
                            app.activate()
                            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
                        }
                        NSLog("E2E_OFFICIAL_SUBWAY_CURRENT_STATION_VISIBLE")
                    }
                }
                if let destination = environment["E2E_FULL_SUBWAY_DESTINATION_NAME"] {
                    let reached = expectation(for: NSPredicate(format: "label == %@", destination), evaluatedWith: instruction)
                    XCTAssertEqual(XCTWaiter().wait(for: [reached], timeout: 180), .completed,
                                   "Same train and continuous GPS must reach the destination station")
                    NSLog("E2E_SUBWAY_DESTINATION_REACHED")
                    capture("isolated-navigation-subway-destination-station")
                }
                let finalWalking = expectation(for: NSPredicate(format: "label == %@", "목적지까지"),
                                               evaluatedWith: instruction)
                XCTAssertEqual(XCTWaiter().wait(for: [finalWalking], timeout: 300), .completed,
                               "Confirmed passenger train and station-exit GPS must reach the final walking stage")
                capture("isolated-navigation-subway-final-walk")
                if environment["E2E_FULL_SUBWAY_LOCK_SCREEN"] == "1" {
                    NSLog("E2E_SUBWAY_LOCK_READY")
                    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                    let lockInstruction = springboard.staticTexts["목적지까지"]
                    XCTAssertTrue(lockInstruction.waitForExistence(timeout: 90),
                                  "The final walking instruction must appear in the lock-screen Live Activity")
                    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                    attachment.name = "isolated-navigation-subway-final-walk-lock-screen"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    NSLog("E2E_SUBWAY_LOCK_FINAL_WALK_VISIBLE")
                    return
                }
                if environment["E2E_FULL_SUBWAY_ARRIVAL"] == "1" {
                    let ended = app.staticTexts["목적지에 도착했어요"]
                    XCTAssertTrue(ended.waitForExistence(timeout: 240),
                                  "Continuous destination GPS must reach an explicit arrival state without a manual stop")
                    capture("isolated-navigation-subway-arrived")
                    NSLog("E2E_SUBWAY_DESTINATION_ARRIVED")
                    return
                }
                sheetHandle.tap()
                XCTAssertTrue(runningMenu.waitForExistence(timeout: 5))
                try stopSavedNavigation()
                return
            }
            let simulateToBoarding = environment["E2E_SIMULATE_TO_BOARDING"] == "1"
            Thread.sleep(forTimeInterval: simulateToBoarding ? 43 : 42)
            if simulateToBoarding {
                XCTAssertTrue(app.staticTexts["승차 지점 근처"].exists || app.staticTexts["승차 지점까지"].exists
                              || app.staticTexts["탑승 대기"].exists
                              || app.staticTexts["saved-journey-progress"].label.contains("열차 대기"),
                              "Fresh location along the owned walking path must reach the boarding approach")
            } else {
                XCTAssertTrue(app.staticTexts["승차 지점까지"].waitForExistence(timeout: 5),
                              "Real location updates on the owned walking path must advance guidance beyond departure waiting")
                XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "도보 약")).firstMatch.exists,
                              "Guidance must present remaining distance to the boarding point")
            }
            capture("isolated-navigation-after-simulated-movement")
            sheetHandle.tap()
            XCTAssertTrue(runningMenu.waitForExistence(timeout: 5))
            if simulateToBoarding && environment["E2E_EXPECT_SUBWAY_ARRIVAL_HINT"] == "1" {
                XCTAssertTrue(arrivalHint.waitForExistence(timeout: 10) && arrivalHint.label.contains("열차 도착까지"),
                              "A bound platform arrival must reach the product route detail after GPS approach")
                capture("isolated-navigation-subway-arrival-hint")
            }
        }
        try stopSavedNavigation()
    }

    /// Run after the notice-selection test has terminated the app. A separate
    /// test process proves the saved choice appears in the product route sheet.
    func testIsolatedGuidanceNoticePreferenceRestored() throws {
        let settings = app.buttons["saved-guidance-notice-expand"]
        if !settings.exists {
            let setup = app.buttons["schedule-route-guidance-settings"]
            if !setup.exists {
                let saved = isolatedSavedJourneyCard(expectedTitle: "격리 실제 ODsay 1711 경로")
                XCTAssertTrue(saved.waitForExistence(timeout: 25))
                saved.tap()
            }
            XCTAssertTrue(setup.waitForExistence(timeout: 25))
            setup.tap()
            app.buttons["journey-options-prepare"].tap()
        }
        XCTAssertTrue(settings.waitForExistence(timeout: 30))
        let restored = expectation(for: NSPredicate(format: "label CONTAINS %@", "음성 + 알림"),
                                   evaluatedWith: settings)
        XCTAssertEqual(XCTWaiter().wait(for: [restored], timeout: 10), .completed,
                       "The selected voice and notification channel must survive app restart")
        capture("isolated-navigation-notice-mode-after-restart")
    }

    /// The saved ODsay subway route must connect its two walking legs through the
    /// server before automatic guidance assessment. This does not forge GPS or boarding.
    func testIsolatedOdsaySubwayWalkingConnection() throws {
        let expectedTitle=ProcessInfo.processInfo.environment["E2E_EXPECTED_SCHEDULE_TITLE"] ?? "격리 실제 ODsay 지하철 경로"
        let sharingNotice = app.alerts["공유 캘린더"]
        if sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].waitForExistence(timeout: 4) {
            sharingNotice.buttons["확인"].tap()
        }
        if !app.otherElements["saved-detail-controls"].exists {
            let expand = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "일정 상세 시트 펼치기")).firstMatch
            if !expand.exists {
                let saved = isolatedSavedJourneyCard(expectedTitle:expectedTitle)
                XCTAssertTrue(saved.waitForExistence(timeout: 35), "The isolated saved ODsay route must be on today's calendar")
                XCTAssertTrue(saved.label.hasPrefix(expectedTitle), "Open only the isolated ODsay schedule")
                let frame = saved.frame
                app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width,
                                                              dy: frame.midY / app.frame.height)).tap()
            }
            if expand.waitForExistence(timeout: 10) { expand.tap() }
        }
        XCTAssertTrue(app.otherElements["saved-detail-controls"].waitForExistence(timeout: 20))
        let connect = app.buttons["saved-detail-connect-walking"]
        XCTAssertTrue(connect.waitForExistence(timeout: 15), "Saved ODsay subway route needs server-owned walking geometry")
        try reveal(connect)
        connect.tap()
        let connected = app.staticTexts["saved-detail-walking-connected"]
        XCTAssertTrue(connected.waitForExistence(timeout: 35),
                      "Officially saved ODsay route must connect both real TMAP walking legs")
        XCTAssertFalse(app.staticTexts["saved-detail-unsupported"].exists,
                       "A connected route must be available for independent server/native assessment")
        capture("isolated-odsay-subway-walking-connected")
    }

    /// A connected real ODsay route must still pass the independent native
    /// assessment and server admission before it can arm location guidance.
    func testIsolatedOdsaySubwayAutomaticPreparation() throws {
        // Reopen the installed product app rather than inheriting an expanded
        // route sheet and its stale local assessment from another test.
        app.terminate()
        app.activate()
        // A newly installed signed build can re-prompt for location before the
        // saved calendar loads. Accept only this isolated simulator's prompt.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allowLocation = springboard.alerts.buttons["앱을 사용하는 동안 허용"]
        if allowLocation.waitForExistence(timeout: 4) { allowLocation.tap() }
        else if app.alerts.buttons["앱을 사용하는 동안 허용"].exists {
            app.alerts.buttons["앱을 사용하는 동안 허용"].tap()
        }
        let sharingNotice = app.alerts["공유 캘린더"]
        if sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].waitForExistence(timeout: 4) {
            sharingNotice.buttons["확인"].tap()
        }
        if !app.otherElements["saved-detail-controls"].exists {
            let saved = isolatedSavedJourneyCard()
            XCTAssertTrue(saved.waitForExistence(timeout: 25))
            let frame = saved.frame
            app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width,
                                                          dy: frame.midY / app.frame.height)).tap()
            // The isolated backend's disabled sharing alert can arrive after
            // the initial launch check and intercept this first card tap.
            if sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].waitForExistence(timeout: 2) {
                sharingNotice.buttons["확인"].tap()
                saved.tap()
            }
            let expand = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "일정 상세 시트 펼치기")).firstMatch
            if expand.waitForExistence(timeout: 10) { expand.tap() }
        }
        XCTAssertTrue(app.otherElements["saved-detail-controls"].waitForExistence(timeout: 20))
        let connect = app.buttons["saved-detail-connect-walking"]
        XCTAssertTrue(connect.waitForExistence(timeout: 10))
        try reveal(connect)
        connect.tap()
        XCTAssertTrue(app.staticTexts["saved-detail-walking-connected"].waitForExistence(timeout: 30))
        let assess = app.buttons["saved-detail-assess"]
        XCTAssertTrue(assess.waitForExistence(timeout: 10))
        try reveal(assess)
        assess.tap()
        let consent = app.descendants(matching: .any)["saved-detail-consent"]
        XCTAssertTrue(consent.waitForExistence(timeout: 15))
        let consentReady = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: consent)
        XCTWaiter().wait(for: [consentReady], timeout: 20)
        XCTAssertTrue(consent.isEnabled, "Native assessment did not accept the connected route")
        consent.tap()
        let prepare = app.buttons["saved-detail-prepare"]
        XCTAssertTrue(prepare.isEnabled)
        prepare.tap()
        // The first CoreLocation request can occur only after preparation. Do
        // not count a hidden ARMED label behind a system permission sheet as
        // visible screen evidence.
        if allowLocation.waitForExistence(timeout: 4) { allowLocation.tap() }
        else if app.alerts.buttons["앱을 사용하는 동안 허용"].exists {
            app.alerts.buttons["앱을 사용하는 동안 허용"].tap()
        }
        assertGuidanceHeading("출발 대기", timeout: 30)
        capture("isolated-odsay-subway-armed")
        if ProcessInfo.processInfo.environment["E2E_REPLAY_DEPARTURE"] == "1" {
            // The external runner moves only this dedicated simulator along the
            // server-owned TMAP walk after ARMED. No test button advances the phase.
            assertGuidanceHeading("위치 안내 중", timeout: 120)
            capture("isolated-odsay-subway-location-departed")
            if ProcessInfo.processInfo.environment["E2E_OBSERVE_SUBWAY"] == "1" {
                // Keep the same owned session alive while the external runner
                // continues the first real TMAP walk and the native poller asks
                // the official provider for fresh trains. A screenshot alone
                // never asserts passenger boarding or APNs delivery.
                for sample in 1...4 {
                    Thread.sleep(forTimeInterval: 30)
                    capture("isolated-odsay-subway-official-observation-\(sample)")
                }
            }
        }
        // The independent simulator may have been locked while the native
        // journey continued. Unlock/foreground the app before the stop tap;
        // a tap used to activate SpringBoard is not an app button press.
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        try stopSavedNavigation()
        assertGuidanceHeading("위치 안내가 끝났어요", timeout: 15)
    }

    /// Clean up a failed GPS replay without deleting the native checkpoint by hand.
    func testIsolatedAutomaticGuidanceStop() throws {
        let stop = app.buttons["saved-detail-stop"]
        try stopSavedNavigation()
        let ended = app.staticTexts.matching(NSPredicate(format: "label IN %@", [
            "위치 안내가 끝났어요", "위치 안내를 종료했어요",
        ])).firstMatch
        XCTAssertTrue(ended.waitForExistence(timeout: 15))
        XCTAssertFalse(stop.exists)
        if ended.label == "위치 안내를 종료했어요" {
            XCTAssertTrue(app.buttons["schedule-guidance-ended-route-button"].exists)
        }
        capture("isolated-automatic-guidance-explicit-stop")
    }

    /// Read-only iOS provider E2E on the dedicated isolated Release simulator.
    /// It searches a real ODsay route from an existing synthetic draft and never saves it.
    func testIsolatedIOSOdsayRouteSearch() throws {
        let sharingNotice = app.alerts["공유 캘린더"]
        if sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].exists {
            sharingNotice.buttons["확인"].tap()
        }
        let saved = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "격리 Release 합성 경로")).firstMatch
        if saved.exists {
            let frame = saved.frame
            app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width,
                                                          dy: frame.midY / app.frame.height)).tap()
        }
        XCTAssertTrue(app.staticTexts["격리 Release 합성 경로"].waitForExistence(timeout: 20),
                      "Open only the isolated synthetic saved schedule before this test")
        let edit = app.buttons["일정 수정"]
        XCTAssertTrue(edit.waitForExistence(timeout: 10))
        edit.tap()
        let route = app.buttons["location-input-pressable"]
        XCTAssertTrue(route.waitForExistence(timeout: 15), "The edit draft has no route selector")
        if !route.isHittable { app.swipeUp() }
        route.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "출발지 재선택, 현재 합성 출발")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "도착지 재선택, 현재 합성 도착")).firstMatch.exists)
        let transit = app.buttons["대중교통"]
        XCTAssertTrue(transit.waitForExistence(timeout: 10))
        transit.tap()
        let candidate = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로")).firstMatch
        XCTAssertTrue(candidate.waitForExistence(timeout: 45), "Real ODsay maasRP returned no selectable iOS route")
        candidate.tap()
        XCTAssertTrue(app.buttons["이 경로 저장"].waitForExistence(timeout: 15),
                      "An ODsay result must expand into a selectable route detail")
        capture("isolated-ios-odsay-real-route-search")
        print("ISOLATED_IOS_ODSAY_ROUTE: " + candidate.label)
        print("ISOLATED_IOS_ODSAY_NOT_SAVED")
    }

    /// Persist a real ODsay result only in the synthetic isolated member's schedule.
    func testIsolatedIOSOdsayRouteSaveAndReopen() throws {
        let sharingNotice = app.alerts["공유 캘린더"]
        if sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].exists {
            sharingNotice.buttons["확인"].tap()
        }
        let retry = app.buttons["경로 다시 검색"]
        if retry.exists {
            // Retry through the existing product action after a genuine provider
            // timeout, retaining the same authenticated schedule and draft OD.
            try tap(retry)
            print("ISOLATED_IOS_ODSAY_EXPLICIT_RETRY")
        } else {
        let saved = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "격리 Release 합성 경로")).firstMatch
        if saved.exists {
            let frame = saved.frame
            app.coordinate(withNormalizedOffset: CGVector(dx: frame.midX / app.frame.width,
                                                          dy: frame.midY / app.frame.height)).tap()
        }
        XCTAssertTrue(app.staticTexts["격리 Release 합성 경로"].waitForExistence(timeout: 20))
        if sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].exists {
            sharingNotice.buttons["확인"].tap()
        }
        let edit = app.buttons["일정 수정"]
        XCTAssertTrue(edit.waitForExistence(timeout: 10))
        edit.tap()
        let route = app.buttons["location-input-pressable"]
        XCTAssertTrue(route.waitForExistence(timeout: 15))
        if !route.isHittable { app.swipeUp() }
        route.tap()
        let transit = app.buttons["대중교통"]
        XCTAssertTrue(transit.waitForExistence(timeout: 10))
        transit.tap()
        }
        print("ISOLATED_IOS_VIEWPORT width=\(app.frame.width) height=\(app.frame.height)")
        if ProcessInfo.processInfo.environment["E2E_PREFER_SUBWAY"] == "1" {
            let subwayFilter = app.buttons.matching(NSPredicate(
                format: "label BEGINSWITH %@ AND label ENDSWITH %@", "지하철 ", " 경로 필터"
            )).firstMatch
            XCTAssertTrue(subwayFilter.waitForExistence(timeout: 45))
            XCTAssertTrue(subwayFilter.isEnabled, "The real provider must offer a subway route for the selected OD")
            try tap(subwayFilter)
        }
        let candidate = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로")).firstMatch
        XCTAssertTrue(candidate.waitForExistence(timeout: 45))
        candidate.tap()
        let routeSave = app.buttons["이 경로 저장"]
        XCTAssertTrue(routeSave.waitForExistence(timeout: 15))
        try reveal(routeSave)
        try tap(routeSave)
        let scheduleSave = app.buttons["일정 수정 저장"]
        XCTAssertTrue(scheduleSave.waitForExistence(timeout: 15))
        try reveal(scheduleSave)
        try tap(scheduleSave)
        XCTAssertTrue(app.buttons["일정 수정"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["격리 Release 합성 경로"].exists)
        XCTAssertFalse(app.staticTexts["지도 설정을 불러오지 못했습니다. 앱을 최신 버전으로 업데이트해 주세요."].exists,
                       "Saved ODsay route must render with the configured map provider")
        capture("isolated-ios-odsay-route-saved-and-reopened")
        print("ISOLATED_IOS_ODSAY_ROUTE_PERSISTED")
    }

    func testCalendarCreateAndEdit() throws {
        let environment = ProcessInfo.processInfo.environment
        XCTAssertTrue(environment["E2E_EMAIL"]?.hasSuffix("@example.test") == true,
                      "Run only in the dedicated synthetic member simulator")
        let email = app.textFields["이메일"]
        if email.exists {
            let emailValue = try XCTUnwrap(environment["E2E_EMAIL"])
            replace(email, with: emailValue)
            XCTAssertEqual(email.value as? String, emailValue)
            replace(app.secureTextFields["비밀번호"], with: try XCTUnwrap(environment["E2E_PASSWORD"]))
            app.buttons["로그인"].tap()
        }
        try createAndEditSchedule()
    }

    func testSyntheticCalendarCreateReopenAndArchive() throws {
        XCTAssertTrue(ProcessInfo.processInfo.environment["E2E_EMAIL"]?.hasSuffix("@example.test") == true)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 30))
        let title = "XCUITest Calendar \(Int(Date().timeIntervalSince1970))"
        func openManager() throws {
            let selector = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "캘린더 선택")).firstMatch
            XCTAssertTrue(selector.waitForExistence(timeout: 10)); try tap(selector)
            let manage = app.buttons["캘린더 관리"]
            XCTAssertTrue(manage.waitForExistence(timeout: 10)); try tap(manage)
            XCTAssertTrue(app.buttons["공유 캘린더 새로고침"].waitForExistence(timeout: 20))
        }
        func tapVisibleCenter(_ control: XCUIElement) throws {
            // The header needs 70pt; the home indicator needs 34pt. A symmetric
            // 70pt bottom inset incorrectly rejects a fully visible last row.
            let touchArea = CGRect(x: app.frame.minX + 2, y: app.frame.minY + 70,
                                   width: app.frame.width - 4, height: app.frame.height - 104)
            for _ in 0..<5 {
                if control.exists && touchArea.contains(control.frame) { break }
                app.swipeUp()
            }
            XCTAssertTrue(control.exists && control.isEnabled)
            XCTAssertTrue(touchArea.contains(control.frame))
            control.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        func verifyDetails() throws {
            let categories = app.buttons[title + " 카테고리 관리"]
            XCTAssertTrue(categories.waitForExistence(timeout: 20), "Current calendar and members must load before detail actions appear")
            XCTAssertTrue(categories.isEnabled)
            XCTAssertFalse(app.alerts["멤버 조회 실패"].exists)
            // iOS 26.5 can report a false hit point for this visible RN row
            // after returning. Require a real navigation result from its frame.
            try tapVisibleCenter(categories)
            XCTAssertTrue(app.textFields["새 카테고리 이름"].waitForExistence(timeout: 20))
            try tap(app.buttons["뒤로 가기"])
            XCTAssertTrue(app.buttons["공유 캘린더 새로고침"].waitForExistence(timeout: 15))
        }
        try openManager()
        XCTAssertTrue(app.staticTexts["공유 캘린더가 없어요"].waitForExistence(timeout: 15), "Use a synthetic account without an existing shared calendar")
        let name = app.textFields["예: 가족 일정"]
        XCTAssertTrue(name.waitForExistence(timeout: 10)); replace(name, with: title)
        XCTAssertEqual(name.value as? String, title)
        XCTAssertTrue(app.buttons["공유 캘린더 추가"].isEnabled)
        name.typeText("\n") // The form's explicit Done action creates one calendar.
        try verifyDetails()
        // The first return materializes a routed manager. Reopening categories
        // must now use its actual router history without adding manager copies.
        try verifyDetails()
        capture("synthetic-calendar-created-ready")
        try tap(app.buttons["뒤로 가기"])
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 20))
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.activate()
        XCTAssertTrue(host.buttons["기차 텍스트 공유 테스트"].waitForExistence(timeout: 10))
        app.activate()
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 20))
        try openManager(); try verifyDetails()
        capture("synthetic-calendar-reopened-ready")
        let archive = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "캘린더 보관")).firstMatch
        try tapVisibleCenter(archive)
        let confirmation = app.alerts["캘린더 보관"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5)); confirmation.buttons["보관"].tap()
        XCTAssertTrue(app.staticTexts["공유 캘린더가 없어요"].waitForExistence(timeout: 20))
        try tap(app.buttons["뒤로 가기"])
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 20))
        try openManager()
        XCTAssertTrue(app.staticTexts["공유 캘린더가 없어요"].waitForExistence(timeout: 20), "An archived cached calendar must not reappear")
        XCTAssertFalse(app.alerts["멤버 조회 실패"].exists)
        capture("synthetic-calendar-archived-reopened-empty")
        try tap(app.buttons["뒤로 가기"])
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 20))
        print("SYNTHETIC_CALENDAR_ARCHIVED_AND_REOPENED_EMPTY \(title)")
    }

    /// Explicit setup after a test has intentionally replaced its server login.
    /// Keep this separate so the relaunch test can never hide lost authentication.
    func testExistingSyntheticMemberLogin() throws {
        let environment = ProcessInfo.processInfo.environment
        let emailValue = try XCTUnwrap(environment["E2E_EMAIL"])
        XCTAssertTrue(emailValue.hasSuffix("@example.test"))
        let email = app.textFields["이메일"]
        if email.waitForExistence(timeout: 5) {
            replace(email, with: emailValue)
            replaceSecure(app.secureTextFields["비밀번호"], with: try XCTUnwrap(environment["E2E_PASSWORD"]))
            app.staticTexts["NoLate"].firstMatch.tap()
            app.buttons["로그인"].tap()
        }
        let later = app.buttons["지금 안 함"]
        if later.waitForExistence(timeout: 3) { later.tap() }
        dismissSyntheticPasswordSavePrompt()
        let skipImport = app.buttons["일정 없이 시작하기"]
        if skipImport.waitForExistence(timeout: 3) {
            try tap(skipImport)
            let skipTour = app.buttons["사용법 건너뛰고 NoLate 시작하기"]
            if skipTour.waitForExistence(timeout: 10) { try tap(skipTour) }
        }
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 30))
    }

    /// Verify persisted calendar data after a process restart, independently of
    /// the mounted edit screen and its local React state.
    func testSavedCalendarScheduleAfterProcessRestart() throws {
        let environment = ProcessInfo.processInfo.environment
        XCTAssertTrue(environment["E2E_EMAIL"]?.hasSuffix("@example.test") == true)
        let title = try XCTUnwrap(environment["E2E_EXPECTED_SCHEDULE_TITLE"])
        XCTAssertTrue(title.hasPrefix("XCUITest ") && title.hasSuffix(" edited"))
        app.terminate()
        app.activate()
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 30))
        let createdAt = try XCTUnwrap(TimeInterval(String(title.split(separator: " ")[1])))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let day = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: createdAt))
        let date = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(day.year!)년 \(day.month!)월 \(day.day!)일,")).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 10)); date.tap()
        let saved = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 20), "The saved schedule must reload after process restart")
        capture("saved-calendar-after-process-restart")
    }

    /// Read-only route traversal used to generate comparable navigation performance rows.
    /// It signs in only with the synthetic XCTest fixture and never creates or edits data.
    func testScreenTransitionPerformance() throws {
        let environment = ProcessInfo.processInfo.environment
        let emailValue = try XCTUnwrap(environment["E2E_EMAIL"])
        XCTAssertTrue(emailValue.hasSuffix("@example.test"),
                      "Run only with the dedicated synthetic XCTest account")

        let unmatchedBack = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Go back")).firstMatch
        if unmatchedBack.waitForExistence(timeout: 2) { unmatchedBack.tap() }

        let email = app.textFields["이메일"]
        if email.waitForExistence(timeout: 3) {
            let passwordValue = try XCTUnwrap(environment["E2E_PASSWORD"])
            replace(email, with: emailValue)
            XCTAssertEqual(email.value as? String, emailValue)
            replaceSecure(app.secureTextFields["비밀번호"], with: passwordValue)
            RunLoop.current.run(until: Date().addingTimeInterval(1))
            app.buttons["로그인"].tap()
            let rejected = app.alerts["로그인을 확인해 주세요"]
            if rejected.waitForExistence(timeout: 5) {
                rejected.buttons["확인"].tap()
                replace(email, with: emailValue)
                XCTAssertEqual(email.value as? String, emailValue)
                replaceSecure(app.secureTextFields["비밀번호"], with: passwordValue)
                RunLoop.current.run(until: Date().addingTimeInterval(1))
                app.buttons["로그인"].tap()
            }
        }
        let skipPasswordSave = app.buttons["지금 안 함"]
        if skipPasswordSave.waitForExistence(timeout: 5) { skipPasswordSave.tap() }

        let calendarReady = app.buttons["일정 추가"]
        if !calendarReady.exists {
            let profileBack = app.buttons["일정 목록으로 돌아가기"]
            if profileBack.exists { profileBack.tap() }
        }
        XCTAssertTrue(calendarReady.waitForExistence(timeout: 30),
                      "The synthetic account should enter the calendar")

        try traverseRoute(open: "내 정보 및 설정",
                          ready: app.staticTexts["프로필"],
                          back: "일정 목록으로 돌아가기")

        let profileOpener = app.buttons
            .matching(NSPredicate(format: "label BEGINSWITH %@", "내 정보 및 설정"))
            .firstMatch
        XCTAssertTrue(profileOpener.waitForExistence(timeout: 10))
        profileOpener.tap()
        XCTAssertTrue(app.staticTexts["프로필"].waitForExistence(timeout: 10))
        let placesOpener = app.buttons["내 장소 관리"]
        XCTAssertTrue(placesOpener.waitForExistence(timeout: 10))
        placesOpener.tap()
        XCTAssertTrue(app.staticTexts["내 장소"].waitForExistence(timeout: 10))
        app.buttons["프로필로 돌아가기"].tap()
        XCTAssertTrue(app.staticTexts["프로필"].waitForExistence(timeout: 10))
        app.links["개인정보처리방침"].tap()
        XCTAssertTrue(app.staticTexts["개인정보처리방침"].waitForExistence(timeout: 10))
        app.buttons["이전 화면으로 돌아가기"].tap()
        XCTAssertTrue(app.staticTexts["프로필"].waitForExistence(timeout: 10))
        app.links["서비스 이용약관"].tap()
        XCTAssertTrue(app.staticTexts["서비스 이용약관"].waitForExistence(timeout: 10))
        app.buttons["이전 화면으로 돌아가기"].tap()
        XCTAssertTrue(app.staticTexts["프로필"].waitForExistence(timeout: 10))
        app.buttons["일정 목록으로 돌아가기"].tap()
        XCTAssertTrue(calendarReady.waitForExistence(timeout: 10))

        try traverseRoute(open: "알림함",
                          ready: app.staticTexts["알림"],
                          back: "뒤로 가기")
        try traverseRoute(open: "공유함",
                          ready: app.staticTexts["공유함"],
                          back: "뒤로 가기")

        let shareOpener = app.buttons
            .matching(NSPredicate(format: "label BEGINSWITH %@", "공유함"))
            .firstMatch
        XCTAssertTrue(shareOpener.waitForExistence(timeout: 10))
        shareOpener.tap()
        XCTAssertTrue(app.staticTexts["공유함"].waitForExistence(timeout: 10))
        app.buttons["공유 안전 관리"].tap()
        XCTAssertTrue(app.staticTexts["공유 안전 관리"].waitForExistence(timeout: 10))
        app.buttons["내 신고 내역"].tap()
        XCTAssertTrue(app.staticTexts["내 신고 내역"].waitForExistence(timeout: 10))
        app.buttons["공유 안전 관리로 돌아가기"].tap()
        XCTAssertTrue(app.staticTexts["공유 안전 관리"].waitForExistence(timeout: 10))
        app.buttons["차단한 사용자"].tap()
        XCTAssertTrue(app.staticTexts["차단한 사용자"].waitForExistence(timeout: 10))
        app.buttons["공유 안전 관리로 돌아가기"].tap()
        XCTAssertTrue(app.staticTexts["공유 안전 관리"].waitForExistence(timeout: 10))
        app.buttons["공유함으로 돌아가기"].tap()
        XCTAssertTrue(app.staticTexts["공유함"].waitForExistence(timeout: 10))
        app.buttons["뒤로 가기"].tap()
        XCTAssertTrue(calendarReady.waitForExistence(timeout: 10))

        app.buttons["일정 추가"].tap()
        let categoryManager = app.buttons["카테고리 관리"]
        XCTAssertTrue(categoryManager.waitForExistence(timeout: 10))
        categoryManager.tap()
        XCTAssertTrue(app.staticTexts["개인 카테고리"].waitForExistence(timeout: 10))
        app.buttons["뒤로 가기"].tap()
        XCTAssertTrue(calendarReady.waitForExistence(timeout: 10))

        let calendarSelector = app.buttons
            .matching(NSPredicate(format: "label BEGINSWITH %@", "현재 "))
            .firstMatch
        XCTAssertTrue(calendarSelector.waitForExistence(timeout: 10))
        calendarSelector.tap()
        let calendarManager = app.buttons["캘린더 관리"]
        XCTAssertTrue(calendarManager.waitForExistence(timeout: 10))
        calendarManager.tap()
        XCTAssertTrue(app.staticTexts["공유 캘린더"].waitForExistence(timeout: 10))
        app.buttons["뒤로 가기"].tap()
        XCTAssertTrue(calendarReady.waitForExistence(timeout: 10))

        let scheduleCard = app.buttons.matching(identifier: "selected-day-agenda-card").firstMatch
        if scheduleCard.waitForExistence(timeout: 5) {
            scheduleCard.tap()
            let detailBack = app.buttons["이전 화면으로 돌아가기"]
            XCTAssertTrue(detailBack.waitForExistence(timeout: 15),
                          "Schedule detail did not become usable")

            let directions = app.buttons["길안내 보기"]
            if directions.waitForExistence(timeout: 3) {
                directions.tap()
                let routeBack = app.buttons["이전 화면으로 돌아가기"]
                XCTAssertTrue(routeBack.waitForExistence(timeout: 15),
                              "Route selection did not become usable")
                routeBack.tap()
                XCTAssertTrue(detailBack.waitForExistence(timeout: 15))
            }

            detailBack.tap()
            XCTAssertTrue(calendarReady.waitForExistence(timeout: 15))
        }

        // The client queue batches writes; keep the authenticated app active long enough to flush.
        RunLoop.current.run(until: Date().addingTimeInterval(7))
        capture("screen-transition-performance")
    }

    private func traverseRoute(open label: String,
                               ready: XCUIElement,
                               back backLabel: String) throws {
        let opener = app.buttons
            .matching(NSPredicate(format: "label BEGINSWITH %@", label))
            .firstMatch
        XCTAssertTrue(opener.waitForExistence(timeout: 10), "Missing route opener: \(label)")
        opener.tap()
        XCTAssertTrue(ready.waitForExistence(timeout: 15), "Route did not become usable: \(label)")
        let back = app.buttons[backLabel]
        XCTAssertTrue(back.waitForExistence(timeout: 10), "Missing back control: \(backLabel)")
        back.tap()
        if !app.buttons["일정 추가"].waitForExistence(timeout: 2) {
            let profileBack = app.buttons["일정 목록으로 돌아가기"]
            if profileBack.exists { profileBack.tap() }
        }
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 15),
                      "Calendar did not become usable after \(label)")
    }

    /// Real provider search and real schedule POST, followed by process restart and server reload.
    func testIntercitySearchSaveReopen() throws {
        try intercitySearchSaveReopen(requiredKind: nil)
    }

    func testIntercityTrainSearchSaveReopen() throws {
        try intercitySearchSaveReopen(requiredKind: "기차")
    }

    func testIntercityRailKeywordSearchSaveReopen() throws {
        try intercitySearchSaveReopen(requiredKind: "기차", lookupTimetable: .seoulToDongdaegu, originName: "서울역 E2E",
                                     destinationName: "동대구역[KTX정차역]", nextDayDeadlineHour: 14,
                                     destinationQuery: "동대구역")
    }

    func testIntercityBusSearchSaveReopen() throws {
        try intercitySearchSaveReopen(requiredKind: "시외버스",
                                     originName: "동서울종합터미널 E2E",
                                     destinationName: "속초시외버스터미널 E2E",
                                     nextDayDeadlineHour: 14)
    }

    func testIntercityBusSelectedServiceSaveReopen() throws {
        try intercitySearchSaveReopen(requiredKind: "시외버스", selectTimetable: true,
                                     originName: "인천국제공항 제2여객터미널 E2E",
                                     destinationName: "청주시외버스터미널 E2E",
                                     nextDayDeadlineHour: 14)
    }

    func testIntercityLiveTimetableSearchSaveReopen() throws {
        try intercitySearchSaveReopen(requiredKind: "기차", lookupTimetable: .suseoToGongju)
    }

    func testIntercitySelectedServiceSaveReopen() throws {
        try intercitySearchSaveReopen(requiredKind: "기차", selectTimetable: true)
    }

    func testTrainTicketImageShareSaveReopen() throws {
        try trainTicketImageShareSaveReopen(connectRoute: false)
    }

    func testTrainTicketTextShareSaveReopen() throws {
        ticketShareFormat = "텍스트"
        try trainTicketImageShareSaveReopen(connectRoute: false)
    }

    /// A share extension writes outside the running JS process. Returning within
    /// the revision cooldown must refresh the already visible calendar too.
    func testTrainTicketTextShareWarmReturn() throws {
        XCTAssertTrue(ProcessInfo.processInfo.environment["E2E_EMAIL"]?.hasSuffix("@example.test") == true)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 30))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let day = calendar.dateComponents([.year, .month, .day], from: Date().addingTimeInterval(86400))
        let date = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(day.year!)년 \(day.month!)월 \(day.day!)일,")).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 15)); try tap(date)
        let title = "기차 수서 → 공주"
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch.exists,
                       "Use a synthetic account that has not imported the train fixture")
        let started = Date()
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.terminate(); host.launch()
        host.buttons["기차 텍스트 공유 테스트"].tap()
        let activity = host.cells.matching(NSPredicate(format: "label CONTAINS %@", "NoLate")).firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 15)); activity.tap()
        XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
        let save = host.buttons["ticket-review-save"]
        XCTAssertFalse(save.isEnabled)
        try confirmSharedTicket(in: host)
        save.tap()
        XCTAssertTrue(host.staticTexts["일정을 저장했어요"].waitForExistence(timeout: 20))
        XCTAssertTrue(host.staticTexts[title].exists)
        host.buttons["완료"].tap()
        app.activate() // Deliberately retain the same main-app process and cache.
        let elapsed = Date().timeIntervalSince(started)
        print("TICKET_WARM_SHARE_RETURN_SECONDS \(elapsed)")
        XCTAssertLessThan(elapsed, 60, "The return must exercise the revision cooldown window")
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 25), "A foreground return must reveal an externally saved ticket without restarting")
        capture("ticket-warm-return-calendar")
        card.tap()
        XCTAssertTrue(app.staticTexts["가져온 기차 승차권"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["경로 미설정"].exists)
        capture("ticket-warm-return-detail")
    }

    func testTrainTicketImageShareConnectRouteSaveReopen() throws {
        try trainTicketImageShareSaveReopen(connectRoute: true)
    }

    func testTrainOfficialBookingOpenReturn() throws {
        try trainTicketImageShareSaveReopen(connectRoute: true, verifyBooking: true)
    }

    private var useTrainBookingAppFixture = false
    private var useBusTicket = false
    private var ticketShareFormat = "이미지"
    private var ticketKindLabel: String { useBusTicket ? "시외버스" : "기차" }
    private var ticketSummaryHeading: String { useBusTicket ? "가져온 버스 승차권" : "가져온 기차 승차권" }
    private var ticketArrivalClock: String { useBusTicket ? "14:45" : "13:12" }
    private var ticketTitle: String { useBusTicket ? "시외버스 인천공항2터미널 → 청주" : "기차 수서 → 공주" }
    private var ticketBookingName: String { useBusTicket ? "티머니GO" : "코레일" }

    func testBusTicketImageShareConnectRouteSaveReopen() throws {
        useBusTicket = true
        try trainTicketImageShareSaveReopen(connectRoute: true, verifyBooking: true)
    }

    func testBusTicketImageShareSaveReopen() throws {
        useBusTicket = true
        try trainTicketImageShareSaveReopen(connectRoute: false)
    }

    /// Read-only regression after updating a build with an already saved ticket.
    /// No login or re-import may hide failure to refresh the persisted calendar.
    func testExistingBusTicketAfterProcessRestart() throws {
        useBusTicket = true
        try existingImportedTicketAfterProcessRestart()
    }

    func testExistingTrainTicketAfterProcessRestart() throws {
        try existingImportedTicketAfterProcessRestart()
    }

    private func existingImportedTicketAfterProcessRestart() throws {
        XCTAssertTrue(ProcessInfo.processInfo.environment["E2E_EMAIL"]?.hasSuffix("@example.test") == true)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 30))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let day = calendar.dateComponents([.year, .month, .day], from: Date().addingTimeInterval(86400))
        let date = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(day.year!)년 \(day.month!)월 \(day.day!)일,")).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 15)); try tap(date)
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", ticketTitle)).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 25), "Existing imported ticket must reappear without logging in or importing it again")
        capture("existing-ticket-calendar-repaired")
        try tap(card)
        XCTAssertTrue(app.staticTexts[ticketSummaryHeading].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["경로 미설정"].exists)
        XCTAssertFalse(app.staticTexts["메모 없음"].exists)
        capture("existing-ticket-reopened-after-cache-repair")
    }

    func testBusTicketPDFShareSaveReopen() throws {
        useBusTicket = true; ticketShareFormat = "PDF"; useTrainBookingAppFixture = true
        try trainTicketImageShareSaveReopen(connectRoute: false, verifyBooking: true)
        try rejectDuplicateBusPDF()
    }

    func testBusTicketPDFShareDuplicateSaveReopen() throws {
        useBusTicket = true; ticketShareFormat = "PDF"
        try trainTicketImageShareSaveReopen(connectRoute: false)
        try rejectDuplicateBusPDF()
    }

    func testBusTicketPDFDuplicateExistingShare() throws {
        XCTAssertTrue(ProcessInfo.processInfo.environment["E2E_EMAIL"]?.hasSuffix("@example.test") == true)
        useBusTicket = true; ticketShareFormat = "PDF"
        try rejectDuplicateBusPDF()
    }

    private func rejectDuplicateBusPDF() throws {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.terminate(); host.launch(); host.buttons["시외버스 PDF 공유 테스트"].tap()
        selectTicketShareExtension(in: host)
        XCTAssertTrue(host.staticTexts["버스 승차권 확인"].waitForExistence(timeout: 30))
        try confirmSharedTicket(in: host)
        let save = host.buttons["ticket-review-save"]
        save.tap()
        let duplicate = host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "이미 가져온 운행편입니다")).firstMatch
        XCTAssertTrue(duplicate.waitForExistence(timeout: 20), "A second confirmed share must show duplicate feedback instead of creating another schedule")
        let shot = XCTAttachment(screenshot: host.screenshot()); shot.name = "ticket-duplicate-rejected"; shot.lifetime = .keepAlways; add(shot)
        print("BUS_TICKET_DUPLICATE_SHARE_REJECTED")
    }

    private func selectTicketShareExtension(in host: XCUIApplication) {
        let hostCell = host.cells["NoLate"].firstMatch
        let sharing = XCUIApplication(bundleIdentifier: "com.apple.SharingUIService")
        let serviceCell = sharing.cells["NoLate"].firstMatch
        var iconCenter: CGPoint?
        var previous = CGRect.null
        // During presentation XCTest can find a miniature cell at the top of the screen.
        // Wait for its frame to settle before tapping the center of the visible icon.
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            // A visible share sheet can temporarily expose only a remote placeholder
            // in the host's accessibility tree. Query its running owner in that case.
            let cell: XCUIElement
            if hostCell.exists && hostCell.isHittable { cell = hostCell }
            else if sharing.state != .notRunning && serviceCell.exists && serviceCell.isHittable { cell = serviceCell }
            else { return false }
            let frame = cell.frame
            defer { previous = frame }
            guard frame == previous, !frame.isEmpty, host.frame.contains(frame) else { return false }
            iconCenter = CGPoint(x: frame.midX, y: frame.minY + frame.height * 0.4)
            return true
        }, object: nil)
        guard XCTWaiter.wait(for: [settled], timeout: 30) == .completed, let iconCenter else {
            XCTFail("NoLate was not available in the presented system share sheet")
            return
        }
        // On iOS 26 the system may replace the remote cell's AX identity even
        // after its frame has settled. The host coordinate space remains stable.
        let origin = host.frame.origin
        host.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: iconCenter.x - origin.x, dy: iconCenter.y - origin.y)).tap()
        // A cold extension can leave the system sheet blank before its first view appears.
        // Start the individual OCR or page assertions once NoLate owns the sheet.
        let status = host.scrollViews["share-status-scroll"].firstMatch
        let review = host.buttons["ticket-review-save"].firstMatch
        let launched = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            status.exists || review.exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [launched], timeout: 45), .completed,
                       "The selected NoLate share extension should appear in the host")
    }

    private func confirmSharedTicket(in host: XCUIApplication) throws {
        let confirm = host.buttons["ticket-review-confirm"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        // A partially clipped UIKit button can report hittable although its
        // center is below the sheet. Bring the whole control into the viewport.
        for _ in 0..<4 {
            let viewport = host.windows.firstMatch.frame.insetBy(dx: 0, dy: 70)
            if viewport.contains(confirm.frame) && confirm.isHittable { break }
            host.swipeUp()
        }
        XCTAssertTrue(confirm.isHittable)
        confirm.tap()
        let save = host.buttons["ticket-review-save"]
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in save.isEnabled }, object: nil)
        let result = XCTWaiter.wait(for: [enabled], timeout: 5)
        if result != .completed {
            let shot = XCTAttachment(screenshot: host.screenshot())
            shot.name = "ticket-confirmation-failure"; shot.lifetime = .keepAlways; add(shot)
        }
        XCTAssertEqual(result, .completed, "An explicit original-ticket confirmation must enable saving")
        if !save.isHittable { host.swipeUp() }
        XCTAssertTrue(save.isHittable)
    }

    func testTicketShareCancelAndInvalidInputs() throws {
        XCTAssertTrue(ProcessInfo.processInfo.environment["E2E_EMAIL"]?.hasSuffix("@example.test") == true)
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        func openShare(_ label: String) {
            host.terminate(); host.launch()
            let share = host.buttons[label]
            XCTAssertTrue(share.waitForExistence(timeout: 10)); share.tap()
            let activity = host.cells.matching(NSPredicate(format: "label CONTAINS %@", "NoLate")).firstMatch
            XCTAssertTrue(activity.waitForExistence(timeout: 15)); activity.tap()
        }
        func cancelReview(_ label: String) {
            let cancel = host.buttons["승차권 가져오기 취소"]
            for _ in 0..<4 {
                if host.windows.firstMatch.frame.insetBy(dx: 0, dy: 70).contains(cancel.frame)
                    && cancel.isHittable { break }
                host.swipeUp()
            }
            XCTAssertTrue(cancel.isHittable); cancel.tap()
            XCTAssertTrue(host.buttons[label].waitForExistence(timeout: 10))
        }
        openShare("기차 텍스트 공유 테스트")
        XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
        XCTAssertFalse(host.buttons["ticket-review-save"].isEnabled)
        cancelReview("기차 텍스트 공유 테스트")

        openShare("취소된 기차 표 공유 테스트")
        XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
        try confirmSharedTicket(in: host)
        host.buttons["ticket-review-save"].tap()
        let cancelled = host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "취소·환불된 표는 이동 계획으로 가져올 수 없어요")).firstMatch
        XCTAssertTrue(cancelled.waitForExistence(timeout: 10))
        XCTAssertFalse(host.staticTexts["일정을 저장했어요"].exists)
        let shot = XCTAttachment(screenshot: host.screenshot()); shot.name = "cancelled-ticket-rejected"; shot.lifetime = .keepAlways; add(shot)
        cancelReview("취소된 기차 표 공유 테스트")

        for (label, heading, message) in [
            ("여러 페이지 PDF 공유 테스트", "일정을 저장하지 못했어요", "잠기지 않은 한 페이지 승차권 PDF만 공유해 주세요"),
            ("기차 링크 공유 테스트", "승차권 내용이 필요해요", "승차권 상세 내용이 전달되지 않았어요")
        ] {
            openShare(label)
            XCTAssertTrue(host.staticTexts[heading].waitForExistence(timeout: 20))
            XCTAssertTrue(host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", message)).firstMatch.exists)
            XCTAssertFalse(host.staticTexts["일정을 저장했어요"].exists)
            let attachment = XCTAttachment(screenshot: host.screenshot()); attachment.name = label; attachment.lifetime = .keepAlways; add(attachment)
            host.buttons["닫기"].tap()
            XCTAssertTrue(host.buttons[label].waitForExistence(timeout: 10))
        }
        app.activate()
        print("TICKET_CANCEL_AND_INVALID_INPUTS_REJECTED")
    }

    /// Checks the actual extension with a synthetic Safari property list and
    /// URL. It proves payload precedence/review, not real Korail or Kakao support.
    func testTrainTicketWebPageShareReviewAndURLOnlyRecovery() throws {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.launch()
        func openShare(_ label: String) {
            let button = host.buttons[label]
            XCTAssertTrue(button.waitForExistence(timeout: 10)); button.tap()
            selectTicketShareExtension(in: host)
        }
        // Establish ordinary URL sharing first, independently of the synthetic
        // web-page representation offered by the fixture.
        openShare("기차 링크 공유 테스트")
        XCTAssertTrue(host.staticTexts["승차권 내용이 필요해요"].waitForExistence(timeout: 20))
        XCTAssertTrue(host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Safari로 열기")).firstMatch.exists)
        XCTAssertFalse(host.staticTexts["일정을 저장했어요"].exists)
        let urlRecovery = XCTAttachment(screenshot: host.screenshot())
        urlRecovery.name = "ticket-url-only-recovery"; urlRecovery.lifetime = .keepAlways; add(urlRecovery)
        host.buttons["닫기"].tap()
        XCTAssertTrue(host.buttons["기차 링크 공유 테스트"].waitForExistence(timeout: 10))

        openShare("제목과 승차권 링크 공유 테스트")
        XCTAssertTrue(host.staticTexts["승차권 내용이 필요해요"].waitForExistence(timeout: 20))
        XCTAssertFalse(host.staticTexts["기차 승차권 확인"].exists)
        host.buttons["닫기"].tap()
        XCTAssertTrue(host.buttons["제목과 승차권 링크 공유 테스트"].waitForExistence(timeout: 10))

        openShare("기차 웹페이지 본문 공유 테스트")
        XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
        XCTAssertEqual(host.textFields["승차권 출발역"].value as? String, "수서")
        XCTAssertEqual(host.textFields["승차권 도착역"].value as? String, "공주")
        XCTAssertEqual(host.textFields["승차권 열차번호"].value as? String, "615")
        XCTAssertFalse(host.buttons["ticket-review-save"].isEnabled)
        let review = XCTAttachment(screenshot: host.screenshot())
        review.name = "synthetic-ticket-webpage-review"; review.lifetime = .keepAlways; add(review)
        let cancel = host.buttons["승차권 가져오기 취소"]
        for _ in 0..<5 {
            if cancel.isHittable { break }
            host.swipeUp()
        }
        XCTAssertTrue(cancel.isHittable); cancel.tap()
        XCTAssertTrue(host.buttons["기차 웹페이지 본문 공유 테스트"].waitForExistence(timeout: 10))
        for label in ["기차 텍스트 공유 테스트", "기차 이미지 공유 테스트"] {
            openShare(label)
            XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
            for (name, expected, placeholder) in [("승차권 출발역", "수서", "출발역"), ("승차권 도착역", "공주", "도착역")] {
                let field = host.textFields[name]
                XCTAssertTrue(field.waitForExistence(timeout: 5))
                if label.contains("이미지") {
                    // As in the existing image-import E2E, ambiguous OCR stays
                    // blank and the user can correct it before confirming.
                    let value = field.value as? String ?? ""
                    if value != expected {
                        field.tap()
                        if !value.isEmpty && value != placeholder {
                            let clear = field.buttons.firstMatch
                            XCTAssertTrue(clear.waitForExistence(timeout: 3)); clear.tap()
                        }
                        for character in expected { field.typeText(String(character)) }
                        let done = host.buttons["키보드 닫기"]
                        if done.exists { done.tap() }
                    }
                }
                XCTAssertEqual(field.value as? String, expected)
            }
            XCTAssertFalse(host.buttons["ticket-review-save"].isEnabled)
            let cancel = host.buttons["승차권 가져오기 취소"]
            for _ in 0..<5 {
                if cancel.isHittable { break }
                host.swipeUp()
            }
            XCTAssertTrue(cancel.isHittable); cancel.tap()
            XCTAssertTrue(host.buttons[label].waitForExistence(timeout: 10))
        }
        app.activate()
        print("TICKET_WEBPAGE_REVIEW_AND_URL_RECOVERY_PASSED")
    }

    private func shareRenderedSmartTicket(_ arguments: [String] = [], date: String? = nil, environment: [String: String] = [:]) -> XCUIApplication {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.launchArguments = ["--webkit-smart-ticket"] + arguments
        host.launchEnvironment.merge(environment) { _, new in new }
        host.launchEnvironment["E2E_SMART_TICKET_DATE"] = date
        host.launch()
        let share = host.buttons["스마트티켓 웹페이지 공유 테스트"]
        XCTAssertTrue(share.waitForExistence(timeout: 15))
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == YES"), object: share)], timeout: 15), .completed)
        share.tap()
        selectTicketShareExtension(in: host)
        return host
    }

    func testSmartTicketRenderedWebPageRecognizesBothColumns() {
        let host = shareRenderedSmartTicket()
        verifySmartTicketReview(in: host, attachmentName: "rendered-webkit-ticket-review")
        cancelSmartTicket(in: host)
    }

    private func openTicketSharePageInSafari() throws -> XCUIApplication {
        guard let address = ProcessInfo.processInfo.environment["E2E_SMART_TICKET_SAFARI_URL"] else {
            throw XCTSkip("Serve the synthetic smart-ticket-share.html on loopback to test MobileSafari")
        }
        let url = try XCTUnwrap(URL(string: address))
        XCTAssertEqual(url.scheme, "http")
        XCTAssertEqual(url.host, "127.0.0.1")
        XCTAssertEqual(url.path, "/smart-ticket-share.html")
        let environment = ProcessInfo.processInfo.environment
        XCTAssertEqual(try XCTUnwrap(environment["SIMULATOR_UDID"]), environment["E2E_DEVICE_ID"])
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate()
        safari.open(url)
        return safari
    }

    private func shareFromSafari(_ label: String, in safari: XCUIApplication) {
        let button = safari.buttons[label]
        XCTAssertTrue(button.waitForExistence(timeout: 25))
        var previous = CGRect.null
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard button.exists, button.isHittable else { return false }
            let frame = button.frame
            defer { previous = frame }
            return !frame.isEmpty && frame == previous && safari.frame.contains(frame)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 15), .completed)
        button.tap()
        // A cold Safari can expose its page before it receives the first tap.
        // The fixture changes this exact label as soon as its click runs.
        let sent = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !button.exists || !button.isHittable
        }, object: nil)
        if XCTWaiter.wait(for: [sent], timeout: 3) == .timedOut, button.exists, button.isHittable {
            button.tap()
        }
        selectTicketShareExtension(in: safari)
    }

    func testSmartTicketFromSafariWebShare() throws {
        let safari = try openTicketSharePageInSafari()
        shareFromSafari("승차권 상세 텍스트 공유", in: safari)
        verifySmartTicketReview(in: safari, attachmentName: "mobile-safari-shared-ticket-text")
        cancelSmartTicket(in: safari)

        shareFromSafari("승차권 링크만 공유", in: safari)
        XCTAssertTrue(safari.staticTexts["승차권 내용이 필요해요"].waitForExistence(timeout: 20))
        XCTAssertTrue(safari.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "사진 앱에서 공유")).firstMatch.exists)
        XCTAssertFalse(safari.buttons["ticket-review-save"].exists)
        let shot = XCTAttachment(screenshot: safari.screenshot())
        shot.name = "mobile-safari-link-only-recovery"; shot.lifetime = .keepAlways; add(shot)
        safari.buttons["닫기"].tap()
        XCTAssertTrue(safari.buttons["승차권 링크만 공유 요청됨"].waitForExistence(timeout: 10))
        app.activate()
    }

    func testSmartTicketCarrierAppLinksRequestTicketContent() {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.launchArguments = ["--carrier-app-links"]
        for label in ["티머니GO 앱 링크 URL", "코레일톡 앱 링크 텍스트"] {
            openSmartTicket(in: host, label: label)
            XCTAssertTrue(host.staticTexts["승차권 내용이 필요해요"].waitForExistence(timeout: 20))
            XCTAssertFalse(host.buttons["ticket-review-save"].exists)
            host.buttons["닫기"].tap()
        }
        app.activate()
    }

    func testSmartTicketForwardedPreviewNeedsTicketDetails() {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.launchArguments = ["--carrier-app-links"]
        for label in ["전달받은 승차권 링크 미리보기", "전달받은 승차권 링크 메시지"] {
            openSmartTicket(in: host, label: label)
            XCTAssertTrue(host.staticTexts["승차권 내용이 필요해요"].waitForExistence(timeout: 20))
            XCTAssertFalse(host.buttons["ticket-review-save"].exists)
            host.buttons["닫기"].tap()
        }
        openSmartTicket(in: host, label: "승차권 상세와 전달 링크")
        verifySmartTicketReview(in: host, attachmentName: "forwarded-link-with-ticket-details")
        cancelSmartTicket(in: host)
        app.activate()
    }

    func testSmartTicketBusLinksAndDetailsFromSafari() throws {
        let safari = try openTicketSharePageInSafari()
        for label in ["티머니 시외버스 링크", "버스타고 링크", "고속버스통합예매 링크"] {
            shareFromSafari(label, in: safari)
            XCTAssertTrue(safari.staticTexts["승차권 내용이 필요해요"].waitForExistence(timeout: 20))
            XCTAssertFalse(safari.buttons["ticket-review-save"].exists)
            let shot = XCTAttachment(screenshot: safari.screenshot())
            shot.name = "link-only-" + label; shot.lifetime = .keepAlways; add(shot)
            safari.buttons["닫기"].tap()
        }
        shareFromSafari("승차권 상세와 버스타고 링크", in: safari)
        verifySharedIntercityBus(in: safari)
        cancelSmartTicket(in: safari)
        app.activate()
    }

    private func verifySharedIntercityBus(in host: XCUIApplication) {
        XCTAssertTrue(host.staticTexts["버스 승차권 확인"].waitForExistence(timeout: 25))
        XCTAssertEqual(host.textFields["승차권 출발 터미널"].value as? String, "동서울")
        XCTAssertEqual(host.textFields["승차권 도착 터미널"].value as? String, "속초")
        XCTAssertEqual(host.textFields["승차권 버스 등급"].value as? String, "우등")
        XCTAssertEqual(host.buttons["ticket-departure-time"].value as? String, "2026. 11. 12. 오후 6:43")
        XCTAssertEqual(host.buttons["ticket-arrival-time"].value as? String, "2026. 11. 12. 오후 8:32")
        XCTAssertFalse(host.buttons["ticket-review-save"].isEnabled)
        let shot = XCTAttachment(screenshot: host.screenshot())
        shot.name = "bus-ticket-detail-review"; shot.lifetime = .keepAlways; add(shot)
    }

    func testSmartTicketBusWebPageUsesCarrierAndRejectsBookingHome() {
        let express = shareRenderedSmartTicket(["--express-web-ticket"])
        verifySharedIntercityBus(in: express)
        XCTAssertTrue(express.buttons["고속버스"].isSelected)
        cancelSmartTicket(in: express)

        let home = shareRenderedSmartTicket(["--intercity-web-ticket", "--bus-booking-home"])
        XCTAssertTrue(home.staticTexts["승차권 내용이 필요해요"].waitForExistence(timeout: 20))
        XCTAssertFalse(home.buttons["ticket-review-save"].exists)
        home.buttons["닫기"].tap()
        app.activate()
    }

    func testSmartTicketTmoneyHomeFromSafariToolbar() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["E2E_PUBLIC_BUS_BOOKING_HOME"] == "1" else {
            throw XCTSkip("This case opens the public Tmoney intercity booking homepage")
        }
        try sharePublicBookingHome("intercitybus.tmoney.co.kr", attachment: "tmoney-public")
    }

    func testSmartTicketKorailHomeFromSafariToolbar() throws {
        guard ProcessInfo.processInfo.environment["E2E_PUBLIC_RAIL_BOOKING_HOME"] == "1" else {
            throw XCTSkip("This case opens the public Korail booking homepage")
        }
        try sharePublicBookingHome("www.korail.com", attachment: "korail-public")
    }

    private func sharePublicBookingHome(_ domain: String, attachment: String) throws {
        let environment = ProcessInfo.processInfo.environment
        XCTAssertEqual(try XCTUnwrap(environment["SIMULATOR_UDID"]), environment["E2E_DEVICE_ID"])
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate()
        safari.open(try XCTUnwrap(URL(string: "https://" + domain + "/")))
        let address = safari.textFields.matching(NSPredicate(format: "value ENDSWITH %@", domain.hasPrefix("www.") ? String(domain.dropFirst(4)) : domain)).firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 30))
        XCTAssertTrue(safari.buttons["ReloadButton"].waitForExistence(timeout: 30))
        let page = XCTAttachment(screenshot: safari.screenshot())
        page.name = attachment + "-mobile-landing"; page.lifetime = .keepAlways; add(page)
        let share = safari.buttons["ShareButton"].firstMatch
        if !share.exists || !share.isHittable {
            let menu = safari.buttons["MoreMenuButton"].firstMatch
            XCTAssertTrue(menu.waitForExistence(timeout: 5))
            menu.tap()
        }
        XCTAssertTrue(share.waitForExistence(timeout: 8))
        share.tap()
        selectTicketShareExtension(in: safari)
        XCTAssertTrue(safari.staticTexts["승차권 내용이 필요해요"].waitForExistence(timeout: 20))
        XCTAssertFalse(safari.buttons["ticket-review-save"].exists)
        let shot = XCTAttachment(screenshot: safari.screenshot())
        shot.name = attachment + "-home-safari-toolbar"; shot.lifetime = .keepAlways; add(shot)
        safari.buttons["닫기"].tap()
        app.activate()
    }

    func testSmartTicketReversedWebPageUsesVisualOrder() {
        let host = shareRenderedSmartTicket(["--reverse-web-ticket-dom"])
        verifySmartTicketReview(in: host, attachmentName: "reversed-webkit-ticket-review")
        cancelSmartTicket(in: host)
    }

    func testSmartTicketLabelledWebPageUsesClockLabels() {
        let host = shareRenderedSmartTicket(["--labelled-web-ticket"])
        verifySmartTicketReview(in: host, attachmentName: "labelled-webkit-ticket-review")
        cancelSmartTicket(in: host)
    }

    func testSmartTicketPartialWebPageLeavesTimesForReview() {
        let host = shareRenderedSmartTicket(["--partial-web-ticket"])
        XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
        XCTAssertEqual(host.textFields["승차권 열차번호"].value as? String, "255")
        for id in ["ticket-departure-time", "ticket-arrival-time"] {
            let time = host.buttons[id]
            XCTAssertTrue(time.exists)
            XCTAssertEqual(time.value as? String, "날짜와 시각 선택")
        }
        XCTAssertFalse(host.buttons["ticket-review-save"].isEnabled)
        cancelSmartTicket(in: host)
    }

    func testSmartTicketPastWebPageRejectsSave() throws {
        let host = shareRenderedSmartTicket(date: "2000년01월01일(토)")
        verifySmartTicketReview(in: host, attachmentName: "past-webkit-ticket-review", date: "2000. 01. 01.")
        try confirmSharedTicket(in: host)
        host.buttons["ticket-review-save"].tap()
        let error = host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "현재보다 늦은 출발 날짜와 시각을 선택해 주세요")).firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 10))
        XCTAssertFalse(host.staticTexts["일정을 저장했어요"].exists)
        cancelSmartTicket(in: host)
    }

    func testSmartTicketScreenshotRecognizesBothColumns() throws {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        openSmartTicket(in: host)
        verifySmartTicketReview(in: host, attachmentName: "synthetic-smart-ticket-photo-review")
        cancelSmartTicket(in: host)
        XCTAssertTrue(host.buttons["스마트티켓 화면 공유 테스트"].waitForExistence(timeout: 10))
    }

    func testSmartTicketCompactRailPhotoReadsPrintedRoute() {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        openSmartTicket(in: host, label: "기차 이미지 공유 테스트")
        XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
        XCTAssertEqual(host.textFields["승차권 출발역"].value as? String, "수서")
        XCTAssertEqual(host.textFields["승차권 도착역"].value as? String, "공주")
        XCTAssertEqual(host.textFields["승차권 열차번호"].value as? String, "615")
        XCTAssertTrue((host.buttons["ticket-departure-time"].value as? String)?.hasSuffix("오후 12:20") == true)
        XCTAssertTrue((host.buttons["ticket-arrival-time"].value as? String)?.hasSuffix("오후 1:12") == true)
        XCTAssertFalse(host.buttons["ticket-review-save"].isEnabled)
        let shot = XCTAttachment(screenshot: host.screenshot())
        shot.name = "compact-srt-route-review"; shot.lifetime = .keepAlways; add(shot)
        cancelSmartTicket(in: host)
        app.activate()
    }

    func testSmartTicketEditingStationRequiresConfirmationAgain() throws {
        let host = shareRenderedSmartTicket()
        let field = host.textFields["승차권 출발역"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        XCTAssertEqual(field.value as? String, "서울")
        try confirmSharedTicket(in: host)
        let save = host.buttons["ticket-review-save"]
        XCTAssertTrue(save.isEnabled)
        for _ in 0..<4 {
            if host.windows.firstMatch.frame.insetBy(dx: 0, dy: 70).contains(field.frame) && field.isHittable { break }
            host.swipeDown()
        }
        XCTAssertTrue(field.isHittable)
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let clear = field.buttons.firstMatch
        XCTAssertTrue(clear.waitForExistence(timeout: 5))
        clear.tap()
        field.typeText("수서")
        let edited = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "수서"), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [edited], timeout: 8), .completed)
        XCTAssertFalse(save.isEnabled)
        let evidence = XCTAttachment(screenshot: host.screenshot())
        evidence.name = "edited-station-review"; evidence.lifetime = .keepAlways; add(evidence)
        cancelSmartTicket(in: host)
        app.activate()
    }

    func testSmartTicketScreenshotFromPhotos() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let photoLabel = environment["E2E_SMART_TICKET_PHOTO_LABEL"], !photoLabel.isEmpty else {
            throw XCTSkip("Import the synthetic smart-ticket JPEG and provide its exact Photos accessibility label")
        }
        let simulator = try XCTUnwrap(environment["SIMULATOR_UDID"])
        XCTAssertEqual(simulator, environment["E2E_DEVICE_ID"])
        let photos = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow")
        openSmartTicketPhoto(in: photos, label: photoLabel)
        verifySmartTicketReview(in: photos, attachmentName: "photos-smart-ticket-review")
        cancelSmartTicket(in: photos)
        XCTAssertTrue(photos.buttons["PUOneUpBarButtonItemIdentifierShare"].waitForExistence(timeout: 10))
        let back = photos.buttons["BackButton"]
        XCTAssertTrue(back.isHittable)
        back.tap()
        XCTAssertTrue(photos.descendants(matching: .any).matching(NSPredicate(format: "label == %@", photoLabel)).firstMatch.waitForExistence(timeout: 10))
    }

    private func openSmartTicketPhoto(in photos: XCUIApplication, label: String) {
        photos.launch()
        let share = photos.buttons["PUOneUpBarButtonItemIdentifierShare"]
        let back = photos.buttons["BackButton"]
        // Photos can restore the single-photo viewer after the app relaunches.
        if share.waitForExistence(timeout: 2), back.isHittable { back.tap() }
        let thumbnail = photos.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
        XCTAssertTrue(thumbnail.firstMatch.waitForExistence(timeout: 15))
        XCTAssertEqual(thumbnail.count, 1, "The seeded synthetic photo must be uniquely identifiable")
        thumbnail.firstMatch.tap()
        XCTAssertTrue(share.waitForExistence(timeout: 10))
        share.tap()
        let activity = photos.cells.matching(NSPredicate(format: "label CONTAINS %@", "NoLate")).firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 15))
        activity.tap()
    }

    func testSmartTicketUpcomingSaveAndReopen() throws {
        try saveAndReopenSmartTicket(.photo)
    }

    func testSmartTicketUpcomingScannedPDFSaveAndReopen() throws {
        try saveAndReopenSmartTicket(.scannedPDF)
    }

    func testSmartTicketUpcomingWebPageSaveAndReopen() throws {
        try saveAndReopenSmartTicket(.webPage)
    }

    private enum SmartTicketSource { case photo, scannedPDF, webPage }

    private func verifyTicketWriteAccount() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let account = environment["E2E_TICKET_WRITE_EMAIL"] else {
            throw XCTSkip("A signed-in synthetic account is required for the schedule write")
        }
        XCTAssertTrue(account.hasSuffix("@example.test"))
        XCTAssertEqual(try XCTUnwrap(environment["SIMULATOR_UDID"]), environment["E2E_DEVICE_ID"])
        // On a fresh install Passwords may present its sheet only when the
        // user returns to NoLate from the extension.
        dismissSyntheticPasswordSavePrompt()
        let addSchedule = app.buttons["일정 추가"]
        if !addSchedule.waitForExistence(timeout: 3) {
            app.open(try XCTUnwrap(URL(string: "nolate://schedule")))
            XCTAssertTrue(addSchedule.waitForExistence(timeout: 20))
        }
        let profile = app.buttons["내 정보 및 설정"]
        XCTAssertTrue(profile.waitForExistence(timeout: 20))
        let member = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", account)).firstMatch
        try tap(profile)
        if !member.waitForExistence(timeout: 4), addSchedule.isHittable {
            // A pending calendar navigation can complete after the first tap.
            try tap(profile)
        }
        XCTAssertTrue(member.waitForExistence(timeout: 10))
        try tap(app.buttons["일정 목록으로 돌아가기"])
    }

    private func saveAndReopenSmartTicket(_ source: SmartTicketSource) throws {
        try verifyTicketWriteAccount()
        let environment = ProcessInfo.processInfo.environment
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Seoul"))
        let tomorrow = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: Date()))
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy년MM월dd일(E)"
        let host: XCUIApplication
        if source == .webPage {
            host = shareRenderedSmartTicket(date: formatter.string(from: tomorrow))
        } else if source == .photo, let photoLabel = environment["E2E_UPCOMING_SMART_TICKET_PHOTO_LABEL"] {
            host = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow")
            openSmartTicketPhoto(in: host, label: photoLabel)
        } else {
            host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
            host.launchEnvironment["E2E_SMART_TICKET_DATE"] = formatter.string(from: tomorrow)
            if source == .scannedPDF {
                host.launchArguments = ["--smart-ticket-pdf-fixtures"]
                openSmartTicket(in: host, label: "스마트티켓 스캔 PDF 공유 테스트")
            } else {
                openSmartTicket(in: host)
            }
        }
        formatter.dateFormat = "yyyy. MM. dd."
        verifySmartTicketReview(in: host, attachmentName: "future-ticket-before-confirmation", date: formatter.string(from: tomorrow))
        try confirmSharedTicket(in: host)
        host.buttons["ticket-review-save"].tap()
        XCTAssertTrue(host.staticTexts["일정을 저장했어요"].waitForExistence(timeout: 25))
        let title = "기차 서울 → 동대구"
        XCTAssertTrue(host.staticTexts[title].exists)
        host.buttons["완료"].tap()

        app.terminate()
        app.launch()
        formatter.dateFormat = "yyyy년 M월 d일,"
        let day = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", formatter.string(from: tomorrow))).firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 30))
        day.tap()
        let saved = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 20))
        saved.tap()
        XCTAssertTrue(app.staticTexts["가져온 기차 승차권"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["서울 → 동대구 · 255편"].exists)
        formatter.dateFormat = "yyyy-MM-dd"
        let times = formatter.string(from: tomorrow) + " 06:43 → 08:32"
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", times)).firstMatch.exists)
        XCTAssertTrue(app.staticTexts["경로 미설정"].exists)
        capture("future-smart-ticket-reopened")
    }

    func testSmartTicketScannedPDFRecognizesBothColumns() {
        checkSmartTicketPDF("스마트티켓 스캔 PDF 공유 테스트", attachment: "scanned-smart-ticket-review")
    }

    func testTicketLabelledTextAndPDFKeepAfternoonRideTimes() {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.launchArguments = ["--labelled-ticket-fixtures"]
        for label in ["시각 표시 텍스트", "시각 표시 PDF", "출발 시각 누락 텍스트"] {
            openSmartTicket(in: host, label: label)
            XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
            XCTAssertEqual(host.textFields["승차권 출발역"].value as? String, "서울")
            XCTAssertEqual(host.textFields["승차권 도착역"].value as? String, "동대구")
            XCTAssertEqual(host.textFields["승차권 열차번호"].value as? String, "255")
            let expectedDeparture = label.contains("누락") ? "날짜와 시각 선택" : "2026. 11. 12. 오후 6:43"
            XCTAssertEqual(host.buttons["ticket-departure-time"].value as? String, expectedDeparture)
            XCTAssertEqual(host.buttons["ticket-arrival-time"].value as? String, "2026. 11. 12. 오후 8:32")
            XCTAssertFalse(host.buttons["ticket-review-save"].isEnabled)
            let shot = XCTAttachment(screenshot: host.screenshot())
            shot.name = label
            shot.lifetime = .keepAlways
            add(shot)
            cancelSmartTicket(in: host)
            XCTAssertTrue(host.buttons[label].waitForExistence(timeout: 10))
        }
    }

    func testTicketLabelledOvernightBusPDFSaveAndReopen() throws {
        try saveAndReopenOvernightBus(webPage: false)
    }

    func testSmartTicketOvernightBusWebPageSaveAndReopen() throws {
        try saveAndReopenOvernightBus(webPage: true)
    }

    private func saveAndReopenOvernightBus(webPage: Bool) throws {
        try verifyTicketWriteAccount()
        let calendar = seoulCalendar
        let departure = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: Date()))
        let arrival = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: departure))
        let format = DateFormatter()
        format.locale = Locale(identifier: "ko_KR")
        format.calendar = calendar
        format.timeZone = calendar.timeZone
        format.dateFormat = "yyyy-MM-dd"
        let departureDate = format.string(from: departure)
        let arrivalDate = format.string(from: arrival)
        let dates = ["E2E_BUS_DEPARTURE_DATE": departureDate, "E2E_BUS_ARRIVAL_DATE": arrivalDate]
        let host: XCUIApplication
        if webPage { host = shareRenderedSmartTicket(["--intercity-web-ticket"], environment: dates) }
        else {
            host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
            host.launchArguments = ["--labelled-ticket-fixtures"]
            host.launchEnvironment.merge(dates) { _, new in new }
            openSmartTicket(in: host, label: "심야 시외버스 PDF")
        }
        XCTAssertTrue(host.staticTexts["버스 승차권 확인"].waitForExistence(timeout: 30))
        XCTAssertEqual(host.textFields["승차권 출발 터미널"].value as? String, "동서울")
        XCTAssertEqual(host.textFields["승차권 도착 터미널"].value as? String, "속초")
        XCTAssertEqual(host.textFields["승차권 버스 등급"].value as? String, "우등")
        format.dateFormat = "yyyy. MM. dd."
        XCTAssertEqual(host.buttons["ticket-departure-time"].value as? String, format.string(from: departure) + " 오후 11:10")
        XCTAssertEqual(host.buttons["ticket-arrival-time"].value as? String, format.string(from: arrival) + " 오전 12:30")
        try confirmSharedTicket(in: host)
        host.buttons["ticket-review-save"].tap()
        XCTAssertTrue(host.staticTexts["일정을 저장했어요"].waitForExistence(timeout: 25))
        host.buttons["완료"].tap()
        app.terminate(); app.launch()
        format.dateFormat = "yyyy년 M월 d일,"
        let day = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", format.string(from: arrival))).firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 30))
        try tap(day)
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "시외버스 동서울 → 속초")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 20))
        try tap(card)
        XCTAssertTrue(app.staticTexts["가져온 버스 승차권"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["동서울 → 속초 · 우등"].exists)
        let times = departureDate + " 23:10 → " + arrivalDate.suffix(5) + " 00:30"
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", times)).firstMatch.exists)
        capture("overnight-bus-reopened")
    }

    func testSmartTicketTextPDFRecognizesBothColumns() {
        checkSmartTicketPDF("스마트티켓 텍스트 PDF 공유 테스트", attachment: "text-smart-ticket-review")
    }

    func testSmartTicketHybridPDFRecognizesBothColumns() {
        checkSmartTicketPDF("스마트티켓 혼합 PDF 공유 테스트", attachment: "hybrid-smart-ticket-review")
    }

    func testSmartTicketHybridPDFRejectsRefundedTicket() throws {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.launchArguments = ["--smart-ticket-pdf-fixtures"]
        openSmartTicket(in: host, label: "스마트티켓 환불 혼합 PDF 공유 테스트")
        XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
        try confirmSharedTicket(in: host)
        host.buttons["ticket-review-save"].tap()
        let error = host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "취소·환불된 표는 이동 계획으로 가져올 수 없어요")).firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 10))
        XCTAssertFalse(host.staticTexts["일정을 저장했어요"].exists)
        cancelSmartTicket(in: host)
    }

    func testSmartTicketPDFFromFiles() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["E2E_SAFARI_SMART_TICKET_PDF"] == "1" else {
            throw XCTSkip("Save the synthetic Safari PDF in On My iPhone first")
        }
        XCTAssertEqual(try XCTUnwrap(environment["SIMULATOR_UDID"]), environment["E2E_DEVICE_ID"])
        let files = XCUIApplication(bundleIdentifier: "com.apple.DocumentsApp")
        files.activate()
        let documentID = "NoLate 합성 승차권, pdf".decomposedStringWithCanonicalMapping
        let document = files.descendants(matching: .any).matching(identifier: documentID)
        if !document.firstMatch.waitForExistence(timeout: 3) {
            let browse = files.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "둘러보기")).firstMatch
            if browse.isHittable { browse.tap() }
            let local = files.buttons["나의 iPhone"]
            if local.isHittable { local.tap() }
        }
        XCTAssertTrue(document.firstMatch.waitForExistence(timeout: 15))
        XCTAssertEqual(document.count, 1)
        document.firstMatch.press(forDuration: 1)
        files.buttons["공유"].tap()
        let noLate = files.cells.matching(NSPredicate(format: "label == %@", "NoLate")).firstMatch
        XCTAssertTrue(noLate.waitForExistence(timeout: 15))
        noLate.tap()
        verifySmartTicketReview(in: files, attachmentName: "safari-printed-pdf-from-files")
        cancelSmartTicket(in: files)
        XCTAssertTrue(document.firstMatch.waitForExistence(timeout: 10))
    }

    private func checkSmartTicketPDF(_ label: String, attachment: String) {
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.launchArguments = ["--smart-ticket-pdf-fixtures"]
        openSmartTicket(in: host, label: label)
        verifySmartTicketReview(in: host, attachmentName: attachment)
        cancelSmartTicket(in: host)
        XCTAssertTrue(host.buttons[label].waitForExistence(timeout: 10))
    }

    private func openSmartTicket(in host: XCUIApplication, label: String = "스마트티켓 화면 공유 테스트") {
        host.launch()
        let share = host.buttons[label]
        XCTAssertTrue(share.waitForExistence(timeout: 10))
        share.tap()
        selectTicketShareExtension(in: host)
    }

    private func verifySmartTicketReview(in host: XCUIApplication, attachmentName: String, date: String = "2026. 11. 12.") {
        XCTAssertTrue(host.staticTexts["기차 승차권 확인"].waitForExistence(timeout: 30))
        XCTAssertEqual(host.textFields["승차권 출발역"].value as? String, "서울")
        XCTAssertEqual(host.textFields["승차권 도착역"].value as? String, "동대구")
        XCTAssertEqual(host.textFields["승차권 열차번호"].value as? String, "255")
        XCTAssertEqual(host.textFields["승차권 열차 종류"].value as? String, "KTX")
        XCTAssertEqual(host.buttons["ticket-departure-time"].value as? String, date + " 오전 6:43")
        XCTAssertEqual(host.buttons["ticket-arrival-time"].value as? String, date + " 오전 8:32")
        XCTAssertFalse(host.buttons["ticket-review-save"].isEnabled)
        let review = XCTAttachment(screenshot: host.screenshot())
        review.name = attachmentName
        review.lifetime = .keepAlways
        add(review)
    }

    private func cancelSmartTicket(in host: XCUIApplication) {
        let cancel = host.buttons["승차권 가져오기 취소"]
        for _ in 0..<5 {
            if cancel.isHittable { break }
            host.swipeUp()
        }
        XCTAssertTrue(cancel.isHittable)
        cancel.tap()
    }

    func testBusTicketScannedPDFShareSaveReopen() throws {
        useBusTicket = true; ticketShareFormat = "스캔 PDF"
        try trainTicketImageShareSaveReopen(connectRoute: false)
    }


    // Synthetic scheme handler proves iOS app dispatch, not the actual Korail app.
    func testTrainAppBookingOpenReturn() throws {
        useTrainBookingAppFixture = true
        try trainTicketImageShareSaveReopen(connectRoute: true, verifyBooking: true)
    }

    private func openOfficialTrainBookingAndReturn(_ phase: String) throws {
        let booking = app.buttons["\(ticketBookingName) 공식 예매 열기"].firstMatch
        try reveal(booking); capture("booking-\(phase)-before-open"); try tap(booking)
        if useTrainBookingAppFixture {
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let open = springboard.alerts.buttons["열기"]
            if open.waitForExistence(timeout: 3) { open.tap() }
            let fixture = XCUIApplication(bundleIdentifier: useBusTicket ? "dev.nolate.busbookingfixture" : "dev.nolate.trainbookingfixture")
            let foreground = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in fixture.state == .runningForeground }, object: nil)
            try require(XCTWaiter.wait(for: [foreground], timeout: 20) == .completed, "Installed synthetic URL handler must open through iOS")
            XCTAssertTrue(fixture.staticTexts[useBusTicket ? "티머니GO 연결 테스트용 · 실제 티머니GO 앱 아님" : "코레일 앱 연결 테스트용 · 실제 코레일 앱 아님"].waitForExistence(timeout: 10))
            XCTAssertTrue(fixture.staticTexts[useBusTicket ? "tmoneytia://main/home" : "korailtalk://gotoMainViewContoller"].exists, "Dispatch must contain only the main-screen URL without ticket or account parameters")
            let shot = XCTAttachment(screenshot: fixture.screenshot()); shot.name = "booking-\(phase)-synthetic-app"; shot.lifetime = .keepAlways; add(shot)
            app.activate()
            XCTAssertTrue(booking.waitForExistence(timeout: 20), "Returning must keep the same NoLate screen")
            print("TRAIN_SYNTHETIC_APP_RETURN_\(phase.uppercased())")
            return
        }
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let foreground = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in safari.state == .runningForeground }, object: nil)
        try require(XCTWaiter.wait(for: [foreground], timeout: 20) == .completed, "Official HTTPS booking must open Safari on this browser-only simulator")
        let notNow = safari.buttons["지금 안 함"]
        if notNow.waitForExistence(timeout: 2) { notNow.tap() }
        let domain = safari.descendants(matching: .any).matching(NSPredicate(format: "value CONTAINS[c] %@ OR label CONTAINS[c] %@", useBusTicket ? "tmoney.co.kr" : "korail.com", useBusTicket ? "tmoney.co.kr" : "korail.com")).firstMatch
        XCTAssertTrue(domain.waitForExistence(timeout: 30), "Safari must display the official korail.com domain")
        let bookingContent = safari.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "승차권", "출발역")).firstMatch
        let contentLoaded = bookingContent.waitForExistence(timeout: 30)
        let shot = XCTAttachment(screenshot: safari.screenshot()); shot.name = "booking-\(phase)-official-browser"; shot.lifetime = .keepAlways; add(shot)
        XCTAssertTrue(contentLoaded, "The actual official booking content must load, not only its URL in the address bar")
        app.activate()
        XCTAssertTrue(booking.waitForExistence(timeout: 20), "Returning must keep the same NoLate screen")
        print("TRAIN_OFFICIAL_BROWSER_RETURN_\(phase.uppercased())")
    }

    private func trainTicketImageShareSaveReopen(connectRoute: Bool, verifyBooking: Bool = false) throws {
        // Fresh simulators can inherit a US timezone; ticket scenarios are in Seoul.
        app.launchEnvironment["TZ"] = "Asia/Seoul"
        app.terminate(); app.launch()
        let environment = ProcessInfo.processInfo.environment
        let manualServer = app.buttons["Enter URL manually"]
        if manualServer.waitForExistence(timeout: 3) {
            let address = try XCTUnwrap(environment["E2E_METRO_URL"], "A fresh simulator needs an explicit dedicated Metro URL")
            let url = try XCTUnwrap(URL(string: address))
            XCTAssertEqual(url.scheme, "http"); XCTAssertEqual(url.host, "127.0.0.1")
            manualServer.tap()
            let server = app.textFields["http://10.0.0.25:8081"]
            XCTAssertTrue(server.waitForExistence(timeout: 5)); server.tap(); server.typeText(address)
            app.buttons["Connect"].tap()
        }
        let email = app.textFields["이메일"]
        // A cold Metro bundle and expired session recovery can both precede login.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            email.exists || self.app.buttons["일정 추가"].exists || self.app.buttons["일정 없이 시작하기"].exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 60), .completed, "Wait for the authentication screen to settle")
        if !email.exists && app.buttons["일정 추가"].exists {
            let expectedEmail = try XCTUnwrap(environment["E2E_EMAIL"])
            XCTAssertTrue(expectedEmail.hasSuffix("@example.test"))
            try tap(app.buttons["내 정보 및 설정"])
            let synthetic = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "xcuitest-ticket-completion-", "@example.test")).firstMatch
            let accountReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in synthetic.exists || email.exists }, object: nil)
            try require(XCTWaiter.wait(for: [accountReady], timeout: 20) == .completed, "Only a synthetic ticket account may be used")
            if !email.exists {
                if synthetic.label.contains(expectedEmail) {
                    try tap(app.buttons["일정 목록으로 돌아가기"])
                } else {
                    let logout = app.buttons["로그아웃"]
                    try reveal(logout); try tap(logout)
                    let confirmation = app.staticTexts["로그아웃할까요?"]
                    XCTAssertTrue(confirmation.waitForExistence(timeout: 8))
                    app.buttons["로그아웃"].tap()
                    XCTAssertTrue(email.waitForExistence(timeout: 20))
                    print("TICKET_SYNTHETIC_ACCOUNT_SIGNED_OUT_BEFORE_LOGIN")
                }
            }
        }
        if email.exists {
            let value = try XCTUnwrap(environment["E2E_EMAIL"])
            XCTAssertTrue(value.hasSuffix("@example.test"))
            replace(email, with: value)
            replaceSecure(app.secureTextFields["비밀번호"], with: try XCTUnwrap(environment["E2E_PASSWORD"]))
            app.buttons["로그인"].tap()
        }
        let later = app.buttons["지금 안 함"]
        if later.waitForExistence(timeout: 3) { later.tap() }
        let sharing = app.alerts["공유 캘린더"]
        if sharing.exists {
            XCTAssertTrue(sharing.staticTexts["현재 사용할 수 없는 기능입니다."].exists)
            sharing.buttons["확인"].tap()
        }
        let noSchedule = app.buttons["일정 없이 시작하기"]
        if noSchedule.waitForExistence(timeout: 2) {
            dismissSyntheticPasswordSavePrompt()
            try tap(noSchedule)
        }
        let skip = app.buttons["사용법 건너뛰고 NoLate 시작하기"]
        if skip.waitForExistence(timeout: 10) { try tap(skip) }
        XCTAssertTrue(app.buttons["일정 추가"].waitForExistence(timeout: 40), "Finish the synthetic account onboarding before sharing")
        let host = XCUIApplication(bundleIdentifier: "dev.nolate.ticketfixture")
        host.terminate(); host.launch()
        let share = host.buttons["\(ticketKindLabel) \(ticketShareFormat) 공유 테스트"]
        XCTAssertTrue(share.waitForExistence(timeout: 10)); share.tap()
        selectTicketShareExtension(in: host)
        let heading = host.staticTexts[useBusTicket ? "버스 승차권 확인" : "기차 승차권 확인"]
        XCTAssertTrue(heading.waitForExistence(timeout: 30), host.debugDescription)
        for (label, expected, placeholder) in [(useBusTicket ? "승차권 출발 터미널" : "승차권 출발역", useBusTicket ? "인천공항2터미널" : "수서", "출발역"), (useBusTicket ? "승차권 도착 터미널" : "승차권 도착역", useBusTicket ? "청주" : "공주", "도착역")] {
            let field = host.textFields[label]
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            let value = field.value as? String ?? ""
            if value != expected {
                field.tap()
                if !value.isEmpty && value != placeholder {
                    let clear = field.buttons.firstMatch
                    XCTAssertTrue(clear.waitForExistence(timeout: 3), "Native ticket field must offer a clear button for corrections")
                    clear.tap()
                }
                for character in expected { field.typeText(String(character)) }
                print("TICKET_STATION_REVIEW_CORRECTION")
            }
            XCTAssertEqual(field.value as? String, expected)
        }
        let departureTime = host.buttons["ticket-departure-time"]
        let arrivalTime = host.buttons["ticket-arrival-time"]
        XCTAssertTrue((departureTime.value as? String ?? "").hasSuffix("오후 12:20"))
        XCTAssertTrue((arrivalTime.value as? String ?? "").hasSuffix(useBusTicket ? "오후 2:45" : "오후 1:12"))
        if useBusTicket { XCTAssertEqual(host.textFields["승차권 버스 등급"].value as? String, "우등") }
        else { XCTAssertEqual(host.textFields["승차권 열차번호"].value as? String, "615") }
        let save = host.buttons["ticket-review-save"]
        XCTAssertFalse(save.isEnabled, "OCR alone must never save an unreviewed ticket")
        try confirmSharedTicket(in: host)
        let review = XCTAttachment(screenshot: host.screenshot()); review.name = "ticket-share-review"; review.lifetime = .keepAlways; add(review)
        XCTAssertTrue(save.isEnabled)
        if !save.isHittable { host.swipeUp() }
        save.tap()
        XCTAssertTrue(host.staticTexts["일정을 저장했어요"].waitForExistence(timeout: 20), host.debugDescription)
        XCTAssertTrue(host.staticTexts[ticketTitle].exists)
        let saved = XCTAttachment(screenshot: host.screenshot()); saved.name = "ticket-share-saved"; saved.lifetime = .keepAlways; add(saved)
        host.buttons["완료"].tap()
        XCTAssertTrue(share.waitForExistence(timeout: 10))
        print("TICKET_IMAGE_SHARE_REVIEWED_AND_SAVED")
        app.terminate(); app.launch()
        let notice = app.alerts["공유 캘린더"]
        if notice.waitForExistence(timeout: 20) {
            XCTAssertTrue(notice.staticTexts["현재 사용할 수 없는 기능입니다."].exists)
            notice.buttons["확인"].tap()
        }
        let back = app.buttons["이전 화면으로 돌아가기"]
        if app.buttons["일정 수정"].exists && back.exists { back.tap() }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let day = calendar.dateComponents([.year, .month, .day], from: Date().addingTimeInterval(86400))
        let date = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(day.year!)년 \(day.month!)월 \(day.day!)일,")).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 40)); date.tap()
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", ticketTitle)).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 25)); card.tap()
        XCTAssertTrue(app.staticTexts[ticketSummaryHeading].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["경로 미설정"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "사용자 확인 · 예매 상태 미검증")).firstMatch.exists)
        capture("ticket-share-reopened")
        print("TICKET_IMAGE_SHARE_REOPENED_FROM_API")
        if verifyBooking {
            try openOfficialTrainBookingAndReturn("pending-ticket")
            XCTAssertTrue(app.staticTexts["경로 미설정"].exists)
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "사용자 확인 · 예매 상태 미검증")).firstMatch.exists)
        }
        if connectRoute { try connectImportedTrainTicketAndReopen(verifyBooking: verifyBooking) }
    }

    private func connectImportedTrainTicketAndReopen(verifyBooking: Bool = false) throws {
        let target = seoulCalendar.date(bySettingHour: 20, minute: 0, second: 0, of: Date().addingTimeInterval(86400))!
        let day = seoulCalendar.dateComponents([.year, .month, .day], from: target)
        try tap(app.buttons["일정 수정"])
        XCTAssertTrue(app.textFields["일정 제목"].waitForExistence(timeout: 15))
        try setStartTime(target, expectedClock: "오후 8:00", expectedDay: "시작 날짜 \(day.year!). \(day.month!). \(day.day!).")
        try tap(app.buttons["일정 수정 저장"])
        XCTAssertTrue(app.staticTexts[ticketSummaryHeading].waitForExistence(timeout: 20), "Editing the arrival deadline must preserve the pending ticket")
        XCTAssertTrue(app.staticTexts["경로 미설정"].exists)
        let ticketClock = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "12:20 → \(ticketArrivalClock)")).firstMatch
        XCTAssertTrue(ticketClock.exists, "The train time must remain fixed when the final deadline changes to 20:00")
        capture("ticket-target-edited-before-route")
        print("TICKET_PENDING_EDIT_PRESERVED")
        let setup = app.buttons["내 이동 경로 설정"]
        try reveal(setup); try tap(setup)
        XCTAssertTrue(app.textFields["일정 제목"].waitForExistence(timeout: 15), "Ticket setup must let the owner change the final destination in schedule editing")
        let places = app.buttons["location-input-pressable"]
        try reveal(places); try tap(places)
        let closeSearch = app.buttons["장소 검색 닫기"]
        if closeSearch.waitForExistence(timeout: 5) { try tap(closeSearch) }
        for (target, place) in [("출발지", useBusTicket ? "인천국제공항 제2여객터미널 E2E" : "서울남부터미널 E2E"), ("도착지", useBusTicket ? "청주시외버스터미널 E2E" : "공주터미널 E2E")] {
            let field = app.textFields[target + " 검색"]
            XCTAssertTrue(field.waitForExistence(timeout: 15)); field.tap()
            let clear = app.buttons[target + " 검색어 지우기"]
            if clear.waitForExistence(timeout: 3) { try tap(clear) }
            let recent = app.buttons[place + ", 최근 장소 선택"]
            XCTAssertTrue(recent.waitForExistence(timeout: 15)); try reveal(recent); try tap(recent)
        }
        try tap(app.buttons["대중교통"])
        let candidates = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로"))
        XCTAssertTrue(candidates.firstMatch.waitForExistence(timeout: 45))
        var labels: [String] = []
        var stableSince = Date()
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let current = candidates.allElementsBoundByIndex.map { $0.label }
            if current != labels || self.app.otherElements["경로를 계산하고 있어요"].exists {
                labels = current; stableSince = Date()
            }
            return !current.isEmpty && Date().timeIntervalSince(stableSince) >= 4
        }, object: nil)
        try require(XCTWaiter.wait(for: [settled], timeout: 60) == .completed, "Live TMAP candidates must settle")
        let train = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "\(ticketKindLabel) · ")).firstMatch
        for label in labels.prefix(10) {
            let candidate = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
            try reveal(candidate); try tap(candidate)
            if train.waitForExistence(timeout: 4) && (!useBusTicket || (train.label.contains("인천T2-청주") && app.buttons.matching(NSPredicate(format: "label == %@", "시외버스 운행 시간표 조회")).count == 1)) { break }
        }
        XCTAssertTrue(train.waitForExistence(timeout: 15), "A live train corridor is required to map the ticket")
        if verifyBooking {
            try openOfficialTrainBookingAndReturn("unsaved-route")
            XCTAssertTrue(app.buttons["\(ticketKindLabel) 운행 시간표 조회"].firstMatch.exists)
            XCTAssertTrue(app.buttons["이 경로 저장"].exists)
        }
        let open = app.buttons["\(ticketKindLabel) 운행 시간표 조회"].firstMatch
        try reveal(open); try tap(open)
        let ticket = app.buttons["가져온 승차권으로 연결"]
        XCTAssertTrue(ticket.waitForExistence(timeout: 15)); try tap(ticket)
        XCTAssertTrue(app.staticTexts["운행편 연결 확인"].waitForExistence(timeout: 10))
        let apply = app.buttons["이 운행편으로 경로 연결"]
        XCTAssertFalse(apply.isEnabled, "The ticket still needs explicit station mapping")
        try tap(app.buttons["같은 승하차 장소입니다"])
        let sheet = app.descendants(matching: .any).matching(identifier: "intercity-timetable-scroll").firstMatch
        if verifyBooking {
            for _ in 0..<4 { if app.buttons["\(ticketBookingName) 공식 예매 열기"].firstMatch.isHittable { break }; sheet.swipeDown() }
            try openOfficialTrainBookingAndReturn("confirmed-mapping")
            XCTAssertTrue(app.buttons["같은 승하차 장소 확인됨"].exists)
            XCTAssertTrue(apply.isEnabled, "Opening booking must not reset the confirmed mapping or selected ticket")
        }
        if !apply.isHittable { sheet.swipeUp() }
        capture("ticket-ride-mapping-confirmed")
        XCTAssertTrue(apply.isEnabled); try tap(apply)
        let connected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !self.app.buttons["시간표 닫기"].exists && self.app.buttons["이 경로 저장"].isHittable
        }, object: nil)
        try require(XCTWaiter.wait(for: [connected], timeout: 60) == .completed, "Ticket connection must finish before saving")
        capture("ticket-live-connections-applied")
        print("TICKET_ROUTE_CONNECTED_WITH_FIXED_TRAIN_TIMES")
        try tap(app.buttons["이 경로 저장"])
        XCTAssertTrue(app.textFields["일정 제목"].waitForExistence(timeout: 20))
        let alarm = app.switches["출발 알림"]
        if alarm.exists && alarm.value as? String == "1" { alarm.tap() }
        try tap(app.buttons["일정 수정 저장"])
        XCTAssertTrue(app.buttons["일정 수정"].waitForExistence(timeout: 20))
        let summary = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "일정 상세 시트 펼치기,")).firstMatch
        if summary.exists { summary.tap() }
        let restored = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "\(ticketKindLabel),")).firstMatch
        if !restored.isHittable { app.swipeUp() }
        XCTAssertTrue(restored.waitForExistence(timeout: 20))
        XCTAssertTrue(restored.label.contains("승차권 입력 12:20"))
        XCTAssertTrue(restored.label.contains(ticketArrivalClock))
        XCTAssertTrue(restored.label.contains("예매 상태 미검증"))
        capture("ticket-route-saved-before-restart")
        app.terminate(); app.launch()
        let notice = app.alerts["공유 캘린더"]
        if notice.waitForExistence(timeout: 20) {
            XCTAssertTrue(notice.staticTexts["현재 사용할 수 없는 기능입니다."].exists)
            notice.buttons["확인"].tap()
        }
        let date = buttonBeginning("\(day.year!)년 \(day.month!)월 \(day.day!)일,")
        XCTAssertTrue(date.waitForExistence(timeout: 40)); try tap(date)
        let card = buttonBeginning(ticketTitle)
        XCTAssertTrue(card.waitForExistence(timeout: 25)); try tap(card)
        XCTAssertTrue(app.buttons["일정 수정"].waitForExistence(timeout: 20))
        if summary.exists { summary.tap() }
        if !restored.isHittable { app.swipeUp() }
        XCTAssertTrue(restored.waitForExistence(timeout: 20))
        XCTAssertTrue(restored.label.contains("승차권 입력 12:20"))
        XCTAssertTrue(restored.label.contains(ticketArrivalClock))
        XCTAssertTrue(restored.label.contains("예매 상태 미검증"))
        capture("ticket-route-reopened-timeline")
        print("TICKET_FULL_JOURNEY_REOPENED_FROM_API")
        if verifyBooking { print("TRAIN_BOOKING_ROUTE_SAVED_AND_REOPENED_UNVERIFIED") }
    }

    private enum RailTimetableCase { case seoulToDongdaegu, suseoToGongju }

    private func intercitySearchSaveReopen(requiredKind: String?, lookupTimetable: RailTimetableCase? = nil, selectTimetable: Bool = false,
                                         originName: String = "서울남부터미널 E2E", destinationName: String = "공주터미널 E2E",
                                         nextDayDeadlineHour: Int? = nil, destinationQuery: String? = nil) throws {
        let environment = ProcessInfo.processInfo.environment
        let emailValue = try XCTUnwrap(environment["E2E_EMAIL"])
        XCTAssertTrue(emailValue.hasSuffix("@example.test"))
        let sharedCalendarAlert = app.alerts["공유 캘린더"]
        if sharedCalendarAlert.exists && sharedCalendarAlert.buttons["확인"].exists {
            sharedCalendarAlert.buttons["확인"].tap()
        }
        let timetableClose = app.buttons["시간표 닫기"]
        if timetableClose.exists { timetableClose.tap() }
        if app.buttons["일정 수정"].exists {
            let back = app.buttons["이전 화면으로 돌아가기"]
            XCTAssertTrue(back.exists); back.tap()
        }
        let scheduleList = app.buttons["일정 목록으로 이동"]
        if scheduleList.exists { scheduleList.tap() }
        let existingDraft = app.textFields["일정 제목"]
        if existingDraft.exists, let value = existingDraft.value as? String,
            (value.hasPrefix("Intercity Train E2E ") || value.hasPrefix("Intercity Bus E2E ")) {
            let closeDraft = app.buttons["새 일정 닫기"]
            let discard = app.alerts["작성 중인 일정을 닫을까요?"]
            if !discard.exists { XCTAssertTrue(closeDraft.exists); try tap(closeDraft) }
            if discard.waitForExistence(timeout: 3) { discard.buttons["작성 취소"].tap() }
            let closed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !existingDraft.exists }, object: nil)
            try require(XCTWaiter.wait(for: [closed], timeout: 10) == .completed, "Previous dedicated test draft must close before starting another")
        }
        let email = app.textFields["이메일"]
        let manualEntry = app.buttons["직접 입력"]
        let initialReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            email.exists || self.app.textFields["일정 제목"].exists || self.app.buttons["일정 추가"].exists || manualEntry.exists ||
            self.app.buttons["사용법 건너뛰고 NoLate 시작하기"].exists || self.app.buttons["일정 없이 시작하기"].exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [initialReady], timeout: 90), .completed)
        if email.exists {
            replace(email, with: emailValue)
            replaceSecure(app.secureTextFields["비밀번호"], with: try XCTUnwrap(environment["E2E_PASSWORD"]))
            app.buttons["로그인"].tap()
        }
        let passwordLater = app.buttons["지금 안 함"]
        if passwordLater.waitForExistence(timeout: 3) { passwordLater.tap() }
        let skipImport = app.buttons["일정 없이 시작하기"]
        if skipImport.waitForExistence(timeout: 5) { skipImport.tap() }
        let skipTour = app.buttons["사용법 건너뛰고 NoLate 시작하기"]
        if skipTour.waitForExistence(timeout: 10) { skipTour.tap() }
        let titleField = app.textFields["일정 제목"]
        if !titleField.exists {
            if !manualEntry.exists {
                let add = app.buttons["일정 추가"]
                try require(add.waitForExistence(timeout: 30), "Calendar add button did not appear")
                try tap(add)
            }
            try require(manualEntry.waitForExistence(timeout: 10), "Manual entry action did not appear")
            try tap(manualEntry)
            if !titleField.waitForExistence(timeout: 5) && manualEntry.exists && manualEntry.isHittable {
                manualEntry.tap()
            }
        }
        try require(titleField.waitForExistence(timeout: 10), "Manual entry did not open the schedule draft")
        let previous = titleField.value as? String ?? ""
        XCTAssertTrue(previous.isEmpty || previous == "일정 제목", "Resume only the empty dedicated test draft")
        let prefix = requiredKind == "기차" ? "Intercity Train E2E " : requiredKind == "시외버스" ? "Intercity Bus E2E " : "Intercity E2E "
        let title = prefix + String(Int(Date().timeIntervalSince1970))
        titleField.tap()
        for character in title { titleField.typeText(String(character)) }
        XCTAssertEqual(titleField.value as? String, title)
        titleField.typeText("\n")
        let usesFutureDay = selectTimetable || nextDayDeadlineHour != nil
        if usesFutureDay {
            let target = seoulCalendar.date(bySettingHour: nextDayDeadlineHour ?? 20, minute: 0, second: 0, of: Date().addingTimeInterval(86400))!
            let day = seoulCalendar.dateComponents([.year, .month, .day], from: target)
            let clock = DateFormatter(); clock.locale = Locale(identifier: "ko_KR"); clock.timeZone = seoulCalendar.timeZone; clock.dateFormat = "a h:mm"
            try setStartTime(target, expectedClock: clock.string(from: target), expectedDay: "시작 날짜 \(day.year!). \(day.month!). \(day.day!).")
        }
        let opener = app.buttons["location-input-pressable"]
        if !opener.isHittable { app.swipeUp() }
        XCTAssertTrue(opener.exists); opener.tap()
        for (target, place) in [("출발지", originName), ("도착지", destinationName)] {
            let close = app.buttons["장소 검색 닫기"]
            if !close.exists { app.textFields[target + " 검색"].tap() }
            if target == "도착지", let destinationQuery {
                let field = app.textFields[target + " 검색"]
                field.tap()
                field.typeText(destinationQuery)
                let result = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", place + ", ")).firstMatch
                XCTAssertTrue(result.waitForExistence(timeout: 25), "A nationwide keyword search must find the named station")
                capture("intercity-keyword-destination")
                result.tap()
            } else {
                let recent = app.buttons[place + ", 최근 장소 선택"]
                XCTAssertTrue(recent.waitForExistence(timeout: 15)); recent.tap()
            }
        }
        app.buttons["대중교통"].tap()
        let candidates = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로"))
        XCTAssertTrue(candidates.firstMatch.waitForExistence(timeout: 45), "The transit provider must return selectable routes")
        var lastRouteLabels: [String] = []
        var stableSince = Date()
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let labels = candidates.allElementsBoundByIndex.map { $0.label }
            if labels != lastRouteLabels || self.app.otherElements["경로를 계산하고 있어요"].exists {
                lastRouteLabels = labels; stableSince = Date()
            }
            return !labels.isEmpty && Date().timeIntervalSince(stableSince) >= 4
        }, object: nil)
        try require(XCTWaiter.wait(for: [settled], timeout: 60) == .completed, "Wait for transit candidates to settle before choosing a ride")
        let ridePredicate = requiredKind.map { NSPredicate(format: "label BEGINSWITH %@", $0 + " 운행 시간표 · ") }
            ?? NSPredicate(format:
                "label BEGINSWITH '고속버스 운행 시간표 · ' OR label BEGINSWITH '시외버스 운행 시간표 · ' OR label BEGINSWITH '기차 운행 시간표 · ' OR label BEGINSWITH '고속·시외버스 운행 시간표 · '")
        let intercity = app.staticTexts.matching(ridePredicate).firstMatch
        for label in lastRouteLabels.prefix(10) {
            let candidate = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
            try reveal(candidate); try tap(candidate)
            if intercity.waitForExistence(timeout: 4) {
                if selectTimetable && requiredKind == "시외버스" {
                    // This feature supports one long-distance ride. Do not confirm a
                    // different transfer terminal just because its first ride is a bus.
                    if intercity.label.hasSuffix("인천공항T2 → 청주") && app.buttons.matching(NSPredicate(format: "label == %@", "시외버스 운행 시간표 조회")).count == 1 { break }
                } else { break }
            }
        }
        XCTAssertTrue(intercity.waitForExistence(timeout: 15), "Expanded result must show an intercity ride")
        if selectTimetable && requiredKind == "시외버스" {
            try require(intercity.label.hasSuffix("인천공항T2 → 청주") && app.buttons.matching(NSPredicate(format: "label == %@", "시외버스 운행 시간표 조회")).count == 1,
                        "Select the real direct Incheon T2–Cheongju bus before confirming terminal mapping")
        }
        let rideLabel = intercity.label
        XCTAssertFalse(rideLabel.hasPrefix("도보")); capture("intercity-real-provider-result")
        if let lookupTimetable { try lookupRealIntercityTimetables(route: lookupTimetable) }
        if requiredKind == "시외버스" && !selectTimetable { try verifyMissingBusTerminalBookingAccess() }
        let selectedClock = selectTimetable ? (requiredKind == "시외버스" ? try selectRealIntercityBusService() : try lookupRealIntercityTimetables(selectService: true)) : nil
        let routeSave = app.buttons["이 경로를 일정에 적용"]
        XCTAssertTrue(routeSave.exists); try reveal(routeSave); try tap(routeSave)
        XCTAssertTrue(titleField.waitForExistence(timeout: 15))
        let alert = app.switches["출발 알림"]
        if alert.exists && alert.value as? String == "1" { alert.tap() }
        let save = app.buttons["일정 저장"]
        try reveal(save)
        var saveFrame = CGRect.zero
        var saveStableSince = Date()
        let saveSettled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            if save.frame != saveFrame { saveFrame = save.frame; saveStableSince = Date() }
            return save.isHittable && save.isEnabled && Date().timeIntervalSince(saveStableSince) >= 2
        }, object: nil)
        try require(XCTWaiter.wait(for: [saveSettled], timeout: 15) == .completed, "Schedule sheet must settle before saving")
        capture("intercity-before-save"); try tap(save)
        func showSavedServiceDay() throws {
            guard usesFutureDay else { return }
            let day = seoulCalendar.dateComponents([.year, .month, .day], from: Date().addingTimeInterval(86400))
            let dateButton = buttonBeginning("\(day.year!)년 \(day.month!)월 \(day.day!)일,")
            let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                !titleField.exists && dateButton.exists && dateButton.isHittable
            }, object: nil)
            try require(XCTWaiter.wait(for: [visible], timeout: 30) == .completed, "Calendar must reopen before choosing the saved service day")
            try tap(dateButton)
        }
        try showSavedServiceDay()
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 25)); capture("intercity-saved-calendar")
        app.terminate(); app.launch()
        if usesFutureDay {
            // This isolated test profile disables calendar sharing. Its asynchronous
            // startup notice can arrive after the personal calendar is already visible.
            let sharingNotice = app.alerts["공유 캘린더"]
            if sharingNotice.waitForExistence(timeout: 20) {
                try require(sharingNotice.staticTexts["현재 사용할 수 없는 기능입니다."].exists,
                            "Inspect an unexpected calendar error instead of dismissing it")
                sharingNotice.buttons["확인"].tap()
                let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !sharingNotice.exists }, object: nil)
                try require(XCTWaiter.wait(for: [dismissed], timeout: 5) == .completed, "Startup sharing notice must close before reopening the personal schedule")
            }
        }
        try showSavedServiceDay()
        XCTAssertTrue(card.waitForExistence(timeout: 40), "Saved schedule must reload from server after restart")
        card.tap()
        XCTAssertTrue(app.buttons["일정 수정"].waitForExistence(timeout: 20))
        let summary = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "일정 상세 시트 펼치기,")).firstMatch
        if summary.exists { summary.tap() }
        let restoredPredicate = requiredKind.map { NSPredicate(format: "label BEGINSWITH %@", $0 + ",") }
            ?? NSPredicate(format:
                "label BEGINSWITH '고속버스,' OR label BEGINSWITH '시외버스,' OR label BEGINSWITH '기차,' OR label BEGINSWITH '고속·시외버스,'")
        let restored = app.buttons.matching(restoredPredicate).firstMatch
        if !restored.isHittable { app.swipeUp() }
        XCTAssertTrue(restored.waitForExistence(timeout: 15), "Saved detail must retain ride type")
        if let selectedClock {
            XCTAssertTrue(restored.label.contains("시간표 " + selectedClock), "Restored selected ride must retain its public departure time")
            XCTAssertTrue(restored.label.contains("예매 미확인"), "The selected public timetable must remain explicitly unconfirmed")
            if requiredKind == "시외버스" {
                XCTAssertTrue(restored.label.contains("01:25"), "The overnight bus must retain its next-day arrival clock")
            }
            print("INTERCITY_SELECTED_SERVICE_RESTORED: " + selectedClock)
        }
        capture("intercity-reopened-timeline")
        print("INTERCITY_E2E_SAVED_REOPENED: " + title + " | " + rideLabel + " | " + restored.label)
    }

    private func verifyMissingBusTerminalBookingAccess() throws {
        let timetable = app.buttons["시외버스 운행 시간표 조회"].firstMatch
        try reveal(timetable); try tap(timetable)
        let departure = app.buttons["출발 역·터미널 선택"]
        try require(departure.waitForExistence(timeout: 10), "The public bus timetable must open")
        try tap(departure)
        let field = app.textFields["역 터미널 검색어"]
        func search(_ query: String) throws {
            replace(field, with: query); field.typeText("\n")
            try tap(app.buttons["역 터미널 검색"])
        }
        let missing = app.staticTexts["공공 시간표 목록에서 이 터미널을 찾지 못했어요. 예매처에서 운행편을 확인해 주세요."]
        try search("동서울")
        if !missing.waitForExistence(timeout: 8) {
            let matches = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", " NAI"))
            try require(matches.firstMatch.exists, "Wait for a public directory result or its empty response")
            try search("노레이트테스트터미널")
        }
        try require(missing.waitForExistence(timeout: 15), "Explain an empty public directory response")
        XCTAssertTrue(app.buttons["티머니GO 공식 예매 열기"].exists)
        XCTAssertTrue(app.buttons["버스타고 공식 예매 열기"].exists)
        capture("intercity-missing-stop-booking")
        try tap(app.buttons["시간표 닫기"])
    }

    private func selectRealIntercityBusService() throws -> String {
        let open = app.buttons["시외버스 운행 시간표 조회"].firstMatch
        try reveal(open); XCTAssertTrue(open.waitForExistence(timeout: 10)); try tap(open)
        XCTAssertTrue(app.staticTexts["운행 시간표"].waitForExistence(timeout: 10))
        let scroll = app.descendants(matching: .any).matching(identifier: "intercity-timetable-scroll").firstMatch
        func pick(_ label: String, _ query: String, _ result: String) throws {
            let opener = app.buttons[label]; try reveal(opener); try tap(opener)
            let field = app.textFields["역 터미널 검색어"]
            replace(field, with: query); field.typeText("\n")
            let find = app.buttons["역 터미널 검색"]; if !find.isHittable { scroll.swipeUp() }
            XCTAssertTrue(find.isEnabled); try tap(find)
            let stop = app.buttons[result]; XCTAssertTrue(stop.waitForExistence(timeout: 20)); try tap(stop)
        }
        try pick("출발 역·터미널 선택", "인천공항", "인천공항2터미널 NAI2238202")
        try pick("도착 역·터미널 선택", "청주", "청주 NAI2839701")
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.timeZone = seoulCalendar.timeZone
        let today = formatter.string(from: Date())
        replace(app.textFields["운행일"], with: today); app.textFields["운행일"].typeText("\n")
        try tap(app.buttons["운행편 조회"])
        let count = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '운행편 '")).firstMatch
        XCTAssertTrue(count.waitForExistence(timeout: 25)); capture("bus-tago-live-timetable")
        let choice = app.buttons["23:00 심야우등 운행편 선택"]
        for _ in 0..<40 { if choice.isHittable { break }; scroll.swipeUp() }
        try require(choice.exists && choice.isHittable && choice.isEnabled, "A real future 23:00 TAGO bus must be available; never select an elapsed departure")
        capture("bus-tago-selected-future-service"); try tap(choice)
        XCTAssertTrue(app.staticTexts["운행편 연결 확인"].waitForExistence(timeout: 10))
        let apply = app.buttons["이 운행편으로 경로 연결"]
        XCTAssertFalse(apply.isEnabled, "Terminal mapping must be confirmed explicitly")
        try tap(app.buttons["같은 승하차 장소입니다"])
        if !apply.isHittable { scroll.swipeUp() }
        capture("bus-selected-service-mapping"); XCTAssertTrue(apply.isEnabled); try tap(apply)
        let connected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !self.app.buttons["시간표 닫기"].exists && self.app.buttons["이 경로 저장"].isHittable
        }, object: nil)
        try require(XCTWaiter.wait(for: [connected], timeout: 75) == .completed, "Actual connection search must finish before saving the selected bus")
        capture("bus-selected-service-connected")
        print("INTERCITY_BUS_SELECTED_SERVICE_APPLIED: " + today + " 23:00 → next day 01:25")
        return "23:00"
    }

    @discardableResult
    private func lookupRealIntercityTimetables(selectService: Bool = false, route: RailTimetableCase = .suseoToGongju) throws -> String? {
        let open = app.buttons["기차 운행 시간표 조회"].firstMatch
        if !open.isHittable { app.swipeUp() }
        XCTAssertTrue(open.waitForExistence(timeout: 10)); open.tap()
        XCTAssertTrue(app.staticTexts["운행 시간표"].waitForExistence(timeout: 10))
        let scroll = app.descendants(matching: .any).matching(identifier: "intercity-timetable-scroll").firstMatch
        func top() {
            // Stop as soon as the mode controls are visible: pulling a pageSheet
            // down again from its top dismisses it on iOS.
            for _ in 0..<5 {
                if app.buttons["기차"].isHittable { break }
                scroll.swipeDown()
            }
            XCTAssertTrue(app.buttons["기차"].isHittable)
        }
        func pick(_ label: String, _ city: String?, _ query: String, _ result: String) {
            let opener = app.buttons[label]; XCTAssertTrue(opener.exists); opener.tap()
            if let city {
                let cityPicker = app.buttons["intercity-city-picker"].firstMatch
                let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    cityPicker.exists && cityPicker.isEnabled
                }, object: nil)
                guard XCTWaiter.wait(for: [ready], timeout: 15) == .completed else {
                    XCTFail("Railway region selection was unavailable")
                    return
                }
                cityPicker.tap()
                let cityList = app.descendants(matching: .any).matching(identifier: "intercity-city-list").firstMatch
                XCTAssertTrue(cityList.waitForExistence(timeout: 15))
                for _ in 0..<6 {
                    if app.buttons[city].isHittable { break }
                    cityList.swipeUp()
                }
                XCTAssertTrue(app.buttons[city].isHittable); app.buttons[city].tap()
            }
            let field = app.textFields["역 터미널 검색어"]
            replace(field, with: query); field.typeText("\n")
            let stop = app.buttons[result]
            XCTAssertTrue(stop.waitForExistence(timeout: 15)); stop.tap()
        }
        if route == .seoulToDongdaegu {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = seoulCalendar.timeZone
            formatter.dateFormat = "yyyy-MM-dd"
            let day = formatter.string(from: Date().addingTimeInterval(86400))
            XCTAssertTrue(app.buttons["운행일, " + day].exists, "The timetable should open on the schedule's travel date")
            pick("출발 역·터미널 선택", "서울특별시", "서울", "서울 NAT010000")
            pick("도착 역·터미널 선택", "대구광역시", "동대구", "동대구 NAT013271")
            app.buttons["운행편 조회"].tap()
            let count = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "운행편 [1-9][0-9]*개")).firstMatch
            XCTAssertTrue(count.waitForExistence(timeout: 25))
            let matchingFirstPage = try XCTUnwrap(Int(count.label.filter(\.isNumber)))
            let scheduleFilter = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "일정에 맞는 운행편만 보기")).firstMatch
            try require(scheduleFilter.waitForExistence(timeout: 5), "The schedule date and arrival deadline must reach the timetable")
            XCTAssertFalse(app.staticTexts["일정 시각 이후 도착"].exists)
            scheduleFilter.tap()
            let firstCount = try XCTUnwrap(Int(count.label.filter(\.isNumber)))
            XCTAssertGreaterThan(firstCount, matchingFirstPage)
            XCTAssertTrue(app.staticTexts["일정 시각 이후 도착"].firstMatch.exists)
            XCTAssertLessThanOrEqual(firstCount, 100)
            let next = app.buttons["다음 운행편 보기"]
            if next.exists {
                XCTAssertEqual(firstCount, 100)
                next.tap()
                let expanded = app.staticTexts.matching(NSPredicate(format: "label MATCHES %@ AND label != %@",
                    "운행편 [1-9][0-9]*개", "운행편 100개")).firstMatch
                XCTAssertTrue(expanded.waitForExistence(timeout: 25))
                let total = try XCTUnwrap(Int(expanded.label.filter(\.isNumber)))
                XCTAssertTrue((101...200).contains(total))
                print("INTERCITY_DATED_RAIL_TIMETABLE " + day + " " + String(firstCount) + " -> " + String(total))
            }
            let allCount = try XCTUnwrap(Int(count.label.filter(\.isNumber)))
            scheduleFilter.tap()
            let filteredCount = try XCTUnwrap(Int(count.label.filter(\.isNumber)))
            XCTAssertGreaterThanOrEqual(filteredCount, matchingFirstPage)
            XCTAssertLessThan(filteredCount, allCount)
            XCTAssertFalse(app.staticTexts["일정 시각 이후 도착"].exists)
            print("INTERCITY_RAIL_DEADLINE " + day + " 14:00 " + String(filteredCount) + " / " + String(allCount))
            capture("intercity-dated-rail-timetable")
            app.buttons["시간표 닫기"].tap()
            return nil
        }
        pick("출발 역·터미널 선택", "서울특별시", "수서", "수서 NATH30000")
        pick("도착 역·터미널 선택", "충청남도", "공주", "공주 NATH20438")
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.timeZone = calendar.timeZone
        replace(app.textFields["운행일"], with: formatter.string(from: selectService ? Date().addingTimeInterval(86400) : Date()))
        app.textFields["운행일"].typeText("\n")
        app.buttons["운행편 조회"].tap()
        let trainCount = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '운행편 '")).firstMatch
        XCTAssertTrue(trainCount.waitForExistence(timeout: 20)); capture("tago-train-live-timetable")
        print("TAGO_UI_TRAIN: " + trainCount.label)
        if selectService {
            let choices = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "운행편 선택")).allElementsBoundByIndex
            let chosen = try XCTUnwrap(choices.first { let clock = String($0.label.prefix(5)); return clock >= "11:00" && clock <= "14:00" })
            let chosenLabel = chosen.label
            let clock = String(chosenLabel.prefix(5))
            for _ in 0..<12 { if chosen.isHittable { break }; scroll.swipeUp() }
            XCTAssertTrue(chosen.isEnabled && chosen.isHittable); chosen.tap()
            XCTAssertTrue(app.staticTexts["운행편 연결 확인"].waitForExistence(timeout: 10))
            let apply = app.buttons["이 운행편으로 경로 연결"]
            XCTAssertFalse(apply.isEnabled, "Station mapping must be explicit before applying")
            app.buttons["같은 승하차 장소입니다"].tap()
            if !apply.isHittable { scroll.swipeUp() }
            capture("intercity-service-mapping-confirmed"); XCTAssertTrue(apply.isEnabled); apply.tap()
            let applied = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                !self.app.buttons["시간표 닫기"].exists && self.app.buttons["이 경로 저장"].isHittable
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [applied], timeout: 60), .completed, "Live connection search must finish and dismiss the modal before saving")
            capture("intercity-selected-service-connected")
            print("INTERCITY_SELECTED_SERVICE_APPLIED: " + chosenLabel)
            return clock
        }
        top(); app.buttons["고속버스"].tap()
        pick("출발 역·터미널 선택", nil, "서울", "서울경부 NAEK010")
        pick("도착 역·터미널 선택", nil, "공주", "공주 NAEK320")
        app.buttons["운행편 조회"].tap()
        let expressCount = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '운행편 '")).firstMatch
        XCTAssertTrue(expressCount.waitForExistence(timeout: 20)); capture("tago-express-live-timetable")
        print("TAGO_UI_EXPRESS: " + expressCount.label)
        top(); app.buttons["시외버스"].tap()
        pick("출발 역·터미널 선택", nil, "서울남부", "서울남부 NAI0671801")
        pick("도착 역·터미널 선택", nil, "공주", "공주 NAI3258501")
        let tomorrow = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: Date()))
        replace(app.textFields["운행일"], with: formatter.string(from: tomorrow)); app.textFields["운행일"].typeText("\n")
        app.buttons["운행편 조회"].tap()
        let unsupported = app.staticTexts["시외버스 공공 시간표는 당일 배차만 제공합니다. 다른 날짜는 예매처에서 확인해 주세요."]
        XCTAssertTrue(unsupported.waitForExistence(timeout: 15)); capture("tago-intercity-future-unsupported")
        replace(app.textFields["운행일"], with: formatter.string(from: Date())); app.textFields["운행일"].typeText("\n")
        app.buttons["운행편 조회"].tap()
        XCTAssertTrue(app.staticTexts["제공된 운행편이 없습니다. 실제 운행 여부는 예매처에서 확인해 주세요."].waitForExistence(timeout: 20))
        capture("tago-intercity-no-services")
        app.buttons["시간표 닫기"].tap()
        XCTAssertTrue(app.buttons["이 경로 저장"].waitForExistence(timeout: 10))
        return nil
    }

    private var seoulCalendar: Calendar {
        var value = Calendar(identifier: .gregorian); value.timeZone = TimeZone(identifier: "Asia/Seoul")!; return value
    }
    private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else { XCTFail(message); throw NSError(domain: "IntercityE2E", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    private func buttonBeginning(_ prefix: String) -> XCUIElement { app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch }
    private func reveal(_ element: XCUIElement, upward: Bool = true) throws {
        for _ in 0..<5 { if element.exists && element.isHittable { return }; if upward { app.swipeUp() } else { app.swipeDown() } }
        try require(element.exists && element.isHittable, "Required intercity form control is not visible")
    }
    private func tap(_ element: XCUIElement) throws {
        let unavailableCalendars = app.alerts["공유 캘린더"]
        if unavailableCalendars.exists && unavailableCalendars.staticTexts["현재 사용할 수 없는 기능입니다."].exists {
            unavailableCalendars.buttons["확인"].tap()
            let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !unavailableCalendars.exists }, object: nil)
            try require(XCTWaiter.wait(for: [dismissed], timeout: 5) == .completed, "Dedicated server's disabled-sharing notice did not close")
        }
        let savePassword = app.sheets["암호를 저장하겠습니까?"]
        if savePassword.exists && savePassword.buttons["지금 안 함"].exists {
            savePassword.buttons["지금 안 함"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !savePassword.exists }, object: nil)
            try require(XCTWaiter.wait(for: [dismissed], timeout: 5) == .completed, "Observed password-save sheet did not close")
        }
        let actionable = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            element.exists && element.isEnabled && element.isHittable
        }, object: nil)
        try require(XCTWaiter.wait(for: [actionable], timeout: 10) == .completed, "Required intercity control is not actionable")
        if element.label == "일정 추가" { element.tap() }
        else { element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
    }
    private func wheelValue(_ wheel: XCUIElement, number: Int) throws -> String {
        let current = wheel.value as? String ?? ""
        guard let digits = current.range(of: "[0-9]+", options: .regularExpression) else {
            throw NSError(domain: "NoLateEtaJourney", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Unrecognized numeric time wheel"])
        }
        let width = current[digits].count
        // AX announces "11시"/"32분", but XCTest's selectable values are bare numbers.
        // Keep minute zero-padding when present; do not pass the spoken Korean suffix.
        return current.contains("시") ? String(number) :
            (width == 2 ? String(format: "%02d", number) : String(number))
    }

    private func setStartDate(_ target: Date, expectedDay: String) throws {
        let components = seoulCalendar.dateComponents([.year, .month, .day], from: target)
        // This exact identifier pattern was observed in the real React Native calendar.
        let dateKey = String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
        let cell = app.buttons["undefined.day_" + dateKey]
        if !app.buttons[expectedDay].exists {
            if !cell.exists {
                let current = buttonBeginning("시작 날짜 ")
                try reveal(current, upward: false)
                try tap(current)
            }
            try require(cell.waitForExistence(timeout: 10),
                        "Target day is not in the displayed calendar; inspect instead of guessing month navigation")
            try reveal(cell)
            try tap(cell)
            try require(app.buttons[expectedDay].waitForExistence(timeout: 10),
                        "Start-date label did not change to the requested day")
            capture("eta-future-date-selected")
        }
        // onDayPress may keep the calendar expanded; collapse only when it is still present.
        if cell.exists {
            let expected = app.buttons[expectedDay]
            try reveal(expected, upward: false)
            try tap(expected)
        }
    }

    private func selectNumericWheel(_ wheel: XCUIElement, number: Int, cycle: Int) throws {
        wheel.adjust(toPickerWheelValue: try wheelValue(wheel, number: number))
        // Native accessibility updates before the controlled React Native date value.
        // Let onChange settle before another wheel sends a date based on the old value.
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        // On this iOS 27 simulator adjust() can return after advancing only one row.
        // Re-read the actual value after each UI action; never proceed with an unverified time.
        for _ in 0..<32 {
            let current = wheel.value as? String ?? ""
            guard let digits = current.range(of: "[0-9]+", options: .regularExpression),
                  let value = Int(current[digits]) else {
                try require(false, "Unrecognized numeric picker value")
                return
            }
            if value == number { return }
            let forward = (number - value + cycle) % cycle
            let next = forward <= cycle / 2
            wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: next ? 0.61 : 0.39)).tap()
            let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                (wheel.value as? String) != current
            }, object: nil)
            try require(XCTWaiter.wait(for: [changed], timeout: 3) == .completed,
                        "Time picker did not advance; preserve the draft and inspect")
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        try require(false, "Time picker exceeded its bounded adjustment budget")
    }

    private func setStartTime(_ target: Date, expectedClock: String, expectedDay: String) throws {
        try setStartDate(target, expectedDay: expectedDay)
        let start = buttonBeginning("시작 시간 ")
        try reveal(start, upward: false)
        let wheels = app.pickerWheels
        if !wheels.firstMatch.exists { try tap(start) }
        try require(wheels.firstMatch.waitForExistence(timeout: 10), "Time picker wheels are missing")
        let components = seoulCalendar.dateComponents([.hour, .minute], from: target)
        let count = wheels.count
        try require(count == 2 || count == 3, "Unexpected time picker layout; inspect before proceeding")
        if count == 3 {
            let periodIndex = (0..<count).first { index in
                let value = wheels.element(boundBy: index).value as? String ?? ""
                return ["오전", "오후", "AM", "PM"].contains(value)
            }
            try require(periodIndex != nil, "Unrecognized AM/PM wheel")
            let period = wheels.element(boundBy: periodIndex!)
            let korean = (period.value as? String ?? "").hasPrefix("오")
            let numeric = (0..<count).filter { $0 != periodIndex! }
            let hour = wheels.element(boundBy: numeric[0])
            let minute = wheels.element(boundBy: numeric[1])
            try selectNumericWheel(hour, number: (components.hour! + 11) % 12 + 1, cycle: 12)
            try selectNumericWheel(minute, number: components.minute!, cycle: 60)
            // Crossing 11 → 12 can flip AM/PM, so apply the target period last.
            let targetPeriod = components.hour! < 12 ? (korean ? "오전" : "AM") : (korean ? "오후" : "PM")
            if period.value as? String != targetPeriod {
                period.adjust(toPickerWheelValue: targetPeriod)
                RunLoop.current.run(until: Date().addingTimeInterval(1))
                if period.value as? String != targetPeriod {
                    period.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: components.hour! < 12 ? 0.39 : 0.61)).tap()
                    RunLoop.current.run(until: Date().addingTimeInterval(1))
                }
            }
        } else {
            let hour = wheels.element(boundBy: 0)
            let minute = wheels.element(boundBy: 1)
            try selectNumericWheel(hour, number: components.hour!, cycle: 24)
            try selectNumericWheel(minute, number: components.minute!, cycle: 60)
        }
        let expected = app.buttons["시작 시간 " + expectedClock]
        try require(expected.waitForExistence(timeout: 10), "Start-time label does not match the requested target")
        capture("eta-future-time-selected")
        try tap(expected) // Collapse the picker before opening the route selector.
    }


    private func createAndEditSchedule() throws {
        let back = app.buttons["이전 화면으로 돌아가기"]
        if back.exists && app.buttons["일정 수정"].exists { back.tap() }
        let add = app.buttons["일정 추가"]
        XCTAssertTrue(add.waitForExistence(timeout: 20))
        // The SwiftUI glass toolbar currently reports an invalid XCTest hit
        // point. Use the observed element's centre, then assert the next screen.
        add.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let manual = app.buttons["직접 입력"]
        if !manual.waitForExistence(timeout: 3) {
            // The initial calendar transition can replace the toolbar beneath
            // an in-flight tap. Resolve its current frame and retry once.
            add.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        XCTAssertTrue(manual.waitForExistence(timeout: 10))
        manual.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let title = "XCUITest " + String(Int(Date().timeIntervalSince1970))
        let titleField = app.textFields["일정 제목"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 10))
        replace(titleField, with: title)
        XCTAssertEqual(titleField.value as? String, title)
        titleField.typeText("\n")
        app.switches["종일 일정"].tap()
        let save = app.buttons["일정 저장"]
        if !save.isHittable { app.swipeUp() }
        save.tap()
        let created = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        XCTAssertTrue(created.waitForExistence(timeout: 20))
        capture("schedule-created")
        created.press(forDuration: 1.2)
        let edit = app.buttons["수정"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        edit.tap()
        XCTAssertTrue(titleField.waitForExistence(timeout: 10))
        replace(titleField, with: title + " edited")
        XCTAssertEqual(titleField.value as? String, title + " edited")
        titleField.typeText("\n")
        app.buttons["일정 수정 저장"].tap()
        // Quick editing may return to the calendar or the detail page depending
        // on the entry route. Verify the saved title before returning to calendar.
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title + " edited")).firstMatch
        let detail = app.staticTexts[title + " edited"].firstMatch
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            card.exists || (detail.exists && self.app.buttons["일정 수정"].exists)
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 20), .completed)
        if app.buttons["일정 수정"].waitForExistence(timeout: 2) {
            app.buttons["이전 화면으로 돌아가기"].tap()
        }
        XCTAssertTrue(card.waitForExistence(timeout: 20))
        capture("schedule-edited")
        print("SYNTHETIC_SCHEDULE_EDITED_TITLE \(title) edited")
    }
}

/// Opt-in real UI journey on the existing synthetic member's dedicated simulator.
/// Preparation never saves: the final write is a separate, explicitly gated test.
final class NoLateEtaJourneyE2ETests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private let allowedDevice = "9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69"
    private var environment: [String: String] { ProcessInfo.processInfo.environment }
    private var seoulCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return calendar
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        try require(environment["E2E_DEVICE_ID"] == allowedDevice,
                    "Explicit dedicated simulator authorization is required")
        try require(environment["E2E_MEMBER_ID"] == "296",
                    "This journey is authorized only for synthetic member 296")
        if let runtimeDevice = environment["SIMULATOR_UDID"] {
            try require(runtimeDevice == allowedDevice, "Unexpected simulator; do not touch this app")
        }
        // Activate the installed app without relaunching, logging out, or clearing data.
        app.activate()
        if environment["E2E_PRIVATE_NOTICE"] == "1" {
            try require(springboard.alerts.count == 0, "System prompts need operator review")
            return
        }
        // Decline only the observed password-save sheet; never persist test credentials
        // in the system password manager or accept unrelated permission prompts.
        let passwordSave = app.sheets["암호를 저장하겠습니까?"]
        if passwordSave.exists && passwordSave.buttons["지금 안 함"].exists {
            passwordSave.buttons["지금 안 함"].tap()
        }
        if environment["E2E_RESTART_ONLY"] == "1" {
            try rejectBlockingAlerts()
            return
        }
        if environment["E2E_LOGIN_ONLY"] == "1" {
            try require(environment["E2E_EMAIL"]?.hasSuffix("@example.test") == true,
                        "Only the approved synthetic credentials may be used")
            // Only the inspected private-server reset notice on the login form may
            // be closed here. Keeping this adjacent to login avoids a second stale
            // member request covering the form between separate Xcode launches.
            if environment["E2E_PRIVATE_LOGIN"] == "1" {
                // These exact reset notices were observed after restarting private H2.
                // Do not dismiss sharing failures or any other production/system prompt.
                for heading in ["멤버 조회 실패", "공유 캘린더"] {
                    let authNotice = app.alerts[heading]
                    if authNotice.staticTexts["인증이 필요합니다."].exists && authNotice.buttons["확인"].exists {
                        try require(springboard.alerts.count == 0, "System prompts need operator review")
                        authNotice.buttons["확인"].tap()
                    }
                }
            }
            try rejectBlockingAlerts()
            return
        }
        try require(!app.textFields["이메일"].exists && app.secureTextFields.count == 0,
                    "An authenticated synthetic-member session is required; no login is performed")
        try rejectBlockingAlerts()
    }

    override func tearDownWithError() throws {
        // Preserve failure evidence without printing an authentication screen or credentials.
        if environment["E2E_CLOSE_DETAIL_AFTER_READ"] == "1",
           environment["E2E_REAL_ISOLATED"] == "1", environment["E2E_DEVICE_ID"] == allowedDevice,
           testRun?.failureCount == 0 {
            // 장시간 다음 열차를 기다리는 동안 펼쳐진 시트의 45초 도착정보 조회를 끝낸다.
            try require(app.buttons["일정 수정"].exists && app.staticTexts["ETA E2E real isolated fixture"].firstMatch.exists,
                        "Only close the inspected private schedule")
            try collapseRealRouteSheetIfExpanded()
            try tap(app.buttons["이전 화면으로 돌아가기"])
            try require(app.buttons["일정 추가"].waitForExistence(timeout: 12) && !app.buttons["일정 수정"].isHittable,
                        "Leave the inspected route before the next real-clock wait")
            print("ETA_REAL_ROUTE_DETAIL_CLOSED_AFTER_READ")
            return
        }
        guard (testRun?.failureCount ?? 0) > 0,
              environment["E2E_DEVICE_ID"] == allowedDevice,
              app.state == .runningForeground,
              !app.textFields["이메일"].exists,
              app.secureTextFields.count == 0 else { return }
        capture("eta-journey-failure")
        print("ETA_JOURNEY_FAILURE_UI\n" + app.debugDescription)
    }

    private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else {
            XCTFail(message)
            throw NSError(domain: "NoLateEtaJourney", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: message])
        }
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func rejectBlockingAlerts() throws {
        // Permission prompts must be reported to the operator, never auto-approved.
        try require(springboard.alerts.count == 0,
                    "A system permission/confirmation prompt requires operator review")
        // Calendar reads now validate focus and refreshed membership before
        // presenting errors. Do not dismiss a stale-calendar failure here:
        // its recurrence is a product lifecycle regression, not test setup.
        // Pre-mounted calendar scenes can retain non-interactive alert AX nodes.
        // The isolated detail journey must still stop for any actionable app alert.
        let hasAppAlert = environment["E2E_FIXTURE_PHASE"] == nil || environment["E2E_FIXTURE_PHASE"] == ""
            ? app.alerts.count > 0
            : app.alerts.allElementsBoundByIndex.contains { alert in
                alert.buttons.allElementsBoundByIndex.contains { $0.exists && $0.isHittable }
            }
        try require(!hasAppAlert,
                    "An app alert requires inspection; the test will not dismiss it")
    }

    private func labeled(_ label: String) -> XCUIElement {
        let button = app.buttons[label]
        if button.exists { return button }
        return app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    private func buttonBeginning(_ prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private func tap(_ element: XCUIElement) throws {
        // iOS may show this sheet after the calendar is already accessible.
        // Decline its observed save action before resolving the destination hit point.
        let passwordSave = app.sheets["암호를 저장하겠습니까?"]
        if passwordSave.exists && passwordSave.buttons["지금 안 함"].exists {
            passwordSave.buttons["지금 안 함"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                !passwordSave.exists
            }, object: nil)
            try require(XCTWaiter.wait(for: [dismissed], timeout: 5) == .completed, "Password-save sheet did not close")
        }
        try rejectBlockingAlerts()
        try require(element.waitForExistence(timeout: 12), "Expected UI element did not appear")
        let form = app.otherElements["schedule-add-scroll"]
        if form.exists && app.buttons["일정 저장"].exists && !form.frame.insetBy(dx: 2, dy: 8).contains(element.frame) {
            try reveal(element)
        }
        try require(element.isEnabled && element.isHittable, "Expected UI element is not actionable")
        // Existing SwiftUI glass toolbar buttons can report an invalid XCTest tap point.
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    private func reveal(_ element: XCUIElement, upward: Bool = true) throws {
        for _ in 0..<8 {
            let form = app.otherElements["schedule-add-scroll"]
            let withinForm = !form.exists || !app.buttons["일정 저장"].exists ||
                form.frame.insetBy(dx: 2, dy: 8).contains(element.frame)
            if element.exists && element.isHittable && withinForm { return }
            let scroll = form.descendants(matching: .scrollView).firstMatch
            if form.exists && scroll.exists {
                // XCTest can call a clipped radio button "hittable". Never tap
                // its off-card center: that hits the modal-dismiss backdrop.
                if element.exists && element.frame.midY < form.frame.minY { scroll.swipeDown() }
                else if upward { scroll.swipeUp() } else { scroll.swipeDown() }
            } else if upward { app.swipeUp() } else { app.swipeDown() }
        }
        try require(element.exists && element.isHittable, "Required form control is not visible")
    }

    private func replace(_ field: XCUIElement, with text: String) throws {
        try tap(field)
        field.typeKey("a", modifierFlags: .command)
        field.typeText(XCUIKeyboardKey.delete.rawValue)
        for character in text { field.typeText(String(character)) }
        try require(field.value as? String == text, "Text entry did not preserve the requested value")
    }

    /// The route card and rail share a scroll view. Follow the target's position;
    /// swiping only upwards can move a newly expanded card above the viewport.
    private func revealRouteElement(_ element: XCUIElement) throws {
        try require(element.waitForExistence(timeout: 12), "Expanded route content did not appear")
        for _ in 0..<8 {
            let scroll = app.scrollViews.allElementsBoundByIndex.first {
                $0.exists && $0.frame.height > 200 && $0.frame.minY > 100
            }
            if element.exists && element.isHittable,
               let viewport = scroll?.frame.insetBy(dx: 0, dy: 8),
               viewport.contains(CGPoint(x: element.frame.midX, y: element.frame.midY)) { return }
            guard let scroll else { break }
            if element.exists && element.frame.midY < scroll.frame.midY { scroll.swipeDown() }
            else { scroll.swipeUp() }
        }
        try require(element.exists && element.isHittable, "Required route card or rail is not visible")
    }

    private func configuration() throws -> (title: String, target: Date, clock: String, day: String) {
        let title = environment["E2E_ETA_TITLE"] ?? ""
        try require(title.hasPrefix("ETA E2E ") && title.count <= 80, "Provide a scoped ETA E2E title")
        let iso = environment["E2E_ETA_TARGET_ISO8601"] ?? ""
        let formatter = ISO8601DateFormatter()
        let parsed = formatter.date(from: iso)
        try require(parsed != nil, "Provide an ISO8601 target including its time zone")
        let target = parsed!
        try require(target.timeIntervalSinceNow > 120, "Target must remain at least two minutes in the future")
        let components = seoulCalendar.dateComponents([.year, .month, .day, .hour, .minute], from: target)
        let clockFormatter = DateFormatter()
        clockFormatter.locale = Locale(identifier: "ko_KR")
        clockFormatter.timeZone = seoulCalendar.timeZone
        clockFormatter.dateFormat = "a h:mm"
        let clock = clockFormatter.string(from: target)
        let day = "시작 날짜 \(components.year!). \(components.month!). \(components.day!)."
        return (title, target, clock, day)
    }

    /// Observation-only: usable before preparing or committing the draft.
    func testInspectEtaJourney() throws {
        capture("eta-journey-current-ui")
        // Authentication fields are rejected in setUp, so credentials are never dumped.
        print("ETA_JOURNEY_UI\n" + app.debugDescription)
    }

    /// Regression: the first selected route becomes the saved schedule destination.
    /// The fixture's route provider and database are private; this still drives the installed app.
    func testSaveUnlocatedDestinationRoute() throws {
        try require(environment["E2E_ALLOW_SAVE"] == "1" &&
                    environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "E2E 도착지만 저장",
                    "Only the private unlocated-destination fixture may be changed")
        try require(app.staticTexts["E2E 도착지만 저장"].firstMatch.waitForExistence(timeout: 20),
                    "The saved schedule without a route must be open")
        try require(!app.staticTexts["경로 준비됨"].firstMatch.exists,
                    "A name-only destination must not be advertised as a ready route")
        let setup = app.buttons["내 이동 경로 설정"]
        try require(setup.waitForExistence(timeout: 10), "Route setup action is missing")
        capture("unlocated-before-route")
        try tap(setup)
        // A name-only destination opens destination search; an already located
        // destination with no origin opens origin search. Follow the visible
        // search screen rather than assuming both controls exist behind it.
        let placeSearch = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.textFields["출발지 검색"].exists || self.app.textFields["도착지 검색"].exists
        }, object: nil)
        try require(XCTWaiter.wait(for: [placeSearch], timeout: 10) == .completed,
                    "The normal place search must open")
        let originFirst = labeled("장소 검색 닫기").exists && app.textFields["출발지 검색"].exists
        let selections = originFirst ? [("출발지", "노원역"), ("도착지", "신림역")]
            : [("도착지", "신림역"), ("출발지", "노원역")]
        for (target, place) in selections {
            let field = app.textFields[target + " 검색"]
            if !field.waitForExistence(timeout: 10) {
                let current = buttonBeginning(target + " 재선택, 현재 ")
                try require(current.waitForExistence(timeout: 10), "Route place selector is missing: " + target)
                try tap(current)
            }
            try require(field.waitForExistence(timeout: 15), "Route place input is missing: " + target)
            if !labeled("장소 검색 닫기").exists { try tap(field) }
            let clear = app.buttons[target + " 검색어 지우기"]
            if clear.exists { try tap(clear) }
            let recent = app.buttons[place + ", 최근 장소 선택"]
            try require(recent.waitForExistence(timeout: 15), "Private recent place is missing: " + place)
            try tap(recent)
        }
        try tap(labeled("대중교통"))
        let candidates = app.buttons.matching(NSPredicate(format:
            "label MATCHES %@", "([0-9]+시간 )?[0-9]+분 경로"))
        let candidate = candidates.firstMatch
        try require(candidate.waitForExistence(timeout: 30) && candidates.count == 1,
                    "Exactly the one private provider route must be returned")
        if candidate.value as? String != "expanded" { try tap(candidate) }
        capture("unlocated-route-selected")
        let save = labeled("이 경로 저장")
        try reveal(save)
        try tap(save)
        try require(app.staticTexts["E2E 도착지만 저장"].firstMatch.waitForExistence(timeout: 20),
                    "Saving the route did not return to the existing detail")
        try require(!app.alerts["경로 저장 실패"].exists, "Route save was rejected")
        capture("unlocated-route-save-returned")
        print("UNLOCATED_ROUTE_UI_SAVE_RETURNED")
    }

    /// Run after reopening the app and clearing only the known stale H2 calendar notice.
    func testVerifyUnlocatedDestinationRouteReopened() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "E2E 도착지만 저장",
                    "Only the private unlocated-destination fixture may be inspected")
        try require(app.staticTexts["E2E 도착지만 저장"].firstMatch.waitForExistence(timeout: 20),
                    "The saved schedule did not reopen")
        try require(app.staticTexts["신림역"].firstMatch.exists,
                    "The selected route destination was not saved")
        let minutes = try XCTUnwrap(environment["E2E_UNLOCATED_TRAVEL_MINUTES"].flatMap(Int.init))
        try require(minutes > 0 && minutes <= 240, "Expected duration must come from the saved private API plan")
        try require(app.staticTexts["대중교통 \(minutes)분"].firstMatch.waitForExistence(timeout: 15),
                    "The saved transit route is absent after reopening")
        let summary = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH %@ AND label CONTAINS %@",
            "일정 상세 시트 펼치기, ", "4호선 48분"
        )).firstMatch
        try require(summary.exists &&
                    summary.label.contains("2호선 8분"),
                    "The persisted transfer itinerary is not visible")
        capture("unlocated-route-reopened")
        print("UNLOCATED_ROUTE_REOPENED_WITH_SELECTED_DESTINATION_AND_TRANSFER")
    }

    /// Acknowledge only the previously inspected app notice, not any system permission or generic alert.
    func testDismissPrivateSharingDisabledNotice() throws {
        try require(environment["E2E_PRIVATE_NOTICE"] == "1", "Marked private server is required")
        let sharingDisabled = app.alerts["공유 캘린더"]
        let missingCachedCalendar = app.alerts["멤버 조회 실패"]
        let alert = missingCachedCalendar.exists ? missingCachedCalendar : sharingDisabled
        let networkNotice = "네트워크 상태를 확인한 뒤 다시 시도해 주세요."
        let staleConnectionNotice = sharingDisabled.staticTexts[networkNotice].exists
        // Observed after replacing the private H2 server: a cached member request
        // finishes after auth redirects to the empty login form. This is not an OS prompt.
        let staleAuthNotice = missingCachedCalendar.staticTexts["인증이 필요합니다."].exists &&
            app.textFields["이메일"].exists
        let expectedMessage = missingCachedCalendar.exists
            ? (staleAuthNotice ? "인증이 필요합니다." : "공유 캘린더가 존재하지 않습니다.")
            : (staleConnectionNotice ? networkNotice : "현재 사용할 수 없는 기능입니다.")
        // The same device previously used another database's calendar deep link.
        // Acknowledge this inspected missing-resource notice only, not permissions or arbitrary errors.
        try require(alert.waitForExistence(timeout: 10) &&
                    alert.staticTexts[expectedMessage].exists &&
                    alert.buttons["확인"].exists, "Unexpected alert; preserve it for inspection")
        capture("eta-private-fixture-preparation-notice")
        alert.buttons["확인"].tap()
        try require(!alert.exists, "Expected notice did not close")
        let passwordSave = app.sheets["암호를 저장하겠습니까?"]
        if passwordSave.exists {
            try require(passwordSave.buttons["지금 안 함"].exists, "Unexpected password manager sheet")
            passwordSave.buttons["지금 안 함"].tap()
        }
        try require(app.buttons["일정 추가"].waitForExistence(timeout: 10) ||
                    app.buttons["일정 수정"].exists ||
                    ((staleConnectionNotice || staleAuthNotice) && app.textFields["이메일"].exists),
                    "Private app did not reach a usable calendar, detail or inspected signed-out screen")
        capture("eta-private-login-calendar-ready")
    }

    /// Explicit opt-in recovery using the real login form; no storage injection or token bypass.
    func testLoginDedicatedEtaAccount() throws {
        try require(environment["E2E_LOGIN_ONLY"] == "1", "Login requires the scoped credential runner")
        let email = try XCTUnwrap(environment["E2E_EMAIL"])
        let password = try XCTUnwrap(environment["E2E_PASSWORD"])
        // A cold private-server launch first rejects the previous run's JWT and finishes
        // the normal auth bootstrap. Wait for the real form; never inject a token.
        try require(app.textFields["이메일"].waitForExistence(timeout: 45), "The actual login form is required")
        try replace(app.textFields["이메일"], with: email)
        let secure = app.secureTextFields["비밀번호"]
        try tap(secure)
        secure.typeKey("a", modifierFlags: .command)
        secure.typeText(XCUIKeyboardKey.delete.rawValue)
        for character in password { secure.typeText(String(character)) }
        try tap(app.buttons["로그인"])
        // Do not accept permission prompts or skip onboarding for an unexpected account.
        try require(app.buttons["일정 추가"].waitForExistence(timeout: 35), "Synthetic login did not reach the existing calendar")
        try rejectBlockingAlerts()
        let passwordSave = app.sheets["암호를 저장하겠습니까?"]
        if passwordSave.waitForExistence(timeout: 3) {
            try require(passwordSave.buttons["지금 안 함"].exists, "Unexpected password manager sheet")
            passwordSave.buttons["지금 안 함"].tap()
        }
        capture("eta-synthetic-account-calendar")
        if environment["E2E_LOGIN_FOLLOWUP_ODSAY"] == "1" {
            try testVerifySavedEtaJourney()
            try testInspectOdsayRefreshFromSavedTransfer()
            if environment["E2E_ASSERT_QUOTA_FAILURE"] == "1" {
                try testVerifyOdsayQuotaFailure()
            }
        }
        if environment["E2E_LOGIN_FOLLOWUP_TMAP"] == "1" {
            try testPrepareTmapTransferSearch()
        }
        if environment["E2E_VERIFY_PRIVATE_DETAIL_AFTER_LOGIN"] == "1" {
            try require(environment["E2E_REAL_ISOLATED"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                        environment["E2E_EXISTING_TITLE"] == "ETA E2E real isolated fixture",
                        "Only the private fixture detail may be checked before evaluation")
            try openRealIsolatedDetail()
            try collapseRealRouteSheetIfExpanded()
            capture("real-isolated-detail-before-provider-evaluation")
            print("ETA_REAL_PRE_EVALUATION_DETAIL_REACHABLE")
        }
    }

    /// Observe the real calendar labels before choosing a date across midnight.
    /// This opens only the existing/new test draft's date picker and never saves.
    func testInspectStartDatePicker() throws {
        try openOrResumeDraft()
        let startDate = buttonBeginning("시작 날짜 ")
        try reveal(startDate, upward: false)
        try tap(startDate)
        capture("eta-start-date-picker")
        print("ETA_START_DATE_PICKER_UI\n" + app.debugDescription)
    }

    private func openOrResumeDraft() throws {
        let title = app.textFields["일정 제목"]
        if !title.exists && labeled("장소 검색 닫기").exists {
            try tap(labeled("장소 검색 닫기"))
        }
        if !title.exists && (labeled("이 경로 저장").exists || labeled("이동 경로 화면 닫기").exists ||
                            buttonBeginning("출발지 재선택, 현재 ").exists) {
            // Return only from this unsaved draft's route picker; never open a saved schedule.
            if labeled("이동 경로 화면 닫기").exists { try tap(labeled("이동 경로 화면 닫기")) }
            else if app.buttons["일정 목록으로 이동"].exists {
                // Current route-picker toolbar uses this explicit label rather than "뒤로가기".
                try tap(app.buttons["일정 목록으로 이동"])
                if app.buttons["일정 수정"].exists &&
                    app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "ETA E2E NAVER ")).firstMatch.exists {
                    try tap(app.buttons["이전 화면으로 돌아가기"])
                }
            }
            else { try tap(labeled("뒤로가기")) }
        }
        if !title.waitForExistence(timeout: 3) {
            // Cold Metro launches finish authentication asynchronously. Wait for
            // the real calendar; never skip login or treat the loading view as ready.
            try require(app.buttons["일정 추가"].waitForExistence(timeout: 35),
                        "Unknown screen: run testInspectEtaJourney before taking further action")
            try tap(app.buttons["일정 추가"])
            try tap(app.buttons["직접 입력"])
        }
        try require(title.waitForExistence(timeout: 15), "The new-schedule draft did not appear")
        try require(app.buttons["일정 저장"].exists && !app.buttons["일정 수정 저장"].exists,
                    "Only a new unsaved schedule may be changed")
        let existing = title.value as? String ?? ""
        try require(existing.isEmpty || existing == "일정 제목" || existing.hasPrefix("ETA E2E "),
                    "An unrelated draft is open; preserve it and stop")
    }

    private func wheelValue(_ wheel: XCUIElement, number: Int) throws -> String {
        let current = wheel.value as? String ?? ""
        guard let digits = current.range(of: "[0-9]+", options: .regularExpression) else {
            throw NSError(domain: "NoLateEtaJourney", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Unrecognized numeric time wheel"])
        }
        let width = current[digits].count
        // AX announces "11시"/"32분", but XCTest's selectable values are bare numbers.
        // Keep minute zero-padding when present; do not pass the spoken Korean suffix.
        return current.contains("시") ? String(number) :
            (width == 2 ? String(format: "%02d", number) : String(number))
    }

    private func setStartDate(_ target: Date, expectedDay: String) throws {
        let components = seoulCalendar.dateComponents([.year, .month, .day], from: target)
        // This exact identifier pattern was observed in the real React Native calendar.
        let dateKey = String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
        let cell = app.buttons["undefined.day_" + dateKey]
        if !app.buttons[expectedDay].exists {
            if !cell.exists {
                let current = buttonBeginning("시작 날짜 ")
                try reveal(current, upward: false)
                try tap(current)
            }
            try require(cell.waitForExistence(timeout: 10),
                        "Target day is not in the displayed calendar; inspect instead of guessing month navigation")
            try reveal(cell)
            try tap(cell)
            try require(app.buttons[expectedDay].waitForExistence(timeout: 10),
                        "Start-date label did not change to the requested day")
            capture("eta-future-date-selected")
        }
        // onDayPress may keep the calendar expanded; collapse only when it is still present.
        if cell.exists {
            let expected = app.buttons[expectedDay]
            try reveal(expected, upward: false)
            try tap(expected)
        }
    }

    private func selectNumericWheel(_ wheel: XCUIElement, number: Int, cycle: Int) throws {
        wheel.adjust(toPickerWheelValue: try wheelValue(wheel, number: number))
        // Native accessibility updates before the controlled React Native date value.
        // Let onChange settle before another wheel sends a date based on the old value.
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        // On this iOS 27 simulator adjust() can return after advancing only one row.
        // Re-read the actual value after each UI action; never proceed with an unverified time.
        for _ in 0..<32 {
            let current = wheel.value as? String ?? ""
            guard let digits = current.range(of: "[0-9]+", options: .regularExpression),
                  let value = Int(current[digits]) else {
                try require(false, "Unrecognized numeric picker value")
                return
            }
            if value == number { return }
            let forward = (number - value + cycle) % cycle
            let next = forward <= cycle / 2
            wheel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: next ? 0.61 : 0.39)).tap()
            let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                (wheel.value as? String) != current
            }, object: nil)
            try require(XCTWaiter.wait(for: [changed], timeout: 3) == .completed,
                        "Time picker did not advance; preserve the draft and inspect")
            RunLoop.current.run(until: Date().addingTimeInterval(1))
        }
        try require(false, "Time picker exceeded its bounded adjustment budget")
    }

    private func setStartTime(_ target: Date, expectedClock: String, expectedDay: String) throws {
        try setStartDate(target, expectedDay: expectedDay)
        let start = buttonBeginning("시작 시간 ")
        try reveal(start, upward: false)
        let wheels = app.pickerWheels
        if !wheels.firstMatch.exists { try tap(start) }
        try require(wheels.firstMatch.waitForExistence(timeout: 10), "Time picker wheels are missing")
        let components = seoulCalendar.dateComponents([.hour, .minute], from: target)
        let count = wheels.count
        try require(count == 2 || count == 3, "Unexpected time picker layout; inspect before proceeding")
        if count == 3 {
            let periodIndex = (0..<count).first { index in
                let value = wheels.element(boundBy: index).value as? String ?? ""
                return ["오전", "오후", "AM", "PM"].contains(value)
            }
            try require(periodIndex != nil, "Unrecognized AM/PM wheel")
            let period = wheels.element(boundBy: periodIndex!)
            let korean = (period.value as? String ?? "").hasPrefix("오")
            let numeric = (0..<count).filter { $0 != periodIndex! }
            let hour = wheels.element(boundBy: numeric[0])
            let minute = wheels.element(boundBy: numeric[1])
            try selectNumericWheel(hour, number: (components.hour! + 11) % 12 + 1, cycle: 12)
            try selectNumericWheel(minute, number: components.minute!, cycle: 60)
            // Crossing 11 → 12 can flip AM/PM, so apply the target period last.
            let targetPeriod = components.hour! < 12 ? (korean ? "오전" : "AM") : (korean ? "오후" : "PM")
            if period.value as? String != targetPeriod {
                period.adjust(toPickerWheelValue: targetPeriod)
                RunLoop.current.run(until: Date().addingTimeInterval(1))
                if period.value as? String != targetPeriod {
                    period.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: components.hour! < 12 ? 0.39 : 0.61)).tap()
                    RunLoop.current.run(until: Date().addingTimeInterval(1))
                }
            }
        } else {
            let hour = wheels.element(boundBy: 0)
            let minute = wheels.element(boundBy: 1)
            try selectNumericWheel(hour, number: components.hour!, cycle: 24)
            try selectNumericWheel(minute, number: components.minute!, cycle: 60)
        }
        let expected = app.buttons["시작 시간 " + expectedClock]
        try require(expected.waitForExistence(timeout: 10), "Start-time label does not match the requested target")
        capture("eta-future-time-selected")
        try tap(expected) // Collapse the picker before opening the route selector.
    }

    private func chooseStation(_ station: String, target: String) throws {
        let field = app.textFields[target + " 검색"]
        if !labeled("장소 검색 닫기").exists {
            // The route form exposes the same field label; tapping it opens the search sheet.
            if field.exists { try tap(field) }
            else { try tap(buttonBeginning(target + " 재선택, 현재 ")) }
        }
        try require(labeled("장소 검색 닫기").waitForExistence(timeout: 10), "Place-search sheet did not open")
        try require(field.waitForExistence(timeout: 10), "Place-search input is unavailable")
        // These are real recent-search UI entries already observed on this dedicated simulator.
        let recent = app.buttons[station + "[수도권2호선], 최근 장소 선택"]
        if recent.exists {
            capture("eta-" + target + "-recent-station")
            try tap(recent)
            return
        }
        try replace(field, with: station + " 2호선")
        let result = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH %@ AND label CONTAINS %@ AND NOT label CONTAINS %@ AND NOT label CONTAINS %@ AND NOT label CONTAINS %@",
            station, "2호선", "재선택", "삭제", "즐겨찾기"
        )).firstMatch
        try require(result.waitForExistence(timeout: 25), "The requested Line 2 station was not returned")
        capture("eta-" + target + "-search-result")
        try tap(result)
    }

    private func chooseTransitRoute() throws {
        let route = app.buttons["location-input-pressable"]
        let opener = route.exists ? route : labeled("출발지와 도착지 추가")
        try reveal(opener)
        try tap(opener)
        try chooseStation("강남역", target: "출발지")
        try chooseStation("선릉역", target: "도착지")
        let transit = labeled("대중교통")
        try require(transit.waitForExistence(timeout: 10), "Transit mode is unavailable")
        try tap(transit)
        let direct = app.buttons["6분 경로"]
        try require(direct.waitForExistence(timeout: 45),
                    "The expected six-minute Line 2 route was not returned; do not substitute another route")
        try tap(direct)
        try require(app.staticTexts["2호선 3분"].waitForExistence(timeout: 10) &&
                    app.staticTexts["강남역 · 2정거장"].exists,
                    "The selected six-minute route is not the observed direct Line 2 journey")
        capture("eta-direct-transit-route-selected")
        let save = labeled("이 경로 저장")
        try reveal(save)
        try tap(save)
        try require(app.textFields["일정 제목"].waitForExistence(timeout: 20), "Selected route did not return to the draft")
        let summary = buttonBeginning("이동 경로 수정, ")
        try require(summary.exists && summary.label.contains("강남역") && summary.label.contains("선릉역"),
                    "Stored draft route endpoints do not match")
        // The route card groups its visible duration under an explicit endpoint AX label.
        // The six-minute Line 2 journey was asserted above before saving into this draft.
        capture("eta-route-applied-to-draft")
    }

    func testPrepareEtaJourney() throws {
        let configuration = try configuration()
        try openOrResumeDraft()
        let title = app.textFields["일정 제목"]
        try reveal(title, upward: false)
        try replace(title, with: configuration.title)
        title.typeText("\n")
        let allDay = app.switches["종일 일정"]
        try require(allDay.exists, "Missing all-day control")
        if allDay.value as? String == "1" { try tap(allDay) }
        try require(allDay.value as? String == "0", "ETA journey must be a timed schedule")
        try setStartTime(configuration.target, expectedClock: configuration.clock, expectedDay: configuration.day)
        try chooseTransitRoute()
        let enabled = app.switches["출발 알림"]
        try reveal(enabled)
        if enabled.value as? String != "1" { try tap(enabled) }
        try rejectBlockingAlerts()
        try require(enabled.value as? String == "1", "Departure notification was not enabled")
        let standard = labeled("푸시 알림 선택")
        try reveal(standard)
        try tap(standard)
        try rejectBlockingAlerts()
        capture("eta-prepared-unsaved-draft")
        print("ETA_PREPARED: title/time/route/notification selected; schedule NOT saved")
    }

    /// Open only the specifically authorized saved schedule's editor for inspection.
    /// No field is changed and no save control is pressed.
    func testInspectExistingEtaEdit() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363",
                    "Existing-schedule editing is authorized only for schedule 363")
        let existingTitle = environment["E2E_EXISTING_TITLE"] ?? ""
        try require(existingTitle == "ETA E2E 1004 0030",
                    "The exact previously saved synthetic schedule title is required")
        let title = app.staticTexts[existingTitle].firstMatch
        try require(title.waitForExistence(timeout: 10),
                    "Open the authorized existing schedule detail before inspecting its editor")
        let edit = app.buttons["일정 수정"]
        try require(edit.exists && !app.buttons["일정 저장"].exists,
                    "The authorized saved detail screen is required")
        capture("eta-existing-schedule-before-edit")
        try tap(edit)
        try rejectBlockingAlerts()
        capture("eta-existing-schedule-edit-inspection")
        print("ETA_EXISTING_EDIT_UI\n" + app.debugDescription)
    }

    /// Prepare only the authorized existing edit draft, then inspect real place-search results.
    /// No route result is selected and the existing schedule is not saved here.
    func testPrepareExistingEtaRouteSearch() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363",
                    "Existing-schedule editing is authorized only for schedule 363")
        let existingTitle = environment["E2E_EXISTING_TITLE"] ?? ""
        try require(existingTitle == "ETA E2E 1004 0030", "The authorized existing title is required")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Use the authorized transfer-test title")
        let title = app.textFields["일정 제목"]
        try require(title.exists && app.buttons["일정 수정 저장"].exists && !app.buttons["일정 저장"].exists,
                    "The existing schedule's edit form must already be open")
        let currentTitle = title.value as? String ?? ""
        try require(currentTitle == existingTitle || currentTitle == configuration.title,
                    "An unrelated existing schedule is open; preserve it and stop")
        try reveal(title, upward: false)
        try replace(title, with: configuration.title)
        title.typeText("\n")
        try require(app.switches["종일 일정"].value as? String == "0", "The existing ETA schedule must remain timed")
        try setStartTime(configuration.target, expectedClock: configuration.clock, expectedDay: configuration.day)
        let route = app.buttons["location-input-pressable"]
        try reveal(route)
        try require(route.label.contains("강남역") && route.label.contains("선릉역"),
                    "The original route endpoints must still be present before searching")
        try tap(route)
        let origin = buttonBeginning("출발지 재선택, 현재 ")
        try require(origin.waitForExistence(timeout: 15) && origin.label.contains("강남역"),
                    "The original Gangnam departure must be selected")
        try tap(origin)
        try require(labeled("장소 검색 닫기").waitForExistence(timeout: 10), "Departure place-search sheet did not open")
        let search = app.textFields["출발지 검색"]
        try require(search.waitForExistence(timeout: 10), "Departure search input is missing")
        try replace(search, with: "노원역")
        // Observe returned result labels first; do not guess a station/line result selector.
        _ = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "노원역")).firstMatch.waitForExistence(timeout: 20)
        try rejectBlockingAlerts()
        capture("eta-existing-edit-nowon-search")
        print("ETA_EXISTING_ROUTE_SEARCH_UI\n" + app.debugDescription)
        print("ETA_EXISTING_DRAFT_NOT_SAVED: title/time edited; departure search results only")
    }

    /// Continue the inspected station search and inspect actual long-route candidates.
    func testInspectTransferRouteCandidates() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only the synthetic saved schedule is in scope")
        let originSearch = app.textFields["출발지 검색"]
        try require(originSearch.exists && originSearch.value as? String == "노원역", "Resume only the inspected Nowon search")
        try tap(app.buttons["노원역[수도권4호선], 서울 노원구 상계로 69-1"])
        let destinationSearch = app.textFields["도착지 검색"]
        if !destinationSearch.exists {
            try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").waitForExistence(timeout: 10), "Origin was not applied")
            try tap(buttonBeginning("도착지 재선택, 현재 선릉역[수도권2호선]"))
        }
        try require(destinationSearch.waitForExistence(timeout: 10), "Destination search did not open")
        try replace(destinationSearch, with: "신림역")
        let destination = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "신림역[수도권2호선], ")).firstMatch
        try require(destination.waitForExistence(timeout: 20), "Exact Sillim Line 2 station was not returned")
        capture("eta-transfer-destination-search")
        try tap(destination)
        try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").waitForExistence(timeout: 10), "Unexpected origin")
        try require(buttonBeginning("도착지 재선택, 현재 신림역[수도권2호선]").exists, "Unexpected destination")
        try tap(labeled("대중교통"))
        let candidate = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로")).firstMatch
        try require(candidate.waitForExistence(timeout: 45), "No transit candidates were returned")
        capture("eta-transfer-route-candidates")
        print("ETA_TRANSFER_ROUTE_CANDIDATES_UI\n" + app.debugDescription)
        print("ETA_EXISTING_DRAFT_NOT_SAVED: inspect route candidates before selecting")
    }

    /// Restart only this simulator's app process; never clear credentials or application data.
    func testRestartDedicatedEtaApp() throws {
        app.terminate()
        app.launch()
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.buttons["일정 추가"].exists || self.app.textFields["이메일"].exists
        }, object: nil)
        _ = XCTWaiter.wait(for: [ready], timeout: 40)
        if app.textFields["이메일"].exists {
            print("ETA_RESTART_STATE: login-required")
        } else {
            capture("eta-app-after-process-restart")
            print("ETA_RESTART_UI\n" + app.debugDescription)
        }
    }

    /// Test-only TMAP selection: prepare a future draft and inspect a real transfer search.
    /// Never save the schedule or interpret a route estimate as verified live ETA.
    func testReturnFromTransferTimeline() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        let origin = app.descendants(matching: .any)["route-step-row-origin"].firstMatch
        let destination = app.descendants(matching: .any)["route-step-row-destination"].firstMatch
        try require(origin.exists && origin.label.contains("노원역") &&
                    destination.exists && destination.label.contains("신림역"),
                    "Return only from the previously inspected transfer timeline")
        try tap(app.buttons["뒤로가기"])
        try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").waitForExistence(timeout: 15),
                    "Expected the scoped unsaved route picker")
        try require(buttonBeginning("도착지 재선택, 현재 신림역[수도권2호선]").exists,
                    "Unexpected destination")
        capture("eta-return-to-transfer-route-picker")
        print("ETA_RETURN_TO_TRANSFER_PICKER_UI\n" + app.debugDescription)
    }

    func testReopenTransferEditor() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").exists &&
                    buttonBeginning("도착지 재선택, 현재 신림역[수도권2호선]").exists,
                    "Only the inspected synthetic transfer route picker is in scope")
        try tap(app.buttons["일정 목록으로 이동"])
        try require(app.buttons["일정 추가"].waitForExistence(timeout: 15), "Calendar did not reopen")
        try testPrepareTmapTransferSearch()
    }

    func testPrepareTmapTransferSearch() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Unexpected synthetic title")
        if app.buttons["일정 추가"].exists {
            // The saved fixture and future draft are both on October 4; the helper only opens its card.
            try testVerifySavedEtaJourney()
        }
        let title = app.textFields["일정 제목"]
        if !title.exists {
            try require(app.staticTexts[configuration.title].firstMatch.exists && app.buttons["일정 수정"].exists,
                        "Open the authorized saved transfer detail before preparing a TMAP draft")
            try tap(app.buttons["일정 수정"])
        }
        // Resume only this previously inspected edit draft when its old target has expired.
        // The exact synthetic title, schedule scope, endpoints and final-save gate remain enforced.
        try require(title.waitForExistence(timeout: 10) && title.value as? String == configuration.title,
                    "Wrong edit draft; preserve unrelated schedules")
        try require(app.buttons["일정 수정 저장"].exists && !app.buttons["일정 저장"].exists,
                    "Only the scoped existing edit draft may be used")
        try setStartTime(configuration.target, expectedClock: configuration.clock, expectedDay: configuration.day)
        let route = app.buttons["location-input-pressable"]
        try reveal(route)
        try require(route.label.contains("노원역") && route.label.contains("신림역"), "Unexpected saved endpoints")
        try tap(route)
        try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").waitForExistence(timeout: 15),
                    "Unexpected origin")
        try require(buttonBeginning("도착지 재선택, 현재 신림역[수도권2호선]").exists, "Unexpected destination")
        let transit = labeled("대중교통")
        if !transit.isSelected { try tap(transit) }
        let candidate = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로")).firstMatch
        try require(candidate.waitForExistence(timeout: 45), "Real TMAP search returned no selectable route")
        try require(!app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "조회 한도를 초과했습니다")).firstMatch.exists,
                    "Provider quota failure must not be hidden behind route candidates")
        capture("eta-tmap-real-transfer-candidates")
        print("ETA_TMAP_TRANSFER_SEARCH_UI\n" + app.debugDescription)
        print("ETA_TMAP_SEARCH_NOT_SAVED: verify provider dispatch logs; no live ETA or history success claimed")
    }

    /// Re-search the same authorized schedule through the real provider; do not save here.
    func testInspectOdsayRefreshFromSavedTransfer() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only schedule 363 is authorized")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Unexpected test title")
        try require(app.staticTexts[configuration.title].firstMatch.waitForExistence(timeout: 15), "Open saved transfer detail first")
        let warning = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "재조회 미지원")).firstMatch
        try require(warning.waitForExistence(timeout: 20), "The unsupported saved TMAP route must expose its trust warning")
        capture("eta-unsupported-transit-warning")
        try tap(app.buttons["일정 수정"])
        let title = app.textFields["일정 제목"]
        try require(title.waitForExistence(timeout: 10) && title.value as? String == configuration.title, "Wrong edit draft")
        let route = app.buttons["location-input-pressable"]
        try reveal(route)
        try require(route.label.contains("노원역") && route.label.contains("신림역"), "Unexpected saved endpoints")
        try tap(route)
        try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").waitForExistence(timeout: 15), "Unexpected origin")
        try require(buttonBeginning("도착지 재선택, 현재 신림역[수도권2호선]").exists, "Unexpected destination")
        try tap(labeled("대중교통"))
        // A provider failure is an observation, never evidence that live correction succeeded.
        let candidate = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로")).firstMatch
        let providerError = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "조회 한도를 초과", "경로 서비스에 연결하지")).firstMatch
        let searchFinished = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            candidate.exists || providerError.exists
        }, object: nil)
        _ = XCTWaiter.wait(for: [searchFinished], timeout: 35)
        capture("eta-odsay-real-search-outcome")
        print("ETA_ODSAY_REAL_SEARCH_UI\n" + app.debugDescription)
        print("ETA_NOT_SAVED: inspect provider outcome before selecting or saving")
    }

    /// Real provider failure-path E2E. This explicitly does not prove successful ETA correction.
    func testVerifyOdsayQuotaFailure() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only schedule 363 is authorized")
        if app.buttons["일정 추가"].exists {
            try testVerifySavedEtaJourney()
        }
        if app.buttons["일정 수정"].exists {
            try testInspectOdsayRefreshFromSavedTransfer()
        }
        try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").exists, "Unexpected origin")
        try require(buttonBeginning("도착지 재선택, 현재 신림역[수도권2호선]").exists, "Unexpected destination")
        let quota = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "조회 한도를 초과했습니다")).firstMatch
        try require(quota.waitForExistence(timeout: 30), "Expected the real provider quota failure to be explicit")
        let candidate = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로")).firstMatch
        try require(!candidate.exists, "Quota error must not silently produce a TMAP route")
        capture("eta-odsay-quota-explicit-no-tmap-fallback")
        print("ETA_FAILURE_PATH_VERIFIED: explicit provider quota error, no selectable fallback, no schedule save")
    }

    /// Retry only the already observed provider error screen; never change endpoint or save.
    func testRetryOdsaySearch() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only schedule 363 is authorized")
        if app.buttons["일정 추가"].exists {
            try testVerifySavedEtaJourney()
            try testInspectOdsayRefreshFromSavedTransfer()
        }
        try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").exists, "Unexpected origin")
        try require(buttonBeginning("도착지 재선택, 현재 신림역[수도권2호선]").exists, "Unexpected destination")
        try tap(app.buttons["경로 다시 검색"])
        let candidate = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로")).firstMatch
        let succeeded = candidate.waitForExistence(timeout: 35)
        capture("eta-odsay-retry-outcome")
        print("ETA_ODSAY_RETRY_UI\n" + app.debugDescription)
        try require(succeeded, "Actual ODsay route search did not return a selectable route; E2E remains incomplete")
    }

    /// Inspect the selected future route's actual detail UI without saving the schedule.
    func testInspectFutureRouteTimeline() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Unexpected synthetic title")
        try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").exists &&
                    buttonBeginning("도착지 재선택, 현재 신림역[수도권2호선]").exists,
                    "Inspect only the observed Nowon to Sillim route")
        let candidate = app.buttons["1시간 5분 경로"]
        try require(candidate.exists && candidate.isSelected, "The reviewed route is not selected")
        let detail = app.buttons["경로 상세 보기"].firstMatch
        try reveal(detail)
        capture("eta-future-route-before-detail")
        try tap(detail)
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !self.app.buttons["경로 상세 보기"].firstMatch.exists
        }, object: nil)
        try require(XCTWaiter.wait(for: [loaded], timeout: 25) == .completed,
                    "Route detail did not open; do not interpret this as ETA validation")
        capture("eta-future-route-timeline-inspection")
        print("ETA_FUTURE_ROUTE_DETAIL_UI\n" + app.debugDescription)
        print("ETA_FUTURE_COMPARISON_INSPECTION_ONLY: no accuracy pass or schedule save")
    }

    /// Compare the visible total with the final timeline clock for the observed real route.
    /// This is internal timing consistency, not proof of a future train's arrival accuracy.
    func testVerifyFutureRouteTimelineConsistency() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Unexpected synthetic title")
        let departure = configuration.target.addingTimeInterval(-65 * 60)
        let clock = DateFormatter()
        clock.timeZone = seoulCalendar.timeZone
        clock.dateFormat = "HH:mm"
        let origin = app.descendants(matching: .any)["route-step-row-origin"].firstMatch
        let destination = app.descendants(matching: .any)["route-step-row-destination"].firstMatch
        try require(origin.waitForExistence(timeout: 15) && origin.label.contains("노원역") &&
                    origin.label.contains(clock.string(from: departure)), "Unexpected departure endpoint or time")
        try require(destination.exists && destination.label.contains("신림역") &&
                    destination.label.contains(clock.string(from: configuration.target)),
                    "Timeline arrival differs from the reviewed total; do not hide the mismatch")
        try require(app.staticTexts["1시간 5분"].firstMatch.exists, "Provider duration changed; inspect it again")
        try require(app.scrollViews.count == 1, "Expected the single observed route-detail scroll view")
        let detailScroll = app.scrollViews.firstMatch
        // The inspected sheet handle is 13pt above this scroll view. Expand only that sheet,
        // avoiding a global swipe that would pan the map or another simulator.
        if detailScroll.frame.height < app.frame.height * 0.4 {
            let startY = (detailScroll.frame.minY - 13) / app.frame.height
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: startY))
                .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.23)))
        }
        for _ in 0..<6 {
            if destination.isHittable { break }
            detailScroll.swipeUp()
        }
        try require(destination.isHittable, "The destination timeline could not be revealed")
        capture("eta-future-timeline-consistent-arrival")
        print("ETA_TIMELINE_CONSISTENCY_VERIFIED: " + origin.label + " -> " + destination.label)
        print("ETA_FUTURE_ACCURACY_NOT_VERIFIED: no timetable matching or observed trip")
    }

    /// Apply the inspected 65-minute transfer candidate to the existing unsaved draft.
    func testPrepareTransferEtaEdit() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only schedule 363 is authorized")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Unexpected synthetic title")
        try require(buttonBeginning("출발지 재선택, 현재 노원역[수도권4호선]").exists &&
                    buttonBeginning("도착지 재선택, 현재 신림역[수도권2호선]").exists,
                    "Resume only the inspected transfer route")
        let candidate = app.buttons["1시간 5분 경로"]
        try require(candidate.exists && candidate.isSelected, "Expected inspected candidate is not expanded")
        try require(app.staticTexts["환승 5분"].firstMatch.exists && app.staticTexts["2호선 9분"].firstMatch.exists &&
                    app.staticTexts["사당역 · 4정거장"].firstMatch.exists, "The selected transfer differs from inspected evidence")
        capture("eta-transfer-route-before-applying")
        let routeSave = labeled("이 경로 저장")
        try reveal(routeSave)
        try tap(routeSave)
        let title = app.textFields["일정 제목"]
        try require(title.waitForExistence(timeout: 20) && title.value as? String == configuration.title,
                    "Selected route did not return to the authorized edit draft")
        try require(app.buttons["일정 수정 저장"].exists && !app.buttons["일정 저장"].exists, "Not an existing edit")
        try require(app.buttons[configuration.day].exists && app.buttons["시작 시간 " + configuration.clock].exists,
                    "Prepared target date/time changed")
        let summary = buttonBeginning("이동 경로 수정, ")
        try require(summary.label.contains("노원역") && summary.label.contains("신림역"), "Draft endpoints mismatch")
        let enabled = app.switches["출발 알림 사용"]
        try reveal(enabled)
        try require(enabled.value as? String == "1", "Existing departure notification must remain enabled")
        try rejectBlockingAlerts()
        capture("eta-transfer-existing-edit-ready")
        print("ETA_TRANSFER_EDIT_READY_NOT_SAVED\n" + app.debugDescription)
    }

    /// Preserve the selected route while moving only the authorized fixture to today's future time.
    /// The final write remains separately gated by testCommitTransferEtaEdit.
    func testPrepareTimetableEtaReschedule() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Unexpected synthetic title")
        let existingDraft = app.textFields["일정 제목"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            existingDraft.exists || self.app.buttons["일정 수정"].exists || self.app.buttons["일정 추가"].exists
        }, object: nil)
        try require(XCTWaiter.wait(for: [ready], timeout: 20) == .completed,
                    "Wait for the dedicated app's authenticated screen after restart")
        if !existingDraft.exists && !app.buttons["일정 수정"].exists {
            try require(app.buttons["일정 추가"].exists, "Start only on the authenticated calendar")
            let day = app.buttons["detail-month-cell-2026-10-2026-10-05"]
            try tap(day)
            let card = buttonBeginning(configuration.title + ",")
            try require(card.waitForExistence(timeout: 15), "Authorized fixture is absent from October 5")
            try reveal(card)
            try tap(card)
        }
        if !existingDraft.exists {
            try require(app.staticTexts[configuration.title].firstMatch.exists, "Wrong schedule detail")
            capture("eta-existing-fixture-before-reschedule")
            try tap(app.buttons["일정 수정"])
        }
        let title = app.textFields["일정 제목"]
        try require(title.waitForExistence(timeout: 15) && title.value as? String == configuration.title,
                    "Wrong edit draft")
        try setStartTime(configuration.target, expectedClock: configuration.clock, expectedDay: configuration.day)
        let summary = buttonBeginning("이동 경로 수정, ")
        try require(summary.exists && summary.label.contains("노원역") && summary.label.contains("신림역"),
                    "Preserve the existing transfer endpoints")
        // Read the preserved value only. This iOS 27 switch has an invalid AX hit point;
        // no switch mutation is needed for rescheduling and it must not be toggled.
        try require(app.switches["출발 알림 사용"].value as? String == "1", "Preserve notification enablement")
        capture("eta-timetable-reschedule-ready-not-saved")
        print("ETA_RESCHEDULE_PREPARED_NOT_SAVED: same selected route; target=" + configuration.day + " " + configuration.clock)
    }

    /// Assert honest presentation after the real scoped worker; not an accuracy or recovery pass.
    func testVerifyTimetableEtaPresentation() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        if app.buttons["일정 수정"].exists {
            try require(app.staticTexts["ETA E2E 1004 transfer"].firstMatch.exists, "Wrong saved detail")
            try tap(app.buttons["이전 화면으로 돌아가기"])
            try require(app.buttons["일정 추가"].waitForExistence(timeout: 15), "Calendar did not reopen")
        }
        try testVerifySavedEtaJourney()
        let diagnostic = environment["E2E_EXPECTED_DIAGNOSTIC"] ?? ""
        let warning = diagnostic == "TRANSIT_ARRIVAL_UNAVAILABLE" ? "실시간 도착정보 없음" :
            diagnostic == "TRANSIT_ARRIVAL_OUT_OF_HORIZON" ? "실시간 조회 범위 밖" : "예상 출발"
        // Navigation retains older detail nodes in the accessibility tree. Inspect
        // the visible current summary, not the first cached node with this prefix.
        let summaries = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "일정 상세 시트 펼치기, 예상 출발 "))
        var visibleSummary: XCUIElement?
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            visibleSummary = summaries.allElementsBoundByIndex.first {
                $0.exists && $0.isHittable && $0.frame.height > 30 &&
                self.app.frame.contains($0.frame) && $0.label.contains(warning) && !$0.label.contains("운행시각 미확인")
            }
            return visibleSummary != nil
        }, object: nil)
        try require(XCTWaiter.wait(for: [expected], timeout: 20) == .completed,
                    "A timetable-only result without live verification must remain explicitly estimated")
        let summary = try XCTUnwrap(visibleSummary)
        try require(!summary.label.contains("권장 출발") && !summary.label.contains("재조회 미지원"),
                    "Do not promote uncertain ETA or mislabel a supported requery as unsupported")
        capture("eta-timetable-only-honest-app-presentation")
        print("ETA_TIMETABLE_PRESENTATION_VERIFIED: " + summary.label)
        print("ETA_REALTIME_TRANSFER_RECOVERY_AND_TWO_MINUTE_ACCURACY_NOT_VERIFIED")
    }

    /// Read the visible saved detail without reopening cached navigation entries.
    func testVerifyCurrentTimetableEtaPresentation() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        let configuration = try configuration()
        try require(app.staticTexts[configuration.title].firstMatch.exists && app.buttons["일정 수정"].exists,
                    "Inspect only the currently saved synthetic detail")
        let warning = environment["E2E_EXPECTED_DIAGNOSTIC"] == "TRANSIT_ARRIVAL_UNAVAILABLE"
            ? "실시간 도착정보 없음" : "실시간 조회 범위 밖"
        let summaries = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "일정 상세 시트 펼치기, 예상 출발 "))
        let current = summaries.matching(NSPredicate(format: "label CONTAINS %@", warning)).firstMatch
        try require(current.waitForExistence(timeout: 20), "Latest recorded diagnostic is absent from the current detail")
        try require(app.frame.contains(current.frame) && current.frame.height > 30,
                    "Expected a visibly rendered diagnostic, not an offscreen cached detail")
        capture("eta-current-live-unavailable-diagnostic")
        print("ETA_CURRENT_DIAGNOSTIC_PRESENTATION_VERIFIED: " + current.label)
    }

    /// Reset navigation only. The runner opens the private detail with simctl afterwards.
    func testResetIsolatedEtaNavigation() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E isolated fixture",
                    "Only the isolated fixture is authorized")
        let phase = try XCTUnwrap(environment["E2E_FIXTURE_PHASE"])
        try require(["success", "reconnect", "early-transfer", "dwell-transfer", "first-alighting-late", "onward-delay", "early-transfer-risk", "transfer-observed", "transfer-first-unobserved", "planned-postdeparture", "planned-alighting", "planned-first-alighting", "reported-boarding", "unknown", "missed", "recovered", "late", "contract-save"].contains(phase), "Unknown fixture phase")
        // An imminent fixture alarm may cover the calendar. Close its in-app
        // presentation only; never mark departure or turn off the automatic alarm.
        if app.buttons["알람 화면 닫기"].exists && app.buttons["경로 보기"].exists {
            try tap(app.buttons["알람 화면 닫기"])
        }
        if app.buttons["캘린더 선택 닫기"].isHittable {
            try tap(app.buttons["캘린더 선택 닫기"])
        }
        if app.buttons["일정 수정"].isHittable {
            try tap(app.buttons["이전 화면으로 돌아가기"])
        }
        try require(app.buttons["일정 추가"].waitForExistence(timeout: 15), "Calendar did not reopen")
        capture("eta-private-navigation-reset")
    }

    /// Create through actual recent-place/route selection and POST, never by fixture SQL.
    func testCreateIsolatedEtaJourney() throws {
        try require(environment["E2E_PRIVATE_CREATE"] == "1" && environment["E2E_ALLOW_SAVE"] == "1",
                    "Explicit private creation authorization is required")
        let configuration = try configuration()
        let realAutomatic = environment["E2E_REAL_AUTOMATIC"] == "1"
        try require(configuration.title == (realAutomatic ? "ETA E2E real isolated fixture" : "ETA E2E isolated fixture"), "Wrong private title")
        try openOrResumeDraft()
        let title = app.textFields["일정 제목"]
        try replace(title, with: configuration.title)
        title.typeText("\n")
        let allDay = app.switches["종일 일정"]
        if allDay.value as? String == "1" { try tap(allDay) }
        try require(allDay.value as? String == "0", "A timed schedule is required")
        try setStartTime(configuration.target, expectedClock: configuration.clock, expectedDay: configuration.day)
        let route = app.buttons["location-input-pressable"]
        let opener = route.exists ? route : labeled("출발지와 도착지 추가")
        try reveal(opener)
        try tap(opener)
        let search = app.textFields["route-search-input"]
        let searchOpened = search.waitForExistence(timeout: 8)
        let originFirst = !searchOpened || search.label == "출발지 검색"
        let selections = originFirst ? [("출발지", "노원역"), ("도착지", "신림역")]
            : [("도착지", "신림역"), ("출발지", "노원역")]
        for (index, selection) in selections.enumerated() {
            let (target, station) = selection
            if !search.exists { try tap(app.textFields[target + " 검색"]) }
            try require(labeled("장소 검색 닫기").waitForExistence(timeout: 10), "Private recent-place sheet missing")
            try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "label == %@", target + " 검색"), object: search
            )], timeout: 8) == .completed, "Unexpected active place field: " + target)
            let recent = app.buttons[station + ", 최근 장소 선택"]
            try require(recent.waitForExistence(timeout: 15), "Public fixture recent place missing; do not search externally")
            try tap(recent)
            if index == selections.count - 1 {
                let transit = app.buttons["대중교통"]
                // If the keyboard consumed the coordinate tap, retry only on the same open
                // place picker. Never retry a scheduled save or substitute coordinates.
                if !transit.waitForExistence(timeout: 3), search.exists, search.label == target + " 검색",
                   recent.isHittable {
                    recent.tap()
                }
                try require(transit.waitForExistence(timeout: 12), "Final place selection did not leave place search")
            }
        }
        try require(app.buttons["출발지 재선택, 현재 노원역"].exists &&
                    app.buttons["도착지 재선택, 현재 신림역"].exists, "Do not query a different pair of endpoints")
        try tap(labeled("대중교통"))
        // The real formatter announces durations >= 60 minutes as hours + minutes.
        if realAutomatic {
            let subwayFilter = app.buttons.matching(NSPredicate(
                format: "label BEGINSWITH %@ AND label ENDSWITH %@", "지하철 ", " 경로 필터"
            )).firstMatch
            try require(subwayFilter.waitForExistence(timeout: 45), "Real subway route filter is unavailable")
            if !subwayFilter.isSelected { try tap(subwayFilter) }
            let candidates = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로"))
            try require(candidates.firstMatch.waitForExistence(timeout: 45), "Real route search returned no candidates")
            let list = app.scrollViews.firstMatch
            var matched = false
            for candidate in candidates.allElementsBoundByIndex.prefix(5) {
                for _ in 0..<4 where !candidate.isHittable { list.swipeUp() }
                if !candidate.isHittable { continue }
                if !(candidate.value as? String ?? "").hasPrefix("expanded") { try tap(candidate) }
                let line4 = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "4호선 ")).firstMatch
                let line2 = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "2호선 ")).firstMatch
                if line4.exists && line2.exists { matched = true; break }
            }
            try require(matched, "Do not save a different real transfer topology")
        } else {
            let candidate = app.buttons["1시간 5분 경로"]
            try require(candidate.waitForExistence(timeout: 30), "Expected transfer route was not returned")
            if candidate.value as? String != "expanded" { try tap(candidate) }
            try require(app.staticTexts["4호선 49분"].firstMatch.exists &&
                        app.staticTexts["2호선 9분"].firstMatch.exists, "Wrong transfer lines/durations")
        }
        capture("eta-private-created-route-selection")
        let applyToDraft = app.buttons["이 경로를 일정에 적용"]
        let applyRoute = applyToDraft.exists ? applyToDraft : labeled("이 경로 저장")
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND enabled == true"), object: applyRoute
        )], timeout: 20) == .completed, "Route application did not become ready after timetable lookup")
        try tap(applyRoute)
        try require(title.waitForExistence(timeout: 15), "Route did not return to the new draft")
        let summary = buttonBeginning("이동 경로 수정, ")
        try require(summary.label.contains("노원역") && summary.label.contains("신림역"), "Wrong selected endpoints")
        let enabled = app.switches["출발 알림"]
        try reveal(enabled)
        if enabled.value as? String != "1" { try tap(enabled) }
        try rejectBlockingAlerts()
        try require(enabled.value as? String == "1", "Departure notification must be enabled")
        // Push mode avoids treating native alarm permission/delivery as part of this input-contract gate.
        try tap(labeled(realAutomatic ? "출발 알람 선택" : "푸시 알림 선택"))
        let save = app.buttons["일정 저장"]
        try reveal(save)
        try require(save.exists && !app.buttons["일정 수정 저장"].exists, "Only a new schedule may be saved")
        capture("eta-private-new-before-save")
        try tap(save)
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: save)], timeout: 30) == .completed,
            "Creation uncertain: inspect private DB before retrying")
        capture("eta-private-new-after-save")
        print("ETA_PRIVATE_NEW_CREATED_ONCE: verify POST, persisted inputs and actual Worker separately")
    }

    /// Persist a changed future target through the actual form and controller, only in private H2.
    func testSaveIsolatedEtaTarget() throws {
        try require(environment["E2E_PRIVATE_TARGET_SAVE"] == "1" &&
                    environment["E2E_ALLOW_SAVE"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E isolated fixture",
                    "Only the marked private target-save contract is authorized")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E isolated fixture", "Wrong private title")
        try require(app.staticTexts[configuration.title].firstMatch.waitForExistence(timeout: 20) &&
                    app.buttons["일정 수정"].exists, "Private saved detail must be open")
        try tap(app.buttons["일정 수정"])
        let title = app.textFields["일정 제목"]
        try require(title.waitForExistence(timeout: 15) && title.value as? String == configuration.title,
                    "Wrong private edit draft")
        try setStartTime(configuration.target, expectedClock: configuration.clock, expectedDay: configuration.day)
        let route = buttonBeginning("이동 경로 수정, ")
        try require(route.exists && route.label.contains("노원역") && route.label.contains("신림역"),
                    "Preserve the selected transfer route")
        try require(app.switches["출발 알림 사용"].value as? String == "1", "Preserve departure notification")
        let save = app.buttons["일정 수정 저장"]
        try require(save.exists && !app.buttons["일정 저장"].exists, "Existing private schedule edit only")
        try reveal(save)
        capture("eta-private-target-before-save")
        try tap(save)
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: save)], timeout: 30) == .completed,
            "Save uncertain; inspect private persistence before retrying")
        capture("eta-private-target-after-save")
        print("ETA_PRIVATE_TARGET_SAVED_ONCE: verify persisted target and worker input separately")
    }

    func testVerifyNaturalEtaFixture() throws {
        try require(environment["E2E_NATURAL_UI"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E isolated fixture", "Private natural result only")
        try require(app.staticTexts["ETA E2E isolated fixture"].firstMatch.waitForExistence(timeout: 20) &&
                    app.buttons["일정 수정"].exists, "Natural fixture detail did not open")
        let summary = buttonBeginning("일정 상세 시트 펼치기, 권장 출발 ")
        try require(summary.waitForExistence(timeout: 20) && summary.isHittable && app.frame.contains(summary.frame),
                    "Recovered accepted ETA must be visibly rendered")
        let departure = try XCTUnwrap(environment["E2E_FIXTURE_DEPARTURE_CLOCK"])
        let minutes = try XCTUnwrap(environment["E2E_FIXTURE_MINUTES"])
        try require(summary.label.contains("권장 출발 " + departure) && summary.label.contains("현재 이동 " + minutes + "분"),
                    "Displayed natural result differs from persisted evaluation")
        try require(!summary.label.contains("미확인") && !summary.label.contains("미지원"), "Recovery remained degraded")
        capture("eta-natural-cadence-recovered-ui")
        print("ETA_NATURAL_UI_VERIFIED: " + summary.label)
    }

    /// Read the native bridge through a scoped development UI; no XCTest response injection.
    func testInspectIsolatedNativeAlarm() throws {
        _ = try inspectNativeAlarm()
    }

    /// Verify actual OS pending requests, including CANCEL. Never equate a DB command with OS success.
    func testVerifyIsolatedNativeAlarmState() throws {
        let first = try inspectNativeAlarmState()
        let replay = try inspectNativeAlarmState()
        // Replaying the same authenticated snapshot must not add another OS request.
        let a = try JSONSerialization.data(withJSONObject: first["osPending"] ?? [], options: [.sortedKeys])
        let b = try JSONSerialization.data(withJSONObject: replay["osPending"] ?? [], options: [.sortedKeys])
        try require(a == b, "Repeated snapshot reconciliation changed actual OS pending requests")
        print("ETA_NATIVE_DUPLICATE_REPLAY_VERIFIED")
    }

    private func beginNativeInspection(_ inspect: XCUIElement, status: XCUIElement) throws {
        try tap(inspect)
        let started = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != 'READY'"), object: status)
        if XCTWaiter.wait(for: [started], timeout: 2) != .completed {
            // A deep-link transition can swallow its first tap. Retry only while no
            // inspection has begun; never retry/ignore BLOCKED, SYNC_FAILED or a busy call.
            if status.label == "READY" && inspect.isEnabled && inspect.isHittable {
                try tap(inspect)
            }
        }
    }

    private func inspectNativeAlarmState() throws -> [String: Any] {
        try require(environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == (environment["E2E_REAL_AUTOMATIC"] == "1" ? "ETA E2E real isolated fixture" : "ETA E2E isolated fixture"), "Private native fixture only")
        let inspect = app.buttons["격리 알람 예약 확인"]
        try require(inspect.waitForExistence(timeout: 20), "Scoped native observation screen must be open")
        let status = app.staticTexts["eta-alarm-status"]
        try beginNativeInspection(inspect, status: status)
        let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == 'INSPECTED'"), object: status)
        try require(XCTWaiter.wait(for: [done], timeout: 20) == .completed,
                    "Native snapshot replay failed or was blocked; last stage: " + status.label +
                    "; read-only OS probe: " + app.staticTexts["eta-alarm-diagnostic"].label)
        let text = app.staticTexts["eta-alarm-evidence"].label
        let data = try XCTUnwrap(text.data(using: .utf8))
        let record = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let alarms = try XCTUnwrap(record["alarms"] as? [[String: Any]])
        let pending = try XCTUnwrap(record["osPending"] as? [[String: Any]])
        let operation = try XCTUnwrap(environment["E2E_NATIVE_OPERATION"])
        let generation = try XCTUnwrap(Int(environment["E2E_NATIVE_GENERATION"] ?? ""))
        if operation == "CANCEL" {
            try require(alarms.isEmpty && pending.isEmpty,
                        "Cancelled fixture must be absent from both native store and actual OS pending requests")
        } else {
            let planData = try XCTUnwrap((environment["E2E_NATIVE_PLAN"] ?? "").data(using: .utf8))
            let plan = try XCTUnwrap(try JSONSerialization.jsonObject(with: planData) as? [[String: String]])
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let observedAt = try XCTUnwrap(formatter.date(from: record["observedAt"] as? String ?? ""))
            // M15/M10/M5 are intended reminders, not duplicates. Only future occurrences
            // should still be pending, once each, with no extra physical request.
            let datedPlan = try plan.map { item in
                (item, try XCTUnwrap(ISO8601DateFormatter().date(from: item["triggerAt"] ?? "")))
            }
            let future = datedPlan.filter { $0.1 > observedAt }
            try require(operation == "UPSERT" && !future.isEmpty && alarms.count == future.count && pending.count == future.count,
                        "Each future planned occurrence requires exactly one native alarm and OS request")
            for (occurrence, expected) in future {
                let id = try XCTUnwrap(occurrence["occurrenceId"])
                let nativeId = "schedule:363:member:296:occurrence:" + id
                let matchingAlarms = alarms.filter { $0["nativeAlarmId"] as? String == nativeId }
                let matchingRequests = pending.filter { $0["nativeAlarmId"] as? String == nativeId }
                try require(matchingAlarms.count == 1 && matchingRequests.count == 1, "Duplicate or missing occurrence: " + id)
                let alarm = matchingAlarms[0], request = matchingRequests[0]
                try require(alarm["generation"] as? Int == generation && request["generation"] as? Int == generation,
                            "Native and OS generation must match the Worker command")
                try require(request["occurrenceId"] as? String == id, "OS pending request belongs to another occurrence")
                let trigger = try XCTUnwrap(request["trigger"] as? [String: Any])
                try require(trigger["type"] as? String == "calendar" && trigger["repeats"] as? Bool == false,
                            "A real one-shot OS calendar trigger is required")
                let fields = try XCTUnwrap(trigger["dateComponents"] as? [String: Any])
                var parts = DateComponents()
                parts.year = fields["year"] as? Int; parts.month = fields["month"] as? Int
                parts.day = fields["day"] as? Int; parts.hour = fields["hour"] as? Int
                parts.minute = fields["minute"] as? Int; parts.second = fields["second"] as? Int
                try require([parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].allSatisfy { $0 != nil },
                            "OS calendar trigger must contain an exact date and time")
                try require((fields["timeZone"] as? String)?.hasPrefix("GMT") == true,
                            "The production native calendar trigger must explicitly use GMT")
                var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
                try require(calendar.date(from: parts) == expected && expected.timeIntervalSinceNow > 5,
                            "Actual OS trigger must match the future Worker trigger, not an already fired alarm")
            }
        }
        capture("eta-native-state-" + operation.lowercased())
        print("ETA_NATIVE_STATE_EVIDENCE: " + text)
        return record
    }

    private func inspectNativeAlarm() throws -> Date {
        try require(environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == (environment["E2E_REAL_AUTOMATIC"] == "1" ? "ETA E2E real isolated fixture" : "ETA E2E isolated fixture"), "Private native fixture only")
        let inspect = app.buttons["격리 알람 예약 확인"]
        try require(inspect.waitForExistence(timeout: 20), "Scoped native observation screen must be open")
        let status = app.staticTexts["eta-alarm-status"]
        func readReservation() throws -> (String, [String: Any]) {
            try beginNativeInspection(inspect, status: status)
            let done = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == 'INSPECTED'"), object: status)
            try require(XCTWaiter.wait(for: [done], timeout: 20) == .completed,
                        "Native inspection failed or was blocked; last stage: " + status.label)
            let text = app.staticTexts["eta-alarm-evidence"].label
            let data = try XCTUnwrap(text.data(using: .utf8))
            let record = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
            if environment["E2E_REAL_AUTOMATIC"] == "1" {
                let sync = try XCTUnwrap(record["sync"] as? [String: Any])
                try require(sync["inspectionOnly"] as? Bool == true && sync["fetched"] as? Bool == false,
                            "Automatic delivery must not be repaired by diagnostic snapshot replay")
            }
            return (text, record)
        }
        let trigger = try XCTUnwrap(environment["E2E_NATIVE_TRIGGER"])
        let expected = try XCTUnwrap(ISO8601DateFormatter().date(from: trigger))
        func containsExpected(_ record: [String: Any]) -> Bool {
            (record["alarms"] as? [[String: Any]] ?? []).contains { item in
                guard let value = item["triggerAt"] as? String else { return false }
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                return (formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)) == expected
            }
        }
        var (text, record) = try readReservation()
        // The production foreground poll can be between ticks. Re-read only;
        // never reconcile, change the expected time or wait past the due alarm.
        let deadline = min(Date().addingTimeInterval(65), expected.addingTimeInterval(-5))
        while environment["E2E_REAL_AUTOMATIC"] == "1" && !containsExpected(record) && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(1))
            (text, record) = try readReservation()
        }
        let capabilities = try XCTUnwrap(record["capabilities"] as? [String: Any])
        try require(capabilities["notificationAuthorized"] as? Bool == true, "Notification permission is required; never auto-accept it")
        try require(capabilities["soundAuthorization"] as? String == "enabled", "Sound authorization is not enabled")
        try require(containsExpected(record), "The actual native reservation must match the Worker departure time")
        capture("eta-native-scheduled")
        print("ETA_NATIVE_SCHEDULED_EVIDENCE: " + text)
        return expected
    }

    /// Wait on actual wall time for the OS banner. Mock route feeds do not mock local notification delivery.
    func testObserveIsolatedNativeAlarmDelivery() throws {
        let expected = try inspectNativeAlarm()
        let wait = expected.timeIntervalSinceNow
        try require(wait > 5 && wait < 600, "Do not test expired or unbounded alarm reservations")
        let mode = try XCTUnwrap(environment["E2E_NATIVE_MODE"])
        try require(["foreground", "background", "terminated", "locked"].contains(mode), "Unsupported delivery condition")
        if mode == "foreground" {
            // Keep the actual app active. Its production local-notification listener owns this presentation.
            let stop = app.buttons["알람 끄기"].firstMatch
            try require(!stop.exists, "An old alarm screen cannot satisfy foreground delivery")
            try require(stop.waitForExistence(timeout: wait + 25), "Foreground delivery did not open the actual alarm screen")
            let observed = Date()
            let deliveryDelay = observed.timeIntervalSince(expected)
            try require(deliveryDelay >= 0 && deliveryDelay <= 25,
                        "Foreground delivery must not be early or exceed tolerance")
            capture("eta-native-custom-screen-foreground")
            print("ETA_NATIVE_OS_DELIVERED: foreground: scheduled=" + ISO8601DateFormatter().string(from: expected) +
                  " observed=" + ISO8601DateFormatter().string(from: observed))
            fflush(stdout)
            print("ETA_NATIVE_AUDIBLE_SOUND_NOT_MEASURED")
            try tap(stop)
            try require(app.buttons["알람 꺼짐"].firstMatch.waitForExistence(timeout: 10), "Foreground alarm did not stop")
            capture("eta-native-stopped-foreground")
            return
        }
        if mode == "terminated" {
            app.terminate()
            try require(app.state == .notRunning, "The app must really be terminated")
        } else { XCUIDevice.shared.press(.home) }
        if mode == "locked" {
            // The operator uses the pinned simulator's observed Lock menu. Never fake a lock with a black screenshot.
            print("ETA_NATIVE_LOCK_READY")
            fflush(stdout)
            // This iOS 27 lock screen exposes date/time without an unlock-hint label.
            // Together with the observed host Lock action, require the actual clock surface
            // and absence of the home-screen NoLate icon; never accept a dark display alone.
            let lockClock = springboard.descendants(matching: .any).matching(NSPredicate(format:
                "label MATCHES %@", "(오전|오후) [0-9]{1,2}:[0-9]{2}")).firstMatch
            let lockDate = springboard.descendants(matching: .any).matching(NSPredicate(format:
                "label MATCHES %@", "[0-9]{1,2}월 [0-9]{1,2}일 .*" )).firstMatch
            // A clock can also exist on Home. Wait for the whole lock condition,
            // not just the clock, before testing the date and icon absence.
            let actualLock = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                lockClock.exists && lockDate.exists &&
                    !self.springboard.otherElements["Home screen icons"].exists &&
                    self.springboard.windows["SBCoverSheetWindow"].exists
            }, object: nil)
            let lockObserved = XCTWaiter.wait(for: [actualLock], timeout: 60) == .completed
            if !lockObserved { print("ETA_NATIVE_LOCK_FAILURE_UI\n" + springboard.debugDescription) }
            try require(lockObserved, "Actual observed lock-screen date/time must replace home icons")
            let locked = XCTAttachment(screenshot: springboard.screenshot())
            locked.name = "eta-native-locked-before-delivery"
            locked.lifetime = .keepAlways
            add(locked)
            print("ETA_NATIVE_LOCK_OBSERVED")
        }
        // The production notification uses a generic heading; identify the scoped schedule in its body.
        let fixtureTitle = environment["E2E_EXISTING_TITLE"] ?? "ETA E2E isolated fixture"
        let title = springboard.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", fixtureTitle)).firstMatch
        try require(!title.exists, "A pre-existing notification cannot count as this delivery")
        try require(title.waitForExistence(timeout: wait + 25), "The OS did not display the scoped notification at its due time")
        let observed = Date()
        // Accessibility can expose the banner before its entrance animation
        // has painted. Preserve its first observed time, then capture visible
        // pixels before tapping the same scoped OS element.
        let actionable = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in title.exists && title.isHittable }, object: nil)
        try require(XCTWaiter.wait(for: [actionable], timeout: 3) == .completed,
                    "The same delivered OS notification must become actionable after its entrance animation")
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        // Capture the pinned simulator's entire screen, including OS overlay
        // windows; an application-only SpringBoard screenshot can omit banners.
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "eta-native-os-delivered-" + mode
        attachment.lifetime = .keepAlways
        add(attachment)
        let deliveryDelay = observed.timeIntervalSince(expected)
        try require(deliveryDelay >= 0 && deliveryDelay <= 25,
                    "Observed notification must not be early or exceed the test delivery tolerance")
        print("ETA_NATIVE_OS_DELIVERED: " + mode + ": scheduled=" + ISO8601DateFormatter().string(from: expected) +
              " observed=" + ISO8601DateFormatter().string(from: observed))
        fflush(stdout)
        // Audio authorization/asset checks are not acoustic evidence. Never declare audible sound from a screenshot.
        print("ETA_NATIVE_AUDIBLE_SOUND_NOT_MEASURED")
        // Banner lifetime is short: do not query the background app's password/alert sheets first.
        // This is the already-observed, scoped SpringBoard notification, not a permission prompt.
        try require(title.exists && title.isHittable, "The observed notification must remain actionable")
        title.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        // Querying a locked/background application's accessibility tree can itself
        // time out on iOS 27. Inspect OS/app state first, not an inaccessible button.
        if mode == "locked" && app.state != .runningForeground {
            // Separate a lock-screen interaction from an application response failure.
            // Keep the actual SpringBoard surface as evidence before any further gesture.
            print("ETA_NATIVE_AFTER_LOCK_TAP_APP_STATE: " + String(app.state.rawValue))
            print("ETA_NATIVE_AFTER_LOCK_TAP_UI\n" + springboard.debugDescription)
            let cell = springboard.buttons.matching(NSPredicate(format:
                "label CONTAINS %@", "ETA E2E isolated fixture")).firstMatch
            try require(cell.exists && cell.isHittable, "The scoped lock notification must remain visible after waking")
            // iOS 27 exposed a real 'Open' swipe action on this exact notification
            // in the failed hierarchy. Use that OS action when present, not the
            // shifted body whose next tap can simply close the action affordance.
            let open = cell.buttons["열기"].firstMatch
            if open.exists && open.isHittable {
                print("ETA_NATIVE_LOCK_NOTIFICATION_OPEN_ACTION")
                open.tap()
            } else {
                print("ETA_NATIVE_LOCK_NOTIFICATION_SECOND_TAP")
                cell.tap()
            }
            if app.state != .runningForeground {
                let lockDate = springboard.descendants(matching: .any).matching(NSPredicate(format:
                    "label MATCHES %@", "[0-9]{1,2}월 [0-9]{1,2}일 .*" )).firstMatch
                try require(lockDate.exists && springboard.alerts.count == 0,
                            "Only the observed simulator lock screen may receive the unlock gesture")
                // Complete the normal user unlock gesture after the real notification tap.
                // Never activate the app or inject navigation; passcodes/permissions remain manual.
                print("ETA_NATIVE_LOCK_UNLOCK_GESTURE")
                // The observed home indicator is at the bottom edge of the
                // 402x874 lock window. A generic center swipe scrolls notifications
                // rather than completing the OS's bottom-edge unlock gesture.
                let lockWindow = springboard.windows["SBCoverSheetWindow"]
                try require(lockWindow.exists && lockWindow.frame.height > 0,
                            "The observed lock window is required for an edge swipe")
                lockWindow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98))
                    .press(forDuration: 0.05, thenDragTo:
                        lockWindow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)))
                try require(springboard.alerts.count == 0, "System prompts need operator review")
                print("ETA_NATIVE_AFTER_UNLOCK_APP_STATE: " + String(app.state.rawValue))
                print("ETA_NATIVE_AFTER_UNLOCK_UI\n" + springboard.debugDescription)
            }
        }
        let foreground = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.state == .runningForeground
        }, object: nil)
        try require(XCTWaiter.wait(for: [foreground], timeout: 20) == .completed,
                    "The real notification interaction did not bring the app to foreground")
        // Bind queries only after the OS has launched the cold process. This
        // is observation, not launch()/activate() or navigation repair.
        let respondingApp = XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe")
        let stop = respondingApp.buttons["알람 끄기"].firstMatch
        let opened = stop.waitForExistence(timeout: 20)
        if !opened {
            // Capture system pixels before failure triage performs another app
            // AX query, which can itself stall long after this open deadline.
            let missing = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            missing.name = "eta-native-cold-start-at-open-deadline"
            missing.lifetime = .keepAlways
            add(missing)
            print("ETA_NATIVE_OPEN_DEADLINE_MISSED_AT: " + ISO8601DateFormatter().string(from: Date()))
        }
        if !opened && mode == "locked" {
            let lockedFailure = XCTAttachment(screenshot: springboard.screenshot())
            lockedFailure.name = "eta-native-lock-interaction-failure"
            lockedFailure.lifetime = .keepAlways
            add(lockedFailure)
            print("ETA_NATIVE_LOCK_INTERACTION_FAILURE_UI\n" + springboard.debugDescription)
        }
        try require(opened, "The real notification tap did not open the custom alarm screen")
        capture("eta-native-custom-screen-" + mode)
        try tap(stop)
        try require(respondingApp.buttons["알람 꺼짐"].firstMatch.waitForExistence(timeout: 10), "The scoped alarm did not stop")
        capture("eta-native-stopped-" + mode)
    }

    func testVerifyIsolatedOdsayTimetableSelection() throws {
        let persist = environment["E2E_DATED_TIMETABLE_SAVE"] == "1"
        try require(environment["E2E_REAL_ISOLATED"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E real isolated fixture" &&
                    environment["E2E_ALLOW_SAVE"] == (persist ? "1" : "0"), "Use only the scoped timetable fixture")
        try openRealIsolatedDetail()
        try tap(app.buttons["일정 수정"])
        let route = app.buttons["location-input-pressable"]
        try reveal(route)
        try tap(route)
        try tap(labeled("대중교통"))
        if environment["E2E_REAL_BUS_PREVIEW"] == "1" {
            try require(persist, "Bus preview verification requires its own private save")
            try verifyAndSaveLiveBusOption()
            return
        }
        if environment["E2E_WEEKEND_BUS_OPTIONS"] == "1" {
            try require(persist, "Weekend bus verification requires its own private save")
            try verifyAndSaveWeekendBusOption()
            return
        }
        let subwayFilter = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH %@ AND label ENDSWITH %@", "지하철 ", " 경로 필터"
        )).firstMatch
        try require(subwayFilter.waitForExistence(timeout: 45) && subwayFilter.isEnabled,
                    "The actual ODsay search must offer a selectable subway route")
        try tap(subwayFilter)
        if environment["E2E_SEOLLEUNG_WALK_ONLY"] == "1" {
            try require(persist && environment["E2E_SEOLLEUNG_ACCESS"] == "1", "Use the scoped access walk fixture")
            let candidate = app.buttons["7분 경로"].firstMatch
            try require(candidate.waitForExistence(timeout: 30), "The verified access walk should extend the route estimate to seven minutes")
            let value = try XCTUnwrap(candidate.value as? String)
            try require(!value.contains("시간표 기준"), "The walking estimate cannot be presented as a timetable")
            capture("eta-odsay-missing-timetable-route")
            let apply = labeled("이 경로를 일정에 적용")
            try reveal(apply)
            try tap(apply)
            try require(app.textFields["일정 제목"].waitForExistence(timeout: 15) &&
                        app.textFields["일정 제목"].value as? String == "ETA E2E real isolated fixture",
                        "Must return to the private schedule draft")
            try saveAndReopenPrivateScheduleEdit()
            capture("eta-odsay-missing-timetable-reopened")
            print("ETA_ODSAY_WALK_ESTIMATE_SAVED_AND_REOPENED")
            return
        }
        // The route button exposes the visibly rendered timing in accessibilityValue.
        let timing = app.buttons.matching(NSPredicate(
            format: "value CONTAINS %@ AND value CONTAINS %@", "시간표 기준", "예상 도착"
        )).firstMatch
        try require(timing.waitForExistence(timeout: 30), "The selected route must display the server timetable")
        let accessibilityValue = try XCTUnwrap(timing.value as? String)
        let timetableStart = try XCTUnwrap(accessibilityValue.range(of: "시간표 기준"))
        let timetableLabel = String(accessibilityValue[timetableStart.lowerBound...])
        let walkingRange = try XCTUnwrap(timetableLabel.range(of: "도보 [0-9]+분", options: .regularExpression))
        let walkingSummary = String(timetableLabel[walkingRange])
        let transferWait = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "예상 대기")).firstMatch
        let rideClock = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "하차 예정")).firstMatch
        try require((timetableLabel.contains("환승 0회") || transferWait.exists) && rideClock.exists,
                    "The timetable route must distinguish waiting from walking and riding")
        capture("eta-odsay-timetable-selection")
        let map = labeled("지도에서 경로 보기")
        try reveal(map)
        try tap(map)
        let summary = labeled("경로 상세 펼치기")
        try require(summary.waitForExistence(timeout: 25), "The selected ODsay route must open on the map")
        let arrivalRange = try XCTUnwrap(timetableLabel.range(
            of: "(?:다음날 )?(?:오전|오후) [0-9]+:[0-9]{2}(?= 예상 도착)", options: .regularExpression))
        let arrivalClock = String(timetableLabel[arrivalRange])
        try require((summary.value as? String)?.contains(arrivalClock + " 목적지 도착 (시간표 기준)") == true,
                    "List and map must show the same ODsay route timetable arrival")
        try require((summary.value as? String)?.contains(walkingSummary) == true,
                    "List and map must show the same timetable walking total")
        capture("eta-odsay-timetable-map")
        let apply = labeled("선택한 경로를 일정에 적용")
        let save = apply.exists ? apply : labeled("선택한 경로 저장")
        try reveal(save)
        try tap(save)
        try require(app.textFields["일정 제목"].waitForExistence(timeout: 15), "Must return to the schedule draft")
        try require(buttonBeginning("이동 경로 수정, ").exists, "The draft must contain the selected route")
        let departureRange = try XCTUnwrap(timetableLabel.range(
            of: "(?:오전|오후) [0-9]+:[0-9]{2}(?= 출발)", options: .regularExpression))
        let departureClock = String(timetableLabel[departureRange])
        let settingsClock = arrivalClock.hasPrefix("다음날 ") ? String(arrivalClock.dropFirst("다음날 ".count)) : arrivalClock
        let settingsArrival = app.staticTexts[settingsClock + " 도착 예정"].firstMatch
        try reveal(settingsArrival)
        try require(settingsArrival.exists && app.staticTexts[departureClock].firstMatch.exists,
                    "The alert settings must show the same departure and destination clocks as the selected route")
        print("ETA_ODSAY_TIMETABLE_ALERT_SETTINGS_VERIFIED: " + departureClock + " / " + settingsClock)
        capture("eta-odsay-timetable-applied-to-draft")
        print("ETA_ODSAY_TIMETABLE_SELECTION_VERIFIED: " + timetableLabel)
        print("ETA_ODSAY_TIMETABLE_MAP_VERIFIED: " + arrivalClock)
        if persist {
            try require(app.textFields["일정 제목"].value as? String == "ETA E2E real isolated fixture",
                        "Only the synthetic schedule may be saved")
            if let revised = environment["E2E_DATED_TIMETABLE_RESCHEDULE"], !revised.isEmpty {
                let target = try XCTUnwrap(ISO8601DateFormatter().date(from: revised))
                let day = seoulCalendar.dateComponents([.year, .month, .day], from: target)
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "ko_KR")
                formatter.timeZone = seoulCalendar.timeZone
                formatter.dateFormat = "a h:mm"
                try setStartTime(target, expectedClock: formatter.string(from: target),
                                 expectedDay: "시작 날짜 \(day.year!). \(day.month!). \(day.day!).")
                print("ETA_ODSAY_TIMETABLE_APPOINTMENT_CHANGED: " + revised)
            }
            try saveAndReopenPrivateScheduleEdit()
            let compactSummary = app.buttons["schedule-route-compact-summary"]
            let savedWalking = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                (compactSummary.exists && compactSummary.label.components(separatedBy: ", ").contains(walkingSummary)) ||
                    self.app.staticTexts[walkingSummary].firstMatch.exists
            }, object: nil)
            try require(XCTWaiter.wait(for: [savedWalking], timeout: 10) == .completed,
                        "The reopened schedule must show the timetable walking total")
            capture("eta-odsay-timetable-reopened")
            print("ETA_ODSAY_TIMETABLE_SAVED_AND_REOPENED")
            print("ETA_ODSAY_TIMETABLE_WALKING_VERIFIED: " + walkingSummary)
        }
    }

    private func verifyAndSaveWeekendBusOption() throws {
        let busFilter = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH %@ AND label ENDSWITH %@", "버스 ", " 경로 필터"
        )).firstMatch
        try require(busFilter.waitForExistence(timeout: 45) && busFilter.isEnabled,
                    "The actual ODsay search must offer a selectable bus route")
        try tap(busFilter)
        let availableBus = app.staticTexts.matching(NSPredicate(
            format: "label MATCHES %@", ".*(?<![0-9])360(?![0-9]).*"
        )).firstMatch
        try require(availableBus.waitForExistence(timeout: 20), "Expected the 360 weekend bus in the route details")
        try require(!app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "8146")).firstMatch.exists,
                    "A weekday-only bus must not be offered on Sunday")
        try require(!app.buttons.matching(NSPredicate(format: "value CONTAINS %@", "시간표 기준")).firstMatch.exists,
                    "An unverified future bus must remain a duration estimate")
        capture("eta-odsay-weekend-bus-selection")
        let apply = labeled("이 경로를 일정에 적용")
        try reveal(apply)
        try tap(apply)
        try require(app.textFields["일정 제목"].waitForExistence(timeout: 15) &&
                    app.textFields["일정 제목"].value as? String == "ETA E2E real isolated fixture",
                    "Must return to the private schedule draft")
        try saveAndReopenPrivateScheduleEdit()
        capture("eta-odsay-weekend-bus-reopened")
        print("ETA_ODSAY_WEEKEND_BUS_SAVED_AND_REOPENED")
    }

    private func verifyAndSaveLiveBusOption() throws {
        let filter = app.buttons.matching(NSPredicate(
            format: "label BEGINSWITH %@ AND label ENDSWITH %@", "버스 ", " 경로 필터"
        )).firstMatch
        try require(filter.waitForExistence(timeout: 45) && filter.isEnabled,
                    "ODsay must offer a selectable bus route")
        try tap(filter)
        let timing = app.buttons.matching(NSPredicate(
            format: "value CONTAINS %@ AND value CONTAINS %@", "실시간 반영", "예상 도착"
        )).firstMatch
        try require(timing.waitForExistence(timeout: 35), "No qualifying live bus preview on the selected route")
        let label = try XCTUnwrap(timing.value as? String)
        let ride = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "하차 예측")).firstMatch
        try require(ride.exists, "The live route must show the boarding and alighting forecast")
        capture("eta-odsay-live-bus-selection")
        print("ETA_ODSAY_LIVE_BUS_SELECTION: " + label)
        let apply = labeled("이 경로를 일정에 적용")
        try reveal(apply)
        try tap(apply)
        try require(app.textFields["일정 제목"].waitForExistence(timeout: 15) &&
                    app.textFields["일정 제목"].value as? String == "ETA E2E real isolated fixture",
                    "Must return to the private schedule draft")
        try saveAndReopenPrivateScheduleEdit()
        capture("eta-odsay-live-bus-reopened")
        print("ETA_ODSAY_LIVE_BUS_SAVED_AND_REOPENED")
    }

    private func saveAndReopenPrivateScheduleEdit() throws {
        let commit = app.buttons["일정 수정 저장"]
        try require(commit.exists && !app.buttons["일정 저장"].exists, "Only the existing private schedule may be saved")
        try reveal(commit)
        try tap(commit)
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: commit)], timeout: 25) == .completed,
            "Save uncertain; inspect private persistence without another save")
        try openRealIsolatedDetail()
    }

    /// Separate H2 DB, real route/timetable/arrival feeds and wall clock. Not a two-minute accuracy proof.
    func testVerifyIsolatedRealProviderEta() throws {
        try require(environment["E2E_REAL_ISOLATED"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E real isolated fixture",
                    "Explicit actual-provider isolation is required")
        if environment["E2E_REAL_AUTOMATIC"] == "1" && app.buttons["알람 화면 닫기"].exists {
            // Real advance notices may fire while the three bounded automatic
            // evaluations run. Closing their presentation is a normal user
            // action, not cancellation of the future M0 reservation. Never
            // dismiss a departure alarm or count an old notice as its delivery.
            let departure = try XCTUnwrap(ISO8601DateFormatter().date(
                from: try XCTUnwrap(environment["E2E_REAL_DEPARTURE_AT"])))
            let heading = app.staticTexts["nolate-custom-alarm-schedule-title"].firstMatch
            try require(departure.timeIntervalSinceNow > 20 && heading.label == "출발 준비하세요" &&
                        app.buttons["경로 보기"].exists,
                        "Only a scoped advance presentation before the actual departure may be closed")
            capture("eta-automatic-advance-notice-before-detail")
            print("ETA_AUTOMATIC_ADVANCE_PRESENTATION_CLOSED_WITHOUT_CANCELING_M0: " +
                  ISO8601DateFormatter().string(from: Date()))
            try tap(app.buttons["알람 화면 닫기"])
            try require(!app.buttons["알람 끄기"].exists,
                        "The advance presentation must close without replaying or canceling alarm state")
        }
        try openRealIsolatedDetail()
        // 이전 검증 회차가 펼친 시트 상태를 보존할 수 있다. 같은 요약 상태에서 새 값을 비교한다.
        try collapseRealRouteSheetIfExpanded()
        let departure = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_CLOCK"])
        let arrival = try XCTUnwrap(environment["E2E_REAL_ARRIVAL_CLOCK"])
        let minutes = try XCTUnwrap(environment["E2E_REAL_MINUTES"])
        let summary = app.buttons.matching(NSPredicate(format:
            "label BEGINSWITH %@ AND label CONTAINS %@", "일정 상세 시트 펼치기, 권장 출발 " + departure, "현재 보정 여정")).firstMatch
        try require(summary.waitForExistence(timeout: 20) && summary.isHittable && app.frame.contains(summary.frame),
                    "Fresh real-provider ETA is not visible")
        try require(summary.label.contains("현재 이동 " + minutes + "분") && summary.label.contains(arrival + " 도착"),
                    "Visible clocks/duration differ from the actual Worker")
        try verifyRideIntervals(in: summary.label)
        try require(!summary.label.contains("미지원") && !summary.label.contains("미확인") && !summary.label.contains("환승 불가"),
                    "A rejected ETA must not look accepted")
        let rideData = try XCTUnwrap(environment["E2E_REAL_RIDE_TEXT"]?.data(using: .utf8))
        let rides = try XCTUnwrap(try JSONSerialization.jsonObject(with: rideData) as? [String])
        try require(rides.count >= 2, "Expected first and transfer ride clocks")
        try verifyOrderedRideClocks(rides, in: summary.label)
        // 펼치면 요약 버튼이 사라진다. 검증한 문자열을 보관해 로그가 재조회 실패를 만들지 않게 한다.
        let verifiedSummary = summary.label
        try tap(summary)
        let guidance = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "현재 보정 여정,")).firstMatch
        try require(waitForVisibleRealRouteText(guidance), "Expanded actual-provider evidence must show the accepted route")
        try verifyOrderedRideClocks(rides, in: guidance.label)
        let walkData = try XCTUnwrap(environment["E2E_REAL_WALK_TEXT"]?.data(using: .utf8))
        let walking = try XCTUnwrap(try JSONSerialization.jsonObject(with: walkData) as? [[String]])
        try require(walking.allSatisfy { tokens in (2...3).contains(tokens.count) &&
                    tokens.allSatisfy { guidance.label.contains($0) } },
                    "Expanded itinerary must preserve provider walking scopes, meters and verified seconds")
        if let railData = environment["E2E_REAL_MATCHED_RAIL"]?.data(using: .utf8) {
            try verifyRealRideRail(railData)
            print("ETA_REAL_ODSay_MATCHED_RAIL_VERIFIED")
        }
        capture("eta-real-isolated-accepted")
        print("ETA_REAL_ISOLATED_UI_VERIFIED: " + verifiedSummary)
        if environment["E2E_REAL_AUTOMATIC"] == "1" {
            // A pre-mounted detail overlay can cover the subsequent internal
            // observation route. Close it through the normal visible Back
            // action before the runner sends that deep link. No alarm sync.
            try tap(app.buttons["이전 화면으로 돌아가기"])
            try require(app.buttons["일정 추가"].waitForExistence(timeout: 10),
                        "Close the detail overlay before native observation")
        }
    }

    /// A real same-train observation after departure is a provisional arrival, never a new departure ETA.
    func testVerifyIsolatedRealProviderPlannedArrival() throws {
        try verifyIsolatedRealProviderPlannedArrival("same-train")
    }

    /// Without a qualifying same-train delay, the original plan stays provisional and the departure remains frozen.
    func testVerifyIsolatedRealProviderPlannedFallback() throws {
        try verifyIsolatedRealProviderPlannedArrival("fallback")
    }

    func testVerifyIsolatedRealProviderPlannedTimingFailure() throws {
        try require(environment["E2E_REAL_ISOLATED"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E real isolated fixture",
                    "Only inspect the scoped real-provider schedule")
        let reason = try XCTUnwrap(environment["E2E_REAL_TIMING_FAILURE"])
        let departure = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_CLOCK"])
        let warning = reason == "EARLY_BOARDING_UNCONFIRMED" ? "승차 시각을 확인하고 있어요" : "환승 시각을 확인하고 있어요"
        try openRealIsolatedDetail(allowElapsedAutomaticAlarmRoute: true)
        try collapseRealRouteSheetIfExpanded()
        let summary = app.buttons.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS %@",
                                                         "schedule-route-compact-summary", warning)).firstMatch
        try require(summary.waitForExistence(timeout: 15) && summary.label.contains("기존 출발 안내 " + departure) &&
                    !summary.label.contains("도착 예상"),
                    "Verify frozen departure and withheld arrival in the compact route sheet")
        try tap(summary)
        let details = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "계획 경로 재확인 필요,")).firstMatch
        try revealRouteElement(details)
        try require(details.exists && details.isHittable && details.label.contains(warning) &&
                    details.label.contains("출발 알림 시각은 바뀌지 않아요") && !details.label.contains("도착 예상"),
                    "The expanded route must explain the same unresolved timing")
        capture("eta-real-isolated-planned-timing-warning")
    }

    private func verifyIsolatedRealProviderPlannedArrival(_ kind: String) throws {
        try require(environment["E2E_REAL_ISOLATED"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E real isolated fixture",
                    "Only the scoped real-provider H2 schedule is allowed")
        try openRealIsolatedDetail(allowElapsedAutomaticAlarmRoute: true)
        let departure = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_CLOCK"])
        let arrival = try XCTUnwrap(environment["E2E_REAL_PROVISIONAL_CLOCK"])
        let plannedBus = environment["E2E_REAL_PROVISIONAL_BUS"]
        if plannedBus != nil { try collapseRealRouteSheetIfExpanded() }
        let summary = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "계획 경로 기준 · 잠정 도착")).firstMatch
        let summaryVisible = summary.waitForExistence(timeout: 20) && summary.isHittable
        if plannedBus != nil { try require(summaryVisible, "Verify the preserved departure on the mixed-route summary") }
        if summaryVisible {
            try require(summary.label.contains("기존 출발 안내 " + departure) &&
                        summary.label.contains(arrival + " 도착 예상") &&
                        !summary.label.contains("현재 보정 여정"),
                        "A provisional arrival must not replace the frozen departure guidance")
            try tap(summary)
        }
        let guidance = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "계획 경로 기준 · 잠정 도착,")).firstMatch
        try revealRouteElement(guidance)
        try require(guidance.exists && guidance.isHittable &&
                    guidance.label.contains(arrival + " 도착 예상") &&
                    guidance.label.contains("실제 탑승·환승 여부는 확인하지 못했어요") &&
                    guidance.label.contains("출발 알림 시각은 바뀌지 않아요"),
                    "The installed app must label the observed arrival as provisional")
        let steps = guidance.label.components(separatedBy: "  →  ")
        if let plannedBus {
            try require(steps.contains(where: { $0.contains(plannedBus) }),
                        "The same bus stop clocks and forecast labels must be visible in one route step")
            if let walkingLabel = environment["E2E_REAL_MIXED_WALK"] {
                try require(steps.contains(where: { $0.contains(walkingLabel) }), "Show transfer walking separately")
            }
            try verifyRideIntervals(in: guidance.label)
        }
        if let encoded = environment["E2E_REAL_PROVISIONAL_RIDES"], let data = encoded.data(using: .utf8) {
            let rides = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [[String: String]])
            try require(!rides.isEmpty, "Refreshed route must contain independently expected rides")
            for (index, ride) in rides.enumerated() {
                let rowIdentifier = try XCTUnwrap(ride["rowIdentifier"])
                let train = try XCTUnwrap(ride["train"])
                let boardSeconds = try XCTUnwrap(ride["boardSeconds"])
                let alightSeconds = try XCTUnwrap(ride["alightSeconds"])
                let board = try XCTUnwrap(ride["board"])
                let alight = try XCTUnwrap(ride["alight"])
                let alightingLabel = ride["alightingLabel"] ?? "예상 하차"
                let firstWait = index == 0 ? environment["E2E_REAL_FIRST_WAIT"] : nil
                if index == 0 && plannedBus == nil { try verifyRideIntervals(in: guidance.label) }
                try require(guidance.label.contains(train + "열차") &&
                            guidance.label.contains(boardSeconds) && guidance.label.contains(alightSeconds),
                            "Real route card must show each Worker's updated train and clocks")
                if alightingLabel == "하차역 도착 보고" {
                    try require(guidance.label.contains(alightSeconds + " " + alightingLabel),
                                "A past station report must keep its own label and exact source clock")
                }
                if let plannedBus {
                    let trainPosition = try XCTUnwrap(steps.firstIndex { step in
                        step.contains(train + "열차") && step.contains(boardSeconds) && step.contains(alightSeconds)
                    })
                    let busPosition = try XCTUnwrap(steps.firstIndex { $0.contains(plannedBus) })
                    let busFirst = environment["E2E_REAL_MIXED_ORDER"] == "bus-rail"
                    try require(busFirst ? busPosition < trainPosition : trainPosition < busPosition,
                                "Preserve the planned train and bus order")
                    continue
                }
                let row = app.descendants(matching: .any)[rowIdentifier].firstMatch
                try revealRouteElement(row)
                if let firstWait {
                    try require(row.label.contains(firstWait), "The saved rail must show the same first boarding interval")
                }
                try require(row.label.contains(board) && row.label.contains(alight + " " + alightingLabel) &&
                            row.label.contains("계획 경로의 잠정 시각 기준"),
                            "Real route rail must match the updated API itinerary")
            }
        }
        capture("eta-real-isolated-planned-" + kind)
        print("ETA_REAL_ISOLATED_PROVISIONAL_\(kind.uppercased())_UI_VERIFIED: " + guidance.label)
    }

    /// Select the saved fixture's actual date, including a target after midnight.
    /// This only opens existing data; it never saves or changes a schedule/calendar style.
    private func openRealIsolatedDetail(allowElapsedAutomaticAlarmRoute: Bool = false) throws {
        if allowElapsedAutomaticAlarmRoute && environment["E2E_REAL_AUTOMATIC"] == "1" &&
            app.buttons["알람 화면 닫기"].exists {
            // This post-departure cadence test is not an OS-delivery test. Follow
            // the scoped alarm's normal read-only Route action; never press
            // Complete Departure/Stop or hide an unexpected alarm.
            try require(environment["E2E_REAL_ISOLATED"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                        environment["E2E_EXISTING_TITLE"] == "ETA E2E real isolated fixture",
                        "Only the private elapsed alarm may open its saved route")
            let rawDeparture = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_AT"])
            let formatter = ISO8601DateFormatter()
            var parsedDeparture = formatter.date(from: rawDeparture)
            if parsedDeparture == nil {
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                parsedDeparture = formatter.date(from: rawDeparture)
            }
            let departure = try XCTUnwrap(parsedDeparture)
            let heading = app.staticTexts["nolate-custom-alarm-schedule-title"].firstMatch
            let route = app.buttons["경로 보기"]
            try require(departure < Date() && heading.label == "ETA E2E real isolated fixture" && route.isHittable,
                        "Do not navigate another fixture or an untriggered alarm")
            capture("eta-cadence-elapsed-alarm-before-route")
            try tap(route)
            print("ETA_CADENCE_ELAPSED_ALARM_ROUTE_ACTION_WITHOUT_DEPARTURE_COMPLETION")
        }
        // The real deep link can expose the pre-mounted calendar before its detail toolbar.
        // Wait for the requested destination before touching any underlying calendar control.
        let linkedDetail = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.staticTexts["ETA E2E real isolated fixture"].firstMatch.exists &&
                self.app.buttons["일정 수정"].exists
        }, object: nil)
        if XCTWaiter.wait(for: [linkedDetail], timeout: 10) == .completed {
            return
        }
        let calendarAddButton = app.buttons["일정 추가"]
        if app.buttons["일정 수정"].exists {
            try require(app.staticTexts["ETA E2E real isolated fixture"].firstMatch.exists, "Unexpected detail")
            try tap(app.buttons["이전 화면으로 돌아가기"])
            try require(calendarAddButton.waitForExistence(timeout: 12), "Calendar did not return after closing the fixture")
        }
        if calendarAddButton.exists {
            let card = buttonBeginning("ETA E2E real isolated fixture,")
            if !card.exists {
                let target = try configuration().target
                let parts = seoulCalendar.dateComponents([.year, .month, .day], from: target)
                let month = String(format: "%04d-%02d", parts.year!, parts.month!)
                let date = String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
                let detailed = app.buttons["detail-month-cell-" + month + "-" + date]
                let stacked = app.buttons["calendar-day-" + date]
                try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    detailed.exists || stacked.exists
                }, object: nil)], timeout: 10) == .completed, "Fixture target day is not visible")
                try tap(detailed.exists ? detailed : stacked)
            }
            try require(card.waitForExistence(timeout: 20), "Fixture is absent from its saved target day")
            // The day view may open below a midnight event. Reveal it in the direction of its actual frame.
            let timeline = app.scrollViews.containing(.button, identifier: "day-timeline-event-card").firstMatch
            let scrollArea: XCUIElement = timeline.exists ? timeline : app
            let visibleBounds = scrollArea.frame.insetBy(dx: 2, dy: 8)
            for _ in 0..<8 {
                if card.isHittable && visibleBounds.contains(card.frame) { break }
                // A default fling jumps across this short day timeline and oscillates
                // between clipping the card above and below its viewport. Move only
                // the observed distance toward its center, then release without inertia.
                let distance = visibleBounds.midY - card.frame.midY
                let limit = scrollArea.frame.height * 0.3
                let translation = max(-limit, min(limit, distance))
                let start = scrollArea.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                let end = start.withOffset(CGVector(dx: 0, dy: translation))
                start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow,
                            thenHoldForDuration: 0.2)
            }
            try require(card.isHittable && visibleBounds.contains(card.frame),
                        "The fixture card remains outside the visible calendar")
            try tap(card)
        }
        let title = app.staticTexts["ETA E2E real isolated fixture"].firstMatch
        let edit = app.buttons["일정 수정"]
        // The title can appear while the detail toolbar is still rendering.
        let detailReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            title.exists && edit.exists
        }, object: nil)
        try require(XCTWaiter.wait(for: [detailReady], timeout: 20) == .completed,
                    "The real-isolated detail did not open")
    }

    private func collapseRealRouteSheetIfExpanded() throws {
        let handle = app.buttons["schedule-route-sheet-handle"]
        if handle.exists && handle.value as? String == "expanded" {
            try tap(handle)
        }
    }

    private func waitForVisibleRealRouteText(_ element: XCUIElement) -> Bool {
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard element.exists else { return false }
            let frame = element.frame
            let sheetHandle = self.app.buttons["schedule-route-sheet-handle"]
            return frame.height > 0 && sheetHandle.exists && frame.midY > sheetHandle.frame.maxY &&
                self.app.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
        }, object: nil)
        return XCTWaiter.wait(for: [visible], timeout: 10) == .completed
    }

    /// Actual rejected ODsay Worker result; this proves diagnostic delivery, not accepted ETA.
    func testVerifyIsolatedRealProviderDiagnostic() throws {
        try require(environment["E2E_REAL_ISOLATED"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E real isolated fixture",
                    "Explicit rejected real-provider isolation is required")
        try openRealIsolatedDetail()
        try collapseRealRouteSheetIfExpanded()
        let departure = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_CLOCK"])
        let summary = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@",
            "일정 상세 시트 펼치기, 예상 출발 " + departure)).firstMatch
        try require(summary.waitForExistence(timeout: 20) && summary.isHittable,
                    "Rejected ODsay ETA must retain the saved departure, not claim a live recommendation")
        let warning = try XCTUnwrap(environment["E2E_REAL_DIAGNOSTIC_WARNING"])
        let timetable = environment["E2E_REAL_FUTURE_SUMMARY"]
        try require((summary.label.contains(warning) || timetable.map { summary.label.contains($0) } == true) &&
                    !summary.label.contains("현재 보정 여정") &&
                    !summary.label.contains("첫 승차 실시간 반영"), "Rejected route must not look like successful realtime ETA")
        let verifiedSummary = summary.label
        if let excluded = environment["E2E_REAL_FUTURE_WITHHELD"] {
            try require(["DEPARTED_AT_EVALUATION", "ARRIVES_AFTER_TARGET"].contains(excluded),
                        "Only independently proven preview exclusions are allowed")
        }
        if environment["E2E_REAL_FUTURE_WITHHELD"] != nil ||
            environment["E2E_REAL_FORBID_FUTURE_PREVIEW"] == "1" {
            try require(!verifiedSummary.contains("도착 예상 · 시간표 기준"),
                        "A departed or late timetable preview must remain hidden")
            try tap(summary)
            let expired = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", "도착 예상 · 시간표 기준")).firstMatch
            try require(!expired.exists, "Expanded sheet must not resurrect an ineligible timetable preview")
        }
        if let futureSummary = timetable {
            let departureText = try XCTUnwrap(environment["E2E_REAL_FUTURE_DEPARTURE_AT"])
            let departure = try XCTUnwrap(ISO8601DateFormatter().date(from: departureText))
            if !summary.label.contains(futureSummary) && Date() > departure {
                // Xcode 기동 중 미래 출발이 지나면 공개 API가 예측을 숨긴다.
                // 실제 API read-window도 사후 감사하므로 시각 불일치를 임의 허용하지 않는다.
                try require(!summary.label.contains("도착 예상 · 시간표 기준"),
                            "Expired preview must be absent")
                capture("eta-real-timetable-expired-during-ui-launch")
                print("ETA_REAL_DIAGNOSTIC_UI_VERIFIED: " + verifiedSummary)
                return
            }
            try require(summary.label.contains(futureSummary) && !summary.label.contains("열차 · 시간표 ·"),
                        "The summary must show the Worker arrival only once, rounded to minutes")
            try tap(summary)
            let arrival = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", futureSummary)).firstMatch
            try require(waitForVisibleRealRouteText(arrival),
                        "Expanded sheet must label the timetable arrival")
            if let data = environment["E2E_REAL_FUTURE_RAIL"]?.data(using: .utf8) {
                try verifyRealRideRail(data)
                print("ETA_REAL_FUTURE_TIMETABLE_RAIL_VERIFIED")
            }
        }
        capture("eta-real-odsay-diagnostic")
        print("ETA_REAL_DIAGNOSTIC_UI_VERIFIED: " + verifiedSummary)
    }

    private func verifyRideIntervals(in label: String) throws {
        if let wait = environment["E2E_REAL_FIRST_WAIT"] {
            let ride = try XCTUnwrap(environment["E2E_REAL_FIRST_RIDE"])
            try require(label.contains(wait + " · " + ride),
                        "The first wait and station-to-station duration must agree with the Worker clocks")
        }
        if let value = environment["E2E_REAL_TRANSFER_INTERVALS"] {
            let expected = try JSONDecoder().decode([String].self, from: Data(value.utf8))
            for transfer in expected {
                try require(label.contains(transfer), "Transfer wait and ride duration must match the accepted route: " + transfer)
            }
        }
    }

    private func verifyOrderedRideClocks(_ rides: [String], in label: String) throws {
        var remaining = label[...]
        for ride in rides {
            let match = try XCTUnwrap(remaining.range(of: ride), "Missing or out-of-order ride clocks: " + ride)
            remaining = remaining[match.upperBound...]
        }
    }

    private func verifyRealRideRail(_ data: Data) throws {
        let rows = try JSONDecoder().decode([[String]].self, from: data)
        try require(!rows.isEmpty, "Expected at least one ride in the timetable")
        for (index, fields) in rows.enumerated() {
            try require(fields.count == 3, "Expected a saved row identifier and two ride clocks")
            let row = app.descendants(matching: .any)[fields[0]].firstMatch
            if index == 0, let wait = environment["E2E_REAL_FIRST_WAIT"] {
                try require(row.label.contains(wait), "The saved first ride must show the same wait as the card")
            }
            try require(row.exists && row.label.contains(fields[1]) && row.label.contains(fields[2] + " 예상 하차"),
                        "Saved ride row does not match the Worker timetable for " + fields[0] + ": " + row.label)
        }
    }

    /// A once-accepted real observation expires without another provider call or a forged Worker failure.
    func testVerifyIsolatedRealProviderObservationExpiry() throws {
        try require(environment["E2E_REAL_OBSERVATION_EXPIRY"] == "1",
                    "Explicit wall-clock observation expiry verification is required")
        try testVerifyIsolatedRealProviderDiagnostic()
        print("ETA_REAL_OBSERVATION_EXPIRY_UI_VERIFIED: protected-clock-without-expired-live-route")
    }

    /// Actual app UI with synthetic quota faults. Does not prove live API or accuracy.
    func testVerifyIsolatedQuotaEta() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E isolated fixture",
                    "Quota verification is private H2 only")
        let accepted = environment["E2E_QUOTA_ACCEPTED"] == "1"
        let clock = try XCTUnwrap(environment["E2E_QUOTA_DEPARTURE_CLOCK"])
        if app.buttons["알람 화면 닫기"].exists {
            // M-5 may arrive between navigation-reset and this test. Dismiss
            // only the scoped preparation presentation, never Stop/Depart or
            // the actual M0 alarm; the future OS reservation stays unchanged.
            let departure = try XCTUnwrap(ISO8601DateFormatter().date(
                from: try XCTUnwrap(environment["E2E_QUOTA_DEPARTURE_AT"])))
            let heading = app.staticTexts["nolate-custom-alarm-schedule-title"].firstMatch
            try require(departure.timeIntervalSinceNow > 20 && heading.label == "출발 준비하세요" &&
                        app.buttons["경로 보기"].exists,
                        "Only the private future-departure preparation presentation may be closed")
            capture("eta-quota-advance-notice-before-detail")
            try tap(app.buttons["알람 화면 닫기"])
            print("ETA_QUOTA_ADVANCE_PRESENTATION_CLOSED_WITHOUT_CANCELING_M0")
        }
        try require(app.staticTexts["ETA E2E isolated fixture"].firstMatch.waitForExistence(timeout: 20) &&
                    app.buttons["일정 수정"].exists, "Quota fixture detail did not open")
        let prefix = "일정 상세 시트 펼치기, " + (accepted ? "권장 출발 " : "예상 출발 ") + clock
        let summaries = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix))
        var visible: XCUIElement?
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            visible = summaries.allElementsBoundByIndex.first { $0.exists && $0.isHittable && $0.frame.height > 30 }
            return visible != nil
        }, object: nil)
        try require(XCTWaiter.wait(for: [expectation], timeout: 20) == .completed,
                    "Quota/recovery presentation or protected departure differs from the Worker")
        let label = try XCTUnwrap(visible).label
        if accepted {
            try require(label.contains("현재 보정 여정") && !label.contains("운행시각 미확인") &&
                        !label.contains("실시간 도착정보 없음"), "Recovery must restore accepted guidance")
            let firstBoarding = try XCTUnwrap(environment["E2E_RIDE_FIRST_BOARDING"])
            let firstAlighting = try XCTUnwrap(environment["E2E_RIDE_FIRST_ALIGHTING"])
            let transferBoarding = try XCTUnwrap(environment["E2E_RIDE_TRANSFER_BOARDING"])
            let transferAlighting = try XCTUnwrap(environment["E2E_RIDE_TRANSFER_ALIGHTING"])
            try require(label.contains("4012열차 · 첫 승차 실시간 반영 · \(firstBoarding) 승차역 열차 도착 예측 → \(firstAlighting) 하차 예측"),
                        "First ride must show the exact once-adjusted predicted clocks")
            try require(label.contains("2012열차 · 시간표 · \(transferBoarding) 승차 → \(transferAlighting) 하차 예측"),
                        "Future transfer must show timetable clocks, not first-train delay or realtime")
            try tap(try XCTUnwrap(visible))
            let guidance = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "현재 보정 여정,")).firstMatch
            try require(waitForVisibleRealRouteText(guidance) &&
                        guidance.label.contains("\(firstBoarding) 승차역 열차 도착 예측 → \(firstAlighting) 하차 예측") &&
                        guidance.label.contains("2012열차 · 시간표 · \(transferBoarding) 승차 → \(transferAlighting) 하차 예측"),
                        "Expanded journey must retain exact first and transfer ride clocks")
            print("ETA_RIDE_TIMING_SYNTHETIC_UI_VERIFIED: first-live-and-transfer-timetable")
            for text in ["접근 도보 · 출발지→노원역 · 약 1분 51초 · 128m",
                         "환승 도보 · 사당 · 약 4분 3초 · 205m",
                         "도착 도보 · 신림→도착지 · 약 2분 51초 · 126m",
                         "역 내부 이동 포함 범위는 확인되지 않았어요"] {
                try require(label.contains(text) && guidance.label.contains(text),
                            "WALK seconds/distance/unknown platform coverage must survive expanded UI")
            }
            print("ETA_WALK_BOUNDARY_SYNTHETIC_UI_VERIFIED: seconds-distance-unknown-platform")
        } else {
            let quality = environment["E2E_ARRIVAL_QUALITY_SCENARIO"] ?? ""
            let timetablePreview = ["quality-unobserved", "quality-departed", "quality-stale"].contains(quality)
            let warnings = ["quality-unverified": "차량 관측시각 검증 불가",
                            "quality-error": "도착정보 API 오류", "quality-timeout": "도착정보 API 응답 지연",
                            "quota-arrival": "도착정보 API 한도 초과"]
            if !timetablePreview, let warning = warnings[quality] {
                try require(label.contains(warning), "Arrival failure must retain its own diagnostic stage")
            }
            if timetablePreview {
                try require(label.contains("도착 예상 · 시간표 기준") && !label.contains("열차 · 시간표 ·") &&
                            !label.contains("첫 승차 실시간 반영"), "A timetable estimate must stay concise and distinct from live data")
                try tap(try XCTUnwrap(visible))
                let preview = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", "도착 예상 · 시간표 기준")).firstMatch
                try require(waitForVisibleRealRouteText(preview), "Expanded sheet must show the timetable arrival")
                print("ETA_FUTURE_TIMETABLE_SYNTHETIC_UI_VERIFIED: separate-preview-not-live")
            }
            try require((label.contains("저장 경로 기준") || timetablePreview) && !label.contains("현재 보정 여정"),
                        "Quota failure must not masquerade as realtime accepted guidance")
        }
        capture(accepted ? "eta-quota-recovered" : "eta-quota-protected")
        print("ETA_QUOTA_SYNTHETIC_UI_VERIFIED: " + (accepted ? "recovered" : "protected"))
    }

    /// Fixed feeds, private H2 backend, installed app. Never an actual accuracy proof.
    func testVerifyIsolatedEtaFixture() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E isolated fixture",
                    "Only the isolated fixture is authorized")
        let phase = try XCTUnwrap(environment["E2E_FIXTURE_PHASE"])
        try require(["success", "reconnect", "early-transfer", "dwell-transfer", "first-alighting-late", "onward-delay", "early-transfer-risk", "transfer-observed", "transfer-first-unobserved", "planned-postdeparture", "planned-alighting", "planned-first-alighting", "reported-boarding", "unknown", "missed", "recovered", "late"].contains(phase), "Unknown fixture phase")
        if app.buttons["알람 화면 닫기"].exists && app.buttons["경로 보기"].exists {
            try tap(app.buttons["알람 화면 닫기"])
        }
        // The runner re-enters through the real deep-link handler to refresh focus.
        // No token, response, or application store is injected into the app.
        // Keep the assertion on the visible detail rather than virtual calendar nodes.
        try require(app.staticTexts["ETA E2E isolated fixture"].firstMatch.waitForExistence(timeout: 20) &&
                    app.buttons["일정 수정"].exists, "Private fixture detail did not open")
        if ["planned-postdeparture", "planned-alighting", "planned-first-alighting", "reported-boarding"].contains(phase) {
            let clock = try XCTUnwrap(environment["E2E_FIXTURE_PROVISIONAL_CLOCK"])
            let departure = try XCTUnwrap(environment["E2E_FIXTURE_DEPARTURE_CLOCK"])
            let guidance = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "계획 경로 기준 · 잠정 도착,")).firstMatch
            let summary = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "계획 경로 기준 · 잠정 도착")).firstMatch
            if summary.exists && summary.isHittable {
                try require(summary.label.contains("기존 출발 안내 " + departure) && !summary.label.contains("현재 보정 여정"),
                            "A confirmed departure ETA was mixed into the compact provisional arrival")
                try tap(summary)
            }
            try revealRouteElement(guidance)
            try require(guidance.exists && guidance.isHittable &&
                        guidance.label.contains(clock + " 도착 예상") &&
                        guidance.label.contains("실제 탑승·환승 여부는 확인하지 못했어요") &&
                        guidance.label.contains("출발 알림 시각은 바뀌지 않아요"),
                        "Expanded route must explain provisional evidence and unchanged alarm")
            if phase == "planned-first-alighting" {
                let first = try XCTUnwrap(environment["E2E_FIXTURE_FIRST_RIDE_TEXT"])
                let onward = try XCTUnwrap(environment["E2E_FIXTURE_TRANSFER_RIDE_TEXT"])
                try require(guidance.label.contains(first) && guidance.label.contains(onward) &&
                            guidance.label.contains("환승 대기 약 5분 57초"),
                            "Provisional journey must show the directly observed first alighting and new connecting train")
                for leg in [1, 3] {
                    let board = try XCTUnwrap(environment["E2E_RAIL_BOARD_\(leg)"])
                    let alight = try XCTUnwrap(environment["E2E_RAIL_ALIGHT_\(leg)"])
                    let row = app.descendants(matching: .any)["route-step-row-leg-\(leg)"].firstMatch
                    try revealRouteElement(row)
                    try require(row.exists && row.label.contains(board) && row.label.contains(alight + " 예상 하차") &&
                                row.label.contains("계획 경로의 잠정 시각 기준"),
                                "Provisional rail must use the same updated ride clocks as the server and card")
                }
            }
            if phase == "reported-boarding" {
                let onward = try XCTUnwrap(environment["E2E_FIXTURE_TRANSFER_RIDE_TEXT"])
                try require(guidance.label.contains(onward) && !guidance.label.contains("2012열차"),
                            "Historical boarding must retain the observed vehicle instead of the old timetable vehicle")
                let board = try XCTUnwrap(environment["E2E_RAIL_BOARD_3"])
                let alight = try XCTUnwrap(environment["E2E_RAIL_ALIGHT_3"])
                let row = app.descendants(matching: .any)["route-step-row-leg-3"].firstMatch
                try revealRouteElement(row)
                try require(row.exists && row.label.contains(board) && row.label.contains(alight + " 예상 하차") &&
                            row.label.contains("열차 도착 관측") && row.label.contains("계획 경로의 잠정 시각 기준"),
                            "Rail clocks must distinguish historical station state from a current prediction")
            }
            capture("eta-isolated-planned-postdeparture")
            print("ETA_ISOLATED_PROVISIONAL_UI_VERIFIED: " + guidance.label)
            return
        }
        let accepted = ["success", "reconnect", "early-transfer", "dwell-transfer", "first-alighting-late", "onward-delay", "transfer-observed", "recovered"].contains(phase)
        let prefix = accepted ? "일정 상세 시트 펼치기, 권장 출발 " : "일정 상세 시트 펼치기, 예상 출발 "
        let warning = phase == "missed" ? "환승 불가" : phase == "late" ? "정시 도착 불가" : phase == "early-transfer-risk" ? "환승 가능 여부 미확인" : phase == "transfer-first-unobserved" ? "실시간 도착정보 없음" : nil
        let summaries = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix))
        var visible: XCUIElement?
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            visible = summaries.allElementsBoundByIndex.first {
                $0.exists && $0.isHittable && $0.frame.height > 30 && self.app.frame.contains($0.frame) &&
                (warning == nil || $0.label.contains(warning!))
            }
            return visible != nil
        }, object: nil)
        try require(XCTWaiter.wait(for: [expected], timeout: 20) == .completed,
                    "Visible fixture ETA does not match the calculated phase")
        let summary = try XCTUnwrap(visible)
        if phase == "early-transfer-risk" {
            let estimatedDeparture = try XCTUnwrap(environment["E2E_FIXTURE_DEPARTURE_CLOCK"])
            try require(summary.label.contains("예상 출발 " + estimatedDeparture),
                        "The displayed estimate must match the saved route clock provided by the API")
            try require(!summary.label.contains("환승 불가") && !summary.label.contains("현재 보정 여정"),
                        "An early station arrival is neither a confirmed miss nor a live departure plan")
            capture("eta-early-transfer-risk")
        }
        if accepted {
            try require(!summary.label.contains("미확인") && !summary.label.contains("미지원") &&
                        !summary.label.contains("환승 불가"), "Unverified route must not look accepted")
            // Verify independently expected values, not only the trust label.
            let departure = try XCTUnwrap(environment["E2E_FIXTURE_DEPARTURE_CLOCK"])
            let minutes = try XCTUnwrap(environment["E2E_FIXTURE_MINUTES"])
            try require(summary.label.contains("권장 출발 " + departure), "Displayed departure differs from fixture calculation")
            try require(summary.label.contains("현재 이동 " + minutes + "분"), "Displayed duration is still the stored estimate")
            if phase == "onward-delay" {
                let rideTexts = try ["E2E_FIXTURE_FIRST_RIDE_TEXT", "E2E_FIXTURE_TRANSFER_RIDE_TEXT", "E2E_FIXTURE_THIRD_RIDE_TEXT"]
                    .map { try XCTUnwrap(environment[$0]) }
                let arrival = try XCTUnwrap(environment["E2E_FIXTURE_ARRIVAL_CLOCK"])
                let walks = ["접근 도보 · 출발지→노원역 · 약 1분 51초", "환승 도보 · 사당 · 약 1분",
                             "환승 도보 · 신도림 · 약 1분", "도착 도보 · 영등포→도착지 · 약 2분 51초"]
                try require(rideTexts.allSatisfy { summary.label.contains($0) } &&
                            walks.allSatisfy { summary.label.contains($0) } && summary.label.contains(arrival + " 도착"),
                            "All three updated train clocks and preserved walks must reach the collapsed summary")
                capture("eta-isolated-onward-delay")
                print("ETA_ISOLATED_ONWARD_UI_VERIFIED: " + summary.label)
                try tap(summary)
                let guidance = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "현재 보정 여정,")).firstMatch
                try require(guidance.waitForExistence(timeout: 10), "Expanded three-ride guidance is absent")
                try reveal(guidance)
                try require(rideTexts.allSatisfy { guidance.label.contains($0) } &&
                            walks.allSatisfy { guidance.label.contains($0) } && guidance.label.contains("총 " + minutes + "분"),
                            "Expanded journey must use the same recalculated rides and walking durations")
                capture("eta-isolated-onward-delay-expanded")
                print("ETA_MOCK_FEEDS_NOT_REAL_WORLD_ACCURACY")
                return
            }
            // Independent synthetic timetable expectations: never rescale the saved 48/8-minute rides.
            let firstRide = environment["E2E_FIXTURE_FIRST_RIDE_MINUTES"] ??
                (phase == "transfer-observed" ? "7" : phase == "dwell-transfer" ? "21" : phase == "success" ? "22" : "25")
            let secondRide = phase == "dwell-transfer" ? "14" : phase == "transfer-observed" ? "12" : ["success", "early-transfer"].contains(phase) ? "11" : "13"
            let onwardTiming = environment["E2E_FIXTURE_TRANSFER_WAIT"] ?? "약 " + secondRide + "분"
            let firstTiming = environment["E2E_FIXTURE_FIRST_INTERVALS"] ?? "약 " + firstRide + "분"
            if environment["E2E_FIXTURE_FIRST_INTERVALS"] != nil {
                try require(environment["E2E_FIXTURE_FIRST_INCLUSIVE_MINUTES"] == firstRide,
                            "The split first wait and ride must still equal the independent fixture duration")
            }
            try require(summary.label.contains("현재 보정 여정") &&
                        summary.label.contains("수도권 4호선 · 노원역→사당 · " + firstTiming) &&
                        summary.label.contains("수도권 2호선 · 사당→신림 · " + onwardTiming) &&
                        summary.label.contains("접근 도보 · 출발지→노원역 · 약 1분 51초") &&
                        summary.label.contains("환승 도보 · 사당 · 약 4분 3초") &&
                        summary.label.contains("도착 도보 · 신림→도착지 · 약 2분 51초"),
                        "Current journey segments still show the saved estimate or omit walking")
            try require(!summary.label.contains("약 48분") && !summary.label.contains("약 49분"),
                        "Saved first ride leaked into current timing")
            if ["dwell-transfer", "first-alighting-late"].contains(phase) {
                let transferRide = try XCTUnwrap(environment["E2E_FIXTURE_TRANSFER_RIDE_TEXT"])
                let arrival = try XCTUnwrap(environment["E2E_FIXTURE_ARRIVAL_CLOCK"])
                try require(summary.label.contains(transferRide) && summary.label.contains(arrival + " 도착"),
                            "Schedule must show the later transfer and recalculated destination arrival")
            }
            if ["early-transfer", "first-alighting-late"].contains(phase) {
                let firstRideText = try XCTUnwrap(environment["E2E_FIXTURE_FIRST_RIDE_TEXT"])
                try require(summary.label.contains(firstRideText),
                            "The first train clocks computed using scheduled station arrival must be visible")
            }
            try require(summary.label.contains("도착 도보는 총시간에 포함돼요") &&
                        summary.label.contains("역 내부 이동 포함 범위는 확인되지 않았어요"),
                        "Egress inclusion must not imply verified station-interior coverage")
        } else {
            try require(!summary.label.contains("현재 보정 여정"), "Unverified journey must not be presented as current accepted guidance")
        }
        capture("eta-isolated-" + phase)
        print("ETA_ISOLATED_UI_VERIFIED: " + phase + ": " + summary.label)
        if accepted {
            try tap(summary)
            // The card is intentionally one accessible group, not separate StaticText nodes.
            let guidance = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "현재 보정 여정,")).firstMatch
            try require(guidance.waitForExistence(timeout: 10), "Expanded current journey card is absent")
            if phase != "transfer-observed" { try reveal(guidance) }
            let minutes = try XCTUnwrap(environment["E2E_FIXTURE_MINUTES"])
            try require(guidance.label.contains("총 " + minutes + "분"), "Expanded journey total differs from current ETA")
            try require(guidance.label.contains("접근 도보 · 출발지→노원역 · 약 1분 51초") &&
                        guidance.label.contains("환승 도보 · 사당 · 약 4분 3초") &&
                        guidance.label.contains("도착 도보 · 신림→도착지 · 약 2분 51초"),
                        "Expanded journey must retain walking scopes and original seconds")
            try require(guidance.label.contains("지도에는 저장한 경로가 표시돼요"),
                        "Saved map must be explicitly distinguished from corrected guidance")
            if phase == "transfer-observed" {
                try require(guidance.label.contains("4012열차 · 첫 승차 실시간 반영") &&
                            guidance.label.contains("2012열차 · 환승역 실시간 반영") &&
                            guidance.label.components(separatedBy: "승차역 열차 도착 예측").count == 3,
                            "Both live clocks must identify their trains and describe station arrival")
                for leg in [1, 3] {
                    let board = try XCTUnwrap(environment["E2E_RAIL_BOARD_\(leg)"])
                    let alight = try XCTUnwrap(environment["E2E_RAIL_ALIGHT_\(leg)"])
                    let row = app.descendants(matching: .any)["route-step-row-leg-\(leg)"].firstMatch
                    try require(row.waitForExistence(timeout: 10) && row.label.contains(board + " 열차 도착 예측") &&
                                row.label.contains(alight + " 예상 하차") && row.label.contains("현재 보정 여정 기준"),
                                "Saved timeline must show the corrected boarding and alighting clocks for leg \(leg)")
                    try require(!row.label.contains("48분") && !row.label.contains("8분"),
                                "The saved train duration must not leak into the corrected rail")
                }
                let transfer = app.descendants(matching: .any)["route-step-row-leg-2"].firstMatch
                let precedingAlight = try XCTUnwrap(environment["E2E_RAIL_ALIGHT_1"])
                try require(transfer.exists && !transfer.label.contains(precedingAlight),
                            "Transfer walk must not repeat the preceding alighting clock")
            }
            try require(guidance.label.contains("도착 도보는 총시간에 포함돼요") &&
                        guidance.label.contains("역 내부 이동 포함 범위는 확인되지 않았어요"),
                        "Expanded guidance must explain egress inclusion and unknown coverage")
            capture("eta-isolated-" + phase + "-expanded-current-journey")
        }
        print("ETA_MOCK_FEEDS_NOT_REAL_WORLD_ACCURACY")
    }

    /// Save the specifically reviewed existing draft exactly once; never replay on an ambiguous result.
    func testCommitTransferEtaEdit() throws {
        try require(environment["E2E_ALLOW_SAVE"] == "1" && environment["E2E_SCHEDULE_ID"] == "363",
                    "Explicit final-save authorization for schedule 363 is required")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Unexpected title")
        let title = app.textFields["일정 제목"]
        try reveal(title, upward: false)
        try require(title.value as? String == configuration.title, "Reviewed title changed")
        try require(app.buttons[configuration.day].exists && app.buttons["시작 시간 " + configuration.clock].exists,
                    "Reviewed date/time changed")
        try require(app.switches["종일 일정"].value as? String == "0", "Must remain a timed schedule")
        let summary = buttonBeginning("이동 경로 수정, ")
        try require(summary.label.contains("노원역") && summary.label.contains("신림역"), "Reviewed route changed")
        try require(app.switches["출발 알림 사용"].value as? String == "1", "Departure notification was disabled")
        let save = app.buttons["일정 수정 저장"]
        try require(save.exists && !app.buttons["일정 저장"].exists, "Only the existing schedule may be saved")
        try reveal(save)
        capture("eta-transfer-before-final-edit-save")
        try tap(save)
        let dismissed = NSPredicate(format: "exists == false")
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: dismissed, object: save)], timeout: 30) == .completed,
                    "Save outcome uncertain; use read-only DB verification before any further action")
        capture("eta-transfer-after-edit-save")
        print("ETA_TRANSFER_EDIT_SUBMITTED_ONCE: verify persistence and history separately")
    }

    /// Verify an already-saved schedule without creating or modifying any schedule.
    /// A failed post-save assertion must use this test, never retry the commit test.
    func testVerifyIncidentCalendarDeparture() throws {
        let config = try configuration()
        try require(config.title == "ETA E2E calendar 1" && app.buttons["일정 추가"].waitForExistence(timeout: 20),
                    "Expected the isolated calendar")
        let parts = seoulCalendar.dateComponents([.year, .month, .day], from: config.target)
        let month = String(format: "%04d-%02d", parts.year!, parts.month!)
        let day = String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
        let first = buttonBeginning("ETA E2E calendar 1,")
        if !first.exists {
            let detailed = app.buttons["detail-month-cell-" + month + "-" + day]
            let stacked = app.buttons["calendar-day-" + day]
            try require(detailed.exists || stacked.exists, "Isolated calendar date unavailable")
            try tap(detailed.exists ? detailed : stacked)
        }
        for (title, expected, rejected) in [
            ("ETA E2E calendar 1", "오전 8:55 출발", "오전 9:56 출발"),
            ("ETA E2E calendar 2", "오후 2:07 출발", "오후 5:35 출발"),
        ] {
            let card = buttonBeginning(title + ",")
            try require(card.waitForExistence(timeout: 20), "Missing scoped agenda card")
            try require(card.label.contains(expected) && !card.label.contains(rejected),
                        "Wrong departure on agenda: " + card.label)
        }
        capture("incident-calendar-corrected-departure")
        print("ETA_INCIDENT_CALENDAR_CORRECTED_BOTH_CASES")
    }

    func testVerifyIncidentStationBoard() throws {
        let config = try configuration()
        try require(config.title == "ETA E2E calendar 1", "Expected the isolated incident fixture")
        try require(app.buttons["일정 수정"].waitForExistence(timeout: 15), "Synthetic incident detail did not open")
        let summary = buttonBeginning("일정 상세 시트 펼치기,")
        if environment["E2E_EXPECT_TMAP_UNSUPPORTED"] == "1" {
            let fallback = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                summary.exists && summary.label.contains("예상 출발 08:55") &&
                    summary.label.contains("재조회 미지원 · 경로 재선택 필요")
            }, object: nil)
            try require(XCTWaiter.wait(for: [fallback], timeout: 20) == .completed,
                        "The saved Tmap route did not explain why the earlier departure was retained")
            print("ETA_INCIDENT_TMAP_REFRESH_UNSUPPORTED_UI_VERIFIED")
        }
        if summary.exists && summary.isHittable { try tap(summary) }
        let row = app.descendants(matching: .any)["route-step-row-incident-first-train"].firstMatch
        let toOido = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "오이도행"))
        let toSadang = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "사당행"))
        let toDanggogae = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "당고개행"))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            row.exists && ((row.label.contains("오이도행") && row.label.contains("사당행")) ||
                (toOido.firstMatch.exists && toSadang.firstMatch.exists))
        }, object: nil)
        try require(XCTWaiter.wait(for: [ready], timeout: 30) == .completed,
                    "The saved route did not render both distinct station arrivals")
        let grouped = row.label.contains("오이도행")
        try require((grouped ? row.label.components(separatedBy: "오이도행").count == 2 : toOido.count == 1) &&
                    !row.label.contains("당고개행") && !toDanggogae.firstMatch.exists,
                    "Station board showed a duplicate or opposite-direction train")
        let adjustedWait = (1...7).contains { minutes in
            grouped ? row.label.contains(", \(minutes)분 · 오이도행") : app.staticTexts["\(minutes)분"].exists
        }
        let delayed = grouped ? row.label.contains("갱신 지연") : app.staticTexts["갱신 지연"].exists
        let freshness = grouped ? row.label.contains("분 전 갱신") :
            app.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", "분 전 갱신")).firstMatch.exists
        try require(adjustedWait && delayed && freshness && !row.label.contains("방금 갱신"),
                    "Station board reused fresh-looking receipt time or the original wait")
        capture("incident-station-board-delayed-observation")
        print("ETA_INCIDENT_STATION_BOARD_UI_VERIFIED")
    }

    func testVerifyIsolatedBusArrivalReplay() throws {
        let fixture = try configuration()
        try require(fixture.title == "ETA E2E bus arrival replay", "Expected the isolated bus replay")
        try testVerifySavedEtaJourney()
        let summary = buttonBeginning("일정 상세 시트 펼치기,")
        if summary.exists && summary.isHittable { try tap(summary) }
        let row = app.descendants(matching: .any)["route-step-row-leg-0"].firstMatch
        let pending = app.staticTexts.matching(NSPredicate(format: "label == %@", "출발대기"))
        let approaching = app.staticTexts.matching(NSPredicate(format: "label == %@", "곧 도착"))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            row.exists && (row.label.contains("출발대기") || pending.firstMatch.exists) &&
                (row.label.contains("곧 도착") || approaching.firstMatch.exists)
        }, object: nil)
        try require(XCTWaiter.wait(for: [ready], timeout: 25) == .completed,
                    "The station board must show departure waiting and the approaching bus separately")
        // React Native exposes nested text accessibility nodes at the same rendered frame.
        let pendingFrames = Set(pending.allElementsBoundByIndex.map { NSCoder.string(for: $0.frame) })
        let approachingFrames = Set(approaching.allElementsBoundByIndex.map { NSCoder.string(for: $0.frame) })
        try require(pendingFrames.count <= 1 && approachingFrames.count <= 1 &&
                    row.label.components(separatedBy: "출발대기").count <= 2 &&
                    row.label.components(separatedBy: "곧 도착").count <= 2,
                    "Read each bus status once")
        capture("isolated-n37-station-board")
        print("ETA_N37_STATION_BOARD_UI_VERIFIED")
    }

    func testVerifySavedEtaJourney() throws {
        let configuration = try configuration()
        try require(!app.buttons["일정 저장"].exists && !app.buttons["일정 수정 저장"].exists,
                    "Verification requires the calendar/detail screen, not an unsaved draft")
        // The observed calendar style menu can cover the agenda after navigation.
        // Re-select its current style only; do not tap through the overlay onto a card.
        if app.buttons["상세형"].exists && app.buttons["상세형"].isHittable &&
            app.buttons["스택형"].exists && app.buttons["목록형"].exists {
            try tap(app.buttons["상세형"])
        }
        let detailTitle = app.staticTexts[configuration.title].firstMatch
        if !detailTitle.exists || !app.buttons["일정 수정"].exists {
            let components = seoulCalendar.dateComponents([.year, .month, .day], from: configuration.target)
            let monthKey = String(format: "%04d-%02d", components.year!, components.month!)
            let dateKey = String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
            // Exact month-cell identifier observed after the original save succeeded.
            let card = buttonBeginning(configuration.title)
            if !card.exists {
                // Stack mode has a different observed day identifier. Open the same
                // calendar date without changing the user's selected calendar style.
                let detailedDay = app.buttons["detail-month-cell-" + monthKey + "-" + dateKey]
                let stackedDay = app.buttons["calendar-day-" + dateKey]
                try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                    detailedDay.exists || stackedDay.exists
                }, object: nil)], timeout: 10) == .completed,
                            "The saved schedule's calendar day is not visible")
                let day = detailedDay.exists ? detailedDay : stackedDay
                try tap(day)
            }
            try require(card.waitForExistence(timeout: 20), "The saved schedule is absent from its own calendar day")
            // The current dedicated app can reopen in day-timeline mode after a reload.
            // Reveal only this exact synthetic event; never switch a user's calendar style.
            if card.identifier == "day-timeline-event-card" && !card.isHittable {
                try reveal(card)
            }
            capture("eta-verified-saved-calendar-card")
            if card.isHittable {
                try tap(card)
            } else {
                // On the inspected iOS 27 screen, XCTest marks this visibly rendered card
                // non-hittable alongside hidden SwiftUI menu items. Restrict the fallback
                // to this exact synthetic card and its current, fully visible frame.
                try rejectBlockingAlerts()
                try require(["selected-day-agenda-card", "day-timeline-event-card"].contains(card.identifier) &&
                            card.label.hasPrefix(configuration.title + ",") && card.isEnabled &&
                            card.frame.height > 30 && app.frame.contains(card.frame),
                            "Synthetic card is not visibly within the dedicated app")
                card.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
        }
        try require(detailTitle.waitForExistence(timeout: 15), "Saved detail title did not appear")
        capture("eta-verified-saved-schedule-detail")
        print("ETA_UI_SAVED_SCHEDULE_VERIFIED_WITHOUT_WRITES: " + configuration.title)
        print("ETA_SAVED_DETAIL_UI\n" + app.debugDescription)
    }

    /// Reopen the saved detail after the real worker records its unsupported TMAP evaluation.
    /// This verifies honest fallback presentation, not successful real-time ETA correction.
    func testVerifyTmapFallbackPresentation() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Unexpected synthetic title")
        try require(app.staticTexts[configuration.title].firstMatch.exists && app.buttons["일정 수정"].exists,
                    "Start on the scoped saved detail; never dismiss an unsaved draft")
        try tap(app.buttons["이전 화면으로 돌아가기"])
        try require(app.buttons["일정 추가"].waitForExistence(timeout: 15), "Calendar did not reopen")
        try testVerifySavedEtaJourney()
        let summary = buttonBeginning("일정 상세 시트 펼치기, 예상 출발 ")
        let expectedDeparture = configuration.target.addingTimeInterval(-65 * 60)
        let time = DateFormatter()
        time.timeZone = seoulCalendar.timeZone
        time.dateFormat = "HH:mm"
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            summary.exists && summary.label.contains("예상 출발 " + time.string(from: expectedDeparture)) &&
                summary.label.contains("재조회 미지원 · 경로 재선택 필요")
        }, object: nil)
        try require(XCTWaiter.wait(for: [expected], timeout: 20) == .completed,
                    "Latest unsupported evaluation must show estimated departure and its specific warning")
        try require(!summary.label.contains("권장 출발"), "Fallback must not be presented as verified ETA")
        capture("eta-tmap-fallback-history-presentation")
        print("ETA_TMAP_FALLBACK_PRESENTATION_VERIFIED: " + summary.label)
        print("ETA_TMAP_FALLBACK_UI\n" + app.debugDescription)
    }

    /// Observation-only safety check; requery/matching success requires independent BE evidence.
    /// Do not label this as timetable accuracy or full live-ETA validation.
    func testVerifyUnverifiedTransferPresentation() throws {
        try require(environment["E2E_SCHEDULE_ID"] == "363", "Only synthetic schedule 363 is in scope")
        let configuration = try configuration()
        try require(configuration.title == "ETA E2E 1004 transfer", "Unexpected synthetic title")
        try require(app.staticTexts[configuration.title].firstMatch.exists && app.buttons["일정 수정"].exists,
                    "Start on the saved synthetic detail; never dismiss an unsaved draft")
        try tap(app.buttons["이전 화면으로 돌아가기"])
        try require(app.buttons["일정 추가"].waitForExistence(timeout: 15), "Calendar did not reopen")
        try testVerifySavedEtaJourney()
        let summary = buttonBeginning("일정 상세 시트 펼치기, 예상 출발 ")
        let clock = DateFormatter()
        clock.timeZone = seoulCalendar.timeZone
        clock.dateFormat = "HH:mm"
        let expectedDeparture = clock.string(from: configuration.target.addingTimeInterval(-3888))
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            summary.exists && summary.label.contains("예상 출발 " + expectedDeparture) &&
                !summary.label.contains("운행시각 미확인")
        }, object: nil)
        try require(XCTWaiter.wait(for: [expected], timeout: 20) == .completed,
                    "Unverified route timing must remain explicitly estimated")
        try require(!summary.label.contains("권장 출발"), "Unverified timing must not be promoted to a recommendation")
        capture("eta-unverified-transfer-presentation")
        print("ETA_UNVERIFIED_PRESENTATION_VERIFIED: " + summary.label)
        print("ETA_MATCH_AND_FUTURE_ACCURACY_REQUIRE_SEPARATE_EVIDENCE")
    }

    /// Real-provider comparison input: no private fixture, no hard-coded duration.
    /// Preparation never submits a schedule; commit remains a separate, explicit step.
    func testPrepareNaverComparisonJourney() throws {
        let configuration = try configuration()
        try require(configuration.title.hasPrefix("ETA E2E NAVER "), "Synthetic comparison title required")
        if app.buttons["일정 수정"].exists {
            try require(!app.textFields["일정 제목"].exists, "Never discard an edit draft")
            try tap(app.buttons["이전 화면으로 돌아가기"])
        }
        try openOrResumeDraft()
        let title = app.textFields["일정 제목"]
        try replace(title, with: configuration.title)
        title.typeText("\n")
        let allDay = app.switches["종일 일정"]
        if allDay.value as? String == "1" { try tap(allDay) }
        try setStartTime(configuration.target, expectedClock: configuration.clock, expectedDay: configuration.day)
        let route = app.buttons["location-input-pressable"]
        let opener = route.exists ? route : labeled("출발지와 도착지 추가")
        try reveal(opener)
        try tap(opener)
        for (target, station, line) in [("출발지", "노원역", "4호선"), ("도착지", "신림역", "2호선")] {
            // Opening the route planner can asynchronously open the first search sheet.
            // Resolve the visible screen before choosing between input/reselect controls.
            try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                self.labeled("장소 검색 닫기").exists || self.app.textFields[target + " 검색"].exists ||
                    self.buttonBeginning(target + " 재선택, 현재 ").exists
            }, object: nil)], timeout: 15) == .completed, "Endpoint controls did not finish opening")
            if !labeled("장소 검색 닫기").exists {
                let input = app.textFields[target + " 검색"]
                // A resumed route draft exposes selected endpoints as reselect buttons.
                if input.exists { try tap(input) }
                else { try tap(buttonBeginning(target + " 재선택, 현재 ")) }
            }
            try require(labeled("장소 검색 닫기").waitForExistence(timeout: 10), "Place search missing")
            let field = app.textFields[target + " 검색"]
            try replace(field, with: station)
            // Exact public station/line labels were observed in the previous real search.
            let place = buttonBeginning(station + "[수도권" + line + "], ")
            try require(place.waitForExistence(timeout: 25), "Exact public station not returned")
            capture("eta-naver-" + target + "-station")
            try tap(place)
        }
        try tap(labeled("대중교통"))
        let candidate = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로")).firstMatch
        try require(candidate.waitForExistence(timeout: 45), "Real provider returned no transit route")
        if candidate.value as? String != "expanded" { try tap(candidate) }
        capture("eta-naver-real-provider-route")
        print("ETA_NAVER_ROUTE_SELECTION_UI\n" + app.debugDescription)
        try require(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "4호선 ")).firstMatch.exists &&
                    app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "2호선 ")).firstMatch.exists,
                    "Inspect a different route instead of accepting an unexpected line combination")
        try tap(labeled("이 경로 저장"))
        // Route navigation briefly retains the outgoing draft's AX nodes.
        // Wait for the actual matching draft before touching its notification switch.
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            title.exists && title.isHittable && title.value as? String == configuration.title &&
                !self.app.buttons["이 경로 저장"].isHittable
        }, object: nil)], timeout: 15) == .completed, "Route did not return to the matching draft")
        let summary = buttonBeginning("이동 경로 수정, ")
        try require(summary.label.contains("노원역") && summary.label.contains("신림역"), "Wrong endpoints")
        let enabled = app.switches["출발 알림"]
        try reveal(enabled)
        capture("eta-naver-notification-control-before-toggle")
        print("ETA_NAVER_NOTIFICATION_DRAFT_UI\n" + app.debugDescription)
        if enabled.value as? String != "1" { try tap(enabled) }
        try tap(labeled("푸시 알림 선택"))
        try require(enabled.value as? String == "1", "ETA monitoring must be enabled")
        capture("eta-naver-real-draft-before-save")
        print("ETA_NAVER_PREPARED_NOT_SAVED\n" + app.debugDescription)
    }

    /// Reopen the created detail through normal app navigation to fetch the latest Worker state.
    func testReopenNaverComparisonJourney() throws {
        let configuration = try configuration()
        try require(configuration.title.hasPrefix("ETA E2E NAVER "), "Synthetic comparison only")
        if app.buttons["일정 수정"].exists {
            try require(app.staticTexts[configuration.title].firstMatch.exists, "Wrong current detail")
            try tap(app.buttons["이전 화면으로 돌아가기"])
        }
        // Navigation animation briefly retains the outgoing detail's AX nodes.
        // Wait for their removal before deciding whether the saved card needs opening.
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.buttons["일정 추가"].exists && !self.app.buttons["일정 수정"].exists
        }, object: nil)], timeout: 15) == .completed, "Calendar navigation did not finish")
        try testVerifySavedEtaJourney()
        let diagnostic = buttonBeginning("일정 상세 시트 펼치기, 예상 출발 ")
        try require(diagnostic.waitForExistence(timeout: 15) && diagnostic.label.contains("재조회 미지원"),
                    "Expected the actual observed unsupported-provider diagnosis, not a live success")
        capture("eta-naver-real-latest-worker-diagnostic")
        print("ETA_NAVER_REAL_LATEST_DIAGNOSTIC: " + diagnostic.label)
    }

    /// Real UI verification requires an independently collected accepted Worker result.
    /// A refreshed-but-degraded timetable must not pass this realtime acceptance test.
    func testVerifyRealEtaDiagnostic() throws {
        let configuration = try configuration()
        let realScopes = ["ETA E2E NAVER 1007 02": "365", "ETA E2E NAVER 1007 03": "366", "ETA E2E NAVER 1007 04": "367"]
        try require(environment["E2E_REAL_ACCEPTED"] == "0" && realScopes[configuration.title] != nil &&
                    environment["E2E_REAL_SCHEDULE_ID"] == realScopes[configuration.title], "Real unaccepted comparison evidence required")
        try require(!app.textFields["일정 제목"].exists, "Never discard an unsaved draft")
        if app.buttons["일정 수정"].exists {
            try require(app.staticTexts[configuration.title].firstMatch.exists, "Wrong saved detail")
            try tap(app.buttons["이전 화면으로 돌아가기"])
        }
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.buttons["일정 추가"].exists && !self.app.buttons["일정 수정"].exists
        }, object: nil)], timeout: 15) == .completed, "Calendar did not reopen")
        try testVerifySavedEtaJourney()
        let departure = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_CLOCK"])
        let summary = buttonBeginning("일정 상세 시트 펼치기, 예상 출발 ")
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            summary.exists && summary.label.contains("예상 출발 " + departure) &&
                summary.label.contains("실시간 도착정보 없음 · 저장 경로 기준")
        }, object: nil)], timeout: 20) == .completed, "The actual unaccepted ETA diagnosis is not visible")
        try require(!summary.label.contains("권장 출발") && !summary.label.contains("재조회 미지원"),
                    "Requery support and realtime acceptance must remain distinct")
        capture("eta-real-unaccepted-requery-diagnostic-ui")
        print("ETA_REAL_DIAGNOSTIC_UI_ONLY_NOT_ACCEPTED_ETA: " + summary.label)
    }

    /// A verified live vehicle can still arrive too late; this must not pass on-time acceptance.
    func testVerifyRealLateEtaComparison() throws {
        let configuration = try configuration()
        let scopes = ["ETA E2E NAVER 1007 02": "365", "ETA E2E NAVER 1007 03": "366", "ETA E2E NAVER 1007 04": "367"]
        try require(environment["E2E_REAL_LATE"] == "1" && environment["E2E_REAL_ACCEPTED"] == "0" &&
                    scopes[configuration.title] != nil && environment["E2E_REAL_SCHEDULE_ID"] == scopes[configuration.title],
                    "Verified real late-vehicle evidence required")
        try require(!app.textFields["일정 제목"].exists, "Never discard an unsaved draft")
        if app.buttons["일정 수정"].exists {
            try require(app.staticTexts[configuration.title].firstMatch.exists, "Wrong saved detail")
            try tap(app.buttons["이전 화면으로 돌아가기"])
        }
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.buttons["일정 추가"].exists && !self.app.buttons["일정 수정"].exists
        }, object: nil)], timeout: 15) == .completed, "Calendar did not reopen")
        try testVerifySavedEtaJourney()
        let departure = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_CLOCK"])
        let summary = buttonBeginning("일정 상세 시트 펼치기, 예상 출발 ")
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            summary.exists && summary.label.contains("예상 출발 " + departure) &&
                summary.label.contains("현재 확인된 경로로 정시 도착 불가")
        }, object: nil)], timeout: 20) == .completed, "Actual late-arrival warning is missing")
        for warning in ["권장 출발", "재조회 미지원", "실시간 도착정보 없음"] {
            try require(!summary.label.contains(warning), "Real late arrival must be distinguished from missing realtime data")
        }
        capture("eta-real-live-late-warning-ui")
        print("ETA_REAL_LIVE_LATE_REJECTION_UI_NOT_ON_TIME_SUCCESS: " + summary.label)
    }

    /// Degraded data must not revert a protected earlier clock to the later saved estimate.
    func testVerifyProtectedRealEtaDiagnostic() throws {
        let configuration = try configuration()
        try require(environment["E2E_REAL_PROTECTED"] == "1" &&
                    environment["E2E_REAL_ACCEPTED"] == "0" && environment["E2E_REAL_SCHEDULE_ID"] == "367" &&
                    configuration.title == "ETA E2E NAVER 1007 04", "Exact real failure/protected-clock evidence required")
        try require(!app.textFields["일정 제목"].exists, "Never discard a draft")
        if app.buttons["일정 수정"].exists {
            try require(app.staticTexts[configuration.title].firstMatch.exists, "Wrong saved detail")
            try tap(app.buttons["이전 화면으로 돌아가기"])
        }
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.buttons["일정 추가"].exists && !self.app.buttons["일정 수정"].exists
        }, object: nil)], timeout: 15) == .completed, "Calendar did not reopen")
        try testVerifySavedEtaJourney()
        let clock = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_CLOCK"])
        let summary = buttonBeginning("일정 상세 시트 펼치기, 예상 출발 ")
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            summary.exists && summary.label.contains("예상 출발 " + clock) &&
                summary.label.contains("출발 시각 안전 유지") && summary.label.contains("재조회 미지원")
        }, object: nil)], timeout: 20) == .completed, "Failure incorrectly delayed the protected departure clock")
        try require(!summary.label.contains("권장 출발") && !summary.label.contains("현재 보정 여정"),
                    "Protected earlier clock is not a newly accepted realtime journey")
        capture("eta-real-failure-protected-earlier-clock")
        print("ETA_REAL_PROTECTED_CLOCK_DIAGNOSTIC_NOT_LIVE_SUCCESS: " + summary.label)
    }

    func testVerifyAcceptedRealEtaComparison() throws {
        let configuration = try configuration()
        let realScopes = ["ETA E2E NAVER 1007 02": "365", "ETA E2E NAVER 1007 03": "366", "ETA E2E NAVER 1007 04": "367"]
        try require(environment["E2E_REAL_ACCEPTED"] == "1" && realScopes[configuration.title] != nil &&
                    environment["E2E_REAL_SCHEDULE_ID"] == realScopes[configuration.title],
                    "Accepted real-provider evidence for the new synthetic comparison is required")
        let departure = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_CLOCK"])
        try require(!app.textFields["일정 제목"].exists, "Never discard an unsaved draft")
        if app.buttons["일정 수정"].exists {
            try require(app.staticTexts[configuration.title].firstMatch.exists, "Wrong saved detail")
            try tap(app.buttons["이전 화면으로 돌아가기"])
        }
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.buttons["일정 추가"].exists && !self.app.buttons["일정 수정"].exists
        }, object: nil)], timeout: 15) == .completed, "Calendar did not finish opening")
        try testVerifySavedEtaJourney()
        let summary = buttonBeginning("일정 상세 시트 펼치기, 권장 출발 ")
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            summary.exists && summary.label.contains("권장 출발 " + departure)
        }, object: nil)], timeout: 20) == .completed, "Accepted Worker departure is not displayed in the real app")
        for warning in ["재조회 미지원", "운행시각 미확인", "저장 경로 기준", "실시간 도착정보 없음"] {
            try require(!summary.label.contains(warning), "Degraded timing must never pass accepted realtime UI verification")
        }
        capture("eta-real-accepted-requery-ui")
        print("ETA_REAL_ACCEPTED_REQUERY_UI: " + summary.label)
    }

    /// Align only this newly created test schedule with Naver's ten-minute query grid.
    /// Preserve its actual station coordinates and selected provider route.
    func testRescheduleNaverComparisonJourney() throws {
        let configuration = try configuration()
        let scopes = ["ETA E2E NAVER 1007 01": "364", "ETA E2E NAVER 1007 04": "367"]
        try require(environment["E2E_ALLOW_SAVE"] == "1" && scopes[configuration.title] != nil &&
                    environment["E2E_SCHEDULE_ID"] == scopes[configuration.title] &&
                    environment["E2E_EXISTING_TITLE"] == configuration.title, "Exact synthetic comparison only")
        try require(
                    app.staticTexts[configuration.title].firstMatch.exists && app.buttons["일정 수정"].exists,
                    "Start on the exact newly created test detail")
        try tap(app.buttons["일정 수정"])
        let title = app.textFields["일정 제목"]
        try require(title.waitForExistence(timeout: 15) && title.value as? String == configuration.title, "Wrong editor")
        try setStartTime(configuration.target, expectedClock: configuration.clock, expectedDay: configuration.day)
        let route = buttonBeginning("이동 경로 수정, ")
        try require(route.exists && route.label.contains("노원역") && route.label.contains("신림역"), "Preserve route")
        try require(app.switches["출발 알림 사용"].value as? String == "1", "Preserve monitoring")
        let save = app.buttons["일정 수정 저장"]
        try reveal(save)
        capture("eta-naver-aligned-before-save")
        try tap(save)
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: save)], timeout: 30) == .completed,
            "Save uncertain: inspect persistence before retry")
        capture("eta-naver-aligned-saved")
        print("ETA_NAVER_ALIGNED_TARGET_SAVED_ONCE\n" + app.debugDescription)
    }

    func testCommitNaverComparisonJourney() throws {
        try require(environment["E2E_ALLOW_SAVE"] == "1", "Explicit final save required")
        let configuration = try configuration()
        try require(configuration.title.hasPrefix("ETA E2E NAVER "), "Synthetic comparison title required")
        let title = app.textFields["일정 제목"]
        try require(title.exists && title.value as? String == configuration.title, "Wrong prepared draft")
        try require(app.buttons[configuration.day].exists && app.buttons["시작 시간 " + configuration.clock].exists,
                    "Prepared target differs from requested target")
        let summary = buttonBeginning("이동 경로 수정, ")
        try require(summary.exists && summary.label.contains("노원역") && summary.label.contains("신림역"), "Wrong endpoints")
        try require(app.switches["출발 알림"].value as? String == "1", "Monitoring disabled")
        let save = app.buttons["일정 저장"]
        try require(save.exists && !app.buttons["일정 수정 저장"].exists, "New schedule only")
        try reveal(save)
        capture("eta-naver-real-final-save")
        try tap(save)
        try require(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: save)], timeout: 30) == .completed,
            "Save uncertain: inspect persistence before any retry")
        capture("eta-naver-real-created")
        print("ETA_NAVER_CREATED_ONCE\n" + app.debugDescription)
    }

    func testCommitPreparedEtaJourney() throws {
        try require(environment["E2E_ALLOW_SAVE"] == "1", "Final save requires E2E_ALLOW_SAVE=1")
        let configuration = try configuration()
        let title = app.textFields["일정 제목"]
        try require(title.exists && title.value as? String == configuration.title, "Prepared title does not match")
        try require(app.buttons[configuration.day].exists && app.buttons["시작 시간 " + configuration.clock].exists,
                    "Prepared target date/time does not match")
        try require(app.switches["종일 일정"].value as? String == "0", "Prepared schedule must not be all-day")
        let summary = buttonBeginning("이동 경로 수정, ")
        try require(summary.exists && summary.label.contains("강남역") && summary.label.contains("선릉역"),
                    "Prepared route endpoints do not match")
        // Duration/Line 2 were asserted in preparation and are visible in its screenshots.
        // This commit checks the exposed endpoint label; persisted route is checked afterward.
        try require(app.switches["출발 알림"].value as? String == "1", "Prepared departure notification is disabled")
        let save = app.buttons["일정 저장"]
        try require(save.exists && !app.buttons["일정 수정 저장"].exists, "This is not a new-schedule draft")
        try reveal(save)
        capture("eta-before-explicit-final-save")
        try tap(save)
        let card = buttonBeginning(configuration.title)
        try require(card.waitForExistence(timeout: 30), "Saved schedule card did not appear")
        capture("eta-saved-calendar-card")
        try tap(card)
        try require(app.staticTexts[configuration.title].waitForExistence(timeout: 15), "Saved detail title did not appear")
        capture("eta-saved-schedule-detail")
        print("ETA_UI_SAVE_CONFIRMED: " + configuration.title)
        print("ETA_ROUTE_VERIFICATION: exact duration/Line 2 from preparation evidence; verify the persisted route separately")
        print("ETA_SAVED_DETAIL_UI\n" + app.debugDescription)
    }
}

/// Opt-in public UI probes on the pinned device, never alarm-delivery evidence.
/// Settings inspection is read-only; launcher recovery only changes development navigation.
final class NoLatePinnedDeviceControlsTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["E2E_INSPECT_PINNED_SETTINGS"] == "1"
                          || environment["E2E_PRIVATE_LAUNCHER_RECOVERY"] == "1"
                          || environment["E2E_PINNED_PRIVATE_LIFECYCLE"] == "1"
                          || environment["E2E_PINNED_PUBLIC_SIRI_LOCK"] == "1"
                          || environment["E2E_INSPECT_PINNED_CONTROL_CENTER"] == "1")
        try XCTSkipUnless(environment["SIMULATOR_UDID"] == "9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69",
                          "Never inspect or operate Settings on another simulator")
    }

    func testInspectPublicSettingsControls() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["E2E_INSPECT_PINNED_SETTINGS"] == "1")
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.activate()
        defer {
            settings.terminate()
            XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe").activate()
        }
        XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 15))
        if ProcessInfo.processInfo.environment["E2E_INSPECT_ACCESSIBILITY_PAGE"] == "1" {
            // Observed public identifier on this pinned iOS 27 Settings screen.
            let accessibility = settings.buttons["com.apple.settings.accessibility"]
            XCTAssertTrue(accessibility.waitForExistence(timeout: 10))
            accessibility.tap()
        }
        let attachment = XCTAttachment(screenshot: settings.screenshot())
        attachment.name = "pinned-public-settings-controls"
        attachment.lifetime = .keepAlways
        add(attachment)
        print("ETA_PINNED_SETTINGS_READ_ONLY_UI\n" + settings.debugDescription)
    }

    /// Reproduce the SDK's real nil-onError reload path, without a network server.
    /// The caller must first confirm that the private development endpoints are offline.
    func testOfflineDevelopmentReloadRecoversWithoutCrash() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["E2E_PRIVATE_LAUNCHER_RECOVERY"] == "1")
        let app = XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe")
        app.activate()
        let heading = app.staticTexts["There was a problem loading the project."]
        let privateError = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@",
            "Failed to load app from http://127.0.0.1:8085")).firstMatch
        XCTAssertTrue(heading.waitForExistence(timeout: 15))
        XCTAssertTrue(privateError.exists, "Only the observed offline local-development failure may be reloaded")
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "private-launcher-offline-error-before-reload"
        before.lifetime = .keepAlways
        add(before)
        let reload = app.buttons["Reload"]
        XCTAssertTrue(reload.isHittable)
        reload.tap()
        XCTAssertTrue(app.staticTexts["Development Build"].waitForExistence(timeout: 30),
                      "A failed optional-callback reload must return to the launcher, not crash")
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertFalse(heading.exists)
        let after = XCTAttachment(screenshot: app.screenshot())
        after.name = "private-launcher-recovered-without-crash"
        after.lifetime = .keepAlways
        add(after)
        print("ETA_PRIVATE_LAUNCHER_NIL_CALLBACK_UI_RECOVERY_PASSED")
    }

    /// Public XCTest lifecycle transport, not a provider/ETA assertion.
    /// Only the private 8086 development client may be opened here.
    func testOpenPrivateDevelopmentClient() throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["E2E_PINNED_PRIVATE_LIFECYCLE"] == "1")
        let app = XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe")
        if app.state != .notRunning { app.terminate() }
        XCTAssertEqual(app.state, .notRunning)
        app.open(try XCTUnwrap(URL(string:
            "nolate://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8086")))
        XCTAssertEqual(app.state, .runningForeground)
        if environment["E2E_EXPECT_PRIVATE_ENDPOINT_OFFLINE"] == "1" {
            let localError = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@",
                "Failed to load app from http://127.0.0.1:8086")).firstMatch
            XCTAssertTrue(localError.waitForExistence(timeout: 30))
            print("ETA_PINNED_PRIVATE_LIFECYCLE_OFFLINE_ERROR_OBSERVED")
        }
        print("ETA_PINNED_PRIVATE_LIFECYCLE_URL_DISPATCHED")
    }

    func testRestoreDevelopmentClientEndpoint() throws {
        let environment = ProcessInfo.processInfo.environment
        try XCTSkipUnless(environment["E2E_PINNED_PRIVATE_LIFECYCLE"] == "1" &&
                          environment["E2E_RESTORE_DEVELOPMENT_ENDPOINT"] == "1")
        let app = XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe")
        // Stop the private client's pending loads before opening the original endpoint.
        if app.state != .notRunning { app.terminate() }
        XCTAssertEqual(app.state, .notRunning)
        app.open(try XCTUnwrap(URL(string:
            "nolate://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8085")))
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        print("ETA_PINNED_ORIGINAL_ENDPOINT_DISPATCHED")
    }

    func testInspectPublicControlCenter() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["E2E_INSPECT_PINNED_CONTROL_CENTER"] == "1")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCUIDevice.shared.press(.home)
        defer {
            XCUIDevice.shared.press(.home)
            XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe").activate()
        }
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.01))
            .press(forDuration: 0.1, thenDragTo:
                springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.6)))
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "pinned-public-control-center-controls"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        print("ETA_PINNED_CONTROL_CENTER_READ_ONLY_UI\n" + springboard.debugDescription)
    }

    /// Capability probe only. Uses the installed SDK's public Siri API, never
    /// private lock selectors, settings changes, permission grants or another device.
    func testPublicSiriLockCapability() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["E2E_PINNED_PUBLIC_SIRI_LOCK"] == "1")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCUIDevice.shared.press(.home)
        defer { XCUIDevice.shared.press(.home) }
        let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        before.name = "pinned-before-public-siri-request"
        before.lifetime = .keepAlways
        add(before)
        print("ETA_PINNED_BEFORE_PUBLIC_SIRI_UI\n" + springboard.debugDescription)
        XCTAssertTrue(springboard.otherElements["Home screen icons"].waitForExistence(timeout: 5) &&
                      springboard.alerts.count == 0,
                      "Begin on the observed pinned home screen, not an unknown system prompt")
        XCUIDevice.shared.siriService.activate(voiceRecognitionText: "화면 잠가 줘")
        let clock = springboard.descendants(matching: .any).matching(NSPredicate(format:
            "label MATCHES %@", "(오전|오후) [0-9]{1,2}:[0-9]{2}")).firstMatch
        let date = springboard.descendants(matching: .any).matching(NSPredicate(format:
            "label MATCHES %@", "[0-9]{1,2}월 [0-9]{1,2}일 .*" )).firstMatch
        let actualLock = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            clock.exists && date.exists && !springboard.otherElements["Home screen icons"].exists &&
                springboard.windows["SBCoverSheetWindow"].exists
        }, object: nil)
        let locked = XCTWaiter.wait(for: [actualLock], timeout: 15) == .completed
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "pinned-public-siri-lock-capability"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        print("ETA_PINNED_PUBLIC_SIRI_LOCK_UI\n" + springboard.debugDescription)
        try XCTSkipUnless(locked, "Public Siri did not produce an observed lock; capability is not verified")
        print("ETA_PINNED_PUBLIC_SIRI_LOCK_OBSERVED")
    }

    func testInspectPublicPowerMenuCancellation() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["E2E_INSPECT_PINNED_CONTROL_CENTER"] == "1")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCUIDevice.shared.press(.home)
        defer {
            XCUIDevice.shared.press(.home)
            XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe").activate()
        }
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.01))
            .press(forDuration: 0.1, thenDragTo:
                springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.6)))
        // Observed in the preceding pinned Control Center accessibility capture.
        let power = springboard.buttons["전원"]
        XCTAssertTrue(power.waitForExistence(timeout: 5))
        power.press(forDuration: 1.2)
        let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        before.name = "pinned-public-power-menu"
        before.lifetime = .keepAlways
        add(before)
        print("ETA_PINNED_POWER_MENU_INSPECTION_UI\n" + springboard.debugDescription)
        let cancel = springboard.buttons["취소"]
        if cancel.waitForExistence(timeout: 5) {
            cancel.tap()
            let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            after.name = "pinned-after-public-power-cancel"
            after.lifetime = .keepAlways
            add(after)
            print("ETA_PINNED_POWER_CANCEL_INSPECTION_UI\n" + springboard.debugDescription)
        }
        // Never drag the power-off slider, enter a passcode or call private lock APIs.
        // A captured clock alone is not evidence of a completed lock/delivery test.
    }
}
