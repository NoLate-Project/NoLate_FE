import {
    CALENDAR_YEAR_SCHEDULE_DENSITY_LEVEL_MAX,
    buildCalendarYearScheduleCounts,
    getCalendarYearScheduleDensityLevel,
    getCalendarYearScheduleDensityPresentation,
    getCalendarYearScheduleFetchRanges,
    mergeCalendarYearScheduleItems,
} from "../src/modules/schedule/components/calendar/calendarYearScheduleDensity";
import type { ScheduleItem } from "../src/modules/schedule/types";

function schedule(
    id: string,
    startAt: string,
    endAt: string,
    allDay = false
): ScheduleItem {
    return {
        id,
        title: id,
        startAt,
        endAt,
        allDay,
        category: {
            id: "category",
            title: "카테고리",
            color: "#0A84FF",
        },
    };
}

describe("calendar year schedule density", () => {
    test("counts schedules and maps 1, 2, and 3+ items to the three heat levels", () => {
        const items = Array.from({ length: 4 }, (_, index) => schedule(
            `schedule-${index + 1}`,
            `2026-08-06T${String(9 + index).padStart(2, "0")}:00:00+09:00`,
            `2026-08-06T${String(10 + index).padStart(2, "0")}:00:00+09:00`
        ));

        const counts = buildCalendarYearScheduleCounts(items);

        expect(counts["2026-08-06"]).toBe(4);
        expect(CALENDAR_YEAR_SCHEDULE_DENSITY_LEVEL_MAX).toBe(3);
        expect([0, 1, 2, 3, 4].map(getCalendarYearScheduleDensityLevel))
            .toEqual([0, 1, 2, 3, 3]);
        expect(getCalendarYearScheduleDensityPresentation(1, "light")).toEqual({
            level: 1,
            backgroundColor: "#FFE6E3",
            textColor: "#A7433B",
        });
        expect(getCalendarYearScheduleDensityPresentation(2, "light")).toEqual({
            level: 2,
            backgroundColor: "#FFB5AE",
            textColor: "#7D2923",
        });
        expect(getCalendarYearScheduleDensityPresentation(4, "light")).toEqual({
            level: 3,
            backgroundColor: "#F24A3F",
            textColor: "#FFFFFF",
        });
    });

    test("keeps only the latest copy of the same schedule id when counting", () => {
        const older = schedule(
            "duplicate",
            "2026-08-05T09:00:00+09:00",
            "2026-08-05T10:00:00+09:00"
        );
        const newer = {
            ...older,
            startAt: "2026-08-06T09:00:00+09:00",
            endAt: "2026-08-06T10:00:00+09:00",
        };

        expect(buildCalendarYearScheduleCounts([older, newer])).toEqual({
            "2026-08-06": 1,
        });
    });

    test("uses local dates and keeps midnight end exclusive for multi-day schedules", () => {
        const counts = buildCalendarYearScheduleCounts([
            schedule(
                "trip",
                "2026-08-09T15:30:00Z",
                "2026-08-12T15:00:00Z",
                true
            ),
            schedule(
                "overlap",
                "2026-08-11T12:00:00+09:00",
                "2026-08-11T13:00:00+09:00"
            ),
        ]);

        expect(counts).toEqual({
            "2026-08-10": 1,
            "2026-08-11": 2,
            "2026-08-12": 1,
        });
        expect(counts["2026-08-13"]).toBeUndefined();
    });

    test("splits a year into two contiguous ranges below the backend limit", () => {
        const ranges = getCalendarYearScheduleFetchRanges(2026);
        const firstStart = new Date(ranges[0].startAt);
        const firstEnd = new Date(ranges[0].endAt);
        const secondStart = new Date(ranges[1].startAt);
        const secondEnd = new Date(ranges[1].endAt);
        const maxRangeMs = 190 * 24 * 60 * 60 * 1000;

        expect(ranges).toHaveLength(2);
        expect([firstStart.getFullYear(), firstStart.getMonth(), firstStart.getDate()])
            .toEqual([2026, 0, 1]);
        expect(firstEnd.getTime() + 1).toBe(secondStart.getTime());
        expect([secondEnd.getFullYear(), secondEnd.getMonth(), secondEnd.getDate()])
            .toEqual([2026, 11, 31]);
        expect(firstEnd.getTime() - firstStart.getTime()).toBeLessThan(maxRangeMs);
        expect(secondEnd.getTime() - secondStart.getTime()).toBeLessThan(maxRangeMs);
    });

    test("deduplicates a boundary schedule by id and keeps the latest item", () => {
        const older = schedule(
            "boundary",
            "2026-06-30T23:00:00+09:00",
            "2026-07-01T01:00:00+09:00"
        );
        const newer = { ...older, title: "updated" };

        expect(mergeCalendarYearScheduleItems([older, newer])).toEqual([newer]);
    });
});
