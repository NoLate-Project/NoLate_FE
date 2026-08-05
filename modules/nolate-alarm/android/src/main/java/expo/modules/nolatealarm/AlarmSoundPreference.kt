package expo.modules.nolatealarm

import android.content.Context
import android.content.SharedPreferences

internal enum class NoLateAlarmSound(
  val bridgeValue: String,
  val rawResourceName: String
) {
  CHIME("CHIME", "nolate_departure_chime"),
  BELL("BELL", "nolate_alarm_bell"),
  BEEP("BEEP", "nolate_alarm_beep");

  companion object {
    val default: NoLateAlarmSound = CHIME

    fun fromBridgeValue(value: String?): NoLateAlarmSound? =
      entries.firstOrNull { it.bridgeValue == value }

    fun fromStoredValue(value: String?): NoLateAlarmSound =
      fromBridgeValue(value) ?: default
  }
}

internal interface AlarmSoundPreferenceStorage {
  fun read(): String?

  fun write(value: String): Boolean
}

/**
 * Keeps the alarm sound available to the exact-alarm service before the user unlocks the device.
 * React Native AsyncStorage is credential-protected and cannot be the source of truth here.
 */
private class DeviceProtectedAlarmSoundPreferenceStorage(
  context: Context
) : AlarmSoundPreferenceStorage {
  private val preferences: SharedPreferences = context.applicationContext
    .createDeviceProtectedStorageContext()
    .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  override fun read(): String? = preferences.getString(KEY_SOUND_ID, null)

  override fun write(value: String): Boolean = preferences.edit()
    .putString(KEY_SOUND_ID, value)
    .commit()

  private companion object {
    const val PREFERENCES_NAME = "nolate_alarm_sound_preference_v1"
    const val KEY_SOUND_ID = "sound_id"
  }
}

internal class AlarmSoundPreferenceStore(
  private val storage: AlarmSoundPreferenceStorage
) {
  constructor(context: Context) : this(
    DeviceProtectedAlarmSoundPreferenceStorage(context)
  )

  fun get(): NoLateAlarmSound = NoLateAlarmSound.fromStoredValue(
    runCatching(storage::read).getOrNull()
  )

  /** Rejects untrusted bridge values rather than silently persisting an unknown resource name. */
  fun set(soundId: String): Boolean {
    val sound = NoLateAlarmSound.fromBridgeValue(soundId) ?: return false
    return runCatching {
      storage.write(sound.bridgeValue)
    }.getOrDefault(false)
  }
}
