export type CalendarViewMode = "compact" | "stack" | "detail" | "week" | "list";

export const CALENDAR_DAY_HEIGHTS: Record<CalendarViewMode, number> = {
    compact: 76,
    stack: 90,
    detail: 100,
    week: 76,
    list: 58,
};

export const CALENDAR_VIEW_OPTIONS: Array<{
    value: CalendarViewMode;
    label: string;
}> = [
    { value: "compact", label: "축소형" },
    { value: "stack", label: "스택형" },
    { value: "detail", label: "상세형" },
    { value: "list", label: "목록형" },
];
