import Foundation

/// Read-only native admission. Data arrives only through the pinned authenticated transport.
/// A JS boolean/route ID/arrival estimate cannot create this binding or vehicle evidence.
enum NoLateSavedGuidanceRidePolicy {
  typealias Session = NoLateJourneyAutomaticSession
  typealias Ride = NoLateJourneyBusRideCore
  struct Admission {
    let route: Ride.Route
    let validUntil: Double
  }
  static func nextPollAt(completedAt: Double) -> Double { completedAt + 11 }
  static func vehicleStatus(_ data: Data, session: Session) -> String {
    guard let body = body(data, session: session), let status = body["status"] as? String else {
      return "VEHICLE_RESPONSE_REJECTED"
    }
    switch status {
    case "AVAILABLE": return "VEHICLE_INPUT_RECEIVED"
    case "POLL_BUDGET_EXHAUSTED": return "POLL_BUDGET_EXHAUSTED"
    case "VEHICLE_EVIDENCE_UNAVAILABLE": return "VEHICLE_EVIDENCE_UNAVAILABLE"
    case "VEHICLE_PROVIDER_UNAVAILABLE": return "VEHICLE_PROVIDER_UNAVAILABLE"
    default: return "VEHICLE_RESPONSE_REJECTED"
    }
  }
  static func admission(_ data: Data, session: Session, now: Double) -> Admission? {
    guard let body = body(data, session: session), body["status"] as? String == "VERIFIED",
      let until = number(body["validUntil"]), until > now, until <= now + 30.001,
      until <= session.binding.expiresAtEpochSeconds,
      let routeId = body["routeId"] as? String, routeId.range(of: "^[1-9][0-9]{8}$", options: .regularExpression) != nil,
      let direction = body["direction"] as? String, !direction.isEmpty, direction.utf8.count <= 128,
      !direction.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
      let approach = session.approachForAdmission(now:now),
      let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(session.routeJSON.utf8)),
      input.legs.count > approach.legIndex, input.legs[approach.legIndex].localRouteId == routeId,
      let coordinates = body["coordinates"] as? [[String: Any]], coordinates.count == approach.coordinates.count,
      zip(coordinates, approach.coordinates).allSatisfy({ raw, expected in
        number(raw["latitude"]) == expected.latitude && number(raw["longitude"]) == expected.longitude
      }) else { return nil }
    let window: Double
    if (integer(body["schemaVersion"]) ?? 0) >= 2 {
      guard let value = number(body["departureWindowMeters"]), value == 0 || (100...350).contains(value) else { return nil }
      window = value
    } else { window = 0 }
    return Admission(route: .init(identity: session.core.snapshot.identity, providerRouteId: routeId,
      direction: direction, approach: approach, departureWindowMeters:window), validUntil: until)
  }
  static func vehicles(_ data: Data, session: Session, admission: Admission, now: Double) -> [Ride.Vehicle] {
    guard now.isFinite, now < admission.validUntil, admission.route.identity == session.core.snapshot.identity,
      admission.route.approach == session.bus?.snapshot.route,
      let body = body(data, session: session), body["status"] as? String == "AVAILABLE",
      let rows = body["vehicles"] as? [[String: Any]], rows.count <= 100 else { return [] }
    var result: [Ride.Vehicle] = []
    var ids = Set<String>()
    for row in rows {
      guard let id = row["id"] as? String, id.range(of: "^[1-9][0-9]{8}$", options: .regularExpression) != nil,
        ids.insert(id).inserted, row["routeId"] as? String == admission.route.providerRouteId,
        row["direction"] as? String == admission.route.direction, row["source"] as? String == "verifiedWGS84",
        let coordinate = row["coordinate"] as? [String: Any],
        let latitude = number(coordinate["latitude"]), (33...39.5).contains(latitude),
        let longitude = number(coordinate["longitude"]), (124...132).contains(longitude),
        let source = number(row["sourceAt"]), let received = number(row["receivedAt"]), let until = number(row["validUntil"]),
        source >= session.binding.preparedAtEpochSeconds - 15, source <= received, received <= now,
        source <= now, until > now, until <= source + 15, until > source else { return [] }
      var past: Double?
      if (integer(body["schemaVersion"]) ?? 0) >= 2 {
        switch row["positionScope"] as? String {
        case "SELECTED_SEGMENT": guard row["metersPastAlighting"] == nil || row["metersPastAlighting"] is NSNull else { return [] }
        case "AFTER_ALIGHTING":
          guard admission.route.departureWindowMeters > 0, let meters = number(row["metersPastAlighting"]),
            meters > 25, meters <= admission.route.departureWindowMeters,
            let end = admission.route.approach.coordinates.last else { return [] }
          let distance = NoLateJourneyBusSeparationCore.distance(end, .init(latitude:latitude,longitude:longitude))
          guard distance > 25, distance <= meters + 25 else { return [] }
          past = meters
        default: return []
        }
      } else if row["positionScope"] != nil || row["metersPastAlighting"] != nil { return [] }
      result.append(.init(id: id, routeId: admission.route.providerRouteId, direction: admission.route.direction,
        coordinate: .init(latitude: latitude, longitude: longitude), sourceAt: source, receivedAt: received,
        validUntil: until, source: .verifiedWGS84, metersPastAlighting:past))
    }
    return result
  }
  private static func body(_ data: Data, session: Session) -> [String: Any]? {
    guard data.count <= 262144, session.binding.syncScope == "AUTHENTICATED",
      session.binding.savedRouteValidated == true, session.binding.guidanceEnabled == true,
      !session.core.snapshot.status.isTerminal,
      let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      root["success"] as? Bool == true, let body = root["data"] as? [String: Any],
      [1,2,3].contains(integer(body["schemaVersion"]) ?? 0), body["sessionId"] as? String == session.binding.sessionId,
      integer(body["generation"]) == session.binding.generation, integer(body["routeRevision"]) == session.binding.routeRevision,
      body["routeInputDigest"] as? String == session.binding.routeInputDigest,
      body["identityEvidence"] as? String == "OFFICIAL_STOP_SHAPE_CROSSWALK" else { return nil }
    guard let index = session.requestedBusLegIndex(now:session.core.snapshot.lastEvaluationAt),
      integer(body["schemaVersion"]) == 3 ? integer(body["busLegIndex"]) == Int64(index)
        : index == 1 && (body["busLegIndex"] == nil || body["busLegIndex"] is NSNull) else { return nil }
    return body
  }
  private static func number(_ value: Any?) -> Double? {
    guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite else { return nil }
    return value.doubleValue
  }
  private static func integer(_ value: Any?) -> Int64? {
    guard let number = number(value), number.rounded() == number, abs(number) <= 9_007_199_254_740_991 else { return nil }
    return Int64(number)
  }
}
