package expo.modules.nolatealarm

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat

internal data class AlarmCapabilities(
  val exactAlarmAuthorized: Boolean,
  val fullScreenAuthorized: Boolean,
  val notificationAuthorized: Boolean
) {
  fun toBridgeMap(): Map<String, Any?> {
    val missing = buildList {
      if (!notificationAuthorized) add("NOTIFICATION_PERMISSION_REQUIRED")
      if (!exactAlarmAuthorized) add("EXACT_ALARM_PERMISSION_REQUIRED")
      if (!fullScreenAuthorized) add("FULL_SCREEN_PERMISSION_REQUIRED")
    }
    return buildMap {
      put("supported", true)
      put("platform", "android")
      put("exactAlarmAuthorized", exactAlarmAuthorized)
      put("fullScreenAuthorized", fullScreenAuthorized)
      put("notificationAuthorized", notificationAuthorized)
      missing.firstOrNull()?.let { put("reason", it) }
    }
  }
}

internal object AlarmCapabilityReader {
  fun read(context: Context): AlarmCapabilities {
    val notificationManager = context.getSystemService(NotificationManager::class.java)
    val exactAuthorized = ExactAlarmScheduler(context).canScheduleExactAlarms()
    val fullScreenAuthorized = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      notificationManager.canUseFullScreenIntent()
    } else {
      true
    }
    val runtimeNotificationAuthorized =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(
          context,
          Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    val appNotificationsEnabled =
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    val channelEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      notificationManager.getNotificationChannel(AlarmContract.CHANNEL_ID)
        ?.importance
        ?.let { it >= NotificationManager.IMPORTANCE_HIGH }
        ?: true
    } else {
      true
    }

    return AlarmCapabilities(
      exactAlarmAuthorized = exactAuthorized,
      fullScreenAuthorized = fullScreenAuthorized,
      notificationAuthorized =
        runtimeNotificationAuthorized && appNotificationsEnabled && channelEnabled
    )
  }

  fun openExactAlarmSettings(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
    return startSettingsIntent(
      context,
      Intent(
        Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
        Uri.parse("package:${context.packageName}")
      )
    )
  }

  fun openFullScreenSettings(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return false
    return startSettingsIntent(
      context,
      Intent(
        Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
        Uri.parse("package:${context.packageName}")
      )
    )
  }

  private fun startSettingsIntent(context: Context, intent: Intent): Boolean =
    runCatching {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }.getOrDefault(false)
}
