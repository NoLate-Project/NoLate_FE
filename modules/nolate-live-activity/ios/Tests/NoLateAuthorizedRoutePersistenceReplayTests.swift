import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateAuthorizedRoutePersistenceReplayTests: XCTestCase {
  /// Optional local reproduction input from the normal saved-route/TMAP contract.
  /// This is a deterministic persistence check, not official train or UI evidence.
  func testAuthorizedFirstWalkPersistsEveryFreshLocation() throws {
    guard let path = ProcessInfo.processInfo.environment["NOLATE_PERSISTENCE_REPLAY_INPUT_PATH"] else {
      throw XCTSkip("Owned saved-route persistence reproduction only")
    }
    XCTAssertTrue(path.hasPrefix("/private/tmp/nolate-official-subway-product-e2e."))
    let url = URL(fileURLWithPath: path)
    let json = String(decoding: try Data(contentsOf: url), as: UTF8.self)
    let input = try JSONDecoder().decode(NoLateJourneyRouteNormalizer.Input.self, from: Data(json.utf8))
    let snapshot = try XCTUnwrap(input.walkingSnapshot)
    let points = try XCTUnwrap(snapshot.walks.first(where: { $0.legIndex == 0 })).coordinates
    XCTAssertGreaterThan(points.count, 2)
    let now = Double(snapshot.issuedAtMs) / 1000 + 1
    let binding: [String: Any] = [
      "sessionId": "00000000-0000-4000-8000-000000000001", "scheduleId": String(snapshot.scheduleId),
      "generation": 1, "routeRevision": input.routeRevision,
      "clientOwnerId": "00000000-0000-4000-8000-000000000002",
      "routeInputDigest": NoLateJourneyAutomaticSession.digest(json),
      "preparedAtEpochSeconds": now, "expiresAtEpochSeconds": now + 600,
      "execution": "SIMULATOR", "syncScope": "AUTHENTICATED", "savedRouteValidated": true,
      "guidanceEnabled": true, "apiOrigin": "http://127.0.0.1:5528",
      "authMemberId": snapshot.memberId, "loginGeneration": snapshot.loginGeneration,
    ]
    let bindingJSON = String(decoding: try JSONSerialization.data(withJSONObject: binding), as: UTF8.self)
    var session = try NoLateJourneyAutomaticSession(routeJSON: json, bindingJSON: bindingJSON, now: now)
    var store = NoLateJourneyAutomaticStore<NoLateJourneyAutomaticSession.Envelope>(
      url: url.deletingLastPathComponent().appendingPathComponent("persistence-replay-checkpoint.json"))
    try store.save(session.envelope)
    var index = 0
    for (a, b) in zip(points, points.dropFirst()) {
      let start = NoLateJourneyEngineCore.Coordinate(latitude: a.latitude, longitude: a.longitude)
      let end = NoLateJourneyEngineCore.Coordinate(latitude: b.latitude, longitude: b.longitude)
      let steps = max(1, Int(ceil(NoLateJourneySubwayRideCore.distance(start, end) / 2.4)))
      for step in 1...steps {
        index += 1
        let fraction = Double(step) / Double(steps)
        let coordinate = NoLateJourneyEngineCore.Coordinate(
          latitude: a.latitude + (b.latitude - a.latitude) * fraction,
          longitude: a.longitude + (b.longitude - a.longitude) * fraction)
        _ = session.ingest(coordinate: coordinate, accuracy: 5, observedAt: now + Double(index), now: now + Double(index))
        do { try store.save(session.envelope) }
        catch {
          XCTFail("Checkpoint failed at first-walk sample \(index); inspect safe store stage/domain/code diagnostic")
          return
        }
      }
    }
    XCTAssertEqual(session.core.snapshot.status, .active)
    XCTAssertNotNil(try store.load())
    print("AUTHORIZED_ROUTE_FIRST_WALK_PERSISTENCE_REPLAY_PASSED samples=\(index)")
  }
}
