import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateGuidanceRoutePositionTests: XCTestCase {
  func testProviderGlyphContrastChoosesBlackOrWhiteWithoutChangingRouteColor() {
    XCTAssertTrue(NoLateGuidanceRouteLayoutPolicy.darkIconInk("#FFF5A0"))
    XCTAssertFalse(NoLateGuidanceRouteLayoutPolicy.darkIconInk("#000040"))
    func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    for r in stride(from: 0, through: 255, by: 51) {
      for g in stride(from: 0, through: 255, by: 51) {
        for b in stride(from: 0, through: 255, by: 51) {
          let hex = String(format: "#%02X%02X%02X", r, g, b)
          let l = 0.2126 * linear(Double(r)/255) + 0.7152 * linear(Double(g)/255) + 0.0722 * linear(Double(b)/255)
          let contrast = NoLateGuidanceRouteLayoutPolicy.darkIconInk(hex) ? (l + 0.05)/0.05 : 1.05/(l + 0.05)
          XCTAssertGreaterThanOrEqual(contrast, 4.5, hex)
        }
      }
    }
  }
  private let legs = ["WALK", "BUS", "WALK", "SUBWAY", "WALK"].enumerated().map { NoLateGuidanceRouteLeg(index: $0.offset, kind: $0.element) }
  func testPlannedTimeProportionsMoveGPSWithinWeightedWalkOnly() {
    let route = [NoLateGuidanceRouteLeg(index: 0, kind: "WALK", durationMinutes: 2, distanceMeters: 100),
      .init(index: 1, kind: "BUS", lineName: "601", lineColor: "#E8752B", durationMinutes: 5, distanceMeters: 800),
      .init(index: 2, kind: "WALK", durationMinutes: 2, distanceMeters: 100)]
    let layout = NoLateGuidanceRouteLayoutPolicy.layout(route)
    XCTAssertEqual(layout.basis, "TIME"); XCTAssertEqual(layout.fractions, [2.0/9, 5.0/9, 2.0/9])
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(content(), legs: route, now: 1021)?.barFraction, 0.6 * (2.0/9))
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(content(phase: "WAITING", index: 1, progress: 1), legs: route, now: 1021)?.barFraction, 2.0/9)
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.label(route[1]), "601")
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.safeColor("e8752b"), "#E8752B")
    XCTAssertNil(NoLateGuidanceRouteLayoutPolicy.safeColor("red")); XCTAssertNil(NoLateGuidanceRouteLayoutPolicy.safeName("bad\nname"))
    XCTAssertNil(NoLateGuidanceRouteLayoutPolicy.safeColor("ABCDEF\n"))
    XCTAssertFalse(NoLateGuidanceRouteLayoutPolicy.validTopology([.init(index: 3, kind: "BUS")]))
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.layout([.init(index: 3, kind: "BUS")]).fractions, [])
  }
  func testDistanceFallbackRequiresAllLegsAndNeverMixesTimeWithDistance() {
    let route = [NoLateGuidanceRouteLeg(index: 0, kind: "WALK", durationMinutes: 2, distanceMeters: 100),
      .init(index: 1, kind: "BUS", distanceMeters: 800), .init(index: 2, kind: "WALK", distanceMeters: 100)]
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.layout(route).basis, "DISTANCE")
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.layout(route).fractions, [0.1, 0.8, 0.1])
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.layout(Array(route.prefix(2)) + [.init(index: 2, kind: "WALK")]).basis, "EQUAL")
  }
  func testLongMetadataBudgetFallsBackUniformlyAndPreservesThirtyTwoOriginalLegs() throws {
    let route = (0..<32).map { NoLateGuidanceRouteLeg(index: $0, kind: $0 == 0 ? "WALK" : "BUS",
      lineName: String(repeating: "가", count: 60), lineColor: "#E8752B", durationMinutes: 2) }
    let bounded = NoLateGuidanceRouteLayoutPolicy.budgeted(route)
    XCTAssertEqual(bounded.map(\.index), Array(0..<32)); XCTAssertEqual(bounded.map(\.kind), route.map(\.kind))
    XCTAssertTrue(bounded.allSatisfy { $0.lineName == nil && $0.durationMinutes == nil })
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.layout(bounded).basis, "EQUAL")
    XCTAssertLessThan(try JSONEncoder().encode(bounded).count, 2201)
    let legacy = try JSONDecoder().decode(NoLateGuidanceRouteLeg.self, from: Data("{\"index\":0,\"kind\":\"WALK\"}".utf8))
    XCTAssertNil(legacy.lineName); XCTAssertNil(legacy.durationMinutes)
  }
  func testFirstWalkPositionsUseFullTopologyNotWholeTripPercent() {
    for progress in [0.0, 0.25, 0.6, 1.0] {
      let position = NoLateGuidanceRoutePositionPolicy.position(content(progress: progress), legs: legs, now: 1021)
      XCTAssertEqual(position?.legIndex, 0)
      XCTAssertEqual(position?.legProgress, progress)
      XCTAssertEqual(position?.barFraction, progress / 5)
    }
  }
  func testWaitingRemainsAtBoardingBoundaryNotBusEnd() {
    let position = NoLateGuidanceRoutePositionPolicy.position(content(phase: "WAITING", index: 1, progress: 1), legs: legs, now: 1021)
    XCTAssertEqual(position?.barFraction, 0.2)
    XCTAssertEqual(position?.legIndex, 0)
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(content(phase: "WAITING", index: 1, progress: 0.6), legs: legs, now: 1021))
  }
  func testClockCannotMovePositionAndStalenessHidesIt() {
    let value = content()
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1021),
      NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1034))
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1035))
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1021, isStale: true))
  }
  func testNoFabricatedRideOrCandidatePositions() {
    for value in [content(phase: "BOARDING_CANDIDATE"), content(phase: "RIDING", index: 1),
      content(index: 1), content(quality: "UNCERTAIN"), content(status: "ARMED"), content(status: "STOPPED"),
      content(progress: nil), content(progress: .nan), content(progress: 1.1), content(progress: -0.1),
      content(observed: 1030), content(until: 1040)] {
      XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1021))
    }
  }
  func testV2RideMarkerUsesBusSegmentOnlyAndItsOriginalShorterTTL() throws {
    func ride(progress: Double? = 0.5, confirmed: Bool = true, index: Int = 1, walk: Double? = nil) -> NoLateGuidanceContent {
      .init(sessionId: "session", scheduleId: "9001", generation: 1, routeRevision: 1, routeInputDigest: String(repeating: "a", count: 64),
        sequence: 20, status: "ACTIVE", phase: "RIDING", quality: "GOOD", instruction: "버스로 이동 중", activeLegIndex: index,
        walkProgress: walk, observedAt: 1020, validUntil: 1025, rideProgress: progress, boardingConfirmed: confirmed)
    }
    let value = ride()
    XCTAssertEqual(try XCTUnwrap(NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1021)?.barFraction), 0.3, accuracy: 0.000001)
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1024)?.legIndex, 1)
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1025))
    for bad in [ride(confirmed: false), ride(index: 0), ride(walk: 0.5), ride(progress: nil), ride(progress: .nan), ride(progress: 1.1)] {
      XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(bad, legs: legs, now: 1021))
    }
    let copy = NoLateGuidancePresentationPolicy.presentation(value, legs: legs, now: 1021)
    XCTAssertEqual(copy.action, "버스로 이동 중"); XCTAssertFalse(copy.action.contains("%"))
    XCTAssertNil(NoLateGuidancePresentationPolicy.freshArrival(value, legs: legs, now: 1021))
    let legacy = try JSONDecoder().decode(NoLateGuidanceContent.self, from: JSONEncoder().encode(content()))
    XCTAssertNil(legacy.rideProgress); XCTAssertFalse(legacy.boardingConfirmed)
  }
  func testInvalidTopologyRejectedAndThirtyTwoLegsPreserved() throws {
    for route in [[], [.init(index: 0, kind: "BUS")], [.init(index: 3, kind: "WALK")], [.init(index: 0, kind: "BAD")]] as [[NoLateGuidanceRouteLeg]] {
      XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(content(), legs: route, now: 1021))
    }
    let route = (0..<32).map { NoLateGuidanceRouteLeg(index: $0, kind: $0 == 0 ? "WALK" : "BUS") }
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(content(progress: 1), legs: route, now: 1021)?.barFraction, 1.0 / 32)
    XCTAssertLessThan(try JSONEncoder().encode(route).count, 1200)
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(content(), legs: route + [.init(index: 32, kind: "WALK")], now: 1021))
    XCTAssertEqual(try JSONDecoder().decode([NoLateGuidanceRouteLeg].self, from: JSONEncoder().encode(route)), route)
  }
  private func content(phase: String = "WALKING_TO_STOP", index: Int = 0, progress: Double? = 0.6,
    quality: String = "GOOD", status: String = "ACTIVE", observed: Double = 1020, until: Double = 1035) -> NoLateGuidanceContent {
    .init(sessionId: "session", scheduleId: "9001", generation: 1, routeRevision: 1, routeInputDigest: String(repeating: "a", count: 64),
      sequence: 10, status: status, phase: phase, quality: quality, instruction: "시험", activeLegIndex: index,
      walkProgress: progress, observedAt: observed, validUntil: until)
  }

  func testWalkingCopyUsesRemainingGeometryDistanceAndVerifiedPlaceNotPercentage() {
    let route = [NoLateGuidanceRouteLeg(index: 0, kind: "WALK", walkingLengthMeters: 200),
      .init(index: 1, kind: "BUS", boardingStopName: "구로역")]
    let value = NoLateGuidancePresentationPolicy.presentation(content(progress: 0.5), legs: route, now: 1021)
    XCTAssertEqual(value.title, "구로역까지")
    XCTAssertEqual(value.action, "도보 약 100m")
    XCTAssertEqual(value.compact, "도보 약 100m")
    XCTAssertFalse(value.action.contains("%"))
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(content(progress: 0.51), legs: route, now: 1021).action, "도보 약 100m")
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(content(progress: 1), legs: route, now: 1021).action, "승차 지점 근처")
  }

  func testWaitingCopyUsesStopNameButNeverClaimsOnboardOrNextStop() {
    let route = [NoLateGuidanceRouteLeg(index: 0, kind: "WALK", walkingLengthMeters: 200),
      .init(index: 1, kind: "BUS", boardingStopName: "구로역")]
    let value = NoLateGuidancePresentationPolicy.presentation(content(phase: "WAITING", index: 1, progress: 1), legs: route, now: 1021)
    XCTAssertEqual(value.title, "구로역")
    XCTAssertEqual(value.action, "버스 대기 · 도착하면 탑승 준비")
    XCTAssertEqual(value.symbol, "bus.fill")
  }

  func testMissingInvalidAndLegacyMetadataCannotInventDistanceOrPlace() throws {
    let legacy = try JSONDecoder().decode(NoLateGuidanceRouteLeg.self, from: Data("{\"index\":0,\"kind\":\"WALK\"}".utf8))
    XCTAssertNil(legacy.walkingLengthMeters)
    XCTAssertNil(legacy.boardingStopName)
    for length in [nil, .nan, .infinity, -1, 100_001] as [Double?] {
      let route = [NoLateGuidanceRouteLeg(index: 0, kind: "WALK", walkingLengthMeters: length),
        .init(index: 1, kind: "BUS", boardingStopName: "구로\n역")]
      let value = NoLateGuidancePresentationPolicy.presentation(content(), legs: route, now: 1021)
      XCTAssertEqual(value.title, "승차 지점까지")
      XCTAssertEqual(value.action, "도보로 이동 중")
    }
  }

  func testUncertainExpiredOrCandidateCopyHidesPreciseLocationAndDistance() {
    let route = [NoLateGuidanceRouteLeg(index: 0, kind: "WALK", walkingLengthMeters: 200),
      .init(index: 1, kind: "BUS", boardingStopName: "구로역")]
    for value in [content(quality: "UNCERTAIN"), content(phase: "BOARDING_CANDIDATE"), content(phase: "RIDING", index: 1), content(until: 1021)] {
      XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(value, legs: route, now: 1021).title, "위치 확인 중")
    }
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(content(), legs: route, now: 1021, isStale: true).symbol, "location.slash")
  }

  func testArrivalFooterRequiresBothFreshLocationAndFreshWaitingInformation() {
    func value(_ arrival: NoLateGuidanceArrival, status: String = "WAITING_INFORMATION") -> NoLateGuidanceContent {
      .init(sessionId: "session", scheduleId: "9001", generation: 1, routeRevision: 1, routeInputDigest: String(repeating: "a", count: 64),
        sequence: 10, status: "ACTIVE", phase: "WAITING", quality: "GOOD", instruction: "시험", activeLegIndex: 1,
        walkProgress: 1, observedAt: 1020, validUntil: 1035, arrivalStatus: status, arrival: arrival)
    }
    let arrival = NoLateGuidanceArrival(providerRouteId: "route", directionLabel: "종점 방면", expectedAt: 1100, sourceUpdatedAt: 1020, validUntil: 1100)
    XCTAssertNotNil(NoLateGuidancePresentationPolicy.freshArrival(value(arrival), legs: legs, now: 1021))
    XCTAssertNil(NoLateGuidancePresentationPolicy.freshArrival(value(arrival), legs: legs, now: 1035))
    XCTAssertNil(NoLateGuidancePresentationPolicy.freshArrival(value(arrival), legs: legs, now: 1021, isStale: true))
    XCTAssertNil(NoLateGuidancePresentationPolicy.freshArrival(value(arrival, status: "STALE"), legs: legs, now: 1021))
    for invalid in [NoLateGuidanceArrival(providerRouteId: "route", directionLabel: "종점 방면", expectedAt: 1021, sourceUpdatedAt: 1020, validUntil: 1021),
      .init(providerRouteId: "route", directionLabel: "종점 방면", expectedAt: 1100, sourceUpdatedAt: 1000, validUntil: 1021),
      .init(providerRouteId: "route", directionLabel: "종점 방면", expectedAt: 1100, sourceUpdatedAt: 1030, validUntil: 1100)] {
      XCTAssertNil(NoLateGuidancePresentationPolicy.freshArrival(value(invalid), legs: legs, now: 1021))
    }
  }
}
