import AppIntents
import Foundation

@available(iOS 26.0, *)
struct NoLateDepartNowAlarmIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "지금 출발 완료"
  static var description = IntentDescription("출발 완료 요청을 안전하게 저장합니다.")
  static var openAppWhenRun = true
  static var isDiscoverable = false

  @Parameter(title: "알람 ID")
  var physicalAlarmId: String

  init() {
    physicalAlarmId = ""
  }

  init(physicalAlarmId: String) {
    self.physicalAlarmId = physicalAlarmId
  }

  func perform() async throws -> some IntentResult {
    // The coordinator commits fire evidence and then the action journal before stopping/canceling
    // AlarmKit. Opening the app starts authenticated replay but carries no route target.
    _ = try await NoLateAlarmCoordinator.shared.performDepartureActionFromAlarmKit(
      physicalAlarmId: physicalAlarmId
    )
    return .result()
  }
}

@available(iOS 26.0, *)
struct NoLateOpenRouteAlarmIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "일정 열기"
  static var description = IntentDescription("알람의 일정과 경로를 엽니다.")
  static var openAppWhenRun = true
  static var isDiscoverable = false

  @Parameter(title: "알람 ID")
  var physicalAlarmId: String

  init() {
    physicalAlarmId = ""
  }

  init(physicalAlarmId: String) {
    self.physicalAlarmId = physicalAlarmId
  }

  func perform() async throws -> some IntentResult {
    // Fire evidence precedes the idempotent navigation journal; no depart mutation is enqueued.
    _ = try await NoLateAlarmCoordinator.shared.performOpenRouteFromAlarmKit(
      physicalAlarmId: physicalAlarmId
    )
    return .result()
  }
}
