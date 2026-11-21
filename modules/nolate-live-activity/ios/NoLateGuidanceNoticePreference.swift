import Foundation

/// The guidance channel is a device preference. Keep an explicit OFF choice
/// across app launches, and never turn an unknown stored value into audio.
enum NoLateGuidanceNoticePreference {
  private static let key = "NoLateGuidanceNoticeMode.v1"
  private static let drivingKey = "NoLateDrivingVoiceEnabled.v1"
  private static let modes: Set<String> = ["OFF", "NOTIFICATIONS", "VOICE_AND_NOTIFICATIONS"]

  static func load(from defaults: UserDefaults = .standard) -> String {
    guard let stored = defaults.string(forKey: key), modes.contains(stored) else { return "OFF" }
    return stored
  }

  /// Before the first driving selection, use the guidance channel the user already chose.
  static func drivingVoiceEnabled(from defaults: UserDefaults = .standard) -> Bool {
    guard defaults.object(forKey: drivingKey) != nil else {
      return load(from: defaults) == "VOICE_AND_NOTIFICATIONS"
    }
    return defaults.object(forKey: drivingKey) as? Bool == true
  }

  static func setDrivingVoiceEnabled(_ enabled: Bool, in defaults: UserDefaults = .standard) {
    defaults.set(enabled, forKey: drivingKey)
  }

  static func save(_ mode: String, to defaults: UserDefaults = .standard) {
    guard modes.contains(mode) else { return }
    defaults.set(mode, forKey: key)
  }
}
