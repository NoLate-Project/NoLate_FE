import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateGuidanceActivityStartPolicyTests: XCTestCase {
  private let legs = [NoLateGuidanceRouteLeg(index: 0, kind: "WALK", walkingLengthMeters: 100),
    .init(index: 1, kind: "BUS"), .init(index: 2, kind: "WALK", walkingLengthMeters: 100)]
  private func value(status: String = "ARMED", phase: String = "READY", quality: String = "UNAVAILABLE",
    progress: Double? = nil, observed: Double? = nil, until: Double = 1600) -> NoLateGuidanceContent {
    .init(sessionId: "prepared", scheduleId: "9001", generation: 1, routeRevision: 1, routeInputDigest: "digest",
      sequence: 0, status: status, phase: phase, quality: quality, instruction: "이동하면 출발을 감지합니다",
      activeLegIndex: 0, walkProgress: progress, observedAt: observed, validUntil: until)
  }
  func testForegroundLocalPreparationCreatesShellButNoLocationOrNotice() {
    let content = value()
    XCTAssertTrue(NoLateGuidanceActivityStartPolicy.allows(content, legs: legs, now: 1000, foreground: true, remotePilot: false))
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(content, legs: legs, now: 1000).title, "출발 대기")
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(content, legs: legs, now: 1000))
    var notice = NoLateGuidanceNoticePolicy()
    XCTAssertNil(notice.next(content, legs: legs, now: 1000))
  }
  func testRemotePilotAndBackgroundCannotCreatePreparedShell() {
    XCTAssertFalse(NoLateGuidanceActivityStartPolicy.allows(value(), legs: legs, now: 1000, foreground: true, remotePilot: true))
    XCTAssertFalse(NoLateGuidanceActivityStartPolicy.allows(value(), legs: legs, now: 1000, foreground: false, remotePilot: false))
  }
  func testExpiredStaleOrMalformedPreparationDoesNotClaimReady() {
    for bad in [value(until: 1000), value(until: .nan), value(quality: "GOOD"), value(progress: 0),
      value(status: "STOPPED"), value(phase: "RIDING"), value(observed: 1000)] {
      XCTAssertFalse(NoLateGuidanceActivityStartPolicy.allows(bad, legs: legs, now: 1000, foreground: true, remotePilot: false))
      XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(bad, legs: legs, now: 1000).title, "위치 확인 중")
    }
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(value(), legs: legs, now: 1000, isStale: true).title, "위치 확인 중")
    XCTAssertFalse(NoLateGuidanceActivityStartPolicy.allows(value(), legs: Array(legs.prefix(2)), now: 1000, foreground: true, remotePilot: false))
  }
  func testActiveRequiresOriginalFreshGPSDeadlineInBothModes() {
    let content = value(status: "ACTIVE", phase: "WALKING_TO_STOP", quality: "GOOD", progress: 0.2, observed: 1000, until: 1015)
    for remote in [false, true] {
      XCTAssertTrue(NoLateGuidanceActivityStartPolicy.allows(content, legs: legs, now: 1001, foreground: true, remotePilot: remote))
      XCTAssertFalse(NoLateGuidanceActivityStartPolicy.allows(content, legs: legs, now: 1015, foreground: true, remotePilot: remote))
      XCTAssertFalse(NoLateGuidanceActivityStartPolicy.allows(content, legs: legs, now: 1001, foreground: false, remotePilot: remote))
    }
  }
}
