import AsyncStorage from "@react-native-async-storage/async-storage";

import { markScheduleDeparted } from "../src/api/schedule";
import { ApiResponseError } from "../src/api/response";
import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    enqueueNativeDepartureActionEvent,
    getPendingNativeDepartureActionEvents,
    markNativeDepartureActionNavigationDelivered,
    removePendingNativeDepartureActionEvent,
} from "../src/modules/notification/departureAlarm";
import { recoverDepartureAlarmsAfterMutation } from "../src/modules/notification/departureAlarmMutationRecovery";
import { isDepartureAlarmAccountCleanupPending } from "../src/modules/notification/departureAlarmSync";
import {
    configureNativeDepartureActionNavigation,
    deactivateNativeDepartureActionJournalRetry,
    drainNativeDepartureActionJournal,
    enqueueStandardDepartureAction,
    resetNativeDepartureActionJournalForTests,
} from "../src/modules/notification/nativeDepartureActionJournal";

jest.mock("../src/api/schedule", () => ({ markScheduleDeparted: jest.fn() }));
jest.mock("../src/modules/auth/authStorage", () => ({ getAuthMember: jest.fn() }));
jest.mock("../src/modules/notification/departureAlarm", () => ({
    enqueueNativeDepartureActionEvent: jest.fn(),
    getPendingNativeDepartureActionEvents: jest.fn(),
    markNativeDepartureActionNavigationDelivered: jest.fn(),
    removePendingNativeDepartureActionEvent: jest.fn(),
}));
jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: jest.fn(),
}));
jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    isDepartureAlarmAccountCleanupPending: jest.fn(),
}));

const event = {
    eventId: "action-1",
    alarmId: "schedule:41:member:7",
    scheduleId: "41",
    generation: 8,
    recipientMemberId: 7,
    occurrenceId: "M0",
    actionEventKey: `key:${"a".repeat(64)}`,
    occurredAt: "2026-08-04T01:00:00.000Z",
    requiresRouteNavigation: false,
    routeNavigationDelivered: false,
};

describe("durable departure action journal", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        resetNativeDepartureActionJournalForTests();
        await AsyncStorage.clear();
        jest.mocked(getAuthMember).mockResolvedValue({ id: 7 });
        jest.mocked(isDepartureAlarmAccountCleanupPending).mockResolvedValue(false);
        jest.mocked(getPendingNativeDepartureActionEvents).mockResolvedValue([]);
        jest.mocked(markScheduleDeparted).mockResolvedValue({ id: "41" } as never);
        jest.mocked(recoverDepartureAlarmsAfterMutation).mockResolvedValue(undefined);
        jest.mocked(markNativeDepartureActionNavigationDelivered).mockResolvedValue(true);
        jest.mocked(removePendingNativeDepartureActionEvent).mockResolvedValue(true);
        jest.mocked(enqueueNativeDepartureActionEvent).mockResolvedValue(true);
    });

    afterEach(() => {
        deactivateNativeDepartureActionJournalRetry();
        jest.useRealTimers();
    });

    it("mutates with the canonical key and recipient fence before deleting", async () => {
        jest.mocked(getPendingNativeDepartureActionEvents).mockResolvedValue([event]);
        const navigate = jest.fn();
        configureNativeDepartureActionNavigation(navigate);

        await expect(drainNativeDepartureActionJournal()).resolves.toMatchObject({
            completed: 1,
            failed: 0,
        });

        expect(markScheduleDeparted).toHaveBeenCalledWith("41", event.actionEventKey, 7);
        expect(recoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(navigate).not.toHaveBeenCalled();
        expect(markNativeDepartureActionNavigationDelivered).not.toHaveBeenCalled();
        expect(removePendingNativeDepartureActionEvent).toHaveBeenCalledWith("action-1");
    });

    it("drains a cold-start native action after authenticated app setup without routing", async () => {
        jest.mocked(getPendingNativeDepartureActionEvents).mockResolvedValue([event]);
        const navigate = jest.fn();

        configureNativeDepartureActionNavigation(navigate);
        await expect(drainNativeDepartureActionJournal()).resolves.toMatchObject({
            discovered: 1,
            completed: 1,
        });

        expect(markScheduleDeparted).toHaveBeenCalledWith("41", event.actionEventKey, 7);
        expect(navigate).not.toHaveBeenCalled();
    });

    it("retains network failures but quarantines a terminal conflict", async () => {
        jest.mocked(getPendingNativeDepartureActionEvents).mockResolvedValue([event]);
        jest.mocked(markScheduleDeparted).mockRejectedValueOnce(new Error("offline"));

        await expect(drainNativeDepartureActionJournal()).resolves.toMatchObject({ failed: 1 });
        expect(removePendingNativeDepartureActionEvent).not.toHaveBeenCalled();

        resetNativeDepartureActionJournalForTests();
        jest.mocked(getPendingNativeDepartureActionEvents).mockResolvedValue([event]);
        jest.mocked(markScheduleDeparted).mockRejectedValueOnce(
            new ApiResponseError("key conflict", { status: 409 }),
        );
        const terminal = jest.fn();
        configureNativeDepartureActionNavigation(jest.fn(), terminal);

        await expect(drainNativeDepartureActionJournal()).resolves.toMatchObject({ terminal: 1 });
        expect(removePendingNativeDepartureActionEvent).toHaveBeenCalledWith("action-1");
        expect(terminal).toHaveBeenCalledWith(event, "key conflict");
    });

    it("does not reuse an old in-flight drain after account lifecycle deactivation", async () => {
        let resolveFirst: (events: typeof event[]) => void = () => undefined;
        jest.mocked(getPendingNativeDepartureActionEvents)
            .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValueOnce([]);

        const oldDrain = drainNativeDepartureActionJournal();
        for (let attempt = 0; attempt < 20; attempt += 1) {
            if (jest.mocked(getPendingNativeDepartureActionEvents).mock.calls.length === 1) break;
            await Promise.resolve();
        }
        expect(getPendingNativeDepartureActionEvents).toHaveBeenCalledTimes(1);
        deactivateNativeDepartureActionJournalRetry();
        const newDrain = drainNativeDepartureActionJournal();
        resolveFirst([event]);

        await expect(oldDrain).resolves.toMatchObject({ blocked: true });
        await expect(newDrain).resolves.toMatchObject({ discovered: 0 });
        expect(getPendingNativeDepartureActionEvents).toHaveBeenCalledTimes(2);
        expect(markScheduleDeparted).not.toHaveBeenCalled();
    });

    it("falls back to a durable JS queue when the native journal is unavailable", async () => {
        jest.mocked(enqueueNativeDepartureActionEvent).mockResolvedValue(false);
        await expect(enqueueStandardDepartureAction({
            scheduleId: "41",
            recipientMemberId: 7,
            actionEventKey: event.actionEventKey,
        })).resolves.toBe(true);
        configureNativeDepartureActionNavigation(jest.fn());

        await expect(drainNativeDepartureActionJournal()).resolves.toMatchObject({
            discovered: 1,
            completed: 1,
        });
        expect(markScheduleDeparted).toHaveBeenCalledWith("41", event.actionEventKey, 7);
        expect(removePendingNativeDepartureActionEvent).not.toHaveBeenCalled();
    });

    it("never mutates another account's retained event", async () => {
        jest.mocked(getPendingNativeDepartureActionEvents).mockResolvedValue([event]);
        jest.mocked(getAuthMember).mockResolvedValue({ id: 8 });

        await expect(drainNativeDepartureActionJournal()).resolves.toMatchObject({
            accountMismatch: 1,
        });
        expect(markScheduleDeparted).not.toHaveBeenCalled();
        expect(removePendingNativeDepartureActionEvent).not.toHaveBeenCalled();
    });
});
