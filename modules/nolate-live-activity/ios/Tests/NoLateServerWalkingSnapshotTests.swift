import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateServerWalkingSnapshotTests:XCTestCase {
  typealias S=NoLateJourneyAutomaticSession
  func testV4TwoHourSessionDoesNotRenewAdmissionOrLocationFreshness() throws {
    var p=try payload(),w=p["walkingSnapshot"] as! [String:Any]
    w["schemaVersion"]=4;w["navigationExpiresAtMs"]=8_500_000;p["walkingSnapshot"]=w
    var s=try session(p,bindingPatch:["expiresAtEpochSeconds":8200])
    let json=try encode(p),binding=try bindingJSON(json,["expiresAtEpochSeconds":8200])
    s.tick(now:1700)
    XCTAssertEqual(s.core.snapshot.status,.armed)
    let restored=try S(restoring:s.envelope,routeJSON:json,bindingJSON:binding,now:1701)
    XCTAssertEqual(restored.core.snapshot.status,.armed)
    XCTAssertNotEqual(restored.core.snapshot.quality.rawValue,"GOOD")
    XCTAssertThrowsError(try S(restoring:s.envelope,routeJSON:json,bindingJSON:binding,now:8200))
    XCTAssertThrowsError(try session(p,bindingPatch:["expiresAtEpochSeconds":8201]))
    XCTAssertThrowsError(try session(p,bindingPatch:["preparedAtEpochSeconds":1300,"expiresAtEpochSeconds":8200],now:1300))
    for patch:[String:Any] in [["navigationExpiresAtMs":8_500_001],["navigationExpiresAtMs":1_900_000],["schemaVersion":3]] {
      var bad=p,snapshot=w;patch.forEach{snapshot[$0.key]=$0.value};bad["walkingSnapshot"]=snapshot
      XCTAssertThrowsError(try session(bad,bindingPatch:["expiresAtEpochSeconds":8200]))
    }
    var noSnapshot=p;noSnapshot.removeValue(forKey:"walkingSnapshot")
    XCTAssertThrowsError(try session(noSnapshot,bindingPatch:["expiresAtEpochSeconds":8200]))
  }
  func testV3SeparatesAdmissionExpiryFromBoundedNavigationAndRestore() throws {
    var p=try payload(),w=p["walkingSnapshot"] as! [String:Any]
    w["schemaVersion"]=3;w["navigationExpiresAtMs"]=1_900_000;p["walkingSnapshot"]=w
    let s=try session(p,bindingPatch:["expiresAtEpochSeconds":1600])
    let json=try encode(p),binding=try bindingJSON(json,["expiresAtEpochSeconds":1600])
    let restored=try S(restoring:s.envelope,routeJSON:json,bindingJSON:binding,now:1301)
    XCTAssertEqual(restored.core.snapshot.status,.armed)
    XCTAssertThrowsError(try S(restoring:s.envelope,routeJSON:json,bindingJSON:binding,now:1600))
    XCTAssertThrowsError(try session(p,bindingPatch:["expiresAtEpochSeconds":1601]))
    XCTAssertThrowsError(try session(p,bindingPatch:["preparedAtEpochSeconds":1300,"expiresAtEpochSeconds":1600],now:1300))
    for patch:[String:Any] in [["navigationExpiresAtMs":1_900_001],["navigationExpiresAtMs":NSNull()],["schemaVersion":2]] {
      var bad=p,snapshot=w;patch.forEach{snapshot[$0.key]=$0.value};bad["walkingSnapshot"]=snapshot
      XCTAssertThrowsError(try session(bad))
    }
  }
  func testMixedWalkConsumesSeparatePathsWithoutChangingODsayOrBoarding() throws {
    let input=try payload(),json=try encode(input),s=try session(input)
    let summary=try NoLateJourneyRouteNormalizer.normalize(json:json)
    XCTAssertEqual(summary.reasonCodes,["SAVED_ROUTE_REVALIDATION_REQUIRED"])
    XCTAssertTrue(summary.legs[0].geometryUsable);XCTAssertTrue(summary.legs[2].geometryUsable)
    XCTAssertEqual(s.core.snapshot.route.coordinates.count,3);XCTAssertEqual(s.core.snapshot.route.provenance,.verifiedWalkingPath)
    XCTAssertEqual(s.core.snapshot.status,.armed);XCTAssertNil(s.ride);XCTAssertNil(s.pendingDeparture)
    let decoded=try JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self,from:Data(json.utf8))
    XCTAssertEqual(decoded.provider,"odsay");XCTAssertTrue(decoded.legs[0].coordinates.isEmpty)
    XCTAssertEqual(decoded.legs[0].geometrySource,"DISPLAY_CONNECTOR")
    XCTAssertEqual(s.routeLegs[0].walkingLengthMeters!,200,accuracy:0.1)
    XCTAssertEqual(NoLateAutomaticGuidanceProjection.content(s,now:1000).phase,"READY")
  }
  func testMissingSeparateContractNeverPromotesODsayConnectors() throws {
    var p=try payload();p.removeValue(forKey:"walkingSnapshot")
    XCTAssertThrowsError(try session(p))
  }
  func testV2BindsEveryTransferWalkAndRejectsMissingReorderedOrWrongVersionPaths() throws {
    var p=try payload(),legs=p["legs"] as! [[String:Any]],snapshot=p["walkingSnapshot"] as! [String:Any]
    var next=legs[1];next["index"]=3;next["start"]=point(800);next["end"]=point(1200);next["coordinates"]=[800.0,1000,1200].map(point)
    next["stops"]=[800.0,1000,1200].enumerated().map { ["sourceIndex":$0.offset,"providerSequence":$0.offset,"name":"다음 정류장",
      "code":"next-\($0.offset)","coordinate":point($0.element)] as [String:Any] }
    var last=legs[2];last["index"]=4;last["start"]=point(1200);last["end"]=point(1400)
    legs += [next,last];p["legs"]=legs;p["destination"]=point(1400)
    var walks=snapshot["walks"] as! [[String:Any]]
    walks.append(["legIndex":4,"provider":"tmap","points":[1200.0,1300,1400].map {x -> [String:Double] in
      let v=point(x);return ["lat":v["latitude"]!,"lng":v["longitude"]!]}])
    snapshot["schemaVersion"]=2;snapshot["walks"]=walks;p["walkingSnapshot"]=snapshot
    let s=try session(p);XCTAssertEqual(s.routeLegs.count,5);XCTAssertEqual(s.routeLegs[4].walkingLengthMeters!,200,accuracy:0.1)
    for mode in ["version","missing","order","index","claim"] {
      var bad=p,w=snapshot,paths=walks
      switch mode {case "version":w["schemaVersion"]=1
      case "missing":paths.removeLast()
      case "order":paths.reverse()
      case "index":paths[2]["legIndex"]=6
      default:w["navigationReady"]=true}
      w["walks"]=paths;bad["walkingSnapshot"]=w;XCTAssertThrowsError(try session(bad))
    }
  }
  func testForeignOwnerLoginScheduleRevisionAndUntrustedScopeCannotArm() throws {
    for patch:[String:Any] in [["authMemberId":8],["loginGeneration":3],["scheduleId":"9002"],["routeRevision":2],
      ["syncScope":"SANDBOX"],["syncScope":"LOCAL_ONLY"],["expiresAtEpochSeconds":1301],["preparedAtEpochSeconds":999]] {
      XCTAssertThrowsError(try session(payload(),bindingPatch:patch))
    }
  }
  func testExpiredFutureAndChangedSnapshotMetadataCannotArm() throws {
    for patch:[String:Any] in [["issuedAtMs":1_001_000,"expiresAtMs":1_301_000],["expiresAtMs":1_300_001],
      ["memberId":8],["loginGeneration":3],["routeRevision":2],["walkProvider":"odsay"],["navigationReady":true],
      ["routeFingerprint":"wrong"],["snapshotId":"wrong"],["schemaVersion":2]] {
      var p=try payload();var w=p["walkingSnapshot"] as! [String:Any];patch.forEach{w[$0.key]=$0.value};p["walkingSnapshot"]=w
      XCTAssertThrowsError(try session(p))
    }
    XCTAssertThrowsError(try session(payload(),now:1300))
  }
  func testDisconnectedWrongEndpointsOrBusSubstitutionCannotArm() throws {
    for mode in ["gap","endpoint","provider","tuple","walk-order"] {
      var p=try payload();var w=p["walkingSnapshot"] as! [String:Any];var walks=w["walks"] as! [[String:Any]]
      if mode == "gap" {walks[0]["points"]=[["lat":37.5665,"lng":126.978],["lat":0,"lng":0]]}
      if mode == "endpoint" {walks[0]["points"]=[["lat":37.5665,"lng":126.99],["lat":37.5665,"lng":126.9901]]}
      if mode == "provider" {walks[0]["provider"]="odsay"}
      if mode == "walk-order" {walks.reverse()}
      if mode == "tuple" {var legs=p["legs"] as! [[String:Any]];legs[0]["end"]=point(201);p["legs"]=legs}
      w["walks"]=walks;p["walkingSnapshot"]=w;XCTAssertThrowsError(try session(p))
    }
  }
  func testSnapshotLifetimeBoundsEngineAndRestore() throws {
    var s=try session(payload());let saved=s.envelope
    s.tick(now:1300);XCTAssertTrue(s.core.snapshot.status.isTerminal)
    let json=try encode(payload()),binding=try bindingJSON(json)
    XCTAssertThrowsError(try S(restoring:saved,routeJSON:json,bindingJSON:binding,now:1300))
  }
  private func point(_ x:Double)->[String:Double] { ["latitude":37.5665,"longitude":126.978+x/(6_371_000*Double.pi/180*cos(37.5665*Double.pi/180))] }
  private func payload() throws -> [String:Any] {
    func leg(_ index:Int,_ values:[Double])->[String:Any] {
      let bus=index==1
      return ["index":index,"kind":bus ? "BUS":"WALK","geometrySource":bus ? "TRANSIT_PASS_SHAPE_LINESTRING":"DISPLAY_CONNECTOR",
        "exact":bus,"geometryInputComplete":bus,"coordinates":bus ? values.map(point):[],"start":point(values.first!),"end":point(values.last!),
        "providerRouteId":"888888","localRouteId":"999999999","directionName":"합성 동쪽 방면","serviceAvailable":true,
        "declaredStationCount":2,"stopEvidenceProvider":"odsay","stopEvidenceVersion":1,
        "stops":bus ? values.enumerated().map { ["sourceIndex":$0.offset,"providerSequence":$0.offset,"name":"합성 정류장",
          "code":"synthetic-\($0.offset)","coordinate":point($0.element)] as [String:Any] }:[]]
    }
    func walk(_ i:Int,_ xs:[Double])->[String:Any] { ["legIndex":i,"provider":"tmap","points":xs.map { x in
      let p=point(x);return ["lat":p["latitude"]!,"lng":p["longitude"]!]}] }
    return ["schemaVersion":1,"routeRevision":1,"context":"SAVED_ROUTE","provider":"odsay","source":"api",
      "reliability":"live_provider","plausibility":"normal","serviceState":"operating","origin":point(0),"destination":point(800),
      "legs":[leg(0,[0,100,200]),leg(1,[200,400,600]),leg(2,[600,700,800])],
      "walkingSnapshot":["schemaVersion":1,"snapshotId":"11111111-1111-4111-8111-111111111111","memberId":7,"scheduleId":9001,
        "loginGeneration":2,"routeRevision":1,"routeFingerprint":String(repeating:"a",count:64),"issuedAtMs":1_000_000,"expiresAtMs":1_300_000,
        "transitProvider":"odsay","walkProvider":"tmap","navigationReady":false,"reason":"TRANSIT_ADMISSION_PENDING",
        "walks":[walk(0,[0,100,200]),walk(2,[600,700,800])]]]
  }
  private func encode(_ p:[String:Any]) throws -> String {String(decoding:try JSONSerialization.data(withJSONObject:p,options:.sortedKeys),as:UTF8.self)}
  private func bindingJSON(_ json:String,_ patch:[String:Any]=[:]) throws -> String {
    var b:[String:Any]=["sessionId":"00000000-0000-4000-8000-000000000001","scheduleId":"9001","generation":1,"routeRevision":1,
      "clientOwnerId":"00000000-0000-4000-8000-000000000002","routeInputDigest":S.digest(json),"preparedAtEpochSeconds":1000,
      "expiresAtEpochSeconds":1300,"execution":"SIMULATOR","syncScope":"AUTHENTICATED","savedRouteValidated":true,
      "guidanceEnabled":true,"apiOrigin":"http://127.0.0.1:15546","authMemberId":7,"loginGeneration":2]
    patch.forEach{b[$0.key]=$0.value};return try encode(b)
  }
  private func session(_ p:[String:Any],bindingPatch:[String:Any]=[:],now:Double=1000) throws -> S {
    let json=try encode(p);return try S(routeJSON:json,bindingJSON:bindingJSON(json,bindingPatch),now:now)
  }
}
