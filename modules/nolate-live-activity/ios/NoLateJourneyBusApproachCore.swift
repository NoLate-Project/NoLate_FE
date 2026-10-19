import Foundation

/// P2-1 location-only evidence. There is deliberately no RIDING state or boarding confirmation.
struct NoLateJourneyBusApproachCore: Sendable {
  typealias Engine = NoLateJourneyEngineCore
  typealias Coordinate = Engine.Coordinate
  enum Phase: String, Codable, Sendable {
    case walkingToStop = "WALKING_TO_STOP", approachingStop = "APPROACHING_STOP", waiting = "WAITING"
    case boardingCandidate = "BOARDING_CANDIDATE", unavailable = "UNAVAILABLE"
  }
  enum Provenance: String, Codable, Sendable { case providerShape = "VERIFIED_BUS_PATH", syntheticReplay = "SYNTHETIC_REPLAY" }
  struct Route: Codable, Equatable, Sendable {
    let legIndex: Int
    let boardingCoordinate: Coordinate
    let walkingCoordinates: [Coordinate]
    let coordinates: [Coordinate]
    let provenance: Provenance
  }
  struct Policy: Codable, Equatable, Sendable {
    var approachRadiusMeters = 80.0
    var approachExitRadiusMeters = 100.0
    var waitRadiusMeters = 25.0
    var waitExitRadiusMeters = 45.0
    var dwellSeconds = 12.0
    var minimumDwellObservations = 3
    var maximumDwellSpeed = 1.0
    var maximumDwellDisplacementMeters = 12.0
    var minimumVehicleSpeed = 4.0
    var minimumSpeedWindowSeconds = 4.0
    // Immutable ambiguity budget, deliberately not a new persisted-policy schema field.
    var maximumSpeedWindowSeconds: Double { 12.0 }
    var minimumBoardingMeters = 70.0
    var minimumBoardingSeconds = 12.0
    var minimumBoardingObservations = 3
    var maximumAccuracyMeters = 25.0
    var maximumAgeSeconds = 15.0
    var maximumGapSeconds = 20.0
    var maximumJumpMeters = 180.0
    var maximumSpeed = 25.0
    var corridorMeters = 35.0
    var reverseToleranceMeters = 8.0
  }
  struct Snapshot: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let identity: Engine.Identity
    let route: Route
    let policy: Policy
    let armedAt: TimeInterval
    let expiresAt: TimeInterval
    var phase: Phase
    var quality: Engine.Quality
    var reason: String
    var sequence: Int64
    var lastObservationSequence: Int64?
    var lastObservationAt: TimeInterval?
    var lastEvaluationAt: TimeInterval
    var distanceToBoardMeters: Double?
    var alongRouteMeters: Double?
    var walkingProgress: Double? = nil
    var boardingEvidenceCount: Int
    var terminated: Bool
    // Never inferred from GPS, speed, dwell, route ID, elapsed time, or restore.
    let boardingConfirmed: Bool
  }
  enum Failure: Error { case invalidConfiguration, invalidSnapshot }
  private struct Last: Sendable {
    let coordinate: Coordinate
    let accuracy: Double
    let observedAt: TimeInterval
    let walkingAlong: Double
    let busAlong: Double?
  }
  private var state: Snapshot
  private var last: Last?
  private var dwellAnchor: Coordinate?
  private var dwellStartedAt: TimeInterval?
  private var dwellObservations = 0
  private var waitingQualified = false
  private var boardingAnchorAlong: Double?
  private var boardingStartedAt: TimeInterval?
  private var movementSample: Last?
  var snapshot: Snapshot { state }

  init(identity: Engine.Identity, route: Route, policy: Policy = .init(), armedAt: TimeInterval, expiresAt: TimeInterval) throws {
    let values = [policy.approachRadiusMeters, policy.approachExitRadiusMeters, policy.waitRadiusMeters,
      policy.waitExitRadiusMeters, policy.dwellSeconds, policy.maximumDwellSpeed, policy.maximumDwellDisplacementMeters,
      policy.minimumVehicleSpeed, policy.minimumSpeedWindowSeconds, policy.minimumBoardingMeters, policy.minimumBoardingSeconds,
      policy.maximumAccuracyMeters, policy.maximumAgeSeconds, policy.maximumGapSeconds, policy.maximumJumpMeters,
      policy.maximumSpeed, policy.corridorMeters, policy.reverseToleranceMeters]
    guard (1...29).contains(route.legIndex), route.legIndex % 2 == 1, (2...2_000).contains(route.coordinates.count),
          (2...2_000).contains(route.walkingCoordinates.count), valid(route.boardingCoordinate),
          route.coordinates.allSatisfy(valid), route.walkingCoordinates.allSatisfy(valid),
          distance(route.boardingCoordinate, route.coordinates[0]) <= 75,
          distance(route.boardingCoordinate, route.walkingCoordinates.last!) <= 75,
          let projection = project(route.boardingCoordinate, coordinates: route.coordinates),
          projection.routeLengthMeters > 0,
          values.allSatisfy({ $0.isFinite && $0 > 0 }),
          policy.waitRadiusMeters < policy.waitExitRadiusMeters,
          policy.waitExitRadiusMeters < policy.approachRadiusMeters,
          policy.approachRadiusMeters < policy.approachExitRadiusMeters,
          policy.maximumDwellSpeed < policy.minimumVehicleSpeed, policy.minimumVehicleSpeed < policy.maximumSpeed,
          policy.minimumSpeedWindowSeconds <= policy.minimumBoardingSeconds,
          policy.minimumSpeedWindowSeconds <= policy.maximumSpeedWindowSeconds,
          (3...1_000).contains(policy.minimumDwellObservations), (3...1_000).contains(policy.minimumBoardingObservations),
          armedAt.isFinite, expiresAt.isFinite, expiresAt > armedAt else { throw Failure.invalidConfiguration }
    state = Snapshot(schemaVersion: 1, identity: identity, route: route, policy: policy, armedAt: armedAt, expiresAt: expiresAt,
      phase: .walkingToStop, quality: .unavailable, reason: "AWAITING_AUTOMATIC_DEPARTURE", sequence: 0,
      lastObservationSequence: nil, lastObservationAt: nil, lastEvaluationAt: armedAt,
      distanceToBoardMeters: nil, alongRouteMeters: nil, boardingEvidenceCount: 0, terminated: false, boardingConfirmed: false)
  }

  init(restoring snapshot: Snapshot, now: TimeInterval) throws {
    try self.init(identity: snapshot.identity, route: snapshot.route, policy: snapshot.policy,
                  armedAt: snapshot.armedAt, expiresAt: snapshot.expiresAt)
    guard snapshot.schemaVersion == 1, !snapshot.boardingConfirmed,
          now.isFinite, now >= snapshot.armedAt, snapshot.lastEvaluationAt.isFinite,
          snapshot.lastEvaluationAt >= snapshot.armedAt, snapshot.lastEvaluationAt <= now,
          snapshot.sequence >= 0, snapshot.sequence < Int64.max - 1,
          snapshot.lastObservationSequence.map({ $0 >= 0 && $0 < Int64.max }) ?? true,
          snapshot.lastObservationAt.map({ $0.isFinite && $0 >= snapshot.armedAt && $0 <= now + 2 }) ?? true,
          (0...1_000).contains(snapshot.boardingEvidenceCount) else { throw Failure.invalidSnapshot }
    state = snapshot
    advanceSequence()
    state.lastObservationAt = nil
    state.lastEvaluationAt = now
    clearEvidence()
    state.distanceToBoardMeters = nil
    state.alongRouteMeters = nil
    state.phase = snapshot.terminated ? .unavailable : .walkingToStop
    state.quality = .unavailable
    state.reason = snapshot.terminated ? "BUS_SESSION_STOPPED" : "RESTORED_NEEDS_FRESH_LOCATION"
    if now >= state.expiresAt { stop(now: now, reason: "BUS_SESSION_EXPIRED") }
  }

  @discardableResult
  mutating func ingest(_ observation: Engine.Observation, now: TimeInterval) -> Bool {
    guard !state.terminated, observation.identity == state.identity,
          observation.sequence >= 0, (observation.sequence < Int64.max),
          observation.sequence > (state.lastObservationSequence ?? -1) else { return false }
    tick(now: now)
    guard !state.terminated, now.isFinite, now >= state.lastEvaluationAt else { return false }
    state.lastObservationSequence = observation.sequence
    advanceSequence()
    guard valid(observation.coordinate) else { return reject("BUS_COORDINATE_INVALID") }
    guard observation.horizontalAccuracyMeters.isFinite, observation.horizontalAccuracyMeters >= 0,
          observation.horizontalAccuracyMeters <= state.policy.maximumAccuracyMeters else { return reject("BUS_ACCURACY_UNRELIABLE") }
    guard observation.observedAt.isFinite, observation.observedAt >= state.armedAt,
          now - observation.observedAt <= state.policy.maximumAgeSeconds else { return reject("BUS_LOCATION_STALE") }
    guard observation.observedAt <= now + 2 else { return reject("BUS_LOCATION_FUTURE") }
    guard state.lastObservationAt.map({ observation.observedAt > $0 }) ?? true else { return reject("BUS_LOCATION_OUT_OF_ORDER") }
    guard (state.route.provenance == .syntheticReplay && observation.source == .replay)
      || (state.route.provenance == .providerShape && observation.source == .realLocation) else { return reject("BUS_SOURCE_MISMATCH") }
    guard let bus = project(observation.coordinate, coordinates: state.route.coordinates),
          let walk = project(observation.coordinate, coordinates: state.route.walkingCoordinates) else { return reject("BUS_PROJECTION_UNAVAILABLE") }
    guard (waitingQualified ? bus.crossTrackMeters : min(bus.crossTrackMeters, walk.crossTrackMeters)) <= state.policy.corridorMeters else {
      return reject("BUS_OFF_ROUTE")
    }
    let busAlong = bus.crossTrackMeters <= state.policy.corridorMeters ? bus.alongRouteMeters : nil
    var displacement = 0.0
    var speed = 0.0
    var minimumSpeed = 0.0
    if let last {
      let elapsed = observation.observedAt - last.observedAt
      guard elapsed > 0, elapsed <= state.policy.maximumGapSeconds else { return reject("BUS_LOCATION_GAP") }
      displacement = distance(last.coordinate, observation.coordinate)
      speed = displacement / elapsed
      minimumSpeed = max(0, displacement - last.accuracy - observation.horizontalAccuracyMeters) / elapsed
      guard displacement <= state.policy.maximumJumpMeters, minimumSpeed <= state.policy.maximumSpeed else { return reject("BUS_GPS_JUMP") }
      if let previousAlong = last.busAlong, let busAlong,
         busAlong < previousAlong - state.policy.reverseToleranceMeters { return reject("BUS_REVERSE_MOVEMENT") }
      if !waitingQualified, walk.alongRouteMeters < last.walkingAlong - state.policy.reverseToleranceMeters {
        return reject("BUS_REVERSE_MOVEMENT")
      }
    }
    let distanceToBoard = distance(observation.coordinate, state.route.boardingCoordinate)
    let previous = last
    last = Last(coordinate: observation.coordinate, accuracy: observation.horizontalAccuracyMeters,
                observedAt: observation.observedAt, walkingAlong: walk.alongRouteMeters, busAlong: busAlong)
    state.lastObservationAt = observation.observedAt
    state.distanceToBoardMeters = distanceToBoard
    state.alongRouteMeters = busAlong
    state.walkingProgress = walk.crossTrackMeters + observation.horizontalAccuracyMeters <= 25 && walk.routeLengthMeters > 0
      ? min(1,max(0,walk.alongRouteMeters / walk.routeLengthMeters)) : nil
    state.quality = .good

    if state.phase == .boardingCandidate {
      // Quality describes this observation, not whether the user boarded a particular vehicle.
      state.quality = .good
      state.reason = "BOARDING_CANDIDATE_VEHICLE_UNVERIFIED"
      return true
    }
    if distanceToBoard <= state.policy.waitRadiusMeters {
      if !waitingQualified {
        let stayed = dwellAnchor.map { distance($0, observation.coordinate) <= state.policy.maximumDwellDisplacementMeters } ?? false
        if dwellStartedAt == nil || !stayed || (previous != nil && speed > state.policy.maximumDwellSpeed) {
          dwellAnchor = observation.coordinate; dwellStartedAt = observation.observedAt; dwellObservations = 1
        } else { dwellObservations = min(1_000, dwellObservations + 1) }
        if let dwellStartedAt, observation.observedAt - dwellStartedAt >= state.policy.dwellSeconds,
           dwellObservations >= state.policy.minimumDwellObservations {
          waitingQualified = true
          boardingAnchorAlong = busAlong
          movementSample = last
          state.phase = .waiting
          state.reason = "STOP_DWELL_OBSERVED"
        } else {
          state.phase = .approachingStop
          state.reason = "STOP_DWELL_ACCUMULATING"
        }
      } else { state.phase = .waiting; state.reason = "WAITING_FOR_VEHICLE_EVIDENCE"; movementSample = last }
      state.boardingEvidenceCount = 0
      boardingStartedAt = nil
      return true
    }

    if waitingQualified {
      // Accuracy radii must be discounted over independent time windows, not every 1Hz GPS fix.
      // Otherwise valid 10m/s motion with 5m accuracy would incorrectly look stationary forever.
      let movementElapsed = movementSample.map { observation.observedAt - $0.observedAt } ?? 0
      if movementElapsed < state.policy.minimumSpeedWindowSeconds {
        state.phase = distanceToBoard <= state.policy.waitExitRadiusMeters ? .waiting : .unavailable
        state.reason = "BOARDING_EVIDENCE_ACCUMULATING"
        return true
      }
      guard movementElapsed <= state.policy.maximumSpeedWindowSeconds else {
        return reject("BOARDING_SPEED_WINDOW_TIMEOUT")
      }
      let movementDistance = movementSample.map { distance($0.coordinate, observation.coordinate) } ?? 0
      let accuracyRadius = (movementSample?.accuracy ?? 0) + observation.horizontalAccuracyMeters
      let movementSpeed = max(0, movementDistance - accuracyRadius) / movementElapsed
      let maximumMovementSpeed = (movementDistance + accuracyRadius) / movementElapsed
      if let movementSample, let busAlong, let previousAlong = movementSample.busAlong,
         busAlong > previousAlong, movementSpeed >= state.policy.minimumVehicleSpeed {
        if boardingStartedAt == nil { boardingStartedAt = movementSample.observedAt }
        self.movementSample = last
        state.boardingEvidenceCount = min(1_000, state.boardingEvidenceCount + 1)
        let progress = busAlong - (boardingAnchorAlong ?? busAlong)
        if let boardingStartedAt, progress >= state.policy.minimumBoardingMeters,
           state.boardingEvidenceCount >= state.policy.minimumBoardingObservations,
           observation.observedAt - boardingStartedAt >= state.policy.minimumBoardingSeconds,
           distanceToBoard > state.policy.waitExitRadiusMeters {
          state.phase = .boardingCandidate
          state.quality = .good
          state.reason = "BOARDING_CANDIDATE_VEHICLE_UNVERIFIED"
        } else {
          state.phase = distanceToBoard <= state.policy.waitExitRadiusMeters ? .waiting : .unavailable
          state.quality = .good
          state.reason = "BOARDING_EVIDENCE_ACCUMULATING"
        }
        return true
      }
      if maximumMovementSpeed >= state.policy.minimumVehicleSpeed {
        // The accuracy interval still admits vehicle-like motion. Insufficient evidence is not
        // proof of walking away: retain this independent window, but only for a bounded duration.
        guard movementElapsed < state.policy.maximumSpeedWindowSeconds else {
          return reject("BOARDING_SPEED_WINDOW_TIMEOUT")
        }
        state.phase = distanceToBoard <= state.policy.waitExitRadiusMeters ? .waiting : .unavailable
        state.reason = "BOARDING_SPEED_AMBIGUOUS"
        return true
      }
      boardingStartedAt = nil
      state.boardingEvidenceCount = 0
      movementSample = last
      if distanceToBoard <= state.policy.waitExitRadiusMeters {
        state.phase = .waiting
        state.reason = "WAITING_FOR_VEHICLE_EVIDENCE"
        return true
      }
      // Walking past/leaving the stop never preserves waiting evidence for a later speed burst.
      clearEvidence(keepLast: true)
      state.phase = .walkingToStop
      state.quality = .good
      state.reason = "LEFT_STOP_WITHOUT_VEHICLE_EVIDENCE"
      return true
    }
    dwellAnchor = nil; dwellStartedAt = nil; dwellObservations = 0
    let withinApproach = distanceToBoard <= state.policy.approachRadiusMeters
      || (state.phase == .approachingStop && distanceToBoard <= state.policy.approachExitRadiusMeters)
    state.phase = withinApproach ? .approachingStop : .walkingToStop
    state.reason = withinApproach ? "APPROACHING_BOARDING_STOP" : "WALKING_TO_BOARDING_STOP"
    return true
  }

  mutating func tick(now: TimeInterval) {
    guard !state.terminated else { return }
    guard now.isFinite, now >= state.lastEvaluationAt else {
      stop(now: state.lastEvaluationAt, reason: "BUS_CLOCK_REGRESSION")
      state.quality = .uncertain
      return
    }
    if state.lastEvaluationAt != now { state.lastEvaluationAt = now; advanceSequence() }
    if now >= state.expiresAt { stop(now: now, reason: "BUS_SESSION_EXPIRED"); return }
    if let observedAt = state.lastObservationAt, now - observedAt > state.policy.maximumAgeSeconds {
      _ = reject("BUS_LOCATION_STALE")
    } else if waitingQualified, state.phase != .boardingCandidate, let movementSample,
              (state.distanceToBoardMeters ?? 0) > state.policy.waitRadiusMeters,
              now - movementSample.observedAt > state.policy.maximumSpeedWindowSeconds {
      _ = reject("BOARDING_SPEED_WINDOW_TIMEOUT")
    }
  }

  mutating func stop(now: TimeInterval, reason: String = "BUS_SESSION_STOPPED") {
    guard !state.terminated else { return }
    state.terminated = true
    state.phase = .unavailable
    state.quality = .unavailable
    state.reason = reason
    if now.isFinite { state.lastEvaluationAt = max(state.lastEvaluationAt, now) }
    state.distanceToBoardMeters = nil
    state.alongRouteMeters = nil
    clearEvidence()
    advanceSequence()
  }

  private mutating func reject(_ reason: String) -> Bool {
    if state.reason != reason || state.phase != .unavailable || state.boardingEvidenceCount != 0 { advanceSequence() }
    state.phase = .unavailable
    state.quality = .uncertain
    state.reason = reason
    state.distanceToBoardMeters = nil
    state.alongRouteMeters = nil
    clearEvidence()
    return false
  }
  private mutating func clearEvidence(keepLast: Bool = false) {
    if !keepLast { last = nil; state.walkingProgress = nil }
    dwellAnchor = nil; dwellStartedAt = nil; dwellObservations = 0
    waitingQualified = false; boardingAnchorAlong = nil; boardingStartedAt = nil
    movementSample = nil
    state.boardingEvidenceCount = 0
  }
  private mutating func advanceSequence() { if state.sequence < Int64.max { state.sequence += 1 } }
}

private func valid(_ point: NoLateJourneyEngineCore.Coordinate) -> Bool {
  point.latitude.isFinite && point.longitude.isFinite && abs(point.latitude) <= 90 && abs(point.longitude) <= 180
}
private func distance(_ first: NoLateJourneyEngineCore.Coordinate, _ second: NoLateJourneyEngineCore.Coordinate) -> Double {
  let radians = Double.pi / 180
  let a = pow(sin((second.latitude - first.latitude) * radians / 2), 2)
    + cos(first.latitude * radians) * cos(second.latitude * radians) * pow(sin((second.longitude - first.longitude) * radians / 2), 2)
  return 6_371_000 * 2 * asin(sqrt(min(1, max(0, a))))
}
private func project(_ point: NoLateJourneyEngineCore.Coordinate, coordinates: [NoLateJourneyEngineCore.Coordinate]) -> NoLateJourneyEngineCore.Projection? {
  // Provenance is immaterial to the projection math; it remains explicit on BusApproachCore.Route.
  NoLateJourneyEngineCore.project(point, onto: .init(coordinates: coordinates, provenance: .syntheticReplay))
}
