const mockScheduleNotificationAsync = jest.fn();
const mockAcknowledgePushDelivery = jest.fn();
const mockEmitAppNotificationReceived = jest.fn();
const mockEmitScheduleMutation = jest.fn();
const mockSetNotificationCategoryAsync = jest.fn();

jest.mock("@react-native-firebase/messaging", () => ({
    getInitialNotification: jest.fn().mockResolvedValue(null),
    getMessaging: jest.fn(() => ({})),
    onMessage: jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn(() => jest.fn()),
}));

jest.mock("expo-device", () => ({
    isDevice: true,
}));

jest.mock("expo-modules-core", () => ({
    requireOptionalNativeModule: jest.fn(() => ({})),
}));

jest.mock("expo-notifications", () => ({
    AndroidImportance: { HIGH: 4 },
    addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
    clearLastNotificationResponse: jest.fn(),
    getLastNotificationResponse: jest.fn(() => null),
    scheduleNotificationAsync: (...args: unknown[]) =>
        mockScheduleNotificationAsync(...args),
    setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    setNotificationHandler: jest.fn(),
}));

jest.mock("../src/api/schedule", () => ({
    markScheduleDeparted: jest.fn(),
    snoozeScheduleDepartureReminder: jest.fn(),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn().mockResolvedValue({ id: 7 }),
}));

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    handleDepartureAlarmSyncData: jest.fn().mockResolvedValue(true),
}));

jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: jest.fn(),
}));

jest.mock("../src/modules/notification/appNotificationEvents", () => ({
    emitAppNotificationReceived: () => mockEmitAppNotificationReceived(),
}));

jest.mock("../src/modules/schedule/calendarScheduleCache", () => ({
    clearCalendarScheduleCache: jest.fn(),
}));

jest.mock("../src/modules/schedule/scheduleMutationEvents", () => ({
    emitScheduleMutation: () => mockEmitScheduleMutation(),
}));

jest.mock("../src/modules/notification/pushDeliveryAck", () => ({
    acknowledgePushDelivery: (...args: unknown[]) =>
        mockAcknowledgePushDelivery(...args),
}));

import {
    handleForegroundPushMessage,
    setForegroundNotificationsModuleForTests,
} from "../src/modules/notification/foregroundPush";

describe("foreground push presentation ACK", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockScheduleNotificationAsync.mockResolvedValue("local-notification-1");
        mockAcknowledgePushDelivery.mockResolvedValue(true);
        setForegroundNotificationsModuleForTests({
            AndroidImportance: { HIGH: 4 },
            scheduleNotificationAsync: mockScheduleNotificationAsync,
            setNotificationCategoryAsync: mockSetNotificationCategoryAsync,
            setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
            setNotificationHandler: jest.fn(),
        } as unknown as Parameters<typeof setForegroundNotificationsModuleForTests>[0]);
    });

    afterEach(() => {
        setForegroundNotificationsModuleForTests(undefined);
    });

    it("ACKs PRESENTED only after immediate local presentation is scheduled", async () => {
        const data = {
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "41",
            logicalEventKey: "event:foreground-presented-41",
        };

        await handleForegroundPushMessage({
            data,
            messageId: "provider-presented-41",
            notification: {
                title: "출발 시간 변경",
                body: "10분 일찍 출발하세요.",
            },
        } as unknown as Parameters<typeof handleForegroundPushMessage>[0]);

        expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
        expect(mockAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "PRESENTED",
            { providerMessageId: "provider-presented-41" },
        );
        expect(mockScheduleNotificationAsync.mock.invocationCallOrder[0])
            .toBeLessThan(
                mockAcknowledgePushDelivery.mock.invocationCallOrder[
                    mockAcknowledgePushDelivery.mock.invocationCallOrder.length - 1
                ],
            );
        expect(mockEmitScheduleMutation).not.toHaveBeenCalled();
    });

    it("invalidates search state only for schedule visibility pushes", async () => {
        await handleForegroundPushMessage({
            data: { type: "CATEGORY_SHARE_RECEIVED" },
            notification: { title: "공유", body: "새 공유 일정" },
        } as unknown as Parameters<typeof handleForegroundPushMessage>[0]);

        expect(mockEmitScheduleMutation).toHaveBeenCalledTimes(1);
    });

    it("registers the exact visible departure action label", async () => {
        const { configureForegroundPush } = require(
            "../src/modules/notification/foregroundPush"
        ) as typeof import("../src/modules/notification/foregroundPush");

        const unsubscribe = await configureForegroundPush();

        expect(mockSetNotificationCategoryAsync).toHaveBeenCalledWith(
            "schedule_depart_now",
            expect.arrayContaining([
                expect.objectContaining({
                    identifier: "schedule_depart_now_action",
                    buttonTitle: "지금 출발 완료",
                }),
            ]),
            expect.any(Object),
        );
        unsubscribe();
    });
});
