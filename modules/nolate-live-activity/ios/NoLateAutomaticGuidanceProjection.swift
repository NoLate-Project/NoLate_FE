import Foundation

enum NoLateAutomaticGuidanceProjection {
  /// Static display evidence shared with Activity attributes, fenced to the same immutable route.
  static func displayRoute(_ session: NoLateJourneyAutomaticSession) -> [String: Any]? {
    guard session.binding.savedRouteValidated == true, session.binding.guidanceEnabled == true,
      let data = try? JSONEncoder().encode(session.routeLegs),
      let legs = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return nil }
    let binding = session.binding
    return ["sessionId": binding.sessionId, "scheduleId": binding.scheduleId, "generation": binding.generation,
      "routeRevision": binding.routeRevision, "routeInputDigest": binding.routeInputDigest, "legs": legs]
  }
  /// Ephemeral UI location only. Never added to Activity content, checkpoints or HTTP requests.
  static func position(_ session: NoLateJourneyAutomaticSession, coordinate: NoLateJourneyEngineCore.Coordinate,
    accuracy: Double, observedAt: Double, now: Double) -> [String: Double]? {
    let content = content(session, now: now)
    guard session.binding.savedRouteValidated == true, session.binding.guidanceEnabled == true,
      ["SANDBOX", "AUTHENTICATED"].contains(session.binding.syncScope), content.status == "ACTIVE", content.quality == "GOOD",
      content.observedAt == observedAt, now < content.validUntil,
      accuracy.isFinite, accuracy >= 0, accuracy <= session.core.snapshot.policy.maximumAccuracyMeters,
      coordinate.latitude.isFinite, coordinate.longitude.isFinite,
      abs(coordinate.latitude) <= 90, abs(coordinate.longitude) <= 180 else { return nil }
    return ["latitude": coordinate.latitude, "longitude": coordinate.longitude, "accuracyMeters": accuracy,
      "observedAt": observedAt, "validUntil": content.validUntil]
  }
  static func content(_ session: NoLateJourneyAutomaticSession, now: TimeInterval,
    arrival: NoLateSavedGuidanceArrivalPolicy.Result? = nil) -> NoLateGuidanceContent {
    let core = session.core.snapshot, bus = session.bus?.snapshot, ride = session.ride?.snapshot
    let busIndex = bus?.route.legIndex ?? 1
    var phase = "UNAVAILABLE", quality = "UNCERTAIN", instruction = "현재 위치 확인 필요", index = 0
    var progress: Double?
    var observation = bus?.quality == .good ? bus?.lastObservationAt : core.lastObservationAt
    var expiry = min(session.binding.expiresAtEpochSeconds, (observation ?? now - 15) + 15)
    var rideProgress: Double?
    var subwayPosition: NoLateGuidanceSubway?
    var lastConfirmedSubway: NoLateGuidanceLastSubway?
    if core.status == .active, let subway = session.subway, !session.walkingHandoffCommitted,
      let at = subway.snapshot.observedAt, let until = subway.snapshot.validUntil,
      at >= core.armedAt, at <= now, now < until, until <= at + 15 {
      observation = at; expiry = min(session.binding.expiresAtEpochSeconds,until)
      if subway.snapshot.phase == "WAITING" {
        phase = "WAITING"; quality = "GOOD"; instruction = "정류장 대기 · 탑승 미확정"
        index = subway.route.legIndex; progress = 1
      } else if subway.snapshot.phase == "RIDING", subway.snapshot.boardingConfirmed,
        let stop = subway.snapshot.currentStopIndex,
        let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self,from:Data(session.routeJSON.utf8)),
        input.legs.indices.contains(subway.route.legIndex) {
        let stops = input.legs[subway.route.legIndex].stops
        if stops.count == subway.route.stations.count, stops.indices.contains(stop),
          let name = NoLateGuidanceRouteLayoutPolicy.safeName(stops[stop].name) {
          let next = stop + 1 < stops.count ? NoLateGuidanceRouteLayoutPolicy.safeName(stops[stop+1].name) : nil
          let position = NoLateGuidanceSubway(currentStopIndex:stop,totalStops:stops.count,currentStopName:name,nextStopName:next)
          if position.valid { subwayPosition = position; phase = "RIDING"; quality = "GOOD"; instruction = "지하철로 이동 중"
            index = subway.route.legIndex; rideProgress = Double(stop)/Double(stops.count-1) }
        }
      }
    }
    if core.status == .active, let transfer = session.transferWalk, transfer.committed,
      transfer.snapshot.phase == "TRANSFER_WALK", let at = transfer.snapshot.observedAt,
      let until = transfer.snapshot.validUntil, let along = transfer.snapshot.along {
      let length = transfer.route.walk.length
      if [at,until,along,length].allSatisfy(\.isFinite), at >= core.armedAt, at <= now,
        now < until, until <= at + 15, (1...10_000).contains(length), (0...length).contains(along) {
        observation = at; expiry = min(session.binding.expiresAtEpochSeconds,until)
        if now < expiry { phase = "TRANSFER_WALK"; quality = "GOOD"; instruction = "환승 승차 지점으로 도보 이동 중"
          index = transfer.route.walkingLegIndex; progress = along / length }
      }
    }
    if core.status == .active, session.finalWalk?.committed == true, let walk = session.finalWalk?.snapshot,
      walk.phase == "FINAL_WALK", let at = walk.observedAt, let until = walk.validUntil, let along = walk.along,
      let length = session.finalWalk?.route.length, [at,until,along,length].allSatisfy(\.isFinite),
      at >= core.armedAt, at <= now, now < until, until <= at + 15,
      length >= 70, along >= 0, along <= length,
      let walkIndex = session.finalWalk?.route.walkingLegIndex,
      walkIndex == session.routeLegs.count - 1, walkIndex > 1,
      session.routeLegs[walkIndex].kind == "WALK", session.routeLegs[walkIndex - 1].kind == "BUS" {
      observation = at; expiry = min(session.binding.expiresAtEpochSeconds,until)
      if now < expiry { phase = "FINAL_WALK"; quality = "GOOD"; instruction = "목적지로 도보 이동 중"; index = walkIndex; progress = along / length }
    }
    if core.status == .active, let ride, ride.phase == "RIDING", ride.quality == "GOOD", ride.boardingConfirmed,
      let at = ride.observedAt, let until = ride.validUntil, let along = ride.alongRouteMeters, let length = ride.routeLengthMeters,
      [now, at, until, along, length].allSatisfy(\.isFinite), at >= core.armedAt, at <= now + 2,
      now < until, until <= at + 15, length >= 100, length <= 100_000, along >= 0, along <= length,
      session.routeLegs.count > busIndex, session.routeLegs[busIndex].kind == "BUS" {
      observation = at; expiry = min(session.binding.expiresAtEpochSeconds, until)
      if now < expiry { phase = "RIDING"; quality = "GOOD"; instruction = "버스로 이동 중"; index = busIndex; rideProgress = along / length }
    }
    if core.status == .armed {
      phase = "READY"; quality = "UNAVAILABLE"; instruction = "이동하면 출발을 감지합니다"
      // The prepared surface lasts only for the server lease, never claims a fresh fix.
      observation = nil; expiry = session.binding.expiresAtEpochSeconds
    }
    else if core.status.isTerminal { phase = "STOPPED"; quality = "UNAVAILABLE"; instruction = "길안내 종료" }
    // Never fall back to a first-stop marker after a walking handoff has committed.
    else if now < expiry && phase == "UNAVAILABLE" && !session.walkingHandoffCommitted {
      if let bus, bus.quality == .good {
        switch bus.phase {
        case .waiting: phase = "WAITING"; quality = "GOOD"; instruction = "정류장 대기 · 탑승 미확정"; index = busIndex; progress = 1
        case .approachingStop: phase = "APPROACHING_STOP"; quality = "GOOD"; instruction = "승차 정류장에 접근 중"; index = busIndex - 1; progress = bus.walkingProgress
        case .boardingCandidate: phase = "BOARDING_CANDIDATE"; quality = "UNCERTAIN"; instruction = "탑승 여부 확인 필요 · 미확정"; index = busIndex
        case .walkingToStop where busIndex > 1:
          phase = "WALKING_TO_STOP"; quality = "GOOD"; instruction = "승차 정류장으로 이동 중"; index = busIndex - 1; progress = bus.walkingProgress
        default: break
        }
      }
      if busIndex == 1, session.subway == nil, core.quality == .good && phase == "UNAVAILABLE" { phase = "WALKING_TO_STOP"; quality = "GOOD"; instruction = "승차 정류장으로 이동 중" }
      if busIndex == 1, quality == "GOOD", progress == nil, let along = core.alongRouteMeters {
        let points = core.route.coordinates
        var length = 0.0
        for pair in zip(points, points.dropFirst()) {
          let a = pair.0, b = pair.1, r = Double.pi / 180
          let h = pow(sin((b.latitude - a.latitude) * r / 2), 2) + cos(a.latitude * r) * cos(b.latitude * r) * pow(sin((b.longitude - a.longitude) * r / 2), 2)
          length += 6371000 * 2 * asin(sqrt(min(1, max(0, h))))
        }
        if length > 0 { progress = min(1, max(0, along / length)) }
      }
    }
    if core.status == .active, phase == "UNAVAILABLE", !session.walkingHandoffCommitted,
      let subway = session.subway, session.routeLegs.indices.contains(subway.route.legIndex),
      session.routeLegs[subway.route.legIndex].kind == "SUBWAY",
      let stop = subway.snapshot.lastConfirmedStopIndex, let at = subway.snapshot.lastConfirmedAt,
      let input = try? JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(session.routeJSON.utf8)),
      input.legs.indices.contains(subway.route.legIndex) {
      let stops = input.legs[subway.route.legIndex].stops
      if stops.count == subway.route.stations.count, stops.indices.contains(stop),
        let name = NoLateGuidanceRouteLayoutPolicy.safeName(stops[stop].name) {
        let last = NoLateGuidanceLastSubway(stopIndex: stop, totalStops: stops.count, stopName: name, confirmedAt: at)
        if last.valid(now: now) { lastConfirmedSubway = last }
      }
    }
    let sequence = core.sequence.addingReportingOverflow(bus?.sequence ?? 0)
    let ridingSequence = sequence.partialValue.addingReportingOverflow(ride?.sequence ?? 0)
    let finalSequence = ridingSequence.partialValue.addingReportingOverflow(session.finalWalk?.snapshot.sequence ?? 0)
    let transferSequence = finalSequence.partialValue.addingReportingOverflow(session.transferWalk?.snapshot.sequence ?? 0)
    let subwaySequence = transferSequence.partialValue.addingReportingOverflow(session.subway?.snapshot.sequence ?? 0)
    let retiredSequence = subwaySequence.partialValue.addingReportingOverflow(session.completedLegSequence)
    return .init(sessionId: session.binding.sessionId, scheduleId: session.binding.scheduleId,
      generation: session.binding.generation, routeRevision: session.binding.routeRevision, routeInputDigest: session.binding.routeInputDigest,
      sequence: sequence.overflow || ridingSequence.overflow || finalSequence.overflow || transferSequence.overflow || subwaySequence.overflow || retiredSequence.overflow ? Int64.max : retiredSequence.partialValue, status: core.status.rawValue, phase: phase, quality: quality,
      instruction: instruction, activeLegIndex: index, walkProgress: quality == "GOOD" ? progress : nil,
      observedAt: observation, validUntil: expiry, arrivalStatus: arrival?.status,
      arrival: busIndex == arrival?.busLegIndex && quality == "GOOD" && ["APPROACHING_STOP", "WAITING"].contains(phase)
        && arrival?.arrival.map({ now < $0.validUntil && now < $0.expectedAt }) == true ? arrival?.arrival : nil,
      rideProgress: rideProgress, boardingConfirmed: phase == "RIDING",
      alighting: phase == "RIDING" ? NoLateJourneyBusAlightingPolicy.notice(route:session.alightingRoute, ride:ride, now:now) : nil,
      subway: subwayPosition, lastConfirmedSubway: lastConfirmedSubway)
  }
}
