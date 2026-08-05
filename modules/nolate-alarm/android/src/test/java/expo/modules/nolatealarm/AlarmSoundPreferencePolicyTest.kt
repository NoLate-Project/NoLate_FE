package expo.modules.nolatealarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmSoundPreferencePolicyTest {
  @Test
  fun exposesOnlyThePinnedBridgeWhitelist() {
    assertEquals(
      listOf("CHIME", "BELL", "BEEP"),
      NoLateAlarmSound.entries.map(NoLateAlarmSound::bridgeValue)
    )
    assertEquals(NoLateAlarmSound.CHIME, NoLateAlarmSound.fromBridgeValue("CHIME"))
    assertEquals(NoLateAlarmSound.BELL, NoLateAlarmSound.fromBridgeValue("BELL"))
    assertEquals(NoLateAlarmSound.BEEP, NoLateAlarmSound.fromBridgeValue("BEEP"))
    assertNull(NoLateAlarmSound.fromBridgeValue("SYSTEM"))
    assertNull(NoLateAlarmSound.fromBridgeValue(" bell "))
  }

  @Test
  fun missingAndCorruptStoredValuesFallBackToChime() {
    assertEquals(NoLateAlarmSound.CHIME, store(null).get())
    assertEquals(NoLateAlarmSound.CHIME, store("removed-sound").get())
    assertEquals(NoLateAlarmSound.BELL, store("BELL").get())
  }

  @Test
  fun rejectsUnknownBridgeValuesWithoutOverwritingTheLastGoodChoice() {
    val storage = MemoryAlarmSoundPreferenceStorage("BEEP")
    val store = AlarmSoundPreferenceStore(storage)

    assertFalse(store.set("../../custom"))
    assertEquals("BEEP", storage.value)
    assertEquals(0, storage.writeCount)
  }

  @Test
  fun reportsDurableCommitFailureToTheBridge() {
    val storage = MemoryAlarmSoundPreferenceStorage("CHIME", writeSucceeds = false)
    val store = AlarmSoundPreferenceStore(storage)

    assertFalse(store.set("BELL"))
    assertEquals("CHIME", storage.value)
    assertEquals(1, storage.writeCount)
  }

  @Test
  fun storageExceptionsFailClosedToChimeAndFalse() {
    val store = AlarmSoundPreferenceStore(ThrowingAlarmSoundPreferenceStorage)

    assertEquals(NoLateAlarmSound.CHIME, store.get())
    assertFalse(store.set("BELL"))
  }

  @Test
  fun persistsEverySupportedChoiceAndMapsItToADistinctRawResource() {
    val storage = MemoryAlarmSoundPreferenceStorage(null)
    val store = AlarmSoundPreferenceStore(storage)

    NoLateAlarmSound.entries.forEach { sound ->
      assertTrue(store.set(sound.bridgeValue))
      assertEquals(sound, store.get())
    }
    assertEquals(
      setOf(
        "nolate_departure_chime",
        "nolate_alarm_bell",
        "nolate_alarm_beep"
      ),
      NoLateAlarmSound.entries.map(NoLateAlarmSound::rawResourceName).toSet()
    )
  }

  private fun store(value: String?): AlarmSoundPreferenceStore =
    AlarmSoundPreferenceStore(MemoryAlarmSoundPreferenceStorage(value))
}

private class MemoryAlarmSoundPreferenceStorage(
  initialValue: String?,
  private val writeSucceeds: Boolean = true
) : AlarmSoundPreferenceStorage {
  var value: String? = initialValue
    private set
  var writeCount: Int = 0
    private set

  override fun read(): String? = value

  override fun write(value: String): Boolean {
    writeCount += 1
    if (writeSucceeds) this.value = value
    return writeSucceeds
  }
}

private object ThrowingAlarmSoundPreferenceStorage : AlarmSoundPreferenceStorage {
  override fun read(): String? = error("corrupt preferences")

  override fun write(value: String): Boolean = error("storage unavailable")
}
