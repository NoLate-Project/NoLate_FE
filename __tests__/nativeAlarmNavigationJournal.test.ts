import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    getPendingNativeAlarmNavigationEvents,
    removePendingNativeAlarmNavigationEvent,
} from "../src/modules/notification/departureAlarm";
import { isDepartureAlarmAccountCleanupPending } from "../src/modules/notification/departureAlarmSync";
import {
    configureNativeAlarmNavigation,
    deactivateNativeAlarmNavigationJournal,
    drainNativeAlarmNavigationJournal,
    resetNativeAlarmNavigationJournalForTests,
} from "../src/modules/notification/nativeAlarmNavigationJournal";

jest.mock("../src/modules/auth/authStorage", () => ({ getAuthMember: jest.fn() }));
jest.mock("../src/modules/notification/departureAlarm", () => ({
    getPendingNativeAlarmNavigationEvents: jest.fn(),
    removePendingNativeAlarmNavigationEvent: jest.fn(),
}));
jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    isDepartureAlarmAccountCleanupPending: jest.fn(),
}));

const event = {
    eventId: "navigation-1",
    scheduleId: "41",
    recipientMemberId: 7,
    occurredAt: "2026-08-04T01:00:00.000Z",
};

describe("native alarm navigation journal", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetNativeAlarmNavigationJournalForTests();
        jest.mocked(getAuthMember).mockResolvedValue({ id: 7 });
        jest.mocked(isDepartureAlarmAccountCleanupPending).mockResolvedValue(false);
        jest.mocked(getPendingNativeAlarmNavigationEvents).mockResolvedValue([]);
        jest.mocked(removePendingNativeAlarmNavigationEvent).mockResolvedValue(true);
    });

    afterEach(() => {
        deactivateNativeAlarmNavigationJournal();
        jest.useRealTimers();
    });

    it("delivers a cold-start route only after the authenticated handler is ready", async () => {
        jest.mocked(getPendingNativeAlarmNavigationEvents).mockResolvedValue([event]);
        const navigate = jest.fn();
        configureNativeAlarmNavigation(navigate);

        await expect(drainNativeAlarmNavigationJournal()).resolves.toMatchObject({
            discovered: 1,
            delivered: 1,
        });

        expect(navigate).toHaveBeenCalledWith("41");
        expect(removePendingNativeAlarmNavigationEvent).toHaveBeenCalledWith("navigation-1");
    });

    it("does not deliver or delete a retained event for another account", async () => {
        jest.mocked(getPendingNativeAlarmNavigationEvents).mockResolvedValue([event]);
        jest.mocked(getAuthMember).mockResolvedValue({ id: 8 });
        const navigate = jest.fn();
        configureNativeAlarmNavigation(navigate);

        await expect(drainNativeAlarmNavigationJournal()).resolves.toMatchObject({
            accountMismatch: 1,
            delivered: 0,
        });
        expect(navigate).not.toHaveBeenCalled();
        expect(removePendingNativeAlarmNavigationEvent).not.toHaveBeenCalled();
    });

    it("retains the event when route delivery fails", async () => {
        jest.mocked(getPendingNativeAlarmNavigationEvents).mockResolvedValue([event]);
        configureNativeAlarmNavigation(jest.fn().mockRejectedValue(new Error("router not ready")));

        await expect(drainNativeAlarmNavigationJournal()).resolves.toMatchObject({
            unresolved: 1,
            delivered: 0,
        });
        expect(removePendingNativeAlarmNavigationEvent).not.toHaveBeenCalled();
    });
});
