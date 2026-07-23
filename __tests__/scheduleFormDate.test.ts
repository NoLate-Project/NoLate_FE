import {
    formatScheduleFormDate,
    getDefaultScheduleFormStart,
    getDefaultScheduleStartTime,
    getScheduleAllDayFormEndDay,
    getScheduleCalendarDateKey,
    normalizeScheduleFormRange,
    startOfLocalScheduleDay,
} from "../src/modules/schedule/scheduleFormDate";

describe("schedule form date presentation", () => {
    it("computes the default start time from the moment the form opens", () => {
        const openedAt = new Date(2026, 6, 17, 17, 15, 48, 320);
        const start = getDefaultScheduleStartTime(openedAt);

        expect(start.getHours()).toBe(17);
        expect(start.getMinutes()).toBe(45);
        expect(start.getSeconds()).toBe(0);
        expect(start.getMilliseconds()).toBe(0);
        expect(openedAt.getMinutes()).toBe(15);
    });

    it("moves today's default date across midnight together with the 30-minute start time", () => {
        const openedAt = new Date(2026, 6, 17, 23, 45);
        const next = getDefaultScheduleFormStart("2026-07-17", openedAt);

        expect(getScheduleCalendarDateKey(next.startDay)).toBe("2026-07-18");
        expect(next.startTime.getHours()).toBe(0);
        expect(next.startTime.getMinutes()).toBe(15);
    });

    it("preserves an explicitly selected non-today date", () => {
        const openedAt = new Date(2026, 6, 17, 23, 45);
        const next = getDefaultScheduleFormStart("2026-07-20", openedAt);

        expect(getScheduleCalendarDateKey(next.startDay)).toBe("2026-07-20");
        expect(next.startTime.getHours()).toBe(0);
        expect(next.startTime.getMinutes()).toBe(15);
    });

    it("keeps the display label separate from the calendar date key", () => {
        const date = new Date(2026, 6, 17, 7, 30);

        expect(formatScheduleFormDate(date)).toBe("2026. 7. 17.");
        expect(getScheduleCalendarDateKey(date)).toBe("2026-07-17");
    });

    it("preserves the local calendar day when normalizing to midnight", () => {
        const date = new Date(2026, 6, 17, 1, 5);
        const normalized = startOfLocalScheduleDay(date);

        expect(getScheduleCalendarDateKey(normalized)).toBe("2026-07-17");
        expect(normalized.getHours()).toBe(0);
        expect(normalized.getMinutes()).toBe(0);
    });

    it("saves a same-day all-day edit with an exclusive next-midnight end", () => {
        const day = new Date(2026, 6, 17, 13, 20);
        const range = normalizeScheduleFormRange({
            startDay: day,
            startTime: new Date(2026, 6, 17, 9, 30),
            endDay: day,
            endTime: new Date(2026, 6, 17, 9, 30),
            allDay: true,
            hasEndTime: false,
        });

        expect(getScheduleCalendarDateKey(range.startAt)).toBe("2026-07-17");
        expect(getScheduleCalendarDateKey(range.endAt)).toBe("2026-07-18");
        expect(range.startAt.getHours()).toBe(0);
        expect(range.endAt.getHours()).toBe(0);
        expect(range.endAt.getTime()).toBeGreaterThan(range.startAt.getTime());
        expect(range.hasEndTime).toBe(false);
        expect(range.allDay).toBe(true);
    });

    it("round-trips a stored exclusive all-day end through the inclusive form day", () => {
        const startAt = new Date(2026, 6, 17);
        const storedEndAt = new Date(2026, 6, 20);
        const formEndDay = getScheduleAllDayFormEndDay(startAt, storedEndAt);
        const range = normalizeScheduleFormRange({
            startDay: startAt,
            startTime: startAt,
            endDay: formEndDay,
            endTime: formEndDay,
            allDay: true,
            hasEndTime: false,
        });

        expect(getScheduleCalendarDateKey(formEndDay)).toBe("2026-07-19");
        expect(getScheduleCalendarDateKey(range.endAt)).toBe("2026-07-20");
    });

    it("keeps timed payloads explicitly non-all-day", () => {
        const range = normalizeScheduleFormRange({
            startDay: new Date(2026, 6, 17),
            startTime: new Date(2026, 6, 17, 19),
            endDay: new Date(2026, 6, 17),
            endTime: new Date(2026, 6, 17, 20),
            allDay: false,
            hasEndTime: true,
        });

        expect(range.allDay).toBe(false);
        expect(range.hasEndTime).toBe(true);
    });
});
