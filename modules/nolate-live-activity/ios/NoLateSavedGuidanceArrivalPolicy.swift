import Foundation

/// Memory-only credential snapshot; never encoded into a checkpoint, departure or Activity.
struct NoLateJourneyAuthentication: Decodable, Sendable {
  let accessToken: String
  let apiOrigin: String
  let authMemberId: Int64
  let loginGeneration: Int64
  let expiresAtEpochSeconds: Double
  static func origin(_ value: String) -> URL? {
    guard value.utf8.count <= 256, value.range(of: "^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[1-9][0-9]{0,4})?$", options: .regularExpression) != nil,
      let c = URLComponents(string: value), c.user == nil, c.password == nil,
      c.query == nil, c.fragment == nil, c.path.isEmpty, c.port != 15543,
      let host = c.host, !host.isEmpty, let url = c.url, url.absoluteString == value else { return nil }
    if let port = c.port, port > 65535 || (c.scheme == "https" && port == 443) || (c.scheme == "http" && port == 80) { return nil }
    if c.scheme == "https" { return url }
    // An ad-hoc signed Release simulator runs the isolated loopback E2E server.
    // Physical iOS builds stay HTTPS-only in every configuration.
    #if targetEnvironment(simulator) || os(macOS)
    if c.scheme == "http", ["127.0.0.1", "localhost"].contains(host) { return url }
    #endif
    return nil
  }
  func valid(now: Double) -> Bool {
    let safe: Int64 = 9_007_199_254_740_991
    guard Self.origin(apiOrigin) != nil, (1...safe).contains(authMemberId), (0...safe).contains(loginGeneration),
      accessToken.utf8.count <= 8192, expiresAtEpochSeconds.isFinite, expiresAtEpochSeconds > now else { return false }
    let parts = accessToken.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 } }) else { return false }
    var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    encoded += String(repeating: "=", count: (4 - encoded.utf8.count % 4) % 4)
    guard let data = Data(base64Encoded: encoded), let claims = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      claims["type"] as? String == "ACCESS", claims["sub"] as? String == String(authMemberId),
      let sg = claims["sg"] as? NSNumber, CFGetTypeID(sg) != CFBooleanGetTypeID(), sg.doubleValue == Double(loginGeneration),
      let exp = claims["exp"] as? NSNumber, CFGetTypeID(exp) != CFBooleanGetTypeID(), exp.doubleValue == expiresAtEpochSeconds,
      let iat = claims["iat"] as? NSNumber, CFGetTypeID(iat) != CFBooleanGetTypeID(),
      iat.doubleValue.isFinite, iat.doubleValue <= now + 5, exp.doubleValue > iat.doubleValue else { return false }
    // Signature and issuer are deliberately verified only by the authenticated server.
    return true
  }
  /// A live rotation cannot change identity, shorten expiry or replace a newer credential.
  func canReplace(_ previous: NoLateJourneyAuthentication, expectedToken: String,
                  binding: NoLateJourneyAutomaticSession.Binding, now: Double) -> Bool {
    previous.accessToken == expectedToken && previous.matches(binding, now: now)
      && matches(binding, now: now) && expiresAtEpochSeconds >= previous.expiresAtEpochSeconds
      && now < binding.expiresAtEpochSeconds
  }
  func matches(_ binding: NoLateJourneyAutomaticSession.Binding, now: Double) -> Bool {
    valid(now: now) && binding.syncScope == "AUTHENTICATED" && binding.apiOrigin == apiOrigin
      && binding.authMemberId == authMemberId && binding.loginGeneration == loginGeneration
  }
  /// Long navigation must be covered before arm/restore; no refresh secret is stored here.
  func coversNavigation(_ binding: NoLateJourneyAutomaticSession.Binding, now: Double) -> Bool {
    matches(binding, now: now) && (binding.expiresAtEpochSeconds - binding.preparedAtEpochSeconds <= 600.001
      || expiresAtEpochSeconds >= binding.expiresAtEpochSeconds + 30)
  }
}

/// A server lease validates account/route/session lifetime, not GPS quality or boarding.
enum NoLateSavedGuidanceLeasePolicy {
  private struct Envelope: Decodable {
    struct Lease: Decodable {
      let schemaVersion: Int, sessionId: String, scheduleId: String, generation: Int64, routeRevision: Int64
      let clientOwnerId: String, routeInputDigest: String, execution: String, state: String
      let validatedAt: String, validUntil: String
    }
    let success: Bool, data: Lease
  }
  static func validUntil(_ data: Data, binding: NoLateJourneyAutomaticSession.Binding, now: Double) -> Double? {
    guard data.count <= 65536, now.isFinite,
      let response = try? JSONDecoder().decode(Envelope.self, from: data), response.success else { return nil }
    let value = response.data
    guard value.schemaVersion == 1, value.sessionId == binding.sessionId, value.scheduleId == binding.scheduleId,
      value.generation == binding.generation, value.routeRevision == binding.routeRevision,
      value.clientOwnerId == binding.clientOwnerId, value.routeInputDigest == binding.routeInputDigest,
      value.execution == binding.execution, ["ARMED", "ACTIVE"].contains(value.state),
      let validated = instant(value.validatedAt), let until = instant(value.validUntil),
      validated >= binding.preparedAtEpochSeconds, validated <= now + 5, until > now,
      until > validated, until <= validated + 30, until <= binding.expiresAtEpochSeconds else { return nil }
    return min(until, now + 30)
  }
  static func terminalHTTP(_ status: Int) -> Bool { [400, 401, 403, 404, 409, 410, 422].contains(status) }
  private static func instant(_ value: String) -> Double? {
    guard value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z$", options: .regularExpression) != nil else { return nil }
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date.timeIntervalSince1970 }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)?.timeIntervalSince1970
  }
}

/// Saved-route metadata parity is not vehicle tracking or proof that the user boarded.
enum NoLateSavedGuidanceArrivalPolicy {
  struct Query: Codable, Equatable, Sendable {
    let namespace: String, arsId: String, providerRouteId: String, directionLabel: String
    let legIndex: Int
  }
  struct Result: Equatable, Sendable {
    let status: String
    let arrival: NoLateGuidanceArrival?
    let busLegIndex: Int
    init(_ status: String, _ arrival: NoLateGuidanceArrival? = nil, busLegIndex: Int = 1) {
      self.status = status; self.arrival = arrival; self.busLegIndex = busLegIndex
    }
  }
  private struct Envelope<T: Decodable>: Decodable { let success: Bool; let data: T }
  private struct Fence: Decodable {
    let schemaVersion: Int, sessionId: String, generation: Int64, routeRevision: Int64
    let routeInputDigest: String, identityEvidence: String
  }
  private struct BindingResponse: Decodable {
    struct Mapping: Decodable {
      struct Boarding: Decodable { let sourceIndex: Int, providerSequence: Int, localStationId: String; let latitude: Double, longitude: Double }
      let status: String; let query: Query?; let boarding: Boarding?
    }
    let mapping: Mapping
  }
  private struct ArrivalResponse: Decodable {
    struct Observation: Decodable {
      let quality: String, provider: String, kind: String, inputFreshnessEvidence: String
      let arsId: String?, directionLabel: String?, sourceUpdatedAt: String?, receivedAt: String?, expectedAt: String?, validUntil: String?
      let confirmedBoarding: Bool
    }
    let status: String, evaluatedAt: String, query: Query, confirmedBoarding: Bool
    let observation: Observation?
  }
  static func eligible(_ session: NoLateJourneyAutomaticSession, now: Double) -> Bool {
    let value = NoLateAutomaticGuidanceProjection.content(session, now: now)
    return session.binding.savedRouteValidated == true && session.binding.guidanceEnabled == true
      && ["SANDBOX", "AUTHENTICATED"].contains(session.binding.syncScope) && session.departureAcknowledged
      && value.status == "ACTIVE" && value.quality == "GOOD" && now < value.validUntil
      && ["APPROACHING_STOP", "WAITING"].contains(value.phase)
  }
  static func supportedInput(_ session: NoLateJourneyAutomaticSession) -> Bool {
    guard let index=session.bus?.snapshot.route.legIndex,(1...29).contains(index),index % 2 == 1,
      let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(session.routeJSON.utf8)),
      input.provider == "odsay", input.legs.count > index, input.legs[index].kind == "BUS",
      let route = input.legs[index].localRouteId, identifier(route), input.legs[index].directionName != nil else { return false }
    return true
  }
  static func binding(_ data: Data, session: NoLateJourneyAutomaticSession) -> Query? {
    guard data.count <= 262144, fence(data, session: session),
      let raw = try? JSONDecoder().decode(Envelope<BindingResponse>.self, from: data), raw.success,
      raw.data.mapping.status == "SUPPORTED", let query = raw.data.mapping.query, let board = raw.data.mapping.boarding,
      query.namespace == "SEOUL_BUS", query.legIndex == session.bus?.snapshot.route.legIndex, identifier(query.providerRouteId),
      query.arsId.range(of: "^[0-9]{5}$", options: .regularExpression) != nil, query.arsId != "00000",
      !query.directionLabel.isEmpty, query.directionLabel.utf8.count <= 256,
      !query.directionLabel.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
      identifier(board.localStationId), board.sourceIndex == 0,
      let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(session.routeJSON.utf8)),
      input.provider == "odsay", (1...29).contains(query.legIndex),query.legIndex % 2 == 1,
      input.legs.count > query.legIndex, input.legs[query.legIndex].kind == "BUS",
      input.legs[query.legIndex].localRouteId == query.providerRouteId, input.legs[query.legIndex].directionName == query.directionLabel,
      let first = input.legs[query.legIndex].stops.first, first.sourceIndex == board.sourceIndex, first.providerSequence == board.providerSequence,
      let coordinate = first.coordinate, let start = input.legs[query.legIndex].start,
      coordinate.latitude == board.latitude, coordinate.longitude == board.longitude,
      abs(start.latitude - board.latitude) < 0.0003, abs(start.longitude - board.longitude) < 0.0003 else { return nil }
    return query
  }
  static func observe(_ data: Data, session: NoLateJourneyAutomaticSession, query: Query, now: Double) -> Result {
    guard eligible(session, now: now), queryCompatible(query, session: session), data.count <= 262144, fence(data, session: session),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let payload = object["data"] as? [String: Any], payload["remainingStopsToAlight"] is NSNull,
      let raw = try? JSONDecoder().decode(Envelope<ArrivalResponse>.self, from: data), raw.success,
      raw.data.query == query, !raw.data.confirmedBoarding else { return .init("RESPONSE_REJECTED") }
    guard raw.data.status == "WAITING_INFORMATION" else {
      return .init(["NO_ARRIVAL", "IDENTITY_MISMATCH", "STALE", "UNVERIFIED", "INVALID", "UNAVAILABLE"].contains(raw.data.status)
        ? raw.data.status : "RESPONSE_REJECTED")
    }
    guard let observation = raw.data.observation, observation.quality == "FRESH_WAITING_INFORMATION",
      observation.provider == "SEOUL_BUS", observation.kind == "BUS", !observation.confirmedBoarding,
      observation.inputFreshnessEvidence == "PROVIDER_SOURCE_TIMESTAMP", observation.arsId == query.arsId,
      observation.directionLabel == query.directionLabel,
      let source = instant(observation.sourceUpdatedAt), let receipt = instant(observation.receivedAt),
      let expected = instant(observation.expectedAt), let expiry = instant(observation.validUntil), let evaluated = instant(raw.data.evaluatedAt),
      source <= receipt + 5, receipt <= evaluated + 5, source <= evaluated + 5, evaluated <= now + 5,
      evaluated >= session.binding.preparedAtEpochSeconds - 5,
      expected > source, expected <= source + 3600, abs(expiry - min(source + 120, expected)) < 0.001 else { return .init("RESPONSE_REJECTED") }
    guard now < expiry, now < expected else { return .init("STALE") }
    return .init("WAITING_INFORMATION", .init(providerRouteId: query.providerRouteId, directionLabel: query.directionLabel,
      expectedAt: expected, sourceUpdatedAt: source, validUntil: expiry,busLegIndex:query.legIndex > 1 ? query.legIndex:nil),busLegIndex:query.legIndex)
  }
  private static func fence(_ data: Data, session: NoLateJourneyAutomaticSession) -> Bool {
    guard let envelope = try? JSONDecoder().decode(Envelope<Fence>.self, from: data), envelope.success else { return false }
    let raw = envelope.data, binding = session.binding
    return raw.schemaVersion == 1 && raw.identityEvidence == "SAVED_ROUTE_METADATA" && raw.sessionId == binding.sessionId
      && raw.generation == binding.generation && raw.routeRevision == binding.routeRevision && raw.routeInputDigest == binding.routeInputDigest
  }
  private static func identifier(_ value: String) -> Bool { value.range(of: "^[1-9][0-9]{0,19}$", options: .regularExpression) != nil }
  private static func queryCompatible(_ query: Query, session: NoLateJourneyAutomaticSession) -> Bool {
    guard supportedInput(session), query.namespace == "SEOUL_BUS", query.legIndex == session.bus?.snapshot.route.legIndex,
      query.arsId.range(of: "^[0-9]{5}$", options: .regularExpression) != nil, query.arsId != "00000",
      let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(session.routeJSON.utf8)) else { return false }
    return input.legs.count > query.legIndex && input.legs[query.legIndex].localRouteId == query.providerRouteId
      && input.legs[query.legIndex].directionName == query.directionLabel
  }
  private static func instant(_ value: String?) -> Double? {
    guard let value, value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z$", options: .regularExpression) != nil else { return nil }
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date.timeIntervalSince1970 }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)?.timeIntervalSince1970
  }
}
