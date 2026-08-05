package expo.modules.nolatealarm

import android.content.Intent
import com.google.firebase.messaging.RemoteMessage
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService

/**
 * Owns only canonical Android departure reminders. RNFirebase's independent broadcast receiver
 * still delivers the message to JS, while this service uses the process-wide native claim as the
 * single presentation arbiter across foreground/background state transitions.
 */
class NoLateFirebaseMessagingService : ReactNativeFirebaseMessagingService() {
  /**
   * Firebase consumes background notification payloads before onMessageReceived. A sanitized
   * copy makes only departure reminders behave as data delivery in this binary, so older app
   * versions can continue receiving the server's backward-compatible notification payload.
   */
  override fun handleIntent(intent: Intent) {
    if (intent.extras?.getString("type") != DEPARTURE_REMINDER_PAYLOAD_TYPE) {
      super.handleIntent(intent)
      return
    }
    val recipientMemberId = canonicalDepartureReminderRecipientMemberId(
      intent.extras?.getString("recipientMemberId")
    )
    val sanitized = runCatching {
      Intent(intent).also { copy ->
        copy.extras?.keySet()
          ?.filter(::isFirebaseNotificationPresentationKey)
          ?.forEach(copy::removeExtra)
      }
    }.getOrNull()
    val sanitizedMessage = sanitized?.extras?.let { runCatching { RemoteMessage(it) }.getOrNull() }
    // Pinned FirebaseMessaging 25.0.2 currently recognizes both reserved prefixes above. Verify
    // that assumption at runtime before consuming the message id or suppressing legacy display.
    // An unsafe copy can use original auto-display only for an uninitialized or matching account;
    // invalid/old-account data is consumed without calling super to avoid leaking drawer content.
    if (sanitizedMessage == null || sanitizedMessage.notification != null) {
      val fallback = synchronized(DepartureReminderLifecycleLock.monitor) {
        DepartureReminderUnsafeSanitizationPolicy.decide(
          recipientValid = recipientMemberId != null,
          accountStatus = recipientMemberId?.let {
            runCatching { DepartureReminderAccountStore(this).statusFor(it) }.getOrNull()
          }
        )
      }
      if (fallback == DepartureReminderUnsafeSanitizationDecision.ORIGINAL) {
        super.handleIntent(intent)
      }
      return
    }

    if (recipientMemberId == null) {
      // An unbound target payload must never be displayed under whichever account happens to be
      // active. Consuming only the sanitized copy is the privacy-preserving failure mode.
      super.handleIntent(sanitized)
      return
    }
    val nowMillis = System.currentTimeMillis()
    val decision = synchronized(DepartureReminderLifecycleLock.monitor) {
      val accountStatus = DepartureReminderAccountStore(this).statusFor(recipientMemberId)
      val payload = DepartureReminderPayload.fromPushData(
        sanitizedMessage.data,
        sanitizedMessage.messageId,
        nowMillis
      )
      val expiresAt = sanitizedMessage.data["etaEventExpiresAt"]
        ?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
      val interception = DepartureReminderInterceptionPolicy.decide(
        sanitizationSucceeded = true,
        recipientValid = true,
        accountStatus = accountStatus,
        nativePayloadValid = payload != null,
        expirationFuture = expiresAt != null && expiresAt > nowMillis
      )
      if (interception != DepartureReminderInterceptionDecision.CUSTOM) {
        interception
      } else {
        // Keep the branch selected at handleIntent entry; a second foreground read can create a
        // gap between the independent RN receiver and service decisions.
        val result = DepartureReminderPresentationCoordinator(
          DurableDepartureReminderClaimStore(this),
          AndroidDepartureReminderPresenter(this)
        ).present(requireNotNull(payload), nowMillis)
        DepartureReminderInterceptionPolicy.afterPresentation(
          result,
          expirationFuture = payload.expiresAtMillis > System.currentTimeMillis()
        )
      }
    }
    super.handleIntent(
      if (decision == DepartureReminderInterceptionDecision.ORIGINAL) intent else sanitized
    )
  }

}
