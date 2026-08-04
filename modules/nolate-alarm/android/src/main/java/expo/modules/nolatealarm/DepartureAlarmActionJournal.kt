package expo.modules.nolatealarm

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.util.UUID

/** Durable, device-protected evidence that the user explicitly chose "depart now". */
internal data class StoredDepartureActionEvent(
  val eventId: String,
  val alarmId: String,
  val scheduleId: String,
  val generation: Long,
  val recipientMemberId: Long,
  val occurrenceId: String?,
  val actionEventKey: String,
  val occurredAtMillis: Long,
  val requiresRouteNavigation: Boolean = false,
  val routeNavigationDelivered: Boolean = false
) {
  fun toBridgeMap(): Map<String, Any?> = buildMap {
    put("eventId", eventId)
    put("alarmId", alarmId)
    put("scheduleId", scheduleId)
    put("generation", generation.toDouble())
    put("recipientMemberId", recipientMemberId.toDouble())
    occurrenceId?.let { put("occurrenceId", it) }
    put("actionEventKey", actionEventKey)
    put("occurredAt", formatIsoInstant(occurredAtMillis))
    put("requiresRouteNavigation", requiresRouteNavigation)
    put("routeNavigationDelivered", routeNavigationDelivered)
  }
}

internal object DepartureActionEventPolicy {
  const val MAX_EVENTS = 100

  fun merge(
    existing: List<StoredDepartureActionEvent>,
    incoming: StoredDepartureActionEvent
  ): List<StoredDepartureActionEvent> {
    if (existing.any {
        it.recipientMemberId == incoming.recipientMemberId &&
          it.actionEventKey == incoming.actionEventKey
      }) {
      return existing
    }
    return (existing + incoming)
      .sortedWith(compareBy(
        StoredDepartureActionEvent::occurredAtMillis,
        StoredDepartureActionEvent::eventId
      ))
      .takeLast(MAX_EVENTS)
  }
}

internal class DepartureAlarmActionJournal(context: Context) {
  private val preferences: SharedPreferences = context.applicationContext
    .createDeviceProtectedStorageContext()
    .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  /** Must commit successfully before callers stop an alarm or acknowledge the user action. */
  fun record(alarm: StoredAlarm, occurredAtMillis: Long): Boolean {
    val recipientMemberId = alarm.recipientMemberId ?: return false
    val actionEventKey = alarm.actionEventKey
      ?: alarm.logicalEventKey?.takeIf(::isValidActionEventKey)
      ?: "event:${UUID.randomUUID()}"
    return record(
      StoredDepartureActionEvent(
        eventId = UUID.randomUUID().toString(),
        alarmId = alarm.logicalAlarmId,
        scheduleId = alarm.scheduleId,
        generation = alarm.generation,
        recipientMemberId = recipientMemberId,
        occurrenceId = alarm.occurrenceId,
        actionEventKey = actionEventKey,
        occurredAtMillis = occurredAtMillis,
        requiresRouteNavigation = false,
        routeNavigationDelivered = false
      )
    )
  }

  fun record(event: StoredDepartureActionEvent): Boolean = synchronized(JOURNAL_LOCK) {
    if (!isValid(event)) return@synchronized false
    writeAllUnlocked(DepartureActionEventPolicy.merge(readAllUnlocked(), event))
  }

  fun getAll(): List<StoredDepartureActionEvent> = synchronized(JOURNAL_LOCK) {
    readAllUnlocked()
  }

  fun markNavigationDelivered(eventId: String): Boolean = synchronized(JOURNAL_LOCK) {
    if (!isValidEventId(eventId)) return@synchronized false
    val current = readAllUnlocked()
    val existing = current.find { it.eventId == eventId } ?: return@synchronized false
    if (existing.routeNavigationDelivered) return@synchronized true
    writeAllUnlocked(current.map {
      if (it.eventId == eventId) it.copy(routeNavigationDelivered = true) else it
    })
  }

  fun remove(eventId: String): Boolean = synchronized(JOURNAL_LOCK) {
    if (!isValidEventId(eventId)) return@synchronized false
    val current = readAllUnlocked()
    if (current.none { it.eventId == eventId }) return@synchronized false
    writeAllUnlocked(current.filterNot { it.eventId == eventId })
  }

  fun clear(): Boolean = synchronized(JOURNAL_LOCK) {
    preferences.edit().clear().commit()
  }

  private fun readAllUnlocked(): List<StoredDepartureActionEvent> = preferences.all.values
    .mapNotNull { decode(it as? String) }
    .sortedWith(compareBy(
      StoredDepartureActionEvent::occurredAtMillis,
      StoredDepartureActionEvent::eventId
    ))
    .takeLast(DepartureActionEventPolicy.MAX_EVENTS)

  private fun writeAllUnlocked(events: List<StoredDepartureActionEvent>): Boolean {
    val editor = preferences.edit().clear()
    events.forEach { event -> editor.putString(event.eventId, encode(event)) }
    return editor.commit()
  }

  private fun encode(event: StoredDepartureActionEvent): String = JSONObject()
    .put("eventId", event.eventId)
    .put("alarmId", event.alarmId)
    .put("scheduleId", event.scheduleId)
    .put("generation", event.generation)
    .put("recipientMemberId", event.recipientMemberId)
    .put("occurrenceId", event.occurrenceId ?: JSONObject.NULL)
    .put("actionEventKey", event.actionEventKey)
    .put("occurredAtMillis", event.occurredAtMillis)
    .put("requiresRouteNavigation", event.requiresRouteNavigation)
    .put("routeNavigationDelivered", event.routeNavigationDelivered)
    .toString()

  private fun decode(raw: String?): StoredDepartureActionEvent? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
      val json = JSONObject(raw)
      StoredDepartureActionEvent(
        eventId = json.getString("eventId"),
        alarmId = json.getString("alarmId"),
        scheduleId = json.getString("scheduleId"),
        generation = json.getLong("generation"),
        recipientMemberId = json.getLong("recipientMemberId"),
        occurrenceId = if (!json.has("occurrenceId") || json.isNull("occurrenceId")) {
          null
        } else {
          json.optString("occurrenceId").takeIf { it.isNotBlank() }
        },
        actionEventKey = json.getString("actionEventKey"),
        occurredAtMillis = json.getLong("occurredAtMillis"),
        requiresRouteNavigation = json.optBoolean("requiresRouteNavigation", false),
        routeNavigationDelivered = json.optBoolean("routeNavigationDelivered", false)
      ).takeIf(::isValid)
    }.getOrNull()
  }

  private fun isValid(event: StoredDepartureActionEvent): Boolean =
    isValidEventId(event.eventId) &&
      event.alarmId.isNotBlank() && event.alarmId.length <= 200 &&
      event.scheduleId.matches(Regex("^[1-9]\\d*$")) && event.scheduleId.length <= 200 &&
      event.generation in 0..MAX_SAFE_JS_INTEGER &&
      event.recipientMemberId in 1..MAX_SAFE_JS_INTEGER &&
      (event.occurrenceId == null || event.occurrenceId in setOf("M15", "M10", "M5", "M0")) &&
      isValidActionEventKey(event.actionEventKey) &&
      event.occurredAtMillis in 0..MAX_SAFE_JS_INTEGER

  private fun isValidEventId(value: String): Boolean = value.isNotBlank() && value.length <= 200

  private companion object {
    const val PREFERENCES_NAME = "nolate_alarm_action_journal_v1"
    val JOURNAL_LOCK = Any()
  }
}

internal fun isValidActionEventKey(value: String): Boolean =
  Regex("^key:[a-f0-9]{64}$").matches(value) ||
    Regex("^event:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
      .matches(value)

/** Navigation intent is deliberately distinct from a depart action. */
internal data class StoredAlarmNavigationEvent(
  val eventId: String,
  val scheduleId: String,
  val recipientMemberId: Long,
  val occurredAtMillis: Long
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "eventId" to eventId,
    "scheduleId" to scheduleId,
    "recipientMemberId" to recipientMemberId.toDouble(),
    "occurredAt" to formatIsoInstant(occurredAtMillis)
  )
}

internal class DepartureAlarmNavigationJournal(context: Context) {
  private val preferences: SharedPreferences = context.applicationContext
    .createDeviceProtectedStorageContext()
    .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun record(alarm: StoredAlarm, occurredAtMillis: Long): Boolean = synchronized(JOURNAL_LOCK) {
    val recipientMemberId = alarm.recipientMemberId ?: return@synchronized false
    if (!alarm.scheduleId.matches(Regex("^[1-9]\\d*$"))) return@synchronized false
    val incoming = StoredAlarmNavigationEvent(
      eventId = UUID.randomUUID().toString(),
      scheduleId = alarm.scheduleId,
      recipientMemberId = recipientMemberId,
      occurredAtMillis = occurredAtMillis
    )
    val existing = readAllUnlocked()
    val merged = (existing + incoming)
      .sortedWith(compareBy(StoredAlarmNavigationEvent::occurredAtMillis, StoredAlarmNavigationEvent::eventId))
      .takeLast(MAX_EVENTS)
    writeAllUnlocked(merged)
  }

  fun getAll(): List<StoredAlarmNavigationEvent> = synchronized(JOURNAL_LOCK) {
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

  private fun readAllUnlocked(): List<StoredAlarmNavigationEvent> = preferences.all.values
    .mapNotNull { raw -> decode(raw as? String) }
    .sortedWith(compareBy(StoredAlarmNavigationEvent::occurredAtMillis, StoredAlarmNavigationEvent::eventId))
    .takeLast(MAX_EVENTS)

  private fun writeAllUnlocked(events: List<StoredAlarmNavigationEvent>): Boolean {
    val editor = preferences.edit().clear()
    events.forEach { event ->
      editor.putString(event.eventId, JSONObject()
        .put("eventId", event.eventId)
        .put("scheduleId", event.scheduleId)
        .put("recipientMemberId", event.recipientMemberId)
        .put("occurredAtMillis", event.occurredAtMillis)
        .toString())
    }
    return editor.commit()
  }

  private fun decode(raw: String?): StoredAlarmNavigationEvent? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
      val json = JSONObject(raw)
      StoredAlarmNavigationEvent(
        eventId = json.getString("eventId"),
        scheduleId = json.getString("scheduleId"),
        recipientMemberId = json.getLong("recipientMemberId"),
        occurredAtMillis = json.getLong("occurredAtMillis")
      ).takeIf {
        it.eventId.isNotBlank() && it.eventId.length <= 200 &&
          it.scheduleId.matches(Regex("^[1-9]\\d*$")) &&
          it.recipientMemberId in 1..MAX_SAFE_JS_INTEGER &&
          it.occurredAtMillis in 0..MAX_SAFE_JS_INTEGER
      }
    }.getOrNull()
  }

  private companion object {
    const val PREFERENCES_NAME = "nolate_alarm_navigation_journal_v1"
    const val MAX_EVENTS = 100
    val JOURNAL_LOCK = Any()
  }
}
