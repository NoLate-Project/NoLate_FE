import Foundation

enum NoLateGuidanceActivityStartPolicy {
  static func allows(_ content: NoLateGuidanceContent, legs: [NoLateGuidanceRouteLeg],
    now: Double, foreground: Bool, remotePilot: Bool) -> Bool {
    guard foreground else { return false }
    if !remotePilot && NoLateGuidancePresentationPolicy.isPrepared(content, legs: legs, now: now) { return true }
    return NoLateGuidanceRoutePositionPolicy.position(content, legs: legs, now: now) != nil
  }
}

/// Event extraction is separate from rendering: GPS ticks never become repeated announcements.
/// It consumes only the same fresh, confirmed position used by detail/Activity, not raw speeds.
struct NoLateGuidanceNotice: Equatable, Sendable {
  let kind: String
  let body: String
  let expiresAt: Double
}
struct NoLateGuidanceNoticePolicy {
  private var identity: String?
  private var seen = Set<String>()
  private var lastClock = -Double.infinity
  private var lastObservation = -Double.infinity
  private var lastSequence: Int64 = -1
  private var stage = 0
  mutating func reset() { self = Self() }
  mutating func next(_ content: NoLateGuidanceContent, legs: [NoLateGuidanceRouteLeg], now: Double) -> NoLateGuidanceNotice? {
    guard now.isFinite, content.sequence >= 0, content.generation > 0, content.routeRevision > 0,
      !content.sessionId.isEmpty, !content.routeInputDigest.isEmpty,
      NoLateGuidanceRouteLayoutPolicy.validTopology(legs), legs.count >= 3 else { return nil }
    let key = "\(content.sessionId):\(content.generation):\(content.routeRevision):\(content.routeInputDigest)"
    if identity != key { reset(); identity = key }
    guard now >= lastClock, content.sequence >= lastSequence else { return nil }
    lastClock = now; lastSequence = content.sequence
    guard NoLateGuidanceRoutePositionPolicy.position(content, legs: legs, now: now) != nil,
      let observation = content.observedAt, observation >= lastObservation else { return nil }
    lastObservation = observation
    let nextStage: Int
    switch content.phase {
    case "WALKING_TO_STOP": nextStage = content.activeLegIndex * 10 + 1
    case "APPROACHING_STOP": nextStage = content.activeLegIndex * 10 + 2
    case "WAITING": nextStage = content.activeLegIndex * 10 + 3
    case "RIDING": nextStage = content.activeLegIndex * 10 + 4
    case "FINAL_WALK": nextStage = content.activeLegIndex * 10 + 5
    case "TRANSFER_WALK": nextStage = content.activeLegIndex * 10
    default: return nil
    }
    guard nextStage >= stage else { return nil }; stage = nextStage
    let busIndex = content.activeLegIndex % 2 == 1 ? content.activeLegIndex : content.activeLegIndex + 1
    let leg = legs[min(busIndex, legs.count - 1)]
    let target = NoLateGuidanceRouteLayoutPolicy.safeName(leg.alightingStopName) ?? "목표 정류장"
    let line = NoLateGuidanceRouteLayoutPolicy.safeName(leg.lineName) ?? "버스"
    func eventKey(_ kind:String) -> String { "\(content.activeLegIndex):\(kind)" }
    var kind: String, body: String
    if content.phase == "RIDING", let subway = content.subway, subway.valid {
      let station = NoLateGuidanceRouteLayoutPolicy.safeName(leg.alightingStopName) ?? "하차역"
      if subway.remainingStops == 0 { kind = "SUBWAY_ALIGHTING_STATION"; body = "\(station)에 도착했습니다. 하차 여부를 확인해 주세요." }
      else if subway.remainingStops == 1 { kind = "SUBWAY_ONE_STOP_BEFORE"; body = "다음 역은 \(station)입니다. 하차를 준비해 주세요." }
      else { kind = "BOARDING_CONFIRMED"; body = "\(line)로 이동 중입니다. 하차역까지 \(subway.remainingStops)개 역 남았습니다." }
    } else if content.phase == "RIDING", let alighting = content.alighting, alighting.valid {
      if alighting.kind == "NEAR_STOP" { kind = "NEAR_STOP"; body = "\(target) 근처입니다. 하차를 준비해 주세요." }
      else {
        guard !seen.contains(eventKey("NEAR_STOP")) else { return nil }
        kind = "ONE_STOP_BEFORE"; body = "다음 정류장은 \(target)입니다. 하차를 준비해 주세요."
      }
    } else if ["WAITING", "APPROACHING_STOP"].contains(content.phase),
      let arrival = NoLateGuidancePresentationPolicy.freshArrival(content, legs: legs, now: now),
      arrival.expectedAt - now <= 120 {
      // Round up, never claim the user is on this vehicle or that it arrives at an exact second.
      let minutes = max(1, Int(ceil((arrival.expectedAt - now) / 60)))
      kind = "ARRIVAL_SOON"; body = "\(line) · 약 \(minutes)분 후 도착 예정입니다. 탑승을 준비해 주세요."
    } else if content.phase == "RIDING" { kind = "BOARDING_CONFIRMED"; body = "\(line)로 이동 중입니다." }
    else if content.phase == "FINAL_WALK" { kind = "FINAL_WALK"; body = "목적지까지 도보로 이동합니다." }
    else if content.phase == "TRANSFER_WALK" {
      kind = "TRANSFER_WALK_\(content.activeLegIndex)"
      let next = NoLateGuidanceRouteLayoutPolicy.safeName(legs[content.activeLegIndex + 1].boardingStopName) ?? "다음 승차 지점"
      body = "\(next)까지 도보로 이동해 환승해 주세요."
    }
    else if content.phase == "WALKING_TO_STOP" { kind = "DEPARTURE"; body = "이동을 감지했습니다. 승차 지점으로 안내합니다." }
    else { return nil }
    // Higher priority replaces lower priority, never drains an obsolete speech queue later.
    if kind == "NEAR_STOP" || kind == "ONE_STOP_BEFORE" { seen.insert(eventKey("BOARDING_CONFIRMED")) }
    guard seen.insert(eventKey(kind)).inserted else { return nil }
    return .init(kind: kind, body: body, expiresAt: min(content.validUntil, now + 10))
  }
}

/// Single remote publisher pilot: wall-clock seconds, no future timestamps, no persistence of tokens.
struct NoLateGuidancePublicationPolicy {
  private(set) var timestamp: Int64 = 0
  private var last: NoLateGuidanceContent?
  private(set) var transportBlocked = false
  mutating func rejectTransport() { transportBlocked = true }
  /// Invalidation is not a refreshed observation. Retain its expired GPS deadline and strip
  /// every precise/live field; the remote widget needs this transition even after GPS expires.
  static func isExpiredInvalidation(_ content: NoLateGuidanceContent, now: Double) -> Bool {
    content.phase == "UNAVAILABLE" && ["UNCERTAIN", "UNAVAILABLE"].contains(content.quality)
      && content.instruction == "현재 위치 확인 필요" && content.walkProgress == nil && content.rideProgress == nil && content.alighting == nil && !content.boardingConfirmed && content.arrival == nil
      && content.validUntil.isFinite && content.validUntil > 0 && content.validUntil <= now
      && content.observedAt.map { $0.isFinite && $0 <= now && content.validUntil <= $0 + 15 } == true
  }
  mutating func next(_ content: NoLateGuidanceContent, now: Double) -> Int64? {
    guard !transportBlocked, now.isFinite, now > 0, now < 253402300800,
      content.status == "ACTIVE", content.validUntil.isFinite,
      content.validUntil > now || Self.isExpiredInvalidation(content, now: now) else { return nil }
    let second = Int64(now.rounded(.down))
    guard second > timestamp else { return nil } // Same-second changes coalesce; clock regression waits.
    if let last {
      guard last.sessionId == content.sessionId, last.generation == content.generation,
        last.routeRevision == content.routeRevision, last.routeInputDigest == content.routeInputDigest else { return nil }
      let meaningful = last.phase != content.phase || last.quality != content.quality
        || last.activeLegIndex != content.activeLegIndex || last.schemaVersion != content.schemaVersion
        || last.instruction != content.instruction || last.walkProgress != content.walkProgress
        || last.rideProgress != content.rideProgress || last.boardingConfirmed != content.boardingConfirmed
        || last.alighting != content.alighting || last.subway != content.subway
        || last.lastConfirmedSubway != content.lastConfirmedSubway
        // A station dwell still needs genuinely new observation leases. Otherwise
        // an unchanged current-station card expires after 15s despite fresh GPS.
        || last.observedAt != content.observedAt || last.validUntil != content.validUntil
        || last.arrival != content.arrival || last.arrivalStatus != content.arrivalStatus
      guard meaningful, second - timestamp >= 5 else { return nil }
    }
    timestamp = second; last = content
    return second
  }
}
