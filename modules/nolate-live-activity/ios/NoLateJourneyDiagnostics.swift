import Foundation

/// A probe observation is evidence of a fresh location callback, not route progress.
enum NoLateJourneyDiagnosticsPolicy {
  static let maximumProbeDurationSeconds: TimeInterval = 600

  static func sampleRejection(
    accuracyMeters: Double,
    observedAt: TimeInterval,
    probeStartedAt: TimeInterval,
    latestObservedAt: TimeInterval?,
    receivedAt: TimeInterval
  ) -> String? {
    guard accuracyMeters.isFinite, accuracyMeters >= 0 else { return "INVALID_ACCURACY" }
    guard observedAt.isFinite, receivedAt.isFinite, probeStartedAt.isFinite else {
      return "INVALID_TIMESTAMP"
    }
    guard observedAt >= probeStartedAt else { return "CACHED_BEFORE_PROBE" }
    guard observedAt <= receivedAt + 5 else { return "FUTURE_TIMESTAMP" }
    guard receivedAt - observedAt <= 30 else { return "STALE_SAMPLE" }
    if let latestObservedAt, observedAt <= latestObservedAt { return "DUPLICATE_OR_OLDER" }
    return nil
  }

  static func isSupportedSpeechMode(_ mode: String) -> Bool {
    mode == "RESPECT_SILENT" || mode == "LOCK_SCREEN"
  }
}

#if DEBUG && canImport(UIKit)
import ActivityKit
import AVFAudio
import CoreLocation
import UIKit

/// Development-only P0 instrumentation. No coordinates, tokens, or raw errors leave this object.
/// Counts describe the application's state when a location callback was processed on the main actor.
@MainActor
final class NoLateJourneyDiagnostics: NSObject, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate {
  static let shared = NoLateJourneyDiagnostics()

  private let manager = CLLocationManager()
  private let synthesizer = AVSpeechSynthesizer()
  private var wantsLocation = false
  private var probeStartedAt: Date?
  private var locationTimeout: Task<Void, Never>?
  private var speechTimeout: Task<Void, Never>?
  private var locationState = "IDLE"
  private var locationError: String?
  private var totalSamples = 0
  private var foregroundSamples = 0
  private var backgroundSamples = 0
  private var inactiveSamples = 0
  private var rejectedSamples = 0
  private var lastAccuracy: Double?
  private var lastSampleAt: Date?
  private var speechState = "IDLE"
  private var speechMode: String?
  private var speechError: String?
  private var startedCount = 0
  private var completedCount = 0
  private var cancelledCount = 0
  private var currentUtterance: AVSpeechUtterance?
  private var audioLease: AudioLease?

  private struct AudioLease {
    let previousCategory: AVAudioSession.Category
    let previousMode: AVAudioSession.Mode
    let previousOptions: AVAudioSession.CategoryOptions
    let probeCategory: AVAudioSession.Category
    let probeMode: AVAudioSession.Mode
    let probeOptions: AVAudioSession.CategoryOptions
  }

  private struct ProbeSample: Sendable {
    let accuracyMeters: Double
    let observedAt: TimeInterval
  }

  private override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = kCLDistanceFilterNone
    manager.activityType = .otherNavigation
    manager.pausesLocationUpdatesAutomatically = false
    synthesizer.delegate = self
  }

  private var backgroundModes: [String] {
    Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
  }

  private var diagnosticsBuildEnabled: Bool {
    Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyDiagnosticsEnabled") as? Bool == true
  }

  func snapshot() -> [String: Any?] {
    guard diagnosticsBuildEnabled else {
      return ["enabled": false, "reason": "DIAGNOSTICS_BUILD_REQUIRED"]
    }
    let session = AVAudioSession.sharedInstance()
    let outputMuteSupported: Bool
    let outputMuted: Bool?
    if #available(iOS 26.0, *) {
      outputMuteSupported = true
      outputMuted = session.isOutputMuted
    } else {
      outputMuteSupported = false
      outputMuted = nil
    }
    let activitiesEnabled: Bool
    if #available(iOS 16.1, *) {
      activitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
    } else {
      activitiesEnabled = false
    }
    let pushToStartSupported: Bool
    if #available(iOS 17.2, *) { pushToStartSupported = true } else { pushToStartSupported = false }
    return [
      "enabled": true,
      "reason": "P0_DIAGNOSTIC_NOT_NAVIGATION",
      "iosVersion": UIDevice.current.systemVersion,
      "applicationState": applicationStateName,
      "location": [
        "servicesEnabled": CLLocationManager.locationServicesEnabled(),
        "authorization": authorizationName,
        "accuracyAuthorization": manager.accuracyAuthorization == .fullAccuracy ? "FULL" : "REDUCED",
        "backgroundModeConfigured": backgroundModes.contains("location"),
        "state": locationState,
        "totalSamples": totalSamples,
        "foregroundSamples": foregroundSamples,
        "backgroundSamples": backgroundSamples,
        "inactiveSamples": inactiveSamples,
        "rejectedSamples": rejectedSamples,
        "lastAccuracyMeters": lastAccuracy,
        "lastSampleAtEpochMs": lastSampleAt.map { $0.timeIntervalSince1970 * 1_000 },
        "lastErrorCode": locationError,
        "maximumDurationSeconds": NoLateJourneyDiagnosticsPolicy.maximumProbeDurationSeconds
      ] as [String: Any?],
      "speech": [
        "state": speechState,
        "mode": speechMode,
        "startedCount": startedCount,
        "completedCount": completedCount,
        "cancelledCount": cancelledCount,
        "lastErrorCode": speechError,
        "backgroundModeConfigured": backgroundModes.contains("audio"),
        "outputMuteSupported": outputMuteSupported,
        "outputMuted": outputMuted,
        "hardwareSilentState": "UNAVAILABLE",
        "audibilityVerified": false
      ] as [String: Any?],
      "liveActivity": [
        "activitiesEnabled": activitiesEnabled,
        "pushToStartSupported": pushToStartSupported,
        "apnsDeliveryVerified": false
      ] as [String: Any?]
    ]
  }

  func startLocationProbe() -> [String: Any?] {
    guard diagnosticsBuildEnabled else { return snapshot() }
    guard UIApplication.shared.applicationState == .active else {
      locationError = "FOREGROUND_REQUIRED"
      return snapshot()
    }
    guard !wantsLocation else { return snapshot() }
    guard CLLocationManager.locationServicesEnabled() else {
      locationState = "ERROR"
      locationError = "LOCATION_SERVICES_DISABLED"
      return snapshot()
    }
    guard let usage = Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") as? String,
          !usage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      locationState = "ERROR"
      locationError = "LOCATION_USAGE_DESCRIPTION_MISSING"
      return snapshot()
    }
    totalSamples = 0
    foregroundSamples = 0
    backgroundSamples = 0
    inactiveSamples = 0
    rejectedSamples = 0
    lastAccuracy = nil
    lastSampleAt = nil
    locationError = nil
    wantsLocation = true
    probeStartedAt = Date()
    locationTimeout?.cancel()
    locationTimeout = Task { @MainActor [weak self] in
      do {
        try await Task.sleep(nanoseconds: UInt64(NoLateJourneyDiagnosticsPolicy.maximumProbeDurationSeconds * 1_000_000_000))
      } catch { return }
      guard let self, self.wantsLocation else { return }
      self.stopLocation(reason: "PROBE_TIME_LIMIT")
    }
    if manager.authorizationStatus == .notDetermined {
      locationState = "REQUESTING_PERMISSION"
      manager.requestWhenInUseAuthorization()
    } else {
      beginAuthorizedLocation()
    }
    return snapshot()
  }

  /// Stop pending authorization as well as active updates; late delegates cannot restart a probe.
  func stopProbe() -> [String: Any?] {
    stopLocation(reason: nil)
    cancelSpeech(reason: nil)
    return snapshot()
  }

  private var guidanceSpeech = false
  func queueGuidanceInstruction(_ text: String) -> Bool {
    guard currentUtterance == nil, !text.isEmpty, text.utf8.count <= 512,
      !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return false }
    _ = speakProbe(mode: "RESPECT_SILENT", instruction: text)
    return guidanceSpeech && currentUtterance != nil && speechState == "QUEUED"
  }
  func cancelGuidanceSpeech() {
    guard guidanceSpeech else { return }
    guidanceSpeech = false
    cancelSpeech(reason: nil)
  }
  func speakProbe(mode: String, instruction: String? = nil) -> [String: Any?] {
    guard diagnosticsBuildEnabled else { return snapshot() }
    guard UIApplication.shared.applicationState == .active else {
      speechError = "FOREGROUND_REQUIRED"
      return snapshot()
    }
    guard NoLateJourneyDiagnosticsPolicy.isSupportedSpeechMode(mode) else {
      speechError = "INVALID_SPEECH_MODE"
      return snapshot()
    }
    // Do not replace a running probe: its delayed delegate must not release a newer audio lease.
    guard currentUtterance == nil else {
      speechError = "SPEECH_ALREADY_RUNNING"
      return snapshot()
    }
    guard let voice = AVSpeechSynthesisVoice(language: "ko-KR") else {
      speechState = "ERROR"
      speechError = "KOREAN_VOICE_UNAVAILABLE"
      return snapshot()
    }
    let session = AVAudioSession.sharedInstance()
    if instruction != nil && (session.isOtherAudioPlaying || session.secondaryAudioShouldBeSilencedHint
      || session.category == .playback || session.category == .record || session.category == .playAndRecord) {
      speechError = "GUIDANCE_AUDIO_IN_USE"; return snapshot()
    }
    guard session.category != .record, session.category != .playAndRecord else {
      speechState = "ERROR"
      speechError = "RECORDING_AUDIO_SESSION_IN_USE"
      return snapshot()
    }
    let category: AVAudioSession.Category = mode == "LOCK_SCREEN" ? .playback : .ambient
    let audioMode: AVAudioSession.Mode = mode == "LOCK_SCREEN" ? .spokenAudio : .default
    let options: AVAudioSession.CategoryOptions = .mixWithOthers
    audioLease = AudioLease(
      previousCategory: session.category, previousMode: session.mode,
      previousOptions: session.categoryOptions,
      probeCategory: category, probeMode: audioMode, probeOptions: options
    )
    speechMode = mode
    speechError = nil
    do {
      try session.setCategory(category, mode: audioMode, options: options)
      try session.setActive(true)
    } catch {
      speechState = "ERROR"
      speechError = "AUDIO_SESSION_SETUP_FAILED"
      restoreAudioSession()
      return snapshot()
    }
    let utterance = AVSpeechUtterance(string: instruction ?? "길안내 음성 진단입니다. 다음 정류장에서 내려 주세요. 열차는 약 2분 후 도착 예정입니다.")
    utterance.voice = voice
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate
    // The tester has time to lock the independent simulator or physical device.
    utterance.preUtteranceDelay = instruction == nil ? 3 : 0
    guidanceSpeech = instruction != nil
    currentUtterance = utterance
    speechState = "QUEUED"
    synthesizer.usesApplicationAudioSession = true
    synthesizer.speak(utterance)
    speechTimeout = Task { @MainActor [weak self] in
      do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
      guard let self, self.currentUtterance != nil else { return }
      self.cancelSpeech(reason: "SPEECH_CALLBACK_TIMEOUT")
    }
    return snapshot()
  }

  private func beginAuthorizedLocation() {
    guard wantsLocation else { return }
    switch manager.authorizationStatus {
    case .authorizedAlways, .authorizedWhenInUse:
      // Setting this to true without the Info.plist capability raises a Core Location exception.
      manager.allowsBackgroundLocationUpdates = backgroundModes.contains("location")
      manager.showsBackgroundLocationIndicator = backgroundModes.contains("location")
      locationState = "RUNNING"
      manager.startUpdatingLocation()
    case .denied, .restricted:
      stopLocation(reason: "LOCATION_PERMISSION_DENIED")
      locationState = "ERROR"
    case .notDetermined:
      locationState = "REQUESTING_PERMISSION"
    @unknown default:
      stopLocation(reason: "LOCATION_AUTHORIZATION_UNKNOWN")
      locationState = "ERROR"
    }
  }

  private func stopLocation(reason: String?) {
    wantsLocation = false
    locationTimeout?.cancel()
    locationTimeout = nil
    manager.stopUpdatingLocation()
    manager.allowsBackgroundLocationUpdates = false
    manager.showsBackgroundLocationIndicator = false
    locationState = "STOPPED"
    locationError = reason
  }

  private func cancelSpeech(reason: String?) {
    speechTimeout?.cancel()
    speechTimeout = nil
    if currentUtterance != nil {
      currentUtterance = nil
      cancelledCount += 1
      speechState = reason == nil ? "CANCELLED" : "ERROR"
      speechError = reason
      synthesizer.stopSpeaking(at: .immediate)
    }
    restoreAudioSession()
  }

  private func restoreAudioSession() {
    guard let lease = audioLease else { return }
    audioLease = nil
    let session = AVAudioSession.sharedInstance()
    // Never restore over a different audio configuration installed by another feature.
    guard session.category == lease.probeCategory, session.mode == lease.probeMode,
          session.categoryOptions == lease.probeOptions else {
      speechError = "AUDIO_SESSION_OWNERSHIP_CHANGED"
      return
    }
    do {
      try session.setActive(false, options: .notifyOthersOnDeactivation)
      try session.setCategory(lease.previousCategory, mode: lease.previousMode, options: lease.previousOptions)
    } catch {
      speechError = "AUDIO_SESSION_RESTORE_FAILED"
    }
  }

  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    Task { @MainActor [weak self] in self?.beginAuthorizedLocation() }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    // Only non-identifying value data crosses from the framework callback into our actor.
    let samples = locations.map {
      ProbeSample(accuracyMeters: $0.horizontalAccuracy, observedAt: $0.timestamp.timeIntervalSince1970)
    }
    let receivedAt = Date().timeIntervalSince1970
    Task { @MainActor [weak self] in self?.recordSamples(samples, receivedAt: receivedAt) }
  }

  private func recordSamples(_ samples: [ProbeSample], receivedAt: TimeInterval) {
    guard wantsLocation, let probeStartedAt else { return }
    for sample in samples {
      if NoLateJourneyDiagnosticsPolicy.sampleRejection(
        accuracyMeters: sample.accuracyMeters,
        observedAt: sample.observedAt,
        probeStartedAt: probeStartedAt.timeIntervalSince1970,
        latestObservedAt: lastSampleAt?.timeIntervalSince1970,
        receivedAt: receivedAt
      ) != nil {
        rejectedSamples += 1
        continue
      }
      totalSamples += 1
      switch UIApplication.shared.applicationState {
      case .active: foregroundSamples += 1
      case .background: backgroundSamples += 1
      case .inactive: inactiveSamples += 1
      @unknown default: inactiveSamples += 1
      }
      lastAccuracy = sample.accuracyMeters
      lastSampleAt = Date(timeIntervalSince1970: sample.observedAt)
      locationError = nil
    }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let code = (error as? CLError)?.code
    let denied = code == .denied
    let message = denied ? "LOCATION_PERMISSION_DENIED"
      : (code == .locationUnknown ? "LOCATION_TEMPORARILY_UNAVAILABLE" : "LOCATION_PROVIDER_ERROR")
    Task { @MainActor [weak self] in self?.recordLocationError(message, denied: denied) }
  }

  private func recordLocationError(_ message: String, denied: Bool) {
    guard wantsLocation else { return }
    if denied {
      stopLocation(reason: "LOCATION_PERMISSION_DENIED")
      locationState = "ERROR"
    } else {
      locationError = message
    }
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
    let identity = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in self?.recordSpeechStarted(identity) }
  }

  private func recordSpeechStarted(_ identity: ObjectIdentifier) {
    guard let currentUtterance, identity == ObjectIdentifier(currentUtterance) else { return }
    speechState = "SPEAKING"
    startedCount += 1
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    let identity = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in self?.recordSpeechFinished(identity, cancelled: false) }
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    let identity = ObjectIdentifier(utterance)
    Task { @MainActor [weak self] in self?.recordSpeechFinished(identity, cancelled: true) }
  }

  private func recordSpeechFinished(_ identity: ObjectIdentifier, cancelled: Bool) {
    guard let utterance = currentUtterance, identity == ObjectIdentifier(utterance) else { return }
    currentUtterance = nil
    speechTimeout?.cancel()
    speechTimeout = nil
    speechState = cancelled ? "CANCELLED" : "COMPLETED"
    if cancelled { cancelledCount += 1 } else { completedCount += 1 }
    restoreAudioSession()
  }

  private var authorizationName: String {
    switch manager.authorizationStatus {
    case .authorizedAlways: return "ALWAYS"
    case .authorizedWhenInUse: return "WHEN_IN_USE"
    case .denied: return "DENIED"
    case .restricted: return "RESTRICTED"
    case .notDetermined: return "NOT_DETERMINED"
    @unknown default: return "UNKNOWN"
    }
  }

  private var applicationStateName: String {
    switch UIApplication.shared.applicationState {
    case .active: return "ACTIVE"
    case .background: return "BACKGROUND"
    case .inactive: return "INACTIVE"
    @unknown default: return "UNKNOWN"
    }
  }
}
#endif
