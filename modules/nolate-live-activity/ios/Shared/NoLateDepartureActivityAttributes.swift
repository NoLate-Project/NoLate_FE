import ActivityKit
import Foundation

@available(iOS 16.1, *)
public struct NoLateDepartureAttributes: ActivityAttributes, Hashable, Sendable {
  public typealias ContentState = NoLateDepartureContentState

  public let scheduleId: String
  public let recipientMemberId: Int64
  public let generation: Int64
  public let scheduleTitle: String
  public let destinationName: String
  public let scheduleStartAt: String
  public let actionEventKey: String
  public let logicalEventKey: String?

  public init(
    scheduleId: String,
    recipientMemberId: Int64,
    generation: Int64,
    scheduleTitle: String,
    destinationName: String,
    scheduleStartAt: String,
    actionEventKey: String,
    logicalEventKey: String?
  ) {
    self.scheduleId = scheduleId
    self.recipientMemberId = recipientMemberId
    self.generation = generation
    self.scheduleTitle = scheduleTitle
    self.destinationName = destinationName
    self.scheduleStartAt = scheduleStartAt
    self.actionEventKey = actionEventKey
    self.logicalEventKey = logicalEventKey
  }

  public var routeURL: URL {
    URL(string: "nolate://schedule/\(scheduleId)?openRouteDetail=1")!
  }

  public var scheduleURL: URL {
    URL(string: "nolate://schedule/\(scheduleId)")!
  }

  public var identityKey: String {
    "\(recipientMemberId):\(scheduleId)"
  }
}
