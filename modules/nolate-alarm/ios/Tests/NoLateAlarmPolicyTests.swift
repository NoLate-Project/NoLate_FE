import XCTest
@testable import NoLateAlarmPolicy

final class NoLateAlarmPolicyTests: XCTestCase {
  func testTombstoneBlocksLateAndEqualUpserts() {
    let tombstone = NoLateAlarmTombstone(
      alarmId: "schedule:41",
      generation: 7,
      updatedAtMilliseconds: 1_000
    )

    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideUpsert(
        current: nil,
        tombstone: tombstone,
        incomingGeneration: 7,
        incomingScheduleId: "41",
        incomingSourceTriggerAtMilliseconds: 2_000,
        incomingTitle: "회의",
        incomingSnoozeMinutes: 5
      ),
      .stale
    )
    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideUpsert(
        current: nil,
        tombstone: tombstone,
        incomingGeneration: 8,
        incomingScheduleId: "41",
        incomingSourceTriggerAtMilliseconds: 2_000,
        incomingTitle: "회의",
        incomingSnoozeMinutes: 5
      ),
      .apply
    )
  }

  func testEqualGenerationIsOnlyIdempotentForSameServerIdentity() {
    let current = storedAlarm(generation: 4)

    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideUpsert(
        current: current,
        tombstone: nil,
        incomingGeneration: 4,
        incomingScheduleId: "41",
        incomingSourceTriggerAtMilliseconds: 2_000,
        incomingTitle: "회의",
        incomingSnoozeMinutes: 5
      ),
      .idempotent
    )
    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideUpsert(
        current: current,
        tombstone: nil,
        incomingGeneration: 4,
        incomingScheduleId: "42",
        incomingSourceTriggerAtMilliseconds: 2_000,
        incomingTitle: "회의",
        incomingSnoozeMinutes: 5
      ),
      .conflict
    )
    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideUpsert(
        current: current,
        tombstone: nil,
        incomingGeneration: 4,
        incomingScheduleId: "41",
        incomingSourceTriggerAtMilliseconds: 2_000,
        incomingTitle: "변경된 회의",
        incomingSnoozeMinutes: 5
      ),
      .conflict
    )
    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideUpsert(
        current: current,
        tombstone: nil,
        incomingGeneration: 4,
        incomingScheduleId: "41",
        incomingSourceTriggerAtMilliseconds: 2_000,
        incomingTitle: "회의",
        incomingSnoozeMinutes: 10
      ),
      .conflict
    )
  }

  func testStaleCancelCannotDeleteNewerAlarm() {
    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideCancel(
        current: storedAlarm(generation: 9),
        tombstone: nil,
        incomingGeneration: 8
      ),
      .stale
    )
    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideCancel(
        current: storedAlarm(generation: 9),
        tombstone: nil,
        incomingGeneration: 9
      ),
      .apply
    )
    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideCancel(
        current: nil,
        tombstone: NoLateAlarmTombstone(
          alarmId: "schedule:41",
          generation: 9,
          updatedAtMilliseconds: 1_000
        ),
        incomingGeneration: 9
      ),
      .apply
    )
  }

  func testIsoParserRequiresTimezoneAndAcceptsFractions() throws {
    XCTAssertEqual(
      try NoLateAlarmInput.isoTimestampMilliseconds(
        "2026-03-31T23:30:00.123456789Z"
      ),
      1_774_999_800_123
    )
    XCTAssertThrowsError(
      try NoLateAlarmInput.isoTimestampMilliseconds("2026-03-31T23:30:00")
    )
    XCTAssertThrowsError(
      try NoLateAlarmInput.isoTimestampMilliseconds("2026-02-30T23:30:00Z")
    )
  }

  func testSystemIdentifierIsStableAcrossGenerations() {
    let first = NoLateAlarmSystemIdentifier.uuid(alarmId: "schedule:41")
    let replay = NoLateAlarmSystemIdentifier.uuid(alarmId: "schedule:41")
    let other = NoLateAlarmSystemIdentifier.uuid(alarmId: "schedule:42")

    XCTAssertEqual(first, replay)
    XCTAssertNotEqual(first, other)
  }

  func testRecoveryExpiresOnlyBeyondGraceWindow() {
    let now: Int64 = 1_000_000

    XCTAssertEqual(
      NoLateAlarmRecoveryPolicy.disposition(
        triggerAtMilliseconds: now - noLateMissedAlarmGraceMilliseconds,
        nowMilliseconds: now
      ),
      .keep
    )
    XCTAssertEqual(
      NoLateAlarmRecoveryPolicy.disposition(
        triggerAtMilliseconds: now - noLateMissedAlarmGraceMilliseconds - 1,
        nowMilliseconds: now
      ),
      .expire
    )
    XCTAssertEqual(
      NoLateAlarmTriggerPolicy.effectiveTriggerAtMilliseconds(
        sourceTriggerAtMilliseconds: 1_000,
        deliveryMode: .timeSensitive
      ),
      1_000
    )
    XCTAssertEqual(
      NoLateAlarmTriggerPolicy.effectiveTriggerAtMilliseconds(
        sourceTriggerAtMilliseconds: 1_001,
        deliveryMode: .timeSensitive
      ),
      2_000
    )
  }

  func testRecoveryReschedulesDurablePreScheduleStateEvenWhenStableIdExists() {
    let now: Int64 = 1_000_000

    XCTAssertTrue(
      NoLateAlarmRecoveryPolicy.shouldReschedule(
        alarmState: .pendingPermission,
        isSystemDeliveryPresent: true,
        triggerAtMilliseconds: now + 10_000,
        nowMilliseconds: now
      )
    )
    XCTAssertFalse(
      NoLateAlarmRecoveryPolicy.shouldReschedule(
        alarmState: .scheduled,
        isSystemDeliveryPresent: true,
        triggerAtMilliseconds: now + 10_000,
        nowMilliseconds: now
      )
    )
  }

  func testMissingAlarmKitDeliveryIsInferredOnlyAfterItsTrigger() {
    let alarm = storedAlarm(generation: 4)

    XCTAssertFalse(
      NoLateAlarmRecoveryPolicy.shouldInferMissingAlarmKitFire(
        alarm: alarm,
        isSystemDeliveryPresent: true,
        nowMilliseconds: alarm.effectiveTriggerAtMilliseconds + 1
      )
    )
    XCTAssertFalse(
      NoLateAlarmRecoveryPolicy.shouldInferMissingAlarmKitFire(
        alarm: alarm,
        isSystemDeliveryPresent: false,
        nowMilliseconds: alarm.effectiveTriggerAtMilliseconds - 1
      )
    )
    XCTAssertTrue(
      NoLateAlarmRecoveryPolicy.shouldInferMissingAlarmKitFire(
        alarm: alarm,
        isSystemDeliveryPresent: false,
        nowMilliseconds: alarm.effectiveTriggerAtMilliseconds
      )
    )
  }

  func testCapturedTombstoneCannotCancelAConcurrentNewUpsert() {
    let captured = NoLateAlarmTombstone(
      alarmId: "schedule:41",
      generation: 4,
      updatedAtMilliseconds: 1_000
    )

    XCTAssertTrue(
      NoLateAlarmRecoveryPolicy.mayCancelTombstonedDelivery(
        captured: captured,
        current: captured,
        activeAlarm: nil
      )
    )
    XCTAssertFalse(
      NoLateAlarmRecoveryPolicy.mayCancelTombstonedDelivery(
        captured: captured,
        current: nil,
        activeAlarm: storedAlarm(generation: 5)
      )
    )
  }

  func testDeliveredOldGenerationCannotStopConcurrentNewUpsert() {
    let current = storedAlarm(generation: 5)

    XCTAssertFalse(
      NoLateAlarmDeliveredNotificationPolicy.matches(
        alarm: current,
        deliveredAlarmId: current.alarmId,
        deliveredScheduleId: current.scheduleId,
        deliveredGeneration: 4
      )
    )
    XCTAssertTrue(
      NoLateAlarmDeliveredNotificationPolicy.matches(
        alarm: current,
        deliveredAlarmId: current.alarmId,
        deliveredScheduleId: current.scheduleId,
        deliveredGeneration: 5
      )
    )
  }

  func testStoreRestoresAlarmAndTombstoneAfterReinitialization() throws {
    let suiteName = "NoLateAlarmPolicyTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer {
      defaults.removePersistentDomain(forName: suiteName)
    }
    let expected = NoLateAlarmStoreSnapshot(
      alarms: ["schedule:41": storedAlarm(generation: 4)],
      tombstones: [
        "schedule:42": NoLateAlarmTombstone(
          alarmId: "schedule:42",
          generation: 8,
          updatedAtMilliseconds: 3_000
        )
      ]
    )

    let store = NoLateAlarmStore(defaults: defaults)
    try store.save(expected)

    XCTAssertEqual(try NoLateAlarmStore(defaults: defaults).load(), expected)

    let corruptData = Data("not-json".utf8)
    defaults.set(corruptData, forKey: NoLateAlarmStore.storageKey)
    XCTAssertThrowsError(try store.load())
    XCTAssertEqual(defaults.data(forKey: NoLateAlarmStore.storageKey), corruptData)

    try store.reset()
    XCTAssertEqual(try store.load(), .empty)

    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideUpsert(
        current: nil,
        tombstone: nil,
        incomingGeneration: 4,
        incomingScheduleId: "41",
        incomingSourceTriggerAtMilliseconds: 2_000,
        incomingTitle: "회의",
        incomingSnoozeMinutes: 5
      ),
      .apply
    )
  }

  func testLegacyTombstoneWithoutExpiredResponseEvidenceRemainsDecodable() throws {
    let suiteName = "NoLateLegacyTombstoneTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    defaults.set(
      try JSONSerialization.data(withJSONObject: [
        "alarms": [:],
        "tombstones": [
          "schedule:41:member:7": [
            "alarmId": "schedule:41:member:7",
            "generation": 8,
            "updatedAtMilliseconds": 123_000
          ]
        ]
      ]),
      forKey: NoLateAlarmStore.storageKey
    )

    let tombstone = try XCTUnwrap(
      NoLateAlarmStore(defaults: defaults).load().tombstones["schedule:41:member:7"]
    )
    XCTAssertEqual(tombstone.generation, 8)
    XCTAssertNil(tombstone.expiredResponseEvidence)
  }

  func testV2PhysicalAndLogicalAlarmIdentityRoundTrips() throws {
    let suiteName = "NoLateAlarmV2StoreTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let key = "key:\(String(repeating: "a", count: 64))"
    let alarm = NoLateStoredAlarm(
      alarmId: "schedule:41:member:7:occurrence:M0",
      scheduleId: "41",
      title: "지금 출발",
      generation: 8,
      recipientMemberId: 7,
      logicalEventKey: nil,
      sourceTriggerAtMilliseconds: 2_000,
      effectiveTriggerAtMilliseconds: 2_000,
      snoozeMinutes: 5,
      deliveryMode: .alarmKit,
      state: .scheduled,
      updatedAtMilliseconds: 1_000,
      logicalAlarmId: "schedule:41:member:7",
      occurrenceId: "M0",
      body: "지금 출발하세요.",
      decision: "DEPART_NOW",
      minutesBeforeDeparture: 0,
      actionEventKey: key
    )
    let store = NoLateAlarmStore(defaults: defaults)
    try store.save(NoLateAlarmStoreSnapshot(
      alarms: [alarm.alarmId: alarm],
      tombstones: [:]
    ))

    let restored = try NoLateAlarmStore(defaults: defaults).load().alarms[alarm.alarmId]
    XCTAssertEqual(restored, alarm)
    XCTAssertEqual(restored?.backendAlarmId, "schedule:41:member:7")
    XCTAssertEqual(
      NoLateAlarmGenerationPolicy.decideUpsert(
        current: restored,
        tombstone: nil,
        incomingGeneration: 8,
        incomingScheduleId: "41",
        incomingSourceTriggerAtMilliseconds: 2_000,
        incomingTitle: "지금 출발",
        incomingSnoozeMinutes: 5,
        incomingLogicalAlarmId: "schedule:41:member:7",
        incomingOccurrenceId: "M0",
        incomingBody: "지금 출발하세요.",
        incomingDecision: "DEPART_NOW",
        incomingMinutesBeforeDeparture: 0,
        incomingActionEventKey: key
      ),
      .idempotent
    )
  }

  func testActionAndNavigationJournalsRemainSeparateAndDurable() throws {
    let suiteName = "NoLateAlarmIntentJournalTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let actionJournal = NoLateAlarmActionJournal(defaults: defaults)
    let action = NoLateStoredDepartureActionEvent(
      eventId: "action-1",
      alarmId: "schedule:41:member:7",
      scheduleId: "41",
      generation: 8,
      recipientMemberId: 7,
      occurrenceId: "M0",
      actionEventKey: "key:\(String(repeating: "b", count: 64))",
      occurredAtMilliseconds: 2_000,
      requiresRouteNavigation: false,
      routeNavigationDelivered: false
    )
    try actionJournal.record(action)
    try actionJournal.record(action)

    let navigationJournal = NoLateAlarmNavigationJournal(defaults: defaults)
    let navigationEventId = NoLateAlarmNavigationIdentity.eventId(
      physicalAlarmId: "schedule:41:member:7:occurrence:M0",
      generation: 8
    )
    let navigation = NoLateStoredAlarmNavigationEvent(
      eventId: navigationEventId,
      scheduleId: "41",
      recipientMemberId: 7,
      occurredAtMilliseconds: 2_100
    )
    try navigationJournal.record(navigation)
    try navigationJournal.record(NoLateStoredAlarmNavigationEvent(
      eventId: navigationEventId,
      scheduleId: "41",
      recipientMemberId: 7,
      occurredAtMilliseconds: 2_200
    ))

    XCTAssertEqual(try NoLateAlarmActionJournal(defaults: defaults).load(), [action])
    XCTAssertEqual(try NoLateAlarmNavigationJournal(defaults: defaults).load(), [navigation])
    XCTAssertFalse(try actionJournal.remove(eventId: navigationEventId))
    XCTAssertFalse(try navigationJournal.remove(eventId: "action-1"))
  }

  func testAlarmKitIntentRetryCommitsFireBeforeActionWithoutDuplicates() throws {
    enum SimulatedFailure: Error { case interaction }

    let suiteName = "NoLateAlarmIntentRetryTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let fireJournal = NoLateAlarmFireJournal(defaults: defaults)
    let actionJournal = NoLateAlarmActionJournal(defaults: defaults)
    let fire = fireEvent(eventId: "fire-first", generation: 8, occurredAt: 2_000)
    let action = NoLateStoredDepartureActionEvent(
      eventId: "action-first",
      alarmId: "schedule:41:member:7",
      scheduleId: "41",
      generation: 8,
      recipientMemberId: 7,
      occurrenceId: "M0",
      actionEventKey: "key:\(String(repeating: "f", count: 64))",
      occurredAtMilliseconds: 2_000,
      requiresRouteNavigation: false,
      routeNavigationDelivered: false
    )

    // A real corrupt fire store makes telemetry persistence fail, but the explicit user action
    // still crosses its independent durable boundary. Overall failure prevents finish/cancel.
    defaults.set(
      Data("corrupt-fire-journal".utf8),
      forKey: NoLateAlarmFireJournal.storageKey
    )
    XCTAssertThrowsError(try NoLateAlarmIntentCommitSequence.recordFireThenInteraction(
      recordFire: { try fireJournal.record(fire) },
      recordInteraction: { try actionJournal.record(action) }
    ))
    XCTAssertThrowsError(try fireJournal.load())
    XCTAssertEqual(try actionJournal.load(), [action])
    defaults.removeObject(forKey: NoLateAlarmFireJournal.storageKey)
    XCTAssertTrue(defaults.synchronize())

    // If interaction persistence also fails on a later attempt, fire can still commit. Replay
    // keeps both sides idempotent and eventually leaves exactly one of each.
    XCTAssertThrowsError(try NoLateAlarmIntentCommitSequence.recordFireThenInteraction(
      recordFire: { try fireJournal.record(fire) },
      recordInteraction: { throw SimulatedFailure.interaction }
    ))
    XCTAssertEqual(try fireJournal.load(), [fire])
    XCTAssertEqual(try actionJournal.load(), [action])

    try NoLateAlarmIntentCommitSequence.recordFireThenInteraction(
      recordFire: {
        try fireJournal.record(fireEvent(
          eventId: "fire-replay",
          generation: 8,
          occurredAt: 2_100
        ))
      },
      recordInteraction: { try actionJournal.record(action) }
    )
    try NoLateAlarmIntentCommitSequence.recordFireThenInteraction(
      recordFire: {
        try fireJournal.record(fireEvent(
          eventId: "fire-finish-replay",
          generation: 8,
          occurredAt: 2_200
        ))
      },
      recordInteraction: {
        try actionJournal.record(NoLateStoredDepartureActionEvent(
          eventId: "action-finish-replay",
          alarmId: action.alarmId,
          scheduleId: action.scheduleId,
          generation: action.generation,
          recipientMemberId: action.recipientMemberId,
          occurrenceId: action.occurrenceId,
          actionEventKey: action.actionEventKey,
          occurredAtMilliseconds: 2_200,
          requiresRouteNavigation: false,
          routeNavigationDelivered: false
        ))
      }
    )

    XCTAssertEqual(try fireJournal.load(), [fire])
    XCTAssertEqual(try actionJournal.load(), [action])
  }

  func testAlarmKitNavigationIdentityIsStableAndRetryDeduplicates() throws {
    let suiteName = "NoLateAlarmNavigationRetryTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let journal = NoLateAlarmNavigationJournal(defaults: defaults)
    let fireJournal = NoLateAlarmFireJournal(defaults: defaults)
    let eventId = NoLateAlarmNavigationIdentity.eventId(
      physicalAlarmId: "schedule:41:member:7:occurrence:M0",
      generation: 8
    )
    XCTAssertEqual(
      eventId,
      NoLateAlarmNavigationIdentity.eventId(
        physicalAlarmId: "schedule:41:member:7:occurrence:M0",
        generation: 8
      )
    )
    XCTAssertNotEqual(
      eventId,
      NoLateAlarmNavigationIdentity.eventId(
        physicalAlarmId: "schedule:41:member:7:occurrence:M0",
        generation: 9
      )
    )

    let first = NoLateStoredAlarmNavigationEvent(
      eventId: eventId,
      scheduleId: "41",
      recipientMemberId: 7,
      occurredAtMilliseconds: 2_000
    )
    let replay = NoLateStoredAlarmNavigationEvent(
      eventId: eventId,
      scheduleId: "41",
      recipientMemberId: 7,
      occurredAtMilliseconds: 2_100
    )
    let fire = fireEvent(eventId: "navigation-fire", generation: 9, occurredAt: 2_000)
    defaults.set(
      Data("corrupt-navigation-fire-journal".utf8),
      forKey: NoLateAlarmFireJournal.storageKey
    )

    XCTAssertThrowsError(try NoLateAlarmIntentCommitSequence.recordFireThenInteraction(
      recordFire: { try fireJournal.record(fire) },
      recordInteraction: { try journal.record(first) }
    ))
    XCTAssertEqual(try journal.load(), [first])
    defaults.removeObject(forKey: NoLateAlarmFireJournal.storageKey)
    XCTAssertTrue(defaults.synchronize())

    try NoLateAlarmIntentCommitSequence.recordFireThenInteraction(
      recordFire: { try fireJournal.record(fire) },
      recordInteraction: { try journal.record(replay) }
    )

    XCTAssertEqual(try fireJournal.load(), [fire])
    XCTAssertEqual(try journal.load(), [first])
  }

  func testAlarmKitPresentationKeepsTitleAndBodyWithinBound() {
    XCTAssertEqual(
      NoLateAlarmPresentationPolicy.alarmKitAlertTitle(
        title: "회의 출발",
        body: "지금 출발하세요."
      ),
      "회의 출발 · 지금 출발하세요."
    )
    XCTAssertEqual(
      NoLateAlarmPresentationPolicy.alarmKitAlertTitle(
        title: String(repeating: "가", count: 100),
        body: String(repeating: "나", count: 100)
      ).count,
      160
    )
  }

  func testTimeSensitiveNotificationResponseRequiresExactStoredIdentity() throws {
    let alarm = NoLateStoredAlarm(
      alarmId: "schedule:41:member:7:occurrence:M0",
      scheduleId: "41",
      title: "지금 출발",
      generation: 8,
      recipientMemberId: 7,
      logicalEventKey: nil,
      sourceTriggerAtMilliseconds: 2_000,
      effectiveTriggerAtMilliseconds: 2_000,
      snoozeMinutes: 5,
      deliveryMode: .timeSensitive,
      state: .scheduled,
      updatedAtMilliseconds: 1_000,
      logicalAlarmId: "schedule:41:member:7",
      occurrenceId: "M0",
      body: "지금 출발하세요.",
      decision: "DEPART_NOW",
      minutesBeforeDeparture: 0,
      actionEventKey: "key:\(String(repeating: "a", count: 64))"
    )
    let response = try NoLateAlarmInput.notificationResponseFire(
      nativeAlarmId: alarm.alarmId,
      alarmId: alarm.backendAlarmId,
      scheduleId: alarm.scheduleId,
      generation: Double(alarm.generation),
      recipientMemberId: 7,
      occurrenceId: alarm.occurrenceId,
      occurredAt: "1970-01-01T00:00:02.100Z"
    )

    XCTAssertTrue(NoLateAlarmNotificationResponsePolicy.matches(
      alarm: alarm,
      response: response
    ))
    XCTAssertFalse(NoLateAlarmNotificationResponsePolicy.matches(
      alarm: alarm,
      response: NoLateValidatedNotificationResponseFire(
        nativeAlarmId: response.nativeAlarmId,
        alarmId: response.alarmId,
        scheduleId: response.scheduleId,
        generation: 9,
        recipientMemberId: response.recipientMemberId,
        occurrenceId: response.occurrenceId,
        occurredAtMilliseconds: response.occurredAtMilliseconds
      )
    ))
    XCTAssertThrowsError(try NoLateAlarmInput.notificationResponseFire(
      nativeAlarmId: alarm.backendAlarmId,
      alarmId: alarm.backendAlarmId,
      scheduleId: alarm.scheduleId,
      generation: Double(alarm.generation),
      recipientMemberId: 7,
      occurrenceId: alarm.occurrenceId,
      occurredAt: "1970-01-01T00:00:02.100Z"
    ))
  }

  func testExpiredTimeSensitiveResponseProducesDurableFireEvidenceAfterColdStart() throws {
    let suiteName = "NoLateExpiredAlarmResponseTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let alarm = timeSensitiveResponseAlarm(generation: 8)
    let recoveryNow = alarm.effectiveTriggerAtMilliseconds +
      noLateMissedAlarmGraceMilliseconds + 1
    XCTAssertEqual(
      NoLateAlarmRecoveryPolicy.disposition(
        triggerAtMilliseconds: alarm.effectiveTriggerAtMilliseconds,
        nowMilliseconds: recoveryNow
      ),
      .expire
    )

    let expired = NoLateAlarmRecoveryPolicy.expiredTombstone(
      for: alarm,
      nowMilliseconds: recoveryNow
    )
    let store = NoLateAlarmStore(defaults: defaults)
    try store.save(NoLateAlarmStoreSnapshot(
      alarms: [:],
      tombstones: [alarm.alarmId: expired]
    ))

    // Reinitialize both stores to model module creation/reconciliation completing before JS reads
    // the OS last response on a cold start.
    let restored = try NoLateAlarmStore(defaults: defaults).load()
    let response = try NoLateAlarmInput.notificationResponseFire(
      nativeAlarmId: alarm.alarmId,
      alarmId: alarm.backendAlarmId,
      scheduleId: alarm.scheduleId,
      generation: Double(alarm.generation),
      recipientMemberId: 7,
      occurrenceId: alarm.occurrenceId,
      occurredAt: "1970-01-01T00:00:02.100Z"
    )
    let evidence = try XCTUnwrap(
      NoLateAlarmNotificationResponsePolicy.matchingEvidence(
        activeAlarm: nil,
        tombstone: restored.tombstones[alarm.alarmId],
        response: response,
        nowMilliseconds: recoveryNow
      )
    )
    let event = evidence.fireEvent(
      eventId: "cold-start-response",
      occurredAtMilliseconds: response.occurredAtMilliseconds,
      timingBasis: .observedAlerting
    )
    let journal = NoLateAlarmFireJournal(defaults: defaults)
    try journal.record(event)

    XCTAssertEqual(try NoLateAlarmFireJournal(defaults: defaults).load(), [event])
    XCTAssertEqual(event.alarmId, "schedule:41:member:7")
    XCTAssertEqual(event.generation, 8)
    XCTAssertEqual(event.recipientMemberId, 7)
    XCTAssertEqual(event.occurrenceId, "M0")

    let consumedTombstone = expired.withoutExpiredResponseEvidence()
    try store.save(NoLateAlarmStoreSnapshot(
      alarms: [:],
      tombstones: [alarm.alarmId: consumedTombstone]
    ))
    let consumedSnapshot = try NoLateAlarmStore(defaults: defaults).load()
    XCTAssertNil(consumedSnapshot.tombstones[alarm.alarmId]?.expiredResponseEvidence)
    XCTAssertNil(NoLateAlarmNotificationResponsePolicy.matchingEvidence(
      activeAlarm: nil,
      tombstone: consumedSnapshot.tombstones[alarm.alarmId],
      response: response,
      nowMilliseconds: recoveryNow
    ))
  }

  func testExpiredResponseEvidencePreservesGenerationAndAccountBoundaries() throws {
    let alarm = timeSensitiveResponseAlarm(generation: 8)
    let recoveryNow = alarm.effectiveTriggerAtMilliseconds +
      noLateMissedAlarmGraceMilliseconds + 1
    let tombstone = NoLateAlarmRecoveryPolicy.expiredTombstone(
      for: alarm,
      nowMilliseconds: recoveryNow
    )
    let response = try NoLateAlarmInput.notificationResponseFire(
      nativeAlarmId: alarm.alarmId,
      alarmId: alarm.backendAlarmId,
      scheduleId: alarm.scheduleId,
      generation: Double(alarm.generation),
      recipientMemberId: 7,
      occurrenceId: alarm.occurrenceId,
      occurredAt: "1970-01-01T00:00:02.100Z"
    )

    XCTAssertNotNil(NoLateAlarmNotificationResponsePolicy.matchingEvidence(
      activeAlarm: nil,
      tombstone: tombstone,
      response: response,
      nowMilliseconds: recoveryNow
    ))
    XCTAssertNil(NoLateAlarmNotificationResponsePolicy.matchingEvidence(
      activeAlarm: nil,
      tombstone: tombstone,
      response: NoLateValidatedNotificationResponseFire(
        nativeAlarmId: response.nativeAlarmId,
        alarmId: response.alarmId,
        scheduleId: response.scheduleId,
        generation: response.generation + 1,
        recipientMemberId: response.recipientMemberId,
        occurrenceId: response.occurrenceId,
        occurredAtMilliseconds: response.occurredAtMilliseconds
      ),
      nowMilliseconds: recoveryNow
    ))

    let otherAccountResponse = try NoLateAlarmInput.notificationResponseFire(
      nativeAlarmId: "schedule:41:member:9:occurrence:M0",
      alarmId: "schedule:41:member:9",
      scheduleId: "41",
      generation: Double(alarm.generation),
      recipientMemberId: 9,
      occurrenceId: "M0",
      occurredAt: "1970-01-01T00:00:02.100Z"
    )
    XCTAssertNil(NoLateAlarmNotificationResponsePolicy.matchingEvidence(
      activeAlarm: nil,
      tombstone: tombstone,
      response: otherAccountResponse,
      nowMilliseconds: recoveryNow
    ))

    // A newer active generation is authoritative. Never fall back to an older tombstone merely
    // because the old response is otherwise internally canonical.
    XCTAssertNil(NoLateAlarmNotificationResponsePolicy.matchingEvidence(
      activeAlarm: timeSensitiveResponseAlarm(generation: 9),
      tombstone: tombstone,
      response: response,
      nowMilliseconds: recoveryNow
    ))
    XCTAssertNil(NoLateAlarmNotificationResponsePolicy.matchingEvidence(
      activeAlarm: nil,
      tombstone: nil,
      response: response,
      nowMilliseconds: recoveryNow
    ))
    XCTAssertNil(NoLateAlarmNotificationResponsePolicy.matchingEvidence(
      activeAlarm: nil,
      tombstone: tombstone,
      response: response,
      nowMilliseconds: recoveryNow + noLateTombstoneRetentionMilliseconds + 1
    ))
  }

  func testFallbackActionIdentityIsStableAndCanonical() {
    let first = NoLateAlarmActionIdentity.fallbackKey(
      physicalAlarmId: "schedule:41:member:7:occurrence:M0",
      generation: 8
    )
    let replay = NoLateAlarmActionIdentity.fallbackKey(
      physicalAlarmId: "schedule:41:member:7:occurrence:M0",
      generation: 8
    )
    XCTAssertEqual(first, replay)
    XCTAssertNotNil(first.range(of: #"^key:[a-f0-9]{64}$"#, options: .regularExpression))
  }

  func testCustomAlarmNotificationIdentifiersCannotCommitLegacyDepartureAction() {
    let identifiers = [
      NoLateCustomAlarmNotificationContract.openActionIdentifier,
      NoLateCustomAlarmNotificationContract.confirmDepartureActionIdentifier,
      NoLateCustomAlarmNotificationContract.previewRouteActionIdentifier,
      NoLateCustomAlarmNotificationContract.previewDepartureActionIdentifier
    ]

    XCTAssertEqual(Set(identifiers).count, identifiers.count)
    XCTAssertFalse(identifiers.contains("schedule_depart_now_action"))
    XCTAssertNotEqual(
      NoLateCustomAlarmNotificationContract.categoryIdentifier,
      NoLateCustomAlarmNotificationContract.previewCategoryIdentifier
    )
  }

  func testNativeCategoryRegistrationOwnsAllNoLateCategoriesAndPreservesOthers() {
    XCTAssertEqual(
      NoLateCustomAlarmNotificationContract.managedCategoryIdentifiers,
      [
        "nolate_custom_alarm",
        "nolate_custom_alarm_preview",
        "schedule_depart_now"
      ]
    )
    XCTAssertEqual(
      NoLateCustomAlarmNotificationContract.legacyDepartureActionIdentifier,
      "schedule_depart_now_action"
    )
    XCTAssertEqual(
      NoLateCustomAlarmNotificationContract.legacySnoozeActionIdentifier,
      "schedule_snooze_action"
    )

    let registered = NoLateCustomAlarmNotificationContract
      .categoryIdentifiersAfterRegistration(
        preserving: [
          "unrelated_calendar_category",
          "schedule_depart_now"
        ]
      )
    XCTAssertEqual(
      registered,
      [
        "unrelated_calendar_category",
        "nolate_custom_alarm",
        "nolate_custom_alarm_preview",
        "schedule_depart_now"
      ]
    )
  }

  func testPreviewCleanupTargetsOnlyNoLateCustomAlarmPreviews() {
    XCTAssertEqual(
      NoLateCustomAlarmNotificationContract.previewRequestIdentifierPrefix,
      "nolate.custom-alarm.preview."
    )
    XCTAssertEqual(
      NoLateCustomAlarmNotificationContract.previewRequestIdentifier,
      "nolate.custom-alarm.preview.current"
    )
    XCTAssertEqual(
      NoLateCustomAlarmNotificationContract.previewRequestIdentifiers(
        from: [
          "nolate.custom-alarm.preview.first",
          "nolate.departure.schedule-41",
          "nolate.custom-alarm.preview.second",
          "nolate.custom-alarm.preview",
          "another.preview.request"
        ]
      ),
      [
        "nolate.custom-alarm.preview.first",
        "nolate.custom-alarm.preview.second"
      ]
    )
  }

  func testAlarmSoundPreferenceMapsOnlySupportedIdsToLongNotificationFiles() {
    XCTAssertEqual(NoLateAlarmSoundPreference.defaultValue, .chime)
    XCTAssertEqual(
      NoLateAlarmSoundPreference.chime.notificationResourceName,
      "nolate_departure_alert"
    )
    XCTAssertEqual(
      NoLateAlarmSoundPreference.bell.notificationResourceName,
      "nolate_alarm_bell_alert"
    )
    XCTAssertEqual(
      NoLateAlarmSoundPreference.beep.notificationResourceName,
      "nolate_alarm_beep_alert"
    )
    XCTAssertEqual(
      Set(NoLateAlarmSoundPreference.allCases.map(\.rawValue)),
      ["CHIME", "BELL", "BEEP"]
    )
    XCTAssertNil(NoLateAlarmSoundPreference(rawValue: "DEFAULT"))
  }

  func testAlarmSoundPreferenceStoreDefaultsAndRejectsUnknownValues() throws {
    let suiteName = "NoLateAlarmSoundPreferenceStoreTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let store = NoLateAlarmSoundPreferenceStore(defaults: defaults)

    XCTAssertEqual(store.load(), .chime)
    XCTAssertTrue(store.save(rawValue: "BELL"))
    XCTAssertEqual(store.load(), .bell)
    XCTAssertFalse(store.save(rawValue: "LOUD"))
    XCTAssertEqual(store.load(), .bell)

    defaults.set("UNSUPPORTED", forKey: NoLateAlarmSoundPreferenceStore.storageKey)
    XCTAssertEqual(store.load(), .chime)
  }

  func testSoundRefreshTargetsOnlyCustomAlarmCategories() {
    XCTAssertEqual(
      NoLateCustomAlarmNotificationContract.soundManagedCategoryIdentifiers,
      ["nolate_custom_alarm", "nolate_custom_alarm_preview"]
    )
    XCTAssertTrue(NoLateCustomAlarmNotificationContract.shouldRefreshSound(
      categoryIdentifier: "nolate_custom_alarm"
    ))
    XCTAssertTrue(NoLateCustomAlarmNotificationContract.shouldRefreshSound(
      categoryIdentifier: "nolate_custom_alarm_preview"
    ))
    XCTAssertFalse(NoLateCustomAlarmNotificationContract.shouldRefreshSound(
      categoryIdentifier: "schedule_depart_now"
    ))
    XCTAssertFalse(NoLateCustomAlarmNotificationContract.shouldRefreshSound(
      categoryIdentifier: "unrelated_calendar_category"
    ))
  }

  func testCustomAlarmPreviewPayloadIsExplicitAndCanonical() throws {
    XCTAssertEqual(
      try NoLateCustomAlarmNotificationContract.normalizedScheduleId(" 41 "),
      "41"
    )
    XCTAssertNil(
      try NoLateCustomAlarmNotificationContract.normalizedScheduleId(nil)
    )
    XCTAssertThrowsError(
      try NoLateCustomAlarmNotificationContract.normalizedScheduleId("schedule:41")
    )
    XCTAssertThrowsError(
      try NoLateCustomAlarmNotificationContract.normalizedScheduleId("0")
    )

    XCTAssertEqual(
      NoLateCustomAlarmNotificationContract.payload(
        alarmId: "preview:preview-id",
        previewId: "preview-id",
        scheduleId: "41",
        title: "NoLate 출발 알림",
        body: "미리보기",
        isPreview: true
      ),
      [
        "type": "NOLATE_CUSTOM_ALARM",
        "alarmId": "preview:preview-id",
        "previewId": "preview-id",
        "scheduleId": "41",
        "title": "NoLate 출발 알림",
        "body": "미리보기",
        "isPreview": "true"
      ]
    )
  }

  private func storedAlarm(generation: Int64) -> NoLateStoredAlarm {
    NoLateStoredAlarm(
      alarmId: "schedule:41",
      scheduleId: "41",
      title: "회의",
      generation: generation,
      recipientMemberId: 7,
      logicalEventKey: "event:alarm-41",
      sourceTriggerAtMilliseconds: 2_000,
      effectiveTriggerAtMilliseconds: 2_000,
      snoozeMinutes: 5,
      deliveryMode: .alarmKit,
      state: .scheduled,
      updatedAtMilliseconds: 1_000,
      logicalAlarmId: nil,
      occurrenceId: nil,
      body: nil,
      decision: nil,
      minutesBeforeDeparture: nil,
      actionEventKey: nil
    )
  }

  private func timeSensitiveResponseAlarm(generation: Int64) -> NoLateStoredAlarm {
    NoLateStoredAlarm(
      alarmId: "schedule:41:member:7:occurrence:M0",
      scheduleId: "41",
      title: "지금 출발",
      generation: generation,
      recipientMemberId: 7,
      logicalEventKey: "event:alarm-41",
      sourceTriggerAtMilliseconds: 2_000,
      effectiveTriggerAtMilliseconds: 2_000,
      snoozeMinutes: 5,
      deliveryMode: .timeSensitive,
      state: .scheduled,
      updatedAtMilliseconds: 1_000,
      logicalAlarmId: "schedule:41:member:7",
      occurrenceId: "M0",
      body: "지금 출발하세요.",
      decision: "DEPART_NOW",
      minutesBeforeDeparture: 0,
      actionEventKey: "key:\(String(repeating: "a", count: 64))"
    )
  }

  func testFireJournalDeduplicatesGenerationAndSurvivesReinitialization() throws {
    let suiteName = "NoLateAlarmFireJournalTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let journal = NoLateAlarmFireJournal(defaults: defaults)
    let first = fireEvent(eventId: "first", generation: 4, occurredAt: 2_000)
    let duplicate = fireEvent(eventId: "duplicate", generation: 4, occurredAt: 3_000)

    try journal.record(first)
    try journal.record(duplicate)

    XCTAssertEqual(try NoLateAlarmFireJournal(defaults: defaults).load(), [first])
    XCTAssertEqual(
      try NoLateAlarmFireJournal(defaults: defaults).load().first?.timingBasis,
      .observedAlerting
    )
    XCTAssertEqual(
      try NoLateAlarmFireJournal(defaults: defaults).load().first?.occurrenceId,
      "M0"
    )
    XCTAssertTrue(try journal.remove(eventId: "first"))
    XCTAssertFalse(try journal.remove(eventId: "first"))
    XCTAssertEqual(try journal.load(), [])
  }

  func testFireJournalIsBoundedToNewestEvents() throws {
    let suiteName = "NoLateAlarmFireJournalBoundTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let journal = NoLateAlarmFireJournal(defaults: defaults)

    for generation in 0...NoLateAlarmFireEventPolicy.maximumEvents {
      try journal.record(fireEvent(
        eventId: "event-\(generation)",
        generation: Int64(generation),
        occurredAt: Int64(generation * 1_000)
      ))
    }

    let restored = try NoLateAlarmFireJournal(defaults: defaults).load()
    XCTAssertEqual(restored.count, NoLateAlarmFireEventPolicy.maximumEvents)
    XCTAssertFalse(restored.contains(where: { $0.generation == 0 }))
  }

  func testLegacyFireJournalWithoutTimingBasisRemainsDecodable() throws {
    let suiteName = "NoLateAlarmFireJournalLegacyTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let legacy: [[String: Any]] = [[
      "eventId": "legacy",
      "alarmId": "schedule:41:member:7",
      "scheduleId": "41",
      "generation": 4,
      "recipientMemberId": 7,
      "scheduledForMilliseconds": 1_500,
      "sourceTriggerAtMilliseconds": 1_000,
      "occurredAtMilliseconds": 2_000,
      "logicalEventKey": NSNull()
    ]]
    defaults.set(
      try JSONSerialization.data(withJSONObject: legacy),
      forKey: NoLateAlarmFireJournal.storageKey
    )

    let restored = try NoLateAlarmFireJournal(defaults: defaults).load()

    XCTAssertEqual(restored.count, 1)
    XCTAssertNil(restored.first?.timingBasis)
  }

  func testSnoozedFireWithSameGenerationIsIndependent() {
    let first = fireEvent(eventId: "first", generation: 4, occurredAt: 2_000)
    let snoozed = NoLateStoredAlarmFireEvent(
      eventId: "snoozed",
      alarmId: first.alarmId,
      scheduleId: first.scheduleId,
      generation: first.generation,
      recipientMemberId: first.recipientMemberId,
      scheduledForMilliseconds: 302_000,
      sourceTriggerAtMilliseconds: first.sourceTriggerAtMilliseconds,
      occurredAtMilliseconds: 302_100,
      timingBasis: .observedAlerting,
      logicalEventKey: first.logicalEventKey,
      occurrenceId: first.occurrenceId
    )

    XCTAssertEqual(
      NoLateAlarmFireEventPolicy.merge(existing: [first], incoming: snoozed),
      [first, snoozed]
    )
  }

  private func fireEvent(
    eventId: String,
    generation: Int64,
    occurredAt: Int64
  ) -> NoLateStoredAlarmFireEvent {
    NoLateStoredAlarmFireEvent(
      eventId: eventId,
      alarmId: "schedule:41:member:7",
      scheduleId: "41",
      generation: generation,
      recipientMemberId: 7,
      scheduledForMilliseconds: 1_500,
      sourceTriggerAtMilliseconds: 1_000,
      occurredAtMilliseconds: occurredAt,
      timingBasis: .observedAlerting,
      logicalEventKey: nil,
      occurrenceId: "M0"
    )
  }
}
