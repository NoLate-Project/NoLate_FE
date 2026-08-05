import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    getPendingNativeDepartureReminderPresentationEvents,
    markNativeDepartureReminderPresentationDelivered,
} from "../src/modules/notification/departureAlarm";
import {
    activateDepartureReminderAccountForAuthenticatedSession,
    isDepartureAlarmAccountCleanupPending,
} from "../src/modules/notification/departureAlarmSync";
import {
    activateNativeDepartureReminderPresentationJournal,
    resetNativeDepartureReminderPresentationJournalForTests,
} from "../src/modules/notification/nativeDepartureReminderPresentationJournal";
import { acknowledgePushDelivery } from "../src/modules/notification/pushDeliveryAck";

jest.mock("../src/modules/auth/authStorage", () => ({ getAuthMember: jest.fn() }));
jest.mock("../src/modules/notification/departureAlarm", () => ({
    getPendingNativeDepartureReminderPresentationEvents: jest.fn(),
    markNativeDepartureReminderPresentationDelivered: jest.fn(),
}));
jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    activateDepartureReminderAccountForAuthenticatedSession: jest.fn(),
    isDepartureAlarmAccountCleanupPending: jest.fn(),
}));
jest.mock("../src/modules/notification/pushDeliveryAck", () => ({
    acknowledgePushDelivery: jest.fn(),
}));

const event = {
    eventId: "nolate-visible-" + "a".repeat(64),
    notificationTag: "nolate-visible-" + "a".repeat(64),
    recipientMemberId: 7,
    logicalEventKey: "event:00000000-0000-4000-8000-000000000041",
    providerMessageId: "provider-41",
    occurredAt: "2026-08-04T03:00:00.000Z",
};

describe("native departure reminder presentation evidence", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetNativeDepartureReminderPresentationJournalForTests();
        jest.mocked(getAuthMember).mockResolvedValue({ id: 7 });
        jest.mocked(isDepartureAlarmAccountCleanupPending).mockResolvedValue(false);
        jest.mocked(activateDepartureReminderAccountForAuthenticatedSession)
            .mockResolvedValue(true);
        jest.mocked(getPendingNativeDepartureReminderPresentationEvents)
            .mockResolvedValue([event]);
        jest.mocked(acknowledgePushDelivery).mockResolvedValue(true);
        jest.mocked(markNativeDepartureReminderPresentationDelivered).mockResolvedValue(true);
    });

    it("binds the verified account before draining and commits PRESENTED evidence", async () => {
        await expect(activateNativeDepartureReminderPresentationJournal()).resolves.toEqual({
            discovered: 1,
            acknowledged: 1,
            unresolved: 0,
            accountMismatch: 0,
            blocked: false,
        });

        expect(activateDepartureReminderAccountForAuthenticatedSession).toHaveBeenCalledWith(7);
        expect(
            jest.mocked(activateDepartureReminderAccountForAuthenticatedSession)
                .mock.invocationCallOrder[0],
        ).toBeLessThan(
            jest.mocked(getPendingNativeDepartureReminderPresentationEvents)
                .mock.invocationCallOrder[0],
        );
        expect(acknowledgePushDelivery).toHaveBeenCalledTimes(2);
        expect(acknowledgePushDelivery).toHaveBeenCalledWith(
            {
                logicalEventKey: event.logicalEventKey,
                recipientMemberId: "7",
            },
            "RECEIVED",
            {
                providerMessageId: event.providerMessageId,
                occurredAt: event.occurredAt,
            },
        );
        expect(acknowledgePushDelivery).toHaveBeenCalledWith(
            {
                logicalEventKey: event.logicalEventKey,
                recipientMemberId: "7",
            },
            "PRESENTED",
            {
                providerMessageId: event.providerMessageId,
                occurredAt: event.occurredAt,
            },
        );
        expect(markNativeDepartureReminderPresentationDelivered).toHaveBeenCalledWith(
            event.notificationTag,
        );
    });

    it("retains evidence until the durable ACK succeeds", async () => {
        jest.mocked(acknowledgePushDelivery)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);

        await expect(activateNativeDepartureReminderPresentationJournal()).resolves.toMatchObject({
            acknowledged: 0,
            unresolved: 1,
        });
        expect(markNativeDepartureReminderPresentationDelivered).not.toHaveBeenCalled();
    });

    it("does not bind or read native evidence while account cleanup is fenced", async () => {
        jest.mocked(isDepartureAlarmAccountCleanupPending).mockResolvedValue(true);

        await expect(activateNativeDepartureReminderPresentationJournal()).resolves.toMatchObject({
            blocked: true,
            discovered: 0,
        });
        expect(activateDepartureReminderAccountForAuthenticatedSession).not.toHaveBeenCalled();
        expect(getPendingNativeDepartureReminderPresentationEvents).not.toHaveBeenCalled();
    });
});
