import ActivityKit
import Foundation
import UIKit

/// Local mode or explicit single-remote-publisher pilot; never touches departure Activities.
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
    let candidate = enabled && !pushPilot.requested && activity != nil && last?.locationObservationDeadline != nil ? last : nil
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
      guard !self.busy, self.enabled, !self.pushPilot.requested,
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
      if let activity, activity.attributes.sessionId == value.sessionId, !pushPilot.requested {
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
    let prepared = !pushPilot.requested && NoLateGuidancePresentationPolicy.isPrepared(value, legs: routeLegs, now: Date().timeIntervalSince1970)
    guard value.status == "ACTIVE" || prepared else { return }
    let content = ActivityContent(state: value, staleDate: Date(timeIntervalSince1970: min(value.validUntil, value.arrival?.validUntil ?? value.validUntil)), relevanceScore: 90)
    if activity == nil {
      guard NoLateGuidanceActivityStartPolicy.allows(value, legs: routeLegs, now: Date().timeIntervalSince1970,
        foreground: UIApplication.shared.applicationState == .active, remotePilot: pushPilot.requested) else {
        state = "FOREGROUND_OR_FRESH_LOCATION_REQUIRED"; return
      }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { state = "DISABLED"; return }
      do {
        // Remove only abandoned guidance surfaces. Never end departure Activities.
        for old in Activity<NoLateGuidanceAttributes>.activities { await old.end(nil, dismissalPolicy: .immediate) }
        guard enabled, revision == appliedRevision,
          NoLateGuidanceActivityStartPolicy.allows(value, legs: routeLegs, now: Date().timeIntervalSince1970,
            foreground: UIApplication.shared.applicationState == .active, remotePilot: pushPilot.requested) else { return }
        activity = try Activity.request(attributes: .init(sessionId: value.sessionId, routeLegs: routeLegs), content: content, pushType: pushPilot.requested ? .token : nil)
        if pushPilot.requested, let activity {
          tokenTask = Task { @MainActor [weak self] in
            for await token in activity.pushTokenUpdates {
              guard let self, !Task.isCancelled, self.activity?.id == activity.id else { return }
              self.pushPilot.token(token, activityId: activity.id)
            }
          }
        }
        last = value; state = prepared ? "ARMED" : "ACTIVE"; error = nil
      } catch { state = "FAILED"; self.error = "LOCAL_ACTIVITY_START_FAILED" }
    } else if let activity, last?.phase != value.phase || last?.quality != value.quality || last?.walkProgress != value.walkProgress || last?.rideProgress != value.rideProgress || last?.boardingConfirmed != value.boardingConfirmed || last?.alighting != value.alighting || last?.validUntil != value.validUntil || last?.arrival != value.arrival || last?.arrivalStatus != value.arrivalStatus || last?.subway != value.subway || last?.lastConfirmedSubway != value.lastConfirmedSubway || last?.lastConfirmedBus != value.lastConfirmedBus {
      // Remote pilot does NOT locally update: seeing a changed surface must prove remote delivery.
      if !pushPilot.requested { await activity.update(content) }
      last = value; state = prepared ? "ARMED" : "ACTIVE"
    }
  }
}
