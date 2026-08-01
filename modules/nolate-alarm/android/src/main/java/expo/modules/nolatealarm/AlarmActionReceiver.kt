package expo.modules.nolatealarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AlarmActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (
      action != AlarmContract.ACTION_DISMISS &&
      action != AlarmContract.ACTION_SNOOZE &&
      action != AlarmContract.ACTION_DEPART
    ) {
      return
    }

    val alarmId = intent.getStringExtra(AlarmContract.EXTRA_ALARM_ID) ?: return
    val generation = intent.getLongExtra(
      AlarmContract.EXTRA_GENERATION,
      Long.MIN_VALUE
    )
    val triggerAtMillis = intent.getLongExtra(
      AlarmContract.EXTRA_TRIGGER_AT,
      Long.MIN_VALUE
    )
    if (generation < 0 || triggerAtMillis < 0) return

    val coordinator = DepartureAlarmCoordinator(context)
    val current = coordinator.findCurrentForIntent(
      alarmId,
      generation,
      triggerAtMillis
    ) ?: return

    runCatching {
      when (action) {
        AlarmContract.ACTION_SNOOZE -> coordinator.snooze(
          current.alarmId,
          current.generation
        )
        AlarmContract.ACTION_DISMISS,
        AlarmContract.ACTION_DEPART -> coordinator.dismiss(
          current.alarmId,
          current.generation
        )
      }
    }
  }
}
