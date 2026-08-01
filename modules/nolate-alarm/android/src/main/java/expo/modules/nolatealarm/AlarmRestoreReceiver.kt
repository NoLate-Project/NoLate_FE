package expo.modules.nolatealarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.concurrent.Executors

class AlarmRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action !in RECOVERY_ACTIONS) return

    val pendingResult = goAsync()
    RECOVERY_EXECUTOR.execute {
      try {
        // Android 15+ forbids starting a mediaPlayback FGS directly from a
        // boot receiver. restoreAll only re-registers future AlarmManager
        // entries and expires past entries; it never starts the service.
        AlarmNotificationFactory.ensureChannel(context)
        DepartureAlarmCoordinator(context).restoreAll()
      } finally {
        pendingResult.finish()
      }
    }
  }

  private companion object {
    val RECOVERY_ACTIONS = setOf(
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_LOCKED_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED,
      ACTION_EXACT_ALARM_PERMISSION_CHANGED
    )
    const val ACTION_EXACT_ALARM_PERMISSION_CHANGED =
      "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
    val RECOVERY_EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "nolate-alarm-recovery").apply {
        isDaemon = true
      }
    }
  }
}
