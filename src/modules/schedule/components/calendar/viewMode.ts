import { STACK_CALENDAR_GEOMETRY } from "./stackCalendarAppearance";

export type CalendarViewMode = "stack" | "detail" | "week" | "list";
export type CalendarViewModePreference = Exclude<CalendarViewMode, "week">;

export const DEFAULT_CALENDAR_VIEW_MODE: CalendarViewModePreference = "detail";

export function isCalendarViewModePreference(
    value: unknown
): value is CalendarViewModePreference {
    return value === "stack" || value === "detail" || value === "list";
}

export const CALENDAR_DAY_HEIGHTS: Record<CalendarViewMode, number> = {
    // 휴일이 있는 날의 두 일정 lane과 overflow까지 유지하면서 남는 세로 공간만 줄인다.
    stack: STACK_CALENDAR_GEOMETRY.rowHeight,
    detail: 72,
    week: 86,
    list: 68,
};

export function isContinuousMonthViewMode(
    mode: CalendarViewMode
): mode is "stack" {
    return mode === "stack";
}

/** 월간 화면은 이동 전에 양옆 한 달을 채워 첫 월 전환에서 네트워크를 기다리지 않는다. */
export function prefetchesAdjacentMonths(mode: CalendarViewMode): boolean {
    return mode !== "week";
}

/** 달력 안에서 월 제목을 읽을 수 없는 기본 목록형에도 현재 월을 표시한다. */
export function usesMonthInPrimaryPill(mode: CalendarViewMode, fontScale = 1): boolean {
    return mode === "detail" || (mode === "list" && fontScale <= 1.35);
}

/** The expanded mode label has room for its icon at standard text on wider phones. */
export function showsCalendarToolbarModeIcon(width: number, fontScale: number): boolean {
    return width >= 390 && fontScale <= 1;
}

/** 상세형 pill과 요일 행 사이에만 숨 쉴 공간을 더한다. */
export function getPrimaryPillWeekdayGap(mode: CalendarViewMode): number {
    return mode === "detail" ? 6 : 0;
}

/** 스택형은 스크롤 중에도 현재 월을 알 수 있도록 큰 월 제목을 유지한다. */
export function showsStickyMonthTitle(mode: CalendarViewMode): boolean {
    return mode !== "detail";
}

export const CALENDAR_VIEW_OPTIONS: Array<{
    value: CalendarViewModePreference;
    label: string;
    subtitle: string;
}> = [
    { value: "stack", label: "스택형", subtitle: "날짜 칸 안에 일정" },
    { value: "detail", label: "상세형", subtitle: "월 달력과 선택한 날의 일정" },
    { value: "list", label: "목록형", subtitle: "날짜순 일정 목록" },
];
