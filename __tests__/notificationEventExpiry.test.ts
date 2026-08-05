import { isNotificationEtaEventFresh } from "../src/modules/notification/notificationEventExpiry";

const NOW = Date.parse("2026-08-06T01:00:00.000Z");

describe("notification ETA event expiration", () => {
    test("requires expiration for every standard departure reminder action contract", () => {
        expect(isNotificationEtaEventFresh({
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "41",
            recipientMemberId: "7",
            actionEventKey: `key:${"a".repeat(64)}`,
        }, NOW)).toBe(false);
        expect(isNotificationEtaEventFresh({ type: "LEGACY_VISIBLE_PUSH" }, NOW)).toBe(true);
    });

    test("accepts only future strict ISO instants with an explicit timezone", () => {
        expect(isNotificationEtaEventFresh({
            type: "SCHEDULE_DEPARTURE_REMINDER",
            etaEventExpiresAt: "2026-08-06T10:01:00+09:00",
        }, NOW)).toBe(true);
        expect(isNotificationEtaEventFresh({
            type: "SCHEDULE_DEPARTURE_REMINDER",
            etaEventExpiresAt: "2026-08-06T01:01:00.123456789Z",
        }, NOW)).toBe(true);
        for (const invalid of [
            "2026-08-07",
            "Thu, 06 Aug 2026 01:01:00 GMT",
            " 2026-08-06T01:01:00Z ",
            "2026-08-06T01:01:00",
            "2026-02-30T01:01:00Z",
        ]) {
            expect(isNotificationEtaEventFresh({
                type: "SCHEDULE_DEPARTURE_REMINDER",
                etaEventExpiresAt: invalid,
            }, NOW)).toBe(false);
        }
    });
});
