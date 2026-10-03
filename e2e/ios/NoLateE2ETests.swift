import XCTest

/// Runs against the installed app; the server and app build are managed separately.
final class NoLateE2ETests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe")

    override func setUpWithError() throws {
        continueAfterFailure = false
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let open = springboard.alerts.buttons["열기"]
        if open.waitForExistence(timeout: 2) { open.tap() }
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
        }
    }

    private func replace(_ field: XCUIElement, with text: String) {
        field.tap()
        // A tap can place the caret in the middle of existing text. Select all
        // rather than deleting only the characters before that caret.
        field.typeKey("a", modifierFlags: .command)
        field.typeText(XCUIKeyboardKey.delete.rawValue)
        // Controlled React Native fields can drop batched keystrokes while
        // their value is being reconciled. Let XCTest idle between characters.
        for character in text { field.typeText(String(character)) }
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

    func testNewMemberScheduleJourney() throws {
        let environment = ProcessInfo.processInfo.environment
        let emailValue = try XCTUnwrap(environment["E2E_EMAIL"], "Pass credentials using run.py")
        let passwordValue = try XCTUnwrap(environment["E2E_PASSWORD"])
        let email = app.textFields["이메일"]
        XCTAssertTrue(email.waitForExistence(timeout: 30), "Use a signed-out dedicated simulator")
        replace(email, with: emailValue)
        XCTAssertEqual(email.value as? String, emailValue)
        replace(app.secureTextFields["비밀번호"], with: passwordValue)
        app.buttons["로그인"].tap()

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["나중에", "지금 안 함", "허용 안 함", "Don't Allow", "Not Now"] {
            let button = springboard.alerts.buttons[label]
            if button.exists { button.tap() }
        }
        let skipImport = app.buttons["일정 없이 시작하기"]
        XCTAssertTrue(skipImport.waitForExistence(timeout: 45), "New member should enter onboarding")
        capture("new-member-onboarding")
        skipImport.tap()
        let skipTour = app.buttons["사용법 건너뛰고 NoLate 시작하기"]
        XCTAssertTrue(skipTour.waitForExistence(timeout: 20))
        skipTour.tap()
        let add = app.buttons["일정 추가"]
        XCTAssertTrue(add.waitForExistence(timeout: 20))
        capture("calendar-after-login")
        try createAndEditSchedule()
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
    }
}
