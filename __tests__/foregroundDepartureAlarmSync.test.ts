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
const mockGetAuthMember = jest.fn();
const mockEnqueueStandardDepartureAction = jest.fn();
const mockActivateDepartureActionJournal = jest.fn();
const mockRecordNativeAlarmResponseFire = jest.fn();
const mockActivateNativeAlarmFireJournal = jest.fn();
let mockExpoResponseHandler: ((response: unknown) => void) | undefined;

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

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: (...args: unknown[]) => mockGetAuthMember(...args),
}));

jest.mock("../src/modules/notification/nativeDepartureActionJournal", () => ({
    enqueueStandardDepartureAction: (...args: unknown[]) =>
        mockEnqueueStandardDepartureAction(...args),
    activateNativeDepartureActionJournalForAuthenticatedMember: (...args: unknown[]) =>
        mockActivateDepartureActionJournal(...args),
}));

jest.mock("../src/modules/notification/departureAlarm", () => ({
    recordNativeAlarmNotificationResponseFire: (...args: unknown[]) =>
        mockRecordNativeAlarmResponseFire(...args),
}));

jest.mock("../src/modules/notification/nativeAlarmFireJournal", () => ({
    activateNativeAlarmFireJournalForAuthenticatedMember: (...args: unknown[]) =>
        mockActivateNativeAlarmFireJournal(...args),
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
    setForegroundNotificationsModuleForTests,
} from "../src/modules/notification/foregroundPush";
import { ApiResponseError } from "../src/api/response";

describe("foreground departure alarm sync routing", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockMarkScheduleDeparted.mockResolvedValue({ id: "41" });
        mockSnoozeScheduleDepartureReminder.mockResolvedValue(undefined);
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
        mockGetInitialNotification.mockResolvedValue(null);
        mockAcknowledgePushDelivery.mockResolvedValue(true);
        mockNotificationOpenedHandler = undefined;
        mockExpoResponseHandler = undefined;
        mockGetAuthMember.mockResolvedValue({ id: 7 });
        mockEnqueueStandardDepartureAction.mockResolvedValue(true);
        mockActivateDepartureActionJournal.mockResolvedValue({ completed: 0 });
        mockRecordNativeAlarmResponseFire.mockImplementation((data) => (
            data?.nativeAlarmId ? Promise.resolve(true) : undefined
        ));
        mockActivateNativeAlarmFireJournal.mockResolvedValue({ sent: 1 });
        setForegroundNotificationsModuleForTests(undefined);
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
        expect(mockEnqueueStandardDepartureAction).not.toHaveBeenCalled();

        cleanup();
        expect(mockFirebaseNavigationUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it("commits a time-sensitive response fire before default route-only navigation", async () => {
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn((handler) => {
                mockExpoResponseHandler = handler as (response: unknown) => void;
                return { remove: jest.fn() };
            }),
            clearLastNotificationResponse: jest.fn(),
            getLastNotificationResponse: jest.fn(() => null),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);
        const openSchedule = jest.fn();
        const cleanup = await configurePushNavigation(openSchedule, jest.fn());
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            alarmId: "schedule:41:member:7",
            nativeAlarmId: "schedule:41:member:7:occurrence:M0",
            scheduleId: "41",
            alarmGeneration: "8",
            recipientMemberId: "7",
            occurrenceId: "M0",
            logicalEventKey: "event:00000000-0000-4000-8000-000000000041",
        };
        const date = Date.parse("2026-08-04T01:00:02.000Z");

        mockExpoResponseHandler?.({
            actionIdentifier: "DEFAULT",
            notification: {
                date,
                request: {
                    identifier: "native-response-1",
                    content: { data },
                },
            },
        });
        for (let attempt = 0; attempt < 10 && openSchedule.mock.calls.length === 0; attempt += 1) {
            await Promise.resolve();
        }

        expect(mockRecordNativeAlarmResponseFire).toHaveBeenCalledWith(data, date);
        expect(mockActivateNativeAlarmFireJournal).toHaveBeenCalledTimes(1);
        expect(openSchedule).toHaveBeenCalledWith("41");
        expect(mockEnqueueStandardDepartureAction).not.toHaveBeenCalled();
        expect(mockSnoozeScheduleDepartureReminder).not.toHaveBeenCalled();
        expect(mockAcknowledgePushDelivery).not.toHaveBeenCalled();
        expect(mockRecordNativeAlarmResponseFire.mock.invocationCallOrder[0])
            .toBeLessThan(openSchedule.mock.invocationCallOrder[0]);

        cleanup();
    });

    it("keeps push interaction ACKs for an ordinary Expo visible notification response", async () => {
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn((handler) => {
                mockExpoResponseHandler = handler as (response: unknown) => void;
                return { remove: jest.fn() };
            }),
            clearLastNotificationResponse: jest.fn(),
            getLastNotificationResponse: jest.fn(() => null),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);
        const openSchedule = jest.fn();
        const cleanup = await configurePushNavigation(openSchedule, jest.fn());
        const data = {
            type: "SCHEDULE_TRAFFIC",
            scheduleId: "41",
            logicalEventKey: "event:ordinary-expo-visible-41",
        };

        mockExpoResponseHandler?.({
            actionIdentifier: "DEFAULT",
            notification: {
                request: {
                    identifier: "ordinary-expo-response-1",
                    content: { data },
                },
            },
        });

        expect(mockRecordNativeAlarmResponseFire).toHaveBeenCalledWith(
            data,
            expect.any(Number),
        );
        expect(mockAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "RECEIVED",
            { providerMessageId: undefined },
        );
        expect(mockAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "PRESENTED",
            { providerMessageId: undefined },
        );
        expect(mockAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "ACTIONED",
            {
                providerMessageId: undefined,
                actionIdentifier: "DEFAULT",
            },
        );
        expect(openSchedule).toHaveBeenCalledWith("41");

        cleanup();
    });

    it("clears a native initial depart response only after fire commit and durable action enqueue", async () => {
        let resolveFire!: (recorded: boolean) => void;
        const fireCommit = new Promise<boolean>((resolve) => {
            resolveFire = resolve;
        });
        let resolveEnqueue!: (queued: boolean) => void;
        const durableEnqueue = new Promise<boolean>((resolve) => {
            resolveEnqueue = resolve;
        });
        const clearLastResponse = jest.fn();
        const actionEventKey = `key:${"b".repeat(64)}`;
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            alarmId: "schedule:41:member:7",
            nativeAlarmId: "schedule:41:member:7:occurrence:M0",
            scheduleId: "41",
            alarmGeneration: "8",
            recipientMemberId: "7",
            occurrenceId: "M0",
            actionEventKey,
            logicalEventKey: "event:00000000-0000-4000-8000-000000000042",
        };
        const initialResponse = {
            actionIdentifier: "schedule_depart_now_action",
            notification: {
                date: Date.parse("2026-08-04T01:00:02.000Z"),
                request: {
                    identifier: "native-initial-depart-1",
                    content: { data },
                },
            },
        };
        mockRecordNativeAlarmResponseFire.mockReturnValueOnce(fireCommit);
        mockEnqueueStandardDepartureAction.mockReturnValueOnce(durableEnqueue);
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => initialResponse),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);

        const configuring = configurePushNavigation(jest.fn(), jest.fn());
        for (
            let attempt = 0;
            attempt < 10 && mockRecordNativeAlarmResponseFire.mock.calls.length === 0;
            attempt += 1
        ) await Promise.resolve();

        expect(mockRecordNativeAlarmResponseFire).toHaveBeenCalledTimes(1);
        expect(mockEnqueueStandardDepartureAction).not.toHaveBeenCalled();
        expect(clearLastResponse).not.toHaveBeenCalled();

        resolveFire(true);
        for (
            let attempt = 0;
            attempt < 10 && mockEnqueueStandardDepartureAction.mock.calls.length === 0;
            attempt += 1
        ) await Promise.resolve();

        expect(mockEnqueueStandardDepartureAction).toHaveBeenCalledWith(expect.objectContaining({
            scheduleId: "41",
            actionEventKey,
            requiresRouteNavigation: false,
        }));
        expect(clearLastResponse).not.toHaveBeenCalled();

        resolveEnqueue(true);
        const cleanup = await configuring;

        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        expect(mockAcknowledgePushDelivery).not.toHaveBeenCalled();
        cleanup();
    });

    it("keeps an ordinary initial depart response until its durable enqueue settles", async () => {
        let resolveEnqueue!: (queued: boolean) => void;
        const durableEnqueue = new Promise<boolean>((resolve) => {
            resolveEnqueue = resolve;
        });
        const clearLastResponse = jest.fn();
        const actionEventKey = `key:${"c".repeat(64)}`;
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "41",
            recipientMemberId: "7",
            actionEventKey,
        };
        mockEnqueueStandardDepartureAction.mockReturnValueOnce(durableEnqueue);
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => ({
                actionIdentifier: "schedule_depart_now_action",
                notification: {
                    request: {
                        identifier: "ordinary-initial-depart-1",
                        content: { data },
                    },
                },
            })),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);

        const configuring = configurePushNavigation(jest.fn(), jest.fn());
        for (
            let attempt = 0;
            attempt < 10 && mockEnqueueStandardDepartureAction.mock.calls.length === 0;
            attempt += 1
        ) await Promise.resolve();

        expect(mockRecordNativeAlarmResponseFire).toHaveBeenCalledWith(data, expect.any(Number));
        expect(mockEnqueueStandardDepartureAction).toHaveBeenCalledTimes(1);
        expect(clearLastResponse).not.toHaveBeenCalled();

        resolveEnqueue(true);
        const cleanup = await configuring;

        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        expect(mockAcknowledgePushDelivery).toHaveBeenCalledWith(
            data,
            "ACTIONED",
            expect.objectContaining({ actionIdentifier: "schedule_depart_now_action" }),
        );
        cleanup();
    });

    it("keeps an initial snooze response until the server mutation attempt settles", async () => {
        let resolveSnooze!: () => void;
        const snoozeAttempt = new Promise<void>((resolve) => {
            resolveSnooze = resolve;
        });
        const clearLastResponse = jest.fn();
        const actionEventKey = "event:00000000-0000-4000-8000-000000000043";
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "41",
            recipientMemberId: "7",
            actionEventKey,
        };
        mockSnoozeScheduleDepartureReminder.mockReturnValueOnce(snoozeAttempt);
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => ({
                actionIdentifier: "schedule_snooze_action",
                notification: {
                    request: {
                        identifier: "ordinary-initial-snooze-1",
                        content: { data },
                    },
                },
            })),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);

        const configuring = configurePushNavigation(jest.fn(), jest.fn());
        for (
            let attempt = 0;
            attempt < 10 && mockSnoozeScheduleDepartureReminder.mock.calls.length === 0;
            attempt += 1
        ) await Promise.resolve();

        expect(mockSnoozeScheduleDepartureReminder).toHaveBeenCalledWith(
            "41",
            actionEventKey,
            7,
        );
        expect(clearLastResponse).not.toHaveBeenCalled();

        resolveSnooze();
        const cleanup = await configuring;

        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it("retains and replays a native depart response after durable enqueue storage fails", async () => {
        const { AppState } = require("react-native") as typeof import("react-native");
        let appStateHandler: ((state: string) => void) | undefined;
        const appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation((
            (_type: string, handler: (state: string) => void) => {
                appStateHandler = handler;
                return { remove: jest.fn() };
            }
        ) as typeof AppState.addEventListener);
        const clearLastResponse = jest.fn();
        const actionEventKey = `key:${"d".repeat(64)}`;
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            alarmId: "schedule:41:member:7",
            nativeAlarmId: "schedule:41:member:7:occurrence:M0",
            scheduleId: "41",
            alarmGeneration: "8",
            recipientMemberId: "7",
            occurrenceId: "M0",
            actionEventKey,
        };
        const response = {
            actionIdentifier: "schedule_depart_now_action",
            notification: {
                date: Date.parse("2026-08-04T01:00:02.000Z"),
                request: {
                    identifier: "native-retry-depart-1",
                    content: { data },
                },
            },
        };
        mockEnqueueStandardDepartureAction.mockRejectedValueOnce(
            new Error("durable storage unavailable"),
        );
        // The first native commit tombstones the physical occurrence. Replay therefore observes
        // no scheduled alarm, but must still retry the independent durable depart action.
        mockRecordNativeAlarmResponseFire
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => response),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);

        const cleanup = await configurePushNavigation(jest.fn(), jest.fn());

        expect(mockRecordNativeAlarmResponseFire).toHaveBeenCalledTimes(1);
        expect(mockEnqueueStandardDepartureAction).toHaveBeenCalledTimes(1);
        expect(clearLastResponse).not.toHaveBeenCalled();

        appStateHandler?.("active");
        for (
            let attempt = 0;
            attempt < 10 && clearLastResponse.mock.calls.length === 0;
            attempt += 1
        ) await Promise.resolve();

        expect(mockRecordNativeAlarmResponseFire).toHaveBeenCalledTimes(2);
        expect(mockEnqueueStandardDepartureAction).toHaveBeenCalledTimes(2);
        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        expect(mockAcknowledgePushDelivery).not.toHaveBeenCalled();
        cleanup();
        appStateSpy.mockRestore();
    });

    it("retains a native response when fire persistence rejects and clears after benign replay", async () => {
        const { AppState } = require("react-native") as typeof import("react-native");
        let appStateHandler: ((state: string) => void) | undefined;
        const appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation((
            (_type: string, handler: (state: string) => void) => {
                appStateHandler = handler;
                return { remove: jest.fn() };
            }
        ) as typeof AppState.addEventListener);
        const clearLastResponse = jest.fn();
        const actionEventKey = `key:${"e".repeat(64)}`;
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            alarmId: "schedule:41:member:7",
            nativeAlarmId: "schedule:41:member:7:occurrence:M0",
            scheduleId: "41",
            alarmGeneration: "8",
            recipientMemberId: "7",
            occurrenceId: "M0",
            actionEventKey,
        };
        const response = {
            actionIdentifier: "schedule_depart_now_action",
            notification: {
                date: Date.parse("2026-08-04T01:00:02.000Z"),
                request: {
                    identifier: "native-fire-retry-depart-1",
                    content: { data },
                },
            },
        };
        mockRecordNativeAlarmResponseFire
            .mockRejectedValueOnce(new Error("fire journal persistence failed"))
            .mockResolvedValueOnce(false);
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => response),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);

        const cleanup = await configurePushNavigation(jest.fn(), jest.fn());

        // The user's action still crosses its durable boundary, but unknown fire durability keeps
        // the OS response available for replay.
        expect(mockEnqueueStandardDepartureAction).toHaveBeenCalledTimes(1);
        expect(clearLastResponse).not.toHaveBeenCalled();

        appStateHandler?.("active");
        for (
            let attempt = 0;
            attempt < 10 && clearLastResponse.mock.calls.length === 0;
            attempt += 1
        ) await Promise.resolve();

        expect(mockRecordNativeAlarmResponseFire).toHaveBeenCalledTimes(2);
        expect(mockEnqueueStandardDepartureAction).toHaveBeenCalledTimes(1);
        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        expect(mockAcknowledgePushDelivery).not.toHaveBeenCalled();
        cleanup();
        appStateSpy.mockRestore();
    });

    it.each([401, 408, 429, 500])(
        "retains a snooze response after retryable API status %s",
        async (status) => {
            const clearLastResponse = jest.fn();
            const data = {
                type: "SCHEDULE_DEPARTURE_REMINDER",
                scheduleId: "41",
                recipientMemberId: "7",
                actionEventKey: "event:00000000-0000-4000-8000-000000000044",
            };
            mockSnoozeScheduleDepartureReminder.mockRejectedValueOnce(
                new ApiResponseError("retry later", { status }),
            );
            setForegroundNotificationsModuleForTests({
                addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
                clearLastNotificationResponse: clearLastResponse,
                getLastNotificationResponse: jest.fn(() => ({
                    actionIdentifier: "schedule_snooze_action",
                    notification: {
                        request: {
                            identifier: `retryable-snooze-${status}`,
                            content: { data },
                        },
                    },
                })),
                setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
            } as never);

            const cleanup = await configurePushNavigation(jest.fn(), jest.fn());

            expect(mockSnoozeScheduleDepartureReminder).toHaveBeenCalledTimes(1);
            expect(clearLastResponse).not.toHaveBeenCalled();
            cleanup();
        },
    );

    it("clears a snooze response after a permanent API rejection", async () => {
        const clearLastResponse = jest.fn();
        mockSnoozeScheduleDepartureReminder.mockRejectedValueOnce(
            new ApiResponseError("invalid snooze", { status: 422 }),
        );
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => ({
                actionIdentifier: "schedule_snooze_action",
                notification: {
                    request: {
                        identifier: "permanent-snooze-422",
                        content: {
                            data: {
                                type: "SCHEDULE_DEPARTURE_REMINDER",
                                scheduleId: "41",
                                recipientMemberId: "7",
                                actionEventKey: "event:00000000-0000-4000-8000-000000000045",
                            },
                        },
                    },
                },
            })),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);

        const cleanup = await configurePushNavigation(jest.fn(), jest.fn());

        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it("clears an invalid depart payload without retrying it", async () => {
        const clearLastResponse = jest.fn();
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => ({
                actionIdentifier: "schedule_depart_now_action",
                notification: {
                    request: {
                        identifier: "invalid-depart-payload-1",
                        content: {
                            data: {
                                type: "SCHEDULE_DEPARTURE_REMINDER",
                                scheduleId: "41",
                                recipientMemberId: "7",
                            },
                        },
                    },
                },
            })),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);

        const cleanup = await configurePushNavigation(jest.fn(), jest.fn());

        expect(mockEnqueueStandardDepartureAction).not.toHaveBeenCalled();
        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it("keeps an app-state replay until its native fire commit attempt settles", async () => {
        const { AppState } = require("react-native") as typeof import("react-native");
        let appStateHandler: ((state: string) => void) | undefined;
        const appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation((
            (_type: string, handler: (state: string) => void) => {
                appStateHandler = handler;
                return { remove: jest.fn() };
            }
        ) as typeof AppState.addEventListener);
        let currentResponse: unknown = null;
        const clearLastResponse = jest.fn();
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => currentResponse),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);
        const cleanup = await configurePushNavigation(jest.fn(), jest.fn());
        let resolveFire!: (recorded: boolean) => void;
        mockRecordNativeAlarmResponseFire.mockReturnValueOnce(new Promise<boolean>((resolve) => {
            resolveFire = resolve;
        }));
        currentResponse = {
            actionIdentifier: "DEFAULT",
            notification: {
                date: Date.parse("2026-08-04T01:00:02.000Z"),
                request: {
                    identifier: "native-app-state-response-1",
                    content: {
                        data: {
                            type: "SCHEDULE_DEPARTURE_REMINDER",
                            alarmId: "schedule:41:member:7",
                            nativeAlarmId: "schedule:41:member:7:occurrence:M0",
                            scheduleId: "41",
                            alarmGeneration: "8",
                            recipientMemberId: "7",
                            occurrenceId: "M0",
                        },
                    },
                },
            },
        };

        appStateHandler?.("active");
        expect(mockRecordNativeAlarmResponseFire).toHaveBeenCalledTimes(1);
        expect(clearLastResponse).not.toHaveBeenCalled();

        resolveFire(false);
        for (
            let attempt = 0;
            attempt < 10 && clearLastResponse.mock.calls.length === 0;
            attempt += 1
        ) await Promise.resolve();

        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        cleanup();
        appStateSpy.mockRestore();
    });

    it("recovers once after a successful depart-now notification action", async () => {
        await completeDepartureFromNotificationAction("41");

        expect(mockMarkScheduleDeparted).toHaveBeenCalledWith("41");
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockMarkScheduleDeparted.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
    });

    it("durably queues a STANDARD depart action only for the bound recipient and canonical key", async () => {
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn((handler) => {
                mockExpoResponseHandler = handler as (response: unknown) => void;
                return { remove: jest.fn() };
            }),
            clearLastNotificationResponse: jest.fn(),
            getLastNotificationResponse: jest.fn(() => null),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);
        const cleanup = await configurePushNavigation(jest.fn(), jest.fn());
        const actionEventKey = `key:${"a".repeat(64)}`;

        mockExpoResponseHandler?.({
            actionIdentifier: "schedule_depart_now_action",
            notification: {
                request: {
                    identifier: "response-1",
                    content: {
                        data: {
                            type: "SCHEDULE_DEPARTURE_REMINDER",
                            scheduleId: "41",
                            recipientMemberId: "7",
                            actionEventKey,
                        },
                    },
                },
            },
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(mockEnqueueStandardDepartureAction).toHaveBeenCalledWith(expect.objectContaining({
            scheduleId: "41",
            recipientMemberId: 7,
            actionEventKey,
            requiresRouteNavigation: false,
        }));
        expect(mockMarkScheduleDeparted).not.toHaveBeenCalled();

        cleanup();
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
