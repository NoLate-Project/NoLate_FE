package expo.modules.nolatealarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant

internal const val DEPARTURE_REMINDER_PAYLOAD_TYPE = "SCHEDULE_DEPARTURE_REMINDER"
internal const val DEPARTURE_REMINDER_CHANNEL_ID = "schedule-push"
// expo-notifications 0.32.17 posts request.identifier with numeric id 0. Matching both tag and id
// lets the narrow foreground/background transition race replace one OS row instead of adding two.
internal const val DEPARTURE_REMINDER_NOTIFICATION_ID = 0
internal const val DEPARTURE_REMINDER_ACTION_OPEN_ROUTE =
  "expo.modules.nolatealarm.action.PUSH_OPEN_ROUTE"
internal const val DEPARTURE_REMINDER_ACTION_DEPART =
  "expo.modules.nolatealarm.action.PUSH_DEPART"

/** Serializes account fencing, claim mutation, OS presentation, interaction, and logout purge. */
internal object DepartureReminderLifecycleLock {
  val monitor = Any()
}

internal data class DepartureReminderPayload(
  val scheduleId: String,
  val recipientMemberId: Long,
  val logicalEventKey: String,
  val providerMessageId: String?,
  val title: String,
  val body: String,
  val providerTag: String,
  val notificationTag: String,
  val expiresAtMillis: Long
) {
  /** Fixed-length opaque journal identity; scheduleId itself may legally occupy 200 characters. */
  fun interactionAlarmId(): String = "push:$providerTag"

  fun toIntent(intent: Intent): Intent = intent
    .putExtra(EXTRA_SCHEDULE_ID, scheduleId)
    .putExtra(EXTRA_RECIPIENT_MEMBER_ID, recipientMemberId)
    .putExtra(EXTRA_LOGICAL_EVENT_KEY, logicalEventKey)
    .putExtra(EXTRA_PROVIDER_MESSAGE_ID, providerMessageId)
    .putExtra(EXTRA_NOTIFICATION_TITLE, title)
    .putExtra(EXTRA_NOTIFICATION_BODY, body)
    .putExtra(EXTRA_PROVIDER_TAG, providerTag)
    .putExtra(EXTRA_NOTIFICATION_TAG, notificationTag)
    .putExtra(EXTRA_EXPIRES_AT, expiresAtMillis)

  companion object {
    const val EXTRA_SCHEDULE_ID = "nolateReminderScheduleId"
    const val EXTRA_RECIPIENT_MEMBER_ID = "nolateReminderRecipientMemberId"
    const val EXTRA_LOGICAL_EVENT_KEY = "nolateReminderLogicalEventKey"
    const val EXTRA_PROVIDER_MESSAGE_ID = "nolateReminderProviderMessageId"
    const val EXTRA_NOTIFICATION_TITLE = "nolateReminderTitle"
    const val EXTRA_NOTIFICATION_BODY = "nolateReminderBody"
    const val EXTRA_PROVIDER_TAG = "nolateReminderProviderTag"
    const val EXTRA_NOTIFICATION_TAG = "nolateReminderNotificationTag"
    const val EXTRA_EXPIRES_AT = "nolateReminderExpiresAt"

    fun fromPushData(
      data: Map<String, String>,
      providerMessageId: String?,
      nowMillis: Long
    ): DepartureReminderPayload? {
      if (data["type"] != DEPARTURE_REMINDER_PAYLOAD_TYPE) return null
      val scheduleId = canonicalPositiveIdentifier(data["scheduleId"], 200) ?: return null
      val recipientText = canonicalPositiveIdentifier(data["recipientMemberId"], 16)
        ?: return null
      val recipientMemberId = recipientText.toLongOrNull()
        ?.takeIf { it in 1..MAX_SAFE_JS_INTEGER }
        ?: return null
      val logicalEventKey = data["logicalEventKey"]
        ?.takeIf(::isValidActionEventKey)
        ?: return null
      val title = exactVisibleText(data["nolateNotificationTitle"], 100) ?: return null
      val body = exactVisibleText(data["nolateNotificationBody"], 500) ?: return null
      val providerTag = data["nolateNotificationTag"]
        ?.takeIf {
          LOWER_SHA_256.matches(it) &&
            it == sha256Hex(logicalEventKey)
        }
        ?: return null
      val expiresAtMillis = data["etaEventExpiresAt"]
        ?.takeIf { it == it.trim() && it.length <= 64 }
        ?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        ?.takeIf { it > nowMillis && it in 0..MAX_SAFE_JS_INTEGER }
        ?: return null
      val normalizedProviderMessageId = providerMessageId
        ?.takeIf { it == it.trim() && it.length in 1..300 && !ASCII_CONTROL.containsMatchIn(it) }

      return DepartureReminderPayload(
        scheduleId = scheduleId,
        recipientMemberId = recipientMemberId,
        logicalEventKey = logicalEventKey,
        providerMessageId = normalizedProviderMessageId,
        title = title,
        body = body,
        providerTag = providerTag,
        notificationTag = notificationTag(recipientMemberId, logicalEventKey),
        expiresAtMillis = expiresAtMillis
      )
    }

    fun fromInteractionIntent(intent: Intent?): DepartureReminderPayload? {
      intent ?: return null
      val scheduleId = canonicalPositiveIdentifier(
        intent.getStringExtra(EXTRA_SCHEDULE_ID),
        200
      ) ?: return null
      val recipientMemberId = intent.getLongExtra(EXTRA_RECIPIENT_MEMBER_ID, -1L)
        .takeIf { it in 1..MAX_SAFE_JS_INTEGER }
        ?: return null
      val logicalEventKey = intent.getStringExtra(EXTRA_LOGICAL_EVENT_KEY)
        ?.takeIf(::isValidActionEventKey)
        ?: return null
      val title = exactVisibleText(intent.getStringExtra(EXTRA_NOTIFICATION_TITLE), 100)
        ?: return null
      val body = exactVisibleText(intent.getStringExtra(EXTRA_NOTIFICATION_BODY), 500)
        ?: return null
      val providerTag = intent.getStringExtra(EXTRA_PROVIDER_TAG)
        ?.takeIf {
          LOWER_SHA_256.matches(it) &&
            it == providerTag(logicalEventKey)
        }
        ?: return null
      val notificationTag = intent.getStringExtra(EXTRA_NOTIFICATION_TAG)
        ?.takeIf { it == notificationTag(recipientMemberId, logicalEventKey) }
        ?: return null
      val expiresAtMillis = intent.getLongExtra(EXTRA_EXPIRES_AT, -1L)
        .takeIf { it in 0..MAX_SAFE_JS_INTEGER }
        ?: return null
      val providerMessageId = intent.getStringExtra(EXTRA_PROVIDER_MESSAGE_ID)
        ?.takeIf { it.length in 1..300 && !ASCII_CONTROL.containsMatchIn(it) }
      return DepartureReminderPayload(
        scheduleId,
        recipientMemberId,
        logicalEventKey,
        providerMessageId,
        title,
        body,
        providerTag,
        notificationTag,
        expiresAtMillis
      )
    }

    fun notificationTag(recipientMemberId: Long, logicalEventKey: String): String {
      val canonical = "logical\u0000$recipientMemberId\u0000$logicalEventKey"
      return "nolate-visible-${sha256Hex(canonical)}"
    }

    fun providerTag(logicalEventKey: String): String = sha256Hex(logicalEventKey)

    private fun sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
      .digest(value.toByteArray(StandardCharsets.UTF_8))
      .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun canonicalPositiveIdentifier(value: String?, maximumLength: Int): String? = value
      ?.takeIf { it.length in 1..maximumLength && POSITIVE_IDENTIFIER.matches(it) }

    private fun exactVisibleText(value: String?, maximumLength: Int): String? = value
      ?.takeIf {
        it == it.trim() &&
          it.length in 1..maximumLength &&
          !ASCII_CONTROL.containsMatchIn(it)
      }

    private val POSITIVE_IDENTIFIER = Regex("^[1-9]\\d*$")
    private val LOWER_SHA_256 = Regex("^[0-9a-f]{64}$")
    private val ASCII_CONTROL = Regex("[\\u0000-\\u001f\\u007f]")
  }
}

internal class DepartureReminderAccountStore(context: Context) {
  private val preferences = context.applicationContext
    .createDeviceProtectedStorageContext()
    .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun activate(memberId: Long): Boolean = synchronized(DepartureReminderLifecycleLock.monitor) {
    if (memberId !in 1..MAX_SAFE_JS_INTEGER) return@synchronized false
    preferences.edit()
      .putString(ACCOUNT_STATE, ACTIVE)
      .putLong(ACTIVE_MEMBER_ID, memberId)
      .commit()
  }

  fun isActive(memberId: Long): Boolean = synchronized(DepartureReminderLifecycleLock.monitor) {
    statusFor(memberId) == DepartureReminderAccountStatus.ACTIVE_MATCH
  }

  fun statusFor(memberId: Long): DepartureReminderAccountStatus =
    synchronized(DepartureReminderLifecycleLock.monitor) {
    when (preferences.getString(ACCOUNT_STATE, null)) {
      null -> DepartureReminderAccountStatus.UNINITIALIZED
      INACTIVE -> DepartureReminderAccountStatus.INACTIVE
      ACTIVE -> if (preferences.getLong(ACTIVE_MEMBER_ID, -1L) == memberId) {
        DepartureReminderAccountStatus.ACTIVE_MATCH
      } else {
        DepartureReminderAccountStatus.ACTIVE_OTHER_ACCOUNT
      }
      else -> DepartureReminderAccountStatus.INACTIVE
    }
  }

  fun deactivate(): Boolean = synchronized(DepartureReminderLifecycleLock.monitor) {
    preferences.edit()
      .clear()
      .putString(ACCOUNT_STATE, INACTIVE)
      .commit()
  }

  private companion object {
    const val PREFERENCES_NAME = "nolate_departure_reminder_account_v1"
    const val ACCOUNT_STATE = "accountState"
    const val ACTIVE_MEMBER_ID = "activeMemberId"
    const val ACTIVE = "ACTIVE"
    const val INACTIVE = "INACTIVE"
  }
}

internal enum class DepartureReminderAccountStatus {
  UNINITIALIZED,
  INACTIVE,
  ACTIVE_MATCH,
  ACTIVE_OTHER_ACCOUNT
}

internal enum class DepartureReminderInterceptionDecision {
  ORIGINAL,
  SANITIZED,
  CUSTOM
}

internal enum class DepartureReminderUnsafeSanitizationDecision { ORIGINAL, CONSUME }

internal object DepartureReminderUnsafeSanitizationPolicy {
  fun decide(
    recipientValid: Boolean,
    accountStatus: DepartureReminderAccountStatus?
  ): DepartureReminderUnsafeSanitizationDecision =
    if (
      recipientValid &&
      (accountStatus == DepartureReminderAccountStatus.UNINITIALIZED ||
        accountStatus == DepartureReminderAccountStatus.ACTIVE_MATCH)
    ) {
      DepartureReminderUnsafeSanitizationDecision.ORIGINAL
    } else {
      DepartureReminderUnsafeSanitizationDecision.CONSUME
    }
}

internal object DepartureReminderInterceptionPolicy {
  fun decide(
    sanitizationSucceeded: Boolean,
    recipientValid: Boolean,
    accountStatus: DepartureReminderAccountStatus,
    nativePayloadValid: Boolean,
    expirationFuture: Boolean
  ): DepartureReminderInterceptionDecision = when {
    !sanitizationSucceeded -> DepartureReminderInterceptionDecision.ORIGINAL
    !recipientValid -> DepartureReminderInterceptionDecision.SANITIZED
    accountStatus == DepartureReminderAccountStatus.UNINITIALIZED ->
      DepartureReminderInterceptionDecision.ORIGINAL
    accountStatus != DepartureReminderAccountStatus.ACTIVE_MATCH ->
      DepartureReminderInterceptionDecision.SANITIZED
    nativePayloadValid -> DepartureReminderInterceptionDecision.CUSTOM
    expirationFuture -> DepartureReminderInterceptionDecision.ORIGINAL
    else -> DepartureReminderInterceptionDecision.SANITIZED
  }

  fun afterPresentation(
    result: DepartureReminderPresentationResult,
    expirationFuture: Boolean = true
  ): DepartureReminderInterceptionDecision =
    if (result == DepartureReminderPresentationResult.FAILED && expirationFuture) {
      DepartureReminderInterceptionDecision.ORIGINAL
    } else {
      DepartureReminderInterceptionDecision.SANITIZED
    }
}

internal fun isFirebaseNotificationPresentationKey(key: String): Boolean =
  key.startsWith("gcm.n.") || key.startsWith("gcm.notification.")

internal fun canonicalDepartureReminderRecipientMemberId(value: String?): Long? = value
  ?.takeIf { Regex("^[1-9]\\d*$").matches(it) }
  ?.toLongOrNull()
  ?.takeIf { it in 1..MAX_SAFE_JS_INTEGER }

internal fun remainingDepartureReminderLifetimeMillis(
  payload: DepartureReminderPayload,
  nowMillis: Long
): Long? = (payload.expiresAtMillis - nowMillis).takeIf { it > 0L }

internal enum class DepartureReminderClaimState { PENDING, COMMITTED }

internal data class DepartureReminderPresentationClaim(
  val notificationTag: String,
  val memberId: Long,
  val logicalEventKey: String,
  val providerMessageId: String?,
  val state: DepartureReminderClaimState,
  val updatedAtMillis: Long,
  val presentedAtMillis: Long?,
  val evidenceDelivered: Boolean
) {
  fun toBridgeMap(): Map<String, Any?> = buildMap {
    put("eventId", notificationTag)
    put("notificationTag", notificationTag)
    put("recipientMemberId", memberId.toDouble())
    put("logicalEventKey", logicalEventKey)
    providerMessageId?.let { put("providerMessageId", it) }
    presentedAtMillis?.let { put("occurredAt", formatIsoInstant(it)) }
  }
}

internal object DepartureReminderPresentationClaimPolicy {
  const val PENDING_LEASE_MILLIS = 60 * 1000L
  const val RETENTION_MILLIS = 7 * 24 * 60 * 60 * 1000L
  const val MAX_CLAIMS = 256

  fun retained(
    entries: List<DepartureReminderPresentationClaim>,
    nowMillis: Long
  ): List<DepartureReminderPresentationClaim> {
    val newest = linkedMapOf<String, DepartureReminderPresentationClaim>()
    entries.sortedWith(compareBy(
      DepartureReminderPresentationClaim::updatedAtMillis,
      DepartureReminderPresentationClaim::notificationTag
    )).forEach { entry ->
      val age = nowMillis - entry.updatedAtMillis
      if (age <= RETENTION_MILLIS || age < 0L) newest[entry.notificationTag] = entry
    }
    return newest.values.toList().takeLast(MAX_CLAIMS)
  }

  fun blocksPresentation(
    entry: DepartureReminderPresentationClaim?,
    nowMillis: Long
  ): Boolean = when (entry?.state) {
    DepartureReminderClaimState.COMMITTED -> true
    DepartureReminderClaimState.PENDING ->
      nowMillis - entry.updatedAtMillis < PENDING_LEASE_MILLIS
    null -> false
  }
}

internal sealed interface DepartureReminderClaimAcquisition {
  data class Acquired(val updatedAtMillis: Long) : DepartureReminderClaimAcquisition
  data object Duplicate : DepartureReminderClaimAcquisition
  data object StorageUnavailable : DepartureReminderClaimAcquisition
}

internal interface DepartureReminderClaimStore {
  fun acquire(
    payload: DepartureReminderPayload,
    nowMillis: Long
  ): DepartureReminderClaimAcquisition
  fun commit(payload: DepartureReminderPayload, acquiredAtMillis: Long, nowMillis: Long): Boolean
  fun rollback(payload: DepartureReminderPayload, acquiredAtMillis: Long): Boolean
}

internal class DurableDepartureReminderClaimStore(context: Context) : DepartureReminderClaimStore {
  private val preferences = context.applicationContext
    .createDeviceProtectedStorageContext()
    .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  override fun acquire(
    payload: DepartureReminderPayload,
    nowMillis: Long
  ): DepartureReminderClaimAcquisition = synchronized(DepartureReminderLifecycleLock.monitor) {
    runCatching {
      val retained = readAllUnlocked(nowMillis)
      val existing = retained.find { it.notificationTag == payload.notificationTag }
      if (DepartureReminderPresentationClaimPolicy.blocksPresentation(existing, nowMillis)) {
        return@synchronized DepartureReminderClaimAcquisition.Duplicate
      }
      val pending = DepartureReminderPresentationClaim(
        notificationTag = payload.notificationTag,
        memberId = payload.recipientMemberId,
        logicalEventKey = payload.logicalEventKey,
        providerMessageId = payload.providerMessageId,
        state = DepartureReminderClaimState.PENDING,
        updatedAtMillis = nowMillis,
        presentedAtMillis = null,
        evidenceDelivered = false
      )
      check(writeAllUnlocked(
        DepartureReminderPresentationClaimPolicy.retained(
          retained.filterNot { it.notificationTag == payload.notificationTag } + pending,
          nowMillis
        )
      ))
      DepartureReminderClaimAcquisition.Acquired(nowMillis)
    }.getOrElse { DepartureReminderClaimAcquisition.StorageUnavailable }
  }

  override fun commit(
    payload: DepartureReminderPayload,
    acquiredAtMillis: Long,
    nowMillis: Long
  ): Boolean = synchronized(DepartureReminderLifecycleLock.monitor) {
    runCatching {
      val entries = readAllUnlocked(nowMillis)
      val current = entries.find {
        it.notificationTag == payload.notificationTag &&
          it.state == DepartureReminderClaimState.PENDING &&
          it.updatedAtMillis == acquiredAtMillis
      } ?: return@synchronized false
      writeAllUnlocked(entries.map {
        if (it == current) it.copy(
          state = DepartureReminderClaimState.COMMITTED,
          updatedAtMillis = nowMillis,
          presentedAtMillis = nowMillis
        ) else it
      })
    }.getOrDefault(false)
  }

  override fun rollback(
    payload: DepartureReminderPayload,
    acquiredAtMillis: Long
  ): Boolean = synchronized(DepartureReminderLifecycleLock.monitor) {
    runCatching {
      val entries = readAllUnlocked(System.currentTimeMillis())
      writeAllUnlocked(entries.filterNot {
        it.notificationTag == payload.notificationTag &&
          it.state == DepartureReminderClaimState.PENDING &&
          it.updatedAtMillis == acquiredAtMillis
      })
    }.getOrDefault(false)
  }

  fun getUndeliveredEvidence(nowMillis: Long): List<DepartureReminderPresentationClaim> =
    synchronized(DepartureReminderLifecycleLock.monitor) {
      readAllUnlocked(nowMillis).filter {
        it.state == DepartureReminderClaimState.COMMITTED &&
          it.presentedAtMillis != null &&
          !it.evidenceDelivered
      }
    }

  fun getAll(nowMillis: Long): List<DepartureReminderPresentationClaim> =
    synchronized(DepartureReminderLifecycleLock.monitor) {
    readAllUnlocked(nowMillis)
  }

  fun markEvidenceDelivered(notificationTag: String): Boolean =
    synchronized(DepartureReminderLifecycleLock.monitor) {
    runCatching {
      val entries = readAllUnlocked(System.currentTimeMillis())
      val current = entries.find { it.notificationTag == notificationTag }
        ?: return@synchronized false
      if (current.evidenceDelivered) return@synchronized true
      writeAllUnlocked(entries.map {
        if (it == current) it.copy(evidenceDelivered = true) else it
      })
    }.getOrDefault(false)
  }

  fun clear(): Boolean = synchronized(DepartureReminderLifecycleLock.monitor) {
    preferences.edit().clear().commit()
  }

  private fun readAllUnlocked(nowMillis: Long): List<DepartureReminderPresentationClaim> =
    DepartureReminderPresentationClaimPolicy.retained(
      preferences.all.values.mapNotNull { decode(it as? String) },
      nowMillis
    )

  private fun writeAllUnlocked(entries: List<DepartureReminderPresentationClaim>): Boolean {
    val editor = preferences.edit().clear()
    entries.forEach { editor.putString(it.notificationTag, encode(it)) }
    return editor.commit()
  }

  private fun encode(entry: DepartureReminderPresentationClaim): String = JSONObject()
    .put("notificationTag", entry.notificationTag)
    .put("memberId", entry.memberId)
    .put("logicalEventKey", entry.logicalEventKey)
    .put("providerMessageId", entry.providerMessageId ?: JSONObject.NULL)
    .put("state", entry.state.name)
    .put("updatedAtMillis", entry.updatedAtMillis)
    .put("presentedAtMillis", entry.presentedAtMillis ?: JSONObject.NULL)
    .put("evidenceDelivered", entry.evidenceDelivered)
    .toString()

  private fun decode(raw: String?): DepartureReminderPresentationClaim? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
      val json = JSONObject(raw)
      val tag = json.getString("notificationTag")
      val memberId = json.getLong("memberId")
      val logicalEventKey = json.getString("logicalEventKey")
      val updatedAtMillis = json.getLong("updatedAtMillis")
      DepartureReminderPresentationClaim(
        notificationTag = tag,
        memberId = memberId,
        logicalEventKey = logicalEventKey,
        providerMessageId = if (json.isNull("providerMessageId")) null else {
          json.getString("providerMessageId")
        },
        state = DepartureReminderClaimState.valueOf(json.getString("state")),
        updatedAtMillis = updatedAtMillis,
        presentedAtMillis = if (json.isNull("presentedAtMillis")) null else {
          json.getLong("presentedAtMillis")
        },
        evidenceDelivered = json.optBoolean("evidenceDelivered", false)
      ).takeIf {
        tag == DepartureReminderPayload.notificationTag(memberId, logicalEventKey) &&
          memberId in 1..MAX_SAFE_JS_INTEGER &&
          isValidActionEventKey(logicalEventKey) &&
          updatedAtMillis in 0..MAX_SAFE_JS_INTEGER &&
          (it.providerMessageId == null || it.providerMessageId.length in 1..300) &&
          (it.presentedAtMillis == null || it.presentedAtMillis in 0..MAX_SAFE_JS_INTEGER)
      }
    }.getOrNull()
  }

  private companion object {
    const val PREFERENCES_NAME = "nolate_departure_reminder_claims_v1"
  }
}

internal enum class DepartureReminderPresentationResult {
  PRESENTED,
  DUPLICATE,
  FAILED
}

internal fun interface DepartureReminderPresenter {
  fun present(payload: DepartureReminderPayload): Boolean
}

internal class DepartureReminderPresentationCoordinator(
  private val claimStore: DepartureReminderClaimStore,
  private val presenter: DepartureReminderPresenter
) {
  fun present(
    payload: DepartureReminderPayload,
    nowMillis: Long
  ): DepartureReminderPresentationResult {
    val acquisition = claimStore.acquire(payload, nowMillis)
    if (acquisition == DepartureReminderClaimAcquisition.Duplicate) {
      return DepartureReminderPresentationResult.DUPLICATE
    }
    return try {
      if (!presenter.present(payload)) {
        if (acquisition is DepartureReminderClaimAcquisition.Acquired) {
          claimStore.rollback(payload, acquisition.updatedAtMillis)
        }
        DepartureReminderPresentationResult.FAILED
      } else {
        if (acquisition is DepartureReminderClaimAcquisition.Acquired) {
          // NotificationManager accepted the request. A failed commit intentionally leaves a
          // bounded PENDING lease; replay uses the same tag after the lease rather than silently
          // suppressing the reminder forever.
          claimStore.commit(payload, acquisition.updatedAtMillis, nowMillis)
        }
        DepartureReminderPresentationResult.PRESENTED
      }
    } catch (_: Throwable) {
      if (acquisition is DepartureReminderClaimAcquisition.Acquired) {
        claimStore.rollback(payload, acquisition.updatedAtMillis)
      }
      DepartureReminderPresentationResult.FAILED
    }
  }
}

internal class AndroidDepartureReminderPresenter(private val context: Context) :
  DepartureReminderPresenter {
  override fun present(payload: DepartureReminderPayload): Boolean {
    val remainingMillis = remainingDepartureReminderLifetimeMillis(
      payload,
      System.currentTimeMillis()
    ) ?: return false
    val manager = context.getSystemService(NotificationManager::class.java) ?: return false
    ensureChannel(manager)
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      manager.getNotificationChannel(DEPARTURE_REMINDER_CHANNEL_ID)?.importance ==
        NotificationManager.IMPORTANCE_NONE
    ) return false
    manager.notify(
      payload.notificationTag,
      DEPARTURE_REMINDER_NOTIFICATION_ID,
      NotificationCompat.Builder(context, DEPARTURE_REMINDER_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_nolate_alarm)
        .setContentTitle(payload.title)
        .setContentText(payload.body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(payload.body))
        .setCategory(NotificationCompat.CATEGORY_REMINDER)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
        .setVibrate(longArrayOf(0L, 250L, 250L, 250L))
        .setAutoCancel(false)
        .setOnlyAlertOnce(true)
        // The route/action is meaningful only inside the server-signed ETA event window. Android
        // removes the posted row at the same boundary even when the user never interacts with it.
        .setTimeoutAfter(remainingMillis)
        .setContentIntent(interactionIntent(payload, DEPARTURE_REMINDER_ACTION_OPEN_ROUTE))
        .addAction(
          R.drawable.ic_nolate_alarm,
          context.getString(R.string.nolate_alarm_depart),
          interactionIntent(payload, DEPARTURE_REMINDER_ACTION_DEPART)
        )
        .build()
    )
    return true
  }

  private fun ensureChannel(manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    manager.createNotificationChannel(NotificationChannel(
      DEPARTURE_REMINDER_CHANNEL_ID,
      context.getString(R.string.nolate_schedule_push_channel_name),
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = context.getString(R.string.nolate_schedule_push_channel_description)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
      enableVibration(true)
      vibrationPattern = longArrayOf(0L, 250L, 250L, 250L)
      setSound(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
        android.media.AudioAttributes.Builder()
          .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_EVENT)
          .build()
      )
    })
  }

  private fun interactionIntent(
    payload: DepartureReminderPayload,
    action: String
  ): PendingIntent {
    val uri = Uri.Builder()
      .scheme("nolate-reminder")
      .authority(if (action == DEPARTURE_REMINDER_ACTION_DEPART) "depart" else "route")
      .appendPath(payload.notificationTag)
      .build()
    val intent = payload.toIntent(
      Intent(context, DepartureReminderInteractionActivity::class.java)
        .setAction(action)
        .setData(uri)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    )
    return PendingIntent.getActivity(
      context,
      if (action == DEPARTURE_REMINDER_ACTION_DEPART) 1 else 0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

}
