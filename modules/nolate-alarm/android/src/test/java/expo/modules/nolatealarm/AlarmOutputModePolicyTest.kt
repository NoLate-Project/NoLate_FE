package expo.modules.nolatealarm

import android.media.AudioManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlarmOutputModePolicyTest {
  @Test
  fun soundModePlaysTheSelectedSoundAlongsideVibration() {
    assertTrue(AlarmOutputModePolicy.shouldPlaySound(AudioManager.RINGER_MODE_NORMAL))
  }

  @Test
  fun vibrateAndSilentModesLeaveOnlyTheAlarmVibration() {
    assertFalse(AlarmOutputModePolicy.shouldPlaySound(AudioManager.RINGER_MODE_VIBRATE))
    assertFalse(AlarmOutputModePolicy.shouldPlaySound(AudioManager.RINGER_MODE_SILENT))
  }
}
