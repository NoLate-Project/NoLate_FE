import ActivityKit
import Foundation
import UIKit

/// Local product publication may also receive APNs. Only the explicit QA pilot is remote-only.
@MainActor final class NoLateAutomaticGuidanceActivity {
  private let pushPilot: NoLateGuidancePushPilot
  private var tokenTask: Task<Void, Never>?
  private var locationExpiryTask: Task<Void, Never>?
  private var locationExpiryContent: NoLateGuidanceContent?
  init(pushPilot: NoLateGuidancePushPilot) { self.pushPilot = pushPilot }
  private var activity: Activity<NoLateGuidanceAttributes>?
  private var pending: NoLateGuidanceContent?
  private var pendingLegs: [NoLateGuidanceRouteLeg] = []
  private var pendingArrivalHandoffUntil: Date?
  private var endedActivity: Activity<NoLateGuidanceAttributes>?
  private var last: NoLateGuidanceContent?
  private var busy = false
  private var enabled = false
  private var revision = 0
  private(set) var state = "NOT_STARTED"
  private(set) var error: String?

  func accept(_ content: NoLateGuidanceContent?, enabled: Bool, routeLegs: [NoLateGuidanceRouteLeg],
    arrivalHandoffUntil: Date?) {
    self.enabled = enabled
    revision += 1
    pending = content
    pendingLegs = routeLegs
    pendingArrivalHandoffUntil = arrivalHandoffUntil
    guard !busy else { return }
    busy = true
    Task { @MainActor in
      defer {
        busy = false
        reconcileLocalLocationExpiry()
      }
      var appliedRevision: Int
      repeat {
        appliedRevision = revision
        let value = pending; pending = nil
        await apply(value, routeLegs: pendingLegs, arrivalHandoffUntil: pendingArrivalHandoffUntil,
          revision: appliedRevision)
      } while appliedRevision != revision
    }
  }

  private func reconcileLocalLocationExpiry() {
    let candidate = enabled && !pushPilot.remoteOnly && activity != nil && last?.locationObservationDeadline != nil ? last : nil
    guard candidate != locationExpiryContent else { return }
    locationExpiryTask?.cancel()
    locationExpiryTask = nil
    locationExpiryContent = candidate
    guard let candidate, let deadline = candidate.locationObservationDeadline else { return }
    // iOS controls when its stale state is rendered. While the local publisher can run,
    // explicitly clear the old observation even if no new location callback arrives.
    locationExpiryTask = Task { @MainActor [weak self] in
      do { try await Task.sleep(for: .seconds(max(0, deadline - Date().timeIntervalSince1970))) }
      catch { return }
      guard let self, !Task.isCancelled, self.locationExpiryContent == candidate else { return }
      self.locationExpiryTask = nil
      self.locationExpiryContent = nil
      // A pending publication takes precedence and will reconcile its own deadline.
      guard !self.busy, self.enabled, !self.pushPilot.remoteOnly,
        self.last == candidate, let activity = self.activity else { return }
      if let expired = candidate.expiringLocation(at: Date().timeIntervalSince1970) {
        self.accept(expired, enabled: true, routeLegs: activity.attributes.routeLegs, arrivalHandoffUntil: nil)
      } else {
        self.reconcileLocalLocationExpiry()
      }
    }
  }
  private func apply(_ value: NoLateGuidanceContent?, routeLegs: [NoLateGuidanceRouteLeg],
    arrivalHandoffUntil: Date?, revision appliedRevision: Int) async {
    if enabled, let value, value.status == "STOPPED", let until = arrivalHandoffUntil, until > Date() {
      if endedActivity?.attributes.sessionId == value.sessionId { return }
      if let activity, activity.attributes.sessionId == value.sessionId, !pushPilot.remoteOnly {
        tokenTask?.cancel(); tokenTask = nil
        endedActivity = activity
        self.activity = nil; last = nil; state = "ENDED"
        let finished = ActivityContent(state: value, staleDate: nil, relevanceScore: 0)
        await activity.end(finished, dismissalPolicy: .after(until))
        return
      }
    }
    guard enabled, let value, ["ARMED", "ACTIVE"].contains(value.status) else {
      // Cold launch / explicit stop must also clear a guidance surface left by a crashed
      // journey process. This Activity type never replaces a departure Activity.
      for old in Activity<NoLateGuidanceAttributes>.activities { await old.end(nil, dismissalPolicy: .immediate) }
      if let endedActivity { await endedActivity.end(nil, dismissalPolicy: .immediate); self.endedActivity = nil }
      tokenTask?.cancel(); tokenTask = nil
      activity = nil; last = nil; state = "ENDED"; return
    }
    if let endedActivity {
      await endedActivity.end(nil, dismissalPolicy: .immediate)
      self.endedActivity = nil
    }
    if let activity, activity.attributes.sessionId != value.sessionId || activity.attributes.routeLegs != routeLegs {
      tokenTask?.cancel(); tokenTask = nil
      await activity.end(nil, dismissalPolicy: .immediate); self.activity = nil; last = nil
    }
    // A local foreground preparation card lets GPS departure update after locking.
    // The APNs pilot still starts ACTIVE only, so local preparation cannot masquerade as delivery.
    let prepared = !pushPilot.remoteOnly && NoLateGuidancePresentationPolicy.isPrepared(value, legs: routeLegs, now: Date().timeIntervalSince1970)
    guard value.status == "ACTIVE" || prepared else { return }
    // The historical label has its own lifetime; its stale date must not renew a passenger observation.
    let historyDeadline = value.phase == "UNAVAILABLE" ? value.lastConfirmedSubway.map { $0.confirmedAt + 90 } : nil
    let displayDeadline = historyDeadline ?? min(value.validUntil, value.arrival?.validUntil ?? value.validUntil)
    let content = ActivityContent(state: value, staleDate: Date(timeIntervalSince1970: displayDeadline), relevanceScore: 90)
    if activity == nil {
      guard NoLateGuidanceActivityStartPolicy.allows(value, legs: routeLegs, now: Date().timeIntervalSince1970,
        foreground: UIApplication.shared.applicationState == .active, remotePilot: pushPilot.remoteOnly) else {
        state = "FOREGROUND_OR_FRESH_LOCATION_REQUIRED"; return
      }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { state = "DISABLED"; return }
      do {
        // Remove only abandoned guidance surfaces. Never end departure Activities.
        for old in Activity<NoLateGuidanceAttributes>.activities { await old.end(nil, dismissalPolicy: .immediate) }
        guard enabled, revision == appliedRevision,
          NoLateGuidanceActivityStartPolicy.allows(value, legs: routeLegs, now: Date().timeIntervalSince1970,
            foreground: UIApplication.shared.applicationState == .active, remotePilot: pushPilot.remoteOnly) else { return }
        do {
          activity = try Activity.request(attributes: .init(sessionId: value.sessionId, routeLegs: routeLegs), content: content, pushType: pushPilot.requested ? .token : nil)
        } catch {
          guard pushPilot.requested, !pushPilot.remoteOnly else { throw error }
          pushPilot.reset()
          activity = try Activity.request(attributes: .init(sessionId: value.sessionId, routeLegs: routeLegs), content: content, pushType: nil)
        }
        if pushPilot.requested, let activity {
          tokenTask = Task { @MainActor [weak self] in
            for await token in activity.pushTokenUpdates {
              guard let self, !Task.isCancelled, self.activity?.id == activity.id else { return }
              self.pushPilot.token(token, activityId: activity.id, sessionId: activity.attributes.sessionId)
            }
          }
        }
        last = value; state = prepared ? "ARMED" : "ACTIVE"; error = nil
      } catch { state = "FAILED"; self.error = "LOCAL_ACTIVITY_START_FAILED" }
    } else if let activity, last?.phase != value.phase || last?.quality != value.quality || last?.walkProgress != value.walkProgress || last?.rideProgress != value.rideProgress || last?.boardingConfirmed != value.boardingConfirmed || last?.alighting != value.alighting || last?.validUntil != value.validUntil || last?.arrival != value.arrival || last?.arrivalStatus != value.arrivalStatus || last?.subway != value.subway || last?.lastConfirmedSubway != value.lastConfirmedSubway || last?.lastConfirmedBus != value.lastConfirmedBus {
      // Remote pilot does NOT locally update: seeing a changed surface must prove remote delivery.
      if !pushPilot.remoteOnly {
        if #available(iOS 17.2, *) {
          // A delayed remote UPDATE must not replace a newer local observation.
          await activity.update(content, timestamp: Date())
        } else {
          await activity.update(content)
        }
      }
      last = value; state = prepared ? "ARMED" : "ACTIVE"
    }
  }
}

import AVFAudio
import OSLog

/// Updates the same local activity from confirmed observations, including background samples from an active drive.
@available(iOS 16.2, *)
@MainActor final class NoLateDrivingPublication: NSObject, AVSpeechSynthesizerDelegate {
  static let shared = NoLateDrivingPublication()
  private var owner: String?
  private var moduleOwner: UUID?
  private var attributes: NoLateDrivingAttributes?
  private var activity: Activity<NoLateDrivingAttributes>?
  private var lastUpdate: Date?
  private var lastAttempt: Date?
  private var lastContent: NoLateDrivingContent?
  private var lastObservationExpiry: Double?
  private var lastCue: NoLateDrivingSpeechCue?
  private let displayExpiry = NoLateDrivingDisplayExpiry()
  private var pendingWrite: Task<Void, Never>?
  private let speaker = AVSpeechSynthesizer()
  private var inactiveObserver: NSObjectProtocol?

  private override init() {
    super.init()
    speaker.delegate = self
    speaker.usesApplicationAudioSession = true
    inactiveObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification,
      object: nil, queue: .main) { [weak self] _ in
        Task { @MainActor in self?.cancelSpeech() }
      }
  }

  func removeOrphans() async {
    let orphaned = Activity<NoLateDrivingAttributes>.activities.filter { $0.attributes.owner != owner }
    for item in orphaned { await item.end(nil, dismissalPolicy: .immediate) }
  }

  func open(owner token: String, scheduleId: String, destination: String, module: UUID) async {
    guard UUID(uuidString: token) != nil, destination.utf8.count <= 512,
      !destination.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else { return }
    if owner == token { return }
    let previous = activity
    reset()
    owner = token
    moduleOwner = module
    let id = scheduleId.utf8.count <= 16 && scheduleId.utf8.allSatisfy({ (48...57).contains($0) })
      && scheduleId.first != "0" ? scheduleId : ""
    attributes = .init(owner: token, scheduleId: id, destination: destination)
    if let previous { await previous.end(nil, dismissalPolicy: .immediate) }
  }

  func close(owner token: String) async {
    guard token == owner else { return }
    let previous = activity
    reset()
    if let previous { await previous.end(nil, dismissalPolicy: .immediate) }
  }

  func close(module: UUID) async {
    if module == moduleOwner, let owner { await close(owner: owner) }
  }

  /// Retire the previous route immediately, keeping the original ActivityKit instance through rerouting.
  func resetRoute(owner token: String) async {
    guard owner == token else { return }
    cancelSpeech()
    lastCue = nil
    lastObservationExpiry = nil
    displayExpiry.cancel()
    let neutral = NoLateDrivingContent(status: "ACQUIRING")
    lastContent = neutral
    lastUpdate = Date()
    if let activity { await updateActivity(activity, showing: neutral) }
  }

  func publish(owner token: String, json: String, voice: Bool) async {
    guard owner == token, let attributes else { return }
    let now = Date()
    if !voice { cancelSpeech() }
    guard let data = json.data(using: .utf8), data.count <= 3500,
      let submitted = try? JSONDecoder().decode(NoLateDrivingContent.self, from: data) else { return }
    let content = submitted.visible(now: now)
    let foreground = UIApplication.shared.applicationState == .active
    let verified = NoLateDrivingLocation.shared.hasObservation(expiry: submitted.validUntilMs, module: moduleOwner, now: now)
    if content.status == "ARRIVED" {
      await close(owner: token)
      return
    }
    guard foreground || verified else { cancelSpeech(); return }
    if let expiry = submitted.validUntilMs {
      if let lastObservationExpiry, expiry < lastObservationExpiry { return }
      lastObservationExpiry = expiry
    }
    if voice && foreground { speak(content, now: now) } else { cancelSpeech() }
    let packet = ActivityContent(state: content, staleDate: content.staleDate)
    if let activity {
      guard activity.activityState == .active || activity.activityState == .stale else { cancelSpeechIfUncertain(content); return }
      let important = lastContent?.status != content.status || lastContent?.next?.index != content.next?.index ||
        (lastContent?.staleDate.map { $0 <= now } ?? false)
      guard content != lastContent, important || now.timeIntervalSince(lastUpdate ?? .distantPast) >= 3 else { return }
      lastContent = content
      lastUpdate = now
      observeExpiry(of: content, activity: activity, owner: token)
      await updateActivity(activity, showing: content)
    } else if foreground, ActivityAuthorizationInfo().areActivitiesEnabled, now.timeIntervalSince(lastAttempt ?? .distantPast) >= 15 {
      lastAttempt = now
      if let requested = try? Activity.request(attributes: attributes, content: packet, pushType: nil) {
        activity = requested
        lastContent = content
        lastUpdate = now
        observeExpiry(of: content, activity: requested, owner: token)
      }
    }
  }

  private func observeExpiry(of content: NoLateDrivingContent, activity: Activity<NoLateDrivingAttributes>, owner token: String) {
    displayExpiry.observe(content) { [weak self] in
      guard let self, self.owner == token, self.activity?.id == activity.id,
        self.lastContent == content else { return }
      // Invalidating the exact displayed fix needs no new GPS observation. Retain the
      // observation watermark so a delayed previous fix cannot restore this maneuver.
      let neutral = NoLateDrivingContent(status: "UNCERTAIN")
      self.cancelSpeech()
      self.lastContent = neutral
      self.lastUpdate = Date()
      await self.updateActivity(activity, showing: neutral)
    }
  }

  /// Source updates and their expiry can overlap at the boundary. Send them in order
  /// so an already in-flight old ActivityKit write cannot replace the newer display.
  private func updateActivity(_ target: Activity<NoLateDrivingAttributes>, showing content: NoLateDrivingContent) async {
    let previous = pendingWrite
    let write = Task { @MainActor [weak self] in
      await previous?.value
      guard let self, self.activity?.id == target.id, self.lastContent == content else { return }
      await target.update(.init(state: content, staleDate: content.staleDate))
    }
    pendingWrite = write
    await write.value
  }

  private func speak(_ content: NoLateDrivingContent, now: Date) {
    cancelSpeechIfUncertain(content)
    guard let cue = NoLateDrivingSpeechCue(content, after: lastCue, now: now), let next = content.next else { return }
    // Replace outdated spoken instructions if the screen moved on to another maneuver.
    if let lastCue, cue.index != lastCue.index { cancelSpeech() }
    guard !speaker.isSpeaking, let voice = AVSpeechSynthesisVoice(language: "ko-KR") else { return }
    do { try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default) }
    catch { return }
    let utterance = AVSpeechUtterance(string: NoLateDrivingSpeechCue.instruction(for: next))
    utterance.voice = voice
    speaker.speak(utterance)
    lastCue = cue
  }

  // Field diagnostics report synthesizer callbacks without logging instructions or locations.
  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
    if utterance.voice?.language.hasPrefix("ko") == true {
      Logger(subsystem: "com.anonymous.nolatefe", category: "DrivingVoice").info("Korean driving speech started")
    }
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    Logger(subsystem: "com.anonymous.nolatefe", category: "DrivingVoice").info("Driving speech finished")
  }

  private func cancelSpeechIfUncertain(_ content: NoLateDrivingContent) {
    if content.next == nil || (lastCue != nil && content.next?.index != lastCue?.index) { cancelSpeech() }
  }

  private func cancelSpeech() {
    if speaker.isSpeaking { speaker.stopSpeaking(at: .immediate) }
  }

  private func reset() {
    cancelSpeech()
    displayExpiry.cancel()
    pendingWrite = nil
    owner = nil; moduleOwner = nil; attributes = nil; activity = nil
    lastUpdate = nil; lastAttempt = nil; lastContent = nil; lastCue = nil; lastObservationExpiry = nil
  }
}

import CoreLocation

/// A foreground-initiated, in-memory owner. Never restores GPS on process launch or asks for Always access.
@MainActor final class NoLateDrivingLocation {
  static let shared = NoLateDrivingLocation()
  private struct Sample: Sendable {
    let latitude: Double, longitude: Double, accuracy: Double, course: Double, milliseconds: Double
    func values(owner: String) -> [String: Any] {
      ["owner": owner, "latitude": latitude, "longitude": longitude, "accuracyMeters": accuracy,
       "courseDegrees": course, "observedAtMs": milliseconds]
    }
  }
  private enum Event: Sendable { case samples([Sample]), unavailable, denied }
  private final class Delegate: NSObject, CLLocationManagerDelegate {
    let receive: @Sendable (Event) -> Void
    init(_ receive: @escaping @Sendable (Event) -> Void) { self.receive = receive }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations fixes: [CLLocation]) {
      receive(.samples(fixes.suffix(12).map {
        .init(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude, accuracy: $0.horizontalAccuracy,
              course: $0.course, milliseconds: floor($0.timestamp.timeIntervalSince1970 * 1000))
      }))
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
      if manager.authorizationStatus == .restricted || manager.authorizationStatus == .denied { receive(.denied) }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
      receive((error as? CLError)?.code == .denied ? .denied : .unavailable)
    }
  }
  private var manager: CLLocationManager?
  private var delegate: Delegate?
  private var owner: String?
  private var moduleOwner: UUID?
  private var latest: Sample?
  private var deliveredTimes: [Double] = []
  private var sink: (([String: Any]) -> Void)?

  func start(owner token: String, module: UUID, sink: @escaping ([String: Any]) -> Void) -> String {
    if token == owner, module == moduleOwner { return "STARTED" }
    guard UIApplication.shared.applicationState == .active else { return "FOREGROUND_REQUIRED" }
    guard UUID(uuidString: token) != nil,
      (Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String])?.contains("location") == true else {
      return "UNAVAILABLE"
    }
    let manager = CLLocationManager()
    guard [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus) else { return "PERMISSION_REQUIRED" }
    clear()
    let delegate = Delegate { [weak self] event in
      Task { @MainActor in self?.receive(event, owner: token) }
    }
    self.owner = token; moduleOwner = module; self.sink = sink
    self.manager = manager; self.delegate = delegate
    manager.delegate = delegate
    manager.activityType = .automotiveNavigation
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.distanceFilter = kCLDistanceFilterNone
    manager.allowsBackgroundLocationUpdates = true
    manager.showsBackgroundLocationIndicator = true
    manager.pausesLocationUpdatesAutomatically = false
    manager.startUpdatingLocation()
    return "STARTED"
  }

  func latest(owner token: String) -> [String: Any]? {
    if token == owner, let latest, fresh(latest.milliseconds, now: Date()) { return latest.values(owner: token) }
    return nil
  }

  /// A JS clock tick or foreground-only fallback must never mint a fresh turn on the lock screen.
  func hasObservation(expiry: Double?, module: UUID?, now: Date) -> Bool {
    guard module != nil, module == moduleOwner, let expiry else { return false }
    let observed = expiry - 12_000
    return fresh(observed, now: now) && deliveredTimes.contains { abs($0 - observed) < 0.01 }
  }

  func stop(owner token: String) { if token == owner { clear() } }
  func stop(module: UUID) { if module == moduleOwner { clear() } }

  private func fresh(_ timestamp: Double, now: Date) -> Bool {
    let age = now.timeIntervalSince1970 * 1000 - timestamp
    return timestamp.isFinite && age >= 0 && age < 12_000
  }

  private func receive(_ event: Event, owner token: String) {
    guard owner == token else { return }
    switch event {
    case .samples(let fixes):
      var batch: [[String: Any]] = []
      let now = Date()
      for fix in fixes where fresh(fix.milliseconds, now: now) && fix.milliseconds > (latest?.milliseconds ?? 0) {
        latest = fix
        deliveredTimes.append(fix.milliseconds)
        batch.append(fix.values(owner: token))
      }
      deliveredTimes = Array(deliveredTimes.suffix(12))
      if !batch.isEmpty { sink?(["owner": token, "samples": batch]) }
    case .denied:
      sink?(["owner": token, "error": "PERMISSION_REQUIRED"])
      clear()
    case .unavailable:
      latest = nil; deliveredTimes.removeAll()
      sink?(["owner": token, "error": "LOCATION_UNAVAILABLE"])
    }
  }

  private func clear() {
    manager?.delegate = nil
    manager?.stopUpdatingLocation()
    manager?.allowsBackgroundLocationUpdates = false
    manager = nil; delegate = nil; owner = nil; moduleOwner = nil; sink = nil; latest = nil
    deliveredTimes.removeAll()
  }
}
