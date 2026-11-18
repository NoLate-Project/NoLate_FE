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
    let departure = p.next(content(), legs: legs, now: 1001)
    XCTAssertEqual(departure?.kind, "DEPARTURE")
    XCTAssertEqual(departure?.body, "이동을 감지했습니다. 승차까지 안내합니다.")
    XCTAssertNil(p.next(content(), legs: legs, now: 1002))
    XCTAssertNil(p.next(content(at: 1003, sequence: 2), legs: legs, now: 1004))
  }
  func testFreshSubwayArrivalWithinTwoMinutesCreatesOnePlatformNotice() {
    let subwayLegs = [legs[0], NoLateGuidanceRouteLeg(index: 1, kind: "SUBWAY",
      boardingStopName: "강남", lineName: "2호선", alightingStopName: "선릉"), legs[2]]
    let arrival = NoLateGuidanceArrival(providerRouteId: "2호선", directionLabel: "성수행",
      expectedAt: 1110, sourceUpdatedAt: 990, validUntil: 1110, busLegIndex: 1, kind: "SUBWAY")
    let waiting = NoLateGuidanceContent(sessionId: "one", scheduleId: "9001", generation: 1,
      routeRevision: 1, routeInputDigest: String(repeating: "a", count: 64), sequence: 1,
      status: "ACTIVE", phase: "WAITING", quality: "GOOD", instruction: "열차 대기",
      activeLegIndex: 1, walkProgress: 1, observedAt: 1000, validUntil: 1015,
      arrivalStatus: "WAITING_INFORMATION", arrival: arrival)
    var policy = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(waiting, legs: subwayLegs, now: 1001).action,
      "성수행 열차 약 2분 뒤 도착 · 탑승 전")
    XCTAssertEqual(policy.next(waiting, legs: subwayLegs, now: 1001)?.body,
      "2호선 · 약 2분 후 도착 예정입니다. 탑승을 준비해 주세요.")
    XCTAssertNil(policy.next(waiting, legs: subwayLegs, now: 1002))
  }
  func testNearPlatformWalkingShowsSubwayArrivalWithoutClaimingBoardingOrRepeatingNotice() {
    let subwayLegs = [legs[0], NoLateGuidanceRouteLeg(index: 1, kind: "SUBWAY",
      boardingStopName: "강남", lineName: "2호선", alightingStopName: "선릉"), legs[2]]
    let arrival = NoLateGuidanceArrival(providerRouteId: "2호선", directionLabel: "성수행",
      expectedAt: 1110, sourceUpdatedAt: 990, validUntil: 1110, busLegIndex: 1, kind: "SUBWAY")
    func walking(_ progress: Double) -> NoLateGuidanceContent {
      .init(sessionId: "one", scheduleId: "9001", generation: 1, routeRevision: 1,
        routeInputDigest: String(repeating: "a", count: 64), sequence: 1,
        status: "ACTIVE", phase: "WALKING_TO_STOP", quality: "GOOD", instruction: "승차역으로 이동 중",
        activeLegIndex: 0, walkProgress: progress, observedAt: 1000, validUntil: 1015,
        arrivalStatus: "WAITING_INFORMATION", arrival: arrival, boardingConfirmed: false)
    }
    XCTAssertNil(NoLateGuidancePresentationPolicy.freshArrival(walking(0.89), legs: subwayLegs, now: 1001))
    XCTAssertEqual(NoLateGuidancePresentationPolicy.freshArrival(walking(0.95), legs: subwayLegs, now: 1001)?.kind, "SUBWAY")
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(walking(0.95), legs: subwayLegs, now: 1001).compact,
      "열차 약 2분")
    var policy = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(policy.next(walking(0.95), legs: subwayLegs, now: 1001)?.kind, "ARRIVAL_SOON")
    let waiting = NoLateGuidanceContent(sessionId: "one", scheduleId: "9001", generation: 1,
      routeRevision: 1, routeInputDigest: String(repeating: "a", count: 64), sequence: 2,
      status: "ACTIVE", phase: "WAITING", quality: "GOOD", instruction: "열차 대기",
      activeLegIndex: 1, walkProgress: 1, observedAt: 1002, validUntil: 1017,
      arrivalStatus: "WAITING_INFORMATION", arrival: arrival)
    XCTAssertNil(policy.next(waiting, legs: subwayLegs, now: 1003))
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
      var q = NoLateGuidanceNoticePolicy()
      XCTAssertEqual(q.next(content("WAITING", eta: eta), legs: legs, now: 1001)?.kind, "BOARDING_STOP_REACHED")
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
  func testFirstReliablePositionAtBoardingStopAnnouncesCurrentStageNotLateDeparture() {
    var p = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(p.next(content("WAITING"), legs: legs, now: 1001)?.body,
      "승차에 도착했습니다. 탑승할 노선을 확인해 주세요.")
    XCTAssertNil(p.next(content("WAITING", at: 1002, sequence: 2), legs: legs, now: 1003))
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
