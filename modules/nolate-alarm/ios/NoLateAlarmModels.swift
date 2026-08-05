import CryptoKit
import Foundation

let noLateMaximumSafeJavaScriptInteger: Int64 = 9_007_199_254_740_991
let noLateMinimumFutureTriggerMilliseconds: Int64 = 250
let noLateMissedAlarmGraceMilliseconds: Int64 = 2 * 60 * 1_000
let noLateTombstoneRetentionMilliseconds: Int64 = 90 * 24 * 60 * 60 * 1_000

enum NoLateAlarmDeliveryMode: String, Codable, Sendable {
  case alarmKit
  case timeSensitive
}

enum NoLateAlarmTriggerPolicy {
  static func effectiveTriggerAtMilliseconds(
    sourceTriggerAtMilliseconds: Int64,
    deliveryMode: NoLateAlarmDeliveryMode
  ) -> Int64 {
    guard deliveryMode == .timeSensitive else {
      return sourceTriggerAtMilliseconds
    }
    let remainder = sourceTriggerAtMilliseconds % 1_000
    return remainder == 0
      ? sourceTriggerAtMilliseconds
      : sourceTriggerAtMilliseconds + (1_000 - remainder)
  }
}

enum NoLateStoredAlarmState: String, Codable, Sendable {
  case pendingPermission
  case scheduled
}

enum NoLateAlarmFireTimingBasis: String, Codable, Sendable {
  case exactCallback = "EXACT_CALLBACK"
  case observedAlerting = "OBSERVED_ALERTING"
  case inferredOSDelivery = "INFERRED_OS_DELIVERY"
}

struct NoLateStoredAlarm: Codable, Equatable, Sendable {
  let alarmId: String
  let scheduleId: String
  let title: String?
  let generation: Int64
  let recipientMemberId: Int64?
  let logicalEventKey: String?
  let sourceTriggerAtMilliseconds: Int64
  let effectiveTriggerAtMilliseconds: Int64
  let snoozeMinutes: Int
  var deliveryMode: NoLateAlarmDeliveryMode
  var state: NoLateStoredAlarmState
  var updatedAtMilliseconds: Int64
  /** Physical OS key remains alarmId; this optional value is the stable backend identity. */
  let logicalAlarmId: String?
  let occurrenceId: String?
  let body: String?
  let decision: String?
  let minutesBeforeDeparture: Int?
  let actionEventKey: String?

  var backendAlarmId: String {
    logicalAlarmId ?? alarmId
  }

  func hasSameIdentity(as other: NoLateStoredAlarm) -> Bool {
    alarmId == other.alarmId &&
      generation == other.generation &&
      effectiveTriggerAtMilliseconds == other.effectiveTriggerAtMilliseconds
  }
}

/**
 * Minimal immutable identity retained only when recovery expires a scheduled time-sensitive alarm.
 *
 * A cold-start UNNotificationResponse can outlive the active alarm row because iOS removes the
 * delivered notification before JS starts and reconciliation expires alarms after the grace window.
 * Keeping this response-only evidence on the tombstone lets that response prove the fire without
 * retaining presentation text or making the expired alarm schedulable again.
 */
struct NoLateAlarmNotificationResponseEvidence: Codable, Equatable, Sendable {
  let nativeAlarmId: String
  let alarmId: String
  let scheduleId: String
  let generation: Int64
  let recipientMemberId: Int64
  let occurrenceId: String?
  let scheduledForMilliseconds: Int64
  let sourceTriggerAtMilliseconds: Int64
  let logicalEventKey: String?

  init?(alarm: NoLateStoredAlarm) {
    guard
      alarm.deliveryMode == .timeSensitive,
      alarm.state == .scheduled,
      let recipientMemberId = alarm.recipientMemberId
    else {
      return nil
    }
    self.nativeAlarmId = alarm.alarmId
    self.alarmId = alarm.backendAlarmId
    self.scheduleId = alarm.scheduleId
    self.generation = alarm.generation
    self.recipientMemberId = recipientMemberId
    self.occurrenceId = alarm.occurrenceId
    self.scheduledForMilliseconds = alarm.effectiveTriggerAtMilliseconds
    self.sourceTriggerAtMilliseconds = alarm.sourceTriggerAtMilliseconds
    self.logicalEventKey = alarm.logicalEventKey
    guard isCanonical else { return nil }
  }

  var isCanonical: Bool {
    let hasCanonicalOccurrence = occurrenceId.map {
      ["M15", "M10", "M5", "M0"].contains($0)
    } ?? true
    guard
      let scheduleNumber = Int64(scheduleId),
      scheduleNumber > 0,
      generation >= 0,
      generation <= noLateMaximumSafeJavaScriptInteger,
      recipientMemberId > 0,
      recipientMemberId <= noLateMaximumSafeJavaScriptInteger,
      sourceTriggerAtMilliseconds >= 0,
      scheduledForMilliseconds >= sourceTriggerAtMilliseconds,
      scheduledForMilliseconds - sourceTriggerAtMilliseconds < 1_000,
      hasCanonicalOccurrence
    else {
      return false
    }
    let expectedAlarmId = "schedule:\(scheduleId):member:\(recipientMemberId)"
    let expectedNativeAlarmId = occurrenceId.map {
      "\(expectedAlarmId):occurrence:\($0)"
    } ?? expectedAlarmId
    return alarmId == expectedAlarmId && nativeAlarmId == expectedNativeAlarmId
  }

  func fireEvent(
    eventId: String,
    occurredAtMilliseconds: Int64,
    timingBasis: NoLateAlarmFireTimingBasis
  ) -> NoLateStoredAlarmFireEvent {
    NoLateStoredAlarmFireEvent(
      eventId: eventId,
      alarmId: alarmId,
      scheduleId: scheduleId,
      generation: generation,
      recipientMemberId: recipientMemberId,
      scheduledForMilliseconds: scheduledForMilliseconds,
      sourceTriggerAtMilliseconds: sourceTriggerAtMilliseconds,
      occurredAtMilliseconds: occurredAtMilliseconds,
      timingBasis: timingBasis,
      logicalEventKey: logicalEventKey,
      occurrenceId: occurrenceId
    )
  }
}

struct NoLateStoredAlarmFireEvent: Codable, Equatable, Sendable {
  let eventId: String
  let alarmId: String
  let scheduleId: String
  let generation: Int64
  let recipientMemberId: Int64
  let scheduledForMilliseconds: Int64
  let sourceTriggerAtMilliseconds: Int64
  let occurredAtMilliseconds: Int64
  // Optional only for decoding v1 records written before timing provenance
  // was added. The bridge normalizes those legacy iOS records as observation.
  let timingBasis: NoLateAlarmFireTimingBasis?
  let logicalEventKey: String?
  let occurrenceId: String?

  init(
    eventId: String,
    alarmId: String,
    scheduleId: String,
    generation: Int64,
    recipientMemberId: Int64,
    scheduledForMilliseconds: Int64,
    sourceTriggerAtMilliseconds: Int64,
    occurredAtMilliseconds: Int64,
    timingBasis: NoLateAlarmFireTimingBasis? = nil,
    logicalEventKey: String?,
    occurrenceId: String? = nil
  ) {
    self.eventId = eventId
    self.alarmId = alarmId
    self.scheduleId = scheduleId
    self.generation = generation
    self.recipientMemberId = recipientMemberId
    self.scheduledForMilliseconds = scheduledForMilliseconds
    self.sourceTriggerAtMilliseconds = sourceTriggerAtMilliseconds
    self.occurredAtMilliseconds = occurredAtMilliseconds
    self.timingBasis = timingBasis
    self.logicalEventKey = logicalEventKey
    self.occurrenceId = occurrenceId
  }
}

enum NoLateAlarmFireEventPolicy {
  static let maximumEvents = 100

  static func merge(
    existing: [NoLateStoredAlarmFireEvent],
    incoming: NoLateStoredAlarmFireEvent
  ) -> [NoLateStoredAlarmFireEvent] {
    if existing.contains(where: {
      $0.alarmId == incoming.alarmId &&
        $0.generation == incoming.generation &&
        $0.scheduledForMilliseconds == incoming.scheduledForMilliseconds
    }) {
      return existing
    }
    return (existing + [incoming])
      .sorted {
        if $0.occurredAtMilliseconds != $1.occurredAtMilliseconds {
          return $0.occurredAtMilliseconds < $1.occurredAtMilliseconds
        }
        return $0.eventId < $1.eventId
      }
      .suffix(maximumEvents)
      .map { $0 }
  }
}

struct NoLateStoredDepartureActionEvent: Codable, Equatable, Sendable {
  let eventId: String
  let alarmId: String
  let scheduleId: String
  let generation: Int64
  let recipientMemberId: Int64
  let occurrenceId: String?
  let actionEventKey: String
  let occurredAtMilliseconds: Int64
  var requiresRouteNavigation: Bool
  var routeNavigationDelivered: Bool
}

enum NoLateDepartureActionEventPolicy {
  static let maximumEvents = 100

  static func merge(
    existing: [NoLateStoredDepartureActionEvent],
    incoming: NoLateStoredDepartureActionEvent
  ) -> [NoLateStoredDepartureActionEvent] {
    if existing.contains(where: {
      $0.recipientMemberId == incoming.recipientMemberId &&
        $0.actionEventKey == incoming.actionEventKey
    }) {
      return existing
    }
    return (existing + [incoming])
      .sorted {
        if $0.occurredAtMilliseconds != $1.occurredAtMilliseconds {
          return $0.occurredAtMilliseconds < $1.occurredAtMilliseconds
        }
        return $0.eventId < $1.eventId
      }
      .suffix(maximumEvents)
      .map { $0 }
  }
}

struct NoLateStoredAlarmNavigationEvent: Codable, Equatable, Sendable {
  let eventId: String
  let scheduleId: String
  let recipientMemberId: Int64
  let occurredAtMilliseconds: Int64
}

enum NoLateAlarmNavigationEventPolicy {
  static let maximumEvents = 100

  static func merge(
    existing: [NoLateStoredAlarmNavigationEvent],
    incoming: NoLateStoredAlarmNavigationEvent
  ) -> [NoLateStoredAlarmNavigationEvent] {
    if existing.contains(where: { $0.eventId == incoming.eventId }) {
      return existing
    }
    return (existing + [incoming])
      .sorted {
        if $0.occurredAtMilliseconds != $1.occurredAtMilliseconds {
          return $0.occurredAtMilliseconds < $1.occurredAtMilliseconds
        }
        return $0.eventId < $1.eventId
      }
      .suffix(maximumEvents)
      .map { $0 }
  }
}

struct NoLateAlarmTombstone: Codable, Equatable, Sendable {
  let alarmId: String
  let generation: Int64
  let updatedAtMilliseconds: Int64
  let expiredResponseEvidence: NoLateAlarmNotificationResponseEvidence?

  init(
    alarmId: String,
    generation: Int64,
    updatedAtMilliseconds: Int64,
    expiredResponseEvidence: NoLateAlarmNotificationResponseEvidence? = nil
  ) {
    self.alarmId = alarmId
    self.generation = generation
    self.updatedAtMilliseconds = updatedAtMilliseconds
    self.expiredResponseEvidence = expiredResponseEvidence
  }

  func withoutExpiredResponseEvidence() -> NoLateAlarmTombstone {
    NoLateAlarmTombstone(
      alarmId: alarmId,
      generation: generation,
      updatedAtMilliseconds: updatedAtMilliseconds
    )
  }
}

struct NoLateAlarmStoreSnapshot: Codable, Equatable, Sendable {
  var alarms: [String: NoLateStoredAlarm]
  var tombstones: [String: NoLateAlarmTombstone]

  static let empty = NoLateAlarmStoreSnapshot(alarms: [:], tombstones: [:])
}

enum NoLateAlarmUpsertDisposition: Equatable {
  case apply
  case idempotent
  case stale
  case conflict
}

enum NoLateAlarmCancelDisposition: Equatable {
  case apply
  case stale
}

enum NoLateAlarmRecoveryDisposition: Equatable {
  case keep
  case expire
}

enum NoLateAlarmGenerationPolicy {
  static func decideUpsert(
    current: NoLateStoredAlarm?,
    tombstone: NoLateAlarmTombstone?,
    incomingGeneration: Int64,
    incomingScheduleId: String,
    incomingSourceTriggerAtMilliseconds: Int64,
    incomingTitle: String?,
    incomingSnoozeMinutes: Int,
    incomingLogicalAlarmId: String? = nil,
    incomingOccurrenceId: String? = nil,
    incomingBody: String? = nil,
    incomingDecision: String? = nil,
    incomingMinutesBeforeDeparture: Int? = nil,
    incomingActionEventKey: String? = nil
  ) -> NoLateAlarmUpsertDisposition {
    guard incomingGeneration >= 0 else {
      return .stale
    }

    if
      let tombstoneGeneration = tombstone?.generation,
      incomingGeneration <= tombstoneGeneration
    {
      return .stale
    }

    guard let current else {
      return .apply
    }
    if incomingGeneration < current.generation {
      return .stale
    }
    if incomingGeneration > current.generation {
      return .apply
    }
    if
      incomingScheduleId == current.scheduleId,
      incomingSourceTriggerAtMilliseconds == current.sourceTriggerAtMilliseconds,
      incomingTitle == current.title,
      incomingSnoozeMinutes == current.snoozeMinutes,
      (incomingLogicalAlarmId ?? current.backendAlarmId) == current.backendAlarmId,
      incomingOccurrenceId == current.occurrenceId,
      incomingBody == current.body,
      incomingDecision == current.decision,
      incomingMinutesBeforeDeparture == current.minutesBeforeDeparture,
      incomingActionEventKey == current.actionEventKey
    {
      return .idempotent
    }
    return .conflict
  }

  static func decideCancel(
    current: NoLateStoredAlarm?,
    tombstone: NoLateAlarmTombstone?,
    incomingGeneration: Int64
  ) -> NoLateAlarmCancelDisposition {
    let latestKnownGeneration = max(
      current?.generation ?? Int64.min,
      tombstone?.generation ?? Int64.min
    )
    return incomingGeneration >= latestKnownGeneration ? .apply : .stale
  }
}

enum NoLateAlarmRecoveryPolicy {
  static func disposition(
    triggerAtMilliseconds: Int64,
    nowMilliseconds: Int64
  ) -> NoLateAlarmRecoveryDisposition {
    triggerAtMilliseconds < nowMilliseconds - noLateMissedAlarmGraceMilliseconds
      ? .expire
      : .keep
  }

  static func expiredTombstone(
    for alarm: NoLateStoredAlarm,
    nowMilliseconds: Int64
  ) -> NoLateAlarmTombstone {
    NoLateAlarmTombstone(
      alarmId: alarm.alarmId,
      generation: alarm.generation,
      updatedAtMilliseconds: nowMilliseconds,
      expiredResponseEvidence: NoLateAlarmNotificationResponseEvidence(alarm: alarm)
    )
  }

  static func mayCancelTombstonedDelivery(
    captured: NoLateAlarmTombstone,
    current: NoLateAlarmTombstone?,
    activeAlarm: NoLateStoredAlarm?
  ) -> Bool {
    current == captured && activeAlarm == nil
  }

  static func shouldReschedule(
    alarmState: NoLateStoredAlarmState,
    isSystemDeliveryPresent: Bool,
    triggerAtMilliseconds: Int64,
    nowMilliseconds: Int64
  ) -> Bool {
    let isStillFuture =
      triggerAtMilliseconds >=
        nowMilliseconds + noLateMinimumFutureTriggerMilliseconds
    return isStillFuture &&
      (alarmState != .scheduled || !isSystemDeliveryPresent)
  }

  /**
   * AlarmKit removes a one-shot alarm from `AlarmManager.alarms` after it fired and stopped.
   * A persisted, scheduled alarm that is missing only after its trigger is therefore execution
   * coverage evidence, but never exact timing evidence.
   */
  static func shouldInferMissingAlarmKitFire(
    alarm: NoLateStoredAlarm,
    isSystemDeliveryPresent: Bool,
    nowMilliseconds: Int64
  ) -> Bool {
    alarm.deliveryMode == .alarmKit &&
      alarm.state == .scheduled &&
      !isSystemDeliveryPresent &&
      alarm.effectiveTriggerAtMilliseconds <= nowMilliseconds
  }
}

enum NoLateAlarmDeliveredNotificationPolicy {
  static func matches(
    alarm: NoLateStoredAlarm,
    deliveredAlarmId: String?,
    deliveredScheduleId: String?,
    deliveredGeneration: Int64?
  ) -> Bool {
    deliveredAlarmId == alarm.alarmId &&
      deliveredScheduleId == alarm.scheduleId &&
      deliveredGeneration == alarm.generation
  }
}

enum NoLateAlarmValidationError: Error, LocalizedError {
  case invalid(String)

  var errorDescription: String? {
    switch self {
    case .invalid(let message):
      return message
    }
  }
}

struct NoLateValidatedUpsertCommand: Sendable {
  let alarmId: String
  let logicalAlarmId: String
  let scheduleId: String
  let title: String?
  let body: String?
  let occurrenceId: String?
  let decision: String?
  let minutesBeforeDeparture: Int?
  let actionEventKey: String?
  let generation: Int64
  let recipientMemberId: Int64
  let logicalEventKey: String?
  let triggerAtMilliseconds: Int64
  let snoozeMinutes: Int
}

struct NoLateValidatedCancelCommand: Sendable {
  let alarmId: String
  let logicalAlarmId: String?
  let scheduleId: String
  let generation: Int64
}

struct NoLateValidatedNotificationResponseFire: Sendable {
  let nativeAlarmId: String
  let alarmId: String
  let scheduleId: String
  let generation: Int64
  let recipientMemberId: Int64
  let occurrenceId: String?
  let occurredAtMilliseconds: Int64
}

enum NoLateAlarmNotificationResponsePolicy {
  static func matchingEvidence(
    activeAlarm: NoLateStoredAlarm?,
    tombstone: NoLateAlarmTombstone?,
    response: NoLateValidatedNotificationResponseFire,
    nowMilliseconds: Int64
  ) -> NoLateAlarmNotificationResponseEvidence? {
    if let activeAlarm {
      guard
        let evidence = NoLateAlarmNotificationResponseEvidence(alarm: activeAlarm),
        matches(evidence: evidence, response: response)
      else {
        return nil
      }
      return evidence
    }

    guard
      let tombstone,
      tombstone.alarmId == response.nativeAlarmId,
      tombstone.generation == response.generation,
      tombstone.updatedAtMilliseconds >= 0,
      nowMilliseconds >= tombstone.updatedAtMilliseconds,
      nowMilliseconds - tombstone.updatedAtMilliseconds <=
        noLateTombstoneRetentionMilliseconds,
      let evidence = tombstone.expiredResponseEvidence,
      evidence.nativeAlarmId == tombstone.alarmId,
      evidence.generation == tombstone.generation,
      tombstone.updatedAtMilliseconds >= evidence.scheduledForMilliseconds,
      response.occurredAtMilliseconds <= tombstone.updatedAtMilliseconds,
      matches(evidence: evidence, response: response)
    else {
      return nil
    }
    return evidence
  }

  static func matches(
    alarm: NoLateStoredAlarm,
    response: NoLateValidatedNotificationResponseFire
  ) -> Bool {
    guard let evidence = NoLateAlarmNotificationResponseEvidence(alarm: alarm) else {
      return false
    }
    return matches(evidence: evidence, response: response)
  }

  private static func matches(
    evidence: NoLateAlarmNotificationResponseEvidence,
    response: NoLateValidatedNotificationResponseFire
  ) -> Bool {
    evidence.isCanonical &&
      evidence.nativeAlarmId == response.nativeAlarmId &&
      evidence.alarmId == response.alarmId &&
      evidence.scheduleId == response.scheduleId &&
      evidence.generation == response.generation &&
      evidence.recipientMemberId == response.recipientMemberId &&
      evidence.occurrenceId == response.occurrenceId &&
      // UNNotification.date is the observed delivery time. Tolerate the one-second calendar
      // trigger rounding boundary, but never accept a response dated before this alarm.
      response.occurredAtMilliseconds >= evidence.scheduledForMilliseconds - 1_000
  }
}

enum NoLateAlarmInput {
  static func upsert(
    operation: String,
    alarmId: String,
    logicalAlarmId: String,
    scheduleId: String,
    title: String?,
    body: String?,
    occurrenceId: String?,
    decision: String?,
    minutesBeforeDeparture: Int?,
    actionEventKey: String?,
    generation: Double,
    recipientMemberId: Double,
    logicalEventKey: String?,
    triggerAt: String,
    snoozeMinutes: Int?
  ) throws -> NoLateValidatedUpsertCommand {
    guard operation == "UPSERT" else {
      throw NoLateAlarmValidationError.invalid("operation must be UPSERT.")
    }
    let normalizedSnooze = snoozeMinutes ?? 5
    guard (1...60).contains(normalizedSnooze) else {
      throw NoLateAlarmValidationError.invalid(
        "snoozeMinutes must be between 1 and 60."
      )
    }
    let normalizedAlarmId = try validatedIdentifier(alarmId, fieldName: "alarmId")
    let normalizedLogicalAlarmId = try validatedIdentifier(
      logicalAlarmId.isEmpty ? alarmId : logicalAlarmId,
      fieldName: "logicalAlarmId"
    )
    let normalizedOccurrenceId = try normalizedOccurrenceId(occurrenceId)
    let normalizedDecision = try normalizedDecision(decision)
    let normalizedMinutes = try normalizedMinutesBeforeDeparture(minutesBeforeDeparture)
    let normalizedActionKey = try normalizedActionEventKey(actionEventKey)
    if let normalizedOccurrenceId {
      guard normalizedActionKey != nil else {
        throw NoLateAlarmValidationError.invalid(
          "actionEventKey is required for an occurrence alarm."
        )
      }
      let expectedMinutes = ["M15": 15, "M10": 10, "M5": 5, "M0": 0][normalizedOccurrenceId]
      let expectedDecision = normalizedOccurrenceId == "M0" ? "DEPART_NOW" : "ADVANCE_NOTICE"
      guard normalizedMinutes == expectedMinutes, normalizedDecision == expectedDecision else {
        throw NoLateAlarmValidationError.invalid(
          "occurrence metadata does not match occurrenceId."
        )
      }
    }
    return NoLateValidatedUpsertCommand(
      alarmId: normalizedAlarmId,
      logicalAlarmId: normalizedLogicalAlarmId,
      scheduleId: try validatedIdentifier(scheduleId, fieldName: "scheduleId"),
      title: normalizedTitle(title),
      body: normalizedBody(body),
      occurrenceId: normalizedOccurrenceId,
      decision: normalizedDecision,
      minutesBeforeDeparture: normalizedMinutes,
      actionEventKey: normalizedActionKey,
      generation: try safeInteger(generation, fieldName: "generation"),
      recipientMemberId: try positiveSafeInteger(
        recipientMemberId,
        fieldName: "recipientMemberId"
      ),
      logicalEventKey: try normalizedLogicalEventKey(logicalEventKey),
      triggerAtMilliseconds: try isoTimestampMilliseconds(triggerAt),
      snoozeMinutes: normalizedSnooze
    )
  }

  static func cancel(
    alarmId: String,
    logicalAlarmId: String?,
    scheduleId: String,
    generation: Double
  ) throws -> NoLateValidatedCancelCommand {
    NoLateValidatedCancelCommand(
      alarmId: try validatedIdentifier(alarmId, fieldName: "alarmId"),
      logicalAlarmId: try logicalAlarmId.map {
        try validatedIdentifier($0, fieldName: "logicalAlarmId")
      },
      scheduleId: try validatedIdentifier(scheduleId, fieldName: "scheduleId"),
      generation: try safeInteger(generation, fieldName: "generation")
    )
  }

  static func notificationResponseFire(
    nativeAlarmId: String,
    alarmId: String,
    scheduleId: String,
    generation: Double,
    recipientMemberId: Double,
    occurrenceId: String?,
    occurredAt: String
  ) throws -> NoLateValidatedNotificationResponseFire {
    let normalizedNativeAlarmId = try validatedIdentifier(
      nativeAlarmId,
      fieldName: "nativeAlarmId"
    )
    let normalizedAlarmId = try validatedIdentifier(alarmId, fieldName: "alarmId")
    let normalizedScheduleId = try validatedIdentifier(scheduleId, fieldName: "scheduleId")
    guard let scheduleNumber = Int64(normalizedScheduleId), scheduleNumber > 0 else {
      throw NoLateAlarmValidationError.invalid("scheduleId must be a positive integer.")
    }
    let normalizedRecipientMemberId = try positiveSafeInteger(
      recipientMemberId,
      fieldName: "recipientMemberId"
    )
    guard normalizedAlarmId ==
      "schedule:\(normalizedScheduleId):member:\(normalizedRecipientMemberId)"
    else {
      throw NoLateAlarmValidationError.invalid("alarmId is not canonical.")
    }
    let normalizedOccurrenceId = try normalizedOccurrenceId(occurrenceId)
    let expectedNativeAlarmId = normalizedOccurrenceId.map {
      "\(normalizedAlarmId):occurrence:\($0)"
    } ?? normalizedAlarmId
    guard normalizedNativeAlarmId == expectedNativeAlarmId else {
      throw NoLateAlarmValidationError.invalid("nativeAlarmId is not canonical.")
    }
    return NoLateValidatedNotificationResponseFire(
      nativeAlarmId: normalizedNativeAlarmId,
      alarmId: normalizedAlarmId,
      scheduleId: normalizedScheduleId,
      generation: try safeInteger(generation, fieldName: "generation"),
      recipientMemberId: normalizedRecipientMemberId,
      occurrenceId: normalizedOccurrenceId,
      occurredAtMilliseconds: try isoTimestampMilliseconds(occurredAt)
    )
  }

  static func safeInteger(_ value: Double, fieldName: String) throws -> Int64 {
    guard value.isFinite, value.rounded(.towardZero) == value else {
      throw NoLateAlarmValidationError.invalid("\(fieldName) must be an integer.")
    }
    guard value >= 0, value <= Double(noLateMaximumSafeJavaScriptInteger) else {
      throw NoLateAlarmValidationError.invalid(
        "\(fieldName) is outside the JavaScript safe-integer range."
      )
    }
    return Int64(value)
  }

  static func positiveSafeInteger(_ value: Double, fieldName: String) throws -> Int64 {
    let result = try safeInteger(value, fieldName: fieldName)
    guard result > 0 else {
      throw NoLateAlarmValidationError.invalid("\(fieldName) must be positive.")
    }
    return result
  }

  static func normalizedLogicalEventKey(_ value: String?) throws -> String? {
    let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if normalized.isEmpty { return nil }
    guard normalized.count <= 100 else {
      throw NoLateAlarmValidationError.invalid(
        "logicalEventKey must not exceed 100 characters."
      )
    }
    return normalized
  }

  static func isoTimestampMilliseconds(_ value: String) throws -> Int64 {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
      !normalized.isEmpty,
      normalized.range(
        of: #"(?:Z|[+-]\d{2}:\d{2})$"#,
        options: .regularExpression
      ) != nil
    else {
      throw NoLateAlarmValidationError.invalid(
        "triggerAt must be a valid ISO-8601 timestamp with a timezone."
      )
    }

    let fractionExpression = try! NSRegularExpression(
      pattern: #"\.(\d{1,9})(?=Z|[+-]\d{2}:\d{2}$)"#
    )
    let sourceRange = NSRange(normalized.startIndex..., in: normalized)
    let fractionMatch = fractionExpression.firstMatch(
      in: normalized,
      range: sourceRange
    )
    let millisecondNormalized: String
    if
      let fractionMatch,
      let fullRange = Range(fractionMatch.range(at: 0), in: normalized),
      let digitsRange = Range(fractionMatch.range(at: 1), in: normalized)
    {
      let digits = String(normalized[digitsRange])
      let milliseconds = String((digits + "000").prefix(3))
      millisecondNormalized = normalized.replacingCharacters(
        in: fullRange,
        with: ".\(milliseconds)"
      )
    } else {
      millisecondNormalized = normalized
    }

    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.isLenient = false
    formatter.dateFormat = fractionMatch == nil
      ? "yyyy-MM-dd'T'HH:mm:ssXXXXX"
      : "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"
    let parsed = formatter.date(from: millisecondNormalized)
    guard let parsed else {
      throw NoLateAlarmValidationError.invalid(
        "triggerAt must be a valid ISO-8601 timestamp with a timezone."
      )
    }

    let milliseconds = parsed.timeIntervalSince1970 * 1_000
    guard
      milliseconds.isFinite,
      milliseconds >= 0,
      milliseconds <= Double(noLateMaximumSafeJavaScriptInteger)
    else {
      throw NoLateAlarmValidationError.invalid(
        "triggerAt is outside the supported timestamp range."
      )
    }
    return Int64(milliseconds.rounded())
  }

  static func normalizedTitle(_ value: String?) -> String? {
    let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return normalized.isEmpty ? nil : String(normalized.prefix(100))
  }

  static func normalizedBody(_ value: String?) -> String? {
    let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return normalized.isEmpty ? nil : String(normalized.prefix(500))
  }

  static func normalizedOccurrenceId(_ value: String?) throws -> String? {
    let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if normalized.isEmpty { return nil }
    guard ["M15", "M10", "M5", "M0"].contains(normalized) else {
      throw NoLateAlarmValidationError.invalid(
        "occurrenceId must be M15, M10, M5, or M0."
      )
    }
    return normalized
  }

  static func normalizedDecision(_ value: String?) throws -> String? {
    let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if normalized.isEmpty { return nil }
    guard normalized == "ADVANCE_NOTICE" || normalized == "DEPART_NOW" else {
      throw NoLateAlarmValidationError.invalid(
        "decision must be ADVANCE_NOTICE or DEPART_NOW."
      )
    }
    return normalized
  }

  static func normalizedMinutesBeforeDeparture(_ value: Int?) throws -> Int? {
    guard let value else { return nil }
    guard [0, 5, 10, 15].contains(value) else {
      throw NoLateAlarmValidationError.invalid(
        "minutesBeforeDeparture must be 0, 5, 10, or 15."
      )
    }
    return value
  }

  static func normalizedActionEventKey(_ value: String?) throws -> String? {
    let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if normalized.isEmpty { return nil }
    let keyPattern = try! NSRegularExpression(pattern: #"^key:[a-f0-9]{64}$"#)
    let eventPattern = try! NSRegularExpression(
      pattern: #"^event:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"#
    )
    let range = NSRange(normalized.startIndex..., in: normalized)
    guard keyPattern.firstMatch(in: normalized, range: range) != nil ||
      eventPattern.firstMatch(in: normalized, range: range) != nil
    else {
      throw NoLateAlarmValidationError.invalid("actionEventKey has an invalid format.")
    }
    return normalized
  }

  private static func validatedIdentifier(
    _ value: String,
    fieldName: String
  ) throws -> String {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else {
      throw NoLateAlarmValidationError.invalid("\(fieldName) is required.")
    }
    guard normalized.count <= 200 else {
      throw NoLateAlarmValidationError.invalid(
        "\(fieldName) must not exceed 200 characters."
      )
    }
    return normalized
  }
}

enum NoLateAlarmSystemIdentifier {
  static func uuid(alarmId: String) -> UUID {
    let input = Data("nolate.departure|\(alarmId)".utf8)
    var bytes = Array(SHA256.hash(data: input).prefix(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x50
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    let hex = bytes.map { String(format: "%02x", $0) }.joined()
    let first = String(hex.prefix(8))
    let second = String(hex.dropFirst(8).prefix(4))
    let third = String(hex.dropFirst(12).prefix(4))
    let fourth = String(hex.dropFirst(16).prefix(4))
    let fifth = String(hex.dropFirst(20).prefix(12))
    let formatted = "\(first)-\(second)-\(third)-\(fourth)-\(fifth)"
    return UUID(uuidString: formatted)!
  }

  static func notificationRequestIdentifier(alarmId: String) -> String {
    "nolate.departure.\(uuid(alarmId: alarmId).uuidString.lowercased())"
  }
}

enum NoLateAlarmActionIdentity {
  static func fallbackKey(physicalAlarmId: String, generation: Int64) -> String {
    let input = Data("nolate.departure.action|\(physicalAlarmId)|\(generation)".utf8)
    return "key:" + SHA256.hash(data: input).map {
      String(format: "%02x", $0)
    }.joined()
  }
}

enum NoLateAlarmNavigationIdentity {
  static func eventId(physicalAlarmId: String, generation: Int64) -> String {
    let input = Data("nolate.departure.navigation|\(physicalAlarmId)|\(generation)".utf8)
    return "navigation:" + SHA256.hash(data: input).map {
      String(format: "%02x", $0)
    }.joined()
  }
}

enum NoLateAlarmIntentCommitSequence {
  static func recordFireThenInteraction(
    recordFire: () throws -> Void,
    recordInteraction: () throws -> Void
  ) throws {
    var fireFailure: Error?
    var interactionFailure: Error?
    do {
      try recordFire()
    } catch {
      fireFailure = error
    }
    // A telemetry persistence failure must not discard an explicit user action. Attempt the
    // independent interaction journal even after fire failure, but only the caller may proceed to
    // tombstone/cancel when both durable boundaries succeeded.
    do {
      try recordInteraction()
    } catch {
      interactionFailure = error
    }
    if let fireFailure { throw fireFailure }
    if let interactionFailure { throw interactionFailure }
  }
}

enum NoLateAlarmPresentationPolicy {
  static func alarmKitAlertTitle(title: String?, body: String?) -> String {
    let normalizedTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let finalTitle = normalizedTitle.isEmpty ? "출발 시간입니다" : normalizedTitle
    let normalizedBody = body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let combined = normalizedBody.isEmpty
      ? finalTitle
      : "\(finalTitle) · \(normalizedBody)"
    return String(combined.prefix(160))
  }
}

enum NoLateAlarmSoundPreference: String, CaseIterable {
  case chime = "CHIME"
  case bell = "BELL"
  case beep = "BEEP"

  static let defaultValue: Self = .chime

  var notificationResourceName: String {
    switch self {
    case .chime:
      return "nolate_departure_alert"
    case .bell:
      return "nolate_alarm_bell_alert"
    case .beep:
      return "nolate_alarm_beep_alert"
    }
  }
}

/**
 * Stable identifiers shared by the native notification scheduler and the JS response router.
 *
 * Custom-alarm notification actions only open NoLate. They deliberately do not reuse the
 * production `schedule_depart_now_action` identifier, because that identifier commits a departure
 * mutation before the app UI is shown.
 */
enum NoLateCustomAlarmNotificationContract {
  static let payloadType = "NOLATE_CUSTOM_ALARM"
  static let categoryIdentifier = "nolate_custom_alarm"
  static let previewCategoryIdentifier = "nolate_custom_alarm_preview"
  static let legacyCategoryIdentifier = "schedule_depart_now"
  static let openActionIdentifier = "nolate_custom_alarm_open_action"
  static let confirmDepartureActionIdentifier =
    "nolate_custom_alarm_confirm_departure_action"
  static let previewRouteActionIdentifier = "nolate_custom_alarm_preview_route_action"
  static let previewDepartureActionIdentifier =
    "nolate_custom_alarm_preview_departure_action"
  static let legacyDepartureActionIdentifier = "schedule_depart_now_action"
  static let legacySnoozeActionIdentifier = "schedule_snooze_action"

  static let previewRequestIdentifierPrefix = "nolate.custom-alarm.preview."
  static let previewRequestIdentifier = "\(previewRequestIdentifierPrefix)current"

  static let managedCategoryIdentifiers: Set<String> = [
    categoryIdentifier,
    previewCategoryIdentifier,
    legacyCategoryIdentifier
  ]

  // Only notifications that open NoLate's custom alarm screen follow the selected alarm sound.
  // The legacy standard-push category remains on its own notification sound policy.
  static let soundManagedCategoryIdentifiers: Set<String> = [
    categoryIdentifier,
    previewCategoryIdentifier
  ]

  static let previewTitle = "출발 알람 미리보기"
  static let previewBody = "알람이 잘 울리는지 확인해 보세요."

  static func categoryIdentifiersAfterRegistration(
    preserving existing: Set<String>
  ) -> Set<String> {
    existing.union(managedCategoryIdentifiers)
  }

  static func shouldRefreshSound(categoryIdentifier: String) -> Bool {
    soundManagedCategoryIdentifiers.contains(categoryIdentifier)
  }

  static func previewRequestIdentifiers(
    from identifiers: [String]
  ) -> [String] {
    identifiers.filter { $0.hasPrefix(previewRequestIdentifierPrefix) }
  }

  static func normalizedScheduleId(_ value: String?) throws -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
      !normalized.isEmpty,
      normalized.count <= 200,
      normalized.range(
        of: "^[1-9][0-9]*$",
        options: .regularExpression
      ) != nil
    else {
      throw NoLateAlarmValidationError.invalid(
        "scheduleId must be a positive decimal identifier."
      )
    }
    return normalized
  }

  static func payload(
    alarmId: String,
    previewId: String?,
    scheduleId: String?,
    title: String?,
    body: String?,
    isPreview: Bool
  ) -> [String: String] {
    var data: [String: String] = [
      "type": payloadType,
      "alarmId": alarmId,
      "isPreview": isPreview ? "true" : "false"
    ]
    if let previewId { data["previewId"] = previewId }
    if let scheduleId { data["scheduleId"] = scheduleId }
    if let title { data["title"] = title }
    if let body { data["body"] = body }
    return data
  }
}
