const mockHandleDepartureAlarmSyncData = jest.fn().mockResolvedValue(true);
const mockMarkScheduleDeparted = jest.fn();
const mockSnoozeScheduleDepartureReminder = jest.fn();
const mockRecoverDepartureAlarmsAfterMutation = jest.fn();
const mockEmitAppNotificationReceived = jest.fn();
const mockOnMessage = jest.fn((_messaging: unknown, _handler: unknown) => jest.fn());
const mockGetMessaging = jest.fn(() => ({}));
const mockGetInitialNotification = jest.fn();
const mockFirebaseNavigationUnsubscribe = jest.fn();
let mockNotificationOpenedHandler: ((message: {
    data?: Record<string, string>;
    messageId?: string;
}) => void) | undefined;
const mockAcknowledgePushDelivery = jest.fn();

jest.mock("@react-native-firebase/messaging", () => ({
    getInitialNotification: (...args: unknown[]) => mockGetInitialNotification(...args),
    getMessaging: () => mockGetMessaging(),
    onMessage: (messaging: unknown, handler: unknown) => mockOnMessage(messaging, handler),
    onNotificationOpenedApp: jest.fn((_messaging: unknown, handler: typeof mockNotificationOpenedHandler) => {
        mockNotificationOpenedHandler = handler;
        return mockFirebaseNavigationUnsubscribe;
    }),
}));

jest.mock("expo-modules-core", () => ({
    requireOptionalNativeModule: jest.fn(() => null),
}));

jest.mock("../src/api/schedule", () => ({
    markScheduleDeparted: (...args: unknown[]) => mockMarkScheduleDeparted(...args),
    snoozeScheduleDepartureReminder: (...args: unknown[]) =>
        mockSnoozeScheduleDepartureReminder(...args),
}));

jest.mock("expo-device", () => ({
    isDevice: false,
}));

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    handleDepartureAlarmSyncData: (...args: unknown[]) => (
        mockHandleDepartureAlarmSyncData(...args)
    ),
}));

jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
}));

jest.mock("../src/modules/notification/appNotificationEvents", () => ({
    emitAppNotificationReceived: () => mockEmitAppNotificationReceived(),
}));

jest.mock("../src/modules/notification/pushDeliveryAck", () => ({
    acknowledgePushDelivery: (...args: unknown[]) =>
        mockAcknowledgePushDelivery(...args),
}));

import {
    completeDepartureFromNotificationAction,
    configureForegroundPush,
    configurePushNavigation,
    handleForegroundPushMessage,
    snoozeDepartureFromNotificationAction,
} from "../src/modules/notification/foregroundPush";

describe("foreground departure alarm sync routing", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockMarkScheduleDeparted.mockResolvedValue({ id: "41" });
        mockSnoozeScheduleDepartureReminder.mockResolvedValue(undefined);
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
        mockGetInitialNotification.mockResolvedValue(null);
        mockAcknowledgePushDelivery.mockResolvedValue(true);
        mockNotificationOpenedHandler = undefined;
    });

    it("consumes even malformed reserved sync payloads without inbox presentation", async () => {
        const data = {
            type: "DEPARTURE_ALARM_SYNC",
            alarmSchemaVersion: "broken",
        };

        await handleForegroundPushMessage(
            { data } as unknown as Parameters<typeof handleForegroundPushMessage>[0],
        );

        expect(mockHandleDepartureAlarmSyncData).toHaveBeenCalledWith(data);
        expect(mockEmitAppNotificationReceived).not.toHaveBeenCalled();
    });

    it("registers Firebase foreground sync even without expo-notifications", async () => {
        const unsubscribe = await configureForegroundPush();

        expect(mockOnMessage).toHaveBeenCalledWith(
            expect.anything(),
            handleForegroundPushMessage,
        );
        expect(typeof unsubscribe).toBe("function");
    });

    it("keeps the existing standard push presentation path", async () => {
        await handleForegroundPushMessage({
            data: {
                type: "SCHEDULE_DEPARTURE_REMINDER",
                scheduleId: "41",
            },
            notification: {
                title: "출발 알림",
                body: "지금 출발하세요.",
            },
        } as unknown as Parameters<typeof handleForegroundPushMessage>[0]);

        expect(mockHandleDepartureAlarmSyncData).not.toHaveBeenCalled();
        expect(mockEmitAppNotificationReceived).toHaveBeenCalledTimes(1);
    });

    it("ACKs foreground receipt with the Firebase provider message id", async () => {
        const data = {
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "41",
            logicalEventKey: "event:foreground-41",
        };

        await handleForegroundPushMessage({
            data,
            messageId: "provider-message-41",
        } as unknown as Parameters<typeof handleForegroundPushMessage>[0]);

        expect(mockAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "RECEIVED",
            { providerMessageId: "provider-message-41" },
        );
    });

    it("infers received and presented before ACKing a Firebase notification action", async () => {
        const openSchedule = jest.fn();
        const cleanup = await configurePushNavigation(openSchedule, jest.fn());
        const data = {
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "41",
            logicalEventKey: "event:opened-41",
        };

        mockNotificationOpenedHandler?.({
            data,
            messageId: "provider-opened-41",
        });

        expect(mockAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "RECEIVED",
            { providerMessageId: "provider-opened-41" },
        );
        expect(mockAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "PRESENTED",
            { providerMessageId: "provider-opened-41" },
        );
        expect(mockAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "ACTIONED",
            {
                providerMessageId: "provider-opened-41",
                actionIdentifier: "DEFAULT",
            },
        );
        expect(openSchedule).toHaveBeenCalledWith("41");

        cleanup();
        expect(mockFirebaseNavigationUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it("recovers once after a successful depart-now notification action", async () => {
        await completeDepartureFromNotificationAction("41");

        expect(mockMarkScheduleDeparted).toHaveBeenCalledWith("41");
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockMarkScheduleDeparted.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
    });

    it("recovers once after snooze and not after a failed action", async () => {
        await snoozeDepartureFromNotificationAction("41");

        expect(mockSnoozeScheduleDepartureReminder).toHaveBeenCalledWith("41");
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);

        mockRecoverDepartureAlarmsAfterMutation.mockClear();
        mockMarkScheduleDeparted.mockRejectedValueOnce(new Error("depart failed"));
        await expect(
            completeDepartureFromNotificationAction("42"),
        ).rejects.toThrow("depart failed");

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
    });

    it("does not recover when snoozing fails", async () => {
        mockSnoozeScheduleDepartureReminder.mockRejectedValueOnce(
            new Error("snooze failed"),
        );

        await expect(
            snoozeDepartureFromNotificationAction("43"),
        ).rejects.toThrow("snooze failed");

        expect(mockSnoozeScheduleDepartureReminder).toHaveBeenCalledWith("43");
        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
    });
});
