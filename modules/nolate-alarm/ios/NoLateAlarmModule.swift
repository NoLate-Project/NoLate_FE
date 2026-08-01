import ExpoModulesCore
import Foundation

private struct NoLateUpsertAlarmCommand: Record {
  @Field
  var operation: String = "UPSERT"

  @Field
  var alarmId: String = ""

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
  var snoozeMinutes: Int?
}

private struct NoLateCancelAlarmCommand: Record {
  @Field
  var alarmId: String = ""

  @Field
  var scheduleId: String = ""

  @Field
  var generation: Double = -1
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
          scheduleId: command.scheduleId,
          title: command.title,
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
