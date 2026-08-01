const mockCreateSchedule = jest.fn();
const mockRecoverDepartureAlarmsAfterMutation = jest.fn();

jest.mock("../src/api/schedule", () => ({
    createSchedule: (...args: unknown[]) => mockCreateSchedule(...args),
}));
jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
}));

import { createScheduleForAddItem } from "../src/modules/schedule/scheduleCreateMutation";
import type { SchedulePayload } from "../src/api/schedule";
import type { ScheduleItem } from "../src/modules/schedule/types";

const payload: SchedulePayload = {
    title: "공통 등록 경로",
    startAt: "2099-07-29T03:00:00Z",
    endAt: "2099-07-29T04:00:00Z",
    category: { id: "1", title: "업무", color: "#2979FF" },
};

const createdItem: ScheduleItem = {
    ...payload,
    id: "41",
};

describe("manual and Quick schedule add-item mutation", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
    });

    it("returns the created item after exactly one recovery", async () => {
        mockCreateSchedule.mockResolvedValue(createdItem);

        await expect(createScheduleForAddItem(payload)).resolves.toBe(createdItem);

        expect(mockCreateSchedule).toHaveBeenCalledTimes(1);
        expect(mockCreateSchedule).toHaveBeenCalledWith(payload);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockCreateSchedule.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
    });

    it("does not recover and preserves the original error when creation fails", async () => {
        const creationError = new Error("create failed");
        mockCreateSchedule.mockRejectedValue(creationError);

        await expect(createScheduleForAddItem(payload)).rejects.toBe(creationError);

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
    });
});
