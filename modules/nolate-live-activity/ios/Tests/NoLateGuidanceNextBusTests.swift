import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateGuidanceNextBusTests:XCTestCase {
  let legs:[NoLateGuidanceRouteLeg] = ["WALK","BUS","WALK","BUS","WALK"].enumerated().map {
    .init(index:$0.offset,kind:$0.element,walkingLengthMeters:200,boardingStopName:"승차 \($0.offset)",
      lineName:"버스 \($0.offset)",alightingStopName:"하차 \($0.offset)")
  }
  func content(_ phase:String="RIDING",_ index:Int=3,_ at:Double=1200,_ notice:NoLateGuidanceAlighting?=nil)->NoLateGuidanceContent {
    .init(sessionId:"s",scheduleId:"9001",generation:1,routeRevision:1,routeInputDigest:String(repeating:"a",count:64),
      sequence:Int64(at),status:"ACTIVE",phase:phase,quality:"GOOD",instruction:"unused",activeLegIndex:index,
      walkProgress:phase == "RIDING" ? nil:phase == "WAITING" ? 1:0.5,observedAt:at,validUntil:at+15,
      rideProgress:phase == "RIDING" ? 0.5:nil,boardingConfirmed:phase == "RIDING",alighting:notice)
  }
  func testIndexedPositionsAndNamesShareTheCurrentOccurrence() {
    for (phase,index,positionIndex,fraction) in [("RIDING",3,3,0.7),("WAITING",3,2,0.6),
      ("WALKING_TO_STOP",2,2,0.5),("APPROACHING_STOP",2,2,0.5),("FINAL_WALK",4,4,0.9)] {
      let c=content(phase,index)
      XCTAssertEqual(c.schemaVersion,6)
      let p=NoLateGuidanceRoutePositionPolicy.position(c,legs:legs,now:1201)
      XCTAssertEqual(p?.legIndex,positionIndex);XCTAssertEqual(p?.barFraction ?? -1,fraction,accuracy:0.00001)
      XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(c,legs:legs,now:1215))
    }
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(content(),legs:legs,now:1201).title,"버스 3")
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(content("WAITING"),legs:legs,now:1201).title,"승차 3")
    XCTAssertEqual(NoLateGuidancePresentationPolicy.presentation(content("RIDING",3,1200,.init(kind:"NEAR_STOP",remainingMeters:20)),legs:legs,now:1201).title,"하차 3")
  }
  func testSecondRideAnnouncementsHaveTheirOwnDeduplicationScope() {
    var p=NoLateGuidanceNoticePolicy()
    XCTAssertEqual(p.next(content("RIDING",1,1100),legs:legs,now:1100)?.kind,"BOARDING_CONFIRMED")
    XCTAssertEqual(p.next(content("RIDING",1,1110,.init(kind:"NEAR_STOP",remainingMeters:20)),legs:legs,now:1110)?.kind,"NEAR_STOP")
    XCTAssertEqual(p.next(content(),legs:legs,now:1200)?.body,"버스 3로 이동 중입니다.")
    XCTAssertNil(p.next(content("RIDING",3,1204),legs:legs,now:1204))
    XCTAssertEqual(p.next(content("RIDING",3,1208,.init(kind:"ONE_STOP_BEFORE",remainingMeters:100)),legs:legs,now:1208)?.body,
      "다음 정류장은 하차 3입니다. 하차를 준비해 주세요.")
    XCTAssertNil(p.next(content("RIDING",1,1210),legs:legs,now:1210))
  }
  func testWrongIndexTopologyAndClaimsNeverShowAMarker() throws {
    let data=try JSONEncoder().encode(content())
    for patch:[String:Any] in [["schemaVersion":2],["activeLegIndex":1],["activeLegIndex":2],["activeLegIndex":31],
      ["boardingConfirmed":false],["walkProgress":1],["rideProgress":1.1]] {
      var object=try JSONSerialization.jsonObject(with:data) as! [String:Any]
      object.merge(patch,uniquingKeysWith:{_,new in new})
      let c=try JSONDecoder().decode(NoLateGuidanceContent.self,from:JSONSerialization.data(withJSONObject:object))
      XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(c,legs:legs,now:1201))
    }
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(content(),legs:Array(legs.prefix(3)),now:1201))
    XCTAssertNil(NoLateGuidanceRoutePositionPolicy.position(content("FINAL_WALK",2),legs:legs,now:1201))
  }
}
