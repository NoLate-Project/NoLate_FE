import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyBusDelayedHandoffTests: XCTestCase {
  typealias E = NoLateJourneyEngineCore
  typealias Ride = NoLateJourneyBusRideCore
  typealias Separation = NoLateJourneyBusSeparationCore
  typealias Walk = NoLateJourneyFinalWalkCore
  let identity = E.Identity(sessionId: "delayed-bus-handoff", generation: 1, routeRevision: 1, epoch: 1)

  private func point(_ meters: Double) -> E.Coordinate {
    .init(latitude: 0, longitude: meters / (6_371_000 * .pi / 180))
  }

  private func fix(_ sequence: Int64, _ time: Double, _ meters: Double) -> E.Observation {
    .init(identity: identity, sequence: sequence, observedAt: time, coordinate: point(meters),
      horizontalAccuracyMeters: 2, source: .replay)
  }

  private func walkRoute(subway: Bool = false, transfer: Bool = false) -> Walk.Route {
    .init(identity: identity,
      path: .init(coordinates: [point(1000), point(1100), point(1200)], provenance: .syntheticReplay),
      busPath: .init(coordinates: [point(0), point(1000)], provenance: .syntheticReplay),
      length: 200, destination: point(1200), isTransfer: transfer, isSubwayFinalWalk: subway)
  }

  func testTwoDistinctDelayedBusDepartureFixesFeedFinalAndTransferWalking() {
    let route = Ride.Route(identity: identity, providerRouteId: "999999999", direction: "시험 방면",
      approach: .init(legIndex: 1, boardingCoordinate: point(0),
        walkingCoordinates: [point(-200), point(0)], coordinates: [point(0), point(1000)],
        provenance: .syntheticReplay), departureWindowMeters: 325)
    var separation = Separation(route: route)
    let recent = Ride.RecentConfirmation(vehicleId: "999999998", observedAt: 1000,
      alongRouteMeters: 1000, routeLengthMeters: 1000)
    // Two distinct source fixes, 28 seconds apart, each received 30 seconds late.
    // There is no currently usable vehicle between their expiry and the next source fix.
    for offset in 0...68 {
      let now = 1001 + Double(offset)
      let source = now < 1063 ? 1005.0 : 1033.0
      let past = source == 1005 ? 100.0 : 320.0
      let vehicles: [Ride.Vehicle] = now >= source + 30 && now < source + 45
        ? [.init(id: "999999998", routeId: route.providerRouteId, direction: route.direction,
          coordinate: point(1000 + past), sourceAt: source, receivedAt: now,
          validUntil: source + 45, source: .syntheticReplay, metersPastAlighting: past)] : []
      separation.ingest(fix(Int64(offset + 1), now, 1000), priorRide: nil, associatedId: nil,
        recentRide: recent, vehicles: vehicles, now: now)
      if now == 1050 {
        XCTAssertEqual(separation.snapshot.status, "UNAVAILABLE")
        XCTAssertNil(separation.snapshot.validUntil)
      }
    }
    XCTAssertEqual(separation.snapshot.status, "SEPARATION_OBSERVED")
    XCTAssertEqual(separation.snapshot.evidenceCount, 2)

    for transfer in [false, true] {
      var walking = Walk(route: walkRoute(transfer: transfer))
      for index in 0...5 {
        let now = 1069 + Double(index) * 4
        walking.ingest(fix(Int64(index + 100), now, 1000 + Double(index) * 8),
          separation: index == 0 ? separation.snapshot : nil, now: now)
      }
      XCTAssertTrue(walking.committed, "A confirmed bus departure must reach its walking consumer")
      XCTAssertEqual(walking.snapshot.phase, transfer ? "TRANSFER_WALK" : "FINAL_WALK")
      XCTAssertFalse(walking.arrived)
    }
  }

  func testWalkingKeepsSeparateBusAndSubwayEvidenceThresholds() {
    for (subway, count, accepted) in [(false, 1, false), (true, 2, false), (true, 3, true)] {
      var walking = Walk(route: walkRoute(subway: subway))
      let separation = Separation.Snapshot(status: "SEPARATION_OBSERVED", reason: "test",
        evidenceCount: count, validUntil: 1015)
      for index in 0...5 {
        let now = 1000 + Double(index) * 4
        walking.ingest(fix(Int64(index + 1), now, 1000 + Double(index) * 8),
          separation: index == 0 ? separation : nil, now: now)
      }
      XCTAssertEqual(walking.committed, accepted)
      if !accepted { XCTAssertEqual(walking.snapshot.reason, "FRESH_SEPARATION_REQUIRED") }
    }
  }
}
