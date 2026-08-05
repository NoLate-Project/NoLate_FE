import AsyncStorage from "@react-native-async-storage/async-storage";

const mockScheduleNotificationAsync = jest.fn();
const mockAcknowledgePushDelivery = jest.fn();
const mockEmitAppNotificationReceived = jest.fn();
const mockEmitScheduleMutation = jest.fn();
const mockSetNotificationCategoryAsync = jest.fn();
const mockPresentForegroundDepartureReminder = jest.fn();

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
    presentForegroundDepartureReminderForAuthenticatedSession: (...args: unknown[]) =>
        mockPresentForegroundDepartureReminder(...args),
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
import {
    resetForegroundPushPresentationClaimsForTests,
} from "../src/modules/notification/foregroundPushPresentationClaim";

describe("foreground push presentation ACK", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        resetForegroundPushPresentationClaimsForTests();
        jest.clearAllMocks();
        mockScheduleNotificationAsync.mockResolvedValue("local-notification-1");
        mockAcknowledgePushDelivery.mockResolvedValue(true);
        mockPresentForegroundDepartureReminder.mockResolvedValue("unsupported");
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
            recipientMemberId: "7",
            logicalEventKey: "event:00000000-0000-4000-8000-000000000041",
            etaEventExpiresAt: "2099-08-04T05:02:00.000Z",
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
        expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
            expect.objectContaining({
                identifier: expect.stringMatching(/^nolate-visible-[0-9a-f]{64}$/),
            }),
        );
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

    it("presents the same logical event once across provider redelivery", async () => {
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "42",
            recipientMemberId: "7",
            logicalEventKey: "event:00000000-0000-4000-8000-000000000042",
            etaEventExpiresAt: "2099-08-04T05:02:00.000Z",
        };
        const notification = { title: "출발 준비하세요", body: "15분 남았어요." };

        await Promise.all([
            handleForegroundPushMessage({
                data,
                messageId: "provider-redelivery-a",
                notification,
            } as unknown as Parameters<typeof handleForegroundPushMessage>[0]),
            handleForegroundPushMessage({
                data,
                messageId: "provider-redelivery-b",
                notification,
            } as unknown as Parameters<typeof handleForegroundPushMessage>[0]),
        ]);

        expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
        expect(mockAcknowledgePushDelivery.mock.calls.filter(
            ([, stage]) => stage === "RECEIVED",
        )).toHaveLength(2);
        expect(mockAcknowledgePushDelivery.mock.calls.filter(
            ([, stage]) => stage === "PRESENTED",
        )).toHaveLength(1);
    });

    it("does not present an expired ETA event", async () => {
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "43",
            recipientMemberId: "7",
            logicalEventKey: "event:00000000-0000-4000-8000-000000000043",
            etaEventExpiresAt: "2020-01-01T00:00:00.000Z",
        };

        await handleForegroundPushMessage({
            data,
            messageId: "provider-expired",
            notification: { title: "출발 준비하세요", body: "이미 지난 알림" },
        } as unknown as Parameters<typeof handleForegroundPushMessage>[0]);

        expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
        expect(mockAcknowledgePushDelivery.mock.calls.some(
            ([, stage]) => stage === "PRESENTED",
        )).toBe(false);
    });

    it("invalidates search state only for schedule visibility pushes", async () => {
        await handleForegroundPushMessage({
            data: { type: "CATEGORY_SHARE_RECEIVED" },
            notification: { title: "공유", body: "새 공유 일정" },
        } as unknown as Parameters<typeof handleForegroundPushMessage>[0]);

        expect(mockEmitScheduleMutation).toHaveBeenCalledTimes(1);
    });

    it("leaves iOS category registration to the atomic NoLate native owner", async () => {
        const { configureForegroundPush } = require(
            "../src/modules/notification/foregroundPush"
        ) as typeof import("../src/modules/notification/foregroundPush");

        const unsubscribe = await configureForegroundPush();

        expect(mockSetNotificationCategoryAsync).not.toHaveBeenCalled();
        unsubscribe();
    });
});
