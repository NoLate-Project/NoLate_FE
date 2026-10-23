import Foundation

/// Debug simulator transport. Sandbox is credential-free; authenticated requests require an ephemeral identity/origin fence.
@MainActor final class NoLateSavedGuidanceArrivalTransport {
  private final class RedirectBlocker: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
      newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  }
  private var task: Task<Void, Never>?
  private var token: UUID?
  private var binding: NoLateJourneyAutomaticSession.Binding?
  private var legIndex: Int?
  private var query: NoLateSavedGuidanceArrivalPolicy.Query?
  private var raw: Data?
  private var status = "NOT_REQUESTED"
  private var nextAt = 0.0
  private var leaseTask: Task<Void, Never>?
  private var leaseToken: UUID?
  private var leaseBinding: NoLateJourneyAutomaticSession.Binding?
  private var leaseUntil = 0.0
  private var leaseDeadline: ContinuousClock.Instant?
  private var nextLeaseAt = 0.0
  private let changed: () -> Void
  private let authentication: () -> NoLateJourneyAuthentication?
  init(authentication: @escaping () -> NoLateJourneyAuthentication?, changed: @escaping () -> Void) {
    self.authentication = authentication; self.changed = changed
  }
  private func allowed(_ session: NoLateJourneyAutomaticSession, now: Double) -> Bool {
    if session.binding.syncScope == "SANDBOX" { return session.binding.scheduleId == "9001" }
    return authentication()?.matches(session.binding, now: now) == true
  }
  func clear() {
    leaseTask?.cancel(); leaseTask = nil; leaseToken = nil; leaseBinding = nil
    leaseUntil = 0; leaseDeadline = nil; nextLeaseAt = 0
    clearArrivals()
  }
  private func clearArrivals() {
    task?.cancel(); task = nil; token = nil; binding = nil; legIndex = nil; query = nil; raw = nil; nextAt = 0; status = "NOT_REQUESTED"
  }
  /// Independent of GPS freshness, approach phase, and provider mapping. Runs while native location is alive.
  func validateLifetime(session: NoLateJourneyAutomaticSession?, now: Double, rejected: @escaping (String) -> Void) {
    guard let session, !session.core.snapshot.status.isTerminal,
      session.binding.savedRouteValidated == true, session.binding.guidanceEnabled == true,
      allowed(session, now: now) else { clear(); return }
    if leaseBinding != session.binding {
      clear(); leaseBinding = session.binding
      leaseUntil = min(now + 30, session.binding.expiresAtEpochSeconds)
      leaseDeadline = ContinuousClock.now.advanced(by: .seconds(max(0, leaseUntil - now)))
    }
    guard now < leaseUntil, let leaseDeadline, ContinuousClock.now < leaseDeadline else {
      clear(); rejected("SAVED_SESSION_VALIDATION_EXPIRED"); return
    }
    guard leaseTask == nil, now >= nextLeaseAt else { return }
    nextLeaseAt = now + 10
    let leaseToken = UUID(); self.leaseToken = leaseToken
    let auth = authentication()
    let body: [String: Any] = ["generation": session.binding.generation, "routeRevision": session.binding.routeRevision,
      "clientOwnerId": session.binding.clientOwnerId, "routeInputDigest": session.binding.routeInputDigest]
    leaseTask = Task { @MainActor [weak self] in
      var until: Double?
      var reason: String?
      do {
        let data = try await Self.post(session: session, auth: auth, suffix: "/validate", body: body)
        try Task.checkCancellation()
        until = NoLateSavedGuidanceLeasePolicy.validUntil(data, binding: session.binding, now: Date().timeIntervalSince1970)
        if until == nil { reason = "SAVED_SESSION_VALIDATION_REJECTED" }
      } catch LifetimeError.rejected { reason = "SAVED_SESSION_VALIDATION_REJECTED" }
      catch { /* Transient failure cannot extend the previous lease. */ }
      guard let self, !Task.isCancelled, self.leaseToken == leaseToken, self.leaseBinding == session.binding else { return }
      self.leaseTask = nil
      if let reason { self.clear(); rejected(reason); return }
      if let until {
        self.leaseUntil = until
        self.leaseDeadline = ContinuousClock.now.advanced(by: .seconds(max(0, until - Date().timeIntervalSince1970)))
      }
    }
  }
  func result(session: NoLateJourneyAutomaticSession?, now: Double) -> NoLateSavedGuidanceArrivalPolicy.Result {
    guard let session, NoLateSavedGuidanceArrivalPolicy.eligible(session, now: now) else { return .init("LOCATION_OR_SESSION_UNAVAILABLE") }
    guard binding == session.binding,legIndex == session.bus?.snapshot.route.legIndex, let query, let raw else { return .init(status) }
    return NoLateSavedGuidanceArrivalPolicy.observe(raw, session: session, query: query, now: now)
  }
  func update(session: NoLateJourneyAutomaticSession?, now: Double) {
    guard let session, allowed(session, now: now), NoLateSavedGuidanceArrivalPolicy.eligible(session, now: now) else { clearArrivals(); return }
    guard NoLateSavedGuidanceArrivalPolicy.supportedInput(session) else { clearArrivals(); status = "UNSUPPORTED_SAVED_MAPPING"; return }
    guard let index=session.bus?.snapshot.route.legIndex else { clearArrivals(); return }
    if binding != session.binding || legIndex != index { clearArrivals(); binding = session.binding; legIndex = index }
    guard task == nil, now >= nextAt else { return }
    nextAt = now + 10
    let token = UUID(); self.token = token
    let auth = authentication()
    let body: [String: Any] = ["generation": session.binding.generation, "routeRevision": session.binding.routeRevision,
      "clientOwnerId": session.binding.clientOwnerId, "routeInputDigest": session.binding.routeInputDigest,"busLegIndex":index]
    task = Task { @MainActor [weak self] in
      var query: NoLateSavedGuidanceArrivalPolicy.Query?
      var response: Data?
      var status = "ARRIVAL_UNAVAILABLE"
      do {
        let mapping = try await Self.post(session: session, auth: auth, suffix: "/bus-arrivals/binding", body: body)
        try Task.checkCancellation()
        if let canonical = NoLateSavedGuidanceArrivalPolicy.binding(mapping, session: session) {
          query = canonical
          var request = body
          request.removeValue(forKey:"busLegIndex") // observation index is the exact canonical query occurrence
          request["query"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(canonical))
          response = try await Self.post(session: session, auth: auth, suffix: "/bus-arrivals", body: request)
          try Task.checkCancellation()
        } else { status = "SAVED_ROUTE_MAPPING_UNAVAILABLE" }
      } catch { status = "ARRIVAL_UNAVAILABLE" }
      guard let self, !Task.isCancelled, self.token == token, self.binding == session.binding,self.legIndex == index else { return }
      self.task = nil; self.query = query; self.raw = response; self.status = status
      self.changed()
    }
  }
  private enum LifetimeError: Error { case rejected }
  static func refreshRequest(apiOrigin: String, refreshToken: String) async -> [String: Any] {
    guard (Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyProductEnabled") as? Bool == true ||
      Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyDiagnosticsEnabled") as? Bool == true),
      Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyAuthenticatedEnabled") as? Bool == true else { return ["available": false] }
    // Refresh endpoint verifies REFRESH signature/type/current generation server-side.
    // No access credential is required here, and redirects cannot replay the refresh body.
    guard NoLateJourneyAuthentication.origin(apiOrigin) != nil,
      refreshToken.utf8.count <= 8192, !refreshToken.isEmpty,
      let url = URL(string: apiOrigin + "/api/member/auth/refresh") else {
      return ["available": true, "accepted": false, "errorCode": "AUTOMATIC_SERVER_REJECTED"]
    }
    do {
      let data = try await request(url: url, body: ["refreshToken": refreshToken], accessToken: nil)
      guard data.count <= 65536 else { throw URLError(.dataLengthExceedsMaximum) }
      return ["available": true, "accepted": true, "responseJSON": String(decoding: data, as: UTF8.self)]
    } catch LifetimeError.rejected { return ["available": true, "accepted": false, "errorCode": "AUTOMATIC_SERVER_REJECTED"] }
    catch { return ["available": true, "accepted": false, "errorCode": "AUTOMATIC_SERVER_UNAVAILABLE"] }
  }
  static func authenticatedRequest(authJSON: String, path: String, bodyJSON: String) async -> [String: Any] {
    guard (Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyProductEnabled") as? Bool == true ||
      Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyDiagnosticsEnabled") as? Bool == true),
      Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyAuthenticatedEnabled") as? Bool == true else { return ["accepted": false, "errorCode": "AUTOMATIC_SERVER_REJECTED"] }
    guard authJSON.utf8.count <= 12288, bodyJSON.utf8.count <= 1100000,
      let auth = try? JSONDecoder().decode(NoLateJourneyAuthentication.self, from: Data(authJSON.utf8)) else { return ["accepted": false, "errorCode": "AUTOMATIC_SERVER_REJECTED"] }
    guard auth.valid(now: Date().timeIntervalSince1970) else { return ["accepted": false, "errorCode": "AUTOMATIC_SERVER_REJECTED"] }
    guard
      path.range(of: "^/api/schedules/[1-9][0-9]{0,17}/automatic-journey/(prepare-saved|[a-f0-9-]{36}/(departure|validate|stop|reconcile|live-activity))$", options: .regularExpression) != nil,
      let body = (try? JSONSerialization.jsonObject(with: Data(bodyJSON.utf8))) as? [String: Any],
      let url = URL(string: auth.apiOrigin + path) else { return ["accepted": false, "errorCode": "AUTOMATIC_SERVER_REJECTED"] }
    if path.hasSuffix("/live-activity"), Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyAPNsPilotEnabled") as? Bool != true {
      return ["accepted": false, "errorCode": "AUTOMATIC_SERVER_REJECTED"]
    }
    do {
      let data = try await request(url: url, body: body, accessToken: auth.accessToken)
      guard data.count <= 65536, auth.valid(now: Date().timeIntervalSince1970) else { throw LifetimeError.rejected }
      return ["accepted": true, "responseJSON": String(decoding: data, as: UTF8.self)]
    } catch LifetimeError.rejected { return ["accepted": false, "errorCode": "AUTOMATIC_SERVER_REJECTED"] }
    catch { return ["accepted": false, "errorCode": "AUTOMATIC_SERVER_UNAVAILABLE"] }
  }
  static func post(session: NoLateJourneyAutomaticSession, auth: NoLateJourneyAuthentication?, suffix: String, body: [String: Any]) async throws -> Data {
    guard UUID(uuidString: session.binding.sessionId) != nil,
      NoLateJourneyObservationPathPolicy.allows(suffix,scope:session.binding.syncScope) else { throw URLError(.badURL) }
    let origin: String
    if session.binding.syncScope == "AUTHENTICATED" {
      guard let auth, auth.matches(session.binding, now: Date().timeIntervalSince1970) else { throw LifetimeError.rejected }
      origin = auth.apiOrigin
    } else {
      guard session.binding.syncScope == "SANDBOX", session.binding.scheduleId == "9001" else { throw URLError(.badURL) }
      origin = "http://127.0.0.1:15543"
    }
    guard let url = URL(string: "\(origin)/api/schedules/\(session.binding.scheduleId)/automatic-journey/\(session.binding.sessionId)\(suffix)") else { throw URLError(.badURL) }
    return try await request(url: url, body: body, accessToken: session.binding.syncScope == "AUTHENTICATED" ? auth?.accessToken : nil)
  }
  private static func request(url: URL, body: [String: Any], accessToken: String?) async throws -> Data {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil; config.urlCredentialStorage = nil; config.urlCache = nil
    config.timeoutIntervalForRequest = 4; config.timeoutIntervalForResource = 6
    let client = URLSession(configuration: config, delegate: RedirectBlocker(), delegateQueue: nil)
    defer { client.invalidateAndCancel() }
    var request = URLRequest(url: url); request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let accessToken { request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization") }
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (stream, response) = try await client.bytes(for: request)
    guard let http = response as? HTTPURLResponse, http.url == url else { throw URLError(.badServerResponse) }
    if NoLateSavedGuidanceLeasePolicy.terminalHTTP(http.statusCode) { throw LifetimeError.rejected }
    guard (200...299).contains(http.statusCode) else { throw URLError(.badServerResponse) }
    var data = Data()
    for try await byte in stream {
      try Task.checkCancellation()
      guard data.count < 262144 else { throw URLError(.dataLengthExceedsMaximum) }
      data.append(byte)
    }
    return data
  }
}
