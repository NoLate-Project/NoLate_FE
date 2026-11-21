import ActivityKit
import SwiftUI
import WidgetKit

private let guidanceSecondaryInk = Color(hex: "AAB8CB")

struct NoLateGuidanceLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: NoLateGuidanceAttributes.self) { context in
      NoLateGuidanceCard(legs: context.attributes.routeLegs, content: context.state, isStale: context.isStale)
        .padding(.horizontal, 18).padding(.vertical, 14)
        .activityBackgroundTint(Color(hex: "111925"))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(scheduleURL(context.state))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) {
          NoLateGuidanceCard(legs: context.attributes.routeLegs, content: context.state, isStale: context.isStale, compact: true)
            .padding(.horizontal, 8)
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
    guard UUID(uuidString: content.sessionId) != nil, content.sessionId.utf8.count == 36 else {
      return URL(string: "nolate://schedule/\(id)")
    }
    return URL(string: "nolate://schedule/\(id)?entrySource=guidance-activity&guidanceSession=\(content.sessionId)")
  }
}

private struct NoLateGuidanceCard: View {
  let legs: [NoLateGuidanceRouteLeg]
  let content: NoLateGuidanceContent
  let isStale: Bool
  var compact = false

  var body: some View {
    let now = Date().timeIntervalSince1970
    let presentation = NoLateGuidancePresentationPolicy.presentation(content, legs: legs, now: now, isStale: isStale)
    let arrival = NoLateGuidancePresentationPolicy.freshArrival(content, legs: legs, now: now, isStale: isStale)
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        NoLateActivityIcons.guidance(presentation.symbol, size: 19)
          .foregroundStyle(Color(hex: "A3C9FF")).frame(width: 34, height: 34)
          .background(Color(hex: "203653"), in: RoundedRectangle(cornerRadius: 9))
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 3) {
          Text(presentation.title).font(.headline)
            .accessibilityLabel(presentation.title)
            .lineLimit(1).minimumScaleFactor(0.8).accessibilityIdentifier("guidance-lock-instruction")
          Text(presentation.action).font(.subheadline).foregroundStyle(guidanceSecondaryInk)
            .accessibilityLabel(presentation.action)
            .lineLimit(1).minimumScaleFactor(0.8)
        }
        Spacer(minLength: 0)
        NoLateActivityIcons.image(62015, size: 13)
          .foregroundStyle(guidanceSecondaryInk).accessibilityHidden(true)
      }
      if (content.status == "ARMED" || content.status == "ACTIVE"),
         NoLateGuidanceRouteLayoutPolicy.validTopology(legs) {
        NoLateGuidanceRouteBar(legs: legs, content: content, isStale: isStale, compact: compact)
      }
      if let arrival {
        HStack(spacing: 5) {
          NoLateActivityIcons.guidance(arrival.kind == "SUBWAY" ? "tram.fill" : "bus.fill", size: 12).foregroundStyle(.green)
          Text(arrival.kind == "SUBWAY" ? "열차 도착까지" : "버스 도착까지").foregroundStyle(guidanceSecondaryInk)
          Text(Date(timeIntervalSince1970: arrival.expectedAt), style: .timer)
            .fontWeight(.semibold).monospacedDigit()
          Spacer(minLength: 4)
          Text(arrival.directionLabel).foregroundStyle(guidanceSecondaryInk).lineLimit(1)
        }.font(.caption).lineLimit(1).minimumScaleFactor(0.8)
      }
    }
    .foregroundStyle(.white)
    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
  }
}

/// Provider labels/colours with planned proportions. Progress still comes from fresh GPS only.
private struct NoLateGuidanceRouteBar: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.isLuminanceReduced) private var isLuminanceReduced
  let legs: [NoLateGuidanceRouteLeg]
  let content: NoLateGuidanceContent
  let isStale: Bool
  let compact: Bool

  var body: some View {
    let motion = reduceMotion || isLuminanceReduced
      ? nil : Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.24)
    let now = Date().timeIntervalSince1970
    let position = NoLateGuidanceRoutePositionPolicy.position(content, legs: legs,
      now: now, isStale: isStale)
    let layout = NoLateGuidanceRouteLayoutPolicy.layout(legs)
    let activeRideIndex = position != nil && ["WAITING", "RIDING", "RIDING_SEGMENT"].contains(content.phase)
      ? content.activeLegIndex : nil
    VStack(alignment: .leading, spacing: 3) {
      GeometryReader { proxy in
        let width = max(0, proxy.size.width - 22)
        ZStack(alignment: .topLeading) {
          HStack(spacing: 0) {
            ForEach(legs, id: \.index) { leg in
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
        let rides = legs.filter { ["BUS", "SUBWAY"].contains($0.kind) }
        let legend = NoLateGuidanceRouteLayoutPolicy.visibleRideLegend(rides, activeLegIndex: activeRideIndex)
        ForEach(legend, id: \.index) { leg in
          HStack(spacing: 3) {
            Circle().fill(color(leg)).frame(width: 5, height: 5)
            Text(NoLateGuidanceRouteLayoutPolicy.legendLabel(leg)).lineLimit(1)
              .minimumScaleFactor(0.85)
          }
          .layoutPriority(leg.index == activeRideIndex ? 1 : 0)
        }
        if rides.count > legend.count {
          Text("+\(rides.count - legend.count)").foregroundStyle(guidanceSecondaryInk)
        }
        Spacer(minLength: 0)
        Text(layout.basis == "TIME" ? (compact ? "예정 시간" : "구간별 예정 시간") : layout.caption)
          .foregroundStyle(guidanceSecondaryInk).lineLimit(1).truncationMode(.tail)
          .layoutPriority(-1)
      }
      .font(.caption2)
    }.accessibilityElement(children: .ignore)
      .accessibilityLabel(legs.map { "\($0.index + 1). \(NoLateGuidanceRouteLayoutPolicy.legendLabel($0))" }.joined(separator: " → ")
        + ". \(layout.caption). 전체 여정 완료율이 아닙니다."
        + positionDescription(hasPosition: position != nil, now: now))
      .accessibilityIdentifier("guidance-lock-route-bar")
  }

  private func positionDescription(hasPosition: Bool, now: Double) -> String {
    guard hasPosition else {
      return !isStale && NoLateGuidancePresentationPolicy.isPrepared(content, legs: legs, now: now)
        ? " 출발 대기" : " 현재 위치 확인 필요"
    }
    switch content.phase {
    case "TRANSFER_WALK": return " 현재 위치: 환승 도보 구간"
    case "FINAL_WALK": return " 현재 위치: 최종 도보 구간"
    case "RIDING": return content.subway == nil ? " 현재 위치: 버스 이동 구간" : " 현재 위치: 지하철 이동 구간"
    case "RIDING_SEGMENT": return " 현재 위치: 지하철 역 사이"
    case "WAITING": return " 현재 위치: 승차 정류장"
    default: return content.activeLegIndex > 0 ? " 현재 위치: 환승 승차점 도보 구간" : " 현재 위치: 첫 도보 구간"
    }
  }
  private func color(_ leg: NoLateGuidanceRouteLeg) -> Color {
    Color(hex: NoLateGuidanceRouteLayoutPolicy.routeColor(leg))
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

private func drivingIcon(_ turn: NoLateDrivingContent.Turn?, size: CGFloat, status: String) -> Image {
  let code: UInt32
  switch turn?.type {
  case "11": code = 61769 // arrow-up-outline
  case "12": code = 62783 // return-up-back-outline
  case "13": code = 62786 // return-up-forward-outline
  case "14": code = 62777 // return-down-back-outline
  case "117": code = 61751 // arrow-forward-outline
  case "118": code = 61739 // arrow-back-outline
  case "201": code = 62225 // flag-outline
  default: code = status == "GUIDING" ? 62576 : 62402 // navigate-outline, locate-outline
  }
  return NoLateActivityIcons.image(code, size: size)
}

@available(iOSApplicationExtension 16.2, *)
struct NoLateDrivingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: NoLateDrivingAttributes.self) { context in
      let content = context.state.visible(now: Date(), isStale: context.isStale)
      NoLateDrivingCard(content: content, destination: context.attributes.destination)
        .activityBackgroundTint(Color(hex: "121D30"))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(scheduleURL(context.attributes))
    } dynamicIsland: { context in
      let content = context.state.visible(now: Date(), isStale: context.isStale)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) {
          NoLateDrivingCard(content: content, destination: context.attributes.destination, compact: true)
        }
      } compactLeading: {
        drivingIcon(content.next, size: 17, status: content.status)
          .foregroundStyle(Color(hex: "98C4FF")).accessibilityLabel(content.statusText)
      } compactTrailing: {
        Text(content.next.map { NoLateDrivingContent.distance($0.meters) } ?? (content.status == "GUIDING" ? "주행" : "위치 확인"))
          .font(.caption2.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.75)
      } minimal: {
        drivingIcon(content.next, size: 18, status: content.status)
          .foregroundStyle(Color(hex: "98C4FF")).accessibilityLabel(content.statusText)
      }
      .widgetURL(scheduleURL(context.attributes))
    }
  }

  private func scheduleURL(_ attributes: NoLateDrivingAttributes) -> URL? {
    URL(string: attributes.scheduleId.isEmpty ? "nolate://schedule" : "nolate://schedule/\(attributes.scheduleId)")
  }
}

private struct NoLateDrivingCard: View {
  let content: NoLateDrivingContent
  let destination: String
  var compact = false

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        drivingIcon(content.next, size: compact ? 27 : 36, status: content.status)
          .foregroundStyle(.white).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          if let next = content.next {
            HStack(alignment: .firstTextBaseline, spacing: 9) {
              Text(NoLateDrivingContent.distance(next.meters))
                .font(.system(size: compact ? 22 : 28, weight: .bold)).monospacedDigit()
                .accessibilityIdentifier("driving-lock-distance")
              Text(next.title).font(.headline)
                .accessibilityIdentifier("driving-lock-instruction")
            }
            if !next.road.isEmpty {
              Text(next.road).font(.subheadline).foregroundStyle(.white.opacity(0.9)).privacySensitive()
            }
          } else {
            Text(content.statusText).font(.headline).accessibilityIdentifier("driving-lock-instruction")
          }
        }
        Spacer(minLength: 0)
      }
      .lineLimit(1).minimumScaleFactor(0.8)
      .padding(.horizontal, compact ? 8 : 17).padding(.vertical, compact ? 5 : 10)
      .background(content.status == "GUIDING" ? Color(hex: "1158B4") : Color(hex: "27384E"))

      if let following = content.following {
        HStack(spacing: 7) {
          drivingIcon(following, size: 15, status: content.status).accessibilityHidden(true)
          Text("이어서 \(NoLateDrivingContent.distance(following.meters)) 뒤 \(following.title)")
            .font(.caption.weight(.semibold)).lineLimit(1).accessibilityIdentifier("driving-lock-following")
          Spacer(minLength: 0)
        }
        .foregroundStyle(Color(hex: "E2EDFF"))
        .padding(.horizontal, compact ? 8 : 17).padding(.vertical, 4).background(Color(hex: "164482"))
      }

      HStack(spacing: 7) {
        Text(destination.isEmpty ? "목적지" : destination)
          .foregroundStyle(Color(hex: "CAD6E6")).lineLimit(1).privacySensitive()
          .accessibilityIdentifier("driving-lock-destination")
        Spacer(minLength: 2)
        if let remaining = content.remainingMeters {
          HStack(spacing: 5) {
            if let seconds = content.remainingSeconds, let expiry = content.staleDate {
              Text(expiry.addingTimeInterval(TimeInterval(seconds) - 12), style: .time)
              Text("도착 · \(max(1, Int(ceil(Double(seconds) / 60))))분")
            }
            Text(NoLateDrivingContent.distance(remaining))
          }
          .fontWeight(.semibold).monospacedDigit().lineLimit(1).minimumScaleFactor(0.75)
          .accessibilityElement(children: .combine).accessibilityIdentifier("driving-lock-summary")
        }
      }
      .font(.caption).padding(.horizontal, compact ? 8 : 17).padding(.vertical, compact ? 5 : 9)
    }
    .foregroundStyle(.white)
    .accessibilityElement(children: .contain).accessibilityIdentifier("driving-lock-card")
  }
}
