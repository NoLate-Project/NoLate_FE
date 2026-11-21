import Foundation

/// Bounded against the official source clock, never the HTTP receipt clock.
enum NoLateJourneyBusVehicleFreshness {
  static let maxSourceAge = 45.0
  static let maxSourceGap = 35.0
}

/// R2 evidence reducer, not an HTTP adapter. Vehicle coordinates must be independently verified.
/// No nearest-bus fallback, receipt-time freshening, or speed-only boarding confirmation.
struct NoLateJourneyBusRideCore: Sendable {
  typealias Engine = NoLateJourneyEngineCore
  enum EvidenceSource: String, Sendable { case verifiedWGS84, syntheticReplay }
  struct Vehicle: Sendable {
    let id: String
    let routeId: String
    let direction: String
    let coordinate: Engine.Coordinate
    let sourceAt: Double
    let receivedAt: Double
    let validUntil: Double
    let source: EvidenceSource
    var metersPastAlighting: Double? = nil
    var shapeOccurrenceAmbiguous = false
  }
  struct Route: Equatable, Sendable {
    let identity: Engine.Identity
    let providerRouteId: String
    let direction: String
    let approach: NoLateJourneyBusApproachCore.Route
    var departureWindowMeters: Double = 0
  }
  struct Snapshot: Equatable, Sendable {
    var phase = "UNAVAILABLE"
    var quality = "UNAVAILABLE"
    var reason = "WAITING_FOR_BOARDING_CANDIDATE"
    var sequence: Int64 = 0
    var alongRouteMeters: Double?
    var routeLengthMeters: Double?
    var observedAt: Double?
    var validUntil: Double?
    var evidenceCount = 0
    var boardingConfirmed = false
    // A label-only memory of the last confirmed ride. Never a current position.
    var lastConfirmedAt: Double?
  }
  struct RecentConfirmation: Sendable {
    let vehicleId: String
    let observedAt: Double
    let alongRouteMeters: Double
    let routeLengthMeters: Double
  }
  enum Failure: Error { case invalidRoute }
  let route: Route
  let armedAt: Double
  let expiresAt: Double
  private(set) var snapshot = Snapshot()
  // All vehicle identities and raw GPS are ephemeral. No Codable/diagnostic representation.
  private var history: [(time: Double, along: Double, accuracy: Double)] = []
  private var lastSequence: Int64 = -1
  private var candidateId: String?
  private var candidateFirstAt: Double?
  private var candidateFirstAlong: Double?
  private var candidateLastSource: Double?
  private var candidateLastVehicleAlong: Double?
  private var confirmedId: String?
  // Only a short-lived identity fence for rechecking the same vehicle after a
  // provider gap. It never carries a position or confirms riding by itself.
  private var recentConfirmedId: String?
  private var recentConfirmedSource: Double?
  private var recentConfirmedVehicleAlong: Double?
  private var recentConfirmedPassengerAlong: Double?
  private var recentConfirmedRouteLength: Double?
  // Ephemeral native-only correlation port; never part of Snapshot, Envelope or a log.
  var associatedVehicleId: String? { snapshot.boardingConfirmed ? confirmedId : nil }
  func recentConfirmation(now: Double) -> RecentConfirmation? {
    guard now.isFinite, let vehicleId = recentConfirmedId,
      let at = snapshot.lastConfirmedAt, at.isFinite, at <= now, now - at < 90,
      let along = recentConfirmedPassengerAlong, let length = recentConfirmedRouteLength,
      [along,length].allSatisfy(\.isFinite), 0 <= along, along <= length else { return nil }
    return .init(vehicleId: vehicleId, observedAt: at, alongRouteMeters: along, routeLengthMeters: length)
  }
  private var lastEvaluationAt: Double?
  private var terminated = false

  init(route: Route, armedAt: Double, expiresAt: Double) throws {
    guard (1...29).contains(route.approach.legIndex), route.approach.legIndex % 2 == 1, !route.identity.sessionId.isEmpty,
      route.identity.generation > 0, route.identity.routeRevision > 0, route.identity.epoch > 0,
      route.providerRouteId.range(of: "^[1-9][0-9]{8}$", options: .regularExpression) != nil,
      !route.direction.isEmpty, route.direction.utf8.count <= 128,
      !route.direction.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
      (2...2000).contains(route.approach.coordinates.count),
      let projection = Self.project(route.approach.coordinates[0], route: route),
      projection.routeLengthMeters >= 100, projection.routeLengthMeters <= 100_000,
      route.departureWindowMeters.isFinite, route.departureWindowMeters == 0 || (100...350).contains(route.departureWindowMeters),
      armedAt.isFinite, expiresAt.isFinite, armedAt > 0, expiresAt > armedAt,
      // Session construction separately requires the authenticated v4 walking contract for >600s.
      expiresAt - armedAt <= 7200 else { throw Failure.invalidRoute }
    self.route = route; self.armedAt = armedAt; self.expiresAt = expiresAt
  }

  /// Approach is obtained from the same native location reducer, not a boolean supplied by UI.
  mutating func ingest(_ location: Engine.Observation, approach: NoLateJourneyBusApproachCore.Snapshot,
    vehicles: [Vehicle], now: Double) {
    guard !terminated, location.identity == route.identity, approach.identity == route.identity,
      approach.route == route.approach, !approach.terminated,
      approach.armedAt == armedAt, approach.expiresAt == expiresAt,
      location.sequence > lastSequence, location.sequence < Int64.max else { return }
    guard now.isFinite, lastEvaluationAt.map({ now >= $0 }) ?? true else { return }
    tick(now: now)
    guard !terminated else { return }
    lastSequence = location.sequence
    snapshot.sequence = min(Int64.max - 1, snapshot.sequence) + 1
    guard location.observedAt.isFinite, location.observedAt >= armedAt, location.observedAt <= now + 2,
      now - location.observedAt < 15,
      location.horizontalAccuracyMeters.isFinite, (0...25).contains(location.horizontalAccuracyMeters),
      (route.approach.provenance == .syntheticReplay && location.source == .replay)
        || (route.approach.provenance == .providerShape && location.source == .realLocation),
      let projected = Self.project(location.coordinate, route: route), projected.crossTrackMeters <= 35 else {
      invalidate("PASSENGER_LOCATION_UNRELIABLE"); return
    }
    if let previous = history.last {
      let elapsed = location.observedAt - previous.time
      let delta = projected.alongRouteMeters - previous.along
      let residualSpeed = elapsed > 0
        ? max(0, abs(delta) - previous.accuracy - location.horizontalAccuracyMeters) / elapsed : .infinity
      guard elapsed > 0, elapsed <= 20, delta >= -8, abs(delta) <= 180, residualSpeed <= 25 else {
        #if targetEnvironment(simulator)
        NSLog("NOLATE_GUIDANCE_RIDE movement_rejected elapsed=%.2f delta=%.1f speed=%.1f cross=%.1f",
          elapsed,delta,residualSpeed,projected.crossTrackMeters)
        #endif
        invalidate("PASSENGER_MOVEMENT_UNRELIABLE"); return
      }
    }
    history.append((location.observedAt, projected.alongRouteMeters, location.horizontalAccuracyMeters))
    history.removeAll { location.observedAt - $0.time > 60 }
    if history.count > 180 { history.removeFirst(history.count - 180) }
    let recovering = recentConfirmedId != nil && snapshot.lastConfirmedAt.map { now - $0 < 90 } == true
    guard confirmedId != nil || recovering || (approach.phase == .boardingCandidate && approach.quality == .good
      && approach.lastObservationAt == location.observedAt && approach.boardingEvidenceCount >= 3) else {
      clearCandidate(); snapshot.phase = "WAITING"; snapshot.quality = "UNAVAILABLE"
      snapshot.reason = "WAITING_FOR_BOARDING_CANDIDATE"; return
    }
    guard vehicles.count <= 100 else { invalidate("VEHICLE_BATCH_TOO_LARGE"); return }
    let duplicates = Set(Dictionary(grouping: vehicles, by: \.id).filter { $0.value.count > 1 }.keys)
    let candidates: [(Vehicle, Double)] = vehicles.compactMap { vehicle in
      guard !duplicates.contains(vehicle.id), vehicle.id.range(of: "^[1-9][0-9]{8}$", options: .regularExpression) != nil,
        vehicle.metersPastAlighting == nil, // A departure observation can NEVER become co-riding evidence.
        !vehicle.shapeOccurrenceAmbiguous || confirmedId == vehicle.id || (recovering && recentConfirmedId == vehicle.id),
        vehicle.routeId == route.providerRouteId, vehicle.direction == route.direction,
        (route.approach.provenance == .syntheticReplay && vehicle.source == .syntheticReplay)
          || (route.approach.provenance == .providerShape && vehicle.source == .verifiedWGS84) else {
        #if targetEnvironment(simulator)
        NSLog("NOLATE_GUIDANCE_RIDE rejected identity_or_scope ambiguous=%@ recovering=%@", vehicle.shapeOccurrenceAmbiguous ? "true" : "false", recovering ? "true" : "false")
        #endif
        return nil
      }
      guard
        [vehicle.sourceAt, vehicle.receivedAt, vehicle.validUntil].allSatisfy(\.isFinite),
        vehicle.sourceAt <= vehicle.receivedAt, vehicle.receivedAt <= now + 2,
        vehicle.sourceAt <= now, now < vehicle.validUntil,
        vehicle.validUntil <= vehicle.sourceAt + NoLateJourneyBusVehicleFreshness.maxSourceAge,
        vehicle.validUntil > vehicle.sourceAt else {
        #if targetEnvironment(simulator)
        NSLog("NOLATE_GUIDANCE_RIDE rejected source_clock")
        #endif
        return nil
      }
      guard let passenger = synchronizedPassenger(at: vehicle.sourceAt) else {
        #if targetEnvironment(simulator)
        NSLog("NOLATE_GUIDANCE_RIDE rejected passenger_history")
        #endif
        return nil
      }
      guard let projection = Self.project(vehicle.coordinate, route: route), projection.crossTrackMeters <= 25 else {
        #if targetEnvironment(simulator)
        NSLog("NOLATE_GUIDANCE_RIDE rejected vehicle_projection")
        #endif
        return nil
      }
      let gap = abs(projection.alongRouteMeters - passenger.along) + passenger.accuracy
      guard gap <= 35 else {
        #if targetEnvironment(simulator)
        NSLog("NOLATE_GUIDANCE_RIDE rejected co_movement_gap %.1f signed %.1f accuracy %.1f source_age %.1f",
          gap, projection.alongRouteMeters - passenger.along, passenger.accuracy, now - vehicle.sourceAt)
        #endif
        return nil
      }
      return (vehicle, projection.alongRouteMeters)
    }
    // Two co-moving buses are ambiguous even if one was previously preferred.
    guard candidates.count == 1, let (vehicle, vehicleAlong) = candidates.first else {
      invalidate(candidates.isEmpty ? "VEHICLE_ASSOCIATION_UNAVAILABLE" : "VEHICLE_ASSOCIATION_AMBIGUOUS",
        clearHistory: false, preserveCandidate: vehicles.isEmpty && candidates.isEmpty && confirmedId == nil)
      return
    }
    if let confirmedId, confirmedId != vehicle.id {
      invalidate("ASSOCIATED_VEHICLE_CHANGED", clearHistory: false); return
    }
    if recovering, let recentConfirmedId, recentConfirmedId != vehicle.id {
      invalidate("ASSOCIATED_VEHICLE_CHANGED", clearHistory: false); return
    }
    if recovering, confirmedId == nil, let recentConfirmedSource,
      vehicle.sourceAt <= recentConfirmedSource {
      snapshot.reason = "VEHICLE_SOURCE_NOT_ADVANCED"; return
    }
    if candidateId != vehicle.id {
      clearCandidate(); candidateId = vehicle.id; candidateFirstAt = vehicle.sourceAt
      candidateFirstAlong = vehicleAlong
    }
    let canResume = confirmedId == nil && recovering
      && recentConfirmedId == vehicle.id
      && recentConfirmedSource.map { vehicle.sourceAt > $0
        && vehicle.sourceAt - $0 <= NoLateJourneyBusVehicleFreshness.maxSourceGap } == true
      && recentConfirmedVehicleAlong.map { vehicleAlong >= $0 - 8 } == true
    // Repeated receipt of the same provider fix cannot accumulate evidence or extend its TTL.
    if let previousSource = candidateLastSource {
      guard vehicle.sourceAt > previousSource else {
        // Reusing a provider fix never adds evidence or renews its TTL. While that fix
        // remains valid, a confirmed ride may still show this fresh passenger position.
        if confirmedId != nil, vehicle.sourceAt == previousSource {
          snapshot.alongRouteMeters = projected.alongRouteMeters
          snapshot.routeLengthMeters = projected.routeLengthMeters
          snapshot.observedAt = location.observedAt
          snapshot.validUntil = min(vehicle.validUntil, location.observedAt + 15)
        }
        snapshot.reason = "VEHICLE_SOURCE_NOT_ADVANCED"; return
      }
      guard vehicle.sourceAt - previousSource <= NoLateJourneyBusVehicleFreshness.maxSourceGap,
        candidateLastVehicleAlong.map({ vehicleAlong >= $0 - 8 }) ?? true else {
        invalidate("VEHICLE_MOVEMENT_UNRELIABLE", clearHistory: false); return
      }
    }
    candidateLastSource = vehicle.sourceAt; candidateLastVehicleAlong = vehicleAlong
    snapshot.evidenceCount = min(1000, snapshot.evidenceCount + 1)
    if canResume {
      confirmedId = vehicle.id
    } else if confirmedId == nil, let started = candidateFirstAt, let startAlong = candidateFirstAlong,
      snapshot.evidenceCount >= 3, vehicle.sourceAt - started >= 12, vehicleAlong - startAlong >= 70 {
      confirmedId = vehicle.id
    }
    snapshot.boardingConfirmed = confirmedId != nil
    if confirmedId != nil {
      recentConfirmedId = vehicle.id
      recentConfirmedSource = vehicle.sourceAt
      recentConfirmedVehicleAlong = vehicleAlong
      recentConfirmedPassengerAlong = projected.alongRouteMeters
      recentConfirmedRouteLength = projected.routeLengthMeters
      snapshot.lastConfirmedAt = location.observedAt
    }
    snapshot.phase = confirmedId == nil ? "BOARDING_CANDIDATE" : "RIDING"
    snapshot.quality = confirmedId == nil ? "UNCERTAIN" : "GOOD"
    snapshot.reason = confirmedId == nil ? "VEHICLE_ASSOCIATION_ACCUMULATING" : "CO_MOVEMENT_OBSERVED"
    snapshot.alongRouteMeters = confirmedId == nil ? nil : projected.alongRouteMeters
    snapshot.routeLengthMeters = confirmedId == nil ? nil : projected.routeLengthMeters
    snapshot.observedAt = location.observedAt
    snapshot.validUntil = min(vehicle.validUntil, location.observedAt + 15)
  }

  mutating func tick(now: Double) {
    guard !terminated, now.isFinite, now >= armedAt, lastEvaluationAt.map({ now >= $0 }) ?? true else { return }
    lastEvaluationAt = now
    if let at = snapshot.lastConfirmedAt, now - at >= 90 {
      snapshot.lastConfirmedAt = nil; recentConfirmedId = nil
      recentConfirmedSource = nil; recentConfirmedVehicleAlong = nil
      recentConfirmedPassengerAlong = nil; recentConfirmedRouteLength = nil
    }
    if now >= expiresAt {
      stop(); snapshot.reason = "RIDING_SESSION_EXPIRED"; return
    }
    if let until = snapshot.validUntil, now >= until {
      invalidate("RIDING_EVIDENCE_STALE", clearHistory: false,
        preserveCandidate: confirmedId == nil && candidateId != nil)
    }
  }

  mutating func stop() {
    guard !terminated else { return }
    terminated = true
    invalidate("RIDING_SESSION_STOPPED")
    snapshot.phase = "STOPPED"
  }

  private func synchronizedPassenger(at time: Double) -> (along: Double, accuracy: Double)? {
    if let exact = history.first(where: { abs($0.time - time) < 0.001 }) { return (exact.along, exact.accuracy) }
    for (a, b) in zip(history, history.dropFirst()) where a.time <= time && time <= b.time && b.time - a.time <= 8 {
      let fraction = (time - a.time) / (b.time - a.time)
      return (a.along + fraction * (b.along - a.along), max(a.accuracy, b.accuracy))
    }
    return nil // Never extrapolate passenger or train motion during missing GPS.
  }
  private mutating func clearCandidate() {
    candidateId = nil; candidateFirstAt = nil; candidateFirstAlong = nil
    candidateLastSource = nil; candidateLastVehicleAlong = nil; snapshot.evidenceCount = 0
  }
  private mutating func invalidate(_ reason: String, clearHistory: Bool = true,
    preserveCandidate: Bool = false) {
    snapshot.sequence = min(Int64.max - 1, snapshot.sequence) + 1
    if confirmedId != nil { recentConfirmedId = confirmedId }
    if !preserveCandidate { clearCandidate() }
    confirmedId = nil
    // One rejected GPS movement must hide the public ride position, but it does
    // not prove that the already associated vehicle changed. A fresh, distinct
    // source fix and synchronized passenger history are still required to resume.
    if reason != "RIDING_EVIDENCE_STALE" && reason != "VEHICLE_ASSOCIATION_UNAVAILABLE"
      && reason != "PASSENGER_MOVEMENT_UNRELIABLE" {
      snapshot.lastConfirmedAt = nil; recentConfirmedId = nil
      recentConfirmedSource = nil; recentConfirmedVehicleAlong = nil
      recentConfirmedPassengerAlong = nil; recentConfirmedRouteLength = nil
    }
    if clearHistory { history.removeAll() }
    snapshot.phase = "UNAVAILABLE"; snapshot.quality = "UNCERTAIN"; snapshot.reason = reason
    snapshot.boardingConfirmed = false; snapshot.alongRouteMeters = nil; snapshot.routeLengthMeters = nil
    snapshot.observedAt = nil; snapshot.validUntil = nil
  }
  private static func project(_ coordinate: Engine.Coordinate, route: Route) -> Engine.Projection? {
    Engine.project(coordinate, onto: .init(coordinates: route.approach.coordinates,
      provenance: route.approach.provenance == .syntheticReplay ? .syntheticReplay : .verifiedWalkingPath))
  }
}

/// R3-1 read-only notice policy. Only a fresh confirmed ride may approach its saved
/// alighting occurrence. Never infers alighting, walking, arrival or a time-based ETA.
enum NoLateJourneyBusAlightingPolicy {
  typealias Engine = NoLateJourneyEngineCore
  struct Route: Sendable {
    let identity: Engine.Identity
    let previousStopAlong: Double
    let targetAlong: Double
    let length: Double
  }
  static func prepare(json: String, ride: NoLateJourneyBusRideCore.Route,
    officialBusAdmission: NoLateJourneyRouteNormalizer.OfficialBusAdmission? = nil) -> Route? {
    let index = ride.approach.legIndex
    guard let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(json.utf8)),
      let summary = try? NoLateJourneyRouteNormalizer.normalize(json: json,
        officialBusAdmission: officialBusAdmission),
      input.routeRevision == ride.identity.routeRevision, index >= 1, index < input.legs.count,
      summary.legs[index].geometryUsable, summary.legs[index].stopSequenceUsable, summary.legs[index].directionExplicit,
      input.legs[index].kind == "BUS", input.legs[index].localRouteId == ride.providerRouteId,
      let target = input.legs[index].stops.last?.coordinate,
      let previous = input.legs[index].stops.dropLast().last?.coordinate else { return nil }
    let raw = input.legs[index].coordinates.compactMap {
      $0.map { Engine.Coordinate(latitude:$0.latitude, longitude:$0.longitude) }
    }
    guard raw.count == input.legs[index].coordinates.count else { return nil }
    // The independently admitted official crosswalk collapses only adjacent
    // zero-length edges. Match the ride against exactly that same canonical shape.
    let admitted = officialBusAdmission?.busLegIndex == index && officialBusAdmission?.matches(input) == true
    let canonical = admitted ? raw.reduce(into: [Engine.Coordinate]()) { result, point in
      if result.last != point { result.append(point) }
    } : raw
    guard canonical == ride.approach.coordinates,
      !admitted || officialBusAdmission?.routeId == ride.providerRouteId else { return nil }
    let path = Engine.Route(coordinates:ride.approach.coordinates, provenance:.verifiedWalkingPath)
    guard let end = Engine.project(.init(latitude:target.latitude, longitude:target.longitude), onto:path),
      let before = Engine.project(.init(latitude:previous.latitude, longitude:previous.longitude), onto:path),
      end.crossTrackMeters <= 25, before.crossTrackMeters <= 25,
      end.routeLengthMeters - end.alongRouteMeters <= 25,
      end.alongRouteMeters - before.alongRouteMeters >= 70 else { return nil }
    return .init(identity:ride.identity, previousStopAlong:before.alongRouteMeters,
      targetAlong:end.alongRouteMeters, length:end.routeLengthMeters)
  }

  static func notice(route: Route?, ride: NoLateJourneyBusRideCore.Snapshot?, now: Double) -> NoLateGuidanceAlighting? {
    guard let route, let ride, now.isFinite, ride.phase == "RIDING", ride.quality == "GOOD", ride.boardingConfirmed,
      let at = ride.observedAt, let until = ride.validUntil, let along = ride.alongRouteMeters,
      [at, until, along].allSatisfy(\.isFinite), at <= now + 2, now < until, until <= at + 15,
      ride.routeLengthMeters == route.length, along >= 0, along <= route.length else { return nil }
    // Use the reducer's worst accepted accuracy radius (25 m) as a conservative
    // lower/upper bound. A borderline GPS fix cannot prematurely cross a stop boundary.
    let remaining = max(0, route.targetAlong - along)
    let metres = ceil(remaining / 10) * 10
    // The official feed advances by roughly one bus block per source fix. A
    // 50 m trigger can be skipped entirely; this bounded approach window is
    // still after the verified previous stop on the admitted route shape.
    if remaining + 25 <= 260, along - 25 >= route.previousStopAlong {
      return .init(kind:"NEAR_STOP", remainingMeters:metres)
    }
    guard along - 25 >= route.previousStopAlong else { return nil }
    return .init(kind:"ONE_STOP_BEFORE", remainingMeters:metres)
  }
}

/// R3-2 ephemeral diagnostic evidence only. Stationary GPS or disappearance of a bus
/// is NOT alighting. No phase transition, final-walk permit, persistence or UI action.
struct NoLateJourneyBusSeparationCore: Sendable {
  // Shared with the walking consumer so an accepted bus departure can hand off.
  static let minimumDepartureFixes = 2
  typealias E = NoLateJourneyEngineCore
  typealias Ride = NoLateJourneyBusRideCore
  struct Snapshot: Equatable, Sendable {
    var status = "UNAVAILABLE"
    var reason = "CONFIRMED_TARGET_RIDE_REQUIRED"
    var evidenceCount = 0
    var validUntil: Double?
  }
  let route: Ride.Route
  private(set) var snapshot = Snapshot()
  private var trackedId: String?
  private var trackUntil = 0.0
  private var firstSource: Double?
  private var firstPast: Double?
  private var lastSource: Double?
  private var lastPast: Double?
  private var acceptedCount = 0
  private var lastLocation: (at:Double, coordinate:E.Coordinate, accuracy:Double)?
  private var lastSequence: Int64 = -1
  private var lastNow = 0.0
  private var stopped = false

  init(route: Ride.Route) { self.route = route }

  mutating func ingest(_ location:E.Observation, priorRide:Ride.Snapshot?, associatedId:String?,
    recentRide:Ride.RecentConfirmation? = nil, vehicles:[Ride.Vehicle], now:Double) {
    guard !stopped, now.isFinite, now >= lastNow, location.identity == route.identity,
      location.sequence > lastSequence, location.sequence < Int64.max else { return }
    tick(now:now); lastSequence = location.sequence
    guard (100...350).contains(route.departureWindowMeters), let target = route.approach.coordinates.last,
      location.observedAt.isFinite, location.observedAt >= now - 8, location.observedAt <= now,
      location.horizontalAccuracyMeters.isFinite, (0...25).contains(location.horizontalAccuracyMeters),
      (route.approach.provenance == .syntheticReplay && location.source == .replay)
        || (route.approach.provenance == .providerShape && location.source == .realLocation),
      Self.distance(target, location.coordinate) + location.horizontalAccuracyMeters <= 50 else {
      clearTrack("PASSENGER_NOT_AT_TARGET"); return
    }
    if let priorRide, priorRide.phase == "RIDING", priorRide.quality == "GOOD", priorRide.boardingConfirmed,
      let at = priorRide.observedAt, let until = priorRide.validUntil,
      let along = priorRide.alongRouteMeters, let length = priorRide.routeLengthMeters,
      [at,until,along,length].allSatisfy(\.isFinite), at <= now, now < until, until <= at + 15,
      length - along <= min(260,route.departureWindowMeters),
      let associatedId, associatedId.range(of:"^[1-9][0-9]{8}$",options:.regularExpression) != nil {
      track(associatedId, confirmedAt:now)
    } else if let recentRide,
      recentRide.vehicleId.range(of:"^[1-9][0-9]{8}$",options:.regularExpression) != nil,
      recentRide.observedAt.isFinite, recentRide.observedAt <= now,
      now - recentRide.observedAt < 90,
      [recentRide.alongRouteMeters,recentRide.routeLengthMeters].allSatisfy(\.isFinite),
      recentRide.routeLengthMeters - recentRide.alongRouteMeters >= 0,
      recentRide.routeLengthMeters - recentRide.alongRouteMeters <= min(260,route.departureWindowMeters) {
      // A source gap may hide the ride at the exact stop. This private,
      // short-lived confirmation only identifies the same vehicle for later
      // independent departure fixes; it never confirms alighting itself.
      track(recentRide.vehicleId, confirmedAt:recentRide.observedAt)
    }
    guard let trackedId, now < trackUntil else { clearTrack("CONFIRMED_TARGET_RIDE_REQUIRED"); return }
    // Keep a stationary passenger history across 1 Hz CLLocation fixes. No motion from clocks.
    if let previous = lastLocation {
      let elapsed = location.observedAt - previous.at
      guard elapsed > 0, elapsed <= 8,
        max(0,Self.distance(previous.coordinate,location.coordinate) - previous.accuracy - location.horizontalAccuracyMeters) / elapsed <= 2.5 else {
        clearTrack("PASSENGER_MOVEMENT_UNRELIABLE"); return
      }
    }
    lastLocation = (location.observedAt,location.coordinate,location.horizontalAccuracyMeters)
    guard vehicles.count <= 100 else { resetEvidence("MATCHED_DEPARTING_VEHICLE_REQUIRED"); return }
    let matching = vehicles.filter { $0.id == trackedId }
    // A provider gap hides the current result, but does not turn the next
    // distinct source fix into a first observation of the same departure.
    guard !matching.isEmpty else { suspendEvidence("MATCHED_DEPARTING_VEHICLE_REQUIRED"); return }
    guard matching.count == 1, let v = matching.first,
      v.routeId == route.providerRouteId, v.direction == route.direction,
      (route.approach.provenance == .syntheticReplay && v.source == .syntheticReplay)
        || (route.approach.provenance == .providerShape && v.source == .verifiedWGS84),
      [v.sourceAt,v.receivedAt,v.validUntil].allSatisfy(\.isFinite),
      [v.coordinate.latitude,v.coordinate.longitude].allSatisfy(\.isFinite),
      abs(v.coordinate.latitude) <= 90, abs(v.coordinate.longitude) <= 180,
      v.sourceAt <= v.receivedAt, v.receivedAt <= now, v.sourceAt <= location.observedAt else {
      resetEvidence("MATCHED_DEPARTING_VEHICLE_REQUIRED"); return
    }
    guard
      location.observedAt - v.sourceAt < NoLateJourneyBusVehicleFreshness.maxSourceAge,
      now < v.validUntil, v.validUntil <= v.sourceAt + NoLateJourneyBusVehicleFreshness.maxSourceAge,
      v.sourceAt >= (lastSource ?? v.sourceAt) else {
      suspendEvidence("MATCHED_DEPARTING_VEHICLE_REQUIRED"); return
    }
    guard
      let past = v.metersPastAlighting, past.isFinite, past >= 75,
      past <= route.departureWindowMeters + 25,
      Self.distance(target,v.coordinate) > 25, Self.distance(target,v.coordinate) <= past + 25,
      Self.distance(v.coordinate,location.coordinate) - location.horizontalAccuracyMeters >= 60 else {
      resetEvidence("MATCHED_DEPARTING_VEHICLE_REQUIRED"); return
    }
    if let lastSource {
      if v.sourceAt == lastSource { return } // no evidence/TTL renewal on a repeated source fix
      guard v.sourceAt > lastSource,
        v.sourceAt - lastSource <= NoLateJourneyBusVehicleFreshness.maxSourceGap,
        let lastPast, past >= lastPast - 5 else { resetEvidence("VEHICLE_MOVEMENT_UNRELIABLE"); return }
    }
    if firstSource == nil { firstSource = v.sourceAt; firstPast = past }
    lastSource = v.sourceAt; lastPast = past
    acceptedCount = min(1000,acceptedCount + 1)
    snapshot.evidenceCount = acceptedCount
    let observed = acceptedCount >= Self.minimumDepartureFixes
      && v.sourceAt - (firstSource ?? v.sourceAt) >= 12 && past - (firstPast ?? past) >= 40
    snapshot.status = observed ? "SEPARATION_OBSERVED" : "COLLECTING"
    snapshot.reason = observed ? "SAME_VEHICLE_DEPARTED_PASSENGER_AT_TARGET" : "DISTINCT_DEPARTURE_FIXES_REQUIRED"
    snapshot.validUntil = min(v.validUntil,location.observedAt + 15)
  }
  mutating func tick(now:Double) {
    guard !stopped, now.isFinite, now >= lastNow else { return }; lastNow = now
    if trackedId != nil, now >= trackUntil { clearTrack("CORRELATION_WINDOW_EXPIRED") }
    else if let until = snapshot.validUntil, now >= until { suspendEvidence("SEPARATION_EVIDENCE_STALE") }
  }
  mutating func stop() { clearTrack("SESSION_STOPPED"); stopped = true }
  private mutating func track(_ id:String, confirmedAt:Double) {
    if trackedId != id { resetEvidence("WAITING_FOR_VEHICLE_DEPARTURE") }
    trackedId = id
    trackUntil = max(trackUntil,confirmedAt + 150)
  }
  private mutating func resetEvidence(_ reason:String) {
    firstSource = nil; firstPast = nil; lastSource = nil; lastPast = nil
    acceptedCount = 0
    snapshot = .init(status:"UNAVAILABLE",reason:reason,evidenceCount:0,validUntil:nil)
  }
  private mutating func suspendEvidence(_ reason:String) {
    // No usable alighting signal is exposed during the gap. Internal source
    // history remains bounded by trackUntil and the max source gap checked on
    // the next distinct, same-vehicle fix.
    snapshot = .init(status:"UNAVAILABLE",reason:reason,evidenceCount:0,validUntil:nil)
  }
  private mutating func clearTrack(_ reason:String) {
    resetEvidence(reason); trackedId = nil; trackUntil = 0; lastLocation = nil
  }
  static func distance(_ a:E.Coordinate,_ b:E.Coordinate) -> Double {
    guard [a.latitude,a.longitude,b.latitude,b.longitude].allSatisfy(\.isFinite),
      abs(a.latitude) <= 90, abs(b.latitude) <= 90, abs(a.longitude) <= 180, abs(b.longitude) <= 180 else { return .infinity }
    let r = Double.pi / 180
    let h = pow(sin((b.latitude-a.latitude)*r/2),2) + cos(a.latitude*r)*cos(b.latitude*r)*pow(sin((b.longitude-a.longitude)*r/2),2)
    return 6_371_000 * 2 * asin(sqrt(min(1,max(0,h))))
  }
}

/// R3-3: an ephemeral handoff, not a persisted alighting claim or arrival event.
/// Only a verified WALK-BUS-WALK topology and fresh same-vehicle separation can arm it.
struct NoLateJourneyFinalWalkCore: Sendable {
  typealias E = NoLateJourneyEngineCore
  typealias Separation = NoLateJourneyBusSeparationCore.Snapshot
  struct Route: Sendable {
    let identity: E.Identity
    let path: E.Route
    let busPath: E.Route
    let length: Double
    let destination: E.Coordinate
    var walkingLegIndex = 2
    // The transfer wrapper owns this distinction. A boarding-point dwell is never
    // exposed to the automatic session as whole-journey arrival.
    var isTransfer = false
    // The subway exit reducer already proves same-train arrival and continuous
    // movement on this path. Rail geometry can overlap the station exit walk.
    var isSubwayFinalWalk = false
  }
  struct Snapshot: Equatable, Sendable {
    var phase = "UNAVAILABLE"
    var reason = "FRESH_SEPARATION_REQUIRED"
    var evidenceCount = 0
    var observedAt: Double?
    var validUntil: Double?
    var along: Double?
    var sequence: Int64 = 0
  }
  let route: Route
  private(set) var snapshot = Snapshot()
  private(set) var committed = false
  private(set) var arrived = false
  private(set) var arrivalEvidenceCount = 0
  private var arrivalStartedAt: Double?
  private var permitUntil: Double?
  private var last: E.Observation?
  private var lastAlong: Double?
  private var firstAlong: Double?
  private var firstAt: Double?
  private var evidenceAlong: Double?
  private var lastSequence: Int64 = -1
  private var lastNow = 0.0
  private var stopped = false

  init(route: Route) { self.route = route }

  static func prepare(json: String, ride: NoLateJourneyBusRideCore.Route,
    officialBusAdmission: NoLateJourneyRouteNormalizer.OfficialBusAdmission? = nil) -> Route? {
    let busIndex = ride.approach.legIndex, walkIndex = busIndex + 1
    guard let summary = try? NoLateJourneyRouteNormalizer.normalize(json: json),
      let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(json.utf8)),
      input.routeRevision == ride.identity.routeRevision, busIndex >= 1, walkIndex == input.legs.count - 1,
      input.legs.enumerated().allSatisfy({ $0.offset % 2 == 0 ? $0.element.kind == "WALK" : ["BUS","SUBWAY"].contains($0.element.kind) }),
      summary.legs[walkIndex].geometryUsable, let length = summary.legs[walkIndex].geometryLengthMeters,
      (70...10_000).contains(length), input.legs[walkIndex].serviceAvailable != false,
      NoLateJourneyBusAlightingPolicy.prepare(json: json, ride: ride,
        officialBusAdmission: officialBusAdmission) != nil,
      let target = input.legs[busIndex].stops.last?.coordinate, let destination = input.destination,
      let walking = try? NoLateJourneyRouteNormalizer.routeCoordinates(input,legIndex:walkIndex),
      let start = walking.first ?? nil, let end = walking.last ?? nil,
      let declaredStart = input.legs[walkIndex].start, let declaredEnd = input.legs[walkIndex].end else { return nil }
    func point(_ p: NoLateJourneyRouteNormalizer.Coordinate) -> E.Coordinate { .init(latitude:p.latitude, longitude:p.longitude) }
    let distance = NoLateJourneyBusSeparationCore.distance
    guard distance(point(target),point(start)) <= 25, distance(point(start),point(declaredStart)) <= 25,
      distance(point(end),point(destination)) <= 25, distance(point(end),point(declaredEnd)) <= 25 else { return nil }
    let coordinates = walking.compactMap { $0.map(point) }
    guard coordinates.count == walking.count else { return nil }
    return .init(identity:ride.identity,
      path:.init(coordinates:coordinates,provenance:ride.approach.provenance == .syntheticReplay ? .syntheticReplay : .verifiedWalkingPath),
      busPath:.init(coordinates:ride.approach.coordinates,provenance:.verifiedWalkingPath),length:length,destination:point(destination),walkingLegIndex:walkIndex)
  }

  /// The walking target is the next platform on a transfer or the saved destination on the last leg.
  static func prepare(json: String, subway: NoLateJourneySubwayRideCore.Route,
    busAdmissions: [NoLateJourneyRouteNormalizer.OfficialBusAdmission] = [],
    subwayAdmissions: [NoLateJourneyRouteNormalizer.OfficialSubwayAdmission] = []) -> Route? {
    let transitIndex = subway.legIndex, walkIndex = transitIndex + 1
    guard (1...29).contains(transitIndex), transitIndex % 2 == 1,
      let summary = try? NoLateJourneyRouteNormalizer.normalize(json:json,busAdmissions:busAdmissions,subwayAdmissions:subwayAdmissions),
      let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(json.utf8)),
      input.provider == "odsay", input.source == "api", input.routeRevision == subway.identity.routeRevision,
      (3...31).contains(input.legs.count), input.legs.count % 2 == 1, input.legs.indices.contains(walkIndex),
      input.legs.enumerated().allSatisfy({ $0.offset % 2 == 0 ? $0.element.kind == "WALK" : ["BUS","SUBWAY"].contains($0.element.kind) }),
      input.legs[transitIndex].kind == "SUBWAY",
      input.legs[walkIndex].kind == "WALK", input.legs[transitIndex].stops.count == subway.stations.count,
      summary.legs[walkIndex].geometryUsable, let length = summary.legs[walkIndex].geometryLengthMeters,
      (1...10_000).contains(length), input.legs[walkIndex].serviceAvailable != false,
      let target = input.legs[transitIndex].stops.last?.coordinate,
      let officialTarget = subway.stations.last?.coordinate,

      let walking = try? NoLateJourneyRouteNormalizer.routeCoordinates(input,legIndex:walkIndex),
      let transit = try? NoLateJourneyRouteNormalizer.routeCoordinates(input,legIndex:transitIndex),
      let start = walking.first ?? nil, let end = walking.last ?? nil,
      let transitEnd = transit.last ?? nil,
      let declaredStart = input.legs[walkIndex].start, let declaredEnd = input.legs[walkIndex].end,
      input.legs[transitIndex].stops.enumerated().allSatisfy({ offset, stop in
        stop.routingStationId == subway.stations[offset].routingId && stop.coordinate.map {
          NoLateJourneyBusSeparationCore.distance(.init(latitude:$0.latitude,longitude:$0.longitude),
            subway.stations[offset].coordinate) <= 25
        } == true
      }) else { return nil }
    let transfer = walkIndex < input.legs.count - 1
    let destination: NoLateJourneyRouteNormalizer.Coordinate
    if transfer {
      let next = input.legs[walkIndex + 1]
      guard next.serviceAvailable != false, let board = next.stops.first?.coordinate else { return nil }
      destination = board
    } else {
      guard length >= 70, let end = input.destination else { return nil }
      destination = end
    }
    func point(_ p: NoLateJourneyRouteNormalizer.Coordinate) -> E.Coordinate {
      .init(latitude:p.latitude, longitude:p.longitude)
    }
    let distance = NoLateJourneyBusSeparationCore.distance
    guard distance(point(target),officialTarget) <= 25,
      distance(point(transitEnd),officialTarget) <= 25,
      distance(point(start),officialTarget) <= 25,
      distance(point(start),point(declaredStart)) <= 25,
      distance(point(end),point(destination)) <= 25,
      distance(point(end),point(declaredEnd)) <= 25 else { return nil }
    let walkCoordinates = walking.compactMap { $0.map(point) }
    let transitCoordinates = transit.compactMap { $0.map(point) }
    guard walkCoordinates.count == walking.count, transitCoordinates.count == transit.count,
      transitCoordinates.count >= 2 else { return nil }
    return .init(identity:subway.identity,
      path:.init(coordinates:walkCoordinates,provenance:.verifiedWalkingPath),
      busPath:.init(coordinates:transitCoordinates,provenance:.verifiedWalkingPath),
      length:length,destination:point(destination),walkingLegIndex:walkIndex,isTransfer:transfer,isSubwayFinalWalk:true)
  }
  mutating func ingest(_ fix:E.Observation, separation:Separation?, now:Double) {
    guard !stopped, now.isFinite, now >= lastNow, fix.identity == route.identity,
      fix.sequence > lastSequence, fix.sequence < Int64.max else { return }
    tick(now:now); lastSequence = fix.sequence; advance()
    guard fix.observedAt.isFinite, fix.observedAt >= now - 8, fix.observedAt <= now,
      fix.horizontalAccuracyMeters.isFinite, (0...25).contains(fix.horizontalAccuracyMeters),
      (route.path.provenance == .syntheticReplay && fix.source == .replay)
        || (route.path.provenance == .verifiedWalkingPath && fix.source == .realLocation),
      let projection = E.project(fix.coordinate,onto:route.path),
      projection.crossTrackMeters + fix.horizontalAccuracyMeters <= 25 else { reject("FINAL_WALK_LOCATION_UNRELIABLE"); return }
    let along = projection.alongRouteMeters
    if !committed, permitUntil == nil {
      // Subway separation keeps its own three-fix contract. Bus final and
      // transfer walks consume the same evidence threshold as the bus reducer.
      let minimumFixes = route.isSubwayFinalWalk ? 3 : NoLateJourneyBusSeparationCore.minimumDepartureFixes
      guard let separation, separation.status == "SEPARATION_OBSERVED", separation.evidenceCount >= minimumFixes,
        let until = separation.validUntil, until.isFinite, now < until, until <= fix.observedAt + 15,
        let start = route.path.coordinates.first,
        NoLateJourneyBusSeparationCore.distance(start,fix.coordinate) + fix.horizontalAccuracyMeters <= 50,
        along <= 25 else { reject("FRESH_SEPARATION_REQUIRED"); return }
      permitUntil = now + 90 // fixed handoff lifetime; repeated separation never extends it
    }
    guard committed || permitUntil.map({ now < $0 }) == true else { reject("FINAL_WALK_HANDOFF_EXPIRED"); return }
    if let last, let lastAlong {
      let elapsed = fix.observedAt - last.observedAt
      let displacement = NoLateJourneyBusSeparationCore.distance(last.coordinate,fix.coordinate)
      guard elapsed > 0, elapsed <= 8, displacement <= 30,
        displacement / elapsed <= 4,
        max(0,displacement - last.horizontalAccuracyMeters - fix.horizontalAccuracyMeters) / elapsed <= 2.5,
        along >= lastAlong - 5 else { reject("FINAL_WALK_MOVEMENT_UNRELIABLE"); return }
    } else if !committed {
      guard along <= 25 else { reject("FINAL_WALK_START_REQUIRED"); return }
    } else if let anchor = snapshot.along {
      // A gap cannot silently relocate a committed walker along the rest of the route.
      guard abs(along - anchor) <= 30 else { reject("FINAL_WALK_REACQUISITION_REQUIRED"); return }
    }
    if firstAlong == nil { firstAlong = along; firstAt = fix.observedAt; evidenceAlong = along; snapshot.evidenceCount = 1 }
    else if along - (evidenceAlong ?? along) >= 8 - 0.000001 {
      evidenceAlong = along; snapshot.evidenceCount = min(1000,snapshot.evidenceCount + 1)
    }
    last = fix; lastAlong = along
    let movementRequired = route.isTransfer ? min(35, max(5, route.length / 4)) : 35
    if !committed, snapshot.evidenceCount >= 3, fix.observedAt - (firstAt ?? fix.observedAt) >= 8,
      along - (firstAlong ?? along) - fix.horizontalAccuracyMeters >= movementRequired,
      let busProjection = E.project(fix.coordinate,onto:route.busPath),
      route.isTransfer || route.isSubwayFinalWalk
        || busProjection.crossTrackMeters - fix.horizontalAccuracyMeters >= 25 {
      committed = true; permitUntil = nil
    }
    // Local navigation arrival only. Require the uncertainty circle inside BOTH the
    // declared destination and final geometry endpoint, after a continuous walking handoff.
    // Clocks, elapsed route time and vehicle disappearance never contribute evidence.
    // Very short/shared-stop transfers may require no measurable walk. They still
    // require the same-vehicle departure permit AND five continuous good fixes over
    // twenty seconds entirely inside the next boarding-point uncertainty boundary.
    // This exception cannot complete a final walk or confirm the next vehicle.
    if committed || (route.isTransfer && route.length <= 40),
      let end = route.path.coordinates.last, fix.horizontalAccuracyMeters <= 10,
      route.length - along + fix.horizontalAccuracyMeters <= 20,
      NoLateJourneyBusSeparationCore.distance(end,fix.coordinate) + fix.horizontalAccuracyMeters <= 20,
      NoLateJourneyBusSeparationCore.distance(route.destination,fix.coordinate) + fix.horizontalAccuracyMeters <= 20 {
      if arrivalStartedAt == nil { arrivalStartedAt = fix.observedAt }
      arrivalEvidenceCount = min(1000,arrivalEvidenceCount + 1)
      if arrivalEvidenceCount >= 5, fix.observedAt - (arrivalStartedAt ?? fix.observedAt) >= 20 {
        arrived = true
        if route.isTransfer { committed = true; permitUntil = nil }
      }
    } else { resetArrival() }
    snapshot.phase = committed ? (route.isTransfer ? "TRANSFER_WALK" : "FINAL_WALK") : "COLLECTING"
    snapshot.reason = committed ? "SEPARATION_AND_CONTINUOUS_WALK_CONFIRMED" : "CONTINUOUS_FINAL_WALK_REQUIRED"
    snapshot.observedAt = fix.observedAt; snapshot.validUntil = fix.observedAt + 15; snapshot.along = along
  }
  mutating func tick(now:Double) {
    guard !stopped, now.isFinite, now >= lastNow else { return }; lastNow = now
    if !committed, let until = permitUntil, now >= until { permitUntil = nil; reject("FINAL_WALK_HANDOFF_EXPIRED"); advance() }
    else if let until = snapshot.validUntil, now >= until { reject("FINAL_WALK_LOCATION_STALE"); advance() }
  }
  mutating func stop() { guard !stopped else { return }; permitUntil = nil; reject("SESSION_STOPPED"); committed = false; arrived = false; stopped = true; advance() }
  private mutating func resetArrival() { arrivalStartedAt = nil; arrivalEvidenceCount = 0; arrived = false }
  private mutating func advance() { if snapshot.sequence < Int64.max { snapshot.sequence += 1 } }
  private mutating func reject(_ reason:String) {
    resetArrival()
    last = nil; lastAlong = nil; firstAlong = nil; firstAt = nil; evidenceAlong = nil
    snapshot.phase = "UNAVAILABLE"; snapshot.reason = reason; snapshot.evidenceCount = 0
    snapshot.observedAt = nil; snapshot.validUntil = nil
    // Preserve only a committed walk's in-memory reacquisition anchor, never display it stale.
    if !committed { snapshot.along = nil }
  }
}

/// A native-only, ephemeral handoff to the NEXT boarding occurrence. There is no
/// phase-setting input, Codable checkpoint, passenger boarding claim or journey end.
/// The session supplies its own separation reducer, not a UI-provided Boolean.
struct NoLateJourneyTransferWalkCore: Sendable {
  typealias E = NoLateJourneyEngineCore
  struct Route: Sendable {
    let walkingLegIndex: Int
    let nextTransitLegIndex: Int
    let nextTransitKind: String
    let walk: NoLateJourneyFinalWalkCore.Route
  }
  let route: Route
  private var walk: NoLateJourneyFinalWalkCore
  var snapshot: NoLateJourneyFinalWalkCore.Snapshot { walk.snapshot }
  var committed: Bool { walk.committed }
  var readyForNextTransit: Bool { walk.arrived && snapshot.phase == "TRANSFER_WALK" }
  var boardingPointEvidenceCount: Int { walk.arrivalEvidenceCount }

  init(route: Route) { self.route = route; walk = NoLateJourneyFinalWalkCore(route: route.walk) }

  static func prepare(json: String, ride: NoLateJourneyBusRideCore.Route,
    officialBusAdmission: NoLateJourneyRouteNormalizer.OfficialBusAdmission? = nil,
    busAdmissions: [NoLateJourneyRouteNormalizer.OfficialBusAdmission] = [],
    subwayAdmissions: [NoLateJourneyRouteNormalizer.OfficialSubwayAdmission] = []) -> Route? {
    let index = ride.approach.legIndex, walkingIndex = index + 1, nextIndex = index + 2
    guard let summary = try? NoLateJourneyRouteNormalizer.normalize(json: json,
      officialBusAdmission: officialBusAdmission, busAdmissions:busAdmissions, subwayAdmissions:subwayAdmissions),
      let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(json.utf8)),
      input.routeRevision == ride.identity.routeRevision,
      summary.reasonCodes == ["SAVED_ROUTE_REVALIDATION_REQUIRED"] || summary.reasonCodes.isEmpty
        || summary.reasonCodes == ["SYNTHETIC_FIXTURE_ONLY"] && ride.approach.provenance == .syntheticReplay,
      index >= 1, nextIndex < input.legs.count - 1, input.legs.count % 2 == 1,
      input.legs.enumerated().allSatisfy({ $0.offset % 2 == 0 ? $0.element.kind == "WALK" : ["BUS","SUBWAY"].contains($0.element.kind) }),
      NoLateJourneyBusAlightingPolicy.prepare(json: json, ride: ride,
        officialBusAdmission: officialBusAdmission) != nil,
      summary.legs[walkingIndex].geometryUsable, let length = summary.legs[walkingIndex].geometryLengthMeters,
      (1...10_000).contains(length), input.legs[walkingIndex].serviceAvailable != false,
      input.legs[nextIndex].serviceAvailable != false,
      let alight = input.legs[index].stops.last?.coordinate,
      let board = input.legs[nextIndex].stops.first?.coordinate,
      let points = try? NoLateJourneyRouteNormalizer.routeCoordinates(input, legIndex: walkingIndex),
      let start = points.first ?? nil, let end = points.last ?? nil,
      let declaredStart = input.legs[walkingIndex].start, let declaredEnd = input.legs[walkingIndex].end else { return nil }
    // The handoff targets a saved boarding point. An official station-path proof
    // identifies that occurrence even when ODsay omitted a separate direction label.
    let nextTrain = subwayAdmissions.first { $0.subwayLegIndex == nextIndex && $0.matches(input) }
    let nextBus = busAdmissions.first { $0.busLegIndex == nextIndex && $0.matches(input) }
    let nextQuality = summary.legs[nextIndex]
    let hasRouteID = input.legs[nextIndex].providerRouteId?.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty == false
    guard nextTrain != nil || (nextQuality.geometryUsable && nextQuality.stopSequenceUsable &&
      nextQuality.directionExplicit && (hasRouteID || nextBus != nil)) else { return nil }
    func p(_ c: NoLateJourneyRouteNormalizer.Coordinate) -> E.Coordinate { .init(latitude:c.latitude, longitude:c.longitude) }
    let distance = NoLateJourneyBusSeparationCore.distance
    guard distance(p(alight),p(start)) <= 25, distance(p(start),p(declaredStart)) <= 25,
      distance(p(board),p(end)) <= 25, distance(p(end),p(declaredEnd)) <= 25 else { return nil }
    let coordinates = points.compactMap { $0.map(p) }
    guard coordinates.count == points.count else { return nil }
    return .init(walkingLegIndex:walkingIndex, nextTransitLegIndex:nextIndex, nextTransitKind:input.legs[nextIndex].kind,
      walk:.init(identity:ride.identity,
        path:.init(coordinates:coordinates, provenance:ride.approach.provenance == .syntheticReplay ? .syntheticReplay : .verifiedWalkingPath),
        busPath:.init(coordinates:ride.approach.coordinates, provenance:.verifiedWalkingPath),
        length:length, destination:p(board), walkingLegIndex:walkingIndex, isTransfer:true))
  }
  mutating func ingest(_ fix:E.Observation, separation:NoLateJourneyBusSeparationCore.Snapshot?, now:Double) {
    walk.ingest(fix,separation:separation,now:now)
  }
  mutating func tick(now:Double) { walk.tick(now:now) }
  mutating func stop() { walk.stop() }
}
