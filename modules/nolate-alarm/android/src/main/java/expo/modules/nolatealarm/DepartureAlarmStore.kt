package expo.modules.nolatealarm

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

internal class DepartureAlarmStore(context: Context) {
  private val storageContext = context.applicationContext.createDeviceProtectedStorageContext()
  private val preferences: SharedPreferences = storageContext.getSharedPreferences(
    PREFERENCES_NAME,
    Context.MODE_PRIVATE
  )

  fun getAlarm(alarmId: String): StoredAlarm? = synchronized(STORE_LOCK) {
    decodeAlarm(preferences.getString(alarmKey(alarmId), null))
  }

  fun getTombstone(alarmId: String): AlarmTombstone? = synchronized(STORE_LOCK) {
    decodeTombstone(preferences.getString(tombstoneKey(alarmId), null))
  }

  fun getAllAlarms(): List<StoredAlarm> = synchronized(STORE_LOCK) {
    preferences.all
      .asSequence()
      .filter { (key, _) -> key.startsWith(ALARM_PREFIX) }
      .mapNotNull { (_, value) -> decodeAlarm(value as? String) }
      .sortedWith(compareBy(StoredAlarm::effectiveTriggerAtMillis, StoredAlarm::alarmId))
      .toList()
  }

  fun saveAlarm(alarm: StoredAlarm): Boolean = synchronized(STORE_LOCK) {
    preferences.edit()
      .putString(alarmKey(alarm.alarmId), encodeAlarm(alarm))
      .remove(tombstoneKey(alarm.alarmId))
      .commit()
  }

  fun replaceAlarmIfCurrent(
    alarm: StoredAlarm,
    expectedGeneration: Long,
    expectedEffectiveTriggerAtMillis: Long? = null
  ): Boolean = synchronized(STORE_LOCK) {
    val current = decodeAlarm(preferences.getString(alarmKey(alarm.alarmId), null))
      ?: return@synchronized false
    if (current.generation != expectedGeneration) return@synchronized false
    if (
      expectedEffectiveTriggerAtMillis != null &&
      current.effectiveTriggerAtMillis != expectedEffectiveTriggerAtMillis
    ) {
      return@synchronized false
    }

    preferences.edit()
      .putString(alarmKey(alarm.alarmId), encodeAlarm(alarm))
      .commit()
  }

  /**
   * Alarm removal and its tombstone are committed together. Even if the process
   * dies before AlarmManager.cancel(), an already-delivered PendingIntent is a
   * no-op because receivers validate this store first.
   */
  fun removeAndTombstone(
    alarmId: String,
    generation: Long,
    nowMillis: Long
  ): Boolean = synchronized(STORE_LOCK) {
    val existingTombstone = decodeTombstone(
      preferences.getString(tombstoneKey(alarmId), null)
    )
    val finalGeneration = maxOf(generation, existingTombstone?.generation ?: Long.MIN_VALUE)
    val tombstone = AlarmTombstone(alarmId, finalGeneration, nowMillis)

    preferences.edit()
      .remove(alarmKey(alarmId))
      .putString(tombstoneKey(alarmId), encodeTombstone(tombstone))
      .commit()
  }

  fun purgeAll(): PurgedDepartureAlarmState = synchronized(STORE_LOCK) {
    val alarmEntries = preferences.all
      .filterKeys { it.startsWith(ALARM_PREFIX) }
    val healthyAlarms = alarmEntries.values
      .mapNotNull { decodeAlarm(it as? String) }
    val hadStoredState = preferences.all.isNotEmpty()

    // This method is only used at the account privacy boundary. Keeping the old
    // account's tombstones would block the same generation when that account
    // logs in again and replays its snapshot.
    check(preferences.edit().clear().commit()) {
      "Failed to atomically purge departure alarm state."
    }
    PurgedDepartureAlarmState(healthyAlarms, hadStoredState)
  }

  fun pruneTombstones(nowMillis: Long): Boolean = synchronized(STORE_LOCK) {
    val editor = preferences.edit()
    var changed = false
    preferences.all.forEach { (key, value) ->
      if (!key.startsWith(TOMBSTONE_PREFIX)) return@forEach
      val tombstone = decodeTombstone(value as? String)
      if (
        tombstone == null ||
        nowMillis - tombstone.updatedAtMillis > AlarmContract.TOMBSTONE_RETENTION_MILLIS
      ) {
        editor.remove(key)
        changed = true
      }
    }
    !changed || editor.commit()
  }

  private fun encodeAlarm(alarm: StoredAlarm): String = JSONObject()
    .put("alarmId", alarm.alarmId)
    .put("scheduleId", alarm.scheduleId)
    .put("logicalAlarmId", alarm.logicalAlarmId)
    .put("occurrenceId", alarm.occurrenceId ?: JSONObject.NULL)
    .put("title", alarm.title ?: JSONObject.NULL)
    .put("body", alarm.body ?: JSONObject.NULL)
    .put("decision", alarm.decision ?: JSONObject.NULL)
    .put("minutesBeforeDeparture", alarm.minutesBeforeDeparture ?: JSONObject.NULL)
    .put("actionEventKey", alarm.actionEventKey ?: JSONObject.NULL)
    .put("generation", alarm.generation)
    .put("recipientMemberId", alarm.recipientMemberId ?: JSONObject.NULL)
    .put("logicalEventKey", alarm.logicalEventKey ?: JSONObject.NULL)
    .put("sourceTriggerAtMillis", alarm.sourceTriggerAtMillis)
    .put("effectiveTriggerAtMillis", alarm.effectiveTriggerAtMillis)
    .put("snoozeMinutes", alarm.snoozeMinutes)
    .put("state", alarm.state.name)
    .put("updatedAtMillis", alarm.updatedAtMillis)
    .toString()

  private fun decodeAlarm(raw: String?): StoredAlarm? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
      val json = JSONObject(raw)
      StoredAlarm(
        alarmId = json.getString("alarmId"),
        scheduleId = json.getString("scheduleId"),
        title = if (json.isNull("title")) {
          null
        } else {
          json.optString("title").takeIf { it.isNotBlank() }
        },
        generation = json.getLong("generation"),
        recipientMemberId = if (json.isNull("recipientMemberId")) {
          null
        } else {
          json.optLong("recipientMemberId").takeIf { it > 0 }
        },
        logicalEventKey = if (json.isNull("logicalEventKey")) {
          null
        } else {
          json.optString("logicalEventKey").takeIf { it.isNotBlank() }
        },
        sourceTriggerAtMillis = json.getLong("sourceTriggerAtMillis"),
        effectiveTriggerAtMillis = json.getLong("effectiveTriggerAtMillis"),
        snoozeMinutes = json.optInt("snoozeMinutes", 5).coerceIn(1, 60),
        state = StoredAlarmState.valueOf(json.getString("state")),
        updatedAtMillis = json.getLong("updatedAtMillis"),
        logicalAlarmId = json.optString("logicalAlarmId", json.getString("alarmId"))
          .takeIf { it.isNotBlank() } ?: json.getString("alarmId"),
        occurrenceId = nullableText(json, "occurrenceId"),
        body = nullableText(json, "body"),
        decision = nullableText(json, "decision"),
        minutesBeforeDeparture = if (json.isNull("minutesBeforeDeparture")) {
          null
        } else {
          json.optInt("minutesBeforeDeparture").takeIf { it in setOf(0, 5, 10, 15) }
        },
        actionEventKey = nullableText(json, "actionEventKey")
      )
    }.getOrNull()
  }

  private fun encodeTombstone(tombstone: AlarmTombstone): String = JSONObject()
    .put("alarmId", tombstone.alarmId)
    .put("generation", tombstone.generation)
    .put("updatedAtMillis", tombstone.updatedAtMillis)
    .toString()

  private fun decodeTombstone(raw: String?): AlarmTombstone? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
      val json = JSONObject(raw)
      AlarmTombstone(
        alarmId = json.getString("alarmId"),
        generation = json.getLong("generation"),
        updatedAtMillis = json.getLong("updatedAtMillis")
      )
    }.getOrNull()
  }

  private fun nullableText(json: JSONObject, key: String): String? =
    if (!json.has(key) || json.isNull(key)) null
    else json.optString(key).takeIf { it.isNotBlank() }

  private fun alarmKey(alarmId: String) = "$ALARM_PREFIX$alarmId"
  private fun tombstoneKey(alarmId: String) = "$TOMBSTONE_PREFIX$alarmId"

  private companion object {
    const val PREFERENCES_NAME = "nolate_departure_alarms_v1"
    const val ALARM_PREFIX = "alarm:"
    const val TOMBSTONE_PREFIX = "tombstone:"
    val STORE_LOCK = Any()
  }
}

internal data class PurgedDepartureAlarmState(
  val healthyAlarms: List<StoredAlarm>,
  val hadStoredState: Boolean
)
