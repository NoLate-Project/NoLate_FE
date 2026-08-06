import { getMonthRange } from "../../calendarRange";
import type { ScheduleItem } from "../../types";
import { enumerateStackScheduleDays } from "./stackCalendarLayout";

export const CALENDAR_YEAR_SCHEDULE_DENSITY_LEVEL_MAX = 3;

export type CalendarYearScheduleCounts = Readonly<Record<string, number>>;

export type CalendarYearScheduleDensityPresentation = {
    level: 1 | 2 | 3;
    backgroundColor: string;
    textColor: string;
};

const LIGHT_DENSITY_COLORS = [
    { backgroundColor: "#FFE6E3", textColor: "#A7433B" },
    { backgroundColor: "#FFB5AE", textColor: "#7D2923" },
    { backgroundColor: "#F24A3F", textColor: "#FFFFFF" },
] as const;

const DARK_DENSITY_COLORS = [
    { backgroundColor: "#3A1715", textColor: "#FFB4AE" },
    { backgroundColor: "#8F2D27", textColor: "#FFE5E3" },
    { backgroundColor: "#FF453A", textColor: "#FFFFFF" },
] as const;

export function buildCalendarYearScheduleCounts(
    items: readonly ScheduleItem[]
): CalendarYearScheduleCounts {
    const scheduleCountsByDate: Record<string, number> = {};
    const uniqueItemsById = new Map<string, ScheduleItem>();
    items.forEach((item) => uniqueItemsById.set(item.id, item));

    uniqueItemsById.forEach((item) => {
        enumerateStackScheduleDays(item).forEach((dateKey) => {
            scheduleCountsByDate[dateKey] = (scheduleCountsByDate[dateKey] ?? 0) + 1;
        });
    });

    return scheduleCountsByDate;
}

export function getCalendarYearScheduleDensityLevel(count: number): 0 | 1 | 2 | 3 {
    if (!Number.isFinite(count) || count <= 0) return 0;
    return Math.min(
        Math.floor(count),
        CALENDAR_YEAR_SCHEDULE_DENSITY_LEVEL_MAX
    ) as 1 | 2 | 3;
}

export function getCalendarYearScheduleDensityPresentation(
    count: number,
    mode: "light" | "dark"
): CalendarYearScheduleDensityPresentation | null {
    const level = getCalendarYearScheduleDensityLevel(count);
    if (level === 0) return null;

    const colors = (mode === "dark" ? DARK_DENSITY_COLORS : LIGHT_DENSITY_COLORS)[level - 1];
    return { level, ...colors };
}

export function getCalendarYearScheduleFetchRanges(year: number) {
    const safeYear = Number.isInteger(year) ? year : new Date().getFullYear();
    const january = getMonthRange(`${safeYear}-01-01`);
    const june = getMonthRange(`${safeYear}-06-01`);
    const july = getMonthRange(`${safeYear}-07-01`);
    const december = getMonthRange(`${safeYear}-12-01`);

    return [
        { startAt: january.startAt, endAt: june.endAt },
        { startAt: july.startAt, endAt: december.endAt },
    ];
}

/** 같은 일정이 반기·연도 경계 양쪽에 포함돼도 최신 배열 항목 하나만 유지한다. */
export function mergeCalendarYearScheduleItems(
    items: readonly ScheduleItem[]
): ScheduleItem[] {
    const itemsById = new Map<string, ScheduleItem>();
    items.forEach((item) => itemsById.set(item.id, item));
    return [...itemsById.values()];
}
