import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyFinalWalkCoreTests: XCTestCase {
  typealias C = NoLateJourneyFinalWalkCore
  typealias E = NoLateJourneyEngineCore
  let identity = E.Identity(sessionId:"00000000-0000-4000-8000-000000000001",generation:1,routeRevision:1,epoch:1)
  func point(_ x:Double) -> E.Coordinate { .init(latitude:0,longitude:x/(6_371_000 * .pi/180)) }
  func route() -> C.Route { .init(identity:identity,path:.init(coordinates:[point(1000),point(1100),point(1200)],provenance:.verifiedWalkingPath),
    busPath:.init(coordinates:[point(200),point(1000)],provenance:.verifiedWalkingPath),length:200,destination:point(1200)) }
  func fix(_ seq:Int,_ t:Double,_ meters:Double,accuracy:Double=2) -> E.Observation {
    .init(identity:identity,sequence:Int64(seq),observedAt:t,coordinate:point(meters),horizontalAccuracyMeters:accuracy,source:.realLocation)
  }
  func separation(_ until:Double=1015) -> NoLateJourneyBusSeparationCore.Snapshot {
    .init(status:"SEPARATION_OBSERVED",reason:"SAME_VEHICLE_DEPARTED_PASSENGER_AT_TARGET",evidenceCount:3,validUntil:until)
  }
  func seed(_ c:inout C) { c.ingest(fix(1,1000,1000),separation:separation(),now:1000) }
  func walk(_ c:inout C) { for i in 1...5 { c.ingest(fix(i+1,1000+Double(i)*4,1000+Double(i)*8),separation:nil,now:1000+Double(i)*4) } }
  func testFreshSeparationPlusContinuousWalkingCommitsAndUsesLocationNotClocks() {
    var c=C(route:route());seed(&c);walk(&c)
    XCTAssertTrue(c.committed);XCTAssertEqual(c.snapshot.phase,"FINAL_WALK")
    XCTAssertEqual(c.snapshot.evidenceCount,6);XCTAssertEqual(c.snapshot.along!,40,accuracy:0.01)
    let before=c.snapshot;c.tick(now:1034);XCTAssertEqual(c.snapshot,before)
    c.tick(now:1035);XCTAssertTrue(c.committed);XCTAssertEqual(c.snapshot.phase,"UNAVAILABLE")
    XCTAssertNil(c.snapshot.validUntil)
    c.ingest(fix(7,1036,1042),separation:nil,now:1036)
    XCTAssertEqual(c.snapshot.phase,"FINAL_WALK")
  }
  func testSeoulSyntheticGPSJitterTrajectoryIncludesFullDestinationDwellBeforeLeaseExpiry() {
    let scale=6_371_000 * Double.pi/180 * cos(37.5665 * Double.pi/180)
    let length=scale*0.0015
    func coordinate(_ meters:Double)->E.Coordinate { .init(latitude:37.5665,longitude:126.9895+meters/scale) }
    var c=C(route:.init(identity:identity,
      path:.init(coordinates:[coordinate(0),coordinate(length/2),coordinate(length)],provenance:.verifiedWalkingPath),
      busPath:.init(coordinates:[coordinate(-880),coordinate(0)],provenance:.verifiedWalkingPath),length:length,destination:coordinate(length)))
    for step in 0...95 {
      let elapsed=137+Double(step)*1.1,t=1000+elapsed
      let walk=min(length,max(0,(elapsed-140)*2.4))
      let meters=walk+(walk==length ? sin(elapsed)*0.3 : 0)
      c.tick(now:t)
      c.ingest(.init(identity:identity,sequence:Int64(step+1),observedAt:t,coordinate:coordinate(meters),
        horizontalAccuracyMeters:5,source:.realLocation),separation:step==0 ? separation(t+15):nil,now:t+0.01)
      if c.arrived {XCTAssertLessThan(elapsed,215);return}
    }
    XCTFail("Continuous synthetic destination dwell must arrive, not expire")
  }
  func testStationaryTimeMissingStaleOrCandidateSeparationCannotCommit() {
    for mode in 0..<4 {
      var c=C(route:route())
      var s=separation();if mode==1{s.validUntil=1000};if mode==2{s.status="COLLECTING"};if mode==3{s.evidenceCount=2}
      c.ingest(fix(1,1000,1000),separation:mode==0 ? nil:s,now:1000);walk(&c)
      XCTAssertFalse(c.committed)
    }
    var c=C(route:route());seed(&c)
    for i in 1...10{c.ingest(fix(i+1,1000+Double(i)*4,1000),separation:nil,now:1000+Double(i)*4)}
    XCTAssertFalse(c.committed);XCTAssertEqual(c.snapshot.evidenceCount,1)
  }
  func testJumpFastBusReversePoorGPSWrongSourceAndOffRouteDoNotCommit() {
    for mode in 0..<6 {
      var c=C(route:route());seed(&c)
      var f=fix(2,1004,1008)
      switch mode {
      case 0:f=fix(2,1004,1100)
      case 1:f=fix(2,1001,1020)
      case 2:f=fix(2,1004,1008,accuracy:26)
      case 3:f = .init(identity:identity,sequence:2,observedAt:1004,coordinate:point(1008),horizontalAccuracyMeters:2,source:.replay)
      case 4:f = .init(identity:identity,sequence:2,observedAt:1004,coordinate:.init(latitude:1,longitude:1),horizontalAccuracyMeters:2,source:.realLocation)
      default:c.ingest(f, separation:nil,now:1004);f=fix(3,1008,1000)
      }
      c.ingest(f,separation:nil,now:f.observedAt)
      XCTAssertFalse(c.committed);XCTAssertEqual(c.snapshot.phase,"UNAVAILABLE")
    }
  }
  func testForeignIdentityDuplicateFutureAndRegressionCannotAdvance() {
    var c=C(route:route());seed(&c);let before=c.snapshot
    c.ingest(fix(1,1000,1000),separation:nil,now:1001);XCTAssertEqual(c.snapshot,before)
    let foreign=E.Observation(identity:.init(sessionId:"other",generation:1,routeRevision:1,epoch:1),sequence:2,observedAt:1004,
      coordinate:point(1008),horizontalAccuracyMeters:2,source:.realLocation)
    c.ingest(foreign,separation:nil,now:1004);XCTAssertEqual(c.snapshot,before)
    c.ingest(fix(2,1006,1008),separation:nil,now:1004);XCTAssertEqual(c.snapshot.phase,"UNAVAILABLE")
    c.ingest(fix(3,1003,1008),separation:nil,now:1003);XCTAssertFalse(c.committed)
  }
  func testHandoffCannotBeRenewedByRepeatedSeparationAndCannotStartHalfway() {
    var c=C(route:route());seed(&c)
    for i in 1...24{let t=1000+Double(i)*4;c.ingest(fix(i+1,t,1000),separation:nil,now:t)}
    walk(&c);XCTAssertFalse(c.committed)
    c=C(route:route());c.ingest(fix(1,1000,1100),separation:separation(),now:1000)
    XCTAssertEqual(c.snapshot.reason,"FRESH_SEPARATION_REQUIRED")
  }
  func testCommittedGPSGapDoesNotRelocateMarkerAndStopCannotReopen() {
    var c=C(route:route());seed(&c);walk(&c);c.tick(now:1035)
    c.ingest(fix(7,1036,1180),separation:nil,now:1036)
    XCTAssertEqual(c.snapshot.phase,"UNAVAILABLE");XCTAssertEqual(c.snapshot.along!,40,accuracy:0.01)
    c.stop();c.ingest(fix(8,1040,1042),separation:separation(1055),now:1040)
    XCTAssertFalse(c.committed);XCTAssertEqual(c.snapshot.reason,"SESSION_STOPPED")
  }
  func nearDestination() -> C {
    var c=C(route:route());seed(&c);walk(&c)
    for i in 1...19 { let t=1020+Double(i)*4;c.ingest(fix(i+6,t,1040+Double(i)*8),separation:nil,now:t) }
    XCTAssertTrue(c.committed);XCTAssertFalse(c.arrived)
    return c
  }
  func testArrivalRequiresFreshContinuousDestinationDwellNotClock() {
    var c=nearDestination()
    c.ingest(fix(30,1100,1199,accuracy:11),separation:nil,now:1100)
    for i in 0...4 { let t=1104+Double(i)*4;c.ingest(fix(31+i,t,1199),separation:nil,now:t) }
    XCTAssertEqual(c.arrivalEvidenceCount,5);XCTAssertFalse(c.arrived)
    c.tick(now:1124);XCTAssertFalse(c.arrived)
    c.ingest(fix(36,1124,1200),separation:nil,now:1124)
    XCTAssertTrue(c.arrived)
    c.stop();XCTAssertFalse(c.arrived);XCTAssertEqual(c.arrivalEvidenceCount,0)
    c.ingest(fix(37,1128,1200),separation:separation(1143),now:1128);XCTAssertFalse(c.arrived)
  }
  func testArrivalRejectsProximityWithoutHandoffAndJump() {
    var c=C(route:route())
    for i in 0...8 { let t=1000+Double(i)*4;c.ingest(fix(i+1,t,1200),separation:separation(t+15),now:t) }
    XCTAssertFalse(c.arrived);XCTAssertEqual(c.arrivalEvidenceCount,0)
    c=C(route:route());seed(&c);walk(&c)
    c.ingest(fix(8,1024,1200),separation:nil,now:1024)
    XCTAssertEqual(c.snapshot.phase,"UNAVAILABLE");XCTAssertFalse(c.arrived)
  }
  func testArrivalResetsOnPoorAccuracyOutsideRadiusGapAndWrongSource() {
    for mode in 0...4 {
      var c=nearDestination()
      c.ingest(fix(30,1100,1199),separation:nil,now:1100)
      c.ingest(fix(31,1104,1200),separation:nil,now:1104)
      var f=fix(32,1108,1200)
      switch mode {
      case 0:f=fix(32,1108,1200,accuracy:11)
      case 1:f=fix(32,1108,1179)
      case 2:f=fix(32,1113,1200)
      case 3:f = .init(identity:identity,sequence:32,observedAt:1108,coordinate:point(1200),horizontalAccuracyMeters:2,source:.replay)
      default:c.tick(now:1119);f=fix(32,1120,1200)
      }
      c.ingest(f,separation:nil,now:f.observedAt)
      XCTAssertFalse(c.arrived)
      XCTAssertLessThanOrEqual(c.arrivalEvidenceCount,1)
    }
  }
  func testArrivalAlsoRequiresDeclaredDestinationNotJustGeometryEnd() {
    let r=route()
    var c=C(route:.init(identity:r.identity,path:r.path,busPath:r.busPath,length:r.length,destination:point(1225)))
    seed(&c);walk(&c)
    for i in 1...20 { let t=1020+Double(i)*4;c.ingest(fix(i+6,t,1040+Double(i)*8),separation:nil,now:t) }
    for i in 0...8 { let t=1104+Double(i)*4;c.ingest(fix(i+30,t,1200),separation:nil,now:t) }
    XCTAssertFalse(c.arrived);XCTAssertEqual(c.arrivalEvidenceCount,0)
  }
  func json(_ patch:((inout [[String:Any]]) -> Void)?=nil) throws -> String {
    func p(_ m:Double)->[String:Double]{["latitude":0,"longitude":point(m).longitude]}
    var legs:[[String:Any]] = [("WALK",[0.0,100,200]),("BUS",[200.0,600,1000]),("WALK",[1000.0,1100,1200])].enumerated().map { i, item in
      var leg:[String:Any] = ["index":i,"kind":item.0,"geometrySource":i==1 ? "TRANSIT_PASS_SHAPE_LINESTRING":"WALK_STEPS_LINESTRING",
        "exact":true,"geometryInputComplete":true,"coordinates":item.1.map(p),"start":p(item.1.first!),"end":p(item.1.last!),
        "stopEvidenceProvider":"odsay","stopEvidenceVersion":1,"stops":[]]
      if i==1 { leg["providerRouteId"]="888888";leg["localRouteId"]="999999999";leg["directionName"]="합성 동쪽 방면";leg["declaredStationCount"]=2
        leg["stops"]=item.1.enumerated().map{["sourceIndex":$0.offset,"providerSequence":$0.offset,"name":"합성 정류장 \($0.offset)","code":"stop-\($0.offset)","coordinate":p($0.element)] as [String:Any]} }
      return leg
    }
    patch?(&legs)
    return String(decoding:try JSONSerialization.data(withJSONObject:["schemaVersion":1,"routeRevision":1,"context":"SAVED_ROUTE","provider":"odsay",
      "source":"api","reliability":"live_provider","plausibility":"normal","serviceState":"operating","origin":p(0),"destination":p(1200),"legs":legs]),as:UTF8.self)
  }
  func rideRoute()->NoLateJourneyBusRideCore.Route{.init(identity:identity,providerRouteId:"999999999",direction:"합성 동쪽 방면",
    approach:.init(legIndex:1,boardingCoordinate:point(200),walkingCoordinates:[point(0),point(100),point(200)],coordinates:[point(200),point(600),point(1000)],provenance:.providerShape),departureWindowMeters:300)}
  func testPreparationRequiresVerifiedLastWalkTopologyEndpointsAndGeometry() throws {
    XCTAssertNotNil(C.prepare(json:try json(),ride:rideRoute()))
    for patch:(inout [[String:Any]])->Void in [{$0[2]["exact"]=false},{$0[2]["geometryInputComplete"]=false},{$0[2]["stopEvidenceProvider"]="tmap"},
      {$0[2]["start"]=["latitude":0,"longitude":self.point(1050).longitude]},{$0[2]["kind"]="BUS"},
      {$0[2]["coordinates"]=[["latitude":0,"longitude":self.point(1000).longitude],["latitude":0,"longitude":self.point(1200).longitude]]}] {
      XCTAssertNil(C.prepare(json:try json(patch),ride:rideRoute()))
    }
  }
  func testSessionIntegrationSeparationWalkProjectionAndRestoreNeverPersistHandoff() throws {
    typealias S=NoLateJourneyAutomaticSession
    let json=try json(),binding=String(decoding:try JSONSerialization.data(withJSONObject:["sessionId":identity.sessionId,"scheduleId":"9001","generation":1,"routeRevision":1,
      "clientOwnerId":"00000000-0000-4000-8000-000000000002","routeInputDigest":S.digest(json),"preparedAtEpochSeconds":1000,"expiresAtEpochSeconds":1600,
      "execution":"SIMULATOR","syncScope":"SANDBOX","savedRouteValidated":true,"guidanceEnabled":true]),as:UTF8.self)
    var s=try S(routeJSON:json,bindingJSON:binding,now:1000,rideRoute:rideRoute())
    func ingest(_ x:Double,_ t:Double,_ vehicle:Double?=nil,_ past:Double?=nil) {
      let v:[NoLateJourneyBusRideCore.Vehicle] = vehicle.map{[.init(id:"999999998",routeId:"999999999",direction:"합성 동쪽 방면",coordinate:point($0),sourceAt:t,receivedAt:t,validUntil:t+15,source:.verifiedWGS84,metersPastAlighting:past)]} ?? []
      s.ingest(coordinate:point(x),accuracy:2,observedAt:t,now:t,vehicles:v)
    }
    for i in 0...10{ingest(Double(i)*20,1000+Double(i)*4)}
    for i in 11...13{ingest(200,1000+Double(i)*4)}
    for i in 14...33{let x=200+Double(i-13)*40;ingest(x,1000+Double(i)*4,x)}
    XCTAssertEqual(s.ride?.snapshot.phase,"RIDING")
    for (i,t) in [1136.0,1142,1148].enumerated(){ingest(1000,t,1080+Double(i)*60,80+Double(i)*60)}
    XCTAssertEqual(s.separation?.snapshot.status,"SEPARATION_OBSERVED")
    XCTAssertFalse(s.finalWalk?.committed ?? true)
    var unconfirmed=s
    unconfirmed.expireRideAdmission()
    XCTAssertNil(unconfirmed.ride);XCTAssertNil(unconfirmed.finalWalk)
    for i in 1...5{ingest(1000+Double(i)*8,1148+Double(i)*4)}
    XCTAssertTrue(s.finalWalk?.committed ?? false)
    let c=NoLateAutomaticGuidanceProjection.content(s,now:1168)
    XCTAssertEqual(c.schemaVersion,4);XCTAssertEqual(c.phase,"FINAL_WALK");XCTAssertEqual(c.activeLegIndex,2)
    XCTAssertFalse(c.boardingConfirmed);XCTAssertNil(c.rideProgress);XCTAssertNil(c.alighting)
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(c,legs:s.routeLegs,now:1168)?.legIndex,2)
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(c,legs:s.routeLegs,now:1168).action,"도보 약 160m")
    XCTAssertNotNil(NoLateAutomaticGuidanceProjection.position(s,coordinate:point(1040),accuracy:2,observedAt:1168,now:1168))
    // Runtime intentionally stops polling vehicles after the walking handoff. Its next
    // clock tick must not erase the walk merely because that vehicle lease is absent.
    s.expireRideAdmission()
    XCTAssertTrue(s.finalWalk?.committed ?? false)
    XCTAssertEqual(NoLateAutomaticGuidanceProjection.content(s,now:1168).phase,"FINAL_WALK")
    var revoked=s
    revoked.disconnectRide()
    XCTAssertNil(revoked.finalWalk)
    var expired=s
    expired.tick(now:1600)
    XCTAssertTrue(expired.core.snapshot.status.isTerminal)
    XCTAssertFalse(expired.finalWalk?.committed ?? true)
    XCTAssertEqual(NoLateAutomaticGuidanceProjection.content(expired,now:1600).phase,"STOPPED")
    let envelope=try JSONEncoder().encode(s.envelope)
    XCTAssertFalse(String(decoding:envelope,as:UTF8.self).contains("finalWalk"))
    let restored=try S(restoring:s.envelope,routeJSON:json,bindingJSON:binding,now:1169,rideRoute:rideRoute())
    XCTAssertFalse(restored.finalWalk?.committed ?? true)
    XCTAssertNotEqual(NoLateAutomaticGuidanceProjection.content(restored,now:1169).phase,"FINAL_WALK")
    var arrival=s
    for i in 1...20 { let t=1168+Double(i)*4
      arrival.ingest(coordinate:point(1040+Double(i)*8),accuracy:2,observedAt:t,now:t)
    }
    XCTAssertFalse(arrival.core.snapshot.status.isTerminal)
    for i in 1...5 { let t=1248+Double(i)*4
      arrival.ingest(coordinate:point(1200),accuracy:2,observedAt:t,now:t)
    }
    XCTAssertEqual(arrival.core.snapshot.status,.stopped)
    XCTAssertEqual(arrival.core.snapshot.reason,.destinationArrived)
    XCTAssertNil(arrival.pendingDeparture)
    XCTAssertFalse(arrival.finalWalk?.committed ?? true)
    XCTAssertNil(NoLateAutomaticGuidanceProjection.position(arrival,coordinate:point(1200),accuracy:2,observedAt:1268,now:1268))
    XCTAssertEqual(NoLateAutomaticGuidanceProjection.content(arrival,now:1268).phase,"STOPPED")
    let terminal=try S(restoring:arrival.envelope,routeJSON:json,bindingJSON:binding,now:1269,rideRoute:rideRoute())
    XCTAssertEqual(terminal.core.snapshot.reason,.destinationArrived)
    arrival.stop(now:1270);arrival.tick(now:1271)
    arrival.ingest(coordinate:point(1200),accuracy:2,observedAt:1272,now:1272)
    XCTAssertEqual(arrival.core.snapshot.reason,.destinationArrived)
    s.tick(now:1183);XCTAssertEqual(NoLateAutomaticGuidanceProjection.content(s,now:1183).phase,"UNAVAILABLE")
    s.stop(now:1184);XCTAssertEqual(NoLateAutomaticGuidanceProjection.content(s,now:1184).phase,"STOPPED")
  }
}
