import Foundation

/// Native passenger evidence, separate from the provider's train position. Memory only.
/// Underground GPS loss MUST NOT advance a passenger marker from the train clock alone.
struct NoLateJourneySubwayRideCore: Sendable {
  typealias Engine = NoLateJourneyEngineCore
  struct Station: Equatable, Sendable {
    let routingId: String
    let providerId: String
    let coordinate: Engine.Coordinate
  }
  struct Route: Equatable, Sendable {
    let identity: Engine.Identity
    let legIndex: Int
    let stations: [Station]
  }
  struct Train: Sendable {
    let id: String
    let stopIndex: Int
    let state: Int
    let sourceAt: Double
    let validUntil: Double
  }
  struct Snapshot: Equatable, Sendable {
    var phase = "UNAVAILABLE"
    var reason = "SUBWAY_INPUT_UNAVAILABLE"
    var sequence: Int64 = 0
    var boardingConfirmed = false
    var currentStopIndex: Int?
    var remainingStops: Int?
    var observedAt: Double?
    var validUntil: Double?
    // Historical evidence only. Never used to confirm boarding or advance the live marker.
    var lastConfirmedStopIndex: Int?
    var lastConfirmedAt: Double?
  }
  let route: Route
  let armedAt: Double
  let expiresAt: Double
  private(set) var snapshot = Snapshot()
  private var lastSequence: Int64 = -1
  private var lastGPS: (at: Double, coordinate: Engine.Coordinate)?
  private var waitStarted: Double?
  private var waitCount = 0
  private var candidate: String?
  private var candidateSource: Double?
  private var departedAt: Double?
  private var association: String?
  private var confirmedIndex: Int?
  private var lastNow: Double?
  private var terminated = false

  init(route: Route, armedAt: Double, expiresAt: Double) throws {
    guard route.legIndex % 2 == 1, (1...29).contains(route.legIndex),
      (2...500).contains(route.stations.count),
      Set(route.stations.map(\.routingId)).count == route.stations.count,
      Set(route.stations.map(\.providerId)).count == route.stations.count,
      route.stations.allSatisfy({ Self.id($0.routingId) && Self.id($0.providerId)
        && $0.coordinate.latitude.isFinite && (33...39.5).contains($0.coordinate.latitude)
        && $0.coordinate.longitude.isFinite && (124...132).contains($0.coordinate.longitude) }),
      armedAt.isFinite, expiresAt.isFinite, armedAt > 0, expiresAt > armedAt,
      expiresAt - armedAt <= 7200 else { throw NoLateJourneyAutomaticSession.Failure.invalidRoute }
    self.route = route; self.armedAt = armedAt; self.expiresAt = expiresAt
  }

  mutating func ingest(_ fix: Engine.Observation, trains: [Train], now: Double) {
    guard !terminated, now.isFinite, now >= armedAt, lastNow.map({ now >= $0 }) ?? true,
      fix.identity == route.identity, fix.sequence > lastSequence else { return }
    tick(now: now)
    guard !terminated else { return }
    lastSequence = fix.sequence; snapshot.sequence = min(Int64.max - 1, snapshot.sequence) + 1
    guard fix.observedAt.isFinite, fix.observedAt >= armedAt, fix.observedAt <= now,
      now - fix.observedAt < 15, fix.horizontalAccuracyMeters.isFinite,
      (0...25).contains(fix.horizontalAccuracyMeters), fix.coordinate.latitude.isFinite,
      fix.coordinate.longitude.isFinite else { uncertain("PASSENGER_LOCATION_UNRELIABLE"); return }
    if let prior = lastGPS {
      let elapsed = fix.observedAt - prior.at
      // CoreLocation may deliver a newer sequence with the same (or an older)
      // observation timestamp. It is not new movement evidence, but it also
      // cannot invalidate the earlier, continuous passenger history.
      guard elapsed > 0 else { uncertain("PASSENGER_LOCATION_UNRELIABLE"); return }
      guard elapsed <= 20,
        Self.distance(prior.coordinate, fix.coordinate) <= max(80, elapsed * 40) else {
        // Before boarding, a discontinuity must not bridge a missing movement history.
        // A fresh appearance at the next station is not proof of riding this train.
        if association == nil { resetCandidate() }
        lastGPS = nil; uncertain("PASSENGER_MOVEMENT_UNRELIABLE"); return
      }
    }
    lastGPS = (fix.observedAt, fix.coordinate)
    guard trains.count <= 100, Set(trains.map(\.id)).count == trains.count else {
      uncertain("TRAIN_ASSOCIATION_AMBIGUOUS"); return
    }
    let fresh = trains.filter { Self.id($0.id) && $0.id.count <= 8 && route.stations.indices.contains($0.stopIndex)
      && (0...3).contains($0.state) && $0.sourceAt.isFinite && $0.validUntil.isFinite
      && $0.sourceAt >= armedAt - 30 && $0.sourceAt <= now && now < $0.validUntil
      && $0.validUntil > $0.sourceAt && $0.validUntil <= $0.sourceAt + 30 }
    let near = route.stations.indices.filter {
      Self.distance(fix.coordinate, route.stations[$0].coordinate) + fix.horizontalAccuracyMeters <= 75
    }
    guard near.count <= 1 else { uncertain("STATION_OCCURRENCE_AMBIGUOUS"); return }
    if near.first == 0 && association == nil {
      let atBoard = fresh.filter { $0.stopIndex == 0 && [0,1].contains($0.state) }
      // The train can leave the boarding station before the next passenger GPS fix.
      // A missing station row is not evidence that the passenger's already observed
      // waiting history disappeared. Keep it briefly, but never confirm boarding
      // until continuous movement and the same train at the next station arrive.
      if atBoard.isEmpty, candidate != nil, waitCount >= 3,
        let started = waitStarted, fix.observedAt - started >= 8,
        // The public train row can disappear before the passenger clears the
        // boarding-station radius. Keep a verified wait for at most 90 seconds;
        // this never confirms riding without same-train evidence at the next stop.
        let source = candidateSource, now - source < 90 {
        uncertain("TRAIN_PASSENGER_CORRELATION_REQUIRED"); return
      }
      guard atBoard.count == 1, let train = atBoard.first else { resetCandidate(); uncertain("TRAIN_ASSOCIATION_AMBIGUOUS"); return }
      if candidate != train.id { resetCandidate(); candidate = train.id }
      waitStarted = waitStarted ?? fix.observedAt; waitCount += 1
      candidateSource = train.sourceAt
      snapshot.phase = "WAITING"; snapshot.reason = "SUBWAY_BOARDING_NOT_CONFIRMED"
      snapshot.observedAt = fix.observedAt; snapshot.validUntil = min(expiresAt, train.validUntil, fix.observedAt + 15)
      return
    }
    guard let candidate, waitCount >= 3, let started = waitStarted,
      fix.observedAt - started >= 8, let candidateSource else {
      uncertain("BOARDING_HISTORY_REQUIRED"); return
    }
    let boardDistance = Self.distance(fix.coordinate, route.stations[0].coordinate)
    if departedAt == nil && boardDistance >= 100 { departedAt = fix.observedAt }
    guard let index = near.first, index > 0,
      let departure = departedAt, association != nil || fix.observedAt - departure <= 120,
      fresh.filter({ $0.stopIndex == index && $0.state == 1 }).count == 1,
      let train = fresh.first(where: { $0.stopIndex == index && $0.state == 1 }), train.id == candidate,
      train.stopIndex == index, train.state == 1, train.sourceAt > candidateSource,
      train.sourceAt - candidateSource >= 10,
      // Speed is evidence for the initial boarding, not a timer that invalidates a
      // previously correlated passenger when the same train dwells at a station.
      association != nil || boardDistance / max(1, fix.observedAt - started) >= 3,
      confirmedIndex.map({ index >= $0 && index <= $0 + 1 }) ?? (index == 1),
      association == nil || association == train.id else {
      uncertain("TRAIN_PASSENGER_CORRELATION_REQUIRED"); return
    }
    association = train.id
    confirmedIndex = index
    snapshot.phase = "RIDING"; snapshot.reason = "STATION_SEQUENCE_AND_TRAIN_CORRELATED"
    snapshot.boardingConfirmed = true; snapshot.currentStopIndex = index
    snapshot.remainingStops = route.stations.count - 1 - index
    snapshot.observedAt = fix.observedAt
    snapshot.validUntil = min(expiresAt, train.validUntil, fix.observedAt + 15)
    snapshot.lastConfirmedStopIndex = index; snapshot.lastConfirmedAt = fix.observedAt
  }

  mutating func tick(now: Double) {
    guard !terminated, now.isFinite, lastNow.map({ now >= $0 }) ?? true else { return }
    lastNow = now
    if now >= expiresAt { stop(); return }
    if let until = snapshot.validUntil, now >= until { uncertain("SUBWAY_EVIDENCE_STALE") }
  }
  mutating func stop() { terminated = true; resetCandidate(); association = nil; confirmedIndex = nil; uncertain("SUBWAY_SESSION_STOPPED"); snapshot.phase = "STOPPED"; snapshot.lastConfirmedStopIndex = nil; snapshot.lastConfirmedAt = nil }
  private mutating func resetCandidate() { candidate = nil; candidateSource = nil; waitStarted = nil; waitCount = 0; departedAt = nil }
  private mutating func uncertain(_ reason: String) {
    snapshot.phase = "UNAVAILABLE"; snapshot.reason = reason; snapshot.boardingConfirmed = false
    snapshot.currentStopIndex = nil; snapshot.remainingStops = nil; snapshot.observedAt = nil; snapshot.validUntil = nil
  }
  private static func id(_ value: String) -> Bool {
    !value.isEmpty && value.count <= 20 && value.utf8.allSatisfy { (48...57).contains($0) } && value.contains { $0 != "0" }
  }
  static func distance(_ a: Engine.Coordinate, _ b: Engine.Coordinate) -> Double {
    let r = Double.pi / 180
    let h = pow(sin((b.latitude-a.latitude)*r/2),2) + cos(a.latitude*r)*cos(b.latitude*r)*pow(sin((b.longitude-a.longitude)*r/2),2)
    return 6_371_000 * 2 * asin(sqrt(min(1,max(0,h))))
  }
}
