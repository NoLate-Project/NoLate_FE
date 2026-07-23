export type CalendarViewMode = "compact" | "stack" | "detail" | "week" | "list";

export const CALENDAR_DAY_HEIGHTS: Record<CalendarViewMode, number> = {
    // Compact inherits the former stack presentation: a continuous month
    // scroller with short category bars.
    compact: 102,
    // Stack is the Apple-style detailed month presentation. Its taller cells
    // leave room for event-title chips without crowding the date number.
    stack: 130,
    detail: 72,
    week: 86,
    list: 68,
};

export function isContinuousMonthViewMode(
    mode: CalendarViewMode
): mode is "compact" | "stack" {
    return mode === "compact" || mode === "stack";
}

export const CALENDAR_VIEW_OPTIONS: Array<{
    value: CalendarViewMode;
    label: string;
}> = [
    { value: "compact", label: "축소형" },
    { value: "stack", label: "스택형" },
    { value: "detail", label: "상세형" },
    { value: "list", label: "목록형" },
];
