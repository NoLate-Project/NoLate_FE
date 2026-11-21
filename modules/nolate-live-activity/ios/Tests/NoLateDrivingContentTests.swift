import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateDrivingContentTests: XCTestCase {
  let now = Date(timeIntervalSince1970: 1000)
  func content(_ meters: Int = 140, index: Int = 3) -> NoLateDrivingContent {
    .init(status: "GUIDING", validUntilMs: 1_012_000, remainingMeters: 980, remainingSeconds: 180,
          next: .init(title: "우회전", road: "시장길", type: "13", index: index, meters: meters))
  }

  @MainActor func testHostExpiresOnlyTheLatestDisplayedFixWithoutAnotherObservation() async {
    let expiry = NoLateDrivingDisplayExpiry()
    let expired = expectation(description: "display retired using the original source deadline")
    // Replace a packet that expired during suspension with a fresh observed maneuver.
    // With no more GPS callbacks, that new packet must still retire at its source deadline.
    expiry.observe(content()) { XCTFail("superseded direction should not update the card") }
    var replacement = content(30, index: 4)
    let deadline = Date().addingTimeInterval(0.04)
    replacement.validUntilMs = deadline.timeIntervalSince1970 * 1000
    expiry.observe(replacement) {
      XCTAssertGreaterThanOrEqual(Date().timeIntervalSince1970, deadline.timeIntervalSince1970 - 0.000001)
      expired.fulfill()
    }
    await fulfillment(of: [expired], timeout: 1)
    let finished = expectation(description: "expiry work after an explicit reset is cancelled")
    expiry.observe(content()) { XCTFail("a finished drive should not update its card") }
    expiry.cancel()
    Task { @MainActor in finished.fulfill() }
    await fulfillment(of: [finished], timeout: 1)
  }
  func testExpiresAtSourceDeadlineAndRemovesAllOldDirectionsAndETA() {
    let packet = content()
    XCTAssertEqual(packet.visible(now: now), packet)
    for value in [packet.visible(now: now.addingTimeInterval(12)), packet.visible(now: now, isStale: true),
                  packet.visible(now: now.addingTimeInterval(-1))] {
      XCTAssertEqual(value, .init(status: "UNCERTAIN"))
    }
    let outside = NoLateDrivingContent(status: "OFF_ROUTE", validUntilMs: packet.validUntilMs, remainingMeters: 980, next: packet.next)
    XCTAssertEqual(outside.visible(now: now), .init(status: "OFF_ROUTE", validUntilMs: packet.validUntilMs))
    XCTAssertEqual(outside.visible(now: now.addingTimeInterval(12)), .init(status: "UNCERTAIN"))
    var invalid = packet
    invalid.remainingMeters = -1
    XCTAssertEqual(invalid.visible(now: now), .init(status: "UNCERTAIN"))
    invalid = packet
    invalid.following = .init(title: "우회전", road: "", type: "13", index: 7, meters: 70)
    XCTAssertEqual(invalid.visible(now: now), .init(status: "UNCERTAIN"))
  }
  func testSpokenTurnNamesTheRoadAndDoesNotRepeatProviderCopy() {
    let turn = NoLateDrivingContent.Turn(title: "우회전", road: "시장길", type: "13", index: 2, meters: 140)
    XCTAssertEqual(NoLateDrivingSpeechCue.instruction(for: turn), "약 140미터 앞, 시장길 방면 우회전.")
    let close = NoLateDrivingContent.Turn(title: "시장길 진입", road: "시장길", type: "104", index: 3, meters: 4)
    XCTAssertEqual(NoLateDrivingSpeechCue.instruction(for: close), "잠시 후, 시장길 진입.")
  }

  func testSpeechAnnouncesEachThresholdOnceAndRecognizesTheNextProviderOccurrence() {
    XCTAssertNil(NoLateDrivingSpeechCue(content(750), after: nil, now: now))
    let first = NoLateDrivingSpeechCue(content(), after: nil, now: now)
    XCTAssertEqual(first?.stage, 1)
    XCTAssertNil(NoLateDrivingSpeechCue(content(80), after: first, now: now))
    let close = NoLateDrivingSpeechCue(content(45), after: first, now: now)
    XCTAssertEqual(close?.stage, 2)
    XCTAssertNil(NoLateDrivingSpeechCue(content(43), after: close, now: now))
    XCTAssertNil(NoLateDrivingSpeechCue(content(80), after: close, now: now))
    XCTAssertEqual(NoLateDrivingSpeechCue(content(35, index: 4), after: close, now: now)?.index, 4)
    XCTAssertNil(NoLateDrivingSpeechCue(content(), after: nil, now: now.addingTimeInterval(13)))
  }
}
