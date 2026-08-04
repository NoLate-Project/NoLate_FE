import Foundation
import SwiftUI
import UIKit
import UserNotifications

#if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
import AlarmKit
#endif

struct NoLateAlarmMutationResult: Sendable {
  let applied: Bool
  let scheduled: Bool
  let reason: String?
  let deliveryMode: NoLateAlarmDeliveryMode?

  init(
    applied: Bool,
    scheduled: Bool,
    reason: String?,
    deliveryMode: NoLateAlarmDeliveryMode? = nil
  ) {
    self.applied = applied
    self.scheduled = scheduled
    self.reason = reason
    self.deliveryMode = deliveryMode
  }

  func bridgeMap() -> [String: Any] {
    var result: [String: Any] = [
      "applied": applied,
      "scheduled": scheduled
    ]
    if let reason {
      result["reason"] = reason
    }
    if let deliveryMode {
      result["deliveryMode"] = deliveryMode.rawValue
    }
    return result
  }
}

struct NoLateAlarmCapabilities: Sendable {
  let exactAlarmAuthorized: Bool
  let fullScreenAuthorized: Bool
  let notificationAuthorized: Bool
  let deliveryMode: String
  let alarmKitAuthorization: String
  let notificationAuthorization: String
  let timeSensitiveAuthorization: String
  let soundAuthorization: String
  let reason: String?

  func bridgeMap() -> [String: Any] {
    var result: [String: Any] = [
      "supported": true,
      "platform": "ios",
      "exactAlarmAuthorized": exactAlarmAuthorized,
      "fullScreenAuthorized": fullScreenAuthorized,
      "notificationAuthorized": notificationAuthorized,
      "deliveryMode": deliveryMode,
      "alarmKitAuthorization": alarmKitAuthorization,
      "notificationAuthorization": notificationAuthorization,
      "timeSensitiveAuthorization": timeSensitiveAuthorization,
      "soundAuthorization": soundAuthorization
    ]
    if let reason {
      result["reason"] = reason
    }
    return result
  }
}

struct NoLateScheduledAlarmBridgeRecord: Sendable {
  let alarm: NoLateStoredAlarm

  func bridgeMap() -> [String: Any] {
    var result: [String: Any] = [
      "operation": "UPSERT",
      "alarmId": alarm.backendAlarmId,
      "nativeAlarmId": alarm.alarmId,
      "scheduleId": alarm.scheduleId,
      "generation": Double(alarm.generation),
      "triggerAt": NoLateAlarmDateFormatter.isoString(
        milliseconds: alarm.effectiveTriggerAtMilliseconds
      ),
      "snoozeMinutes": alarm.snoozeMinutes
    ]
    if let recipientMemberId = alarm.recipientMemberId {
      result["recipientMemberId"] = Double(recipientMemberId)
    }
    if let logicalEventKey = alarm.logicalEventKey {
      result["logicalEventKey"] = logicalEventKey
    }
    if let title = alarm.title {
      result["title"] = title
    }
    if let body = alarm.body {
      result["body"] = body
    }
    if let occurrenceId = alarm.occurrenceId {
      result["occurrenceId"] = occurrenceId
    }
    if let decision = alarm.decision {
      result["decision"] = decision
    }
    if let minutesBeforeDeparture = alarm.minutesBeforeDeparture {
      result["minutesBeforeDeparture"] = minutesBeforeDeparture
    }
    if let actionEventKey = alarm.actionEventKey {
      result["actionEventKey"] = actionEventKey
    }
    return result
  }
}

enum NoLateAlarmRuntime {
  static var isAlarmKitAvailable: Bool {
    #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
    if #available(iOS 26.0, *) {
      return true
    }
    #endif
    return false
  }

  static var isIOS26OrNewer: Bool {
    if #available(iOS 26.0, *) {
      return true
    }
    return false
  }
}

private enum NoLateSystemScheduleOutcome: Sendable {
  case scheduled(NoLateAlarmDeliveryMode, warning: String?)
  case permissionRequired(NoLateAlarmDeliveryMode, reason: String)
  case failed(NoLateAlarmDeliveryMode, reason: String)
}

private actor NoLateAlarmSystemMutex {
  private var isLocked = false
  private var waiters: [CheckedContinuation<Void, Never>] = []

  func acquire() async {
    if !isLocked {
      isLocked = true
      return
    }
    await withCheckedContinuation { continuation in
      waiters.append(continuation)
    }
  }

  func release() {
    if waiters.isEmpty {
      isLocked = false
    } else {
      waiters.removeFirst().resume()
    }
  }
}

private enum NoLateAlarmDateFormatter {
  static func isoString(milliseconds: Int64) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [
      .withInternetDateTime,
      .withFractionalSeconds
    ]
    return formatter.string(
      from: Date(timeIntervalSince1970: Double(milliseconds) / 1_000)
    )
  }
}

actor NoLateAlarmCoordinator {
  static let shared = NoLateAlarmCoordinator()

  private let store: NoLateAlarmStore
  private let fireJournal: NoLateAlarmFireJournal
  private let actionJournal: NoLateAlarmActionJournal
  private let navigationJournal: NoLateAlarmNavigationJournal
  private let notificationCenter: UNUserNotificationCenter
  private let systemMutex = NoLateAlarmSystemMutex()
  private var snapshot: NoLateAlarmStoreSnapshot
  private var initialPersistenceError: Error?

  init(
    store: NoLateAlarmStore = NoLateAlarmStore(),
    fireJournal: NoLateAlarmFireJournal = NoLateAlarmFireJournal(),
    actionJournal: NoLateAlarmActionJournal = NoLateAlarmActionJournal(),
    navigationJournal: NoLateAlarmNavigationJournal = NoLateAlarmNavigationJournal(),
    notificationCenter: UNUserNotificationCenter = .current()
  ) {
    self.store = store
    self.fireJournal = fireJournal
    self.actionJournal = actionJournal
    self.navigationJournal = navigationJournal
    self.notificationCenter = notificationCenter
    do {
      self.snapshot = try store.load()
      self.initialPersistenceError = nil
    } catch {
      self.snapshot = .empty
      self.initialPersistenceError = error
    }
  }

  func getCapabilities() async -> NoLateAlarmCapabilities {
    let notificationSettings = await notificationCenter.notificationSettings()
    let notificationAuthorized =
      Self.canDeliverNotifications(notificationSettings.authorizationStatus) &&
      notificationSettings.alertSetting != .disabled
    let notificationAuthorization = Self.authorizationLabel(
      notificationSettings.authorizationStatus
    )
    let timeSensitiveAuthorization = Self.settingLabel(
      notificationSettings.timeSensitiveSetting
    )
    let soundAuthorization = Self.settingLabel(notificationSettings.soundSetting)

    #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
    if #available(iOS 26.0, *) {
      let alarmKitAuthorization = Self.alarmKitAuthorizationLabel(
        AlarmManager.shared.authorizationState
      )
      let isAuthorized = AlarmManager.shared.authorizationState == .authorized
      let reason: String?
      switch AlarmManager.shared.authorizationState {
      case .authorized:
        reason = nil
      case .notDetermined:
        reason = "ALARM_AUTHORIZATION_NOT_DETERMINED"
      case .denied:
        reason = "ALARM_AUTHORIZATION_DENIED"
      @unknown default:
        reason = "ALARM_AUTHORIZATION_UNKNOWN"
      }
      return NoLateAlarmCapabilities(
        exactAlarmAuthorized: isAuthorized,
        fullScreenAuthorized: isAuthorized,
        notificationAuthorized: notificationAuthorized,
        deliveryMode: "alarmKit",
        alarmKitAuthorization: alarmKitAuthorization,
        notificationAuthorization: notificationAuthorization,
        timeSensitiveAuthorization: timeSensitiveAuthorization,
        soundAuthorization: soundAuthorization,
        reason: reason
      )
    }
    #endif

    let reason: String
    if !Self.canDeliverNotifications(notificationSettings.authorizationStatus) {
      reason = notificationSettings.authorizationStatus == .notDetermined
        ? "NOTIFICATION_PERMISSION_NOT_DETERMINED"
        : "NOTIFICATION_PERMISSION_REQUIRED"
    } else if notificationSettings.alertSetting == .disabled {
      reason = "NOTIFICATION_ALERTS_DISABLED"
    } else if notificationSettings.timeSensitiveSetting != .enabled {
      reason = "TIME_SENSITIVE_DISABLED"
    } else if notificationSettings.soundSetting != .enabled {
      reason = "SOUND_DISABLED"
    } else if NoLateAlarmRuntime.isIOS26OrNewer {
      reason = "ALARMKIT_SDK_UNAVAILABLE"
    } else {
      reason = "TIME_SENSITIVE_FALLBACK"
    }
    return NoLateAlarmCapabilities(
      exactAlarmAuthorized: false,
      fullScreenAuthorized: false,
      notificationAuthorized: notificationAuthorized,
      deliveryMode: "timeSensitive",
      alarmKitAuthorization: NoLateAlarmRuntime.isIOS26OrNewer
        ? "unavailable"
        : "notSupported",
      notificationAuthorization: notificationAuthorization,
      timeSensitiveAuthorization: timeSensitiveAuthorization,
      soundAuthorization: soundAuthorization,
      reason: reason
    )
  }

  func upsert(
    _ command: NoLateValidatedUpsertCommand,
    nowMilliseconds: Int64 = NoLateAlarmCoordinator.currentTimeMilliseconds()
  ) async throws -> NoLateAlarmMutationResult {
    try await restoreAndReconcile(nowMilliseconds: nowMilliseconds)
    pruneTombstones(nowMilliseconds: nowMilliseconds)

    guard
      command.triggerAtMilliseconds >=
        nowMilliseconds + noLateMinimumFutureTriggerMilliseconds
    else {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "TRIGGER_NOT_IN_FUTURE"
      )
    }

    let current = snapshot.alarms[command.alarmId]
    let disposition = NoLateAlarmGenerationPolicy.decideUpsert(
      current: current,
      tombstone: snapshot.tombstones[command.alarmId],
      incomingGeneration: command.generation,
      incomingScheduleId: command.scheduleId,
      incomingSourceTriggerAtMilliseconds: command.triggerAtMilliseconds,
      incomingTitle: command.title,
      incomingSnoozeMinutes: command.snoozeMinutes,
      incomingLogicalAlarmId: command.logicalAlarmId,
      incomingOccurrenceId: command.occurrenceId,
      incomingBody: command.body,
      incomingDecision: command.decision,
      incomingMinutesBeforeDeparture: command.minutesBeforeDeparture,
      incomingActionEventKey: command.actionEventKey
    )
    switch disposition {
    case .stale:
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "STALE_GENERATION"
      )
    case .conflict:
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "GENERATION_CONFLICT"
      )
    case .idempotent:
      guard let current else {
        return NoLateAlarmMutationResult(
          applied: false,
          scheduled: false,
          reason: "MISSING_IDEMPOTENT_ALARM"
        )
      }
      if current.state == .scheduled {
        return NoLateAlarmMutationResult(
          applied: false,
          scheduled: true,
          reason: "ALREADY_APPLIED",
          deliveryMode: current.deliveryMode
        )
      }
      return try await schedulePersisted(
        current,
        requestAuthorization: true,
        applied: false
      )
    case .apply:
      break
    }

    let desiredDeliveryMode: NoLateAlarmDeliveryMode =
      NoLateAlarmRuntime.isAlarmKitAvailable
        ? .alarmKit
        : .timeSensitive
    let desired = NoLateStoredAlarm(
      alarmId: command.alarmId,
      scheduleId: command.scheduleId,
      title: command.title,
      generation: command.generation,
      recipientMemberId: command.recipientMemberId,
      logicalEventKey: command.logicalEventKey,
      sourceTriggerAtMilliseconds: command.triggerAtMilliseconds,
      effectiveTriggerAtMilliseconds:
        NoLateAlarmTriggerPolicy.effectiveTriggerAtMilliseconds(
          sourceTriggerAtMilliseconds: command.triggerAtMilliseconds,
          deliveryMode: desiredDeliveryMode
        ),
      snoozeMinutes: command.snoozeMinutes,
      deliveryMode: desiredDeliveryMode,
      state: .pendingPermission,
      updatedAtMilliseconds: nowMilliseconds,
      logicalAlarmId: command.logicalAlarmId,
      occurrenceId: command.occurrenceId,
      body: command.body,
      decision: command.decision,
      minutesBeforeDeparture: command.minutesBeforeDeparture,
      actionEventKey: command.actionEventKey
    )
    snapshot.alarms[desired.alarmId] = desired
    snapshot.tombstones.removeValue(forKey: desired.alarmId)
    try persistSnapshot()

    if let current {
      try await cancelSystemDelivery(for: current)
    }
    return try await schedulePersisted(
      desired,
      requestAuthorization: true,
      applied: true
    )
  }

  func cancel(
    _ command: NoLateValidatedCancelCommand,
    nowMilliseconds: Int64 = NoLateAlarmCoordinator.currentTimeMilliseconds()
  ) async throws -> NoLateAlarmMutationResult {
    try requireHealthyStore()
    try await reconcileObservedAlarmFireEvents(nowMilliseconds: nowMilliseconds)
    pruneTombstones(nowMilliseconds: nowMilliseconds)
    let current = snapshot.alarms[command.alarmId]
    if let current, current.scheduleId != command.scheduleId {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "INVALID_COMMAND:scheduleId does not match the stored alarm."
      )
    }
    if
      let current,
      let logicalAlarmId = command.logicalAlarmId,
      current.backendAlarmId != logicalAlarmId
    {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "INVALID_COMMAND:logicalAlarmId does not match the stored alarm."
      )
    }
    let disposition = NoLateAlarmGenerationPolicy.decideCancel(
      current: current,
      tombstone: snapshot.tombstones[command.alarmId],
      incomingGeneration: command.generation
    )
    guard disposition == .apply else {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "STALE_GENERATION"
      )
    }

    snapshot.alarms.removeValue(forKey: command.alarmId)
    let retainedGeneration = max(
      command.generation,
      snapshot.tombstones[command.alarmId]?.generation ?? Int64.min
    )
    snapshot.tombstones[command.alarmId] = NoLateAlarmTombstone(
      alarmId: command.alarmId,
      generation: retainedGeneration,
      updatedAtMilliseconds: nowMilliseconds
    )
    try persistSnapshot()

    if let current {
      try await cancelSystemDelivery(for: current)
    } else {
      try await cancelSystemDelivery(
        alarmId: command.alarmId
      )
    }
    return NoLateAlarmMutationResult(
      applied: true,
      scheduled: false,
      reason: nil,
      deliveryMode: current?.deliveryMode
    )
  }

  func getScheduledAlarms() async throws -> [NoLateScheduledAlarmBridgeRecord] {
    try await restoreAndReconcile()
    return snapshot.alarms.values
      .sorted {
        if $0.effectiveTriggerAtMilliseconds != $1.effectiveTriggerAtMilliseconds {
          return $0.effectiveTriggerAtMilliseconds < $1.effectiveTriggerAtMilliseconds
        }
        return $0.alarmId < $1.alarmId
      }
      .map(NoLateScheduledAlarmBridgeRecord.init)
  }

  func scheduleTestAlarm(
    delaySeconds: Int,
    nowMilliseconds: Int64 = NoLateAlarmCoordinator.currentTimeMilliseconds()
  ) async throws -> NoLateAlarmMutationResult {
    guard (3...60).contains(delaySeconds) else {
      throw NoLateAlarmValidationError.invalid(
        "delaySeconds must be between 3 and 60."
      )
    }
    return try await upsert(
      NoLateValidatedUpsertCommand(
        alarmId: "test:\(UUID().uuidString.lowercased())",
        logicalAlarmId: "test",
        scheduleId: "test",
        title: "NoLate 테스트 알람",
        body: "강력한 출발 알람 테스트입니다.",
        occurrenceId: nil,
        decision: nil,
        minutesBeforeDeparture: nil,
        actionEventKey: nil,
        generation: min(nowMilliseconds, noLateMaximumSafeJavaScriptInteger),
        recipientMemberId: 1,
        logicalEventKey: nil,
        triggerAtMilliseconds: nowMilliseconds + Int64(delaySeconds) * 1_000,
        snoozeMinutes: 5
      ),
      nowMilliseconds: nowMilliseconds
    )
  }

  func stopRinging(
    nowMilliseconds: Int64 = NoLateAlarmCoordinator.currentTimeMilliseconds()
  ) async throws -> Bool {
    try requireHealthyStore()
    // Persist observation evidence before either AlarmKit stop/cancel or
    // delivered-notification removal can erase the only proof of execution.
    try await reconcileObservedAlarmFireEvents(nowMilliseconds: nowMilliseconds)
    var stoppedAlarmIds = Set<String>()
    var stoppedSystemDelivery = false

    #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
    if #available(iOS 26.0, *) {
      let alarmKitResult = try await stopAlertingAlarmKitDeliveries(
        nowMilliseconds: nowMilliseconds
      )
      stoppedAlarmIds.formUnion(alarmKitResult.storedAlarmIds)
      stoppedSystemDelivery = alarmKitResult.stoppedSystemDelivery
    }
    #endif

    let delivered = await notificationCenter.deliveredNotifications()
    let deliveredIdentifiers = Set(
      delivered
        .map(\.request.identifier)
        .filter { $0.hasPrefix(Self.notificationIdentifierPrefix) }
    )
    let deliveredStored = snapshot.alarms.values.filter { alarm in
      delivered.contains { notification in
        guard
          notification.request.identifier == Self.notificationIdentifier(for: alarm)
        else {
          return false
        }
        let userInfo = notification.request.content.userInfo
        return NoLateAlarmDeliveredNotificationPolicy.matches(
          alarm: alarm,
          deliveredAlarmId: (userInfo["nativeAlarmId"] as? String) ??
            (userInfo["alarmId"] as? String),
          deliveredScheduleId: userInfo["scheduleId"] as? String,
          deliveredGeneration: Self.int64Value(
            userInfo["alarmGeneration"]
          )
        )
      }
    }
    if !deliveredStored.isEmpty {
      for alarm in deliveredStored {
        snapshot.alarms.removeValue(forKey: alarm.alarmId)
        snapshot.tombstones[alarm.alarmId] = NoLateAlarmTombstone(
          alarmId: alarm.alarmId,
          generation: alarm.generation,
          updatedAtMilliseconds: nowMilliseconds
        )
        stoppedAlarmIds.insert(alarm.alarmId)
      }
      try persistSnapshot()
    }
    if !deliveredIdentifiers.isEmpty {
      notificationCenter.removeDeliveredNotifications(
        withIdentifiers: Array(deliveredIdentifiers)
      )
      stoppedSystemDelivery = true
    }
    return stoppedSystemDelivery || !stoppedAlarmIds.isEmpty
  }

  func clearAllAlarms() async throws -> Bool {
    await systemMutex.acquire()
    do {
      let storedAlarms = Array(snapshot.alarms.values)
      let hadStoredState =
        initialPersistenceError != nil ||
        !snapshot.alarms.isEmpty ||
        !snapshot.tombstones.isEmpty
      let hadFireEvidence = (try? !fireJournal.load().isEmpty) ?? true
      let hadActionEvidence = (try? !actionJournal.load().isEmpty) ?? true
      let hadNavigationEvidence = (try? !navigationJournal.load().isEmpty) ?? true
      // Logout is a privacy boundary. Purge healthy alarms, tombstones, and
      // corrupt bytes alike. Retaining tombstones here would reject the same
      // generation when this account logs in again and replays its snapshot.
      try store.reset()
      try fireJournal.reset()
      try actionJournal.reset()
      try navigationJournal.reset()
      snapshot = .empty
      initialPersistenceError = nil

      let pendingIdentifiers = Set(
        await notificationCenter.pendingNotificationRequests()
          .map(\.identifier)
          .filter { $0.hasPrefix(Self.notificationIdentifierPrefix) }
      )
      let deliveredIdentifiers = Set(
        await notificationCenter.deliveredNotifications()
          .map(\.request.identifier)
          .filter { $0.hasPrefix(Self.notificationIdentifierPrefix) }
      )
      if !pendingIdentifiers.isEmpty {
        notificationCenter.removePendingNotificationRequests(
          withIdentifiers: Array(pendingIdentifiers)
        )
      }
      if !deliveredIdentifiers.isEmpty {
        notificationCenter.removeDeliveredNotifications(
          withIdentifiers: Array(deliveredIdentifiers)
        )
      }

      var alarmKitDeliveryCount = 0
      #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
      if #available(iOS 26.0, *) {
        let appAlarms = try AlarmManager.shared.alarms
        alarmKitDeliveryCount = appAlarms.count
        var cancellationError: Error?
        for alarm in appAlarms {
          if alarm.state == .alerting {
            do {
              try AlarmManager.shared.stop(id: alarm.id)
            } catch {
              // A state transition may race stop(); cancel below remains the
              // authoritative removal operation.
            }
          }
          do {
            try AlarmManager.shared.cancel(id: alarm.id)
          } catch {
            cancellationError = cancellationError ?? error
          }
        }
        if let cancellationError {
          throw cancellationError
        }
      }
      #endif

      await systemMutex.release()
      return hadStoredState ||
        hadFireEvidence ||
        hadActionEvidence ||
        hadNavigationEvidence ||
        !storedAlarms.isEmpty ||
        !pendingIdentifiers.isEmpty ||
        !deliveredIdentifiers.isEmpty ||
        alarmKitDeliveryCount > 0
    } catch {
      await systemMutex.release()
      throw error
    }
  }

  func restoreAndReconcile(
    nowMilliseconds: Int64 = NoLateAlarmCoordinator.currentTimeMilliseconds()
  ) async throws {
    try requireHealthyStore()
    try await reconcileObservedAlarmFireEvents(nowMilliseconds: nowMilliseconds)
    pruneTombstones(nowMilliseconds: nowMilliseconds)
    try persistSnapshot()

    for tombstone in Array(snapshot.tombstones.values) {
      try await cancelSystemDeliveryIfTombstoneIsCurrent(tombstone)
    }

    let pendingNotificationIds = Set(
      await notificationCenter.pendingNotificationRequests().map(\.identifier)
    )
    #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
    let alarmKitIds: Set<UUID>
    if #available(iOS 26.0, *) {
      alarmKitIds = Set(((try? AlarmManager.shared.alarms) ?? []).map(\.id))
    } else {
      alarmKitIds = []
    }
    #endif

    let alarmsAtStart = snapshot.alarms.values.sorted {
      $0.alarmId < $1.alarmId
    }
    for alarm in alarmsAtStart {
      guard snapshot.alarms[alarm.alarmId]?.hasSameIdentity(as: alarm) == true else {
        continue
      }
      if
        NoLateAlarmRecoveryPolicy.disposition(
          triggerAtMilliseconds: alarm.effectiveTriggerAtMilliseconds,
          nowMilliseconds: nowMilliseconds
        ) == .expire
      {
        snapshot.alarms.removeValue(forKey: alarm.alarmId)
        let tombstone = NoLateAlarmTombstone(
          alarmId: alarm.alarmId,
          generation: alarm.generation,
          updatedAtMilliseconds: nowMilliseconds
        )
        snapshot.tombstones[alarm.alarmId] = tombstone
        try persistSnapshot()
        try await cancelSystemDeliveryIfTombstoneIsCurrent(tombstone)
        continue
      }

      let isScheduled: Bool
      switch alarm.deliveryMode {
      case .timeSensitive:
        isScheduled = pendingNotificationIds.contains(
          Self.notificationIdentifier(for: alarm)
        )
      case .alarmKit:
        #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
        if #available(iOS 26.0, *) {
          isScheduled = alarmKitIds.contains(Self.systemUUID(for: alarm))
        } else {
          isScheduled = false
        }
        #else
        isScheduled = false
        #endif
      }
      if
        NoLateAlarmRecoveryPolicy.shouldReschedule(
          alarmState: alarm.state,
          isSystemDeliveryPresent: isScheduled,
          triggerAtMilliseconds: alarm.effectiveTriggerAtMilliseconds,
          nowMilliseconds: nowMilliseconds
        )
      {
        // `.pendingPermission` is also the durable pre-schedule state. Even
        // when the stable system ID exists, it may still represent the prior
        // generation if the process died between persisting and replacement.
        _ = try await schedulePersisted(
          alarm,
          requestAuthorization: false,
          applied: false
        )
      } else if isScheduled {
        if alarm.state != .scheduled {
          var repaired = alarm
          repaired.state = .scheduled
          repaired.updatedAtMilliseconds = nowMilliseconds
          snapshot.alarms[alarm.alarmId] = repaired
          try persistSnapshot()
        }
      }
    }

    let knownNotificationIds = Set(
      snapshot.alarms.values.map(Self.notificationIdentifier(for:))
    )
    let orphanedNotificationIds = pendingNotificationIds.filter {
      $0.hasPrefix(Self.notificationIdentifierPrefix) &&
        !knownNotificationIds.contains($0)
    }
    if !orphanedNotificationIds.isEmpty {
      notificationCenter.removePendingNotificationRequests(
        withIdentifiers: Array(orphanedNotificationIds)
      )
    }

    #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
    if #available(iOS 26.0, *) {
      let capturedOrphanedAlarmKitIds = alarmKitIds.filter { id in
        !snapshot.alarms.values.contains {
          $0.deliveryMode == .alarmKit && Self.systemUUID(for: $0) == id
        }
      }
      for id in capturedOrphanedAlarmKitIds {
        try await cancelAlarmKitDeliveryIfStillUnknown(id: id)
      }
    }
    #endif
  }

  func getPendingAlarmFireEvents() async throws -> [[String: Any]] {
    try requireHealthyStore()
    try await reconcileObservedAlarmFireEvents(
      nowMilliseconds: NoLateAlarmCoordinator.currentTimeMilliseconds()
    )
    return try fireJournal.load().map { event in
      var result: [String: Any] = [
        "eventId": event.eventId,
        "alarmId": event.alarmId,
        "scheduleId": event.scheduleId,
        "generation": Double(event.generation),
        "recipientMemberId": Double(event.recipientMemberId),
        "scheduledFor": NoLateAlarmDateFormatter.isoString(
          milliseconds: event.scheduledForMilliseconds
        ),
        "sourceTriggerAt": NoLateAlarmDateFormatter.isoString(
          milliseconds: event.sourceTriggerAtMilliseconds
        ),
        "occurredAt": NoLateAlarmDateFormatter.isoString(
          milliseconds: event.occurredAtMilliseconds
        ),
        "timingBasis": (
          event.timingBasis ?? .observedAlerting
        ).rawValue
      ]
      if let logicalEventKey = event.logicalEventKey {
        result["logicalEventKey"] = logicalEventKey
      }
      if let occurrenceId = event.occurrenceId {
        result["occurrenceId"] = occurrenceId
      }
      return result
    }
  }

  func removeAlarmFireEvent(eventId: String) throws -> Bool {
    guard !eventId.isEmpty, eventId.count <= 200 else { return false }
    return try fireJournal.remove(eventId: eventId)
  }

  /**
   * A UNNotificationResponse is durable proof that a time-sensitive alarm was presented even when
   * iOS removes its notification-center row before deliveredNotifications() reconciliation. Commit
   * fire evidence first, then tombstone/cancel the consumed physical occurrence so recovery cannot
   * re-install an alert the user already handled.
   */
  func recordTimeSensitiveNotificationResponse(
    _ response: NoLateValidatedNotificationResponseFire
  ) async throws -> Bool {
    try requireHealthyStore()
    guard
      let alarm = snapshot.alarms[response.nativeAlarmId],
      NoLateAlarmNotificationResponsePolicy.matches(alarm: alarm, response: response)
    else {
      // Ordinary remote visible pushes do not own a stored physical native alarm.
      return false
    }
    try recordObservedFireEvent(
      for: alarm,
      occurredAtMilliseconds: response.occurredAtMilliseconds,
      timingBasis: .observedAlerting
    )
    try await finishAlarmAfterCommittedUserIntent(
      alarm,
      nowMilliseconds: NoLateAlarmCoordinator.currentTimeMilliseconds()
    )
    return true
  }

  func recordDepartureActionEvent(
    _ event: NoLateStoredDepartureActionEvent
  ) throws -> Bool {
    try requireHealthyStore()
    guard
      !event.eventId.isEmpty,
      event.eventId.count <= 200,
      Int64(event.scheduleId) != nil,
      event.alarmId == "schedule:\(event.scheduleId):member:\(event.recipientMemberId)",
      event.generation >= 0,
      event.generation <= noLateMaximumSafeJavaScriptInteger,
      event.occurredAtMilliseconds >= 0,
      event.occurredAtMilliseconds <= noLateMaximumSafeJavaScriptInteger,
      (try? NoLateAlarmInput.normalizedActionEventKey(event.actionEventKey)) != nil
    else {
      return false
    }
    try actionJournal.record(event)
    return true
  }

  func getPendingDepartureActionEvents() throws -> [[String: Any]] {
    try requireHealthyStore()
    return try actionJournal.load().map { event in
      var result: [String: Any] = [
        "eventId": event.eventId,
        "alarmId": event.alarmId,
        "scheduleId": event.scheduleId,
        "generation": Double(event.generation),
        "recipientMemberId": Double(event.recipientMemberId),
        "actionEventKey": event.actionEventKey,
        "occurredAt": NoLateAlarmDateFormatter.isoString(
          milliseconds: event.occurredAtMilliseconds
        ),
        "requiresRouteNavigation": event.requiresRouteNavigation,
        "routeNavigationDelivered": event.routeNavigationDelivered
      ]
      if let occurrenceId = event.occurrenceId {
        result["occurrenceId"] = occurrenceId
      }
      return result
    }
  }

  func markDepartureActionNavigationDelivered(eventId: String) throws -> Bool {
    guard !eventId.isEmpty, eventId.count <= 200 else { return false }
    return try actionJournal.markNavigationDelivered(eventId: eventId)
  }

  func removeDepartureActionEvent(eventId: String) throws -> Bool {
    guard !eventId.isEmpty, eventId.count <= 200 else { return false }
    return try actionJournal.remove(eventId: eventId)
  }

  func getPendingAlarmNavigationEvents() throws -> [[String: Any]] {
    try requireHealthyStore()
    return try navigationJournal.load().map { event in
      [
        "eventId": event.eventId,
        "scheduleId": event.scheduleId,
        "recipientMemberId": Double(event.recipientMemberId),
        "occurredAt": NoLateAlarmDateFormatter.isoString(
          milliseconds: event.occurredAtMilliseconds
        )
      ]
    }
  }

  func removeAlarmNavigationEvent(eventId: String) throws -> Bool {
    guard !eventId.isEmpty, eventId.count <= 200 else { return false }
    return try navigationJournal.remove(eventId: eventId)
  }

  /** AlarmKit secondary action: commit fire then action before stopping; never enqueue navigation. */
  func performDepartureActionFromAlarmKit(
    physicalAlarmId: String,
    nowMilliseconds: Int64 = NoLateAlarmCoordinator.currentTimeMilliseconds()
  ) async throws -> Bool {
    try requireHealthyStore()
    guard
      let alarm = snapshot.alarms[physicalAlarmId],
      let recipientMemberId = alarm.recipientMemberId,
      Int64(alarm.scheduleId) != nil,
      alarm.backendAlarmId == "schedule:\(alarm.scheduleId):member:\(recipientMemberId)"
    else {
      return false
    }
    let actionEventKey = Self.actionEventKey(for: alarm)
    let event = NoLateStoredDepartureActionEvent(
      eventId: UUID().uuidString.lowercased(),
      alarmId: alarm.backendAlarmId,
      scheduleId: alarm.scheduleId,
      generation: alarm.generation,
      recipientMemberId: recipientMemberId,
      occurrenceId: alarm.occurrenceId,
      actionEventKey: actionEventKey,
      occurredAtMilliseconds: nowMilliseconds,
      requiresRouteNavigation: false,
      routeNavigationDelivered: false
    )
    try NoLateAlarmIntentCommitSequence.recordFireThenInteraction(
      recordFire: {
        try recordObservedFireEvent(
          for: alarm,
          occurredAtMilliseconds: nowMilliseconds,
          timingBasis: .observedAlerting
        )
      },
      recordInteraction: {
        try actionJournal.record(event)
      }
    )
    try await finishAlarmAfterCommittedUserIntent(alarm, nowMilliseconds: nowMilliseconds)
    return true
  }

  /** AlarmKit default/system-stop path: route only, with no departure mutation. */
  func performOpenRouteFromAlarmKit(
    physicalAlarmId: String,
    nowMilliseconds: Int64 = NoLateAlarmCoordinator.currentTimeMilliseconds()
  ) async throws -> Bool {
    try requireHealthyStore()
    guard
      let alarm = snapshot.alarms[physicalAlarmId],
      let recipientMemberId = alarm.recipientMemberId,
      Int64(alarm.scheduleId) != nil,
      alarm.backendAlarmId == "schedule:\(alarm.scheduleId):member:\(recipientMemberId)"
    else {
      return false
    }
    let navigationEvent = NoLateStoredAlarmNavigationEvent(
      eventId: NoLateAlarmNavigationIdentity.eventId(
        physicalAlarmId: alarm.alarmId,
        generation: alarm.generation
      ),
      scheduleId: alarm.scheduleId,
      recipientMemberId: recipientMemberId,
      occurredAtMilliseconds: nowMilliseconds
    )
    try NoLateAlarmIntentCommitSequence.recordFireThenInteraction(
      recordFire: {
        try recordObservedFireEvent(
          for: alarm,
          occurredAtMilliseconds: nowMilliseconds,
          timingBasis: .observedAlerting
        )
      },
      recordInteraction: {
        try navigationJournal.record(navigationEvent)
      }
    )
    try await finishAlarmAfterCommittedUserIntent(alarm, nowMilliseconds: nowMilliseconds)
    return true
  }

  private func finishAlarmAfterCommittedUserIntent(
    _ alarm: NoLateStoredAlarm,
    nowMilliseconds: Int64
  ) async throws {
    guard snapshot.alarms[alarm.alarmId]?.hasSameIdentity(as: alarm) == true else {
      return
    }
    var committedSnapshot = snapshot
    committedSnapshot.alarms.removeValue(forKey: alarm.alarmId)
    committedSnapshot.tombstones[alarm.alarmId] = NoLateAlarmTombstone(
      alarmId: alarm.alarmId,
      generation: alarm.generation,
      updatedAtMilliseconds: nowMilliseconds
    )
    // Do not expose an in-memory tombstone until the same state is durable. Otherwise a failed
    // save followed by response replay looks like a benign already-committed `false` and can erase
    // the only OS response record while the old alarm remains persisted on disk.
    try requireHealthyStore()
    try store.save(committedSnapshot)
    snapshot = committedSnapshot
    try await cancelSystemDelivery(for: alarm)
  }

  private func reconcileDeliveredNotificationFireEvents() async throws {
    let delivered = await notificationCenter.deliveredNotifications()
    for notification in delivered {
      guard
        let alarm = snapshot.alarms.values.first(where: {
          $0.deliveryMode == .timeSensitive &&
            notification.request.identifier == Self.notificationIdentifier(for: $0)
        }),
        alarm.recipientMemberId != nil
      else {
        continue
      }
      let userInfo = notification.request.content.userInfo
      guard NoLateAlarmDeliveredNotificationPolicy.matches(
        alarm: alarm,
        deliveredAlarmId: (userInfo["nativeAlarmId"] as? String) ??
          (userInfo["alarmId"] as? String),
        deliveredScheduleId: userInfo["scheduleId"] as? String,
        deliveredGeneration: Self.int64Value(userInfo["alarmGeneration"])
      ) else {
        continue
      }
      try recordObservedFireEvent(
        for: alarm,
        occurredAtMilliseconds: Int64((notification.date.timeIntervalSince1970 * 1_000).rounded()),
        timingBasis: .observedAlerting
      )
    }
  }

  private func reconcileObservedAlarmFireEvents(
    nowMilliseconds: Int64
  ) async throws {
    #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
    if #available(iOS 26.0, *) {
      try await reconcileAlertingAlarmKitFireEvents(
        nowMilliseconds: nowMilliseconds
      )
    }
    #endif
    try await reconcileDeliveredNotificationFireEvents()
  }

  private func recordObservedFireEvent(
    for alarm: NoLateStoredAlarm,
    occurredAtMilliseconds: Int64,
    timingBasis: NoLateAlarmFireTimingBasis
  ) throws {
    guard
      let recipientMemberId = alarm.recipientMemberId,
      Int64(alarm.scheduleId) != nil,
      alarm.backendAlarmId == "schedule:\(alarm.scheduleId):member:\(recipientMemberId)"
    else {
      return
    }
    try fireJournal.record(NoLateStoredAlarmFireEvent(
      eventId: UUID().uuidString.lowercased(),
      alarmId: alarm.backendAlarmId,
      scheduleId: alarm.scheduleId,
      generation: alarm.generation,
      recipientMemberId: recipientMemberId,
      scheduledForMilliseconds: alarm.effectiveTriggerAtMilliseconds,
      sourceTriggerAtMilliseconds: alarm.sourceTriggerAtMilliseconds,
      occurredAtMilliseconds: occurredAtMilliseconds,
      timingBasis: timingBasis,
      logicalEventKey: alarm.logicalEventKey,
      occurrenceId: alarm.occurrenceId
    ))
  }

  private func schedulePersisted(
    _ alarm: NoLateStoredAlarm,
    requestAuthorization: Bool,
    applied: Bool
  ) async throws -> NoLateAlarmMutationResult {
    guard snapshot.alarms[alarm.alarmId]?.hasSameIdentity(as: alarm) == true else {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "STALE_GENERATION"
      )
    }

    let outcome = await scheduleSystemDelivery(
      for: alarm,
      requestAuthorization: requestAuthorization
    )
    guard snapshot.alarms[alarm.alarmId]?.hasSameIdentity(as: alarm) == true else {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "STALE_GENERATION"
      )
    }

    var updated = alarm
    updated.updatedAtMilliseconds = Self.currentTimeMilliseconds()
    switch outcome {
    case .scheduled(let deliveryMode, let warning):
      updated.deliveryMode = deliveryMode
      updated.state = .scheduled
      snapshot.alarms[alarm.alarmId] = updated
      try persistSnapshot()
      return NoLateAlarmMutationResult(
        applied: applied,
        scheduled: true,
        reason: warning,
        deliveryMode: deliveryMode
      )
    case .permissionRequired(let deliveryMode, let reason):
      updated.deliveryMode = deliveryMode
      updated.state = .pendingPermission
      snapshot.alarms[alarm.alarmId] = updated
      try persistSnapshot()
      return NoLateAlarmMutationResult(
        applied: applied,
        scheduled: false,
        reason: reason,
        deliveryMode: deliveryMode
      )
    case .failed(let deliveryMode, let reason):
      updated.deliveryMode = deliveryMode
      updated.state = .pendingPermission
      snapshot.alarms[alarm.alarmId] = updated
      try persistSnapshot()
      return NoLateAlarmMutationResult(
        applied: applied,
        scheduled: false,
        reason: reason,
        deliveryMode: deliveryMode
      )
    }
  }

  private func scheduleSystemDelivery(
    for alarm: NoLateStoredAlarm,
    requestAuthorization: Bool
  ) async -> NoLateSystemScheduleOutcome {
    await systemMutex.acquire()
    let result = await scheduleSystemDeliveryUnlocked(
      for: alarm,
      requestAuthorization: requestAuthorization
    )
    await systemMutex.release()
    return result
  }

  private func scheduleSystemDeliveryUnlocked(
    for alarm: NoLateStoredAlarm,
    requestAuthorization: Bool
  ) async -> NoLateSystemScheduleOutcome {
    #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
    if #available(iOS 26.0, *) {
      return await scheduleAlarmKit(
        alarm,
        requestAuthorization: requestAuthorization
      )
    }
    #endif
    return await scheduleTimeSensitiveNotification(
      alarm,
      requestAuthorization: requestAuthorization
    )
  }

  private func scheduleTimeSensitiveNotification(
    _ alarm: NoLateStoredAlarm,
    requestAuthorization: Bool
  ) async -> NoLateSystemScheduleOutcome {
    var settings = await notificationCenter.notificationSettings()
    if
      settings.authorizationStatus == .notDetermined,
      requestAuthorization
    {
      do {
        _ = try await notificationCenter.requestAuthorization(
          options: [.alert, .badge, .sound]
        )
        settings = await notificationCenter.notificationSettings()
      } catch {
        return .failed(
          .timeSensitive,
          reason: "NOTIFICATION_AUTHORIZATION_ERROR"
        )
      }
    }
    guard Self.canDeliverNotifications(settings.authorizationStatus) else {
      let reason = settings.authorizationStatus == .notDetermined
        ? "NOTIFICATION_PERMISSION_NOT_DETERMINED"
        : "NOTIFICATION_PERMISSION_REQUIRED"
      return .permissionRequired(.timeSensitive, reason: reason)
    }
    guard settings.alertSetting != .disabled else {
      return .permissionRequired(
        .timeSensitive,
        reason: "NOTIFICATION_ALERTS_DISABLED"
      )
    }

    let content = UNMutableNotificationContent()
    content.title = alarm.title ?? "출발 시간입니다"
    content.body = alarm.body ?? "지금 출발하면 예정된 시간에 도착할 수 있어요."
    content.sound = .default
    content.categoryIdentifier = "schedule_depart_now"
    content.threadIdentifier = "departure-reminder"
    content.interruptionLevel = .timeSensitive
    let actionEventKey = Self.actionEventKey(for: alarm)
    var userInfo: [AnyHashable: Any] = [
      "type": "SCHEDULE_DEPARTURE_REMINDER",
      "scheduleId": alarm.scheduleId,
      "alarmId": alarm.backendAlarmId,
      "nativeAlarmId": alarm.alarmId,
      "alarmGeneration": String(alarm.generation),
      "recipientMemberId": String(alarm.recipientMemberId ?? 0),
      "actionEventKey": actionEventKey
    ]
    if let occurrenceId = alarm.occurrenceId {
      userInfo["occurrenceId"] = occurrenceId
    }
    if let logicalEventKey = alarm.logicalEventKey {
      userInfo["logicalEventKey"] = logicalEventKey
    }
    if let decision = alarm.decision {
      userInfo["decision"] = decision
    }
    userInfo["body"] = content.body
    content.userInfo = userInfo

    let fireDate = Date(
      timeIntervalSince1970:
        Double(alarm.effectiveTriggerAtMilliseconds) / 1_000
    )
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    var components = calendar.dateComponents(
      [.year, .month, .day, .hour, .minute, .second],
      from: fireDate
    )
    components.calendar = calendar
    components.timeZone = calendar.timeZone
    let request = UNNotificationRequest(
      identifier: Self.notificationIdentifier(for: alarm),
      content: content,
      trigger: UNCalendarNotificationTrigger(
        dateMatching: components,
        repeats: false
      )
    )
    do {
      try await notificationCenter.add(request)
    } catch {
      return .failed(.timeSensitive, reason: "NOTIFICATION_SCHEDULE_FAILED")
    }

    let warning: String?
    if settings.timeSensitiveSetting != .enabled {
      warning = "TIME_SENSITIVE_DISABLED"
    } else if settings.soundSetting != .enabled {
      warning = "SOUND_DISABLED"
    } else if settings.authorizationStatus == .provisional {
      warning = "PROVISIONAL_NOTIFICATION_AUTHORIZATION"
    } else {
      warning = nil
    }
    return .scheduled(.timeSensitive, warning: warning)
  }

  #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
  @available(iOS 26.0, *)
  private func scheduleAlarmKit(
    _ alarm: NoLateStoredAlarm,
    requestAuthorization: Bool
  ) async -> NoLateSystemScheduleOutcome {
    let manager = AlarmManager.shared
    var authorizationState = manager.authorizationState
    if authorizationState == .notDetermined, requestAuthorization {
      do {
        authorizationState = try await manager.requestAuthorization()
      } catch {
        return .failed(.alarmKit, reason: "ALARM_AUTHORIZATION_ERROR")
      }
    }
    guard authorizationState == .authorized else {
      let reason = authorizationState == .notDetermined
        ? "ALARM_AUTHORIZATION_NOT_DETERMINED"
        : "ALARM_AUTHORIZATION_DENIED"
      return .permissionRequired(.alarmKit, reason: reason)
    }

    // AlarmKit exposes one alert-title slot and no body slot. Keep both server strings by
    // synthesizing a bounded, readable title instead of dropping the occurrence body.
    let title = LocalizedStringResource(
      String.LocalizationValue(NoLateAlarmPresentationPolicy.alarmKitAlertTitle(
        title: alarm.title,
        body: alarm.body
      ))
    )
    let stopButton = AlarmButton(
      text: "중지",
      textColor: .white,
      systemImageName: "stop.circle.fill"
    )
    let departButton = AlarmButton(
      text: "지금 출발 완료",
      textColor: .white,
      systemImageName: "figure.walk.circle.fill"
    )
    let alert: AlarmPresentation.Alert
    if #available(iOS 26.1, *) {
      alert = AlarmPresentation.Alert(
        title: title,
        secondaryButton: departButton,
        secondaryButtonBehavior: .custom
      )
    } else {
      alert = AlarmPresentation.Alert(
        title: title,
        stopButton: stopButton,
        secondaryButton: departButton,
        secondaryButtonBehavior: .custom
      )
    }
    let attributes = AlarmAttributes(
      presentation: AlarmPresentation(alert: alert),
      metadata: NoLateAlarmMetadata(
        alarmId: alarm.alarmId,
        logicalAlarmId: alarm.backendAlarmId,
        scheduleId: alarm.scheduleId,
        generation: alarm.generation,
        occurrenceId: alarm.occurrenceId,
        actionEventKey: Self.actionEventKey(for: alarm)
      ),
      tintColor: Color(red: 0.95, green: 0.38, blue: 0.17)
    )
    let configuration = AlarmManager.AlarmConfiguration.alarm(
      schedule: .fixed(
        Date(
          timeIntervalSince1970:
            Double(alarm.effectiveTriggerAtMilliseconds) / 1_000
        )
      ),
      attributes: attributes,
      // AlarmKit has no independent body-tap intent. The system stop/default path is the closest
      // supported route entry and remains navigation-only; it never commits departure.
      stopIntent: NoLateOpenRouteAlarmIntent(physicalAlarmId: alarm.alarmId),
      secondaryIntent: NoLateDepartNowAlarmIntent(physicalAlarmId: alarm.alarmId),
      sound: .default
    )
    let id = Self.systemUUID(for: alarm)
    notificationCenter.removePendingNotificationRequests(
      withIdentifiers: [Self.notificationIdentifier(for: alarm)]
    )
    notificationCenter.removeDeliveredNotifications(
      withIdentifiers: [Self.notificationIdentifier(for: alarm)]
    )
    try? manager.cancel(id: id)
    do {
      _ = try await manager.schedule(id: id, configuration: configuration)
      return .scheduled(.alarmKit, warning: nil)
    } catch AlarmManager.AlarmError.maximumLimitReached {
      return .failed(.alarmKit, reason: "ALARM_MAXIMUM_LIMIT_REACHED")
    } catch {
      return .failed(.alarmKit, reason: "ALARM_SCHEDULE_FAILED")
    }
  }

  @available(iOS 26.0, *)
  private static func alarmKitAuthorizationLabel(
    _ state: AlarmManager.AuthorizationState
  ) -> String {
    switch state {
    case .notDetermined:
      return "notDetermined"
    case .denied:
      return "denied"
    case .authorized:
      return "authorized"
    @unknown default:
      return "unknown"
    }
  }
  #endif

  private func cancelSystemDelivery(for alarm: NoLateStoredAlarm) async throws {
    try await cancelSystemDelivery(alarmId: alarm.alarmId)
  }

  private func cancelSystemDelivery(alarmId: String) async throws {
    await systemMutex.acquire()
    do {
      try cancelSystemDeliveryUnlocked(alarmId: alarmId)
      await systemMutex.release()
    } catch {
      await systemMutex.release()
      throw error
    }
  }

  private func cancelSystemDeliveryIfTombstoneIsCurrent(
    _ captured: NoLateAlarmTombstone
  ) async throws {
    await systemMutex.acquire()
    do {
      // Acquiring the mutex suspends this actor, so a newer UPSERT may have
      // removed the captured tombstone. Re-check immediately before the
      // synchronous system cancel to avoid deleting that newer desired alarm.
      let mayCancel = NoLateAlarmRecoveryPolicy.mayCancelTombstonedDelivery(
        captured: captured,
        current: snapshot.tombstones[captured.alarmId],
        activeAlarm: snapshot.alarms[captured.alarmId]
      )
      if mayCancel {
        try cancelSystemDeliveryUnlocked(alarmId: captured.alarmId)
      }
      await systemMutex.release()
    } catch {
      await systemMutex.release()
      throw error
    }
  }

  #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
  @available(iOS 26.0, *)
  private func reconcileAlertingAlarmKitFireEvents(
    nowMilliseconds: Int64
  ) async throws {
    await systemMutex.acquire()
    do {
      // A provider read failure must not look like an empty daemon store: that would turn every
      // elapsed alarm into false execution evidence.
      let systemAlarms = try AlarmManager.shared.alarms
      let allSystemIds = Set(systemAlarms.map(\.id))
      let activeSystemIds = Set(
        systemAlarms.filter { $0.state == .alerting }.map(\.id)
      )
      let activeStored = snapshot.alarms.values.filter {
        $0.deliveryMode == .alarmKit &&
          $0.state == .scheduled &&
          activeSystemIds.contains(Self.systemUUID(for: $0))
      }
      for alarm in activeStored {
        try recordObservedFireEvent(
          for: alarm,
          occurredAtMilliseconds: nowMilliseconds,
          timingBasis: .observedAlerting
        )
      }
      let stoppedAfterFire = snapshot.alarms.values.filter { alarm in
        NoLateAlarmRecoveryPolicy.shouldInferMissingAlarmKitFire(
          alarm: alarm,
          isSystemDeliveryPresent: allSystemIds.contains(Self.systemUUID(for: alarm)),
          nowMilliseconds: nowMilliseconds
        )
      }
      for alarm in stoppedAfterFire {
        // AlarmKit proves that the persisted one-shot delivery disappeared after its trigger, not
        // the exact callback instant. Store the scheduled instant as the bounded estimate and keep
        // the distinct timing basis out of exact-delay metrics.
        try recordObservedFireEvent(
          for: alarm,
          occurredAtMilliseconds: alarm.effectiveTriggerAtMilliseconds,
          timingBasis: .inferredOSDelivery
        )
      }
      await systemMutex.release()
    } catch {
      await systemMutex.release()
      throw error
    }
  }

  @available(iOS 26.0, *)
  private func stopAlertingAlarmKitDeliveries(
    nowMilliseconds: Int64
  ) async throws -> (
    storedAlarmIds: Set<String>,
    stoppedSystemDelivery: Bool
  ) {
    await systemMutex.acquire()
    do {
      // Read both AlarmKit and the current snapshot only after acquiring the
      // same mutex used by UPSERT/CANCEL. Stable UUIDs intentionally span
      // generations, so matching before the lock could tombstone a newer
      // desired generation while an older one is still alerting.
      let activeSystemIds = Set(
        ((try? AlarmManager.shared.alarms) ?? [])
          .filter { $0.state == .alerting }
          .map(\.id)
      )
      let activeStored = snapshot.alarms.values.filter {
        $0.deliveryMode == .alarmKit &&
          $0.state == .scheduled &&
          activeSystemIds.contains(Self.systemUUID(for: $0))
      }
      let stoppedStoredIds = Set(activeStored.map(\.alarmId))

      if !activeStored.isEmpty {
        for alarm in activeStored {
          // This is the last mutation point before AlarmKit stop/cancel removes
          // the observable `.alerting` state.
          try recordObservedFireEvent(
            for: alarm,
            occurredAtMilliseconds: nowMilliseconds,
            timingBasis: .observedAlerting
          )
          snapshot.alarms.removeValue(forKey: alarm.alarmId)
          snapshot.tombstones[alarm.alarmId] = NoLateAlarmTombstone(
            alarmId: alarm.alarmId,
            generation: alarm.generation,
            updatedAtMilliseconds: nowMilliseconds
          )
        }
        try persistSnapshot()
      }

      // AlarmManager.alarms is scoped to this app. Stop alerting orphans too,
      // but only current `.scheduled` records become tombstones.
      for id in activeSystemIds {
        try? AlarmManager.shared.stop(id: id)
        try? AlarmManager.shared.cancel(id: id)
      }
      await systemMutex.release()
      return (
        storedAlarmIds: stoppedStoredIds,
        stoppedSystemDelivery: !activeSystemIds.isEmpty
      )
    } catch {
      await systemMutex.release()
      throw error
    }
  }

  @available(iOS 26.0, *)
  private func cancelAlarmKitDeliveryIfStillUnknown(id: UUID) async throws {
    await systemMutex.acquire()
    do {
      // A newer UPSERT can run while this actor is suspended on the mutex.
      // Protect its stable ID by checking the current desired state immediately
      // before touching AlarmKit.
      let isKnown = snapshot.alarms.values.contains {
        $0.deliveryMode == .alarmKit && Self.systemUUID(for: $0) == id
      }
      if
        !isKnown,
        try AlarmManager.shared.alarms.contains(where: { $0.id == id })
      {
        try AlarmManager.shared.cancel(id: id)
      }
      await systemMutex.release()
    } catch {
      await systemMutex.release()
      throw error
    }
  }
  #endif

  private func cancelSystemDeliveryUnlocked(alarmId: String) throws {
    let notificationIdentifier =
      NoLateAlarmSystemIdentifier.notificationRequestIdentifier(alarmId: alarmId)
    notificationCenter.removePendingNotificationRequests(
      withIdentifiers: [notificationIdentifier]
    )
    notificationCenter.removeDeliveredNotifications(
      withIdentifiers: [notificationIdentifier]
    )

    #if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
    if #available(iOS 26.0, *) {
      let id = NoLateAlarmSystemIdentifier.uuid(
        alarmId: alarmId
      )
      if try AlarmManager.shared.alarms.contains(where: { $0.id == id }) {
        try AlarmManager.shared.cancel(id: id)
      }
    }
    #endif
  }

  private func pruneTombstones(nowMilliseconds: Int64) {
    snapshot.tombstones = snapshot.tombstones.filter { _, tombstone in
      let age = nowMilliseconds - tombstone.updatedAtMilliseconds
      return age <= noLateTombstoneRetentionMilliseconds
    }
  }

  private func persistSnapshot() throws {
    try requireHealthyStore()
    try store.save(snapshot)
  }

  private func requireHealthyStore() throws {
    if let initialPersistenceError {
      throw initialPersistenceError
    }
  }

  private static func systemUUID(for alarm: NoLateStoredAlarm) -> UUID {
    NoLateAlarmSystemIdentifier.uuid(alarmId: alarm.alarmId)
  }

  private static func notificationIdentifier(for alarm: NoLateStoredAlarm) -> String {
    NoLateAlarmSystemIdentifier.notificationRequestIdentifier(alarmId: alarm.alarmId)
  }

  private static func actionEventKey(for alarm: NoLateStoredAlarm) -> String {
    if let actionEventKey = alarm.actionEventKey {
      return actionEventKey
    }
    if
      let logicalEventKey = alarm.logicalEventKey,
      (try? NoLateAlarmInput.normalizedActionEventKey(logicalEventKey)) != nil
    {
      return logicalEventKey
    }
    return NoLateAlarmActionIdentity.fallbackKey(
      physicalAlarmId: alarm.alarmId,
      generation: alarm.generation
    )
  }

  private static let notificationIdentifierPrefix = "nolate.departure."

  private static func currentTimeMilliseconds() -> Int64 {
    Int64((Date().timeIntervalSince1970 * 1_000).rounded())
  }

  private static func canDeliverNotifications(
    _ status: UNAuthorizationStatus
  ) -> Bool {
    switch status {
    case .authorized, .provisional, .ephemeral:
      return true
    case .notDetermined, .denied:
      return false
    @unknown default:
      return false
    }
  }

  private static func authorizationLabel(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
      return "notDetermined"
    case .denied:
      return "denied"
    case .authorized:
      return "authorized"
    case .provisional:
      return "provisional"
    case .ephemeral:
      return "ephemeral"
    @unknown default:
      return "unknown"
    }
  }

  private static func settingLabel(_ setting: UNNotificationSetting) -> String {
    switch setting {
    case .notSupported:
      return "notSupported"
    case .disabled:
      return "disabled"
    case .enabled:
      return "enabled"
    @unknown default:
      return "unknown"
    }
  }

  private static func int64Value(_ value: Any?) -> Int64? {
    if let value = value as? String {
      return Int64(value)
    }
    if let value = value as? NSNumber {
      return value.int64Value
    }
    return nil
  }
}

#if canImport(AlarmKit) && !targetEnvironment(macCatalyst)
@available(iOS 26.0, *)
private struct NoLateAlarmMetadata: AlarmMetadata {
  let alarmId: String
  let logicalAlarmId: String
  let scheduleId: String
  let generation: Int64
  let occurrenceId: String?
  let actionEventKey: String
}
#endif

enum NoLateAlarmSettingsOpener {
  @MainActor
  static func open(preferNotificationSettings: Bool) async -> Bool {
    let rawURL: String
    if preferNotificationSettings {
      rawURL = UIApplication.openNotificationSettingsURLString
    } else {
      rawURL = UIApplication.openSettingsURLString
    }
    guard let url = URL(string: rawURL) else {
      return false
    }
    return await UIApplication.shared.open(url)
  }
}
