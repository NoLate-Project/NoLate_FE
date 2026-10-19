import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyBusAlightingPolicyTests: XCTestCase {
  typealias P = NoLateJourneyBusAlightingPolicy
  typealias E = NoLateJourneyEngineCore
  let identity = E.Identity(sessionId:"alight-test", generation:1, routeRevision:1, epoch:1)
  func point(_ meters:Double) -> E.Coordinate {
    .init(latitude:37.5665, longitude:126.978 + meters / (6_371_000 * Double.pi / 180 * cos(37.5665 * Double.pi / 180)))
  }
  func ride() -> NoLateJourneyBusRideCore.Route {
    .init(identity:identity, providerRouteId:"999999999", direction:"합성 동쪽 방면",
      approach:.init(legIndex:1,boardingCoordinate:point(200),walkingCoordinates:[point(0),point(100),point(200)],
        coordinates:[point(200),point(600),point(1000)],provenance:.providerShape))
  }
  func json(_ patch:((inout [[String:Any]]) -> Void)? = nil) throws -> String {
    func p(_ m:Double) -> [String:Double] { let c=point(m); return ["latitude":c.latitude,"longitude":c.longitude] }
    var legs:[[String:Any]] = [
      ["index":0,"kind":"WALK","geometrySource":"WALK_STEPS_LINESTRING","exact":true,"geometryInputComplete":true,
       "coordinates":[p(0),p(100),p(200)],"start":p(0),"end":p(200),"stops":[]],
      ["index":1,"kind":"BUS","geometrySource":"TRANSIT_PASS_SHAPE_LINESTRING","exact":true,"geometryInputComplete":true,
       "coordinates":[p(200),p(600),p(1000)],"start":p(200),"end":p(1000),"localRouteId":"999999999",
       "providerRouteId":"888888","directionName":"합성 동쪽 방면","declaredStationCount":2,"serviceAvailable":true,
       "stopEvidenceProvider":"odsay","stopEvidenceVersion":1,
       "stops":[200.0,600,1000].enumerated().map { ["sourceIndex":$0.offset,"providerSequence":$0.offset,"name":"합성 정류장 \($0.offset+1)","code":"stop-\($0.offset)","coordinate":p($0.element)] as [String:Any] }],
      ["index":2,"kind":"WALK","geometrySource":"WALK_STEPS_LINESTRING","exact":true,"geometryInputComplete":true,
       "coordinates":[p(1000),p(1100),p(1200)],"start":p(1000),"end":p(1200),"stops":[]]]
    patch?(&legs)
    let input:[String:Any] = ["schemaVersion":1,"routeRevision":1,"context":"SAVED_ROUTE","provider":"odsay","source":"api",
      "reliability":"live_provider","plausibility":"normal","serviceState":"operating","origin":p(0),"destination":p(1200),"legs":legs]
    return String(decoding:try JSONSerialization.data(withJSONObject:input),as:UTF8.self)
  }
  func snapshot(_ along:Double) -> NoLateJourneyBusRideCore.Snapshot {
    var s = NoLateJourneyBusRideCore.Snapshot()
    s.phase="RIDING"; s.quality="GOOD"; s.boardingConfirmed=true; s.observedAt=1020; s.validUntil=1025
    let length=E.project(point(200),onto:.init(coordinates:ride().approach.coordinates,provenance:.verifiedWalkingPath))!.routeLengthMeters
    s.alongRouteMeters=min(along,length); s.routeLengthMeters=length
    return s
  }
  func testVerifiedOccurrenceAndAccuracyMarginGateOneStopBeforeAndNearStop() throws {
    let route = try XCTUnwrap(P.prepare(json:json(),ride:ride()))
    XCTAssertEqual(route.previousStopAlong,400,accuracy:0.01)
    XCTAssertEqual(route.targetAlong,800,accuracy:0.01)
    XCTAssertNil(P.notice(route:route,ride:snapshot(424),now:1021))
    let one=try XCTUnwrap(P.notice(route:route,ride:snapshot(426),now:1021))
    XCTAssertEqual(one.kind,"ONE_STOP_BEFORE"); XCTAssertEqual(one.remainingMeters,380)
    XCTAssertEqual(P.notice(route:route,ride:snapshot(780),now:1021)?.kind,"NEAR_STOP")
    XCTAssertEqual(P.notice(route:route,ride:snapshot(800),now:1021)?.remainingMeters,0)
  }
  func testNoticeNeverExtendsTTLAndRejectsUnconfirmedStaleFutureOrUnreliableRide() throws {
    let route = try XCTUnwrap(P.prepare(json:json(),ride:ride()))
    let s=snapshot(600)
    XCTAssertEqual(P.notice(route:route,ride:s,now:1021),P.notice(route:route,ride:s,now:1024))
    XCTAssertNil(P.notice(route:route,ride:s,now:1025))
    for variant in 0..<7 {
      var bad=s
      switch variant { case 0:bad.boardingConfirmed=false; case 1:bad.phase="BOARDING_CANDIDATE"
      case 2:bad.quality="UNCERTAIN"; case 3:bad.observedAt=1030; case 4:bad.validUntil=1040
      case 5:bad.alongRouteMeters=Double.nan; default:bad.routeLengthMeters=900 }
      XCTAssertNil(P.notice(route:route,ride:bad,now:1021))
    }
    XCTAssertNil(P.notice(route:nil,ride:s,now:1021))
  }
  func testUnverifiedOrderGeometryNamespaceOrSelectedShapeCannotPrepareNotice() throws {
    for patch: (inout [[String:Any]]) -> Void in [
      { $0[1]["exact"]=false }, { $0[1]["localRouteId"]="888888888" },
      { $0[1]["declaredStationCount"]=10 }, { $0[1]["stopEvidenceVersion"]=2 },
      { $0[1]["coordinates"]=[["latitude":37.5665,"longitude":126.99],["latitude":37.5665,"longitude":127.0]] }] {
      XCTAssertNil(P.prepare(json:try json(patch),ride:ride()))
    }
  }
  func testV3SurfacesStayOnBusAndNeverInventAlightingOrArrival() throws {
    let notice=NoLateGuidanceAlighting(kind:"NEAR_STOP",remainingMeters:20)
    let c=NoLateGuidanceContent(sessionId:"s",scheduleId:"9001",generation:1,routeRevision:1,routeInputDigest:String(repeating:"a",count:64),
      sequence:1,status:"ACTIVE",phase:"RIDING",quality:"GOOD",instruction:"버스로 이동 중",activeLegIndex:1,
      walkProgress:nil,observedAt:1020,validUntil:1025,rideProgress:0.98,boardingConfirmed:true,alighting:notice)
    let legs:[NoLateGuidanceRouteLeg] = [.init(index:0,kind:"WALK",durationMinutes:2),
      .init(index:1,kind:"BUS",lineName:"합성 버스",durationMinutes:5,alightingStopName:"합성 하차"),.init(index:2,kind:"WALK",durationMinutes:2)]
    XCTAssertEqual(c.schemaVersion,3); XCTAssertTrue(c.boardingConfirmed)
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(c,legs:legs,now:1021)?.legIndex,1)
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(c,legs:legs,now:1021).title,"합성 하차")
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(c,legs:legs,now:1021).action,"정류장 근처 · 하차 준비")
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(c,legs:legs,now:1025))
    XCTAssertNil(c.arrival)
    for a in [NoLateGuidanceAlighting(kind:"ARRIVED",remainingMeters:0),.init(kind:"NEAR_STOP",remainingMeters:60),
      .init(kind:"ONE_STOP_BEFORE",remainingMeters:Double.nan),.init(kind:"ONE_STOP_BEFORE",remainingMeters:11)] { XCTAssertFalse(a.valid) }
  }
}
