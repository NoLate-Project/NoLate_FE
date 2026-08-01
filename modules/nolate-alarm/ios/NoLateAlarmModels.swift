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

  func hasSameIdentity(as other: NoLateStoredAlarm) -> Bool {
    alarmId == other.alarmId &&
      generation == other.generation &&
      effectiveTriggerAtMilliseconds == other.effectiveTriggerAtMilliseconds
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
    logicalEventKey: String?
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

struct NoLateAlarmTombstone: Codable, Equatable, Sendable {
  let alarmId: String
  let generation: Int64
  let updatedAtMilliseconds: Int64
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
    incomingSnoozeMinutes: Int
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
      incomingSnoozeMinutes == current.snoozeMinutes
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
  let scheduleId: String
  let title: String?
  let generation: Int64
  let recipientMemberId: Int64
  let logicalEventKey: String?
  let triggerAtMilliseconds: Int64
  let snoozeMinutes: Int
}

struct NoLateValidatedCancelCommand: Sendable {
  let alarmId: String
  let scheduleId: String
  let generation: Int64
}

enum NoLateAlarmInput {
  static func upsert(
    operation: String,
    alarmId: String,
    scheduleId: String,
    title: String?,
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
    return NoLateValidatedUpsertCommand(
      alarmId: try validatedIdentifier(alarmId, fieldName: "alarmId"),
      scheduleId: try validatedIdentifier(scheduleId, fieldName: "scheduleId"),
      title: normalizedTitle(title),
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
    scheduleId: String,
    generation: Double
  ) throws -> NoLateValidatedCancelCommand {
    NoLateValidatedCancelCommand(
      alarmId: try validatedIdentifier(alarmId, fieldName: "alarmId"),
      scheduleId: try validatedIdentifier(scheduleId, fieldName: "scheduleId"),
      generation: try safeInteger(generation, fieldName: "generation")
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
