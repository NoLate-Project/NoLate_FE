import {
    getScheduleCountdownPresentation,
    resolveScheduleCountdownEndAt,
} from "../src/modules/schedule/detailPresentation";

describe("all-day schedule status", () => {
    test("keeps a zero-duration all-day event active until the next midnight", () => {
        const start = new Date(2026, 6, 17, 0, 0, 0, 0).getTime();
        const end = resolveScheduleCountdownEndAt({
            startAtMs: start,
            endAtMs: start,
            hasEndTime: false,
            allDay: true,
        });

        expect(end).toBe(new Date(2026, 6, 18, 0, 0, 0, 0).getTime());
        expect(getScheduleCountdownPresentation(start, end, start + 12 * 60 * 60 * 1000).phase).toBe("active");
    });

    test("does not add an artificial duration to a normal point-in-time event", () => {
        expect(resolveScheduleCountdownEndAt({
            startAtMs: 100,
            endAtMs: 100,
            hasEndTime: false,
            allDay: false,
        })).toBeUndefined();
    });
});
