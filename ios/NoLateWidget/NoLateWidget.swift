import SwiftUI
import WidgetKit

private let noLateAccent = Color(red: 90 / 255, green: 150 / 255, blue: 255 / 255)

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
        isPlaceholder: context.isPreview
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
      timestamps.insert(Int(date.timeIntervalSince1970))
    }

    for schedule in schedules.prefix(6) {
      include(schedule.startDate)
      include(schedule.effectiveEndDate())
      guard !schedule.departureCompleted,
            let departureDate = schedule.departureDate,
            departureDate > now else { continue }

      include(departureDate.addingTimeInterval(1))
      let countdownEnd = min(departureDate, now.addingTimeInterval(90 * 60))
      var cursor = now.addingTimeInterval(5 * 60)
      var countdownEntries = 0
      while cursor < countdownEnd && countdownEntries < 18 {
        include(cursor)
        cursor = cursor.addingTimeInterval(5 * 60)
        countdownEntries += 1
      }
    }

    return timestamps
      .sorted()
      .prefix(28)
      .map { Date(timeIntervalSince1970: TimeInterval($0)) }
  }
}

struct NoLateScheduleWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(
      kind: NoLateWidgetConstants.widgetKind,
      provider: NoLateWidgetProvider()
    ) { entry in
      NoLateWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("다가오는 일정")
    .description("다음 일정과 추천 출발 시각을 홈 화면에서 바로 확인해요.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

private struct NoLateWidgetEntryView: View {
  @Environment(\.widgetFamily) private var family
  let entry: NoLateWidgetEntry

  var body: some View {
    Group {
      switch family {
      case .systemSmall:
        NoLateSmallWidget(entry: entry)
      case .systemLarge:
        NoLateLargeWidget(entry: entry)
      default:
        NoLateMediumWidget(entry: entry)
      }
    }
    .redacted(reason: entry.isPlaceholder ? .placeholder : [])
    .modifier(NoLateWidgetBackgroundModifier())
  }
}

private struct NoLateSmallWidget: View {
  let entry: NoLateWidgetEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      NoLateWidgetHeader(date: entry.date, compact: true)
      Spacer(minLength: 7)

      if let schedule = entry.schedules.first {
        HStack(spacing: 6) {
          Capsule()
            .fill(Color(noLateHex: schedule.categoryTintHex))
            .frame(width: 4, height: 18)
          Text(NoLateWidgetFormatting.eventTime(schedule, relativeTo: entry.date))
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }

        Text(schedule.title)
          .font(.system(size: 17, weight: .bold, design: .rounded))
          .foregroundStyle(.primary)
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
          .minimumScaleFactor(0.9)
          .layoutPriority(1)
          .padding(.top, 4)

        Spacer(minLength: 4)

        NoLateDepartureLabel(
          schedule: schedule,
          now: entry.date,
          compact: true,
          prominent: true,
          shortened: true
        )

        if entry.schedules.count > 1 {
          Text("외 \(entry.schedules.count - 1)개 일정")
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .padding(.top, 3)
        }
      } else {
        Spacer(minLength: 0)
        NoLateEmptyState(hasSnapshot: entry.snapshot != nil, compact: true)
        Spacer(minLength: 0)
      }
    }
    .padding(14)
    .widgetURL(entry.schedules.first?.deepLink)
    .accessibilityElement(children: .combine)
  }
}

private struct NoLateMediumWidget: View {
  let entry: NoLateWidgetEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      NoLateWidgetHeader(date: entry.date)

      if entry.schedules.isEmpty {
        NoLateEmptyState(hasSnapshot: entry.snapshot != nil)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        VStack(spacing: 0) {
          ForEach(Array(entry.schedules.prefix(3).enumerated()), id: \.element.id) { index, schedule in
            NoLateScheduleRow(
              schedule: schedule,
              now: entry.date,
              showsDate: !Calendar.current.isDate(schedule.startDate ?? entry.date, inSameDayAs: entry.date),
              compact: true
            )
            if index < min(entry.schedules.count, 3) - 1 {
              Divider().padding(.leading, 57)
            }
          }
        }
      }
    }
    .padding(14)
  }
}

private struct NoLateLargeWidget: View {
  let entry: NoLateWidgetEntry

  private var nextSchedule: NoLateWidgetSchedule? { entry.schedules.first }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      NoLateWidgetHeader(date: entry.date)

      if entry.schedules.isEmpty {
        NoLateEmptyState(hasSnapshot: entry.snapshot != nil)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        HStack {
          Text("다가오는 일정")
            .font(.system(size: 12, weight: .bold, design: .rounded))
          Spacer()
          Text("\(entry.schedules.count)개")
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)
        }

        VStack(spacing: 0) {
          ForEach(Array(entry.schedules.prefix(3).enumerated()), id: \.element.id) { index, schedule in
            NoLateScheduleRow(
              schedule: schedule,
              now: entry.date,
              showsDate: !Calendar.current.isDate(schedule.startDate ?? entry.date, inSameDayAs: entry.date)
            )
            if index < min(entry.schedules.count, 3) - 1 {
              Divider().padding(.leading, 62)
            }
          }
        }
        .frame(maxHeight: .infinity, alignment: .top)

        if let nextSchedule {
          NoLateNextScheduleCard(schedule: nextSchedule, now: entry.date)
        }
      }
    }
    .padding(16)
  }
}

private struct NoLateNextScheduleCard: View {
  let schedule: NoLateWidgetSchedule
  let now: Date

  var body: some View {
    Group {
      if let deepLink = schedule.deepLink {
        Link(destination: deepLink) { cardContent }
      } else {
        cardContent
      }
    }
    .buttonStyle(.plain)
  }

  private var cardContent: some View {
    HStack(spacing: 10) {
      Capsule()
        .fill(Color(noLateHex: schedule.categoryTintHex))
        .frame(width: 4, height: 46)

      VStack(alignment: .leading, spacing: 4) {
        Text(schedule.title)
          .font(.system(size: 15, weight: .bold, design: .rounded))
          .foregroundStyle(.primary)
          .lineLimit(1)

        NoLateDepartureLabel(schedule: schedule, now: now, compact: true)

        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(NoLateWidgetFormatting.eventDateTime(schedule, relativeTo: now))
            .lineLimit(1)
          Spacer(minLength: 6)
          Text("다음 일정")
        }
        .font(.system(size: 10, weight: .semibold, design: .rounded))
        .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(11)
    .background(
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .fill(noLateAccent.opacity(0.09))
    )
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

private struct NoLateWidgetHeader: View {
  let date: Date
  var compact = false

  var body: some View {
    HStack(spacing: 6) {
      ZStack {
        RoundedRectangle(cornerRadius: compact ? 6 : 7, style: .continuous)
          .fill(noLateAccent)
        Image(systemName: "clock.fill")
          .font(.system(size: compact ? 9 : 10, weight: .bold))
          .foregroundStyle(.white)
      }
      .frame(width: compact ? 20 : 22, height: compact ? 20 : 22)

      Text("NoLate")
        .font(.system(size: compact ? 13 : 14, weight: .bold, design: .rounded))
        .foregroundStyle(.primary)
        .unredacted()

      Spacer(minLength: 4)

      if !compact {
        Text(date, format: .dateTime.month(.abbreviated).day().weekday(.abbreviated))
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(.secondary)
      }
    }
  }
}

private struct NoLateScheduleRow: View {
  let schedule: NoLateWidgetSchedule
  let now: Date
  var showsDate = false
  var compact = false

  var body: some View {
    Group {
      if let deepLink = schedule.deepLink {
        Link(destination: deepLink) { rowContent }
      } else {
        rowContent
      }
    }
    .buttonStyle(.plain)
  }

  private var rowContent: some View {
    HStack(spacing: 8) {
      Text(
        showsDate
          ? NoLateWidgetFormatting.shortDate(schedule)
          : NoLateWidgetFormatting.eventTime(schedule, relativeTo: now)
      )
      .font(.system(size: compact ? 10 : 11, weight: .bold, design: .rounded))
      .foregroundStyle(.secondary)
      .frame(width: compact ? 44 : 49, alignment: .trailing)
      .lineLimit(1)
      .minimumScaleFactor(0.75)

      Capsule()
        .fill(Color(noLateHex: schedule.categoryTintHex))
        .frame(width: 3, height: compact ? 28 : 31)

      VStack(alignment: .leading, spacing: 2) {
        Text(schedule.title)
          .font(.system(size: compact ? 12 : 13, weight: .bold, design: .rounded))
          .foregroundStyle(.primary)
          .lineLimit(1)

        HStack(spacing: 4) {
          if schedule.departureCompleted {
            Image(systemName: "checkmark.circle.fill")
              .foregroundStyle(Color.green)
            Text("출발 완료")
          } else if NoLateWidgetFormatting.isOngoing(schedule, at: now) {
            Image(systemName: "clock.fill")
              .foregroundStyle(noLateAccent)
            Text("일정 진행 중")
          } else if schedule.routeSetupRequired {
            Image(systemName: "map.fill")
              .foregroundStyle(Color.orange)
            Text("경로 설정 필요")
          } else if let departureDate = schedule.departureDate,
                    departureDate > now {
            Image(systemName: NoLateWidgetFormatting.travelIcon(schedule.travelMode))
              .foregroundStyle(Color(noLateHex: schedule.categoryTintHex))
            Text("\(NoLateWidgetFormatting.clockTime(departureDate)) 출발")
          } else if let startDate = schedule.startDate, startDate > now,
                    schedule.departureDate != nil {
            Image(systemName: NoLateWidgetFormatting.travelIcon(schedule.travelMode))
              .foregroundStyle(Color.orange)
            Text("지금 출발")
          } else if let location = schedule.displayLocation {
            Image(systemName: "location.fill")
            Text(location)
          } else if let category = schedule.categoryTitle {
            Text(category)
          }
        }
        .font(.system(size: compact ? 9 : 10, weight: .semibold, design: .rounded))
        .foregroundStyle(.secondary)
        .lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(minHeight: compact ? 35 : 39)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

private struct NoLateDepartureLabel: View {
  let schedule: NoLateWidgetSchedule
  let now: Date
  var compact = false
  var prominent = false
  var shortened = false

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: NoLateWidgetFormatting.departureIcon(schedule, now: now))
        .foregroundStyle(NoLateWidgetFormatting.departureColor(schedule))
      Text(
        shortened
          ? NoLateWidgetFormatting.compactDepartureText(schedule, now: now)
          : NoLateWidgetFormatting.departureText(schedule, now: now)
      )
        .lineLimit(1)
        .minimumScaleFactor(0.76)
    }
    .font(.system(
      size: prominent ? 14 : compact ? 10 : 11,
      weight: .bold,
      design: .rounded
    ))
    .foregroundStyle(.secondary)
    .accessibilityElement(children: .combine)
  }
}

private struct NoLateEmptyState: View {
  let hasSnapshot: Bool
  var compact = false

  var body: some View {
    VStack(spacing: compact ? 7 : 8) {
      Image(systemName: hasSnapshot ? "calendar.badge.checkmark" : "arrow.clockwise.circle")
        .font(.system(size: compact ? 23 : 27, weight: .medium))
        .foregroundStyle(noLateAccent)
      Text(hasSnapshot ? "다가오는 일정이 없어요" : "일정을 불러와 주세요")
        .font(.system(size: compact ? 12 : 13, weight: .bold, design: .rounded))
        .foregroundStyle(.primary)
        .multilineTextAlignment(.center)
      if !compact {
        Text(hasSnapshot ? "오늘을 여유롭게 시작해 보세요" : "NoLate를 열면 위젯이 자동으로 동기화돼요")
          .font(.system(size: 10, weight: .medium, design: .rounded))
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
  }
}

private enum NoLateWidgetFormatting {
  static func clockTime(_ date: Date) -> String {
    date.formatted(date: .omitted, time: .shortened)
  }

  static func eventDateTime(_ schedule: NoLateWidgetSchedule, relativeTo now: Date) -> String {
    guard let startDate = schedule.startDate else {
      return schedule.allDay ? "종일" : "시간 미정"
    }

    let calendar = Calendar.current
    let dayLabel: String
    if calendar.isDate(startDate, inSameDayAs: now) {
      dayLabel = "오늘"
    } else if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now),
              calendar.isDate(startDate, inSameDayAs: tomorrow) {
      dayLabel = "내일"
    } else {
      dayLabel = startDate.formatted(.dateTime.month(.abbreviated).day())
    }

    let timeLabel = schedule.allDay ? "종일" : clockTime(startDate)
    return "\(dayLabel) · \(timeLabel)"
  }

  static func eventTime(_ schedule: NoLateWidgetSchedule, relativeTo now: Date) -> String {
    if schedule.allDay { return "종일" }
    guard let startDate = schedule.startDate else { return "시간 미정" }
    if !Calendar.current.isDate(startDate, inSameDayAs: now) {
      return shortDate(schedule)
    }
    return clockTime(startDate)
  }

  static func shortDate(_ schedule: NoLateWidgetSchedule) -> String {
    guard let startDate = schedule.startDate else { return "예정" }
    return startDate.formatted(.dateTime.month(.abbreviated).day())
  }

  static func departureText(_ schedule: NoLateWidgetSchedule, now: Date) -> String {
    if schedule.departureCompleted { return "출발 완료" }
    if isOngoing(schedule, at: now) { return "일정 진행 중" }
    if schedule.routeSetupRequired { return "경로 설정이 필요해요" }
    if let departureDate = schedule.departureDate {
      let remainingMinutes = Int(ceil(departureDate.timeIntervalSince(now) / 60))
      if remainingMinutes > 0 && remainingMinutes <= 90 {
        return "\(clockTime(departureDate)) 출발 · \(remainingMinutes)분 남음"
      }
      if remainingMinutes <= 0,
         let startDate = schedule.startDate,
         startDate > now {
        return "지금 출발할 시간이에요"
      }
      return "\(clockTime(departureDate)) 출발"
    }
    if let travelMinutes = schedule.travelMinutes, travelMinutes > 0 {
      return "이동 \(travelMinutes)분"
    }
    if let location = schedule.displayLocation { return location }
    return schedule.categoryTitle ?? "일정 확인하기"
  }

  static func compactDepartureText(_ schedule: NoLateWidgetSchedule, now: Date) -> String {
    if schedule.departureCompleted { return "출발 완료" }
    if isOngoing(schedule, at: now) { return "일정 진행 중" }
    if schedule.routeSetupRequired { return "경로 설정 필요" }
    if let departureDate = schedule.departureDate {
      let remainingMinutes = Int(ceil(departureDate.timeIntervalSince(now) / 60))
      if remainingMinutes > 0 && remainingMinutes <= 90 {
        return "\(remainingMinutes)분 뒤 출발"
      }
      if remainingMinutes <= 0,
         let startDate = schedule.startDate,
         startDate > now {
        return "지금 출발"
      }
      return "\(clockTime(departureDate)) 출발"
    }
    if let travelMinutes = schedule.travelMinutes, travelMinutes > 0 {
      return "이동 \(travelMinutes)분"
    }
    if let location = schedule.displayLocation { return location }
    return schedule.categoryTitle ?? "일정 확인"
  }

  static func departureIcon(_ schedule: NoLateWidgetSchedule, now: Date) -> String {
    if schedule.departureCompleted { return "checkmark.circle.fill" }
    if isOngoing(schedule, at: now) { return "clock.fill" }
    if schedule.routeSetupRequired { return "map.fill" }
    if schedule.departureDate != nil { return travelIcon(schedule.travelMode) }
    if schedule.displayLocation != nil { return "location.fill" }
    return "calendar"
  }

  static func departureColor(_ schedule: NoLateWidgetSchedule) -> Color {
    if schedule.departureCompleted { return .green }
    if schedule.routeSetupRequired { return .orange }
    return Color(noLateHex: schedule.categoryTintHex)
  }

  static func travelIcon(_ travelMode: String?) -> String {
    switch travelMode?.uppercased() {
    case "CAR": return "car.fill"
    case "TRANSIT": return "bus.fill"
    case "WALK": return "figure.walk"
    case "BIKE": return "bicycle"
    default: return "location.fill"
    }
  }

  static func isOngoing(_ schedule: NoLateWidgetSchedule, at now: Date) -> Bool {
    guard let startDate = schedule.startDate,
          let endDate = schedule.effectiveEndDate() else { return false }
    return startDate <= now && endDate > now
  }
}

private struct NoLateWidgetBackgroundModifier: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content.containerBackground(for: .widget) {
        NoLateWidgetBackground()
      }
    } else {
      content.background(NoLateWidgetBackground())
    }
  }
}

private struct NoLateWidgetBackground: View {
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    ZStack {
      Color(uiColor: .systemBackground)
      LinearGradient(
        colors: [
          noLateAccent.opacity(colorScheme == .dark ? 0.16 : 0.10),
          Color.clear,
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    }
  }
}

private extension Color {
  init(noLateHex: String) {
    let normalized = noLateHex
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "#", with: "")
    var value: UInt64 = 0
    guard normalized.count == 6,
          Scanner(string: normalized).scanHexInt64(&value) else {
      self = noLateAccent
      return
    }
    self.init(
      red: Double((value >> 16) & 0xff) / 255,
      green: Double((value >> 8) & 0xff) / 255,
      blue: Double(value & 0xff) / 255
    )
  }
}
