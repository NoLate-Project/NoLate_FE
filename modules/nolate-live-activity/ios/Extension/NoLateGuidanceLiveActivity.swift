import ActivityKit
import SwiftUI
import WidgetKit

struct NoLateGuidanceLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: NoLateGuidanceAttributes.self) { context in
      NoLateGuidanceCard(legs: context.attributes.routeLegs, content: context.state, isStale: context.isStale)
        .padding(.horizontal, 18).padding(.vertical, 14)
        .activityBackgroundTint(Color(.systemBackground))
        .activitySystemActionForegroundColor(.primary)
        .widgetURL(scheduleURL(context.state))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) {
          NoLateGuidanceCard(legs: context.attributes.routeLegs, content: context.state, isStale: context.isStale)
        }
      } compactLeading: {
        NoLateActivityIcons.guidance(NoLateGuidancePresentationPolicy.presentation(context.state,
          legs: context.attributes.routeLegs, now: Date().timeIntervalSince1970, isStale: context.isStale).symbol, size: 14)
          .foregroundStyle(.blue)
      } compactTrailing: {
        Text(NoLateGuidancePresentationPolicy.presentation(context.state,
          legs: context.attributes.routeLegs, now: Date().timeIntervalSince1970, isStale: context.isStale).compact)
          .font(.caption2).lineLimit(1).minimumScaleFactor(0.7)
      } minimal: { NoLateActivityIcons.image(62576, size: 18).foregroundStyle(.blue) }
      .widgetURL(scheduleURL(context.state))
    }
  }

  private func scheduleURL(_ content: NoLateGuidanceContent) -> URL? {
    let id = content.scheduleId
    guard id.first != "0", id.utf8.allSatisfy({ (48...57).contains($0) }),
          let value = UInt64(id), value > 0, value <= 9_007_199_254_740_991 else {
      return URL(string: "nolate://schedule")
    }
    return URL(string: "nolate://schedule/\(id)?openRouteDetail=1")
  }
}

private struct NoLateGuidanceCard: View {
  let legs: [NoLateGuidanceRouteLeg]
  let content: NoLateGuidanceContent
  let isStale: Bool

  var body: some View {
    let now = Date().timeIntervalSince1970
    let presentation = NoLateGuidancePresentationPolicy.presentation(content, legs: legs, now: now, isStale: isStale)
    let arrival = NoLateGuidancePresentationPolicy.freshArrival(content, legs: legs, now: now, isStale: isStale)
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        NoLateActivityIcons.guidance(presentation.symbol, size: 19)
          .foregroundStyle(.blue).frame(width: 34, height: 34)
          .background(Color.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
        VStack(alignment: .leading, spacing: 3) {
          Text(presentation.title).font(.headline)
            .accessibilityLabel(presentation.title)
            .lineLimit(1).minimumScaleFactor(0.8).accessibilityIdentifier("guidance-lock-instruction")
          Text(presentation.action).font(.subheadline).foregroundStyle(.secondary)
            .accessibilityLabel(presentation.action)
            .lineLimit(1).minimumScaleFactor(0.8)
        }
        Spacer(minLength: 0)
        NoLateActivityIcons.image(62015, size: 13)
          .foregroundStyle(.secondary).accessibilityHidden(true)
      }
      NoLateGuidanceRouteBar(legs: legs, content: content, isStale: isStale)
      if let arrival {
        HStack(spacing: 5) {
          NoLateActivityIcons.image(61892, size: 12).foregroundStyle(.green)
          Text("버스 도착까지").foregroundStyle(.secondary)
          Text(Date(timeIntervalSince1970: arrival.expectedAt), style: .timer)
            .fontWeight(.semibold).monospacedDigit()
          Spacer(minLength: 4)
          Text(arrival.directionLabel).foregroundStyle(.secondary).lineLimit(1)
        }.font(.caption).lineLimit(1).minimumScaleFactor(0.8)
      }
    }.dynamicTypeSize(...DynamicTypeSize.xxxLarge)
  }
}

/// Provider labels/colours with planned proportions. Progress still comes from fresh GPS only.
private struct NoLateGuidanceRouteBar: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.isLuminanceReduced) private var isLuminanceReduced
  let legs: [NoLateGuidanceRouteLeg]
  let content: NoLateGuidanceContent
  let isStale: Bool

  var body: some View {
    let motion = reduceMotion || isLuminanceReduced
      ? nil : Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.24)
    let position = NoLateGuidanceRoutePositionPolicy.position(content, legs: legs,
      now: Date().timeIntervalSince1970, isStale: isStale)
    let displayLegs = NoLateGuidanceRouteLayoutPolicy.validTopology(legs) ? legs : []
    let layout = NoLateGuidanceRouteLayoutPolicy.layout(displayLegs)
    VStack(alignment: .leading, spacing: 3) {
      GeometryReader { proxy in
        let width = max(0, proxy.size.width - 22)
        ZStack(alignment: .topLeading) {
          HStack(spacing: 0) {
            ForEach(displayLegs, id: \.index) { leg in
              color(leg).frame(width: width * layout.fractions[leg.index])
            }
          }
          .frame(width: width, height: 8)
          .clipShape(Capsule())
          .offset(x: 11, y: 7)

          if let position {
            NoLateActivityIcons.image(62576, size: 12).rotationEffect(.degrees(45))
              .foregroundStyle(.white)
              .frame(width: 22, height: 22).background(.blue, in: Circle())
              .overlay(Circle().stroke(.white, lineWidth: 2))
              .shadow(color: .black.opacity(0.22), radius: 3, y: 1)
              .offset(x: width * position.barFraction)
              .animation(motion, value: position.barFraction)
              .transition(motion == nil ? .identity : .asymmetric(
                insertion: .modifier(active: NoLateGuidanceMarkerEntrance(progress: 0),
                                     identity: NoLateGuidanceMarkerEntrance(progress: 1)),
                removal: .identity
              ))
              .accessibilityHidden(true)
          }
        }
        .animation(motion, value: position != nil)
      }
      .frame(height: 22)

      HStack(spacing: 6) {
        let rides = displayLegs.filter { ["BUS", "SUBWAY"].contains($0.kind) }
        ForEach(rides.prefix(3), id: \.index) { leg in
          HStack(spacing: 3) {
            Circle().fill(color(leg)).frame(width: 5, height: 5)
            Text(NoLateGuidanceRouteLayoutPolicy.label(leg)).lineLimit(1)
          }
        }
        if rides.count > 3 {
          Text("+\(rides.count - 3)").foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        Text(layout.basis == "TIME" ? "구간별 예정 시간" : layout.caption)
          .foregroundStyle(.secondary).lineLimit(1)
      }
      .font(.caption2)
    }.accessibilityElement(children: .ignore)
      .accessibilityLabel(legs.map { "\($0.index + 1). \(NoLateGuidanceRouteLayoutPolicy.label($0))" }.joined(separator: " → ")
        + ". \(layout.caption). 전체 여정 완료율이 아닙니다."
        + (position == nil ? " 현재 위치 확인 필요" : content.phase == "TRANSFER_WALK" ? " 현재 위치: 환승 도보 구간" : content.phase == "FINAL_WALK" ? " 현재 위치: 최종 도보 구간" : content.phase == "RIDING" ? (content.subway == nil ? " 현재 위치: 버스 이동 구간" : " 현재 위치: 지하철 이동 구간") : content.phase == "WAITING" ? " 현재 위치: 승차 정류장" : content.activeLegIndex > 0 ? " 현재 위치: 환승 승차점 도보 구간" : " 현재 위치: 첫 도보 구간"))
      .accessibilityIdentifier("guidance-lock-route-bar")
  }
  private func color(_ leg: NoLateGuidanceRouteLeg) -> Color {
    if ["BUS", "SUBWAY"].contains(leg.kind), let value = NoLateGuidanceRouteLayoutPolicy.safeColor(leg.lineColor) { return Color(hex: value) }
    switch leg.kind {
    case "BUS": return Color(hex: "2F963B")
    case "SUBWAY": return Color(hex: "239FD2")
    default: return Color(hex: "78828F")
    }
  }

}

private struct NoLateGuidanceMarkerEntrance: AnimatableModifier {
  var progress: Double

  var animatableData: Double {
    get { progress }
    set { progress = newValue }
  }

  func body(content: Content) -> some View {
    content
      .rotation3DEffect(.degrees(26 * (1 - progress)), axis: (x: 1, y: 0, z: 0), perspective: 0.3)
      .scaleEffect(0.82 + 0.18 * progress)
      .offset(y: -7 * (1 - progress))
      .opacity(0.2 + 0.8 * progress)
  }
}
