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
  // Numbered line colors used by the in-app route map and timeline.
  private static let numberedSubwayColors = [
    "1호선": "#0D47A1", "2호선": "#00B140", "3호선": "#FF7F00",
    "4호선": "#00A4E3", "5호선": "#7E57C2", "6호선": "#A05A2C",
    "7호선": "#6A8F2A", "8호선": "#E5398E", "9호선": "#B59A3A",
    "인천1호선": "#7CA8D5", "인천2호선": "#ED8B00"
  ]
  private static func numberedSubwayLabel(_ name: String) -> String? {
    let compact = name.replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
    guard let range = compact.range(
      of: "^(?:수도권|서울)?((?:인천|부산|대구|대전|광주)?[0-9]+호선)(?=$|[（(]|급행|일반|완행)",
      options: .regularExpression
    ) else { return nil }
    return String(compact[range]).replacingOccurrences(of: "^(?:수도권|서울)", with: "", options: .regularExpression)
  }
  public static func validTopology(_ legs: [NoLateGuidanceRouteLeg]) -> Bool {
    !legs.isEmpty && legs.count <= 32 && legs.enumerated().allSatisfy {
      $0.offset == $0.element.index && ["WALK", "BUS", "SUBWAY", "ETC", "UNKNOWN"].contains($0.element.kind)
    }
  }
  /// Keep static legs under 2.2 KB so Activity attributes + v1 content fit the 4 KB budget.
  /// All display weights are dropped together: never mix partially budgeted units.
  public static func budgeted(_ legs: [NoLateGuidanceRouteLeg]) -> [NoLateGuidanceRouteLeg] {
    guard validTopology(legs) else { return [] }
    let encoder = JSONEncoder()
    func fits(_ values: [NoLateGuidanceRouteLeg]) -> Bool {
      (try? encoder.encode(values)).map { $0.count <= 2200 } ?? false
    }
    if fits(legs) { return legs }

    let basis = layout(legs).basis
    func compact(includeStops: Bool, includeWeights: Bool) -> [NoLateGuidanceRouteLeg] {
      legs.map { leg in
        let name = safeName(leg.lineName)
        return .init(index: leg.index, kind: leg.kind,
          walkingLengthMeters: number(leg.walkingLengthMeters, maximum: 100_000),
          boardingStopName: includeStops ? safeName(leg.boardingStopName) : nil,
          lineName: leg.kind == "SUBWAY" ? name.flatMap { numberedSubwayLabel($0) ?? $0 } : name,
          lineColor: safeColor(leg.lineColor),
          durationMinutes: includeWeights && basis == "TIME" ? leg.durationMinutes : nil,
          distanceMeters: includeWeights && basis == "DISTANCE" ? leg.distanceMeters : nil,
          alightingStopName: includeStops ? safeName(leg.alightingStopName) : nil)
      }
    }
    let canonical = compact(includeStops: true, includeWeights: true)
    if fits(canonical) { return canonical }
    let weightedLines = compact(includeStops: false, includeWeights: true)
    if fits(weightedLines) { return weightedLines }
    let lines = compact(includeStops: false, includeWeights: false)
    if fits(lines) { return lines }

    let topology = legs.map { NoLateGuidanceRouteLeg(index: $0.index, kind: $0.kind,
      walkingLengthMeters: number($0.walkingLengthMeters, maximum: 100_000)) }
    return fits(topology) ? topology : legs.map { .init(index: $0.index, kind: $0.kind) }
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
  public static func legendLabel(_ leg: NoLateGuidanceRouteLeg) -> String {
    let name = label(leg)
    if leg.kind == "SUBWAY" { return numberedSubwayLabel(name) ?? name }
    if leg.kind == "BUS", name.first?.isASCII == true, name.first?.isNumber == true, !name.hasSuffix("번") {
      return "\(name)번"
    }
    return name
  }
  public static func routeColor(_ leg: NoLateGuidanceRouteLeg) -> String {
    switch leg.kind {
    case "SUBWAY":
      return numberedSubwayColors[legendLabel(leg)] ?? safeColor(leg.lineColor) ?? "#64748B"
    case "BUS": return safeColor(leg.lineColor) ?? "#2F963B"
    default: return "#78828F"
    }
  }
  /// Keep the current ride in the three labels that fit while retaining route order.
  public static func visibleRideLegend(_ rides: [NoLateGuidanceRouteLeg], activeLegIndex: Int?) -> ArraySlice<NoLateGuidanceRouteLeg> {
    let limit = 3
    guard let activeLegIndex, let current = rides.firstIndex(where: { $0.index == activeLegIndex }),
          current >= limit else { return rides.prefix(limit) }
    let start = min(current - 1, rides.count - limit)
    return rides[start..<(start + limit)]
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
    if content.status == "STOPPED" || content.status == "EXPIRED" {
      return .init(title: "위치 안내를 종료했어요", action: "저장한 경로는 일정에서 볼 수 있어요",
        symbol: "location.slash", compact: "안내 종료")
    }
    if !isStale && isPrepared(content, legs: legs, now: now) {
      return .init(title: "출발 대기", action: "이동하면 출발을 감지합니다", symbol: "figure.walk", compact: "출발 대기")
    }
    guard let position = NoLateGuidanceRoutePositionPolicy.position(content, legs: legs, now: now, isStale: isStale) else {
      if content.status == "ACTIVE", content.phase == "UNAVAILABLE", let last = content.lastConfirmedBus,
        last.valid(now: now), legs.indices.contains(last.legIndex), legs[last.legIndex].kind == "BUS" {
        let line = NoLateGuidanceRouteLayoutPolicy.safeName(legs[last.legIndex].lineName) ?? "버스"
        let age = Int((now - last.confirmedAt) / 60)
        let ageText = age < 1 ? "방금 확인" : "\(age)분 전 확인"
        return .init(title: "마지막 확인 · \(line)", action: "현재 위치 재확인 중 · \(ageText)",
          symbol: "location.slash", compact: "버스 위치 확인 중")
      }
      if content.status == "ACTIVE", (content.phase == "UNAVAILABLE" && content.schemaVersion == 1 || content.validSegment != nil),
        legs.indices.contains(content.activeLegIndex == 0 ? 1 : content.activeLegIndex),
        legs[content.activeLegIndex == 0 ? 1 : content.activeLegIndex].kind == "SUBWAY", let last = content.lastConfirmedSubway ?? content.validSegment?.anchor,
        last.valid(now: now) {
        let age = Int((now - last.confirmedAt) / 60)
        let ageText = age < 1 ? "방금 확인" : "\(age)분 전 확인"
        return .init(title: "마지막 확인 · \(last.stopName)", action: "현재 위치 재확인 중 · \(ageText)",
          symbol: "location.slash", compact: "역 확인 중")
      }
      return .init(title: "위치 확인 중", action: "앱에서 현재 경로를 확인해 주세요", symbol: "location.slash", compact: "확인 중")
    }
    if let segment = content.validSegment {
      var action = "다음 \(segment.toStopName)"
      if segment.fromStopIndex + 1 == segment.totalStops - 1 {
        let transfer = position.legIndex + 2
        if legs.indices.contains(transfer), legs[transfer-1].kind == "WALK", ["SUBWAY","BUS"].contains(legs[transfer].kind) {
          action += " 하차 · \(NoLateGuidanceRouteLayoutPolicy.legendLabel(legs[transfer])) 환승"
        } else {
          action = "다음 역에서 내리세요"
        }
      }
      return .init(title:"\(segment.fromStopName) → \(segment.toStopName)",action:action,symbol:"tram.fill",compact:"다음 \(segment.toStopName)")
    }
    if content.phase == "RIDING" {
      if let subway = content.subway, subway.valid {
        return .init(title: subway.currentStopName,
          action: subway.remainingStops == 0 ? "하차역 도착 · 하차 확인 중" : subway.remainingStops == 1
            ? "\(subway.nextStopName ?? "다음 역")에서 내리세요" : "다음 \(subway.nextStopName ?? "역") · \(subway.remainingStops)개 역 남음",
          symbol: "tram.fill", compact: subway.remainingStops <= 1 ? "하차 준비" : "\(subway.remainingStops)개 역")
      }
      if let notice = content.alighting {
        return .init(title: NoLateGuidanceRouteLayoutPolicy.safeName(legs[position.legIndex].alightingStopName) ?? "하차 정류장",
          action: notice.action, symbol: "bus.fill", compact: notice.kind == "NEAR_STOP" ? "하차 준비" : "다음 정류장")
      }
      let name = NoLateGuidanceRouteLayoutPolicy.safeName(legs[position.legIndex].lineName)
      let target = NoLateGuidanceRouteLayoutPolicy.safeName(legs[position.legIndex].alightingStopName)
      return .init(title: name ?? "버스 이동 중", action: target.map { "\($0)에서 하차" } ?? "버스로 이동 중",
        symbol: "bus.fill", compact: "버스 이동 중")
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
        if let arrival = freshArrival(content, legs: legs, now: now, isStale: isStale), arrival.kind == "SUBWAY" {
          let minutes = max(1, Int(ceil((arrival.expectedAt - now) / 60)))
          return .init(title:safeName ?? "승차역",action:"\(arrival.directionLabel) 열차 약 \(minutes)분 뒤 도착 · 탑승 전",
            symbol:"tram.fill",compact:"열차 약 \(minutes)분")
        }
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
    if let arrival = freshArrival(content, legs: legs, now: now, isStale: isStale), arrival.kind == "SUBWAY" {
      let minutes = max(1, Int(ceil((arrival.expectedAt - now) / 60)))
      return .init(title: safeName.map { "\($0)까지" } ?? "승차역까지",
        action: "\(arrival.directionLabel) 열차 약 \(minutes)분 뒤 도착 · 탑승 전",
        symbol: "figure.walk", compact: "열차 약 \(minutes)분")
    }
    return .init(title: safeName.map { "\($0)까지" } ?? "승차 지점까지",
      action: distance ?? "도보로 이동 중", symbol: "figure.walk", compact: distance ?? "도보 이동")
  }

  public static func freshArrival(_ content: NoLateGuidanceContent, legs: [NoLateGuidanceRouteLeg],
    now: Double, isStale: Bool = false) -> NoLateGuidanceArrival? {
    guard NoLateGuidanceRoutePositionPolicy.position(content, legs: legs, now: now, isStale: isStale) != nil,
      content.arrivalStatus == "WAITING_INFORMATION",
      let arrival = content.arrival, arrival.expectedAt.isFinite, arrival.expectedAt > now,
      arrival.sourceUpdatedAt.isFinite, arrival.sourceUpdatedAt <= now + 5,
      arrival.expectedAt > arrival.sourceUpdatedAt, arrival.expectedAt <= arrival.sourceUpdatedAt + 3600,
      arrival.validUntil.isFinite, arrival.validUntil > now,
      arrival.validUntil <= min(arrival.sourceUpdatedAt + 120, arrival.expectedAt) else { return nil }
    let nearSubwayPlatform = content.phase == "WALKING_TO_STOP" && arrival.kind == "SUBWAY"
      && (content.walkProgress ?? 0) >= 0.9 && legs.indices.contains(content.activeLegIndex + 1)
      && legs[content.activeLegIndex + 1].kind == "SUBWAY"
      && arrival.busLegIndex == content.activeLegIndex + 1
    guard ["APPROACHING_STOP", "WAITING"].contains(content.phase) || nearSubwayPlatform else { return nil }
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
    if content.schemaVersion == 9 {
      let index = content.activeLegIndex
      guard let segment = content.validSegment, legs.indices.contains(index), legs[index].kind == "SUBWAY" else { return nil }
      return .init(legIndex:index,legProgress:segment.legProgress,barFraction:layout.start(index)+segment.legProgress*layout.fractions[index])
    }
    guard content.subwaySegment == nil else { return nil }
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
          (["WAITING","APPROACHING_STOP"].contains(content.phase) || content.phase == "WALKING_TO_STOP" && content.arrival?.kind == "SUBWAY" && (content.walkProgress ?? 0) >= 0.9) && content.arrivalStatus == "WAITING_INFORMATION"
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
        guard i % 2 == 1, ["BUS","SUBWAY"].contains(legs[i].kind), p == 1 else { return nil }; walkIndex = i - 1
      } else if content.phase == "FINAL_WALK" {
        guard i == legs.count - 1, i % 2 == 0, ["BUS","SUBWAY"].contains(legs[i - 1].kind) else { return nil }; walkIndex = i
      } else if ["WALKING_TO_STOP","APPROACHING_STOP"].contains(content.phase) {
        guard i % 2 == 0, i < legs.count - 1, ["BUS","SUBWAY"].contains(legs[i + 1].kind) else { return nil }; walkIndex = i
      } else { return nil }
      guard let length = legs[walkIndex].walkingLengthMeters, length.isFinite,
        (content.phase == "FINAL_WALK" ? 70.0 : 1.0)...10_000 ~= length else { return nil }
      return .init(legIndex:walkIndex,legProgress:p,barFraction:layout.start(walkIndex) + p * layout.fractions[walkIndex])
    }
    if content.phase == "TRANSFER_WALK" {
      let i = content.activeLegIndex
      guard content.schemaVersion == 5, legs.count >= 5, legs.count % 2 == 1,
        i >= 2, i % 2 == 0, i + 1 < legs.count - 1, ["BUS","SUBWAY"].contains(legs[i - 1].kind),
        legs.enumerated().allSatisfy({ $0.offset % 2 == 0 ? $0.element.kind == "WALK" : ["BUS","SUBWAY"].contains($0.element.kind) }),
        !content.boardingConfirmed, content.rideProgress == nil, content.alighting == nil, content.arrival == nil,
        let length = legs[i].walkingLengthMeters, length.isFinite, (1...10_000).contains(length),
        let progress = content.walkProgress, progress.isFinite, (0...1).contains(progress) else { return nil }
      return .init(legIndex:i,legProgress:progress,barFraction:layout.start(i) + progress * layout.fractions[i])
    }
    if content.phase == "FINAL_WALK" {
      guard content.schemaVersion == 4,
        (legs.map(\.kind) == ["WALK","BUS","WALK"] || legs.map(\.kind) == ["WALK","SUBWAY","WALK"]),
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
  /// Optional for compatibility with existing bus Activity payloads.
  public let kind: String?
  public let providerRouteId: String
  public let directionLabel: String
  public let expectedAt: Double
  public let sourceUpdatedAt: Double
  public let validUntil: Double
  public init(providerRouteId: String, directionLabel: String, expectedAt: Double, sourceUpdatedAt: Double, validUntil: Double, busLegIndex: Int? = nil, kind: String? = nil) {
    self.busLegIndex = busLegIndex
    self.kind = kind
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
      && (kind != "NEAR_STOP" || remainingMeters <= 260)
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

/// Metadata-only measured position between a confirmed station and its adjacent saved stop.
public struct NoLateGuidanceSubwaySegment: Codable, Hashable, Sendable {
  public let fromStopIndex: Int
  public let totalStops: Int
  public let fromStopName: String
  public let toStopName: String
  public let progress: Double
  public let confirmedAt: Double
  public var legProgress: Double { (Double(fromStopIndex) + progress) / Double(totalStops-1) }
  public var anchor: NoLateGuidanceLastSubway {
    .init(stopIndex:fromStopIndex,totalStops:totalStops,stopName:fromStopName,confirmedAt:confirmedAt)
  }
  public func valid(observedAt: Double, validUntil: Double) -> Bool {
    (3...64).contains(totalStops) && fromStopIndex >= 1 && fromStopIndex < totalStops - 1 &&
      NoLateGuidanceRouteLayoutPolicy.safeName(fromStopName) == fromStopName &&
      NoLateGuidanceRouteLayoutPolicy.safeName(toStopName) == toStopName &&
      progress.isFinite && progress > 0 && progress < 1 && observedAt.isFinite && confirmedAt.isFinite &&
      confirmedAt > 0 && confirmedAt <= observedAt && observedAt - confirmedAt < 90 &&
      validUntil.isFinite && validUntil > observedAt && validUntil <= min(observedAt+15,confirmedAt+90)
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

/// A recent boarding confirmation, never a live bus position or alighting estimate.
public struct NoLateGuidanceLastBus: Codable, Hashable, Sendable {
  public let legIndex: Int
  public let confirmedAt: Double
  public func valid(now: Double) -> Bool {
    now.isFinite && confirmedAt.isFinite && confirmedAt <= now && now - confirmedAt < 90
      && (1...29).contains(legIndex) && legIndex % 2 == 1
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
  public let lastConfirmedBus: NoLateGuidanceLastBus?
  public let subwaySegment: NoLateGuidanceSubwaySegment?

  public init(sessionId: String, scheduleId: String, generation: Int64, routeRevision: Int64, routeInputDigest: String,
    sequence: Int64, status: String, phase: String, quality: String, instruction: String, activeLegIndex: Int,
    walkProgress: Double?, observedAt: Double?, validUntil: Double, arrivalStatus: String? = nil, arrival: NoLateGuidanceArrival? = nil,
    rideProgress: Double? = nil, boardingConfirmed: Bool = false, alighting: NoLateGuidanceAlighting? = nil,
    subway: NoLateGuidanceSubway? = nil, lastConfirmedSubway: NoLateGuidanceLastSubway? = nil,
    lastConfirmedBus: NoLateGuidanceLastBus? = nil, subwaySegment: NoLateGuidanceSubwaySegment? = nil) {
    schemaVersion = subwaySegment != nil ? 9 : subway != nil ? 8 : activeLegIndex > 1 && arrival != nil && (["WAITING","APPROACHING_STOP"].contains(phase) || phase == "WALKING_TO_STOP" && arrival?.kind == "SUBWAY") ? 7 : phase == "TRANSFER_WALK" ? 5 : activeLegIndex > 1 && !(phase == "FINAL_WALK" && activeLegIndex == 2) && ["RIDING","FINAL_WALK","WAITING","WALKING_TO_STOP","APPROACHING_STOP","BOARDING_CANDIDATE"].contains(phase) ? 6 : phase == "FINAL_WALK" ? 4 : phase == "RIDING" ? (alighting == nil ? 2 : 3) : 1; self.sessionId = sessionId; self.scheduleId = scheduleId; self.generation = generation
    self.routeRevision = routeRevision; self.routeInputDigest = routeInputDigest; self.sequence = sequence
    self.status = status; self.phase = phase; self.quality = quality; self.instruction = instruction
    self.activeLegIndex = activeLegIndex; self.walkProgress = walkProgress; self.observedAt = observedAt
    self.validUntil = validUntil; self.boardingConfirmed = boardingConfirmed; self.rideProgress = rideProgress
    self.alighting = alighting
    self.arrivalStatus = arrivalStatus; self.arrival = arrival
    self.subway = subway
    self.lastConfirmedSubway = lastConfirmedSubway
    self.lastConfirmedBus = lastConfirmedBus
    self.subwaySegment = subwaySegment
  }

  var validSegment: NoLateGuidanceSubwaySegment? {
    guard schemaVersion == 9, status == "ACTIVE", phase == "RIDING_SEGMENT", quality == "GOOD",
      (1...29).contains(activeLegIndex), activeLegIndex % 2 == 1, boardingConfirmed, walkProgress == nil,
      subway == nil, arrival == nil, alighting == nil, lastConfirmedSubway == nil, lastConfirmedBus == nil,
      let observedAt, let segment = subwaySegment, segment.valid(observedAt:observedAt,validUntil:validUntil),
      let rideProgress, rideProgress.isFinite, abs(rideProgress-segment.legProgress) < 0.000001 else { return nil }
    return segment
  }

  var locationObservationDeadline: Double? {
    guard status == "ACTIVE", quality == "GOOD", let observedAt, observedAt.isFinite, observedAt > 0,
      validUntil.isFinite, validUntil > observedAt, validUntil <= observedAt + 15 else { return nil }
    return validUntil
  }

  func expiringLocation(at now: Double) -> Self? {
    guard let deadline = locationObservationDeadline, now.isFinite, deadline <= now else { return nil }
    let history = (lastConfirmedSubway ?? validSegment?.anchor).flatMap { $0.valid(now:now) ? $0 : nil }
    return .init(sessionId: sessionId, scheduleId: scheduleId, generation: generation,
      routeRevision: routeRevision, routeInputDigest: routeInputDigest, sequence: sequence,
      status: status, phase: "UNAVAILABLE", quality: "UNCERTAIN", instruction: "현재 위치 확인 필요",
      activeLegIndex: history != nil && activeLegIndex > 1 ? activeLegIndex : 0, walkProgress: nil, observedAt: observedAt, validUntil: deadline,
      lastConfirmedSubway: history,
      lastConfirmedBus: lastConfirmedBus.flatMap { $0.valid(now: now) ? $0 : nil })
  }
}

/// The driving matcher sends only matched provider maneuver copy. This model is shared by the app and widget.
struct NoLateDrivingContent: Codable, Hashable, Sendable {
  struct Turn: Codable, Hashable, Sendable {
    let title: String
    let road: String
    let type: String
    let index: Int
    let meters: Int

    var valid: Bool {
      (0..<4000).contains(index) && (0...5_000_000).contains(meters) && !title.isEmpty &&
        title.utf8.count <= 512 && road.utf8.count <= 512 &&
        !type.isEmpty && type.count <= 4 && type.utf8.allSatisfy { (48...57).contains($0) } &&
        !title.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) &&
        !road.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }
  }

  let status: String
  var validUntilMs: Double? = nil
  var remainingMeters: Int? = nil
  var remainingSeconds: Int? = nil
  var next: Turn? = nil
  var following: Turn? = nil

  var staleDate: Date? { validUntilMs.map { Date(timeIntervalSince1970: $0 / 1000) } }

  func visible(now: Date, isStale: Bool = false) -> Self {
    guard status == "GUIDING" else {
      if status == "OFF_ROUTE" {
        guard !isStale, let limit = staleDate, limit > now, limit.timeIntervalSince(now) <= 12.001 else {
          return Self(status: "UNCERTAIN")
        }
        return Self(status: status, validUntilMs: validUntilMs)
      }
      return Self(status: ["ACQUIRING", "ARRIVED"].contains(status) ? status : "UNCERTAIN")
    }
    guard !isStale, let limit = staleDate, limit > now, limit.timeIntervalSince(now) <= 12.001,
      let remainingMeters, (0...5_000_000).contains(remainingMeters),
      remainingSeconds.map({ (0...604800).contains($0) }) ?? true,
      next?.valid != false, following?.valid != false,
      following == nil || (next != nil && following?.index == (next?.index ?? -2) + 1) else {
      return Self(status: "UNCERTAIN")
    }
    return self
  }

  var statusText: String {
    switch status {
    case "OFF_ROUTE": return "경로를 벗어났어요"
    case "GUIDING": return next?.title ?? "목적지까지 이동"
    case "ARRIVED": return "목적지에 도착했어요"
    default: return "현재 위치를 확인하는 중"
    }
  }

  static func distance(_ meters: Int) -> String {
    meters < 1000 ? "\(meters)m" : String(format: "%.1fkm", Double(meters) / 1000)
  }
}

/// A turn can be announced at two approach distances. No coordinate or location history is needed.
struct NoLateDrivingSpeechCue: Equatable {
  let index: Int
  let stage: Int
  /// Only add the road to short turn labels. Some provider instructions already
  /// contain a whole sentence, the road name and a second distance.
  static func instruction(for turn: NoLateDrivingContent.Turn) -> String {
    let approach = turn.meters <= 10 ? "잠시 후" : "약 \(turn.meters)미터 앞"
    let shortTurns = ["11", "12", "13", "14", "16", "17", "18", "19", "117", "118"]
    if shortTurns.contains(turn.type), !turn.road.isEmpty, !turn.title.contains(turn.road) {
      return "\(approach), \(turn.road) 방면 \(turn.title)."
    }
    return "\(approach), \(turn.title)."
  }

  init?(_ content: NoLateDrivingContent, after previous: Self?, now: Date) {
    guard let turn = content.visible(now: now).next, turn.meters <= 250 else { return nil }
    index = turn.index
    stage = turn.meters <= 60 ? 2 : 1
    if let previous, previous.index == index && previous.stage >= stage { return nil }
  }
}
