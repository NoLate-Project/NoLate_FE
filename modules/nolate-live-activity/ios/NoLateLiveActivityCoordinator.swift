import ActivityKit
import Foundation

struct NoLateLiveActivityMutationResult: Sendable {
  let supported: Bool
  let applied: Bool
  let operation: String
  let activityId: String?
  let reason: String?
  let endedCount: Int?

  init(
    supported: Bool = true,
    applied: Bool,
    operation: String,
    activityId: String? = nil,
    reason: String? = nil,
    endedCount: Int? = nil
  ) {
    self.supported = supported
    self.applied = applied
    self.operation = operation
    self.activityId = activityId
    self.reason = reason
    self.endedCount = endedCount
  }

  func bridgeMap() -> [String: Any?] {
    [
      "supported": supported,
      "applied": applied,
      "operation": operation,
      "activityId": activityId,
      "reason": reason,
      "endedCount": endedCount
    ]
  }
}

@available(iOS 16.1, *)
actor NoLateLiveActivityCoordinator {
  static let shared = NoLateLiveActivityCoordinator()

  typealias EventSink = (_ name: String, _ body: [String: Any?]) -> Void

  private var eventSink: EventSink?
  private var activityUpdatesTask: Task<Void, Never>?
  private var pushToStartTask: Task<Void, Never>?
  private var updateTokenTasks: [String: Task<Void, Never>] = [:]
  private var stateTasks: [String: Task<Void, Never>] = [:]
  private var suppressedDuplicateActivityIds: Set<String> = []

  private struct ActivityGroupKey: Hashable {
    let scheduleId: String
    let recipientMemberId: Int64
  }

  func setEventSink(_ sink: EventSink?) {
    eventSink = sink
  }

  func restoreAndObserve() async {
    await reconcileAndObserveActivities()
    if activityUpdatesTask == nil {
      activityUpdatesTask = Task { [weak self] in
        for await _ in Activity<NoLateDepartureAttributes>.activityUpdates {
          guard !Task.isCancelled else { return }
          await self?.reconcileAndObserveActivities()
        }
      }
    }
    if #available(iOS 17.2, *), pushToStartTask == nil {
      pushToStartTask = Task { [weak self] in
        for await token in Activity<NoLateDepartureAttributes>.pushToStartTokenUpdates {
          guard !Task.isCancelled else { return }
          await self?.reconcileAndEmitPushToStartToken(token)
        }
      }
    }
  }

  func stopObserving() {
    activityUpdatesTask?.cancel()
    pushToStartTask?.cancel()
    updateTokenTasks.values.forEach { $0.cancel() }
    stateTasks.values.forEach { $0.cancel() }
    activityUpdatesTask = nil
    pushToStartTask = nil
    updateTokenTasks.removeAll()
    stateTasks.removeAll()
    eventSink = nil
  }

  func getCapabilities() async -> [String: Any?] {
    await restoreAndObserve()
    let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
    var result: [String: Any?] = [
      "supported": true,
      "platform": "ios",
      "enabled": enabled,
      "canDisplay": enabled,
      "canUpdate": enabled,
      // Scheduled departure notifications start through APNs on supported systems.
      "canStartLocally": false,
      "canStartRemotely": false,
      "pushToStartSupported": false,
      "pushToStartToken": nil,
      "reason": enabled ? nil : "LIVE_ACTIVITIES_DISABLED"
    ]
    if #available(iOS 17.2, *) {
      result["pushToStartSupported"] = true
      result["canStartRemotely"] = enabled
      result["pushToStartToken"] = Activity<NoLateDepartureAttributes>
        .pushToStartToken?
        .noLateHexString
    }
    return result
  }

  func startOrUpdate(
    _ unvalidated: NoLateDepartureStartOrUpdateCommand
  ) async throws -> NoLateLiveActivityMutationResult {
    await restoreAndObserve()
    let command = try NoLateLiveActivityPolicy.validate(unvalidated)
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      return NoLateLiveActivityMutationResult(
        applied: false,
        operation: "ignored",
        reason: "LIVE_ACTIVITIES_DISABLED"
      )
    }

    let matching = matchingActivities(
      scheduleId: command.scheduleId,
      recipientMemberId: command.recipientMemberId
    )
    let primary = matching.sorted(by: Self.isPreferredActivity).first
    for duplicate in matching where duplicate.id != primary?.id {
      await duplicate.end(nil, dismissalPolicy: .immediate)
    }

    if let primary {
      if command.generation < primary.attributes.generation {
        return NoLateLiveActivityMutationResult(
          applied: false,
          operation: "ignored",
          activityId: primary.id,
          reason: "STALE_GENERATION"
        )
      }
      if command.generation == primary.attributes.generation {
        guard
          primary.attributes.scheduleTitle == command.scheduleTitle,
          primary.attributes.destinationName == command.destinationName,
          primary.attributes.scheduleStartAt == command.scheduleStartAt,
          primary.attributes.actionEventKey == command.actionEventKey,
          primary.attributes.logicalEventKey == command.logicalEventKey
        else {
          return NoLateLiveActivityMutationResult(
            applied: false,
            operation: "ignored",
            activityId: primary.id,
            reason: "ATTRIBUTE_CONFLICT"
          )
        }
        let current = primary.content.state
        if primary.activityState == .ended || primary.activityState == .dismissed {
          return NoLateLiveActivityMutationResult(
            applied: false,
            operation: "ignored",
            activityId: primary.id,
            reason: "TERMINAL_STATE"
          )
        }
        if let reason = NoLateLiveActivityPolicy.journeyUpdateRejection(
          current: current,
          incoming: command.contentState
        ) {
          return NoLateLiveActivityMutationResult(
            applied: false,
            operation: "ignored",
            activityId: primary.id,
            reason: reason
          )
        }
        if command.contentState.revision < current.revision {
          return NoLateLiveActivityMutationResult(
            applied: false,
            operation: "ignored",
            activityId: primary.id,
            reason: "STALE_REVISION"
          )
        }
        if command.contentState.revision == current.revision {
          return NoLateLiveActivityMutationResult(
            applied: false,
            operation: "ignored",
            activityId: primary.id,
            reason: command.contentState == current ? "IDEMPOTENT" : "REVISION_CONFLICT"
          )
        }
        await primary.update(content(for: command))
        observe(primary)
        emitState(activity: primary, state: "active")
        return NoLateLiveActivityMutationResult(
          applied: true,
          operation: "updated",
          activityId: primary.id
        )
      }
      // Activity attributes are immutable. A newer backend generation replaces the old instance.
      await primary.end(nil, dismissalPolicy: .immediate)
    }

    let attributes = NoLateDepartureAttributes(
      scheduleId: command.scheduleId,
      recipientMemberId: command.recipientMemberId,
      generation: command.generation,
      scheduleTitle: command.scheduleTitle,
      destinationName: command.destinationName,
      scheduleStartAt: command.scheduleStartAt,
      actionEventKey: command.actionEventKey,
      logicalEventKey: command.logicalEventKey
    )
    #if DEBUG && targetEnvironment(simulator)
    // Unsigned simulator builds do not carry an APS environment entitlement.
    // Requesting a push token in that environment makes ActivityKit reject an
    // otherwise valid local preview before the widget can be rendered.
    let activity = try Activity<NoLateDepartureAttributes>.request(
      attributes: attributes,
      content: content(for: command),
      pushType: nil
    )
    #else
    let activity = try Activity<NoLateDepartureAttributes>.request(
      attributes: attributes,
      content: content(for: command),
      pushType: .token
    )
    #endif
    observe(activity)
    emitState(activity: activity, state: "active")
    return NoLateLiveActivityMutationResult(
      applied: true,
      operation: "started",
      activityId: activity.id
    )
  }

  func end(
    _ unvalidated: NoLateDepartureEndCommand
  ) async throws -> NoLateLiveActivityMutationResult {
    await restoreAndObserve()
    let command = try NoLateLiveActivityPolicy.validate(unvalidated)
    let matching = matchingActivities(
      scheduleId: command.scheduleId,
      recipientMemberId: command.recipientMemberId
    )
    guard !matching.isEmpty else {
      return NoLateLiveActivityMutationResult(
        applied: false,
        operation: "ignored",
        reason: "NOT_FOUND"
      )
    }

    var endedActivityId: String?
    var endedCount = 0
    for activity in matching {
      let current = activity.content.state
      if let revision = command.revision, revision < current.revision { continue }
      let finalRevision = command.revision ?? min(
        current.revision + 1,
        noLateLiveActivityMaximumSafeInteger
      )
      let finalState = current.replacingStatus(
        command.status,
        revision: finalRevision,
        updatedAtEpochSeconds: command.updatedAtEpochSeconds
      )
      await activity.end(
        ActivityContent(
          state: finalState,
          staleDate: nil,
          relevanceScore: 0
        ),
        dismissalPolicy: dismissalPolicy(for: command)
      )
      endedActivityId = endedActivityId ?? activity.id
      endedCount += 1
      emitState(activity: activity, state: "ended")
    }
    guard endedCount > 0 else {
      return NoLateLiveActivityMutationResult(
        applied: false,
        operation: "ignored",
        activityId: matching.first?.id,
        reason: "STALE_REVISION"
      )
    }
    return NoLateLiveActivityMutationResult(
      applied: true,
      operation: "ended",
      activityId: endedActivityId,
      endedCount: endedCount
    )
  }

  func endAll() async -> NoLateLiveActivityMutationResult {
    await restoreAndObserve()
    let activities = Activity<NoLateDepartureAttributes>.activities
    let now = Int64(Date().timeIntervalSince1970.rounded())
    for activity in activities {
      let current = activity.content.state
      let finalState = current.replacingStatus(
        .cancelled,
        revision: min(current.revision + 1, noLateLiveActivityMaximumSafeInteger),
        updatedAtEpochSeconds: now
      )
      await activity.end(
        ActivityContent(state: finalState, staleDate: nil, relevanceScore: 0),
        dismissalPolicy: .immediate
      )
      emitState(activity: activity, state: "ended")
    }
    return NoLateLiveActivityMutationResult(
      applied: !activities.isEmpty,
      operation: activities.isEmpty ? "ignored" : "endedAll",
      reason: activities.isEmpty ? "NOT_FOUND" : nil,
      endedCount: activities.count
    )
  }

  func getActiveActivities() async -> [[String: Any?]] {
    await restoreAndObserve()
    return Activity<NoLateDepartureAttributes>.activities
      .filter { !suppressedDuplicateActivityIds.contains($0.id) }
      .map { activity in
      let state = activity.content.state
      return [
        "activityId": activity.id,
        "scheduleId": activity.attributes.scheduleId,
        "recipientMemberId": Double(activity.attributes.recipientMemberId),
        "generation": Double(activity.attributes.generation),
        "revision": Double(state.revision),
        "status": state.status.rawValue,
        "scheduleTitle": activity.attributes.scheduleTitle,
        "destinationName": activity.attributes.destinationName,
        "scheduleStartAt": activity.attributes.scheduleStartAt,
        "actionEventKey": activity.attributes.actionEventKey,
        "logicalEventKey": activity.attributes.logicalEventKey,
        "journey": state.journey.map { journey -> [String: Any?] in
          [
            "sessionId": journey.sessionId,
            "generation": Double(journey.generation),
            "routeRevision": Double(journey.routeRevision),
            "sequence": Double(journey.sequence),
            "phase": journey.phase.rawValue,
            "activeLegIndex": journey.activeLegIndex,
            "currentStopIndex": journey.currentStopIndex,
            "remainingStops": journey.remainingStops,
            "legProgress": journey.legProgress,
            "nextInstruction": journey.nextInstruction,
            "observedAtEpochSeconds": Double(journey.observedAtEpochSeconds),
            "overallProgress": journey.overallProgress
          ]
        },
        "updateToken": activity.pushToken?.noLateHexString
      ]
    }
  }

  private func matchingActivities(
    scheduleId: String,
    recipientMemberId: Int64
  ) -> [Activity<NoLateDepartureAttributes>] {
    Activity<NoLateDepartureAttributes>.activities.filter {
      !suppressedDuplicateActivityIds.contains($0.id) &&
      $0.attributes.scheduleId == scheduleId &&
        $0.attributes.recipientMemberId == recipientMemberId
    }
  }

  private func content(
    for command: NoLateDepartureStartOrUpdateCommand
  ) -> ActivityContent<NoLateDepartureContentState> {
    ActivityContent(
      state: command.contentState,
      staleDate: command.staleAtEpochSeconds.map {
        Date(timeIntervalSince1970: TimeInterval($0))
      },
      relevanceScore: Self.relevanceScore(for: command.contentState.status)
    )
  }

  private func dismissalPolicy(
    for command: NoLateDepartureEndCommand
  ) -> ActivityUIDismissalPolicy {
    switch command.dismissalPolicy {
    case .default:
      return .default
    case .immediate:
      return .immediate
    case .afterDate:
      return .after(Date(
        timeIntervalSince1970: TimeInterval(command.dismissAtEpochSeconds ?? 0)
      ))
    }
  }

  private static func relevanceScore(for status: NoLateLiveActivityStatus) -> Double {
    switch status {
    case .leaveNow, .delayed: return 100
    case .preparing: return 80
    case .inTransit: return 70
    case .arrived, .cancelled: return 0
    }
  }

  private static func isPreferredActivity(
    _ lhs: Activity<NoLateDepartureAttributes>,
    _ rhs: Activity<NoLateDepartureAttributes>
  ) -> Bool {
    NoLateLiveActivityPolicy.preferredActivityID(in: [
      identity(for: lhs),
      identity(for: rhs)
    ]) == lhs.id
  }

  private static func identity(
    for activity: Activity<NoLateDepartureAttributes>
  ) -> NoLateActiveActivityIdentity {
    NoLateActiveActivityIdentity(
      activityId: activity.id,
      generation: activity.attributes.generation,
      revision: activity.content.state.revision
    )
  }

  private func reconcileAndObserveActivities() async {
    let activities = Activity<NoLateDepartureAttributes>.activities
    let groups = Dictionary(grouping: activities) { activity in
      ActivityGroupKey(
        scheduleId: activity.attributes.scheduleId,
        recipientMemberId: activity.attributes.recipientMemberId
      )
    }
    let now = Int64(Date().timeIntervalSince1970.rounded())
    for group in groups.values {
      guard let retainedId = NoLateLiveActivityPolicy.preferredActivityID(
        in: group.map { Self.identity(for: $0) }
      ) else { continue }
      for activity in group {
        if activity.id == retainedId {
          observe(activity)
          continue
        }
        suppressedDuplicateActivityIds.insert(activity.id)
        stopObserving(activityId: activity.id)
        let current = activity.content.state
        let terminal = current.replacingStatus(
          .cancelled,
          revision: min(current.revision + 1, noLateLiveActivityMaximumSafeInteger),
          updatedAtEpochSeconds: now
        )
        await activity.end(
          ActivityContent(state: terminal, staleDate: nil, relevanceScore: 0),
          dismissalPolicy: .immediate
        )
        emitState(activity: activity, state: "ended")
      }
    }
  }

  /**
   * A rotated push-to-start credential may be emitted while a remotely-started
   * Activity is becoming visible to the process. Reconcile first so any existing
   * Activity/update-token events enter the React Native event queue before the
   * replacement start credential. The JS coordinator attempts those update-token
   * registrations first, then advances this installation credential. Ambiguous
   * remote STARTs remain fail-closed on the backend instead of being replayed.
   */
  private func reconcileAndEmitPushToStartToken(_ token: Data) async {
    await reconcileAndObserveActivities()
    emitPushToken(kind: "pushToStart", token: token, activity: nil)
  }

  private func observe(_ activity: Activity<NoLateDepartureAttributes>) {
    if let token = activity.pushToken {
      emitPushToken(kind: "update", token: token, activity: activity)
    }
    if updateTokenTasks[activity.id] == nil {
      updateTokenTasks[activity.id] = Task { [weak self] in
        for await token in activity.pushTokenUpdates {
          guard !Task.isCancelled else { return }
          await self?.emitPushToken(kind: "update", token: token, activity: activity)
        }
      }
    }
    if stateTasks[activity.id] == nil {
      stateTasks[activity.id] = Task { [weak self] in
        for await state in activity.activityStateUpdates {
          guard !Task.isCancelled else { return }
          await self?.emitState(activity: activity, state: state.noLateBridgeValue)
          if state != .active && state != .stale {
            await self?.stopObserving(activityId: activity.id)
            return
          }
        }
      }
    }
  }

  private func stopObserving(activityId: String) {
    updateTokenTasks.removeValue(forKey: activityId)?.cancel()
    stateTasks.removeValue(forKey: activityId)?.cancel()
  }

  private func emitPushToken(
    kind: String,
    token: Data,
    activity: Activity<NoLateDepartureAttributes>?
  ) {
    eventSink?("onLiveActivityPushToken", [
      "kind": kind,
      "token": token.noLateHexString,
      "activityId": activity?.id,
      "scheduleId": activity?.attributes.scheduleId,
      "recipientMemberId": activity.map { Double($0.attributes.recipientMemberId) },
      // Required for fencing a late token callback from a superseded Activity instance.
      "generation": activity.map { Double($0.attributes.generation) }
    ])
  }

  private func emitState(
    activity: Activity<NoLateDepartureAttributes>,
    state: String
  ) {
    eventSink?("onLiveActivityStateChange", [
      "activityId": activity.id,
      "scheduleId": activity.attributes.scheduleId,
      "recipientMemberId": Double(activity.attributes.recipientMemberId),
      "generation": Double(activity.attributes.generation),
      "state": state
    ])
  }
}

private extension Data {
  var noLateHexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}

@available(iOS 16.1, *)
private extension ActivityState {
  var noLateBridgeValue: String {
    switch self {
    case .pending: return "pending"
    case .active: return "active"
    case .stale: return "stale"
    case .ended: return "ended"
    case .dismissed: return "dismissed"
    @unknown default: return "unknown"
    }
  }
}
