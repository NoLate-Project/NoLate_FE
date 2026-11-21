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
  let track: NoLateJourneyRouteNormalizer.SubwayTrack?
  struct PassengerSegment: Sendable {
    let from: Int
    let progress: Double
    let point: Engine.Coordinate
    let observedAt: Double
    let validUntil: Double
    let confirmedAt: Double
  }
  private(set) var passengerSegment: PassengerSegment?
  private var alongTrack: (at: Double, along: Double, accuracy: Double)?
  let armedAt: Double
  let expiresAt: Double
  private(set) var snapshot = Snapshot()
  private(set) var hasObservedBoardingWait = false
  // Passenger location at a verified boarding platform, independent of which train is there.
  private(set) var platformFixAt: Double?
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

  init(route: Route, armedAt: Double, expiresAt: Double, track: NoLateJourneyRouteNormalizer.SubwayTrack? = nil) throws {
    guard route.legIndex % 2 == 1, (1...29).contains(route.legIndex),
      (2...500).contains(route.stations.count),
      Set(route.stations.map(\.routingId)).count == route.stations.count,
      Set(route.stations.map(\.providerId)).count == route.stations.count,
      route.stations.allSatisfy({ Self.id($0.routingId) && Self.id($0.providerId)
        && $0.coordinate.latitude.isFinite && (33...39.5).contains($0.coordinate.latitude)
        && $0.coordinate.longitude.isFinite && (124...132).contains($0.coordinate.longitude) }),
      armedAt.isFinite, expiresAt.isFinite, armedAt > 0, expiresAt > armedAt,
      expiresAt - armedAt <= 7200 else { throw NoLateJourneyAutomaticSession.Failure.invalidRoute }
    self.route = route; self.armedAt = armedAt; self.expiresAt = expiresAt; self.track = track
  }

  mutating func ingest(_ fix: Engine.Observation, trains: [Train], now: Double) {
    guard !terminated, now.isFinite, now >= armedAt, lastNow.map({ now >= $0 }) ?? true,
      fix.identity == route.identity, fix.sequence > lastSequence else { return }
    tick(now: now)
    guard !terminated else { return }
    let previousPlatformFix = platformFixAt
    platformFixAt = nil
    lastSequence = fix.sequence; snapshot.sequence = min(Int64.max - 1, snapshot.sequence) + 1
    guard fix.observedAt.isFinite, fix.observedAt >= armedAt, fix.observedAt <= now,
      now - fix.observedAt < 15, fix.horizontalAccuracyMeters.isFinite,
      (0...25).contains(fix.horizontalAccuracyMeters), fix.coordinate.latitude.isFinite,
      (-90...90).contains(fix.coordinate.latitude), fix.coordinate.longitude.isFinite,
      (-180...180).contains(fix.coordinate.longitude) else { uncertain("PASSENGER_LOCATION_UNRELIABLE"); return }
    if let prior = lastGPS {
      let elapsed = fix.observedAt - prior.at
      // CoreLocation may deliver a newer sequence with the same (or an older)
      // observation timestamp. It is not new movement evidence, but it also
      // cannot invalidate the earlier, continuous passenger history.
      guard elapsed > 0 else { uncertain("PASSENGER_LOCATION_UNRELIABLE", retainTrackChain: true); return }
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
      if fix.source == .realLocation,
        atBoard.count == 1 || previousPlatformFix.map({ fix.observedAt - $0 < 15 }) == true {
        platformFixAt = fix.observedAt
      }
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
      hasObservedBoardingWait = true
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
      uncertain("TRAIN_PASSENGER_CORRELATION_REQUIRED", retainTrackChain: true)
      measureBetweenStations(fix, trains: fresh, now: now)
      return
    }
    association = train.id
    confirmedIndex = index
    snapshot.phase = "RIDING"; snapshot.reason = "STATION_SEQUENCE_AND_TRAIN_CORRELATED"
    snapshot.boardingConfirmed = true; snapshot.currentStopIndex = index
    snapshot.remainingStops = route.stations.count - 1 - index
    snapshot.observedAt = fix.observedAt
    snapshot.validUntil = min(expiresAt, train.validUntil, fix.observedAt + 15)
    snapshot.lastConfirmedStopIndex = index; snapshot.lastConfirmedAt = fix.observedAt
    passengerSegment = nil; alongTrack = nil
    if fix.source == .realLocation, let track, track.stopsAlong.indices.contains(index + 1),
      let projection = track.project(fix), abs(projection.along - track.stopsAlong[index]) <= 75 {
      alongTrack = (fix.observedAt, projection.along, fix.horizontalAccuracyMeters)
    }
  }

  /// Display-only evidence. Never alters train association, station index/count, separation or boarding.
  private mutating func measureBetweenStations(_ fix: Engine.Observation, trains: [Train], now: Double) {
    guard fix.source == .realLocation, let track, let anchor = confirmedIndex, let association,
      let confirmedAt = snapshot.lastConfirmedAt, now - confirmedAt < 90, let prior = alongTrack,
      track.stopsAlong.indices.contains(anchor + 1), fix.observedAt > prior.at, fix.observedAt - prior.at <= 15,
      !trains.contains(where: { $0.id == association && ![anchor,anchor+1].contains($0.stopIndex) }),
      let projection = track.project(fix) else { alongTrack = nil; return }
    let from = track.stopsAlong[anchor], to = track.stopsAlong[anchor + 1], delta = projection.along - prior.along
    guard delta >= -max(3,fix.horizontalAccuracyMeters),
      delta <= 40 * (fix.observedAt - prior.at) + prior.accuracy + fix.horizontalAccuracyMeters,
      projection.along >= from - 75, projection.along < to - fix.horizontalAccuracyMeters else { alongTrack = nil; return }
    alongTrack = (fix.observedAt,projection.along,fix.horizontalAccuracyMeters)
    guard projection.along - from > max(30,2 * fix.horizontalAccuracyMeters),
      projection.along - from >= 2 * (fix.observedAt - confirmedAt), to > from else { return }
    passengerSegment = .init(from:anchor,progress:(projection.along-from)/(to-from),point:projection.point,
      observedAt:fix.observedAt,validUntil:min(expiresAt,fix.observedAt+15,confirmedAt+90),confirmedAt:confirmedAt)
  }

  mutating func tick(now: Double) {
    guard !terminated, now.isFinite, lastNow.map({ now >= $0 }) ?? true else { return }
    lastNow = now
    if now >= expiresAt { stop(); return }
    if let at = platformFixAt, now - at >= 15 { platformFixAt = nil }
    if let until = snapshot.validUntil, now >= until { uncertain("SUBWAY_EVIDENCE_STALE", retainTrackChain:true) }
    if let prior = alongTrack, now - prior.at > 15 { alongTrack = nil }
    if let segment = passengerSegment, now >= segment.validUntil { passengerSegment = nil }
  }
  mutating func stop() { terminated = true; platformFixAt = nil; resetCandidate(); association = nil; confirmedIndex = nil; uncertain("SUBWAY_SESSION_STOPPED"); snapshot.phase = "STOPPED"; snapshot.lastConfirmedStopIndex = nil; snapshot.lastConfirmedAt = nil }
  private mutating func resetCandidate() { candidate = nil; candidateSource = nil; waitStarted = nil; waitCount = 0; departedAt = nil }
  private mutating func uncertain(_ reason: String, retainTrackChain: Bool = false) {
    passengerSegment = nil
    if !retainTrackChain { alongTrack = nil }
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

/// Ephemeral subway exit evidence. A train at the destination station is only an
/// anchor: continuous passenger GPS on the owned final walking path is required
/// before the existing final-walk reducer may start. No train/GPS history is saved.
struct NoLateJourneySubwaySeparationCore: Sendable {
  typealias E = NoLateJourneyEngineCore
  typealias Snapshot = NoLateJourneyBusSeparationCore.Snapshot
  let route: NoLateJourneySubwayRideCore.Route
  let walk: NoLateJourneyFinalWalkCore.Route
  private(set) var snapshot = Snapshot()
  private var lastSequence: Int64 = -1
  private var lastNow = 0.0
  private var anchorUntil: Double?
  private var firstAt: Double?
  private var firstAlong: Double?
  private var lastAt: Double?
  private var lastAlong: Double?
  private var lastCoordinate: E.Coordinate?
  private var countedAlong: Double?
  private var stopped = false

  init(route: NoLateJourneySubwayRideCore.Route, walk: NoLateJourneyFinalWalkCore.Route) {
    self.route = route; self.walk = walk
  }

  mutating func ingest(_ fix:E.Observation, subway:NoLateJourneySubwayRideCore.Snapshot?, now:Double) {
    guard !stopped, now.isFinite, now >= lastNow,
      fix.identity == route.identity, fix.identity == walk.identity,
      fix.sequence > lastSequence, fix.sequence < Int64.max else { return }
    tick(now:now); lastSequence = fix.sequence
    if snapshot.status == "SEPARATION_OBSERVED" { return }
    guard let target = route.stations.last?.coordinate,
      fix.source == .realLocation, fix.observedAt.isFinite,
      fix.observedAt >= now - 8, fix.observedAt <= now,
      fix.horizontalAccuracyMeters.isFinite, (0...15).contains(fix.horizontalAccuracyMeters),
      fix.coordinate.latitude.isFinite, (-90...90).contains(fix.coordinate.latitude),
      fix.coordinate.longitude.isFinite, (-180...180).contains(fix.coordinate.longitude),
      let projection = E.project(fix.coordinate,onto:walk.path),
      projection.crossTrackMeters + fix.horizontalAccuracyMeters <= 25,
      projection.alongRouteMeters <= 65 else { reset("PASSENGER_EXIT_LOCATION_UNRELIABLE"); return }
    let along = projection.alongRouteMeters
    if anchorUntil == nil {
      guard let subway, subway.phase == "RIDING", subway.boardingConfirmed,
        subway.currentStopIndex == route.stations.count - 1,
        let at = subway.observedAt, at == fix.observedAt,
        let until = subway.validUntil, now < until, until <= at + 15,
        NoLateJourneySubwayRideCore.distance(target,fix.coordinate) + fix.horizontalAccuracyMeters <= 50,
        along <= 15 else { reset("CONFIRMED_TARGET_SUBWAY_RIDE_REQUIRED"); return }
      anchorUntil = now + 90
      firstAt = fix.observedAt; firstAlong = along
      lastAt = fix.observedAt; lastAlong = along; lastCoordinate = fix.coordinate; countedAlong = along
      snapshot.status = "COLLECTING"; snapshot.reason = "CONTINUOUS_STATION_EXIT_REQUIRED"
      snapshot.evidenceCount = 1; snapshot.validUntil = min(until,now + 15)
      return
    }
    guard let anchorUntil, now < anchorUntil,
      let lastAt, let lastAlong, let lastCoordinate,
      fix.observedAt > lastAt, fix.observedAt - lastAt <= 8,
      along >= lastAlong - 5,
      NoLateJourneySubwayRideCore.distance(lastCoordinate,fix.coordinate) <= 25,
      NoLateJourneySubwayRideCore.distance(lastCoordinate,fix.coordinate) / (fix.observedAt - lastAt) <= 3,
      NoLateJourneySubwayRideCore.distance(target,fix.coordinate) <= 85 else {
      reset("PASSENGER_EXIT_MOVEMENT_UNRELIABLE"); return
    }
    self.lastAt = fix.observedAt; self.lastAlong = along; self.lastCoordinate = fix.coordinate
    if along - (countedAlong ?? along) >= 6 {
      countedAlong = along; snapshot.evidenceCount = min(1000,snapshot.evidenceCount + 1)
    }
    if snapshot.evidenceCount >= 3,
      fix.observedAt - (firstAt ?? fix.observedAt) >= 8,
      along - (firstAlong ?? along) - fix.horizontalAccuracyMeters >= 16 {
      snapshot.status = "SEPARATION_OBSERVED"
      snapshot.reason = "CONFIRMED_SUBWAY_EXIT_ON_WALK_PATH"
      snapshot.validUntil = min(anchorUntil,fix.observedAt + 15)
    } else {
      snapshot.status = "COLLECTING"
      snapshot.reason = "CONTINUOUS_STATION_EXIT_REQUIRED"
      snapshot.validUntil = min(anchorUntil,fix.observedAt + 15)
    }
  }

  mutating func tick(now:Double) {
    guard !stopped, now.isFinite, now >= lastNow else { return }
    lastNow = now
    if let until = snapshot.validUntil, now >= until { reset("SUBWAY_EXIT_EVIDENCE_STALE") }
    if let until = anchorUntil, now >= until { reset("SUBWAY_EXIT_WINDOW_EXPIRED") }
  }
  mutating func stop() { stopped = true; reset("SUBWAY_SESSION_STOPPED") }
  private mutating func reset(_ reason:String) {
    anchorUntil = nil; firstAt = nil; firstAlong = nil; lastAt = nil; lastAlong = nil
    lastCoordinate = nil; countedAlong = nil
    snapshot = Snapshot(status:"UNAVAILABLE",reason:reason,evidenceCount:0,validUntil:nil)
  }
}
