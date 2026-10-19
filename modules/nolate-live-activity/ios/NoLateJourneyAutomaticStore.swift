import Foundation

/// Whole-envelope atomic replacement. Never deletes the previous receipt before a replacement.
/// Success describes OS atomic publication, not a power-loss/fsync or exactly-once guarantee.
struct NoLateJourneyAutomaticStore<Value: Codable> {
  struct Failure: Error, Equatable {
    let code: String
    let durableRevocationGuaranteed: Bool
  }
  private struct Record: Codable {
    let schemaVersion: Int
    let revoked: Bool
    let value: Value?
  }
  private let url: URL
  private let io: any NoLateJourneyAutomaticStoreIO
  private var blocked = false
  private var revoked = false
  private var validURL: Bool { url.isFileURL && !url.hasDirectoryPath && url.pathExtension == "json" }
  var isAvailable: Bool { validURL && !blocked }
  /// A persisted tombstone still exists on disk, but is never a resumable checkpoint.
  /// Query through the same bounded decoder as load so a new process cannot advertise it.
  /// This is read-only readiness, not session admission; restore still revalidates the envelope.
  var canRestore: Bool {
    guard isAvailable, !revoked, let record = try? readValidatedRecord() else { return false }
    return !record.revoked && record.value != nil
  }

  init(url: URL, io: any NoLateJourneyAutomaticStoreIO = NoLateJourneyAutomaticFoundationIO()) {
    self.url = url.standardizedFileURL
    self.io = io
    blocked = !url.isFileURL || url.hasDirectoryPath || url.pathExtension != "json"
  }

  mutating func load() throws -> Value? {
    guard isAvailable else { throw Failure(code: "STORE_UNAVAILABLE", durableRevocationGuaranteed: false) }
    do {
      guard let record = try readValidatedRecord() else { return nil }
      revoked = record.revoked
      return record.value
    } catch {
      blocked = true
      throw Failure(code: "STORE_READ_FAILED", durableRevocationGuaranteed: false)
    }
  }

  private func readValidatedRecord() throws -> Record? {
    guard io.exists(url) else { return nil }
    let data = try io.read(url)
    guard !data.isEmpty, data.count <= 2_097_152 else { throw Failure(code: "STORE_PAYLOAD_INVALID", durableRevocationGuaranteed: false) }
    let record = try JSONDecoder().decode(Record.self, from: data)
    guard record.schemaVersion == 1, record.revoked == (record.value == nil) else {
      throw Failure(code: "STORE_RECORD_INVALID", durableRevocationGuaranteed: false)
    }
    return record
  }

  mutating func save(_ value: Value) throws {
    guard isAvailable, !revoked else { throw Failure(code: "STORE_UNAVAILABLE", durableRevocationGuaranteed: revoked) }
    do {
      let data = try JSONEncoder().encode(Record(schemaVersion: 1, revoked: false, value: value))
      guard !data.isEmpty, data.count <= 2_097_152 else { throw Failure(code: "STORE_PAYLOAD_INVALID", durableRevocationGuaranteed: false) }
      try io.write(data, url)
    } catch {
      blocked = true
      throw Failure(code: "STORE_WRITE_FAILED", durableRevocationGuaranteed: false)
    }
  }

  mutating func revoke() throws {
    blocked = true
    revoked = true
    guard validURL else { throw Failure(code: "STORE_URL_INVALID", durableRevocationGuaranteed: false) }
    do {
      let data = try JSONEncoder().encode(Record(schemaVersion: 1, revoked: true, value: nil))
      try io.write(data, url)
    } catch {
      // Explicit revocation may remove the old envelope if publishing a tombstone is impossible.
      do { try io.remove(url) }
      catch { throw Failure(code: "STORE_REVOCATION_FAILED", durableRevocationGuaranteed: false) }
    }
  }
}

protocol NoLateJourneyAutomaticStoreIO {
  func exists(_ url: URL) -> Bool
  func read(_ url: URL) throws -> Data
  func write(_ data: Data, _ url: URL) throws
  func remove(_ url: URL) throws
}

struct NoLateJourneyAutomaticFoundationIO: NoLateJourneyAutomaticStoreIO {
  private enum Failure: Error { case notRegular, size }
  func exists(_ url: URL) -> Bool { FileManager.default.fileExists(atPath: url.path) }
  private func regular(_ url: URL) throws -> Bool {
    do {
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      guard attributes[.type] as? FileAttributeType == .typeRegular else { throw Failure.notRegular }
      return true
    } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {
      return false
    }
  }
  func read(_ url: URL) throws -> Data {
    guard try regular(url) else { throw Failure.notRegular }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    let data = try handle.read(upToCount: 2_097_153) ?? Data()
    guard !data.isEmpty, data.count <= 2_097_152 else { throw Failure.size }
    return data
  }
  func write(_ data: Data, _ url: URL) throws {
    _ = try regular(url) // Refuse replacing a directory/symlink/device with the envelope.
    #if os(iOS)
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    #else
    try data.write(to: url, options: [.atomic])
    #endif
  }
  func remove(_ url: URL) throws {
    if try regular(url) { try FileManager.default.removeItem(at: url) }
  }
}
