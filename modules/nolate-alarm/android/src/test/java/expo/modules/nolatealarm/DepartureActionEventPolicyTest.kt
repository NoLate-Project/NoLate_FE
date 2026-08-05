package expo.modules.nolatealarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DepartureActionEventPolicyTest {
  @Test
  fun canonicalActionKeyDeduplicatesRepeatedUserDelivery() {
    val original = event("first", "a")
    val duplicate = original.copy(eventId = "second", occurredAtMillis = 2_000)

    assertEquals(listOf(original), DepartureActionEventPolicy.merge(listOf(original), duplicate))
  }

  @Test
  fun actionJournalIsBoundedAndNeverRequiresRouteNavigation() {
    var events = emptyList<StoredDepartureActionEvent>()
    for (index in 0..DepartureActionEventPolicy.MAX_EVENTS) {
      events = DepartureActionEventPolicy.merge(events, event("event-$index", index.toString()))
    }

    assertEquals(DepartureActionEventPolicy.MAX_EVENTS, events.size)
    assertFalse(events.any { it.eventId == "event-0" })
    assertTrue(events.all { !it.requiresRouteNavigation })
    assertTrue(events.all { it.alarmId == "schedule:41:member:7" })
  }

  @Test
  fun pushNavigationDeduplicatesOnlyTheSameMemberAndLogicalEvent() {
    val original = navigationEvent("first", 7, logicalEventKey)
    val duplicate = navigationEvent("second", 7, logicalEventKey)
    val processed = original.copy(delivered = true)
    val otherMember = navigationEvent("third", 8, logicalEventKey)
    val ordinaryAlarmTap = navigationEvent("ordinary", 7, null)

    assertTrue(AlarmNavigationEventPolicy.isDuplicate(listOf(original), duplicate))
    assertEquals(
      listOf(original),
      AlarmNavigationEventPolicy.merge(listOf(original), duplicate)
    )
    assertTrue(AlarmNavigationEventPolicy.isDuplicate(listOf(processed), duplicate))
    assertEquals(
      2,
      AlarmNavigationEventPolicy.merge(listOf(original), otherMember).size
    )
    assertEquals(
      2,
      AlarmNavigationEventPolicy.merge(listOf(ordinaryAlarmTap), ordinaryAlarmTap.copy(
        eventId = "ordinary-again"
      )).size
    )
  }

  private fun event(eventId: String, suffix: String) = StoredDepartureActionEvent(
    eventId = eventId,
    alarmId = "schedule:41:member:7",
    scheduleId = "41",
    generation = 8,
    recipientMemberId = 7,
    occurrenceId = "M0",
    actionEventKey = "key:${suffix.padEnd(64, 'a').take(64)}",
    occurredAtMillis = 1_000,
    requiresRouteNavigation = false,
    routeNavigationDelivered = false
  )

  private fun navigationEvent(
    eventId: String,
    memberId: Long,
    notificationLogicalEventKey: String?
  ) = StoredAlarmNavigationEvent(
    eventId = eventId,
    scheduleId = "41",
    recipientMemberId = memberId,
    occurredAtMillis = 1_000,
    notificationLogicalEventKey = notificationLogicalEventKey,
    providerMessageId = "provider-41"
  )

  private companion object {
    const val logicalEventKey = "event:00000000-0000-4000-8000-000000000041"
  }
}
