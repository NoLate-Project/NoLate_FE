#if DEBUG
import Foundation

/// Authenticated native-only, ephemeral vehicle input. Never derives buses from user GPS.
@MainActor final class NoLateSavedGuidanceRideTransport {
  typealias Policy = NoLateSavedGuidanceRidePolicy
  private var task: Task<Void, Never>?
  private var token: UUID?
  private var binding: NoLateJourneyAutomaticSession.Binding?
  private var legIndex: Int?
  private var admitted: Policy.Admission?
  private var raw: Data?
  private var nextAt = 0.0
  private var deadline: ContinuousClock.Instant?
  private(set) var status = "NOT_REQUESTED"
  private let authentication: () -> NoLateJourneyAuthentication?
  private let changed: () -> Void
  init(authentication: @escaping () -> NoLateJourneyAuthentication?, changed: @escaping () -> Void) {
    self.authentication = authentication; self.changed = changed
  }
  func clear() {
    task?.cancel(); task = nil; token = nil; binding = nil; legIndex = nil; admitted = nil; raw = nil
    deadline = nil; nextAt = 0; status = "NOT_REQUESTED"
  }
  func admission(session: NoLateJourneyAutomaticSession, now: Double) -> Policy.Admission? {
    guard binding == session.binding, legIndex == session.requestedBusLegIndex(now:now),
      let admitted, admitted.route.approach == session.approachForAdmission(now:now), now < admitted.validUntil,
      let deadline, ContinuousClock.now < deadline,
      authentication()?.matches(session.binding, now: now) == true else { return nil }
    return admitted
  }
  func vehicles(session: NoLateJourneyAutomaticSession, now: Double) -> [NoLateJourneyBusRideCore.Vehicle] {
    guard let admitted = admission(session: session, now: now), let raw else { return [] }
    return Policy.vehicles(raw, session: session, admission: admitted, now: now)
  }
  func update(session: NoLateJourneyAutomaticSession?, now: Double) {
    guard let session, session.binding.syncScope == "AUTHENTICATED",
      session.binding.savedRouteValidated == true, session.binding.guidanceEnabled == true,
      !session.core.snapshot.status.isTerminal, let index = session.requestedBusLegIndex(now:now),
      authentication()?.matches(session.binding, now: now) == true else { clear(); return }
    if binding != session.binding || legIndex != index { clear(); binding = session.binding; legIndex = index }
    guard task == nil, now >= nextAt else { return }
    let token = UUID(); self.token = token
    let auth = authentication()
    let body: [String: Any] = ["generation": session.binding.generation, "routeRevision": session.binding.routeRevision,
      "clientOwnerId": session.binding.clientOwnerId, "routeInputDigest": session.binding.routeInputDigest,"busLegIndex":index]
    task = Task { @MainActor [weak self] in
      var admission: Policy.Admission?
      var response: Data?
      var status = "RIDE_TRANSPORT_UNAVAILABLE"
      do {
        let data = try await NoLateSavedGuidanceArrivalTransport.post(session: session, auth: auth, suffix: "/bus-ride/binding", body: body)
        try Task.checkCancellation()
        if let next = Policy.admission(data, session: session, now: Date().timeIntervalSince1970) {
          admission = next; status = "VERIFIED_ROUTE_WAITING_FOR_GPS"
          if session.core.snapshot.status == .active {
            response = try await NoLateSavedGuidanceArrivalTransport.post(session: session, auth: auth, suffix: "/bus-ride", body: body)
            try Task.checkCancellation()
            status = Policy.vehicleStatus(response!, session: session)
          }
        } else { status = "VERIFIED_RIDE_BINDING_UNAVAILABLE" }
      } catch { /* Discard current response; never freshen the last vehicle receipt. */ }
      guard let self, !Task.isCancelled, self.token == token, self.binding == session.binding, self.legIndex == index else { return }
      self.task = nil; self.admitted = admission; self.raw = response; self.status = status
      // The server cooldown starts when it admits the observation request, not when
      // the client starts its preceding binding request. Leave a margin after completion.
      self.nextAt = Policy.nextPollAt(completedAt: Date().timeIntervalSince1970)
      self.deadline = admission.map { ContinuousClock.now.advanced(by: .seconds(max(0, $0.validUntil - Date().timeIntervalSince1970))) }
      self.changed()
    }
  }
}
#endif
