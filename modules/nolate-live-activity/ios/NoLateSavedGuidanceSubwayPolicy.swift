import Foundation

/// Shared by the native HTTP transport and offline contract tests. Subway is authenticated only.
enum NoLateJourneyObservationPathPolicy {
  static func allows(_ suffix:String, scope:String) -> Bool {
    if suffix == "/subway-observation/input" { return scope == "AUTHENTICATED" }
    return ["AUTHENTICATED","SANDBOX"].contains(scope)
      && ["/validate","/bus-arrivals/binding","/bus-arrivals","/bus-ride/binding","/bus-ride"].contains(suffix)
  }
}

/// Only the pinned native authenticated transport calls this decoder. A UI boolean/phase is not evidence.
enum NoLateSavedGuidanceSubwayPolicy {
  struct Input {
    let route: NoLateJourneySubwayRideCore.Route
    let trains: [NoLateJourneySubwayRideCore.Train]
    let validUntil: Double
  }
  static func decode(_ data: Data, session: NoLateJourneyAutomaticSession, now: Double) -> Input? {
    guard data.count <= 262_144, now.isFinite, now < session.binding.expiresAtEpochSeconds,
      session.binding.syncScope == "AUTHENTICATED", session.binding.savedRouteValidated == true,
      session.binding.guidanceEnabled == true, !session.core.snapshot.status.isTerminal,
      let index = session.requestedSubwayLegIndex,
      let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], root["success"] as? Bool == true,
      let body = root["data"] as? [String: Any], integer(body["schemaVersion"]) == 2,
      body["sessionId"] as? String == session.binding.sessionId,
      integer(body["generation"]) == session.binding.generation,
      integer(body["routeRevision"]) == session.binding.routeRevision,
      body["routeInputDigest"] as? String == session.binding.routeInputDigest,
      integer(body["subwayLegIndex"]) == Int64(index),
      body["identityEvidence"] as? String == "OWNED_AUTOMATIC_SESSION_TRAIN_REFERENCES",
      body["status"] as? String == "TRAIN_REFERENCES_ONLY", body["navigationReady"] as? Bool == false,
      body["passengerBoardingConfirmed"] as? Bool == false,
      body["passengerPosition"] is NSNull, body["passengerRemainingStops"] is NSNull,
      let input = body["nativeInput"] as? [String: Any], let observed = number(input["observedAt"]),
      observed >= session.core.snapshot.armedAt - 30, observed <= now, now - observed < 30,
      let stations = input["stations"] as? [[String: Any]], (2...500).contains(stations.count),
      let rows = input["trains"] as? [[String: Any]], (1...100).contains(rows.count),
      let routeInput = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(session.routeJSON.utf8)),
      routeInput.legs.indices.contains(index), routeInput.legs[index].kind == "SUBWAY",
      routeInput.legs[index].stops.count == stations.count else { return nil }
    var stops: [NoLateJourneySubwayRideCore.Station] = []
    for (raw, expected) in zip(stations, routeInput.legs[index].stops) {
      guard let routing = raw["routingStationId"] as? String, routing == expected.routingStationId,
        let provider = raw["stationId"] as? String, let latitude = number(raw["latitude"]), let longitude = number(raw["longitude"]),
        latitude == expected.coordinate?.latitude, longitude == expected.coordinate?.longitude else { return nil }
      stops.append(.init(routingId: routing, providerId: provider, coordinate: .init(latitude:latitude,longitude:longitude)))
    }
    let route = NoLateJourneySubwayRideCore.Route(identity: session.core.snapshot.identity, legIndex:index, stations:stops)
    guard (try? NoLateJourneySubwayRideCore(route:route, armedAt:session.core.snapshot.armedAt,
      expiresAt:session.binding.expiresAtEpochSeconds)) != nil else { return nil }
    var trains: [NoLateJourneySubwayRideCore.Train] = []
    for row in rows {
      guard let id = row["id"] as? String, id.range(of:"^[0-9]{1,8}$",options:.regularExpression) != nil,
        id.contains(where: { $0 != "0" }), let stop = integer(row["stopIndex"]), stops.indices.contains(Int(stop)),
        let state = integer(row["state"]), (0...3).contains(state), let source = number(row["sourceAt"]),
        let until = number(row["validUntil"]), source >= session.core.snapshot.armedAt - 30,
        source <= observed, source <= now, until > now, until <= source + 30, until > source else { return nil }
      trains.append(.init(id:id,stopIndex:Int(stop),state:Int(state),sourceAt:source,validUntil:until))
    }
    guard Set(trains.map(\.id)).count == trains.count else { return nil }
    return Input(route:route,trains:trains,validUntil:min(session.binding.expiresAtEpochSeconds, observed+30, trains.map(\.validUntil).min()!))
  }
  private static func number(_ value: Any?) -> Double? {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
    return n.doubleValue
  }
  private static func integer(_ value: Any?) -> Int64? {
    guard let n = number(value), n.rounded() == n, abs(n) <= 9_007_199_254_740_991 else { return nil }
    return Int64(n)
  }
}
