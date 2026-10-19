import Foundation

/// Immutable, validated display metadata only. Never contains live GPS or credentials.
public struct NoLateGuidanceRouteLeg: Codable, Hashable, Sendable {
  public let index: Int
  public let kind: String
  public let walkingLengthMeters: Double?
  public let boardingStopName: String?
  public let alightingStopName: String?
  public let lineName: String?
  public let lineColor: String?
  public let durationMinutes: Double?
  public let distanceMeters: Double?
  public init(index: Int, kind: String, walkingLengthMeters: Double? = nil, boardingStopName: String? = nil,
    lineName: String? = nil, lineColor: String? = nil, durationMinutes: Double? = nil, distanceMeters: Double? = nil,
    alightingStopName: String? = nil) {
    self.index = index; self.kind = kind
    self.walkingLengthMeters = walkingLengthMeters; self.boardingStopName = boardingStopName
    self.alightingStopName = alightingStopName
    self.lineName = lineName; self.lineColor = lineColor; self.durationMinutes = durationMinutes; self.distanceMeters = distanceMeters
  }
}

public struct NoLateGuidanceRouteLayout: Equatable, Sendable {
  public let basis: String
  public let fractions: [Double]
  public var caption: String { basis == "TIME" ? "예정 시간 비례" : basis == "DISTANCE" ? "경로 거리 비례" : "구간 동일 폭" }
  public func start(_ index: Int) -> Double { fractions.prefix(index).reduce(0, +) }
}
/// Static planned proportions, not whole-journey completion or live ETA. Never mixes units.
public enum NoLateGuidanceRouteLayoutPolicy {
  public static func validTopology(_ legs: [NoLateGuidanceRouteLeg]) -> Bool {
    !legs.isEmpty && legs.count <= 32 && legs.enumerated().allSatisfy {
      $0.offset == $0.element.index && ["WALK", "BUS", "SUBWAY", "ETC", "UNKNOWN"].contains($0.element.kind)
    }
  }
  /// Keep static legs under 2.2 KB so Activity attributes + v1 content fit the 4 KB budget.
  /// All display weights are dropped together: never mix partially budgeted units.
  public static func budgeted(_ legs: [NoLateGuidanceRouteLeg]) -> [NoLateGuidanceRouteLeg] {
    if let data = try? JSONEncoder().encode(legs), data.count <= 2200 { return legs }
    return legs.map { .init(index: $0.index, kind: $0.kind,
      walkingLengthMeters: $0.walkingLengthMeters, boardingStopName: $0.boardingStopName, alightingStopName: $0.alightingStopName) }
  }
  public static func layout(_ legs: [NoLateGuidanceRouteLeg]) -> NoLateGuidanceRouteLayout {
    guard validTopology(legs) else { return .init(basis: "EQUAL", fractions: []) }
    let times = legs.compactMap { number($0.durationMinutes, maximum: 1440) }
    let distances = legs.compactMap { number($0.distanceMeters, maximum: 10_000_000) }
    let basis = times.count == legs.count ? "TIME" : distances.count == legs.count ? "DISTANCE" : "EQUAL"
    let values = basis == "TIME" ? times : basis == "DISTANCE" ? distances : legs.map { _ in 1.0 }
    let total = values.reduce(0, +)
    return .init(basis: basis, fractions: values.map { $0 / total })
  }
  public static func number(_ value: Double?, maximum: Double) -> Double? {
    value.flatMap { $0.isFinite && $0 > 0 && $0 <= maximum ? $0 : nil }
  }
  public static func safeName(_ value: String?) -> String? {
    guard let value, !value.unicodeScalars.contains(where: { $0.value <= 31 || (127...159).contains($0.value) }) else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return !trimmed.isEmpty && trimmed.utf16.count <= 64 && trimmed.utf8.count <= 256 ? trimmed : nil
  }
  public static func safeColor(_ value: String?) -> String? {
    guard let value, value.utf8.count == (value.hasPrefix("#") ? 7 : 6),
      value.range(of: "^#?[0-9a-fA-F]{6}$", options: .regularExpression) != nil else { return nil }
    return "#" + value.replacingOccurrences(of: "#", with: "").uppercased()
  }
  public static func label(_ leg: NoLateGuidanceRouteLeg) -> String {
    if ["BUS", "SUBWAY"].contains(leg.kind), let name = safeName(leg.lineName) { return name }
    switch leg.kind { case "WALK": return "도보"; case "BUS": return "버스"; case "SUBWAY": return "지하철"; default: return "이동" }
  }
  /// Black/white glyph ink uses the greater sRGB contrast; route colour remains unchanged.
  public static func darkIconInk(_ value: String?) -> Bool {
    guard let hex = safeColor(value), let rgb = UInt32(hex.dropFirst(), radix: 16) else { return false }
    func linear(_ channel: UInt32) -> Double {
      let c = Double(channel) / 255
      return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }
    let luminance = 0.2126 * linear((rgb >> 16) & 255) + 0.7152 * linear((rgb >> 8) & 255) + 0.0722 * linear(rgb & 255)
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
  }
}

public struct NoLateGuidancePresentation: Equatable, Sendable {
  public let title: String
  public let action: String
  public let symbol: String
  public let compact: String
}

/// Human instructions use the same fresh position evidence as the marker, never elapsed time.
public enum NoLateGuidancePresentationPolicy {
  /// Preparation is a lease, not GPS evidence. Never supplies a position or announcement.
  public static func isPrepared(_ content: NoLateGuidanceContent, legs: [NoLateGuidanceRouteLeg], now: Double) -> Bool {
    now.isFinite && now > 0 && content.schemaVersion == 1 && content.status == "ARMED" && content.phase == "READY"
      && content.quality == "UNAVAILABLE" && content.activeLegIndex == 0 && content.sequence >= 0
      && content.generation > 0 && content.routeRevision > 0 && !content.sessionId.isEmpty && !content.routeInputDigest.isEmpty
      && content.validUntil.isFinite && now < content.validUntil
      && content.observedAt == nil && content.walkProgress == nil && content.rideProgress == nil && !content.boardingConfirmed
      && content.alighting == nil && content.arrival == nil
      && legs.count >= 3 && legs.count % 2 == 1 && ["BUS","SUBWAY"].contains(legs[1].kind)
      && legs.enumerated().allSatisfy({ $0.offset % 2 == 0 ? $0.element.kind == "WALK" : ["BUS","SUBWAY"].contains($0.element.kind) })
      && NoLateGuidanceRouteLayoutPolicy.validTopology(legs)
  }
  public static func presentation(_ content: NoLateGuidanceContent, legs: [NoLateGuidanceRouteLeg],
    now: Double, isStale: Bool = false) -> NoLateGuidancePresentation {
    if !isStale && isPrepared(content, legs: legs, now: now) {
      return .init(title: "출발 대기", action: "이동하면 출발을 감지합니다", symbol: "figure.walk", compact: "출발 대기")
    }
    guard let position = NoLateGuidanceRoutePositionPolicy.position(content, legs: legs, now: now, isStale: isStale) else {
      if content.status == "ACTIVE", content.phase == "UNAVAILABLE", content.schemaVersion == 1,
        legs.count > 1, legs[1].kind == "SUBWAY", let last = content.lastConfirmedSubway,
        last.valid(now: now) {
        let age = Int((now - last.confirmedAt) / 60)
        let ageText = age < 1 ? "방금 확인" : "\(age)분 전 확인"
        return .init(title: "마지막 확인 · \(last.stopName)", action: "현재 위치 재확인 중 · \(ageText)",
          symbol: "location.slash", compact: "역 확인 중")
      }
      return .init(title: "위치 확인 중", action: "앱에서 현재 경로를 확인해 주세요", symbol: "location.slash", compact: "확인 중")
    }
    if content.phase == "RIDING" {
      if let subway = content.subway, subway.valid {
        return .init(title: subway.currentStopName,
          action: subway.remainingStops == 0 ? "하차역 도착 · 하차 확인 중" : subway.remainingStops == 1
            ? "다음 역 하차 · 하차 준비" : "다음 \(subway.nextStopName ?? "역") · \(subway.remainingStops)개 역 남음",
          symbol: "tram.fill", compact: subway.remainingStops <= 1 ? "하차 준비" : "\(subway.remainingStops)개 역")
      }
      if let notice = content.alighting {
        return .init(title: NoLateGuidanceRouteLayoutPolicy.safeName(legs[position.legIndex].alightingStopName) ?? "하차 정류장",
          action: notice.action, symbol: "bus.fill", compact: notice.kind == "NEAR_STOP" ? "하차 준비" : "다음 정류장")
      }
      let name = NoLateGuidanceRouteLayoutPolicy.safeName(legs[position.legIndex].lineName)
      return .init(title: name ?? "버스 이동 중", action: "버스로 이동 중", symbol: "bus.fill", compact: "버스 이동 중")
    }
    if content.phase == "FINAL_WALK" {
      let length = legs[position.legIndex].walkingLengthMeters!
      let metres = Int(ceil(max(0,length * (1 - position.legProgress) - 0.000001) / 10) * 10)
      let action = metres > 0 ? "도보 약 \(metres)m" : "목적지 근처 · 위치 확인"
      return .init(title:"목적지까지",action:action,symbol:"figure.walk",compact:action)
    }
    if content.phase == "TRANSFER_WALK" {
      let i = position.legIndex, length = legs[i].walkingLengthMeters!
      let metres = Int(ceil(max(0,length * (1 - position.legProgress) - 0.000001) / 10) * 10)
      let name = NoLateGuidanceRouteLayoutPolicy.safeName(legs[i + 1].boardingStopName)
      let action = metres > 0 ? "환승 도보 약 \(metres)m" : "승차 지점 근처 · 탑승 대기"
      return .init(title:name.map { "\($0) 환승" } ?? "다음 승차 지점까지",action:action,symbol:"figure.walk",compact:action)
    }
    let boardingIndex = position.legIndex + 1
    let rawName = legs.count > boardingIndex ? legs[boardingIndex].boardingStopName : nil
    let name = rawName?.trimmingCharacters(in: .whitespacesAndNewlines)
    let safeName = name.flatMap { !$0.isEmpty && $0.utf8.count <= 256
      && !$0.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) ? $0 : nil }
    if content.phase == "WAITING" {
      if legs.count > boardingIndex, legs[boardingIndex].kind == "SUBWAY" {
        return .init(title:safeName ?? "승차역",action:"열차 대기 · 탑승 확인 전",symbol:"tram.fill",compact:"열차 대기")
      }
      return .init(title: safeName ?? "승차 정류장", action: "버스 대기 · 도착하면 탑승 준비", symbol: "bus.fill", compact: "버스 대기")
    }
    var distance: String?
    if let length = legs[position.legIndex].walkingLengthMeters, length.isFinite, length >= 1, length <= 100_000 {
      // Round upward to 10 m, not centimetre precision implied by a GPS projection.
      let metres = Int(ceil(length * (1 - position.legProgress) / 10) * 10)
      distance = metres > 0 ? "도보 약 \(metres)m" : "승차 지점 근처"
    }
    return .init(title: safeName.map { "\($0)까지" } ?? "승차 지점까지",
      action: distance ?? "도보로 이동 중", symbol: "figure.walk", compact: distance ?? "도보 이동")
  }

  public static func freshArrival(_ content: NoLateGuidanceContent, legs: [NoLateGuidanceRouteLeg],
    now: Double, isStale: Bool = false) -> NoLateGuidanceArrival? {
    guard NoLateGuidanceRoutePositionPolicy.position(content, legs: legs, now: now, isStale: isStale) != nil,
      ["APPROACHING_STOP", "WAITING"].contains(content.phase), content.arrivalStatus == "WAITING_INFORMATION",
      let arrival = content.arrival, arrival.expectedAt.isFinite, arrival.expectedAt > now,
      arrival.sourceUpdatedAt.isFinite, arrival.sourceUpdatedAt <= now + 5,
      arrival.expectedAt > arrival.sourceUpdatedAt, arrival.expectedAt <= arrival.sourceUpdatedAt + 3600,
      arrival.validUntil.isFinite, arrival.validUntil > now,
      arrival.validUntil <= min(arrival.sourceUpdatedAt + 120, arrival.expectedAt) else { return nil }
    return arrival
  }
}

public struct NoLateGuidanceRoutePosition: Equatable, Sendable {
  public let legIndex: Int
  public let legProgress: Double
  public let barFraction: Double
}

/// Waiting anchors at the boarding boundary. V2 RIDING needs explicit fresh native confirmation.
public enum NoLateGuidanceRoutePositionPolicy {
  public static func position(_ content: NoLateGuidanceContent, legs: [NoLateGuidanceRouteLeg],
    now: Double, isStale: Bool = false) -> NoLateGuidanceRoutePosition? {
    guard !isStale, now.isFinite, content.status == "ACTIVE", content.quality == "GOOD",
      let observation = content.observedAt, observation.isFinite, observation <= now + 2,
      content.validUntil.isFinite, now < content.validUntil, content.validUntil <= observation + 15,
      !legs.isEmpty, legs.count <= 32, legs.first?.kind == "WALK",
      legs.enumerated().allSatisfy({ $0.offset == $0.element.index && ["WALK", "BUS", "SUBWAY", "ETC", "UNKNOWN"].contains($0.element.kind) }) else { return nil }
    let layout = NoLateGuidanceRouteLayoutPolicy.layout(legs)
    if content.schemaVersion == 8 {
      let i = content.activeLegIndex
      guard content.phase == "RIDING", i >= 1, i < legs.count, i % 2 == 1, legs[i].kind == "SUBWAY",
        content.boardingConfirmed, content.walkProgress == nil, content.alighting == nil, content.arrival == nil,
        let subway = content.subway, subway.valid, let p = content.rideProgress,
        p.isFinite, abs(p - Double(subway.currentStopIndex)/Double(subway.totalStops-1)) < 0.000001 else { return nil }
      return .init(legIndex:i,legProgress:p,barFraction:layout.start(i)+p*layout.fractions[i])
    }
    guard content.subway == nil else { return nil }
    if [6,7].contains(content.schemaVersion) {
      let i = content.activeLegIndex
      guard legs.count >= 5, legs.count <= 31, legs.count % 2 == 1, i >= 2, i < legs.count,
        legs.enumerated().allSatisfy({ $0.offset % 2 == 0 ? $0.element.kind == "WALK" : ["BUS","SUBWAY"].contains($0.element.kind) }),
        content.schemaVersion == 6 ? content.arrival == nil :
          ["WAITING","APPROACHING_STOP"].contains(content.phase) && content.arrivalStatus == "WAITING_INFORMATION"
          && content.arrival?.busLegIndex == (content.phase == "WAITING" ? i : i + 1) else { return nil }
      if content.phase == "RIDING" {
        guard i % 2 == 1, legs[i].kind == "BUS", content.boardingConfirmed, content.walkProgress == nil,
          content.alighting == nil || content.alighting?.valid == true,
          let p = content.rideProgress, p.isFinite, (0...1).contains(p) else { return nil }
        return .init(legIndex:i,legProgress:p,barFraction:layout.start(i) + p * layout.fractions[i])
      }
      guard !content.boardingConfirmed, content.rideProgress == nil, content.alighting == nil,
        let p = content.walkProgress, p.isFinite, (0...1).contains(p) else { return nil }
      let walkIndex: Int
      if content.phase == "WAITING" {
        guard i % 2 == 1, legs[i].kind == "BUS", p == 1 else { return nil }; walkIndex = i - 1
      } else if content.phase == "FINAL_WALK" {
        guard i == legs.count - 1, i % 2 == 0, legs[i - 1].kind == "BUS" else { return nil }; walkIndex = i
      } else if ["WALKING_TO_STOP","APPROACHING_STOP"].contains(content.phase) {
        guard i % 2 == 0, i < legs.count - 1, legs[i + 1].kind == "BUS" else { return nil }; walkIndex = i
      } else { return nil }
      guard let length = legs[walkIndex].walkingLengthMeters, length.isFinite,
        (content.phase == "FINAL_WALK" ? 70.0 : 1.0)...10_000 ~= length else { return nil }
      return .init(legIndex:walkIndex,legProgress:p,barFraction:layout.start(walkIndex) + p * layout.fractions[walkIndex])
    }
    if content.phase == "TRANSFER_WALK" {
      let i = content.activeLegIndex
      guard content.schemaVersion == 5, legs.count >= 5, legs.count % 2 == 1,
        i >= 2, i % 2 == 0, i + 1 < legs.count - 1, legs[i - 1].kind == "BUS",
        legs.enumerated().allSatisfy({ $0.offset % 2 == 0 ? $0.element.kind == "WALK" : ["BUS","SUBWAY"].contains($0.element.kind) }),
        !content.boardingConfirmed, content.rideProgress == nil, content.alighting == nil, content.arrival == nil,
        let length = legs[i].walkingLengthMeters, length.isFinite, (1...10_000).contains(length),
        let progress = content.walkProgress, progress.isFinite, (0...1).contains(progress) else { return nil }
      return .init(legIndex:i,legProgress:progress,barFraction:layout.start(i) + progress * layout.fractions[i])
    }
    if content.phase == "FINAL_WALK" {
      guard content.schemaVersion == 4, legs.map(\.kind) == ["WALK","BUS","WALK"],
        content.activeLegIndex == 2, !content.boardingConfirmed, content.rideProgress == nil,
        content.alighting == nil, content.arrival == nil,
        let length = legs[2].walkingLengthMeters, length.isFinite, (70...10_000).contains(length),
        let progress = content.walkProgress, progress.isFinite, (0...1).contains(progress) else { return nil }
      return .init(legIndex:2,legProgress:progress,barFraction:layout.start(2) + progress * layout.fractions[2])
    }
    if content.phase == "RIDING" {
      guard (content.schemaVersion == 2 && content.alighting == nil || content.schemaVersion == 3 && content.alighting?.valid == true),
        content.boardingConfirmed, content.activeLegIndex == 1,
        legs.count > 1, legs[1].kind == "BUS", content.walkProgress == nil,
        let progress = content.rideProgress, progress.isFinite, (0...1).contains(progress) else { return nil }
      return .init(legIndex: 1, legProgress: progress, barFraction: layout.start(1) + progress * layout.fractions[1])
    }
    guard content.schemaVersion == 1, !content.boardingConfirmed, content.rideProgress == nil, content.alighting == nil,
      let progress = content.walkProgress, progress.isFinite, (0...1).contains(progress) else { return nil }
    if ["WALKING_TO_STOP", "APPROACHING_STOP"].contains(content.phase) {
      guard content.activeLegIndex == 0 else { return nil }
    } else if content.phase == "WAITING" {
      guard legs.count > 1, ["BUS","SUBWAY"].contains(legs[1].kind), content.activeLegIndex == 1, progress == 1 else { return nil }
    } else { return nil }
    return .init(legIndex: 0, legProgress: progress, barFraction: progress * NoLateGuidanceRouteLayoutPolicy.layout(legs).fractions[0])
  }
}

public struct NoLateGuidanceArrival: Codable, Hashable, Sendable {
  public let busLegIndex: Int?
  public let providerRouteId: String
  public let directionLabel: String
  public let expectedAt: Double
  public let sourceUpdatedAt: Double
  public let validUntil: Double
  public init(providerRouteId: String, directionLabel: String, expectedAt: Double, sourceUpdatedAt: Double, validUntil: Double, busLegIndex: Int? = nil) {
    self.busLegIndex = busLegIndex
    self.providerRouteId = providerRouteId; self.directionLabel = directionLabel; self.expectedAt = expectedAt
    self.sourceUpdatedAt = sourceUpdatedAt; self.validUntil = validUntil
  }
}

/// Distance along a verified bus shape, NOT an ETA or proof that the passenger got off.
public struct NoLateGuidanceAlighting: Codable, Hashable, Sendable {
  public let kind: String
  public let remainingMeters: Double
  public var valid: Bool {
    ["ONE_STOP_BEFORE", "NEAR_STOP"].contains(kind) && remainingMeters.isFinite
      && (0...100_000).contains(remainingMeters) && remainingMeters.truncatingRemainder(dividingBy: 10) == 0
      && (kind != "NEAR_STOP" || remainingMeters <= 50)
  }
  public var action: String {
    guard valid else { return "하차 정보 확인 필요" }
    return kind == "NEAR_STOP" ? "정류장 근처 · 하차 준비" : "다음 정류장 · 약 \(Int(remainingMeters))m 앞 · 하차 준비"
  }
}

/// One native projection is consumed by both route detail and the local ActivityKit surface.
/// A confirmed station occurrence, not clock-interpolated tunnel GPS or an ETA.
public struct NoLateGuidanceSubway: Codable, Hashable, Sendable {
  public let currentStopIndex: Int
  public let totalStops: Int
  public let currentStopName: String
  public let nextStopName: String?
  public var remainingStops: Int { totalStops - 1 - currentStopIndex }
  public var valid: Bool {
    (2...500).contains(totalStops) && (1..<totalStops).contains(currentStopIndex)
      && NoLateGuidanceRouteLayoutPolicy.safeName(currentStopName) == currentStopName
      && (remainingStops == 0 ? nextStopName == nil : nextStopName != nil
        && NoLateGuidanceRouteLayoutPolicy.safeName(nextStopName) == nextStopName)
  }
}

/// A bounded, explicitly non-live station label shown while a fresh train/GPS pair is unavailable.
public struct NoLateGuidanceLastSubway: Codable, Hashable, Sendable {
  public let stopIndex: Int
  public let totalStops: Int
  public let stopName: String
  public let confirmedAt: Double
  public func valid(now: Double) -> Bool {
    now.isFinite && confirmedAt.isFinite && confirmedAt <= now && now - confirmedAt < 90
      && (2...500).contains(totalStops) && (1..<totalStops).contains(stopIndex)
      && NoLateGuidanceRouteLayoutPolicy.safeName(stopName) == stopName
  }
}

public struct NoLateGuidanceContent: Codable, Hashable, Sendable {
  public let schemaVersion: Int
  public let sessionId: String
  public let scheduleId: String
  public let generation: Int64
  public let routeRevision: Int64
  public let routeInputDigest: String
  public let sequence: Int64
  public let status: String
  public let phase: String
  public let quality: String
  public let instruction: String
  public let activeLegIndex: Int
  public let walkProgress: Double?
  public let rideProgress: Double?
  public let alighting: NoLateGuidanceAlighting?
  public let observedAt: Double?
  public let validUntil: Double
  public let boardingConfirmed: Bool
  public let arrivalStatus: String?
  public let arrival: NoLateGuidanceArrival?
  public let subway: NoLateGuidanceSubway?
  public let lastConfirmedSubway: NoLateGuidanceLastSubway?

  public init(sessionId: String, scheduleId: String, generation: Int64, routeRevision: Int64, routeInputDigest: String,
    sequence: Int64, status: String, phase: String, quality: String, instruction: String, activeLegIndex: Int,
    walkProgress: Double?, observedAt: Double?, validUntil: Double, arrivalStatus: String? = nil, arrival: NoLateGuidanceArrival? = nil,
    rideProgress: Double? = nil, boardingConfirmed: Bool = false, alighting: NoLateGuidanceAlighting? = nil,
    subway: NoLateGuidanceSubway? = nil, lastConfirmedSubway: NoLateGuidanceLastSubway? = nil) {
    schemaVersion = subway != nil ? 8 : activeLegIndex > 1 && arrival != nil && ["WAITING","APPROACHING_STOP"].contains(phase) ? 7 : phase == "TRANSFER_WALK" ? 5 : activeLegIndex > 1 && !(phase == "FINAL_WALK" && activeLegIndex == 2) && ["RIDING","FINAL_WALK","WAITING","WALKING_TO_STOP","APPROACHING_STOP","BOARDING_CANDIDATE"].contains(phase) ? 6 : phase == "FINAL_WALK" ? 4 : phase == "RIDING" ? (alighting == nil ? 2 : 3) : 1; self.sessionId = sessionId; self.scheduleId = scheduleId; self.generation = generation
    self.routeRevision = routeRevision; self.routeInputDigest = routeInputDigest; self.sequence = sequence
    self.status = status; self.phase = phase; self.quality = quality; self.instruction = instruction
    self.activeLegIndex = activeLegIndex; self.walkProgress = walkProgress; self.observedAt = observedAt
    self.validUntil = validUntil; self.boardingConfirmed = boardingConfirmed; self.rideProgress = rideProgress
    self.alighting = alighting
    self.arrivalStatus = arrivalStatus; self.arrival = arrival
    self.subway = subway
    self.lastConfirmedSubway = lastConfirmedSubway
  }
}
