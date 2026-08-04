package expo.modules.nolatealarm

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

internal object AlarmPendingIntents {
  private const val IMMUTABLE_UPDATE_FLAGS =
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  fun fire(context: Context, alarm: StoredAlarm): PendingIntent {
    val intent = baseIntent(
      context,
      DepartureAlarmReceiver::class.java,
      AlarmContract.ACTION_FIRE,
      AlarmContract.URI_FIRE_AUTHORITY,
      alarm
    )
    return PendingIntent.getBroadcast(context, 0, intent, IMMUTABLE_UPDATE_FLAGS)
  }

  fun show(context: Context, alarm: StoredAlarm): PendingIntent {
    val intent = baseIntent(
      context,
      DepartureAlarmActivity::class.java,
      AlarmContract.ACTION_SHOW,
      AlarmContract.URI_SHOW_AUTHORITY,
      alarm
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(context, 0, intent, IMMUTABLE_UPDATE_FLAGS)
  }

  fun openRoute(context: Context, alarm: StoredAlarm): PendingIntent = activityAction(
    context,
    AlarmContract.ACTION_OPEN_ROUTE,
    alarm
  )

  fun depart(context: Context, alarm: StoredAlarm): PendingIntent = activityAction(
    context,
    AlarmContract.ACTION_DEPART,
    alarm
  )

  fun action(context: Context, action: String, alarm: StoredAlarm): PendingIntent {
    val intent = baseIntent(
      context,
      AlarmActionReceiver::class.java,
      action,
      AlarmContract.URI_ACTION_AUTHORITY,
      alarm
    )
    return PendingIntent.getBroadcast(context, 0, intent, IMMUTABLE_UPDATE_FLAGS)
  }

  private fun activityAction(
    context: Context,
    action: String,
    alarm: StoredAlarm
  ): PendingIntent {
    val intent = baseIntent(
      context,
      DepartureAlarmActivity::class.java,
      action,
      AlarmContract.URI_ACTION_AUTHORITY,
      alarm
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(context, 0, intent, IMMUTABLE_UPDATE_FLAGS)
  }

  fun alarmUri(authority: String, action: String, alarm: StoredAlarm): Uri =
    Uri.Builder()
      .scheme(AlarmContract.URI_SCHEME)
      .authority(authority)
      .appendPath(action)
      .appendPath(alarm.alarmId)
      .appendPath(alarm.generation.toString())
      .appendPath(alarm.effectiveTriggerAtMillis.toString())
      .build()

  private fun <T> baseIntent(
    context: Context,
    componentClass: Class<T>,
    action: String,
    authority: String,
    alarm: StoredAlarm
  ): Intent = Intent(context, componentClass)
    .setAction(action)
    .setData(alarmUri(authority, action, alarm))
    .putExtra(AlarmContract.EXTRA_ALARM_ID, alarm.alarmId)
    .putExtra(AlarmContract.EXTRA_SCHEDULE_ID, alarm.scheduleId)
    .putExtra(AlarmContract.EXTRA_GENERATION, alarm.generation)
    .putExtra(AlarmContract.EXTRA_TRIGGER_AT, alarm.effectiveTriggerAtMillis)
}
