import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyAuthenticationTests: XCTestCase {
  func testLongNavigationRequiresCoverageBeyondFixedSessionExpiry() throws {
    let long = try binding(patch: ["expiresAtEpochSeconds": 8200])
    let short = try authentication()
    XCTAssertTrue(short.matches(long, now: 1000))
    XCTAssertFalse(short.coversNavigation(long, now: 1000))
    for expiry in [8229, 8230, 9000] {
      let auth = try authentication(patch: ["expiresAtEpochSeconds": expiry], claimsPatch: ["exp": expiry])
      XCTAssertEqual(auth.coversNavigation(long, now: 1000), expiry >= 8230)
      XCTAssertEqual(auth.coversNavigation(long, now: 1700), expiry >= 8230)
      XCTAssertFalse(auth.coversNavigation(try binding(patch: ["expiresAtEpochSeconds": 8200, "authMemberId": 8]), now: 1700))
    }
    XCTAssertTrue(short.coversNavigation(try binding(), now: 1000)) // Existing ten-minute contract unchanged.
    XCTAssertFalse(short.coversNavigation(try binding(), now: 1600))
    XCTAssertEqual(long.expiresAtEpochSeconds, 8200) // No token exchange extends authorization.
  }
  func testLiveRenewalIsIdentityAndPreviousTokenCompareAndSwap() throws {
    let previous = try authentication()
    let next = try authentication(patch: ["expiresAtEpochSeconds": 1700], claimsPatch: ["exp": 1700])
    let bound = try binding()
    XCTAssertTrue(next.canReplace(previous, expectedToken: previous.accessToken, binding: bound, now: 1000))
    XCTAssertFalse(next.canReplace(previous, expectedToken: "late-token", binding: bound, now: 1000))
    XCTAssertFalse(next.canReplace(previous, expectedToken: previous.accessToken, binding: bound, now: 1600))
    XCTAssertFalse(next.canReplace(previous, expectedToken: previous.accessToken, binding: try binding(patch: ["authMemberId": 8]), now: 1000))
    let shorter = try authentication(patch: ["expiresAtEpochSeconds": 1500], claimsPatch: ["exp": 1500])
    XCTAssertFalse(shorter.canReplace(previous, expectedToken: previous.accessToken, binding: bound, now: 1000))
    let otherGeneration = try authentication(patch: ["loginGeneration": 3, "expiresAtEpochSeconds": 1700], claimsPatch: ["sg": 3, "exp": 1700])
    XCTAssertFalse(otherGeneration.canReplace(previous, expectedToken: previous.accessToken, binding: bound, now: 1000))
    XCTAssertEqual(bound.expiresAtEpochSeconds, 1600) // Token renewal never extends session TTL.
  }
  private func authentication(patch: [String: Any] = [:], claimsPatch: [String: Any] = [:]) throws -> NoLateJourneyAuthentication {
    var claims: [String: Any] = ["type": "ACCESS", "sub": "7", "sg": 2, "iat": 990, "exp": 1600]
    claims.merge(claimsPatch) { _, new in new }
    let encoded = try JSONSerialization.data(withJSONObject: claims).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    var object: [String: Any] = ["accessToken": "e30.\(encoded).c2ln", "apiOrigin": "http://127.0.0.1:15544",
      "authMemberId": 7, "loginGeneration": 2, "expiresAtEpochSeconds": 1600]
    object.merge(patch) { _, new in new }
    return try JSONDecoder().decode(NoLateJourneyAuthentication.self, from: JSONSerialization.data(withJSONObject: object))
  }
  private func binding(patch: [String: Any] = [:]) throws -> NoLateJourneyAutomaticSession.Binding {
    var object: [String: Any] = ["sessionId": "11111111-1111-4111-8111-111111111111", "scheduleId": "9001", "generation": 1,
      "routeRevision": 1, "clientOwnerId": "22222222-2222-4222-8222-222222222222", "routeInputDigest": String(repeating: "a", count: 64),
      "preparedAtEpochSeconds": 1000, "expiresAtEpochSeconds": 1600, "execution": "SIMULATOR", "syncScope": "AUTHENTICATED",
      "savedRouteValidated": true, "guidanceEnabled": true, "apiOrigin": "http://127.0.0.1:15544", "authMemberId": 7, "loginGeneration": 2]
    object.merge(patch) { _, new in new }
    return try NoLateJourneyAutomaticSession.decodeBinding(String(decoding: JSONSerialization.data(withJSONObject: object), as: UTF8.self), now: 1000)
  }
  func testMemorySnapshotExpiresAtOriginalClaimBoundary() throws {
    let auth = try authentication()
    XCTAssertTrue(auth.valid(now: 1000)); XCTAssertTrue(auth.valid(now: 1599.999)); XCTAssertFalse(auth.valid(now: 1600))
    XCTAssertFalse(try authentication(patch: ["expiresAtEpochSeconds": 1700]).valid(now: 1000))
    for claims in [["type": "REFRESH"], ["sub": "8"], ["sg": 3], ["sg": true], ["iat": 1006], ["exp": true]] as [[String: Any]] {
      XCTAssertFalse(try authentication(claimsPatch: claims).valid(now: 1000))
    }
  }
  func testOriginNeverUsesCredentialFreeFixtureOrArbitraryPath() {
    for origin in ["http://127.0.0.1:15543", "http://example.invalid", "https://user:pass@example.invalid", "https://example.invalid/path",
      "https://example.invalid?q=x", "https://example.invalid#x", "https://example.invalid/"] {
      XCTAssertNil(NoLateJourneyAuthentication.origin(origin))
    }
    XCTAssertNotNil(NoLateJourneyAuthentication.origin("https://api.example.invalid"))
  }
  func testAuthIdentityAndSavedProofAreRequiredButCredentialsNeverEnterBinding() throws {
    let auth = try authentication(); let checked = try binding()
    XCTAssertTrue(auth.matches(checked, now: 1000))
    XCTAssertFalse(auth.matches(try binding(patch: ["authMemberId": 8]), now: 1000))
    XCTAssertFalse(auth.matches(try binding(patch: ["loginGeneration": 3]), now: 1000))
    XCTAssertFalse(auth.matches(try binding(patch: ["apiOrigin": "https://other.example.invalid"]), now: 1000))
    XCTAssertThrowsError(try binding(patch: ["savedRouteValidated": false]))
    XCTAssertThrowsError(try binding(patch: ["loginGeneration": -1]))
    XCTAssertTrue(try authentication(patch: ["loginGeneration": 0], claimsPatch: ["sg": 0]).valid(now: 1000))
    let encoded = String(decoding: try JSONEncoder().encode(checked), as: UTF8.self)
    XCTAssertFalse(encoded.contains("accessToken")); XCTAssertFalse(encoded.contains(auth.accessToken))
  }
}
