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
}
