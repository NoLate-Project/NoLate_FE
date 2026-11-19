import Foundation

/// Keep the native HTTP allowlist in step with the authenticated JS journey transport.
enum NoLateAuthenticatedJourneyPathPolicy {
  private static let uuid = #"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"#
  private static let pattern = #"^/api/schedules/[1-9][0-9]{0,17}/automatic-journey/(prepare-saved|current|"#
    + uuid + #"/(departure|validate|stop|reconcile|live-activity|reroute-candidates(?:/"#
    + uuid + #"/(?:walking-proof|transit-proof|commit))?))$"#

  static func allows(_ path: String) -> Bool {
    path.range(of: pattern, options: .regularExpression) != nil
  }

  static func responseLimit(for path: String) -> Int {
    path.contains("/reroute-candidates") ? 1_100_000 : 65_536
  }
}
