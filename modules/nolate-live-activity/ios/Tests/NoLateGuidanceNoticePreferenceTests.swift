import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateGuidanceNoticePreferenceTests: XCTestCase {
  private func isolatedDefaults() -> UserDefaults {
    let name = "NoLateGuidanceNoticePreferenceTests.\(UUID().uuidString)"
    return UserDefaults(suiteName: name)!
  }

  func testFirstLaunchAndUnexpectedStoredValueStayOff() {
    let defaults = isolatedDefaults()
    XCTAssertEqual(NoLateGuidanceNoticePreference.load(from: defaults), "OFF")
    defaults.set("LOUD_UNKNOWN", forKey: "NoLateGuidanceNoticeMode.v1")
    XCTAssertEqual(NoLateGuidanceNoticePreference.load(from: defaults), "OFF")
  }

  func testChosenVoiceAndNotificationModeSurvivesReload() {
    let defaults = isolatedDefaults()
    NoLateGuidanceNoticePreference.save("VOICE_AND_NOTIFICATIONS", to: defaults)
    XCTAssertEqual(NoLateGuidanceNoticePreference.load(from: defaults), "VOICE_AND_NOTIFICATIONS")
    NoLateGuidanceNoticePreference.save("NOTIFICATIONS", to: defaults)
    XCTAssertEqual(NoLateGuidanceNoticePreference.load(from: defaults), "NOTIFICATIONS")
  }

  func testDrivingInheritsTheChosenChannelUntilTheUserOverridesIt() {
    let defaults = isolatedDefaults()
    XCTAssertFalse(NoLateGuidanceNoticePreference.drivingVoiceEnabled(from: defaults))
    NoLateGuidanceNoticePreference.save("VOICE_AND_NOTIFICATIONS", to: defaults)
    XCTAssertTrue(NoLateGuidanceNoticePreference.drivingVoiceEnabled(from: defaults))
    NoLateGuidanceNoticePreference.setDrivingVoiceEnabled(false, in: defaults)
    XCTAssertFalse(NoLateGuidanceNoticePreference.drivingVoiceEnabled(from: defaults))
    XCTAssertEqual(NoLateGuidanceNoticePreference.load(from: defaults), "VOICE_AND_NOTIFICATIONS")
    NoLateGuidanceNoticePreference.save("NOTIFICATIONS", to: defaults)
    NoLateGuidanceNoticePreference.setDrivingVoiceEnabled(true, in: defaults)
    XCTAssertTrue(NoLateGuidanceNoticePreference.drivingVoiceEnabled(from: defaults))
    XCTAssertEqual(NoLateGuidanceNoticePreference.load(from: defaults), "NOTIFICATIONS")
  }

  func testExplicitOffPersistsAndInvalidWriteCannotChangeIt() {
    let defaults = isolatedDefaults()
    NoLateGuidanceNoticePreference.save("VOICE_AND_NOTIFICATIONS", to: defaults)
    NoLateGuidanceNoticePreference.save("OFF", to: defaults)
    NoLateGuidanceNoticePreference.save("INVALID", to: defaults)
    XCTAssertEqual(NoLateGuidanceNoticePreference.load(from: defaults), "OFF")
  }
}
