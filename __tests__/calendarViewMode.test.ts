import {
    CALENDAR_DAY_HEIGHTS,
    CALENDAR_VIEW_OPTIONS,
    getPrimaryPillWeekdayGap,
    isContinuousMonthViewMode,
    prefetchesAdjacentMonths,
    showsStickyMonthTitle,
    usesMonthInPrimaryPill,
} from "../src/modules/schedule/components/calendar/viewMode";

describe("calendar view modes", () => {
    test("exposes only stack, detail, and list in the calendar menu", () => {
        expect(CALENDAR_VIEW_OPTIONS).toEqual([
            { value: "stack", label: "스택형" },
            { value: "detail", label: "상세형" },
            { value: "list", label: "목록형" },
        ]);
    });

    test("keeps enough stack height for event lanes without the unused tail space", () => {
        expect(CALENDAR_DAY_HEIGHTS.stack).toBe(116);
        expect(isContinuousMonthViewMode("stack")).toBe(true);
        expect(isContinuousMonthViewMode("detail")).toBe(false);
        expect(isContinuousMonthViewMode("week")).toBe(false);
        expect(isContinuousMonthViewMode("list")).toBe(false);
    });

    test("puts month in the pill only for detail and keeps stack's month title", () => {
        expect(usesMonthInPrimaryPill("detail")).toBe(true);
        expect(showsStickyMonthTitle("detail")).toBe(false);

        expect(usesMonthInPrimaryPill("stack")).toBe(false);
        expect(showsStickyMonthTitle("stack")).toBe(true);
        expect(usesMonthInPrimaryPill("list")).toBe(false);
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
