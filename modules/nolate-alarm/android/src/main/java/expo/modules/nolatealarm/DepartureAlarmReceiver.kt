package expo.modules.nolatealarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class DepartureAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != AlarmContract.ACTION_FIRE) return
    // Capture the platform callback boundary before storage lookup, notification creation, or
    // foreground-service startup can add latency to the exact-fire evidence.
    val receiverOccurredAtMillis = System.currentTimeMillis()

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
    val nowMillis = receiverOccurredAtMillis

    AlarmNotificationFactory.ensureChannel(context)
    if (!AlarmCapabilityReader.read(context).notificationAuthorized) {
      // Without a visible high-importance notification Android can start alarm
      // audio with no dependable stop UI. Fail closed instead.
      coordinator.dismiss(alarmId, generation, nowMillis)
      return
    }

    if (!AlarmRecoveryPolicy.mayFire(triggerAtMillis, nowMillis)) {
      if (triggerAtMillis > nowMillis) {
        // A very early delivery is not allowed to ring. Re-run normal recovery,
        // which restores the future exact alarm without starting an FGS.
        coordinator.restoreAll(nowMillis)
      } else {
        coordinator.dismiss(alarmId, generation, nowMillis)
      }
      return
    }

    val firing = coordinator.markFiring(current, nowMillis) ?: return
    val serviceIntent = Intent(context, DepartureAlarmService::class.java)
      .setAction(AlarmContract.ACTION_FIRE)
      .putExtra(AlarmContract.EXTRA_ALARM_ID, firing.alarmId)
      .putExtra(AlarmContract.EXTRA_SCHEDULE_ID, firing.scheduleId)
      .putExtra(AlarmContract.EXTRA_GENERATION, firing.generation)
      .putExtra(AlarmContract.EXTRA_TRIGGER_AT, firing.effectiveTriggerAtMillis)
      .putExtra(AlarmContract.EXTRA_RECEIVER_OCCURRED_AT, receiverOccurredAtMillis)

    runCatching {
      ContextCompat.startForegroundService(context, serviceIntent)
    }.onFailure {
      // Never leave an alarm in FIRING state when Android rejected the service.
      coordinator.dismiss(firing.alarmId, firing.generation, nowMillis)
    }
  }
}
