const mockOptionalNativeModule = jest.fn();

jest.mock("expo-modules-core", () => ({
    requireOptionalNativeModule: (...args: unknown[]) => mockOptionalNativeModule(...args),
}));

import {
    applyDepartureAlarmCommand,
    clearAllDepartureAlarms,
    getDepartureAlarmCapabilities,
    getPendingNativeAlarmFireEvents,
    removePendingNativeAlarmFireEvent,
    resetDepartureAlarmNativeModuleForTests,
    scheduleDepartureTestAlarm,
} from "../src/modules/notification/departureAlarm";

describe("departure alarm native facade", () => {
    beforeEach(() => {
        mockOptionalNativeModule.mockReset();
        resetDepartureAlarmNativeModuleForTests();
    });

    it("routes upsert and cancel through distinct native methods", async () => {
        const upsertAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: true });
        const cancelAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: false });
        mockOptionalNativeModule.mockReturnValue({
            upsertAlarm,
            cancelAlarm,
            getCapabilities: jest.fn(),
            getScheduledAlarms: jest.fn(),
            openExactAlarmSettings: jest.fn(),
            openFullScreenSettings: jest.fn(),
            scheduleTestAlarm: jest.fn(),
            stopRinging: jest.fn(),
            clearAllAlarms: jest.fn(),
        });

        await applyDepartureAlarmCommand({
            operation: "UPSERT",
            alarmId: "schedule:1",
            scheduleId: "1",
            generation: 2,
            recipientMemberId: 7,
            logicalEventKey: "event:alarm-1",
            triggerAt: "2026-07-29T03:00:00Z",
        });
        await applyDepartureAlarmCommand({
            operation: "CANCEL",
            alarmId: "schedule:1",
            scheduleId: "1",
            generation: 3,
            recipientMemberId: 7,
        });

        expect(upsertAlarm).toHaveBeenCalledTimes(1);
        expect(cancelAlarm).toHaveBeenCalledWith({
            alarmId: "schedule:1",
            scheduleId: "1",
            generation: 3,
        });
    });

    it("returns a safe unsupported result when the native module is absent", async () => {
        mockOptionalNativeModule.mockReturnValue(null);

        await expect(getDepartureAlarmCapabilities()).resolves.toMatchObject({
            supported: false,
            reason: "NATIVE_MODULE_UNAVAILABLE",
        });
        await expect(scheduleDepartureTestAlarm(1)).resolves.toEqual({
            applied: false,
            scheduled: false,
            reason: "NATIVE_MODULE_UNAVAILABLE",
        });
    });

    it("clamps test alarm delay before crossing the bridge", async () => {
        const scheduleTestAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: true });
        mockOptionalNativeModule.mockReturnValue({
            upsertAlarm: jest.fn(),
            cancelAlarm: jest.fn(),
            getCapabilities: jest.fn(),
            getScheduledAlarms: jest.fn(),
            openExactAlarmSettings: jest.fn(),
            openFullScreenSettings: jest.fn(),
            scheduleTestAlarm,
            stopRinging: jest.fn(),
            clearAllAlarms: jest.fn(),
        });

        await scheduleDepartureTestAlarm(1);
        await scheduleDepartureTestAlarm(90);

        expect(scheduleTestAlarm).toHaveBeenNthCalledWith(1, 3);
        expect(scheduleTestAlarm).toHaveBeenNthCalledWith(2, 60);
    });

    it("clears all account-owned native alarms through one bridge call", async () => {
        const clearAllAlarms = jest.fn().mockResolvedValue(true);
        mockOptionalNativeModule.mockReturnValue({
            upsertAlarm: jest.fn(),
            cancelAlarm: jest.fn(),
            getCapabilities: jest.fn(),
            getScheduledAlarms: jest.fn(),
            openExactAlarmSettings: jest.fn(),
            openFullScreenSettings: jest.fn(),
            scheduleTestAlarm: jest.fn(),
            stopRinging: jest.fn(),
            clearAllAlarms,
        });

        await expect(clearAllDepartureAlarms()).resolves.toBe(true);
        expect(clearAllAlarms).toHaveBeenCalledTimes(1);
    });

    it("validates native fire journal records before exposing them to authenticated JS", async () => {
        const getPendingAlarmFireEvents = jest.fn().mockResolvedValue([
            {
                eventId: "a7360f46-4f44-48b6-ae93-28f11c3f667d",
                alarmId: "schedule:41:member:7",
                scheduleId: "41",
                generation: 3,
                recipientMemberId: 7,
                scheduledFor: "2026-08-01T01:00:00.000Z",
                sourceTriggerAt: "2026-08-01T00:55:00.000Z",
                occurredAt: "2026-08-01T01:00:02.000Z",
            },
            {
                eventId: "0f0d8a6e-1dda-4ba6-9ccb-7414c7cb0cf7",
                alarmId: "schedule:42:member:7",
                scheduleId: "42",
                generation: 1,
                recipientMemberId: 7,
                scheduledFor: "2026-08-01T02:00:00.000Z",
                sourceTriggerAt: "2026-08-01T02:00:00.000Z",
                occurredAt: "2026-08-01T02:00:00.000Z",
                timingBasis: "INFERRED_OS_DELIVERY",
            },
            { eventId: "corrupt", recipientMemberId: 7 },
        ]);
        mockOptionalNativeModule.mockReturnValue({ getPendingAlarmFireEvents });

        await expect(getPendingNativeAlarmFireEvents()).resolves.toEqual([
            expect.objectContaining({
                eventId: "a7360f46-4f44-48b6-ae93-28f11c3f667d",
                timingBasis: "OBSERVED_ALERTING",
            }),
            expect.objectContaining({
                eventId: "0f0d8a6e-1dda-4ba6-9ccb-7414c7cb0cf7",
                timingBasis: "INFERRED_OS_DELIVERY",
            }),
        ]);
    });

    it("keeps OTA updates safe when an older native binary lacks journal methods", async () => {
        mockOptionalNativeModule.mockReturnValue({});

        await expect(getPendingNativeAlarmFireEvents()).resolves.toEqual([]);
        await expect(removePendingNativeAlarmFireEvent("event-1")).resolves.toBe(false);
    });
});
