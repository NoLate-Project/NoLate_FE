const mockOptionalNativeModule = jest.fn();

jest.mock("expo-modules-core", () => ({
    requireOptionalNativeModule: (...args: unknown[]) => mockOptionalNativeModule(...args),
}));

import { Platform } from "react-native";

import {
    applyDepartureAlarmCommand,
    applyDepartureAlarmPlanCommand,
    clearAllDepartureAlarms,
    getDepartureAlarmCapabilities,
    getNativeNoLateAlarmSoundPreference,
    getPendingNativeAlarmFireEvents,
    recordNativeAlarmNotificationResponseFire,
    removePendingNativeAlarmFireEvent,
    resetDepartureAlarmNativeModuleForTests,
    scheduleDepartureTestAlarm,
    scheduleNoLateCustomAlarmPreview,
    setNativeNoLateAlarmSoundPreference,
} from "../src/modules/notification/departureAlarm";

describe("departure alarm native facade", () => {
    const originalPlatform = Platform.OS;

    beforeEach(() => {
        mockOptionalNativeModule.mockReset();
        resetDepartureAlarmNativeModuleForTests();
        Object.defineProperty(Platform, "OS", {
            configurable: true,
            value: originalPlatform,
        });
    });

    afterAll(() => {
        Object.defineProperty(Platform, "OS", {
            configurable: true,
            value: originalPlatform,
        });
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
            logicalAlarmId: "schedule:1",
            scheduleId: "1",
            generation: 3,
        });
    });

    it("removes every v2 occurrence before replacing a plan with a legacy snooze", async () => {
        const upsertAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: true });
        const cancelAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: false });
        mockOptionalNativeModule.mockReturnValue({ upsertAlarm, cancelAlarm });
        const alarmId = "schedule:41:member:7";
        const command = {
            operation: "UPSERT" as const,
            alarmId,
            scheduleId: "41",
            generation: 9,
            recipientMemberId: 7,
            triggerAt: "2099-08-04T01:25:00Z",
            title: "5분 뒤 다시 알림",
            snoozeMinutes: 5,
        };

        await expect(applyDepartureAlarmPlanCommand({
            ...command,
            planSchemaVersion: 1,
            validationRevision: 0,
            occurrences: [command],
        })).resolves.toEqual([
            { command, result: { applied: true, scheduled: true } },
        ]);

        expect(cancelAlarm.mock.calls.map(([call]) => call.alarmId)).toEqual([
            `${alarmId}:occurrence:M15`,
            `${alarmId}:occurrence:M10`,
            `${alarmId}:occurrence:M5`,
            `${alarmId}:occurrence:M0`,
        ]);
        expect(upsertAlarm).toHaveBeenCalledWith(expect.objectContaining({
            alarmId,
            logicalAlarmId: alarmId,
        }));
        expect(cancelAlarm.mock.invocationCallOrder.at(-1)).toBeLessThan(
            upsertAlarm.mock.invocationCallOrder[0],
        );
    });

    it("does not install a legacy snooze when v2 occurrence cleanup fails", async () => {
        const upsertAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: true });
        const cancelAlarm = jest.fn()
            .mockResolvedValueOnce({ applied: true, scheduled: false })
            .mockResolvedValueOnce({
                applied: false,
                scheduled: false,
                reason: "NATIVE_STATE_ERROR:disk",
            });
        mockOptionalNativeModule.mockReturnValue({ upsertAlarm, cancelAlarm });
        const alarmId = "schedule:41:member:7";
        const command = {
            operation: "UPSERT" as const,
            alarmId,
            scheduleId: "41",
            generation: 9,
            recipientMemberId: 7,
            triggerAt: "2099-08-04T01:25:00Z",
            title: "5분 뒤 다시 알림",
            snoozeMinutes: 5,
        };

        await expect(applyDepartureAlarmPlanCommand({
            ...command,
            planSchemaVersion: 1,
            validationRevision: 0,
            occurrences: [command],
        })).resolves.toEqual([{
            command,
            result: {
                applied: false,
                scheduled: false,
                reason: "PREREQUISITE_CANCEL_FAILED:NATIVE_STATE_ERROR:disk",
            },
        }]);
        expect(cancelAlarm).toHaveBeenCalledTimes(2);
        expect(upsertAlarm).not.toHaveBeenCalled();
    });

    it("tombstones elapsed/missing v2 slots and schedules only future occurrences", async () => {
        const upsertAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: true });
        const cancelAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: false });
        mockOptionalNativeModule.mockReturnValue({ upsertAlarm, cancelAlarm });

        const base = {
            operation: "UPSERT" as const,
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            generation: 8,
            recipientMemberId: 7,
            snoozeMinutes: 5,
        };
        const occurrences = [
            {
                ...base,
                occurrenceId: "M15" as const,
                nativeAlarmId: "schedule:41:member:7:occurrence:M15",
                triggerAt: "2026-08-04T00:59:00Z",
                title: "15분 전",
                body: "과거 알림",
                decision: "ADVANCE_NOTICE" as const,
                minutesBeforeDeparture: 15 as const,
                actionEventKey: `key:${"a".repeat(64)}`,
            },
            {
                ...base,
                occurrenceId: "M10" as const,
                nativeAlarmId: "schedule:41:member:7:occurrence:M10",
                triggerAt: "2026-08-04T01:10:00Z",
                title: "10분 전",
                body: "미리 출발을 준비하세요.",
                decision: "ADVANCE_NOTICE" as const,
                minutesBeforeDeparture: 10 as const,
                actionEventKey: `key:${"b".repeat(64)}`,
            },
            {
                ...base,
                occurrenceId: "M0" as const,
                nativeAlarmId: "schedule:41:member:7:occurrence:M0",
                triggerAt: "2026-08-04T01:20:00Z",
                title: "지금 출발",
                body: "지금 출발하세요.",
                decision: "DEPART_NOW" as const,
                minutesBeforeDeparture: 0 as const,
                actionEventKey: `key:${"c".repeat(64)}`,
            },
        ];

        const executions = await applyDepartureAlarmPlanCommand({
            ...base,
            planSchemaVersion: 2,
            validationRevision: 0,
            occurrences,
        }, Date.parse("2026-08-04T01:00:00Z"));

        expect(cancelAlarm).toHaveBeenCalledWith(expect.objectContaining({
            alarmId: "schedule:41:member:7",
            logicalAlarmId: "schedule:41:member:7",
            generation: 8,
        }));
        expect(cancelAlarm).toHaveBeenCalledWith(expect.objectContaining({
            alarmId: "schedule:41:member:7:occurrence:M15",
        }));
        expect(cancelAlarm).toHaveBeenCalledWith(expect.objectContaining({
            alarmId: "schedule:41:member:7:occurrence:M5",
        }));
        expect(upsertAlarm).toHaveBeenCalledTimes(2);
        expect(upsertAlarm).toHaveBeenNthCalledWith(1, expect.objectContaining({
            alarmId: "schedule:41:member:7:occurrence:M10",
            logicalAlarmId: "schedule:41:member:7",
            occurrenceId: "M10",
        }));
        expect(executions.map((execution) => execution.command.occurrenceId)).toEqual(["M10", "M0"]);
    });

    it("withholds every future occurrence when obsolete-id cancellation fails", async () => {
        const upsertAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: true });
        const cancelAlarm = jest.fn().mockResolvedValue({
            applied: false,
            scheduled: false,
            reason: "NATIVE_STATE_ERROR:disk",
        });
        mockOptionalNativeModule.mockReturnValue({ upsertAlarm, cancelAlarm });
        const alarmId = "schedule:41:member:7";
        const occurrence = {
            operation: "UPSERT" as const,
            alarmId,
            nativeAlarmId: `${alarmId}:occurrence:M0`,
            scheduleId: "41",
            generation: 8,
            validationRevision: 0,
            recipientMemberId: 7,
            occurrenceId: "M0" as const,
            triggerAt: "2099-08-04T01:20:00Z",
            title: "지금 출발",
            body: "지금 출발하세요.",
            decision: "DEPART_NOW" as const,
            minutesBeforeDeparture: 0 as const,
            actionEventKey: `key:${"c".repeat(64)}`,
            snoozeMinutes: 5,
        };

        await expect(applyDepartureAlarmPlanCommand({
            operation: "UPSERT",
            alarmId,
            scheduleId: "41",
            generation: 8,
            validationRevision: 0,
            recipientMemberId: 7,
            planSchemaVersion: 2,
            occurrences: [occurrence],
        }, Date.parse("2026-08-04T01:00:00Z"))).resolves.toEqual([
            expect.objectContaining({
                command: occurrence,
                result: expect.objectContaining({
                    scheduled: false,
                    reason: "PREREQUISITE_CANCEL_FAILED:NATIVE_STATE_ERROR:disk",
                }),
            }),
        ]);
        expect(upsertAlarm).not.toHaveBeenCalled();
    });

    it("keeps the successful occurrence prefix when a later upsert fails", async () => {
        const upsertAlarm = jest.fn()
            .mockResolvedValueOnce({ applied: true, scheduled: true })
            .mockResolvedValueOnce({ applied: false, scheduled: false, reason: "QUOTA" });
        const cancelAlarm = jest.fn().mockResolvedValue({ applied: true, scheduled: false });
        mockOptionalNativeModule.mockReturnValue({ upsertAlarm, cancelAlarm });
        const alarmId = "schedule:41:member:7";
        const common = {
            operation: "UPSERT" as const,
            alarmId,
            scheduleId: "41",
            generation: 8,
            recipientMemberId: 7,
            snoozeMinutes: 5,
        };
        const occurrences = [
            {
                ...common,
                nativeAlarmId: `${alarmId}:occurrence:M15`,
                occurrenceId: "M15" as const,
                triggerAt: "2099-08-04T01:05:00Z",
                title: "15분 전",
                body: "준비하세요.",
                decision: "ADVANCE_NOTICE" as const,
                minutesBeforeDeparture: 15 as const,
                actionEventKey: `key:${"a".repeat(64)}`,
            },
            {
                ...common,
                nativeAlarmId: `${alarmId}:occurrence:M10`,
                occurrenceId: "M10" as const,
                triggerAt: "2099-08-04T01:10:00Z",
                title: "10분 전",
                body: "곧 출발하세요.",
                decision: "ADVANCE_NOTICE" as const,
                minutesBeforeDeparture: 10 as const,
                actionEventKey: `key:${"b".repeat(64)}`,
            },
        ];

        const executions = await applyDepartureAlarmPlanCommand({
            ...common,
            planSchemaVersion: 2,
            validationRevision: 0,
            occurrences,
        }, Date.parse("2026-08-04T01:00:00Z"));

        expect(executions).toEqual([
            { command: occurrences[0], result: { applied: true, scheduled: true } },
            {
                command: occurrences[1],
                result: { applied: false, scheduled: false, reason: "QUOTA" },
            },
        ]);
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

    it("reads and writes only whitelisted NoLate alarm sound ids", async () => {
        const getAlarmSoundPreference = jest.fn().mockResolvedValue("BELL");
        const setAlarmSoundPreference = jest.fn().mockResolvedValue(true);
        mockOptionalNativeModule.mockReturnValue({
            getAlarmSoundPreference,
            setAlarmSoundPreference,
        });

        await expect(getNativeNoLateAlarmSoundPreference()).resolves.toBe("BELL");
        await expect(setNativeNoLateAlarmSoundPreference("BEEP")).resolves.toBe(true);
        expect(setAlarmSoundPreference).toHaveBeenCalledWith("BEEP");

        getAlarmSoundPreference.mockResolvedValue("../../bad.wav");
        resetDepartureAlarmNativeModuleForTests();
        mockOptionalNativeModule.mockReturnValue({
            getAlarmSoundPreference,
            setAlarmSoundPreference,
        });
        await expect(getNativeNoLateAlarmSoundPreference()).resolves.toBeUndefined();
    });

    it("uses the iOS custom-alarm preview bridge with normalized inputs", async () => {
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        const scheduleCustomAlarmPreview = jest.fn()
            .mockResolvedValue({ applied: true, scheduled: true });
        mockOptionalNativeModule.mockReturnValue({ scheduleCustomAlarmPreview });

        await scheduleNoLateCustomAlarmPreview(1, " 41 ");
        await scheduleNoLateCustomAlarmPreview(90);

        expect(scheduleCustomAlarmPreview).toHaveBeenNthCalledWith(1, 3, "41");
        expect(scheduleCustomAlarmPreview).toHaveBeenNthCalledWith(2, 60, null);
    });

    it("rejects an invalid iOS schedule id before scheduling a preview", async () => {
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        const scheduleCustomAlarmPreview = jest.fn();
        mockOptionalNativeModule.mockReturnValue({ scheduleCustomAlarmPreview });

        await expect(scheduleNoLateCustomAlarmPreview(10, "schedule:41"))
            .resolves.toEqual({
                applied: false,
                scheduled: false,
                reason: "INVALID_SCHEDULE_ID",
            });
        expect(scheduleCustomAlarmPreview).not.toHaveBeenCalled();
    });

    it("keeps Android on its existing NoLate full-screen test alarm", async () => {
        Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
        const scheduleTestAlarm = jest.fn()
            .mockResolvedValue({ applied: true, scheduled: true });
        const scheduleCustomAlarmPreview = jest.fn();
        mockOptionalNativeModule.mockReturnValue({
            scheduleTestAlarm,
            scheduleCustomAlarmPreview,
        });

        await expect(scheduleNoLateCustomAlarmPreview(1, "unused-on-android"))
            .resolves.toEqual({ applied: true, scheduled: true });
        expect(scheduleTestAlarm).toHaveBeenCalledWith(3);
        expect(scheduleCustomAlarmPreview).not.toHaveBeenCalled();
    });

    it("fails safely when an older iOS binary lacks the custom preview bridge", async () => {
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        mockOptionalNativeModule.mockReturnValue({ scheduleTestAlarm: jest.fn() });

        await expect(scheduleNoLateCustomAlarmPreview()).resolves.toEqual({
            applied: false,
            scheduled: false,
            reason: "CUSTOM_ALARM_PREVIEW_UNAVAILABLE",
        });
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

    it("records only canonical native alarm notification responses as fire evidence", async () => {
        const recordAlarmNotificationResponseFire = jest.fn().mockResolvedValue(true);
        mockOptionalNativeModule.mockReturnValue({ recordAlarmNotificationResponseFire });
        const occurredAt = Date.parse("2026-08-04T01:00:02.000Z");
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            alarmId: "schedule:41:member:7",
            nativeAlarmId: "schedule:41:member:7:occurrence:M0",
            scheduleId: "41",
            alarmGeneration: "8",
            recipientMemberId: "7",
            occurrenceId: "M0",
        };

        await expect(recordNativeAlarmNotificationResponseFire(data, occurredAt))
            .resolves.toBe(true);
        expect(recordAlarmNotificationResponseFire).toHaveBeenCalledWith({
            nativeAlarmId: "schedule:41:member:7:occurrence:M0",
            alarmId: "schedule:41:member:7",
            scheduleId: "41",
            generation: 8,
            recipientMemberId: 7,
            occurrenceId: "M0",
            occurredAt: "2026-08-04T01:00:02.000Z",
        });
        expect(recordNativeAlarmNotificationResponseFire({
            ...data,
            nativeAlarmId: "schedule:41:member:7:occurrence:M10",
        }, occurredAt)).toBeUndefined();
        expect(recordAlarmNotificationResponseFire).toHaveBeenCalledTimes(1);
    });

    it("keeps OTA updates safe when an older native binary lacks journal methods", async () => {
        mockOptionalNativeModule.mockReturnValue({});

        await expect(getPendingNativeAlarmFireEvents()).resolves.toEqual([]);
        await expect(removePendingNativeAlarmFireEvent("event-1")).resolves.toBe(false);
    });
});
