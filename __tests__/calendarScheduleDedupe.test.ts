import { dedupeCalendarSchedules } from "../src/modules/schedule/calendarScheduleDedupe";
import type { ScheduleItem } from "../src/modules/schedule/types";

const base: ScheduleItem = {
    id: "holiday-1",
    title: "제헌절",
    startAt: "2026-07-17T00:00:00+09:00",
    endAt: "2026-07-18T00:00:00+09:00",
    allDay: true,
    category: { id: "holiday", title: "공휴일", color: "#ff0000" },
    travelMode: "TRANSIT",
};

describe("calendar schedule deduplication", () => {
    test("collapses duplicate all-day holidays from overlapping imports", () => {
        expect(dedupeCalendarSchedules([base, { ...base, id: "holiday-2" }])).toEqual([base]);
    });

    test("keeps timed schedules even when their title and time match", () => {
        const timed = { ...base, allDay: false };
        expect(dedupeCalendarSchedules([timed, { ...timed, id: "timed-2" }])).toHaveLength(2);
    });
});
