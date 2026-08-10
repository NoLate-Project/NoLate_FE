import { canSendDepartureNudge } from "../src/modules/schedule/detailPresentation";
import { classifyDepartureNudgeResult } from "../src/modules/schedule/departureNudgeResult";
import type { ScheduleDepartureParticipant } from "../src/modules/schedule/types";

const waitingSharedParticipant: ScheduleDepartureParticipant = {
    memberId: 2,
    email: "target@example.com",
    role: "SHARED",
    departed: false,
};

describe("schedule departure nudge presentation", () => {
    test("only the schedule owner can nudge a waiting shared participant", () => {
        expect(canSendDepartureNudge(waitingSharedParticipant, 1, 1)).toBe(true);
        expect(canSendDepartureNudge(waitingSharedParticipant, 3, 1)).toBe(false);
    });

    test("does not expose nudge for owner, self, departed participant, or unknown ownership", () => {
        expect(canSendDepartureNudge(
            { ...waitingSharedParticipant, memberId: 1, role: "OWNER" },
            1,
            1
        )).toBe(false);
        expect(canSendDepartureNudge(
            { ...waitingSharedParticipant, memberId: 1 },
            1,
            1
        )).toBe(false);
        expect(canSendDepartureNudge(
            { ...waitingSharedParticipant, departed: true },
            1,
            1
        )).toBe(false);
        expect(canSendDepartureNudge(waitingSharedParticipant, 1, undefined)).toBe(false);
    });

    test("treats a durable queued response as accepted before provider dispatch", () => {
        expect(classifyDepartureNudgeResult({
            requestedCount: 1,
            attemptedCount: 0,
            sentCount: 0,
            failedCount: 0,
            removedTokenCount: 0,
            eventSnapshot: { id: 101, type: "SCHEDULE_DEPARTURE_NUDGE" },
            fenceRejected: false,
            recipientInactive: false,
        })).toBe("accepted");
    });

    test("accepts an inbox-only durable nudge even without a registered push device", () => {
        expect(classifyDepartureNudgeResult({
            requestedCount: 0,
            attemptedCount: 0,
            sentCount: 0,
            failedCount: 0,
            removedTokenCount: 0,
            eventSnapshot: { id: 102, type: "SCHEDULE_DEPARTURE_NUDGE" },
        })).toBe("accepted");
    });

    test("keeps legacy no-device and rejected responses distinct from accepted events", () => {
        expect(classifyDepartureNudgeResult({
            requestedCount: 0,
            sentCount: 0,
            failedCount: 0,
            removedTokenCount: 0,
        })).toBe("no_registered_device");

        expect(classifyDepartureNudgeResult({
            requestedCount: 1,
            sentCount: 0,
            failedCount: 0,
            removedTokenCount: 0,
            eventSnapshot: { id: 103 },
            fenceRejected: true,
        })).toBe("failed");
    });
});
