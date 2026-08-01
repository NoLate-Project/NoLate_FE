package expo.modules.nolatealarm

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.util.UUID

/** Device-protected, bounded, at-least-once evidence of native alarm execution. */
internal class DepartureAlarmFireJournal(context: Context) {
  private val preferences: SharedPreferences = context.applicationContext
    .createDeviceProtectedStorageContext()
    .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun record(alarm: StoredAlarm, occurredAtMillis: Long): Boolean = synchronized(JOURNAL_LOCK) {
    val recipientMemberId = alarm.recipientMemberId ?: return@synchronized false
    val incoming = StoredAlarmFireEvent(
      eventId = UUID.randomUUID().toString(),
      alarmId = alarm.alarmId,
      scheduleId = alarm.scheduleId,
      generation = alarm.generation,
      recipientMemberId = recipientMemberId,
      scheduledForMillis = alarm.effectiveTriggerAtMillis,
      sourceTriggerAtMillis = alarm.sourceTriggerAtMillis,
      occurredAtMillis = occurredAtMillis,
      logicalEventKey = alarm.logicalEventKey,
      timingBasis = AlarmFireTimingBasis.EXACT_CALLBACK
    )
    writeAllUnlocked(AlarmFireEventPolicy.merge(readAllUnlocked(), incoming))
  }

  fun getAll(): List<StoredAlarmFireEvent> = synchronized(JOURNAL_LOCK) {
    readAllUnlocked()
  }

  fun remove(eventId: String): Boolean = synchronized(JOURNAL_LOCK) {
    if (eventId.isBlank() || eventId.length > 200) return@synchronized false
    val current = readAllUnlocked()
    if (current.none { it.eventId == eventId }) return@synchronized false
    writeAllUnlocked(current.filterNot { it.eventId == eventId })
  }

  fun clear(): Boolean = synchronized(JOURNAL_LOCK) {
    preferences.edit().clear().commit()
  }

  private fun readAllUnlocked(): List<StoredAlarmFireEvent> = preferences.all.values
    .mapNotNull { decode(it as? String) }
    .sortedWith(compareBy(StoredAlarmFireEvent::occurredAtMillis, StoredAlarmFireEvent::eventId))
    .takeLast(AlarmFireEventPolicy.MAX_EVENTS)

  private fun writeAllUnlocked(events: List<StoredAlarmFireEvent>): Boolean {
    val editor = preferences.edit().clear()
    events.forEach { event -> editor.putString(event.eventId, encode(event)) }
    return editor.commit()
  }

  private fun encode(event: StoredAlarmFireEvent): String = JSONObject()
    .put("eventId", event.eventId)
    .put("alarmId", event.alarmId)
    .put("scheduleId", event.scheduleId)
    .put("generation", event.generation)
    .put("recipientMemberId", event.recipientMemberId)
    .put("scheduledForMillis", event.scheduledForMillis)
    .put("sourceTriggerAtMillis", event.sourceTriggerAtMillis)
    .put("occurredAtMillis", event.occurredAtMillis)
    .put("timingBasis", event.timingBasis.name)
    .put("logicalEventKey", event.logicalEventKey ?: JSONObject.NULL)
    .toString()

  private fun decode(raw: String?): StoredAlarmFireEvent? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
      val json = JSONObject(raw)
      StoredAlarmFireEvent(
        eventId = json.getString("eventId"),
        alarmId = json.getString("alarmId"),
        scheduleId = json.getString("scheduleId"),
        generation = json.getLong("generation"),
        recipientMemberId = json.getLong("recipientMemberId"),
        scheduledForMillis = json.getLong("scheduledForMillis"),
        sourceTriggerAtMillis = json.optLong(
          "sourceTriggerAtMillis",
          json.getLong("scheduledForMillis")
        ),
        occurredAtMillis = json.getLong("occurredAtMillis"),
        timingBasis = AlarmFireTimingBasis.valueOf(
          json.optString("timingBasis", AlarmFireTimingBasis.EXACT_CALLBACK.name)
        ),
        logicalEventKey = if (json.isNull("logicalEventKey")) {
          null
        } else {
          json.optString("logicalEventKey").takeIf { it.isNotBlank() }
        }
      )
    }.getOrNull()
  }

  private companion object {
    const val PREFERENCES_NAME = "nolate_alarm_fire_journal_v1"
    val JOURNAL_LOCK = Any()
  }
}
