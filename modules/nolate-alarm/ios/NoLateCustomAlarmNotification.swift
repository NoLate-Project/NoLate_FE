import Foundation
import UserNotifications

/**
 * Owns the ordinary iOS notification surface that opens NoLate's custom alarm screen.
 *
 * This scheduler intentionally has no AlarmKit dependency. iOS still owns the banner/lock-screen
 * row, but every tap and action launches the app so NoLate can render its own full-screen alarm UI.
 */
actor NoLateCustomAlarmNotificationScheduler {
  static let shared = NoLateCustomAlarmNotificationScheduler()

  private let notificationCenter: UNUserNotificationCenter
  private let soundPreferenceStore: NoLateAlarmSoundPreferenceStore

  init(
    notificationCenter: UNUserNotificationCenter = .current(),
    soundPreferenceStore: NoLateAlarmSoundPreferenceStore = .init()
  ) {
    self.notificationCenter = notificationCenter
    self.soundPreferenceStore = soundPreferenceStore
  }

  func getAlarmSoundPreference() -> String {
    soundPreferenceStore.load().rawValue
  }

  func setAlarmSoundPreference(_ soundId: String) async -> Bool {
    guard let preference = NoLateAlarmSoundPreference(rawValue: soundId) else {
      return false
    }
    if
      soundPreferenceStore.load() != preference,
      !soundPreferenceStore.save(preference)
    {
      return false
    }

    // Re-adding the same identifier replaces the pending request atomically. We never remove the
    // old request first, so a native scheduling failure cannot silently delete an alarm. Retrying
    // the same preference also retries any request that could not be refreshed previously.
    return await refreshPendingManagedAlarmSounds(preference)
  }

  func registerCategories() async {
    let currentCategories: Set<UNNotificationCategory> = await withCheckedContinuation {
      continuation in
      notificationCenter.getNotificationCategories { categories in
        continuation.resume(returning: categories)
      }
    }
    let preservedCategories = currentCategories.filter {
      !NoLateCustomAlarmNotificationContract.managedCategoryIdentifiers.contains(
        $0.identifier
      )
    }
    let registeredCategories = Set(preservedCategories).union([
      Self.customAlarmCategory(),
      Self.previewCategory(),
      Self.legacyStandardCategory()
    ])

    // Register every NoLate-owned category in one native write. Unrelated categories remain
    // untouched, while stale definitions of the three managed categories are replaced together.
    notificationCenter.setNotificationCategories(registeredCategories)
  }

  func schedulePreview(
    delaySeconds: Int,
    scheduleId: String?
  ) async throws -> NoLateAlarmMutationResult {
    guard (3...60).contains(delaySeconds) else {
      throw NoLateAlarmValidationError.invalid(
        "delaySeconds must be between 3 and 60."
      )
    }
    let normalizedScheduleId = try NoLateCustomAlarmNotificationContract
      .normalizedScheduleId(scheduleId)

    var settings = await notificationCenter.notificationSettings()
    if settings.authorizationStatus == .notDetermined {
      do {
        _ = try await notificationCenter.requestAuthorization(
          options: [.alert, .badge, .sound]
        )
        settings = await notificationCenter.notificationSettings()
      } catch {
        return NoLateAlarmMutationResult(
          applied: false,
          scheduled: false,
          reason: "NOTIFICATION_AUTHORIZATION_ERROR",
          deliveryMode: .timeSensitive
        )
      }
    }
    guard Self.canDeliverNotifications(settings.authorizationStatus) else {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: settings.authorizationStatus == .notDetermined
          ? "NOTIFICATION_PERMISSION_NOT_DETERMINED"
          : "NOTIFICATION_PERMISSION_REQUIRED",
        deliveryMode: .timeSensitive
      )
    }
    guard settings.alertSetting != .disabled else {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "NOTIFICATION_ALERTS_DISABLED",
        deliveryMode: .timeSensitive
      )
    }

    await registerCategories()
    await removeExistingPreviews()
    let previewId = UUID().uuidString.lowercased()
    let alarmId = "preview:\(previewId)"
    let content = UNMutableNotificationContent()
    content.title = NoLateCustomAlarmNotificationContract.previewTitle
    content.body = NoLateCustomAlarmNotificationContract.previewBody
    content.sound = Self.resolvedSound()
    content.categoryIdentifier =
      NoLateCustomAlarmNotificationContract.previewCategoryIdentifier
    content.threadIdentifier = "nolate-custom-alarm-preview"
    content.interruptionLevel = .timeSensitive
    content.userInfo = NoLateCustomAlarmNotificationContract.payload(
      alarmId: alarmId,
      previewId: previewId,
      scheduleId: normalizedScheduleId,
      title: content.title,
      body: content.body,
      isPreview: true
    )

    let request = UNNotificationRequest(
      identifier: NoLateCustomAlarmNotificationContract.previewRequestIdentifier,
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(
        timeInterval: TimeInterval(delaySeconds),
        repeats: false
      )
    )
    do {
      try await notificationCenter.add(request)
    } catch {
      return NoLateAlarmMutationResult(
        applied: false,
        scheduled: false,
        reason: "NOTIFICATION_SCHEDULE_FAILED",
        deliveryMode: .timeSensitive
      )
    }

    return NoLateAlarmMutationResult(
      applied: true,
      scheduled: true,
      reason: Self.warning(for: settings),
      deliveryMode: .timeSensitive
    )
  }

  nonisolated static func resolvedSound(
    preference: NoLateAlarmSoundPreference? = nil,
    bundle: Bundle = .main
  ) -> UNNotificationSound {
    // The 28-second variants are reserved for OS-delivered notifications. The four-second files
    // are used by NoLate's foreground preview, where playback is controlled in app.
    let selectedPreference = preference ?? NoLateAlarmSoundPreferenceStore().load()
    let resourceName = selectedPreference.notificationResourceName
    let fileExtension = "wav"
    if bundle.url(forResource: resourceName, withExtension: fileExtension) != nil {
      return UNNotificationSound(
        named: UNNotificationSoundName("\(resourceName).\(fileExtension)")
      )
    }
    return .default
  }

  private func refreshPendingManagedAlarmSounds(
    _ preference: NoLateAlarmSoundPreference
  ) async -> Bool {
    let requests: [UNNotificationRequest] = await withCheckedContinuation { continuation in
      notificationCenter.getPendingNotificationRequests { requests in
        continuation.resume(returning: requests)
      }
    }
    let managedRequests = requests.filter {
      NoLateCustomAlarmNotificationContract.shouldRefreshSound(
        categoryIdentifier: $0.content.categoryIdentifier
      )
    }
    guard !managedRequests.isEmpty else { return true }

    let sound = Self.resolvedSound(preference: preference)
    var didRefreshEveryRequest = true
    for request in managedRequests {
      guard
        let updatedContent = request.content.mutableCopy()
          as? UNMutableNotificationContent
      else {
        didRefreshEveryRequest = false
        continue
      }
      updatedContent.sound = sound
      let updatedRequest = UNNotificationRequest(
        identifier: request.identifier,
        content: updatedContent,
        trigger: request.trigger
      )
      do {
        try await notificationCenter.add(updatedRequest)
      } catch {
        didRefreshEveryRequest = false
      }
    }
    return didRefreshEveryRequest
  }

  private nonisolated static func customAlarmCategory() -> UNNotificationCategory {
    UNNotificationCategory(
      identifier: NoLateCustomAlarmNotificationContract.categoryIdentifier,
      actions: [
        UNNotificationAction(
          identifier: NoLateCustomAlarmNotificationContract.openActionIdentifier,
          title: "알람 열기",
          options: [.foreground]
        ),
        UNNotificationAction(
          identifier:
            NoLateCustomAlarmNotificationContract.confirmDepartureActionIdentifier,
          title: "지금 출발 완료",
          options: [.foreground]
        )
      ],
      intentIdentifiers: [],
      options: []
    )
  }

  private nonisolated static func previewCategory() -> UNNotificationCategory {
    UNNotificationCategory(
      identifier: NoLateCustomAlarmNotificationContract.previewCategoryIdentifier,
      actions: [
        UNNotificationAction(
          identifier: NoLateCustomAlarmNotificationContract.previewRouteActionIdentifier,
          title: "경로 보기",
          options: [.foreground]
        ),
        UNNotificationAction(
          identifier:
            NoLateCustomAlarmNotificationContract.previewDepartureActionIdentifier,
          title: "지금 출발 완료",
          options: [.foreground]
        )
      ],
      intentIdentifiers: [],
      options: []
    )
  }

  private nonisolated static func legacyStandardCategory() -> UNNotificationCategory {
    UNNotificationCategory(
      identifier: NoLateCustomAlarmNotificationContract.legacyCategoryIdentifier,
      actions: [
        UNNotificationAction(
          identifier:
            NoLateCustomAlarmNotificationContract.legacyDepartureActionIdentifier,
          title: "출발 완료",
          options: [.foreground]
        ),
        UNNotificationAction(
          identifier: NoLateCustomAlarmNotificationContract.legacySnoozeActionIdentifier,
          title: "5분 뒤 다시 알림",
          options: [.foreground]
        )
      ],
      intentIdentifiers: [],
      options: [.hiddenPreviewsShowTitle, .hiddenPreviewsShowSubtitle]
    )
  }

  private func removeExistingPreviews() async {
    async let pendingIdentifiers = pendingPreviewIdentifiers()
    async let deliveredIdentifiers = deliveredPreviewIdentifiers()
    let (pending, delivered) = await (pendingIdentifiers, deliveredIdentifiers)

    if !pending.isEmpty {
      notificationCenter.removePendingNotificationRequests(withIdentifiers: pending)
    }
    if !delivered.isEmpty {
      notificationCenter.removeDeliveredNotifications(withIdentifiers: delivered)
    }
  }

  private func pendingPreviewIdentifiers() async -> [String] {
    let identifiers: [String] = await withCheckedContinuation { continuation in
      notificationCenter.getPendingNotificationRequests { requests in
        continuation.resume(returning: requests.map(\.identifier))
      }
    }
    return NoLateCustomAlarmNotificationContract.previewRequestIdentifiers(
      from: identifiers
    )
  }

  private func deliveredPreviewIdentifiers() async -> [String] {
    let identifiers: [String] = await withCheckedContinuation { continuation in
      notificationCenter.getDeliveredNotifications { notifications in
        continuation.resume(returning: notifications.map {
          $0.request.identifier
        })
      }
    }
    return NoLateCustomAlarmNotificationContract.previewRequestIdentifiers(
      from: identifiers
    )
  }

  private nonisolated static func canDeliverNotifications(
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

  private nonisolated static func warning(
    for settings: UNNotificationSettings
  ) -> String? {
    if settings.timeSensitiveSetting != .enabled {
      return "TIME_SENSITIVE_DISABLED"
    }
    if settings.soundSetting != .enabled {
      return "SOUND_DISABLED"
    }
    if settings.authorizationStatus == .provisional {
      return "PROVISIONAL_NOTIFICATION_AUTHORIZATION"
    }
    return nil
  }
}
