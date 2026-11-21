import CoreLocation
import Foundation
import UIKit
import UserNotifications
import CryptoKit
import AVFoundation

/// Opt-in GPS inference and local Activity. Product and diagnostic builds have
/// separate Info.plist gates and checkpoint directories. No GPS upload.
@MainActor
final class NoLateJourneyAutomaticRuntime: NSObject {
  static let shared = NoLateJourneyAutomaticRuntime()
  private typealias Session = NoLateJourneyAutomaticSession
  private struct Sample: Sendable {
    let latitude: Double, longitude: Double, accuracy: Double, observedAt: TimeInterval
  }
  private enum LocationEvent: Sendable { case authorization(CLAuthorizationStatus), samples([Sample]), failed(Bool) }
  private final class Delegate: NSObject, CLLocationManagerDelegate {
    let token: UUID
    let receive: @Sendable (UUID, LocationEvent) -> Void
    init(token: UUID, receive: @escaping @Sendable (UUID, LocationEvent) -> Void) {
      self.token = token; self.receive = receive
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
      receive(token, .authorization(manager.authorizationStatus))
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
      receive(token, .samples(locations.map { .init(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude,
        accuracy: $0.horizontalAccuracy, observedAt: $0.timestamp.timeIntervalSince1970) }))
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
      receive(token, .failed((error as? CLError)?.code == .denied))
    }
  }
  private var session: Session?
  private var manager: CLLocationManager?
  private var delegate: Delegate?
  private var token: UUID?
  private var clockTask: Task<Void, Never>?
  private var deadline: ContinuousClock.Instant?
  private var lastPersistedAt: TimeInterval = 0
  private var lastError: String?
  private var arrivalHandoffUntil: Date?
  // Local diagnostics only: last received accuracy is not engine acceptance or vehicle evidence.
  // Never persisted in the envelope or included in the departure outbox.
  private var lastAccuracyMeters: Double?
  private var guidanceSample: Sample?
  private var offRouteCandidate: NoLateJourneyOffRouteMapPolicy.Fix?
  private var offRouteMapSample: NoLateJourneyOffRouteMapPolicy.Fix?
  private var lastRideDiagnostic: String?
  private var lastHandoffDiagnostic: String?
  private let guidanceNotices = NoLateJourneyNoticeDelivery()
  private var locationState = "IDLE"
  private var locationAuthorization: CLAuthorizationStatus?
  private var restored = false
  private let guidancePushPilot = NoLateGuidancePushPilot()
  private lazy var guidanceActivity = NoLateAutomaticGuidanceActivity(pushPilot: guidancePushPilot)
  private var authentication: NoLateJourneyAuthentication?
  private var rerouteCommitBinding: Session.Binding?
  private var rerouteCommitDeadline: ContinuousClock.Instant?
  private lazy var guidanceArrivals = NoLateSavedGuidanceArrivalTransport(authentication: { [weak self] in self?.authentication },
    changed: { [weak self] in self?.publish() })
  private lazy var guidanceVehicles = NoLateSavedGuidanceRideTransport(authentication: { [weak self] in self?.authentication },
    changed: { [weak self] in self?.refreshRideAdmission(); self?.publish() })
  private lazy var guidanceSubway = NoLateSavedGuidanceSubwayTransport(authentication: { [weak self] in self?.authentication },
    changed: { [weak self] in self?.publish() })
  private var revocationFailed = false
  private var sinkOwner: UUID?
  private var eventSink: (([String: Any]) -> Void)?
  private var expectedExecution: String? {
    #if targetEnvironment(simulator)
    return "SIMULATOR"
    #else
    if productBuild { return "DEVICE" }
    return Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyDeviceFieldTestEnabled") as? Bool == true ? "DEVICE" : nil
    #endif
  }
  private var productBuild: Bool {
    Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyProductEnabled") as? Bool == true
  }
  private var enabled: Bool {
    (productBuild || Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyDiagnosticsEnabled") as? Bool == true)
      && expectedExecution != nil
  }
  private var checkpointURL: URL? {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
      .appendingPathComponent(productBuild ? "NoLateJourney" : "NoLateJourneyDevelopment", isDirectory: true)
      .appendingPathComponent("automatic-selected-route-v1.json")
  }
  private lazy var store = checkpointURL.map { NoLateJourneyAutomaticStore<Session.Envelope>(url: $0) }
  private var running: Bool { session.map { !$0.core.snapshot.status.isTerminal } ?? false }
  var hasLiveSession: Bool { running || session?.pendingDeparture != nil }

  func setEventSink(owner: UUID, sink: @escaping ([String: Any]) -> Void) { sinkOwner = owner; eventSink = sink }
  func removeEventSink(owner: UUID) {
    guard owner == sinkOwner else { return }
    sinkOwner = nil; eventSink = nil
  }

  func snapshot() -> [String: Any?] {
    guard enabled else { return ["enabled": false, "reason": "JOURNEY_BUILD_REQUIRED"] }
    advanceClock()
    return viewState()
  }

  func configureAuthentication(_ json: String) -> [String: Any] {
    guard enabled, Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyAuthenticatedEnabled") as? Bool == true,
      !running, json.utf8.count <= 12288,
      let auth = try? JSONDecoder().decode(NoLateJourneyAuthentication.self, from: Data(json.utf8)),
      auth.valid(now: Date().timeIntervalSince1970) else { return ["accepted": false] }
    authentication = auth
    return ["accepted": true]
  }
  func configurePushPilot(fcmToken: String) -> [String: Any] {
    #if !targetEnvironment(simulator)
    return ["accepted": false]
    #else
    guard enabled, !running, UIApplication.shared.applicationState == .active else { return ["accepted": false] }
    return ["accepted": guidancePushPilot.configure(fcmToken: fcmToken)]
    #endif
  }
  func configureRemoteUpdates(fcmToken: String) -> [String: Any] {
    guard enabled, productBuild, !running, UIApplication.shared.applicationState == .active,
      authentication?.valid(now: Date().timeIntervalSince1970) == true else { return ["accepted": false] }
    return ["accepted": guidancePushPilot.configureProduct(fcmToken: fcmToken)]
  }
  func updateRemoteRegistration(fcmToken: String, bindingJSON: String) -> [String: Any] {
    let now = Date().timeIntervalSince1970
    guard enabled, productBuild, running, bindingJSON.utf8.count <= 4096, let session,
      let expected = try? Session.decodeBinding(bindingJSON, now: now), expected == session.binding,
      authentication?.matches(expected, now: now) == true else { return ["accepted": false] }
    let result = guidancePushPilot.updateProductRegistration(fcmToken)
    if result.changed { publish() }
    return ["accepted": result.accepted]
  }
  func configureNoticeMode(_ mode: String, sessionId: String? = nil) -> [String: Any] {
    guard enabled, UIApplication.shared.applicationState == .active,
      ["OFF", "NOTIFICATIONS", "VOICE_AND_NOTIFICATIONS"].contains(mode) else { return ["accepted": false] }
    if let sessionId {
      guard running, session?.binding.sessionId == sessionId else { return ["accepted": false] }
    } else if running { return ["accepted": false] }
    guidanceNotices.configure(mode, preservingJourney: running)
    eventSink?(viewState().compactMapValues { $0 })
    return ["accepted": true]
  }
  func updateAuthentication(_ json: String, bindingJSON: String, previousAccessToken: String) -> [String: Any] {
    let now = Date().timeIntervalSince1970
    // No session reset, new GPS manager, checkpoint write or lifetime extension.
    guard enabled, Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyAuthenticatedEnabled") as? Bool == true,
      UIApplication.shared.applicationState == .active, running,
      json.utf8.count <= 12288, bindingJSON.utf8.count <= 4096,
      let active = session, let previous = authentication,
      let binding = try? Session.decodeBinding(bindingJSON, now: now), binding == active.binding,
      let next = try? JSONDecoder().decode(NoLateJourneyAuthentication.self, from: Data(json.utf8)),
      next.canReplace(previous, expectedToken: previousAccessToken, binding: binding, now: now)
      else { return ["accepted": false] }
    authentication = next
    return ["accepted": true]
  }
  private func authenticated(_ candidate: Session, now: Double) -> Bool {
    candidate.binding.syncScope != "AUTHENTICATED" || (Bundle.main.object(forInfoDictionaryKey: "NoLateJourneyAuthenticatedEnabled") as? Bool == true
      && authentication?.coversNavigation(candidate.binding, now: now) == true)
  }

  func arm(routeJSON: String, bindingJSON: String) -> [String: Any?] {
    guard enabled else { return snapshot() }
    guard UIApplication.shared.applicationState == .active else { lastError = "FOREGROUND_REQUIRED"; return snapshot() }
    #if DEBUG
    _ = NoLateJourneyRuntime.shared.snapshot()
    guard !NoLateJourneyRuntime.shared.hasLiveSession else { lastError = "OTHER_JOURNEY_RUNTIME_RUNNING"; return snapshot() }
    #endif
    advanceClock()
    guard !running, session?.pendingDeparture == nil else { lastError = "SESSION_ALREADY_RUNNING"; return viewState() }
    guard !revocationFailed else { lastError = "AUTOMATIC_REVOCATION_FAILED"; return viewState() }
    do {
      let now = Date().timeIntervalSince1970
      let candidate = try Session(routeJSON: routeJSON, bindingJSON: bindingJSON, now: now)
      guard candidate.binding.execution == expectedExecution else { lastError = "EXECUTION_PLATFORM_MISMATCH"; return viewState() }
      guard authenticated(candidate, now: now) else { lastError = "AUTOMATIC_AUTH_REQUIRED"; return viewState() }
      store = checkpointURL.map { NoLateJourneyAutomaticStore<Session.Envelope>(url: $0) }
      // A process restart cannot replace an unacknowledged or still-active session without stop.
      if let saved = try store?.load(), saved.binding.expiresAtEpochSeconds > now,
         !saved.engine.status.isTerminal { lastError = "CHECKPOINT_RESTORE_OR_STOP_REQUIRED"; return viewState() }
      releaseInputs()
      store = checkpointURL.map { NoLateJourneyAutomaticStore<Session.Envelope>(url: $0) }
      restored = false
      lastError = nil
      guard commit(candidate) else { return viewState() }
      arrivalHandoffUntil = nil
      beginInputs()
    } catch {
      lastError = "AUTOMATIC_ARM_REJECTED"
    }
    publish()
    return snapshot()
  }

  /// Replace the route only after the authenticated server has committed its next revision.
  /// A cold process can use the intact prior checkpoint as the replacement source.
  func replace(routeJSON: String, bindingJSON: String) -> [String: Any?] {
    guard enabled, UIApplication.shared.applicationState == .active, !revocationFailed else {
      lastError = "FOREGROUND_REQUIRED"; return snapshot()
    }
    let now = Date().timeIntervalSince1970
    do {
      let previous: Session
      if let live = session, live.core.snapshot.status == .active { previous = live }
      else {
        guard let envelope = try store?.load(), envelope.engine.status == .active,
          let bindingData = try? JSONEncoder().encode(envelope.binding),
          let oldJSON = String(data: bindingData, encoding: .utf8)
        else { lastError = "REROUTE_CHECKPOINT_UNAVAILABLE"; return viewState() }
        previous = try Session(restoring: envelope, routeJSON: envelope.routeJSON,
          bindingJSON: oldJSON, now: now)
      }
      let candidate = try Session(replacing: previous, routeJSON: routeJSON,
        bindingJSON: bindingJSON, now: now)
      guard candidate.binding.execution == expectedExecution, authenticated(candidate, now: now) else {
        lastError = "REROUTE_AUTH_REJECTED"; return viewState()
      }
      releaseInputs()
      lastError = nil
      restored = false
      guard commit(candidate) else { return viewState() }
      beginInputs()
      publish()
    } catch { lastError = "REROUTE_REPLACEMENT_REJECTED" }
    return snapshot()
  }

  /// The server may supersede the old session before its commit response reaches JS.
  /// Pause old-session observation requests briefly so their expected 409 cannot revoke
  /// the checkpoint while JS verifies the new revision through /current.
  func beginRerouteCommit(bindingJSON: String) -> [String: Any] {
    let now = Date().timeIntervalSince1970
    guard enabled, UIApplication.shared.applicationState == .active,
      let active = session, active.core.snapshot.status == .active,
      active.departureAcknowledged, active.binding.savedRouteValidated == true,
      let binding = try? Session.decodeBinding(bindingJSON, now: now), binding == active.binding,
      authenticated(active, now: now) else { return ["accepted": false] }
    rerouteCommitBinding = binding
    rerouteCommitDeadline = ContinuousClock.now.advanced(by: .seconds(30))
    guidanceArrivals.clear(); guidanceVehicles.clear(); guidanceSubway.clear()
    publish()
    return ["accepted": true]
  }

  func endRerouteCommit(bindingJSON: String) -> [String: Any] {
    let now = Date().timeIntervalSince1970
    guard let binding = try? Session.decodeBinding(bindingJSON, now: now),
      rerouteCommitBinding == binding, session?.binding == binding else { return ["accepted": false] }
    rerouteCommitBinding = nil; rerouteCommitDeadline = nil
    advanceClock(); publish()
    return ["accepted": running]
  }

  func clearArrivalHandoff() {
    guard arrivalHandoffUntil != nil else { return }
    arrivalHandoffUntil = nil
    publish()
  }

  func stop() -> [String: Any?] {
    guard enabled else { return snapshot() }
    NSLog("NOLATE_GUIDANCE_RUNTIME explicit_stop")
    session?.stop(now: Date().timeIntervalSince1970)
    lastError = NoLateJourneyAutomaticLocationErrorPolicy.afterExplicitStop(lastError)
    guidancePushPilot.reset()
    authentication = nil
    releaseInputs()
    revoke()
    publish()
    return viewState()
  }

  func reconcileTerminal(bindingJSON: String) -> [String: Any?] {
    guard enabled, UIApplication.shared.applicationState == .active, !revocationFailed else { return ["accepted": false] }
    do {
      let expected = try Session.decodeBinding(bindingJSON, now: Date().timeIntervalSince1970)
      guard store != nil else { return ["accepted": false] }
      let saved = try store?.load()
      guard Session.canReconcileTerminal(expected: expected, checkpoint: saved?.binding, live: session?.binding,
        hasLiveSession: hasLiveSession) else { return ["accepted": false] }
      // Server authority is checked by the JS coordinator; this guard prevents a late receipt
      // from clearing another native binding. No location/Activity restoration occurs here.
      _ = stop()
      return ["accepted": !revocationFailed && self.store?.canRestore == false]
    } catch { return ["accepted": false] }
  }

  func readSavedCheckpointRoute(bindingJSON: String) -> [String: Any] {
    let now = Date().timeIntervalSince1970
    guard productBuild, enabled, UIApplication.shared.applicationState == .active,
      !hasLiveSession, !revocationFailed,
      let expected = try? Session.decodeBinding(bindingJSON, now: now),
      expected.execution == expectedExecution, expected.syncScope == "AUTHENTICATED",
      expected.savedRouteValidated == true, now < expected.expiresAtEpochSeconds,
      authentication?.coversNavigation(expected, now: now) == true,
      let envelope = try? store?.load(), envelope.schemaVersion == 1,
      envelope.binding == expected, envelope.routeJSON.utf8.count <= 1_048_576,
      Session.digest(envelope.routeJSON) == expected.routeInputDigest
    else { return ["accepted": false] }
    return ["accepted": true, "routeJSON": envelope.routeJSON]
  }

  func restore(routeJSON: String, bindingJSON: String) -> [String: Any?] {
    guard enabled else { return snapshot() }
    guard UIApplication.shared.applicationState == .active else { lastError = "FOREGROUND_REQUIRED"; return snapshot() }
    #if DEBUG
    _ = NoLateJourneyRuntime.shared.snapshot()
    guard !NoLateJourneyRuntime.shared.hasLiveSession else { lastError = "OTHER_JOURNEY_RUNTIME_RUNNING"; return snapshot() }
    #endif
    advanceClock()
    guard !running, session?.pendingDeparture == nil else { lastError = "SESSION_ALREADY_RUNNING"; return viewState() }
    guard !revocationFailed else { lastError = "AUTOMATIC_REVOCATION_FAILED"; return viewState() }
    do {
      store = checkpointURL.map { NoLateJourneyAutomaticStore<Session.Envelope>(url: $0) }
      guard let envelope = try store?.load() else { lastError = "CHECKPOINT_MISSING_OR_REVOKED"; return viewState() }
      let candidate = try Session(restoring: envelope, routeJSON: routeJSON, bindingJSON: bindingJSON,
                                  now: Date().timeIntervalSince1970)
      guard candidate.binding.execution == expectedExecution else { lastError = "EXECUTION_PLATFORM_MISMATCH"; return viewState() }
      guard authenticated(candidate, now: Date().timeIntervalSince1970) else { lastError = "AUTOMATIC_AUTH_REQUIRED"; return viewState() }
      releaseInputs()
      restored = true
      lastError = nil
      if candidate.core.snapshot.status.isTerminal {
        session = candidate
        revoke()
      } else if commit(candidate) { beginInputs() }
    } catch {
      lastError = "AUTOMATIC_RESTORE_REJECTED"
    }
    publish()
    return snapshot()
  }

  func departure() -> [String: Any?] {
    guard enabled else { return ["available": false, "reason": "JOURNEY_BUILD_REQUIRED"] }
    advanceClock()
    guard let event = session?.pendingDeparture else { return ["available": true, "eventJSON": NSNull()] }
    do {
      let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
      return ["available": true, "eventJSON": String(decoding: try encoder.encode(event), as: UTF8.self)]
    } catch { return ["available": false, "reason": "DEPARTURE_ENCODING_FAILED"] }
  }

  func acknowledge(eventKey: String, bindingJSON: String) -> [String: Any?] {
    guard enabled else { return snapshot() }
    advanceClock()
    guard var candidate = session else { lastError = "AUTOMATIC_SESSION_MISSING"; return viewState() }
    do {
      try candidate.acknowledge(eventKey: eventKey, bindingJSON: bindingJSON, now: Date().timeIntervalSince1970)
      guard commit(candidate) else { return viewState() }
      lastError = nil
    } catch { lastError = "DEPARTURE_ACKNOWLEDGEMENT_REJECTED" }
    publish()
    return viewState()
  }

  private func advanceClock() {
    guard var candidate = session, !candidate.core.snapshot.status.isTerminal else { return }
    let now = Date().timeIntervalSince1970
    let reroutePending = rerouteCommitBinding == candidate.binding
    if reroutePending {
      guard let rerouteCommitDeadline, ContinuousClock.now < rerouteCommitDeadline else {
        failClosed("REROUTE_CONFIRMATION_TIMEOUT"); return
      }
    }
    if !reroutePending && guidanceVehicles.admission(session: candidate, now: now) == nil { candidate.expireRideAdmission() }
    guard authenticated(candidate, now: now) else { failClosed("AUTOMATIC_AUTH_EXPIRED"); return }
    if now < candidate.core.snapshot.lastEvaluationAt {
      failClosed("CLOCK_REGRESSION")
      return
    }
    if let deadline, ContinuousClock.now >= deadline {
      candidate.tick(now: max(now, candidate.binding.expiresAtEpochSeconds))
    } else { candidate.tick(now: now) }
    if candidate.core.snapshot.status.isTerminal {
      session = candidate
      authentication = nil
      guidancePushPilot.reset()
      releaseInputs()
      revoke()
    } else if candidate.core.snapshot.quality != session?.core.snapshot.quality
      || candidate.core.snapshot.reason != session?.core.snapshot.reason
      || candidate.bus?.snapshot.phase != session?.bus?.snapshot.phase
      || candidate.bus?.snapshot.quality != session?.bus?.snapshot.quality
      || candidate.bus?.snapshot.reason != session?.bus?.snapshot.reason || now - lastPersistedAt >= 10 {
      _ = commit(candidate)
    } else { session = candidate }
  }

  @discardableResult private func commit(_ candidate: Session) -> Bool {
    var stage = "checkpoint"
    do {
      guard let url = checkpointURL, store != nil else { throw CocoaError(.fileWriteUnknown) }
      stage = "directory"
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      // The event, its acknowledged flag, binding, route and engine state share one atomic commit.
      stage = "save"
      try store?.save(candidate.envelope)
      session = candidate
      lastPersistedAt = Date().timeIntervalSince1970
      return true
    } catch {
      let cause = error as NSError
      NSLog("NOLATE_GUIDANCE_RUNTIME checkpoint_failed stage=%@ domain=%@ code=%ld", stage, cause.domain, cause.code)
      if session == nil { session = candidate }
      failClosed("AUTOMATIC_CHECKPOINT_WRITE_FAILED")
      return false
    }
  }

  private func failClosed(_ reason: String) {
    NSLog("NOLATE_GUIDANCE_RUNTIME fail_closed %@", reason)
    lastError = reason
    arrivalHandoffUntil = nil
    guidancePushPilot.reset()
    authentication = nil
    session?.stop(now: Date().timeIntervalSince1970)
    releaseInputs()
    revoke()
    publish()
  }

  private func revoke() {
    do {
      guard store != nil else { throw CocoaError(.fileWriteUnknown) }
      try store?.revoke()
      revocationFailed = false
    } catch {
      // Filesystem-wide refusal prevents a durable across-process promise; expose this honestly.
      lastError = "AUTOMATIC_REVOCATION_FAILED"
      revocationFailed = true
    }
  }

  private func beginInputs() {
    guard running, let binding = session?.binding else { return }
    let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
    // Do not synchronously query the location daemon on the main actor. Its reply
    // can stall the entire UI; authorization is reported by the manager delegate.
    guard modes.contains("location"),
          let usage = Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") as? String,
          !usage.isEmpty else { failClosed("LOCATION_CAPABILITY_UNAVAILABLE"); return }
    deadline = ContinuousClock.now.advanced(by: .seconds(max(0, min(7200, binding.expiresAtEpochSeconds - Date().timeIntervalSince1970))))
    clockTask = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
        guard let self, self.session?.binding == binding else { return }
        self.advanceClock(); self.publish()
        if !self.running { return }
      }
    }
    let token = UUID()
    self.token = token
    let delegate = Delegate(token: token) { [weak self] token, event in
      Task { @MainActor [weak self] in
        guard let self, self.token == token else { return }
        switch event {
        case .authorization(let status):
          self.locationAuthorization = status
          self.startAuthorizedLocation(status)
        case .samples(let samples):
          for sample in samples { self.ingest(sample) }
        case .failed(let denied):
          if denied { self.failClosed("LOCATION_PERMISSION_DENIED") }
          else { self.lastError = "LOCATION_TEMPORARILY_UNAVAILABLE"; self.publish() }
        }
      }
    }
    let manager = CLLocationManager()
    locationState = "CHECKING_PERMISSION"; locationAuthorization = nil
    self.delegate = delegate; self.manager = manager; manager.delegate = delegate
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = kCLDistanceFilterNone
    manager.activityType = .fitness
    manager.pausesLocationUpdatesAutomatically = false
    // The initial authorization callback also covers already-authorized users.
    // No synchronous global services query or speculative location start here.
  }

  private func startAuthorizedLocation(_ status: CLAuthorizationStatus) {
    guard running, let manager else { return }
    switch status {
    case .authorizedAlways, .authorizedWhenInUse:
      manager.allowsBackgroundLocationUpdates = true
      manager.showsBackgroundLocationIndicator = true
      manager.startUpdatingLocation()
      locationState = "RUNNING"
    case .notDetermined:
      if locationState != "REQUESTING_PERMISSION" {
        locationState = "REQUESTING_PERMISSION"
        manager.requestWhenInUseAuthorization()
      }
    case .denied, .restricted: failClosed("LOCATION_PERMISSION_DENIED")
    @unknown default: failClosed("LOCATION_AUTHORIZATION_UNKNOWN")
    }
    publish()
  }

  private func ingest(_ sample: Sample) {
    advanceClock()
    guard running, var candidate = session else { return }
    lastAccuracyMeters = sample.accuracy.isFinite && sample.accuracy >= 0 ? sample.accuracy : nil
    let now = Date().timeIntervalSince1970
    let vehicles = guidanceVehicles.vehicles(session: candidate, now: now)
    let acceptedFreshObservation = candidate.ingest(coordinate: .init(latitude: sample.latitude, longitude: sample.longitude), accuracy: sample.accuracy,
      observedAt: sample.observedAt, now: now, vehicles: vehicles,
      subwayInput: guidanceSubway.input(session:candidate,now:now))
    // The evaluation clock can cross expiry after advanceClock() but before ingest(). Do not
    // leave CLLocationManager alive just because the core became terminal inside this sample.
    if candidate.core.snapshot.status.isTerminal {
      session = candidate
      if candidate.core.snapshot.reason == .destinationArrived, candidate.binding.authMemberId != nil {
        arrivalHandoffUntil = Date(timeIntervalSince1970: now + 90)
      }
      authentication = nil
      guidancePushPilot.reset()
      releaseInputs()
      revoke()
    } else if commit(candidate) {
      guidanceSample = acceptedFreshObservation ? sample : nil
      let offRoute = candidate.core.snapshot.reason == .offRoute
        || candidate.bus?.snapshot.reason == "BUS_OFF_ROUTE"
      let riding = NoLateJourneyOffRouteMapPolicy.transitStillCorrelated(
        busPhase: candidate.ride?.snapshot.phase, busConfirmedAt: candidate.ride?.snapshot.lastConfirmedAt,
        subwayPhase: candidate.subway?.snapshot.phase, subwayConfirmedAt: candidate.subway?.snapshot.lastConfirmedAt,
        now: now)
      let fix = NoLateJourneyOffRouteMapPolicy.Fix(latitude: sample.latitude, longitude: sample.longitude,
        accuracyMeters: sample.accuracy, observedAt: sample.observedAt)
      if candidate.core.snapshot.status == .active && offRoute && !riding,
        NoLateJourneyOffRouteMapPolicy.usable(fix, now: now, armedAt: candidate.core.snapshot.armedAt,
          expiresAt: candidate.binding.expiresAtEpochSeconds) {
        offRouteMapSample = NoLateJourneyOffRouteMapPolicy.continuous(fix, after: offRouteCandidate, now: now,
          armedAt: candidate.core.snapshot.armedAt, expiresAt: candidate.binding.expiresAtEpochSeconds) ? fix : nil
        offRouteCandidate = fix
      } else {
        offRouteCandidate = nil
        offRouteMapSample = nil
      }
      lastError = NoLateJourneyAutomaticLocationErrorPolicy.afterCommittedObservation(
        lastError, acceptedFreshObservation: acceptedFreshObservation)
    }
    publish()
  }

  private func releaseInputs() {
    locationAuthorization = nil
    guidanceNotices.clear()
    guidanceArrivals.clear()
    guidanceVehicles.clear()
    guidanceSubway.clear()
    rerouteCommitBinding = nil; rerouteCommitDeadline = nil
    token = nil; deadline = nil
    lastAccuracyMeters = nil
    guidanceSample = nil
    offRouteCandidate = nil
    offRouteMapSample = nil
    clockTask?.cancel(); clockTask = nil
    manager?.delegate = nil
    manager?.stopUpdatingLocation()
    manager?.allowsBackgroundLocationUpdates = false
    manager?.showsBackgroundLocationIndicator = false
    manager = nil; delegate = nil
    locationState = "STOPPED"
  }

  private func publish() {
    let now = Date().timeIntervalSince1970
    if let rerouteCommitBinding, session?.binding == rerouteCommitBinding {
      if rerouteCommitDeadline.map({ ContinuousClock.now >= $0 }) != false {
        failClosed("REROUTE_CONFIRMATION_TIMEOUT"); return
      }
    } else {
      guidanceArrivals.validateLifetime(session: session, now: now) { [weak self] reason in self?.failClosed(reason) }
      guidanceArrivals.update(session: session, now: now)
      guidanceVehicles.update(session: session, now: now)
      guidanceSubway.update(session: session, now: now)
    }
    if session?.ride != nil {
      let ride = session?.ride?.snapshot
      let diagnostic = "phase=\(ride?.phase ?? "UNAVAILABLE") reason=\(ride?.reason ?? "UNAVAILABLE") transport=\(guidanceVehicles.status)"
      if diagnostic != lastRideDiagnostic {
        NSLog("NOLATE_GUIDANCE_RIDE %@", diagnostic)
        lastRideDiagnostic = diagnostic
      }
    } else {
      lastRideDiagnostic = nil
    }
    #if targetEnvironment(simulator)
    if let session, session.separation != nil {
      let separation = session.separation!.snapshot
      let walk = session.finalWalk?.snapshot
      let diagnostic = "separation=\(separation.status) reason=\(separation.reason) count=\(separation.evidenceCount) walk=\(walk?.phase ?? "UNAVAILABLE") walkReason=\(walk?.reason ?? "UNAVAILABLE") window=\(session.ride?.route.departureWindowMeters ?? 0) transport=\(guidanceVehicles.status)"
      if diagnostic != lastHandoffDiagnostic {
        NSLog("NOLATE_GUIDANCE_HANDOFF %@", diagnostic)
        lastHandoffDiagnostic = diagnostic
      }
    } else { lastHandoffDiagnostic = nil }
    #endif
    let enabled = session?.binding.savedRouteValidated == true && session?.binding.guidanceEnabled == true
    let arrival = session.map { arrivalResult(session: $0, now: now) }
    let content = session.map { NoLateAutomaticGuidanceProjection.content($0, now: now, arrival: arrival) }
    guidanceNotices.accept(content, legs: session?.routeLegs ?? [], subwayTrainNumber: arrival?.subwayTrainNumber,
      // The server departure record can remain pending while the screen is locked.
      // Notices use the same fresh, validated native position as the Activity and
      // must not wait for foreground JS to acknowledge that record.
      enabled: enabled)
    let arrivalHandoffUntil = session.flatMap { value -> Date? in
      let state = value.core.snapshot
      guard state.status == .stopped, state.reason == .destinationArrived, value.binding.authMemberId != nil else { return nil }
      return self.arrivalHandoffUntil
    }
    guidanceActivity.accept(content, enabled: enabled,
      routeLegs: session?.routeLegs ?? [], arrivalHandoffUntil: arrivalHandoffUntil)
    if let session, session.departureAcknowledged, let content {
      guidancePushPilot.publish(content, binding: session.binding, auth: authentication)
    }
    eventSink?(viewState().compactMapValues { $0 })
  }
  private func arrivalResult(session: NoLateJourneyAutomaticSession, now: Double) -> NoLateSavedGuidanceArrivalPolicy.Result {
    let bus = guidanceArrivals.result(session: session, now: now)
    guard let subway = guidanceSubway.arrival(session: session, now: now), subway.arrival != nil else { return bus }
    let current = NoLateAutomaticGuidanceProjection.content(session, now: now)
    let target = current.phase == "WAITING" ? current.activeLegIndex : current.activeLegIndex + 1
    return subway.busLegIndex == target && session.routeLegs.indices.contains(target)
      && session.routeLegs[target].kind == "SUBWAY" ? subway : bus
  }
  private func viewState() -> [String: Any?] {
    let state = session?.core.snapshot
    let bus = session?.bus?.snapshot
    let ride = session?.ride?.snapshot
    let content = session.flatMap { value -> [String: Any]? in
      guard value.binding.savedRouteValidated == true, value.binding.guidanceEnabled == true else { return nil }
      let now = Date().timeIntervalSince1970
      let projected = NoLateAutomaticGuidanceProjection.content(value, now: now, arrival: arrivalResult(session: value, now: now))
      guard let data = try? JSONEncoder().encode(projected) else { return nil }
      return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    return ["enabled": enabled, "reason": expectedExecution == "DEVICE" ? "DEVICE_FIELD_TEST_ONLY" : "P1_AUTOMATIC_DEPARTURE_SIMULATOR_ONLY",
      "guidanceNoticeMode": guidanceNotices.mode, "guidanceNoticeState": guidanceNotices.state,
      "guidanceNoticeScheduledCount": guidanceNotices.scheduledCount,
      "guidanceNoticePermission": guidanceNotices.permission,
      "guidanceVoiceQueuedCount": guidanceNotices.voiceQueuedCount,
      "guidancePosition": session.flatMap { value in guidanceSample.flatMap { sample in
        NoLateAutomaticGuidanceProjection.position(value, coordinate: .init(latitude: sample.latitude, longitude: sample.longitude),
          accuracy: sample.accuracy, observedAt: sample.observedAt, now: Date().timeIntervalSince1970)
      } },
      "deviceMapLocation": offRouteMapLocation(),
      "guidance": content, "guidanceRoute": session.flatMap { NoLateAutomaticGuidanceProjection.displayRoute($0) },
      "guidanceActivityState": guidanceActivity.state, "guidanceActivityError": guidanceActivity.error,
      "guidancePushState": guidancePushPilot.state, "guidancePushTokenAvailable": guidancePushPilot.tokenAvailable,
      "guidancePushProviderAcceptedCount": guidancePushPilot.providerAcceptedCount,
      "status": state?.status.rawValue ?? "IDLE", "sessionId": session?.binding.sessionId,
      "guidanceMemberId": content == nil ? nil : session?.binding.authMemberId,
      "routeRevision": session?.binding.routeRevision, "alongRouteMeters": state?.alongRouteMeters,
      "crossTrackMeters": state?.crossTrackMeters, "departureCount": state?.departureEventKey == nil ? 0 : 1,
      "quality": state?.quality.rawValue ?? "UNAVAILABLE", "qualityReason": state?.reason.rawValue ?? "NOT_ARMED",
      "locationState": locationState, "authorization": authorization,
      "pendingDeparture": session?.pendingDeparture != nil, "departureAcknowledged": session?.departureAcknowledged ?? false,
      "syncScope": session?.binding.syncScope ?? "LOCAL_ONLY", "execution": session?.binding.execution ?? expectedExecution ?? "UNAVAILABLE",
      "remainingSeconds": session.map { Int(max(0, min(7200, $0.binding.expiresAtEpochSeconds - Date().timeIntervalSince1970))) } ?? 0,
      "lastErrorCode": lastError, "checkpointAvailable": store?.canRestore ?? false, "restored": restored,
      "sequence": state?.sequence ?? 0, "evidenceCount": state?.evidenceCount ?? 0,
      "routeContext": session?.routeContext,
      "busPhase": bus?.phase.rawValue ?? "UNAVAILABLE", "busQuality": bus?.quality.rawValue ?? "UNAVAILABLE",
      "busReason": bus?.reason ?? session?.busUnavailableReason ?? "BUS_NOT_PREPARED",
      "distanceToBoardMeters": bus?.distanceToBoardMeters, "busAlongRouteMeters": bus?.alongRouteMeters,
      "boardingEvidenceCount": bus?.boardingEvidenceCount ?? 0,
      "boardingConfirmed": ride?.boardingConfirmed ?? false,
      "ridePhase": ride?.phase ?? "UNAVAILABLE", "rideQuality": ride?.quality ?? "UNAVAILABLE",
      "rideReason": ride?.reason ?? "VERIFIED_RIDE_BINDING_UNAVAILABLE",
      "rideEvidenceCount": ride?.evidenceCount ?? 0,
      "separationStatus": session?.separation?.snapshot.status ?? session?.subwaySeparation?.snapshot.status ?? "UNAVAILABLE",
      "separationReason": session?.separation?.snapshot.reason ?? session?.subwaySeparation?.snapshot.reason ?? "DEPARTURE_WINDOW_UNAVAILABLE",
      "separationEvidenceCount": session?.separation?.snapshot.evidenceCount ?? session?.subwaySeparation?.snapshot.evidenceCount ?? 0,
      "finalWalkPhase": session?.finalWalk?.snapshot.phase ?? "UNAVAILABLE",
      "finalWalkReason": session?.finalWalk?.snapshot.reason ?? "FINAL_WALK_GEOMETRY_UNAVAILABLE",
      "finalWalkEvidenceCount": session?.finalWalk?.snapshot.evidenceCount ?? 0,
      "destinationEvidenceCount": session?.finalWalk?.arrivalEvidenceCount ?? 0,
      "transferWalkPhase": session?.transferWalk?.snapshot.phase ?? "UNAVAILABLE",
      "transferWalkReason": session?.transferWalk?.snapshot.reason ?? "TRANSFER_WALK_GEOMETRY_UNAVAILABLE",
      "transferWalkEvidenceCount": session?.transferWalk?.snapshot.evidenceCount ?? 0,
      "nextBoardingPointReady": session?.transferWalk?.readyForNextTransit ?? false,
      "rideTransportState": guidanceVehicles.status,
      "subwayTransportState": guidanceSubway.status,
      "subwayPhase": session?.subway?.snapshot.phase,
      "subwayReason": session?.subway?.snapshot.reason,
      "busLastAccuracyMeters": lastAccuracyMeters
    ]
  }
  private func offRouteMapLocation() -> [String: Any]? {
    let now = Date().timeIntervalSince1970
    guard let value = session, let fix = offRouteMapSample,
      value.binding.savedRouteValidated == true, value.binding.guidanceEnabled == true,
      value.core.snapshot.status == .active,
      value.core.snapshot.reason == .offRoute || value.bus?.snapshot.reason == "BUS_OFF_ROUTE",
      !NoLateJourneyOffRouteMapPolicy.transitStillCorrelated(
        busPhase: value.ride?.snapshot.phase, busConfirmedAt: value.ride?.snapshot.lastConfirmedAt,
        subwayPhase: value.subway?.snapshot.phase, subwayConfirmedAt: value.subway?.snapshot.lastConfirmedAt,
        now: now) else { return nil }
    guard NoLateJourneyOffRouteMapPolicy.usable(fix, now: now, armedAt: value.core.snapshot.armedAt,
      expiresAt: value.binding.expiresAtEpochSeconds) else { return nil }
    return ["schemaVersion": 1, "sessionId": value.binding.sessionId, "generation": value.binding.generation,
      "routeRevision": value.binding.routeRevision, "routeInputDigest": value.binding.routeInputDigest,
      "latitude": fix.latitude, "longitude": fix.longitude, "accuracyMeters": fix.accuracyMeters,
      "observedAt": fix.observedAt, "validUntil": min(fix.observedAt + 15, value.binding.expiresAtEpochSeconds)]
  }
  private func refreshRideAdmission() {
    guard var candidate = session, !candidate.core.snapshot.status.isTerminal else { return }
    // The immutable validated walking route is already held in memory. Vehicle admission
    // is no longer an input after a committed handoff; never reconnect a ride behind it.
    let now = Date().timeIntervalSince1970
    guard candidate.requestedBusLegIndex(now:now) != nil else { return }
    if let admission = guidanceVehicles.admission(session: candidate, now:now) {
      do { try candidate.connectRide(admission.route,now:now) }
      catch { candidate.expireRideAdmission(); lastError = "RIDE_BINDING_REJECTED" }
    } else { candidate.expireRideAdmission() }
    session = candidate
  }
  private var authorization: String {
    guard manager != nil else { return "NOT_COLLECTING" }
    guard let locationAuthorization else { return "CHECKING_PERMISSION" }
    switch locationAuthorization {
    case .authorizedAlways: return "ALWAYS"
    case .authorizedWhenInUse: return "WHEN_IN_USE"
    case .notDetermined: return "NOT_DETERMINED"
    case .denied: return "DENIED"
    case .restricted: return "RESTRICTED"
    @unknown default: return "UNKNOWN"
    }
  }
}

/// No permission request, alarm mutation, persistent event history or background audio loop.
/// Local notification acceptance is not proof of a visible banner.
@MainActor
private final class NoLateJourneyNoticeDelivery {
  private let speech = NoLateJourneySpeechDelivery()
  private(set) var mode: String
  private(set) var state: String
  private(set) var scheduledCount = 0
  private(set) var voiceQueuedCount = 0
  private(set) var permission = "NOT_CHECKED"
  private var policy = NoLateGuidanceNoticePolicy()
  private var epoch = UUID()
  private var binding: String?
  private var identifiers = Set<String>()
  private var pendingArrival: (hint: NoLateGuidanceArrival, train: String?)?
  private var lastUsable = false
  private var phase: String?
  private var lastDiagnostic: String?
  private var expiryTask: Task<Void, Never>?
  init() {
    mode = NoLateGuidanceNoticePreference.load()
    state = mode == "OFF" ? "OFF" : "READY"
  }
  func configure(_ value: String, preservingJourney: Bool) {
    if preservingJourney {
      if mode != value {
        // Cancel in-flight delivery. Keep the event history so switching channels
        // cannot announce the same train or stop twice.
        epoch = UUID()
        clearDelivered()
        speech.cancel()
      }
    } else {
      clear()
      scheduledCount = 0
      voiceQueuedCount = 0
    }
    mode = value
    state = value == "OFF" ? "OFF" : "READY"
    NoLateGuidanceNoticePreference.save(value)
    permission = "NOT_CHECKED"
    let fence = epoch
    UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
      let summary = Self.permissionSummary(settings)
      Task { @MainActor [weak self] in
        guard let self, self.epoch == fence else { return }
        self.permission = summary
      }
    }
  }
  nonisolated private static func permissionSummary(_ settings: UNNotificationSettings) -> String {
    let authorization: String
    switch settings.authorizationStatus {
    case .authorized: authorization = "AUTHORIZED"
    case .provisional: authorization = "PROVISIONAL"
    case .ephemeral: authorization = "EPHEMERAL"
    case .denied: authorization = "DENIED"
    case .notDetermined: authorization = "NOT_DETERMINED"
    @unknown default: authorization = "UNKNOWN"
    }
    func setting(_ value: UNNotificationSetting) -> String {
      switch value { case .enabled: return "ON"; case .disabled: return "OFF"; case .notSupported: return "UNSUPPORTED"; @unknown default: return "UNKNOWN" }
    }
    return authorization + "_LOCK_" + setting(settings.lockScreenSetting) + "_ALERT_" + setting(settings.alertSetting)
  }
  func clear() {
    epoch = UUID(); binding = nil; phase = nil; lastUsable = false; policy.reset()
    lastDiagnostic = nil
    clearDelivered()
    speech.cancel()
    state = mode == "OFF" ? "OFF" : "IDLE"
  }
  private func clearDelivered() {
    pendingArrival = nil
    expiryTask?.cancel(); expiryTask = nil
    let ids = Array(identifiers); identifiers.removeAll()
    // UserNotifications performs synchronous XPC work even for an empty list.
    // In particular, the initial arm has nothing to revoke and must not block
    // the main actor while the notification service is unavailable.
    guard !ids.isEmpty else { return }
    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids)
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
  }
  func accept(_ content: NoLateGuidanceContent?, legs: [NoLateGuidanceRouteLeg], subwayTrainNumber: String?, enabled: Bool) {
    let diagnostic = "mode=\(mode) enabled=\(enabled) status=\(content?.status ?? "NIL") phase=\(content?.phase ?? "NIL") quality=\(content?.quality ?? "NIL")"
    if diagnostic != lastDiagnostic {
      NSLog("NOLATE_GUIDANCE_NOTICE input %@", diagnostic)
      lastDiagnostic = diagnostic
    }
    guard enabled, let content, content.status == "ACTIVE" else {
      if binding != nil { clear() }; return
    }
    let identity = "\(content.sessionId):\(content.generation):\(content.routeRevision):\(content.routeInputDigest)"
    if binding != identity { clear(); binding = identity }
    guard mode != "OFF" else { return }
    let now = Date().timeIntervalSince1970
    let arrival = NoLateGuidancePresentationPolicy.freshArrival(content, legs: legs, now: now)
    // An approach can become a platform wait while iOS is still speaking about the same arrival.
    let sameArrival = pendingArrival.map { pending in
      guard let arrival, arrival.expectedAt - now <= 120 else { return false }
      let old = pending.hint
      let sameTrip = pending.train == nil ? arrival.expectedAt == old.expectedAt : pending.train == subwayTrainNumber
      return sameTrip && arrival.providerRouteId == old.providerRouteId && arrival.directionLabel == old.directionLabel
        && arrival.busLegIndex == old.busLegIndex && arrival.kind == old.kind && old.validUntil > now
    } ?? false
    if !sameArrival && (phase != content.phase || pendingArrival != nil) {
      epoch = UUID(); clearDelivered(); speech.cancel()
    }
    phase = content.phase
    let usable = NoLateGuidanceRoutePositionPolicy.position(content, legs: legs, now: now) != nil
    if usable && !lastUsable { NSLog("NOLATE_GUIDANCE_NOTICE evidence_available") }
    if !usable {
      if lastUsable {
        NSLog("NOLATE_GUIDANCE_NOTICE evidence_unavailable")
        epoch = UUID(); clearDelivered(); speech.cancel()
      }
      lastUsable = false; state = "EVIDENCE_UNAVAILABLE"; return
    }
    lastUsable = true
    guard let notice = policy.next(content, legs: legs, now: now, subwayTrainNumber: subwayTrainNumber) else { return }
    NSLog("NOLATE_GUIDANCE_NOTICE selected kind=%@", notice.kind)
    epoch = UUID(); clearDelivered(); speech.cancel()
    let fence = epoch
    if notice.kind == "ARRIVAL_SOON", let arrival { pendingArrival = (arrival, subwayTrainNumber) }
    let remaining = max(0, notice.expiresAt - now)
    expiryTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(min(10, remaining) * 1_000_000_000))
      guard !Task.isCancelled, let self, self.epoch == fence, self.binding == identity else { return }
      self.epoch = UUID(); self.clearDelivered()
      self.speech.cancel()
      self.state = "NOTICE_EXPIRED"
      NSLog("NOLATE_GUIDANCE_NOTICE expired")
    }
    let identifier = "nolate.guidance.notice." + SHA256.hash(data: Data((identity + notice.kind + fence.uuidString).utf8)).map { String(format: "%02x", $0) }.joined()
    UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
      let authorized = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
      let undetermined = settings.authorizationStatus == .notDetermined
      let permission = Self.permissionSummary(settings)
      Task { @MainActor [weak self] in
        guard let self, self.epoch == fence, self.binding == identity,
          self.mode != "OFF", Date().timeIntervalSince1970 < notice.expiresAt else { return }
        self.permission = permission
        var voiceQueued = false
        if self.mode == "VOICE_AND_NOTIFICATIONS", UIApplication.shared.applicationState == .active {
          self.speech.cancel()
          voiceQueued = self.speech.queue(notice.body, kind: notice.kind)
          if voiceQueued { self.voiceQueuedCount += 1 }
        }
        guard authorized else {
          self.state = voiceQueued ? (undetermined ? "VOICE_QUEUED_PERMISSION_REQUIRED" : "VOICE_QUEUED_NOTIFICATION_DENIED") : "NOTIFICATION_PERMISSION_REQUIRED"
          NSLog("NOLATE_GUIDANCE_NOTICE permission_required")
          return
        }
        let body = UNMutableNotificationContent()
        body.title = "NoLate 길안내"; body.body = notice.body
        body.sound = voiceQueued ? nil : .default
        body.threadIdentifier = "nolate.guidance"
        body.userInfo = ["scheduleId": content.scheduleId, "guidanceSession": content.sessionId]
        self.identifiers.insert(identifier)
        self.state = "NOTIFICATION_SUBMITTING"
        UNUserNotificationCenter.current().add(.init(identifier: identifier, content: body, trigger: nil)) { [weak self] error in
          let accepted = error == nil
          Task { @MainActor [weak self] in
            guard let self else { return }
            guard self.epoch == fence, self.binding == identity, Date().timeIntervalSince1970 < notice.expiresAt else {
              UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
              UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier]); return
            }
            if accepted { self.scheduledCount += 1; self.state = "NOTIFICATION_ACCEPTED" }
            else { self.state = "NOTIFICATION_REJECTED" }
            NSLog("NOLATE_GUIDANCE_NOTICE submit_%@ kind=%@", accepted ? "accepted" : "rejected", notice.kind)
          }
        }
      }
    }
  }
}

@MainActor
private final class NoLateJourneySpeechDelivery: NSObject, AVSpeechSynthesizerDelegate {
  #if !DEBUG
  private let synthesizer = AVSpeechSynthesizer()
  #endif

  #if !DEBUG
  private var spoken: (id: ObjectIdentifier, kind: String)?
  override init() {
    super.init()
    synthesizer.usesApplicationAudioSession = true
    synthesizer.delegate = self
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
    guard utterance.voice?.language.hasPrefix("ko") == true else { return }
    record("started", ObjectIdentifier(utterance))
  }
  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    record("finished", ObjectIdentifier(utterance))
  }
  nonisolated private func record(_ event: String, _ id: ObjectIdentifier) {
    Task { @MainActor in
      guard let spoken, spoken.id == id else { return }
      NSLog("NOLATE_GUIDANCE_NOTICE speech_%@ kind=%@", event, spoken.kind)
      if event == "finished" { self.spoken = nil }
    }
  }
  #endif

  func queue(_ text: String, kind: String) -> Bool {
    #if DEBUG
    return NoLateJourneyDiagnostics.shared.queueGuidanceInstruction(text)
    #else
    guard UIApplication.shared.applicationState == .active,
      !text.isEmpty, text.utf8.count <= 512,
      !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
      !synthesizer.isSpeaking, let voice = AVSpeechSynthesisVoice(language: "ko-KR") else { return false }
    do {
      // Ambient audio obeys the hardware silent switch; navigation never overrides it.
      try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
    } catch { return false }
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = voice
    spoken = (ObjectIdentifier(utterance), kind)
    synthesizer.speak(utterance)
    return true
    #endif
  }

  func cancel() {
    #if DEBUG
    NoLateJourneyDiagnostics.shared.cancelGuidanceSpeech()
    #else
    if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    #endif
  }
}
