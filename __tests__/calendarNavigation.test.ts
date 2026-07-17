import {
    getCalendarWeekStart,
    getCalendarWeekdayIndex,
    getScheduleFocusDay,
    getYearTodayScrollOffset,
    shiftCalendarMonth,
} from "../src/modules/schedule/calendarNavigation";

describe("calendar month navigation", () => {
    test.each([
        ["2026-07-15", 0, "2026-07-12"],
        ["2026-07-15", 1, "2026-07-13"],
        ["2026-07-19", 1, "2026-07-13"],
        ["2026-07-20", 1, "2026-07-20"],
    ] as const)("%s의 주 시작일을 firstDay=%p 기준으로 계산한다", (day, firstDay, expected) => {
        expect(getCalendarWeekStart(day, firstDay)).toBe(expected);
    });

    test("월요일 시작 주간 스트립의 선택 인덱스를 월요일부터 센다", () => {
        expect(getCalendarWeekdayIndex("2026-07-13", 1)).toBe(0);
        expect(getCalendarWeekdayIndex("2026-07-19", 1)).toBe(6);
        expect(getCalendarWeekdayIndex("2026-07-19", 0)).toBe(0);
    });

    test("저장한 일정의 현지 날짜로 캘린더 포커스를 옮긴다", () => {
        expect(getScheduleFocusDay(new Date(2026, 6, 20, 0, 5).toISOString()))
            .toBe("2026-07-20");
        expect(getScheduleFocusDay(new Date(2026, 6, 20, 23, 55).toISOString()))
            .toBe("2026-07-20");
        expect(getScheduleFocusDay("not-a-date")).toBeNull();
    });

    test.each([
        ["2026-07-15", -1, "2026-06-15"],
        ["2026-07-15", 1, "2026-08-15"],
        ["2026-01-10", -1, "2025-12-10"],
        ["2026-12-10", 1, "2027-01-10"],
    ])("%s에서 %p개월 이동한다", (day, offset, expected) => {
        expect(shiftCalendarMonth(day, offset)).toBe(expected);
    });

    test.each([
        ["2026-01-31", 1, "2026-02-28"],
        ["2024-01-31", 1, "2024-02-29"],
        ["2026-03-31", -1, "2026-02-28"],
    ])("짧은 달로 이동할 때 %s를 말일로 보정한다", (day, offset, expected) => {
        expect(shiftCalendarMonth(day, offset)).toBe(expected);
    });

    test("월만 주어지면 1일을 기준으로 이동한다", () => {
        expect(shiftCalendarMonth("2026-07", 1)).toBe("2026-08-01");
    });

    test("연 보기에서 오늘 월 행을 상단 chrome 아래로 맞춘다", () => {
        expect(getYearTodayScrollOffset(103, 56, 300, 103)).toBe(356);
        expect(getYearTodayScrollOffset(0, 20, 0, 103)).toBe(0);
    });

    test("연 보기의 레이아웃 값이 아직 준비되지 않았으면 스크롤을 보류한다", () => {
        expect(getYearTodayScrollOffset(103, Number.NaN, 300, 103)).toBeNull();
    });
});
