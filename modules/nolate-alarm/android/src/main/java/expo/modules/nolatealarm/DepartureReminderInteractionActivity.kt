package expo.modules.nolatealarm

import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import java.util.UUID

/** Direct notification PendingIntent target; avoids Android 12+ notification trampolines. */
class DepartureReminderInteractionActivity : Activity() {
  private enum class CommitResult { COMMITTED, EXPIRED, REJECTED, FAILED }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handle(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handle(intent)
  }

  private fun handle(source: Intent?) {
    val payload = DepartureReminderPayload.fromInteractionIntent(source)
      ?: return finish()
    val result = synchronized(DepartureReminderLifecycleLock.monitor) {
      val manager = getSystemService(NotificationManager::class.java)
      if (remainingDepartureReminderLifetimeMillis(payload, System.currentTimeMillis()) == null) {
        manager?.cancel(payload.notificationTag, DEPARTURE_REMINDER_NOTIFICATION_ID)
        return@synchronized CommitResult.EXPIRED
      }
      if (!DepartureReminderAccountStore(this).isActive(payload.recipientMemberId)) {
        return@synchronized CommitResult.REJECTED
      }
      val recorded = when (source?.action) {
        DEPARTURE_REMINDER_ACTION_DEPART -> DepartureAlarmActionJournal(this).record(
          StoredDepartureActionEvent(
            eventId = UUID.randomUUID().toString(),
            alarmId = payload.interactionAlarmId(),
            scheduleId = payload.scheduleId,
            generation = 0L,
            recipientMemberId = payload.recipientMemberId,
            occurrenceId = null,
            actionEventKey = payload.logicalEventKey,
            occurredAtMillis = System.currentTimeMillis(),
            requiresRouteNavigation = false,
            routeNavigationDelivered = false,
            notificationLogicalEventKey = payload.logicalEventKey,
            providerMessageId = payload.providerMessageId
          )
        )
        DEPARTURE_REMINDER_ACTION_OPEN_ROUTE -> DepartureAlarmNavigationJournal(this).record(
          scheduleId = payload.scheduleId,
          recipientMemberId = payload.recipientMemberId,
          occurredAtMillis = System.currentTimeMillis(),
          notificationLogicalEventKey = payload.logicalEventKey,
          providerMessageId = payload.providerMessageId
        )
        else -> false
      }
      if (!recorded) return@synchronized CommitResult.FAILED
      // Cancellation belongs to the same linearized account lifecycle transaction as the
      // account check and durable journal commit. Logout can only run wholly before or after it.
      manager?.cancel(payload.notificationTag, DEPARTURE_REMINDER_NOTIFICATION_ID)
      CommitResult.COMMITTED
    }
    if (result == CommitResult.EXPIRED || result == CommitResult.REJECTED) {
      finish()
      return
    }
    if (result == CommitResult.FAILED) {
      Toast.makeText(
        this,
        if (source?.action == DEPARTURE_REMINDER_ACTION_DEPART) {
          R.string.nolate_alarm_action_retry
        } else {
          R.string.nolate_alarm_navigation_retry
        },
        Toast.LENGTH_LONG
      ).show()
      // The notification remains posted so the explicit interaction can be retried.
      finish()
      return
    }
    launchMainApp()
    finish()
  }

  private fun launchMainApp() {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launchIntent
      .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(AlarmContract.EXTRA_LAUNCHED_FROM_ALARM, true)
    runCatching { startActivity(launchIntent) }
  }
}
