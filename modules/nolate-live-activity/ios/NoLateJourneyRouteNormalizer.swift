import Foundation

/// Read-only P1-2 admission boundary. Provider labels are evidence claims, not field validation.
/// This evaluator does not arm the engine, persist routes, query providers, or request location.
enum NoLateJourneyRouteNormalizer {
  struct Coordinate: Codable, Equatable, Hashable, Sendable {
    let latitude: Double
    let longitude: Double
  }

  struct Stop: Codable, Equatable, Sendable {
    let sourceIndex: Int
    let providerSequence: Int?
    let name: String?
    let code: String?
    let coordinate: Coordinate?
    var routingStationId: String? = nil
  }

  struct Leg: Codable, Equatable, Sendable {
    let index: Int
    let kind: String
    let geometrySource: String
    let exact: Bool
    let geometryInputComplete: Bool?
    let coordinates: [Coordinate?]
    let start: Coordinate?
    let end: Coordinate?
    let providerRouteId: String?
    let localRouteId: String?
    let directionName: String?
    let directionCode: String?
    let serviceAvailable: Bool?
    let declaredStationCount: Int?
    let stopEvidenceProvider: String?
    let stopEvidenceVersion: Int?
    let stops: [Stop]
    var display: Display? = nil
  }
  struct Display: Codable, Equatable, Sendable {
    let lineName: String?
    let lineColor: String?
    let durationMinutes: Double?
    let distanceMeters: Double?
  }

  struct Input: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let routeRevision: Int64
    let context: String
    let provider: String
    let source: String
    let reliability: String
    let plausibility: String
    let serviceState: String
    let origin: Coordinate?
    let destination: Coordinate?
    let legs: [Leg]
    var walkingSnapshot: NoLateServerWalkingSnapshot? = nil
  }

  /// Authenticated server prepare proof for one saved bus leg. Static identity only;
  /// it never claims current service, a vehicle, or passenger boarding.
  struct OfficialBusAdmission: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let identityEvidence: String
    let busLegIndex: Int
    let routeId: String
    let direction: String
    let stationCount: Int
    let firstStopSequence: Int
    let lastStopSequence: Int

    func matches(_ input: Input) -> Bool {
      let span = lastStopSequence.subtractingReportingOverflow(firstStopSequence)
      guard schemaVersion == 1, identityEvidence == "OFFICIAL_STOP_SHAPE_CROSSWALK",
        (1...29).contains(busLegIndex), busLegIndex % 2 == 1, input.legs.indices.contains(busLegIndex), input.context == "SAVED_ROUTE", input.provider == "odsay",
        input.legs[busLegIndex].kind == "BUS",
        input.serviceState == "operating" || input.serviceState == "UNKNOWN",
        routeId.range(of: "^[1-9][0-9]{8}$", options: .regularExpression) != nil,
        !direction.isEmpty, direction.utf8.count <= 128,
        !direction.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
        (1...63).contains(stationCount), firstStopSequence >= 0,
        !span.overflow, span.partialValue == stationCount,
        input.legs[busLegIndex].localRouteId == routeId,
        input.legs[busLegIndex].stops.count == stationCount + 1,
        input.legs[busLegIndex].directionName.map({ $0 == direction }) ?? true,
        input.legs[busLegIndex].declaredStationCount.map({ $0 == stationCount }) ?? true,
        input.legs[busLegIndex].serviceAvailable != false else { return false }
      return true
    }
  }

  /// Authenticated server proof for one saved ODsay subway leg. It proves only the
  /// static official station path; live train and passenger evidence remain separate.
  struct OfficialSubwayAdmission: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let identityEvidence: String
    let subwayLegIndex: Int
    let providerRouteId: String
    let startRoutingStationId: String
    let endRoutingStationId: String
    let stationCount: Int

    func matches(_ input: Input) -> Bool {
      guard schemaVersion == 1, identityEvidence == "OFFICIAL_STATION_PATH_CROSSWALK",
        (1...29).contains(subwayLegIndex), subwayLegIndex % 2 == 1, input.legs.indices.contains(subwayLegIndex), input.context == "SAVED_ROUTE", input.provider == "odsay",
        input.source == "api", input.legs[subwayLegIndex].kind == "SUBWAY",
        input.serviceState == "operating" || input.serviceState == "UNKNOWN",
        providerRouteId.range(of: "^1000:[0-9]{1,20}$", options: .regularExpression) != nil,
        providerRouteId.dropFirst(5).contains(where: { $0 != "0" }),
        startRoutingStationId.range(of: "^[0-9]{1,20}$", options: .regularExpression) != nil,
        endRoutingStationId.range(of: "^[0-9]{1,20}$", options: .regularExpression) != nil,
        startRoutingStationId.contains(where: { $0 != "0" }),
        endRoutingStationId.contains(where: { $0 != "0" }),
        startRoutingStationId != endRoutingStationId, (1...63).contains(stationCount),
        input.legs[subwayLegIndex].providerRouteId == providerRouteId,
        input.legs[subwayLegIndex].stops.count == stationCount + 1,
        input.legs[subwayLegIndex].stops.first?.routingStationId == startRoutingStationId,
        input.legs[subwayLegIndex].stops.last?.routingStationId == endRoutingStationId,
        input.legs[subwayLegIndex].serviceAvailable != false else { return false }
      return true
    }
  }

  struct LegSummary: Codable, Equatable, Sendable {
    let index: Int
    let kind: String
    let geometryUsable: Bool
    let stopSequenceUsable: Bool
    let directionExplicit: Bool
    let rideNavigationEligible: Bool
    let geometryLengthMeters: Double?
    let shapePointCount: Int
    let stopCount: Int
    let reasonCodes: [String]

    private enum CodingKeys: String, CodingKey {
      case index, kind, geometryUsable, stopSequenceUsable, directionExplicit, rideNavigationEligible
      case geometryLengthMeters, shapePointCount, stopCount, reasonCodes
    }
    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(index, forKey: .index)
      try container.encode(kind, forKey: .kind)
      try container.encode(geometryUsable, forKey: .geometryUsable)
      try container.encode(stopSequenceUsable, forKey: .stopSequenceUsable)
      try container.encode(directionExplicit, forKey: .directionExplicit)
      try container.encode(rideNavigationEligible, forKey: .rideNavigationEligible)
      try container.encode(geometryLengthMeters, forKey: .geometryLengthMeters)
      try container.encode(shapePointCount, forKey: .shapePointCount)
      try container.encode(stopCount, forKey: .stopCount)
      try container.encode(reasonCodes, forKey: .reasonCodes)
    }
  }

  struct Summary: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let routeRevision: Int64
    let context: String
    let provider: String
    let evaluationMode: String
    let fullAutomaticGuidance: Bool
    let fieldValidated: Bool
    let eligibleDepartureLegIndex: Int?
    var reasonCodes: [String]
    let legs: [LegSummary]

    // Encode the absent eligibility as explicit null for a stable JS boundary.
    private enum CodingKeys: String, CodingKey {
      case schemaVersion, routeRevision, context, provider, evaluationMode, fullAutomaticGuidance
      case fieldValidated, eligibleDepartureLegIndex, reasonCodes, legs
    }
    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(schemaVersion, forKey: .schemaVersion)
      try container.encode(routeRevision, forKey: .routeRevision)
      try container.encode(context, forKey: .context)
      try container.encode(provider, forKey: .provider)
      try container.encode(evaluationMode, forKey: .evaluationMode)
      try container.encode(fullAutomaticGuidance, forKey: .fullAutomaticGuidance)
      try container.encode(fieldValidated, forKey: .fieldValidated)
      try container.encode(eligibleDepartureLegIndex, forKey: .eligibleDepartureLegIndex)
      try container.encode(reasonCodes, forKey: .reasonCodes)
      try container.encode(legs, forKey: .legs)
    }
  }

  enum ValidationError: Error, Equatable {
    case payloadSize, schema, bounds, invalidJSON, departureNotEligible
  }

  struct PreparedWalkingRoute: Equatable, Sendable {
    let routeRevision: Int64
    let context: String
    let route: NoLateJourneyEngineCore.Route
    let summary: Summary
    let busRoute: NoLateJourneyBusApproachCore.Route?
    let busUnavailableReason: String?
    let guidanceLegs: [NoLateGuidanceRouteLeg]
    let indoorTransferIndices: Set<Int>
  }

  /// Only the caller's explicit sandbox binding may exercise synthetic geometry. It stays synthetic.
  static func prepareWalkingRoute(json: String, allowSyntheticSandbox: Bool = false, allowValidatedSavedRoute: Bool = false,
    officialBusAdmission: OfficialBusAdmission? = nil, officialSubwayAdmission: OfficialSubwayAdmission? = nil, busAdmissions: [OfficialBusAdmission] = [],
    subwayAdmissions: [OfficialSubwayAdmission] = []) throws -> PreparedWalkingRoute {
    let summary = try normalize(json: json, officialBusAdmission: officialBusAdmission,
      officialSubwayAdmission: officialSubwayAdmission, busAdmissions: busAdmissions, subwayAdmissions: subwayAdmissions)
    let synthetic = summary.context == "SYNTHETIC_FIXTURE" && allowSyntheticSandbox
    let unknownSingleSubway = summary.provider == "odsay" && summary.legs.count == 3
      && summary.legs[1].kind == "SUBWAY"
      && summary.reasonCodes == ["SAVED_ROUTE_REVALIDATION_REQUIRED", "ROUTE_SERVICE_UNVERIFIED"]
    let saved = summary.context == "SAVED_ROUTE" && allowValidatedSavedRoute
      && (summary.reasonCodes == ["SAVED_ROUTE_REVALIDATION_REQUIRED"] || unknownSingleSubway)
      && summary.legs.first?.geometryUsable == true
    guard (summary.eligibleDepartureLegIndex == 0 && summary.context == "ROUTING_RESPONSE")
      || saved || (synthetic && summary.reasonCodes == ["SYNTHETIC_FIXTURE_ONLY"]
          && summary.legs.first?.kind == "WALK" && summary.legs.first?.geometryUsable == true) else {
      throw ValidationError.departureNotEligible
    }
    // The immutable string was bounded and validated above. No altered/display path is substituted.
    let input = try JSONDecoder().decode(Input.self, from: Data(json.utf8))
    var coordinates: [NoLateJourneyEngineCore.Coordinate] = []
    for coordinate in try routeCoordinates(input, legIndex: 0) {
      guard let coordinate else { throw ValidationError.departureNotEligible }
      coordinates.append(.init(latitude: coordinate.latitude, longitude: coordinate.longitude))
    }
    let bus = prepareBusApproach(input, summary: summary, walking: coordinates, synthetic: synthetic)
    return PreparedWalkingRoute(routeRevision: summary.routeRevision, context: summary.context,
      route: .init(coordinates: coordinates, provenance: synthetic ? .syntheticReplay : .verifiedWalkingPath), summary: summary,
      busRoute: bus.0, busUnavailableReason: bus.1,
      guidanceLegs: NoLateGuidanceRouteLayoutPolicy.budgeted(summary.legs.map { leg in
        let continuous: Bool
        if leg.index == 1, leg.kind == "BUS" { continuous = bus.0 != nil }
        else if leg.index > 0, input.legs[leg.index - 1].kind == "WALK", summary.legs[leg.index - 1].geometryUsable,
          let end = (try? routeCoordinates(input,legIndex:leg.index - 1))?.last ?? nil,
          let board = input.legs[leg.index].stops.first?.coordinate {
          // Walking providers may end at a station entrance while the transit
          // provider anchors the platform/stop. Use the same proximity bound
          // as the bus approach; this permits only a planned boarding label.
          continuous = distance(end,board) <= 75
        } else { continuous = false }
        return .init(index: leg.index, kind: leg.kind,
          walkingLengthMeters: leg.kind == "WALK" && leg.geometryUsable ? leg.geometryLengthMeters : nil,
          // The first subway boarding point is also anchored by the verified
          // walking endpoint. Its route label can be shown before a live train
          // or official stop-sequence admission is available; ride/alighting
          // claims still require the stricter evidence below.
          boardingStopName: continuous && (leg.kind == "SUBWAY" || (leg.stopSequenceUsable && leg.directionExplicit))
            ? NoLateGuidanceRouteLayoutPolicy.safeName(input.legs[leg.index].stops.first?.name) : nil,
          lineName: ["BUS", "SUBWAY"].contains(leg.kind) ? NoLateGuidanceRouteLayoutPolicy.safeName(input.legs[leg.index].display?.lineName) : nil,
          lineColor: ["BUS", "SUBWAY"].contains(leg.kind) ? NoLateGuidanceRouteLayoutPolicy.safeColor(input.legs[leg.index].display?.lineColor) : nil,
          durationMinutes: NoLateGuidanceRouteLayoutPolicy.number(input.legs[leg.index].display?.durationMinutes, maximum: 1440),
          distanceMeters: NoLateGuidanceRouteLayoutPolicy.number(input.legs[leg.index].display?.distanceMeters, maximum: 10_000_000),
          alightingStopName: continuous && leg.stopSequenceUsable && leg.directionExplicit ? NoLateGuidanceRouteLayoutPolicy.safeName(input.legs[leg.index].stops.last?.name) : nil)
      }), indoorTransferIndices:Set(input.legs.indices.filter { usesIndoorTransfer(input,legIndex:$0) }))
  }

  private static func prepareBusApproach(_ input: Input, summary: Summary,
    walking: [NoLateJourneyEngineCore.Coordinate], synthetic: Bool, legIndex: Int = 1) -> (NoLateJourneyBusApproachCore.Route?, String?) {
    guard legIndex >= 1, legIndex < input.legs.count, input.legs[legIndex].kind == "BUS" else { return (nil, "NEXT_LEG_NOT_BUS") }
    let leg = input.legs[legIndex], quality = summary.legs[legIndex]
    guard quality.geometryUsable else { return (nil, "BUS_GEOMETRY_UNUSABLE") }
    guard quality.stopSequenceUsable else { return (nil, "BUS_STOP_SEQUENCE_UNVERIFIED") }
    guard quality.directionExplicit else { return (nil, "BUS_DIRECTION_UNVERIFIED") }
    guard let boarding = leg.stops.first?.coordinate, let walkEnd = walking.last,
          distance(.init(latitude:walkEnd.latitude, longitude:walkEnd.longitude), boarding) <= 75 else { return (nil, "BUS_BOARDING_CONTINUITY_UNVERIFIED") }
    var coordinates: [NoLateJourneyEngineCore.Coordinate] = []
    for coordinate in leg.coordinates {
      guard let coordinate else { return (nil, "BUS_GEOMETRY_UNUSABLE") }
      let point = NoLateJourneyEngineCore.Coordinate(latitude: coordinate.latitude, longitude: coordinate.longitude)
      if coordinates.last != point { coordinates.append(point) }
    }
    // A missing provider route ID cannot confirm a vehicle. It does not prevent stop proximity
    // or a clearly labelled, unconfirmed speed/shape candidate; there is no RIDING transition.
    return (.init(legIndex: legIndex, boardingCoordinate: .init(latitude: boarding.latitude, longitude: boarding.longitude),
                  walkingCoordinates: walking, coordinates: coordinates,
                  provenance: synthetic ? .syntheticReplay : .providerShape), nil)
  }

  /// Static scoped geometry only; this never grants a transfer or boarding decision.
  static func prepareBusApproachForLeg(json:String, legIndex:Int, allowSynthetic:Bool, busAdmissions:[OfficialBusAdmission] = [],
    subwayAdmissions:[OfficialSubwayAdmission] = []) -> NoLateJourneyBusApproachCore.Route? {
    guard legIndex >= 3, legIndex <= 29, legIndex % 2 == 1,
      let prepared = try? prepareWalkingRoute(json:json,allowSyntheticSandbox:allowSynthetic,allowValidatedSavedRoute:true,
        busAdmissions:busAdmissions,subwayAdmissions:subwayAdmissions),
      let input = try? JSONDecoder().decode(Input.self,from:Data(json.utf8)),
      legIndex < input.legs.count - 1, input.legs.count % 2 == 1,
      input.legs.enumerated().allSatisfy({ $0.offset % 2 == 0 ? $0.element.kind == "WALK" : ["BUS","SUBWAY"].contains($0.element.kind) }),
      prepared.summary.legs[legIndex - 1].geometryUsable,
      let path = try? routeCoordinates(input,legIndex:legIndex - 1) else { return nil }
    let coordinates = path.compactMap { $0.map { NoLateJourneyEngineCore.Coordinate(latitude:$0.latitude,longitude:$0.longitude) } }
    guard coordinates.count == path.count else { return nil }
    return prepareBusApproach(input,summary:prepared.summary,walking:coordinates,
      synthetic:prepared.route.provenance == .syntheticReplay,legIndex:legIndex).0
  }

  private struct Geometry {
    let coordinates: [Coordinate]
    let length: Double?
    var reasons: [String]
    var usable: Bool { reasons.isEmpty }
  }

  private struct Projection {
    let along: Double
    let cross: Double
    let point: Coordinate
  }

  /// Saved, confirmed geometry only. Official station correspondence does not itself prove a rail curve.
  struct SubwayTrack: Sendable {
    let shape: [Coordinate]
    let stopsAlong: [Double]
    func project(_ fix: NoLateJourneyEngineCore.Observation) -> (along: Double, point: NoLateJourneyEngineCore.Coordinate)? {
      let point = Coordinate(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude)
      let choices = segmentProjections(point, onto: shape)
      guard let best = choices.min(by: { $0.cross < $1.cross }), best.cross + fix.horizontalAccuracyMeters <= 35,
        !choices.contains(where: { abs($0.along-best.along) > 40 && $0.cross <= best.cross + max(5,fix.horizontalAccuracyMeters) })
        else { return nil }
      return (best.along, .init(latitude: best.point.latitude, longitude: best.point.longitude))
    }
  }

  static func subwayTrack(json: String, proof: OfficialSubwayAdmission?, route: NoLateJourneySubwayRideCore.Route) -> SubwayTrack? {
    guard let proof, proof.subwayLegIndex == route.legIndex,
      let input = try? JSONDecoder().decode(Input.self, from: Data(json.utf8)), proof.matches(input) else { return nil }
    let leg = input.legs[route.legIndex]
    let geometry = evaluateGeometry(leg, provider: input.provider, collapseAdjacentTransitVertices: true)
    let stopErrors = evaluateStops(leg, geometry: geometry, provider: input.provider).filter {
      !($0 == "STATION_COUNT_MISMATCH_OR_MISSING" && leg.declaredStationCount == nil && proof.stationCount == leg.stops.count - 1)
    }
    guard geometry.usable, stopErrors.isEmpty,
      leg.stops.count == route.stations.count, geometry.coordinates.count > leg.stops.count,
      zip(geometry.coordinates,geometry.coordinates.dropFirst()).allSatisfy({ distance($0,$1) <= 300 }) else { return nil }
    var anchors: [Double] = []
    for (saved, official) in zip(leg.stops,route.stations) {
      guard let p = saved.coordinate, p.latitude == official.coordinate.latitude, p.longitude == official.coordinate.longitude,
        saved.routingStationId == official.routingId,
        let best = segmentProjections(p, onto: geometry.coordinates).min(by: { $0.cross < $1.cross }), best.cross <= 25,
        anchors.last.map({ best.along - $0 >= 100 }) ?? true else { return nil }
      anchors.append(best.along)
    }
    return .init(shape: geometry.coordinates, stopsAlong: anchors)
  }

  static let staticGeometryEndpointToleranceMeters = 75.0
  private static let maximumIntersectionComparisons = 200_000
  private static let earthRadius = 6_371_000.0

  static func normalize(json: String, officialBusAdmission: OfficialBusAdmission? = nil,
    officialSubwayAdmission: OfficialSubwayAdmission? = nil, busAdmissions: [OfficialBusAdmission] = [],
    subwayAdmissions: [OfficialSubwayAdmission] = []) throws -> Summary {
    guard !json.isEmpty, json.utf8.count <= 1_048_576 else { throw ValidationError.payloadSize }
    let input: Input
    do { input = try JSONDecoder().decode(Input.self, from: Data(json.utf8)) }
    catch { throw ValidationError.invalidJSON }
    try validateShape(input)
    if let snapshot = input.walkingSnapshot { try snapshot.validate(input: input) }
    // An absent/mismatched proof is never partially applied. Read-only assessment calls
    // normalize without proof and continues to report the original ODsay gaps.
    let buses = (busAdmissions + [officialBusAdmission].compactMap { $0 }).filter { $0.matches(input) }
    let trains = (subwayAdmissions + [officialSubwayAdmission].compactMap { $0 }).filter { $0.matches(input) }
    var routeReasons = routeReasons(input, officialBusAdmission: buses.first, officialSubwayAdmission: trains.first)
    var summaries: [LegSummary] = []
    for leg in input.legs {
      let busProof = buses.first { $0.busLegIndex == leg.index }
      let geometry = evaluateGeometry(leg, provider: input.provider,
        walkingPath: snapshotWalkingPath(input, legIndex:leg.index),
        collapseAdjacentTransitVertices: busProof != nil)
      var reasons = geometry.reasons
      let ride = leg.kind == "BUS" || leg.kind == "SUBWAY"
      let direction = explicit(leg.directionName) || leg.directionCode == "UP" || leg.directionCode == "DOWN" || busProof != nil
      let stopsUsable: Bool
      if ride {
        let stopReasons = evaluateStops(leg, geometry: geometry, provider: input.provider)
            .filter { busProof == nil || $0 != "STATION_COUNT_MISMATCH_OR_MISSING" }
        stopsUsable = stopReasons.isEmpty
        reasons += stopReasons
        if !direction { reasons.append("DIRECTION_NOT_EXPLICIT") }
        if !explicit(leg.providerRouteId) && busProof == nil { reasons.append("PROVIDER_ROUTE_ID_MISSING") }
      } else {
        stopsUsable = false
      }
      if leg.serviceAvailable == false { reasons.append("LEG_SERVICE_UNAVAILABLE") }
      summaries.append(LegSummary(
        index: leg.index, kind: leg.kind, geometryUsable: geometry.usable,
        stopSequenceUsable: stopsUsable, directionExplicit: direction,
        rideNavigationEligible: ride && geometry.usable && stopsUsable && direction
          && (explicit(leg.providerRouteId) || busProof != nil) && leg.serviceAvailable != false && routeReasons.isEmpty,
        geometryLengthMeters: geometry.length, shapePointCount: leg.coordinates.count,
        stopCount: leg.stops.count, reasonCodes: unique(reasons)
      ))
    }
    let first = input.legs[0]
    if first.kind != "WALK" { routeReasons.append("FIRST_LEG_NOT_WALK") }
    if !summaries[0].geometryUsable { routeReasons.append("FIRST_WALK_GEOMETRY_UNUSABLE") }
    if let length = summaries[0].geometryLengthMeters {
      if length < 70 { routeReasons.append("FIRST_WALK_TOO_SHORT") }
      if length > 100_000 { routeReasons.append("FIRST_WALK_TOO_LONG") }
    }
    return Summary(
      schemaVersion: 1, routeRevision: input.routeRevision, context: input.context, provider: input.provider,
      evaluationMode: "READ_ONLY", fullAutomaticGuidance: false, fieldValidated: false,
      eligibleDepartureLegIndex: routeReasons.isEmpty ? first.index : nil,
      reasonCodes: unique(routeReasons), legs: summaries
    )
  }

  static func summaryJSON(json: String) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return String(decoding: try encoder.encode(normalize(json: json)), as: UTF8.self)
  }

  private static func validateShape(_ input: Input) throws {
    guard input.schemaVersion == 1, (1...9_007_199_254_740_991).contains(input.routeRevision),
          ["ROUTING_RESPONSE", "SAVED_ROUTE", "SYNTHETIC_FIXTURE"].contains(input.context),
          ["tmap", "odsay", "UNKNOWN"].contains(input.provider),
          ["api", "fallback", "UNKNOWN"].contains(input.source),
          ["live_provider", "provider_estimate", "fallback_estimate", "UNKNOWN"].contains(input.reliability),
          ["normal", "geometry_suspected", "UNKNOWN"].contains(input.plausibility),
          ["operating", "not_operating", "UNKNOWN"].contains(input.serviceState) else { throw ValidationError.schema }
    guard (1...32).contains(input.legs.count),
          input.legs.reduce(0, { $0 + $1.coordinates.count }) <= 12_000,
          input.legs.reduce(0, { $0 + $1.stops.count }) <= 2_000 else { throw ValidationError.bounds }
    for (index, leg) in input.legs.enumerated() {
      guard leg.index == index, ["WALK", "BUS", "SUBWAY", "ETC", "UNKNOWN"].contains(leg.kind),
            leg.coordinates.count <= 2_000, leg.stops.count <= 500,
            [leg.geometrySource, leg.providerRouteId, leg.localRouteId, leg.directionName,
             leg.directionCode, leg.stopEvidenceProvider].allSatisfy(shortString),
            leg.stops.allSatisfy({ shortString($0.name) && shortString($0.code) && shortString($0.routingStationId) }) else { throw ValidationError.bounds }
    }
  }

  private static func routeReasons(_ input: Input, officialBusAdmission: OfficialBusAdmission? = nil,
    officialSubwayAdmission: OfficialSubwayAdmission? = nil) -> [String] {
    var reasons: [String] = []
    switch input.context {
    case "SYNTHETIC_FIXTURE": reasons.append("SYNTHETIC_FIXTURE_ONLY")
    case "SAVED_ROUTE": reasons.append("SAVED_ROUTE_REVALIDATION_REQUIRED")
    default: break
    }
    if input.provider == "UNKNOWN" { reasons.append("PROVIDER_UNKNOWN") }
    if input.source != "api" { reasons.append("NON_API_ROUTE") }
    if input.reliability == "fallback_estimate" || input.reliability == "UNKNOWN" { reasons.append("ROUTE_RELIABILITY_UNVERIFIED") }
    if input.plausibility != "normal" { reasons.append("ROUTE_PLAUSIBILITY_UNVERIFIED") }
    if input.serviceState != "operating" && !(input.serviceState == "UNKNOWN" &&
      (officialBusAdmission != nil || officialSubwayAdmission != nil)) {
      reasons.append("ROUTE_SERVICE_UNVERIFIED")
    }
    if input.legs.contains(where: { $0.serviceAvailable == false }) { reasons.append("LEG_SERVICE_UNAVAILABLE") }
    guard let origin = input.origin, let destination = input.destination else {
      reasons.append("ROUTE_ENDPOINT_MISSING")
      return reasons
    }
    guard valid(origin), valid(destination) else {
      reasons.append("ROUTE_ENDPOINT_INVALID")
      return reasons
    }
    if distance(origin, destination) < 1 { reasons.append("ROUTE_ENDPOINTS_IDENTICAL") }
    if let first = input.legs.first, let start = first.start,
       let shapeStart = (try? routeCoordinates(input, legIndex:0))?.first ?? nil, valid(start), valid(shapeStart) {
      if distance(origin, start) > staticGeometryEndpointToleranceMeters || distance(origin, shapeStart) > staticGeometryEndpointToleranceMeters {
        reasons.append("ORIGIN_MISMATCH")
      }
    } else { reasons.append("ORIGIN_UNVERIFIABLE") }
    if let last = input.legs.last, let end = last.end,
       let shapeEnd = (try? routeCoordinates(input, legIndex:input.legs.count-1))?.last ?? nil, valid(end), valid(shapeEnd) {
      if distance(destination, end) > staticGeometryEndpointToleranceMeters || distance(destination, shapeEnd) > staticGeometryEndpointToleranceMeters {
        reasons.append("DESTINATION_MISMATCH")
      }
    } else { reasons.append("DESTINATION_UNVERIFIABLE") }
    for index in 1..<input.legs.count {
      guard let previousEnd = input.legs[index - 1].end, let nextStart = input.legs[index].start,
            valid(previousEnd), valid(nextStart) else {
        reasons.append("LEG_CONTINUITY_UNVERIFIABLE")
        continue
      }
      if distance(previousEnd, nextStart) > 150 { reasons.append("LEG_CONTINUITY_GAP") }
      if let previousShapeEnd = (try? routeCoordinates(input, legIndex:index-1))?.last ?? nil,
         let nextShapeStart = (try? routeCoordinates(input, legIndex:index))?.first ?? nil,
         valid(previousShapeEnd), valid(nextShapeStart) {
        if distance(previousShapeEnd, nextShapeStart) > 150 { reasons.append("LEG_GEOMETRY_CONTINUITY_GAP") }
      } else { reasons.append("LEG_GEOMETRY_CONTINUITY_UNVERIFIABLE") }
    }
    return reasons
  }

  /// Separate walking contract only. Saved geometrySource/provider fields are never rewritten.
  static func routeCoordinates(_ input: Input, legIndex: Int) throws -> [Coordinate?] {
    guard input.legs.indices.contains(legIndex) else { throw ValidationError.bounds }
    if let snapshot = input.walkingSnapshot { try snapshot.validate(input:input) }
    if let path = snapshotWalkingPath(input,legIndex:legIndex) { return path.map(Optional.some) }
    return input.legs[legIndex].coordinates
  }

  // Street routing can leave the station and return via a different entrance. When the
  // saved transit itinerary supplies the actual same-station footpath, keep its geometry
  // and provenance. All other walks retain the server pedestrian snapshot when available.
  private static func snapshotWalkingPath(_ input: Input, legIndex: Int) -> [Coordinate]? {
    guard let fallback = input.walkingSnapshot?.walks.first(where: { $0.legIndex == legIndex }) else { return nil }
    return usesIndoorTransfer(input,legIndex:legIndex) ? nil : fallback.coordinates
  }
  private static func usesIndoorTransfer(_ input: Input, legIndex: Int) -> Bool {
    let leg = input.legs[legIndex]
    guard input.context == "SAVED_ROUTE", input.provider == "odsay", input.source == "api",
      legIndex > 0, legIndex + 1 < input.legs.count, legIndex % 2 == 0,
      leg.kind == "WALK", leg.exact, leg.geometryInputComplete == true, leg.geometrySource == "WALK_STEPS_LINESTRING",
      leg.stopEvidenceProvider == "odsay", leg.stopEvidenceVersion == 1, (2...2000).contains(leg.coordinates.count),
      input.legs[legIndex - 1].kind == "SUBWAY", input.legs[legIndex + 1].kind == "SUBWAY",
      let alight = input.legs[legIndex - 1].stops.last, let board = input.legs[legIndex + 1].stops.first,
      let name = transferStationName(alight.name), name == transferStationName(board.name),
      let from = alight.coordinate, let to = board.coordinate,
      let start = leg.start, let end = leg.end, let first = leg.coordinates.first ?? nil, let last = leg.coordinates.last ?? nil,
      [from,to,start,end].allSatisfy(valid),
      distance(first,from) <= 25, distance(last,to) <= 25,
      distance(first,start) <= 25, distance(last,end) <= 25 else { return false }
    let raw = evaluateGeometry(leg,provider:input.provider)
    return raw.usable && raw.length.map { (1...10_000).contains($0) } == true
  }

  private static func transferStationName(_ raw: String?) -> String? {
    guard let name = NoLateGuidanceRouteLayoutPolicy.safeName(raw) else { return nil }
    let compact = name.filter { !$0.isWhitespace }
    let normalized = compact.hasSuffix("역") ? String(compact.dropLast()) : compact
    return normalized.isEmpty ? nil : normalized
  }
  private static func evaluateGeometry(_ leg: Leg, provider: String, walkingPath: [Coordinate]? = nil,
    collapseAdjacentTransitVertices: Bool = false) -> Geometry {
    var reasons: [String] = []
    let trustedSources = leg.kind == "WALK"
      ? ["WALK_STEPS_LINESTRING", "WALK_PASS_SHAPE_LINESTRING"]
      : ((leg.kind == "BUS" || leg.kind == "SUBWAY") ? ["TRANSIT_PASS_SHAPE_LINESTRING"] : [])
    if walkingPath == nil {
      if !trustedSources.contains(leg.geometrySource) { reasons.append("GEOMETRY_PROVENANCE_UNTRUSTED") }
      if !leg.exact { reasons.append("GEOMETRY_NOT_EXACT") }
      if leg.geometryInputComplete != true { reasons.append("GEOMETRY_INPUT_UNVERIFIED") }
      let rerouteWalkProvider = leg.kind == "WALK" && provider == "odsay"
        && leg.geometrySource == "WALK_STEPS_LINESTRING" && leg.stopEvidenceProvider == "tmap"
      if !(leg.stopEvidenceProvider == provider || rerouteWalkProvider)
          || !["tmap", "odsay"].contains(provider) || leg.stopEvidenceVersion != 1 {
        reasons.append("GEOMETRY_EVIDENCE_UNVERIFIED")
      }
    }
    let path = walkingPath?.map(Optional.some) ?? leg.coordinates
    guard path.count >= 2 else {
      return Geometry(coordinates: [], length: nil, reasons: reasons + ["GEOMETRY_MISSING"])
    }
    guard path.allSatisfy({ $0.map(valid) ?? false }) else {
      // Do not filter out a bad middle point and connect the surrounding coordinates.
      return Geometry(coordinates: [], length: nil, reasons: reasons + ["GEOMETRY_COORDINATE_INVALID"])
    }
    let rawCoordinates = path.compactMap { $0 }
    // A bound transit shape may repeat the shared vertex of two adjacent links.
    // Collapse adjacent repeats only; distant repeats and reversed paths stay rejected.
    let coordinates = collapseAdjacentTransitVertices && ["BUS","SUBWAY"].contains(leg.kind)
      ? rawCoordinates.reduce(into: [Coordinate]()) { result, point in
          if result.last != point { result.append(point) }
        } : rawCoordinates
    if coordinates.count < 2 { return Geometry(coordinates: coordinates, length: 0,
      reasons: unique(reasons + ["GEOMETRY_ZERO_LENGTH"])) }
    if Set(coordinates).count != coordinates.count { reasons.append("GEOMETRY_DUPLICATE_COORDINATE") }
    let maximumSegment = leg.kind == "WALK" ? 150.0 : (leg.kind == "BUS" ? 2_000.0 : 5_000.0)
    var length = 0.0
    for index in 1..<coordinates.count {
      let segmentLength = distance(coordinates[index - 1], coordinates[index])
      length += segmentLength
      if segmentLength > maximumSegment { reasons.append("GEOMETRY_SEGMENT_GAP") }
    }
    if !length.isFinite || length <= 0 { reasons.append("GEOMETRY_ZERO_LENGTH") }
    if let start = leg.start, let end = leg.end, valid(start), valid(end) {
      if distance(start, coordinates[0]) > staticGeometryEndpointToleranceMeters || distance(end, coordinates[coordinates.count - 1]) > staticGeometryEndpointToleranceMeters {
        reasons.append("GEOMETRY_ENDPOINT_MISMATCH")
      }
    } else { reasons.append("LEG_ENDPOINT_INVALID_OR_MISSING") }
    if !reasons.contains("GEOMETRY_DUPLICATE_COORDINATE") {
      if let ambiguity = geometryAmbiguity(coordinates) { reasons.append(ambiguity) }
    }
    return Geometry(coordinates: coordinates, length: length.isFinite ? length : nil, reasons: unique(reasons))
  }

  private static func evaluateStops(_ leg: Leg, geometry: Geometry, provider: String) -> [String] {
    var reasons: [String] = []
    if leg.stopEvidenceProvider != provider || !["tmap", "odsay"].contains(provider) || leg.stopEvidenceVersion != 1 {
      reasons.append("STOP_EVIDENCE_UNVERIFIED")
    }
    if !geometry.usable { reasons.append("STOP_GEOMETRY_UNUSABLE") }
    guard leg.stops.count >= 2 else { return reasons + ["STOP_LIST_INCOMPLETE"] }
    if leg.declaredStationCount != leg.stops.count - 1 { reasons.append("STATION_COUNT_MISMATCH_OR_MISSING") }
    var previousSequence: Int?
    var sequenceValid = true
    var stopCoordinates: [Coordinate] = []
    for (index, stop) in leg.stops.enumerated() {
      if stop.sourceIndex != index { reasons.append("STOP_SOURCE_INDEX_INVALID") }
      if let sequence = stop.providerSequence, (0...9_007_199_254_740_991).contains(sequence) {
        if let previousSequence, previousSequence == Int.max || sequence != previousSequence + 1 { sequenceValid = false }
        previousSequence = sequence
      } else { sequenceValid = false }
      if !explicit(stop.code) { reasons.append("STOP_ID_MISSING") }
      if let coordinate = stop.coordinate, valid(coordinate) { stopCoordinates.append(coordinate) }
      else { reasons.append("STOP_COORDINATE_INVALID_OR_MISSING") }
    }
    if !sequenceValid { reasons.append("STOP_SEQUENCE_UNVERIFIED") }
    // Missing coordinates are not silently dropped into an apparently valid stop sequence.
    guard stopCoordinates.count == leg.stops.count else { return unique(reasons) }
    if Set(stopCoordinates).count != stopCoordinates.count { reasons.append("AMBIGUOUS_STOP_OCCURRENCE") }
    if let start = leg.start, let end = leg.end, valid(start), valid(end) {
      if distance(start, stopCoordinates[0]) > staticGeometryEndpointToleranceMeters || distance(end, stopCoordinates[stopCoordinates.count - 1]) > staticGeometryEndpointToleranceMeters {
        reasons.append("STOP_ENDPOINT_MISMATCH")
      }
    } else { reasons.append("STOP_ENDPOINT_UNVERIFIABLE") }
    guard geometry.coordinates.count >= 2 else { return unique(reasons) }
    var previousAlong: Double?
    for coordinate in stopCoordinates {
      let projections = segmentProjections(coordinate, onto: geometry.coordinates)
      guard let best = projections.min(by: { $0.cross < $1.cross }) else {
        reasons.append("STOP_PROJECTION_UNAVAILABLE")
        continue
      }
      if best.cross > staticGeometryEndpointToleranceMeters { reasons.append("STOP_OFF_GEOMETRY") }
      if projections.contains(where: { abs($0.cross - best.cross) <= 5 && abs($0.along - best.along) >= 30 }) {
        reasons.append("AMBIGUOUS_STOP_PROJECTION")
      }
      if let previousAlong, best.along <= previousAlong + 1 { reasons.append("STOP_PROGRESS_NON_MONOTONIC") }
      previousAlong = best.along
    }
    return unique(reasons)
  }

  private static func geometryAmbiguity(_ coordinates: [Coordinate]) -> String? {
    if coordinates.count >= 3 {
      for index in 1..<(coordinates.count - 1) {
        let before = vector(from: coordinates[index - 1], to: coordinates[index])
        let after = vector(from: coordinates[index], to: coordinates[index + 1])
        let denominator = hypot(before.0, before.1) * hypot(after.0, after.1)
        if denominator > 0, (before.0 * after.0 + before.1 * after.1) / denominator < -0.8 {
          return "GEOMETRY_BACKTRACKING"
        }
      }
    }
    guard coordinates.count >= 4 else { return nil }
    var comparisons = 0
    for first in 0..<(coordinates.count - 1) {
      guard first + 2 < coordinates.count - 1 else { continue }
      for second in (first + 2)..<(coordinates.count - 1) {
        comparisons += 1
        if comparisons > maximumIntersectionComparisons { return "GEOMETRY_COMPLEXITY_LIMIT" }
        if intersects(coordinates[first], coordinates[first + 1], coordinates[second], coordinates[second + 1]) {
          return "GEOMETRY_SELF_INTERSECTION"
        }
      }
    }
    return nil
  }

  private static func intersects(_ a: Coordinate, _ b: Coordinate, _ c: Coordinate, _ d: Coordinate) -> Bool {
    let bv = vector(from: a, to: b), cv = vector(from: a, to: c), dv = vector(from: a, to: d)
    let cross1 = bv.0 * cv.1 - bv.1 * cv.0
    let cross2 = bv.0 * dv.1 - bv.1 * dv.0
    let cross3 = (dv.0 - cv.0) * -cv.1 - (dv.1 - cv.1) * -cv.0
    let cross4 = (dv.0 - cv.0) * (bv.1 - cv.1) - (dv.1 - cv.1) * (bv.0 - cv.0)
    if ((cross1 > 0 && cross2 < 0) || (cross1 < 0 && cross2 > 0))
      && ((cross3 > 0 && cross4 < 0) || (cross3 < 0 && cross4 > 0)) { return true }
    let epsilon = 0.001
    func onSegment(_ p: (Double, Double), _ q: (Double, Double), _ r: (Double, Double)) -> Bool {
      r.0 >= min(p.0, q.0) - epsilon && r.0 <= max(p.0, q.0) + epsilon
        && r.1 >= min(p.1, q.1) - epsilon && r.1 <= max(p.1, q.1) + epsilon
    }
    return (abs(cross1) <= epsilon && onSegment((0, 0), bv, cv))
      || (abs(cross2) <= epsilon && onSegment((0, 0), bv, dv))
      || (abs(cross3) <= epsilon && onSegment(cv, dv, (0, 0)))
      || (abs(cross4) <= epsilon && onSegment(cv, dv, bv))
  }

  private static func segmentProjections(_ coordinate: Coordinate, onto shape: [Coordinate]) -> [Projection] {
    var cumulative = 0.0
    var result: [Projection] = []
    for index in 1..<shape.count {
      let start = shape[index - 1], end = shape[index]
      let delta = vector(from: start, to: end), point = vector(from: start, to: coordinate)
      let squaredLength = delta.0 * delta.0 + delta.1 * delta.1
      let length = distance(start, end)
      defer { cumulative += length }
      guard squaredLength > 0 else { continue }
      let fraction = min(1, max(0, (point.0 * delta.0 + point.1 * delta.1) / squaredLength))
      let projection = Coordinate(latitude: start.latitude + (end.latitude - start.latitude) * fraction,
                                  longitude: wrap(start.longitude + wrap(end.longitude - start.longitude) * fraction))
      result.append(Projection(along: cumulative + length * fraction, cross: distance(coordinate, projection), point: projection))
    }
    return result
  }

  private static func vector(from start: Coordinate, to end: Coordinate) -> (Double, Double) {
    let radians = Double.pi / 180
    return (wrap(end.longitude - start.longitude) * radians * earthRadius * cos(start.latitude * radians),
            (end.latitude - start.latitude) * radians * earthRadius)
  }

  private static func distance(_ start: Coordinate, _ end: Coordinate) -> Double {
    let radians = Double.pi / 180
    let a = pow(sin((end.latitude - start.latitude) * radians / 2), 2)
      + cos(start.latitude * radians) * cos(end.latitude * radians) * pow(sin(wrap(end.longitude - start.longitude) * radians / 2), 2)
    return earthRadius * 2 * asin(sqrt(min(1, max(0, a))))
  }

  private static func wrap(_ value: Double) -> Double {
    let result = value.truncatingRemainder(dividingBy: 360)
    return result > 180 ? result - 360 : (result < -180 ? result + 360 : result)
  }

  private static func valid(_ coordinate: Coordinate) -> Bool {
    coordinate.latitude.isFinite && coordinate.longitude.isFinite
      && abs(coordinate.latitude) <= 90 && abs(coordinate.longitude) <= 180
  }

  private static func shortString(_ string: String?) -> Bool { (string?.utf8.count ?? 0) <= 256 }
  private static func explicit(_ string: String?) -> Bool {
    guard let value = string?.trimmingCharacters(in: .whitespacesAndNewlines) else { return false }
    return !value.isEmpty && value != "UNKNOWN"
  }
  private static func unique(_ values: [String]) -> [String] {
    var seen: Set<String> = []
    return values.filter { seen.insert($0).inserted }
  }
}
