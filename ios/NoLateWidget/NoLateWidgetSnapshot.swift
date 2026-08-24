import Foundation

enum NoLateWidgetConstants {
  static let appGroupIdentifier = "group.com.anonymous.nolatefe"
  static let snapshotKey = "nolate.widget.snapshot.v1"
  static let widgetKind = "NoLateScheduleWidget"
}

struct NoLateWidgetSnapshot: Decodable {
  let version: Int
  let generatedAt: String?
  let schedules: [NoLateWidgetSchedule]

  private enum CodingKeys: String, CodingKey {
    case version
    case generatedAt
    case schedules
    case items
  }

  init(version: Int, generatedAt: String?, schedules: [NoLateWidgetSchedule]) {
    self.version = version
    self.generatedAt = generatedAt
    self.schedules = schedules
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    version = (try? container.decode(Int.self, forKey: .version)) ?? 0
    generatedAt = try? container.decodeIfPresent(String.self, forKey: .generatedAt)
    schedules =
      (try? container.decode([NoLateWidgetSchedule].self, forKey: .schedules)) ??
      (try? container.decode([NoLateWidgetSchedule].self, forKey: .items)) ??
      []
  }

  static var placeholder: NoLateWidgetSnapshot {
    let calendar = Calendar.current
    let now = Date()
    let firstStart = calendar.date(byAdding: .minute, value: 40, to: now) ?? now
    let secondStart = calendar.date(byAdding: .hour, value: 3, to: now) ?? now
    let thirdStart = calendar.date(byAdding: .day, value: 1, to: now) ?? now

    return NoLateWidgetSnapshot(
      version: 1,
      generatedAt: NoLateISO8601.string(from: now),
      schedules: [
        NoLateWidgetSchedule(
          id: "preview-1",
          title: "팀 주간 회의",
          startAt: NoLateISO8601.string(from: firstStart),
          endAt: NoLateISO8601.string(from: calendar.date(byAdding: .hour, value: 1, to: firstStart) ?? firstStart),
          allDay: false,
          hasEndTime: true,
          categoryTitle: "업무",
          categoryColor: "#5A96FF",
          locationName: "강남 오피스",
          destinationName: nil,
          travelMode: "TRANSIT",
          travelMinutes: 35,
          departAt: NoLateISO8601.string(from: calendar.date(byAdding: .minute, value: -35, to: firstStart) ?? firstStart),
          departureCompleted: false,
          departedAt: nil,
          myDepartedAt: nil,
          routeSetupRequired: false
        ),
        NoLateWidgetSchedule(
          id: "preview-2",
          title: "저녁 약속",
          startAt: NoLateISO8601.string(from: secondStart),
          endAt: NoLateISO8601.string(from: calendar.date(byAdding: .hour, value: 2, to: secondStart) ?? secondStart),
          allDay: false,
          hasEndTime: true,
          categoryTitle: "개인",
          categoryColor: "#FF9F0A",
          locationName: "성수동",
          destinationName: nil,
          travelMode: "TRANSIT",
          travelMinutes: 28,
          departAt: NoLateISO8601.string(from: calendar.date(byAdding: .minute, value: -28, to: secondStart) ?? secondStart),
          departureCompleted: false,
          departedAt: nil,
          myDepartedAt: nil,
          routeSetupRequired: false
        ),
        NoLateWidgetSchedule(
          id: "preview-3",
          title: "프로젝트 마감",
          startAt: NoLateISO8601.string(from: thirdStart),
          endAt: nil,
          allDay: true,
          hasEndTime: false,
          categoryTitle: "중요",
          categoryColor: "#FF453A",
          locationName: nil,
          destinationName: nil,
          travelMode: nil,
          travelMinutes: nil,
          departAt: nil,
          departureCompleted: false,
          departedAt: nil,
          myDepartedAt: nil,
          routeSetupRequired: false
        ),
      ]
    )
  }
}

struct NoLateWidgetSchedule: Decodable, Identifiable, Hashable {
  let id: String
  let title: String
  let startAt: String
  let endAt: String?
  let allDay: Bool
  let hasEndTime: Bool
  let categoryTitle: String?
  let categoryColor: String?
  let locationName: String?
  let destinationName: String?
  let travelMode: String?
  let travelMinutes: Int?
  let departAt: String?
  let departureCompleted: Bool
  let departedAt: String?
  let myDepartedAt: String?
  let routeSetupRequired: Bool

  private struct Category: Decodable {
    let title: String?
    let color: String?
  }

  private struct Place: Decodable {
    let name: String?
  }

  private enum CodingKeys: String, CodingKey {
    case id
    case title
    case startAt
    case endAt
    case allDay
    case hasEndTime
    case categoryTitle
    case categoryColor
    case category
    case locationName
    case destinationName
    case destination
    case travelMode
    case travelMinutes
    case departAt
    case departureCompleted
    case departedAt
    case myDepartedAt
    case routeSetupRequired
  }

  init(
    id: String,
    title: String,
    startAt: String,
    endAt: String?,
    allDay: Bool,
    hasEndTime: Bool,
    categoryTitle: String?,
    categoryColor: String?,
    locationName: String?,
    destinationName: String?,
    travelMode: String?,
    travelMinutes: Int?,
    departAt: String?,
    departureCompleted: Bool,
    departedAt: String?,
    myDepartedAt: String?,
    routeSetupRequired: Bool
  ) {
    self.id = id
    self.title = title
    self.startAt = startAt
    self.endAt = endAt
    self.allDay = allDay
    self.hasEndTime = hasEndTime
    self.categoryTitle = categoryTitle
    self.categoryColor = categoryColor
    self.locationName = locationName
    self.destinationName = destinationName
    self.travelMode = travelMode
    self.travelMinutes = travelMinutes
    self.departAt = departAt
    self.departureCompleted = departureCompleted
    self.departedAt = departedAt
    self.myDepartedAt = myDepartedAt
    self.routeSetupRequired = routeSetupRequired
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let stringID = try? container.decode(String.self, forKey: .id) {
      id = stringID
    } else if let integerID = try? container.decode(Int.self, forKey: .id) {
      id = String(integerID)
    } else {
      id = ""
    }
    title = ((try? container.decode(String.self, forKey: .title)) ?? "일정")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    startAt = (try? container.decode(String.self, forKey: .startAt)) ?? ""
    endAt = try? container.decodeIfPresent(String.self, forKey: .endAt)
    allDay = (try? container.decode(Bool.self, forKey: .allDay)) ?? false
    hasEndTime = (try? container.decode(Bool.self, forKey: .hasEndTime)) ?? (endAt != nil)

    let category = try? container.decodeIfPresent(Category.self, forKey: .category)
    categoryTitle =
      (try? container.decodeIfPresent(String.self, forKey: .categoryTitle)) ??
      category?.title
    categoryColor =
      (try? container.decodeIfPresent(String.self, forKey: .categoryColor)) ??
      category?.color

    let destination = try? container.decodeIfPresent(Place.self, forKey: .destination)
    locationName = try? container.decodeIfPresent(String.self, forKey: .locationName)
    destinationName =
      (try? container.decodeIfPresent(String.self, forKey: .destinationName)) ??
      destination?.name
    travelMode = try? container.decodeIfPresent(String.self, forKey: .travelMode)
    travelMinutes = try? container.decodeIfPresent(Int.self, forKey: .travelMinutes)
    departAt = try? container.decodeIfPresent(String.self, forKey: .departAt)
    let decodedDepartedAt = try? container.decodeIfPresent(String.self, forKey: .departedAt)
    let decodedMyDepartedAt = try? container.decodeIfPresent(String.self, forKey: .myDepartedAt)
    departedAt = decodedDepartedAt
    myDepartedAt = decodedMyDepartedAt
    let legacyDepartureCompleted = [decodedDepartedAt, decodedMyDepartedAt].contains { value in
      guard let value else { return false }
      return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    departureCompleted =
      ((try? container.decode(Bool.self, forKey: .departureCompleted)) ?? false) ||
      legacyDepartureCompleted
    routeSetupRequired =
      (try? container.decode(Bool.self, forKey: .routeSetupRequired)) ?? false
  }

  var startDate: Date? { NoLateISO8601.date(from: startAt) }
  var endDate: Date? { endAt.flatMap(NoLateISO8601.date(from:)) }
  var departureDate: Date? { departAt.flatMap(NoLateISO8601.date(from:)) }

  var displayLocation: String? {
    let candidate = locationName ?? destinationName
    guard let trimmed = candidate?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty else { return nil }
    return trimmed
  }

  var categoryTintHex: String { categoryColor ?? "#5A96FF" }

  var deepLink: URL? {
    guard !id.isEmpty else { return nil }
    var components = URLComponents()
    components.scheme = "nolate"
    components.host = "schedule"
    components.path = "/\(id)"
    return components.url
  }

  func effectiveEndDate(calendar: Calendar = .current) -> Date? {
    if let endDate { return endDate }
    guard let startDate else { return nil }
    if allDay {
      return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: startDate))
    }
    return calendar.date(byAdding: .hour, value: 1, to: startDate)
  }
}

enum NoLateWidgetSnapshotStore {
  static func load() -> NoLateWidgetSnapshot? {
    guard let defaults = UserDefaults(suiteName: NoLateWidgetConstants.appGroupIdentifier) else {
      return nil
    }

    let data: Data?
    if let storedData = defaults.data(forKey: NoLateWidgetConstants.snapshotKey) {
      data = storedData
    } else if let storedString = defaults.string(forKey: NoLateWidgetConstants.snapshotKey) {
      data = storedString.data(using: .utf8)
    } else {
      data = nil
    }

    guard let data,
          let snapshot = try? JSONDecoder().decode(NoLateWidgetSnapshot.self, from: data),
          snapshot.version == 1 else {
      return nil
    }

    let validSchedules = snapshot.schedules.filter { schedule in
      !schedule.id.isEmpty &&
        !schedule.title.isEmpty &&
        schedule.startDate != nil
    }
    return NoLateWidgetSnapshot(
      version: snapshot.version,
      generatedAt: snapshot.generatedAt,
      schedules: validSchedules
    )
  }

  static func visibleSchedules(
    from snapshot: NoLateWidgetSnapshot?,
    at now: Date,
    calendar: Calendar = .current
  ) -> [NoLateWidgetSchedule] {
    guard let snapshot else { return [] }
    return snapshot.schedules
      .filter { schedule in
        guard let startDate = schedule.startDate else { return false }
        if schedule.allDay && calendar.isDate(startDate, inSameDayAs: now) {
          return true
        }
        let endDate = schedule.effectiveEndDate(calendar: calendar) ?? startDate
        return endDate >= now
      }
      .sorted { left, right in
        guard let leftStart = left.startDate, let rightStart = right.startDate else {
          return left.id < right.id
        }
        if leftStart == rightStart {
          if left.allDay != right.allDay { return left.allDay }
          return left.id < right.id
        }
        return leftStart < rightStart
      }
  }
}

enum NoLateISO8601 {
  static func date(from rawValue: String) -> Date? {
    let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }

    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) { return date }

    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    return standard.date(from: value)
  }

  static func string(from date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }
}
