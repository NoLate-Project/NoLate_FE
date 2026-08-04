package expo.modules.nolatealarm

internal object AlarmContract {
  const val CHANNEL_ID = "departure-alarm-v1"
  const val FOREGROUND_NOTIFICATION_ID = 43_701

  const val ACTION_FIRE = "expo.modules.nolatealarm.action.FIRE"
  const val ACTION_SHOW = "expo.modules.nolatealarm.action.SHOW"
  const val ACTION_DISMISS = "expo.modules.nolatealarm.action.DISMISS"
  const val ACTION_SNOOZE = "expo.modules.nolatealarm.action.SNOOZE"
  const val ACTION_DEPART = "expo.modules.nolatealarm.action.DEPART"
  const val ACTION_OPEN_ROUTE = "expo.modules.nolatealarm.action.OPEN_ROUTE"
  const val ACTION_REMOVE_FROM_SERVICE = "expo.modules.nolatealarm.action.REMOVE_FROM_SERVICE"
  const val ACTION_STOP_ALL = "expo.modules.nolatealarm.action.STOP_ALL"

  const val EXTRA_ALARM_ID = "nolateAlarmId"
  const val EXTRA_SCHEDULE_ID = "nolateScheduleId"
  const val EXTRA_GENERATION = "nolateAlarmGeneration"
  const val EXTRA_TRIGGER_AT = "nolateAlarmTriggerAt"
  const val EXTRA_RECEIVER_OCCURRED_AT = "nolateAlarmReceiverOccurredAt"

  const val EXTRA_LAUNCHED_FROM_ALARM = "nolateLaunchedFromAlarm"

  const val URI_SCHEME = "nolate-alarm"
  const val URI_FIRE_AUTHORITY = "fire"
  const val URI_SHOW_AUTHORITY = "show"
  const val URI_ACTION_AUTHORITY = "action"

  const val MAX_RING_DURATION_MILLIS = 2 * 60 * 1000L
  const val TOMBSTONE_RETENTION_MILLIS = 90L * 24 * 60 * 60 * 1000
}
