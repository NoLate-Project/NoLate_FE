package expo.modules.nolatealarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmRecoveryPolicyTest {
  @Test
  fun onlyFutureAlarmsAreRescheduledDuringRecovery() {
    val now = 1_000_000L

    assertEquals(
      RecoveryDisposition.RESCHEDULE,
      AlarmRecoveryPolicy.disposition(now + 10_000, now)
    )
    assertEquals(
      RecoveryDisposition.EXPIRE,
      AlarmRecoveryPolicy.disposition(now - 1, now)
    )
    assertEquals(
      RecoveryDisposition.EXPIRE,
      AlarmRecoveryPolicy.disposition(now + 100, now)
    )
  }

  @Test
  fun receiverAcceptsOnlyDueAlarmsInsideGraceWindow() {
    val now = 1_000_000L

    assertTrue(AlarmRecoveryPolicy.mayFire(now, now))
    assertTrue(AlarmRecoveryPolicy.mayFire(now - MISSED_ALARM_GRACE_MILLIS, now))
    assertFalse(AlarmRecoveryPolicy.mayFire(now - MISSED_ALARM_GRACE_MILLIS - 1, now))
    assertFalse(AlarmRecoveryPolicy.mayFire(now + MINIMUM_FUTURE_TRIGGER_MILLIS + 1, now))
  }
}
