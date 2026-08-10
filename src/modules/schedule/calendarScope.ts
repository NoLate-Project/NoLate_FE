import type { ScheduleCalendar } from "../../api/scheduleCalendars";
import type { ScheduleCategory, ScheduleItem } from "./types";

export type CalendarScope = "all" | "personal" | number;

export type CalendarScopePresentation = {
    title: string;
    color?: string;
};

export function getCalendarScopePresentation(
    scope: CalendarScope,
    calendars: ScheduleCalendar[],
): CalendarScopePresentation {
    if (scope === "personal") {
        return { title: "개인 일정" };
    }
    if (typeof scope === "number") {
        const calendar = calendars.find((item) => item.id === scope);
        if (calendar) {
            return {
                title: calendar.title,
                color: calendar.color,
            };
        }
    }
    return { title: "전체 일정" };
}

export function isScheduleInCalendarScope(
    item: Pick<ScheduleItem, "calendarId">,
    scope: CalendarScope,
): boolean {
    if (scope === "all") return true;
    if (scope === "personal") return item.calendarId == null;
    return item.calendarId === scope;
}

export function isCategoryInCalendarScope(
    category: Pick<ScheduleCategory, "calendarId">,
    scope: CalendarScope,
): boolean {
    if (scope === "all" || scope === "personal") return category.calendarId == null;
    return category.calendarId === scope;
}

export function getScheduleTargetCalendarId(scope: CalendarScope): number | null {
    return typeof scope === "number" ? scope : null;
}

export function normalizeCalendarScope(
    scope: CalendarScope,
    calendars: ScheduleCalendar[],
): CalendarScope {
    if (typeof scope !== "number") return scope;
    return calendars.some((calendar) => calendar.id === scope) ? scope : "all";
}
