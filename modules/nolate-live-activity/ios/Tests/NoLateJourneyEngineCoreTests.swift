import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyEngineCoreTests: XCTestCase {
  private typealias Core = NoLateJourneyEngineCore
  private let identity = Core.Identity(sessionId: "departure-test", generation: 1, routeRevision: 2, epoch: 3)
  private let metersPerDegree = 6_371_000.0 * Double.pi / 180

  func testArmingDoesNotMeanDeparting() throws {
    let core = try makeCore()
    XCTAssertEqual(core.snapshot.status, .armed)
    XCTAssertNil(core.snapshot.departureEventKey)
    XCTAssertEqual(core.snapshot.evidenceCount, 0)
  }

  func testProjectionClampsBeforeAndAfterRoute() throws {
    let route = route()
    XCTAssertEqual(try XCTUnwrap(Core.project(point(-20), onto: route)).alongRouteMeters, 0, accuracy: 0.01)
    let beyond = try XCTUnwrap(Core.project(point(220), onto: route))
    XCTAssertEqual(beyond.alongRouteMeters, 200, accuracy: 0.01)
    XCTAssertEqual(beyond.crossTrackMeters, 20, accuracy: 0.01)
  }

  func testProjectionAccumulatesPolylineDistanceAroundCorner() throws {
    let bent = Core.Route(coordinates: [point(0), point(100), point(100, north: 100)], provenance: .syntheticReplay)
    let projected = try XCTUnwrap(Core.project(point(100, north: 50), onto: bent))
    XCTAssertEqual(projected.segmentIndex, 1)
    XCTAssertEqual(projected.alongRouteMeters, 150, accuracy: 0.01)
    XCTAssertEqual(projected.routeLengthMeters, 200, accuracy: 0.01)
    XCTAssertEqual(projected.crossTrackMeters, 0, accuracy: 0.01)
  }

  func testProjectionReportsCrossTrackDistance() throws {
    let projected = try XCTUnwrap(Core.project(point(60, north: 20), onto: route()))
    XCTAssertEqual(projected.alongRouteMeters, 60, accuracy: 0.01)
    XCTAssertEqual(projected.crossTrackMeters, 20, accuracy: 0.01)
  }

  func testProjectionHandlesAntimeridianWithoutWorldLengthJump() throws {
    let route = Core.Route(coordinates: [.init(latitude: 0, longitude: 179.999), .init(latitude: 0, longitude: -179.999)], provenance: .syntheticReplay)
    let result = try XCTUnwrap(Core.project(.init(latitude: 0, longitude: 180), onto: route))
    XCTAssertEqual(result.alongRouteMeters, 111.195, accuracy: 0.1)
    XCTAssertEqual(result.routeLengthMeters, 222.39, accuracy: 0.1)
  }

  func testVerifiedRouteDoesNotAcceptFallbackProvenance() throws {
    XCTAssertThrowsError(try JSONDecoder().decode(Core.GeometryProvenance.self, from: Data("\"FALLBACK_STRAIGHT_LINE\"".utf8)))
    XCTAssertThrowsError(try JSONDecoder().decode(Core.GeometryProvenance.self, from: Data("\"PROVIDER_STOPS_ONLY\"".utf8)))
  }

  func testInvalidGeometryAndShortRoutesAreRejected() throws {
    for coordinates in [[], [point(0)], [point(0), point(0)], [point(0), point(20)], [point(0), .init(latitude: 91, longitude: 0)]] {
      XCTAssertThrowsError(try makeCore(route: .init(coordinates: coordinates, provenance: .syntheticReplay)))
    }
    let repeated = Core.Route(coordinates: [point(0), point(0), point(200)], provenance: .syntheticReplay)
    XCTAssertNoThrow(try makeCore(route: repeated))
  }

  func testInvalidIdentityPolicyAndLifetimeAreRejected() throws {
    XCTAssertThrowsError(try Core(identity: .init(sessionId: "bad:id", generation: 1, routeRevision: 1, epoch: 1), route: route(), armedAt: 1000, expiresAt: 2000))
    XCTAssertThrowsError(try Core(identity: .init(sessionId: "id", generation: -1, routeRevision: 1, epoch: 1), route: route(), armedAt: 1000, expiresAt: 2000))
    var policy = Core.Policy()
    policy.minimumEvidenceCount = 1
    XCTAssertThrowsError(try makeCore(policy: policy))
    policy = Core.Policy(); policy.maximumAccuracyMeters = .nan
    XCTAssertThrowsError(try makeCore(policy: policy))
    XCTAssertThrowsError(try Core(identity: identity, route: route(), armedAt: 1000, expiresAt: 1000))
  }

  func testSustainedForwardMovementDepartsExactlyOnce() throws {
    var core = try makeCore()
    let events = moveToDeparture(&core)
    XCTAssertEqual(events.map(\.type), [.departed])
    XCTAssertEqual(core.snapshot.status, .active)
    XCTAssertEqual(core.snapshot.reason, .departureDetected)
    XCTAssertEqual(core.snapshot.departureEventKey, events[0].eventKey)
    XCTAssertEqual(events[0].identity, identity)
    XCTAssertEqual(events[0].inputSource, .replay)
    XCTAssertTrue(core.ingest(observation(6, meters: 90), now: 1024).isEmpty)
    XCTAssertEqual(core.snapshot.status, .active)
  }

  func testDistanceWithoutEnoughIndependentEvidenceCannotDepart() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    XCTAssertTrue(core.ingest(observation(1, meters: 75, at: 1010), now: 1010).isEmpty)
    XCTAssertEqual(core.snapshot.status, .armed)
    XCTAssertEqual(core.snapshot.evidenceCount, 1)
  }

  func testMinimumDurationIsRequiredEvenWithDistanceAndCount() throws {
    var policy = Core.Policy(); policy.maximumSpeedMetersPerSecond = 40
    var core = try makeCore(policy: policy)
    for (sequence, distance) in [0.0, 25, 50, 75].enumerated() {
      XCTAssertTrue(core.ingest(observation(Int64(sequence), meters: distance, at: 1000 + Double(sequence)), now: 1000 + Double(sequence)).isEmpty)
    }
    XCTAssertEqual(core.snapshot.status, .armed)
    XCTAssertEqual(core.snapshot.evidenceCount, 3)
  }

  func testNoOriginAnchorCannotInferDepartureFromMiddleOfRoute() throws {
    var core = try makeCore()
    for index in 0...5 { _ = core.ingest(observation(Int64(index), meters: 80 + Double(index) * 15), now: 1000 + Double(index) * 4) }
    XCTAssertEqual(core.snapshot.status, .armed)
    XCTAssertEqual(core.snapshot.reason, .noOriginAnchor)
  }

  func testStationaryJitterNeverAccumulatesEvidence() throws {
    var core = try makeCore()
    for index in 0...30 {
      _ = core.ingest(observation(Int64(index), meters: Double(index % 3), at: 1000 + Double(index)), now: 1000 + Double(index))
    }
    XCTAssertEqual(core.snapshot.status, .armed)
    XCTAssertEqual(core.snapshot.evidenceCount, 0)
    XCTAssertEqual(core.snapshot.reason, .stationary)
  }

  func testOneHertzWalkingAccumulatesSmallStepsWithoutFalseStationaryReset() throws {
    var core = try makeCore()
    var events: [Core.Event] = []
    for index in 0...80 {
      events += core.ingest(observation(Int64(index), meters: Double(index), at: 1000 + Double(index)), now: 1000 + Double(index))
    }
    XCTAssertEqual(events.map(\.type), [.departed])
    XCTAssertEqual(core.snapshot.status, .active)
  }

  func testDuplicatePositionCallbacksBetweenMovesDoNotCountAsMovement() throws {
    var core = try makeCore()
    var events: [Core.Event] = []
    for index in 0...24 {
      events += core.ingest(observation(Int64(index), meters: Double(index / 4) * 15, at: 1000 + Double(index)), now: 1000 + Double(index))
    }
    XCTAssertEqual(events.map(\.type), [.departed])
  }

  func testLongStationaryPauseResetsSustainedMovementEvidence() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    _ = core.ingest(observation(1, meters: 15), now: 1004)
    for index in 2...5 { _ = core.ingest(observation(Int64(index), meters: 15), now: 1000 + Double(index) * 4) }
    XCTAssertEqual(core.snapshot.evidenceCount, 0)
    XCTAssertEqual(core.snapshot.status, .armed)
  }

  func testStaleFutureAndNonFiniteTimestampsAreRejected() throws {
    for (time, reason) in [(980.0, Core.Reason.staleObservation), (1003.0, .futureObservation), (.nan, .invalidTimestamp)] {
      var core = try makeCore()
      _ = core.ingest(observation(0, meters: 0, at: time), now: 1000)
      XCTAssertEqual(core.snapshot.reason, reason)
      XCTAssertEqual(core.snapshot.evidenceCount, 0)
    }
  }

  func testLowNegativeAndNonFiniteAccuracyAreRejected() throws {
    for (accuracy, reason) in [(100.0, Core.Reason.lowAccuracy), (-1.0, .invalidAccuracy), (.infinity, .invalidAccuracy)] {
      var core = try makeCore()
      _ = core.ingest(observation(0, meters: 0, accuracy: accuracy), now: 1000)
      XCTAssertEqual(core.snapshot.reason, reason)
    }
  }

  func testInvalidCoordinateIsRejectedWithoutContaminatingSnapshot() throws {
    var core = try makeCore()
    let invalid = Core.Observation(identity: identity, sequence: 0, observedAt: 1000, coordinate: .init(latitude: .nan, longitude: 0), horizontalAccuracyMeters: 8, source: .replay)
    _ = core.ingest(invalid, now: 1000)
    XCTAssertEqual(core.snapshot.reason, .invalidCoordinate)
    XCTAssertNoThrow(try JSONEncoder().encode(core.snapshot))
  }

  func testIdentityFencesDoNotMutateAnotherSession() throws {
    for different in [
      Core.Identity(sessionId: "other", generation: 1, routeRevision: 2, epoch: 3),
      .init(sessionId: identity.sessionId, generation: 0, routeRevision: 2, epoch: 3),
      .init(sessionId: identity.sessionId, generation: 1, routeRevision: 1, epoch: 3),
      .init(sessionId: identity.sessionId, generation: 1, routeRevision: 2, epoch: 2)
    ] {
      var core = try makeCore(); let before = core.snapshot
      _ = core.ingest(observation(0, meters: 0, identity: different), now: 1004)
      XCTAssertEqual(core.snapshot, before)
    }
  }

  func testDuplicateAndOlderSequencesAreIdempotentlyIgnored() throws {
    var core = try makeCore()
    _ = core.ingest(observation(2, meters: 0), now: 1008)
    let before = core.snapshot
    for sequence: Int64 in [-1, 0, 1, 2] {
      XCTAssertTrue(core.ingest(observation(sequence, meters: 75, at: 1012), now: 1012).isEmpty)
      XCTAssertEqual(core.snapshot, before)
    }
  }

  func testTimestampOrderingIsIndependentOfSequenceOrdering() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    _ = core.ingest(observation(1, meters: 20, at: 1000), now: 1004)
    XCTAssertEqual(core.snapshot.reason, .outOfOrderObservation)
  }

  func testGPSJumpIsNotDepartureEvidence() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    _ = core.ingest(observation(1, meters: 100, at: 1001), now: 1001)
    XCTAssertEqual(core.snapshot.reason, .gpsJump)
    XCTAssertEqual(core.snapshot.status, .armed)
  }

  func testReverseMovementBreaksEvidenceChain() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    _ = core.ingest(observation(1, meters: 20), now: 1004)
    _ = core.ingest(observation(2, meters: 10), now: 1008)
    XCTAssertEqual(core.snapshot.reason, .reverseMovement)
    XCTAssertEqual(core.snapshot.evidenceCount, 0)
  }

  func testOffRouteMovementBreaksEvidenceChain() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    let off = Core.Observation(identity: identity, sequence: 1, observedAt: 1004, coordinate: point(20, north: 100), horizontalAccuracyMeters: 8, source: .replay)
    _ = core.ingest(off, now: 1004)
    XCTAssertEqual(core.snapshot.reason, .offRoute)
    XCTAssertEqual(core.snapshot.evidenceCount, 0)
  }

  func testMissingObservationGapDoesNotBridgeMovement() throws {
    var policy = Core.Policy(); policy.maximumObservationAgeSeconds = 60
    var core = try makeCore(policy: policy)
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    _ = core.ingest(observation(1, meters: 25, at: 1025), now: 1025)
    XCTAssertEqual(core.snapshot.reason, .observationGap)
  }

  func testInputSourceCannotPromoteReplayIntoVerifiedLiveEvidence() throws {
    var core = try makeCore(route: route(provenance: .verifiedWalkingPath))
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    XCTAssertEqual(core.snapshot.reason, .sourceMismatch)
    _ = core.ingest(observation(1, meters: 0, source: .realLocation), now: 1004)
    XCTAssertEqual(core.snapshot.inputSource, .realLocation)
    var synthetic = try makeCore()
    _ = synthetic.ingest(observation(0, meters: 0, source: .realLocation), now: 1000)
    XCTAssertEqual(synthetic.snapshot.reason, .sourceMismatch)
  }

  func testTickMarksStaleAndClockRegressionWithoutInventingDeparture() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    XCTAssertTrue(core.tick(now: 1020).isEmpty)
    XCTAssertEqual(core.snapshot.reason, .staleObservation)
    XCTAssertTrue(core.tick(now: 1019).isEmpty)
    XCTAssertEqual(core.snapshot.reason, .clockRegression)
    XCTAssertEqual(core.snapshot.status, .armed)
  }

  func testQualityChangesAdvanceOutputSequenceButRepeatedRejectionIsIdempotent() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    let before = core.snapshot.sequence
    _ = core.tick(now: 1020)
    XCTAssertGreaterThan(core.snapshot.sequence, before)
    let stale = core.snapshot
    _ = core.tick(now: 1020)
    XCTAssertEqual(core.snapshot, stale)
    _ = core.tick(now: 1019)
    XCTAssertGreaterThan(core.snapshot.sequence, stale.sequence)
    let regression = core.snapshot
    _ = core.tick(now: 1019)
    XCTAssertEqual(core.snapshot, regression)
  }

  func testCancellationStillWorksAfterClockMovesBackwards() throws {
    var core = try makeCore()
    _ = core.tick(now: 1010)
    let events = core.stop(now: 990)
    XCTAssertEqual(events.map(\.type), [.stopped])
    XCTAssertEqual(events.first?.observedAt, 1010)
    XCTAssertEqual(core.snapshot.status, .stopped)
  }

  func testUncertainChainBeyondOriginRemainsArmedUntilSafeReanchor() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    _ = core.ingest(observation(1, meters: 20), now: 1004)
    _ = core.ingest(observation(2, meters: 40), now: 1008)
    _ = core.ingest(observation(3, meters: 60, accuracy: 100), now: 1012)
    XCTAssertTrue(core.ingest(observation(4, meters: 70), now: 1016).isEmpty)
    XCTAssertTrue(core.ingest(observation(5, meters: 90), now: 1020).isEmpty)
    XCTAssertEqual(core.snapshot.status, .armed)
    XCTAssertEqual(core.snapshot.reason, .noOriginAnchor)
    _ = core.ingest(observation(6, meters: 0), now: 1024)
    XCTAssertEqual(core.snapshot.reason, .originAnchored)
  }

  func testStopIsTerminalAndEmitsOneIdempotentEvent() throws {
    var core = try makeCore()
    let first = core.stop(now: 1000)
    XCTAssertEqual(first.map(\.type), [.stopped])
    let terminal = core.snapshot
    XCTAssertTrue(core.stop(now: 1001).isEmpty)
    XCTAssertTrue(core.tick(now: 3000).isEmpty)
    XCTAssertTrue(core.ingest(observation(1, meters: 75), now: 1004).isEmpty)
    XCTAssertEqual(core.snapshot, terminal)
  }

  func testExpiryIsTerminalEvenIfAnotherObservationArrives() throws {
    var core = try makeCore()
    XCTAssertEqual(core.tick(now: 2000).map(\.type), [.expired])
    let terminal = core.snapshot
    XCTAssertTrue(core.tick(now: 2001).isEmpty)
    XCTAssertTrue(core.ingest(observation(1, meters: 0, at: 2001), now: 2001).isEmpty)
    XCTAssertEqual(core.snapshot, terminal)
  }

  func testSnapshotRoundTripResetsChainAndPreservesSequenceFence() throws {
    var core = try makeCore()
    _ = core.ingest(observation(0, meters: 0), now: 1000)
    _ = core.ingest(observation(1, meters: 20), now: 1004)
    let decoded = try JSONDecoder().decode(Core.Snapshot.self, from: JSONEncoder().encode(core.snapshot))
    XCTAssertEqual(decoded, core.snapshot)
    var restored = try Core(restoring: decoded, now: 1005)
    XCTAssertEqual(restored.snapshot.evidenceCount, 0)
    XCTAssertEqual(restored.snapshot.reason, .restoredNeedsFreshLocation)
    XCTAssertNil(restored.snapshot.lastObservationAt)
    _ = restored.ingest(observation(1, meters: 0, at: 1006), now: 1006)
    XCTAssertNil(restored.snapshot.lastObservationAt)
    _ = restored.ingest(observation(2, meters: 60), now: 1008)
    XCTAssertEqual(restored.snapshot.reason, .noOriginAnchor)
  }

  func testActiveSnapshotRestoreDoesNotEmitDepartureAgain() throws {
    var core = try makeCore(); let events = moveToDeparture(&core)
    var restored = try Core(restoring: core.snapshot, now: 1021)
    XCTAssertTrue(restored.ingest(observation(6, meters: 90), now: 1024).isEmpty)
    XCTAssertEqual(restored.snapshot.status, .active)
    XCTAssertEqual(restored.snapshot.departureEventKey, events[0].eventKey)
  }

  func testStoppedAndExpiredSnapshotsCannotBeReactivatedByRestore() throws {
    var core = try makeCore(); _ = core.stop(now: 1000)
    var restored = try Core(restoring: core.snapshot, now: 1001)
    XCTAssertTrue(restored.ingest(observation(1, meters: 0), now: 1004).isEmpty)
    XCTAssertEqual(restored.snapshot.status, .stopped)
    let expired = try Core(restoring: makeCore().snapshot, now: 2001)
    XCTAssertEqual(expired.snapshot.status, .expired)
  }

  func testCorruptActiveCheckpointCannotPretendDepartureWasRecorded() throws {
    var checkpoint = try makeCore().snapshot
    checkpoint.status = .active
    XCTAssertThrowsError(try Core(restoring: checkpoint, now: 1001))
    checkpoint.status = .armed
    checkpoint.departureEventKey = "foreign-session-key"
    XCTAssertThrowsError(try Core(restoring: checkpoint, now: 1001))
  }

  func testRestoreRejectsFutureClockAndSourceProvenanceMismatch() throws {
    var checkpoint = try makeCore().snapshot
    checkpoint.lastEvaluationAt = 5000
    XCTAssertThrowsError(try Core(restoring: checkpoint, now: 1001))
    checkpoint.lastEvaluationAt = 1000
    checkpoint.inputSource = .realLocation
    XCTAssertThrowsError(try Core(restoring: checkpoint, now: 1001))
  }

  func testDepartureEventKeyIsStableAcrossEquivalentReplaysAndUniquePerEpoch() throws {
    var first = try makeCore(), second = try makeCore()
    XCTAssertEqual(moveToDeparture(&first).first?.eventKey, moveToDeparture(&second).first?.eventKey)
    let changed = Core.Identity(sessionId: identity.sessionId, generation: 1, routeRevision: 2, epoch: 4)
    var third = try Core(identity: changed, route: route(), armedAt: 1000, expiresAt: 2000)
    var events: [Core.Event] = []
    for index in 0...5 { events += third.ingest(observation(Int64(index), meters: Double(index) * 15, identity: changed), now: 1000 + Double(index) * 4) }
    XCTAssertNotEqual(first.snapshot.departureEventKey, events.first?.eventKey)
  }

  private func point(_ east: Double, north: Double = 0) -> Core.Coordinate {
    .init(latitude: north / metersPerDegree, longitude: east / metersPerDegree)
  }

  private func route(provenance: Core.GeometryProvenance = .syntheticReplay) -> Core.Route {
    .init(coordinates: [point(0), point(200)], provenance: provenance)
  }

  private func makeCore(route custom: Core.Route? = nil, policy: Core.Policy = .init()) throws -> Core {
    try Core(identity: identity, route: custom ?? route(), policy: policy, armedAt: 1000, expiresAt: 2000)
  }

  private func observation(_ sequence: Int64, meters: Double, at: TimeInterval? = nil,
                           accuracy: Double = 8, identity custom: Core.Identity? = nil,
                           source: Core.InputSource = .replay) -> Core.Observation {
    .init(identity: custom ?? identity, sequence: sequence, observedAt: at ?? 1000 + Double(sequence) * 4,
          coordinate: point(meters), horizontalAccuracyMeters: accuracy, source: source)
  }

  @discardableResult
  private func moveToDeparture(_ core: inout Core) -> [Core.Event] {
    var events: [Core.Event] = []
    for index in 0...5 { events += core.ingest(observation(Int64(index), meters: Double(index) * 15), now: 1000 + Double(index) * 4) }
    return events
  }
}
