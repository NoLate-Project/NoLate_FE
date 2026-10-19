import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyBusSeparationCoreTests:XCTestCase {
  typealias C=NoLateJourneyBusSeparationCore
  typealias E=NoLateJourneyEngineCore
  typealias R=NoLateJourneyBusRideCore
  let id=E.Identity(sessionId:"separation-test",generation:1,routeRevision:1,epoch:1)
  func point(_ x:Double)->E.Coordinate { .init(latitude:37.5665,longitude:126.978+x/(6_371_000 * .pi/180*cos(37.5665 * .pi/180))) }
  func route()->R.Route { .init(identity:id,providerRouteId:"999999999",direction:"합성 동쪽 방면",
    approach:.init(legIndex:1,boardingCoordinate:point(0),walkingCoordinates:[point(-200),point(0)],coordinates:[point(0),point(1000)],provenance:.syntheticReplay),departureWindowMeters:300) }
  func prior()->R.Snapshot {
    var s=R.Snapshot();s.phase="RIDING";s.quality="GOOD";s.boardingConfirmed=true
    s.observedAt=1000;s.validUntil=1015;s.alongRouteMeters=1000;s.routeLengthMeters=1000;return s
  }
  func fix(_ seq:Int,_ at:Double,_ meters:Double=1000,accuracy:Double=2)->E.Observation {
    .init(identity:id,sequence:Int64(seq),observedAt:at,coordinate:point(meters),horizontalAccuracyMeters:accuracy,source:.replay)
  }
  func vehicle(_ at:Double,_ past:Double,id:String="999999998")->R.Vehicle {
    .init(id:id,routeId:"999999999",direction:"합성 동쪽 방면",coordinate:point(1000+past),sourceAt:at,receivedAt:at,validUntil:at+15,source:.syntheticReplay,metersPastAlighting:past)
  }
  func seed(_ c:inout C) { c.ingest(fix(1,1001),priorRide:prior(),associatedId:"999999998",vehicles:[],now:1001) }
  func collect(_ c:inout C) {
    for (i,t) in [1005.0,1011,1017].enumerated() { c.ingest(fix(i+2,t),priorRide:nil,associatedId:nil,vehicles:[vehicle(t,80+Double(i)*60)],now:t) }
  }
  func testOnlyFreshPreviouslyAssociatedVehicleDepartingWhilePassengerAtTargetCollects() {
    var c=C(route:route());seed(&c);collect(&c)
    XCTAssertEqual(c.snapshot.status,"SEPARATION_OBSERVED");XCTAssertEqual(c.snapshot.evidenceCount,3)
    XCTAssertEqual(c.snapshot.validUntil,1032)
  }
  func testStationaryPassengerMissingChangedDuplicateOrStaleVehicleNeverMeansAlighting() {
    for mode in 0..<5 {
      var c=C(route:route());seed(&c)
      for (i,t) in [1005.0,1011,1017].enumerated() {
        let v=vehicle(t,80+Double(i)*60)
        let rows:[R.Vehicle]
        switch mode { case 0:rows=[];case 1:rows=[vehicle(t,150,id:"999999997")]
        case 2:rows=[v,v];case 3:rows=[vehicle(t-15,150)];default: rows=[vehicle(t,20)] }
        c.ingest(fix(i+2,t),priorRide:nil,associatedId:nil,vehicles:rows,now:t)
      }
      XCTAssertEqual(c.snapshot.status,"UNAVAILABLE");XCTAssertEqual(c.snapshot.evidenceCount,0)
    }
  }
  func testNoPriorRideOrPassengerStillOnDepartingBusCannotCollect() {
    var c=C(route:route());collect(&c);XCTAssertEqual(c.snapshot.evidenceCount,0)
    c=C(route:route());seed(&c)
    c.ingest(fix(2,1005,1100),priorRide:nil,associatedId:nil,vehicles:[vehicle(1005,100)],now:1005)
    XCTAssertEqual(c.snapshot.reason,"PASSENGER_NOT_AT_TARGET")
    collect(&c);XCTAssertEqual(c.snapshot.evidenceCount,0)
  }
  func testRepeatedSourceClockDoesNotAddEvidenceOrRenewTTLAndTickExpires() {
    var c=C(route:route());seed(&c)
    let v=vehicle(1005,100)
    c.ingest(fix(2,1005),priorRide:nil,associatedId:nil,vehicles:[v],now:1005)
    let before=c.snapshot
    c.ingest(fix(3,1006),priorRide:nil,associatedId:nil,vehicles:[v],now:1006)
    XCTAssertEqual(c.snapshot,before)
    c.tick(now:1020);XCTAssertEqual(c.snapshot.evidenceCount,0);XCTAssertNil(c.snapshot.validUntil)
  }
  func testWrongIdentityFutureLocationBadAccuracyRegressionAndExpiredCorrelationFailClosed() {
    for mode in 0..<5 {
      var c=C(route:route());seed(&c)
      let location:E.Observation
      switch mode { case 0:location = .init(identity:.init(sessionId:"other",generation:1,routeRevision:1,epoch:1),sequence:2,observedAt:1005,coordinate:point(1000),horizontalAccuracyMeters:2,source:.replay)
      case 1:location=fix(2,1006);case 2:location=fix(2,1005,accuracy:26)
      case 3:location=fix(1,1005);default:location=fix(2,1092) }
      let now=mode==4 ? 1092.0:1005.0
      c.ingest(location,priorRide:nil,associatedId:nil,vehicles:[vehicle(now,100)],now:now)
      XCTAssertNotEqual(c.snapshot.status,"SEPARATION_OBSERVED")
    }
  }
  func testStopClearsEvidenceAndCannotRestartOrCreateAnyJourneyPhase() {
    var c=C(route:route());seed(&c);collect(&c);c.stop()
    XCTAssertEqual(c.snapshot.status,"UNAVAILABLE");XCTAssertNil(c.snapshot.validUntil)
    c.ingest(fix(10,1020),priorRide:prior(),associatedId:"999999998",vehicles:[vehicle(1020,250)],now:1020)
    XCTAssertEqual(c.snapshot.reason,"SESSION_STOPPED")
  }
  func testUnconfirmedOrStalePriorRideAndInvalidDepartureCoordinateCannotSeedEvidence() {
    for mode in 0..<3 {
      var c=C(route:route()),p=prior()
      if mode==0 { p.boardingConfirmed=false };if mode==1 { p.validUntil=1001 };if mode==2 { p.alongRouteMeters=100 }
      c.ingest(fix(1,1001),priorRide:p,associatedId:"999999998",vehicles:[],now:1001)
      collect(&c);XCTAssertEqual(c.snapshot.evidenceCount,0)
    }
    var c=C(route:route());seed(&c)
    var bad=vehicle(1005,100)
    bad = .init(id:bad.id,routeId:bad.routeId,direction:bad.direction,coordinate:.init(latitude:.nan,longitude:127),
      sourceAt:bad.sourceAt,receivedAt:bad.receivedAt,validUntil:bad.validUntil,source:bad.source,metersPastAlighting:100)
    c.ingest(fix(2,1005),priorRide:nil,associatedId:nil,vehicles:[bad],now:1005)
    XCTAssertEqual(c.snapshot.evidenceCount,0)
  }
}
