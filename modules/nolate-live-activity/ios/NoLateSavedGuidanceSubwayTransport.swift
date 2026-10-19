#if DEBUG
import Foundation

/// Same authenticated fixed-origin transport and immutable session fence as bus input.
/// No JS train/phase input, retries, persisted train IDs or passenger GPS uploads.
@MainActor final class NoLateSavedGuidanceSubwayTransport {
  private var task: Task<Void, Never>?
  private var token: UUID?
  private var binding: NoLateJourneyAutomaticSession.Binding?
  private var raw: Data?
  private var deadline: ContinuousClock.Instant?
  private var nextAt = 0.0
  private(set) var status = "NOT_REQUESTED"
  private let authentication: () -> NoLateJourneyAuthentication?
  private let changed: () -> Void
  init(authentication: @escaping () -> NoLateJourneyAuthentication?, changed: @escaping () -> Void) {
    self.authentication = authentication; self.changed = changed
  }
  func clear() {
    task?.cancel(); task = nil; token = nil; binding = nil; raw = nil
    deadline = nil; nextAt = 0; status = "NOT_REQUESTED"
  }
  func input(session: NoLateJourneyAutomaticSession, now: Double) -> NoLateSavedGuidanceSubwayPolicy.Input? {
    guard binding == session.binding, let deadline, ContinuousClock.now < deadline, let raw,
      authentication()?.matches(session.binding,now:now) == true else { return nil }
    return NoLateSavedGuidanceSubwayPolicy.decode(raw,session:session,now:now)
  }
  func update(session: NoLateJourneyAutomaticSession?, now: Double) {
    guard let session, session.binding.syncScope == "AUTHENTICATED", let index = session.requestedSubwayLegIndex,
      session.binding.savedRouteValidated == true, session.binding.guidanceEnabled == true,
      now < session.binding.expiresAtEpochSeconds, authentication()?.matches(session.binding,now:now) == true else { clear(); return }
    if binding != session.binding { clear(); binding = session.binding }
    guard task == nil, now >= nextAt else { return }
    let token = UUID(); self.token = token
    let auth = authentication()
    let body: [String: Any] = ["generation":session.binding.generation,"routeRevision":session.binding.routeRevision,
      "clientOwnerId":session.binding.clientOwnerId,"routeInputDigest":session.binding.routeInputDigest,"subwayLegIndex":index]
    task = Task { @MainActor [weak self] in
      var received: Data?
      var until: Double?
      do {
        let data = try await NoLateSavedGuidanceArrivalTransport.post(session:session,auth:auth,suffix:"/subway-observation/input",body:body)
        try Task.checkCancellation()
        if let parsed = NoLateSavedGuidanceSubwayPolicy.decode(data,session:session,now:Date().timeIntervalSince1970) {
          received = data; until = parsed.validUntil
        }
      } catch { /* No error URL/token/body, old observations are not freshened. */ }
      guard let self, !Task.isCancelled, self.token == token, self.binding == session.binding else { return }
      self.task = nil; self.raw = received
      self.deadline = until.map { ContinuousClock.now.advanced(by:.seconds(max(0,$0-Date().timeIntervalSince1970))) }
      self.status = received == nil ? "SUBWAY_INPUT_UNAVAILABLE" : "SUBWAY_INPUT_WAITING_FOR_PASSENGER_EVIDENCE"
      self.nextAt = Date().timeIntervalSince1970 + 11
      self.changed()
    }
  }
}
#endif
