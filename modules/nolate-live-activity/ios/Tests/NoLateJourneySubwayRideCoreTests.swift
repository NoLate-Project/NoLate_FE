import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneySubwayRideCoreTests: XCTestCase {
  func testNativeTransportAllowsOnlyAuthenticatedSubwayInputAndNoArbitrarySuffix() {
    XCTAssertTrue(NoLateJourneyObservationPathPolicy.allows("/subway-observation/input",scope:"AUTHENTICATED"))
    for scope in ["SANDBOX","LOCAL_ONLY",""] { XCTAssertFalse(NoLateJourneyObservationPathPolicy.allows("/subway-observation/input",scope:scope)) }
    for path in ["/subway-observation","/subway-observation/input?x=1","/../subway-observation/input","https://other.test"] {
      XCTAssertFalse(NoLateJourneyObservationPathPolicy.allows(path,scope:"AUTHENTICATED"))
    }
    XCTAssertTrue(NoLateJourneyObservationPathPolicy.allows("/validate",scope:"SANDBOX"))
  }
  private typealias Core = NoLateJourneySubwayRideCore
  private typealias Session = NoLateJourneyAutomaticSession
  private let identity = NoLateJourneyEngineCore.Identity(sessionId:"00000000-0000-4000-8000-000000000001",generation:1,routeRevision:1,epoch:1)
  private func point(_ meters: Double) -> NoLateJourneyEngineCore.Coordinate {
    .init(latitude:37.5,longitude:127 + meters / (6_371_000 * Double.pi / 180 * cos(37.5 * Double.pi / 180)))
  }
  private func route() -> Core.Route {
    .init(identity:identity,legIndex:1,stations:[0.0,300,600].enumerated().map {
      .init(routingId:String(222+$0.offset),providerId:String(9990000001+$0.offset),coordinate:point($0.element)) })
  }
  private func train(_ index: Int, _ at: Double, id: String = "00123") -> Core.Train {
    .init(id:id,stopIndex:index,state:1,sourceAt:at,validUntil:at+30)
  }
  private func fix(_ x: Double, _ at: Double, accuracy: Double = 5) -> NoLateJourneyEngineCore.Observation {
    .init(identity:identity,sequence:Int64(at),observedAt:at,coordinate:point(x),horizontalAccuracyMeters:accuracy,source:.realLocation)
  }
  private func wait(_ core: inout Core) {
    for t in [1000.0,1004,1008] { core.ingest(fix(0,t),trains:[train(0,1000)],now:t) }
  }
  private func travel(_ core: inout Core) {
    core.ingest(fix(120,1020),trains:[train(0,1019)],now:1020)
    core.ingest(fix(220,1030),trains:[train(0,1029)],now:1030)
    core.ingest(fix(300,1040),trains:[train(1,1039)],now:1040)
  }
  func testBoardingNeedsWaitingGPSMovementAndSameIndependentTrainAtNextStation() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core);XCTAssertFalse(core.snapshot.boardingConfirmed)
    travel(&core)
    XCTAssertTrue(core.snapshot.boardingConfirmed);XCTAssertEqual(core.snapshot.currentStopIndex,1)
    XCTAssertEqual(core.snapshot.remainingStops,1);XCTAssertEqual(core.snapshot.validUntil,1055)
  }
  func testTrainClockAloneAndTunnelLossNeverAdvancePassengerPosition() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core);travel(&core);core.tick(now:1055)
    XCTAssertFalse(core.snapshot.boardingConfirmed);XCTAssertNil(core.snapshot.currentStopIndex)
    XCTAssertNil(core.snapshot.remainingStops);XCTAssertEqual(core.snapshot.reason,"SUBWAY_EVIDENCE_STALE")
    XCTAssertEqual(core.snapshot.lastConfirmedStopIndex,1)
    XCTAssertEqual(core.snapshot.lastConfirmedAt,1040)
  }
  func testConfirmedPassengerCanDwellWithFreshGPSAndSameTrainWithoutReprovingBoardingSpeed() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core);travel(&core)
    for t in stride(from:1044.0,through:1200.0,by:4) {
      core.ingest(fix(300,t),trains:[train(1,t-1)],now:t)
      XCTAssertTrue(core.snapshot.boardingConfirmed)
      XCTAssertEqual(core.snapshot.currentStopIndex,1)
    }
    core.ingest(fix(300,1204),trains:[train(1,1203,id:"00124")],now:1204)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
    XCTAssertNil(core.snapshot.currentStopIndex)
  }
  func testNoWaitingOrTwoCoLocatedTrainsCannotConfirmPassenger() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    travel(&core);XCTAssertFalse(core.snapshot.boardingConfirmed)
    core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    for t in [1000.0,1004,1008] { core.ingest(fix(0,t),trains:[train(0,1000),train(0,1000,id:"00124")],now:t) }
    travel(&core);XCTAssertFalse(core.snapshot.boardingConfirmed)
  }
  func testAnotherTrainAtAnotherStationDoesNotInvalidateTheUniqueLocalCorrelation() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core)
    core.ingest(fix(120,1020),trains:[train(0,1019)],now:1020)
    core.ingest(fix(220,1030),trains:[train(0,1029)],now:1030)
    core.ingest(fix(300,1040),trains:[train(1,1039),train(2,1039,id:"00124")],now:1040)
    XCTAssertTrue(core.snapshot.boardingConfirmed)
  }
  func testBoardingHistorySurvivesBriefMissingTrainAtBoardingStationButStillNeedsNextStationEvidence() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core)
    core.ingest(fix(0,1012),trains:[],now:1012)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
    XCTAssertEqual(core.snapshot.reason,"TRAIN_PASSENGER_CORRELATION_REQUIRED")
    core.ingest(fix(120,1020),trains:[],now:1020)
    core.ingest(fix(220,1030),trains:[],now:1030)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
    core.ingest(fix(300,1040),trains:[train(1,1039)],now:1040)
    XCTAssertTrue(core.snapshot.boardingConfirmed)
    XCTAssertEqual(core.snapshot.currentStopIndex,1)
  }
  func testVerifiedWaitingSurvivesTrainRowGapWhileLeavingStationRadius() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core)
    for t in stride(from:1012.0,through:1052.0,by:4) {
      core.ingest(fix(0,t),trains:[],now:t)
      XCTAssertFalse(core.snapshot.boardingConfirmed)
      XCTAssertEqual(core.snapshot.reason,"TRAIN_PASSENGER_CORRELATION_REQUIRED")
    }
    core.ingest(fix(40,1056),trains:[],now:1056)
    core.ingest(fix(80,1060),trains:[],now:1060)
    core.ingest(fix(120,1064),trains:[],now:1064)
    core.ingest(fix(180,1070),trains:[],now:1070)
    core.ingest(fix(240,1076),trains:[],now:1076)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
    core.ingest(fix(300,1082),trains:[train(1,1081)],now:1082)
    XCTAssertTrue(core.snapshot.boardingConfirmed)
    XCTAssertEqual(core.snapshot.currentStopIndex,1)
  }
  func testWaitingHistoryExpiresIfPassengerRemainsAtBoardingStationTooLongWithoutTrain() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core)
    for t in stride(from:1012.0,through:1092.0,by:4) {
      core.ingest(fix(0,t),trains:[],now:t)
    }
    core.ingest(fix(120,1096),trains:[],now:1096)
    core.ingest(fix(220,1106),trains:[],now:1106)
    core.ingest(fix(300,1116),trains:[train(1,1115)],now:1116)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
    XCTAssertEqual(core.snapshot.reason,"BOARDING_HISTORY_REQUIRED")
  }
  func testBriefMissingTrainDoesNotPreserveIncompleteOrConflictingBoardingHistory() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    core.ingest(fix(0,1000),trains:[train(0,1000)],now:1000)
    core.ingest(fix(0,1004),trains:[],now:1004)
    core.ingest(fix(0,1008),trains:[train(0,1008)],now:1008)
    core.ingest(fix(120,1020),trains:[],now:1020)
    core.ingest(fix(220,1030),trains:[],now:1030)
    core.ingest(fix(300,1040),trains:[train(1,1039)],now:1040)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
    XCTAssertEqual(core.snapshot.reason,"BOARDING_HISTORY_REQUIRED")
    core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core)
    core.ingest(fix(0,1012),trains:[train(0,1011,id:"00124")],now:1012)
    core.ingest(fix(120,1020),trains:[],now:1020)
    core.ingest(fix(220,1030),trains:[],now:1030)
    core.ingest(fix(300,1040),trains:[train(1,1039)],now:1040)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
  }
  func testDuplicateLocationTimestampDoesNotEraseVerifiedBoardingHistory() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core)
    let duplicate = NoLateJourneyEngineCore.Observation(identity:identity,sequence:1009,
      observedAt:1008,coordinate:point(0),horizontalAccuracyMeters:5,source:.realLocation)
    core.ingest(duplicate,trains:[train(0,1000)],now:1009)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
    XCTAssertEqual(core.snapshot.reason,"PASSENGER_LOCATION_UNRELIABLE")
    travel(&core)
    XCTAssertTrue(core.snapshot.boardingConfirmed)
    XCTAssertEqual(core.snapshot.currentStopIndex,1)
  }
  func testLostPreBoardingMovementHistoryCannotBeRepairedByTheTrainArrivingAtTheNextStation() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core)
    core.ingest(fix(300,1040),trains:[train(1,1039)],now:1040)
    core.ingest(fix(300,1044),trains:[train(1,1043)],now:1044)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
    XCTAssertNil(core.snapshot.currentStopIndex)
    XCTAssertEqual(core.snapshot.reason,"BOARDING_HISTORY_REQUIRED")
  }
  func testWrongTrainStaleFixAndStopCannotProducePosition() throws {
    var core = try Core(route:route(),armedAt:1000,expiresAt:1600)
    wait(&core)
    core.ingest(fix(120,1020),trains:[train(0,1019)],now:1020)
    core.ingest(fix(220,1030),trains:[train(0,1029)],now:1030)
    core.ingest(fix(300,1040),trains:[train(1,1039,id:"00124")],now:1040)
    XCTAssertFalse(core.snapshot.boardingConfirmed)
    core.stop();core.ingest(fix(300,1041),trains:[train(1,1040)],now:1041)
    XCTAssertEqual(core.snapshot.phase,"STOPPED");XCTAssertNil(core.snapshot.currentStopIndex)
  }
  func testNativePolicyAndSessionConsumeSameBoundInputWithoutPersistingTrainEvidence() throws {
    var session = try makeSession()
    XCTAssertEqual(session.requestedSubwayLegIndex,1)
    for (x,t) in [(0.0,1000.0),(0,1004),(30,1008),(60,1012),(90,1016),(120,1020),(150,1024),(180,1028),(200,1032)] {
      session.ingest(coordinate:point(x),accuracy:5,observedAt:t,now:t)
    }
    XCTAssertEqual(session.core.snapshot.status,.active)
    for (x,t,stop,source) in [(200.0,1033.0,0,1032.0),(200,1037,0,1032),(200,1041,0,1032),
      (320,1053,0,1052),(420,1063,0,1062),(500,1073,1,1072)] {
      let raw = try envelope(session,at:t,train:train(stop,source),stationIds:["0222","0221","0220"])
      let input = try XCTUnwrap(NoLateSavedGuidanceSubwayPolicy.decode(raw,session:session,now:t))
      session.ingest(coordinate:point(x),accuracy:5,observedAt:t,now:t,subwayInput:input)
    }
    XCTAssertTrue(session.subway?.snapshot.boardingConfirmed == true)
    let displayed = NoLateAutomaticGuidanceProjection.content(session,now:1073)
    XCTAssertEqual(displayed.schemaVersion,8)
    XCTAssertEqual(displayed.subway?.currentStopIndex,1)
    XCTAssertEqual(displayed.subway?.remainingStops,1)
    XCTAssertEqual(displayed.rideProgress,0.5)
    XCTAssertEqual(NoLateGuidanceRoutePositionPolicy.position(displayed,legs:session.routeLegs,now:1073)?.legIndex,1)
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(displayed,legs:session.routeLegs,now:1073).action,"다음 역 하차 · 하차 준비")
    var notices = NoLateGuidanceNoticePolicy()
    XCTAssertEqual(notices.next(displayed,legs:session.routeLegs,now:1073)?.kind,"SUBWAY_ONE_STOP_BEFORE")
    XCTAssertNil(notices.next(displayed,legs:session.routeLegs,now:1074))
    var expired = session
    expired.tick(now:1088)
    let stale = NoLateAutomaticGuidanceProjection.content(expired,now:1088)
    XCTAssertEqual(stale.phase,"UNAVAILABLE")
    XCTAssertNil(stale.subway)
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(stale,legs:session.routeLegs,now:1088))
    let last = try XCTUnwrap(stale.lastConfirmedSubway)
    XCTAssertEqual(last.stopIndex,1)
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(stale,legs:session.routeLegs,now:1088).title,
      "마지막 확인 · \(last.stopName)")
    XCTAssertTrue(NoLateGuidancePresentationPolicy.presentation(stale,legs:session.routeLegs,now:1088).action.contains("방금 확인"))
    var staleNotices = NoLateGuidanceNoticePolicy()
    XCTAssertNil(staleNotices.next(stale,legs:session.routeLegs,now:1088))
    let tooOld = NoLateAutomaticGuidanceProjection.content(expired,now:1163)
    XCTAssertNil(tooOld.lastConfirmedSubway)
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(tooOld,legs:session.routeLegs,now:1163).title,"위치 확인 중")
    let checkpoint = String(decoding:try JSONEncoder().encode(session.envelope),as:UTF8.self)
    XCTAssertFalse(checkpoint.contains("00123"));XCTAssertFalse(checkpoint.contains("0222"))
    let restored = try Session(restoring:session.envelope,routeJSON:session.routeJSON,
      bindingJSON:String(decoding:try JSONEncoder().encode(session.binding),as:UTF8.self),now:1074)
    XCTAssertNil(restored.subway)
    session.stop(now:1075);XCTAssertEqual(session.subway?.snapshot.phase,"STOPPED")
    XCTAssertNil(session.subway?.snapshot.lastConfirmedStopIndex)
  }
  func testAuthenticatedTrainFeedGapKeepsPassengerGPSButCannotClaimRidingUntilSameTrainAtNextStation() throws {
    var session = try makeSession()
    for (x,t) in [(0.0,1000.0),(0,1004),(30,1008),(60,1012),(90,1016),(120,1020),(150,1024),(180,1028),(200,1032)] {
      session.ingest(coordinate:point(x),accuracy:5,observedAt:t,now:t)
    }
    XCTAssertEqual(session.core.snapshot.status,.active)
    for t in [1033.0,1037,1041] {
      let raw = try envelope(session,at:t,train:train(0,1032),stationIds:["0222","0221","0220"])
      let input = try XCTUnwrap(NoLateSavedGuidanceSubwayPolicy.decode(raw,session:session,now:t))
      session.ingest(coordinate:point(200),accuracy:5,observedAt:t,now:t,subwayInput:input)
    }
    XCTAssertEqual(session.subway?.snapshot.phase,"WAITING")
    for (x,t) in [(240.0,1045.0),(320,1053),(420,1063)] {
      session.ingest(coordinate:point(x),accuracy:5,observedAt:t,now:t)
      XCTAssertFalse(session.subway?.snapshot.boardingConfirmed ?? true)
      XCTAssertNil(session.subway?.snapshot.currentStopIndex)
    }
    let raw = try envelope(session,at:1073,train:train(1,1072),stationIds:["0222","0221","0220"])
    let input = try XCTUnwrap(NoLateSavedGuidanceSubwayPolicy.decode(raw,session:session,now:1073))
    session.ingest(coordinate:point(500),accuracy:5,observedAt:1073,now:1073,subwayInput:input)
    XCTAssertTrue(session.subway?.snapshot.boardingConfirmed == true)
    XCTAssertEqual(session.subway?.snapshot.currentStopIndex,1)
  }
  func testPolicyRejectsCountOnlyWrongBindingChangedStationAndExpiredTrain() throws {
    let session = try makeSession()
    for patch in [["schemaVersion":1],["generation":2],["subwayLegIndex":3],["navigationReady":true]] as [[String:Any]] {
      XCTAssertNil(NoLateSavedGuidanceSubwayPolicy.decode(try envelope(session,at:1001,train:train(0,1000),patch:patch),session:session,now:1001))
    }
    XCTAssertNil(NoLateSavedGuidanceSubwayPolicy.decode(try envelope(session,at:1001,train:train(0,970)),session:session,now:1001))
    var root = try JSONSerialization.jsonObject(with:envelope(session,at:1001,train:train(0,1000))) as! [String:Any]
    var body = root["data"] as! [String:Any];var input = body["nativeInput"] as! [String:Any]
    var stations = input["stations"] as! [[String:Any]];stations[0]["routingStationId"] = "999"
    input["stations"] = stations;body["nativeInput"] = input;root["data"] = body
    XCTAssertNil(NoLateSavedGuidanceSubwayPolicy.decode(try JSONSerialization.data(withJSONObject:root),session:session,now:1001))
  }
  private func makeSession() throws -> Session {
    func p(_ x:Double) -> [String:Double] { let c = point(x);return ["latitude":c.latitude,"longitude":c.longitude] }
    let walk: [String:Any] = ["index":0,"kind":"WALK","geometrySource":"WALK_STEPS_LINESTRING","exact":true,
      "geometryInputComplete":true,"stopEvidenceProvider":"odsay","stopEvidenceVersion":1,
      "coordinates":[p(0),p(100),p(200)],"start":p(0),"end":p(200),"stops":[]]
    let subway: [String:Any] = ["index":1,"kind":"SUBWAY","geometrySource":"TRANSIT_PASS_SHAPE_LINESTRING","exact":true,
      "geometryInputComplete":true,"coordinates":[p(200),p(500),p(800)],"start":p(200),"end":p(800),
      "providerRouteId":"1000:2","directionCode":"UP","declaredStationCount":2,"stopEvidenceProvider":"odsay","stopEvidenceVersion":1,
      "stops":[200.0,500,800].enumerated().map { ["sourceIndex":$0.offset,"providerSequence":$0.offset,"name":"합성 역",
        "code":"synthetic-\($0.offset)","routingStationId":String(222+$0.offset),"coordinate":p($0.element)] as [String:Any] }]
    var final = walk
    final["index"] = 2; final["coordinates"] = [p(800),p(900),p(1000)]; final["start"] = p(800); final["end"] = p(1000)
    let object: [String:Any] = ["schemaVersion":1,"routeRevision":1,"context":"SAVED_ROUTE","provider":"odsay","source":"api",
      "reliability":"live_provider","plausibility":"normal","serviceState":"operating","origin":p(0),"destination":p(1000),"legs":[walk,subway,final]]
    let json = String(decoding:try JSONSerialization.data(withJSONObject:object,options:.sortedKeys),as:UTF8.self)
    let binding: [String:Any] = ["sessionId":identity.sessionId,"scheduleId":"9001","generation":1,"routeRevision":1,
      "clientOwnerId":"00000000-0000-4000-8000-000000000002","routeInputDigest":Session.digest(json),
      "preparedAtEpochSeconds":1000,"expiresAtEpochSeconds":1600,"execution":"SIMULATOR","syncScope":"AUTHENTICATED",
      "savedRouteValidated":true,"guidanceEnabled":true,"apiOrigin":"http://127.0.0.1:15547","authMemberId":7,"loginGeneration":2]
    return try Session(routeJSON:json,bindingJSON:String(decoding:try JSONSerialization.data(withJSONObject:binding),as:UTF8.self),now:1000)
  }
  private func envelope(_ session:Session,at:Double,train:Core.Train,patch:[String:Any] = [:],
    stationIds:[String]? = nil) throws -> Data {
    let stations = [200.0,500,800].enumerated().map { offset,x -> [String:Any] in
      let c = point(x);return ["routingStationId":String(222+offset),
        "stationId":stationIds?[offset] ?? String(9990000001+offset),"latitude":c.latitude,"longitude":c.longitude]
    }
    var body: [String:Any] = ["schemaVersion":2,"sessionId":session.binding.sessionId,"generation":1,"routeRevision":1,
      "routeInputDigest":session.binding.routeInputDigest,"subwayLegIndex":1,"identityEvidence":"OWNED_AUTOMATIC_SESSION_TRAIN_REFERENCES",
      "status":"TRAIN_REFERENCES_ONLY","navigationReady":false,"passengerBoardingConfirmed":false,
      "passengerPosition":NSNull(),"passengerRemainingStops":NSNull(),"nativeInput":["observedAt":at,"stations":stations,
        "trains":[["id":train.id,"stopIndex":train.stopIndex,"state":train.state,"sourceAt":train.sourceAt,"validUntil":train.validUntil]]]]
    patch.forEach { body[$0.key] = $0.value }
    return try JSONSerialization.data(withJSONObject:["success":true,"data":body])
  }
}
