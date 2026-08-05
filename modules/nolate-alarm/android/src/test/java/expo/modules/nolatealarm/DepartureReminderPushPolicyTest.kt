package expo.modules.nolatealarm

import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DepartureReminderPushPolicyTest {
  private val now = Instant.parse("2026-08-04T03:00:00Z").toEpochMilli()
  private val logicalEventKey = "event:00000000-0000-4000-8000-000000000041"

  @Test
  fun canonicalPayloadParsesAndSharesTheForegroundOsIdentity() {
    val parsed = DepartureReminderPayload.fromPushData(validData(), "provider-41", now)

    assertNotNull(parsed)
    assertEquals("서울역 → 광화문 · 지하철 25분", parsed?.body)
    assertEquals(
      "nolate-visible-2acdfc359c4b5e858c2bb6ace6752543773e60244ffd5c759c272f3495a7fa80",
      parsed?.notificationTag
    )
    assertEquals(DepartureReminderPayload.providerTag(logicalEventKey), parsed?.providerTag)
    assertEquals(0, DEPARTURE_REMINDER_NOTIFICATION_ID)
  }

  @Test
  fun malformedIdentityContentTagAndExpirationFailClosed() {
    val invalid = listOf(
      validData() + ("scheduleId" to "01"),
      validData() + ("recipientMemberId" to "7 "),
      validData() + ("logicalEventKey" to "event:not-canonical"),
      validData() + ("nolateNotificationTitle" to " 출발 안내"),
      validData() + ("nolateNotificationBody" to "경로\n상세"),
      validData() + ("nolateNotificationTag" to "a".repeat(64)),
      validData() + ("etaEventExpiresAt" to Instant.ofEpochMilli(now).toString()),
      validData() + ("etaEventExpiresAt" to "not-an-instant")
    )

    invalid.forEach {
      assertNull(DepartureReminderPayload.fromPushData(it, "provider-41", now))
    }
  }

  @Test
  fun interceptionKeepsLegacyFallbackButDropsStaleAndOtherAccountPayloads() {
    assertEquals(
      DepartureReminderInterceptionDecision.ORIGINAL,
      DepartureReminderInterceptionPolicy.decide(
        sanitizationSucceeded = true,
        recipientValid = true,
        accountStatus = DepartureReminderAccountStatus.UNINITIALIZED,
        nativePayloadValid = true,
        expirationFuture = true
      )
    )
    assertEquals(
      DepartureReminderInterceptionDecision.ORIGINAL,
      DepartureReminderInterceptionPolicy.decide(
        true,
        true,
        DepartureReminderAccountStatus.ACTIVE_MATCH,
        nativePayloadValid = false,
        expirationFuture = true
      )
    )
    listOf(
      DepartureReminderAccountStatus.INACTIVE,
      DepartureReminderAccountStatus.ACTIVE_OTHER_ACCOUNT
    ).forEach { accountStatus ->
      assertEquals(
        DepartureReminderInterceptionDecision.SANITIZED,
        DepartureReminderInterceptionPolicy.decide(
          true,
          true,
          accountStatus,
          nativePayloadValid = true,
          expirationFuture = true
        )
      )
    }
    assertEquals(
      DepartureReminderInterceptionDecision.SANITIZED,
      DepartureReminderInterceptionPolicy.decide(
        true,
        true,
        DepartureReminderAccountStatus.ACTIVE_MATCH,
        nativePayloadValid = false,
        expirationFuture = false
      )
    )
    assertEquals(
      DepartureReminderInterceptionDecision.ORIGINAL,
      DepartureReminderInterceptionPolicy.afterPresentation(
        DepartureReminderPresentationResult.FAILED
      )
    )
    assertEquals(
      DepartureReminderInterceptionDecision.SANITIZED,
      DepartureReminderInterceptionPolicy.afterPresentation(
        DepartureReminderPresentationResult.PRESENTED
      )
    )
    assertEquals(
      DepartureReminderInterceptionDecision.SANITIZED,
      DepartureReminderInterceptionPolicy.afterPresentation(
        DepartureReminderPresentationResult.FAILED,
        expirationFuture = false
      )
    )
  }

  @Test
  fun notificationLifetimeEndsExactlyAtTheSignedExpirationBoundary() {
    val payload = requireNotNull(
      DepartureReminderPayload.fromPushData(validData(), "provider-41", now)
    )

    assertEquals(120_000L, remainingDepartureReminderLifetimeMillis(payload, now))
    assertEquals(1L, remainingDepartureReminderLifetimeMillis(payload, payload.expiresAtMillis - 1))
    assertNull(remainingDepartureReminderLifetimeMillis(payload, payload.expiresAtMillis))
    assertNull(remainingDepartureReminderLifetimeMillis(payload, payload.expiresAtMillis + 1))
  }

  @Test
  fun maximumScheduleIdentifierStillProducesABoundedActionJournalIdentity() {
    val longScheduleId = "9".repeat(200)
    val payload = requireNotNull(
      DepartureReminderPayload.fromPushData(
        validData() + ("scheduleId" to longScheduleId),
        "provider-41",
        now
      )
    )

    assertEquals(longScheduleId, payload.scheduleId)
    assertEquals("push:${payload.providerTag}", payload.interactionAlarmId())
    assertEquals(69, payload.interactionAlarmId().length)
  }

  @Test
  fun sanitizerCoversPinnedFirebaseNotificationPrefixesOnly() {
    assertTrue(isFirebaseNotificationPresentationKey("gcm.n.e"))
    assertTrue(isFirebaseNotificationPresentationKey("gcm.notification.title"))
    assertFalse(isFirebaseNotificationPresentationKey("google.message_id"))
    assertFalse(isFirebaseNotificationPresentationKey("logicalEventKey"))
  }

  @Test
  fun unsafeSanitizationFallbackNeverLeaksAnInvalidOrOldAccountReminder() {
    assertEquals(
      DepartureReminderUnsafeSanitizationDecision.ORIGINAL,
      DepartureReminderUnsafeSanitizationPolicy.decide(
        recipientValid = true,
        accountStatus = DepartureReminderAccountStatus.UNINITIALIZED
      )
    )
    assertEquals(
      DepartureReminderUnsafeSanitizationDecision.ORIGINAL,
      DepartureReminderUnsafeSanitizationPolicy.decide(
        recipientValid = true,
        accountStatus = DepartureReminderAccountStatus.ACTIVE_MATCH
      )
    )
    listOf(
      DepartureReminderAccountStatus.INACTIVE,
      DepartureReminderAccountStatus.ACTIVE_OTHER_ACCOUNT,
      null
    ).forEach { status ->
      assertEquals(
        DepartureReminderUnsafeSanitizationDecision.CONSUME,
        DepartureReminderUnsafeSanitizationPolicy.decide(
          recipientValid = true,
          accountStatus = status
        )
      )
    }
    assertEquals(
      DepartureReminderUnsafeSanitizationDecision.CONSUME,
      DepartureReminderUnsafeSanitizationPolicy.decide(
        recipientValid = false,
        accountStatus = DepartureReminderAccountStatus.UNINITIALIZED
      )
    )
  }

  @Test
  fun concurrentRedeliveryHasOnePresenterWinner() {
    val store = MemoryClaimStore()
    val presenterEntered = CountDownLatch(1)
    val releasePresenter = CountDownLatch(1)
    val calls = AtomicInteger(0)
    val coordinator = DepartureReminderPresentationCoordinator(store) {
      calls.incrementAndGet()
      presenterEntered.countDown()
      releasePresenter.await(2, TimeUnit.SECONDS)
    }
    val pool = Executors.newFixedThreadPool(2)
    val payload = requireNotNull(
      DepartureReminderPayload.fromPushData(validData(), "provider-41", now)
    )
    val first = pool.submit<DepartureReminderPresentationResult> {
      coordinator.present(payload, now)
    }
    assertTrue(presenterEntered.await(2, TimeUnit.SECONDS))
    val second = pool.submit<DepartureReminderPresentationResult> {
      coordinator.present(payload, now)
    }

    assertEquals(DepartureReminderPresentationResult.DUPLICATE, second.get(2, TimeUnit.SECONDS))
    releasePresenter.countDown()
    assertEquals(DepartureReminderPresentationResult.PRESENTED, first.get(2, TimeUnit.SECONDS))
    assertEquals(1, calls.get())
    pool.shutdownNow()
  }

  @Test
  fun explicitNotifyFailureRollsBackAndNextDeliveryRetries() {
    val store = MemoryClaimStore()
    val calls = AtomicInteger(0)
    val coordinator = DepartureReminderPresentationCoordinator(store) {
      calls.incrementAndGet() > 1
    }
    val payload = requireNotNull(
      DepartureReminderPayload.fromPushData(validData(), "provider-41", now)
    )

    assertEquals(DepartureReminderPresentationResult.FAILED, coordinator.present(payload, now))
    assertEquals(
      DepartureReminderPresentationResult.PRESENTED,
      coordinator.present(payload, now + 1)
    )
    assertEquals(2, calls.get())
  }

  @Test
  fun storageFailureFailsOpenButCommitFailureKeepsPresentedBoundary() {
    val payload = requireNotNull(
      DepartureReminderPayload.fromPushData(validData(), "provider-41", now)
    )
    val unavailable = object : DepartureReminderClaimStore {
      override fun acquire(payload: DepartureReminderPayload, nowMillis: Long) =
        DepartureReminderClaimAcquisition.StorageUnavailable
      override fun commit(
        payload: DepartureReminderPayload,
        acquiredAtMillis: Long,
        nowMillis: Long
      ) = false
      override fun rollback(payload: DepartureReminderPayload, acquiredAtMillis: Long) = false
    }
    assertEquals(
      DepartureReminderPresentationResult.PRESENTED,
      DepartureReminderPresentationCoordinator(unavailable) { true }.present(payload, now)
    )

    val commitFailure = MemoryClaimStore(commitSucceeds = false)
    assertEquals(
      DepartureReminderPresentationResult.PRESENTED,
      DepartureReminderPresentationCoordinator(commitFailure) { true }.present(payload, now)
    )
    assertTrue(
      DepartureReminderPresentationClaimPolicy.blocksPresentation(
        commitFailure.entry,
        now + DepartureReminderPresentationClaimPolicy.PENDING_LEASE_MILLIS - 1
      )
    )
    assertFalse(
      DepartureReminderPresentationClaimPolicy.blocksPresentation(
        commitFailure.entry,
        now + DepartureReminderPresentationClaimPolicy.PENDING_LEASE_MILLIS
      )
    )
  }

  @Test
  fun retainedClaimsRecoverAcrossRestartAndStayBounded() {
    val entries = (0..DepartureReminderPresentationClaimPolicy.MAX_CLAIMS).map { index ->
      claim("nolate-visible-${index.toString(16).padStart(64, '0')}", now + index)
    } + claim(
      "nolate-visible-${"f".repeat(64)}",
      now - DepartureReminderPresentationClaimPolicy.RETENTION_MILLIS - 1
    )

    val retained = DepartureReminderPresentationClaimPolicy.retained(entries, now + 1_000)
    assertEquals(DepartureReminderPresentationClaimPolicy.MAX_CLAIMS, retained.size)
    assertFalse(retained.any { it.notificationTag == "nolate-visible-${"0".repeat(64)}" })
    assertFalse(retained.any { it.notificationTag == "nolate-visible-${"f".repeat(64)}" })
  }

  private fun validData(): Map<String, String> = mapOf(
    "type" to DEPARTURE_REMINDER_PAYLOAD_TYPE,
    "scheduleId" to "41",
    "recipientMemberId" to "7",
    "logicalEventKey" to logicalEventKey,
    "etaEventExpiresAt" to Instant.ofEpochMilli(now + 120_000).toString(),
    "nolateNotificationTitle" to "출발 시간 안내",
    "nolateNotificationBody" to "서울역 → 광화문 · 지하철 25분",
    "nolateNotificationTag" to DepartureReminderPayload.providerTag(logicalEventKey)
  )

  private fun claim(tag: String, updatedAt: Long) = DepartureReminderPresentationClaim(
    notificationTag = tag,
    memberId = 7,
    logicalEventKey = logicalEventKey,
    providerMessageId = "provider-41",
    state = DepartureReminderClaimState.COMMITTED,
    updatedAtMillis = updatedAt,
    presentedAtMillis = updatedAt,
    evidenceDelivered = false
  )

  private class MemoryClaimStore(
    private val commitSucceeds: Boolean = true
  ) : DepartureReminderClaimStore {
    var entry: DepartureReminderPresentationClaim? = null

    @Synchronized
    override fun acquire(
      payload: DepartureReminderPayload,
      nowMillis: Long
    ): DepartureReminderClaimAcquisition {
      if (DepartureReminderPresentationClaimPolicy.blocksPresentation(entry, nowMillis)) {
        return DepartureReminderClaimAcquisition.Duplicate
      }
      entry = DepartureReminderPresentationClaim(
        payload.notificationTag,
        payload.recipientMemberId,
        payload.logicalEventKey,
        payload.providerMessageId,
        DepartureReminderClaimState.PENDING,
        nowMillis,
        null,
        false
      )
      return DepartureReminderClaimAcquisition.Acquired(nowMillis)
    }

    @Synchronized
    override fun commit(
      payload: DepartureReminderPayload,
      acquiredAtMillis: Long,
      nowMillis: Long
    ): Boolean {
      if (!commitSucceeds) return false
      val current = entry ?: return false
      if (current.updatedAtMillis != acquiredAtMillis) return false
      entry = current.copy(
        state = DepartureReminderClaimState.COMMITTED,
        updatedAtMillis = nowMillis,
        presentedAtMillis = nowMillis
      )
      return true
    }

    @Synchronized
    override fun rollback(
      payload: DepartureReminderPayload,
      acquiredAtMillis: Long
    ): Boolean {
      if (entry?.updatedAtMillis != acquiredAtMillis) return false
      entry = null
      return true
    }
  }
}
