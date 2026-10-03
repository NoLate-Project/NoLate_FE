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

/**
 * 캘린더 멤버십 없이 직접 공유받은 카테고리는 개인/전체 화면에서 일정 생성 대상으로 유지합니다.
 * 선택 후에는 카테고리가 실제 소속된 캘린더 id로 저장해 서버의 assignment 계약을 지킵니다.
 */
export function isCategoryAvailableForScheduleCreation(
    category: Pick<ScheduleCategory, "calendarId" | "shared">,
    scope: CalendarScope,
    joinedCalendarIds: ReadonlySet<number>,
): boolean {
    if (isCategoryInCalendarScope(category, scope)) return true;
    return (scope === "all" || scope === "personal")
        && category.shared === true
        && typeof category.calendarId === "number"
        && !joinedCalendarIds.has(category.calendarId);
}

export function getScheduleTargetCalendarId(scope: CalendarScope): number | null {
    return typeof scope === "number" ? scope : null;
}

export function getScheduleCreationCalendarId(
    scope: CalendarScope,
    category: Pick<ScheduleCategory, "calendarId">,
): number | null {
    return category.calendarId ?? getScheduleTargetCalendarId(scope);
}

export function normalizeCalendarScope(
    scope: CalendarScope,
    calendars: ScheduleCalendar[],
): CalendarScope {
    if (typeof scope !== "number") return scope;
    return calendars.some((calendar) => calendar.id === scope) ? scope : "all";
}
