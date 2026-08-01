package expo.modules.nolatealarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AlarmParsingPolicyTest {
  @Test
  fun parsesUtcOffsetAndFractionalIsoTimestamps() {
    assertEquals(
      1_774_999_800_000L,
      parseIsoTriggerAtMillis("2026-04-01T08:30:00+09:00")
    )
    assertEquals(
      1_774_999_800_123L,
      parseIsoTriggerAtMillis("2026-03-31T23:30:00.123456789Z")
    )
  }

  @Test
  fun rejectsTimestampWithoutTimezoneAndInvalidCalendarDate() {
    assertThrows(IllegalArgumentException::class.java) {
      parseIsoTriggerAtMillis("2026-03-31T23:30:00")
    }
    assertThrows(IllegalArgumentException::class.java) {
      parseIsoTriggerAtMillis("2026-02-30T23:30:00Z")
    }
  }

  @Test
  fun validatesJavaScriptSafeIntegers() {
    assertEquals(42L, requireSafeJsInteger(42.0, "generation"))
    assertThrows(IllegalArgumentException::class.java) {
      requireSafeJsInteger(42.5, "generation")
    }
    assertThrows(IllegalArgumentException::class.java) {
      requireSafeJsInteger(MAX_SAFE_JS_INTEGER.toDouble() + 2.0, "generation")
    }
  }
}
