import SwiftUI
import WidgetKit

private let noLateAccent = Color(uiColor: .systemBlue)

struct NoLateWidgetEntry: TimelineEntry {
  let date: Date
  let snapshot: NoLateWidgetSnapshot?
  let isPlaceholder: Bool

  var schedules: [NoLateWidgetSchedule] {
    NoLateWidgetSnapshotStore.visibleSchedules(from: snapshot, at: date)
  }
}

struct NoLateWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> NoLateWidgetEntry {
    NoLateWidgetEntry(date: Date(), snapshot: .placeholder, isPlaceholder: true)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (NoLateWidgetEntry) -> Void
  ) {
    let snapshot = context.isPreview
      ? NoLateWidgetSnapshot.placeholder
      : NoLateWidgetSnapshotStore.load()
    completion(
      NoLateWidgetEntry(
        date: Date(),
        snapshot: snapshot,
        isPlaceholder: false
      )
    )
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<NoLateWidgetEntry>) -> Void
  ) {
    let now = Date()
    let snapshot = NoLateWidgetSnapshotStore.load()
    let schedules = NoLateWidgetSnapshotStore.visibleSchedules(from: snapshot, at: now)
    let entries = timelineDates(for: schedules, after: now).map { date in
      NoLateWidgetEntry(date: date, snapshot: snapshot, isPlaceholder: false)
    }
    let refreshDate = now.addingTimeInterval(schedules.isEmpty ? 30 * 60 : 2 * 60 * 60)
    completion(Timeline(entries: entries, policy: .after(refreshDate)))
  }

  private func timelineDates(
    for schedules: [NoLateWidgetSchedule],
    after now: Date
  ) -> [Date] {
    let horizon = now.addingTimeInterval(2 * 60 * 60)
    var timestamps = Set<Int>([Int(now.timeIntervalSince1970)])

    func include(_ date: Date?) {
      guard let date, date > now, date <= horizon else { return }
      // Never render a transition just before its boundary when dates include fractions.
      timestamps.insert(Int(ceil(date.timeIntervalSince1970)))
    }

    for schedule in schedules {
      include(schedule.startDate)
      include(schedule.effectiveEndDate()?.addingTimeInterval(1))
      guard !schedule.departureCompleted,
            let departureDate = schedule.departureDate,
            departureDate > now else { continue }
      include(departureDate)
    }

    // Date labels and all-day selection also change at midnight.
    include(Calendar.current.date(byAdding: .day, value: 1,
                                  to: Calendar.current.startOfDay(for: now)))

    return timestamps
      .sorted()
      .map { Date(timeIntervalSince1970: TimeInterval($0)) }
  }
}

struct NoLateScheduleWidget: Widget {
  var body: some WidgetConfiguration {
    configuration.contentMarginsDisabled()
  }

  private var configuration: some WidgetConfiguration {
    StaticConfiguration(
      kind: NoLateWidgetConstants.widgetKind,
      provider: NoLateWidgetProvider()
    ) { entry in
      NoLateWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("다음 일정과 출발")
    .description("홈 화면과 잠금화면에서 다음 일정과 출발 시각을 확인해요.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .systemLarge,
      .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}

private extension NoLateWidgetEntry {
  var featured: NoLateWidgetSchedule? {
    NoLateWidgetPresentation.featured(in: schedules, at: date)
  }

  var remaining: [NoLateWidgetSchedule] {
    schedules.filter { $0.id != featured?.id }
  }

  var destination: URL? { featured?.deepLink ?? URL(string: "nolate://") }
}

private struct NoLateWidgetEntryView: View {
  @Environment(\.widgetFamily) private var family
  let entry: NoLateWidgetEntry

  private var isAccessory: Bool {
    switch family {
    case .accessoryCircular, .accessoryRectangular, .accessoryInline: return true
    default: return false
    }
  }

  var body: some View {
    Group {
      switch family {
      case .accessoryInline: NoLateInlineWidget(entry: entry)
      case .accessoryCircular: NoLateCircularWidget(entry: entry)
      case .accessoryRectangular: NoLateRectangularWidget(entry: entry)
      case .systemSmall: NoLateSmallWidget(entry: entry)
      case .systemLarge: NoLateLargeWidget(entry: entry)
      default: NoLateMediumWidget(entry: entry)
      }
    }
    .redacted(reason: entry.isPlaceholder ? .placeholder : [])
    .modifier(NoLateWidgetBackgroundModifier(isAccessory: isAccessory))
  }
}

// MARK: - Home Screen

private struct NoLateWidgetHeader: View {
  let date: Date
  var compact = false

  var body: some View {
    HStack(spacing: 5) {
      Image("NoLateMark")
        .resizable()
        .frame(width: 15, height: 15)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .accessibilityHidden(true)
      Text("NoLate")
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(.secondary)
      Spacer(minLength: 4)
      Text(NoLateWidgetFormatting.headerDate(date, compact: compact))
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}

private struct NoLateSmallWidget: View {
  let entry: NoLateWidgetEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      NoLateWidgetHeader(date: entry.date, compact: true)
      if let schedule = entry.featured {
        NoLateFeaturedSchedule(schedule: schedule, now: entry.date, compact: true)
      } else {
        NoLateEmptyState(hasSnapshot: entry.snapshot != nil, compact: true)
      }
    }
    .padding(16)
    .widgetURL(entry.destination)
  }
}

private struct NoLateMediumWidget: View {
  let entry: NoLateWidgetEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      NoLateWidgetHeader(date: entry.date)
      if let schedule = entry.featured {
        HStack(alignment: .top, spacing: 18) {
          NoLateScheduleLink(schedule: schedule) {
            NoLateFeaturedSchedule(schedule: schedule, now: entry.date, compact: true)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          if !entry.remaining.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
              ForEach(entry.remaining.prefix(2)) { item in
                NoLateAgendaRow(schedule: item, now: entry.date, compact: true)
              }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          }
        }
      } else {
        NoLateEmptyState(hasSnapshot: entry.snapshot != nil)
      }
    }
    .padding(16)
    .widgetURL(entry.destination)
  }
}

private struct NoLateLargeWidget: View {
  let entry: NoLateWidgetEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      NoLateWidgetHeader(date: entry.date)
      if let schedule = entry.featured {
        NoLateScheduleLink(schedule: schedule) {
          NoLateFeaturedSchedule(schedule: schedule, now: entry.date, compact: false)
        }
        if !entry.remaining.isEmpty {
          Rectangle().fill(.primary.opacity(0.07)).frame(height: 0.5)
          VStack(alignment: .leading, spacing: 16) {
            ForEach(entry.remaining.prefix(3)) { item in
              NoLateAgendaRow(schedule: item, now: entry.date)
            }
          }
        }
        Spacer(minLength: 0)
      } else {
        NoLateEmptyState(hasSnapshot: entry.snapshot != nil)
      }
    }
    .padding(20)
    .widgetURL(entry.destination)
  }
}

/// The event stays the focus; a single blue label carries the departure information.
private struct NoLateFeaturedSchedule: View {
  let schedule: NoLateWidgetSchedule
  let now: Date
  let compact: Bool

  private var timing: NoLateWidgetPresentation.Timing {
    NoLateWidgetPresentation.timing(for: schedule, at: now)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: compact ? 6 : 10) {
      Text(schedule.title)
        .font(.system(size: compact ? 18 : 24, weight: .semibold))
        .tracking(-0.4)
        .lineLimit(2)
        .minimumScaleFactor(0.9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .layoutPriority(1)
        .privacySensitive()
      if compact { Spacer(minLength: 0) }
      NoLateDepartureLabel(schedule: schedule, now: now)
      if let detail = NoLateWidgetFormatting.featureDetail(schedule, timing: timing, now: now) {
        Text(detail)
          .font(.system(size: compact ? 10 : 12))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .privacySensitive()
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

private struct NoLateDepartureLabel: View {
  let schedule: NoLateWidgetSchedule
  let now: Date

  private var timing: NoLateWidgetPresentation.Timing {
    NoLateWidgetPresentation.timing(for: schedule, at: now)
  }

  private var isDeparture: Bool {
    switch timing {
    case .departure, .leaveNow: return true
    default: return false
    }
  }

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: NoLateWidgetFormatting.symbol(timing))
        .font(.system(size: 10, weight: .semibold))
        .accessibilityHidden(true)
      Text(NoLateWidgetFormatting.lockHeadline(schedule, now: now))
        .font(.system(size: 13, weight: .semibold))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
    .padding(.horizontal, 9)
    .padding(.vertical, 6)
    .foregroundStyle(isDeparture ? noLateAccent : .secondary)
    .background {
      Capsule().fill(isDeparture ? noLateAccent.opacity(0.09) : Color.primary.opacity(0.045))
    }
    .widgetAccentable()
  }
}

private struct NoLateAgendaRow: View {
  let schedule: NoLateWidgetSchedule
  let now: Date
  var compact = false

  var body: some View {
    NoLateScheduleLink(schedule: schedule) {
      HStack(alignment: .top, spacing: 8) {
        if !compact {
          VStack(alignment: .leading, spacing: 3) {
            Text(schedule.allDay ? "종일" : schedule.startDate.map(NoLateWidgetFormatting.numericTime) ?? "—")
              .font(.system(size: 13, weight: .medium))
              .monospacedDigit()
            if let start = schedule.startDate, !Calendar.current.isDate(start, inSameDayAs: now) {
              Text(NoLateWidgetFormatting.day(start, now: now))
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
            }
          }
          .frame(width: 44, alignment: .leading)
        }
        Capsule()
          .fill(Color(noLateHex: schedule.categoryTintHex))
          .frame(width: 2, height: compact ? 28 : 30)
          .widgetAccentable()
        VStack(alignment: .leading, spacing: 4) {
          Text(schedule.title)
            .font(.system(size: compact ? 12 : 14, weight: .medium))
            .lineLimit(1)
            .privacySensitive()
          if compact {
            Text(NoLateWidgetFormatting.eventDateTime(schedule, relativeTo: now))
              .font(.system(size: 10))
              .foregroundStyle(.secondary)
              .lineLimit(1)
          } else if let location = schedule.displayLocation {
            Text(location)
              .font(.system(size: 11))
              .foregroundStyle(.secondary)
              .lineLimit(1)
              .privacySensitive()
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .accessibilityElement(children: .combine)
    }
  }
}

private struct NoLateScheduleLink<Content: View>: View {
  let schedule: NoLateWidgetSchedule
  @ViewBuilder let content: () -> Content
  var body: some View {
    if let destination = schedule.deepLink {
      Link(destination: destination, label: content).buttonStyle(.plain)
    } else { content() }
  }
}

// MARK: - Lock Screen widgets (independent of Live Activities)

private struct NoLateInlineWidget: View {
  let entry: NoLateWidgetEntry
  var body: some View {
    Group {
      if let schedule = entry.featured {
        let timing = NoLateWidgetPresentation.timing(for: schedule, at: entry.date)
        // Prioritize the title and spell out the time's meaning within the single line.
        Text(timing == .allDay
          ? schedule.title
          : "\(schedule.title) \(NoLateWidgetFormatting.lockHeadline(schedule, now: entry.date))")
          .privacySensitive()
      } else {
        Label(entry.snapshot == nil ? "NoLate를 열어 주세요" : "다가오는 일정 없음", systemImage: "calendar")
      }
    }
    .widgetURL(entry.destination)
  }
}

private struct NoLateRectangularWidget: View {
  let entry: NoLateWidgetEntry
  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      if let schedule = entry.featured {
        Label {
          Text(NoLateWidgetFormatting.lockHeadline(schedule, now: entry.date))
            .monospacedDigit()
        } icon: {
          Image(systemName: NoLateWidgetFormatting.symbol(
            NoLateWidgetPresentation.timing(for: schedule, at: entry.date)))
        }
        .font(.system(size: 12, weight: .medium))
        .widgetAccentable()
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        Text(schedule.title)
          .font(.headline)
          .lineLimit(2)
          .privacySensitive()
      } else {
        Label("NoLate", systemImage: "arrow.turn.up.right")
          .font(.headline)
        Text(entry.snapshot == nil ? "앱에서 일정을 불러오세요" : "다가오는 일정이 없어요")
          .font(.caption)
          .lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .widgetURL(entry.destination)
    .accessibilityElement(children: .combine)
  }
}

private struct NoLateCircularWidget: View {
  let entry: NoLateWidgetEntry
  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 1) {
        if let schedule = entry.featured {
          let timing = NoLateWidgetPresentation.timing(for: schedule, at: entry.date)
          if let date = timing.date, !Calendar.current.isDate(date, inSameDayAs: entry.date) {
            Text(NoLateWidgetFormatting.day(date, now: entry.date))
              .font(.system(size: 9, weight: .medium))
              .lineLimit(1)
              .minimumScaleFactor(0.8)
          } else {
            Image(systemName: NoLateWidgetFormatting.symbol(timing)).font(.caption2)
          }
          if let date = timing.date {
            Text(NoLateWidgetFormatting.numericTime(date))
              .font(.system(size: 17, weight: .semibold, design: .rounded))
              .monospacedDigit()
              .minimumScaleFactor(0.8)
              .lineLimit(1)
            Text(timing == .departure(date) ? "출발" : "시작")
              .font(.system(size: 9, weight: .medium))
          } else {
            Text(NoLateWidgetFormatting.circularLabel(timing))
              .font(.system(size: 12, weight: .semibold))
              .lineLimit(1)
          }
        } else {
          Image(systemName: entry.snapshot == nil ? "arrow.clockwise" : "calendar")
          Text(entry.snapshot == nil ? "앱 열기" : "일정 없음")
            .font(.system(size: 10, weight: .medium))
        }
      }
      .padding(4)
    }
    .widgetURL(entry.destination)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(entry.featured.map {
      NoLateWidgetFormatting.lockHeadline($0, now: entry.date)
    } ?? (entry.snapshot == nil ? "NoLate를 열어 일정을 불러오세요" : "다가오는 일정이 없어요"))
  }
}

private struct NoLateEmptyState: View {
  let hasSnapshot: Bool
  var compact = false
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Spacer(minLength: 0)
      Text(hasSnapshot ? "잠깐, 쉬어가요" : "일정을 불러올까요?")
        .font(.system(size: compact ? 17 : 21, weight: .semibold))
        .lineLimit(2)
      Text(hasSnapshot ? "다가오는 일정이 없어요" : "NoLate를 열면 동기화돼요")
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
        .lineLimit(2)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

private enum NoLateWidgetFormatting {
  static func numericTime(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.dateFormat = "HH:mm"
    return formatter.string(from: date)
  }

  static func day(_ date: Date, now: Date) -> String {
    if Calendar.current.isDate(date, inSameDayAs: now) { return "오늘" }
    if let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now),
       Calendar.current.isDate(date, inSameDayAs: tomorrow) { return "내일" }
    return date.formatted(.dateTime.month().day())
  }

  static func eventDateTime(_ schedule: NoLateWidgetSchedule, relativeTo now: Date) -> String {
    guard let date = schedule.startDate else { return "시간 미정" }
    return "\(day(date, now: now)) · \(schedule.allDay ? "종일" : numericTime(date))"
  }

  static func headerDate(_ date: Date, compact: Bool) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.dateFormat = compact ? "M.d" : "M월 d일 EEEE"
    return formatter.string(from: date)
  }

  static func symbol(_ timing: NoLateWidgetPresentation.Timing) -> String {
    switch timing {
    case .departure, .leaveNow: return "arrow.turn.up.right"
    default: return timing.symbol
    }
  }

  static func featureDetail(
    _ schedule: NoLateWidgetSchedule,
    timing: NoLateWidgetPresentation.Timing,
    now: Date
  ) -> String? {
    switch timing {
    case .departure, .leaveNow, .routeRequired, .departed, .ongoing:
      guard let start = schedule.startDate else { return schedule.displayLocation }
      let prefix = Calendar.current.isDate(start, inSameDayAs: now) ? "" : "\(day(start, now: now)) "
      return "\(prefix)\(numericTime(start)) 시작" + (schedule.displayLocation.map { " · \($0)" } ?? "")
    default:
      return schedule.displayLocation
    }
  }

  static func lockHeadline(_ schedule: NoLateWidgetSchedule, now: Date) -> String {
    let timing = NoLateWidgetPresentation.timing(for: schedule, at: now)
    if let date = timing.date {
      let prefix = Calendar.current.isDate(date, inSameDayAs: now) ? "" : "\(day(date, now: now)) "
      let time = "\(prefix)\(numericTime(date))"
      return "\(time) \(timing == .departure(date) ? "출발" : "시작")"
    }
    if timing == .allDay, let start = schedule.startDate {
      return "\(day(start, now: now)) · 종일"
    }
    return timing == .leaveNow ? "지금 출발" : timing.label
  }

  static func circularLabel(_ timing: NoLateWidgetPresentation.Timing) -> String {
    switch timing {
    case .leaveNow: return "지금 출발"
    case .ongoing: return "진행 중"
    case .allDay: return "종일"
    case .departed: return "출발 완료"
    case .routeRequired: return "경로 설정"
    default: return "예정"
    }
  }
}

private struct NoLateWidgetBackgroundModifier: ViewModifier {
  let isAccessory: Bool
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      content.containerBackground(for: .widget) {
        if !isAccessory { NoLateWidgetBackground() }
      }
    } else if isAccessory { content }
    else { content.background(NoLateWidgetBackground()) }
  }
}

private struct NoLateWidgetBackground: View {
  var body: some View {
    Color(uiColor: .systemBackground)
  }
}

private extension Color {
  init(noLateHex: String) {
    let normalized = noLateHex.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "#", with: "")
    var value: UInt64 = 0
    guard normalized.count == 6, Scanner(string: normalized).scanHexInt64(&value) else {
      self = noLateAccent
      return
    }
    self.init(red: Double((value >> 16) & 0xff) / 255,
              green: Double((value >> 8) & 0xff) / 255,
              blue: Double(value & 0xff) / 255)
  }
}
