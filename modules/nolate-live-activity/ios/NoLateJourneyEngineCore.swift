import Foundation

/// P1-1 automatic-departure experiment only. No networking, location manager, UI, or boarding inference.
struct NoLateJourneyEngineCore: Sendable {
  struct Identity: Codable, Equatable, Sendable {
    let sessionId: String
    let generation: Int64
    let routeRevision: Int64
    let epoch: Int64
  }

  struct Coordinate: Codable, Equatable, Sendable {
    let latitude: Double
    let longitude: Double
  }

  enum GeometryProvenance: String, Codable, Sendable {
    case verifiedWalkingPath = "VERIFIED_WALKING_PATH"
    case syntheticReplay = "SYNTHETIC_REPLAY"
  }

  enum InputSource: String, Codable, Sendable {
    case realLocation = "REAL_LOCATION"
    case replay = "REPLAY"
  }

  struct Route: Codable, Equatable, Sendable {
    let coordinates: [Coordinate]
    let provenance: GeometryProvenance
  }

  struct Observation: Codable, Equatable, Sendable {
    let identity: Identity
    let sequence: Int64
    let observedAt: TimeInterval
    let coordinate: Coordinate
    let horizontalAccuracyMeters: Double
    let source: InputSource
  }

  struct Policy: Codable, Equatable, Sendable {
    var minimumDepartureMeters: Double = 70
    var minimumEvidenceCount: Int = 3
    var minimumEvidenceDurationSeconds: TimeInterval = 8
    var originAnchorRadiusMeters: Double = 35
    var maximumAccuracyMeters: Double = 35
    var corridorRadiusMeters: Double = 40
    var maximumObservationAgeSeconds: TimeInterval = 15
    var futureToleranceSeconds: TimeInterval = 2
    var maximumObservationGapSeconds: TimeInterval = 20
    var maximumStationarySeconds: TimeInterval = 12
    var minimumForwardStepMeters: Double = 8
    var reverseToleranceMeters: Double = 5
    var maximumJumpMeters: Double = 120
    var maximumSpeedMetersPerSecond: Double = 12
  }

  enum Status: String, Codable, Sendable {
    case armed = "ARMED", active = "ACTIVE", stopped = "STOPPED", expired = "EXPIRED"
    var isTerminal: Bool { self == .stopped || self == .expired }
  }

  enum Quality: String, Codable, Sendable {
    case good = "GOOD", uncertain = "UNCERTAIN", unavailable = "UNAVAILABLE"
  }

  enum Reason: String, Codable, Sendable {
    case awaitingOrigin = "AWAITING_ORIGIN"
    case originAnchored = "ORIGIN_ANCHORED"
    case accumulatingMovement = "ACCUMULATING_MOVEMENT"
    case departureDetected = "DEPARTURE_DETECTED"
    case tracking = "TRACKING"
    case stopped = "STOPPED"
    case destinationArrived = "DESTINATION_ARRIVED"
    case expired = "EXPIRED"
    case restoredNeedsFreshLocation = "RESTORED_NEEDS_FRESH_LOCATION"
    case invalidCoordinate = "INVALID_COORDINATE"
    case invalidTimestamp = "INVALID_TIMESTAMP"
    case invalidAccuracy = "INVALID_ACCURACY"
    case lowAccuracy = "LOW_ACCURACY"
    case staleObservation = "STALE_OBSERVATION"
    case futureObservation = "FUTURE_OBSERVATION"
    case outOfOrderObservation = "OUT_OF_ORDER_OBSERVATION"
    case sourceMismatch = "SOURCE_MISMATCH"
    case offRoute = "OFF_ROUTE"
    case gpsJump = "GPS_JUMP"
    case reverseMovement = "REVERSE_MOVEMENT"
    case stationary = "STATIONARY"
    case observationGap = "OBSERVATION_GAP"
    case noOriginAnchor = "NO_ORIGIN_ANCHOR"
    case clockRegression = "CLOCK_REGRESSION"
  }

  struct Projection: Codable, Equatable, Sendable {
    let alongRouteMeters: Double
    let crossTrackMeters: Double
    let routeLengthMeters: Double
    let segmentIndex: Int
  }

  struct Snapshot: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let identity: Identity
    let route: Route
    let policy: Policy
    let armedAt: TimeInterval
    let expiresAt: TimeInterval
    var status: Status
    var quality: Quality
    var reason: Reason
    var sequence: Int64
    var lastObservationSequence: Int64?
    var lastObservationAt: TimeInterval?
    var lastEvaluationAt: TimeInterval
    var inputSource: InputSource?
    var alongRouteMeters: Double?
    var crossTrackMeters: Double?
    var evidenceCount: Int
    var departureEventKey: String?
  }

  enum EventType: String, Codable, Sendable {
    case departed = "DEPARTED", stopped = "STOPPED", expired = "EXPIRED"
  }

  struct Event: Codable, Equatable, Sendable {
    let type: EventType
    let eventKey: String
    let identity: Identity
    let sequence: Int64
    let observedAt: TimeInterval
    let inputSource: InputSource?
  }

  enum ValidationError: Error, Equatable {
    case invalidIdentity, invalidRoute, invalidPolicy, invalidLifetime, invalidSnapshot
  }

  private struct Chain: Sendable {
    var coordinate: Coordinate
    var accuracyMeters: Double
    var observedAt: TimeInterval
    var alongRouteMeters: Double
    var movementOriginMeters: Double
    var movementStartedAt: TimeInterval?
    var evidenceAlongMeters: Double
    var lastEvidenceAt: TimeInterval
  }

  private var state: Snapshot
  private var chain: Chain?
  var snapshot: Snapshot { state }

  init(identity: Identity, route: Route, policy: Policy = Policy(), armedAt: TimeInterval, expiresAt: TimeInterval) throws {
    try Self.validate(identity: identity, route: route, policy: policy, armedAt: armedAt, expiresAt: expiresAt)
    state = Snapshot(
      schemaVersion: 1, identity: identity, route: route, policy: policy,
      armedAt: armedAt, expiresAt: expiresAt, status: .armed, quality: .unavailable,
      reason: .awaitingOrigin, sequence: 0, lastObservationSequence: nil,
      lastObservationAt: nil, lastEvaluationAt: armedAt, inputSource: nil,
      alongRouteMeters: nil, crossTrackMeters: nil, evidenceCount: 0, departureEventKey: nil
    )
  }

  /// Persist only Snapshot. A restore never trusts an old movement chain or emits departure again.
  init(restoring snapshot: Snapshot, now: TimeInterval) throws {
    try Self.validate(identity: snapshot.identity, route: snapshot.route, policy: snapshot.policy,
                      armedAt: snapshot.armedAt, expiresAt: snapshot.expiresAt)
    guard snapshot.schemaVersion == 1, now.isFinite, now >= snapshot.armedAt,
          snapshot.sequence >= 0, snapshot.sequence < Int64.max - 1,
          snapshot.lastObservationSequence.map({ $0 >= 0 && $0 < Int64.max }) ?? true,
          snapshot.lastEvaluationAt.isFinite, snapshot.lastEvaluationAt >= snapshot.armedAt,
          snapshot.lastEvaluationAt <= now + snapshot.policy.futureToleranceSeconds,
          snapshot.status.isTerminal || snapshot.lastEvaluationAt < snapshot.expiresAt,
          snapshot.inputSource == nil
            || (snapshot.route.provenance == .syntheticReplay && snapshot.inputSource == .replay)
            || (snapshot.route.provenance == .verifiedWalkingPath && snapshot.inputSource == .realLocation),
          snapshot.departureEventKey == nil || snapshot.departureEventKey == Self.eventKey(.departed, snapshot.identity),
          snapshot.status != .active || (snapshot.departureEventKey != nil && snapshot.inputSource != nil),
          snapshot.status != .armed || snapshot.departureEventKey == nil else {
      throw ValidationError.invalidSnapshot
    }
    state = snapshot
    state.evidenceCount = 0
    state.lastObservationAt = nil
    state.alongRouteMeters = nil
    state.crossTrackMeters = nil
    state.lastEvaluationAt = max(snapshot.lastEvaluationAt, now)
    // Restoring resets quality/freshness even when lifecycle status remains unchanged.
    state.sequence += 1
    if !state.status.isTerminal {
      state.quality = .unavailable
      state.reason = .restoredNeedsFreshLocation
      if now >= state.expiresAt {
        state.status = .expired
        state.reason = .expired
        state.sequence += 1
      }
    }
  }

  mutating func ingest(_ observation: Observation, now: TimeInterval) -> [Event] {
    guard !state.status.isTerminal else { return [] }
    // Foreign identities and duplicate sequences have no right to mutate this session.
    guard observation.identity == state.identity, observation.sequence >= 0,
          (observation.sequence < Int64.max),
          (observation.sequence > (state.lastObservationSequence ?? -1)) else { return [] }
    let expiryEvents = tick(now: now)
    guard !state.status.isTerminal else { return expiryEvents }
    guard now.isFinite, now >= state.lastEvaluationAt else { return [] }
    state.lastObservationSequence = observation.sequence
    advanceSequence()
    guard Self.valid(observation.coordinate) else { return reject(.invalidCoordinate) }
    guard observation.observedAt.isFinite else { return reject(.invalidTimestamp) }
    guard observation.horizontalAccuracyMeters.isFinite, observation.horizontalAccuracyMeters >= 0 else {
      return reject(.invalidAccuracy)
    }
    guard observation.horizontalAccuracyMeters <= state.policy.maximumAccuracyMeters else { return reject(.lowAccuracy) }
    guard (state.route.provenance == .syntheticReplay && observation.source == .replay)
      || (state.route.provenance == .verifiedWalkingPath && observation.source == .realLocation) else {
      return reject(.sourceMismatch)
    }
    guard observation.observedAt >= state.armedAt,
          now - observation.observedAt <= state.policy.maximumObservationAgeSeconds else { return reject(.staleObservation) }
    guard observation.observedAt <= now + state.policy.futureToleranceSeconds else { return reject(.futureObservation) }
    if let previousAt = state.lastObservationAt, observation.observedAt <= previousAt {
      return reject(.outOfOrderObservation)
    }
    guard let projection = Self.project(observation.coordinate, onto: state.route) else { return reject(.invalidCoordinate) }
    guard projection.crossTrackMeters <= state.policy.corridorRadiusMeters else { return reject(.offRoute) }

    if let previous = chain {
      let elapsed = observation.observedAt - previous.observedAt
      guard elapsed <= state.policy.maximumObservationGapSeconds else { return reject(.observationGap) }
      let displacement = Self.distance(previous.coordinate, observation.coordinate)
      // Do not mistake a quantized GPS fix for impossible speed when both fixes' accuracy
      // radii overlap. The separate absolute jump limit still rejects large relocations.
      let minimumDisplacement = max(0, displacement - previous.accuracyMeters - observation.horizontalAccuracyMeters)
      guard elapsed > 0, displacement <= state.policy.maximumJumpMeters,
            minimumDisplacement / elapsed <= state.policy.maximumSpeedMetersPerSecond else { return reject(.gpsJump) }
      guard projection.alongRouteMeters >= previous.alongRouteMeters - state.policy.reverseToleranceMeters else {
        return reject(.reverseMovement)
      }
    }

    state.inputSource = observation.source
    state.lastObservationAt = observation.observedAt
    state.alongRouteMeters = projection.alongRouteMeters
    state.crossTrackMeters = projection.crossTrackMeters
    if state.status == .active {
      state.quality = .good
      state.reason = .tracking
      chain = Self.chain(observation, projection)
      return []
    }

    guard var previous = chain else {
      guard projection.alongRouteMeters <= state.policy.originAnchorRadiusMeters,
            Self.distance(state.route.coordinates[0], observation.coordinate) <= state.policy.originAnchorRadiusMeters else {
        return reject(.noOriginAnchor)
      }
      chain = Self.chain(observation, projection)
      state.quality = .good
      state.reason = .originAnchored
      return []
    }

    let forwardStep = projection.alongRouteMeters - previous.evidenceAlongMeters
    if forwardStep < state.policy.minimumForwardStepMeters {
      // Frequent small GPS steps may accumulate into one evidence step. Stationary callbacks
      // never add evidence, but must not erase movement merely because GPS reports at 1 Hz.
      if observation.observedAt - previous.lastEvidenceAt > state.policy.maximumStationarySeconds {
        previous.movementOriginMeters = projection.alongRouteMeters
        previous.evidenceAlongMeters = projection.alongRouteMeters
        previous.movementStartedAt = nil
        previous.lastEvidenceAt = observation.observedAt
        state.evidenceCount = 0
      }
      state.quality = .uncertain
      state.reason = .stationary
    } else {
      if previous.movementStartedAt == nil { previous.movementStartedAt = observation.observedAt }
      previous.evidenceAlongMeters = projection.alongRouteMeters
      previous.lastEvidenceAt = observation.observedAt
      state.evidenceCount += 1
      state.quality = .good
      state.reason = .accumulatingMovement
    }
    previous.coordinate = observation.coordinate
    previous.accuracyMeters = observation.horizontalAccuracyMeters
    previous.observedAt = observation.observedAt
    previous.alongRouteMeters = projection.alongRouteMeters
    chain = previous
    if let movementStartedAt = previous.movementStartedAt,
       projection.alongRouteMeters - previous.movementOriginMeters >= state.policy.minimumDepartureMeters,
       state.evidenceCount >= state.policy.minimumEvidenceCount,
       observation.observedAt - movementStartedAt >= state.policy.minimumEvidenceDurationSeconds {
      state.status = .active
      state.reason = .departureDetected
      state.departureEventKey = Self.eventKey(.departed, state.identity)
      return [event(.departed, observedAt: observation.observedAt)]
    }
    return []
  }

  mutating func tick(now: TimeInterval) -> [Event] {
    guard !state.status.isTerminal else { return [] }
    guard now.isFinite, now >= state.lastEvaluationAt else {
      return reject(.clockRegression)
    }
    if state.lastEvaluationAt != now {
      state.lastEvaluationAt = now
      advanceSequence()
    }
    if now >= state.expiresAt {
      state.status = .expired
      state.quality = .unavailable
      state.reason = .expired
      state.evidenceCount = 0
      chain = nil
      advanceSequence()
      return [event(.expired, observedAt: now)]
    }
    if let previousAt = state.lastObservationAt,
       now - previousAt > state.policy.maximumObservationAgeSeconds {
      return reject(.staleObservation)
    }
    return []
  }

  mutating func stop(now: TimeInterval) -> [Event] {
    guard !state.status.isTerminal, now.isFinite else { return [] }
    // User cancellation must work even after the wall clock is adjusted backwards.
    let effectiveNow = max(now, state.lastEvaluationAt)
    if effectiveNow >= state.expiresAt { return tick(now: effectiveNow) }
    state.status = .stopped
    state.quality = .unavailable
    state.reason = .stopped
    state.evidenceCount = 0
    state.lastEvaluationAt = effectiveNow
    chain = nil
    advanceSequence()
    return [event(.stopped, observedAt: effectiveNow)]
  }

  /// Same terminal STOPPED contract and idempotent cleanup as cancellation. This does
  /// not complete a business schedule or create a second departure/server event.
  mutating func finishNavigation(now: TimeInterval) {
    guard state.status == .active else { return }
    _ = stop(now: now)
    if state.status == .stopped { state.reason = .destinationArrived }
  }

  /// Local equirectangular segment projection; distances use a spherical haversine metric.
  /// Route provenance is supplied by the validated route adapter, never inferred from two points.
  static func project(_ coordinate: Coordinate, onto route: Route) -> Projection? {
    guard valid(coordinate), route.coordinates.count >= 2, route.coordinates.allSatisfy(valid) else { return nil }
    var cumulative = 0.0
    var best: (Double, Double, Int)?
    for index in 0..<(route.coordinates.count - 1) {
      let start = route.coordinates[index]
      let end = route.coordinates[index + 1]
      let length = distance(start, end)
      defer { cumulative += length }
      guard length > 0.01 else { continue }
      let radians = Double.pi / 180
      let scale = cos((start.latitude + end.latitude) * 0.5 * radians)
      let dx = wrappedLongitude(end.longitude - start.longitude) * scale
      let dy = end.latitude - start.latitude
      let px = wrappedLongitude(coordinate.longitude - start.longitude) * scale
      let py = coordinate.latitude - start.latitude
      let denominator = dx * dx + dy * dy
      guard denominator > 0 else { continue }
      let fraction = min(1, max(0, (px * dx + py * dy) / denominator))
      let projected = Coordinate(latitude: start.latitude + dy * fraction,
                                 longitude: wrappedLongitude(start.longitude + wrappedLongitude(end.longitude - start.longitude) * fraction))
      let crossTrack = distance(coordinate, projected)
      if best == nil || crossTrack < best!.0 {
        best = (crossTrack, cumulative + length * fraction, index)
      }
    }
    guard let best else { return nil }
    return Projection(alongRouteMeters: best.1, crossTrackMeters: best.0, routeLengthMeters: cumulative, segmentIndex: best.2)
  }

  private mutating func reject(_ reason: Reason) -> [Event] {
    if state.quality != .uncertain || state.reason != reason || state.evidenceCount != 0 {
      advanceSequence()
    }
    state.quality = .uncertain
    state.reason = reason
    state.evidenceCount = 0
    chain = nil
    return []
  }

  private mutating func advanceSequence() {
    // The finite session and input fence make reaching this bound unrealistic; never trap on overflow.
    if state.sequence < Int64.max { state.sequence += 1 }
  }

  private func event(_ type: EventType, observedAt: TimeInterval) -> Event {
    Event(type: type, eventKey: Self.eventKey(type, state.identity), identity: state.identity,
          sequence: state.sequence, observedAt: observedAt, inputSource: state.inputSource)
  }

  private static func eventKey(_ type: EventType, _ identity: Identity) -> String {
    "journey:\(identity.sessionId):\(identity.epoch):\(identity.generation):\(identity.routeRevision):\(type.rawValue)"
  }

  private static func chain(_ observation: Observation, _ projection: Projection) -> Chain {
    Chain(coordinate: observation.coordinate, accuracyMeters: observation.horizontalAccuracyMeters, observedAt: observation.observedAt,
          alongRouteMeters: projection.alongRouteMeters, movementOriginMeters: projection.alongRouteMeters,
          movementStartedAt: nil, evidenceAlongMeters: projection.alongRouteMeters,
          lastEvidenceAt: observation.observedAt)
  }

  private static func valid(_ coordinate: Coordinate) -> Bool {
    coordinate.latitude.isFinite && coordinate.longitude.isFinite
      && abs(coordinate.latitude) <= 90 && abs(coordinate.longitude) <= 180
  }

  private static func wrappedLongitude(_ value: Double) -> Double {
    let remainder = value.truncatingRemainder(dividingBy: 360)
    return remainder > 180 ? remainder - 360 : (remainder < -180 ? remainder + 360 : remainder)
  }

  private static func distance(_ lhs: Coordinate, _ rhs: Coordinate) -> Double {
    let radians = Double.pi / 180
    let dLatitude = (rhs.latitude - lhs.latitude) * radians
    let dLongitude = wrappedLongitude(rhs.longitude - lhs.longitude) * radians
    let a = pow(sin(dLatitude / 2), 2) + cos(lhs.latitude * radians) * cos(rhs.latitude * radians) * pow(sin(dLongitude / 2), 2)
    return 6_371_000 * 2 * asin(sqrt(min(1, max(0, a))))
  }

  private static func validate(identity: Identity, route: Route, policy: Policy, armedAt: TimeInterval, expiresAt: TimeInterval) throws {
    guard !identity.sessionId.isEmpty, identity.sessionId.utf8.count <= 128,
          identity.sessionId.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 95 }),
          identity.generation >= 0, identity.routeRevision >= 0, identity.epoch >= 0 else { throw ValidationError.invalidIdentity }
    let positive = [policy.minimumDepartureMeters, policy.minimumEvidenceDurationSeconds, policy.originAnchorRadiusMeters,
                    policy.maximumAccuracyMeters, policy.corridorRadiusMeters, policy.maximumObservationAgeSeconds,
                    policy.maximumObservationGapSeconds, policy.maximumStationarySeconds, policy.minimumForwardStepMeters,
                    policy.maximumJumpMeters, policy.maximumSpeedMetersPerSecond]
    guard positive.allSatisfy({ $0.isFinite && $0 > 0 }), policy.minimumEvidenceCount >= 2,
          policy.futureToleranceSeconds.isFinite, policy.futureToleranceSeconds >= 0,
          policy.reverseToleranceMeters.isFinite, policy.reverseToleranceMeters >= 0,
          policy.minimumForwardStepMeters < policy.minimumDepartureMeters,
          policy.originAnchorRadiusMeters < policy.minimumDepartureMeters else { throw ValidationError.invalidPolicy }
    guard armedAt.isFinite, expiresAt.isFinite, expiresAt > armedAt else { throw ValidationError.invalidLifetime }
    guard (2...10_000).contains(route.coordinates.count), route.coordinates.allSatisfy(valid),
          let projection = project(route.coordinates[0], onto: route),
          projection.routeLengthMeters >= policy.minimumDepartureMeters,
          projection.routeLengthMeters <= 100_000 else { throw ValidationError.invalidRoute }
  }
}
