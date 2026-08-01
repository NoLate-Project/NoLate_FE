const mockRecoverDepartureAlarmsAfterMutationBatch = jest.fn();

jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutationBatch: (...args: unknown[]) =>
        mockRecoverDepartureAlarmsAfterMutationBatch(...args),
}));

import { createCalendarImportAlarmRecoveryBatch } from "../src/modules/onboarding/calendarImportAlarmRecoveryBatch";

describe("calendar import callsite alarm recovery batch", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRecoverDepartureAlarmsAfterMutationBatch.mockResolvedValue(undefined);
    });

    it("recovers exactly once for a created, duplicate, and failed mixed batch", async () => {
        const batch = createCalendarImportAlarmRecoveryBatch();
        const created = { id: "created", created: true };
        const duplicate = { id: "duplicate", created: false };
        const failure = new Error("one import failed");

        await expect(batch.run(async () => created)).resolves.toBe(created);
        await expect(batch.run(async () => duplicate)).resolves.toBe(duplicate);
        await expect(batch.run(async () => {
            throw failure;
        })).rejects.toBe(failure);
        await batch.finish();
        await batch.finish();

        expect(mockRecoverDepartureAlarmsAfterMutationBatch).toHaveBeenCalledTimes(1);
        expect(mockRecoverDepartureAlarmsAfterMutationBatch).toHaveBeenCalledWith(1);
    });

    it("recovers once after multiple schedules are created", async () => {
        const batch = createCalendarImportAlarmRecoveryBatch();

        await batch.run(async () => ({ created: true }));
        await batch.run(async () => ({ created: true }));
        await batch.run(async () => ({ created: false }));
        await batch.finish();

        expect(mockRecoverDepartureAlarmsAfterMutationBatch).toHaveBeenCalledTimes(1);
        expect(mockRecoverDepartureAlarmsAfterMutationBatch).toHaveBeenCalledWith(2);
    });

    it("does not recover when duplicates and failures create no schedules", async () => {
        const batch = createCalendarImportAlarmRecoveryBatch();

        await batch.run(async () => ({ created: false }));
        await expect(batch.run(async () => {
            throw new Error("failed import");
        })).rejects.toThrow("failed import");
        await batch.finish();

        expect(mockRecoverDepartureAlarmsAfterMutationBatch).not.toHaveBeenCalled();
    });
});
