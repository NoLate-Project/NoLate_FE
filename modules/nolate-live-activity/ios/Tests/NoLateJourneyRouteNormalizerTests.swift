import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

/// Unit fixtures assert DTO claims only; none is a fetched or field-validated route.
final class NoLateJourneyRouteNormalizerTests: XCTestCase {
  private typealias Normalizer = NoLateJourneyRouteNormalizer
  private let metersPerDegree = 6_371_000.0 * Double.pi / 180

  func testDirectWalkingShapeAllowsReadOnlyDepartureAdmission() throws {
    let summary = try evaluate(route())
    XCTAssertEqual(summary.eligibleDepartureLegIndex, 0)
    XCTAssertTrue(summary.legs[0].geometryUsable)
    XCTAssertEqual(try XCTUnwrap(summary.legs[0].geometryLengthMeters), 100, accuracy: 0.01)
    XCTAssertEqual(summary.evaluationMode, "READ_ONLY")
    XCTAssertFalse(summary.fullAutomaticGuidance)
    XCTAssertFalse(summary.fieldValidated)
    XCTAssertTrue(summary.reasonCodes.isEmpty)
  }

  func testTwoWalkingDirectSourcesAreAcceptedButNoLegacyFallbackIs() throws {
    for source in ["WALK_STEPS_LINESTRING", "WALK_PASS_SHAPE_LINESTRING"] {
      var leg = walk(); leg["geometrySource"] = source
      XCTAssertNotNil(try evaluate(route(legs: [leg])).eligibleDepartureLegIndex)
    }
    for source in ["PASS_STOP_LIST", "ITINERARY_PATH_SNAP", "UNKNOWN", "TRANSIT_PASS_SHAPE_LINESTRING", ""] {
      var leg = walk(); leg["geometrySource"] = source
      let summary = try evaluate(route(legs: [leg]))
      XCTAssertNil(summary.eligibleDepartureLegIndex)
      XCTAssertTrue(summary.legs[0].reasonCodes.contains("GEOMETRY_PROVENANCE_UNTRUSTED"))
    }
  }

  func testMissingOrFalseCompletenessCannotReuseDisplayFilteredShape() throws {
    for completeness in [nil, false] as [Bool?] {
      var leg = walk(); leg["geometryInputComplete"] = completeness
      let summary = try evaluate(route(legs: [leg]))
      XCTAssertFalse(summary.legs[0].geometryUsable)
      XCTAssertNil(summary.eligibleDepartureLegIndex)
      XCTAssertNotNil(summary.legs[0].geometryLengthMeters)
      XCTAssertTrue(summary.legs[0].reasonCodes.contains("GEOMETRY_INPUT_UNVERIFIED"))
    }
  }

  func testInexactShapeIsBlocked() throws {
    var leg = walk(); leg["exact"] = false
    let summary = try evaluate(route(legs: [leg]))
    XCTAssertFalse(summary.legs[0].geometryUsable)
    XCTAssertTrue(summary.legs[0].reasonCodes.contains("GEOMETRY_NOT_EXACT"))
  }

  func testCompleteShapeNeedsMatchingProviderEvidenceAndSupportedVersion() throws {
    for (provider, version) in [(nil, nil), ("odsay", 1), ("tmap", 2)] as [(String?, Int?)] {
      var leg = walk(); leg["stopEvidenceProvider"] = provider; leg["stopEvidenceVersion"] = version
      let summary = try evaluate(route(legs: [leg]))
      XCTAssertFalse(summary.legs[0].geometryUsable)
      XCTAssertNil(summary.eligibleDepartureLegIndex)
      XCTAssertTrue(summary.legs[0].reasonCodes.contains("GEOMETRY_EVIDENCE_UNVERIFIED"))
      XCTAssertNotNil(summary.legs[0].geometryLengthMeters)
    }
  }

  func testSyntheticFixtureRetainsStructuralResultButCannotAdmitRealDeparture() throws {
    var input = route(); input["context"] = "SYNTHETIC_FIXTURE"
    let summary = try evaluate(input)
    XCTAssertTrue(summary.legs[0].geometryUsable)
    XCTAssertNil(summary.eligibleDepartureLegIndex)
    XCTAssertTrue(summary.reasonCodes.contains("SYNTHETIC_FIXTURE_ONLY"))
  }

  func testSavedRouteRequiresFreshRevalidationEvenIfShapeLooksExact() throws {
    var input = route(); input["context"] = "SAVED_ROUTE"
    let summary = try evaluate(input)
    XCTAssertTrue(summary.legs[0].geometryUsable)
    XCTAssertNil(summary.eligibleDepartureLegIndex)
    XCTAssertTrue(summary.reasonCodes.contains("SAVED_ROUTE_REVALIDATION_REQUIRED"))
  }

  func testFallbackAndUnknownRouteQualityCannotAdmitDeparture() throws {
    for (key, value) in [("provider", "UNKNOWN"), ("source", "fallback"), ("source", "UNKNOWN"),
                         ("reliability", "fallback_estimate"), ("reliability", "UNKNOWN"),
                         ("plausibility", "geometry_suspected"), ("plausibility", "UNKNOWN"),
                         ("serviceState", "not_operating"), ("serviceState", "UNKNOWN")] {
      var input = route(); input[key] = value
      let summary = try evaluate(input)
      XCTAssertNil(summary.eligibleDepartureLegIndex, "Unexpected admission for \(key)=\(value)")
      XCTAssertEqual(summary.legs[0].geometryUsable, key != "provider")
    }
  }

  func testProviderETAEstimateDoesNotInvalidateDirectGeometry() throws {
    var input = route(); input["reliability"] = "provider_estimate"
    XCTAssertEqual(try evaluate(input).eligibleDepartureLegIndex, 0)
  }

  func testUnknownLegKindIsPreservedAndBlockedRatherThanAssumedWalk() throws {
    var leg = walk(); leg["kind"] = "UNKNOWN"
    let summary = try evaluate(route(legs: [leg]))
    XCTAssertNil(summary.eligibleDepartureLegIndex)
    XCTAssertTrue(summary.reasonCodes.contains("FIRST_LEG_NOT_WALK"))
    XCTAssertFalse(summary.legs[0].geometryUsable)
  }

  func testInvalidMiddleCoordinateIsNotDroppedOrConnectedAcross() throws {
    for invalid in [NSNull(), point(50, north: 10_100_000), ["latitude": 0, "longitude": 181]] as [Any] {
      var leg = walk(); leg["coordinates"] = [point(0), invalid, point(100)]
      let summary = try evaluate(route(legs: [leg]))
      XCTAssertFalse(summary.legs[0].geometryUsable)
      XCTAssertNil(summary.legs[0].geometryLengthMeters)
      XCTAssertEqual(summary.legs[0].shapePointCount, 3)
      XCTAssertTrue(summary.legs[0].reasonCodes.contains("GEOMETRY_COORDINATE_INVALID"))
    }
  }

  func testMalformedCoordinateTypeFailsAtDecode() throws {
    var leg = walk(); leg["coordinates"] = [["latitude": "0", "longitude": 0], point(100)]
    XCTAssertThrowsError(try evaluate(route(legs: [leg])))
  }

  func testNonFiniteJSONNumbersAreRejected() throws {
    let validInput = try json(route())
    for nonfinite in ["NaN", "Infinity", "-Infinity", "1e999"] {
      let invalid = validInput.replacingOccurrences(of: "\"latitude\":0", with: "\"latitude\":\(nonfinite)")
      XCTAssertNotEqual(invalid, validInput)
      XCTAssertThrowsError(try Normalizer.normalize(json: invalid))
    }
  }

  func testDuplicateAndZeroLengthGeometryCannotPass() throws {
    for shape in [[point(0), point(0)], [point(0), point(50), point(50), point(100)]] {
      var leg = walk(); leg["coordinates"] = shape
      let summary = try evaluate(route(legs: [leg]))
      XCTAssertFalse(summary.legs[0].geometryUsable)
      XCTAssertTrue(summary.legs[0].reasonCodes.contains("GEOMETRY_DUPLICATE_COORDINATE"))
    }
  }

  func testMissingAndSinglePointGeometryAreBlocked() throws {
    for shape in [[], [point(0)]] {
      var leg = walk(); leg["coordinates"] = shape
      XCTAssertTrue(try evaluate(route(legs: [leg])).legs[0].reasonCodes.contains("GEOMETRY_MISSING"))
    }
  }

  func testShortWalkingGeometryCannotEnableDeparture() throws {
    let summary = try evaluate(route(legs: [walk(end: 60)], destination: point(60)))
    XCTAssertTrue(summary.legs[0].geometryUsable)
    XCTAssertNil(summary.eligibleDepartureLegIndex)
    XCTAssertTrue(summary.reasonCodes.contains("FIRST_WALK_TOO_SHORT"))
  }

  func testModeSpecificSegmentGapLimits() throws {
    for (kind, limit) in [("WALK", 150.0), ("BUS", 2_000.0), ("SUBWAY", 5_000.0)] {
      var leg = kind == "WALK" ? walk(end: limit + 1) : ride(kind: kind, start: 0, end: limit + 1)
      leg["index"] = 0
      leg["coordinates"] = [point(0), point(limit + 1)]
      let summary = try evaluate(route(legs: [leg], destination: point(limit + 1)))
      XCTAssertTrue(summary.legs[0].reasonCodes.contains("GEOMETRY_SEGMENT_GAP"), kind)
      leg["coordinates"] = [point(0), point(limit - 1)]
      leg["end"] = point(limit - 1)
      let inside = try evaluate(route(legs: [leg], destination: point(limit - 1)))
      XCTAssertFalse(inside.legs[0].reasonCodes.contains("GEOMETRY_SEGMENT_GAP"), kind)
    }
  }

  func testBacktrackingAndCrossingShapesAreBlocked() throws {
    var reversal = walk(); reversal["coordinates"] = [point(0), point(100), point(30), point(100, north: 30)]
    reversal["end"] = point(100, north: 30)
    XCTAssertTrue(try evaluate(route(legs: [reversal], destination: point(100, north: 30)))
      .legs[0].reasonCodes.contains("GEOMETRY_BACKTRACKING"))
    var crossing = walk()
    crossing["coordinates"] = [point(0), point(100, north: 100), point(0, north: 100), point(100)]
    XCTAssertTrue(try evaluate(route(legs: [crossing])).legs[0].reasonCodes.contains("GEOMETRY_SELF_INTERSECTION"))
  }

  func testExcessiveIntersectionWorkIsConservativelyBounded() throws {
    var leg = walk(end: 700)
    leg["coordinates"] = (0...700).map { point(Double($0)) }
    let summary = try evaluate(route(legs: [leg], destination: point(700)))
    XCTAssertFalse(summary.legs[0].geometryUsable)
    XCTAssertTrue(summary.legs[0].reasonCodes.contains("GEOMETRY_COMPLEXITY_LIMIT"))
  }

  func testEndpointMismatchAndMissingEndpointsAreBlocked() throws {
    var leg = walk(); leg["start"] = point(-76)
    XCTAssertTrue(try evaluate(route(legs: [leg])).legs[0].reasonCodes.contains("GEOMETRY_ENDPOINT_MISMATCH"))
    leg = walk(); leg.removeValue(forKey: "end")
    XCTAssertTrue(try evaluate(route(legs: [leg])).legs[0].reasonCodes.contains("LEG_ENDPOINT_INVALID_OR_MISSING"))
  }

  func testSelectedRouteOriginIsCheckedAgainstShapeNotOnlyLegMetadata() throws {
    var leg = walk(); leg["start"] = point(-60)
    var input = route(legs: [leg]); input["origin"] = point(-120)
    let summary = try evaluate(input)
    XCTAssertTrue(summary.legs[0].geometryUsable)
    XCTAssertNil(summary.eligibleDepartureLegIndex)
    XCTAssertTrue(summary.reasonCodes.contains("ORIGIN_MISMATCH"))
  }

  func testSelectedDestinationIsCheckedAgainstShape() throws {
    var leg = walk(); leg["end"] = point(160)
    let summary = try evaluate(route(legs: [leg], destination: point(220)))
    XCTAssertTrue(summary.legs[0].geometryUsable)
    XCTAssertTrue(summary.reasonCodes.contains("DESTINATION_MISMATCH"))
  }

  func testMissingInvalidOrIdenticalRouteEndpointsAreBlocked() throws {
    var missing = route(); missing.removeValue(forKey: "origin")
    XCTAssertTrue(try evaluate(missing).reasonCodes.contains("ROUTE_ENDPOINT_MISSING"))
    var invalid = route(); invalid["origin"] = ["latitude": -91, "longitude": 0]
    XCTAssertTrue(try evaluate(invalid).reasonCodes.contains("ROUTE_ENDPOINT_INVALID"))
    XCTAssertTrue(try evaluate(route(destination: point(0))).reasonCodes.contains("ROUTE_ENDPOINTS_IDENTICAL"))
  }

  func testDisconnectedLegMetadataAndGeometryBothBlockAdmission() throws {
    let gap = try evaluate(route(legs: [walk(), ride(start: 300, end: 500)], destination: point(500)))
    XCTAssertTrue(gap.reasonCodes.contains("LEG_CONTINUITY_GAP"))
    XCTAssertTrue(gap.reasonCodes.contains("LEG_GEOMETRY_CONTINUITY_GAP"))
    var first = walk(); first["end"] = point(170)
    var second = ride(start: 300, end: 500); second["start"] = point(230)
    let hiddenGap = try evaluate(route(legs: [first, second], destination: point(500)))
    XCTAssertFalse(hiddenGap.reasonCodes.contains("LEG_CONTINUITY_GAP"))
    XCTAssertTrue(hiddenGap.reasonCodes.contains("LEG_GEOMETRY_CONTINUITY_GAP"))
    XCTAssertNil(hiddenGap.eligibleDepartureLegIndex)
  }

  func testOrderedProviderStopEvidenceAllowsReadOnlyRideCapability() throws {
    let summary = try evaluate(multiRoute())
    XCTAssertEqual(summary.eligibleDepartureLegIndex, 0)
    let leg = summary.legs[1]
    XCTAssertTrue(leg.geometryUsable)
    XCTAssertTrue(leg.stopSequenceUsable)
    XCTAssertTrue(leg.directionExplicit)
    XCTAssertTrue(leg.rideNavigationEligible)
    XCTAssertTrue(leg.reasonCodes.isEmpty)
    XCTAssertFalse(summary.fullAutomaticGuidance)
  }

  func testStopSequenceMayStartAtAnyNonnegativeProviderIndex() throws {
    for firstSequence in [0, 1, 91] {
      var leg = ride()
      leg["stops"] = [stop(0, at: 100, sequence: firstSequence), stop(1, at: 300, sequence: firstSequence + 1),
                      stop(2, at: 500, sequence: firstSequence + 2)]
      XCTAssertTrue(try evaluate(multiRoute(rideLeg: leg)).legs[1].stopSequenceUsable)
    }
  }

  func testMissingMixedDuplicateDescendingOrSkippedSequencesAreBlocked() throws {
    for sequences in [[1, nil, 3], [1, 1, 2], [3, 2, 1], [1, 3, 4], [-1, 0, 1]] as [[Int?]] {
      var leg = ride()
      leg["stops"] = sequences.enumerated().map { stop($0.offset, at: 100 + Double($0.offset) * 200, sequence: $0.element) }
      let result = try evaluate(multiRoute(rideLeg: leg)).legs[1]
      XCTAssertFalse(result.stopSequenceUsable)
      XCTAssertTrue(result.reasonCodes.contains("STOP_SEQUENCE_UNVERIFIED"))
    }
  }

  func testStopSourceIndexMustBeDenseOriginalOrder() throws {
    var leg = ride()
    leg["stops"] = [stop(0, at: 100, sequence: 1), stop(3, at: 300, sequence: 2), stop(2, at: 500, sequence: 3)]
    XCTAssertTrue(try evaluate(multiRoute(rideLeg: leg)).legs[1].reasonCodes.contains("STOP_SOURCE_INDEX_INVALID"))
  }

  func testStopProviderSequenceCannotExceedJavaScriptIntegerPrecision() throws {
    var leg = ride()
    leg["stops"] = [stop(0, at: 100, sequence: 9_007_199_254_740_991),
                    stop(1, at: 300, sequence: 9_007_199_254_740_992),
                    stop(2, at: 500, sequence: 9_007_199_254_740_993)]
    XCTAssertTrue(try evaluate(multiRoute(rideLeg: leg)).legs[1].reasonCodes.contains("STOP_SEQUENCE_UNVERIFIED"))
  }

  func testDeclaredStationCountMustEqualNumberOfIntervals() throws {
    for count in [nil, 0, 3] as [Int?] {
      var leg = ride(); leg["declaredStationCount"] = count
      XCTAssertTrue(try evaluate(multiRoute(rideLeg: leg)).legs[1].reasonCodes.contains("STATION_COUNT_MISMATCH_OR_MISSING"))
    }
  }

  func testProviderStopEvidenceMustMatchRouteAndVersion() throws {
    for (provider, version) in [("UNKNOWN", 1), ("odsay", 1), ("tmap", 0), ("tmap", 2)] {
      var leg = ride(); leg["stopEvidenceProvider"] = provider; leg["stopEvidenceVersion"] = version
      XCTAssertTrue(try evaluate(multiRoute(rideLeg: leg)).legs[1].reasonCodes.contains("STOP_EVIDENCE_UNVERIFIED"))
    }
    var leg = ride(); leg["stopEvidenceProvider"] = "odsay"
    var input = multiRoute(rideLeg: leg); input["provider"] = "odsay"
    XCTAssertTrue(try evaluate(input).legs[1].stopSequenceUsable)
  }

  func testMissingStopIDOrCoordinateDoesNotUseNameOrSkipOccurrence() throws {
    var noID = stop(1, at: 300, sequence: 2); noID["code"] = " "
    var leg = ride(); leg["stops"] = [stop(0, at: 100, sequence: 1), noID, stop(2, at: 500, sequence: 3)]
    XCTAssertTrue(try evaluate(multiRoute(rideLeg: leg)).legs[1].reasonCodes.contains("STOP_ID_MISSING"))
    var noCoordinate = stop(1, at: 300, sequence: 2); noCoordinate["coordinate"] = NSNull()
    leg["stops"] = [stop(0, at: 100, sequence: 1), noCoordinate, stop(2, at: 500, sequence: 3)]
    let summary = try evaluate(multiRoute(rideLeg: leg)).legs[1]
    XCTAssertEqual(summary.stopCount, 3)
    XCTAssertFalse(summary.stopSequenceUsable)
    XCTAssertTrue(summary.reasonCodes.contains("STOP_COORDINATE_INVALID_OR_MISSING"))
  }

  func testRepeatedStopOccurrenceIsPreservedAndAmbiguous() throws {
    var leg = ride()
    leg["stops"] = [stop(0, at: 100, sequence: 1), stop(1, at: 100, sequence: 2), stop(2, at: 500, sequence: 3)]
    let summary = try evaluate(multiRoute(rideLeg: leg)).legs[1]
    XCTAssertEqual(summary.stopCount, 3)
    XCTAssertTrue(summary.reasonCodes.contains("AMBIGUOUS_STOP_OCCURRENCE"))
    XCTAssertFalse(summary.stopSequenceUsable)
  }

  func testRepeatedStopIDsAtDifferentOccurrencesAreNotDeduplicated() throws {
    var leg = ride()
    var first = stop(0, at: 100, sequence: 1); first["code"] = "shared-stop"
    var last = stop(2, at: 500, sequence: 3); last["code"] = "shared-stop"
    leg["stops"] = [first, stop(1, at: 300, sequence: 2), last]
    let summary = try evaluate(multiRoute(rideLeg: leg)).legs[1]
    XCTAssertEqual(summary.stopCount, 3)
    XCTAssertTrue(summary.stopSequenceUsable)
  }

  func testStopProjectionMustFollowGeometryWithoutSorting() throws {
    var leg = ride(); leg["declaredStationCount"] = 3
    leg["stops"] = [stop(0, at: 100, sequence: 1), stop(1, at: 400, sequence: 2),
                    stop(2, at: 300, sequence: 3), stop(3, at: 500, sequence: 4)]
    let summary = try evaluate(multiRoute(rideLeg: leg)).legs[1]
    XCTAssertEqual(summary.stopCount, 4)
    XCTAssertTrue(summary.reasonCodes.contains("STOP_PROGRESS_NON_MONOTONIC"))
    XCTAssertFalse(summary.stopSequenceUsable)
  }

  func testOffShapeAndEndpointMismatchingStopsAreBlocked() throws {
    var leg = ride()
    var middle = stop(1, at: 300, sequence: 2); middle["coordinate"] = point(300, north: 76)
    leg["stops"] = [stop(0, at: 100, sequence: 1), middle, stop(2, at: 500, sequence: 3)]
    XCTAssertTrue(try evaluate(multiRoute(rideLeg: leg)).legs[1].reasonCodes.contains("STOP_OFF_GEOMETRY"))
    leg["stops"] = [stop(0, at: 200, sequence: 1), stop(1, at: 300, sequence: 2), stop(2, at: 500, sequence: 3)]
    XCTAssertTrue(try evaluate(multiRoute(rideLeg: leg)).legs[1].reasonCodes.contains("STOP_ENDPOINT_MISMATCH"))
  }

  func testParallelNearbyShapeSegmentsMakeStopProjectionAmbiguous() throws {
    var leg = ride(start: 100, end: 300)
    let shape = [point(100), point(300), point(320, north: 20), point(300, north: 40), point(100, north: 40)]
    leg["coordinates"] = shape; leg["end"] = shape.last
    var middle = stop(1, at: 200, sequence: 2); middle["coordinate"] = point(200, north: 20)
    var last = stop(2, at: 100, sequence: 3); last["coordinate"] = point(100, north: 40)
    leg["stops"] = [stop(0, at: 100, sequence: 1), middle, last]
    let summary = try evaluate(route(legs: [walk(), leg], destination: point(100, north: 40))).legs[1]
    XCTAssertTrue(summary.geometryUsable)
    XCTAssertTrue(summary.reasonCodes.contains("AMBIGUOUS_STOP_PROJECTION"))
    XCTAssertFalse(summary.stopSequenceUsable)
  }

  func testMissingDirectionAndProviderIDDoNotPoisonIndependentShapeResult() throws {
    var leg = ride(); leg.removeValue(forKey: "directionName"); leg.removeValue(forKey: "providerRouteId")
    leg["localRouteId"] = "display-only-local-id"
    let summary = try evaluate(multiRoute(rideLeg: leg)).legs[1]
    XCTAssertTrue(summary.geometryUsable)
    XCTAssertTrue(summary.stopSequenceUsable)
    XCTAssertFalse(summary.directionExplicit)
    XCTAssertFalse(summary.rideNavigationEligible)
    XCTAssertTrue(summary.reasonCodes.contains("DIRECTION_NOT_EXPLICIT"))
    XCTAssertTrue(summary.reasonCodes.contains("PROVIDER_ROUTE_ID_MISSING"))
  }

  func testDirectionRequiresExplicitNameOrRecognizedCodeNotStopNames() throws {
    for code in [nil, "UNKNOWN", "clockwise"] as [String?] {
      var leg = ride(); leg["directionName"] = " "; leg["directionCode"] = code
      XCTAssertFalse(try evaluate(multiRoute(rideLeg: leg)).legs[1].directionExplicit)
    }
    for code in ["UP", "DOWN"] {
      var leg = ride(); leg.removeValue(forKey: "directionName"); leg["directionCode"] = code
      XCTAssertTrue(try evaluate(multiRoute(rideLeg: leg)).legs[1].directionExplicit)
    }
  }

  func testUnavailableRideBlocksRouteAndRideButPreservesGeometry() throws {
    var leg = ride(); leg["serviceAvailable"] = false
    let summary = try evaluate(multiRoute(rideLeg: leg))
    XCTAssertNil(summary.eligibleDepartureLegIndex)
    XCTAssertTrue(summary.legs[1].geometryUsable)
    XCTAssertFalse(summary.legs[1].rideNavigationEligible)
    XCTAssertTrue(summary.reasonCodes.contains("LEG_SERVICE_UNAVAILABLE"))
  }

  func testSyntheticAndSavedContextNeverAdvertiseRideNavigationEligibility() throws {
    for context in ["SYNTHETIC_FIXTURE", "SAVED_ROUTE"] {
      var input = multiRoute(); input["context"] = context
      let summary = try evaluate(input)
      XCTAssertTrue(summary.legs[1].stopSequenceUsable)
      XCTAssertFalse(summary.legs[1].rideNavigationEligible)
    }
  }

  func testTransitStopsOnlyGeometryCannotBecomeNavigationShape() throws {
    var leg = ride(); leg["geometrySource"] = "PASS_STOP_LIST"
    let summary = try evaluate(multiRoute(rideLeg: leg)).legs[1]
    XCTAssertFalse(summary.geometryUsable)
    XCTAssertFalse(summary.stopSequenceUsable)
    XCTAssertTrue(summary.reasonCodes.contains("STOP_GEOMETRY_UNUSABLE"))
  }

  func testMalformedSchemaRequiredFieldsAndTypeErrorsThrow() throws {
    for json in ["", "{", "[]", "null", "{}"] { XCTAssertThrowsError(try Normalizer.normalize(json: json)) }
    for key in ["schemaVersion", "routeRevision", "context", "provider", "source", "reliability", "plausibility", "serviceState", "legs"] {
      var input = route(); input.removeValue(forKey: key)
      XCTAssertThrowsError(try evaluate(input), "Missing \(key)")
    }
    var input = route(); input["schemaVersion"] = 2
    XCTAssertThrowsError(try evaluate(input))
    input = route(); input["context"] = "LIVE_DEVICE"
    XCTAssertThrowsError(try evaluate(input))
    input = route(); input["routeRevision"] = true
    XCTAssertThrowsError(try evaluate(input))
  }

  func testRevisionMustRemainAnExactNonnegativeJavaScriptInteger() throws {
    for revision in [-1, 0, 9_007_199_254_740_992] as [Int64] {
      var input = route(); input["routeRevision"] = revision
      XCTAssertThrowsError(try evaluate(input))
    }
    var input = route(); input["routeRevision"] = Int64(9_007_199_254_740_991)
    XCTAssertEqual(try evaluate(input).routeRevision, 9_007_199_254_740_991)
  }

  func testLegCountAndDenseIndicesAreBounded() throws {
    XCTAssertThrowsError(try evaluate(route(legs: [])))
    var leg = walk(); leg["index"] = 1
    XCTAssertThrowsError(try evaluate(route(legs: [leg])))
    let legs = (0..<33).map { index -> [String: Any] in var item = walk(); item["index"] = index; return item }
    XCTAssertThrowsError(try evaluate(route(legs: legs)))
  }

  func testPerLegAndTotalGeometryAndStopBounds() throws {
    var leg = walk(); leg["coordinates"] = Array(repeating: point(0), count: 2_001)
    XCTAssertThrowsError(try evaluate(route(legs: [leg])))
    leg = ride(); leg["index"] = 0; leg["stops"] = Array(repeating: stop(0, at: 100, sequence: 1), count: 501)
    XCTAssertThrowsError(try evaluate(route(legs: [leg])))
    let shapeLegs = (0..<7).map { index -> [String: Any] in
      var item = walk(); item["index"] = index; item["coordinates"] = Array(repeating: point(0), count: 1_800); return item
    }
    XCTAssertThrowsError(try evaluate(route(legs: shapeLegs)))
    let stopLegs = (0..<5).map { index -> [String: Any] in
      var item = ride(); item["index"] = index; item["stops"] = Array(repeating: stop(0, at: 100, sequence: 1), count: 450); return item
    }
    XCTAssertThrowsError(try evaluate(route(legs: stopLegs)))
  }

  func testStringUTF8AndPayloadByteBounds() throws {
    var leg = ride(); leg["directionName"] = String(repeating: "역", count: 86)
    XCTAssertThrowsError(try evaluate(multiRoute(rideLeg: leg)))
    leg["directionName"] = String(repeating: "a", count: 256)
    XCTAssertNoThrow(try evaluate(multiRoute(rideLeg: leg)))
    let input = try json(route())
    XCTAssertThrowsError(try Normalizer.normalize(json: input + String(repeating: " ", count: 1_048_576)))
  }

  func testSummaryIsDeterministicAndContainsNoCoordinateNameOrIdentifier() throws {
    let input = try json(multiRoute())
    let output = try Normalizer.summaryJSON(json: input)
    XCTAssertEqual(output, try Normalizer.summaryJSON(json: input))
    for sensitive in ["latitude", "longitude", "provider-route-private", "stop-private", "Private Stop", "local-route-private"] {
      XCTAssertFalse(output.contains(sensitive))
    }
    let decoded = try JSONDecoder().decode(Normalizer.Summary.self, from: Data(output.utf8))
    XCTAssertEqual(decoded, try Normalizer.normalize(json: input))
  }

  func testSummaryUsesExplicitNullsForMissingEligibilityAndLength() throws {
    var leg = walk(); leg["coordinates"] = []
    let output = try Normalizer.summaryJSON(json: json(route(legs: [leg])))
    let dictionary = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String: Any])
    XCTAssertTrue(dictionary["eligibleDepartureLegIndex"] is NSNull)
    let legs = try XCTUnwrap(dictionary["legs"] as? [[String: Any]])
    XCTAssertTrue(legs[0]["geometryLengthMeters"] is NSNull)
  }

  func testGuidanceMetadataRequiresVerifiedWalkingShapeAndContinuousBoardingStop() throws {
    let prepared = try Normalizer.prepareWalkingRoute(json: json(multiRoute()))
    XCTAssertEqual(try XCTUnwrap(prepared.guidanceLegs[0].walkingLengthMeters), 100, accuracy: 0.01)
    XCTAssertEqual(prepared.guidanceLegs[1].boardingStopName, "Private Stop 0")
    XCTAssertNil(prepared.guidanceLegs[1].walkingLengthMeters)
    var disconnected = multiRoute(rideLeg: ride(start: 200))
    disconnected["context"] = "SYNTHETIC_FIXTURE"
    let rejectedBus = try Normalizer.prepareWalkingRoute(json: json(disconnected), allowSyntheticSandbox: true)
    XCTAssertNil(rejectedBus.busRoute)
    XCTAssertNil(rejectedBus.guidanceLegs[1].boardingStopName)
  }
  func testProviderDisplayMetadataSurvivesPreparationWithoutPromotingRideEvidence() throws {
    var walking = walk(); walking["display"] = ["durationMinutes": 2, "distanceMeters": 100]
    var bus = ride(); bus["display"] = ["lineName": "601", "lineColor": "e8752b", "durationMinutes": 5, "distanceMeters": 400] as [String: Any]
    let prepared = try Normalizer.prepareWalkingRoute(json: json(route(legs: [walking, bus], destination: point(500))))
    XCTAssertEqual(prepared.guidanceLegs[1].lineName, "601"); XCTAssertEqual(prepared.guidanceLegs[1].lineColor, "#E8752B")
    XCTAssertEqual(prepared.guidanceLegs[0].durationMinutes, 2)
    XCTAssertEqual(NoLateGuidanceRouteLayoutPolicy.layout(prepared.guidanceLegs).fractions, [2.0/7, 5.0/7])
    bus["display"] = ["lineName": "bad\nname", "lineColor": "red", "durationMinutes": -1] as [String: Any]
    let invalid = try Normalizer.prepareWalkingRoute(json: json(route(legs: [walking, bus], destination: point(500))))
    XCTAssertNil(invalid.guidanceLegs[1].lineName); XCTAssertNil(invalid.guidanceLegs[1].durationMinutes)
    XCTAssertEqual(invalid.summary, prepared.summary)
  }

  func testOfficialBusCrosswalkFillsOnlyMissingStaticClaimsForSavedODsayRoute() throws {
    var bus = ride()
    bus["localRouteId"] = "100100185"
    bus.removeValue(forKey: "providerRouteId")
    bus.removeValue(forKey: "directionName")
    bus.removeValue(forKey: "declaredStationCount")
    bus.removeValue(forKey: "serviceAvailable")
    bus["stopEvidenceProvider"] = "odsay"
    var first = walk(); first["stopEvidenceProvider"] = "odsay"
    var last = walk(end: 600)
    last["index"] = 2; last["start"] = point(500)
    last["coordinates"] = [point(500), point(600)]
    last["stopEvidenceProvider"] = "odsay"
    var input = route(legs: [first, bus, last], destination: point(600))
    input["provider"] = "odsay"; input["context"] = "SAVED_ROUTE"; input["serviceState"] = "UNKNOWN"
    let proof = Normalizer.OfficialBusAdmission(schemaVersion: 1, identityEvidence: "OFFICIAL_STOP_SHAPE_CROSSWALK",
      busLegIndex: 1, routeId: "100100185", direction: "상행", stationCount: 2,
      firstStopSequence: 1, lastStopSequence: 3)
    let savedJSON = try json(input)
    let unverified = try Normalizer.normalize(json: savedJSON)
    XCTAssertTrue(unverified.reasonCodes.contains("ROUTE_SERVICE_UNVERIFIED"))
    XCTAssertFalse(unverified.legs[1].stopSequenceUsable)
    XCTAssertFalse(unverified.legs[1].directionExplicit)
    XCTAssertThrowsError(try Normalizer.prepareWalkingRoute(json: savedJSON, allowValidatedSavedRoute: true))

    let accepted = try Normalizer.prepareWalkingRoute(json: savedJSON,
      allowValidatedSavedRoute: true, officialBusAdmission: proof)
    XCTAssertEqual(accepted.summary.reasonCodes, ["SAVED_ROUTE_REVALIDATION_REQUIRED"])
    XCTAssertTrue(accepted.summary.legs[1].stopSequenceUsable)
    XCTAssertTrue(accepted.summary.legs[1].directionExplicit)
    XCTAssertNotNil(accepted.busRoute)
    XCTAssertFalse(accepted.summary.fieldValidated)
    XCTAssertFalse(accepted.summary.fullAutomaticGuidance)

    let wrong = Normalizer.OfficialBusAdmission(schemaVersion: 1, identityEvidence: "OFFICIAL_STOP_SHAPE_CROSSWALK",
      busLegIndex: 1, routeId: "100100186", direction: "상행", stationCount: 2,
      firstStopSequence: 1, lastStopSequence: 3)
    XCTAssertThrowsError(try Normalizer.prepareWalkingRoute(json: savedJSON,
      allowValidatedSavedRoute: true, officialBusAdmission: wrong))
    input["serviceState"] = "not_operating"
    XCTAssertThrowsError(try Normalizer.prepareWalkingRoute(json: json(input),
      allowValidatedSavedRoute: true, officialBusAdmission: proof))
  }

  func testOfficialSubwayCrosswalkMatchesOnlyTheSavedSingleLeg() throws {
    var subway = ride(kind: "SUBWAY")
    subway["providerRouteId"] = "1000:2"
    subway["directionCode"] = "UP"
    subway["stopEvidenceProvider"] = "odsay"
    var stops = subway["stops"] as! [[String: Any]]
    for index in stops.indices { stops[index]["routingStationId"] = String(222 + index) }
    subway["stops"] = stops
    var first = walk(); first["stopEvidenceProvider"] = "odsay"
    var last = walk(end: 600)
    last["index"] = 2; last["start"] = point(500)
    last["coordinates"] = [point(500), point(600)]
    last["stopEvidenceProvider"] = "odsay"
    var input = route(legs: [first, subway, last], destination: point(600))
    input["provider"] = "odsay"; input["context"] = "SAVED_ROUTE"; input["serviceState"] = "UNKNOWN"
    let proof = Normalizer.OfficialSubwayAdmission(schemaVersion: 1,
      identityEvidence: "OFFICIAL_STATION_PATH_CROSSWALK", subwayLegIndex: 1,
      providerRouteId: "1000:2", startRoutingStationId: "222", endRoutingStationId: "224", stationCount: 2)
    let decoded = try JSONDecoder().decode(Normalizer.Input.self, from: Data(json(input).utf8))
    XCTAssertTrue(proof.matches(decoded))
    XCTAssertEqual(try Normalizer.normalize(json: json(input), officialSubwayAdmission: proof).reasonCodes,
      ["SAVED_ROUTE_REVALIDATION_REQUIRED"])
    let wrong = Normalizer.OfficialSubwayAdmission(schemaVersion: 1,
      identityEvidence: "OFFICIAL_STATION_PATH_CROSSWALK", subwayLegIndex: 1,
      providerRouteId: "1000:2", startRoutingStationId: "223", endRoutingStationId: "224", stationCount: 2)
    XCTAssertFalse(wrong.matches(decoded))
    input["serviceState"] = "not_operating"
    XCTAssertFalse(proof.matches(try JSONDecoder().decode(Normalizer.Input.self, from: Data(json(input).utf8))))
  }

  private func point(_ east: Double, north: Double = 0) -> [String: Double] {
    ["latitude": north / metersPerDegree, "longitude": east / metersPerDegree]
  }

  private func walk(end: Double = 100) -> [String: Any] {
    ["index": 0, "kind": "WALK", "geometrySource": "WALK_STEPS_LINESTRING", "exact": true,
     "geometryInputComplete": true, "coordinates": [point(0), point(end)],
     "start": point(0), "end": point(end), "stops": [], "stopEvidenceProvider": "tmap", "stopEvidenceVersion": 1]
  }

  private func ride(kind: String = "BUS", start: Double = 100, end: Double = 500) -> [String: Any] {
    let middle = (start + end) / 2
    return ["index": 1, "kind": kind, "geometrySource": "TRANSIT_PASS_SHAPE_LINESTRING", "exact": true,
            "geometryInputComplete": true, "coordinates": [point(start), point(middle), point(end)],
            "start": point(start), "end": point(end), "providerRouteId": "provider-route-private",
            "localRouteId": "local-route-private", "directionName": "Explicit provider direction",
            "serviceAvailable": true, "declaredStationCount": 2, "stopEvidenceProvider": "tmap", "stopEvidenceVersion": 1,
            "stops": [stop(0, at: start, sequence: 1), stop(1, at: middle, sequence: 2), stop(2, at: end, sequence: 3)]]
  }

  private func stop(_ index: Int, at east: Double, sequence: Int?) -> [String: Any] {
    var result: [String: Any] = ["sourceIndex": index, "name": "Private Stop \(index)",
                                 "code": "stop-private-\(index)", "coordinate": point(east)]
    result["providerSequence"] = sequence
    return result
  }

  private func route(legs: [[String: Any]]? = nil, destination: [String: Double]? = nil) -> [String: Any] {
    ["schemaVersion": 1, "routeRevision": 1, "context": "ROUTING_RESPONSE", "provider": "tmap", "source": "api",
     "reliability": "live_provider", "plausibility": "normal", "serviceState": "operating",
     "origin": point(0), "destination": destination ?? point(100), "legs": legs ?? [walk()]]
  }

  private func multiRoute(rideLeg: [String: Any]? = nil) -> [String: Any] {
    route(legs: [walk(), rideLeg ?? ride()], destination: point(500))
  }

  private func json(_ dictionary: [String: Any]) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: dictionary, options: [.sortedKeys]), as: UTF8.self)
  }

  private func evaluate(_ dictionary: [String: Any]) throws -> Normalizer.Summary {
    try Normalizer.normalize(json: json(dictionary))
  }
}
