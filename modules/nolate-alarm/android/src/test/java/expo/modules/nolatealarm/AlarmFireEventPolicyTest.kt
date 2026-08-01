package expo.modules.nolatealarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmFireEventPolicyTest {
  @Test
  fun duplicateGenerationKeepsOriginalFireTimestampAndEventId() {
    val original = event("first", generation = 4, occurredAtMillis = 2_000)
    val replay = event("replay", generation = 4, occurredAtMillis = 3_000)

    assertEquals(listOf(original), AlarmFireEventPolicy.merge(listOf(original), replay))
  }

  @Test
  fun newerGenerationIsIndependentAndJournalIsBounded() {
    var journal = emptyList<StoredAlarmFireEvent>()
    for (generation in 0L..AlarmFireEventPolicy.MAX_EVENTS.toLong()) {
      journal = AlarmFireEventPolicy.merge(
        journal,
        event("event-$generation", generation, generation * 1_000)
      )
    }

    assertEquals(AlarmFireEventPolicy.MAX_EVENTS, journal.size)
    assertTrue(journal.none { it.generation == 0L })
    assertTrue(journal.any { it.generation == AlarmFireEventPolicy.MAX_EVENTS.toLong() })
  }

  @Test
  fun snoozedFireWithSameGenerationAndNewEffectiveTriggerIsIndependent() {
    val first = event("first", generation = 4, occurredAtMillis = 2_000)
    val snoozed = first.copy(
      eventId = "snoozed",
      scheduledForMillis = 302_000,
      occurredAtMillis = 302_100
    )

    assertEquals(listOf(first, snoozed), AlarmFireEventPolicy.merge(listOf(first), snoozed))
  }

  @Test
  fun androidReceiverEvidenceUsesExactCallbackTiming() {
    val evidence = event("exact", generation = 4, occurredAtMillis = 2_000)

    assertEquals(AlarmFireTimingBasis.EXACT_CALLBACK, evidence.timingBasis)
    assertEquals("EXACT_CALLBACK", evidence.toBridgeMap()["timingBasis"])
  }

  @Test
  fun exactCallbackPreservesReceiverBoundaryInsteadOfForegroundServiceStartup() {
    assertEquals(
      2_000L,
      AlarmFireEventPolicy.exactCallbackTimestamp(
        triggerAtMillis = 1_500L,
        receiverOccurredAtMillis = 2_000L,
        serviceAcceptedAtMillis = 7_000L
      )
    )
  }

  @Test
  fun missingOrImplausiblyDelayedReceiverTimestampIsNotLabelledExact() {
    assertEquals(
      null,
      AlarmFireEventPolicy.exactCallbackTimestamp(
        triggerAtMillis = 1_500L,
        receiverOccurredAtMillis = Long.MIN_VALUE,
        serviceAcceptedAtMillis = 7_000L
      )
    )
    assertEquals(
      null,
      AlarmFireEventPolicy.exactCallbackTimestamp(
        triggerAtMillis = 1_500L,
        receiverOccurredAtMillis = 2_000L,
        serviceAcceptedAtMillis = 2_000L + MISSED_ALARM_GRACE_MILLIS + 1L
      )
    )
  }

  private fun event(
    eventId: String,
    generation: Long,
    occurredAtMillis: Long
  ) = StoredAlarmFireEvent(
    eventId = eventId,
    alarmId = "schedule:41:member:7",
    scheduleId = "41",
    generation = generation,
    recipientMemberId = 7,
    scheduledForMillis = 1_500,
    sourceTriggerAtMillis = 1_000,
    occurredAtMillis = occurredAtMillis,
    logicalEventKey = "event:$generation"
  )
}
