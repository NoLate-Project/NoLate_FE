import XCTest
@testable import NoLateLiveActivityPolicy

final class NoLateJourneyCheckpointStoreTests: XCTestCase {
  private struct Payload: Codable, Equatable { let status: String; var value: Double = 1 }
  private typealias Store = NoLateJourneyCheckpointStore<Payload>
  private let url = URL(fileURLWithPath: "/synthetic-test/checkpoint.json")

  private final class FakeIO: NoLateJourneyCheckpointIO {
    enum Injected: Error { case failure }
    var files: [URL: Data] = [:]
    var operations: [String] = []
    var failMove = false
    var failRead = false
    var failWrite = false
    var publishBeforeWriteFailure = false
    var failRemoval = false
    var failConsumedCleanup = false
    var failRemovalAfterWrite = false

    func fileExists(at url: URL) -> Bool { files[url] != nil }
    func moveIfPresent(from source: URL, to destination: URL) throws -> Bool {
      operations.append("move")
      if failMove { throw Injected.failure }
      guard let data = files.removeValue(forKey: source) else { return false }
      files[destination] = data
      return true
    }
    func removeIfPresent(at url: URL) throws {
      operations.append("remove")
      if failRemoval || (failConsumedCleanup && url.lastPathComponent.contains(".consumed-")) { throw Injected.failure }
      files[url] = nil
    }
    func read(at url: URL) throws -> Data {
      operations.append("read")
      if failRead { throw Injected.failure }
      return try XCTUnwrap(files[url])
    }
    func writeAtomically(_ data: Data, to url: URL) throws {
      operations.append("write")
      if publishBeforeWriteFailure { files[url] = data }
      if failRemovalAfterWrite { failRemoval = true }
      if failWrite { throw Injected.failure }
      files[url] = data
    }
  }

  func testRestoreConsumesBeforeReadingAndCannotRestoreTwice() throws {
    let io = FakeIO(); io.files[url] = try encoded("ARMED")
    var store = Store(url: url, io: io)
    XCTAssertTrue(store.canRestore)
    XCTAssertEqual(try store.restore()?.status, "ARMED")
    XCTAssertEqual(io.operations, ["move", "read", "remove"])
    XCTAssertNil(io.files[url])
    XCTAssertFalse(store.canRestore)
    XCTAssertNil(try store.restore())
    var afterRestart = Store(url: url, io: io)
    XCTAssertNil(try afterRestart.restore())
  }

  func testSuccessfulSaveAllowsANewConsumption() throws {
    let io = FakeIO(); var store = Store(url: url, io: io)
    try store.save(.init(status: "ARMED"))
    XCTAssertEqual(try store.restore()?.status, "ARMED")
    try store.save(.init(status: "ACTIVE"))
    XCTAssertTrue(store.canRestore)
    XCTAssertEqual(try store.restore()?.status, "ACTIVE")
  }

  func testSaveInvalidatesOldCheckpointBeforeWritingNewOne() throws {
    let io = FakeIO(); io.files[url] = try encoded("ARMED")
    var store = Store(url: url, io: io)
    try store.save(.init(status: "ACTIVE"))
    XCTAssertEqual(io.operations, ["remove", "write"])
    XCTAssertEqual(try store.restore()?.status, "ACTIVE")
  }

  func testWriteFailureNeverRestoresAnOlderArmedCheckpoint() throws {
    let io = FakeIO(); io.files[url] = try encoded("ARMED"); io.failWrite = true
    var store = Store(url: url, io: io)
    assertFailure(.writeFailed, durable: true) { try store.save(.init(status: "ACTIVE")) }
    XCTAssertNil(io.files[url])
    XCTAssertFalse(store.isAvailable)
    XCTAssertFalse(store.canRestore)
    var afterRestart = Store(url: url, io: io)
    XCTAssertNil(try afterRestart.restore())
  }

  func testReportedFailureAfterPublicationAlsoInvalidatesTheNewFile() throws {
    let io = FakeIO(); io.failWrite = true; io.publishBeforeWriteFailure = true
    var store = Store(url: url, io: io)
    assertFailure(.writeFailed, durable: true) { try store.save(.init(status: "ACTIVE")) }
    XCTAssertNil(io.files[url])
  }

  func testEncodingFailureAlsoInvalidatesAnOlderArmedCheckpoint() throws {
    let io = FakeIO(); io.files[url] = try encoded("ARMED")
    var store = Store(url: url, io: io)
    assertFailure(.encodeFailed, durable: true) { try store.save(.init(status: "STOPPED", value: .nan)) }
    XCTAssertNil(io.files[url])
    XCTAssertFalse(store.isAvailable)
  }

  func testInvalidationFailureBlocksMemoryAndReportsDurableLimitation() throws {
    let io = FakeIO(); io.files[url] = try encoded("ARMED"); io.failRemoval = true
    var store = Store(url: url, io: io)
    assertFailure(.invalidateFailed, durable: false) { try store.save(.init(status: "STOPPED")) }
    XCTAssertNotNil(io.files[url], "Filesystem refusal cannot guarantee deletion across restart")
    XCTAssertFalse(store.isAvailable)
    assertFailure(.blocked, durable: false) { _ = try store.restore() }
    XCTAssertFalse(io.operations.contains("write"))
  }

  func testRevokeBlocksRestoreAndSaveEvenWhenDiskRemovalFails() throws {
    let io = FakeIO(); io.files[url] = try encoded("ARMED"); io.failRemoval = true
    var store = Store(url: url, io: io)
    assertFailure(.invalidateFailed, durable: false) { try store.revoke() }
    XCTAssertFalse(store.canRestore)
    io.failRemoval = false
    assertFailure(.blocked, durable: false) { try store.save(.init(status: "ACTIVE")) }
    assertFailure(.blocked, durable: false) { _ = try store.restore() }
    try store.revoke()
    XCTAssertNil(io.files[url])
    XCTAssertFalse(store.isAvailable)
  }

  func testRevokeDeletesTerminalCheckpointAsWell() throws {
    let io = FakeIO(); io.files[url] = try encoded("STOPPED")
    var store = Store(url: url, io: io)
    try store.revoke()
    XCTAssertNil(io.files[url])
    assertFailure(.blocked, durable: true) { _ = try store.restore() }
  }

  func testConsumeRenameFailureNeverReadsTheCheckpoint() throws {
    let io = FakeIO(); io.files[url] = try encoded("ARMED"); io.failMove = true
    var store = Store(url: url, io: io)
    assertFailure(.consumeFailed, durable: false) { _ = try store.restore() }
    XCTAssertEqual(io.operations, ["move"])
    XCTAssertFalse(store.isAvailable)
  }

  func testReadAndDecodeFailuresLeaveNoRestorableOriginal() throws {
    for readFailure in [true, false] {
      let io = FakeIO(); io.files[url] = Data("not-json".utf8); io.failRead = readFailure
      var store = Store(url: url, io: io)
      assertFailure(readFailure ? .readFailed : .decodeFailed, durable: true) { _ = try store.restore() }
      XCTAssertNil(io.files[url])
      XCTAssertTrue(io.files.isEmpty)
      XCTAssertFalse(store.isAvailable)
    }
  }

  func testConsumedCleanupFailureCannotRestoreTheTombstone() throws {
    let io = FakeIO(); io.files[url] = try encoded("ARMED"); io.failConsumedCleanup = true
    var store = Store(url: url, io: io)
    assertFailure(.cleanupFailed, durable: true) { _ = try store.restore() }
    XCTAssertNil(io.files[url])
    XCTAssertEqual(io.files.count, 1)
    var afterRestart = Store(url: url, io: io)
    XCTAssertNil(try afterRestart.restore())
  }

  func testWriteThenInvalidationFailureIsExplicitlyNotDurable() throws {
    let io = FakeIO(); io.failWrite = true; io.publishBeforeWriteFailure = true; io.failRemovalAfterWrite = true
    var store = Store(url: url, io: io)
    assertFailure(.writeAndInvalidateFailed, durable: false) { try store.save(.init(status: "ACTIVE")) }
    XCTAssertFalse(store.isAvailable)
    XCTAssertNotNil(io.files[url])
  }

  func testOversizedWriteIsRejectedAfterInvalidatingOldCheckpoint() throws {
    let io = FakeIO(); io.files[url] = try encoded("ARMED")
    var store = Store(url: url, io: io)
    assertFailure(.invalidPayloadSize, durable: true) {
      try store.save(.init(status: String(repeating: "x", count: 262_145)))
    }
    XCTAssertNil(io.files[url])
    XCTAssertFalse(io.operations.contains("write"))
  }

  func testEmptyAndOversizedConsumedDataCannotBeDecoded() throws {
    for data in [Data(), Data(repeating: 32, count: 262_145)] {
      let io = FakeIO(); io.files[url] = data
      var store = Store(url: url, io: io)
      assertFailure(.invalidPayloadSize, durable: true) { _ = try store.restore() }
      XCTAssertTrue(io.files.isEmpty)
    }
  }

  func testDirectoryAndNonFileURLsNeverTriggerMutations() throws {
    for invalid in [URL(fileURLWithPath: "/"), URL(fileURLWithPath: "/synthetic-test/", isDirectory: true), URL(string: "https://example.test/state.json")!] {
      let io = FakeIO(); var store = Store(url: invalid, io: io)
      assertFailure(.invalidURL, durable: false) { try store.save(.init(status: "ARMED")) }
      assertFailure(.invalidURL, durable: false) { try store.revoke() }
      XCTAssertTrue(io.operations.isEmpty)
    }
  }

  func testRealTemporaryDirectoryAtomicRoundTripAndConsumption() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("nolate-checkpoint-test-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: directory) }
    let checkpoint = directory.appendingPathComponent("state.json")
    var store = Store(url: checkpoint)
    XCTAssertNil(try store.restore())
    try store.save(.init(status: "ARMED"))
    XCTAssertTrue(store.canRestore)
    XCTAssertEqual(try store.restore()?.status, "ARMED")
    XCTAssertFalse(FileManager.default.fileExists(atPath: checkpoint.path))
    XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty)
    try store.save(.init(status: "ACTIVE"))
    try store.revoke()
    XCTAssertFalse(FileManager.default.fileExists(atPath: checkpoint.path))
  }

  func testRealIORefusesDirectoryTargetsWithoutDeletingContents() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("nolate-checkpoint-directory-" + UUID().uuidString + ".json", isDirectory: false)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: directory) }
    var store = Store(url: directory)
    assertFailure(.invalidURL, durable: false) { try store.save(.init(status: "ARMED")) }
    XCTAssertThrowsError(try NoLateJourneyCheckpointFoundationIO().removeIfPresent(at: directory))
    XCTAssertTrue(FileManager.default.fileExists(atPath: directory.path))
  }

  private func encoded(_ status: String) throws -> Data { try JSONEncoder().encode(Payload(status: status)) }

  private func assertFailure(_ code: Store.FailureCode, durable: Bool, file: StaticString = #filePath, line: UInt = #line,
                             _ operation: () throws -> Void) {
    XCTAssertThrowsError(try operation(), file: file, line: line) { error in
      XCTAssertEqual(error as? Store.Failure, .init(code: code, durableInvalidationGuaranteed: durable), file: file, line: line)
    }
  }
}
