import UIKit

struct NoLateTMapMarkerArtwork {
  let image: UIImage
  let offset: CGSize
}

@MainActor
enum NoLateTMapMarkerRenderer {
  static func artwork(for item: [String: Any]) -> NoLateTMapMarkerArtwork {
    let displayType = NoLateTMapValue.string(item["displayType"]) ?? "pin"
    switch displayType {
    case "dot":
      return dotArtwork(item)
    case "station":
      return stationArtwork(item)
    case "badge":
      return badgeArtwork(item)
    case "routeLabel":
      return routeLabelArtwork(item)
    default:
      return pinArtwork(item)
    }
  }

  private static func pinArtwork(_ item: [String: Any]) -> NoLateTMapMarkerArtwork {
    let scale = markerScale(item)
    let size = CGSize(width: 38 * scale, height: 46 * scale)
    let tipBottomInset = 2 * scale
    let tint = UIColor.noLateMapColor(item["tintColor"], fallback: pinFallbackColor(item))
    let label = pinLabel(item)
    let image = render(size: size) { _ in
      let center = CGPoint(x: size.width / 2, y: 17 * scale)
      let radius = 14 * scale
      let path = UIBezierPath()
      path.move(to: CGPoint(x: center.x, y: size.height - tipBottomInset))
      path.addCurve(
        to: CGPoint(x: center.x - radius, y: center.y),
        controlPoint1: CGPoint(x: center.x - 3 * scale, y: 34 * scale),
        controlPoint2: CGPoint(x: center.x - radius, y: 25 * scale)
      )
      path.addArc(
        withCenter: center,
        radius: radius,
        startAngle: .pi,
        endAngle: 0,
        clockwise: true
      )
      path.addCurve(
        to: CGPoint(x: center.x, y: size.height - tipBottomInset),
        controlPoint1: CGPoint(x: center.x + radius, y: 25 * scale),
        controlPoint2: CGPoint(x: center.x + 3 * scale, y: 34 * scale)
      )
      path.close()

      UIColor.black.withAlphaComponent(0.18).setFill()
      let shadow = path.copy() as! UIBezierPath
      shadow.apply(CGAffineTransform(translationX: 0, y: 1.5 * scale))
      shadow.fill()
      tint.setFill()
      path.fill()
      UIColor.white.withAlphaComponent(0.9).setStroke()
      path.lineWidth = 1.5 * scale
      path.stroke()

      drawCenteredText(
        label,
        in: CGRect(x: center.x - radius, y: center.y - 9 * scale, width: radius * 2, height: 18 * scale),
        font: .systemFont(ofSize: 13 * scale, weight: .bold),
        color: .white
      )
    }
    return NoLateTMapMarkerArtwork(
      image: image,
      // TMapMarker.offset is the absolute point inside the bitmap that is attached
      // to the geographic coordinate (the SDK normalizes it by image size). It is
      // not a delta from the image center. Anchor the visible tip, not the bitmap's
      // transparent bottom edge.
      offset: CGSize(width: size.width / 2, height: size.height - tipBottomInset)
    )
  }

  private static func dotArtwork(_ item: [String: Any]) -> NoLateTMapMarkerArtwork {
    let rawSize = NoLateTMapValue.double(item["dotSize"]) ?? 8
    let scale = markerScale(item)
    let diameter = CGFloat(NoLateTMapValue.clamp(rawSize, min: 4, max: 18)) * scale
    let size = CGSize(width: diameter + 4, height: diameter + 4)
    let tint = UIColor.noLateMapColor(item["tintColor"], fallback: UIColor(red: 0.11, green: 0.45, blue: 1, alpha: 1))
    let border = UIColor.noLateMapColor(item["badgeBorderColor"], fallback: .white)
    let image = render(size: size) { _ in
      let rect = CGRect(x: 2, y: 2, width: diameter, height: diameter)
      border.setFill()
      UIBezierPath(ovalIn: rect).fill()
      tint.setFill()
      UIBezierPath(ovalIn: rect.insetBy(dx: max(1, diameter * 0.14), dy: max(1, diameter * 0.14))).fill()
    }
    return NoLateTMapMarkerArtwork(
      image: image,
      offset: CGSize(width: size.width / 2, height: size.height / 2)
    )
  }

  private static func stationArtwork(_ item: [String: Any]) -> NoLateTMapMarkerArtwork {
    let compact = NoLateTMapValue.string(item["stationVariant"]) == "compact"
    let rawSize = NoLateTMapValue.double(item["dotSize"]) ?? (compact ? 12 : 28)
    let diameter = CGFloat(NoLateTMapValue.clamp(rawSize, min: compact ? 10 : 20, max: compact ? 18 : 40)) * markerScale(item)
    let size = CGSize(width: diameter + 6, height: diameter + 6)
    let tint = UIColor.noLateMapColor(item["tintColor"], fallback: UIColor(red: 0.18, green: 0.50, blue: 1, alpha: 1))
    let style = NoLateTMapValue.string(item["markerStyle"]) ?? "subway"
    let image = render(size: size) { _ in
      let outer = CGRect(x: 3, y: 3, width: diameter, height: diameter)
      UIColor.black.withAlphaComponent(0.16).setFill()
      UIBezierPath(ovalIn: outer.offsetBy(dx: 0, dy: 1.2)).fill()
      UIColor.white.setFill()
      UIBezierPath(ovalIn: outer).fill()

      if compact {
        tint.setStroke()
        let ring = UIBezierPath(ovalIn: outer.insetBy(dx: 2.2, dy: 2.2))
        ring.lineWidth = max(1.3, diameter * 0.11)
        ring.stroke()
      } else {
        tint.setFill()
        UIBezierPath(ovalIn: outer.insetBy(dx: 3.1, dy: 3.1)).fill()
        drawTransportGlyph(style, in: outer.insetBy(dx: diameter * 0.27, dy: diameter * 0.27))
      }
    }
    return NoLateTMapMarkerArtwork(
      image: image,
      offset: CGSize(width: size.width / 2, height: size.height / 2)
    )
  }

  private static func badgeArtwork(_ item: [String: Any]) -> NoLateTMapMarkerArtwork {
    let label = markerLabel(item, fallback: "구간")
    let scale = markerScale(item)
    let accent = UIColor.noLateMapColor(item["tintColor"], fallback: UIColor(red: 0.18, green: 0.50, blue: 1, alpha: 1))
    let routeVariant = NoLateTMapValue.string(item["badgeVariant"]) == "route"
    let side = NoLateTMapValue.string(item["badgeSide"]) == "left" ? "left" : "right"
    let font = UIFont.systemFont(ofSize: 11 * scale, weight: .semibold)
    let labelWidth = min(130 * scale, max(44 * scale, textWidth(label, font: font) + 20 * scale))
    let markerDiameter = 28 * scale
    let overlap = 4 * scale
    let size = CGSize(width: labelWidth + markerDiameter - overlap, height: 34 * scale)
    let circleCenterX = side == "left" ? labelWidth - overlap + markerDiameter / 2 : markerDiameter / 2
    let labelX = side == "left" ? 0 : markerDiameter - overlap
    let image = render(size: size) { _ in
      let card = UIBezierPath(
        roundedRect: CGRect(x: labelX + 0.5, y: 4, width: labelWidth - 1, height: 26 * scale),
        cornerRadius: 7 * scale
      )
      (routeVariant ? accent : UIColor.white).setFill()
      card.fill()
      accent.withAlphaComponent(routeVariant ? 0.65 : 0.45).setStroke()
      card.lineWidth = 1
      card.stroke()

      accent.setFill()
      UIBezierPath(
        ovalIn: CGRect(
          x: circleCenterX - markerDiameter / 2,
          y: size.height / 2 - markerDiameter / 2,
          width: markerDiameter,
          height: markerDiameter
        )
      ).fill()
      UIColor.white.setStroke()
      let ring = UIBezierPath(
        ovalIn: CGRect(
          x: circleCenterX - markerDiameter / 2 + 1,
          y: size.height / 2 - markerDiameter / 2 + 1,
          width: markerDiameter - 2,
          height: markerDiameter - 2
        )
      )
      ring.lineWidth = 2
      ring.stroke()

      let textX = side == "left" ? 8 * scale : labelX + 9 * scale
      drawText(
        label,
        in: CGRect(x: textX, y: 7 * scale, width: labelWidth - 16 * scale, height: 20 * scale),
        font: font,
        color: routeVariant ? .white : UIColor.noLateMapColor(item["badgeTextColor"], fallback: UIColor(red: 0.12, green: 0.16, blue: 0.23, alpha: 1)),
        alignment: .left
      )
      drawTransportGlyph(
        NoLateTMapValue.string(item["markerStyle"]) ?? "default",
        in: CGRect(x: circleCenterX - 7 * scale, y: size.height / 2 - 7 * scale, width: 14 * scale, height: 14 * scale)
      )
    }
    let anchor = CGPoint(x: circleCenterX, y: size.height / 2)
    return NoLateTMapMarkerArtwork(
      image: image,
      offset: CGSize(width: anchor.x, height: anchor.y)
    )
  }

  private static func routeLabelArtwork(_ item: [String: Any]) -> NoLateTMapMarkerArtwork {
    let label = markerLabel(item, fallback: "노선")
    let sublabel = NoLateTMapValue.string(item["badgeSubLabel"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let context = NoLateTMapValue.string(item["badgeVariant"]) == "context"
    let side = NoLateTMapValue.string(item["badgeSide"]) == "left" ? "left" : "right"
    let scale = markerScale(item)
    let accent = UIColor.noLateMapColor(item["tintColor"], fallback: UIColor(red: 0.18, green: 0.50, blue: 1, alpha: 1))
    let font = UIFont.systemFont(ofSize: 10.5 * scale, weight: .semibold)
    let labelWidth = min(168 * scale, max(context ? 90 * scale : 42 * scale, textWidth(label, font: font) + 22 * scale))
    let gap = 11 * scale
    let size = CGSize(width: labelWidth + gap, height: context ? 44 * scale : 30 * scale)
    let boxX = side == "left" ? 0 : gap
    let anchorX = side == "left" ? size.width : 0
    let image = render(size: size) { _ in
      accent.setStroke()
      let connector = UIBezierPath()
      connector.move(to: CGPoint(x: anchorX, y: size.height / 2))
      connector.addLine(to: CGPoint(x: side == "left" ? labelWidth : gap, y: size.height / 2))
      connector.lineWidth = 1.6 * scale
      connector.stroke()

      let card = UIBezierPath(
        roundedRect: CGRect(x: boxX + 0.5, y: context ? 2.5 : 3.5, width: labelWidth - 1, height: context ? 39 * scale : 23 * scale),
        cornerRadius: 6 * scale
      )
      UIColor.white.setFill()
      card.fill()
      accent.withAlphaComponent(0.72).setStroke()
      card.lineWidth = 1
      card.stroke()
      if context {
        accent.setFill()
        UIBezierPath(roundedRect: CGRect(x: boxX + 2, y: 5, width: 4, height: 34 * scale), cornerRadius: 2).fill()
      }
      drawText(
        label,
        in: CGRect(x: boxX + (context ? 12 : 7) * scale, y: context ? 5 * scale : 6 * scale, width: labelWidth - 18 * scale, height: 16 * scale),
        font: font,
        color: UIColor(red: 0.07, green: 0.09, blue: 0.14, alpha: 1),
        alignment: context ? .left : .center
      )
      if context, !sublabel.isEmpty {
        drawText(
          String(sublabel.prefix(28)),
          in: CGRect(x: boxX + 12 * scale, y: 21 * scale, width: labelWidth - 18 * scale, height: 15 * scale),
          font: .systemFont(ofSize: 9.5 * scale, weight: .medium),
          color: UIColor(red: 0.29, green: 0.35, blue: 0.45, alpha: 1),
          alignment: .left
        )
      }
    }
    return NoLateTMapMarkerArtwork(
      image: image,
      offset: CGSize(width: anchorX, height: size.height / 2)
    )
  }

  private static func render(size: CGSize, draw: (CGContext) -> Void) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    format.scale = UIScreen.main.scale
    return UIGraphicsImageRenderer(size: size, format: format).image { context in
      draw(context.cgContext)
    }
  }

  private static func markerScale(_ item: [String: Any]) -> CGFloat {
    CGFloat(NoLateTMapValue.clamp(NoLateTMapValue.double(item["markerScale"]) ?? 1, min: 0.5, max: 2))
  }

  private static func pinFallbackColor(_ item: [String: Any]) -> UIColor {
    switch NoLateTMapValue.string(item["markerStyle"]) {
    case "origin":
      return UIColor(red: 0.05, green: 0.67, blue: 0.35, alpha: 1)
    case "destination":
      return UIColor(red: 1, green: 0.30, blue: 0.32, alpha: 1)
    default:
      return UIColor(red: 0.11, green: 0.45, blue: 1, alpha: 1)
    }
  }

  private static func pinLabel(_ item: [String: Any]) -> String {
    if let label = NoLateTMapValue.string(item["pinLabel"])?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
      return String(label.prefix(2))
    }
    switch NoLateTMapValue.string(item["markerStyle"]) {
    case "origin":
      return "출"
    case "destination":
      return "도"
    default:
      return "•"
    }
  }

  private static func markerLabel(_ item: [String: Any], fallback: String) -> String {
    let candidates = [item["badgeLabel"], item["caption"]]
    for candidate in candidates {
      if let value = NoLateTMapValue.string(candidate)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
        return String(value.prefix(28))
      }
    }
    return fallback
  }

  private static func textWidth(_ text: String, font: UIFont) -> CGFloat {
    ceil((text as NSString).size(withAttributes: [.font: font]).width)
  }

  private static func drawCenteredText(_ text: String, in rect: CGRect, font: UIFont, color: UIColor) {
    drawText(text, in: rect, font: font, color: color, alignment: .center)
  }

  private static func drawText(
    _ text: String,
    in rect: CGRect,
    font: UIFont,
    color: UIColor,
    alignment: NSTextAlignment
  ) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = alignment
    paragraph.lineBreakMode = .byTruncatingTail
    (text as NSString).draw(
      in: rect,
      withAttributes: [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: paragraph
      ]
    )
  }

  private static func drawTransportGlyph(_ style: String, in rect: CGRect) {
    let symbolName: String
    switch style {
    case "bus":
      symbolName = "bus.fill"
    case "walk":
      symbolName = "figure.walk"
    case "subway":
      symbolName = "tram.fill"
    default:
      symbolName = "circle.fill"
    }
    let configuration = UIImage.SymbolConfiguration(pointSize: min(rect.width, rect.height), weight: .bold)
    UIImage(systemName: symbolName, withConfiguration: configuration)?
      .withTintColor(.white, renderingMode: .alwaysOriginal)
      .draw(in: rect)
  }
}
