package expo.modules.nolatealarm

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmSoundPreferencePolicyTest {
  private val expectedSoundMappings = listOf(
    "CHIME" to "nolate_departure_chime",
    "BELL" to "nolate_alarm_bell",
    "BEEP" to "nolate_alarm_beep",
    "DIGITAL" to "nolate_alarm_digital",
    "CRYSTAL" to "nolate_alarm_crystal",
    "KNOCK" to "nolate_alarm_knock",
    "TRIPLE" to "nolate_alarm_triple",
    "SWEEP" to "nolate_alarm_sweep",
    "SIREN" to "nolate_alarm_siren",
    "KLAXON" to "nolate_alarm_klaxon"
  )

  @Test
  fun exposesOnlyThePinnedBridgeWhitelist() {
    assertEquals(
      expectedSoundMappings,
      NoLateAlarmSound.entries.map { it.bridgeValue to it.rawResourceName }
    )
    expectedSoundMappings.forEach { (bridgeValue, rawResourceName) ->
      val sound = NoLateAlarmSound.fromBridgeValue(bridgeValue)
      assertEquals(bridgeValue, sound?.bridgeValue)
      assertEquals(rawResourceName, sound?.rawResourceName)
    }
    assertEquals(
      expectedSoundMappings.size,
      NoLateAlarmSound.entries.map(NoLateAlarmSound::bridgeValue).toSet().size
    )
    assertEquals(
      expectedSoundMappings.size,
      NoLateAlarmSound.entries.map(NoLateAlarmSound::rawResourceName).toSet().size
    )
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
      expectedSoundMappings.map { it.second }.toSet(),
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
