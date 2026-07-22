import type { ScheduleCalendar } from "../../api/scheduleCalendars";

/** 일정 생성·수정은 캘린더의 소유자와 편집자만 수행할 수 있다. */
export function canWriteScheduleCalendar(calendar?: ScheduleCalendar | null): boolean {
    return calendar?.status === "ACTIVE"
        && (calendar.myRole === "OWNER" || calendar.myRole === "EDITOR");
}
export function getWritableScheduleCalendars(
    calendars: ScheduleCalendar[],
): ScheduleCalendar[] {
    return calendars.filter(canWriteScheduleCalendar);
}
