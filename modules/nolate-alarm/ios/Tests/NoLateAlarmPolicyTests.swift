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
      updatedAtMilliseconds: 1_000
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
      logicalEventKey: first.logicalEventKey
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
      logicalEventKey: nil
    )
  }
}
