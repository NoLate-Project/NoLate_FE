import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyDiagnosticsTests: XCTestCase {
  func testOnlyFreshValidLocationCallbacksCountAsProbeEvidence() {
    XCTAssertNil(rejection(accuracy: 8, observed: 105, latest: 104))
    XCTAssertNil(rejection(accuracy: 0, observed: 100))
    XCTAssertEqual(rejection(accuracy: -1), "INVALID_ACCURACY")
    XCTAssertEqual(rejection(accuracy: .infinity), "INVALID_ACCURACY")
    XCTAssertEqual(rejection(accuracy: .nan), "INVALID_ACCURACY")
    XCTAssertEqual(rejection(observed: .nan), "INVALID_TIMESTAMP")
    XCTAssertEqual(rejection(observed: 99.9), "CACHED_BEFORE_PROBE")
    XCTAssertEqual(rejection(observed: 116), "FUTURE_TIMESTAMP")
    XCTAssertEqual(rejection(observed: 105, received: 136), "STALE_SAMPLE")
    XCTAssertEqual(rejection(observed: 105, latest: 105), "DUPLICATE_OR_OLDER")
    XCTAssertEqual(rejection(observed: 105, latest: 106), "DUPLICATE_OR_OLDER")
  }

  func testModesExposeTheSilentVsLockScreenTradeoffExplicitly() {
    XCTAssertTrue(NoLateJourneyDiagnosticsPolicy.isSupportedSpeechMode("RESPECT_SILENT"))
    XCTAssertTrue(NoLateJourneyDiagnosticsPolicy.isSupportedSpeechMode("LOCK_SCREEN"))
    XCTAssertFalse(NoLateJourneyDiagnosticsPolicy.isSupportedSpeechMode("AUTO_DETECT_SILENT"))
    XCTAssertFalse(NoLateJourneyDiagnosticsPolicy.isSupportedSpeechMode(""))
  }

  func testDevelopmentProbeHasABoundedLifetime() {
    XCTAssertEqual(NoLateJourneyDiagnosticsPolicy.maximumProbeDurationSeconds, 600)
  }

  private func rejection(
    accuracy: Double = 8, observed: TimeInterval = 105, latest: TimeInterval? = nil,
    received: TimeInterval = 110
  ) -> String? {
    NoLateJourneyDiagnosticsPolicy.sampleRejection(
      accuracyMeters: accuracy, observedAt: observed, probeStartedAt: 100,
      latestObservedAt: latest, receivedAt: received
    )
  }
}
