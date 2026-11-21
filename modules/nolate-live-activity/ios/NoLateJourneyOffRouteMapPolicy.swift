import Foundation

/// Ephemeral CoreLocation display only. Never a route projection, boarding proof or Activity position.
struct NoLateJourneyOffRouteMapPolicy {
  struct Fix: Equatable, Sendable {
    let latitude: Double
    let longitude: Double
    let accuracyMeters: Double
    let observedAt: TimeInterval
  }

  static func transitStillCorrelated(busPhase: String?, busConfirmedAt: TimeInterval?,
    subwayPhase: String?, subwayConfirmedAt: TimeInterval?, now: TimeInterval) -> Bool {
    guard now.isFinite else { return false }
    if busPhase == "RIDING" || subwayPhase == "RIDING" { return true }
    return [busConfirmedAt, subwayConfirmedAt].compactMap { $0 }.contains { at in
      at.isFinite && at <= now && now - at < 90
    }
  }

  static func usable(_ fix: Fix, now: TimeInterval, armedAt: TimeInterval, expiresAt: TimeInterval) -> Bool {
    fix.latitude.isFinite && fix.longitude.isFinite && abs(fix.latitude) <= 90 && abs(fix.longitude) <= 180
      && fix.accuracyMeters.isFinite && (0...25).contains(fix.accuracyMeters)
      && fix.observedAt.isFinite && now.isFinite && armedAt.isFinite && expiresAt.isFinite
      && fix.observedAt >= armedAt && fix.observedAt < expiresAt
      && fix.observedAt <= now + 2 && now - fix.observedAt <= 15
  }

  static func continuous(_ current: Fix, after previous: Fix?, now: TimeInterval,
    armedAt: TimeInterval, expiresAt: TimeInterval) -> Bool {
    guard let previous, usable(previous, now: now, armedAt: armedAt, expiresAt: expiresAt),
      usable(current, now: now, armedAt: armedAt, expiresAt: expiresAt) else { return false }
    let elapsed = current.observedAt - previous.observedAt
    guard elapsed >= 0.5 && elapsed <= 15 else { return false }
    let lat = (current.latitude - previous.latitude) * .pi / 180
    let lng = (current.longitude - previous.longitude) * .pi / 180
    let a = pow(sin(lat / 2), 2) + cos(previous.latitude * .pi / 180)
      * cos(current.latitude * .pi / 180) * pow(sin(lng / 2), 2)
    let distance = 6_371_000 * 2 * asin(sqrt(min(1, max(0, a))))
    return distance <= 25 * elapsed + previous.accuracyMeters + current.accuracyMeters
  }
}
