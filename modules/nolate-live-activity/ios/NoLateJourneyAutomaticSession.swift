import CryptoKit
import Foundation

/// Opt-in development state only. Execution is bound to the platform by the native runtime.
/// Raw coordinates live only in the local envelope; Departure is the entire upload allow-list.
struct NoLateJourneyAutomaticSession: Sendable {
  typealias Core = NoLateJourneyEngineCore

  struct Binding: Codable, Equatable, Sendable {
    let sessionId: String
    let scheduleId: String
    let generation: Int64
    let routeRevision: Int64
    let clientOwnerId: String
    let routeInputDigest: String
    let preparedAtEpochSeconds: TimeInterval
    let expiresAtEpochSeconds: TimeInterval
    let execution: String
    let syncScope: String
    let savedRouteValidated: Bool?
    let guidanceEnabled: Bool?
    let apiOrigin: String?
    let authMemberId: Int64?
    let loginGeneration: Int64?
  }

  struct Departure: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let sessionId: String
    let scheduleId: String
    let generation: Int64
    let routeRevision: Int64
    let clientOwnerId: String
    let routeInputDigest: String
    let eventKey: String
    let sequence: Int
    let type: String
    let occurredAtEpochSeconds: TimeInterval
    let execution: String
  }

  struct Envelope: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let routeJSON: String
    let binding: Binding
    let engine: Core.Snapshot
    let departure: Departure?
    let departureAcknowledged: Bool
    let bus: NoLateJourneyBusApproachCore.Snapshot?
    var completedLegSequence: Int64? = nil
  }

  enum Failure: Error, Equatable {
    case invalidBinding, invalidRoute, invalidEnvelope, expired, acknowledgementMismatch
  }

  let routeJSON: String
  let routeContext: String
  let routeLegs: [NoLateGuidanceRouteLeg]
  let binding: Binding
  private(set) var core: Core
  private(set) var departure: Departure?
  private(set) var departureAcknowledged = false
  private(set) var bus: NoLateJourneyBusApproachCore?
  // Live vehicle identity/history is deliberately NOT part of Envelope. A restored session
  // needs a new verified route binding and fresh independent observations before boarding.
  private(set) var ride: NoLateJourneyBusRideCore?
  // Subway references and passenger correlation are native-only and never restored as fact.
  private(set) var subway: NoLateJourneySubwayRideCore?
  var requestedSubwayLegIndex: Int? {
    guard !core.snapshot.status.isTerminal, !walkingHandoffCommitted,
      routeLegs.count > 1, routeLegs[1].kind == "SUBWAY" else { return nil }
    return 1
  }
  private(set) var alightingRoute: NoLateJourneyBusAlightingPolicy.Route?
  private(set) var separation: NoLateJourneyBusSeparationCore?
  // Final-walk handoff/motion is also memory-only. Cold restore needs new ride evidence.
  private(set) var finalWalk: NoLateJourneyFinalWalkCore?
  // A transfer reaches the next boarding point, never the journey destination.
  // Like the ride and final walk, its evidence deliberately does not survive restore.
  private(set) var transferWalk: NoLateJourneyTransferWalkCore?
  private(set) var completedLegSequence: Int64 = 0
  var walkingHandoffCommitted: Bool { finalWalk?.committed == true || transferWalk?.committed == true }
  /// No cursor is accepted from JS. Next occurrence is derived from this session's
  /// fresh walking handoff; a static route index is never a boarding confirmation.
  func requestedBusLegIndex(now:Double) -> Int? {
    guard !core.snapshot.status.isTerminal, now.isFinite, now >= core.snapshot.lastEvaluationAt,
      now < binding.expiresAtEpochSeconds, finalWalk?.committed != true else { return nil }
    if let transfer = transferWalk, transfer.committed {
      guard transfer.readyForNextTransit, transfer.route.nextTransitKind == "BUS",
        let until = transfer.snapshot.validUntil, now < until else { return nil }
      return transfer.route.nextTransitLegIndex
    }
    return bus?.snapshot.route.legIndex
  }
  func approachForAdmission(now:Double) -> NoLateJourneyBusApproachCore.Route? {
    guard let index = requestedBusLegIndex(now:now) else { return nil }
    if index == bus?.snapshot.route.legIndex { return bus?.snapshot.route }
    return NoLateJourneyRouteNormalizer.prepareBusApproachForLeg(json:routeJSON,legIndex:index,
      allowSynthetic:binding.syncScope == "SANDBOX")
  }
  let busUnavailableReason: String?
  var envelope: Envelope {
    Envelope(schemaVersion: 1, routeJSON: routeJSON, binding: binding, engine: core.snapshot,
             departure: departure, departureAcknowledged: departureAcknowledged, bus: bus?.snapshot,
             completedLegSequence:completedLegSequence == 0 ? nil : completedLegSequence)
  }
  var pendingDeparture: Departure? { core.snapshot.status.isTerminal || departureAcknowledged ? nil : departure }
  var inputSource: Core.InputSource { core.snapshot.route.provenance == .syntheticReplay ? .replay : .realLocation }

  init(routeJSON: String, bindingJSON: String, now: TimeInterval,
    rideRoute: NoLateJourneyBusRideCore.Route? = nil) throws {
    let binding = try Self.decodeBinding(bindingJSON, now: now)
    guard now < binding.expiresAtEpochSeconds else { throw Failure.expired }
    let prepared = try Self.prepare(routeJSON, binding: binding, now: now)
    self.routeJSON = routeJSON
    routeContext = prepared.context
    routeLegs = prepared.guidanceLegs
    self.binding = binding
    core = try Core(identity: Self.identity(binding), route: prepared.route,
                    armedAt: now, expiresAt: binding.expiresAtEpochSeconds)
    busUnavailableReason = prepared.busUnavailableReason
    bus = try prepared.busRoute.map { try NoLateJourneyBusApproachCore(identity: Self.identity(binding), route: $0,
      armedAt: now, expiresAt: binding.expiresAtEpochSeconds) }
    ride = try Self.prepareRide(rideRoute, binding: binding, approach: prepared.busRoute, armedAt: now)
    alightingRoute = Self.prepareAlighting(rideRoute, binding: binding, json: routeJSON)
    separation = alightingRoute == nil ? nil : rideRoute.map { NoLateJourneyBusSeparationCore(route:$0) }
    finalWalk = alightingRoute == nil ? nil : rideRoute.flatMap { NoLateJourneyFinalWalkCore.prepare(json:routeJSON,ride:$0) }.map { NoLateJourneyFinalWalkCore(route:$0) }
    transferWalk = alightingRoute == nil ? nil : rideRoute.flatMap { NoLateJourneyTransferWalkCore.prepare(json:routeJSON,ride:$0) }.map { NoLateJourneyTransferWalkCore(route:$0) }
  }

  init(restoring envelope: Envelope, routeJSON: String, bindingJSON: String, now: TimeInterval,
    rideRoute: NoLateJourneyBusRideCore.Route? = nil) throws {
    let binding = try Self.decodeBinding(bindingJSON, now: now)
    let prepared = try Self.prepare(routeJSON, binding: binding, now: now)
    guard envelope.schemaVersion == 1, envelope.routeJSON == routeJSON, envelope.binding == binding,
          envelope.engine.identity == Self.identity(binding), envelope.engine.route == prepared.route,
          envelope.engine.policy == Core.Policy(), envelope.engine.expiresAt == binding.expiresAtEpochSeconds,
          envelope.engine.armedAt >= binding.preparedAtEpochSeconds - 2,
          envelope.engine.armedAt < binding.expiresAtEpochSeconds else { throw Failure.invalidEnvelope }
    let hasDeparture = envelope.engine.departureEventKey != nil
    guard hasDeparture == (envelope.departure != nil),
          !envelope.departureAcknowledged || envelope.departure != nil else { throw Failure.invalidEnvelope }
    if let departure = envelope.departure {
      guard departure == Self.makeDeparture(binding, occurredAt: departure.occurredAtEpochSeconds),
            departure.occurredAtEpochSeconds.isFinite,
            departure.occurredAtEpochSeconds >= envelope.engine.armedAt - 0.001,
            departure.occurredAtEpochSeconds < binding.expiresAtEpochSeconds + 0.001,
            departure.occurredAtEpochSeconds <= now + 2 else { throw Failure.invalidEnvelope }
    }
    self.routeJSON = routeJSON
    routeContext = prepared.context
    routeLegs = prepared.guidanceLegs
    self.binding = binding
    core = try Core(restoring: envelope.engine, now: now)
    departure = envelope.departure
    departureAcknowledged = envelope.departureAcknowledged
    guard (0...9_007_199_254_740_991).contains(envelope.completedLegSequence ?? 0) else { throw Failure.invalidEnvelope }
    completedLegSequence = envelope.completedLegSequence ?? 0
    busUnavailableReason = prepared.busUnavailableReason
    let restoredApproach: NoLateJourneyBusApproachCore.Route?
    if let savedBus = envelope.bus {
      let index = savedBus.route.legIndex
      restoredApproach = index == 1 ? prepared.busRoute : NoLateJourneyRouteNormalizer.prepareBusApproachForLeg(json:routeJSON,
        legIndex:index,allowSynthetic:binding.syncScope == "SANDBOX")
      guard index == 1 || envelope.engine.status == .active || envelope.engine.status.isTerminal else { throw Failure.invalidEnvelope }
      guard let route = restoredApproach, savedBus.route == route, savedBus.identity == Self.identity(binding),
            savedBus.policy == NoLateJourneyBusApproachCore.Policy(), savedBus.armedAt == envelope.engine.armedAt,
            savedBus.expiresAt == binding.expiresAtEpochSeconds,
            envelope.engine.status.isTerminal || !savedBus.terminated else { throw Failure.invalidEnvelope }
      bus = try NoLateJourneyBusApproachCore(restoring: savedBus, now: now)
    } else {
      restoredApproach = prepared.busRoute
      // Pre-P2 envelopes had no bus snapshot. Recover with fresh evidence, never fabricate WAITING.
      bus = try prepared.busRoute.map {
        let fresh = try NoLateJourneyBusApproachCore(identity: Self.identity(binding), route: $0,
          armedAt: envelope.engine.armedAt, expiresAt: binding.expiresAtEpochSeconds)
        return try NoLateJourneyBusApproachCore(restoring: fresh.snapshot, now: now)
      }
    }
    ride = try Self.prepareRide(rideRoute, binding: binding, approach: restoredApproach, armedAt: envelope.engine.armedAt)
    alightingRoute = Self.prepareAlighting(rideRoute, binding: binding, json: routeJSON)
    separation = alightingRoute == nil ? nil : rideRoute.map { NoLateJourneyBusSeparationCore(route:$0) }
    finalWalk = alightingRoute == nil ? nil : rideRoute.flatMap { NoLateJourneyFinalWalkCore.prepare(json:routeJSON,ride:$0) }.map { NoLateJourneyFinalWalkCore(route:$0) }
    transferWalk = alightingRoute == nil ? nil : rideRoute.flatMap { NoLateJourneyTransferWalkCore.prepare(json:routeJSON,ride:$0) }.map { NoLateJourneyTransferWalkCore(route:$0) }
    if core.snapshot.status.isTerminal { bus?.stop(now: now); ride?.stop(); separation?.stop(); finalWalk?.stop(); transferWalk?.stop() }
  }

  /// True only when a new, valid, fresh location reaches the core's accepted-observation state.
  @discardableResult
  mutating func ingest(coordinate: Core.Coordinate, accuracy: Double, observedAt: TimeInterval, now: TimeInterval,
    vehicles: [NoLateJourneyBusRideCore.Vehicle] = [], subwayInput: NoLateSavedGuidanceSubwayPolicy.Input? = nil) -> Bool {
    guard !core.snapshot.status.isTerminal else { return false }
    let previousObservationAt = core.snapshot.lastObservationAt
    let previous = core.snapshot.lastObservationSequence ?? 0
    guard previous < Int64.max - 1 else { stop(now:now); return false }
    let events = core.ingest(.init(identity: core.snapshot.identity, sequence: previous + 1,
      observedAt: observedAt, coordinate: coordinate, horizontalAccuracyMeters: accuracy, source: inputSource), now: now)
    if let detected = events.first(where: { $0.type == .departed }), departure == nil {
      departure = Self.makeDeparture(binding, occurredAt: detected.observedAt)
    }
    var busAccepted = false
    if core.snapshot.status == .active {
      // Once departed, the old walking projection must not reject valid movement along the bus path.
      let observation = Core.Observation(identity: core.snapshot.identity, sequence: previous + 1,
        observedAt: observedAt, coordinate: coordinate, horizontalAccuracyMeters: accuracy, source: inputSource)
      if let input = subwayInput, now < input.validUntil,
        input.route.identity == core.snapshot.identity, input.route.legIndex == requestedSubwayLegIndex {
        if subway?.route != input.route {
          // A live correlation cannot silently replace its route. New evidence needs a new session.
          if subway == nil { subway = try? NoLateJourneySubwayRideCore(route:input.route,
            armedAt:core.snapshot.armedAt,expiresAt:binding.expiresAtEpochSeconds) }
        }
        if subway?.route == input.route { subway?.ingest(observation,trains:input.trains,now:now) }
      } else {
        // A train feed gap removes train evidence, not passenger GPS continuity.
        // Empty train input can only keep the movement chain and fail closed;
        // it cannot confirm boarding or advance a station marker.
        subway?.ingest(observation,trains:[],now:now)
      }
      if !walkingHandoffCommitted { busAccepted = bus?.ingest(observation, now: now) ?? false }
      if !walkingHandoffCommitted, let approach = bus?.snapshot {
        // Same original passenger fix, original vehicle source clocks, same immutable binding.
        // UI cannot supply a phase or a boardingConfirmed flag through this port.
        let priorRide = ride?.snapshot, associatedId = ride?.associatedVehicleId
        ride?.ingest(observation, approach: approach, vehicles: vehicles, now: now)
        separation?.ingest(observation,priorRide:priorRide,associatedId:associatedId,vehicles:vehicles,now:now)
        if ride?.snapshot.phase == "RIDING", let route = finalWalk?.route {
          // A renewed co-riding observation invalidates an uncommitted handoff.
          finalWalk = NoLateJourneyFinalWalkCore(route:route)
        }
        if ride?.snapshot.phase == "RIDING", let route = transferWalk?.route {
          transferWalk = NoLateJourneyTransferWalkCore(route:route)
        }
      }
      finalWalk?.ingest(observation,separation:separation?.snapshot,now:now)
      transferWalk?.ingest(observation,separation:separation?.snapshot,now:now)
      if walkingHandoffCommitted { ride?.stop() }
      if finalWalk?.arrived == true {
        core.finishNavigation(now:now)
        bus?.stop(now:now); ride?.stop(); separation?.stop(); finalWalk?.stop(); transferWalk?.stop()
      }
    } else if core.snapshot.status.isTerminal { bus?.stop(now: now); ride?.stop(); subway?.stop(); separation?.stop(); finalWalk?.stop(); transferWalk?.stop() }
    let rideAccepted = ride?.snapshot.phase == "RIDING" && ride?.snapshot.quality == "GOOD"
      && ride?.snapshot.observedAt == observedAt && ride?.snapshot.boardingConfirmed == true
    let walkAccepted = finalWalk?.snapshot.phase == "FINAL_WALK" && finalWalk?.snapshot.observedAt == observedAt
    let transferAccepted = transferWalk?.snapshot.phase == "TRANSFER_WALK" && transferWalk?.snapshot.observedAt == observedAt
    let subwayAccepted = ["RIDING","WAITING"].contains(subway?.snapshot.phase ?? "") && subway?.snapshot.observedAt == observedAt
    return subwayAccepted || transferAccepted || walkAccepted || rideAccepted || busAccepted || (!core.snapshot.status.isTerminal && core.snapshot.lastObservationAt == observedAt
      && previousObservationAt != observedAt)
  }

  mutating func tick(now: TimeInterval) {
    _ = core.tick(now: now)
    if core.snapshot.status.isTerminal { subway?.stop() } else { subway?.tick(now:now) }
    if core.snapshot.status.isTerminal { bus?.stop(now: now); ride?.stop(); separation?.stop(); finalWalk?.stop(); transferWalk?.stop() }
    else { bus?.tick(now: now); ride?.tick(now: now); separation?.tick(now:now); finalWalk?.tick(now:now); transferWalk?.tick(now:now) }
  }
  mutating func stop(now: TimeInterval) { _ = core.stop(now: now); bus?.stop(now: now); ride?.stop(); subway?.stop(); separation?.stop(); finalWalk?.stop(); transferWalk?.stop() }

  /// Called only with a freshly fenced authenticated transport admission. Repeated equal
  /// leases do not reset history; a changed binding can never replace a live ride.
  mutating func connectRide(_ route: NoLateJourneyBusRideCore.Route, now:Double? = nil) throws {
    let now = now ?? core.snapshot.lastEvaluationAt
    guard let expected = approachForAdmission(now:now), route.approach == expected else { throw Failure.invalidRoute }
    if route.approach.legIndex != bus?.snapshot.route.legIndex {
      // Validate all throwing constructors before replacing any current evidence.
      let nextBus = try NoLateJourneyBusApproachCore(identity:core.snapshot.identity,route:expected,
        armedAt:core.snapshot.armedAt,expiresAt:binding.expiresAtEpochSeconds)
      let nextRide = try Self.prepareRide(route,binding:binding,approach:expected,armedAt:core.snapshot.armedAt)
      retireEvidence(includingBus:true)
      bus?.stop(now:now);ride?.stop();separation?.stop();finalWalk?.stop();transferWalk?.stop()
      bus = nextBus;ride = nextRide
    } else {
      if let ride { guard ride.route == route else { throw Failure.invalidRoute }; return }
      ride = try Self.prepareRide(route, binding: binding, approach: expected, armedAt: core.snapshot.armedAt)
    }
    alightingRoute = Self.prepareAlighting(route, binding: binding, json: routeJSON)
    separation = alightingRoute == nil ? nil : NoLateJourneyBusSeparationCore(route:route)
    finalWalk = alightingRoute == nil ? nil : NoLateJourneyFinalWalkCore.prepare(json:routeJSON,ride:route).map { NoLateJourneyFinalWalkCore(route:$0) }
    transferWalk = alightingRoute == nil ? nil : NoLateJourneyTransferWalkCore.prepare(json:routeJSON,ride:route).map { NoLateJourneyTransferWalkCore(route:$0) }
  }
  /// Missing/expired vehicle admission is distinct from explicit session revocation.
  mutating func expireRideAdmission() {
    // Vehicle polling intentionally stops once a validated handoff commits. Keep only
    // that in-memory walking state; tick/authentication/stop still fence its lifetime.
    guard !walkingHandoffCommitted else { return }
    disconnectRide()
  }
  mutating func disconnectRide() { retireEvidence(includingBus:false); ride?.stop(); ride = nil; alightingRoute = nil; separation?.stop(); separation = nil; finalWalk?.stop(); finalWalk = nil; transferWalk?.stop(); transferWalk = nil }
  private mutating func retireEvidence(includingBus:Bool) {
    for value in [includingBus ? bus?.snapshot.sequence ?? 0 : 0,ride?.snapshot.sequence ?? 0,
      finalWalk?.snapshot.sequence ?? 0,transferWalk?.snapshot.sequence ?? 0] {
      let sum=completedLegSequence.addingReportingOverflow(value)
      completedLegSequence = sum.overflow ? Int64.max : sum.partialValue
    }
  }
  private static func prepareAlighting(_ route: NoLateJourneyBusRideCore.Route?, binding: Binding, json: String) -> NoLateJourneyBusAlightingPolicy.Route? {
    guard let route, binding.savedRouteValidated == true, binding.guidanceEnabled == true else { return nil }
    return NoLateJourneyBusAlightingPolicy.prepare(json:json, ride:route)
  }

  /// Native-only admission port. Caller must establish provider route/direction/shape mapping
  /// independently; a route ID parsed from UI/route JSON alone is NOT such admission.
  /// Runtime intentionally supplies nil until the R1 mapping/vehicle adapter is verified.
  private static func prepareRide(_ route: NoLateJourneyBusRideCore.Route?, binding: Binding,
    approach: NoLateJourneyBusApproachCore.Route?, armedAt: Double) throws -> NoLateJourneyBusRideCore? {
    guard let route else { return nil }
    guard ["SANDBOX", "AUTHENTICATED"].contains(binding.syncScope),
      route.identity == identity(binding), route.approach == approach else { throw Failure.invalidRoute }
    return try NoLateJourneyBusRideCore(route: route, armedAt: armedAt, expiresAt: binding.expiresAtEpochSeconds)
  }

  mutating func acknowledge(eventKey: String, bindingJSON: String, now: TimeInterval) throws {
    let expected = try Self.decodeBinding(bindingJSON, now: now)
    guard expected == binding, let departure, departure.eventKey == eventKey,
          !core.snapshot.status.isTerminal, now < binding.expiresAtEpochSeconds else { throw Failure.acknowledgementMismatch }
    departureAcknowledged = true
  }

  static func decodeBinding(_ json: String, now: TimeInterval) throws -> Binding {
    guard !json.isEmpty, json.utf8.count <= 8_192 else { throw Failure.invalidBinding }
    let binding: Binding
    do { binding = try JSONDecoder().decode(Binding.self, from: Data(json.utf8)) }
    catch { throw Failure.invalidBinding }
    let safe = Int64(9_007_199_254_740_991)
    guard UUID(uuidString: binding.sessionId) != nil, binding.sessionId.utf8.count == 36,
          UUID(uuidString: binding.clientOwnerId) != nil, binding.clientOwnerId.utf8.count == 36,
          !binding.scheduleId.isEmpty, binding.scheduleId.utf8.count <= 32,
          binding.scheduleId.utf8.allSatisfy({ (48...57).contains($0) }),
          (1...safe).contains(binding.generation), (1...safe).contains(binding.routeRevision),
          binding.routeInputDigest.utf8.count == 64,
          binding.routeInputDigest.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
          ["SIMULATOR", "DEVICE"].contains(binding.execution),
          (binding.execution == "SIMULATOR" || binding.syncScope == "AUTHENTICATED"),
          ["LOCAL_ONLY", "SANDBOX", "AUTHENTICATED"].contains(binding.syncScope),
          now.isFinite, binding.preparedAtEpochSeconds.isFinite, binding.expiresAtEpochSeconds.isFinite,
          binding.preparedAtEpochSeconds > 0, binding.preparedAtEpochSeconds <= now + 2,
          binding.expiresAtEpochSeconds > binding.preparedAtEpochSeconds,
          binding.expiresAtEpochSeconds - binding.preparedAtEpochSeconds <= (binding.syncScope == "AUTHENTICATED" ? 7200 : 600) else { throw Failure.invalidBinding }
    if binding.syncScope == "AUTHENTICATED" {
      guard let origin = binding.apiOrigin, NoLateJourneyAuthentication.origin(origin) != nil,
        let member = binding.authMemberId, (1...safe).contains(member),
        let login = binding.loginGeneration, (0...safe).contains(login),
        binding.savedRouteValidated == true, binding.guidanceEnabled == true else { throw Failure.invalidBinding }
    }
    return binding
  }

  static func digest(_ routeJSON: String) -> String {
    SHA256.hash(data: Data(routeJSON.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  /// A terminal receipt may revoke only its own dormant checkpoint, never a live/new binding.
  static func canReconcileTerminal(expected: Binding, checkpoint: Binding?, live: Binding?, hasLiveSession: Bool) -> Bool {
    !hasLiveSession && (checkpoint == nil || checkpoint == expected) && (live == nil || live == expected)
  }

  private static func prepare(_ routeJSON: String, binding: Binding, now:Double) throws -> NoLateJourneyRouteNormalizer.PreparedWalkingRoute {
    guard routeJSON.utf8.count <= 1_048_576, digest(routeJSON) == binding.routeInputDigest else { throw Failure.invalidRoute }
    let input = try JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self,from:Data(routeJSON.utf8))
    if binding.expiresAtEpochSeconds-binding.preparedAtEpochSeconds > 600 {
      guard input.walkingSnapshot?.schemaVersion == 4 else { throw Failure.invalidRoute }
    }
    if let walking = input.walkingSnapshot { try walking.validate(input:input); try walking.validate(binding:binding,now:now) }
    let prepared = try NoLateJourneyRouteNormalizer.prepareWalkingRoute(json: routeJSON, allowSyntheticSandbox: binding.syncScope == "SANDBOX",
      allowValidatedSavedRoute: ["SANDBOX", "AUTHENTICATED"].contains(binding.syncScope) && binding.savedRouteValidated == true)
    guard prepared.routeRevision == binding.routeRevision else { throw Failure.invalidRoute }
    return prepared
  }

  private static func identity(_ binding: Binding) -> Core.Identity {
    .init(sessionId: binding.sessionId, generation: binding.generation, routeRevision: binding.routeRevision, epoch: 1)
  }

  private static func makeDeparture(_ binding: Binding, occurredAt: TimeInterval) -> Departure {
    Departure(schemaVersion: 1, sessionId: binding.sessionId, scheduleId: binding.scheduleId,
      generation: binding.generation, routeRevision: binding.routeRevision, clientOwnerId: binding.clientOwnerId,
      routeInputDigest: binding.routeInputDigest,
      eventKey: "\(binding.sessionId):\(binding.generation):\(binding.routeRevision):AUTO_DEPARTURE",
      sequence: 1, type: "AUTO_DEPARTURE", occurredAtEpochSeconds: (occurredAt * 1_000).rounded() / 1_000,
      execution: binding.execution)
  }
}

/// A good location must not hide storage, permission, binding, or acknowledgement failures.
enum NoLateJourneyAutomaticLocationErrorPolicy {
  /// Explicit stop no longer consumes locations. Keep persistent failures visible;
  /// revocation can still replace this result with AUTOMATIC_REVOCATION_FAILED.
  static func afterExplicitStop(_ error: String?) -> String? {
    error == "LOCATION_TEMPORARILY_UNAVAILABLE" ? nil : error
  }
  static func afterCommittedObservation(_ error: String?, acceptedFreshObservation: Bool) -> String? {
    acceptedFreshObservation && error == "LOCATION_TEMPORARILY_UNAVAILABLE" ? nil : error
  }
}
