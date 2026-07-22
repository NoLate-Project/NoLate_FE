import CoreLocation
import Foundation
import UIKit

enum NoLateTMapValue {
  static func dictionary(_ value: Any?) -> [String: Any]? {
    if let dictionary = value as? [String: Any] {
      return dictionary
    }
    guard let dictionary = value as? NSDictionary else {
      return nil
    }

    var result: [String: Any] = [:]
    dictionary.forEach { key, value in
      if let key = key as? String {
        result[key] = value
      }
    }
    return result
  }

  static func dictionaries(_ value: Any?) -> [[String: Any]] {
    guard let values = value as? [Any] else {
      return []
    }
    return values.compactMap(dictionary)
  }

  static func string(_ value: Any?) -> String? {
    if let value = value as? String {
      return value
    }
    return nil
  }

  static func double(_ value: Any?) -> Double? {
    if let value = value as? NSNumber {
      let result = value.doubleValue
      return result.isFinite ? result : nil
    }
    if let value = value as? String, let result = Double(value), result.isFinite {
      return result
    }
    return nil
  }

  static func int(_ value: Any?) -> Int? {
    guard let value = double(value) else {
      return nil
    }
    return Int(value.rounded())
  }

  static func bool(_ value: Any?) -> Bool? {
    if let value = value as? Bool {
      return value
    }
    if let value = value as? NSNumber {
      return value.boolValue
    }
    if let value = value as? String {
      switch value.lowercased() {
      case "true", "1", "yes":
        return true
      case "false", "0", "no":
        return false
      default:
        return nil
      }
    }
    return nil
  }

  static func coordinate(_ value: Any?) -> CLLocationCoordinate2D? {
    guard
      let dictionary = dictionary(value),
      let latitude = double(dictionary["latitude"]),
      let longitude = double(dictionary["longitude"]),
      (-90...90).contains(latitude),
      (-180...180).contains(longitude)
    else {
      return nil
    }

    let coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    return CLLocationCoordinate2DIsValid(coordinate) ? coordinate : nil
  }

  static func coordinates(_ value: Any?) -> [CLLocationCoordinate2D] {
    guard let values = value as? [Any] else {
      return []
    }
    return values.compactMap(coordinate)
  }

  static func stableSignature(_ value: Any?) -> String {
    let jsonValue: Any = value ?? NSNull()
    guard
      JSONSerialization.isValidJSONObject(jsonValue),
      let data = try? JSONSerialization.data(withJSONObject: jsonValue, options: [.sortedKeys]),
      let signature = String(data: data, encoding: .utf8)
    else {
      return String(describing: jsonValue)
    }
    return signature
  }

  static func clamp<T: Comparable>(_ value: T, min minimum: T, max maximum: T) -> T {
    Swift.max(minimum, Swift.min(maximum, value))
  }
}

extension UIColor {
  static func noLateMapColor(
    _ value: Any?,
    fallback: UIColor,
    opacity: Any? = nil
  ) -> UIColor {
    let parsed = NoLateTMapValue.string(value).flatMap(parseNoLateMapColor) ?? fallback
    guard let requestedOpacity = NoLateTMapValue.double(opacity) else {
      return parsed
    }
    let alpha = CGFloat(NoLateTMapValue.clamp(requestedOpacity, min: 0, max: 1))
    return parsed.withAlphaComponent(parsed.cgColor.alpha * alpha)
  }

  private static func parseNoLateMapColor(_ rawValue: String) -> UIColor? {
    let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if value == "transparent" {
      return UIColor.clear
    }
    if value.hasPrefix("#") {
      return parseNoLateHexColor(String(value.dropFirst()))
    }
    if value.hasPrefix("rgba(") || value.hasPrefix("rgb(") {
      guard
        let open = value.firstIndex(of: "("),
        let close = value.lastIndex(of: ")"),
        open < close
      else {
        return nil
      }
      let components = value[value.index(after: open)..<close]
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      guard components.count == 3 || components.count == 4 else {
        return nil
      }
      let rgb = components.prefix(3).compactMap(Double.init)
      guard rgb.count == 3 else {
        return nil
      }
      let alpha = components.count == 4 ? (Double(components[3]) ?? 1) : 1
      return UIColor(
        red: CGFloat(NoLateTMapValue.clamp(rgb[0] / 255, min: 0, max: 1)),
        green: CGFloat(NoLateTMapValue.clamp(rgb[1] / 255, min: 0, max: 1)),
        blue: CGFloat(NoLateTMapValue.clamp(rgb[2] / 255, min: 0, max: 1)),
        alpha: CGFloat(NoLateTMapValue.clamp(alpha, min: 0, max: 1))
      )
    }
    return nil
  }

  private static func parseNoLateHexColor(_ value: String) -> UIColor? {
    let expanded: String
    switch value.count {
    case 3, 4:
      expanded = value.map { "\($0)\($0)" }.joined()
    case 6, 8:
      expanded = value
    default:
      return nil
    }

    guard let integer = UInt64(expanded, radix: 16) else {
      return nil
    }
    let hasAlpha = expanded.count == 8
    let red = CGFloat((integer >> (hasAlpha ? 24 : 16)) & 0xff) / 255
    let green = CGFloat((integer >> (hasAlpha ? 16 : 8)) & 0xff) / 255
    let blue = CGFloat((integer >> (hasAlpha ? 8 : 0)) & 0xff) / 255
    let alpha = hasAlpha ? CGFloat(integer & 0xff) / 255 : 1
    return UIColor(red: red, green: green, blue: blue, alpha: alpha)
  }
}
