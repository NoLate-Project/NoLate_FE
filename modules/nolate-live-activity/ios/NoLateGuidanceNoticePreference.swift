import Foundation

/// The guidance channel is a device preference. Keep an explicit OFF choice
/// across app launches, and never turn an unknown stored value into audio.
enum NoLateGuidanceNoticePreference {
  private static let key = "NoLateGuidanceNoticeMode.v1"
  private static let modes: Set<String> = ["OFF", "NOTIFICATIONS", "VOICE_AND_NOTIFICATIONS"]

  static func load(from defaults: UserDefaults = .standard) -> String {
    guard let stored = defaults.string(forKey: key), modes.contains(stored) else { return "OFF" }
    return stored
  }

  static func save(_ mode: String, to defaults: UserDefaults = .standard) {
    guard modes.contains(mode) else { return }
    defaults.set(mode, forKey: key)
  }
}
