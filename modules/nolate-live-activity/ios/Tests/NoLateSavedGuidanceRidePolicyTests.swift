import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateSavedGuidanceRidePolicyTests: XCTestCase {
  typealias Policy = NoLateSavedGuidanceRidePolicy
  typealias Session = NoLateJourneyAutomaticSession
  func testPollingWaitsAfterCompletionAndOnlyReportsFencedKnownStatuses() throws {
    let s = try session()
    XCTAssertEqual(Policy.nextPollAt(completedAt: 1002.5), 1013.5)
    for (input, output) in [("AVAILABLE", "VEHICLE_INPUT_RECEIVED"),
      ("POLL_BUDGET_EXHAUSTED", "POLL_BUDGET_EXHAUSTED"),
      ("VEHICLE_EVIDENCE_UNAVAILABLE", "VEHICLE_EVIDENCE_UNAVAILABLE"),
      ("VEHICLE_PROVIDER_UNAVAILABLE", "VEHICLE_PROVIDER_UNAVAILABLE"), ("private provider error", "VEHICLE_RESPONSE_REJECTED")] {
      XCTAssertEqual(Policy.vehicleStatus(try envelope(s, ["status":input]), session:s), output)
    }
    XCTAssertEqual(Policy.vehicleStatus(try envelope(s, ["status":"AVAILABLE", "generation":2]),session:s),"VEHICLE_RESPONSE_REJECTED")
  }
  func testFencedBindingMatchesExactPreparedGeometryAndConnectsWithoutDeparture() throws {
    var s = try session()
    let admission = try XCTUnwrap(Policy.admission(try binding(s), session: s, now: 1000))
    try s.connectRide(admission.route); try s.connectRide(admission.route)
    XCTAssertNotNil(s.ride); XCTAssertNil(s.pendingDeparture); XCTAssertEqual(s.core.snapshot.status, .armed)
    XCTAssertFalse(s.ride!.snapshot.boardingConfirmed)
  }
  func testForeignSessionRevisionGenerationDigestUntrustedEvidenceCannotAdmit() throws {
    let s = try session()
    for patch: [String: Any] in [["sessionId": UUID().uuidString], ["routeRevision": 2], ["generation": 2],
      ["routeInputDigest": String(repeating: "b", count: 64)], ["identityEvidence": "SAVED_ROUTE_METADATA"],
      ["schemaVersion": true], ["generation": "1"], ["status": "SUPPORTED"], ["routeId": "888888888"]] {
      XCTAssertNil(Policy.admission(try binding(s, patch), session: s, now: 1000))
    }
  }
  func testBindingExpiryAndDifferentCoordinateCannotAdmit() throws {
    let s = try session()
    for patch: [String: Any] in [["validUntil":1000], ["validUntil":1031], ["validUntil":true],
      ["coordinates": [["latitude":37.5665,"longitude":126.97]]], ["direction":"bad\n"]] {
      XCTAssertNil(Policy.admission(try binding(s, patch), session: s, now:1000))
    }
  }
  func testVehicleClocksAndIdentityPreservedWithoutPersistence() throws {
    var s = try session(); let a = try XCTUnwrap(Policy.admission(try binding(s),session:s,now:1000))
    let input = Policy.vehicles(try vehicles(s),session:s,admission:a,now:1005)
    XCTAssertEqual(input.count,1); XCTAssertEqual(input[0].sourceAt,1002); XCTAssertEqual(input[0].validUntil,1017)
    try s.connectRide(a.route)
    let saved = String(decoding: try JSONEncoder().encode(s.envelope),as:UTF8.self)
    XCTAssertFalse(saved.contains("\"999999998\"")); XCTAssertFalse(saved.contains("\"sourceAt\""))
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(saved.utf8)) as? [String: Any])
    XCTAssertNil(object["ride"])
  }
  func testDuplicateStaleFutureWrongRouteDirectionSourceAndMalformedVehiclesFailClosed() throws {
    let s = try session(); let a = try XCTUnwrap(Policy.admission(try binding(s),session:s,now:1000))
    for patch: [String: Any] in [["routeId":"999999997"], ["direction":"반대"], ["source":"arrivalEstimate"],
      ["sourceAt":1006], ["receivedAt":1006], ["validUntil":1005], ["validUntil":1018],
      ["coordinate":["latitude":true,"longitude":126.98]], ["id":"bad"]] {
      XCTAssertTrue(Policy.vehicles(try vehicles(s,rowPatch:patch),session:s,admission:a,now:1005).isEmpty)
    }
    XCTAssertTrue(Policy.vehicles(try vehicles(s,count:2),session:s,admission:a,now:1005).isEmpty)
    XCTAssertTrue(Policy.vehicles(try vehicles(s),session:s,admission:a,now:1030).isEmpty)
  }
  func testTerminalAndLocalOnlySessionsCannotConsumeNetworkAdmission() throws {
    var s = try session(); let b = try binding(s)
    s.stop(now:1001); XCTAssertNil(Policy.admission(b,session:s,now:1001))
    XCTAssertThrowsError(try s.connectRide(.init(identity:s.core.snapshot.identity,providerRouteId:"999999999",
      direction:"합성 동쪽 방면",approach:try XCTUnwrap(s.bus).snapshot.route)))
  }
  func testDisconnectClearsEphemeralEngineAndReconnectionStartsWithoutEvidence() throws {
    var s = try session(); let a = try XCTUnwrap(Policy.admission(try binding(s),session:s,now:1000))
    try s.connectRide(a.route); s.disconnectRide(); XCTAssertNil(s.ride)
    try s.connectRide(a.route); XCTAssertEqual(s.ride?.snapshot.evidenceCount,0); XCTAssertFalse(s.ride!.snapshot.boardingConfirmed)
  }
  func testV2DepartureWindowRequiresBoundedAdmissionAndSeparateVehicleScope() throws {
    var s=try session()
    let a=try XCTUnwrap(Policy.admission(try binding(s,["schemaVersion":2,"departureWindowMeters":300]),session:s,now:1000))
    XCTAssertEqual(a.route.departureWindowMeters,300)
    for bad:Any in [true,-1,99,351,"300"] {
      XCTAssertNil(Policy.admission(try binding(s,["schemaVersion":2,"departureWindowMeters":bad]),session:s,now:1000))
    }
    let scale=6_371_000*Double.pi/180*cos(37.5665*Double.pi/180)
    let coordinate:[String:Double]=["latitude":37.5665,"longitude":126.978+900/scale]
    func data(_ patch:[String:Any] = [:],version:Int = 2) throws -> Data {
      var row:[String:Any]=["id":"999999998","routeId":"999999999","direction":"합성 동쪽 방면","source":"verifiedWGS84",
        "coordinate":coordinate,"sourceAt":1002,"receivedAt":1003,"validUntil":1017,"positionScope":"AFTER_ALIGHTING","metersPastAlighting":100]
      patch.forEach { row[$0.key]=$0.value }
      return try envelope(s,["schemaVersion":version,"status":"AVAILABLE","vehicles":[row]])
    }
    let parsed=Policy.vehicles(try data(),session:s,admission:a,now:1005)
    XCTAssertEqual(parsed.first?.metersPastAlighting,100);XCTAssertEqual(parsed.first?.sourceAt,1002)
    for patch:[String:Any] in [["positionScope":"RIDING"],["metersPastAlighting":25],["metersPastAlighting":301],
      ["metersPastAlighting":true],["positionScope":"SELECTED_SEGMENT"],["coordinate":["latitude":37.5665,"longitude":126.978]],
      ["sourceAt":1006],["id":"bad"],["direction":"반대"]] {
      XCTAssertTrue(Policy.vehicles(try data(patch),session:s,admission:a,now:1005).isEmpty)
    }
    XCTAssertTrue(Policy.vehicles(try data(version:1),session:s,admission:a,now:1005).isEmpty)
    try s.connectRide(a.route); XCTAssertNotNil(s.separation)
    XCTAssertFalse(String(decoding:try JSONEncoder().encode(s.envelope),as:UTF8.self).contains("separation"))
    s.disconnectRide(); XCTAssertNil(s.separation)
  }
  private func session() throws -> Session {
    func point(_ x: Double) -> [String: Double] { ["latitude":37.5665,"longitude":126.978+x/(6_371_000*Double.pi/180*cos(37.5665*Double.pi/180))] }
    func leg(_ kind:String,_ coordinates:[Double]) -> [String:Any] {
      ["index":kind == "WALK" ? 0:1,"kind":kind,"geometrySource":kind == "WALK" ? "WALK_STEPS_LINESTRING":"TRANSIT_PASS_SHAPE_LINESTRING",
       "exact":true,"geometryInputComplete":true,"coordinates":coordinates.map(point),"start":point(coordinates.first!),"end":point(coordinates.last!),
       "providerRouteId":"888888","localRouteId":"999999999","directionName":"합성 동쪽 방면","serviceAvailable":true,
       "declaredStationCount":1,"stopEvidenceProvider":"odsay","stopEvidenceVersion":1,
       "stops":kind == "WALK" ? []:coordinates.enumerated().map { ["sourceIndex":$0.offset,"providerSequence":$0.offset,
         "name":"합성 정류장","code":"synthetic-\($0.offset)","coordinate":point($0.element)] as [String:Any] }]
    }
    let object:[String:Any] = ["schemaVersion":1,"routeRevision":1,"context":"SAVED_ROUTE","provider":"odsay","source":"api",
      "reliability":"live_provider","plausibility":"normal","serviceState":"operating","origin":point(0),"destination":point(800),
      "legs":[leg("WALK",[0,100,200]),leg("BUS",[200,800])]]
    let json = String(decoding:try JSONSerialization.data(withJSONObject:object,options:.sortedKeys),as:UTF8.self)
    let binding:[String:Any] = ["sessionId":"00000000-0000-4000-8000-000000000001","scheduleId":"9001","generation":1,
      "routeRevision":1,"clientOwnerId":"00000000-0000-4000-8000-000000000002","routeInputDigest":Session.digest(json),
      "preparedAtEpochSeconds":1000,"expiresAtEpochSeconds":1600,"execution":"SIMULATOR","syncScope":"AUTHENTICATED",
      "savedRouteValidated":true,"guidanceEnabled":true,"apiOrigin":"http://127.0.0.1:15544","authMemberId":7,"loginGeneration":2]
    return try Session(routeJSON:json,bindingJSON:String(decoding:try JSONSerialization.data(withJSONObject:binding),as:UTF8.self),now:1000)
  }
  private func envelope(_ s:Session,_ payload:[String:Any]) throws -> Data {
    var body:[String:Any] = ["schemaVersion":1,"sessionId":s.binding.sessionId,"generation":1,"routeRevision":1,
      "routeInputDigest":s.binding.routeInputDigest,"identityEvidence":"OFFICIAL_STOP_SHAPE_CROSSWALK"]
    payload.forEach { body[$0.key] = $0.value }
    return try JSONSerialization.data(withJSONObject:["success":true,"data":body])
  }
  private func binding(_ s:Session,_ patch:[String:Any] = [:]) throws -> Data {
    var body:[String:Any] = ["status":"VERIFIED","routeId":"999999999","direction":"합성 동쪽 방면","validUntil":1030,
      "coordinates":s.bus!.snapshot.route.coordinates.map { ["latitude":$0.latitude,"longitude":$0.longitude] }]
    patch.forEach { body[$0.key] = $0.value }; return try envelope(s,body)
  }
  private func vehicles(_ s:Session,rowPatch:[String:Any] = [:],count:Int = 1) throws -> Data {
    var row:[String:Any] = ["id":"999999998","routeId":"999999999","direction":"합성 동쪽 방면","source":"verifiedWGS84",
      "coordinate":["latitude":37.5665,"longitude":126.981],"sourceAt":1002,"receivedAt":1003,"validUntil":1017]
    rowPatch.forEach { row[$0.key] = $0.value }; return try envelope(s,["status":"AVAILABLE","vehicles":Array(repeating:row,count:count)])
  }
}
