import { canSendDepartureNudge } from "../src/modules/schedule/detailPresentation";
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
});
