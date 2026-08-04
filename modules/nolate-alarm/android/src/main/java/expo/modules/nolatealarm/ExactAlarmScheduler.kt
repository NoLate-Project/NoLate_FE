package expo.modules.nolatealarm

import android.app.AlarmManager
import android.content.Context
import android.os.Build

internal enum class ExactScheduleResult {
  SCHEDULED,
  PERMISSION_REQUIRED
}

internal class ExactAlarmScheduler(context: Context) {
  private val applicationContext = context.applicationContext
  private val alarmManager = applicationContext.getSystemService(AlarmManager::class.java)

  fun canScheduleExactAlarms(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()

  fun schedule(alarm: StoredAlarm): ExactScheduleResult {
    if (!canScheduleExactAlarms()) return ExactScheduleResult.PERMISSION_REQUIRED

    return try {
      val fireIntent = AlarmPendingIntents.fire(applicationContext, alarm)
      val showIntent = AlarmPendingIntents.show(applicationContext, alarm)
      val alarmClockInfo = AlarmManager.AlarmClockInfo(
        alarm.effectiveTriggerAtMillis,
        showIntent
      )
      alarmManager.setAlarmClock(alarmClockInfo, fireIntent)
      ExactScheduleResult.SCHEDULED
    } catch (_: SecurityException) {
      ExactScheduleResult.PERMISSION_REQUIRED
    }
  }

  fun cancel(alarm: StoredAlarm) {
    alarmManager.cancel(AlarmPendingIntents.fire(applicationContext, alarm))
  }
}
