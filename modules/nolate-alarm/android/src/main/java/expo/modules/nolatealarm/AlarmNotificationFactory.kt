package expo.modules.nolatealarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

internal object AlarmNotificationFactory {
  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = context.getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      AlarmContract.CHANNEL_ID,
      context.getString(R.string.nolate_alarm_channel_name),
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = context.getString(R.string.nolate_alarm_channel_description)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setShowBadge(false)
      // The foreground service owns looping alarm audio and vibration. Keeping
      // the channel silent avoids the channel sound playing over the ringtone.
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
  }

  fun buildRingingNotification(context: Context, alarm: StoredAlarm): Notification {
    ensureChannel(context)
    val showIntent = AlarmPendingIntents.show(context, alarm)
    val openRouteIntent = AlarmPendingIntents.openRoute(context, alarm)
    val departIntent = AlarmPendingIntents.depart(context, alarm)
    val dismissIntent = AlarmPendingIntents.action(
      context,
      AlarmContract.ACTION_DISMISS,
      alarm
    )

    val builder = NotificationCompat.Builder(context, AlarmContract.CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_nolate_alarm)
      .setContentTitle(alarm.title ?: context.getString(R.string.nolate_alarm_title))
      .setContentText(alarm.body ?: context.getString(R.string.nolate_alarm_body))
      .setStyle(NotificationCompat.BigTextStyle().bigText(
        alarm.body ?: context.getString(R.string.nolate_alarm_body)
      ))
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setContentIntent(openRouteIntent)
      .setFullScreenIntent(showIntent, true)
      .setTimeoutAfter(AlarmContract.MAX_RING_DURATION_MILLIS)
      .addAction(
        R.drawable.ic_nolate_alarm,
        context.getString(R.string.nolate_alarm_depart),
        departIntent
      )

    if (AlarmSnoozePolicy.isAvailable(alarm)) {
      builder.addAction(
        R.drawable.ic_nolate_alarm,
        context.getString(R.string.nolate_alarm_notification_snooze),
        AlarmPendingIntents.action(context, AlarmContract.ACTION_SNOOZE, alarm)
      )
    }
    builder.addAction(
        R.drawable.ic_nolate_alarm,
        context.getString(R.string.nolate_alarm_notification_stop),
        dismissIntent
      )

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    }
    return builder.build()
  }
}
