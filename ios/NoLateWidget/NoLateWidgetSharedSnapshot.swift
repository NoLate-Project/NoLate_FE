import Foundation

enum NoLateWidgetSharedSnapshot {
  static let appGroupIdentifier = "group.com.anonymous.nolatefe"
  static let snapshotKey = "nolate.widget.snapshot.v1"

  static var fileURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)?
      .appendingPathComponent("\(snapshotKey).json", isDirectory: false)
  }

  static func read(at url: URL, legacy: () -> Data?) -> Data? {
    do {
      let data = try Data(contentsOf: url)
      return data.isEmpty ? nil : data
    } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
      return legacy()
    } catch {
      return nil
    }
  }

  static func write(_ data: Data, at url: URL) throws {
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  static func removeLegacyValue() {
    UserDefaults(suiteName: appGroupIdentifier)?.removeObject(forKey: snapshotKey)
  }

  static func readLegacyValue() -> Data? {
    let defaults = UserDefaults(suiteName: appGroupIdentifier)
    return defaults?.data(forKey: snapshotKey) ?? defaults?.string(forKey: snapshotKey)?.data(using: .utf8)
  }
}
