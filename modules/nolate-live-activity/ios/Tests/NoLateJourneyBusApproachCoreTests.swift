import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyBusApproachCoreTests: XCTestCase {
  private typealias Bus = NoLateJourneyBusApproachCore
  private typealias Engine = NoLateJourneyEngineCore
  private let identity = Engine.Identity(sessionId: "bus-test", generation: 1, routeRevision: 1, epoch: 1)
  private let metersPerDegree = 6_371_000.0 * Double.pi / 180

  func testPreparedBusDoesNotClaimLocationWaitingOrBoarding() throws {
    let core = try makeCore()
    XCTAssertEqual(core.snapshot.phase, .walkingToStop)
    XCTAssertEqual(core.snapshot.quality, .unavailable)
    XCTAssertNil(core.snapshot.distanceToBoardMeters)
    XCTAssertNil(core.snapshot.alongRouteMeters)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 0)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testWalkingCorridorAllowsApproachingBeforeBusShapeBegins() throws {
    var core = try makeCore()
    XCTAssertTrue(core.ingest(sample(0, meters: 0), now: 1_000))
    XCTAssertEqual(core.snapshot.phase, .walkingToStop)
    XCTAssertNil(core.snapshot.alongRouteMeters)
    XCTAssertTrue(core.ingest(sample(1, meters: 130, at: 1_008), now: 1_008))
    XCTAssertEqual(core.snapshot.phase, .approachingStop)
    XCTAssertEqual(try XCTUnwrap(core.snapshot.distanceToBoardMeters), 70, accuracy: 0.01)
    XCTAssertNil(core.snapshot.alongRouteMeters)
    XCTAssertEqual(core.snapshot.quality, .good)
  }

  func testApproachThresholdIsNotAlreadyWaiting() throws {
    var core = try makeCore()
    core.ingest(sample(0, meters: 130), now: 1_000)
    XCTAssertEqual(core.snapshot.phase, .approachingStop)
    core.ingest(sample(1, meters: 180), now: 1_004)
    XCTAssertEqual(core.snapshot.phase, .approachingStop)
    XCTAssertEqual(core.snapshot.reason, "STOP_DWELL_ACCUMULATING")
  }

  func testDwellRequiresTwelveSecondsAndThreeOrMoreFreshObservations() throws {
    var core = try makeCore()
    for index in 0...2 { core.ingest(sample(index, meters: 200), now: 1_000 + Double(index) * 4) }
    XCTAssertEqual(core.snapshot.phase, .approachingStop)
    core.ingest(sample(3, meters: 200), now: 1_012)
    XCTAssertEqual(core.snapshot.phase, .waiting)
    XCTAssertEqual(core.snapshot.quality, .good)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testSingleObservationAndElapsedTimeCannotInventWaiting() throws {
    var core = try makeCore()
    core.ingest(sample(0, meters: 200), now: 1_000)
    core.tick(now: 1_013)
    XCTAssertNotEqual(core.snapshot.phase, .waiting)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 0)
  }

  func testMovingPastStopAtWalkingSpeedDoesNotSatisfyDwell() throws {
    var core = try makeCore()
    for (index, meters) in [175.0, 181, 187, 193, 199, 205, 211, 217, 223, 229, 235].enumerated() {
      core.ingest(sample(index, meters: meters), now: 1_000 + Double(index) * 4)
      XCTAssertNotEqual(core.snapshot.phase, .waiting)
      XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
    }
  }

  func testLargeDwellDisplacementResetsNearStopEvidence() throws {
    var core = try makeCore()
    core.ingest(sample(0, meters: 180), now: 1_000)
    core.ingest(sample(1, meters: 180), now: 1_004)
    core.ingest(sample(2, meters: 194), now: 1_008)
    core.ingest(sample(3, meters: 194), now: 1_012)
    XCTAssertNotEqual(core.snapshot.phase, .waiting)
  }

  func testWaitingHysteresisRetainsNearStopStateOutsideEntryRadius() throws {
    var core = try makeCore(); waitAtStop(&core)
    core.ingest(sample(4, meters: 230), now: 1_016)
    XCTAssertEqual(core.snapshot.phase, .waiting)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 1)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testSustainedVehicleLikeMovementOnlyCreatesUnconfirmedCandidate() throws {
    var core = try makeCore(); waitAtStop(&core)
    core.ingest(sample(4, meters: 240), now: 1_016)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 1)
    XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
    core.ingest(sample(5, meters: 280), now: 1_020)
    XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
    core.ingest(sample(6, meters: 320), now: 1_024)
    XCTAssertEqual(core.snapshot.phase, .boardingCandidate)
    XCTAssertEqual(core.snapshot.quality, .good) // Observation quality, NOT a vehicle/boarding confirmation.
    XCTAssertEqual(core.snapshot.reason, "BOARDING_CANDIDATE_VEHICLE_UNVERIFIED")
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 3)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testSpeedWithoutWaitingEvidenceNeverCreatesCandidate() throws {
    var core = try makeCore()
    for index in 0...5 {
      core.ingest(sample(index, meters: 200 + Double(index) * 40), now: 1_000 + Double(index) * 4)
      XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
    }
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testOneHertzVehicleMotionAccumulatesIndependentSpeedWindows() throws {
    var core = try makeCore(); waitAtStop(&core)
    for index in 1...14 {
      core.ingest(sample(index + 3, meters: 200 + Double(index) * 10, at: 1_012 + Double(index)), now: 1_012 + Double(index))
      if index < 14 { XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate) }
    }
    XCTAssertEqual(core.snapshot.phase, .boardingCandidate)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 3)
    XCTAssertEqual(core.snapshot.quality, .good)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testStationaryCallbacksInsideSpeedWindowDoNotEraseVehicleEvidence() throws {
    var core = try makeCore(); waitAtStop(&core)
    var sequence = 4
    // Quantized movement: 30m every two seconds, with a stationary callback between each move.
    for step in 1...7 {
      let time = 1_012 + Double(step) * 2
      core.ingest(sample(sequence, meters: 200 + Double(step) * 30, at: time), now: time); sequence += 1
      core.ingest(sample(sequence, meters: 200 + Double(step) * 30, at: time + 1), now: time + 1); sequence += 1
    }
    XCTAssertEqual(core.snapshot.phase, .boardingCandidate)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testTwentyMeterAccuracyExtendsAmbiguousWindowsWithoutDiscardingWaiting() throws {
    var core = try makeCore()
    waitAtStop(&core, accuracy: 20)
    XCTAssertEqual(core.snapshot.phase, .waiting)
    for index in 1...23 {
      let time = 1_012 + Double(index)
      core.ingest(sample(index + 3, meters: 200 + Double(index) * 10, accuracy: 20, at: time), now: time)
      if index == 6 {
        XCTAssertEqual(core.snapshot.reason, "BOARDING_SPEED_AMBIGUOUS")
        XCTAssertEqual(core.snapshot.boardingEvidenceCount, 0)
      }
      if index < 23 { XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate) }
    }
    XCTAssertEqual(core.snapshot.phase, .boardingCandidate)
    XCTAssertEqual(core.snapshot.quality, .good)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 3)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testTwentyMeterAccuracyRequiresStrongerSustainedDisplacementToProveCandidate() throws {
    var core = try makeCore()
    for index in 0...3 { core.ingest(sample(index, meters: 200, accuracy: 20), now: 1_000 + Double(index) * 4) }
    for index in 1...14 {
      let time = 1_012 + Double(index)
      core.ingest(sample(index + 3, meters: 200 + Double(index) * 15, accuracy: 20, at: time), now: time)
    }
    XCTAssertEqual(core.snapshot.phase, .boardingCandidate)
    XCTAssertEqual(core.snapshot.quality, .good)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 3)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testMaximumAcceptedAccuracyNeedsThreeLongerIndependentWindows() throws {
    var core = try makeCore(); waitAtStop(&core, accuracy: 25)
    for index in 1...29 {
      let time = 1_012 + Double(index)
      core.ingest(sample(index + 3, meters: 200 + Double(index) * 10, accuracy: 25, at: time), now: time)
      if index == 11 { XCTAssertEqual(core.snapshot.boardingEvidenceCount, 1) }
      if index == 20 { XCTAssertEqual(core.snapshot.boardingEvidenceCount, 2) }
      if index < 29 { XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate) }
    }
    XCTAssertEqual(core.snapshot.phase, .boardingCandidate)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 3)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testTwentyMeterAccuracyWalkingMotionNeverCreatesCandidate() throws {
    var core = try makeCore(); waitAtStop(&core, accuracy: 20)
    var sawTimeout = false
    for index in 1...60 {
      let time = 1_012 + Double(index)
      core.ingest(sample(index + 3, meters: 200 + Double(index) * 2, accuracy: 20, at: time), now: time)
      sawTimeout = sawTimeout || core.snapshot.reason == "BOARDING_SPEED_WINDOW_TIMEOUT"
      XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
      XCTAssertEqual(core.snapshot.boardingEvidenceCount, 0)
    }
    XCTAssertTrue(sawTimeout)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testStationaryAccuracyDriftTimesOutWithoutAnyBoardingEvidence() throws {
    var core = try makeCore(); waitAtStop(&core, accuracy: 25)
    // Two fixes with 25m accuracy may be 50m apart without proving any physical displacement.
    for index in 1...3 {
      let time = 1_012 + Double(index) * 4
      core.ingest(sample(index + 3, meters: 250, accuracy: 25, at: time), now: time)
      XCTAssertEqual(core.snapshot.boardingEvidenceCount, 0)
      XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
    }
    assertUnavailable(core, reason: "BOARDING_SPEED_WINDOW_TIMEOUT")
  }

  func testAmbiguousWindowCannotSurviveItsBudgetWithoutAnotherCallback() throws {
    var core = try makeCore(); waitAtStop(&core, accuracy: 25)
    core.ingest(sample(4, meters: 250, accuracy: 25), now: 1_016)
    XCTAssertEqual(core.snapshot.reason, "BOARDING_SPEED_AMBIGUOUS")
    core.tick(now: 1_024.001)
    assertUnavailable(core, reason: "BOARDING_SPEED_WINDOW_TIMEOUT")
  }

  func testSpeedUpperBoundBelowThresholdProvesWalkingAndClearsWaitingOutsideStop() throws {
    var core = try makeCore(); waitAtStop(&core, accuracy: 0)
    var sawWalkingDeparture = false
    for index in 1...26 {
      let time = 1_012 + Double(index)
      core.ingest(sample(index + 3, meters: 200 + Double(index) * 2, accuracy: 0, at: time), now: time)
      if core.snapshot.reason == "LEFT_STOP_WITHOUT_VEHICLE_EVIDENCE" {
        sawWalkingDeparture = true
        XCTAssertEqual(core.snapshot.phase, .walkingToStop)
      }
      XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
    }
    XCTAssertTrue(sawWalkingDeparture)
    XCTAssertEqual(core.snapshot.quality, .good)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 0)
  }

  func testTwentyMeterAccuracyWithQuantizedMovementAndStationaryCallbacksCanFormCandidate() throws {
    var core = try makeCore(); waitAtStop(&core, accuracy: 20)
    var sequence = 4
    for step in 1...8 {
      let time = 1_012 + Double(step) * 2
      let meters = 200 + Double(step) * 30
      core.ingest(sample(sequence, meters: meters, accuracy: 20, at: time), now: time); sequence += 1
      core.ingest(sample(sequence, meters: meters, accuracy: 20, at: time + 1), now: time + 1); sequence += 1
    }
    XCTAssertEqual(core.snapshot.phase, .boardingCandidate)
    XCTAssertEqual(core.snapshot.quality, .good)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testAmbiguousTimeoutClearsPreviouslyQualifiedIndependentWindow() throws {
    var core = try makeCore(); waitAtStop(&core, accuracy: 20)
    core.ingest(sample(4, meters: 264, accuracy: 20), now: 1_016)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 1)
    for index in 5...7 {
      core.ingest(sample(index, meters: 284, accuracy: 20), now: 1_000 + Double(index) * 4)
    }
    assertUnavailable(core, reason: "BOARDING_SPEED_WINDOW_TIMEOUT")
  }

  func testSpeedWindowBudgetIsTwelveSecondsAndCannotBeConfiguredAboveIt() throws {
    var policy = Bus.Policy()
    XCTAssertEqual(policy.maximumSpeedWindowSeconds, 12)
    policy.minimumSpeedWindowSeconds = 13
    policy.minimumBoardingSeconds = 20
    XCTAssertThrowsError(try makeCore(policy: policy))
  }

  func testWalkingAwayClearsWaitingRatherThanLaterReusingIt() throws {
    var core = try makeCore(); waitAtStop(&core)
    for index in 4...12 { core.ingest(sample(index, meters: 200 + Double(index - 3) * 6), now: 1_000 + Double(index) * 4) }
    XCTAssertNotEqual(core.snapshot.phase, .waiting)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 0)
    for index in 13...16 { core.ingest(sample(index, meters: 254 + Double(index - 12) * 40), now: 1_000 + Double(index) * 4) }
    XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
  }

  func testAccuracyAdjustedSpeedDoesNotMistakeNoisySlowMovementForVehicle() throws {
    var core = try makeCore(); waitAtStop(&core)
    for index in 4...7 {
      core.ingest(sample(index, meters: 200 + Double(index - 3) * 20, accuracy: 10), now: 1_000 + Double(index) * 4)
    }
    XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
  }

  func testCandidateStaysOnlyCandidateWhenVehicleLikeMotionContinuesOrPauses() throws {
    var core = try makeCore(); makeCandidate(&core)
    core.ingest(sample(7, meters: 360), now: 1_028)
    core.ingest(sample(8, meters: 360), now: 1_032)
    core.ingest(sample(9, meters: 360), now: 1_036)
    core.tick(now: 1_037) // A completed candidate has no pending speed window to time out.
    XCTAssertEqual(core.snapshot.phase, .boardingCandidate)
    XCTAssertEqual(core.snapshot.quality, .good)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }

  func testStaleCandidateIsClearedAndNumbersDisappear() throws {
    var core = try makeCore(); makeCandidate(&core)
    core.tick(now: 1_040)
    assertUnavailable(core, reason: "BUS_LOCATION_STALE")
    core.ingest(sample(7, meters: 360, at: 1_041), now: 1_041)
    XCTAssertNotEqual(core.snapshot.phase, .boardingCandidate)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 0)
  }

  func testReverseMovementClearsCandidateAndNumbers() throws {
    var core = try makeCore(); makeCandidate(&core)
    core.ingest(sample(7, meters: 290), now: 1_028)
    assertUnavailable(core, reason: "BUS_REVERSE_MOVEMENT")
  }

  func testOffRouteCandidateIsClearedAndNumbersDisappear() throws {
    var core = try makeCore(); makeCandidate(&core)
    core.ingest(sample(7, meters: 360, north: 40), now: 1_028)
    assertUnavailable(core, reason: "BUS_OFF_ROUTE")
  }

  func testLowAccuracyInvalidAndFutureSamplesNeverKeepCandidateNumbers() throws {
    for observation in [sample(7, meters: 360, accuracy: 26), sample(7, meters: 360, accuracy: -1),
                        sample(7, meters: 360, north: 11_000_000), sample(7, meters: 360, at: 1_031)] {
      var core = try makeCore(); makeCandidate(&core)
      XCTAssertFalse(core.ingest(observation, now: 1_028))
      XCTAssertEqual(core.snapshot.phase, .unavailable)
      XCTAssertEqual(core.snapshot.quality, .uncertain)
      XCTAssertNil(core.snapshot.distanceToBoardMeters)
      XCTAssertNil(core.snapshot.alongRouteMeters)
      XCTAssertFalse(core.snapshot.boardingConfirmed)
    }
  }

  func testGPSJumpAndImpossibleSpeedAreRejected() throws {
    var jumped = try makeCore(); waitAtStop(&jumped)
    jumped.ingest(sample(4, meters: 390), now: 1_016)
    assertUnavailable(jumped, reason: "BUS_GPS_JUMP")
    var fast = try makeCore(); waitAtStop(&fast)
    fast.ingest(sample(4, meters: 300, at: 1_013), now: 1_013)
    assertUnavailable(fast, reason: "BUS_GPS_JUMP")
  }

  func testForeignIdentityAndDuplicateSequenceCannotMutateState() throws {
    var core = try makeCore(); waitAtStop(&core)
    let before = core.snapshot
    core.ingest(sample(3, meters: 240, at: 1_016), now: 1_016)
    XCTAssertEqual(core.snapshot, before)
    let foreign = Engine.Observation(identity: .init(sessionId: "foreign", generation: 1, routeRevision: 1, epoch: 1),
      sequence: 4, observedAt: 1_016, coordinate: point(240), horizontalAccuracyMeters: 5, source: .replay)
    core.ingest(foreign, now: 1_016)
    XCTAssertEqual(core.snapshot, before)
  }

  func testOldTimestampWithNewSequenceClearsCandidate() throws {
    var core = try makeCore(); makeCandidate(&core)
    core.ingest(sample(7, meters: 320, at: 1_024), now: 1_025)
    assertUnavailable(core, reason: "BUS_LOCATION_OUT_OF_ORDER")
  }

  func testSourceCannotPromoteReplayToRealProviderObservation() throws {
    var core = try makeCore()
    let observation = Engine.Observation(identity: identity, sequence: 0, observedAt: 1_000,
      coordinate: point(200), horizontalAccuracyMeters: 5, source: .realLocation)
    core.ingest(observation, now: 1_000)
    assertUnavailable(core, reason: "BUS_SOURCE_MISMATCH")
  }

  func testRestoreDropsWaitingAndBoardingEvidenceAndFreshness() throws {
    for candidate in [false, true] {
      var original = try makeCore(); if candidate { makeCandidate(&original) } else { waitAtStop(&original) }
      let encoded = try JSONEncoder().encode(original.snapshot)
      let snapshot = try JSONDecoder().decode(Bus.Snapshot.self, from: encoded)
      var restored = try Bus(restoring: snapshot, now: 1_030)
      XCTAssertEqual(restored.snapshot.phase, .walkingToStop)
      XCTAssertEqual(restored.snapshot.quality, .unavailable)
      XCTAssertEqual(restored.snapshot.reason, "RESTORED_NEEDS_FRESH_LOCATION")
      XCTAssertNil(restored.snapshot.distanceToBoardMeters)
      XCTAssertNil(restored.snapshot.alongRouteMeters)
      XCTAssertEqual(restored.snapshot.boardingEvidenceCount, 0)
      restored.ingest(sample(100, meters: 360, at: 1_032), now: 1_032)
      XCTAssertNotEqual(restored.snapshot.phase, .boardingCandidate)
    }
  }

  func testRestoreAfterClockRegressionFailsClosed() throws {
    var core = try makeCore(); makeCandidate(&core)
    XCTAssertThrowsError(try Bus(restoring: core.snapshot, now: 1_023))
    core.tick(now: 1_023)
    XCTAssertTrue(core.snapshot.terminated)
    assertUnavailable(core, reason: "BUS_CLOCK_REGRESSION")
  }

  func testStopAndExpiryStayUnavailableAcrossRestoreAndNewObservations() throws {
    var stopped = try makeCore(); makeCandidate(&stopped); stopped.stop(now: 1_025)
    var restored = try Bus(restoring: stopped.snapshot, now: 1_030)
    XCTAssertTrue(restored.snapshot.terminated)
    XCTAssertFalse(restored.ingest(sample(100, meters: 400, at: 1_032), now: 1_032))
    XCTAssertEqual(restored.snapshot.phase, .unavailable)
    var expired = try makeCore(); waitAtStop(&expired); expired.tick(now: 1_600)
    XCTAssertEqual(expired.snapshot.reason, "BUS_SESSION_EXPIRED")
    XCTAssertNil(expired.snapshot.distanceToBoardMeters)
    XCTAssertEqual(try Bus(restoring: expired.snapshot, now: 1_601).snapshot.phase, .unavailable)
  }

  func testUnsafeSnapshotCountsAndConfirmationClaimsAreRejected() throws {
    let core = try makeCore()
    for patch: [String: Any] in [["boardingConfirmed": true], ["boardingEvidenceCount": 1_001],
                                ["boardingEvidenceCount": -1], ["sequence": Int64.max], ["schemaVersion": 2]] {
      let corrupt = try mutate(core.snapshot, patch: patch)
      XCTAssertThrowsError(try Bus(restoring: corrupt, now: 1_010))
    }
  }

  func testNearMaximumSequenceNeverOverflows() throws {
    let original = try makeCore()
    let nearMaximum = try mutate(original.snapshot, patch: ["sequence": Int64.max - 2])
    var restored = try Bus(restoring: nearMaximum, now: 1_001)
    for index in 0..<5 { restored.ingest(sample(index, meters: 200, at: 1_002 + Double(index)), now: 1_002 + Double(index)) }
    XCTAssertEqual(restored.snapshot.sequence, Int64.max)
    XCTAssertFalse(restored.snapshot.boardingConfirmed)
  }

  func testInvalidRoutePolicyAndLifetimeAreRejected() throws {
    var policy = Bus.Policy(); policy.waitRadiusMeters = .nan
    XCTAssertThrowsError(try makeCore(policy: policy))
    policy = .init(); policy.minimumDwellObservations = 1_001
    XCTAssertThrowsError(try makeCore(policy: policy))
    let wrong = Bus.Route(legIndex: 2, boardingCoordinate: point(200), walkingCoordinates: [point(0), point(200)],
                          coordinates: [point(200), point(1_000)], provenance: .syntheticReplay)
    XCTAssertThrowsError(try Bus(identity: identity, route: wrong, armedAt: 1_000, expiresAt: 1_600))
  }

  private func makeCore(policy: Bus.Policy = .init()) throws -> Bus {
    try Bus(identity: identity, route: .init(legIndex: 1, boardingCoordinate: point(200),
      walkingCoordinates: [point(0), point(100), point(200)], coordinates: [point(200), point(600), point(1_000)],
      provenance: .syntheticReplay), policy: policy, armedAt: 1_000, expiresAt: 1_600)
  }
  private func point(_ east: Double, north: Double = 0) -> Engine.Coordinate {
    .init(latitude: north / metersPerDegree, longitude: east / metersPerDegree)
  }
  private func sample(_ sequence: Int, meters: Double, north: Double = 0, accuracy: Double = 5, at: Double? = nil) -> Engine.Observation {
    .init(identity: identity, sequence: Int64(sequence), observedAt: at ?? 1_000 + Double(sequence) * 4,
      coordinate: point(meters, north: north), horizontalAccuracyMeters: accuracy, source: .replay)
  }
  private func waitAtStop(_ core: inout Bus, accuracy: Double = 5) {
    for index in 0...3 { core.ingest(sample(index, meters: 200, accuracy: accuracy), now: 1_000 + Double(index) * 4) }
  }
  private func makeCandidate(_ core: inout Bus) {
    waitAtStop(&core)
    for index in 4...6 { core.ingest(sample(index, meters: 200 + Double(index - 3) * 40), now: 1_000 + Double(index) * 4) }
  }
  private func assertUnavailable(_ core: Bus, reason: String, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(core.snapshot.phase, .unavailable, file: file, line: line)
    XCTAssertEqual(core.snapshot.quality, .uncertain, file: file, line: line)
    XCTAssertEqual(core.snapshot.reason, reason, file: file, line: line)
    XCTAssertNil(core.snapshot.distanceToBoardMeters, file: file, line: line)
    XCTAssertNil(core.snapshot.alongRouteMeters, file: file, line: line)
    XCTAssertEqual(core.snapshot.boardingEvidenceCount, 0, file: file, line: line)
    XCTAssertFalse(core.snapshot.boardingConfirmed, file: file, line: line)
  }
  private func mutate(_ snapshot: Bus.Snapshot, patch: [String: Any]) throws -> Bus.Snapshot {
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot)) as? [String: Any])
    object.merge(patch) { _, new in new }
    return try JSONDecoder().decode(Bus.Snapshot.self, from: JSONSerialization.data(withJSONObject: object))
  }
}
