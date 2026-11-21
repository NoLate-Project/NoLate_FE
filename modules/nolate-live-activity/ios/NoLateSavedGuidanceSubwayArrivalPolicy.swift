import Foundation

/// A server-bound platform arrival is useful while waiting, but never proves that the rider boarded.
enum NoLateSavedGuidanceSubwayArrivalPolicy {
  static func decode(_ data: Data, session: NoLateJourneyAutomaticSession, now: Double) -> NoLateSavedGuidanceArrivalPolicy.Result? {
    guard data.count <= 262_144, now.isFinite, now < session.binding.expiresAtEpochSeconds,
      session.binding.syncScope == "AUTHENTICATED", session.binding.savedRouteValidated == true,
      session.binding.guidanceEnabled == true, !session.core.snapshot.status.isTerminal,
      let index = session.requestedSubwayLegIndex(now:now),
      let route = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(session.routeJSON.utf8)),
      route.legs.indices.contains(index), route.legs[index].kind == "SUBWAY",
      let savedLine = safe(route.legs[index].display?.lineName),
      let savedStation = safe(route.legs[index].stops.first?.name),
      let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      root["success"] as? Bool == true, let body = root["data"] as? [String: Any],
      integer(body["schemaVersion"]) == 2,
      body["sessionId"] as? String == session.binding.sessionId,
      integer(body["generation"]) == session.binding.generation,
      integer(body["routeRevision"]) == session.binding.routeRevision,
      body["routeInputDigest"] as? String == session.binding.routeInputDigest,
      integer(body["subwayLegIndex"]) == Int64(index),
      body["identityEvidence"] as? String == "OWNED_AUTOMATIC_SESSION_TRAIN_REFERENCES",
      body["navigationReady"] as? Bool == false,
      body["passengerBoardingConfirmed"] as? Bool == false,
      body["passengerPosition"] is NSNull,
      body["passengerRemainingStops"] is NSNull,
      let input = body["arrivalInput"] as? [String: Any],
      input["identityEvidence"] as? String == "OFFICIAL_SAVED_SUBWAY_SERVICE_PATTERN",
      input["provider"] as? String == "SEOUL_SUBWAY", input["kind"] as? String == "SUBWAY",
      input["confirmedBoarding"] as? Bool == false,
      let line = safe(input["lineName"] as? String), sameLine(official: line, saved: savedLine),
      let station = safe(input["boardingStationName"] as? String), name(station) == name(savedStation),
      let terminal = safe(input["terminalStationName"] as? String),
      let direction = safe(input["direction"] as? String),
      ["상행", "하행", "내선", "외선"].contains(where: direction.contains),
      let train = input["trainNumber"] as? String,
      train.range(of: "^[0-9]{1,8}$", options: .regularExpression) != nil,
      let source = instant(input["sourceUpdatedAt"] as? String),
      let receipt = instant(input["receivedAt"] as? String),
      let expected = instant(input["expectedAt"] as? String),
      let until = instant(input["validUntil"] as? String),
      source >= now - 120, source <= now + 5, receipt >= source - 5, receipt <= now + 5,
      expected > now, expected <= source + 3600,
      abs(until - min(source + 120, expected)) < 0.001, now < until else { return nil }
    let arrival = NoLateGuidanceArrival(providerRouteId: line, directionLabel: "\(terminal)행",
      expectedAt: expected, sourceUpdatedAt: source, validUntil: until,
      busLegIndex: index, kind: "SUBWAY")
    return .init("WAITING_INFORMATION", arrival, busLegIndex: index, subwayTrainNumber: train)
  }
  private static func safe(_ value: String?) -> String? {
    NoLateGuidanceRouteLayoutPolicy.safeName(value)
  }
  private static func name(_ value: String) -> String {
    let compact = value.replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
    return compact.hasSuffix("역") ? String(compact.dropLast()) : compact
  }
  private static func sameLine(official: String, saved: String) -> Bool {
    let canonical = official.replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
    guard canonical.range(of: "^[1-8]호선$", options: .regularExpression) != nil else { return false }
    let displayed = saved.replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
      .replacingOccurrences(of: "^수도권", with: "", options: .regularExpression)
    return displayed == canonical
  }
  private static func instant(_ value: String?) -> Double? {
    guard let value else { return nil }
    let format = ISO8601DateFormatter()
    format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = format.date(from: value) { return date.timeIntervalSince1970 }
    format.formatOptions = [.withInternetDateTime]
    return format.date(from: value)?.timeIntervalSince1970
  }
  private static func integer(_ value: Any?) -> Int64? {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
      n.doubleValue.isFinite, n.doubleValue.rounded() == n.doubleValue,
      abs(n.doubleValue) <= 9_007_199_254_740_991 else { return nil }
    return n.int64Value
  }
}
