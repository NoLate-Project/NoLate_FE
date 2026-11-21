import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyOffRouteMapPolicyTests: XCTestCase {
  private typealias Policy = NoLateJourneyOffRouteMapPolicy
  private let first = Policy.Fix(latitude: 37.565, longitude: 126.99, accuracyMeters: 5, observedAt: 1_005)

  func testRequiresTwoFreshContinuousOffRouteFixes() {
    XCTAssertFalse(Policy.continuous(first, after: nil, now: 1_005, armedAt: 1_000, expiresAt: 1_600))
    let next = Policy.Fix(latitude: 37.565004, longitude: 126.99, accuracyMeters: 5, observedAt: 1_006)
    XCTAssertTrue(Policy.continuous(next, after: first, now: 1_006, armedAt: 1_000, expiresAt: 1_600))
    XCTAssertFalse(Policy.continuous(next, after: first, now: 1_022, armedAt: 1_000, expiresAt: 1_600))
  }

  func testRejectsUnreliableAndImplausibleMapCoordinates() {
    let inaccurate = Policy.Fix(latitude: first.latitude, longitude: first.longitude,
      accuracyMeters: 26, observedAt: 1_006)
    let jump = Policy.Fix(latitude: 37.58, longitude: 127.01, accuracyMeters: 5, observedAt: 1_006)
    XCTAssertFalse(Policy.continuous(inaccurate, after: first, now: 1_006, armedAt: 1_000, expiresAt: 1_600))
    XCTAssertFalse(Policy.continuous(jump, after: first, now: 1_006, armedAt: 1_000, expiresAt: 1_600))
    XCTAssertFalse(Policy.usable(.init(latitude: .nan, longitude: 126.99, accuracyMeters: 5, observedAt: 1_006),
      now: 1_006, armedAt: 1_000, expiresAt: 1_600))
  }

  func testRecentlyConfirmedTransitDoesNotBecomeAnOffRouteRerouteDuringProviderGap() {
    XCTAssertTrue(Policy.transitStillCorrelated(busPhase:"RIDING",busConfirmedAt:nil,
      subwayPhase:nil,subwayConfirmedAt:nil,now:1_100))
    XCTAssertTrue(Policy.transitStillCorrelated(busPhase:"UNAVAILABLE",busConfirmedAt:1_010,
      subwayPhase:nil,subwayConfirmedAt:nil,now:1_099))
    XCTAssertTrue(Policy.transitStillCorrelated(busPhase:nil,busConfirmedAt:nil,
      subwayPhase:"UNAVAILABLE",subwayConfirmedAt:1_010,now:1_099))
    XCTAssertFalse(Policy.transitStillCorrelated(busPhase:"UNAVAILABLE",busConfirmedAt:1_010,
      subwayPhase:nil,subwayConfirmedAt:nil,now:1_100))
    XCTAssertFalse(Policy.transitStillCorrelated(busPhase:"UNAVAILABLE",busConfirmedAt:1_101,
      subwayPhase:nil,subwayConfirmedAt:nil,now:1_100))
    XCTAssertFalse(Policy.transitStillCorrelated(busPhase:nil,busConfirmedAt:nil,
      subwayPhase:nil,subwayConfirmedAt:nil,now:1_100))
  }
}
