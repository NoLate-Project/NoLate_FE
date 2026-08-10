import Foundation

public let noLateLiveActivityMaximumSafeInteger: Int64 = 9_007_199_254_740_991

public enum NoLateLiveActivityStatus: String, Codable, CaseIterable, Sendable {
  case preparing
  case leaveNow
  case inTransit
  case arrived
  case delayed
  case cancelled
}

public enum NoLateLiveActivityAppearance: String, Codable, CaseIterable, Sendable {
  case light
  case dark
}

public struct NoLateActiveActivityIdentity: Equatable, Sendable {
  public let activityId: String
  public let generation: Int64
  public let revision: Int64

  public init(activityId: String, generation: Int64, revision: Int64) {
    self.activityId = activityId
    self.generation = generation
    self.revision = revision
  }
}

public enum NoLateRouteSegmentKind: String, Codable, CaseIterable, Sendable {
  case origin
  case destination
  case walk
  case subway
  case bus
  case drive
  case bike
  case transfer
}

public struct NoLateRouteSegment: Codable, Hashable, Sendable {
  public let kind: NoLateRouteSegmentKind
  public let label: String
  public let colorHex: String

  public init(kind: NoLateRouteSegmentKind, label: String, colorHex: String) {
    self.kind = kind
    self.label = label
    self.colorHex = colorHex
  }
}

public struct NoLateLiveActivityThemeTokens: Equatable, Sendable {
  public let hostTint: String
  public let surfaceStart: String
  public let surfaceMiddle: String
  public let surfaceEnd: String
  public let primaryText: String
  public let secondaryText: String
  public let accent: String
  public let neutralRoute: String
  public let callToActionStart: String
  public let callToActionEnd: String

  public static let light = NoLateLiveActivityThemeTokens(
    hostTint: "#E2F0FF",
    surfaceStart: "#F7FBFF",
    surfaceMiddle: "#E2F0FF",
    surfaceEnd: "#CBE4FF",
    primaryText: "#0B2254",
    secondaryText: "#475467",
    accent: "#0867E8",
    neutralRoute: "#667085",
    callToActionStart: "#0867E8",
    callToActionEnd: "#075AC9"
  )

  public static let dark = NoLateLiveActivityThemeTokens(
    hostTint: "#101D33",
    surfaceStart: "#0B1324",
    surfaceMiddle: "#101D33",
    surfaceEnd: "#15355B",
    primaryText: "#F5F8FF",
    secondaryText: "#B8C5D9",
    accent: "#59A6FF",
    neutralRoute: "#B8C5D9",
    callToActionStart: "#1768E8",
    callToActionEnd: "#0E57C8"
  )

  public static func resolved(systemDark: Bool) -> NoLateLiveActivityThemeTokens {
    systemDark ? .dark : .light
  }
}

/**
 * Shared Lock Screen spacing budget.
 *
 * ActivityKit may truncate a Lock Screen Live Activity above 160 points, so the
 * view uses these reserved row heights instead of accumulating ad-hoc padding.
 */
public enum NoLateLiveActivityLayoutMetrics {
  public static let maximumLockScreenHeight = 160.0
  public static let cardCornerRadius = 18.0
  public static let horizontalPadding = 14.0
  public static let verticalPadding = 11.0
  public static let headerHeight = 24.0
  public static let summaryTopSpacing = 15.0
  public static let summaryHeight = 28.0
  public static let routeTopSpacing = 14.0
  public static let routeHeight = 16.0
  public static let actionsTopSpacing = 15.0
  public static let actionVisualHeight = 26.0
  public static let actionHitHeight = 44.0
  public static let actionWidth = 96.0

  public static let estimatedLockScreenHeight =
    (verticalPadding * 2) +
    headerHeight +
    summaryTopSpacing + summaryHeight +
    routeTopSpacing + routeHeight +
    actionsTopSpacing + actionVisualHeight
}

/**
 * Pure copy rules shared by the renderer and tests.
 *
 * The recommended departure instant is the only countdown source. It already
 * reflects the full door-to-door ETA (including transit wait), so the schedule
 * start time and `firstWaitMinutes` must never be used to derive this label.
 */
public enum NoLateLiveActivityPresentation {
  public static func remainingDepartureMinutes(
    recommendedDepartureEpochSeconds: Int64,
    nowEpochSeconds: Int64
  ) -> Int? {
    let remainingSeconds = recommendedDepartureEpochSeconds - nowEpochSeconds
    guard remainingSeconds > 0 else { return nil }
    let wholeMinutes = remainingSeconds / 60
    let roundedUpMinutes = wholeMinutes + (remainingSeconds % 60 == 0 ? 0 : 1)
    return Int(max(1, roundedUpMinutes))
  }

  public static func headline(
    status: NoLateLiveActivityStatus,
    recommendedDepartureEpochSeconds: Int64,
    nowEpochSeconds: Int64
  ) -> String {
    switch status {
    case .preparing:
      guard let minutes = remainingDepartureMinutes(
        recommendedDepartureEpochSeconds: recommendedDepartureEpochSeconds,
        nowEpochSeconds: nowEpochSeconds
      ) else {
        return "지금 출발할 시간이에요"
      }
      return "출발까지 \(minutes)분 남았어요"
    case .leaveNow:
      return "지금 출발할 시간이에요"
    case .inTransit:
      return "목적지로 이동 중이에요"
    case .arrived:
      return "도착했어요"
    case .delayed:
      return "최신 교통 정보를 확인 중이에요"
    case .cancelled:
      return "이 경로 안내가 종료됐어요"
    }
  }

  public static func compactLabel(
    status: NoLateLiveActivityStatus,
    recommendedDepartureEpochSeconds: Int64,
    nowEpochSeconds: Int64
  ) -> String {
    if status == .preparing,
       let minutes = remainingDepartureMinutes(
         recommendedDepartureEpochSeconds: recommendedDepartureEpochSeconds,
         nowEpochSeconds: nowEpochSeconds
       ) {
      return "\(minutes)분"
    }
    switch status {
    case .preparing, .leaveNow: return "출발"
    case .delayed: return "확인"
    case .inTransit: return "이동"
    case .arrived: return "도착"
    case .cancelled: return "종료"
    }
  }
}

/**
 * Compact state shared by the app, Widget extension, and ActivityKit APNs payload.
 *
 * `travelMinutes` is always the complete door-to-door ETA and already includes
 * `firstWaitMinutes`. The latter is explanatory UI metadata and must never be added again.
 */
public struct NoLateDepartureContentState: Codable, Hashable, Sendable {
  public let revision: Int64
  public let travelMinutes: Int
  public let firstWaitMinutes: Int?
  public let predictedArrivalEpochSeconds: Int64?
  public let recommendedDepartureEpochSeconds: Int64
  public let updatedAtEpochSeconds: Int64
  public let actionExpiresAtEpochSeconds: Int64
  public let status: NoLateLiveActivityStatus
  public let routeSegments: [NoLateRouteSegment]
  // Optional keeps schema v1 payloads backward compatible. New clients prefer
  // this device-scoped value because Lock Screen scene traits can differ from
  // the appearance selected by the app.
  public let appearance: NoLateLiveActivityAppearance?

  public init(
    revision: Int64,
    travelMinutes: Int,
    firstWaitMinutes: Int?,
    predictedArrivalEpochSeconds: Int64?,
    recommendedDepartureEpochSeconds: Int64,
    updatedAtEpochSeconds: Int64,
    actionExpiresAtEpochSeconds: Int64,
    status: NoLateLiveActivityStatus,
    routeSegments: [NoLateRouteSegment],
    appearance: NoLateLiveActivityAppearance? = nil
  ) {
    self.revision = revision
    self.travelMinutes = travelMinutes
    self.firstWaitMinutes = firstWaitMinutes
    self.predictedArrivalEpochSeconds = predictedArrivalEpochSeconds
    self.recommendedDepartureEpochSeconds = recommendedDepartureEpochSeconds
    self.updatedAtEpochSeconds = updatedAtEpochSeconds
    self.actionExpiresAtEpochSeconds = actionExpiresAtEpochSeconds
    self.status = status
    self.routeSegments = routeSegments
    self.appearance = appearance
  }

  public var displayedTravelMinutes: Int {
    // Deliberately do not add firstWaitMinutes; it is already part of travelMinutes.
    travelMinutes
  }

  public func replacingStatus(
    _ newStatus: NoLateLiveActivityStatus,
    revision newRevision: Int64,
    updatedAtEpochSeconds newUpdatedAtEpochSeconds: Int64
  ) -> NoLateDepartureContentState {
    NoLateDepartureContentState(
      revision: newRevision,
      travelMinutes: travelMinutes,
      firstWaitMinutes: firstWaitMinutes,
      predictedArrivalEpochSeconds: predictedArrivalEpochSeconds,
      recommendedDepartureEpochSeconds: recommendedDepartureEpochSeconds,
      updatedAtEpochSeconds: newUpdatedAtEpochSeconds,
      actionExpiresAtEpochSeconds: actionExpiresAtEpochSeconds,
      status: newStatus,
      routeSegments: routeSegments,
      appearance: appearance
    )
  }
}

public struct NoLateDepartureStartOrUpdateCommand: Sendable {
  public let scheduleId: String
  public let recipientMemberId: Int64
  public let generation: Int64
  public let scheduleTitle: String
  public let destinationName: String
  public let scheduleStartAt: String
  public let actionEventKey: String
  public let logicalEventKey: String?
  public let staleAtEpochSeconds: Int64?
  public let contentState: NoLateDepartureContentState

  public init(
    scheduleId: String,
    recipientMemberId: Int64,
    generation: Int64,
    scheduleTitle: String,
    destinationName: String,
    scheduleStartAt: String,
    actionEventKey: String,
    logicalEventKey: String?,
    staleAtEpochSeconds: Int64?,
    contentState: NoLateDepartureContentState
  ) {
    self.scheduleId = scheduleId
    self.recipientMemberId = recipientMemberId
    self.generation = generation
    self.scheduleTitle = scheduleTitle
    self.destinationName = destinationName
    self.scheduleStartAt = scheduleStartAt
    self.actionEventKey = actionEventKey
    self.logicalEventKey = logicalEventKey
    self.staleAtEpochSeconds = staleAtEpochSeconds
    self.contentState = contentState
  }
}

public enum NoLateLiveActivityDismissalPolicy: String, Codable, Sendable {
  case `default`
  case immediate
  case afterDate
}

public struct NoLateDepartureEndCommand: Sendable {
  public let scheduleId: String
  public let recipientMemberId: Int64
  public let status: NoLateLiveActivityStatus
  public let revision: Int64?
  public let updatedAtEpochSeconds: Int64
  public let dismissalPolicy: NoLateLiveActivityDismissalPolicy
  public let dismissAtEpochSeconds: Int64?

  public init(
    scheduleId: String,
    recipientMemberId: Int64,
    status: NoLateLiveActivityStatus,
    revision: Int64?,
    updatedAtEpochSeconds: Int64,
    dismissalPolicy: NoLateLiveActivityDismissalPolicy,
    dismissAtEpochSeconds: Int64?
  ) {
    self.scheduleId = scheduleId
    self.recipientMemberId = recipientMemberId
    self.status = status
    self.revision = revision
    self.updatedAtEpochSeconds = updatedAtEpochSeconds
    self.dismissalPolicy = dismissalPolicy
    self.dismissAtEpochSeconds = dismissAtEpochSeconds
  }
}

public enum NoLateLiveActivityValidationError: Error, LocalizedError, Equatable {
  case invalid(String)

  public var errorDescription: String? {
    switch self {
    case .invalid(let reason):
      return reason
    }
  }
}

public enum NoLateLiveActivityPolicy {
  public static let maximumRouteSegments = 6
  public static let maximumEncodedStateBytes = 3_500

  public static func preferredActivityID(
    in candidates: [NoLateActiveActivityIdentity]
  ) -> String? {
    candidates.sorted(by: isPreferredActivity).first?.activityId
  }

  public static func hasDepartureActionIdentity(
    requestedScheduleId: String,
    requestedRecipientMemberId: Int64,
    requestedGeneration: Int64,
    requestedActionEventKey: String,
    activityScheduleId: String,
    activityRecipientMemberId: Int64,
    activityGeneration: Int64,
    activityActionEventKey: String
  ) -> Bool {
    requestedScheduleId == activityScheduleId &&
      requestedRecipientMemberId == activityRecipientMemberId &&
      requestedGeneration == activityGeneration &&
      requestedActionEventKey == activityActionEventKey
  }

  public static func isDepartureActionAvailable(
    status: NoLateLiveActivityStatus,
    nowEpochSeconds: Int64,
    actionExpiresAtEpochSeconds: Int64
  ) -> Bool {
    let actionableStatus = status == .preparing || status == .leaveNow || status == .delayed
    return actionableStatus && nowEpochSeconds < actionExpiresAtEpochSeconds
  }

  public static func validate(
    _ command: NoLateDepartureStartOrUpdateCommand
  ) throws -> NoLateDepartureStartOrUpdateCommand {
    let scheduleId = command.scheduleId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let numericScheduleId = Int64(scheduleId), numericScheduleId > 0 else {
      throw NoLateLiveActivityValidationError.invalid("scheduleId must be a positive integer string.")
    }
    guard isSafeInteger(command.recipientMemberId), command.recipientMemberId > 0 else {
      throw NoLateLiveActivityValidationError.invalid("recipientMemberId is invalid.")
    }
    guard isSafeInteger(command.generation), command.generation >= 0 else {
      throw NoLateLiveActivityValidationError.invalid("generation is invalid.")
    }
    guard isSafeInteger(command.contentState.revision), command.contentState.revision >= 0 else {
      throw NoLateLiveActivityValidationError.invalid("revision is invalid.")
    }
    guard (1...1_440).contains(command.contentState.travelMinutes) else {
      throw NoLateLiveActivityValidationError.invalid("travelMinutes must be between 1 and 1440.")
    }
    if let firstWaitMinutes = command.contentState.firstWaitMinutes {
      guard
        firstWaitMinutes >= 0,
        firstWaitMinutes <= command.contentState.travelMinutes
      else {
        throw NoLateLiveActivityValidationError.invalid(
          "firstWaitMinutes must be explanatory time within travelMinutes."
        )
      }
    }
    for epochSeconds in [
      command.contentState.predictedArrivalEpochSeconds,
      command.staleAtEpochSeconds
    ].compactMap({ $0 }) + [
      command.contentState.recommendedDepartureEpochSeconds,
      command.contentState.updatedAtEpochSeconds,
      command.contentState.actionExpiresAtEpochSeconds
    ] {
      guard isSafeInteger(epochSeconds), epochSeconds >= 0 else {
        throw NoLateLiveActivityValidationError.invalid("Activity timestamps are invalid.")
      }
    }
    let title = normalizedText(command.scheduleTitle, maximumLength: 60)
    let destination = normalizedText(command.destinationName, maximumLength: 40)
    guard !title.isEmpty, !destination.isEmpty else {
      throw NoLateLiveActivityValidationError.invalid(
        "scheduleTitle and destinationName are required."
      )
    }
    let scheduleStartAt = command.scheduleStartAt
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard Self.iso8601Date(scheduleStartAt) != nil else {
      throw NoLateLiveActivityValidationError.invalid("scheduleStartAt must be ISO-8601.")
    }
    let actionEventKey = command.actionEventKey
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard isCanonicalActionEventKey(actionEventKey) else {
      throw NoLateLiveActivityValidationError.invalid("actionEventKey has an invalid format.")
    }
    let logicalEventKey = command.logicalEventKey.flatMap {
      let normalized = normalizedText($0, maximumLength: 200)
      return normalized.isEmpty ? nil : normalized
    }
    let routeSegments = normalizedRouteSegments(command.contentState.routeSegments)
    let state = NoLateDepartureContentState(
      revision: command.contentState.revision,
      travelMinutes: command.contentState.travelMinutes,
      firstWaitMinutes: command.contentState.firstWaitMinutes,
      predictedArrivalEpochSeconds: command.contentState.predictedArrivalEpochSeconds,
      recommendedDepartureEpochSeconds: command.contentState.recommendedDepartureEpochSeconds,
      updatedAtEpochSeconds: command.contentState.updatedAtEpochSeconds,
      actionExpiresAtEpochSeconds: command.contentState.actionExpiresAtEpochSeconds,
      status: command.contentState.status,
      routeSegments: routeSegments,
      appearance: command.contentState.appearance
    )
    guard
      let encoded = try? JSONEncoder().encode(state),
      encoded.count <= maximumEncodedStateBytes
    else {
      throw NoLateLiveActivityValidationError.invalid("Activity content state is too large.")
    }
    return NoLateDepartureStartOrUpdateCommand(
      scheduleId: scheduleId,
      recipientMemberId: command.recipientMemberId,
      generation: command.generation,
      scheduleTitle: title,
      destinationName: destination,
      scheduleStartAt: scheduleStartAt,
      actionEventKey: actionEventKey,
      logicalEventKey: logicalEventKey,
      staleAtEpochSeconds: command.staleAtEpochSeconds,
      contentState: state
    )
  }

  public static func validate(
    _ command: NoLateDepartureEndCommand
  ) throws -> NoLateDepartureEndCommand {
    let scheduleId = command.scheduleId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let numericScheduleId = Int64(scheduleId), numericScheduleId > 0 else {
      throw NoLateLiveActivityValidationError.invalid("scheduleId must be a positive integer string.")
    }
    guard isSafeInteger(command.recipientMemberId), command.recipientMemberId > 0 else {
      throw NoLateLiveActivityValidationError.invalid("recipientMemberId is invalid.")
    }
    if let revision = command.revision {
      guard isSafeInteger(revision), revision >= 0 else {
        throw NoLateLiveActivityValidationError.invalid("revision is invalid.")
      }
    }
    guard isSafeInteger(command.updatedAtEpochSeconds), command.updatedAtEpochSeconds >= 0 else {
      throw NoLateLiveActivityValidationError.invalid("updatedAt is invalid.")
    }
    guard command.status == .arrived || command.status == .cancelled else {
      throw NoLateLiveActivityValidationError.invalid(
        "End status must be arrived or cancelled."
      )
    }
    if command.dismissalPolicy == .afterDate {
      guard
        let dismissAt = command.dismissAtEpochSeconds,
        isSafeInteger(dismissAt),
        dismissAt >= 0
      else {
        throw NoLateLiveActivityValidationError.invalid(
          "dismissAt is required for afterDate dismissal."
        )
      }
    }
    return NoLateDepartureEndCommand(
      scheduleId: scheduleId,
      recipientMemberId: command.recipientMemberId,
      status: command.status,
      revision: command.revision,
      updatedAtEpochSeconds: command.updatedAtEpochSeconds,
      dismissalPolicy: command.dismissalPolicy,
      dismissAtEpochSeconds: command.dismissAtEpochSeconds
    )
  }

  public static func normalizedRouteSegments(
    _ incoming: [NoLateRouteSegment]
  ) -> [NoLateRouteSegment] {
    var normalized: [NoLateRouteSegment] = []
    for segment in incoming where segment.kind != .destination {
      let label = normalizedText(segment.label, maximumLength: 18)
      let color = normalizedHexColor(segment.colorHex) ?? defaultColor(for: segment.kind)
      let candidate = NoLateRouteSegment(
        kind: segment.kind,
        label: label,
        colorHex: color
      )
      if normalized.last == candidate { continue }
      normalized.append(candidate)
    }
    let destination = NoLateRouteSegment(
      kind: .destination,
      label: "도착",
      colorHex: defaultColor(for: .destination)
    )
    // The approved route bar always ends at a red destination pin. Reserve one of the six
    // bounded slots even when the upstream movement projection omits DESTINATION.
    return Array(normalized.prefix(maximumRouteSegments - 1)) + [destination]
  }

  /// Normalizes the JS projection (`WALK`, `BUS`, `SUBWAY`) and APNs raw values through
  /// one contract so local starts and remote updates cannot diverge by letter case.
  public static func normalizedRouteSegmentKind(
    _ value: String
  ) -> NoLateRouteSegmentKind? {
    NoLateRouteSegmentKind(rawValue: value
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased())
  }

  /// A Live Activity button is valid only for the exact immutable Activity generation that
  /// rendered it. This prevents an old island/lock-screen callback from completing a newer trip.
  public static func mayRecordDepartureAction(
    requestedScheduleId: String,
    requestedRecipientMemberId: Int64,
    requestedGeneration: Int64,
    requestedActionEventKey: String,
    activityScheduleId: String,
    activityRecipientMemberId: Int64,
    activityGeneration: Int64,
    activityActionEventKey: String,
    nowEpochSeconds: Int64,
    actionExpiresAtEpochSeconds: Int64
  ) -> Bool {
    hasDepartureActionIdentity(
      requestedScheduleId: requestedScheduleId,
      requestedRecipientMemberId: requestedRecipientMemberId,
      requestedGeneration: requestedGeneration,
      requestedActionEventKey: requestedActionEventKey,
      activityScheduleId: activityScheduleId,
      activityRecipientMemberId: activityRecipientMemberId,
      activityGeneration: activityGeneration,
      activityActionEventKey: activityActionEventKey
    ) &&
      isCanonicalActionEventKey(requestedActionEventKey) &&
      nowEpochSeconds < actionExpiresAtEpochSeconds
  }

  public static func isCanonicalActionEventKey(_ value: String) -> Bool {
    value.range(of: #"^key:[a-f0-9]{64}$"#, options: .regularExpression) != nil ||
      value.range(
        of: #"^event:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"#,
        options: .regularExpression
      ) != nil
  }

  private static func isSafeInteger(_ value: Int64) -> Bool {
    value >= -noLateLiveActivityMaximumSafeInteger &&
      value <= noLateLiveActivityMaximumSafeInteger
  }

  private static func isPreferredActivity(
    _ lhs: NoLateActiveActivityIdentity,
    _ rhs: NoLateActiveActivityIdentity
  ) -> Bool {
    if lhs.generation != rhs.generation {
      return lhs.generation > rhs.generation
    }
    if lhs.revision != rhs.revision {
      return lhs.revision > rhs.revision
    }
    return lhs.activityId < rhs.activityId
  }

  public static func iso8601Date(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) { return date }
    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    return standard.date(from: value)
  }

  private static func normalizedText(_ value: String, maximumLength: Int) -> String {
    String(value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maximumLength))
  }

  private static func normalizedHexColor(_ value: String) -> String? {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    guard normalized.range(of: #"^#[0-9A-F]{6}$"#, options: .regularExpression) != nil else {
      return nil
    }
    return normalized
  }

  private static func defaultColor(for kind: NoLateRouteSegmentKind) -> String {
    switch kind {
    case .origin:
      return "#22C55E"
    case .destination:
      return "#FF4444"
    case .walk, .transfer:
      return "#9CA3AF"
    case .subway, .bus, .drive, .bike:
      return "#2979FF"
    }
  }
}
