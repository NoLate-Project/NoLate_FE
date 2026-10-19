import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateGuidanceNoticePolicyTests: XCTestCase {
  private let legs = [NoLateGuidanceRouteLeg(index: 0, kind: "WALK", walkingLengthMeters: 100),
    NoLateGuidanceRouteLeg(index: 1, kind: "BUS", boardingStopName: "승차", lineName: "7016", alightingStopName: "목표"),
    NoLateGuidanceRouteLeg(index: 2, kind: "WALK", walkingLengthMeters: 100)]
  private func content(_ phase: String = "WALKING_TO_STOP", at: Double = 1000, sequence: Int64 = 1,
    quality: String = "GOOD", status: String = "ACTIVE", session: String = "one", alighting: String? = nil,
    eta: Double? = nil, confirmed: Bool = true) -> NoLateGuidanceContent {
    .init(sessionId: session, scheduleId: "9001", generation: 1, routeRevision: 1, routeInputDigest: String(repeating: "a", count: 64),
      sequence: sequence, status: status, phase: phase, quality: quality, instruction: "not used", activeLegIndex: phase == "FINAL_WALK" ? 2 : phase == "RIDING" || phase == "WAITING" ? 1 : 0,
      walkProgress: phase == "RIDING" ? nil : phase == "WAITING" ? 1 : 0.5, observedAt: at, validUntil: at + 15,
      arrivalStatus: eta == nil ? nil : "WAITING_INFORMATION", arrival: eta.map { .init(providerRouteId: "100100447", directionLabel: "방면",
        expectedAt: $0, sourceUpdatedAt: at, validUntil: min(at + 120, $0)) },
      rideProgress: phase == "RIDING" ? 0.5 : nil, boardingConfirmed: phase == "RIDING" && confirmed,
      alighting: alighting.map { .init(kind: $0, remainingMeters: $0 == "NEAR_STOP" ? 30 : 200) })
  }
  func testDepartureOnceAcrossTicksAndFreshObservations() {
    var p = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(p.next(content(), legs: legs, now: 1001)?.kind, "DEPARTURE")
    XCTAssertNil(p.next(content(), legs: legs, now: 1002))
    XCTAssertNil(p.next(content(at: 1003, sequence: 2), legs: legs, now: 1004))
  }
  func testNoAnnouncementForUncertainStaleArmedStoppedOrCandidate() {
    for c in [content(quality: "UNCERTAIN"), content(status: "ARMED"), content(status: "STOPPED"),
      content("BOARDING_CANDIDATE"), content(at: 980), content(at: 1010)] {
      var p = NoLateGuidanceNoticePolicy(); XCTAssertNil(p.next(c, legs: legs, now: 1001))
    }
  }
  func testFreshTwoMinuteArrivalOnlyOnceAndNoExpiredETAEvenWithFreshGPS() {
    var p = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(p.next(content("WAITING", eta: 1121), legs: legs, now: 1001)?.body, "7016 · 약 2분 후 도착 예정입니다. 탑승을 준비해 주세요.")
    XCTAssertNil(p.next(content("WAITING", at: 1003, sequence: 2, eta: 1100), legs: legs, now: 1004))
    for eta in [999.0, 1001.0, 1122.0, .infinity] {
      var q = NoLateGuidanceNoticePolicy(); XCTAssertNil(q.next(content("WAITING", eta: eta), legs: legs, now: 1001))
    }
  }
  func testBoardingRequiresConfirmedFreshRide() {
    var p = NoLateGuidanceNoticePolicy()
    XCTAssertNil(p.next(content("RIDING", confirmed: false), legs: legs, now: 1001))
    XCTAssertEqual(p.next(content("RIDING"), legs: legs, now: 1001)?.kind, "BOARDING_CONFIRMED")
    XCTAssertNil(p.next(content("RIDING", at: 1002, sequence: 2), legs: legs, now: 1003))
  }
  func testOneStopAndNearStopExactlyOnceWithoutLateLowerPriorityMessages() {
    var p = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(p.next(content("RIDING", alighting: "ONE_STOP_BEFORE"), legs: legs, now: 1001)?.kind, "ONE_STOP_BEFORE")
    XCTAssertEqual(p.next(content("RIDING", at: 1002, sequence: 2, alighting: "NEAR_STOP"), legs: legs, now: 1003)?.kind, "NEAR_STOP")
    XCTAssertNil(p.next(content("RIDING", at: 1004, sequence: 3), legs: legs, now: 1005))
    var q = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(q.next(content("RIDING", alighting: "NEAR_STOP"), legs: legs, now: 1001)?.kind, "NEAR_STOP")
    XCTAssertNil(q.next(content("RIDING", at: 1002, sequence: 2, alighting: "ONE_STOP_BEFORE"), legs: legs, now: 1003))
  }
  func testFinalWalkCannotRegressToBusOrWaiting() {
    var p = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(p.next(content("FINAL_WALK"), legs: legs, now: 1001)?.kind, "FINAL_WALK")
    XCTAssertNil(p.next(content("RIDING", at: 1002, sequence: 2), legs: legs, now: 1003))
    XCTAssertNil(p.next(content("WAITING", at: 1004, sequence: 3, eta: 1100), legs: legs, now: 1005))
  }
  func testWaitingCannotAnnounceLateDepartureEvenWithoutArrivalInformation() {
    var p = NoLateGuidanceNoticePolicy()
    XCTAssertNil(p.next(content("WAITING"), legs: legs, now: 1001))
    XCTAssertNil(p.next(content(at: 1002, sequence: 2), legs: legs, now: 1003))
    XCTAssertNotNil(p.next(content("RIDING", at: 1004, sequence: 3), legs: legs, now: 1005))
  }
  func testNoticeLifetimeIsBoundedByBothTenSecondsAndOriginalGPSExpiry() {
    var p = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(p.next(content(), legs: legs, now: 1001)?.expiresAt, 1011)
    p.reset()
    XCTAssertEqual(p.next(content(), legs: legs, now: 1014)?.expiresAt, 1015)
    p.reset()
    XCTAssertNil(p.next(content(), legs: legs, now: 1015))
  }
  func testClockSequenceAndSourceObservationRegressionCannotAnnounce() {
    var p = NoLateGuidanceNoticePolicy(); _ = p.next(content(at: 1000, sequence: 2), legs: legs, now: 1001)
    XCTAssertNil(p.next(content("RIDING", at: 999, sequence: 3), legs: legs, now: 1002))
    XCTAssertNil(p.next(content("RIDING", at: 1003, sequence: 1), legs: legs, now: 1004))
    XCTAssertNil(p.next(content("RIDING", at: 1000, sequence: 3), legs: legs, now: 1000))
  }
  func testSessionChangeAndExplicitResetStartNewDedupScope() {
    var p = NoLateGuidanceNoticePolicy(); XCTAssertNotNil(p.next(content(), legs: legs, now: 1001))
    XCTAssertNotNil(p.next(content(session: "two"), legs: legs, now: 1002))
    p.reset(); XCTAssertNotNil(p.next(content(), legs: legs, now: 1003))
  }
  func testUnsupportedTopologyAndUnsafeDisplayNamesNeverBecomeInstruction() {
    var p = NoLateGuidanceNoticePolicy(); XCTAssertNil(p.next(content(), legs: [], now: 1001))
    let bad = [legs[0], NoLateGuidanceRouteLeg(index: 1, kind: "BUS", lineName: "bad\nname", alightingStopName: "\0private"), legs[2]]
    XCTAssertEqual(p.next(content("RIDING", alighting: "ONE_STOP_BEFORE"), legs: bad, now: 1001)?.body,
      "다음 정류장은 목표 정류장입니다. 하차를 준비해 주세요.")
  }
}
