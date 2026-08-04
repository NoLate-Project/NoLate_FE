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
        AlarmContract.ACTION_SNOOZE -> if (AlarmSnoozePolicy.isAvailable(current)) {
          coordinator.snooze(current.alarmId, current.generation)
        } else {
          // A stale v2 PendingIntent from an older binary must not create a fifth alarm that can
          // overlap the already-scheduled reminder sequence. Treat it as dismissing this slot.
          coordinator.dismiss(current.alarmId, current.generation)
        }
        AlarmContract.ACTION_DISMISS -> coordinator.dismiss(
          current.alarmId,
          current.generation
        )
        AlarmContract.ACTION_DEPART -> {
          // Legacy PendingIntents from a previous binary can still reach this receiver. Preserve
          // the action durably before stopping the alarm; receivers never force app navigation.
          if (!DepartureAlarmActionJournal(context).record(current, System.currentTimeMillis())) {
            return@runCatching
          }
          coordinator.dismiss(current.alarmId, current.generation)
        }
      }
    }
  }
}
