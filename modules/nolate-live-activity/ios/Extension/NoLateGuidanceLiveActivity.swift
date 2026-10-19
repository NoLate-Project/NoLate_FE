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
        .widgetURL(URL(string: "nolate:///internal/journey-guidance?showDetail=1"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) {
          NoLateGuidanceCard(legs: context.attributes.routeLegs, content: context.state, isStale: context.isStale)
        }
      } compactLeading: {
        Image(systemName: NoLateGuidancePresentationPolicy.presentation(context.state,
          legs: context.attributes.routeLegs, now: Date().timeIntervalSince1970, isStale: context.isStale).symbol)
          .foregroundStyle(.blue)
      } compactTrailing: {
        Text(NoLateGuidancePresentationPolicy.presentation(context.state,
          legs: context.attributes.routeLegs, now: Date().timeIntervalSince1970, isStale: context.isStale).compact)
          .font(.caption2).lineLimit(1).minimumScaleFactor(0.7)
      } minimal: { Image(systemName: "location.fill").foregroundStyle(.blue) }
      .widgetURL(URL(string: "nolate:///internal/journey-guidance?showDetail=1"))
    }
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
      HStack(spacing: 10) {
        Image(systemName: presentation.symbol).font(.system(size: 19, weight: .semibold))
          .foregroundStyle(.blue).frame(width: 38, height: 38)
          .background(Color.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        VStack(alignment: .leading, spacing: 3) {
          Text(presentation.title).font(.headline)
            .accessibilityLabel(presentation.title)
            .lineLimit(1).minimumScaleFactor(0.8).accessibilityIdentifier("guidance-lock-instruction")
          Text(presentation.action).font(.subheadline).foregroundStyle(.secondary)
            .accessibilityLabel(presentation.action)
            .lineLimit(1).minimumScaleFactor(0.8)
        }
        Spacer(minLength: 0)
      }
      NoLateGuidanceRouteBar(legs: legs, content: content, isStale: isStale)
      HStack(spacing: 5) {
        if let arrival {
          Image(systemName: "bus.fill").foregroundStyle(.green)
          Text("버스 도착까지").foregroundStyle(.secondary)
          Text(Date(timeIntervalSince1970: arrival.expectedAt), style: .timer)
            .fontWeight(.semibold).monospacedDigit()
          Spacer(minLength: 4)
          Text(arrival.directionLabel).foregroundStyle(.secondary).lineLimit(1)
        } else {
          Text(presentation.symbol == "location.slash" ? "위치 정보 업데이트 필요" : "NoLate · 대중교통 안내")
            .foregroundStyle(.secondary)
          Spacer(minLength: 0)
        }
      }.font(.caption).lineLimit(1).minimumScaleFactor(0.8)
    }.dynamicTypeSize(...DynamicTypeSize.xxxLarge)
  }
}

/// Provider labels/colours with planned proportions. Progress still comes from fresh GPS only.
private struct NoLateGuidanceRouteBar: View {
  let legs: [NoLateGuidanceRouteLeg]
  let content: NoLateGuidanceContent
  let isStale: Bool

  var body: some View {
    let position = NoLateGuidanceRoutePositionPolicy.position(content, legs: legs,
      now: Date().timeIntervalSince1970, isStale: isStale)
    let displayLegs = NoLateGuidanceRouteLayoutPolicy.validTopology(legs) ? legs : []
    let layout = NoLateGuidanceRouteLayoutPolicy.layout(displayLegs)
    VStack(alignment: .leading, spacing: 3) {
    GeometryReader { proxy in
      let width = max(0, proxy.size.width - 32)
      ZStack(alignment: .topLeading) {
        HStack(spacing: 0) {
          ForEach(displayLegs, id: \.index) { leg in
            color(leg).frame(width: width * layout.fractions[leg.index])
          }
        }.frame(width: width, height: 10).clipShape(Capsule())
          .overlay(Capsule().stroke(Color.primary.opacity(0.5), lineWidth: 1)).offset(x: 16, y: 13)
        if displayLegs.count <= 8 {
          ForEach(displayLegs, id: \.index) { leg in
            Image(systemName: symbol(leg.kind)).font(.system(size: 11, weight: .semibold))
              .foregroundStyle(NoLateGuidanceRouteLayoutPolicy.darkIconInk(leg.lineColor ?? fallbackHex(leg.kind)) ? .black : .white).frame(width: 24, height: 24)
              .background(color(leg), in: Circle())
              .overlay(Circle().stroke(Color.primary.opacity(0.25), lineWidth: 1))
              .offset(x: 4 + width * layout.start(leg.index), y: 6)
              .accessibilityLabel(NoLateGuidanceRouteLayoutPolicy.label(leg))
          }
        }
        if let position {
          Image(systemName: "location.north.fill").rotationEffect(.degrees(90))
            .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
            .frame(width: 32, height: 32).background(.blue, in: Circle())
            .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 3))
            .shadow(color: .blue.opacity(0.22), radius: 3, y: 1)
            .offset(x: width * position.barFraction, y: 2)
            .accessibilityLabel(content.phase == "RIDING" ? (content.subway == nil ? "현재 위치: 버스 이동 구간" : "현재 위치: 지하철 이동 구간") : content.phase == "WAITING" ? "현재 위치: 승차 정류장" : "현재 위치: 도보 구간")
            .accessibilityIdentifier("guidance-lock-route-position")
        }
      }
    }.frame(height: 36)
    HStack(spacing: 6) {
      // Compact visual list; accessibility below preserves every original leg, including repeats.
      Text(legs.filter { ["BUS", "SUBWAY"].contains($0.kind) }.prefix(2)
        .map { NoLateGuidanceRouteLayoutPolicy.label($0) }.joined(separator: " → "))
        .font(.caption2).lineLimit(1).minimumScaleFactor(0.8)
      Spacer(minLength: 0)
      Text(layout.caption).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
    }
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
  private func symbol(_ kind: String) -> String {
    switch kind { case "WALK": return "figure.walk"; case "BUS": return "bus.fill"; case "SUBWAY": return "tram.fill"; default: return "ellipsis" }
  }
  private func fallbackHex(_ kind: String) -> String {
    kind == "BUS" ? "2F963B" : kind == "SUBWAY" ? "239FD2" : "78828F"
  }
  private func label(_ kind: String) -> String {
    switch kind { case "WALK": return "도보"; case "BUS": return "버스"; case "SUBWAY": return "지하철"; default: return "기타 이동" }
  }
}
