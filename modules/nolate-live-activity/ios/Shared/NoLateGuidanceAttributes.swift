import ActivityKit
import Foundation

@available(iOS 16.1, *)
public struct NoLateGuidanceAttributes: ActivityAttributes {
  public typealias ContentState = NoLateGuidanceContent
  public let sessionId: String
  public let routeLegs: [NoLateGuidanceRouteLeg]
  public init(sessionId: String, routeLegs: [NoLateGuidanceRouteLeg]) {
    self.sessionId = sessionId; self.routeLegs = routeLegs
  }
  private enum CodingKeys: String, CodingKey { case sessionId, routeLegs }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    sessionId = try values.decode(String.self, forKey: .sessionId)
    // Pre-route-bar diagnostic Activities remain readable and never invent a route.
    routeLegs = try values.decodeIfPresent([NoLateGuidanceRouteLeg].self, forKey: .routeLegs) ?? []
  }
}
