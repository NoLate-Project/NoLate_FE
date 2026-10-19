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
  func testNoVehicleEvidenceCannotPromoteCandidate() throws {
    var (ride, approach) = try make(); candidate(&ride, &approach)
    for i in 7...9 { step(&ride, &approach, i, Double(i - 3) * 40, 1000 + Double(i) * 4, vehicles: []) }
    XCTAssertFalse(ride.snapshot.boardingConfirmed)
    XCTAssertEqual(ride.snapshot.reason, "VEHICLE_ASSOCIATION_UNAVAILABLE")
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
    step(&ride, &approach, 7, 160, 1028, vehicles: [vehicle(160, 1028, age: 15)])
    XCTAssertEqual(ride.snapshot.reason, "VEHICLE_ASSOCIATION_UNAVAILABLE")
    XCTAssertNil(ride.snapshot.validUntil)
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
