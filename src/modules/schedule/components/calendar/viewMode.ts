export type CalendarViewMode = "stack" | "detail" | "week" | "list";

export const CALENDAR_DAY_HEIGHTS: Record<CalendarViewMode, number> = {
    // 스택형은 날짜 아래 일정 pill이 안정적으로 보이도록 기존 고정 높이를 사용한다.
    stack: 130,
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

/** 상세형은 큰 월 제목을 상단 pill로 올려 달력 영역을 더 넓게 쓴다. */
export function usesMonthInPrimaryPill(mode: CalendarViewMode): boolean {
    return mode === "detail";
}

/** 상세형 pill과 요일 행 사이에만 숨 쉴 공간을 더한다. */
export function getPrimaryPillWeekdayGap(mode: CalendarViewMode): number {
    return usesMonthInPrimaryPill(mode) ? 6 : 0;
}

/** 스택형은 스크롤 중에도 현재 월을 알 수 있도록 큰 월 제목을 유지한다. */
export function showsStickyMonthTitle(mode: CalendarViewMode): boolean {
    return !usesMonthInPrimaryPill(mode);
}

export const CALENDAR_VIEW_OPTIONS: Array<{
    value: CalendarViewMode;
    label: string;
}> = [
    { value: "stack", label: "스택형" },
    { value: "detail", label: "상세형" },
    { value: "list", label: "목록형" },
];
