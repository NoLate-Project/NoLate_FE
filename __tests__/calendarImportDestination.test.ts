import { buildSchedulePayloadFromCandidate } from "../src/modules/onboarding/deviceCalendarImport";

const candidate = {
    id: "candidate-1",
    provider: "APPLE_DEVICE" as const,
    eventId: "event-1",
    calendarId: "source-calendar",
    calendarTitle: "Apple 개인",
    title: "회의",
    startAt: "2026-08-20T01:00:00.000Z",
    endAt: "2026-08-20T02:00:00.000Z",
    allDay: false,
    requiresTimeReview: false,
};

describe("calendar import destination", () => {
    test("copies the selected shared category calendar into the schedule payload", () => {
        const payload = buildSchedulePayloadFromCandidate(candidate, {
            category: {
                id: "category-21",
                title: "팀 업무",
                color: "#246BFE",
                calendarId: 21,
                shared: true,
                sharePermission: "EDITOR",
            },
            travelMode: "TRANSIT",
            travelMinutes: 30,
            prepareDepartureAlert: false,
        });

        expect(payload.calendarId).toBe(21);
    });

    test("keeps a personal category in the personal calendar", () => {
        const payload = buildSchedulePayloadFromCandidate(candidate, {
            category: { id: "personal", title: "개인", color: "#2196f3" },
            travelMode: "TRANSIT",
            travelMinutes: 30,
            prepareDepartureAlert: false,
        });

        expect(payload.calendarId).toBeUndefined();
    });
});
