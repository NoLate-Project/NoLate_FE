import SwiftUI

struct NoLateRouteBarView: View {
  let segments: [NoLateRouteSegment]
  var compact = false
  var usesDarkSurface = false
  var themeOverride: NoLateLiveActivityThemeTokens?
  @Environment(\.colorScheme) private var colorScheme

  private var theme: NoLateLiveActivityThemeTokens {
    if let themeOverride { return themeOverride }
    if usesDarkSurface { return .dark }
    return .resolved(systemDark: colorScheme == .dark)
  }

  var body: some View {
    HStack(spacing: compact ? 3 : 4) {
      ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
        routeIcon(for: segment)
          .font(.system(size: compact ? 14 : 16, weight: .semibold))
          .foregroundStyle(routeColor(for: segment))
          .accessibilityLabel(accessibilityLabel(for: segment))

        if index < segments.count - 1 {
          routeConnector(after: segment)
        }
      }
    }
    .frame(maxWidth: .infinity)
  }

  @ViewBuilder
  private func routeConnector(after segment: NoLateRouteSegment) -> some View {
    let connector = Capsule()
      .fill(routeColor(for: segment).opacity(theme == .dark ? 1 : 0.9))
      .frame(height: 2.5)
      .accessibilityHidden(true)

    connector
      .frame(minWidth: compact ? 8 : 10, maxWidth: .infinity)
      .layoutPriority(1)
  }

  private func routeColor(for segment: NoLateRouteSegment) -> Color {
    switch segment.kind {
    case .origin, .walk, .transfer:
      return Color(hex: theme.neutralRoute)
    default:
      return Color(hex: segment.colorHex)
    }
  }

  @ViewBuilder
  private func routeIcon(for segment: NoLateRouteSegment) -> some View {
    switch segment.kind {
    case .origin:
      Image(systemName: "circle.fill")
    case .destination:
      NoLateDestinationPinShape()
        .fill(style: FillStyle(eoFill: true))
        .frame(
          width: compact ? 11 : 12,
          height: compact ? 14 : 16
        )
    case .walk:
      Image(systemName: "figure.walk")
    case .subway:
      Image(systemName: "tram.fill")
    case .bus:
      Image(systemName: "bus.fill")
    case .drive:
      Image(systemName: "car.fill")
    case .bike:
      Image(systemName: "bicycle")
    case .transfer:
      Image(systemName: "arrow.left.arrow.right")
    }
  }

  private func accessibilityLabel(for segment: NoLateRouteSegment) -> String {
    if !segment.label.isEmpty { return segment.label }
    switch segment.kind {
    case .origin: return "출발지"
    case .destination: return "도착지"
    case .walk: return "도보"
    case .subway: return "지하철"
    case .bus: return "버스"
    case .drive: return "자동차"
    case .bike: return "자전거"
    case .transfer: return "환승"
    }
  }
}

/// Filled map pin with a transparent center, matching the approved route bar
/// instead of the needle-like `mappin` system glyph.
private struct NoLateDestinationPinShape: Shape {
  func path(in rect: CGRect) -> Path {
    let width = rect.width
    let height = rect.height
    let centerX = rect.midX
    var path = Path()

    path.move(to: CGPoint(x: centerX, y: rect.maxY))
    path.addCurve(
      to: CGPoint(x: rect.minX + width * 0.08, y: rect.minY + height * 0.40),
      control1: CGPoint(x: centerX - width * 0.08, y: rect.minY + height * 0.86),
      control2: CGPoint(x: rect.minX + width * 0.08, y: rect.minY + height * 0.62)
    )
    path.addCurve(
      to: CGPoint(x: centerX, y: rect.minY),
      control1: CGPoint(x: rect.minX + width * 0.08, y: rect.minY + height * 0.15),
      control2: CGPoint(x: centerX - width * 0.22, y: rect.minY)
    )
    path.addCurve(
      to: CGPoint(x: rect.maxX - width * 0.08, y: rect.minY + height * 0.40),
      control1: CGPoint(x: centerX + width * 0.22, y: rect.minY),
      control2: CGPoint(x: rect.maxX - width * 0.08, y: rect.minY + height * 0.15)
    )
    path.addCurve(
      to: CGPoint(x: centerX, y: rect.maxY),
      control1: CGPoint(x: rect.maxX - width * 0.08, y: rect.minY + height * 0.62),
      control2: CGPoint(x: centerX + width * 0.08, y: rect.minY + height * 0.86)
    )
    path.closeSubpath()

    let holeDiameter = width * 0.30
    path.addEllipse(in: CGRect(
      x: centerX - holeDiameter / 2,
      y: rect.minY + height * 0.25 - holeDiameter / 2,
      width: holeDiameter,
      height: holeDiameter
    ))
    return path
  }
}

struct NoLateMarkView: View {
  var size: CGFloat = 34

  var body: some View {
    Image("NoLateMark", bundle: .main)
      .resizable()
      .renderingMode(.original)
      .scaledToFill()
      .frame(width: size, height: size)
      .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
      .accessibilityLabel("NoLate")
  }
}

extension Color {
  init(hex: String) {
    let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    let parsed = UInt64(value, radix: 16) ?? 0x2979FF
    self.init(
      .sRGB,
      red: Double((parsed >> 16) & 0xff) / 255,
      green: Double((parsed >> 8) & 0xff) / 255,
      blue: Double(parsed & 0xff) / 255,
      opacity: 1
    )
  }
}
