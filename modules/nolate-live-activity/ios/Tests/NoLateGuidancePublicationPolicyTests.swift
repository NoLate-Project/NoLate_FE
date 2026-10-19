import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateGuidancePublicationPolicyTests: XCTestCase {
  func testStationDwellPublishesNewFreshEvidenceWithoutRefreshingAnIdenticalOrExpiredObservation() {
    var policy = NoLateGuidancePublicationPolicy()
    XCTAssertEqual(policy.next(content(expiry:1015,observed:1000),now:1000),1000)
    XCTAssertNil(policy.next(content(expiry:1015,observed:1000),now:1005))
    XCTAssertEqual(policy.next(content(expiry:1020,observed:1005),now:1005),1005)
    XCTAssertEqual(policy.next(content(expiry:1025,observed:1010),now:1010),1010)
    XCTAssertNil(policy.next(content(expiry:1025,observed:1010),now:1025))
  }
  func testRideMovementPublishesButCannotRefreshExpiredVehicleEvidence() {
    func riding(_ progress:Double, observed:Double = 1000) -> NoLateGuidanceContent {
      .init(sessionId:"session", scheduleId:"9001", generation:1, routeRevision:1, routeInputDigest:String(repeating:"a",count:64),
        sequence:1, status:"ACTIVE", phase:"RIDING", quality:"GOOD", instruction:"버스로 이동 중", activeLegIndex:1,
        walkProgress:nil, observedAt:observed, validUntil:1015, rideProgress:progress, boardingConfirmed:true)
    }
    var policy = NoLateGuidancePublicationPolicy()
    XCTAssertEqual(policy.next(riding(0.2),now:1000),1000)
    XCTAssertEqual(policy.next(riding(0.4,observed:1005),now:1005),1005)
    XCTAssertNil(policy.next(riding(0.6,observed:1016),now:1016))
    XCTAssertEqual(policy.next(invalidation(),now:1016),1016)
  }
  private func content(progress: Double = 0.2, session: String = "session", expiry: Double = 1100, observed: Double = 1000) -> NoLateGuidanceContent {
    .init(sessionId: session, scheduleId: "9001", generation: 1, routeRevision: 1, routeInputDigest: String(repeating: "a", count: 64),
      sequence: 1, status: "ACTIVE", phase: "WALKING_TO_STOP", quality: "GOOD", instruction: "승차 정류장으로 이동 중",
      activeLegIndex: 0, walkProgress: progress, observedAt: observed, validUntil: expiry)
  }
  func testSameSecondAndRapidUpdatesCoalesceWithoutFutureTimestamp() {
    var policy = NoLateGuidancePublicationPolicy()
    XCTAssertEqual(policy.next(content(), now: 1000.9), 1000)
    XCTAssertNil(policy.next(content(progress: 0.3), now: 1000.99))
    XCTAssertNil(policy.next(content(progress: 0.3), now: 1004.9))
    XCTAssertEqual(policy.next(content(progress: 0.4), now: 1005.1), 1005)
  }
  func testRegressionCannotMakeOldProgressLookNew() {
    var policy = NoLateGuidancePublicationPolicy()
    _ = policy.next(content(), now: 1000)
    XCTAssertNil(policy.next(content(progress: 0.4), now: 990))
    XCTAssertEqual(policy.timestamp, 1000)
    XCTAssertEqual(policy.next(content(progress: 0.5), now: 1005), 1005)
  }
  func testNoPublicationForExpiredOrDifferentSessionOrIdenticalView() {
    var policy = NoLateGuidancePublicationPolicy()
    XCTAssertNil(policy.next(content(expiry: 1000), now: 1000))
    XCTAssertNil(policy.next(content(), now: .nan))
    _ = policy.next(content(), now: 1000)
    XCTAssertNil(policy.next(content(), now: 1005))
    XCTAssertNil(policy.next(content(progress: 0.5, session: "new"), now: 1005))
    XCTAssertEqual(policy.timestamp, 1000)
  }
  func testConfirmedRejectionBlocksNewProgressUntilExplicitNewEpoch() {
    var policy = NoLateGuidancePublicationPolicy()
    XCTAssertEqual(policy.next(content(), now: 1000), 1000)
    policy.rejectTransport()
    XCTAssertTrue(policy.transportBlocked)
    XCTAssertNil(policy.next(content(progress: 0.8), now: 1010))
    XCTAssertEqual(policy.timestamp, 1000)
    policy = .init()
    XCTAssertEqual(policy.next(content(progress: 0.8), now: 1010), 1010)
  }
  private func invalidation(progress: Double? = nil, quality: String = "UNCERTAIN", arrival: NoLateGuidanceArrival? = nil,
    observed: Double = 1000, expiry: Double = 1015, session: String = "session") -> NoLateGuidanceContent {
    .init(sessionId: session, scheduleId: "9001", generation: 1, routeRevision: 1, routeInputDigest: String(repeating: "a", count: 64),
      sequence: 2, status: "ACTIVE", phase: "UNAVAILABLE", quality: quality, instruction: "현재 위치 확인 필요",
      activeLegIndex: 0, walkProgress: progress, observedAt: observed, validUntil: expiry, arrival: arrival)
  }
  func testExpiredInvalidationPublishesOnceWithoutRefreshingObservationAndFreshGPSRecovers() throws {
    var policy = NoLateGuidancePublicationPolicy()
    XCTAssertEqual(policy.next(content(expiry: 1015), now: 1000), 1000)
    let removal = invalidation()
    XCTAssertEqual(policy.next(removal, now: 1016), 1016)
    XCTAssertEqual(removal.observedAt, 1000); XCTAssertEqual(removal.validUntil, 1015)
    XCTAssertNil(policy.next(removal, now: 1025))
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(removal, legs: [.init(index: 0, kind: "WALK")], now: 1016))
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(removal, legs: [], now: 1016).title, "위치 확인 중")
    XCTAssertEqual(policy.next(content(progress: 0.4, expiry: 1045, observed: 1030), now: 1030), 1030)
  }
  func testInvalidationCannotCarryPreciseProgressArrivalFutureObservationOrDifferentSession() {
    let arrival = NoLateGuidanceArrival(providerRouteId: "999999", directionLabel: "합성", expectedAt: 1100, sourceUpdatedAt: 1000, validUntil: 1100)
    for value in [invalidation(progress: 0.4), invalidation(quality: "GOOD"), invalidation(arrival: arrival),
      invalidation(observed: 2000), invalidation(expiry: .nan), invalidation(session: "other")] {
      var policy = NoLateGuidancePublicationPolicy()
      _ = policy.next(content(expiry: 1015), now: 1000)
      XCTAssertNil(policy.next(value, now: 1016))
      XCTAssertEqual(policy.timestamp, 1000)
    }
  }
  func testConfirmedRejectionStillBlocksExpiredInvalidation() {
    var policy = NoLateGuidancePublicationPolicy()
    _ = policy.next(content(expiry: 1015), now: 1000)
    policy.rejectTransport()
    XCTAssertNil(policy.next(invalidation(), now: 1016))
  }
}
