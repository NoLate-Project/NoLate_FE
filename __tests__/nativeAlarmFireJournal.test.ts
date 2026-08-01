import { postDepartureAlarmFiredEvent } from "../src/api/notification";
import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    getPendingNativeAlarmFireEvents,
    removePendingNativeAlarmFireEvent,
} from "../src/modules/notification/departureAlarm";
import {
    activateNativeAlarmFireJournalForAuthenticatedMember,
    deactivateNativeAlarmFireJournalRetry,
    drainNativeAlarmFireJournal,
    resetNativeAlarmFireJournalDrainForTests,
} from "../src/modules/notification/nativeAlarmFireJournal";
import { acknowledgePushDelivery } from "../src/modules/notification/pushDeliveryAck";
import { getOrCreatePushDeviceId } from "../src/modules/notification/pushDeviceIdentity";
import { isDepartureAlarmAccountCleanupPending } from "../src/modules/notification/departureAlarmSync";

jest.mock("../src/api/notification", () => ({ postDepartureAlarmFiredEvent: jest.fn() }));
jest.mock("../src/modules/auth/authStorage", () => ({ getAuthMember: jest.fn() }));
jest.mock("../src/modules/notification/departureAlarm", () => ({
    getPendingNativeAlarmFireEvents: jest.fn(),
    removePendingNativeAlarmFireEvent: jest.fn(),
}));
jest.mock("../src/modules/notification/pushDeliveryAck", () => ({
    acknowledgePushDelivery: jest.fn(),
}));
jest.mock("../src/modules/notification/pushDeviceIdentity", () => ({
    getOrCreatePushDeviceId: jest.fn(),
}));
jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    isDepartureAlarmAccountCleanupPending: jest.fn(),
}));

const event = {
    eventId: "a7360f46-4f44-48b6-ae93-28f11c3f667d",
    alarmId: "schedule:41:member:7",
    scheduleId: "41",
    generation: 3,
    recipientMemberId: 7,
    scheduledFor: "2026-08-01T01:00:00.000Z",
    sourceTriggerAt: "2026-08-01T00:55:00.000Z",
    occurredAt: "2026-08-01T01:00:02.000Z",
    timingBasis: "OBSERVED_ALERTING" as const,
};

describe("native alarm fire journal drain", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetNativeAlarmFireJournalDrainForTests();
        jest.mocked(getAuthMember).mockResolvedValue({ id: 7 });
        jest.mocked(getPendingNativeAlarmFireEvents).mockResolvedValue([]);
        jest.mocked(removePendingNativeAlarmFireEvent).mockResolvedValue(true);
        jest.mocked(acknowledgePushDelivery).mockResolvedValue(true);
        jest.mocked(postDepartureAlarmFiredEvent).mockResolvedValue(undefined);
        jest.mocked(getOrCreatePushDeviceId).mockResolvedValue("device-stable-7");
        jest.mocked(isDepartureAlarmAccountCleanupPending).mockResolvedValue(false);
    });

    afterEach(() => {
        deactivateNativeAlarmFireJournalRetry();
        jest.useRealTimers();
    });

    it("uses delivery ACK for push-origin evidence and removes only after success", async () => {
        jest.mocked(getPendingNativeAlarmFireEvents).mockResolvedValue([{
            ...event,
            logicalEventKey: "event:alarm-sync-41",
        }]);

        await expect(drainNativeAlarmFireJournal()).resolves.toEqual({
            discovered: 1,
            acknowledged: 1,
            unresolved: 0,
            accountMismatch: 0,
            failed: 0,
            blocked: false,
        });
        expect(acknowledgePushDelivery).toHaveBeenCalledWith(
            { logicalEventKey: "event:alarm-sync-41", recipientMemberId: "7" },
            "ALARM_FIRED",
            { alarmId: event.alarmId, occurredAt: event.occurredAt },
        );
        expect(postDepartureAlarmFiredEvent).toHaveBeenCalledTimes(1);
        expect(removePendingNativeAlarmFireEvent).toHaveBeenCalledWith(event.eventId);
    });

    it("uses the lifecycle endpoint for snapshot-origin evidence without inventing a key", async () => {
        jest.mocked(getPendingNativeAlarmFireEvents).mockResolvedValue([event]);

        await drainNativeAlarmFireJournal();

        expect(acknowledgePushDelivery).not.toHaveBeenCalled();
        expect(postDepartureAlarmFiredEvent).toHaveBeenCalledWith({
            eventId: event.eventId,
            alarmId: event.alarmId,
            scheduleId: 41,
            generation: 3,
            recipientMemberId: 7,
            scheduledFor: event.scheduledFor,
            sourceTriggerAt: event.sourceTriggerAt,
            occurredAt: event.occurredAt,
            timingBasis: "OBSERVED_ALERTING",
            deviceId: "device-stable-7",
        });
        expect(removePendingNativeAlarmFireEvent).toHaveBeenCalledWith(event.eventId);
    });

    it("retains offline evidence and retries it after process-memory reset", async () => {
        jest.mocked(getPendingNativeAlarmFireEvents).mockResolvedValue([event]);
        jest.mocked(postDepartureAlarmFiredEvent)
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(undefined);

        await expect(drainNativeAlarmFireJournal()).resolves.toMatchObject({ failed: 1 });
        expect(removePendingNativeAlarmFireEvent).not.toHaveBeenCalled();

        resetNativeAlarmFireJournalDrainForTests();
        await expect(drainNativeAlarmFireJournal()).resolves.toMatchObject({ acknowledged: 1 });
        expect(postDepartureAlarmFiredEvent).toHaveBeenCalledTimes(2);
        expect(removePendingNativeAlarmFireEvent).toHaveBeenCalledTimes(1);
    });

    it("retries retained native evidence on a bounded foreground timer", async () => {
        jest.useFakeTimers();
        jest.mocked(getPendingNativeAlarmFireEvents).mockResolvedValue([event]);
        jest.mocked(postDepartureAlarmFiredEvent)
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(undefined);

        await expect(
            activateNativeAlarmFireJournalForAuthenticatedMember()
        ).resolves.toMatchObject({ failed: 1 });
        expect(postDepartureAlarmFiredEvent).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(15_000);

        expect(postDepartureAlarmFiredEvent).toHaveBeenCalledTimes(2);
        expect(removePendingNativeAlarmFireEvent).toHaveBeenCalledWith(event.eventId);
    });

    it("retains a push-origin event when lifecycle succeeds but delivery ACK fails", async () => {
        jest.mocked(getPendingNativeAlarmFireEvents).mockResolvedValue([{
            ...event,
            logicalEventKey: "event:alarm-sync-41",
        }]);
        jest.mocked(acknowledgePushDelivery)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        await expect(drainNativeAlarmFireJournal()).resolves.toMatchObject({ unresolved: 1 });
        expect(postDepartureAlarmFiredEvent).toHaveBeenCalledTimes(1);
        expect(removePendingNativeAlarmFireEvent).not.toHaveBeenCalled();

        resetNativeAlarmFireJournalDrainForTests();
        await expect(drainNativeAlarmFireJournal()).resolves.toMatchObject({ acknowledged: 1 });
        expect(postDepartureAlarmFiredEvent).toHaveBeenCalledTimes(2);
        expect(acknowledgePushDelivery).toHaveBeenCalledTimes(2);
        expect(removePendingNativeAlarmFireEvent).toHaveBeenCalledTimes(1);
    });

    it("retains a push-origin event when delivery ACK succeeds but lifecycle fails", async () => {
        jest.mocked(getPendingNativeAlarmFireEvents).mockResolvedValue([{
            ...event,
            logicalEventKey: "event:alarm-sync-41",
        }]);
        jest.mocked(postDepartureAlarmFiredEvent)
            .mockRejectedValueOnce(new Error("lifecycle offline"))
            .mockResolvedValueOnce(undefined);

        await expect(drainNativeAlarmFireJournal()).resolves.toMatchObject({ unresolved: 1 });
        expect(acknowledgePushDelivery).toHaveBeenCalledTimes(1);
        expect(removePendingNativeAlarmFireEvent).not.toHaveBeenCalled();

        resetNativeAlarmFireJournalDrainForTests();
        await expect(drainNativeAlarmFireJournal()).resolves.toMatchObject({ acknowledged: 1 });
        expect(postDepartureAlarmFiredEvent).toHaveBeenCalledTimes(2);
        expect(acknowledgePushDelivery).toHaveBeenCalledTimes(2);
    });

    it("does not cross the native bridge while account cleanup is fenced", async () => {
        jest.mocked(isDepartureAlarmAccountCleanupPending).mockResolvedValue(true);

        await expect(drainNativeAlarmFireJournal()).resolves.toMatchObject({ blocked: true });
        expect(getPendingNativeAlarmFireEvents).not.toHaveBeenCalled();
        expect(postDepartureAlarmFiredEvent).not.toHaveBeenCalled();
    });

    it("never drains another account's evidence with the current token", async () => {
        jest.mocked(getPendingNativeAlarmFireEvents).mockResolvedValue([event]);
        jest.mocked(getAuthMember).mockResolvedValue({ id: 8 });

        await expect(drainNativeAlarmFireJournal()).resolves.toMatchObject({
            accountMismatch: 1,
            acknowledged: 0,
        });
        expect(postDepartureAlarmFiredEvent).not.toHaveBeenCalled();
        expect(acknowledgePushDelivery).not.toHaveBeenCalled();
        expect(removePendingNativeAlarmFireEvent).not.toHaveBeenCalled();
    });

    it("coalesces concurrent startup and active drains", async () => {
        let resolveEvents: (events: typeof event[]) => void = () => undefined;
        jest.mocked(getPendingNativeAlarmFireEvents).mockReturnValue(new Promise((resolve) => {
            resolveEvents = resolve;
        }));

        const first = drainNativeAlarmFireJournal();
        const second = drainNativeAlarmFireJournal();
        resolveEvents([]);

        await Promise.all([first, second]);
        expect(getPendingNativeAlarmFireEvents).toHaveBeenCalledTimes(1);
    });
});
