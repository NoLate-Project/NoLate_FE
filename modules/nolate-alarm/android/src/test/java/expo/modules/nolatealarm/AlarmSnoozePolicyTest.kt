package expo.modules.nolatealarm

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmSnoozePolicyTest {
  @Test
  fun legacySingleAlarmMaySnooze() {
    assertTrue(AlarmSnoozePolicy.isAvailable(alarm(occurrenceId = null)))
  }

  @Test
  fun advanceOccurrenceCannotCreateAnOverlappingLocalSnooze() {
    assertFalse(AlarmSnoozePolicy.isAvailable(alarm(occurrenceId = "M10")))
  }

  @Test
  fun terminalOccurrenceMaySnoozeAfterTheSequenceEnds() {
    assertTrue(AlarmSnoozePolicy.isAvailable(alarm(occurrenceId = "M0")))
  }

  private fun alarm(occurrenceId: String?) = StoredAlarm(
    alarmId = if (occurrenceId == null) {
      "schedule:41:member:7"
    } else {
      "schedule:41:member:7:occurrence:$occurrenceId"
    },
    scheduleId = "41",
    title = "출발 알림",
    generation = 8,
    recipientMemberId = 7,
    logicalEventKey = "event:41",
    sourceTriggerAtMillis = 1_000,
    effectiveTriggerAtMillis = 1_000,
    snoozeMinutes = 5,
    state = StoredAlarmState.FIRING,
    updatedAtMillis = 1_000,
    logicalAlarmId = "schedule:41:member:7",
    occurrenceId = occurrenceId
  )
}
