import ActivityKit
import SwiftUI
import WidgetKit

struct NoLateDepartureLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: NoLateDepartureAttributes.self) { context in
      NoLateLockScreenView(context: context)
        .widgetURL(context.attributes.scheduleURL)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 7) {
            HStack(spacing: 9) {
              NoLateMarkView(size: 34)
              VStack(alignment: .leading, spacing: 1) {
                Text("\(context.attributes.destinationName) · \(context.attributes.formattedStartTime)")
                  .font(.system(size: 13, weight: .semibold))
                  .foregroundStyle(Color.white.opacity(0.72))
                  .lineLimit(1)
                NoLateDepartureHeadlineView(
                  state: context.state,
                  font: .system(size: 16, weight: .bold, design: .rounded),
                  foregroundColor: .white
                )
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              VStack(alignment: .trailing, spacing: 0) {
                Text("\(context.state.displayedTravelMinutes)분")
                  .font(.system(size: 22, weight: .heavy, design: .rounded))
                  .foregroundStyle(Color(hex: NoLateLiveActivityThemeTokens.dark.accent))
                  .monospacedDigit()
                Text(context.state.arrivalText)
                  .font(.system(size: 10, weight: .medium))
                  .foregroundStyle(Color.white.opacity(0.62))
                  .lineLimit(1)
              }
            }

            NoLateRouteBarView(
              segments: context.state.routeSegments,
              usesDarkSurface: true
            )
              .frame(height: 18)

            NoLateActivityActionsView(
              attributes: context.attributes,
              state: context.state,
              compact: true,
              theme: .dark
            )
          }
          .padding(.horizontal, 12)
          .padding(.top, 4)
          .padding(.bottom, 7)
        }
      } compactLeading: {
        NoLateMarkView(size: 24)
      } compactTrailing: {
        NoLateCompactStatusView(state: context.state)
      } minimal: {
        NoLateMarkView(size: 22)
      }
      .widgetURL(context.attributes.scheduleURL)
      .keylineTint(Color(hex: NoLateLiveActivityThemeTokens.dark.accent))
    }
  }
}

private struct NoLateCompactStatusView: View {
  let state: NoLateDepartureContentState

  var body: some View {
    HStack(spacing: 4) {
      if state.status == .preparing,
         Date(timeIntervalSince1970: TimeInterval(state.recommendedDepartureEpochSeconds)) > .now {
        NoLateDepartureCountdownValueView(state: state)
      } else {
        Text(NoLateLiveActivityPresentation.compactLabel(
          status: state.status,
          recommendedDepartureEpochSeconds: state.recommendedDepartureEpochSeconds,
          nowEpochSeconds: Int64(Date().timeIntervalSince1970.rounded())
        ))
      }
      Circle()
        .fill(Color(hex: NoLateLiveActivityThemeTokens.dark.accent))
        .frame(width: 6, height: 6)
        .accessibilityHidden(true)
    }
    .font(.caption.weight(.bold))
    .foregroundStyle(.white)
    .monospacedDigit()
    .lineLimit(1)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(NoLateLiveActivityPresentation.headline(
      status: state.status,
      recommendedDepartureEpochSeconds: state.recommendedDepartureEpochSeconds,
      nowEpochSeconds: Int64(Date().timeIntervalSince1970.rounded())
    ))
  }
}

private struct NoLateDepartureCountdownValueView: View {
  let state: NoLateDepartureContentState

  @ViewBuilder
  var body: some View {
    let now = Date()
    let departure = Date(
      timeIntervalSince1970: TimeInterval(state.recommendedDepartureEpochSeconds)
    )
    if #available(iOSApplicationExtension 18.0, *), departure > now {
      Text(
        now,
        format: .timer(
          countingDownIn: now..<departure,
          showsHours: false,
          maxFieldCount: 1,
          maxPrecision: .seconds(60)
        )
        .locale(Locale(identifier: "ko_KR"))
      )
    } else {
      Text(NoLateLiveActivityPresentation.compactLabel(
        status: state.status,
        recommendedDepartureEpochSeconds: state.recommendedDepartureEpochSeconds,
        nowEpochSeconds: Int64(now.timeIntervalSince1970.rounded())
      ))
    }
  }
}

private struct NoLateDepartureHeadlineView: View {
  let state: NoLateDepartureContentState
  let font: Font
  let foregroundColor: Color

  var body: some View {
    Group {
      let now = Date()
      let departure = Date(
        timeIntervalSince1970: TimeInterval(state.recommendedDepartureEpochSeconds)
      )
      if state.status == .preparing, departure > now {
        HStack(spacing: 0) {
          Text("출발까지 ")
          NoLateDepartureCountdownValueView(state: state)
          Text(" 남았어요")
        }
      } else {
        Text(NoLateLiveActivityPresentation.headline(
          status: state.status,
          recommendedDepartureEpochSeconds: state.recommendedDepartureEpochSeconds,
          nowEpochSeconds: Int64(now.timeIntervalSince1970.rounded())
        ))
      }
    }
    .font(font)
    .foregroundStyle(foregroundColor)
    .monospacedDigit()
    .lineLimit(1)
    .minimumScaleFactor(0.82)
    .accessibilityElement(children: .combine)
    .accessibilityLabel(NoLateLiveActivityPresentation.headline(
      status: state.status,
      recommendedDepartureEpochSeconds: state.recommendedDepartureEpochSeconds,
      nowEpochSeconds: Int64(Date().timeIntervalSince1970.rounded())
    ))
  }
}

private struct NoLateLockScreenView: View {
  let context: ActivityViewContext<NoLateDepartureAttributes>
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.isLuminanceReduced) private var isLuminanceReduced

  private var palette: NoLateActivityPalette {
    let isDark = context.state.appearance.map { $0 == .dark } ?? (colorScheme == .dark)
    return NoLateActivityPalette(isDark: isDark)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 6) {
        NoLateMarkView(size: CGFloat(NoLateLiveActivityLayoutMetrics.headerHeight))
        HStack(spacing: 3) {
          Text(context.attributes.destinationName)
            .foregroundStyle(palette.primaryText)
            .lineLimit(1)
            .truncationMode(.tail)
            .layoutPriority(1)
          Text("· \(context.attributes.formattedStartTime)")
            .foregroundStyle(palette.secondaryText)
            .monospacedDigit()
            .fixedSize(horizontal: true, vertical: false)
        }
        .font(.system(size: 11, weight: .semibold))
        .lineLimit(1)
        .frame(minWidth: 0)
        .layoutPriority(1)
        Spacer(minLength: 0)
      }
      .frame(height: CGFloat(NoLateLiveActivityLayoutMetrics.headerHeight))

      HStack(alignment: .center, spacing: 8) {
        Text("\(context.state.displayedTravelMinutes)분")
          .font(.system(size: 36, weight: .heavy, design: .rounded))
          .foregroundStyle(palette.accent)
          .monospacedDigit()
          .lineLimit(1)
          .fixedSize(horizontal: true, vertical: false)
          .layoutPriority(2)

        VStack(alignment: .leading, spacing: 1) {
          Text(context.state.arrivalText)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(palette.secondaryText)
            .lineLimit(1)
          NoLateDepartureHeadlineView(
            state: context.state,
            font: .system(size: 11, weight: .bold, design: .rounded),
            foregroundColor: palette.primaryText
          )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
        .frame(
          height: CGFloat(NoLateLiveActivityLayoutMetrics.summaryHeight),
          alignment: .leading
        )
        .padding(.top, CGFloat(NoLateLiveActivityLayoutMetrics.summaryTopSpacing))

      NoLateRouteBarView(
        segments: context.state.routeSegments,
        themeOverride: palette.tokens
      )
        .frame(height: CGFloat(NoLateLiveActivityLayoutMetrics.routeHeight))
        .padding(.top, CGFloat(NoLateLiveActivityLayoutMetrics.routeTopSpacing))

      NoLateActivityActionsView(
        attributes: context.attributes,
        state: context.state,
        compact: false,
        theme: palette.tokens
      )
      .padding(.top, CGFloat(NoLateLiveActivityLayoutMetrics.actionsTopSpacing))
    }
    .padding(
      .horizontal,
      CGFloat(NoLateLiveActivityLayoutMetrics.horizontalPadding)
    )
    .padding(
      .vertical,
      CGFloat(NoLateLiveActivityLayoutMetrics.verticalPadding)
    )
    .frame(
      minWidth: 0,
      maxWidth: .infinity,
      minHeight: CGFloat(NoLateLiveActivityLayoutMetrics.maximumLockScreenHeight),
      maxHeight: CGFloat(NoLateLiveActivityLayoutMetrics.maximumLockScreenHeight),
      alignment: .topLeading
    )
    .background(
      NoLateCardBackground(
        palette: palette,
        isLuminanceReduced: isLuminanceReduced
      )
    )
    .clipShape(RoundedRectangle(
      cornerRadius: CGFloat(NoLateLiveActivityLayoutMetrics.cardCornerRadius),
      style: .continuous
    ))
    .activityBackgroundTint(.clear)
    .activitySystemActionForegroundColor(palette.primaryText)
  }
}

private struct NoLateCardBackground: View {
  let palette: NoLateActivityPalette
  let isLuminanceReduced: Bool

  var body: some View {
    ZStack {
      LinearGradient(
        colors: [
          palette.surfaceStart,
          palette.surfaceMiddle,
          palette.surfaceEnd
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      if !isLuminanceReduced {
        RadialGradient(
          colors: [Color.white.opacity(palette.isDark ? 0.08 : 0.42), Color.clear],
          center: .topTrailing,
          startRadius: 0,
          endRadius: 140
        )
        RadialGradient(
          colors: [palette.accent.opacity(palette.isDark ? 0.20 : 0.25), Color.clear],
          center: .bottomLeading,
          startRadius: 0,
          endRadius: 150
        )
      }
    }
  }
}

private struct NoLateActivityPalette {
  let tokens: NoLateLiveActivityThemeTokens
  let isDark: Bool

  init(isDark: Bool) {
    self.isDark = isDark
    tokens = NoLateLiveActivityThemeTokens.resolved(systemDark: isDark)
  }

  var hostTint: Color { Color(hex: tokens.hostTint) }
  var surfaceStart: Color { Color(hex: tokens.surfaceStart) }
  var surfaceMiddle: Color { Color(hex: tokens.surfaceMiddle) }
  var surfaceEnd: Color { Color(hex: tokens.surfaceEnd) }
  var primaryText: Color { Color(hex: tokens.primaryText) }
  var secondaryText: Color { Color(hex: tokens.secondaryText) }
  var accent: Color { Color(hex: tokens.accent) }
}

private struct NoLateActivityActionsView: View {
  let attributes: NoLateDepartureAttributes
  let state: NoLateDepartureContentState
  let compact: Bool
  let theme: NoLateLiveActivityThemeTokens

  var body: some View {
    Group {
      if compact {
        HStack(spacing: 8) {
          scheduleAction
          departureAction
        }
      } else {
        HStack(spacing: 0) {
          scheduleAction
            .frame(width: CGFloat(NoLateLiveActivityLayoutMetrics.actionWidth))
          Spacer(minLength: 16)
          departureAction
            .frame(width: CGFloat(NoLateLiveActivityLayoutMetrics.actionWidth))
        }
      }
    }
    .frame(maxWidth: .infinity)
    // The approved card scales the visible actions to 26 pt. The links keep a
    // 44 pt interactive child that overflows this unclipped visual row, so the
    // proportional layout does not sacrifice the system-sized hit target.
    .frame(height: visualHeight)
  }

  private var scheduleAction: some View {
    Link(destination: attributes.scheduleURL) {
      Text("일정 확인")
        .font(.system(size: compact ? 13 : 11, weight: .bold))
        .foregroundStyle(Color(hex: theme.accent))
        .frame(maxWidth: .infinity)
        .frame(height: visualHeight)
        .background(
          Color(hex: theme.surfaceStart).opacity(compact ? 0.34 : 0.54),
          in: Capsule()
        )
        .overlay(
          Capsule()
            .stroke(Color(hex: theme.accent), lineWidth: 1.25)
        )
    }
    .buttonStyle(.plain)
    .frame(maxWidth: .infinity)
    .frame(height: hitHeight)
    .contentShape(Capsule())
  }

  private var departureAction: some View {
    NoLateDepartureActionView(
      attributes: attributes,
      state: state,
      compact: compact,
      theme: theme
    )
  }

  private var visualHeight: CGFloat {
    compact ? 34 : CGFloat(NoLateLiveActivityLayoutMetrics.actionVisualHeight)
  }

  private var hitHeight: CGFloat {
    compact ? 34 : CGFloat(NoLateLiveActivityLayoutMetrics.actionHitHeight)
  }
}

private struct NoLateDepartureActionView: View {
  let attributes: NoLateDepartureAttributes
  let state: NoLateDepartureContentState
  let compact: Bool
  let theme: NoLateLiveActivityThemeTokens

  var body: some View {
    let now = Int64(Date().timeIntervalSince1970.rounded())
    let actionAvailable = NoLateLiveActivityPolicy.isDepartureActionAvailable(
      status: state.status,
      nowEpochSeconds: now,
      actionExpiresAtEpochSeconds: state.actionExpiresAtEpochSeconds
    )
    if #available(iOSApplicationExtension 17.0, *), actionAvailable {
      Button(intent: NoLateDepartureLiveActivityIntent(attributes: attributes)) {
        departureLabel
      }
      .buttonStyle(.plain)
      .frame(maxWidth: .infinity)
      .frame(height: hitHeight)
      .contentShape(Capsule())
    } else {
      Link(destination: attributes.scheduleURL) {
        departureLabel
      }
      .buttonStyle(.plain)
      .frame(maxWidth: .infinity)
      .frame(height: hitHeight)
      .contentShape(Capsule())
    }
  }

  private var departureLabel: some View {
    Text("출발 완료")
      .font(.system(size: compact ? 13 : 11, weight: .bold))
      .foregroundStyle(.white)
      .frame(maxWidth: .infinity)
      .frame(height: visualHeight)
      .background(
        LinearGradient(
          colors: [
            Color(hex: theme.callToActionStart),
            Color(hex: theme.callToActionEnd)
          ],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        ),
        in: Capsule()
      )
  }

  private var visualHeight: CGFloat {
    compact ? 34 : CGFloat(NoLateLiveActivityLayoutMetrics.actionVisualHeight)
  }

  private var hitHeight: CGFloat {
    compact ? 34 : CGFloat(NoLateLiveActivityLayoutMetrics.actionHitHeight)
  }
}

private extension NoLateDepartureAttributes {
  var formattedStartTime: String {
    guard let date = NoLateLiveActivityPolicy.iso8601Date(scheduleStartAt) else {
      return "시간 미정"
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.dateFormat = "a h:mm"
    return formatter.string(from: date)
  }
}

private extension NoLateDepartureContentState {
  var arrivalText: String {
    guard let predictedArrivalEpochSeconds else {
      return "도착 시각 계산 중"
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.dateFormat = "a h:mm 도착"
    return formatter.string(
      from: Date(timeIntervalSince1970: TimeInterval(predictedArrivalEpochSeconds))
    )
  }
}
