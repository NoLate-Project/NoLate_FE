import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateAuthenticatedJourneyPathPolicyTests: XCTestCase {
  private let session = "41b74213-cacf-4fc3-b19f-ea3368e50e13"
  private let candidate = "33e9438f-1fd7-4f09-8af3-18cf8062a92a"

  func testNativeAllowsEveryAuthenticatedRerouteStage() {
    let root = "/api/schedules/363/automatic-journey"
    for path in ["\(root)/prepare-saved", "\(root)/current", "\(root)/\(session)/departure",
      "\(root)/\(session)/validate", "\(root)/\(session)/reroute-candidates",
      "\(root)/\(session)/reroute-candidates/\(candidate)/walking-proof",
      "\(root)/\(session)/reroute-candidates/\(candidate)/transit-proof",
      "\(root)/\(session)/reroute-candidates/\(candidate)/commit"] {
      XCTAssertTrue(NoLateAuthenticatedJourneyPathPolicy.allows(path), path)
    }
  }

  func testNativeRejectsNonJourneyAndMalformedPaths() {
    let root = "/api/schedules/363/automatic-journey/\(session)/reroute-candidates"
    for path in ["\(root)/invalid/walking-proof", "\(root)/\(candidate)/delete",
      "\(root)/\(candidate)/commit/extra", "/api/schedules/0/automatic-journey/current",
      "https://example.com/api/schedules/363/automatic-journey/current"] {
      XCTAssertFalse(NoLateAuthenticatedJourneyPathPolicy.allows(path), path)
    }
    XCTAssertEqual(NoLateAuthenticatedJourneyPathPolicy.responseLimit(for: root), 1_100_000)
    XCTAssertEqual(NoLateAuthenticatedJourneyPathPolicy.responseLimit(for: "\(root)/\(candidate)/commit"), 1_100_000)
    XCTAssertEqual(NoLateAuthenticatedJourneyPathPolicy.responseLimit(for: "/api/schedules/363/automatic-journey/current"), 65_536)
  }
}
