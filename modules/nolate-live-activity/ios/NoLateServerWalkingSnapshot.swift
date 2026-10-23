import Foundation

/// Server-owned planning data, NOT proof of vehicle/boarding admission. ODsay input stays separate.
struct NoLateServerWalkingSnapshot: Codable, Equatable, Sendable {
  typealias Input = NoLateJourneyRouteNormalizer.Input
  typealias Coordinate = NoLateJourneyRouteNormalizer.Coordinate
  struct Point: Codable, Equatable, Sendable { let lat:Double; let lng:Double }
  struct Walk: Codable, Equatable, Sendable {
    let legIndex:Int; let provider:String; let points:[Point]
    var coordinates:[Coordinate] { points.map { .init(latitude:$0.lat, longitude:$0.lng) } }
  }
  let schemaVersion:Int; let snapshotId:String; let memberId:Int64; let scheduleId:Int64
  let loginGeneration:Int64; let routeRevision:Int64; let routeFingerprint:String
  let issuedAtMs:Int64; let expiresAtMs:Int64
  let transitProvider:String; let walkProvider:String; let navigationReady:Bool; let reason:String
  let walks:[Walk]
  var navigationExpiresAtMs:Int64? = nil
  func validate(input:Input) throws {
    let safe:Int64=9_007_199_254_740_991
    func require(_ value:Bool) throws { if !value { throw NoLateJourneyRouteNormalizer.ValidationError.schema } }
    // ODsay rounds independently serialized leg and station coordinates by
    // centimetres. Match the same real-world point, never synthesize a link.
    func samePoint(_ a:Coordinate?,_ b:Coordinate?) -> Bool {
      guard let a,let b else { return false }
      return distance(a,b)<=1
    }
    let unknownSingleSubway=input.serviceState == "UNKNOWN" && input.legs.count == 3
      && input.legs[1].kind == "SUBWAY"
    try require((schemaVersion == 1 && walks.count == 2 || schemaVersion == 2 && (3...16).contains(walks.count)
      || [3,4].contains(schemaVersion) && (2...16).contains(walks.count)) && UUID(uuidString:snapshotId)?.uuidString.lowercased() == snapshotId
      && (1...safe).contains(memberId) && (1...safe).contains(scheduleId)
      && (0...safe).contains(loginGeneration) && routeRevision == input.routeRevision
      && routeFingerprint.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil
      && (1...safe).contains(issuedAtMs) && (1...safe).contains(expiresAtMs) && expiresAtMs-issuedAtMs == 300_000
      && transitProvider == "odsay" && walkProvider == "tmap" && !navigationReady && reason == "TRANSIT_ADMISSION_PENDING"
      && input.context == "SAVED_ROUTE" && input.provider == "odsay" && input.source == "api"
      && ["live_provider","provider_estimate"].contains(input.reliability)
      && input.plausibility == "normal" && (input.serviceState == "operating" || unknownSingleSubway)
      && (3...31).contains(input.legs.count) && input.legs.count % 2 == 1
      && input.legs.enumerated().allSatisfy { $0.offset % 2 == 0 ? $0.element.kind == "WALK" : ["BUS","SUBWAY"].contains($0.element.kind) }
      && walks.map(\.legIndex) == Array(stride(from:0,to:input.legs.count,by:2))
      && walks.reduce(0,{ $0 + $1.points.count }) <= 12_000)
    try require([3,4].contains(schemaVersion) ? navigationExpiresAtMs.map {
      (1...safe).contains($0) && $0-expiresAtMs == (schemaVersion == 4 ? 7_200_000 : 600_000)
    } == true : navigationExpiresAtMs == nil)
    try require(samePoint(input.legs.first?.start,input.origin) && samePoint(input.legs.last?.end,input.destination))
    try require(zip(input.legs,input.legs.dropFirst()).allSatisfy { samePoint($0.end,$1.start) }
      && input.legs.filter { $0.kind != "WALK" }.allSatisfy {
        samePoint($0.stops.first?.coordinate,$0.start) && samePoint($0.stops.last?.coordinate,$0.end)
      })
    for walk in walks {
      try require(walk.provider == "tmap" && (2...2000).contains(walk.points.count))
      let points=walk.coordinates
      try require(points.allSatisfy { $0.latitude.isFinite && $0.longitude.isFinite && abs($0.latitude)<=90 && abs($0.longitude)<=180 })
      guard let start=input.legs[walk.legIndex].start,let end=input.legs[walk.legIndex].end else { throw NoLateJourneyRouteNormalizer.ValidationError.schema }
      try require(distance(start,points[0])<=30 && distance(end,points[points.count-1])<=30)
      for (a,b) in zip(points,points.dropFirst()) { let d=distance(a,b); try require(d>0 && d<=150) }
    }
  }
  func validate(binding:NoLateJourneyAutomaticSession.Binding, now:Double) throws {
    guard now.isFinite, binding.syncScope == "AUTHENTICATED", binding.savedRouteValidated == true,
      binding.guidanceEnabled == true, binding.authMemberId == memberId, binding.loginGeneration == loginGeneration,
      binding.scheduleId == String(scheduleId), binding.routeRevision == routeRevision,
      now*1000 >= Double(issuedAtMs), now < binding.expiresAtEpochSeconds,
      binding.preparedAtEpochSeconds*1000 >= Double(issuedAtMs), binding.preparedAtEpochSeconds*1000 < Double(expiresAtMs),
      binding.expiresAtEpochSeconds <= binding.preparedAtEpochSeconds+(schemaVersion == 4 ? 7200 : 600),
      binding.expiresAtEpochSeconds*1000 <= Double([3,4].contains(schemaVersion) ? (navigationExpiresAtMs ?? 0) : expiresAtMs)+0.001,
      [3,4].contains(schemaVersion) || now*1000 < Double(expiresAtMs) else {
      throw NoLateJourneyAutomaticSession.Failure.invalidRoute
    }
  }
  private func distance(_ a:Coordinate,_ b:Coordinate)->Double {
    let r=Double.pi/180, h=pow(sin((b.latitude-a.latitude)*r/2),2)
      + cos(a.latitude*r)*cos(b.latitude*r)*pow(sin((b.longitude-a.longitude)*r/2),2)
    return 6_371_000*2*asin(sqrt(min(1,max(0,h))))
  }
}
