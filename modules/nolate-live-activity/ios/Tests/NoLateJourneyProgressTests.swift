import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyProgressTests: XCTestCase {
  func testOnlyActiveJourneyPayloadOpensTheGuidanceScreen() {
    XCTAssertFalse(NoLateLiveActivityPresentation.opensJourney(status: .inTransit, journey: nil))
    XCTAssertFalse(NoLateLiveActivityPresentation.opensJourney(status: .preparing, journey: nil))
    XCTAssertTrue(NoLateLiveActivityPresentation.opensJourney(status: .inTransit, journey: journey()))
    XCTAssertFalse(NoLateLiveActivityPresentation.opensJourney(status: .arrived, journey: journey(phase: .arrived)))
    XCTAssertFalse(NoLateLiveActivityPresentation.opensJourney(status: .cancelled, journey: journey(phase: .stopped)))
  }

  func testLegacyPayloadStillDecodesWithoutJourneyOrLegIndex() throws {
    let json = """
    {"revision":1,"travelMinutes":20,"recommendedDepartureEpochSeconds":1000,
    "updatedAtEpochSeconds":900,"actionExpiresAtEpochSeconds":3000,"status":"preparing",
    "routeSegments":[{"kind":"walk","label":"도보","colorHex":"#AAAAAA"}]}
    """
    let decoded = try JSONDecoder().decode(NoLateDepartureContentState.self, from: Data(json.utf8))
    XCTAssertNil(decoded.journey)
    XCTAssertNil(decoded.routeSegments.first?.legIndex)
    XCTAssertEqual(decoded.status, .preparing)
  }

  func testJourneyWireRoundTripsWithoutChangingOuterIdentityOrClocks() throws {
    let original = state(journey: journey())
    let data = try JSONEncoder().encode(original)
    XCTAssertEqual(try JSONDecoder().decode(NoLateDepartureContentState.self, from: data), original)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let wire = try XCTUnwrap(object["journey"] as? [String: Any])
    XCTAssertEqual(object["status"] as? String, "inTransit")
    XCTAssertEqual(wire["phase"] as? String, "RIDING")
    XCTAssertEqual(wire["observedAtEpochSeconds"] as? Int, 1_000)
    XCTAssertEqual(wire["activeLegIndex"] as? Int, 1)
    XCTAssertEqual(wire["sequence"] as? Int, 5)
    XCTAssertEqual(original.revision, 100)
  }

  func testValidationRejectsMalformedProgressBeforeNativeMutation() throws {
    XCTAssertNoThrow(try NoLateLiveActivityPolicy.validateJourney(journey(), status: .inTransit))
    for invalid in [
      journey(sessionId: " "), journey(generation: -1), journey(sequence: -1),
      journey(activeLegIndex: -1), journey(legProgress: -0.1), journey(legProgress: 1.1),
      journey(legProgress: .nan), journey(overallProgress: 1.1), journey(remainingStops: -1),
      journey(nextInstruction: ""), journey(nextInstruction: String(repeating: "가", count: 121))
    ] {
      XCTAssertThrowsError(try NoLateLiveActivityPolicy.validateJourney(invalid, status: .inTransit))
    }
    XCTAssertThrowsError(try NoLateLiveActivityPolicy.validateJourney(journey(), status: .preparing))
    XCTAssertThrowsError(try NoLateLiveActivityPolicy.validateJourney(journey(phase: .stopped), status: .inTransit))
    XCTAssertNoThrow(try NoLateLiveActivityPolicy.validateJourney(journey(phase: .stopped), status: .cancelled))
  }

  func testDepartureRefreshCannotRemoveActiveJourneyEvenWithNewOuterRevision() {
    XCTAssertEqual(rejection(journey(), incoming: state(journey: nil, revision: 999, status: .preparing)), "JOURNEY_REQUIRED")
    XCTAssertNil(NoLateLiveActivityPolicy.journeyUpdateRejection(
      current: state(journey: nil, status: .preparing), incoming: state(journey: journey())
    ))
  }

  func testSessionGenerationSequenceAndRouteRevisionFenceLateUpdates() {
    let previous = journey()
    XCTAssertEqual(rejection(previous, next: journey(generation: 0, sequence: 99)), "STALE_JOURNEY_GENERATION")
    XCTAssertEqual(rejection(previous, next: journey(sessionId: "other", sequence: 6)), "JOURNEY_SESSION_CONFLICT")
    XCTAssertEqual(rejection(previous, next: journey(sequence: 4)), "STALE_JOURNEY_SEQUENCE")
    XCTAssertEqual(rejection(previous, next: journey(legProgress: 0.8)), "JOURNEY_SEQUENCE_CONFLICT")
    XCTAssertEqual(rejection(previous, next: journey(routeRevision: 0, sequence: 6)), "STALE_ROUTE_REVISION")
    XCTAssertNil(rejection(previous, next: previous))
    XCTAssertNil(rejection(previous, next: journey(sessionId: "new-session", generation: 2, sequence: 0)))
  }

  func testSameRouteDoesNotRegressButNewRouteCanStartEarlier() {
    let previous = journey()
    XCTAssertEqual(rejection(previous, next: journey(sequence: 6, activeLegIndex: 0)), "JOURNEY_PROGRESS_REGRESSION")
    XCTAssertEqual(rejection(previous, next: journey(sequence: 6, legProgress: 0.1)), "JOURNEY_PROGRESS_REGRESSION")
    XCTAssertEqual(rejection(previous, next: journey(sequence: 6, observedAt: 999)), "STALE_JOURNEY_OBSERVATION")
    XCTAssertNil(rejection(previous, next: journey(routeRevision: 2, sequence: 6, activeLegIndex: 0, legProgress: 0)))
    XCTAssertNil(rejection(journey(phase: .transferring, activeLegIndex: 2), next: journey(sequence: 6, phase: .waiting, activeLegIndex: 3, legProgress: 0)))
  }

  func testArrivalAndStopCannotBeResurrectedByDelayedProgress() throws {
    let active = state(journey: journey())
    for status in [NoLateLiveActivityStatus.arrived, .cancelled] {
      let terminal = active.replacingStatus(status, revision: 101, updatedAtEpochSeconds: 1_100)
      XCTAssertEqual(terminal.journey?.phase, status == .arrived ? .arrived : .stopped)
      XCTAssertEqual(terminal.journey?.sequence, 6)
      XCTAssertNoThrow(try NoLateLiveActivityPolicy.validateJourney(XCTUnwrap(terminal.journey), status: status))
      XCTAssertEqual(NoLateLiveActivityPolicy.journeyUpdateRejection(
        current: terminal, incoming: state(journey: journey(sequence: 20), revision: 200)
      ), "TERMINAL_STATE")
    }
    XCTAssertEqual(active.replacingStatus(.arrived, revision: 101, updatedAtEpochSeconds: 1_100).journey?.overallProgress, 1)
  }

  func testLongRouteProjectionRetainsCurrentSourceLegAndDestination() {
    let input = (0..<12).map { (index: Int) in
      NoLateRouteSegment(kind: .bus, label: "\(index)번", colorHex: "#123456", legIndex: index)
    }
    let projected = NoLateLiveActivityPolicy.normalizedRouteSegments(input, activeLegIndex: 9)
    XCTAssertEqual(projected.count, 6)
    XCTAssertTrue(projected.contains { $0.legIndex == 9 })
    XCTAssertEqual(projected.last?.kind, .destination)
    XCTAssertEqual(projected.dropLast().compactMap(\.legIndex), [7, 8, 9, 10, 11])
  }

  func testAdjacentIdenticalServicesKeepTheirDistinctLegIndexes() {
    let input = [0, 1].map { NoLateRouteSegment(kind: .walk, label: "도보", colorHex: "#AAAAAA", legIndex: $0) }
    XCTAssertEqual(NoLateLiveActivityPolicy.normalizedRouteSegments(input).count, 3)
  }

  func testCompactCopyUsesRemainingStopsOnlyWhileRiding() {
    XCTAssertEqual(journey(remainingStops: 3).compactLabel, "3정거장")
    XCTAssertEqual(journey(phase: .waiting, remainingStops: 3).compactLabel, "대기")
    XCTAssertEqual(journey(phase: .transferring).compactLabel, "환승")
    XCTAssertEqual(journey(phase: .arrived).compactLabel, "도착")
  }

  private func rejection(_ previous: NoLateJourneyProgress, next: NoLateJourneyProgress) -> String? {
    rejection(previous, incoming: state(journey: next, revision: 101))
  }

  private func rejection(_ previous: NoLateJourneyProgress, incoming: NoLateDepartureContentState) -> String? {
    NoLateLiveActivityPolicy.journeyUpdateRejection(current: state(journey: previous), incoming: incoming)
  }

  private func state(
    journey: NoLateJourneyProgress?, revision: Int64 = 100, status: NoLateLiveActivityStatus = .inTransit
  ) -> NoLateDepartureContentState {
    NoLateDepartureContentState(
      revision: revision, travelMinutes: 20, firstWaitMinutes: nil,
      predictedArrivalEpochSeconds: nil, recommendedDepartureEpochSeconds: 900,
      updatedAtEpochSeconds: 1_000, actionExpiresAtEpochSeconds: 3_000,
      status: status, routeSegments: [NoLateRouteSegment(kind: .bus, label: "7016", colorHex: "#123456", legIndex: 1)],
      journey: journey
    )
  }

  private func journey(
    sessionId: String = "journey-1", generation: Int64 = 1, routeRevision: Int64 = 1,
    sequence: Int64 = 5, phase: NoLateJourneyPhase = .riding, activeLegIndex: Int = 1,
    legProgress: Double = 0.5, remainingStops: Int? = 3, nextInstruction: String = "다음 정류장에서 하차하세요",
    observedAt: Int64 = 1_000, overallProgress: Double? = 0.4
  ) -> NoLateJourneyProgress {
    NoLateJourneyProgress(
      sessionId: sessionId, generation: generation, routeRevision: routeRevision, sequence: sequence,
      phase: phase, activeLegIndex: activeLegIndex, currentStopIndex: 3, remainingStops: remainingStops,
      legProgress: legProgress, nextInstruction: nextInstruction, observedAtEpochSeconds: observedAt,
      overallProgress: overallProgress
    )
  }
}
