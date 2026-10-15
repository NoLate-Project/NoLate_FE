package expo.modules.nolatealarm

import android.media.AudioManager

/** Maps the device ringer switch to NoLate's alarm output contract. */
internal object AlarmOutputModePolicy {
  fun shouldPlaySound(ringerMode: Int): Boolean =
    ringerMode == AudioManager.RINGER_MODE_NORMAL
}
