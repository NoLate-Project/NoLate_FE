import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyAutomaticSessionTests: XCTestCase {
  private typealias Session = NoLateJourneyAutomaticSession
  private let metersPerDegree = 6_371_000.0 * Double.pi / 180

  func testTerminalReconciliationOnlyRevokesItsOwnDormantBinding() throws {
    let session = try makeSession(); let expected = session.binding
    XCTAssertTrue(Session.canReconcileTerminal(expected: expected, checkpoint: expected, live: nil, hasLiveSession: false))
    XCTAssertTrue(Session.canReconcileTerminal(expected: expected, checkpoint: nil, live: nil, hasLiveSession: false))
    XCTAssertFalse(Session.canReconcileTerminal(expected: expected, checkpoint: expected, live: expected, hasLiveSession: true))
    let route = try routeJSON()
    let other = try Session.decodeBinding(bindingJSON(route, patch: ["generation": 2]), now: 1_000)
    XCTAssertFalse(Session.canReconcileTerminal(expected: expected, checkpoint: other, live: nil, hasLiveSession: false))
    XCTAssertFalse(Session.canReconcileTerminal(expected: expected, checkpoint: expected, live: other, hasLiveSession: false))
  }

  func testExpiredBindingCanBeComparedForTerminalCleanupWithoutRestoringInputs() throws {
    let session = try makeSession()
    let encoded = String(decoding: try JSONEncoder().encode(session.binding), as: UTF8.self)
    let expired = try Session.decodeBinding(encoded, now: 5_000)
    XCTAssertTrue(Session.canReconcileTerminal(expected: expired, checkpoint: session.binding, live: nil, hasLiveSession: false))
  }

  func testArmingOnlyPreparesAndCreatesNoDeparture() throws {
    let session = try makeSession()
    XCTAssertEqual(session.core.snapshot.status, .armed)
    XCTAssertNil(session.pendingDeparture)
    XCTAssertNil(session.core.snapshot.departureEventKey)
    XCTAssertFalse(session.departureAcknowledged)
    XCTAssertEqual(session.binding.execution, "SIMULATOR")
    let prepared = NoLateAutomaticGuidanceProjection.content(session, now: 1001)
    XCTAssertEqual(prepared.phase, "READY")
    XCTAssertEqual(prepared.validUntil, session.binding.expiresAtEpochSeconds)
    XCTAssertNil(prepared.observedAt)
    XCTAssertNil(prepared.walkProgress)
  }

  func testActualRoutePreparationKeepsGeometryProvenanceButExecutionIsSimulator() throws {
    let route = try routeJSON(context: "ROUTING_RESPONSE")
    let session = try Session(routeJSON: route, bindingJSON: bindingJSON(route, scope: "LOCAL_ONLY"), now: 1_000)
    XCTAssertEqual(session.core.snapshot.route.provenance, .verifiedWalkingPath)
    XCTAssertEqual(session.inputSource, .realLocation)
    XCTAssertEqual(session.binding.execution, "SIMULATOR")
  }

  func testAuthenticatedDeviceFieldTrialPreservesDeviceExecutionThroughDeparture() throws {
    let route = try routeJSON(context: "ROUTING_RESPONSE")
    let binding = try bindingJSON(route, scope: "AUTHENTICATED", patch: [
      "execution": "DEVICE", "apiOrigin": "https://nolate.example.com", "authMemberId": 42,
      "loginGeneration": 1, "savedRouteValidated": true, "guidanceEnabled": true])
    var session = try Session(routeJSON: route, bindingJSON: binding, now: 1_000)
    XCTAssertEqual(session.binding.execution, "DEVICE")
    XCTAssertEqual(session.inputSource, .realLocation)
    depart(&session)
    XCTAssertEqual(session.pendingDeparture?.execution, "DEVICE")
    XCTAssertThrowsError(try Session(routeJSON: route,
      bindingJSON: bindingJSON(route, scope: "SANDBOX", patch: ["execution": "DEVICE"]), now: 1_000))
  }

  func testSyntheticRequiresSandboxAndStaysSyntheticReplay() throws {
    let session = try makeSession()
    XCTAssertEqual(session.core.snapshot.route.provenance, .syntheticReplay)
    XCTAssertEqual(session.inputSource, .replay)
    let route = try routeJSON()
    XCTAssertThrowsError(try Session(routeJSON: route, bindingJSON: bindingJSON(route, scope: "LOCAL_ONLY"), now: 1_000))
    XCTAssertThrowsError(try NoLateJourneyRouteNormalizer.prepareWalkingRoute(json: route))
  }

  func testSyntheticAllowanceDoesNotBypassOtherGeometryFailures() throws {
    var route = try routeDictionary(); var legs = try XCTUnwrap(route["legs"] as? [[String: Any]])
    legs[0]["geometryInputComplete"] = false; route["legs"] = legs
    let json = try encode(route)
    XCTAssertThrowsError(try Session(routeJSON: json, bindingJSON: bindingJSON(json), now: 1_000))
  }

  func testSavedRouteIsNeverArmableEvenInsideSandbox() throws {
    let route = try routeJSON(context: "SAVED_ROUTE")
    XCTAssertThrowsError(try Session(routeJSON: route, bindingJSON: bindingJSON(route), now: 1_000))
  }

  func testSavedRouteRequiresExplicitParityProofAndStillValidatesDigestGeometryAndScope() throws {
    let route = try routeJSON(context: "SAVED_ROUTE")
    let proof: [String: Any] = ["savedRouteValidated": true, "guidanceEnabled": true]
    let session = try Session(routeJSON: route, bindingJSON: bindingJSON(route, patch: proof), now: 1_000)
    XCTAssertEqual(session.routeContext, "SAVED_ROUTE")
    XCTAssertEqual(session.core.snapshot.status, .armed)
    XCTAssertNil(session.pendingDeparture)
    XCTAssertThrowsError(try Session(routeJSON: route, bindingJSON: bindingJSON(route, scope: "LOCAL_ONLY", patch: proof), now: 1_000))
    XCTAssertThrowsError(try Session(routeJSON: route + " ", bindingJSON: bindingJSON(route, patch: proof), now: 1_000))
    var object = try routeDictionary(context: "SAVED_ROUTE")
    var legs = object["legs"] as! [[String: Any]]; legs[0]["geometryInputComplete"] = false; object["legs"] = legs
    let invalid = try encode(object)
    XCTAssertThrowsError(try Session(routeJSON: invalid, bindingJSON: bindingJSON(invalid, patch: proof), now: 1_000))
  }

  func testGuidanceProjectionIsReadyBeforeGPSAndWalkingOnlyAfterAutomaticDeparture() throws {
    var session = try makeSession()
    let ready = NoLateAutomaticGuidanceProjection.content(session, now: 1_000)
    XCTAssertEqual(ready.phase, "READY"); XCTAssertNil(ready.walkProgress)
    depart(&session)
    let walking = NoLateAutomaticGuidanceProjection.content(session, now: 1_016)
    XCTAssertEqual(walking.phase, "WALKING_TO_STOP"); XCTAssertEqual(walking.quality, "GOOD")
    XCTAssertEqual(try XCTUnwrap(walking.walkProgress), 0.4, accuracy: 0.001)
    XCTAssertEqual(walking.validUntil, 1_031)
    XCTAssertFalse(walking.boardingConfirmed)
    XCTAssertEqual(walking.sessionId, session.binding.sessionId)
    XCTAssertEqual(walking.routeInputDigest, session.binding.routeInputDigest)
  }

  func testGuidanceExpirationCannotBeExtendedByRenderingAndHidesMetricsAtTTLBoundary() throws {
    var session = try makeSession(); depart(&session)
    let first = NoLateAutomaticGuidanceProjection.content(session, now: 1_016)
    let stale = NoLateAutomaticGuidanceProjection.content(session, now: 1_031)
    XCTAssertEqual(first.validUntil, stale.validUntil)
    XCTAssertEqual(stale.phase, "UNAVAILABLE"); XCTAssertEqual(stale.quality, "UNCERTAIN")
    XCTAssertNil(stale.walkProgress)
    XCTAssertEqual(stale.observedAt, first.observedAt)
    session.stop(now: 1_032)
    XCTAssertEqual(NoLateAutomaticGuidanceProjection.content(session, now: 1_032).phase, "STOPPED")
  }

  func testGuidanceWaitingAndBoardingCandidateNeverProduceConfirmedRideOrWholeRouteProgress() throws {
    var session = try makeBusSession(); depart(&session); walkAndWaitAtBusStop(&session)
    let waiting = NoLateAutomaticGuidanceProjection.content(session, now: 1_052)
    XCTAssertEqual(waiting.phase, "WAITING"); XCTAssertEqual(waiting.walkProgress, 1)
    XCTAssertEqual(waiting.activeLegIndex, 1); XCTAssertFalse(waiting.boardingConfirmed)
    for index in 14...16 { session.ingest(coordinate: point(200 + Double(index - 13) * 40), accuracy: 5,
      observedAt: 1_000 + Double(index) * 4, now: 1_000 + Double(index) * 4) }
    let candidate = NoLateAutomaticGuidanceProjection.content(session, now: 1_064)
    XCTAssertEqual(candidate.phase, "BOARDING_CANDIDATE"); XCTAssertEqual(candidate.quality, "UNCERTAIN")
    XCTAssertNil(candidate.walkProgress); XCTAssertFalse(candidate.boardingConfirmed)
    XCTAssertEqual(candidate.validUntil, 1_079)
  }

  func testExactInputBytesNotEquivalentReencodedJSONAreDigestBound() throws {
    let route = try routeJSON()
    let binding = try bindingJSON(route)
    XCTAssertThrowsError(try Session(routeJSON: route + " ", bindingJSON: binding, now: 1_000))
    XCTAssertEqual(Session.digest(route).count, 64)
    XCTAssertEqual(Session.digest("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  }

  func testBindingRevisionMustMatchValidatedRoute() throws {
    let route = try routeJSON()
    let binding = try bindingJSON(route, patch: ["routeRevision": 2])
    XCTAssertThrowsError(try Session(routeJSON: route, bindingJSON: binding, now: 1_000))
  }

  func testUUIDCaseIsPreservedExactlyInSnapshotAndOutbox() throws {
    let route = try routeJSON()
    let id = "abcdefab-1234-4000-8000-abcdefabcdef"
    let owner = "abcdefab-5678-4000-8000-abcdefabcdef"
    let binding = try bindingJSON(route, patch: ["sessionId": id, "clientOwnerId": owner])
    var session = try Session(routeJSON: route, bindingJSON: binding, now: 1_000)
    depart(&session)
    XCTAssertEqual(session.core.snapshot.identity.sessionId, id)
    XCTAssertEqual(session.pendingDeparture?.sessionId, id)
    XCTAssertEqual(session.pendingDeparture?.clientOwnerId, owner)
    XCTAssertEqual(session.pendingDeparture?.eventKey, id + ":1:1:AUTO_DEPARTURE")
  }

  func testExplicitStopStillRevokesPendingAfterClockRegression() throws {
    var session = try makeSession(); depart(&session)
    session.stop(now: 900)
    XCTAssertEqual(session.core.snapshot.status, .stopped)
    XCTAssertNil(session.pendingDeparture)
  }

  func testBindingRejectsInvalidIDsExecutionScopeAndDigest() throws {
    let route = try routeJSON()
    for (key, value) in [("sessionId", "not-a-uuid"), ("clientOwnerId", ""), ("scheduleId", "../42"),
                         ("routeInputDigest", String(repeating: "A", count: 64)), ("execution", "REAL_DEVICE"),
                         ("syncScope", "PRODUCTION")] {
      XCTAssertThrowsError(try Session(routeJSON: route, bindingJSON: bindingJSON(route, patch: [key: value]), now: 1_000), key)
    }
  }

  func testBindingRejectsUnsafeIntegerGenerationAndRevision() throws {
    let route = try routeJSON()
    for key in ["generation", "routeRevision"] {
      for value in [0, -1, 9_007_199_254_740_992] as [Int64] {
        XCTAssertThrowsError(try Session(routeJSON: route, bindingJSON: bindingJSON(route, patch: [key: value]), now: 1_000))
      }
    }
  }

  func testBindingLifetimeFutureAndExpiredPreparationAreRejected() throws {
    let route = try routeJSON()
    for patch: [String: Any] in [["preparedAtEpochSeconds": 1_003], ["expiresAtEpochSeconds": 1_601],
                                ["expiresAtEpochSeconds": 1_000], ["preparedAtEpochSeconds": 0]] {
      XCTAssertThrowsError(try Session(routeJSON: route, bindingJSON: bindingJSON(route, patch: patch), now: 1_000))
    }
    XCTAssertThrowsError(try Session(routeJSON: route, bindingJSON: bindingJSON(route), now: 1_600))
  }

  func testMalformedAndOversizedBindingIsSanitized() throws {
    let route = try routeJSON()
    for json in ["", "{}", "[]", String(repeating: "a", count: 8_193)] {
      XCTAssertThrowsError(try Session(routeJSON: route, bindingJSON: json, now: 1_000))
    }
  }

  func testForwardLocationEvidenceCreatesOneStableCoordinateFreeDeparture() throws {
    var session = try makeSession()
    depart(&session)
    let event = try XCTUnwrap(session.pendingDeparture)
    XCTAssertEqual(session.core.snapshot.status, .active)
    XCTAssertEqual(event.sequence, 1)
    XCTAssertEqual(event.type, "AUTO_DEPARTURE")
    XCTAssertEqual(event.eventKey, "00000000-0000-4000-8000-000000000001:1:1:AUTO_DEPARTURE")
    XCTAssertEqual(event.execution, "SIMULATOR")
    XCTAssertEqual(event.occurredAtEpochSeconds, 1_016)
    session.ingest(coordinate: point(100), accuracy: 5, observedAt: 1_020, now: 1_020)
    XCTAssertEqual(session.pendingDeparture, event)
    let json = String(decoding: try JSONEncoder().encode(event), as: UTF8.self)
    for secret in ["latitude", "longitude", "coordinate", "routeJSON", "name", "token", "accuracy"] {
      XCTAssertFalse(json.contains(secret))
    }
    let keys = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]).keys
    XCTAssertEqual(Set(keys), Set(["schemaVersion", "sessionId", "scheduleId", "generation", "routeRevision", "clientOwnerId",
                                 "routeInputDigest", "eventKey", "sequence", "type", "occurredAtEpochSeconds", "execution"]))
  }

  func testStationaryStaleAndReverseSamplesDoNotCreateOutbox() throws {
    var stationary = try makeSession()
    for index in 0..<8 { stationary.ingest(coordinate: point(0), accuracy: 5, observedAt: 1_000 + Double(index), now: 1_000 + Double(index)) }
    XCTAssertNil(stationary.pendingDeparture)
    var stale = try makeSession()
    stale.ingest(coordinate: point(0), accuracy: 5, observedAt: 900, now: 1_000)
    stale.ingest(coordinate: point(100), accuracy: 5, observedAt: 1_010, now: 1_010)
    XCTAssertNil(stale.pendingDeparture)
    var reverse = try makeSession()
    reverse.ingest(coordinate: point(0), accuracy: 5, observedAt: 1_000, now: 1_000)
    reverse.ingest(coordinate: point(50), accuracy: 5, observedAt: 1_004, now: 1_004)
    reverse.ingest(coordinate: point(20), accuracy: 5, observedAt: 1_008, now: 1_008)
    XCTAssertNil(reverse.pendingDeparture)
  }

  func testEventTimestampIsRoundedToMilliseconds() throws {
    var session = try makeSession()
    for index in 0...4 {
      let timestamp = 1_000.0004 + Double(index) * 4
      session.ingest(coordinate: point(Double(index) * 20), accuracy: 5, observedAt: timestamp, now: timestamp)
    }
    XCTAssertEqual(session.pendingDeparture?.occurredAtEpochSeconds, 1_016)
  }

  func testEnvelopeRoundTripAtomicallyIncludesEngineAndPendingEvent() throws {
    var session = try makeSession(); depart(&session)
    let restored = try restore(session.envelope, now: 1_025)
    XCTAssertEqual(restored.core.snapshot.status, .active)
    XCTAssertEqual(restored.pendingDeparture, session.pendingDeparture)
    XCTAssertEqual(restored.core.snapshot.quality, .unavailable)
    XCTAssertNil(restored.core.snapshot.alongRouteMeters)
    XCTAssertEqual(restored.core.snapshot.evidenceCount, 0)
  }

  func testRestoredActiveSessionDoesNotEmitANewDeparture() throws {
    var original = try makeSession(); depart(&original)
    var restored = try restore(original.envelope, now: 1_025)
    restored.ingest(coordinate: point(120), accuracy: 5, observedAt: 1_026, now: 1_026)
    XCTAssertEqual(restored.pendingDeparture, original.pendingDeparture)
  }

  func testRestoredArmedSessionNeedsFreshOriginEvidence() throws {
    var session = try makeSession()
    session.ingest(coordinate: point(0), accuracy: 5, observedAt: 1_000, now: 1_000)
    session.ingest(coordinate: point(40), accuracy: 5, observedAt: 1_004, now: 1_004)
    var restored = try restore(session.envelope, now: 1_010)
    restored.ingest(coordinate: point(80), accuracy: 5, observedAt: 1_012, now: 1_012)
    XCTAssertEqual(restored.core.snapshot.status, .armed)
    XCTAssertNil(restored.pendingDeparture)
  }

  func testRestoreRejectsChangedOwnerSessionRouteAndPolicy() throws {
    let session = try makeSession()
    let route = session.routeJSON
    let changedOwner = try bindingJSON(route, patch: ["clientOwnerId": "00000000-0000-4000-8000-000000000003"])
    XCTAssertThrowsError(try Session(restoring: session.envelope, routeJSON: route, bindingJSON: changedOwner, now: 1_010))
    XCTAssertThrowsError(try Session(restoring: session.envelope, routeJSON: route + " ", bindingJSON: bindingJSON(route), now: 1_010))
    let badPolicy = try mutate(session.envelope) { object in
      var engine = object["engine"] as! [String: Any]
      var policy = engine["policy"] as! [String: Any]; policy["minimumDepartureMeters"] = 1
      engine["policy"] = policy; object["engine"] = engine
    }
    XCTAssertThrowsError(try restore(badPolicy, now: 1_010))
  }

  func testRestoreRejectsMissingForgedOrMismatchedDepartureReceipt() throws {
    var session = try makeSession(); depart(&session)
    let missing = try mutate(session.envelope) { $0.removeValue(forKey: "departure") }
    XCTAssertThrowsError(try restore(missing, now: 1_025))
    for (key, value) in [("eventKey", "foreign"), ("execution", "REAL_DEVICE"), ("type", "MANUAL")] {
      let invalid = try mutate(session.envelope) { object in
        var departure = object["departure"] as! [String: Any]; departure[key] = value; object["departure"] = departure
      }
      XCTAssertThrowsError(try restore(invalid, now: 1_025))
    }
  }

  func testAcknowledgementRequiresExactBindingAndEventAndIsIdempotent() throws {
    var session = try makeSession(); depart(&session)
    let key = try XCTUnwrap(session.pendingDeparture).eventKey
    XCTAssertThrowsError(try session.acknowledge(eventKey: "wrong", bindingJSON: bindingJSON(session.routeJSON), now: 1_020))
    XCTAssertNotNil(session.pendingDeparture)
    let foreign = try bindingJSON(session.routeJSON, patch: ["scheduleId": "43"])
    XCTAssertThrowsError(try session.acknowledge(eventKey: key, bindingJSON: foreign, now: 1_020))
    try session.acknowledge(eventKey: key, bindingJSON: bindingJSON(session.routeJSON), now: 1_020)
    XCTAssertNil(session.pendingDeparture)
    XCTAssertTrue(session.departureAcknowledged)
    try session.acknowledge(eventKey: key, bindingJSON: bindingJSON(session.routeJSON), now: 1_021)
    let restored = try restore(session.envelope, now: 1_025)
    XCTAssertTrue(restored.departureAcknowledged)
    XCTAssertNil(restored.pendingDeparture)
  }

  func testStopAndExpiryRevokePendingWithoutResurrectionOnRestore() throws {
    var stopped = try makeSession(); depart(&stopped); stopped.stop(now: 1_020)
    XCTAssertNil(stopped.pendingDeparture)
    XCTAssertEqual(try restore(stopped.envelope, now: 1_025).core.snapshot.status, .stopped)
    XCTAssertNil(try restore(stopped.envelope, now: 1_025).pendingDeparture)
    var expired = try makeSession(); depart(&expired); expired.tick(now: 1_601)
    XCTAssertEqual(expired.core.snapshot.status, .expired)
    XCTAssertNil(expired.pendingDeparture)
    var active = try makeSession(); depart(&active)
    let afterExpiry = try restore(active.envelope, now: 1_601)
    XCTAssertEqual(afterExpiry.core.snapshot.status, .expired)
    XCTAssertNil(afterExpiry.pendingDeparture)
  }

  func testExpiryInsideLocationIngestIsTerminalAndNeverDeliversPendingEvent() throws {
    var session = try makeSession(); depart(&session)
    session.tick(now: 1_599.999)
    XCTAssertEqual(session.core.snapshot.status, .active)
    session.ingest(coordinate: point(100), accuracy: 5, observedAt: 1_599.999, now: 1_600)
    XCTAssertEqual(session.core.snapshot.status, .expired)
    XCTAssertNil(session.pendingDeparture)
    session.ingest(coordinate: point(120), accuracy: 5, observedAt: 1_604, now: 1_604)
    XCTAssertEqual(session.core.snapshot.status, .expired)
    XCTAssertNil(session.pendingDeparture)
  }

  func testNewValidStationaryObservationsResolveTransientLocationFailure() throws {
    var session = try makeSession()
    XCTAssertTrue(session.ingest(coordinate: point(0), accuracy: 5, observedAt: 1_000, now: 1_000))
    let stationaryAccepted = session.ingest(coordinate: point(0), accuracy: 5, observedAt: 1_004, now: 1_004)
    XCTAssertTrue(stationaryAccepted)
    XCTAssertEqual(session.core.snapshot.reason, .stationary)
    XCTAssertNil(NoLateJourneyAutomaticLocationErrorPolicy.afterCommittedObservation(
      "LOCATION_TEMPORARILY_UNAVAILABLE", acceptedFreshObservation: stationaryAccepted))
  }

  func testRejectedLocationDoesNotResolveTransientFailure() throws {
    for sample in [(point(0), 5.0, 900.0), (point(0), 100.0, 1_004.0),
                   (NoLateJourneyEngineCore.Coordinate(latitude: 1, longitude: 0), 5.0, 1_004.0),
                   (NoLateJourneyEngineCore.Coordinate(latitude: 95, longitude: 0), 5.0, 1_004.0)] {
      var session = try makeSession()
      XCTAssertTrue(session.ingest(coordinate: point(0), accuracy: 5, observedAt: 1_000, now: 1_000))
      let accepted = session.ingest(coordinate: sample.0, accuracy: sample.1, observedAt: sample.2, now: 1_004)
      XCTAssertFalse(accepted)
      XCTAssertEqual(NoLateJourneyAutomaticLocationErrorPolicy.afterCommittedObservation(
        "LOCATION_TEMPORARILY_UNAVAILABLE", acceptedFreshObservation: accepted), "LOCATION_TEMPORARILY_UNAVAILABLE")
    }
  }

  func testDuplicateAndTerminalSamplesDoNotClaimLocationRecovery() throws {
    var session = try makeSession()
    XCTAssertTrue(session.ingest(coordinate: point(0), accuracy: 5, observedAt: 1_000, now: 1_000))
    XCTAssertFalse(session.ingest(coordinate: point(0), accuracy: 5, observedAt: 1_000, now: 1_001))
    session.stop(now: 1_002)
    XCTAssertFalse(session.ingest(coordinate: point(0), accuracy: 5, observedAt: 1_004, now: 1_004))
  }

  func testGoodLocationNeverClearsPersistentRuntimeErrors() {
    for error in [nil, "AUTOMATIC_CHECKPOINT_WRITE_FAILED", "AUTOMATIC_REVOCATION_FAILED", "LOCATION_PERMISSION_DENIED",
                  "DEPARTURE_ACKNOWLEDGEMENT_REJECTED", "AUTOMATIC_RESTORE_REJECTED"] as [String?] {
      XCTAssertEqual(NoLateJourneyAutomaticLocationErrorPolicy.afterCommittedObservation(error, acceptedFreshObservation: true), error)
    }
  }

  func testExplicitStopClearsOnlyTemporaryLocationError() {
    XCTAssertNil(NoLateJourneyAutomaticLocationErrorPolicy.afterExplicitStop("LOCATION_TEMPORARILY_UNAVAILABLE"))
    for error in [nil, "AUTOMATIC_CHECKPOINT_WRITE_FAILED", "AUTOMATIC_REVOCATION_FAILED", "LOCATION_PERMISSION_DENIED",
                  "DEPARTURE_ACKNOWLEDGEMENT_REJECTED", "AUTOMATIC_RESTORE_REJECTED"] as [String?] {
      XCTAssertEqual(NoLateJourneyAutomaticLocationErrorPolicy.afterExplicitStop(error), error)
    }
  }

  func testBusApproachPreparationDoesNotRequireOrInventProviderRouteID() throws {
    let route = try busRouteJSON()
    let prepared = try NoLateJourneyRouteNormalizer.prepareWalkingRoute(json: route, allowSyntheticSandbox: true)
    XCTAssertNotNil(prepared.busRoute)
    XCTAssertNil(prepared.busUnavailableReason)
    XCTAssertFalse(prepared.summary.legs[1].rideNavigationEligible)
    XCTAssertTrue(prepared.summary.legs[1].reasonCodes.contains("PROVIDER_ROUTE_ID_MISSING"))
    let session = try Session(routeJSON: route, bindingJSON: bindingJSON(route), now: 1_000)
    XCTAssertFalse(try XCTUnwrap(session.bus).snapshot.boardingConfirmed)
  }

  func testBusEvidenceWaitsForAutomaticDeparture() throws {
    let route = try busRouteJSON()
    var session = try Session(routeJSON: route, bindingJSON: bindingJSON(route), now: 1_000)
    for index in 0...4 { session.ingest(coordinate: point(200), accuracy: 5,
      observedAt: 1_000 + Double(index) * 4, now: 1_000 + Double(index) * 4) }
    XCTAssertEqual(session.core.snapshot.status, .armed)
    XCTAssertNil(session.bus?.snapshot.lastObservationAt)
    XCTAssertEqual(session.bus?.snapshot.reason, "AWAITING_AUTOMATIC_DEPARTURE")
    XCTAssertNil(session.pendingDeparture)
  }

  func testBusCandidateContinuesDespiteFirstWalkingCoreOffRouteAndPreservesDepartureOutbox() throws {
    var session = try makeBusSession()
    depart(&session)
    let departure = try XCTUnwrap(session.pendingDeparture)
    walkAndWaitAtBusStop(&session)
    XCTAssertEqual(session.bus?.snapshot.phase, .waiting)
    for index in 14...16 {
      XCTAssertTrue(session.ingest(coordinate: point(200 + Double(index - 13) * 40), accuracy: 5,
        observedAt: 1_000 + Double(index) * 4, now: 1_000 + Double(index) * 4))
    }
    XCTAssertEqual(session.core.snapshot.status, .active)
    XCTAssertEqual(session.core.snapshot.reason, .offRoute)
    XCTAssertEqual(session.bus?.snapshot.phase, .boardingCandidate)
    XCTAssertEqual(session.bus?.snapshot.quality, .good)
    XCTAssertEqual(session.bus?.snapshot.boardingConfirmed, false)
    XCTAssertEqual(session.pendingDeparture, departure)
    XCTAssertEqual(session.pendingDeparture?.sequence, 1)
  }

  func testBusStopAndExpiryClearFreshProjectionAndWaiting() throws {
    var stopped = try makeBusSession(); depart(&stopped); walkAndWaitAtBusStop(&stopped)
    stopped.stop(now: 1_053)
    XCTAssertEqual(stopped.bus?.snapshot.phase, .unavailable)
    XCTAssertNil(stopped.bus?.snapshot.distanceToBoardMeters)
    XCTAssertNil(stopped.bus?.snapshot.alongRouteMeters)
    var expired = try makeBusSession(); depart(&expired); walkAndWaitAtBusStop(&expired)
    expired.tick(now: 1_600)
    XCTAssertEqual(expired.bus?.snapshot.phase, .unavailable)
    XCTAssertNil(expired.bus?.snapshot.distanceToBoardMeters)
    XCTAssertEqual(expired.bus?.snapshot.boardingEvidenceCount, 0)
  }

  func testBusRestoreDoesNotReuseWaitingOrCandidateEvidence() throws {
    var session = try makeBusSession(); depart(&session); walkAndWaitAtBusStop(&session)
    for index in 14...16 { session.ingest(coordinate: point(200 + Double(index - 13) * 40), accuracy: 5,
      observedAt: 1_000 + Double(index) * 4, now: 1_000 + Double(index) * 4) }
    XCTAssertEqual(session.bus?.snapshot.phase, .boardingCandidate)
    var restored = try restore(session.envelope, now: 1_065)
    XCTAssertEqual(restored.core.snapshot.status, .active)
    XCTAssertEqual(restored.pendingDeparture, session.pendingDeparture)
    XCTAssertEqual(restored.bus?.snapshot.phase, .walkingToStop)
    XCTAssertEqual(restored.bus?.snapshot.reason, "RESTORED_NEEDS_FRESH_LOCATION")
    XCTAssertNil(restored.bus?.snapshot.distanceToBoardMeters)
    XCTAssertNil(restored.bus?.snapshot.alongRouteMeters)
    XCTAssertEqual(restored.bus?.snapshot.boardingEvidenceCount, 0)
    restored.ingest(coordinate: point(360), accuracy: 5, observedAt: 1_068, now: 1_068)
    XCTAssertNotEqual(restored.bus?.snapshot.phase, .boardingCandidate)
  }

  func testLegacyEnvelopeWithoutBusSnapshotStillRestoresWithFreshBusEvidence() throws {
    var session = try makeBusSession(); depart(&session); walkAndWaitAtBusStop(&session)
    let legacy = try mutate(session.envelope) { $0.removeValue(forKey: "bus") }
    XCTAssertNil(legacy.bus)
    let restored = try restore(legacy, now: 1_053)
    XCTAssertEqual(restored.core.snapshot.status, .active)
    XCTAssertNotNil(restored.bus)
    XCTAssertEqual(restored.bus?.snapshot.reason, "RESTORED_NEEDS_FRESH_LOCATION")
    XCTAssertNil(restored.bus?.snapshot.distanceToBoardMeters)
    XCTAssertEqual(restored.bus?.snapshot.boardingEvidenceCount, 0)
  }

  func testBusSnapshotCannotCrossBindingRoutePolicyOrLifetimeOnRestore() throws {
    var session = try makeBusSession(); depart(&session); walkAndWaitAtBusStop(&session)
    for key in ["identity", "route", "policy", "armedAt", "expiresAt"] {
      let corrupted = try mutate(session.envelope) { object in
        var bus = object["bus"] as! [String: Any]
        if key == "identity" {
          var identity = bus[key] as! [String: Any]; identity["routeRevision"] = 2; bus[key] = identity
        } else if key == "route" {
          var route = bus[key] as! [String: Any]; route["legIndex"] = 2; bus[key] = route
        } else if key == "policy" {
          var policy = bus[key] as! [String: Any]; policy["minimumVehicleSpeed"] = 2; bus[key] = policy
        } else { bus[key] = 1_001 }
        object["bus"] = bus
      }
      XCTAssertThrowsError(try restore(corrupted, now: 1_053), key)
    }
  }

  func testInvalidBusQualityBlocksOnlyBusFeatureNotExistingAutomaticDeparture() throws {
    for patch: [String: Any] in [["geometrySource": "PASS_STOP_LIST"], ["directionName": NSNull()],
                                ["declaredStationCount": 99], ["geometryInputComplete": false], ["kind": "SUBWAY"]] {
      let route = try busRouteJSON(legPatch: patch)
      var session = try Session(routeJSON: route, bindingJSON: bindingJSON(route), now: 1_000)
      XCTAssertNil(session.bus)
      XCTAssertNotNil(session.busUnavailableReason)
      depart(&session)
      XCTAssertEqual(session.core.snapshot.status, .active)
      XCTAssertNotNil(session.pendingDeparture)
    }
  }

  func testObservationSequenceExhaustionStopsBusAlongsideDepartureCore() throws {
    var session = try makeBusSession(); depart(&session); walkAndWaitAtBusStop(&session)
    let exhausted = try mutate(session.envelope) { object in
      var engine = object["engine"] as! [String: Any]
      engine["lastObservationSequence"] = Int64.max - 1
      object["engine"] = engine
    }
    var restored = try restore(exhausted, now: 1_053)
    XCTAssertFalse(restored.ingest(coordinate: point(240), accuracy: 5, observedAt: 1_056, now: 1_056))
    XCTAssertEqual(restored.core.snapshot.status, .stopped)
    XCTAssertEqual(restored.bus?.snapshot.phase, .unavailable)
    XCTAssertEqual(restored.bus?.snapshot.terminated, true)
    XCTAssertNil(restored.bus?.snapshot.distanceToBoardMeters)
    XCTAssertNil(restored.pendingDeparture)
  }

  private func busRouteJSON(legPatch: [String: Any] = [:]) throws -> String {
    var route = try routeDictionary()
    var legs = try XCTUnwrap(route["legs"] as? [[String: Any]])
    var bus: [String: Any] = ["index": 1, "kind": "BUS", "geometrySource": "TRANSIT_PASS_SHAPE_LINESTRING",
      "exact": true, "geometryInputComplete": true, "stopEvidenceProvider": "tmap", "stopEvidenceVersion": 1,
      "coordinates": [coord(200), coord(400), coord(600), coord(900)], "start": coord(200), "end": coord(900),
      "directionName": "explicit provider direction", "declaredStationCount": 2,
      "stops": [200.0, 550, 900].enumerated().map { index, meters in
        ["sourceIndex": index, "providerSequence": index, "code": "stop-\(index)", "coordinate": coord(meters)] as [String: Any]
      }]
    bus.merge(legPatch) { _, new in new }
    legs.append(bus); route["legs"] = legs; route["destination"] = coord(900)
    return try encode(route)
  }
  func testSavedArrivalRequiresProofDepartureAcknowledgementAndFreshWaitingGPS() throws {
    var session = try savedArrivalSession()
    XCTAssertFalse(NoLateSavedGuidanceArrivalPolicy.eligible(session, now: 1_000))
    depart(&session); walkAndWaitAtBusStop(&session)
    XCTAssertFalse(NoLateSavedGuidanceArrivalPolicy.eligible(session, now: 1_052))
    try acknowledgeArrivalSession(&session)
    XCTAssertTrue(NoLateSavedGuidanceArrivalPolicy.eligible(session, now: 1_052))
    XCTAssertFalse(NoLateSavedGuidanceArrivalPolicy.eligible(session, now: 1_067))
    session.stop(now: 1_053)
    XCTAssertFalse(NoLateSavedGuidanceArrivalPolicy.eligible(session, now: 1_053))
  }
  func testCanonicalSavedArrivalBindingRejectsIDDirectionOccurrenceAndSessionMismatch() throws {
    let session = try savedArrivalSession()
    let valid = try arrivalBindingData(session)
    XCTAssertNotNil(NoLateSavedGuidanceArrivalPolicy.binding(valid, session: session))
    for field in ["sessionId", "generation", "routeRevision", "routeInputDigest", "identityEvidence"] {
      let altered = try arrivalBindingData(session, patch: [field: "invalid"])
      XCTAssertNil(NoLateSavedGuidanceArrivalPolicy.binding(altered, session: session), field)
    }
    for patch: [String: Any] in [["providerRouteId": "999998"], ["namespace": "TAGO_BUS"], ["directionLabel": "reverse"], ["arsId": "00000"], ["legIndex": 2]] {
      let altered = try arrivalBindingData(session, queryPatch: patch)
      XCTAssertNil(NoLateSavedGuidanceArrivalPolicy.binding(altered, session: session))
    }
    XCTAssertNil(NoLateSavedGuidanceArrivalPolicy.binding(try arrivalBindingData(session, boardPatch: ["providerSequence": 99]), session: session))
    XCTAssertNil(NoLateSavedGuidanceArrivalPolicy.binding(try arrivalBindingData(session, boardPatch: ["latitude": 1]), session: session))
    XCTAssertFalse(NoLateSavedGuidanceArrivalPolicy.supportedInput(try makeBusSession()))
  }
  func testSavedArrivalUsesOriginalSourceExpiryAndDoesNotCertifyBoarding() throws {
    var session = try savedArrivalSession(); depart(&session); walkAndWaitAtBusStop(&session); try acknowledgeArrivalSession(&session)
    let query = try XCTUnwrap(NoLateSavedGuidanceArrivalPolicy.binding(try arrivalBindingData(session), session: session))
    let data = try arrivalObservationData(session)
    let first = NoLateSavedGuidanceArrivalPolicy.observe(data, session: session, query: query, now: 1_052)
    XCTAssertEqual(first.status, "WAITING_INFORMATION")
    XCTAssertEqual(first.arrival?.expectedAt, 1_170); XCTAssertEqual(first.arrival?.validUntil, 1_170)
    let content = NoLateAutomaticGuidanceProjection.content(session, now: 1_052, arrival: first)
    XCTAssertEqual(content.arrival, first.arrival); XCTAssertFalse(content.boardingConfirmed)
    XCTAssertEqual(content.validUntil, 1_067) // Original GPS TTL is not extended by arrival receipt.
    session.ingest(coordinate: point(200), accuracy: 5, observedAt: 1_170, now: 1_170)
    let stale = NoLateSavedGuidanceArrivalPolicy.observe(data, session: session, query: query, now: 1_170)
    XCTAssertEqual(stale.status, "STALE"); XCTAssertNil(stale.arrival)
  }
  func testSavedArrivalRejectsTamperedIdentityTimestampsCapabilitiesAndQuery() throws {
    var session = try savedArrivalSession(); depart(&session); walkAndWaitAtBusStop(&session); try acknowledgeArrivalSession(&session)
    let query = try XCTUnwrap(NoLateSavedGuidanceArrivalPolicy.binding(try arrivalBindingData(session), session: session))
    for field in ["sessionId", "generation", "routeRevision", "routeInputDigest", "identityEvidence", "confirmedBoarding", "remainingStopsToAlight"] {
      let data = try arrivalObservationData(session, patch: [field: "invalid"])
      XCTAssertNil(NoLateSavedGuidanceArrivalPolicy.observe(data, session: session, query: query, now: 1_052).arrival, field)
    }
    for patch: [String: Any] in [["sourceUpdatedAt": iso(1_058)], ["validUntil": iso(1_171)], ["directionLabel": "reverse"],
      ["inputFreshnessEvidence": "LOCAL_RECEIPT_TIMESTAMP_ONLY"], ["arsId": "00000"], ["confirmedBoarding": true], ["provider": "TAGO_BUS"]] {
      let data = try arrivalObservationData(session, observationPatch: patch)
      XCTAssertNil(NoLateSavedGuidanceArrivalPolicy.observe(data, session: session, query: query, now: 1_052).arrival)
    }
    for status in ["STALE", "IDENTITY_MISMATCH", "NO_ARRIVAL", "UNVERIFIED", "invented"] {
      XCTAssertNil(NoLateSavedGuidanceArrivalPolicy.observe(try arrivalObservationData(session, patch: ["status": status]), session: session, query: query, now: 1_052).arrival)
    }
    XCTAssertNil(NoLateSavedGuidanceArrivalPolicy.observe(Data(repeating: 32, count: 262145), session: session, query: query, now: 1_052).arrival)
  }
  func testCandidateStaleAndStoppedProjectionNeverLeakCachedArrival() throws {
    var session = try savedArrivalSession(); depart(&session); walkAndWaitAtBusStop(&session); try acknowledgeArrivalSession(&session)
    let result = NoLateSavedGuidanceArrivalPolicy.Result("WAITING_INFORMATION", .init(providerRouteId: "999999", directionLabel: "explicit provider direction", expectedAt: 1_170, sourceUpdatedAt: 1_050, validUntil: 1_170))
    XCTAssertNotNil(NoLateAutomaticGuidanceProjection.content(session, now: 1_052, arrival: result).arrival)
    XCTAssertNil(NoLateAutomaticGuidanceProjection.content(session, now: 1_067, arrival: result).arrival)
    for index in 14...16 { session.ingest(coordinate: point(200 + Double(index - 13) * 40), accuracy: 5,
      observedAt: 1_000 + Double(index) * 4, now: 1_000 + Double(index) * 4) }
    XCTAssertFalse(NoLateSavedGuidanceArrivalPolicy.eligible(session, now: 1_064))
    XCTAssertNil(NoLateAutomaticGuidanceProjection.content(session, now: 1_064, arrival: result).arrival)
    session.stop(now: 1_065)
    XCTAssertNil(NoLateAutomaticGuidanceProjection.content(session, now: 1_065, arrival: result).arrival)
  }
  private func savedArrivalSession() throws -> Session {
    // Complete stored-input proof remains simulator-only.
    var object = try JSONSerialization.jsonObject(with: Data(busRouteJSON(legPatch: ["localRouteId": "999999"]).utf8)) as! [String: Any]
    object["context"] = "SAVED_ROUTE"; object["provider"] = "odsay"
    var legs = object["legs"] as! [[String: Any]]
    for i in legs.indices { legs[i]["stopEvidenceProvider"] = "odsay" }; object["legs"] = legs
    let route = try encode(object)
    return try Session(routeJSON: route, bindingJSON: bindingJSON(route, patch: ["savedRouteValidated": true, "guidanceEnabled": true]), now: 1_000)
  }
  func testSavedLeaseHasExactSessionRouteOwnerFenceAndBoundedOriginalExpiry() throws {
    let session = try savedArrivalSession(), b = session.binding
    let formatter = ISO8601DateFormatter()
    var payload: [String: Any] = ["schemaVersion": 1, "sessionId": b.sessionId, "scheduleId": b.scheduleId,
      "generation": b.generation, "routeRevision": b.routeRevision, "clientOwnerId": b.clientOwnerId,
      "routeInputDigest": b.routeInputDigest, "execution": b.execution, "state": "ARMED",
      "validatedAt": formatter.string(from: Date(timeIntervalSince1970: 1_000)),
      "validUntil": formatter.string(from: Date(timeIntervalSince1970: 1_030))]
    func data(_ patch: [String: Any] = [:]) throws -> Data {
      try JSONSerialization.data(withJSONObject: ["success": true, "data": payload.merging(patch) { _, new in new }])
    }
    XCTAssertEqual(NoLateSavedGuidanceLeasePolicy.validUntil(try data(), binding: b, now: 1_000), 1_030)
    XCTAssertNil(NoLateSavedGuidanceLeasePolicy.validUntil(try data(), binding: b, now: 1_030))
    for patch: [String: Any] in [
      ["schemaVersion": 2], ["sessionId": "other"], ["scheduleId": "9002"], ["generation": 2], ["routeRevision": 2],
      ["clientOwnerId": "other"], ["routeInputDigest": String(repeating: "b", count: 64)], ["execution": "DEVICE"],
      ["state": "STOPPED"], ["state": "EXPIRED"], ["validatedAt": formatter.string(from: Date(timeIntervalSince1970: 1_006))],
      ["validUntil": formatter.string(from: Date(timeIntervalSince1970: 1_031))],
      ["validatedAt": "invalid"], ["validUntil": NSNull()],
    ] { XCTAssertNil(NoLateSavedGuidanceLeasePolicy.validUntil(try data(patch), binding: b, now: 1_000)) }
    payload["state"] = "ACTIVE"
    XCTAssertNotNil(NoLateSavedGuidanceLeasePolicy.validUntil(try data(), binding: b, now: 1_001))
    XCTAssertNil(NoLateSavedGuidanceLeasePolicy.validUntil(Data("{}".utf8), binding: b, now: 1_000))
    XCTAssertNil(NoLateSavedGuidanceLeasePolicy.validUntil(try data(), binding: b, now: .nan))
  }
  func testSavedLeaseRejectsNearSessionExpiryAndDistinguishesTransientHTTP() throws {
    let session = try savedArrivalSession(), b = session.binding, formatter = ISO8601DateFormatter()
    let data = try JSONSerialization.data(withJSONObject: ["success": true, "data": [
      "schemaVersion": 1, "sessionId": b.sessionId, "scheduleId": b.scheduleId, "generation": b.generation,
      "routeRevision": b.routeRevision, "clientOwnerId": b.clientOwnerId, "routeInputDigest": b.routeInputDigest,
      "execution": b.execution, "state": "ACTIVE",
      "validatedAt": formatter.string(from: Date(timeIntervalSince1970: b.expiresAtEpochSeconds - 10)),
      "validUntil": formatter.string(from: Date(timeIntervalSince1970: b.expiresAtEpochSeconds + 1)),
    ]])
    XCTAssertNil(NoLateSavedGuidanceLeasePolicy.validUntil(data, binding: b, now: b.expiresAtEpochSeconds - 10))
    for code in [400, 401, 403, 404, 409, 410, 422] { XCTAssertTrue(NoLateSavedGuidanceLeasePolicy.terminalHTTP(code)) }
    for code in [200, 429, 500, 503] { XCTAssertFalse(NoLateSavedGuidanceLeasePolicy.terminalHTTP(code)) }
  }
  private func acknowledgeArrivalSession(_ session: inout Session) throws {
    let event = try XCTUnwrap(session.pendingDeparture)
    try session.acknowledge(eventKey: event.eventKey, bindingJSON: String(decoding: JSONEncoder().encode(session.binding), as: UTF8.self), now: 1_052)
  }
  func testEphemeralGuidancePositionRequiresAcceptedOriginalFreshObservation() throws {
    var session = try savedArrivalSession()
    XCTAssertNil(NoLateAutomaticGuidanceProjection.position(session, coordinate: point(0), accuracy: 5, observedAt: 1_000, now: 1_000))
    depart(&session); walkAndWaitAtBusStop(&session)
    let value = NoLateAutomaticGuidanceProjection.position(session, coordinate: point(200), accuracy: 5, observedAt: 1_052, now: 1_052)
    XCTAssertEqual(value?["latitude"], 0); XCTAssertEqual(value?["longitude"], point(200).longitude)
    XCTAssertEqual(value?["validUntil"], 1_067)
    for (accuracy, observed, now): (Double, Double, Double) in [(36, 1_052, 1_052), (-1, 1_052, 1_052), (5, 1_051, 1_052), (5, 1_052, 1_067)] {
      XCTAssertNil(NoLateAutomaticGuidanceProjection.position(session, coordinate: point(200), accuracy: accuracy, observedAt: observed, now: now))
    }
    session.stop(now: 1_053)
    XCTAssertNil(NoLateAutomaticGuidanceProjection.position(session, coordinate: point(200), accuracy: 5, observedAt: 1_052, now: 1_053))
    let encoded = String(decoding: try JSONEncoder().encode(session.envelope), as: UTF8.self)
    XCTAssertFalse(encoded.contains("guidancePosition"))
  }
  func testDisplayRouteSharesActivityMetadataAndImmutableFenceWithoutCoordinates() throws {
    let session = try savedArrivalSession()
    let value = try XCTUnwrap(NoLateAutomaticGuidanceProjection.displayRoute(session))
    XCTAssertEqual(Set(value.keys), Set(["sessionId", "scheduleId", "generation", "routeRevision", "routeInputDigest", "legs"]))
    XCTAssertEqual(value["sessionId"] as? String, session.binding.sessionId)
    XCTAssertEqual(value["routeInputDigest"] as? String, session.binding.routeInputDigest)
    let legs = try XCTUnwrap(value["legs"] as? [[String: Any]])
    XCTAssertEqual(legs.count, session.routeLegs.count)
    XCTAssertEqual(legs[0]["walkingLengthMeters"] as? Double, session.routeLegs[0].walkingLengthMeters)
    XCTAssertEqual(legs[1]["boardingStopName"] as? String, session.routeLegs[1].boardingStopName)
    for leg in legs { XCTAssertTrue(Set(leg.keys).isSubset(of: ["index", "kind", "walkingLengthMeters", "boardingStopName"])) }
    XCTAssertNil(NoLateAutomaticGuidanceProjection.displayRoute(try makeSession()))
  }

  private func arrivalFence(_ session: Session) -> [String: Any] {
    ["schemaVersion": 1, "sessionId": session.binding.sessionId, "generation": session.binding.generation, "routeRevision": session.binding.routeRevision,
      "routeInputDigest": session.binding.routeInputDigest, "identityEvidence": "SAVED_ROUTE_METADATA"]
  }
  private func arrivalQuery(_ patch: [String: Any] = [:]) -> [String: Any] {
    var query: [String: Any] = ["namespace": "SEOUL_BUS", "arsId": "99999", "providerRouteId": "999999", "directionLabel": "explicit provider direction", "legIndex": 1]
    query.merge(patch) { _, new in new }; return query
  }
  private func arrivalBindingData(_ session: Session, patch: [String: Any] = [:], queryPatch: [String: Any] = [:], boardPatch: [String: Any] = [:]) throws -> Data {
    var data = arrivalFence(session)
    var board: [String: Any] = ["sourceIndex": 0, "providerSequence": 0, "localStationId": "999996", "latitude": 0, "longitude": 200 / metersPerDegree]
    board.merge(boardPatch) { _, new in new }
    data["mapping"] = ["status": "SUPPORTED", "query": arrivalQuery(queryPatch), "boarding": board]; data.merge(patch) { _, new in new }
    return try JSONSerialization.data(withJSONObject: ["success": true, "data": data])
  }
  private func arrivalObservationData(_ session: Session, patch: [String: Any] = [:], observationPatch: [String: Any] = [:]) throws -> Data {
    var data = arrivalFence(session)
    var observation: [String: Any] = ["quality": "FRESH_WAITING_INFORMATION", "provider": "SEOUL_BUS", "kind": "BUS", "confirmedBoarding": false,
      "inputFreshnessEvidence": "PROVIDER_SOURCE_TIMESTAMP", "arsId": "99999", "directionLabel": "explicit provider direction",
      "sourceUpdatedAt": iso(1_050), "receivedAt": iso(1_052), "expectedAt": iso(1_170), "validUntil": iso(1_170)]
    observation.merge(observationPatch) { _, new in new }
    data.merge(["status": "WAITING_INFORMATION", "evaluatedAt": iso(1_052), "query": arrivalQuery(), "confirmedBoarding": false,
      "remainingStopsToAlight": NSNull(), "observation": observation]) { _, new in new }
    data.merge(patch) { _, new in new }; return try JSONSerialization.data(withJSONObject: ["success": true, "data": data])
  }
  private func iso(_ value: Double) -> String { ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: value)) }
  private func makeBusSession() throws -> Session {
    let route = try busRouteJSON()
    return try Session(routeJSON: route, bindingJSON: bindingJSON(route), now: 1_000)
  }
  private func makeRideSession(saved: Bool = false) throws -> Session {
    let base = try saved ? savedArrivalSession() : makeBusSession()
    let ride = NoLateJourneyBusRideCore.Route(identity: base.core.snapshot.identity,
      providerRouteId: "999999999", direction: "explicit provider direction", approach: try XCTUnwrap(base.bus?.snapshot.route))
    return try Session(routeJSON: base.routeJSON, bindingJSON: String(decoding: JSONEncoder().encode(base.binding), as: UTF8.self), now: 1_000, rideRoute: ride)
  }
  private func rideSteps(_ session: inout Session, vehicleEvidence: Bool = true) {
    depart(&session); walkAndWaitAtBusStop(&session)
    for index in 14...21 {
      let time = 1_000 + Double(index) * 4, coordinate = point(200 + Double(index - 13) * 40)
      // Separate synthetic source records, not a boarding flag or UI phase event.
      let vehicles: [NoLateJourneyBusRideCore.Vehicle] = vehicleEvidence ? [.init(id: "999999998",
        routeId: "999999999", direction: "explicit provider direction", coordinate: coordinate,
        sourceAt: time, receivedAt: time, validUntil: time + 15,
        source: session.routeContext == "SAVED_ROUTE" ? .verifiedWGS84 : .syntheticReplay)] : []
      session.ingest(coordinate: coordinate, accuracy: 5, observedAt: time, now: time, vehicles: vehicles)
    }
  }
  func testSessionConnectsWaitingGPSAndIndependentVehicleEvidenceToRideReducer() throws {
    var session = try makeRideSession(); rideSteps(&session)
    XCTAssertEqual(session.core.snapshot.status, .active)
    XCTAssertEqual(session.ride?.snapshot.phase, "RIDING")
    XCTAssertEqual(session.ride?.snapshot.quality, "GOOD")
    XCTAssertTrue(try XCTUnwrap(session.ride?.snapshot.boardingConfirmed))
    XCTAssertEqual(try XCTUnwrap(session.ride?.snapshot.alongRouteMeters), 320, accuracy: 0.01)
    XCTAssertEqual(session.pendingDeparture?.sequence, 1)
    let content = NoLateAutomaticGuidanceProjection.content(session, now: 1_084)
    XCTAssertTrue(content.boardingConfirmed); XCTAssertEqual(content.schemaVersion, 2)
    XCTAssertEqual(content.phase, "RIDING"); XCTAssertNil(content.walkProgress)
    let marker = try XCTUnwrap(NoLateGuidanceRoutePositionPolicy.position(content, legs: session.routeLegs, now: 1_084))
    XCTAssertEqual(marker.legIndex, 1); XCTAssertGreaterThan(marker.legProgress, 0)
    XCTAssertNil(NoLateAutomaticGuidanceProjection.position(session, coordinate: point(520), accuracy: 5, observedAt: 1_084, now: 1_084))
    var saved = try makeRideSession(saved: true); rideSteps(&saved)
    XCTAssertNotNil(NoLateAutomaticGuidanceProjection.position(saved, coordinate: point(520), accuracy: 5, observedAt: 1_084, now: 1_084))
    XCTAssertNil(NoLateAutomaticGuidanceProjection.position(session, coordinate: point(520), accuracy: 5, observedAt: 1_083, now: 1_084))
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(content, legs: session.routeLegs, now: 1_099))
  }
  func testSessionDoesNotInstallRideReducerFromRouteJSONOrFastGPSAlone() throws {
    var withoutBinding = try makeBusSession(); rideSteps(&withoutBinding)
    XCTAssertNil(withoutBinding.ride)
    var withoutVehicle = try makeRideSession(); rideSteps(&withoutVehicle, vehicleEvidence: false)
    XCTAssertFalse(try XCTUnwrap(withoutVehicle.ride?.snapshot.boardingConfirmed))
    XCTAssertEqual(withoutVehicle.ride?.snapshot.reason, "VEHICLE_ASSOCIATION_UNAVAILABLE")
  }
  func testRideRouteCannotCrossSessionGenerationRevisionEpochOrPreparedGeometry() throws {
    let base = try makeBusSession(), id = base.core.snapshot.identity, approach = try XCTUnwrap(base.bus?.snapshot.route)
    for identity in [NoLateJourneyEngineCore.Identity(sessionId: "other", generation: 1, routeRevision: 1, epoch: 1),
      .init(sessionId: id.sessionId, generation: 2, routeRevision: 1, epoch: 1),
      .init(sessionId: id.sessionId, generation: 1, routeRevision: 2, epoch: 1),
      .init(sessionId: id.sessionId, generation: 1, routeRevision: 1, epoch: 2)] {
      let route = NoLateJourneyBusRideCore.Route(identity: identity, providerRouteId: "999999999", direction: "test", approach: approach)
      XCTAssertThrowsError(try Session(routeJSON: base.routeJSON, bindingJSON: bindingJSON(base.routeJSON), now: 1_000, rideRoute: route))
    }
    let changed = NoLateJourneyBusApproachCore.Route(legIndex: 1, boardingCoordinate: point(200),
      walkingCoordinates: approach.walkingCoordinates, coordinates: [point(200), point(950)], provenance: .syntheticReplay)
    let route = NoLateJourneyBusRideCore.Route(identity: id, providerRouteId: "999999999", direction: "test", approach: changed)
    XCTAssertThrowsError(try Session(routeJSON: base.routeJSON, bindingJSON: bindingJSON(base.routeJSON), now: 1_000, rideRoute: route))
  }
  func testVehicleIdentifiersAndHistoryNeverEnterCheckpointOrDepartureOutbox() throws {
    var session = try makeRideSession(); rideSteps(&session)
    for data in [try JSONEncoder().encode(session.envelope), try JSONEncoder().encode(session.pendingDeparture)] {
      let json = String(decoding: data, as: UTF8.self)
      XCTAssertFalse(json.contains("999999998")); XCTAssertFalse(json.contains("CO_MOVEMENT_OBSERVED"))
      XCTAssertFalse(json.contains("candidateId")); XCTAssertFalse(json.contains("sourceAt"))
    }
  }
  func testRestoreRequiresFreshRideBindingAndDoesNotReuseConfirmedVehicle() throws {
    var session = try makeRideSession(); rideSteps(&session)
    let withoutBinding = try restore(session.envelope, now: 1_085)
    XCTAssertNil(withoutBinding.ride)
    let restored = try Session(restoring: session.envelope, routeJSON: session.routeJSON,
      bindingJSON: bindingJSON(session.routeJSON), now: 1_085, rideRoute: session.ride?.route)
    XCTAssertFalse(try XCTUnwrap(restored.ride?.snapshot.boardingConfirmed))
    XCTAssertEqual(restored.ride?.snapshot.evidenceCount, 0)
    XCTAssertNil(restored.ride?.snapshot.alongRouteMeters)
  }
  func testSessionClockExpiryExplicitStopAndStaleVehicleClearRide() throws {
    var stale = try makeRideSession(); rideSteps(&stale); stale.tick(now: 1_099)
    XCTAssertFalse(try XCTUnwrap(stale.ride?.snapshot.boardingConfirmed))
    XCTAssertEqual(stale.ride?.snapshot.reason, "RIDING_EVIDENCE_STALE")
    XCTAssertNil(stale.ride?.snapshot.alongRouteMeters)
    XCTAssertFalse(NoLateAutomaticGuidanceProjection.content(stale, now: 1_099).boardingConfirmed)
    XCTAssertNil(NoLateAutomaticGuidanceProjection.content(stale, now: 1_099).rideProgress)
    var stopped = try makeRideSession(); rideSteps(&stopped); stopped.stop(now: 1_085)
    XCTAssertEqual(stopped.ride?.snapshot.phase, "STOPPED")
    let sequence = stopped.ride?.snapshot.sequence
    stopped.tick(now: 1_086); stopped.stop(now: 1_087)
    XCTAssertEqual(stopped.ride?.snapshot.sequence, sequence)
    var expired = try makeRideSession(); rideSteps(&expired); expired.tick(now: 1_600)
    XCTAssertEqual(expired.ride?.snapshot.phase, "STOPPED")
    XCTAssertFalse(try XCTUnwrap(expired.ride?.snapshot.boardingConfirmed))
  }
  private func walkAndWaitAtBusStop(_ session: inout Session) {
    for index in 5...10 { session.ingest(coordinate: point(Double(index) * 20), accuracy: 5,
      observedAt: 1_000 + Double(index) * 4, now: 1_000 + Double(index) * 4) }
    for index in 11...13 { session.ingest(coordinate: point(200), accuracy: 5,
      observedAt: 1_000 + Double(index) * 4, now: 1_000 + Double(index) * 4) }
  }

  private func point(_ meters: Double) -> NoLateJourneyEngineCore.Coordinate { .init(latitude: 0, longitude: meters / metersPerDegree) }
  private func coord(_ meters: Double) -> [String: Double] { ["latitude": 0, "longitude": meters / metersPerDegree] }
  private func routeDictionary(context: String = "SYNTHETIC_FIXTURE") throws -> [String: Any] {
    ["schemaVersion": 1, "routeRevision": 1, "context": context, "provider": "tmap", "source": "api",
     "reliability": "live_provider", "plausibility": "normal", "serviceState": "operating", "origin": coord(0), "destination": coord(200),
     "legs": [["index": 0, "kind": "WALK", "geometrySource": "WALK_STEPS_LINESTRING", "exact": true,
               "geometryInputComplete": true, "stopEvidenceProvider": "tmap", "stopEvidenceVersion": 1,
               "coordinates": [coord(0), coord(100), coord(200)], "start": coord(0), "end": coord(200), "stops": []]]]
  }
  private func routeJSON(context: String = "SYNTHETIC_FIXTURE") throws -> String { try encode(routeDictionary(context: context)) }
  private func bindingJSON(_ route: String, scope: String = "SANDBOX", patch: [String: Any] = [:]) throws -> String {
    var result: [String: Any] = ["sessionId": "00000000-0000-4000-8000-000000000001", "scheduleId": "42", "generation": 1,
      "routeRevision": 1, "clientOwnerId": "00000000-0000-4000-8000-000000000002", "routeInputDigest": Session.digest(route),
      "preparedAtEpochSeconds": 1_000, "expiresAtEpochSeconds": 1_600, "execution": "SIMULATOR", "syncScope": scope]
    result.merge(patch) { _, new in new }
    return try encode(result)
  }
  private func encode(_ object: [String: Any]) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
  }
  private func makeSession() throws -> Session {
    let route = try routeJSON()
    return try Session(routeJSON: route, bindingJSON: bindingJSON(route), now: 1_000)
  }
  private func depart(_ session: inout Session) {
    for index in 0...4 { session.ingest(coordinate: point(Double(index) * 20), accuracy: 5,
      observedAt: 1_000 + Double(index) * 4, now: 1_000 + Double(index) * 4) }
  }
  private func restore(_ envelope: Session.Envelope, now: Double) throws -> Session {
    let data = try JSONEncoder().encode(envelope)
    let roundTrip = try JSONDecoder().decode(Session.Envelope.self, from: data)
    return try Session(restoring: roundTrip, routeJSON: envelope.routeJSON, bindingJSON: bindingJSON(envelope.routeJSON), now: now)
  }
  private func mutate(_ envelope: Session.Envelope, change: (inout [String: Any]) -> Void) throws -> Session.Envelope {
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope)) as? [String: Any])
    change(&object)
    return try JSONDecoder().decode(Session.Envelope.self, from: JSONSerialization.data(withJSONObject: object))
  }
}
