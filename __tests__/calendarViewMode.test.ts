import {
    CALENDAR_DAY_HEIGHTS,
    CALENDAR_VIEW_OPTIONS,
    DEFAULT_CALENDAR_VIEW_MODE,
    getPrimaryPillWeekdayGap,
    isContinuousMonthViewMode,
    isCalendarViewModePreference,
    prefetchesAdjacentMonths,
    showsStickyMonthTitle,
    showsCalendarToolbarModeIcon,
    usesMonthInPrimaryPill,
} from "../src/modules/schedule/components/calendar/viewMode";
import { createStackMonth, STACK_MONTH_DIVIDER_HEIGHT } from "../src/modules/schedule/components/calendar/scheduleCalendarModel";

describe("calendar view modes", () => {
    test("exposes only stack, detail, and list in the calendar menu", () => {
        expect(CALENDAR_VIEW_OPTIONS).toEqual([
            { value: "stack", label: "스택형", subtitle: "날짜 칸 안에 일정" },
            { value: "detail", label: "상세형", subtitle: "월 달력과 선택한 날의 일정" },
            { value: "list", label: "목록형", subtitle: "날짜순 일정 목록" },
        ]);
    });

    test("accepts only user-selectable modes as saved preferences", () => {
        expect(DEFAULT_CALENDAR_VIEW_MODE).toBe("detail");
        expect(["stack", "detail", "list"].every(isCalendarViewModePreference))
            .toBe(true);
        expect(["week", "", "DETAIL", null, undefined]
            .some(isCalendarViewModePreference))
            .toBe(false);
    });

    test("keeps enough stack height for event lanes without the unused tail space", () => {
        expect(CALENDAR_DAY_HEIGHTS.stack).toBe(104);
        expect(isContinuousMonthViewMode("stack")).toBe(true);
        expect(isContinuousMonthViewMode("detail")).toBe(false);
        expect(isContinuousMonthViewMode("week")).toBe(false);
        expect(isContinuousMonthViewMode("list")).toBe(false);
    });

    test("shows the month in detail and standard list controls and in the stack grid", () => {
        expect(usesMonthInPrimaryPill("detail")).toBe(true);
        expect(showsStickyMonthTitle("detail")).toBe(false);

        expect(usesMonthInPrimaryPill("stack")).toBe(false);
        expect(showsStickyMonthTitle("stack")).toBe(true);
        expect(usesMonthInPrimaryPill("list")).toBe(true);
        expect(usesMonthInPrimaryPill("list", 1.6)).toBe(false);
    });

    test("reserves the inline mode icon for standard text on wider screens", () => {
        expect(showsCalendarToolbarModeIcon(320, 1)).toBe(false);
        expect(showsCalendarToolbarModeIcon(375, 1)).toBe(false);
        expect(showsCalendarToolbarModeIcon(390, 1)).toBe(true);
        expect(showsCalendarToolbarModeIcon(402, 1)).toBe(true);
        expect(showsCalendarToolbarModeIcon(402, 1.15)).toBe(false);
    });

    test("uses the rendered height of every week to position its dates and the next month", () => {
        const occupiedDays = new Set(["2026-11-07", "2026-11-08", "2026-11-29"]);
        const month = createStackMonth(new Date(2026, 10, 1), 0, CALENDAR_DAY_HEIGHTS.stack, 24,
            day => occupiedDays.has(day));
        expect(month.weeks).toEqual([
            { height: 104, offset: 0 },
            { height: 104, offset: 104 },
            { height: 72, offset: 208 },
            { height: 72, offset: 280 },
            { height: 104, offset: 352 },
        ]);
        expect(month.height).toBe(24 + 456 + STACK_MONTH_DIVIDER_HEIGHT);
    });

    test("adds breathing room below the combined detail pill only", () => {
        expect(getPrimaryPillWeekdayGap("detail")).toBe(6);
        expect(getPrimaryPillWeekdayGap("stack")).toBe(0);
        expect(getPrimaryPillWeekdayGap("list")).toBe(0);
    });

    test("prefetches adjacent months for every month presentation", () => {
        expect(prefetchesAdjacentMonths("stack")).toBe(true);
        expect(prefetchesAdjacentMonths("detail")).toBe(true);
        expect(prefetchesAdjacentMonths("list")).toBe(true);
        expect(prefetchesAdjacentMonths("week")).toBe(false);
    });
});
