import Foundation
import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyAutomaticStoreTests: XCTestCase {
  private struct Value: Codable, Equatable { let state: String; let pending: String? }
  private enum IOFailure: Error { case injected }
  private final class IO: NoLateJourneyAutomaticStoreIO {
    var disk: Data?
    var writes = 0, removes = 0
    var rejectWrite = false, rejectRead = false, rejectRemove = false
    func exists(_ url: URL) -> Bool { disk != nil }
    func read(_ url: URL) throws -> Data { if rejectRead { throw IOFailure.injected }; return disk ?? Data() }
    func write(_ data: Data, _ url: URL) throws { writes += 1; if rejectWrite { throw IOFailure.injected }; disk = data }
    func remove(_ url: URL) throws { removes += 1; if rejectRemove { throw IOFailure.injected }; disk = nil }
  }
  private let url = URL(fileURLWithPath: "/private/tmp/nolate-automatic-store-unit.json")

  func testSuccessfulAtomicEnvelopeKeepsStateAndOutboxTogether() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    try store.save(.init(state: "ACTIVE", pending: "departure-key"))
    XCTAssertEqual(try store.load(), .init(state: "ACTIVE", pending: "departure-key"))
    XCTAssertEqual(io.removes, 0)
    XCTAssertTrue(store.canRestore)
  }

  func testLoadDoesNotConsumePendingDeparture() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    try store.save(.init(state: "ACTIVE", pending: "departure-key"))
    XCTAssertEqual(try store.load(), try store.load())
    XCTAssertEqual(io.writes, 1)
    XCTAssertEqual(io.removes, 0)
  }

  func testFailedWritePreservesPreviousBytesThenCallerCanRevoke() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    try store.save(.init(state: "ARMED", pending: nil)); let before = io.disk
    io.rejectWrite = true
    XCTAssertThrowsError(try store.save(.init(state: "ACTIVE", pending: "departure-key")))
    XCTAssertEqual(io.disk, before)
    XCTAssertEqual(io.removes, 0)
    XCTAssertFalse(store.canRestore)
    XCTAssertThrowsError(try store.load())
    try store.revoke() // Atomic tombstone unavailable: explicit revoke removes old checkpoint.
    XCTAssertNil(io.disk)
  }

  func testAckWriteFailureDoesNotLosePendingReceiptBeforeRevocation() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    try store.save(.init(state: "ACTIVE", pending: "departure-key")); let before = io.disk
    io.rejectWrite = true
    XCTAssertThrowsError(try store.save(.init(state: "ACTIVE_ACKNOWLEDGED", pending: nil)))
    XCTAssertEqual(io.disk, before)
  }

  func testRevokePublishesTombstoneAndSurvivesNewStoreInstance() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    try store.save(.init(state: "ACTIVE", pending: "departure-key")); try store.revoke()
    let tombstone = io.disk
    XCTAssertFalse(store.canRestore)
    var reopened = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    XCTAssertFalse(reopened.canRestore) // Readiness must be correct before the first load.
    XCTAssertEqual(io.disk, tombstone)
    XCTAssertEqual(io.removes, 0)
    XCTAssertNil(try reopened.load())
    XCTAssertFalse(reopened.canRestore)
    XCTAssertThrowsError(try reopened.save(.init(state: "ARMED", pending: nil)))
  }

  func testNewStoreAdvertisesOnlyValidSavedEnvelopeWithoutConsumingIt() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    XCTAssertFalse(store.canRestore)
    try store.save(.init(state: "ACTIVE", pending: "departure-key"))
    let saved = io.disk
    let reopened = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    XCTAssertTrue(reopened.canRestore)
    XCTAssertTrue(reopened.canRestore)
    XCTAssertEqual(io.disk, saved)
    XCTAssertEqual(io.writes, 1)
    XCTAssertEqual(io.removes, 0)
  }

  func testNewStoreReadinessFailsClosedForCorruptOrInconsistentRecord() {
    let records = [
      "private invalid json",
      #"{"schemaVersion":2,"revoked":false,"value":{"state":"ACTIVE"}}"#,
      #"{"schemaVersion":1,"revoked":false,"value":null}"#,
      #"{"schemaVersion":1,"revoked":true,"value":{"state":"ACTIVE"}}"#,
      #"{"schemaVersion":1,"value":{"state":"ACTIVE"}}"#,
      #"{"schemaVersion":1,"revoked":false,"value":{"state":42}}"#,
    ]
    for data in records.map({ Data($0.utf8) }) + [Data(), Data(repeating: 32, count: 2_097_153)] {
      let io = IO(); io.disk = data
      let reopened = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
      XCTAssertFalse(reopened.canRestore)
      XCTAssertEqual(io.disk, data)
      XCTAssertEqual(io.writes, 0)
      XCTAssertEqual(io.removes, 0)
    }
  }

  func testNewStoreReadinessFailsClosedOnReadFailureWithoutDiscardingReceipt() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    try store.save(.init(state: "ACTIVE", pending: "departure-key"))
    let saved = io.disk
    io.rejectRead = true
    let reopened = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    XCTAssertFalse(reopened.canRestore)
    XCTAssertEqual(io.disk, saved)
    XCTAssertEqual(io.removes, 0)
    io.rejectRead = false
    XCTAssertTrue(reopened.canRestore)
  }

  func testAllMutationFailuresMakeDurableRevocationLimitationExplicit() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    try store.save(.init(state: "ARMED", pending: nil))
    io.rejectWrite = true; io.rejectRemove = true
    XCTAssertThrowsError(try store.revoke()) { error in
      XCTAssertEqual(error as? NoLateJourneyAutomaticStore<Value>.Failure,
                     .init(code: "STORE_REVOCATION_FAILED", durableRevocationGuaranteed: false))
    }
    XCTAssertFalse(store.isAvailable)
    XCTAssertNotNil(io.disk)
    XCTAssertThrowsError(try store.load())
  }

  func testCorruptAndOversizedReadsBlockWithoutReturningRawPayload() throws {
    for data in [Data(), Data("private invalid json".utf8), Data(repeating: 32, count: 2_097_153)] {
      let io = IO(); io.disk = data
      var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
      XCTAssertThrowsError(try store.load()) { error in
        XCTAssertEqual((error as? NoLateJourneyAutomaticStore<Value>.Failure)?.code, "STORE_READ_FAILED")
      }
      XCTAssertFalse(store.canRestore)
    }
  }

  func testReadFailurePreservesReceiptAndCanBeExplicitlyRevoked() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    try store.save(.init(state: "ACTIVE", pending: "departure-key")); let before = io.disk
    io.rejectRead = true
    XCTAssertThrowsError(try store.load())
    XCTAssertEqual(io.disk, before)
    try store.revoke()
    io.rejectRead = false
    var reopened = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    XCTAssertNil(try reopened.load())
  }

  func testInvalidAndDirectoryURLsNeverWrite() throws {
    for url in [URL(string: "https://example.test/a.json")!, URL(fileURLWithPath: "/private/tmp/", isDirectory: true),
                URL(fileURLWithPath: "/private/tmp/a.txt")] {
      let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
      XCTAssertThrowsError(try store.save(.init(state: "ARMED", pending: nil)))
      XCTAssertThrowsError(try store.revoke())
      XCTAssertEqual(io.writes, 0)
      XCTAssertEqual(io.removes, 0)
    }
  }

  func testOversizedWritePreservesPreviousEnvelope() throws {
    let io = IO(); var store = NoLateJourneyAutomaticStore<Value>(url: url, io: io)
    try store.save(.init(state: "ACTIVE", pending: "departure-key")); let before = io.disk
    XCTAssertThrowsError(try store.save(.init(state: String(repeating: "x", count: 2_097_152), pending: nil)))
    XCTAssertEqual(io.disk, before)
    XCTAssertEqual(io.writes, 1)
  }

  func testActualTemporaryDirectoryRoundTripAndRevocation() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("nolate-auto-store-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("envelope.json")
    var store = NoLateJourneyAutomaticStore<Value>(url: url)
    try store.save(.init(state: "ACTIVE", pending: "departure-key"))
    var reopened = NoLateJourneyAutomaticStore<Value>(url: url)
    XCTAssertTrue(reopened.canRestore)
    XCTAssertEqual(try reopened.load()?.pending, "departure-key")
    try reopened.revoke()
    var final = NoLateJourneyAutomaticStore<Value>(url: url)
    XCTAssertFalse(final.canRestore)
    XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    XCTAssertNil(try final.load())
  }

  func testDirectoryAndSymlinkTargetsAreNotOverwritten() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("nolate-auto-safety-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: directory) }
    let nested = directory.appendingPathComponent("directory.json")
    try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: false)
    var directoryStore = NoLateJourneyAutomaticStore<Value>(url: nested)
    XCTAssertThrowsError(try directoryStore.save(.init(state: "ARMED", pending: nil)))
    let original = directory.appendingPathComponent("original.json")
    var originalStore = NoLateJourneyAutomaticStore<Value>(url: original)
    try originalStore.save(.init(state: "ACTIVE", pending: "safe"))
    let link = directory.appendingPathComponent("link.json")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: original)
    var linkStore = NoLateJourneyAutomaticStore<Value>(url: link)
    XCTAssertThrowsError(try linkStore.load())
    XCTAssertThrowsError(try linkStore.revoke())
    XCTAssertEqual(try originalStore.load()?.pending, "safe")
  }
}
