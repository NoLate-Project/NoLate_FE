package expo.modules.nolatealarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class AlarmMutationResultBridgeTest {
  @Test
  fun exposesActualNativeDeliveryModeWhenKnown() {
    val result = AlarmMutationResult(
      applied = false,
      scheduled = true,
      reason = "ALREADY_APPLIED",
      deliveryMode = AlarmDeliveryMode.ANDROID_EXACT
    ).toBridgeMap()

    assertEquals("androidExact", result["deliveryMode"])
  }

  @Test
  fun omitsDeliveryModeWhenMutationDidNotSelectOne() {
    val result = AlarmMutationResult(
      applied = false,
      scheduled = false,
      reason = "STALE_GENERATION"
    ).toBridgeMap()

    assertFalse(result.containsKey("deliveryMode"))
  }
}
