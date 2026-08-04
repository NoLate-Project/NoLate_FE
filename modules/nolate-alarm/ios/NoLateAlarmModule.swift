import ExpoModulesCore
import Foundation

private struct NoLateUpsertAlarmCommand: Record {
  @Field
  var operation: String = "UPSERT"

  @Field
  var alarmId: String = ""

  @Field
  var logicalAlarmId: String = ""

  @Field
  var scheduleId: String = ""

  @Field
  var generation: Double = -1

  @Field
  var recipientMemberId: Double = -1

  @Field
  var logicalEventKey: String?

  @Field
  var triggerAt: String = ""

  @Field
  var title: String?

  @Field
  var body: String?

  @Field
  var occurrenceId: String?

  @Field
  var decision: String?

  @Field
  var minutesBeforeDeparture: Int?

  @Field
  var actionEventKey: String?

  @Field
  var snoozeMinutes: Int?
}

private struct NoLateCancelAlarmCommand: Record {
  @Field
  var alarmId: String = ""

  @Field
  var logicalAlarmId: String?

  @Field
  var scheduleId: String = ""

  @Field
  var generation: Double = -1
}

private struct NoLateDepartureActionEventCommand: Record {
  @Field
  var eventId: String = ""

  @Field
  var alarmId: String = ""

  @Field
  var scheduleId: String = ""

  @Field
  var generation: Double = -1

  @Field
  var recipientMemberId: Double = -1

  @Field
  var occurrenceId: String?

  @Field
  var actionEventKey: String = ""

  @Field
  var occurredAt: String = ""

  @Field
  var requiresRouteNavigation: Bool = false

  @Field
  var routeNavigationDelivered: Bool = false
}

private struct NoLateNotificationResponseFireCommand: Record {
  @Field
  var nativeAlarmId: String = ""

  @Field
  var alarmId: String = ""

  @Field
  var scheduleId: String = ""

  @Field
  var generation: Double = -1

  @Field
  var recipientMemberId: Double = -1

  @Field
  var occurrenceId: String?

  @Field
  var occurredAt: String = ""
}

public final class NoLateAlarmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NoLateAlarm")

    OnCreate {
      Task {
        try? await NoLateAlarmCoordinator.shared.restoreAndReconcile()
      }
    }

    AsyncFunction("getCapabilities") {
      await NoLateAlarmCoordinator.shared.getCapabilities().bridgeMap()
    }

    AsyncFunction("upsertAlarm") { (command: NoLateUpsertAlarmCommand) in
      await Self.mutationOrInvalid {
        let validated = try NoLateAlarmInput.upsert(
          operation: command.operation,
          alarmId: command.alarmId,
          logicalAlarmId: command.logicalAlarmId,
          scheduleId: command.scheduleId,
          title: command.title,
          body: command.body,
          occurrenceId: command.occurrenceId,
          decision: command.decision,
          minutesBeforeDeparture: command.minutesBeforeDeparture,
          actionEventKey: command.actionEventKey,
          generation: command.generation,
          recipientMemberId: command.recipientMemberId,
          logicalEventKey: command.logicalEventKey,
          triggerAt: command.triggerAt,
          snoozeMinutes: command.snoozeMinutes
        )
        return try await NoLateAlarmCoordinator.shared.upsert(validated)
      }
    }

    AsyncFunction("cancelAlarm") { (command: NoLateCancelAlarmCommand) in
      await Self.mutationOrInvalid {
        let validated = try NoLateAlarmInput.cancel(
          alarmId: command.alarmId,
          logicalAlarmId: command.logicalAlarmId,
          scheduleId: command.scheduleId,
          generation: command.generation
        )
        return try await NoLateAlarmCoordinator.shared.cancel(validated)
      }
    }

    AsyncFunction("getScheduledAlarms") {
      do {
        return try await NoLateAlarmCoordinator.shared
          .getScheduledAlarms()
          .map { $0.bridgeMap() }
      } catch {
        return []
      }
    }

    AsyncFunction("openExactAlarmSettings") {
      await NoLateAlarmSettingsOpener.open(
        preferNotificationSettings: !NoLateAlarmRuntime.isAlarmKitAvailable
      )
    }

    AsyncFunction("openFullScreenSettings") {
      await NoLateAlarmSettingsOpener.open(
        preferNotificationSettings: !NoLateAlarmRuntime.isAlarmKitAvailable
      )
    }

    AsyncFunction("scheduleTestAlarm") { (delaySeconds: Int) in
      await Self.mutationOrInvalid {
        try await NoLateAlarmCoordinator.shared.scheduleTestAlarm(
          delaySeconds: delaySeconds
        )
      }
    }

    AsyncFunction("stopRinging") {
      (try? await NoLateAlarmCoordinator.shared.stopRinging()) ?? false
    }

    AsyncFunction("clearAllAlarms") {
      try await NoLateAlarmCoordinator.shared.clearAllAlarms()
    }

    AsyncFunction("getPendingAlarmFireEvents") {
      try await NoLateAlarmCoordinator.shared.getPendingAlarmFireEvents()
    }

    AsyncFunction("removeAlarmFireEvent") { (eventId: String) in
      try await NoLateAlarmCoordinator.shared.removeAlarmFireEvent(eventId: eventId)
    }

    AsyncFunction("recordAlarmNotificationResponseFire") {
      (command: NoLateNotificationResponseFireCommand) in
      let validated: NoLateValidatedNotificationResponseFire
      do {
        validated = try NoLateAlarmInput.notificationResponseFire(
          nativeAlarmId: command.nativeAlarmId,
          alarmId: command.alarmId,
          scheduleId: command.scheduleId,
          generation: command.generation,
          recipientMemberId: command.recipientMemberId,
          occurrenceId: command.occurrenceId,
          occurredAt: command.occurredAt
        )
      } catch {
        // Invalid or forged response metadata is a benign non-match. Coordinator and persistence
        // failures must reject the JS promise so the OS last-response replay record is retained.
        return false
      }
      return try await NoLateAlarmCoordinator.shared
        .recordTimeSensitiveNotificationResponse(validated)
    }

    AsyncFunction("recordDepartureActionEvent") {
      (command: NoLateDepartureActionEventCommand) in
      do {
        let occurrenceId = try NoLateAlarmInput.normalizedOccurrenceId(command.occurrenceId)
        let actionEventKey = try NoLateAlarmInput.normalizedActionEventKey(command.actionEventKey)
        guard let actionEventKey else { return false }
        let eventId = command.eventId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !eventId.isEmpty, eventId.count <= 200 else { return false }
        return try await NoLateAlarmCoordinator.shared.recordDepartureActionEvent(
          NoLateStoredDepartureActionEvent(
            eventId: eventId,
            alarmId: command.alarmId.trimmingCharacters(in: .whitespacesAndNewlines),
            scheduleId: command.scheduleId.trimmingCharacters(in: .whitespacesAndNewlines),
            generation: try NoLateAlarmInput.safeInteger(
              command.generation,
              fieldName: "generation"
            ),
            recipientMemberId: try NoLateAlarmInput.positiveSafeInteger(
              command.recipientMemberId,
              fieldName: "recipientMemberId"
            ),
            occurrenceId: occurrenceId,
            actionEventKey: actionEventKey,
            occurredAtMilliseconds: try NoLateAlarmInput.isoTimestampMilliseconds(
              command.occurredAt
            ),
            requiresRouteNavigation: command.requiresRouteNavigation,
            routeNavigationDelivered: command.routeNavigationDelivered
          )
        )
      } catch {
        return false
      }
    }

    AsyncFunction("getPendingDepartureActionEvents") {
      try await NoLateAlarmCoordinator.shared.getPendingDepartureActionEvents()
    }

    AsyncFunction("markDepartureActionNavigationDelivered") { (eventId: String) in
      try await NoLateAlarmCoordinator.shared.markDepartureActionNavigationDelivered(
        eventId: eventId
      )
    }

    AsyncFunction("removeDepartureActionEvent") { (eventId: String) in
      try await NoLateAlarmCoordinator.shared.removeDepartureActionEvent(eventId: eventId)
    }

    AsyncFunction("getPendingAlarmNavigationEvents") {
      try await NoLateAlarmCoordinator.shared.getPendingAlarmNavigationEvents()
    }

    AsyncFunction("removeAlarmNavigationEvent") { (eventId: String) in
      try await NoLateAlarmCoordinator.shared.removeAlarmNavigationEvent(eventId: eventId)
    }
  }

  private static func mutationOrInvalid(
    _ operation: () async throws -> NoLateAlarmMutationResult
  ) async -> [String: Any] {
    do {
      return (try await operation()).bridgeMap()
    } catch let error as NoLateAlarmValidationError {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "INVALID_COMMAND:\(error.localizedDescription)"
      ).bridgeMap()
    } catch {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "NATIVE_STATE_ERROR:\(error.localizedDescription)"
      ).bridgeMap()
    }
  }
}
