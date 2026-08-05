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
const mockPresentForegroundDepartureReminder = jest.fn();
let mockExpoResponseHandler: ((response: unknown) => void) | undefined;
let mockExpoReceivedHandler: ((notification: unknown) => void) | undefined;
let mockNotificationPresentationHandler: ((notification: unknown) => Promise<unknown>) | undefined;

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
    presentForegroundDepartureReminderForAuthenticatedSession: (...args: unknown[]) =>
        mockPresentForegroundDepartureReminder(...args),
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
    setCustomAlarmNotificationsModuleForTests,
} from "../src/modules/notification/foregroundPush";
import { ApiResponseError } from "../src/api/response";

const FUTURE_ETA_EVENT_EXPIRY = "2099-08-04T01:05:00.000Z";

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
        mockExpoReceivedHandler = undefined;
        mockNotificationPresentationHandler = undefined;
        mockGetAuthMember.mockResolvedValue({ id: 7 });
        mockEnqueueStandardDepartureAction.mockResolvedValue(true);
        mockActivateDepartureActionJournal.mockResolvedValue({ completed: 0 });
        mockRecordNativeAlarmResponseFire.mockImplementation((data) => (
            data?.nativeAlarmId ? Promise.resolve(true) : undefined
        ));
        mockActivateNativeAlarmFireJournal.mockResolvedValue({ sent: 1 });
        mockPresentForegroundDepartureReminder.mockResolvedValue("unsupported");
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

    it("opens one foreground custom alarm and suppresses the duplicate OS presentation", async () => {
        const removeReceived = jest.fn();
        const removeResponse = jest.fn();
        setForegroundNotificationsModuleForTests(null);
        setCustomAlarmNotificationsModuleForTests({
            addNotificationReceivedListener: jest.fn((handler) => {
                mockExpoReceivedHandler = handler as (notification: unknown) => void;
                return { remove: removeReceived };
            }),
            addNotificationResponseReceivedListener: jest.fn((handler) => {
                mockExpoResponseHandler = handler as (response: unknown) => void;
                return { remove: removeResponse };
            }),
            clearLastNotificationResponse: jest.fn(),
            getLastNotificationResponse: jest.fn(() => null),
            setNotificationHandler: jest.fn((handler) => {
                mockNotificationPresentationHandler = handler.handleNotification;
            }),
        } as never);
        const openCustomAlarm = jest.fn();
        const cleanup = await configurePushNavigation(
            jest.fn(),
            jest.fn(),
            undefined,
            openCustomAlarm,
        );
        const request = {
            identifier: "nolate.departure.00000000-0000-5000-8000-000000000042",
            content: {
                data: {
                    type: "NOLATE_CUSTOM_ALARM",
                    alarmId: "schedule:42:member:7",
                    nativeAlarmId: "schedule:42:member:7:occurrence:M0",
                    scheduleId: "42",
                    alarmGeneration: "8",
                    recipientMemberId: "7",
                    occurrenceId: "M0",
                    actionEventKey: `key:${"a".repeat(64)}`,
                    isPreview: false,
                },
            },
        };

        const behavior = await mockNotificationPresentationHandler?.({
            date: Date.now(),
            request,
        });
        expect(behavior).toEqual({
            shouldShowBanner: false,
            shouldShowList: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
        });
        mockExpoReceivedHandler?.({ date: Date.now(), request });
        for (let attempt = 0; attempt < 10 && openCustomAlarm.mock.calls.length === 0; attempt += 1) {
            await Promise.resolve();
        }
        expect(openCustomAlarm).toHaveBeenCalledTimes(1);
        expect(openCustomAlarm).toHaveBeenLastCalledWith(expect.objectContaining({
            alarmId: "schedule:42:member:7",
            requestedAction: "open",
        }));

        mockExpoResponseHandler?.({
            actionIdentifier: "DEFAULT",
            notification: { request },
        });
        await Promise.resolve();
        expect(openCustomAlarm).toHaveBeenCalledTimes(1);

        mockExpoResponseHandler?.({
            actionIdentifier: "nolate_custom_alarm_confirm_departure_action",
            notification: { request },
        });
        for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve();
        expect(openCustomAlarm).toHaveBeenCalledTimes(1);

        mockExpoReceivedHandler?.({
            request: {
                identifier: "ordinary-push-1",
                content: { data: { type: "SCHEDULE_TRAFFIC", scheduleId: "42" } },
            },
        });
        expect(openCustomAlarm).toHaveBeenCalledTimes(1);

        cleanup();
        expect(removeReceived).toHaveBeenCalledTimes(1);
        expect(removeResponse).toHaveBeenCalledTimes(1);
    });

    it("replays an initial local custom-alarm response without APNs token support", async () => {
        const clearLastResponse = jest.fn();
        const response = {
            actionIdentifier: "DEFAULT",
            notification: {
                request: {
                    identifier: "nolate.custom-alarm.preview.current",
                    content: {
                        data: {
                            type: "NOLATE_CUSTOM_ALARM",
                            alarmId: "preview:5ef854e8-32de-4fde-98fa-280c2e9772dd",
                            previewId: "5ef854e8-32de-4fde-98fa-280c2e9772dd",
                            isPreview: true,
                        },
                    },
                },
            },
        };
        setForegroundNotificationsModuleForTests(null);
        setCustomAlarmNotificationsModuleForTests({
            addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => response),
        } as never);
        const openCustomAlarm = jest.fn();

        const cleanup = await configurePushNavigation(
            jest.fn(),
            jest.fn(),
            undefined,
            openCustomAlarm,
        );

        expect(openCustomAlarm).toHaveBeenCalledWith(expect.objectContaining({
            isPreview: true,
            requestedAction: "open",
        }));
        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it("keeps the OS banner and sound when NoLate cannot open its foreground alarm screen", async () => {
        setForegroundNotificationsModuleForTests(null);
        setCustomAlarmNotificationsModuleForTests({
            addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: jest.fn(),
            getLastNotificationResponse: jest.fn(() => null),
            setNotificationHandler: jest.fn((handler) => {
                mockNotificationPresentationHandler = handler.handleNotification;
            }),
        } as never);
        const cleanup = await configurePushNavigation(
            jest.fn(),
            jest.fn(),
            undefined,
            jest.fn(() => "deferred" as const),
        );
        const behavior = await mockNotificationPresentationHandler?.({
            date: Date.now(),
            request: {
                identifier: "nolate.custom-alarm.preview.current",
                content: {
                    data: {
                        type: "NOLATE_CUSTOM_ALARM",
                        alarmId: "preview:5ef854e8-32de-4fde-98fa-280c2e9772dd",
                        previewId: "5ef854e8-32de-4fde-98fa-280c2e9772dd",
                        isPreview: true,
                    },
                },
            },
        });

        expect(behavior).toEqual({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
        });
        cleanup();
    });

    it("suppresses a foreground custom alarm that belongs to another account", async () => {
        setForegroundNotificationsModuleForTests(null);
        setCustomAlarmNotificationsModuleForTests({
            addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: jest.fn(),
            getLastNotificationResponse: jest.fn(() => null),
            setNotificationHandler: jest.fn((handler) => {
                mockNotificationPresentationHandler = handler.handleNotification;
            }),
        } as never);
        mockGetAuthMember.mockResolvedValue({ id: 8 });
        const openCustomAlarm = jest.fn();
        const cleanup = await configurePushNavigation(
            jest.fn(),
            jest.fn(),
            undefined,
            openCustomAlarm,
        );

        const behavior = await mockNotificationPresentationHandler?.({
            date: Date.now(),
            request: {
                identifier: "nolate.departure.00000000-0000-5000-8000-000000000042",
                content: {
                    data: {
                        type: "NOLATE_CUSTOM_ALARM",
                        alarmId: "schedule:42:member:7",
                        nativeAlarmId: "schedule:42:member:7:occurrence:M0",
                        scheduleId: "42",
                        alarmGeneration: "8",
                        recipientMemberId: "7",
                        occurrenceId: "M0",
                        actionEventKey: `key:${"a".repeat(64)}`,
                        isPreview: false,
                    },
                },
            },
        });

        expect(behavior).toEqual({
            shouldShowBanner: false,
            shouldShowList: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
        });
        expect(openCustomAlarm).not.toHaveBeenCalled();
        cleanup();
    });

    it("opens distinct preview UUIDs even though their native request identifier is reused", async () => {
        setForegroundNotificationsModuleForTests(null);
        setCustomAlarmNotificationsModuleForTests({
            addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: jest.fn(),
            getLastNotificationResponse: jest.fn(() => null),
            setNotificationHandler: jest.fn((handler) => {
                mockNotificationPresentationHandler = handler.handleNotification;
            }),
        } as never);
        const openedPreviewIds: string[] = [];
        const openCustomAlarm = jest.fn((target: { previewId?: string }) => {
            if (target.previewId) openedPreviewIds.push(target.previewId);
            return "opened" as const;
        });
        const cleanup = await configurePushNavigation(
            jest.fn(),
            jest.fn(),
            undefined,
            openCustomAlarm,
        );
        const previewIds = [
            "5ef854e8-32de-4fde-98fa-280c2e9772dd",
            "6ef854e8-32de-4fde-98fa-280c2e9772ee",
        ];

        const behaviors = [];
        for (const previewId of previewIds) {
            behaviors.push(await mockNotificationPresentationHandler?.({
                date: Date.now(),
                request: {
                    identifier: "nolate.custom-alarm.preview.current",
                    content: {
                        data: {
                            type: "NOLATE_CUSTOM_ALARM",
                            alarmId: `preview:${previewId}`,
                            previewId,
                            isPreview: true,
                        },
                    },
                },
            }));
        }

        expect(openCustomAlarm).toHaveBeenCalledTimes(2);
        expect(openedPreviewIds).toEqual(previewIds);
        expect(behaviors).toEqual([
            {
                shouldShowBanner: false,
                shouldShowList: false,
                shouldPlaySound: false,
                shouldSetBadge: false,
            },
            {
                shouldShowBanner: false,
                shouldShowList: false,
                shouldPlaySound: false,
                shouldSetBadge: false,
            },
        ]);
        cleanup();
    });

    it("returns the OS fallback before a slow native fire commit can miss Expo's deadline", async () => {
        jest.useFakeTimers();
        let cleanup: (() => void) | undefined;
        let resolveSlowCommit: ((recorded: boolean) => void) | undefined;
        try {
            setForegroundNotificationsModuleForTests(null);
            setCustomAlarmNotificationsModuleForTests({
                addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
                addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
                clearLastNotificationResponse: jest.fn(),
                getLastNotificationResponse: jest.fn(() => null),
                setNotificationHandler: jest.fn((handler) => {
                    mockNotificationPresentationHandler = handler.handleNotification;
                }),
            } as never);
            const openCustomAlarm = jest.fn(() => "opened" as const);
            mockRecordNativeAlarmResponseFire.mockImplementationOnce(() => (
                new Promise<boolean>((resolve) => {
                    resolveSlowCommit = resolve;
                })
            ));
            cleanup = await configurePushNavigation(
                jest.fn(),
                jest.fn(),
                undefined,
                openCustomAlarm,
            );
            const notification = {
                date: Date.now(),
                request: {
                    identifier: "nolate.departure.00000000-0000-5000-8000-000000000042",
                    content: {
                        data: {
                            type: "NOLATE_CUSTOM_ALARM",
                            alarmId: "schedule:42:member:7",
                            nativeAlarmId: "schedule:42:member:7:occurrence:M0",
                            scheduleId: "42",
                            alarmGeneration: "8",
                            recipientMemberId: "7",
                            occurrenceId: "M0",
                            actionEventKey: `key:${"a".repeat(64)}`,
                            isPreview: false,
                        },
                    },
                },
            };

            const behaviorPromise = mockNotificationPresentationHandler?.(notification);
            await Promise.resolve();
            jest.advanceTimersByTime(2_500);
            await expect(behaviorPromise).resolves.toEqual({
                shouldShowBanner: true,
                shouldShowList: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
            });

            jest.advanceTimersByTime(60_000);
            resolveSlowCommit?.(true);
            for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve();
            expect(openCustomAlarm).not.toHaveBeenCalled();
        } finally {
            cleanup?.();
            jest.useRealTimers();
        }
    });

    it("cancels a late automatic open after auth delay but lets one explicit response open", async () => {
        jest.useFakeTimers();
        let cleanup: (() => void) | undefined;
        let resolveSlowAuth: ((member: { id: number }) => void) | undefined;
        try {
            setForegroundNotificationsModuleForTests(null);
            setCustomAlarmNotificationsModuleForTests({
                addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
                addNotificationResponseReceivedListener: jest.fn((handler) => {
                    mockExpoResponseHandler = handler as (response: unknown) => void;
                    return { remove: jest.fn() };
                }),
                clearLastNotificationResponse: jest.fn(),
                getLastNotificationResponse: jest.fn(() => null),
                setNotificationHandler: jest.fn((handler) => {
                    mockNotificationPresentationHandler = handler.handleNotification;
                }),
            } as never);
            const openCustomAlarm = jest.fn(() => "opened" as const);
            mockGetAuthMember
                .mockImplementationOnce(() => new Promise((resolve) => {
                    resolveSlowAuth = resolve;
                }))
                .mockResolvedValue({ id: 7 });
            cleanup = await configurePushNavigation(
                jest.fn(),
                jest.fn(),
                undefined,
                openCustomAlarm,
            );
            const notification = {
                date: Date.now(),
                request: {
                    identifier: "nolate.departure.00000000-0000-5000-8000-000000000042",
                    content: {
                        data: {
                            type: "NOLATE_CUSTOM_ALARM",
                            alarmId: "schedule:42:member:7",
                            nativeAlarmId: "schedule:42:member:7:occurrence:M0",
                            scheduleId: "42",
                            alarmGeneration: "8",
                            recipientMemberId: "7",
                            occurrenceId: "M0",
                            actionEventKey: `key:${"a".repeat(64)}`,
                            isPreview: false,
                        },
                    },
                },
            };

            const behaviorPromise = mockNotificationPresentationHandler?.(notification);
            for (let attempt = 0; attempt < 5; attempt += 1) await Promise.resolve();
            jest.advanceTimersByTime(2_500);
            await expect(behaviorPromise).resolves.toEqual({
                shouldShowBanner: true,
                shouldShowList: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
            });

            resolveSlowAuth?.({ id: 7 });
            for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve();
            expect(openCustomAlarm).not.toHaveBeenCalled();

            mockExpoResponseHandler?.({
                actionIdentifier: "DEFAULT",
                notification,
            });
            for (let attempt = 0; attempt < 15 && openCustomAlarm.mock.calls.length === 0; attempt += 1) {
                await Promise.resolve();
            }
            expect(openCustomAlarm).toHaveBeenCalledTimes(1);
        } finally {
            cleanup?.();
            jest.useRealTimers();
        }
    });

    it("retains a deferred cold-start custom alarm response until navigation becomes ready", async () => {
        const clearLastResponse = jest.fn();
        const response = {
            actionIdentifier: "DEFAULT",
            notification: {
                request: {
                    identifier: "nolate.custom-alarm.preview.current",
                    content: {
                        data: {
                            type: "NOLATE_CUSTOM_ALARM",
                            alarmId: "preview:5ef854e8-32de-4fde-98fa-280c2e9772dd",
                            previewId: "5ef854e8-32de-4fde-98fa-280c2e9772dd",
                            isPreview: true,
                        },
                    },
                },
            },
        };
        const module = {
            addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => response),
        };
        setForegroundNotificationsModuleForTests(null);
        setCustomAlarmNotificationsModuleForTests(module as never);

        const deferredCleanup = await configurePushNavigation(
            jest.fn(),
            jest.fn(),
            undefined,
            jest.fn(() => "deferred" as const),
        );
        expect(clearLastResponse).not.toHaveBeenCalled();
        deferredCleanup();

        const openCustomAlarm = jest.fn(() => "opened" as const);
        const openedCleanup = await configurePushNavigation(
            jest.fn(),
            jest.fn(),
            undefined,
            openCustomAlarm,
        );
        expect(openCustomAlarm).toHaveBeenCalledTimes(1);
        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        openedCleanup();
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
            etaEventExpiresAt: FUTURE_ETA_EVENT_EXPIRY,
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
            etaEventExpiresAt: FUTURE_ETA_EVENT_EXPIRY,
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

    it("prioritizes an explicit Expo depart action over RNFirebase's cold-start default open", async () => {
        const clearLastResponse = jest.fn();
        const openSchedule = jest.fn();
        const actionEventKey = `key:${"f".repeat(64)}`;
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "41",
            recipientMemberId: "7",
            actionEventKey,
            etaEventExpiresAt: FUTURE_ETA_EVENT_EXPIRY,
        };
        mockGetInitialNotification.mockResolvedValueOnce({
            data,
            messageId: "firebase-cold-start-41",
        });
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => ({
                actionIdentifier: "schedule_depart_now_action",
                notification: {
                    request: {
                        identifier: "expo-cold-start-depart-41",
                        content: { data },
                    },
                },
            })),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);

        const cleanup = await configurePushNavigation(openSchedule, jest.fn());

        expect(mockEnqueueStandardDepartureAction).toHaveBeenCalledWith(expect.objectContaining({
            scheduleId: "41",
            recipientMemberId: 7,
            actionEventKey,
        }));
        expect(openSchedule).not.toHaveBeenCalled();
        expect(clearLastResponse).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it("clears a mismatched historical Expo action instead of stealing a newer Firebase tap", async () => {
        const { AppState } = require("react-native") as typeof import("react-native");
        let appStateHandler: ((state: string) => void) | undefined;
        const appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation((
            (_type: string, handler: (state: string) => void) => {
                appStateHandler = handler;
                return { remove: jest.fn() };
            }
        ) as typeof AppState.addEventListener);
        const oldData = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "41",
            recipientMemberId: "7",
            actionEventKey: `key:${"1".repeat(64)}`,
            etaEventExpiresAt: "2099-08-04T01:05:00.000Z",
        };
        const newData = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "42",
            recipientMemberId: "7",
            actionEventKey: `key:${"2".repeat(64)}`,
            etaEventExpiresAt: "2099-08-04T01:05:00.000Z",
        };
        let storedResponse: unknown = {
            actionIdentifier: "schedule_depart_now_action",
            notification: {
                request: {
                    identifier: "historical-expo-response-41",
                    content: { data: oldData },
                },
            },
        };
        const clearLastResponse = jest.fn(() => { storedResponse = null; });
        mockGetInitialNotification.mockResolvedValueOnce({
            data: newData,
            messageId: "new-firebase-tap-42",
        });
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => storedResponse),
            setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
        } as never);
        const openSchedule = jest.fn();

        const cleanup = await configurePushNavigation(openSchedule, jest.fn());

        expect(openSchedule).toHaveBeenCalledWith("42");
        expect(mockEnqueueStandardDepartureAction).not.toHaveBeenCalled();
        expect(clearLastResponse).toHaveBeenCalledTimes(1);

        appStateHandler?.("active");
        await Promise.resolve();
        expect(mockEnqueueStandardDepartureAction).not.toHaveBeenCalled();
        cleanup();
        appStateSpy.mockRestore();
    });

    it("clears an expired Expo depart action without enqueueing a server mutation", async () => {
        const clearLastResponse = jest.fn();
        const data = {
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "41",
            recipientMemberId: "7",
            actionEventKey: `key:${"9".repeat(64)}`,
            etaEventExpiresAt: "2020-01-01T00:00:00.000Z",
        };
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => ({
                actionIdentifier: "schedule_depart_now_action",
                notification: {
                    request: {
                        identifier: "expired-expo-depart-41",
                        content: { data },
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

    it("rejects a standard departure action when its expiration is missing", async () => {
        const clearLastResponse = jest.fn();
        setForegroundNotificationsModuleForTests({
            addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
            clearLastNotificationResponse: clearLastResponse,
            getLastNotificationResponse: jest.fn(() => ({
                actionIdentifier: "schedule_depart_now_action",
                notification: {
                    request: {
                        identifier: "missing-expiry-depart-41",
                        content: {
                            data: {
                                type: "SCHEDULE_DEPARTURE_REMINDER",
                                scheduleId: "41",
                                recipientMemberId: "7",
                                actionEventKey: `key:${"8".repeat(64)}`,
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
            etaEventExpiresAt: FUTURE_ETA_EVENT_EXPIRY,
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
            etaEventExpiresAt: FUTURE_ETA_EVENT_EXPIRY,
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
            etaEventExpiresAt: FUTURE_ETA_EVENT_EXPIRY,
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
                etaEventExpiresAt: FUTURE_ETA_EVENT_EXPIRY,
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
                                etaEventExpiresAt: FUTURE_ETA_EVENT_EXPIRY,
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
                            etaEventExpiresAt: FUTURE_ETA_EVENT_EXPIRY,
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
