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
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.legendLabel(route[1]), "601번")
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.legendLabel(.init(index: 1, kind: "BUS", lineName: "361번")), "361번")
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.legendLabel(.init(index: 1, kind: "SUBWAY", lineName: "4호선")), "4호선")
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
  func testLegendIncludesLaterConfirmedRideInRouteOrder() {
    let rides = [
      NoLateGuidanceRouteLeg(index: 1, kind: "SUBWAY", lineName: "4호선"),
      .init(index: 3, kind: "SUBWAY", lineName: "2호선"),
      .init(index: 5, kind: "BUS", lineName: "361"),
      .init(index: 7, kind: "BUS", lineName: "4312"),
      .init(index: 9, kind: "BUS", lineName: "3412")
    ]
    func shown(_ active: Int?, rides: [NoLateGuidanceRouteLeg] = rides) -> [String] {
      NoLateGuidanceRouteLayoutPolicy.visibleRideLegend(rides, activeLegIndex: active)
        .map(NoLateGuidanceRouteLayoutPolicy.legendLabel)
    }
    XCTAssertEqual(shown(nil), ["4호선", "2호선", "361번"])
    XCTAssertEqual(shown(5), ["4호선", "2호선", "361번"])
    XCTAssertEqual(shown(7), ["361번", "4312번", "3412번"])
    XCTAssertEqual(shown(9), ["361번", "4312번", "3412번"])
    XCTAssertEqual(shown(8), ["4호선", "2호선", "361번"])
    XCTAssertEqual(shown(5, rides: Array(rides.prefix(3))), ["4호선", "2호선", "361번"])
  }
  func testSubwayLegendMatchesRouteMapWithoutRecoloringARegionalLine() {
    let rides = [
      NoLateGuidanceRouteLeg(index: 0, kind: "SUBWAY", lineName: "수도권 4 호선", lineColor: "#000000"),
      .init(index: 1, kind: "SUBWAY", lineName: "수도권 2호선"),
      .init(index: 2, kind: "SUBWAY", lineName: "인천 2호선"),
      .init(index: 3, kind: "SUBWAY", lineName: "부산 2호선", lineColor: "81BF48"),
      .init(index: 4, kind: "SUBWAY", lineName: "11호선"),
      .init(index: 5, kind: "SUBWAY")
    ]
    XCTAssertEqual(rides.map(NoLateGuidanceRouteLayoutPolicy.legendLabel), ["4호선", "2호선", "인천2호선", "부산2호선", "11호선", "지하철"])
    XCTAssertEqual(rides.map(NoLateGuidanceRouteLayoutPolicy.routeColor), ["#00A4E3", "#00B140", "#ED8B00", "#81BF48", "#64748B", "#64748B"])
  }
  func testLongMetadataBudgetFallsBackUniformlyAndPreservesThirtyTwoOriginalLegs() throws {
    let route = (0..<32).map { NoLateGuidanceRouteLeg(index: $0, kind: $0 == 0 ? "WALK" : "BUS",
      boardingStopName: String(repeating: "가", count: 64),
      lineName: String(repeating: "가", count: 60), lineColor: "#E8752B", durationMinutes: 2) }
    let bounded = NoLateGuidanceRouteLayoutPolicy.budgeted(route)
    XCTAssertEqual(bounded.map(\.index), Array(0..<32)); XCTAssertEqual(bounded.map(\.kind), route.map(\.kind))
    XCTAssertTrue(bounded.allSatisfy { $0.lineName == nil && $0.durationMinutes == nil })
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.layout(bounded).basis, "EQUAL")
    XCTAssertLessThan(try JSONEncoder().encode(bounded).count, 2201)
    let legacy = try JSONDecoder().decode(NoLateGuidanceRouteLeg.self, from: Data("{\"index\":0,\"kind\":\"WALK\"}".utf8))
    XCTAssertNil(legacy.lineName); XCTAssertNil(legacy.durationMinutes)
  }
  func testMixedRouteWithLongStopNamesKeepsLinesAndPlannedTimeWeights() throws {
    let stop = String(repeating: "가", count: 64)
    let lines = ["수도권 4 호선", "수도권 2호선", "361", "4312"]
    let colors = ["#00A4E3", "#00B140", "#0068B7", "#33A23D"]
    let durations = [4.0, 16, 3, 9, 2, 3, 1, 2, 1]
    let route = durations.enumerated().map { index, time -> NoLateGuidanceRouteLeg in
      if index.isMultiple(of: 2) {
        return .init(index: index, kind: "WALK", walkingLengthMeters: 141.1234567,
          durationMinutes: time, distanceMeters: 141.1234567)
      }
      let ride = index / 2
      return .init(index: index, kind: ride < 2 ? "SUBWAY" : "BUS", boardingStopName: stop,
        lineName: lines[ride], lineColor: colors[ride], durationMinutes: time,
        distanceMeters: 1_234.1234567, alightingStopName: stop)
    }
    XCTAssertGreaterThan(try JSONEncoder().encode(route).count, 2200)
    let bounded = NoLateGuidanceRouteLayoutPolicy.budgeted(route)
    XCTAssertLessThanOrEqual(try JSONEncoder().encode(bounded).count, 2200)
    XCTAssertEqual(bounded.map(\.kind), route.map(\.kind))
    XCTAssertEqual(bounded.map(\.walkingLengthMeters), route.map(\.walkingLengthMeters))
    let rides = bounded.filter { $0.kind != "WALK" }
    XCTAssertEqual(rides.map(NoLateGuidanceRouteLayoutPolicy.legendLabel), ["4호선", "2호선", "361번", "4312번"])
    XCTAssertEqual(rides.map(NoLateGuidanceRouteLayoutPolicy.routeColor), colors)
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.layout(bounded), NoLateGuidanceRouteLayoutPolicy.layout(route))
  }
  func testFirstWalkPositionsUseFullTopologyNotWholeTripPercent() {
    for progress in [0.0, 0.25, 0.6, 1.0] {
      let position = NoLateGuidanceRoutePositionPolicy.position(content(progress: progress), legs: legs, now: 1021)
      XCTAssertEqual(position?.legIndex, 0)
      XCTAssertEqual(position?.legProgress, progress)
      XCTAssertEqual(position?.barFraction, progress / 5)
    }
  }
  func testEndedPresentationHasNoLivePosition() {
    let ended = content(status: "STOPPED")
    let presentation = NoLateGuidancePresentationPolicy.presentation(ended, legs: legs, now: 1021, isStale: true)
    XCTAssertEqual(presentation.title, "위치 안내를 종료했어요")
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(ended, legs: legs, now: 1021))
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
  func testLocalExpiryPublishesUnavailableWithOriginalObservationAndNoMarker() throws {
    let value = NoLateGuidanceContent(sessionId: "session", scheduleId: "9001", generation: 1,
      routeRevision: 2, routeInputDigest: String(repeating: "a", count: 64), sequence: 21,
      status: "ACTIVE", phase: "RIDING", quality: "GOOD", instruction: "버스로 이동 중",
      activeLegIndex: 1, walkProgress: nil, observedAt: 1020, validUntil: 1025,
      rideProgress: 0.5, boardingConfirmed: true, alighting: .init(kind: "NEAR_STOP", remainingMeters: 30))
    XCTAssertNotNil(NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1024))
    XCTAssertNil(value.expiringLocation(at: 1024.99))

    let expired = try XCTUnwrap(value.expiringLocation(at: 1025))
    XCTAssertEqual(expired.sessionId, value.sessionId)
    XCTAssertEqual(expired.scheduleId, value.scheduleId)
    XCTAssertEqual(expired.generation, value.generation)
    XCTAssertEqual(expired.routeRevision, value.routeRevision)
    XCTAssertEqual(expired.routeInputDigest, value.routeInputDigest)
    XCTAssertEqual(expired.sequence, value.sequence)
    XCTAssertEqual(expired.observedAt, value.observedAt)
    XCTAssertEqual(expired.validUntil, value.validUntil)
    XCTAssertEqual(expired.status, "ACTIVE")
    XCTAssertEqual(expired.activeLegIndex, 0)
    XCTAssertTrue(NoLateGuidancePublicationPolicy.isExpiredInvalidation(expired, now: 1025))
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(expired, legs: legs, now: 1025))
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(expired, legs: legs, now: 1025).title, "위치 확인 중")
    XCTAssertNil(expired.expiringLocation(at: 1026))
    for other in [content(status: "ARMED"), content(quality: "UNCERTAIN"), content(until: 1040)] {
      XCTAssertNil(other.locationObservationDeadline)
      XCTAssertNil(other.expiringLocation(at: 1050))
    }
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
    let named = [legs[0], NoLateGuidanceRouteLeg(index: 1, kind: "BUS", lineName: "1711",
      alightingStopName: "경복궁역"), legs[2]]
    let namedCopy = NoLateGuidancePresentationPolicy.presentation(value, legs: named, now: 1021)
    XCTAssertEqual(namedCopy.title, "1711")
    XCTAssertEqual(namedCopy.action, "경복궁역에서 하차")
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

  func testLastConfirmedBusLabelNeverRestoresAStalePosition() throws {
    let legs = [NoLateGuidanceRouteLeg(index: 0, kind: "WALK", walkingLengthMeters: 200),
      NoLateGuidanceRouteLeg(index: 1, kind: "BUS", lineName: "1711"),
      NoLateGuidanceRouteLeg(index: 2, kind: "WALK", walkingLengthMeters: 100)]
    let value = NoLateGuidanceContent(sessionId: "session", scheduleId: "9001", generation: 1,
      routeRevision: 1, routeInputDigest: String(repeating: "a", count: 64), sequence: 11,
      status: "ACTIVE", phase: "UNAVAILABLE", quality: "UNCERTAIN", instruction: "최근 탑승 확인",
      activeLegIndex: 1, walkProgress: nil, observedAt: 1036, validUntil: 1051,
      lastConfirmedBus: .init(legIndex: 1, confirmedAt: 1036))
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(value, legs: legs, now: 1052, isStale: true))
    let label = NoLateGuidancePresentationPolicy.presentation(value, legs: legs, now: 1052, isStale: true)
    XCTAssertEqual(label.title, "마지막 확인 · 1711")
    XCTAssertTrue(label.action.contains("현재 위치 재확인 중"))
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(value, legs: legs, now: 1126, isStale: true).title, "위치 확인 중")
    let decoded = try JSONDecoder().decode(NoLateGuidanceContent.self, from: JSONEncoder().encode(value))
    XCTAssertEqual(decoded.lastConfirmedBus, value.lastConfirmedBus)
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
