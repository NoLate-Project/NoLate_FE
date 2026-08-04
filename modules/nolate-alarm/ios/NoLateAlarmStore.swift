import Foundation

enum NoLateAlarmPersistenceError: Error, LocalizedError {
  case encodingFailed
  case decodingFailed
  case resetFailed

  var errorDescription: String? {
    switch self {
    case .encodingFailed:
      return "Failed to persist departure alarm state."
    case .decodingFailed:
      return "Stored departure alarm state is corrupted."
    case .resetFailed:
      return "Failed to purge departure alarm state."
    }
  }
}

final class NoLateAlarmStore {
  static let storageKey = "nolate.departure-alarms.snapshot.v1"

  private let defaults: UserDefaults
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    self.encoder = JSONEncoder()
    self.decoder = JSONDecoder()
    self.encoder.outputFormatting = [.sortedKeys]
  }

  func load() throws -> NoLateAlarmStoreSnapshot {
    guard let data = defaults.data(forKey: Self.storageKey) else {
      return .empty
    }
    guard let snapshot = try? decoder.decode(NoLateAlarmStoreSnapshot.self, from: data) else {
      // Preserve the original bytes so a future migration or support build
      // can recover them. Reconciliation must not overwrite them with empty.
      throw NoLateAlarmPersistenceError.decodingFailed
    }
    return snapshot
  }

  func save(_ snapshot: NoLateAlarmStoreSnapshot) throws {
    guard let data = try? encoder.encode(snapshot) else {
      throw NoLateAlarmPersistenceError.encodingFailed
    }
    defaults.set(data, forKey: Self.storageKey)
    guard defaults.synchronize(), defaults.data(forKey: Self.storageKey) == data else {
      throw NoLateAlarmPersistenceError.encodingFailed
    }
  }

  func reset() throws {
    defaults.removeObject(forKey: Self.storageKey)
    guard defaults.synchronize(), defaults.object(forKey: Self.storageKey) == nil else {
      throw NoLateAlarmPersistenceError.resetFailed
    }
  }
}

final class NoLateAlarmFireJournal {
  static let storageKey = "nolate.alarm-fire-journal.v1"

  private let defaults: UserDefaults
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    encoder.outputFormatting = [.sortedKeys]
  }

  func load() throws -> [NoLateStoredAlarmFireEvent] {
    guard let data = defaults.data(forKey: Self.storageKey) else { return [] }
    guard let events = try? decoder.decode([NoLateStoredAlarmFireEvent].self, from: data) else {
      throw NoLateAlarmPersistenceError.decodingFailed
    }
    return Array(events.suffix(NoLateAlarmFireEventPolicy.maximumEvents))
  }

  func record(_ event: NoLateStoredAlarmFireEvent) throws {
    try save(NoLateAlarmFireEventPolicy.merge(existing: load(), incoming: event))
  }

  func remove(eventId: String) throws -> Bool {
    let current = try load()
    guard current.contains(where: { $0.eventId == eventId }) else { return false }
    try save(current.filter { $0.eventId != eventId })
    return true
  }

  func reset() throws {
    defaults.removeObject(forKey: Self.storageKey)
    guard defaults.object(forKey: Self.storageKey) == nil else {
      throw NoLateAlarmPersistenceError.resetFailed
    }
  }

  private func save(_ events: [NoLateStoredAlarmFireEvent]) throws {
    guard let data = try? encoder.encode(events) else {
      throw NoLateAlarmPersistenceError.encodingFailed
    }
    defaults.set(data, forKey: Self.storageKey)
    guard defaults.synchronize(), defaults.data(forKey: Self.storageKey) == data else {
      throw NoLateAlarmPersistenceError.encodingFailed
    }
  }
}

final class NoLateAlarmActionJournal {
  static let storageKey = "nolate.departure-action-journal.v1"
  private static let lock = NSLock()

  private let defaults: UserDefaults
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    encoder.outputFormatting = [.sortedKeys]
  }

  func load() throws -> [NoLateStoredDepartureActionEvent] {
    try synchronized { try loadUnlocked() }
  }

  func record(_ event: NoLateStoredDepartureActionEvent) throws {
    try synchronized {
      try saveUnlocked(NoLateDepartureActionEventPolicy.merge(
        existing: try loadUnlocked(),
        incoming: event
      ))
    }
  }

  func markNavigationDelivered(eventId: String) throws -> Bool {
    try synchronized {
      let current = try loadUnlocked()
      guard let index = current.firstIndex(where: { $0.eventId == eventId }) else {
        return false
      }
      if current[index].routeNavigationDelivered { return true }
      var updated = current
      updated[index].routeNavigationDelivered = true
      try saveUnlocked(updated)
      return true
    }
  }

  func remove(eventId: String) throws -> Bool {
    try synchronized {
      let current = try loadUnlocked()
      guard current.contains(where: { $0.eventId == eventId }) else { return false }
      try saveUnlocked(current.filter { $0.eventId != eventId })
      return true
    }
  }

  func reset() throws {
    try synchronized {
      defaults.removeObject(forKey: Self.storageKey)
      guard defaults.synchronize(), defaults.object(forKey: Self.storageKey) == nil else {
        throw NoLateAlarmPersistenceError.resetFailed
      }
    }
  }

  private func loadUnlocked() throws -> [NoLateStoredDepartureActionEvent] {
    guard let data = defaults.data(forKey: Self.storageKey) else { return [] }
    guard let events = try? decoder.decode([NoLateStoredDepartureActionEvent].self, from: data) else {
      throw NoLateAlarmPersistenceError.decodingFailed
    }
    return Array(events.suffix(NoLateDepartureActionEventPolicy.maximumEvents))
  }

  private func saveUnlocked(_ events: [NoLateStoredDepartureActionEvent]) throws {
    guard let data = try? encoder.encode(events) else {
      throw NoLateAlarmPersistenceError.encodingFailed
    }
    defaults.set(data, forKey: Self.storageKey)
    guard defaults.synchronize(), defaults.data(forKey: Self.storageKey) == data else {
      throw NoLateAlarmPersistenceError.encodingFailed
    }
  }

  private func synchronized<T>(_ operation: () throws -> T) rethrows -> T {
    Self.lock.lock()
    defer { Self.lock.unlock() }
    return try operation()
  }
}

final class NoLateAlarmNavigationJournal {
  static let storageKey = "nolate.alarm-navigation-journal.v1"
  private static let lock = NSLock()

  private let defaults: UserDefaults
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    encoder.outputFormatting = [.sortedKeys]
  }

  func load() throws -> [NoLateStoredAlarmNavigationEvent] {
    try synchronized { try loadUnlocked() }
  }

  func record(_ event: NoLateStoredAlarmNavigationEvent) throws {
    try synchronized {
      try saveUnlocked(NoLateAlarmNavigationEventPolicy.merge(
        existing: try loadUnlocked(),
        incoming: event
      ))
    }
  }

  func remove(eventId: String) throws -> Bool {
    try synchronized {
      let current = try loadUnlocked()
      guard current.contains(where: { $0.eventId == eventId }) else { return false }
      try saveUnlocked(current.filter { $0.eventId != eventId })
      return true
    }
  }

  func reset() throws {
    try synchronized {
      defaults.removeObject(forKey: Self.storageKey)
      guard defaults.synchronize(), defaults.object(forKey: Self.storageKey) == nil else {
        throw NoLateAlarmPersistenceError.resetFailed
      }
    }
  }

  private func loadUnlocked() throws -> [NoLateStoredAlarmNavigationEvent] {
    guard let data = defaults.data(forKey: Self.storageKey) else { return [] }
    guard let events = try? decoder.decode([NoLateStoredAlarmNavigationEvent].self, from: data) else {
      throw NoLateAlarmPersistenceError.decodingFailed
    }
    return Array(events.suffix(NoLateAlarmNavigationEventPolicy.maximumEvents))
  }

  private func saveUnlocked(_ events: [NoLateStoredAlarmNavigationEvent]) throws {
    guard let data = try? encoder.encode(events) else {
      throw NoLateAlarmPersistenceError.encodingFailed
    }
    defaults.set(data, forKey: Self.storageKey)
    guard defaults.synchronize(), defaults.data(forKey: Self.storageKey) == data else {
      throw NoLateAlarmPersistenceError.encodingFailed
    }
  }

  private func synchronized<T>(_ operation: () throws -> T) rethrows -> T {
    Self.lock.lock()
    defer { Self.lock.unlock() }
    return try operation()
  }
}
