import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyBusRideCoreTests: XCTestCase {
  typealias Ride = NoLateJourneyBusRideCore
  typealias Engine = NoLateJourneyEngineCore
  typealias Approach = NoLateJourneyBusApproachCore
  let identity = Engine.Identity(sessionId: "ride-test", generation: 1, routeRevision: 1, epoch: 1)
  func point(_ meters: Double) -> Engine.Coordinate {
    .init(latitude: 37.5665, longitude: 126.978 + meters / (6_371_000 * cos(37.5665 * .pi / 180) * .pi / 180))
  }
  func route() -> Approach.Route {
    .init(legIndex: 1, boardingCoordinate: point(0), walkingCoordinates: [point(-200), point(0)],
      coordinates: [point(0), point(1000)], provenance: .syntheticReplay)
  }
  func make() throws -> (Ride, Approach) {
    (try Ride(route: .init(identity: identity, providerRouteId: "100100447", direction: "상명대", approach: route()),
      armedAt: 1000, expiresAt: 1500),
     try Approach(identity: identity, route: route(), armedAt: 1000, expiresAt: 1500))
  }
  func location(_ sequence: Int, _ meters: Double, _ time: Double, accuracy: Double = 2) -> Engine.Observation {
    .init(identity: identity, sequence: Int64(sequence), observedAt: time, coordinate: point(meters),
      horizontalAccuracyMeters: accuracy, source: .replay)
  }
  func vehicle(_ meters: Double, _ time: Double, id: String = "100000123", route: String = "100100447",
    direction: String = "상명대", source: Ride.EvidenceSource = .syntheticReplay, age: Double = 0) -> Ride.Vehicle {
    .init(id: id, routeId: route, direction: direction, coordinate: point(meters), sourceAt: time - age,
      receivedAt: time, validUntil: time - age + 15, source: source)
  }
  func step(_ ride: inout Ride, _ approach: inout Approach, _ sequence: Int, _ meters: Double, _ time: Double,
    vehicles: [Ride.Vehicle]? = nil, accuracy: Double = 2) {
    let value = location(sequence, meters, time, accuracy: accuracy)
    approach.ingest(value, now: time)
    ride.ingest(value, approach: approach.snapshot, vehicles: vehicles ?? [vehicle(meters, time)], now: time)
  }
  func candidate(_ ride: inout Ride, _ approach: inout Approach) {
    for i in 0...3 { step(&ride, &approach, i, 0, 1000 + Double(i) * 4) }
    for i in 4...6 { step(&ride, &approach, i, Double(i - 3) * 40, 1000 + Double(i) * 4) }
    XCTAssertEqual(approach.snapshot.phase, .boardingCandidate)
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
  }
  func confirmed(_ ride: inout Ride, _ approach: inout Approach) {
    candidate(&ride, &approach)
    for i in 7...9 { step(&ride, &approach, i, Double(i - 3) * 40, 1000 + Double(i) * 4) }
    XCTAssertTrue(ride.snapshot.boardingConfirmed)
  }

  func testCandidateNeedsDistinctSourceFixesDurationAndCoMovement() throws {
    var (ride, approach) = try make(); candidate(&ride, &approach)
    step(&ride, &approach, 7, 160, 1028)
    step(&ride, &approach, 8, 200, 1032)
    XCTAssertFalse(ride.snapshot.boardingConfirmed) // Three fixes, but only eight seconds.
    step(&ride, &approach, 9, 240, 1036)
    XCTAssertEqual(ride.snapshot.phase, "RIDING")
    XCTAssertEqual(ride.snapshot.quality, "GOOD")
    XCTAssertEqual(try XCTUnwrap(ride.snapshot.alongRouteMeters), 240, accuracy: 0.01)
    XCTAssertEqual(ride.snapshot.observedAt, 1036)
    XCTAssertEqual(ride.snapshot.validUntil, 1051)
  }
  func testSpeedWithoutWaitingHistoryNeverConfirmsBoarding() throws {
    var (ride, approach) = try make()
    for i in 0...9 { step(&ride, &approach, i, Double(i) * 40, 1000 + Double(i) * 4) }
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertNil(ride.snapshot.alongRouteMeters)
  }
  func testSameVehicleFixMovesPassengerMarkerWithoutFresheningEvidenceOrVehicleTTL() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    let count = ride.snapshot.evidenceCount, until = ride.snapshot.validUntil
    step(&ride, &approach, 10, 250, 1037, vehicles: [vehicle(240, 1036)])
    XCTAssertTrue(ride.snapshot.boardingConfirmed)
    XCTAssertEqual(ride.snapshot.evidenceCount, count); XCTAssertEqual(ride.snapshot.validUntil, until)
    XCTAssertEqual(ride.snapshot.observedAt, 1037)
    XCTAssertEqual(try XCTUnwrap(ride.snapshot.alongRouteMeters), 250, accuracy: 0.01)
    ride.tick(now: 1051)
    XCTAssertNil(ride.snapshot.alongRouteMeters); XCTAssertFalse(ride.snapshot.boardingConfirmed)
  }
  func testRecentConfirmationForAlightingKeepsOnlyBoundedPrivateRideEvidence() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    step(&ride, &approach, 10, 265, 1040, vehicles: [])
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertNil(ride.snapshot.alongRouteMeters)
    let recent = try XCTUnwrap(ride.recentConfirmation(now:1040))
    XCTAssertEqual(recent.vehicleId,"100000123")
    XCTAssertEqual(recent.alongRouteMeters,240,accuracy:0.01)
    XCTAssertNil(ride.recentConfirmation(now:1126))
  }
  func testNoVehicleEvidenceCannotPromoteCandidate() throws {
    var (ride, approach) = try make(); candidate(&ride, &approach)
    for i in 7...9 { step(&ride, &approach, i, Double(i - 3) * 40, 1000 + Double(i) * 4, vehicles: []) }
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertEqual(ride.snapshot.reason, "VEHICLE_ASSOCIATION_UNAVAILABLE")
  }
  func testRemoteShapeLoopCanContinueOnlyTheAlreadyConfirmedVehicle() throws {
    var (before, waiting) = try make(); candidate(&before, &waiting)
    var ambiguous = vehicle(160, 1028)
    ambiguous.shapeOccurrenceAmbiguous = true
    step(&before, &waiting, 7, 160, 1028, vehicles: [ambiguous])
    XCTAssertFalse(before.snapshot.boardingConfirmed)
    XCTAssertEqual(before.snapshot.reason, "VEHICLE_ASSOCIATION_UNAVAILABLE")

    var (confirmedRide, confirmedApproach) = try make(); confirmed(&confirmedRide, &confirmedApproach)
    var same = vehicle(280, 1040)
    same.shapeOccurrenceAmbiguous = true
    step(&confirmedRide, &confirmedApproach, 10, 280, 1040, vehicles: [same])
    XCTAssertTrue(confirmedRide.snapshot.boardingConfirmed)
    XCTAssertEqual(confirmedRide.snapshot.phase, "RIDING")
    XCTAssertEqual(confirmedRide.snapshot.lastConfirmedAt, 1040)
  }
  func testSameVehicleCanBeReconfirmedAfterShortProviderGapWithoutReusingOldPosition() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    for i in 10...18 {
      step(&ride, &approach, i, 240 + Double(i - 9) * 25,
           1036 + Double(i - 9) * 4, vehicles: [])
    }
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertNil(ride.snapshot.alongRouteMeters)
    XCTAssertEqual(ride.snapshot.lastConfirmedAt, 1036)
    for i in 19...22 {
      let meters = 240 + Double(i - 9) * 25
      var same = vehicle(meters, 1036 + Double(i - 9) * 4)
      same.shapeOccurrenceAmbiguous = true
      step(&ride, &approach, i, meters, 1036 + Double(i - 9) * 4, vehicles: [same])
      if i < 22 { XCTAssertFalse(ride.snapshot.boardingConfirmed) }
    }
    XCTAssertTrue(ride.snapshot.boardingConfirmed)
    XCTAssertEqual(ride.snapshot.phase, "RIDING")
    XCTAssertEqual(ride.snapshot.lastConfirmedAt, 1088)
  }
  func testRecentConfirmedBusResumesOnlyOnNextDistinctMatchingSourceFix() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    for i in 10...16 {
      step(&ride, &approach, i, 240 + Double(i - 9) * 40,
        1036 + Double(i - 9) * 4, vehicles: [])
    }
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertNil(ride.snapshot.alongRouteMeters)
    let current = location(17, 560, 1068)
    approach.ingest(current, now: 1068)
    let repeated = Ride.Vehicle(id: "100000123", routeId: "100100447", direction: "상명대",
      coordinate: point(240), sourceAt: 1036, receivedAt: 1068, validUntil: 1081,
      source: .syntheticReplay)
    ride.ingest(current, approach: approach.snapshot, vehicles: [repeated], now: 1068)
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertNil(ride.snapshot.alongRouteMeters)
    let next = location(18, 600, 1072)
    approach.ingest(next, now: 1072)
    let fresh = Ride.Vehicle(id: "100000123", routeId: "100100447", direction: "상명대",
      coordinate: point(520), sourceAt: 1064, receivedAt: 1072, validUntil: 1109,
      source: .syntheticReplay)
    ride.ingest(next, approach: approach.snapshot, vehicles: [fresh], now: 1072)
    XCTAssertTrue(ride.snapshot.boardingConfirmed)
    XCTAssertEqual(ride.snapshot.phase, "RIDING")
    XCTAssertEqual(ride.snapshot.evidenceCount, 1)
    XCTAssertEqual(try XCTUnwrap(ride.snapshot.alongRouteMeters), 600, accuracy: 0.01)
  }
  func testDifferentVehicleCannotUseShortProviderGapToReplaceConfirmedRide() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    step(&ride, &approach, 10, 265, 1040, vehicles: [])
    step(&ride, &approach, 11, 290, 1044,
         vehicles: [vehicle(290, 1044, id: "100000124")])
    XCTAssertEqual(ride.snapshot.reason, "ASSOCIATED_VEHICLE_CHANGED")
    XCTAssertNil(ride.snapshot.lastConfirmedAt)
    var same = vehicle(315, 1048)
    same.shapeOccurrenceAmbiguous = true
    step(&ride, &approach, 12, 315, 1048, vehicles: [same])
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
  }
  func testDepartureScopedVehicleCannotBecomeBoardingOrRidingEvidenceEvenAtSameCoordinate() throws {
    var (ride,approach)=try make();candidate(&ride,&approach)
    var departure=vehicle(160,1028);departure.metersPastAlighting=100
    step(&ride,&approach,7,160,1028,vehicles:[departure])
    XCTAssertFalse(ride.snapshot.boardingConfirmed);XCTAssertEqual(ride.snapshot.evidenceCount,0)
    XCTAssertEqual(ride.snapshot.reason,"VEHICLE_ASSOCIATION_UNAVAILABLE")
  }
  func testWrongRouteOppositeDirectionAndProvenanceNeverAssociate() throws {
    for wrong in [vehicle(160, 1028, route: "100100448"), vehicle(160, 1028, direction: "반대"),
      vehicle(160, 1028, source: .verifiedWGS84)] {
      var (ride, approach) = try make(); candidate(&ride, &approach)
      step(&ride, &approach, 7, 160, 1028, vehicles: [wrong])
      XCTAssertEqual(ride.snapshot.reason, "VEHICLE_ASSOCIATION_UNAVAILABLE")
      XCTAssertFalse(ride.snapshot.boardingConfirmed)
    }
  }
  func testDuplicateVehicleAndTwoNearbyBusesRemainAmbiguous() throws {
    var (ride, approach) = try make(); candidate(&ride, &approach)
    step(&ride, &approach, 7, 160, 1028, vehicles: [vehicle(160, 1028), vehicle(160, 1028)])
    XCTAssertEqual(ride.snapshot.reason, "VEHICLE_ASSOCIATION_UNAVAILABLE")
    step(&ride, &approach, 8, 200, 1032,
      vehicles: [vehicle(200, 1032), vehicle(200, 1032, id: "100000124")])
    XCTAssertEqual(ride.snapshot.reason, "VEHICLE_ASSOCIATION_AMBIGUOUS")
    XCTAssertNil(ride.snapshot.alongRouteMeters)
  }
  func testStaleSourceCannotBeFreshenedByReceiptTime() throws {
    var (ride, approach) = try make(); candidate(&ride, &approach)
    step(&ride, &approach, 7, 160, 1028, vehicles: [vehicle(160, 1028, age: 45)])
    XCTAssertEqual(ride.snapshot.reason, "VEHICLE_ASSOCIATION_UNAVAILABLE")
    XCTAssertNil(ride.snapshot.validUntil)
  }
  func testDelayedOfficialCadenceCanConfirmOnlyWithThreeMatchingHistoricalPassengerPositions() throws {
    var (ride, approach) = try make()
    for i in 0...6 {
      let time = 1000 + Double(i) * 4
      let metres = i <= 3 ? 0 : Double(i - 3) * 40
      step(&ride, &approach, i, metres, time, vehicles: [])
    }
    XCTAssertEqual(approach.snapshot.phase, .boardingCandidate)
    for i in 7...30 {
      let time = 1000 + Double(i) * 4
      let metres = 120 + (time - 1024) * 3
      let source: Double? = i >= 30 ? 1088 : i >= 23 ? 1060 : i >= 16 ? 1032 : nil
      let vehicles: [Ride.Vehicle]
      if let source, time < source + 45 {
        let historicalMetres = 120 + (source - 1024) * 3
        vehicles = [.init(id: "100000123", routeId: "100100447", direction: "상명대",
          coordinate: point(historicalMetres), sourceAt: source, receivedAt: time,
          validUntil: source + 45, source: .syntheticReplay)]
      } else { vehicles = [] }
      step(&ride, &approach, i, metres, time, vehicles: vehicles)
      if i < 30 { XCTAssertFalse(ride.snapshot.boardingConfirmed) }
    }
    XCTAssertEqual(ride.snapshot.phase, "RIDING")
    XCTAssertTrue(ride.snapshot.boardingConfirmed)
    XCTAssertEqual(ride.snapshot.evidenceCount, 3)
    XCTAssertEqual(try XCTUnwrap(ride.snapshot.alongRouteMeters), 408, accuracy: 0.01)
  }
  func testSourceTimeAlignsWithHistoricalPassengerPositionNotCurrentPosition() throws {
    var (ride, approach) = try make(); candidate(&ride, &approach)
    // A four-second-old vehicle fix is at the passenger's previous position.
    step(&ride, &approach, 7, 160, 1028, vehicles: [vehicle(120, 1028, age: 4)])
    XCTAssertEqual(ride.snapshot.evidenceCount, 1) // Source did not advance from 1024.
    XCTAssertEqual(ride.snapshot.reason, "VEHICLE_SOURCE_NOT_ADVANCED")
    step(&ride, &approach, 8, 200, 1032, vehicles: [vehicle(160, 1032, age: 4)])
    XCTAssertEqual(ride.snapshot.evidenceCount, 2)
    // The same delayed source placed at current GPS is 40m away from synchronized history.
    step(&ride, &approach, 9, 240, 1036, vehicles: [vehicle(240, 1036, age: 4)])
    XCTAssertEqual(ride.snapshot.reason, "VEHICLE_ASSOCIATION_UNAVAILABLE")
  }
  func testNewVehicleCannotInheritEarlierEvidence() throws {
    var (ride, approach) = try make(); candidate(&ride, &approach)
    step(&ride, &approach, 7, 160, 1028, vehicles: [vehicle(160, 1028, id: "100000124")])
    XCTAssertEqual(ride.snapshot.evidenceCount, 1)
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
  }
  func testAssociatedVehicleChangeInvalidatesRatherThanSilentlySwitching() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    step(&ride, &approach, 10, 280, 1040, vehicles: [vehicle(280, 1040, id: "100000124")])
    XCTAssertEqual(ride.snapshot.reason, "ASSOCIATED_VEHICLE_CHANGED")
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertNil(ride.snapshot.lastConfirmedAt)
  }
  func testTickOnlyExpiresAndNeverAdvancesPosition() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    let along = ride.snapshot.alongRouteMeters
    ride.tick(now: 1050)
    XCTAssertEqual(ride.snapshot.alongRouteMeters, along)
    ride.tick(now: 1051)
    XCTAssertEqual(ride.snapshot.reason, "RIDING_EVIDENCE_STALE")
    XCTAssertNil(ride.snapshot.alongRouteMeters)
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertEqual(ride.snapshot.lastConfirmedAt, 1036)
    ride.tick(now: 1126)
    XCTAssertNil(ride.snapshot.lastConfirmedAt)
  }
  func testOutOfOrderAndDifferentIdentityDoNotMutateState() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    let before = ride.snapshot
    ride.ingest(location(8, 240, 1036), approach: approach.snapshot, vehicles: [], now: 1036)
    XCTAssertEqual(ride.snapshot, before)
    let wrong = Engine.Observation(identity: .init(sessionId: "other", generation: 1, routeRevision: 1, epoch: 1),
      sequence: 10, observedAt: 1040, coordinate: point(280), horizontalAccuracyMeters: 2, source: .replay)
    ride.ingest(wrong, approach: approach.snapshot, vehicles: [], now: 1040)
    XCTAssertEqual(ride.snapshot, before)
  }
  func testPoorGPSAndJumpClearPrecision() throws {
    for (meters, accuracy) in [(280.0, 100.0), (800.0, 2.0)] {
      var (ride, approach) = try make(); confirmed(&ride, &approach)
      step(&ride, &approach, 10, meters, 1040, accuracy: accuracy)
      XCTAssertNil(ride.snapshot.alongRouteMeters)
      XCTAssertFalse(ride.snapshot.boardingConfirmed)
    }
  }
  func testRejectedMovementHidesPositionUntilFreshSameVehicleAndPassengerHistoryAgree() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    step(&ride, &approach, 10, 800, 1040)
    XCTAssertEqual(ride.snapshot.reason, "PASSENGER_MOVEMENT_UNRELIABLE")
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertNil(ride.snapshot.alongRouteMeters)
    XCTAssertNotNil(ride.recentConfirmation(now: 1040))

    step(&ride, &approach, 11, 280, 1044, vehicles: [])
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    step(&ride, &approach, 12, 320, 1048, vehicles: [vehicle(320, 1048)])
    XCTAssertTrue(ride.snapshot.boardingConfirmed)
    XCTAssertEqual(ride.snapshot.phase, "RIDING")
    XCTAssertEqual(try XCTUnwrap(ride.snapshot.alongRouteMeters), 320, accuracy: 0.01)
  }
  func testStopCannotBeReopenedByLaterFreshInputs() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    ride.stop(); let before = ride.snapshot
    step(&ride, &approach, 10, 280, 1040)
    XCTAssertEqual(ride.snapshot, before)
    XCTAssertEqual(ride.snapshot.phase, "STOPPED")
  }
  func testSessionExpiryIsTerminalAndCannotInheritAnotherLifetime() throws {
    var (ride, approach) = try make(); confirmed(&ride, &approach)
    ride.tick(now: 1500)
    XCTAssertEqual(ride.snapshot.reason, "RIDING_SESSION_EXPIRED")
    let before = ride.snapshot
    step(&ride, &approach, 10, 280, 1501)
    XCTAssertEqual(ride.snapshot, before)
    var (other, _) = try make()
    var wrongLifetime = try Approach(identity: identity, route: route(), armedAt: 1000, expiresAt: 1600)
    for i in 0...3 { step(&other, &wrongLifetime, i, 0, 1000 + Double(i) * 4) }
    XCTAssertEqual(other.snapshot.sequence, 0)
  }
  func testInvalidLifetimesAndRouteIdentifiersAreRejected() throws {
    let input = Ride.Route(identity: identity, providerRouteId: "100100447", direction: "상명대", approach: route())
    for (start, end) in [(0.0, 100.0), (1000, 1000), (1000, 8201), (1000, Double.infinity)] {
      XCTAssertThrowsError(try Ride(route: input, armedAt: start, expiresAt: end))
    }
    XCTAssertNoThrow(try Ride(route: input, armedAt: 1000, expiresAt: 8200))
    XCTAssertThrowsError(try Ride(route: .init(identity: identity, providerRouteId: "7016", direction: "상명대", approach: route()),
      armedAt: 1000, expiresAt: 1500))
  }
}
