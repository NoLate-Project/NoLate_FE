package expo.modules.nolatealarm

import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale

internal const val MAX_SAFE_JS_INTEGER = 9_007_199_254_740_991L
internal const val DEFAULT_SNOOZE_MILLIS = 5 * 60 * 1000L
internal const val MISSED_ALARM_GRACE_MILLIS = 2 * 60 * 1000L
internal const val MINIMUM_FUTURE_TRIGGER_MILLIS = 250L

internal enum class StoredAlarmState {
  PENDING_PERMISSION,
  SCHEDULED,
  SNOOZED,
  FIRING
}

internal enum class AlarmFireTimingBasis {
  EXACT_CALLBACK,
  OBSERVED_ALERTING
}

internal data class StoredAlarm(
  val alarmId: String,
  val scheduleId: String,
  val title: String?,
  val generation: Long,
  val recipientMemberId: Long?,
  val logicalEventKey: String?,
  val sourceTriggerAtMillis: Long,
  val effectiveTriggerAtMillis: Long,
  val snoozeMinutes: Int,
  val state: StoredAlarmState,
  val updatedAtMillis: Long
)

internal data class StoredAlarmFireEvent(
  val eventId: String,
  val alarmId: String,
  val scheduleId: String,
  val generation: Long,
  val recipientMemberId: Long,
  val scheduledForMillis: Long,
  val sourceTriggerAtMillis: Long,
  val occurredAtMillis: Long,
  val logicalEventKey: String?,
  val timingBasis: AlarmFireTimingBasis = AlarmFireTimingBasis.EXACT_CALLBACK
) {
  fun toBridgeMap(): Map<String, Any?> = buildMap {
    put("eventId", eventId)
    put("alarmId", alarmId)
    put("scheduleId", scheduleId)
    put("generation", generation.toDouble())
    put("recipientMemberId", recipientMemberId.toDouble())
    put("scheduledFor", formatIsoInstant(scheduledForMillis))
    put("sourceTriggerAt", formatIsoInstant(sourceTriggerAtMillis))
    put("occurredAt", formatIsoInstant(occurredAtMillis))
    put("timingBasis", timingBasis.name)
    logicalEventKey?.let { put("logicalEventKey", it) }
  }
}

internal object AlarmFireEventPolicy {
  const val MAX_EVENTS = 100

  /**
   * Keeps EXACT_CALLBACK tied to the BroadcastReceiver boundary rather than service startup.
   * Missing or implausible dispatch metadata is omitted instead of being relabelled as exact.
   */
  fun exactCallbackTimestamp(
    triggerAtMillis: Long,
    receiverOccurredAtMillis: Long,
    serviceAcceptedAtMillis: Long
  ): Long? {
    if (!AlarmRecoveryPolicy.mayFire(triggerAtMillis, receiverOccurredAtMillis)) return null
    if (receiverOccurredAtMillis > serviceAcceptedAtMillis + MINIMUM_FUTURE_TRIGGER_MILLIS) {
      return null
    }
    if (serviceAcceptedAtMillis - receiverOccurredAtMillis > MISSED_ALARM_GRACE_MILLIS) {
      return null
    }
    return receiverOccurredAtMillis
  }

  fun merge(
    existing: List<StoredAlarmFireEvent>,
    incoming: StoredAlarmFireEvent
  ): List<StoredAlarmFireEvent> {
    if (existing.any {
        it.alarmId == incoming.alarmId &&
          it.generation == incoming.generation &&
          it.scheduledForMillis == incoming.scheduledForMillis
      }) {
      return existing
    }
    return (existing + incoming)
      .sortedWith(compareBy(StoredAlarmFireEvent::occurredAtMillis, StoredAlarmFireEvent::eventId))
      .takeLast(MAX_EVENTS)
  }
}

internal data class AlarmTombstone(
  val alarmId: String,
  val generation: Long,
  val updatedAtMillis: Long
)

internal enum class UpsertDisposition {
  APPLY,
  IDEMPOTENT,
  STALE,
  CONFLICT
}

internal enum class CancelDisposition {
  APPLY,
  STALE
}

internal enum class RecoveryDisposition {
  RESCHEDULE,
  EXPIRE
}

/**
 * Keeps late UPSERT payloads from resurrecting alarms after cancellation.
 *
 * A generation is monotonic for one alarmId. An equal generation is idempotent
 * only when it describes the same server trigger. Local snoozes retain the
 * original source trigger, so replaying the matching UPSERT cannot undo them.
 */
internal object AlarmGenerationPolicy {
  fun decideUpsert(
    current: StoredAlarm?,
    tombstone: AlarmTombstone?,
    incomingGeneration: Long,
    incomingScheduleId: String,
    incomingSourceTriggerAtMillis: Long,
    incomingTitle: String?,
    incomingSnoozeMinutes: Int
  ): UpsertDisposition {
    if (incomingGeneration < 0) return UpsertDisposition.STALE

    val tombstoneGeneration = tombstone?.generation
    if (tombstoneGeneration != null && incomingGeneration <= tombstoneGeneration) {
      return UpsertDisposition.STALE
    }

    if (current == null) return UpsertDisposition.APPLY
    if (incomingGeneration < current.generation) return UpsertDisposition.STALE
    if (incomingGeneration > current.generation) return UpsertDisposition.APPLY

    return if (
      incomingScheduleId == current.scheduleId &&
      incomingSourceTriggerAtMillis == current.sourceTriggerAtMillis &&
      incomingTitle == current.title &&
      incomingSnoozeMinutes == current.snoozeMinutes
    ) {
      UpsertDisposition.IDEMPOTENT
    } else {
      UpsertDisposition.CONFLICT
    }
  }

  fun decideCancel(
    current: StoredAlarm?,
    tombstone: AlarmTombstone?,
    incomingGeneration: Long
  ): CancelDisposition {
    val latestKnownGeneration = maxOf(
      current?.generation ?: Long.MIN_VALUE,
      tombstone?.generation ?: Long.MIN_VALUE
    )
    return if (incomingGeneration >= latestKnownGeneration) {
      CancelDisposition.APPLY
    } else {
      CancelDisposition.STALE
    }
  }
}

internal object AlarmRecoveryPolicy {
  fun disposition(triggerAtMillis: Long, nowMillis: Long): RecoveryDisposition =
    if (triggerAtMillis >= nowMillis + MINIMUM_FUTURE_TRIGGER_MILLIS) {
      RecoveryDisposition.RESCHEDULE
    } else {
      // Recovery receivers never turn a boot/time-change broadcast into a media
      // playback FGS launch. Past alarms become tombstones instead.
      RecoveryDisposition.EXPIRE
    }

  fun mayFire(triggerAtMillis: Long, nowMillis: Long): Boolean =
    triggerAtMillis <= nowMillis + MINIMUM_FUTURE_TRIGGER_MILLIS &&
      nowMillis - triggerAtMillis <= MISSED_ALARM_GRACE_MILLIS
}

internal fun requireSafeJsInteger(value: Double, fieldName: String): Long {
  require(value.isFinite()) { "$fieldName must be finite." }
  require(value % 1.0 == 0.0) { "$fieldName must be an integer." }
  require(value >= 0.0 && value <= MAX_SAFE_JS_INTEGER.toDouble()) {
    "$fieldName is outside the JavaScript safe-integer range."
  }
  return value.toLong()
}

internal fun requireAlarmId(value: String): String {
  val normalized = value.trim()
  require(normalized.isNotEmpty()) { "alarmId is required." }
  require(normalized.length <= 200) { "alarmId must not exceed 200 characters." }
  return normalized
}

internal fun requireScheduleId(value: String): String {
  val normalized = value.trim()
  require(normalized.isNotEmpty()) { "scheduleId is required." }
  require(normalized.length <= 200) { "scheduleId must not exceed 200 characters." }
  return normalized
}

internal fun normalizeAlarmTitle(value: String?): String? {
  val normalized = value?.trim().orEmpty()
  if (normalized.isEmpty()) return null
  return normalized.take(100)
}

internal fun requireRecipientMemberId(value: Double): Long {
  val memberId = requireSafeJsInteger(value, "recipientMemberId")
  require(memberId > 0) { "recipientMemberId must be positive." }
  return memberId
}

internal fun normalizeLogicalEventKey(value: String?): String? {
  val normalized = value?.trim().orEmpty()
  if (normalized.isEmpty()) return null
  require(normalized.length <= 100) { "logicalEventKey must not exceed 100 characters." }
  return normalized
}

internal fun formatIsoInstant(timestampMillis: Long): String =
  SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = java.util.TimeZone.getTimeZone("UTC")
    isLenient = false
  }.format(java.util.Date(timestampMillis))

/**
 * Parses the ISO-8601 form emitted by the backend without java.time, which is
 * unavailable natively on this module's API 24/25 devices.
 */
internal fun parseIsoTriggerAtMillis(value: String): Long {
  val normalized = value.trim()
  require(normalized.isNotEmpty()) { "triggerAt is required." }

  val fractionMatch = FRACTION_PATTERN.find(normalized)
  val millisecondNormalized = if (fractionMatch == null) {
    normalized
  } else {
    val milliseconds = fractionMatch.groupValues[1].padEnd(3, '0').take(3)
    normalized.replaceRange(fractionMatch.range, ".$milliseconds")
  }

  val pattern = if (millisecondNormalized.contains('.')) {
    "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"
  } else {
    "yyyy-MM-dd'T'HH:mm:ssXXX"
  }
  val formatter = SimpleDateFormat(pattern, Locale.US).apply {
    isLenient = false
  }
  val position = ParsePosition(0)
  val parsed = formatter.parse(millisecondNormalized, position)
  require(parsed != null && position.index == millisecondNormalized.length) {
    "triggerAt must be a valid ISO-8601 timestamp with a timezone."
  }
  return parsed.time
}

private val FRACTION_PATTERN = Regex("""\.(\d{1,9})(?=Z|[+-]\d{2}:\d{2}$)""")
