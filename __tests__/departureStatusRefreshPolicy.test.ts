import {
    DEPARTURE_STATUS_FALLBACK_REFRESH_DELAY_MS,
    DEPARTURE_STATUS_MAX_REFRESH_DELAY_MS,
    DEPARTURE_STATUS_MIN_REFRESH_DELAY_MS,
    DEPARTURE_STATUS_REFRESH_GRACE_MS,
    getDepartureStatusRefreshDelay,
} from "../src/modules/schedule/departureStatusRefreshPolicy";

describe("departure status refresh timer policy", () => {
    const nowMs = Date.parse("2026-08-10T00:00:00Z");

    it("waits just beyond the worker next-check boundary", () => {
        expect(getDepartureStatusRefreshDelay({
            nextCheckAt: "2026-08-10T00:01:00Z",
            nowMs,
        })).toBe(60_000 + DEPARTURE_STATUS_REFRESH_GRACE_MS);
    });

    it("prevents an overdue nextCheckAt from creating a tight polling loop", () => {
        expect(getDepartureStatusRefreshDelay({
            nextCheckAt: "2026-08-09T23:59:00Z",
            nowMs,
        })).toBe(DEPARTURE_STATUS_MIN_REFRESH_DELAY_MS);
    });

    it("caps unusually distant server hints for a long-open screen", () => {
        expect(getDepartureStatusRefreshDelay({
            nextCheckAt: "2026-08-10T01:00:00Z",
            nowMs,
        })).toBe(DEPARTURE_STATUS_MAX_REFRESH_DELAY_MS);
    });

    it.each([null, undefined, "invalid"])(
        "uses a bounded fallback for a missing or invalid nextCheckAt (%s)",
        (nextCheckAt) => {
            expect(getDepartureStatusRefreshDelay({ nextCheckAt, nowMs }))
                .toBe(DEPARTURE_STATUS_FALLBACK_REFRESH_DELAY_MS);
        },
    );
});
