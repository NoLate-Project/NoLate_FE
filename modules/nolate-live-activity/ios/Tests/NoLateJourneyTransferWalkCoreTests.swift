import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyTransferWalkCoreTests: XCTestCase {
  typealias C = NoLateJourneyTransferWalkCore
  typealias E = NoLateJourneyEngineCore
  let identity = E.Identity(sessionId:"00000000-0000-4000-8000-000000000001",generation:1,routeRevision:1,epoch:1)
  func point(_ x:Double) -> E.Coordinate { .init(latitude:0,longitude:x/(6_371_000 * .pi/180)) }
  func fix(_ seq:Int,_ t:Double,_ x:Double,accuracy:Double=2) -> E.Observation {
    .init(identity:identity,sequence:Int64(seq),observedAt:t,coordinate:point(x),horizontalAccuracyMeters:accuracy,source:.realLocation)
  }
  func separation(_ until:Double=1015) -> NoLateJourneyBusSeparationCore.Snapshot {
    .init(status:"SEPARATION_OBSERVED",reason:"SAME_VEHICLE_DEPARTED_PASSENGER_AT_TARGET",evidenceCount:3,validUntil:until)
  }
  func ride() -> NoLateJourneyBusRideCore.Route {
    .init(identity:identity,providerRouteId:"999999999",direction:"합성 동쪽 방면",
      approach:.init(legIndex:1,boardingCoordinate:point(200),walkingCoordinates:[point(0),point(100),point(200)],
        coordinates:[point(200),point(600),point(1000)],provenance:.providerShape),departureWindowMeters:300)
  }
  func json(length:Double=200,nextKind:String="BUS",patch:((inout [String:Any])->Void)?=nil) throws -> String {
    func p(_ x:Double)->[String:Double] { ["latitude":0,"longitude":point(x).longitude] }
    let next=1000+length
    let paths:[(String,[Double])] = [("WALK",[0,100,200]),("BUS",[200,600,1000]),
      ("WALK",[1000,1000+length/2,next]),(nextKind,[next,next+400,next+800]),("WALK",[next+800,next+900,next+1000])]
    let legs:[[String:Any]]=paths.enumerated().map { i,item in
      let walking=item.0 == "WALK"
      var leg:[String:Any] = ["index":i,"kind":item.0,"geometrySource":walking ? "WALK_STEPS_LINESTRING":"TRANSIT_PASS_SHAPE_LINESTRING",
        "exact":true,"geometryInputComplete":true,"coordinates":item.1.map(p),"start":p(item.1.first!),"end":p(item.1.last!),
        "stopEvidenceProvider":"odsay","stopEvidenceVersion":1,"stops":[]]
      if !walking {
        leg["providerRouteId"]="888888";leg["localRouteId"]="999999999";leg["directionName"]="합성 동쪽 방면";leg["declaredStationCount"]=2
        leg["stops"]=item.1.enumerated().map { ["sourceIndex":$0.offset,"providerSequence":$0.offset,
          "name":"합성 정류장 \(i)-\($0.offset)","code":"stop-\(i)-\($0.offset)","coordinate":p($0.element)] as [String:Any] }
      }
      return leg
    }
    var input:[String:Any]=["schemaVersion":1,"routeRevision":1,"context":"SAVED_ROUTE","provider":"odsay","source":"api",
      "reliability":"live_provider","plausibility":"normal","serviceState":"operating","origin":p(0),"destination":p(next+1000),"legs":legs]
    patch?(&input)
    return String(decoding:try JSONSerialization.data(withJSONObject:input),as:UTF8.self)
  }
  func route(length:Double=200) throws -> C.Route { try XCTUnwrap(C.prepare(json:json(length:length),ride:ride())) }
  func seed(_ c:inout C) { c.ingest(fix(1,1000,1000),separation:separation(),now:1000) }
  func walking(_ c:inout C) {
    for i in 1...5 { let t=1000+Double(i)*4;c.ingest(fix(i+1,t,1000+Double(i)*8),separation:nil,now:t) }
  }
  func testPreparationTargetsNextBoardingOccurrenceNotWholeDestination() throws {
    let r=try route()
    XCTAssertEqual(r.walkingLegIndex,2);XCTAssertEqual(r.nextTransitLegIndex,3);XCTAssertEqual(r.nextTransitKind,"BUS")
    XCTAssertEqual(r.walk.destination,point(1200));XCTAssertTrue(r.walk.isTransfer)
    XCTAssertNotNil(C.prepare(json:try json(nextKind:"SUBWAY"),ride:ride()))
  }
  func testPreparationRequiresImmutableRevisionTrustedGeometryAndNextStopEvidence() throws {
    let patches:[(inout [String:Any])->Void] = [
      {$0["routeRevision"]=2}, {$0["serviceState"]="not_operating"}, {$0["source"]="fallback"},
      { var legs=$0["legs"] as! [[String:Any]];legs[2]["exact"]=false;$0["legs"]=legs },
      { var legs=$0["legs"] as! [[String:Any]];legs[3]["providerRouteId"]=nil;$0["legs"]=legs },
      { var legs=$0["legs"] as! [[String:Any]];legs[3]["directionName"]=nil;$0["legs"]=legs },
      { var legs=$0["legs"] as! [[String:Any]];legs[3]["stops"]=[];$0["legs"]=legs },
      { var legs=$0["legs"] as! [[String:Any]];legs[2]["coordinates"]=[["latitude":0,"longitude":self.point(1040).longitude],
          ["latitude":0,"longitude":self.point(1100).longitude],["latitude":0,"longitude":self.point(1200).longitude]];$0["legs"]=legs },
      { var legs=$0["legs"] as! [[String:Any]];legs[2]["kind"]="BUS";$0["legs"]=legs }
    ]
    for patch in patches { XCTAssertNil(C.prepare(json:try json(patch:patch),ride:ride())) }
    XCTAssertNil(C.prepare(json:try NoLateJourneyFinalWalkCoreTests().json(),ride:ride()))
  }
  func testContinuousTransferCommitsWithoutBoardingOrJourneyArrival() throws {
    var c=C(route:try route());seed(&c);walking(&c)
    XCTAssertTrue(c.committed);XCTAssertEqual(c.snapshot.phase,"TRANSFER_WALK");XCTAssertFalse(c.readyForNextTransit)
    XCTAssertEqual(c.snapshot.along!,40,accuracy:0.01)
    // Parallel/overlapping bus and walking geometry is legitimate after a fresh
    // independent separation; transfer walking need not leave a 25 m bus corridor.
    let r=try route()
    let parallel=C.Route(walkingLegIndex:2,nextTransitLegIndex:3,nextTransitKind:"BUS",
      walk:.init(identity:identity,path:.init(coordinates:[point(1000),point(900),point(800)],provenance:.verifiedWalkingPath),
        busPath:r.walk.busPath,length:200,destination:point(800),isTransfer:true))
    var p=C(route:parallel);seed(&p)
    for i in 1...5 { let t=1000+Double(i)*4;p.ingest(fix(i+1,t,1000-Double(i)*8),separation:nil,now:t) }
    XCTAssertTrue(p.committed);XCTAssertFalse(p.readyForNextTransit)
  }
  func testMissingStalePartialSeparationAndClockOnlyCannotCommit() throws {
    for mode in 0...3 {
      var c=C(route:try route());var s=separation()
      if mode==1 { s.validUntil=1000 };if mode==2 { s.evidenceCount=2 };if mode==3 { s.status="COLLECTING" }
      c.ingest(fix(1,1000,1000),separation:mode==0 ? nil:s,now:1000);walking(&c)
      XCTAssertFalse(c.committed);XCTAssertFalse(c.readyForNextTransit)
    }
    var c=C(route:try route(length:10));seed(&c);c.tick(now:1020)
    XCTAssertFalse(c.committed);XCTAssertFalse(c.readyForNextTransit)
  }
  func testShortSharedStopTransferRequiresTwentySecondFreshUncertaintyBoundedDwell() throws {
    var c=C(route:try route(length:10));seed(&c)
    for i in 1...4 { let t=1000+Double(i)*4;c.ingest(fix(i+1,t,1000),separation:nil,now:t) }
    XCTAssertFalse(c.readyForNextTransit);XCTAssertFalse(c.committed)
    c.ingest(fix(6,1020,1000),separation:nil,now:1020)
    XCTAssertTrue(c.readyForNextTransit);XCTAssertTrue(c.committed);XCTAssertEqual(c.snapshot.phase,"TRANSFER_WALK")
    c.tick(now:1035);XCTAssertFalse(c.readyForNextTransit);XCTAssertTrue(c.committed)
    c.ingest(fix(7,1036,1000),separation:nil,now:1036)
    XCTAssertFalse(c.readyForNextTransit);XCTAssertEqual(c.boardingPointEvidenceCount,1)
  }
  func testShortTransferOutsideBoardingUncertaintyCircleNeverBecomesReady() throws {
    var c=C(route:try route(length:30));seed(&c)
    for i in 1...8 { let t=1000+Double(i)*4;c.ingest(fix(i+1,t,1000),separation:nil,now:t) }
    XCTAssertFalse(c.committed);XCTAssertFalse(c.readyForNextTransit)
  }
  func testLongTransferReadinessNeedsContinuousArrivalDwellNotTimeOrProximityJump() throws {
    var c=C(route:try route());seed(&c);walking(&c)
    for i in 1...20 { let t=1020+Double(i)*4;c.ingest(fix(i+6,t,1040+Double(i)*8),separation:nil,now:t) }
    XCTAssertFalse(c.readyForNextTransit)
    for i in 1...5 { let t=1100+Double(i)*4;c.ingest(fix(i+26,t,1200),separation:nil,now:t) }
    XCTAssertTrue(c.readyForNextTransit)
    var jump=C(route:try route());seed(&jump);walking(&jump)
    jump.ingest(fix(7,1024,1200),separation:nil,now:1024)
    XCTAssertFalse(jump.readyForNextTransit);XCTAssertEqual(jump.snapshot.phase,"UNAVAILABLE")
  }
  func testForeignDuplicateFuturePoorAccuracyOffRouteReverseAndFastFixesDoNotAdvance() throws {
    for mode in 0...7 {
      var c=C(route:try route());seed(&c);var f=fix(2,1004,1008)
      switch mode {
      case 0:f = .init(identity:.init(sessionId:"foreign",generation:1,routeRevision:1,epoch:1),sequence:2,observedAt:1004,
        coordinate:point(1008),horizontalAccuracyMeters:2,source:.realLocation)
      case 1:f=fix(1,1004,1008)
      case 2:f=fix(2,1006,1008)
      case 3:f=fix(2,1004,1008,accuracy:26)
      case 4:f = .init(identity:identity,sequence:2,observedAt:1004,coordinate:.init(latitude:1,longitude:1),horizontalAccuracyMeters:2,source:.realLocation)
      case 5:f=fix(2,1001,1020)
      case 6:f = .init(identity:identity,sequence:2,observedAt:1004,coordinate:point(1008),horizontalAccuracyMeters:2,source:.replay)
      default:c.ingest(f,separation:nil,now:1004);f=fix(3,1008,1000)
      }
      c.ingest(f,separation:nil,now:mode == 2 ? 1004 : f.observedAt)
      XCTAssertFalse(c.committed);XCTAssertFalse(c.readyForNextTransit)
    }
  }
  func testCommittedGapCannotTeleportAndStopCannotReopen() throws {
    var c=C(route:try route());seed(&c);walking(&c);c.tick(now:1035)
    c.ingest(fix(7,1036,1180),separation:nil,now:1036)
    XCTAssertEqual(c.snapshot.phase,"UNAVAILABLE");XCTAssertEqual(c.snapshot.along!,40,accuracy:0.01)
    c.stop();c.ingest(fix(8,1040,1042),separation:separation(1055),now:1040)
    XCTAssertFalse(c.committed);XCTAssertFalse(c.readyForNextTransit);XCTAssertEqual(c.snapshot.reason,"SESSION_STOPPED")
  }
  func testTransferWireRejectsForeignTopologyClaimsAndStaleMarkers() throws {
    let legs:[NoLateGuidanceRouteLeg] = ["WALK","BUS","WALK","SUBWAY","WALK"].enumerated().map {
      .init(index:$0.offset,kind:$0.element,walkingLengthMeters:200,boardingStopName:"합성 환승역")
    }
    let content=NoLateGuidanceContent(sessionId:identity.sessionId,scheduleId:"9001",generation:1,routeRevision:1,
      routeInputDigest:String(repeating:"a",count:64),sequence:10,status:"ACTIVE",phase:"TRANSFER_WALK",quality:"GOOD",
      instruction:"환승 승차 지점으로 도보 이동 중",activeLegIndex:2,walkProgress:0.2,observedAt:1020,validUntil:1035)
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(content,legs:legs,now:1021)?.barFraction ?? -1,0.44,accuracy:0.000001)
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(content,legs:legs,now:1035))
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(content,legs:Array(legs.prefix(3)),now:1021))
    let encoded=try JSONEncoder().encode(content)
    let patches:[[String:Any]] = [["schemaVersion":4],["activeLegIndex":3],["activeLegIndex":30],["boardingConfirmed":true],
      ["rideProgress":0.2],["arrival":[:]], ["quality":"UNCERTAIN"],["walkProgress":1.1]]
    for patch in patches {
      var object=try JSONSerialization.jsonObject(with:encoded) as! [String:Any]
      object.merge(patch,uniquingKeysWith: { _,new in new })
      // A malformed arrival also fails decoding; neither route may render a marker.
      let changed=try? JSONDecoder().decode(NoLateGuidanceContent.self,from:JSONSerialization.data(withJSONObject:object))
      if let changed { XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(changed,legs:legs,now:1021)) }
    }
  }
  func testSessionOwnsSeparationTransferReadinessDoesNotEndJourneyAndRestoreDropsHandoff() throws {
    typealias S=NoLateJourneyAutomaticSession
    let input=try json(length:10),binding=String(decoding:try JSONSerialization.data(withJSONObject:[
      "sessionId":identity.sessionId,"scheduleId":"9001","generation":1,"routeRevision":1,
      "clientOwnerId":"00000000-0000-4000-8000-000000000002","routeInputDigest":S.digest(input),
      "preparedAtEpochSeconds":1000,"expiresAtEpochSeconds":1600,"execution":"SIMULATOR","syncScope":"SANDBOX",
      "savedRouteValidated":true,"guidanceEnabled":true]),as:UTF8.self)
    var s=try S(routeJSON:input,bindingJSON:binding,now:1000,rideRoute:ride())
    XCTAssertNotNil(s.transferWalk);XCTAssertNil(s.finalWalk)
    func ingest(_ x:Double,_ t:Double,_ vehicle:Double?=nil,_ past:Double?=nil) {
      let vehicles:[NoLateJourneyBusRideCore.Vehicle]=vehicle.map { [.init(id:"999999998",routeId:"999999999",direction:"합성 동쪽 방면",
        coordinate:point($0),sourceAt:t,receivedAt:t,validUntil:t+15,source:.verifiedWGS84,metersPastAlighting:past)] } ?? []
      s.ingest(coordinate:point(x),accuracy:2,observedAt:t,now:t,vehicles:vehicles)
    }
    for i in 0...10 { ingest(Double(i)*20,1000+Double(i)*4) }
    for i in 11...13 { ingest(200,1000+Double(i)*4) }
    for i in 14...33 { let x=200+Double(i-13)*40;ingest(x,1000+Double(i)*4,x) }
    XCTAssertEqual(s.ride?.snapshot.phase,"RIDING")
    for (i,t) in [1136.0,1142,1148].enumerated() { ingest(1000,t,1080+Double(i)*60,80+Double(i)*60) }
    XCTAssertEqual(s.separation?.snapshot.status,"SEPARATION_OBSERVED")
    for i in 1...5 { ingest(1000,1148+Double(i)*4) }
    XCTAssertTrue(s.transferWalk?.readyForNextTransit ?? false)
    XCTAssertEqual(s.core.snapshot.status,.active);XCTAssertFalse(s.ride?.snapshot.boardingConfirmed ?? true)
    let content=NoLateAutomaticGuidanceProjection.content(s,now:1168)
    XCTAssertEqual(content.schemaVersion,5);XCTAssertEqual(content.phase,"TRANSFER_WALK")
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(content,legs:s.routeLegs,now:1168)?.legIndex,2)
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(content,legs:s.routeLegs,now:1168).title,"합성 정류장 3-0 환승")
    var notices=NoLateGuidanceNoticePolicy()
    XCTAssertEqual(notices.next(content,legs:s.routeLegs,now:1168)?.kind,"TRANSFER_WALK_2")
    XCTAssertNil(notices.next(content,legs:s.routeLegs,now:1169))
    s.expireRideAdmission();XCTAssertTrue(s.walkingHandoffCommitted)
    let envelope=try JSONEncoder().encode(s.envelope)
    XCTAssertFalse(String(decoding:envelope,as:UTF8.self).contains("transferWalk"))
    let restored=try S(restoring:s.envelope,routeJSON:input,bindingJSON:binding,now:1169,rideRoute:ride())
    XCTAssertFalse(restored.transferWalk?.committed ?? true);XCTAssertFalse(restored.transferWalk?.readyForNextTransit ?? true)
    var revoked=s;revoked.disconnectRide();XCTAssertNil(revoked.transferWalk)
    XCTAssertThrowsError(try s.connectRide(ride(),now:1168)) // late admission for the retired occurrence
    XCTAssertEqual(s.requestedBusLegIndex(now:1168),3)
    let nextApproach=try XCTUnwrap(s.approachForAdmission(now:1168))
    let nextRide=NoLateJourneyBusRideCore.Route(identity:identity,providerRouteId:"999999999",direction:"합성 동쪽 방면",
      approach:nextApproach,departureWindowMeters:300)
    var expired=s;expired.tick(now:1183)
    XCTAssertNil(expired.requestedBusLegIndex(now:1183))
    XCTAssertThrowsError(try expired.connectRide(nextRide,now:1183))
    try s.connectRide(nextRide,now:1168)
    XCTAssertEqual(s.bus?.snapshot.route.legIndex,3);XCTAssertNil(s.transferWalk);XCTAssertNotNil(s.finalWalk)
    XCTAssertEqual(s.finalWalk?.route.walkingLegIndex,4)
    XCTAssertFalse(s.ride?.snapshot.boardingConfirmed ?? true)
    XCTAssertGreaterThanOrEqual(NoLateAutomaticGuidanceProjection.content(s,now:1168).sequence,content.sequence)
    for t in [1172.0,1176,1180,1184] { ingest(1010,t) }
    let waiting=NoLateAutomaticGuidanceProjection.content(s,now:1184)
    XCTAssertEqual(waiting.schemaVersion,6);XCTAssertEqual(waiting.activeLegIndex,3);XCTAssertEqual(waiting.phase,"WAITING")
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(waiting,legs:s.routeLegs,now:1184)?.legIndex,2)
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(waiting,legs:s.routeLegs,now:1184).title,"합성 정류장 3-0")
    XCTAssertGreaterThan(waiting.sequence,content.sequence)
    // Same provider line can appear twice: the occurrence, not just the line ID, fences ETA.
    let departure=try XCTUnwrap(s.pendingDeparture)
    try s.acknowledge(eventKey:departure.eventKey,bindingJSON:String(decoding:JSONEncoder().encode(s.binding),as:UTF8.self),now:1184)
    var fence:[String:Any]=["schemaVersion":1,"sessionId":s.binding.sessionId,"generation":1,"routeRevision":1,
      "routeInputDigest":s.binding.routeInputDigest,"identityEvidence":"SAVED_ROUTE_METADATA"]
    let query:[String:Any]=["namespace":"SEOUL_BUS","arsId":"99999","providerRouteId":"999999999",
      "directionLabel":"합성 동쪽 방면","legIndex":3]
    func bindingData(_ occurrence:Int) throws -> Data {
      var q=query;q["legIndex"]=occurrence
      var payload=fence;payload["mapping"]=["status":"SUPPORTED","query":q,"boarding":["sourceIndex":0,
        "providerSequence":0,"localStationId":"999999995","latitude":point(1010).latitude,"longitude":point(1010).longitude]]
      return try JSONSerialization.data(withJSONObject:["success":true,"data":payload])
    }
    let canonical=try XCTUnwrap(NoLateSavedGuidanceArrivalPolicy.binding(try bindingData(3),session:s))
    XCTAssertNil(NoLateSavedGuidanceArrivalPolicy.binding(try bindingData(1),session:s))
    let iso=ISO8601DateFormatter()
    func time(_ t:Double)->String{iso.string(from:Date(timeIntervalSince1970:t))}
    fence.merge(["status":"WAITING_INFORMATION","evaluatedAt":time(1184),"query":query,"confirmedBoarding":false,
      "remainingStopsToAlight":NSNull(),"observation":["quality":"FRESH_WAITING_INFORMATION","provider":"SEOUL_BUS","kind":"BUS",
        "inputFreshnessEvidence":"PROVIDER_SOURCE_TIMESTAMP","arsId":"99999","directionLabel":"합성 동쪽 방면",
        "confirmedBoarding":false,"sourceUpdatedAt":time(1184),"receivedAt":time(1184),"expectedAt":time(1304),"validUntil":time(1304)]]){_,v in v}
    let eta=NoLateSavedGuidanceArrivalPolicy.observe(try JSONSerialization.data(withJSONObject:["success":true,"data":fence]),session:s,query:canonical,now:1184)
    XCTAssertNotNil(eta.arrival);XCTAssertEqual(eta.busLegIndex,3)
    let withETA=NoLateAutomaticGuidanceProjection.content(s,now:1184,arrival:eta)
    XCTAssertNotNil(NoLateGuidancePresentationPolicy.freshArrival(withETA,legs:s.routeLegs,now:1184))
    XCTAssertNil(NoLateAutomaticGuidanceProjection.content(s,now:1184,arrival:.init("WAITING_INFORMATION",eta.arrival,busLegIndex:1)).arrival)
    for i in 1...20 { let x=1010+Double(i)*40;ingest(x,1184+Double(i)*4,x) }
    let secondRiding=NoLateAutomaticGuidanceProjection.content(s,now:1264)
    XCTAssertEqual(secondRiding.schemaVersion,6);XCTAssertEqual(secondRiding.phase,"RIDING");XCTAssertEqual(secondRiding.activeLegIndex,3)
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(secondRiding,legs:s.routeLegs,now:1264)?.legIndex,3)
    let restoredNext=try S(restoring:s.envelope,routeJSON:input,bindingJSON:binding,now:1265,rideRoute:nextRide)
    XCTAssertEqual(restoredNext.bus?.snapshot.route.legIndex,3)
    XCTAssertEqual(restoredNext.completedLegSequence,s.completedLegSequence)
    XCTAssertFalse(restoredNext.ride?.snapshot.boardingConfirmed ?? true)
    for (i,t) in [1268.0,1274,1280].enumerated() { ingest(1810,t,1890+Double(i)*60,80+Double(i)*60) }
    XCTAssertEqual(s.separation?.snapshot.status,"SEPARATION_OBSERVED")
    for i in 1...25 { ingest(1810+Double(i)*8,1280+Double(i)*4) }
    let final=NoLateAutomaticGuidanceProjection.content(s,now:1380)
    XCTAssertEqual(final.schemaVersion,6);XCTAssertEqual(final.phase,"FINAL_WALK");XCTAssertEqual(final.activeLegIndex,4)
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(final,legs:s.routeLegs,now:1380)?.legIndex,4)
    XCTAssertGreaterThan(final.sequence,secondRiding.sequence)
    XCTAssertEqual(s.core.snapshot.status,.active)
    for t in [1384.0,1388,1392,1396,1400] { ingest(2010,t) }
    XCTAssertTrue(s.core.snapshot.status.isTerminal)
    s.tick(now:1600);XCTAssertTrue(s.core.snapshot.status.isTerminal);XCTAssertFalse(s.walkingHandoffCommitted)
  }
}
