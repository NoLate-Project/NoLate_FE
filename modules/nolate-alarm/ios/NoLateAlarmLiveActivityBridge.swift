import Foundation

/**
 * Narrow public entry point for app-target LiveActivityIntent execution.
 *
 * It deliberately accepts no authentication material and commits through the same durable,
 * idempotent departure-action journal that the JavaScript bridge drains after app activation.
 */
public enum NoLateAlarmDepartureActionBridge {
  public static func recordFromLiveActivity(
    scheduleId: String,
    recipientMemberId: Int64,
    generation: Int64,
    actionEventKey: String,
    occurredAtMilliseconds: Int64
  ) async throws -> Bool {
    let normalizedScheduleId = scheduleId.trimmingCharacters(in: .whitespacesAndNewlines)
    let alarmId = "schedule:\(normalizedScheduleId):member:\(recipientMemberId)"
    return try await NoLateAlarmCoordinator.shared.recordDepartureActionEvent(
      NoLateStoredDepartureActionEvent(
        eventId: UUID().uuidString.lowercased(),
        alarmId: alarmId,
        scheduleId: normalizedScheduleId,
        generation: generation,
        recipientMemberId: recipientMemberId,
        occurrenceId: nil,
        actionEventKey: actionEventKey,
        occurredAtMilliseconds: occurredAtMilliseconds,
        requiresRouteNavigation: false,
        routeNavigationDelivered: false
      )
    )
  }
}
