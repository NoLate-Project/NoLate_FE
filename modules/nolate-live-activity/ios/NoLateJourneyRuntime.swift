#if DEBUG
import CoreLocation
import Foundation
import UIKit

/// P1-1 simulator-only host of the production-independent pure engine.
/// This never calls schedule APIs, cancels alarms, publishes ActivityKit, or uploads locations.
/// The singleton owns the session; screens and Expo module instances only observe it.
@MainActor
final class NoLateJourneyRuntime: NSObject {
  static let shared = NoLateJourneyRuntime()
  private typealias Core = NoLateJourneyEngineCore
  private enum InputMode: String, Codable { case location = "SIMULATOR_LOCATION", replay = "TIMED_REPLAY" }
  private struct Checkpoint: Codable {
    let schema: Int
    let mode: InputMode
    let observationSequence: Int64
    let replayIndex: Int
    let engine: Core.Snapshot
  }
  private struct Sample: Sendable {
    let latitude: Double
    let longitude: Double
    let accuracy: Double
    let observedAt: TimeInterval
  }
  private enum LocationEvent: Sendable {
    case authorization, samples([Sample]), failure(denied: Bool)
  }
  /// A fresh immutable token fences callbacks queued by an earlier session/provider.
  private final class LocationDelegate: NSObject, CLLocationManagerDelegate {
    let token: UUID
    let receive: @Sendable (UUID, LocationEvent) -> Void
    init(token: UUID, receive: @escaping @Sendable (UUID, LocationEvent) -> Void) {
      self.token = token
      self.receive = receive
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { receive(token, .authorization) }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
      receive(token, .samples(locations.map {
        Sample(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude,
               accuracy: $0.horizontalAccuracy, observedAt: $0.timestamp.timeIntervalSince1970)
      }))
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
      receive(token, .failure(denied: (error as? CLError)?.code == .denied))
    }
  }
  private var engine: Core?
  private var mode: InputMode?
  private var manager: CLLocationManager?
  private var locationDelegate: LocationDelegate?
  private var inputToken: UUID?
  private var runtimeDeadline: ContinuousClock.Instant?
  private var clockTask: Task<Void, Never>?
  private var replayTask: Task<Void, Never>?
  private var observationSequence: Int64 = 0
  private var replayIndex = 0
  private var traceFinished = false
  private var restored = false
  private var locationState = "IDLE"
  private var lastError: String?
  private var sinkOwner: UUID?
  private var eventSink: (([String: Any]) -> Void)?
  private var lastPersistedAt: TimeInterval = 0
  private let maximumDuration: TimeInterval = 600
  private var fixtureRoute: Core.Route {
    .init(coordinates: [.init(latitude: 37.5665, longitude: 126.9780),
                        .init(latitude: 37.5665, longitude: 126.9880)], provenance: .syntheticReplay)
  }

  private var enabled: Bool {
    Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyDiagnosticsEnabled") as? Bool == true
  }
  private var checkpointURL: URL? {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
      .appendingPathComponent("NoLateJourneyDevelopment", isDirectory: true)
      .appendingPathComponent("automatic-departure-v1.json")
  }
  private lazy var checkpointStore = checkpointURL.map { NoLateJourneyCheckpointStore<Checkpoint>(url: $0) }
  private var isRunning: Bool {
    guard let state = engine?.snapshot.status.rawValue else { return false }
    return state == "ARMED" || state == "ACTIVE"
  }
  var hasLiveSession: Bool { isRunning }

  func setEventSink(owner: UUID, sink: @escaping ([String: Any]) -> Void) {
    sinkOwner = owner
    eventSink = sink
  }
  func removeEventSink(owner: UUID) {
    guard sinkOwner == owner else { return }
    sinkOwner = nil
    eventSink = nil
  }

  func snapshot() -> [String: Any?] {
    guard enabled else { return ["enabled": false, "reason": "DIAGNOSTICS_BUILD_REQUIRED"] }
    let before = engine?.snapshot
    let now = Date().timeIntervalSince1970
    enforceLifetime(now: now)
    _ = engine?.tick(now: now)
    if !isRunning, engine != nil { releaseInputs() }
    // Clock-only freshness bookkeeping need not cause a flash write every second.
    if let after = engine?.snapshot,
       before?.status != after.status || before?.quality != after.quality || before?.reason != after.reason
        || now - lastPersistedAt >= 10 { saveOrStop() }
    return viewState()
  }

  func arm(mode requestedMode: String) -> [String: Any?] {
    guard enabled else { return snapshot() }
    _ = NoLateJourneyAutomaticRuntime.shared.snapshot()
    guard !NoLateJourneyAutomaticRuntime.shared.hasLiveSession else {
      lastError = "OTHER_JOURNEY_RUNTIME_RUNNING"
      return snapshot()
    }
    guard UIApplication.shared.applicationState == .active else {
      lastError = "FOREGROUND_REQUIRED"
      return snapshot()
    }
    _ = snapshot() // Recheck expiry before deciding whether a session may be replaced.
    guard !isRunning else {
      lastError = "SESSION_ALREADY_RUNNING"
      return snapshot()
    }
    guard let selectedMode = InputMode(rawValue: requestedMode) else {
      lastError = "INVALID_INPUT_MODE"
      return snapshot()
    }
    releaseInputs()
    checkpointStore = checkpointURL.map { NoLateJourneyCheckpointStore<Checkpoint>(url: $0) }
    let now = Date().timeIntervalSince1970
    do {
      let identity = Core.Identity(sessionId: UUID().uuidString, generation: 1, routeRevision: 1, epoch: 1)
      engine = try Core(identity: identity, route: fixtureRoute, policy: .init(), armedAt: now, expiresAt: now + maximumDuration)
      mode = selectedMode
      observationSequence = 0
      replayIndex = 0
      traceFinished = false
      restored = false
      lastError = nil
      guard saveOrStop() else { return viewState() }
      beginInputs()
    } catch {
      engine = nil
      lastError = "ENGINE_CONFIGURATION_INVALID"
    }
    publish()
    return snapshot()
  }

  func stop() -> [String: Any?] {
    guard enabled else { return snapshot() }
    _ = engine?.stop(now: Date().timeIntervalSince1970)
    releaseInputs()
    revokeCheckpoint()
    publish()
    return snapshot()
  }

  /// Recovery is explicit, never a side effect of opening a screen or accepting a permission.
  func restore() -> [String: Any?] {
    guard enabled else { return snapshot() }
    _ = NoLateJourneyAutomaticRuntime.shared.snapshot()
    guard !NoLateJourneyAutomaticRuntime.shared.hasLiveSession else {
      lastError = "OTHER_JOURNEY_RUNTIME_RUNNING"
      return snapshot()
    }
    guard UIApplication.shared.applicationState == .active else {
      lastError = "FOREGROUND_REQUIRED"
      return snapshot()
    }
    _ = snapshot()
    guard !isRunning else { lastError = "SESSION_ALREADY_RUNNING"; return snapshot() }
    guard checkpointStore != nil else { lastError = "CHECKPOINT_UNAVAILABLE"; return snapshot() }
    do {
      guard let checkpoint = try checkpointStore?.restore() else { throw CocoaError(.fileReadNoSuchFile) }
      guard checkpoint.schema == 1, checkpoint.observationSequence >= 0,
            (0...13).contains(checkpoint.replayIndex),
            checkpoint.observationSequence >= (checkpoint.engine.lastObservationSequence ?? 0),
            checkpoint.engine.expiresAt - checkpoint.engine.armedAt <= maximumDuration,
            checkpoint.engine.route == fixtureRoute, checkpoint.engine.policy == Core.Policy() else {
        throw CocoaError(.fileReadCorruptFile)
      }
      let recovered = try Core(restoring: checkpoint.engine, now: Date().timeIntervalSince1970)
      releaseInputs()
      engine = recovered
      mode = checkpoint.mode
      observationSequence = checkpoint.observationSequence
      replayIndex = checkpoint.replayIndex
      traceFinished = replayIndex >= 13
      restored = true
      lastError = nil
      guard saveOrStop() else { return viewState() }
      if isRunning { beginInputs() }
      publish()
    } catch {
      // Do not show raw paths, checkpoint contents, coordinates, or underlying native errors.
      lastError = "CHECKPOINT_INVALID_OR_MISSING"
    }
    return snapshot()
  }

  private func beginInputs() {
    guard isRunning, let identity = engine?.snapshot.identity else { return }
    runtimeDeadline = ContinuousClock.now.advanced(by: .seconds(min(maximumDuration,
      max(0, (engine?.snapshot.expiresAt ?? 0) - Date().timeIntervalSince1970))))
    clockTask = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
        guard let self, self.engine?.snapshot.identity == identity else { return }
        _ = self.snapshot()
        self.publish()
        if !self.isRunning { return }
      }
    }
    if mode == .replay {
      locationState = "REPLAYING"
      replayTask = Task { @MainActor [weak self] in
        while !Task.isCancelled {
          guard let self, self.isRunning, self.engine?.snapshot.identity == identity else { return }
          guard self.replayIndex < 13 else { self.traceFinished = true; self.publish(); return }
          // 0, 20, ... 240 m, at 4-second intervals; timestamps are real injected clock values.
          let eastMeters = Double(self.replayIndex) * 20
          self.replayIndex += 1
          let now = Date().timeIntervalSince1970
          self.ingest(.init(latitude: 37.5665, longitude: 126.9780 + eastMeters / 88_139,
                            accuracy: 5, observedAt: now), now: now)
          do { try await Task.sleep(nanoseconds: 4_000_000_000) } catch { return }
        }
      }
    } else if mode == .location {
      let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
      guard modes.contains("location"), CLLocationManager.locationServicesEnabled(),
            let usage = Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") as? String,
            !usage.isEmpty else {
        failAndStop("LOCATION_CAPABILITY_UNAVAILABLE")
        return
      }
      let provider = CLLocationManager()
      let token = UUID()
      inputToken = token
      let delegate = LocationDelegate(token: token) { [weak self] token, event in
        Task { @MainActor [weak self] in
          guard let self, self.inputToken == token else { return }
          switch event {
          case .authorization: self.beginAuthorizedLocation()
          case .samples(let samples):
            // The observation retains its timestamp; evaluation time belongs to this actor turn.
            for sample in samples { self.ingest(sample, now: Date().timeIntervalSince1970) }
          case .failure(let denied):
            if denied { self.failAndStop("LOCATION_PERMISSION_DENIED") }
            else { self.lastError = "LOCATION_TEMPORARILY_UNAVAILABLE"; self.publish() }
          }
        }
      }
      locationDelegate = delegate
      manager = provider
      provider.delegate = delegate
      provider.desiredAccuracy = kCLLocationAccuracyBest
      provider.distanceFilter = kCLDistanceFilterNone
      provider.activityType = .fitness
      provider.pausesLocationUpdatesAutomatically = false
      if provider.authorizationStatus == .notDetermined {
        locationState = "REQUESTING_PERMISSION"
        provider.requestWhenInUseAuthorization()
      } else { beginAuthorizedLocation() }
    }
  }

  private func beginAuthorizedLocation() {
    guard isRunning, mode == .location, let provider = manager else { return }
    switch provider.authorizationStatus {
    case .authorizedAlways, .authorizedWhenInUse:
      provider.allowsBackgroundLocationUpdates = true
      provider.showsBackgroundLocationIndicator = true
      provider.startUpdatingLocation()
      locationState = "RUNNING"
    case .notDetermined: locationState = "REQUESTING_PERMISSION"
    case .denied, .restricted: failAndStop("LOCATION_PERMISSION_DENIED")
    @unknown default: failAndStop("LOCATION_AUTHORIZATION_UNKNOWN")
    }
    publish()
  }

  private func ingest(_ sample: Sample, now: TimeInterval) {
    enforceLifetime(now: now)
    guard isRunning, let identity = engine?.snapshot.identity else {
      saveOrStop()
      publish()
      return
    }
    guard observationSequence < Int64.max else { failAndStop("SEQUENCE_EXHAUSTED"); return }
    observationSequence += 1
    _ = engine?.ingest(.init(identity: identity, sequence: observationSequence, observedAt: sample.observedAt,
                            coordinate: .init(latitude: sample.latitude, longitude: sample.longitude),
                            horizontalAccuracyMeters: sample.accuracy, source: .replay), now: now)
    if !isRunning { releaseInputs() }
    saveOrStop()
    publish()
  }

  private func releaseInputs() {
    inputToken = nil
    runtimeDeadline = nil
    clockTask?.cancel(); clockTask = nil
    replayTask?.cancel(); replayTask = nil
    manager?.delegate = nil
    manager?.stopUpdatingLocation()
    manager?.allowsBackgroundLocationUpdates = false
    manager?.showsBackgroundLocationIndicator = false
    manager = nil
    locationDelegate = nil
    if engine != nil { locationState = "STOPPED" }
  }
  private func enforceLifetime(now: TimeInterval) {
    guard isRunning, let state = engine?.snapshot else { return }
    if now < state.lastEvaluationAt {
      lastError = "CLOCK_REGRESSION"
      _ = engine?.stop(now: now)
      releaseInputs()
    } else if let deadline = runtimeDeadline, ContinuousClock.now >= deadline {
      _ = engine?.tick(now: max(now, state.expiresAt))
      releaseInputs()
    }
  }
  private func failAndStop(_ reason: String) {
    lastError = reason
    _ = engine?.stop(now: Date().timeIntervalSince1970)
    releaseInputs()
    saveOrStop()
    publish()
  }

  @discardableResult private func saveOrStop() -> Bool {
    guard let engine, let mode else { return true }
    if engine.snapshot.status.isTerminal { return revokeCheckpoint() }
    do {
      guard let url = checkpointURL, checkpointStore != nil else { throw CocoaError(.fileWriteUnknown) }
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try checkpointStore?.save(Checkpoint(schema: 1, mode: mode, observationSequence: observationSequence,
                                          replayIndex: replayIndex, engine: engine.snapshot))
      lastPersistedAt = Date().timeIntervalSince1970
      return true
    } catch {
      lastError = "CHECKPOINT_WRITE_FAILED"
      _ = self.engine?.stop(now: Date().timeIntervalSince1970)
      releaseInputs()
      revokeCheckpoint()
      return false
    }
  }

  @discardableResult private func revokeCheckpoint() -> Bool {
    do {
      try checkpointStore?.revoke()
      lastPersistedAt = Date().timeIntervalSince1970
      return true
    } catch {
      // Collection is stopped regardless. A totally unwritable filesystem cannot promise
      // durable revocation across process death; surface this instead of claiming success.
      lastError = "CHECKPOINT_REVOCATION_FAILED"
      return false
    }
  }

  private func publish() { eventSink?(viewState().compactMapValues { $0 }) }
  private func viewState() -> [String: Any?] {
    let state = engine?.snapshot
    return [
      "enabled": enabled, "reason": "P1_SYNTHETIC_DEPARTURE_ONLY", "inputMode": mode?.rawValue ?? "NONE",
      "locationState": locationState, "authorization": authorizationName,
      "applicationState": UIApplication.shared.applicationState == .active ? "ACTIVE" : "BACKGROUND",
      "status": state?.status.rawValue ?? "IDLE", "quality": state?.quality.rawValue ?? "UNAVAILABLE",
      "qualityReason": state?.reason.rawValue ?? "NOT_ARMED", "sequence": state?.sequence ?? 0,
      "evidenceCount": state?.evidenceCount ?? 0, "alongRouteMeters": state?.alongRouteMeters,
      "crossTrackMeters": state?.crossTrackMeters, "departureCount": state?.departureEventKey == nil ? 0 : 1,
      "checkpointAvailable": checkpointStore?.canRestore ?? false,
      "restored": restored, "remainingSeconds": state.map { max(0, Int($0.expiresAt - Date().timeIntervalSince1970)) } ?? 0,
      "traceFinished": traceFinished, "lastErrorCode": lastError
    ]
  }
  private var authorizationName: String {
    guard let manager else { return "NOT_COLLECTING" }
    switch manager.authorizationStatus {
    case .authorizedAlways: return "ALWAYS"
    case .authorizedWhenInUse: return "WHEN_IN_USE"
    case .denied: return "DENIED"
    case .restricted: return "RESTRICTED"
    case .notDetermined: return "NOT_DETERMINED"
    @unknown default: return "UNKNOWN"
    }
  }

}
#endif
