package expo.modules.nolatealarm

import org.junit.Assert.assertEquals
import org.junit.Test

class AlarmGenerationPolicyTest {
  @Test
  fun newerGenerationReplacesCurrentAlarm() {
    assertEquals(
      UpsertDisposition.APPLY,
      AlarmGenerationPolicy.decideUpsert(
        current = alarm(generation = 4),
        tombstone = null,
        incomingGeneration = 5,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 5
      )
    )
  }

  @Test
  fun tombstoneBlocksLateAndEqualUpserts() {
    val tombstone = AlarmTombstone("alarm:10", 7, 1_000)

    assertEquals(
      UpsertDisposition.STALE,
      AlarmGenerationPolicy.decideUpsert(
        current = null,
        tombstone = tombstone,
        incomingGeneration = 6,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 5
      )
    )
    assertEquals(
      UpsertDisposition.STALE,
      AlarmGenerationPolicy.decideUpsert(
        current = null,
        tombstone = tombstone,
        incomingGeneration = 7,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 5
      )
    )
    assertEquals(
      UpsertDisposition.APPLY,
      AlarmGenerationPolicy.decideUpsert(
        current = null,
        tombstone = tombstone,
        incomingGeneration = 8,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 5
      )
    )
  }

  @Test
  fun equalGenerationDoesNotUndoLocalSnooze() {
    val snoozed = alarm(
      generation = 4,
      sourceTriggerAtMillis = 2_000,
      effectiveTriggerAtMillis = 302_000,
      state = StoredAlarmState.SNOOZED
    )

    assertEquals(
      UpsertDisposition.IDEMPOTENT,
      AlarmGenerationPolicy.decideUpsert(
        current = snoozed,
        tombstone = null,
        incomingGeneration = 4,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 5
      )
    )
  }

  @Test
  fun equalGenerationWithChangedIdentityIsConflict() {
    val current = alarm(generation = 4)

    assertEquals(
      UpsertDisposition.CONFLICT,
      AlarmGenerationPolicy.decideUpsert(
        current = current,
        tombstone = null,
        incomingGeneration = 4,
        incomingScheduleId = "11",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 5
      )
    )
    assertEquals(
      UpsertDisposition.CONFLICT,
      AlarmGenerationPolicy.decideUpsert(
        current = current,
        tombstone = null,
        incomingGeneration = 4,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 3_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 5
      )
    )
    assertEquals(
      UpsertDisposition.CONFLICT,
      AlarmGenerationPolicy.decideUpsert(
        current = current,
        tombstone = null,
        incomingGeneration = 4,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "변경된 회의",
        incomingSnoozeMinutes = 5
      )
    )
    assertEquals(
      UpsertDisposition.CONFLICT,
      AlarmGenerationPolicy.decideUpsert(
        current = current,
        tombstone = null,
        incomingGeneration = 4,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 10
      )
    )
  }

  @Test
  fun staleCancelCannotRemoveNewerState() {
    assertEquals(
      CancelDisposition.STALE,
      AlarmGenerationPolicy.decideCancel(
        current = alarm(generation = 9),
        tombstone = null,
        incomingGeneration = 8
      )
    )
    assertEquals(
      CancelDisposition.APPLY,
      AlarmGenerationPolicy.decideCancel(
        current = alarm(generation = 9),
        tombstone = null,
        incomingGeneration = 9
      )
    )
  }

  @Test
  fun equalGenerationRequiresCompleteV2OccurrenceIdentity() {
    val key = "key:${"a".repeat(64)}"
    val current = alarm(generation = 4).copy(
      alarmId = "schedule:10:member:7:occurrence:M0",
      logicalAlarmId = "schedule:10:member:7",
      occurrenceId = "M0",
      body = "지금 출발하세요.",
      decision = "DEPART_NOW",
      minutesBeforeDeparture = 0,
      actionEventKey = key
    )
    val matching = AlarmGenerationPolicy.decideUpsert(
      current = current,
      tombstone = null,
      incomingGeneration = 4,
      incomingScheduleId = "10",
      incomingSourceTriggerAtMillis = 2_000,
      incomingTitle = "회의",
      incomingSnoozeMinutes = 5,
      incomingLogicalAlarmId = "schedule:10:member:7",
      incomingOccurrenceId = "M0",
      incomingBody = "지금 출발하세요.",
      incomingDecision = "DEPART_NOW",
      incomingMinutesBeforeDeparture = 0,
      incomingActionEventKey = key
    )

    assertEquals(UpsertDisposition.IDEMPOTENT, matching)
    assertEquals(
      UpsertDisposition.CONFLICT,
      AlarmGenerationPolicy.decideUpsert(
        current = current,
        tombstone = null,
        incomingGeneration = 4,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 5,
        incomingLogicalAlarmId = "schedule:10:member:7",
        incomingOccurrenceId = "M0",
        incomingBody = "변경됨",
        incomingDecision = "DEPART_NOW",
        incomingMinutesBeforeDeparture = 0,
        incomingActionEventKey = key
      )
    )
  }

  @Test
  fun accountPurgeAllowsSameGenerationAfterRelogin() {
    assertEquals(
      UpsertDisposition.APPLY,
      AlarmGenerationPolicy.decideUpsert(
        current = null,
        tombstone = null,
        incomingGeneration = 4,
        incomingScheduleId = "10",
        incomingSourceTriggerAtMillis = 2_000,
        incomingTitle = "회의",
        incomingSnoozeMinutes = 5
      )
    )
  }

  private fun alarm(
    generation: Long,
    sourceTriggerAtMillis: Long = 2_000,
    effectiveTriggerAtMillis: Long = sourceTriggerAtMillis,
    state: StoredAlarmState = StoredAlarmState.SCHEDULED
  ) = StoredAlarm(
    alarmId = "alarm:10",
    scheduleId = "10",
    title = "회의",
    generation = generation,
    recipientMemberId = 7,
    logicalEventKey = "event:alarm-10",
    sourceTriggerAtMillis = sourceTriggerAtMillis,
    effectiveTriggerAtMillis = effectiveTriggerAtMillis,
    snoozeMinutes = 5,
    state = state,
    updatedAtMillis = 1_000
  )
}
