import Foundation
import React
import WidgetKit

private enum NoLateWidgetBridgeConstants {
  static let appGroupIdentifier = "group.com.anonymous.nolatefe"
  static let snapshotKey = "nolate.widget.snapshot.v1"
  static let widgetKind = "NoLateScheduleWidget"
  static let maximumSnapshotBytes = 1_048_576
}

@objc(NoLateWidget)
final class NoLateWidgetModule: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(writeSnapshot:resolver:rejecter:)
  func writeSnapshot(
    _ rawSnapshot: Any,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    do {
      let data = try normalizedSnapshotData(from: rawSnapshot)
      guard data.count <= NoLateWidgetBridgeConstants.maximumSnapshotBytes else {
        reject(
          "widget_snapshot_too_large",
          "위젯 일정 데이터가 허용 크기를 초과했습니다.",
          nil
        )
        return
      }
      guard let defaults = UserDefaults(
        suiteName: NoLateWidgetBridgeConstants.appGroupIdentifier
      ) else {
        reject(
          "widget_app_group_unavailable",
          "위젯 공유 저장소를 열 수 없습니다.",
          nil
        )
        return
      }

      defaults.set(data, forKey: NoLateWidgetBridgeConstants.snapshotKey)
      guard defaults.data(forKey: NoLateWidgetBridgeConstants.snapshotKey) == data else {
        reject(
          "widget_snapshot_write_failed",
          "위젯 일정 데이터를 저장하지 못했습니다.",
          nil
        )
        return
      }

      WidgetCenter.shared.reloadTimelines(ofKind: NoLateWidgetBridgeConstants.widgetKind)
      resolve(true)
    } catch let error as NSError {
      reject("widget_snapshot_invalid", error.localizedDescription, error)
    }
  }

  @objc(clearSnapshot:rejecter:)
  func clearSnapshot(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(
      suiteName: NoLateWidgetBridgeConstants.appGroupIdentifier
    ) else {
      reject(
        "widget_app_group_unavailable",
        "위젯 공유 저장소를 열 수 없습니다.",
        nil
      )
      return
    }

    defaults.removeObject(forKey: NoLateWidgetBridgeConstants.snapshotKey)
    guard defaults.object(forKey: NoLateWidgetBridgeConstants.snapshotKey) == nil else {
      reject(
        "widget_snapshot_clear_failed",
        "위젯 일정 데이터를 삭제하지 못했습니다.",
        nil
      )
      return
    }

    WidgetCenter.shared.reloadTimelines(ofKind: NoLateWidgetBridgeConstants.widgetKind)
    resolve(true)
  }

  private func normalizedSnapshotData(from rawSnapshot: Any) throws -> Data {
    let data: Data
    if let rawString = rawSnapshot as? String {
      guard let encoded = rawString.data(using: .utf8) else {
        throw bridgeError("위젯 일정 데이터를 UTF-8로 변환하지 못했습니다.")
      }
      data = encoded
    } else {
      guard JSONSerialization.isValidJSONObject(rawSnapshot) else {
        throw bridgeError("위젯 일정 데이터는 JSON 객체여야 합니다.")
      }
      data = try JSONSerialization.data(
        withJSONObject: rawSnapshot,
        options: [.sortedKeys]
      )
    }

    let object = try JSONSerialization.jsonObject(with: data)
    guard let dictionary = object as? [String: Any],
          let version = dictionary["version"] as? NSNumber,
          version.intValue == 1 else {
      throw bridgeError("지원하지 않는 위젯 일정 데이터 버전입니다.")
    }
    guard dictionary["schedules"] is [Any] || dictionary["items"] is [Any] else {
      throw bridgeError("위젯 일정 목록이 없습니다.")
    }
    return data
  }

  private func bridgeError(_ message: String) -> NSError {
    NSError(
      domain: "NoLateWidget",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
