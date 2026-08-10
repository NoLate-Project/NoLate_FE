import ActivityKit
import AppIntents
import Foundation

#if NOLATE_LIVE_ACTIVITY_APP
import NoLateAlarm
import NoLateLiveActivity
#endif

@available(iOS 17.0, *)
struct NoLateDepartureLiveActivityIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "출발 완료"
  static var description = IntentDescription("출발 완료 요청을 안전하게 저장합니다.")
  static var openAppWhenRun = false
  static var isDiscoverable = false

  @Parameter(title: "일정 ID")
  var scheduleId: String

  @Parameter(title: "사용자 ID")
  var recipientMemberId: Int

  @Parameter(title: "세대")
  var generation: Int

  @Parameter(title: "작업 키")
  var actionEventKey: String

  init() {
    scheduleId = ""
    recipientMemberId = 0
    generation = 0
    actionEventKey = ""
  }

  init(attributes: NoLateDepartureAttributes) {
    scheduleId = attributes.scheduleId
    recipientMemberId = Int(attributes.recipientMemberId)
    generation = Int(attributes.generation)
    actionEventKey = attributes.actionEventKey
  }

  func perform() async throws -> some IntentResult {
    #if NOLATE_LIVE_ACTIVITY_APP
    let now = Int64(Date().timeIntervalSince1970.rounded())
    guard
      let numericScheduleId = Int64(scheduleId), numericScheduleId > 0,
      recipientMemberId > 0,
      generation >= 0,
      NoLateLiveActivityPolicy.isCanonicalActionEventKey(actionEventKey),
      Activity<NoLateDepartureAttributes>.activities.contains(where: { activity in
        NoLateLiveActivityPolicy.mayRecordDepartureAction(
          requestedScheduleId: scheduleId,
          requestedRecipientMemberId: Int64(recipientMemberId),
          requestedGeneration: Int64(generation),
          requestedActionEventKey: actionEventKey,
          activityScheduleId: activity.attributes.scheduleId,
          activityRecipientMemberId: activity.attributes.recipientMemberId,
          activityGeneration: activity.attributes.generation,
          activityActionEventKey: activity.attributes.actionEventKey,
          nowEpochSeconds: now,
          actionExpiresAtEpochSeconds: activity.content.state.actionExpiresAtEpochSeconds
        )
      })
    else {
      return .result()
    }
    let recorded = try await NoLateAlarmDepartureActionBridge.recordFromLiveActivity(
      scheduleId: scheduleId,
      recipientMemberId: Int64(recipientMemberId),
      generation: Int64(generation),
      actionEventKey: actionEventKey,
      occurredAtMilliseconds: Int64((Date().timeIntervalSince1970 * 1_000).rounded())
    )
    if recorded {
      for activity in Activity<NoLateDepartureAttributes>.activities where
        NoLateLiveActivityPolicy.hasDepartureActionIdentity(
          requestedScheduleId: scheduleId,
          requestedRecipientMemberId: Int64(recipientMemberId),
          requestedGeneration: Int64(generation),
          requestedActionEventKey: actionEventKey,
          activityScheduleId: activity.attributes.scheduleId,
          activityRecipientMemberId: activity.attributes.recipientMemberId,
          activityGeneration: activity.attributes.generation,
          activityActionEventKey: activity.attributes.actionEventKey
        )
      {
        let current = activity.content.state
        let terminal = current.replacingStatus(
          .cancelled,
          revision: min(current.revision + 1, noLateLiveActivityMaximumSafeInteger),
          updatedAtEpochSeconds: now
        )
        // The journal commit is the success boundary. End the exact immutable
        // generation immediately afterwards so an in-flight remote UPDATE can
        // never paint `leaveNow` back over a completed departure action.
        await activity.end(
          ActivityContent(state: terminal, staleDate: nil, relevanceScore: 0),
          dismissalPolicy: .immediate
        )
      }
    }
    #endif
    return .result()
  }
}
