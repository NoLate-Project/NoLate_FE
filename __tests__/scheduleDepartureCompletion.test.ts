const mockMarkScheduleDeparted = jest.fn();
const mockRecoverDepartureAlarmsAfterMutation = jest.fn();
const mockEndLiveActivity = jest.fn();
let mockJourneyEnabled = false;

jest.mock("../src/modules/journey/journeyFeature", () => ({
    isJourneyGuidanceEnabled: () => mockJourneyEnabled,
}));
jest.mock("../src/modules/notification/liveActivitySync", () => ({
    endLiveActivityForSchedule: (...args: unknown[]) => mockEndLiveActivity(...args),
}));

jest.mock("../src/api/schedule", () => ({
    markScheduleDeparted: (...args: unknown[]) =>
        mockMarkScheduleDeparted(...args),
}));

jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
}));

import { completeScheduleDeparture } from "../src/modules/schedule/scheduleDepartureCompletion";
import type { ScheduleItem } from "../src/modules/schedule/types";

const completedSchedule: ScheduleItem = {
    id: "41",
    title: "회의",
    startAt: "2026-07-30T01:00:00.000Z",
    endAt: "2026-07-30T02:00:00.000Z",
    category: {
        id: "1",
        title: "업무",
        color: "#2F80FF",
    },
    myDepartedAt: "2026-07-30T00:30:00.000Z",
};

describe("schedule detail departure completion", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockJourneyEnabled = false;
        mockEndLiveActivity.mockResolvedValue(undefined);
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
    });

    it("recovers exactly once after the detail departure mutation succeeds", async () => {
        mockMarkScheduleDeparted.mockResolvedValue(completedSchedule);

        await expect(completeScheduleDeparture("41"))
            .resolves.toBe(completedSchedule);

        expect(mockMarkScheduleDeparted).toHaveBeenCalledWith("41");
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockEndLiveActivity).toHaveBeenCalledWith("41");
        expect(mockMarkScheduleDeparted.mock.invocationCallOrder[0])
            .toBeLessThan(
                mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0],
            );
    });

    it("does not recover when the detail departure mutation fails", async () => {
        const mutationError = new Error("depart failed");
        mockMarkScheduleDeparted.mockRejectedValue(mutationError);

        await expect(completeScheduleDeparture("41"))
            .rejects.toBe(mutationError);

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
    });

    it("lets the server fence late departure cleanup while the journey pilot is enabled", async () => {
        mockJourneyEnabled = true;
        mockMarkScheduleDeparted.mockResolvedValue(completedSchedule);
        await completeScheduleDeparture("41");
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockEndLiveActivity).not.toHaveBeenCalled();
    });
});
