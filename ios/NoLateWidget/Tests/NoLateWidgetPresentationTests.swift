import Foundation

// Run with swiftc NoLateWidgetSnapshot.swift Tests/NoLateWidgetPresentationTests.swift -o /tmp/widget-tests.
@main
struct NoLateWidgetPresentationTests {
  static func main() throws {
    let now = NoLateISO8601.date(from: "2026-10-03T17:00:00+09:00")!
    func schedule(_ id: String, _ start: String, allDay: Bool = false,
                  departure: String? = nil, completed: Bool = false,
                  routeRequired: Bool = false) -> NoLateWidgetSchedule {
      NoLateWidgetSchedule(id: id, title: id, startAt: start, endAt: nil,
        allDay: allDay, hasEndTime: false, categoryTitle: nil, categoryColor: nil,
        locationName: nil, destinationName: nil, travelMode: nil, travelMinutes: nil,
        departAt: departure, departureCompleted: completed, departedAt: nil,
        myDepartedAt: nil, routeSetupRequired: routeRequired)
    }
    let allDay = schedule("종일 할 일", "2026-10-03T00:00:00+09:00", allDay: true)
    let upcoming = schedule("팀 회의", "2026-10-03T18:00:00+09:00", departure: "2026-10-03T17:25:00+09:00")
    let ongoing = schedule("진행 중 약속", "2026-10-03T16:30:00+09:00")
    let completed = schedule("출발한 약속", "2026-10-03T17:30:00+09:00", completed: true)
    let visible = [allDay, ongoing, completed, upcoming]
    let selected = NoLateWidgetPresentation.featured(in: visible, at: now)
    precondition(selected?.id == upcoming.id, "All-day or departed items must not hide an upcoming departure")
    precondition(visible.filter { $0.id != selected?.id }.count == 3, "The featured event must not be duplicated")
    precondition(NoLateWidgetPresentation.featured(in: [], at: now) == nil)
    precondition(NoLateWidgetPresentation.featured(in: [allDay], at: now)?.id == allDay.id)
    precondition(NoLateWidgetPresentation.timing(for: allDay, at: now) == .allDay)
    precondition(NoLateWidgetPresentation.timing(for: ongoing, at: now) == .ongoing)
    precondition(NoLateWidgetPresentation.timing(for: completed, at: now) == .departed)
    precondition(NoLateWidgetPresentation.timing(for: upcoming, at: now) == .departure(upcoming.departureDate!))
    precondition(NoLateWidgetPresentation.timing(for: upcoming, at: upcoming.departureDate!) == .leaveNow)
    precondition(NoLateWidgetPresentation.timing(for: upcoming, at: upcoming.startDate!) == .ongoing)
    let noRoute = schedule("경로 미설정", "2026-10-03T18:00:00+09:00", routeRequired: true)
    precondition(NoLateWidgetPresentation.timing(for: noRoute, at: now) == .routeRequired)
    let noDeparture = schedule("온라인 회의", "2026-10-03T18:00:00+09:00")
    precondition(NoLateWidgetPresentation.timing(for: noDeparture, at: now) == .start(noDeparture.startDate!))
    let expired = schedule("종료된 일정", "2026-10-03T14:00:00+09:00")
    let snapshot = NoLateWidgetSnapshot(version: 1, generatedAt: nil, schedules: [expired, upcoming])
    precondition(NoLateWidgetSnapshotStore.visibleSchedules(from: snapshot, at: now).map(\.id) == [upcoming.id])
    print("Widget presentation: 13 checks passed")
  }
}
