import XCTest

/// Runs against the installed app; the server and app build are managed separately.
final class NoLateE2ETests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe")

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

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0 {
            capture("failure")
            print(app.debugDescription)
            // A failed assertion after ARMED must not leave a server session
            // that rejects the next isolated Release run.
            if name.contains("testIsolatedOdsaySubwayAutomaticPreparation") ||
               name.contains("testIsolatedSavedRouteNavigationEntry") {
                let stop = app.buttons["saved-detail-stop"]
                if !stop.exists {
                    let handle = app.buttons["schedule-route-sheet-handle"]
                    if handle.exists { handle.tap() }
                }
                if stop.exists {
                    try? reveal(stop)
                    if stop.isHittable { stop.tap() }
                }
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

    private func replace(_ field: XCUIElement, with text: String) {
        focusForTextEntry(field)
        // A tap can place the caret in the middle of existing text. Select all
        // rather than deleting only the characters before that caret.
        field.typeKey("a", modifierFlags: .command)
        field.typeText(XCUIKeyboardKey.delete.rawValue)
        // Controlled React Native fields can drop batched keystrokes while
        // their value is being reconciled. Let XCTest idle between characters.
        for character in text { field.typeText(String(character)) }
    }

    private func replaceSecure(_ field: XCUIElement, with text: String) {
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

    private func dismissSyntheticPasswordSavePrompt() {
        let prompt = app.staticTexts["암호를 저장하겠습니까?"]
        if prompt.waitForExistence(timeout: 3) {
            let later = app.buttons["지금 안 함"].firstMatch
            XCTAssertTrue(later.waitForExistence(timeout: 3))
            later.tap()
            let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !prompt.exists }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed)
        }
    }

    private func dismissTrackingPermissionIfPresent() {
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
        XCTAssertTrue(app.alerts.staticTexts["올바른 이메일 주소를 입력해 주세요."].waitForExistence(timeout: 10))
        capture("login-validation")
        app.alerts.buttons.firstMatch.tap()
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
    func testIsolatedSavedRouteNavigationEntry() throws {
        addUIInterruptionMonitor(withDescription: "Allow isolated route GPS") { alert in
            for label in ["앱을 사용하는 동안 허용", "앱 사용 중에만 허용", "Allow While Using App"] {
                let allow = alert.buttons[label]
                if allow.exists { allow.tap(); return true }
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
                app.buttons["로그인"].tap()
                loggedIn = true
            }
            dismissSyntheticPasswordSavePrompt()
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
        depart.tap()
        let navigationReady = app.otherElements["schedule-route-navigation-ready"]
        var openedExpanded = false
        if !navigationReady.waitForExistence(timeout: 2), depart.exists {
            // The compact scroll area can consume a tap while settling after
            // the deep link. Use the same product action in the expanded sheet.
            let handle = app.buttons["schedule-route-sheet-handle"]
            XCTAssertTrue(handle.waitForExistence(timeout: 5))
            handle.tap()
            openedExpanded = true
            let expandedDepart = app.buttons["schedule-route-departure-action"]
            XCTAssertTrue(expandedDepart.waitForExistence(timeout: 5))
            expandedDepart.tap()
        }
        let locationPermission = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["앱을 사용하는 동안 허용"]
        if locationPermission.waitForExistence(timeout: 2) { locationPermission.tap() }
        XCTAssertTrue(navigationReady.waitForExistence(timeout: 10))
        let prepare = app.buttons["schedule-route-guidance-entry"]
        if openedExpanded {
            let handle = app.buttons["schedule-route-sheet-handle"]
            handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            if !prepare.waitForExistence(timeout: 3) {
                handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
        }
        XCTAssertTrue(prepare.waitForExistence(timeout: 10),
                      "The compact route sheet must expose the guidance preparation action")
        XCTAssertTrue(app.otherElements["saved-journey-route-bar"].waitForExistence(timeout: 5),
                      "The compact route sheet must show the whole-route summary bar")
        XCTAssertFalse(app.buttons["saved-detail-stop"].exists,
                       "Entering navigation must not start the GPS session")
        capture("isolated-navigation-ready-on-route-map")
        let prepareFrame = prepare.frame
        app.coordinate(withNormalizedOffset: CGVector(dx: prepareFrame.midX / app.frame.width,
                                                      dy: prepareFrame.midY / app.frame.height)).tap()
        XCTAssertTrue(app.otherElements["saved-detail-controls"].waitForExistence(timeout: 10),
                      "The same route sheet must reveal the server/native preparation controls")
        if environment["E2E_CLEAR_PENDING_GUIDANCE"] == "1" {
            let stop = app.buttons["saved-detail-stop"]
            if stop.exists {
                stop.tap()
                capture("isolated-navigation-live-session-cleared")
                return
            }
            let restoreConsent = app.descendants(matching: .any)["saved-detail-restore-consent"].firstMatch
            XCTAssertTrue(restoreConsent.waitForExistence(timeout: 10), "A pending guidance checkpoint must be present")
            restoreConsent.tap()
            let restore = app.buttons["saved-detail-restore"]
            XCTAssertTrue(restore.waitForExistence(timeout: 10) && restore.isEnabled)
            restore.tap()
            XCTAssertTrue(stop.waitForExistence(timeout: 20))
            stop.tap()
            capture("isolated-navigation-pending-checkpoint-cleared")
            return
        }
        XCTAssertTrue(app.staticTexts["saved-detail-walking-connected"].waitForExistence(timeout: 30),
                      "Navigation entry must fetch the owned walking path without another button tap")
        capture("isolated-navigation-preparation-in-route-sheet")
        if environment["E2E_LOCKED_DEPARTURE_NOTICE"] == "1" {
            let noticeSettings = app.buttons["saved-guidance-notice-expand"]
            XCTAssertTrue(noticeSettings.waitForExistence(timeout: 10))
            noticeSettings.tap()
            let permission = app.buttons["saved-guidance-notice-permission"]
            XCTAssertTrue(permission.waitForExistence(timeout: 5))
            permission.tap()
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let allow = springboard.alerts.buttons["허용"]
            if allow.waitForExistence(timeout: 5) { allow.tap() }
            let notifications = app.buttons["saved-guidance-notice-notifications"]
            XCTAssertTrue(notifications.waitForExistence(timeout: 5))
            notifications.tap()
            let selected = expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: notifications)
            XCTAssertEqual(XCTWaiter().wait(for: [selected], timeout: 10), .completed,
                           "The product route sheet must select local notification guidance")
            capture("isolated-navigation-notifications-selected")
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
        let activeSheetHandle = app.buttons["schedule-route-sheet-handle"]
        XCTAssertTrue(activeSheetHandle.waitForExistence(timeout: 25))
        let mapFocused = expectation(for: NSPredicate(format: "label == %@", "저장 경로 보기"),
                                     evaluatedWith: activeSheetHandle)
        XCTAssertEqual(XCTWaiter().wait(for: [mapFocused], timeout: 10), .completed,
                       "A new guidance session must reveal the map and compact current-stage sheet")
        XCTAssertTrue(app.descendants(matching: .any)["saved-journey-route-bar"].firstMatch.waitForExistence(timeout: 5),
                      "Map-focused guidance must retain the whole-route progress bar")
        let guidanceLocationAlert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.matching(
            NSPredicate(format: "label CONTAINS %@", "위치를 사용하도록 허용")).firstMatch
        if guidanceLocationAlert.waitForExistence(timeout: 8) {
            for label in ["앱을 사용하는 동안 허용", "앱 사용 중에만 허용", "Allow While Using App"] {
                let allow = guidanceLocationAlert.buttons[label]
                if allow.exists { allow.tap(); break }
            }
        }
        capture("isolated-navigation-map-focused-on-start")
        activeSheetHandle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let expandedAgain = expectation(for: NSPredicate(format: "label == %@", "저장 경로 접기"),
                                        evaluatedWith: activeSheetHandle)
        XCTAssertEqual(XCTWaiter().wait(for: [expandedAgain], timeout: 10), .completed,
                       "The user must be able to reopen route details after map focus")
        let stopGuidance = app.buttons["saved-detail-stop"]
        XCTAssertTrue(stopGuidance.waitForExistence(timeout: 25),
                      "The authenticated saved route must arm a native GPS guidance session")
        XCTAssertTrue(app.staticTexts["saved-journey-instruction"].waitForExistence(timeout: 5),
                      "The route header must announce the active guidance stage")
        XCTAssertFalse(app.staticTexts["saved-detail-guidance-heading"].exists,
                       "The expanded route sheet must not repeat the header's running status")
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
            XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "1711")).firstMatch.exists,
                          "The collapsed route summary must retain the bus line")
            XCTAssertFalse(app.staticTexts["saved-detail-subway-signal"].exists,
                           "A bus route must not show subway live train status")
            capture("isolated-navigation-real-odsay-bus-armed")
            sheetHandle.tap()
            if environment["E2E_BUS_GPS_REPLAY"] == "1" {
                let progress = app.staticTexts["saved-journey-progress"].firstMatch
                NSLog("E2E_BUS_GPS_ARMED")
                let waiting = expectation(for: NSPredicate(format: "label CONTAINS %@", "버스 대기"), evaluatedWith: progress)
                XCTAssertEqual(XCTWaiter().wait(for: [waiting], timeout: 180), .completed,
                               "Owned walking GPS must reach the actual 1711 boarding stop")
                capture("isolated-navigation-real-odsay-bus-waiting")
                NSLog("E2E_BUS_WAITING")
                let riding = expectation(for: NSPredicate(format: "label CONTAINS %@", "버스로 이동 중"), evaluatedWith: progress)
                XCTAssertEqual(XCTWaiter().wait(for: [riding], timeout: 150), .completed,
                               "Independent bus motion and passenger GPS must confirm a shared ride")
                capture("isolated-navigation-real-odsay-bus-riding")
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
                    NSLog("E2E_BUS_DESTINATION_ARRIVED")
                    capture("isolated-navigation-real-odsay-bus-arrived")
                    return
                }
                if environment["E2E_BUS_LOCK_ACTIVITY"] == "1" {
                    NSLog("E2E_BUS_LOCK_READY")
                    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                    let lockInstruction = springboard.staticTexts.matching(NSPredicate(
                        format: "label == %@ OR label CONTAINS %@", "버스로 이동 중", "마지막 확인 · 1711")).firstMatch
                    XCTAssertTrue(lockInstruction.waitForExistence(timeout: 60),
                                  "The lock-screen Live Activity must show the fresh ride or its explicitly stale 1711 label")
                    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                    attachment.name = "isolated-navigation-real-odsay-bus-lock-screen"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    NSLog("E2E_BUS_LOCK_RIDE_CONTEXT_VISIBLE")
                    return
                }
            }
            stopGuidance.tap()
            XCTAssertFalse(stopGuidance.waitForExistence(timeout: 10),
                           "The isolated bus guidance session must stop cleanly")
            return
        }
        let subwaySignal = app.staticTexts["saved-detail-subway-signal"]
        let arrivalHint = app.staticTexts["saved-journey-instruction-arrival"]
        XCTAssertTrue(subwaySignal.waitForExistence(timeout: 10)
                      || (arrivalHint.waitForExistence(timeout: 2) && arrivalHint.label.contains("열차 도착까지")),
                      "The saved subway route must explain live train input or show a bound arrival hint")
        NSLog("E2E_SUBWAY_SIGNAL_%@", !subwaySignal.exists ? "ARRIVAL_HINT"
              : subwaySignal.label.hasPrefix("경로와 일치하는 열차") ? "MATCHED" : "WAITING")
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
        if environment["E2E_WAIT_FOR_SUBWAY_RESPONSE"] == "1" {
            if subwaySignal.exists && subwaySignal.label.hasPrefix("열차 위치를 확인 중") {
                let answered = expectation(for: NSPredicate(format: "NOT (label BEGINSWITH %@)", "열차 위치를 확인 중"),
                                           evaluatedWith: subwaySignal)
                XCTAssertEqual(XCTWaiter().wait(for: [answered], timeout: 30), .completed,
                               "The official subway observation request did not update its user-visible state")
            }
            let label = subwaySignal.exists ? subwaySignal.label : ""
            NSLog("E2E_SUBWAY_RESPONSE_%@", arrivalHint.exists && arrivalHint.label.contains("열차 도착까지") ? "ARRIVAL_HINT"
                  : label.hasPrefix("경로와 일치하는 열차") ? "MATCHED"
                  : label.hasPrefix("현재 경로와 일치하는 최신 열차") ? "NO_FRESH_MATCH"
                  : label.hasPrefix("이 경로의 실시간 열차") ? "ROUTE_UNSUPPORTED" : "TRANSPORT_UNAVAILABLE")
            capture("isolated-navigation-official-train-response")
        }
        if environment["E2E_WAIT_FOR_SUBWAY_SIGNAL"] == "1" {
            let matched = expectation(for: NSPredicate(format: "label BEGINSWITH %@", "경로와 일치하는 열차"),
                                      evaluatedWith: subwaySignal)
            XCTAssertEqual(XCTWaiter().wait(for: [matched], timeout: 240), .completed,
                           "Official live train input never reached the native consumer")
            capture("isolated-navigation-official-train-input")
            stopGuidance.tap()
            return
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
                    let reached = expectation(for: NSPredicate(format: "label == %@", intermediate), evaluatedWith: instruction)
                    XCTAssertEqual(XCTWaiter().wait(for: [reached], timeout: 180), .completed,
                                   "Correlated passenger GPS and train must reach the intermediate station")
                    NSLog("E2E_SUBWAY_INTERMEDIATE_REACHED")
                    capture("isolated-navigation-subway-intermediate-station")
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
                XCTAssertTrue(stopGuidance.waitForExistence(timeout: 5))
                stopGuidance.tap()
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
            XCTAssertTrue(stopGuidance.waitForExistence(timeout: 5))
            if simulateToBoarding {
                if environment["E2E_EXPECT_SUBWAY_ARRIVAL_HINT"] == "1" {
                    XCTAssertTrue(arrivalHint.waitForExistence(timeout: 10)
                                  && arrivalHint.label.contains("열차 도착까지"),
                                  "A bound platform arrival must reach the product route detail after GPS approach")
                    capture("isolated-navigation-subway-arrival-hint")
                } else {
                    XCTAssertTrue(subwaySignal.waitForExistence(timeout: 5))
                    NSLog("E2E_SUBWAY_SIGNAL_AFTER_MOVEMENT_%@",
                          subwaySignal.label.hasPrefix("경로와 일치하는 열차") ? "MATCHED" : "WAITING")
                }
            }
        }
        stopGuidance.tap()
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
        let stop = app.buttons["saved-detail-stop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10), "The isolated test must leave no armed session behind")
        try reveal(stop)
        stop.tap()
        assertGuidanceHeading("위치 안내가 끝났어요", timeout: 15)
    }

    /// Clean up a failed GPS replay without deleting the native checkpoint by hand.
    func testIsolatedAutomaticGuidanceStop() throws {
        let stop = app.buttons["saved-detail-stop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 20),
                      "The isolated route detail must still expose its explicit stop control")
        try reveal(stop)
        stop.tap()
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
        try intercitySearchSaveReopen(requiredKind: "기차", lookupTimetable: true)
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
        let activity = host.cells.matching(NSPredicate(format: "label CONTAINS %@", "NoLate")).firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 15)); activity.tap()
        XCTAssertTrue(host.staticTexts["버스 승차권 확인"].waitForExistence(timeout: 30))
        try confirmSharedTicket(in: host)
        let save = host.buttons["ticket-review-save"]
        save.tap()
        let duplicate = host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "이미 가져온 운행편입니다")).firstMatch
        XCTAssertTrue(duplicate.waitForExistence(timeout: 20), "A second confirmed share must show duplicate feedback instead of creating another schedule")
        let shot = XCTAttachment(screenshot: host.screenshot()); shot.name = "ticket-duplicate-rejected"; shot.lifetime = .keepAlways; add(shot)
        print("BUS_TICKET_DUPLICATE_SHARE_REJECTED")
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

        for (label, message) in [
            ("여러 페이지 PDF 공유 테스트", "잠기지 않은 한 페이지 승차권 PDF만 공유해 주세요"),
            ("기차 링크 공유 테스트", "링크만으로 승차권 내용을 확인할 수 없어요")
        ] {
            openShare(label)
            XCTAssertTrue(host.staticTexts["일정을 저장하지 못했어요"].waitForExistence(timeout: 20))
            XCTAssertTrue(host.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", message)).firstMatch.exists)
            XCTAssertFalse(host.staticTexts["일정을 저장했어요"].exists)
            let attachment = XCTAttachment(screenshot: host.screenshot()); attachment.name = label; attachment.lifetime = .keepAlways; add(attachment)
            host.buttons["닫기"].tap()
            XCTAssertTrue(host.buttons[label].waitForExistence(timeout: 10))
        }
        app.activate()
        print("TICKET_CANCEL_AND_INVALID_INPUTS_REJECTED")
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
        let activity = host.cells.matching(NSPredicate(format: "label CONTAINS %@", "NoLate")).firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 15), host.debugDescription)
        activity.tap()
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

    private func intercitySearchSaveReopen(requiredKind: String?, lookupTimetable: Bool = false, selectTimetable: Bool = false,
                                         originName: String = "서울남부터미널 E2E", destinationName: String = "공주터미널 E2E",
                                         nextDayDeadlineHour: Int? = nil) throws {
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
        let initialReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            email.exists || self.app.textFields["일정 제목"].exists || self.app.buttons["일정 추가"].exists ||
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
            let add = app.buttons["일정 추가"]
            XCTAssertTrue(add.waitForExistence(timeout: 30))
            try tap(add)
            let manual = app.buttons["직접 입력"]
            XCTAssertTrue(manual.waitForExistence(timeout: 10)); try tap(manual)
        }
        XCTAssertTrue(titleField.waitForExistence(timeout: 10))
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
            let recent = app.buttons[place + ", 최근 장소 선택"]
            XCTAssertTrue(recent.waitForExistence(timeout: 15)); recent.tap()
        }
        app.buttons["대중교통"].tap()
        let candidates = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " 경로"))
        XCTAssertTrue(candidates.firstMatch.waitForExistence(timeout: 45), "Real TMAP must return selectable routes")
        var lastRouteLabels: [String] = []
        var stableSince = Date()
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let labels = candidates.allElementsBoundByIndex.map { $0.label }
            if labels != lastRouteLabels || self.app.otherElements["경로를 계산하고 있어요"].exists {
                lastRouteLabels = labels; stableSince = Date()
            }
            return !labels.isEmpty && Date().timeIntervalSince(stableSince) >= 4
        }, object: nil)
        try require(XCTWaiter.wait(for: [settled], timeout: 60) == .completed, "Actual TMAP candidates must settle before choosing a ride")
        let ridePredicate = requiredKind.map { NSPredicate(format: "label BEGINSWITH %@", $0 + " · ") }
            ?? NSPredicate(format:
                "label BEGINSWITH '고속버스 · ' OR label BEGINSWITH '시외버스 · ' OR label BEGINSWITH '기차 · ' OR label BEGINSWITH '고속·시외버스 · '")
        let intercity = app.staticTexts.matching(ridePredicate).firstMatch
        for label in lastRouteLabels.prefix(10) {
            let candidate = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
            try reveal(candidate); try tap(candidate)
            if intercity.waitForExistence(timeout: 4) {
                if selectTimetable && requiredKind == "시외버스" {
                    // This feature supports one long-distance ride. Do not confirm a
                    // different transfer terminal just because its first ride is a bus.
                    if intercity.label.contains("인천T2-청주") && app.buttons.matching(NSPredicate(format: "label == %@", "시외버스 운행 시간표 조회")).count == 1 { break }
                } else { break }
            }
        }
        XCTAssertTrue(intercity.waitForExistence(timeout: 15), "Expanded result must show an intercity ride")
        if selectTimetable && requiredKind == "시외버스" {
            try require(intercity.label.contains("인천T2-청주") && app.buttons.matching(NSPredicate(format: "label == %@", "시외버스 운행 시간표 조회")).count == 1,
                        "Select the real direct Incheon T2–Cheongju bus before confirming terminal mapping")
        }
        let rideLabel = intercity.label
        XCTAssertFalse(rideLabel.hasPrefix("도보")); capture("intercity-real-provider-result")
        if lookupTimetable { try lookupRealIntercityTimetables() }
        let selectedClock = selectTimetable ? (requiredKind == "시외버스" ? try selectRealIntercityBusService() : try lookupRealIntercityTimetables(selectService: true)) : nil
        let routeSave = app.buttons["이 경로 저장"]
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
    private func lookupRealIntercityTimetables(selectService: Bool = false) throws -> String? {
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
            let find = app.buttons["역 터미널 검색"]
            if !find.isHittable { scroll.swipeUp() }
            XCTAssertTrue(find.isEnabled); find.tap()
            let stop = app.buttons[result]
            XCTAssertTrue(stop.waitForExistence(timeout: 15)); stop.tap()
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
            diagnostic == "TRANSIT_ARRIVAL_OUT_OF_HORIZON" ? "실시간 조회 범위 밖" : "운행시각 미확인"
        // Navigation retains older detail nodes in the accessibility tree. Inspect
        // the visible current summary, not the first cached node with this prefix.
        let summaries = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "일정 상세 시트 펼치기, 예상 출발 "))
        var visibleSummary: XCUIElement?
        let expected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            visibleSummary = summaries.allElementsBoundByIndex.first {
                $0.exists && $0.isHittable && $0.frame.height > 30 &&
                self.app.frame.contains($0.frame) && $0.label.contains(warning)
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
        try require(["success", "reconnect", "early-transfer", "dwell-transfer", "early-transfer-risk", "transfer-observed", "transfer-first-unobserved", "planned-postdeparture", "planned-alighting", "unknown", "missed", "recovered", "late", "contract-save"].contains(phase), "Unknown fixture phase")
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
        try require(!summary.label.contains("미지원") && !summary.label.contains("미확인") && !summary.label.contains("환승 불가"),
                    "A rejected ETA must not look accepted")
        let rideData = try XCTUnwrap(environment["E2E_REAL_RIDE_TEXT"]?.data(using: .utf8))
        let rides = try XCTUnwrap(try JSONSerialization.jsonObject(with: rideData) as? [String])
        try require(rides.count >= 2 && rides.allSatisfy { summary.label.contains($0) },
                    "Actual first and transfer train clocks differ from the accepted Worker")
        // 펼치면 요약 버튼이 사라진다. 검증한 문자열을 보관해 로그가 재조회 실패를 만들지 않게 한다.
        let verifiedSummary = summary.label
        try tap(summary)
        let guidance = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "현재 보정 여정,")).firstMatch
        try require(waitForVisibleRealRouteText(guidance) &&
                    rides.allSatisfy { guidance.label.contains($0) },
                    "Expanded actual-provider evidence must retain per-train clocks and timing basis")
        let walkData = try XCTUnwrap(environment["E2E_REAL_WALK_TEXT"]?.data(using: .utf8))
        let walking = try XCTUnwrap(try JSONSerialization.jsonObject(with: walkData) as? [[String]])
        try require(walking.allSatisfy { tokens in (2...3).contains(tokens.count) &&
                    tokens.allSatisfy { guidance.label.contains($0) } },
                    "Expanded itinerary must preserve provider walking scopes, meters and verified seconds")
        if let railData = environment["E2E_REAL_MATCHED_RAIL"]?.data(using: .utf8) {
            let rows = try JSONDecoder().decode([[String]].self, from: railData)
            for fields in rows {
                try require(fields.count == 3, "Expected a ride identifier and two corrected clocks")
                let row = app.descendants(matching: .any)[fields[0]].firstMatch
                try require(row.exists && row.label.contains(fields[1]) &&
                            row.label.contains(fields[2] + " 예상 하차"),
                            "The matched rail does not display the accepted boarding and alighting: " + row.label)
            }
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

    private func verifyIsolatedRealProviderPlannedArrival(_ kind: String) throws {
        try require(environment["E2E_REAL_ISOLATED"] == "1" && environment["E2E_SCHEDULE_ID"] == "363" &&
                    environment["E2E_EXISTING_TITLE"] == "ETA E2E real isolated fixture",
                    "Only the scoped real-provider H2 schedule is allowed")
        try openRealIsolatedDetail()
        let departure = try XCTUnwrap(environment["E2E_REAL_DEPARTURE_CLOCK"])
        let arrival = try XCTUnwrap(environment["E2E_REAL_PROVISIONAL_CLOCK"])
        let summary = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "계획 경로 기준 · 잠정 도착")).firstMatch
        if summary.waitForExistence(timeout: 20) && summary.isHittable {
            try require(summary.label.contains("기존 출발 안내 " + departure) &&
                        summary.label.contains(arrival + " 도착 예상") &&
                        !summary.label.contains("현재 보정 여정"),
                        "A provisional arrival must not replace the frozen departure guidance")
            try tap(summary)
        }
        let guidance = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "계획 경로 기준 · 잠정 도착,")).firstMatch
        try reveal(guidance)
        try require(guidance.exists && guidance.isHittable &&
                    guidance.label.contains(arrival + " 도착 예상") &&
                    guidance.label.contains("실제 탑승·환승 여부는 확인하지 못했어요") &&
                    guidance.label.contains("출발 알림 시각은 바뀌지 않아요"),
                    "The installed app must label the observed arrival as provisional")
        capture("eta-real-isolated-planned-" + kind)
        print("ETA_REAL_ISOLATED_PROVISIONAL_\(kind.uppercased())_UI_VERIFIED: " + guidance.label)
    }

    /// Select the saved fixture's actual date, including a target after midnight.
    /// This only opens existing data; it never saves or changes a schedule/calendar style.
    private func openRealIsolatedDetail() throws {
        if (environment["E2E_SEOLLEUNG_ACCESS"] == "1" || environment["E2E_REAL_AUTOMATIC"] == "1") &&
            app.staticTexts["ETA E2E real isolated fixture"].firstMatch.exists && app.buttons["일정 수정"].exists {
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
            try reveal(card, upward: card.frame.midY >= app.frame.minY)
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
        try require(summary.label.contains(warning) && !summary.label.contains("현재 보정 여정") &&
                    !summary.label.contains("첫 승차 실시간 반영"), "Rejected route must not look like successful realtime ETA")
        let verifiedSummary = summary.label
        if let excluded = environment["E2E_REAL_FUTURE_WITHHELD"] {
            try require(["DEPARTED_AT_EVALUATION", "ARRIVES_AFTER_TARGET"].contains(excluded),
                        "Only independently proven preview exclusions are allowed")
        }
        if environment["E2E_REAL_FUTURE_WITHHELD"] != nil ||
            environment["E2E_REAL_FORBID_FUTURE_PREVIEW"] == "1" {
            try require(!verifiedSummary.contains("출발 예측 ·") &&
                        !verifiedSummary.contains("미래 시간표 예측 · 실시간 미확인"),
                        "A departed or late timetable preview must remain hidden")
            try tap(summary)
            let expired = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@",
                "미래 시간표 예측 · 실시간 미확인,")).firstMatch
            try require(!expired.exists, "Expanded sheet must not resurrect an ineligible timetable preview")
        }
        if let futureSummary = environment["E2E_REAL_FUTURE_SUMMARY"] {
            let rideData = try XCTUnwrap(environment["E2E_REAL_FUTURE_RIDE_TEXT"]?.data(using: .utf8))
            let rides = try XCTUnwrap(try JSONSerialization.jsonObject(with: rideData) as? [String])
            let departureText = try XCTUnwrap(environment["E2E_REAL_FUTURE_DEPARTURE_AT"])
            let departure = try XCTUnwrap(ISO8601DateFormatter().date(from: departureText))
            if !summary.label.contains(futureSummary) && Date() > departure {
                // Xcode 기동 중 미래 출발이 지나면 공개 API가 예측을 숨긴다.
                // 실제 API read-window도 사후 감사하므로 시각 불일치를 임의 허용하지 않는다.
                try require(!summary.label.contains("출발 예측 ·") &&
                            !summary.label.contains("미래 시간표 예측 · 실시간 미확인"),
                            "Expired preview must be absent, not replaced by different train clocks")
                capture("eta-real-timetable-expired-during-ui-launch")
                print("ETA_REAL_DIAGNOSTIC_UI_VERIFIED: " + verifiedSummary)
                return
            }
            try require(rides.count == 2 && summary.label.contains(futureSummary) &&
                        rides.allSatisfy { summary.label.contains($0) }, "Future timetable clocks must match the actual Worker")
            try tap(summary)
            let future = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@",
                "미래 시간표 예측 · 실시간 미확인,")).firstMatch
            try require(waitForVisibleRealRouteText(future) && future.label.contains(futureSummary) &&
                        rides.allSatisfy { future.label.contains($0) }, "Expanded future timetable must preserve both train clocks")
        }
        capture("eta-real-odsay-diagnostic")
        print("ETA_REAL_DIAGNOSTIC_UI_VERIFIED: " + verifiedSummary)
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
            let warnings = ["quality-unobserved": "미래 열차 실시간 미확인 · 시간표 예측 단계",
                            "quality-departed": "미래 열차 실시간 미확인 · 시간표 예측 단계",
                            "quality-stale": "차량 관측정보 오래됨", "quality-unverified": "차량 관측시각 검증 불가",
                            "quality-error": "도착정보 API 오류", "quality-timeout": "도착정보 API 응답 지연",
                            "quota-arrival": "도착정보 API 한도 초과"]
            if let warning = warnings[quality] {
                try require(label.contains(warning), "Arrival failure must retain its own diagnostic stage")
            }
            if timetablePreview {
                try require(label.contains("미래 시간표 예측 · 실시간 미확인") && label.contains("4012열차 · 시간표") &&
                            label.contains("2012열차 · 시간표") && !label.contains("첫 승차 실시간 반영"),
                            "The future train must show only separate timetable predictions")
                try tap(try XCTUnwrap(visible))
                let preview = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "미래 시간표 예측 · 실시간 미확인,")).firstMatch
                try require(waitForVisibleRealRouteText(preview) &&
                            preview.label.contains("출발 알람은 기존 안전 시각을 유지"), "Expanded timetable preview must explain alarm protection")
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
        try require(["success", "reconnect", "early-transfer", "dwell-transfer", "early-transfer-risk", "transfer-observed", "transfer-first-unobserved", "planned-postdeparture", "planned-alighting", "unknown", "missed", "recovered", "late"].contains(phase), "Unknown fixture phase")
        if app.buttons["알람 화면 닫기"].exists && app.buttons["경로 보기"].exists {
            try tap(app.buttons["알람 화면 닫기"])
        }
        // The runner re-enters through the real deep-link handler to refresh focus.
        // No token, response, or application store is injected into the app.
        // Keep the assertion on the visible detail rather than virtual calendar nodes.
        try require(app.staticTexts["ETA E2E isolated fixture"].firstMatch.waitForExistence(timeout: 20) &&
                    app.buttons["일정 수정"].exists, "Private fixture detail did not open")
        if ["planned-postdeparture", "planned-alighting"].contains(phase) {
            let clock = try XCTUnwrap(environment["E2E_FIXTURE_PROVISIONAL_CLOCK"])
            let departure = try XCTUnwrap(environment["E2E_FIXTURE_DEPARTURE_CLOCK"])
            let guidance = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "계획 경로 기준 · 잠정 도착,")).firstMatch
            let summary = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "계획 경로 기준 · 잠정 도착")).firstMatch
            if summary.exists && summary.isHittable {
                try require(summary.label.contains("기존 출발 안내 " + departure) && !summary.label.contains("현재 보정 여정"),
                            "A confirmed departure ETA was mixed into the compact provisional arrival")
                try tap(summary)
            }
            try reveal(guidance)
            try require(guidance.exists && guidance.isHittable &&
                        guidance.label.contains(clock + " 도착 예상") &&
                        guidance.label.contains("실제 탑승·환승 여부는 확인하지 못했어요") &&
                        guidance.label.contains("출발 알림 시각은 바뀌지 않아요"),
                        "Expanded route must explain provisional evidence and unchanged alarm")
            capture("eta-isolated-planned-postdeparture")
            print("ETA_ISOLATED_PROVISIONAL_UI_VERIFIED: " + guidance.label)
            return
        }
        let accepted = ["success", "reconnect", "early-transfer", "dwell-transfer", "transfer-observed", "recovered"].contains(phase)
        let prefix = accepted ? "일정 상세 시트 펼치기, 권장 출발 " : "일정 상세 시트 펼치기, 예상 출발 "
        let warning = phase == "missed" ? "환승 불가" : phase == "late" ? "정시 도착 불가" : phase == "early-transfer-risk" ? "환승 가능 여부 미확인" : phase == "unknown" ? "운행시각 미확인" : phase == "transfer-first-unobserved" ? "실시간 도착정보 없음" : nil
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
            // Independent synthetic timetable expectations: never rescale the saved 48/8-minute rides.
            let firstRide = environment["E2E_FIXTURE_FIRST_RIDE_MINUTES"] ??
                (phase == "transfer-observed" ? "7" : phase == "dwell-transfer" ? "21" : phase == "success" ? "22" : "25")
            let secondRide = phase == "dwell-transfer" ? "14" : phase == "transfer-observed" ? "12" : ["success", "early-transfer"].contains(phase) ? "11" : "13"
            let onwardTiming = environment["E2E_FIXTURE_TRANSFER_WAIT"] ?? "약 " + secondRide + "분"
            try require(summary.label.contains("현재 보정 여정") &&
                        summary.label.contains("수도권 4호선 · 노원역→사당 · 약 " + firstRide + "분") &&
                        summary.label.contains("수도권 2호선 · 사당→신림 · " + onwardTiming) &&
                        summary.label.contains("접근 도보 · 출발지→노원역 · 약 1분 51초") &&
                        summary.label.contains("환승 도보 · 사당 · 약 4분 3초") &&
                        summary.label.contains("도착 도보 · 신림→도착지 · 약 2분 51초"),
                        "Current journey segments still show the saved estimate or omit walking")
            try require(!summary.label.contains("약 48분") && !summary.label.contains("약 49분"),
                        "Saved first ride leaked into current timing")
            if phase == "dwell-transfer" {
                let transferRide = try XCTUnwrap(environment["E2E_FIXTURE_TRANSFER_RIDE_TEXT"])
                let arrival = try XCTUnwrap(environment["E2E_FIXTURE_ARRIVAL_CLOCK"])
                try require(summary.label.contains(transferRide) && summary.label.contains(arrival + " 도착"),
                            "Schedule must show the later transfer and recalculated destination arrival")
            }
            if phase == "early-transfer" {
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
                summary.label.contains("운행시각 미확인")
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
