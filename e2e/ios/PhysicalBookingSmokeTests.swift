import UIKit
import XCTest

/// Real iPhone smoke test. Opens installed carriers without signing in, purchasing,
/// editing schedules, or reading tickets. Screenshots remain in private xcresults.
final class NoLateE2ETests: XCTestCase {
    private let noLate = XCUIApplication(bundleIdentifier: "com.anonymous.nolatefe")

    override func setUpWithError() throws {
        continueAfterFailure = false
        noLate.activate()
        XCTAssertTrue(noLate.wait(for: .runningForeground, timeout: 30))
        let screenshot = XCTAttachment(screenshot: noLate.screenshot())
        screenshot.name = "private-nolate-before-carrier-open"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testActualKorailURLAndReturn() throws {
        try openCarrier(environmentKey: "E2E_KORAIL_URL",
                        expectedScheme: "korailtalk",
                        bundleIdentifier: "com.korail.KorailTalk", marker: "KORAIL")
    }

    func testActualTmoneyGOURLAndReturn() throws {
        try openCarrier(environmentKey: "E2E_TMONEY_URL",
                        expectedScheme: "tmoneytia",
                        bundleIdentifier: "kr.co.tmoney.tia", marker: "TMONEY")
    }

    private func openCarrier(environmentKey: String, expectedScheme: String,
                             bundleIdentifier: String, marker: String) throws {
        let raw = try XCTUnwrap(ProcessInfo.processInfo.environment[environmentKey])
        let url = try XCTUnwrap(URL(string: raw))
        XCTAssertEqual(url.scheme, expectedScheme)
        XCTAssertNil(url.query, "Do not pass account, itinerary, or tracking parameters")
        let carrier = XCUIApplication(bundleIdentifier: bundleIdentifier)
        // Dispatch by scheme without naming the receiving carrier application.
        // The test runner must be foreground for UIApplication.open to be
        // allowed. NoLate's compiled query allowlist is verified separately.
        // This is an OS URL-dispatch smoke test, not a tap on NoLate's UI.
        let runner = XCUIApplication(bundleIdentifier: try XCTUnwrap(Bundle.main.bundleIdentifier))
        runner.activate()
        XCTAssertTrue(runner.wait(for: .runningForeground, timeout: 15))
        let accepted = expectation(description: "OS accepted carrier URL")
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { success in
                XCTAssertTrue(success, "OS must find an installed handler for the product URL")
                accepted.fulfill()
            }
        }
        wait(for: [accepted], timeout: 30)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.alerts.buttons["열기"].exists {
            springboard.alerts.buttons["열기"].tap()
        }
        XCTAssertTrue(carrier.wait(for: .runningForeground, timeout: 30),
                      "The actual carrier app must become foreground")
        print("PHYSICAL_\(marker)_URL_ACCEPTED_REAL_APP_FOREGROUND")
        let carrierShot = XCTAttachment(screenshot: carrier.screenshot())
        carrierShot.name = "private-real-\(marker.lowercased())-foreground"
        carrierShot.lifetime = .keepAlways
        add(carrierShot)
        noLate.activate()
        XCTAssertTrue(noLate.wait(for: .runningForeground, timeout: 30))
        XCTAssertGreaterThan(noLate.windows.count, 0)
        let returnShot = XCTAttachment(screenshot: noLate.screenshot())
        returnShot.name = "private-nolate-return-from-\(marker.lowercased())"
        returnShot.lifetime = .keepAlways
        add(returnShot)
        print("PHYSICAL_\(marker)_RETURNED_TO_NOLATE")
    }
}
