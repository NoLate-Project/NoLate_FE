import Foundation

/// Single-owner, simulator-only checkpoint persistence. The runtime supplies one fixed JSON URL.
/// A consumed checkpoint is never restored from a tombstone, and failed saves never roll back.
/// If the filesystem rejects invalidation, only this instance can be blocked: durable deletion
/// across a process restart cannot be guaranteed. Callers must surface that failure explicitly.
struct NoLateJourneyCheckpointStore<Value: Codable> {
  enum FailureCode: String, Codable, Sendable {
    case blocked = "STORE_BLOCKED"
    case invalidURL = "INVALID_CHECKPOINT_URL"
    case consumeFailed = "CONSUME_FAILED"
    case readFailed = "READ_FAILED"
    case decodeFailed = "DECODE_FAILED"
    case invalidPayloadSize = "INVALID_PAYLOAD_SIZE"
    case cleanupFailed = "CONSUMED_CLEANUP_FAILED"
    case invalidateFailed = "INVALIDATE_FAILED"
    case encodeFailed = "ENCODE_FAILED"
    case writeFailed = "WRITE_FAILED"
    case writeAndInvalidateFailed = "WRITE_AND_INVALIDATE_FAILED"
  }

  struct Failure: Error, Equatable, Sendable {
    let code: FailureCode
    /// Confirms original-path invalidation, not fsync/power-loss guarantees.
    let durableInvalidationGuaranteed: Bool
  }

  private let url: URL
  private let io: any NoLateJourneyCheckpointIO
  private var blocked = false
  private var consumed = false
  private var durableInvalidationGuaranteed = false

  var isAvailable: Bool { !blocked && validURL }
  var canRestore: Bool { isAvailable && !consumed && io.fileExists(at: url) }

  init(url: URL, io: any NoLateJourneyCheckpointIO = NoLateJourneyCheckpointFoundationIO()) {
    self.url = url.standardizedFileURL
    self.io = io
    // Refuse broad/directory URLs before any mutation. A store never creates its parent folder.
    if !url.isFileURL || url.hasDirectoryPath || url.pathExtension != "json" {
      blocked = true
    }
  }

  mutating func restore() throws -> Value? {
    try ensureAvailable()
    guard !consumed else { return nil }
    let retiredURL = url.deletingLastPathComponent()
      .appendingPathComponent(url.lastPathComponent + ".consumed-" + UUID().uuidString)
    do {
      // Same-directory rename happens before reading/decoding. A crash cannot restore this twice.
      guard try io.moveIfPresent(from: url, to: retiredURL) else { return nil }
    } catch {
      throw fail(.consumeFailed, durable: false)
    }
    consumed = true
    durableInvalidationGuaranteed = true
    let result: Result<Value, Failure>
    do {
      let data = try io.read(at: retiredURL)
      if data.isEmpty || data.count > NoLateJourneyCheckpointBounds.maximumBytes {
        result = .failure(Failure(code: .invalidPayloadSize, durableInvalidationGuaranteed: true))
      } else {
        do { result = .success(try JSONDecoder().decode(Value.self, from: data)) }
        catch { result = .failure(Failure(code: .decodeFailed, durableInvalidationGuaranteed: true)) }
      }
    } catch {
      result = .failure(Failure(code: .readFailed, durableInvalidationGuaranteed: true))
    }
    do { try io.removeIfPresent(at: retiredURL) }
    catch { throw fail(.cleanupFailed, durable: true) }
    switch result {
    case .success(let value): return value
    case .failure(let failure):
      blocked = true
      throw failure
    }
  }

  mutating func save(_ value: Value) throws {
    try ensureAvailable()
    // Invalidate before encoding as well: an encoding failure must not preserve an older ARMED state.
    do { try io.removeIfPresent(at: url) }
    catch { throw fail(.invalidateFailed, durable: false) }
    durableInvalidationGuaranteed = true
    let data: Data
    do { data = try JSONEncoder().encode(value) }
    catch { throw fail(.encodeFailed, durable: true) }
    guard !data.isEmpty, data.count <= NoLateJourneyCheckpointBounds.maximumBytes else {
      throw fail(.invalidPayloadSize, durable: true)
    }
    do { try io.writeAtomically(data, to: url) }
    catch {
      // Also invalidate a new file if an IO implementation reports failure after publication.
      do { try io.removeIfPresent(at: url) }
      catch { throw fail(.writeAndInvalidateFailed, durable: false) }
      throw fail(.writeFailed, durable: true)
    }
    consumed = false
    durableInvalidationGuaranteed = false
  }

  /// Explicit stop revokes all checkpoints, including terminal ones. New sessions use a new store.
  mutating func revoke() throws {
    blocked = true
    consumed = true
    guard validURL else { throw Failure(code: .invalidURL, durableInvalidationGuaranteed: false) }
    do { try io.removeIfPresent(at: url) }
    catch { throw fail(.invalidateFailed, durable: false) }
    durableInvalidationGuaranteed = true
  }

  private var validURL: Bool { url.isFileURL && !url.hasDirectoryPath && url.pathExtension == "json" }

  private func ensureAvailable() throws {
    guard validURL else { throw Failure(code: .invalidURL, durableInvalidationGuaranteed: false) }
    guard !blocked else {
      throw Failure(code: .blocked, durableInvalidationGuaranteed: durableInvalidationGuaranteed)
    }
  }

  private mutating func fail(_ code: FailureCode, durable: Bool) -> Failure {
    blocked = true
    durableInvalidationGuaranteed = durable
    return Failure(code: code, durableInvalidationGuaranteed: durable)
  }
}

/// Test seam. Each mutation must either succeed or throw; missing source files are not failures.
protocol NoLateJourneyCheckpointIO {
  func fileExists(at url: URL) -> Bool
  func moveIfPresent(from source: URL, to destination: URL) throws -> Bool
  func removeIfPresent(at url: URL) throws
  func read(at url: URL) throws -> Data
  func writeAtomically(_ data: Data, to url: URL) throws
}

struct NoLateJourneyCheckpointFoundationIO: NoLateJourneyCheckpointIO {
  private enum FileSafetyError: Error { case notRegularFile, invalidSize }

  func fileExists(at url: URL) -> Bool {
    let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
    return attributes?[.type] as? FileAttributeType == .typeRegular
  }

  func moveIfPresent(from source: URL, to destination: URL) throws -> Bool {
    guard try regularFileExists(at: source) else { return false }
    try FileManager.default.moveItem(at: source, to: destination)
    return true
  }

  func removeIfPresent(at url: URL) throws {
    guard try regularFileExists(at: url) else { return }
    try FileManager.default.removeItem(at: url)
  }

  func read(at url: URL) throws -> Data {
    guard try regularFileExists(at: url) else { throw FileSafetyError.notRegularFile }
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard let size = attributes[.size] as? NSNumber,
          size.int64Value > 0, size.int64Value <= Int64(NoLateJourneyCheckpointBounds.maximumBytes) else {
      throw FileSafetyError.invalidSize
    }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    // A bounded read also protects against a file growing after the metadata check.
    let data = try handle.read(upToCount: NoLateJourneyCheckpointBounds.maximumBytes + 1) ?? Data()
    guard !data.isEmpty, data.count <= NoLateJourneyCheckpointBounds.maximumBytes else {
      throw FileSafetyError.invalidSize
    }
    return data
  }

  func writeAtomically(_ data: Data, to url: URL) throws {
    #if os(iOS)
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    #else
    try data.write(to: url, options: [.atomic])
    #endif
  }

  private func regularFileExists(at url: URL) throws -> Bool {
    do {
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      guard attributes[.type] as? FileAttributeType == .typeRegular else { throw FileSafetyError.notRegularFile }
      return true
    } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError {
      return false
    }
  }
}

private enum NoLateJourneyCheckpointBounds {
  static let maximumBytes = 262_144
}
