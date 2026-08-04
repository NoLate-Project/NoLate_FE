package expo.modules.nolatealarm

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

internal enum class AlarmDeliveryMode(val bridgeValue: String) {
  ANDROID_EXACT("androidExact")
}

internal data class AlarmMutationResult(
  val applied: Boolean,
  val scheduled: Boolean,
  val reason: String? = null,
  val deliveryMode: AlarmDeliveryMode? = null
) {
  fun toBridgeMap(): Map<String, Any?> = buildMap {
    put("applied", applied)
    put("scheduled", scheduled)
    reason?.let { put("reason", it) }
    deliveryMode?.let { put("deliveryMode", it.bridgeValue) }
  }
}

internal class DepartureAlarmCoordinator(context: Context) {
  private val applicationContext = context.applicationContext
  private val store = DepartureAlarmStore(applicationContext)
  private val scheduler = ExactAlarmScheduler(applicationContext)

  fun upsert(
    alarmId: String,
    scheduleId: String,
    title: String?,
    generation: Long,
    recipientMemberId: Long?,
    logicalEventKey: String?,
    triggerAtMillis: Long,
    snoozeMinutes: Int,
    logicalAlarmId: String = alarmId,
    occurrenceId: String? = null,
    body: String? = null,
    decision: String? = null,
    minutesBeforeDeparture: Int? = null,
    actionEventKey: String? = null,
    nowMillis: Long = System.currentTimeMillis()
  ): AlarmMutationResult = synchronized(MUTATION_LOCK) {
    store.pruneTombstones(nowMillis)
    if (triggerAtMillis < nowMillis + MINIMUM_FUTURE_TRIGGER_MILLIS) {
      return@synchronized AlarmMutationResult(
        applied = false,
        scheduled = false,
        reason = "TRIGGER_NOT_IN_FUTURE"
      )
    }

    val current = store.getAlarm(alarmId)
    val disposition = AlarmGenerationPolicy.decideUpsert(
      current = current,
      tombstone = store.getTombstone(alarmId),
      incomingGeneration = generation,
      incomingScheduleId = scheduleId,
      incomingSourceTriggerAtMillis = triggerAtMillis,
      incomingTitle = title,
      incomingSnoozeMinutes = snoozeMinutes,
      incomingLogicalAlarmId = logicalAlarmId,
      incomingOccurrenceId = occurrenceId,
      incomingBody = body,
      incomingDecision = decision,
      incomingMinutesBeforeDeparture = minutesBeforeDeparture,
      incomingActionEventKey = actionEventKey
    )
    when (disposition) {
      UpsertDisposition.STALE -> {
        return@synchronized AlarmMutationResult(false, false, "STALE_GENERATION")
      }
      UpsertDisposition.CONFLICT -> {
        return@synchronized AlarmMutationResult(false, false, "GENERATION_CONFLICT")
      }
      UpsertDisposition.IDEMPOTENT -> {
        val existing = current ?: return@synchronized AlarmMutationResult(
          false,
          false,
          "MISSING_IDEMPOTENT_ALARM"
        )
        val enriched = if (existing.logicalEventKey == null && logicalEventKey != null) {
          existing.copy(
            recipientMemberId = recipientMemberId,
            logicalEventKey = logicalEventKey
          ).also {
            check(store.saveAlarm(it)) { "Failed to enrich departure alarm metadata." }
          }
        } else {
          existing
        }
        if (enriched.state != StoredAlarmState.FIRING) {
          return@synchronized schedulePersisted(enriched, nowMillis, applied = false)
        }
        return@synchronized AlarmMutationResult(
          applied = false,
          scheduled = true,
          reason = "ALREADY_APPLIED",
          deliveryMode = AlarmDeliveryMode.ANDROID_EXACT
        )
      }
      UpsertDisposition.APPLY -> Unit
    }

    // The previous PendingIntent identity includes its old generation/trigger.
    // Cancel it with the old record before replacing the persisted desired state.
    current?.let {
      scheduler.cancel(it)
      if (it.state == StoredAlarmState.FIRING) removeFromRingingService(it.alarmId)
    }
    val desired = StoredAlarm(
      alarmId = alarmId,
      scheduleId = scheduleId,
      title = title,
      generation = generation,
      recipientMemberId = recipientMemberId,
      logicalEventKey = logicalEventKey,
      sourceTriggerAtMillis = triggerAtMillis,
      effectiveTriggerAtMillis = triggerAtMillis,
      snoozeMinutes = snoozeMinutes.coerceIn(1, 60),
      state = StoredAlarmState.PENDING_PERMISSION,
      updatedAtMillis = nowMillis,
      logicalAlarmId = logicalAlarmId,
      occurrenceId = occurrenceId,
      body = body,
      decision = decision,
      minutesBeforeDeparture = minutesBeforeDeparture,
      actionEventKey = actionEventKey
    )
    check(store.saveAlarm(desired)) { "Failed to persist departure alarm." }
    schedulePersisted(desired, nowMillis, applied = true)
  }

  fun cancel(
    alarmId: String,
    generation: Long,
    nowMillis: Long = System.currentTimeMillis(),
    notifyRingingService: Boolean = true
  ): AlarmMutationResult = synchronized(MUTATION_LOCK) {
    store.pruneTombstones(nowMillis)
    val current = store.getAlarm(alarmId)
    val disposition = AlarmGenerationPolicy.decideCancel(
      current = current,
      tombstone = store.getTombstone(alarmId),
      incomingGeneration = generation
    )
    if (disposition == CancelDisposition.STALE) {
      return@synchronized AlarmMutationResult(false, false, "STALE_GENERATION")
    }

    check(store.removeAndTombstone(alarmId, generation, nowMillis)) {
      "Failed to persist alarm tombstone."
    }
    current?.let {
      scheduler.cancel(it)
      if (notifyRingingService && it.state == StoredAlarmState.FIRING) {
        removeFromRingingService(it.alarmId)
      }
    }
    AlarmMutationResult(
      applied = true,
      scheduled = false,
      deliveryMode = current?.let { AlarmDeliveryMode.ANDROID_EXACT }
    )
  }

  fun snooze(
    alarmId: String,
    generation: Long,
    nowMillis: Long = System.currentTimeMillis()
  ): AlarmMutationResult = synchronized(MUTATION_LOCK) {
    val current = store.getAlarm(alarmId)
      ?: return@synchronized AlarmMutationResult(false, false, "ALARM_NOT_FOUND")
    if (current.generation != generation) {
      return@synchronized AlarmMutationResult(false, false, "STALE_GENERATION")
    }

    val snoozed = current.copy(
      effectiveTriggerAtMillis =
        nowMillis + current.snoozeMinutes.coerceIn(1, 60) * 60_000L,
      state = StoredAlarmState.SNOOZED,
      updatedAtMillis = nowMillis
    )
    scheduler.cancel(current)
    if (current.state == StoredAlarmState.FIRING) {
      removeFromRingingService(current.alarmId)
    }
    check(store.saveAlarm(snoozed)) { "Failed to persist snoozed alarm." }
    schedulePersisted(snoozed, nowMillis, applied = true)
  }

  fun dismiss(
    alarmId: String,
    generation: Long,
    nowMillis: Long = System.currentTimeMillis()
  ): AlarmMutationResult = cancel(alarmId, generation, nowMillis)

  fun dismissAllFiring(nowMillis: Long = System.currentTimeMillis()): Boolean =
    synchronized(MUTATION_LOCK) {
      val firing = store.getAllAlarms().filter { it.state == StoredAlarmState.FIRING }
      firing.forEach { alarm ->
        check(store.removeAndTombstone(alarm.alarmId, alarm.generation, nowMillis)) {
          "Failed to persist ringing alarm tombstone."
        }
        scheduler.cancel(alarm)
      }
      firing.isNotEmpty()
    }

  fun clearAll(): Boolean =
    synchronized(MUTATION_LOCK) {
      // Purge the whole account-scoped module state in one commit before
      // touching AlarmManager. A receiver already in flight will fail its store
      // identity check, while a future login may replay the same generation.
      val purged = store.purgeAll()
      val fireJournal = DepartureAlarmFireJournal(applicationContext)
      val hadFireEvidence = fireJournal.getAll().isNotEmpty()
      check(fireJournal.clear()) {
        "Failed to purge alarm fire journal."
      }
      val actionJournal = DepartureAlarmActionJournal(applicationContext)
      val hadActionEvidence = actionJournal.getAll().isNotEmpty()
      check(actionJournal.clear()) {
        "Failed to purge alarm action journal."
      }
      val navigationJournal = DepartureAlarmNavigationJournal(applicationContext)
      val hadNavigationEvidence = navigationJournal.getAll().isNotEmpty()
      check(navigationJournal.clear()) {
        "Failed to purge alarm navigation journal."
      }
      purged.healthyAlarms.forEach(scheduler::cancel)
      val stoppedRingingService = applicationContext.stopService(
        android.content.Intent(applicationContext, DepartureAlarmService::class.java)
      )
      purged.hadStoredState || hadFireEvidence || hadActionEvidence ||
        hadNavigationEvidence || stoppedRingingService
    }

  fun findCurrentForIntent(
    alarmId: String,
    generation: Long,
    effectiveTriggerAtMillis: Long
  ): StoredAlarm? = synchronized(MUTATION_LOCK) {
    store.getAlarm(alarmId)?.takeIf {
      it.generation == generation &&
        it.effectiveTriggerAtMillis == effectiveTriggerAtMillis
    }
  }

  fun getScheduledAlarm(alarmId: String): StoredAlarm? = synchronized(MUTATION_LOCK) {
    store.getAlarm(alarmId)
  }

  fun markFiring(
    alarm: StoredAlarm,
    nowMillis: Long = System.currentTimeMillis()
  ): StoredAlarm? = synchronized(MUTATION_LOCK) {
    val firing = alarm.copy(
      state = StoredAlarmState.FIRING,
      updatedAtMillis = nowMillis
    )
    if (
      store.replaceAlarmIfCurrent(
        firing,
        expectedGeneration = alarm.generation,
        expectedEffectiveTriggerAtMillis = alarm.effectiveTriggerAtMillis
      )
    ) {
      firing
    } else {
      null
    }
  }

  fun recordFireIfCurrent(
    alarm: StoredAlarm,
    occurredAtMillis: Long
  ): Boolean = synchronized(MUTATION_LOCK) {
    val current = store.getAlarm(alarm.alarmId) ?: return@synchronized false
    if (
      current.generation != alarm.generation ||
      current.effectiveTriggerAtMillis != alarm.effectiveTriggerAtMillis ||
      current.state != StoredAlarmState.FIRING
    ) {
      return@synchronized false
    }
    DepartureAlarmFireJournal(applicationContext).record(current, occurredAtMillis)
  }

  fun restoreAll(nowMillis: Long = System.currentTimeMillis()): List<AlarmMutationResult> =
    synchronized(MUTATION_LOCK) {
      store.pruneTombstones(nowMillis)
      store.getAllAlarms().map { alarm ->
        scheduler.cancel(alarm)
        when (
          AlarmRecoveryPolicy.disposition(
            alarm.effectiveTriggerAtMillis,
            nowMillis
          )
        ) {
          RecoveryDisposition.EXPIRE -> {
            check(store.removeAndTombstone(alarm.alarmId, alarm.generation, nowMillis)) {
              "Failed to expire recovered alarm."
            }
            AlarmMutationResult(true, false, "MISSED_DURING_RECOVERY")
          }
          RecoveryDisposition.RESCHEDULE -> {
            schedulePersisted(
              alarm.copy(state = StoredAlarmState.PENDING_PERMISSION),
              nowMillis,
              applied = false
            )
          }
        }
      }
    }

  fun getScheduledAlarms(): List<Map<String, Any?>> = store.getAllAlarms().map { alarm ->
    buildMap {
      put("operation", "UPSERT")
      put("alarmId", alarm.logicalAlarmId)
      put("nativeAlarmId", alarm.alarmId)
      put("scheduleId", alarm.scheduleId)
      put("generation", alarm.generation.toDouble())
      alarm.recipientMemberId?.let { put("recipientMemberId", it.toDouble()) }
      alarm.logicalEventKey?.let { put("logicalEventKey", it) }
      put("triggerAt", formatIsoInstant(alarm.effectiveTriggerAtMillis))
      alarm.title?.let { put("title", it) }
      alarm.body?.let { put("body", it) }
      alarm.occurrenceId?.let { put("occurrenceId", it) }
      alarm.decision?.let { put("decision", it) }
      alarm.minutesBeforeDeparture?.let { put("minutesBeforeDeparture", it) }
      alarm.actionEventKey?.let { put("actionEventKey", it) }
      put("snoozeMinutes", alarm.snoozeMinutes)
    }
  }

  fun scheduleTestAlarm(
    delaySeconds: Int,
    nowMillis: Long = System.currentTimeMillis()
  ): AlarmMutationResult {
    val alarmId = "test:${UUID.randomUUID()}"
    return upsert(
      alarmId = alarmId,
      scheduleId = "test",
      title = "NoLate 테스트 알람",
      generation = nowMillis.coerceAtMost(MAX_SAFE_JS_INTEGER),
      recipientMemberId = null,
      logicalEventKey = null,
      triggerAtMillis = nowMillis + delaySeconds.coerceIn(3, 60) * 1_000L,
      snoozeMinutes = 5,
      nowMillis = nowMillis
    )
  }

  private fun schedulePersisted(
    alarm: StoredAlarm,
    nowMillis: Long,
    applied: Boolean
  ): AlarmMutationResult {
    AlarmNotificationFactory.ensureChannel(applicationContext)
    if (!AlarmCapabilityReader.read(applicationContext).notificationAuthorized) {
      val pending = alarm.copy(
        state = StoredAlarmState.PENDING_PERMISSION,
        updatedAtMillis = nowMillis
      )
      check(
        store.replaceAlarmIfCurrent(
          pending,
          expectedGeneration = alarm.generation,
          expectedEffectiveTriggerAtMillis = alarm.effectiveTriggerAtMillis
        )
      ) { "Alarm changed while notification authorization was checked." }
      return AlarmMutationResult(
        applied = applied,
        scheduled = false,
        reason = "NOTIFICATION_PERMISSION_REQUIRED",
        deliveryMode = AlarmDeliveryMode.ANDROID_EXACT
      )
    }

    val result = scheduler.schedule(alarm)
    val nextState = when (result) {
      ExactScheduleResult.SCHEDULED -> {
        if (alarm.state == StoredAlarmState.SNOOZED) {
          StoredAlarmState.SNOOZED
        } else {
          StoredAlarmState.SCHEDULED
        }
      }
      ExactScheduleResult.PERMISSION_REQUIRED -> StoredAlarmState.PENDING_PERMISSION
    }
    val persisted = alarm.copy(state = nextState, updatedAtMillis = nowMillis)
    check(
      store.replaceAlarmIfCurrent(
        persisted,
        expectedGeneration = alarm.generation,
        expectedEffectiveTriggerAtMillis = alarm.effectiveTriggerAtMillis
      )
    ) { "Alarm changed while it was being scheduled." }

    return when (result) {
      ExactScheduleResult.SCHEDULED -> AlarmMutationResult(
        applied = applied,
        scheduled = true,
        deliveryMode = AlarmDeliveryMode.ANDROID_EXACT
      )
      ExactScheduleResult.PERMISSION_REQUIRED -> AlarmMutationResult(
        applied = applied,
        scheduled = false,
        reason = "EXACT_ALARM_PERMISSION_REQUIRED",
        deliveryMode = AlarmDeliveryMode.ANDROID_EXACT
      )
    }
  }

  private fun removeFromRingingService(alarmId: String) {
    val intent = android.content.Intent(
      applicationContext,
      DepartureAlarmService::class.java
    )
      .setAction(AlarmContract.ACTION_REMOVE_FROM_SERVICE)
      .putExtra(AlarmContract.EXTRA_ALARM_ID, alarmId)
    runCatching { applicationContext.startService(intent) }
  }

  private fun formatIsoInstant(timestampMillis: Long): String =
    ISO_FORMATTER.get()!!.format(Date(timestampMillis))

  private companion object {
    val MUTATION_LOCK = Any()
    val ISO_FORMATTER = object : ThreadLocal<SimpleDateFormat>() {
      override fun initialValue(): SimpleDateFormat =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
          timeZone = TimeZone.getTimeZone("UTC")
          isLenient = false
        }
    }
  }
}
