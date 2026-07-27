import {
    type FirebaseMessagingTypes,
    getInitialNotification,
    getMessaging,
    onMessage,
    onNotificationOpenedApp,
} from "@react-native-firebase/messaging";
import * as Device from "expo-device";
import type { NotificationResponse } from "expo-notifications";
import { requireOptionalNativeModule } from "expo-modules-core";
import { AppState, Platform } from "react-native";

import { markScheduleDeparted, snoozeScheduleDepartureReminder } from "../../api/schedule";
import {
    getAuthMember,
    getAuthSessionEpoch,
    isAuthSessionActive,
    subscribeAuthSessionEpoch,
} from "../auth/authStorage";
import { createAuthEpochAbortController } from "../auth/authEpochAbortController";
import {
    getNotificationActionCategoryFromData,
    getPushNavigationTargetFromNotificationData,
    getScheduleIdFromNotificationData,
    SCHEDULE_DEPARTURE_ACTION_CATEGORY,
} from "./pushNavigation";
import {
    createNotificationEventConsumer,
    consumeNotificationEventAfterValidation,
    getExplicitLogicalNotificationEventKey,
    getExpoNotificationProviderMessageId,
} from "./notificationEventKey";
import {
    createNotificationActionDedupe,
    executeNotificationActionOnce,
} from "./notificationActionDedupe";
import { configureNotificationOpenLifecycle } from "./notificationOpenLifecycle";
import {
    createPushActionFailureGate,
    type PushActionFailure,
} from "./pushActionFailureGate";
import { emitAppNotificationReceived } from "./appNotificationEvents";
import { refreshForegroundPushCaches } from "./foregroundTrafficRefresh";
import {
    createNotificationActionKeys,
    type ValidatedNotificationAccountBinding,
} from "./notificationAccountBinding";
import {
    executeNotificationActionForActiveSession,
    resolveActiveNotificationAccountBinding,
    shouldReportNotificationFailureForSession,
} from "./notificationSessionFence";
import { SCHEDULE_PUSH_CHANNEL_ID } from "./notificationPermission";
import { emitScheduleDepartureMutation } from "../schedule/scheduleDepartureMutationEvents";
import {
    invalidateScheduleDepartureStatus,
    setCachedScheduleDepartureStatus,
} from "../schedule/departureStatusCache";
import {
    processForegroundPushForSession,
    type ForegroundPushPresentation,
} from "./foregroundPushSession";
import {
    runNotificationPresentationMutation,
} from "./notificationPresentationCoordinator";
import {
    isScheduleNotificationAllowedBySharingPolicy,
} from "../share/scheduleSharingPolicy";

export type { PushActionFailure } from "./pushActionFailureGate";

export type PushNavigationBinding = ValidatedNotificationAccountBinding & {
    authEpoch: number;
};

const ANDROID_CHANNEL_ID = SCHEDULE_PUSH_CHANNEL_ID;
const SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER = "schedule_depart_now_action";
const SCHEDULE_SNOOZE_ACTION_IDENTIFIER = "schedule_snooze_action";

type ExpoNotificationsModule = typeof import("expo-notifications");

let notificationsModule: ExpoNotificationsModule | null | undefined;

function logPushDevelopment(
    level: "info" | "warn",
    message: string,
    detail?: unknown,
): void {
    if (!__DEV__) return;
    if (detail === undefined) {
        console[level](message);
        return;
    }
    console[level](message, detail);
}

async function getNotifications(): Promise<ExpoNotificationsModule | null> {
    if (notificationsModule !== undefined) {
        return notificationsModule;
    }

    // iOS Simulator는 APNs 원격 푸시를 지원하지 않는다. expo-notifications를 import하면
    // 패키지 초기화 과정에서 서버 등록 정보를 Keychain에서 즉시 읽기 때문에, 서명되지
    // 않은 시뮬레이터 런타임에서는 errSecMissingEntitlement 오류가 발생할 수 있다.
    if (Platform.OS === "ios" && !Device.isDevice) {
        notificationsModule = null;
        return notificationsModule;
    }

    if (!requireOptionalNativeModule("ExpoPushTokenManager")) {
        notificationsModule = null;
        return notificationsModule;
    }

    try {
        const Notifications = await import("expo-notifications");

        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowBanner: true,
                shouldShowList: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
            }),
        });

        notificationsModule = Notifications;
    } catch (error) {
        logPushDevelopment("warn", "[push] expo-notifications is unavailable in this build", error);
        notificationsModule = null;
    }

    return notificationsModule;
}

export async function configureForegroundPush(): Promise<() => void> {
    const Notifications = await getNotifications();

    if (!Notifications) {
        return () => undefined;
    }

    await ensureNotificationPresentation(Notifications);

    return onMessage(
        getMessaging(),
        (message) => showForegroundNotification(message, Notifications),
    );
}

export async function configurePushNavigation(
    openSchedule: (scheduleId: string, binding: PushNavigationBinding) => void,
    openShareInbox: (binding: PushNavigationBinding) => void,
    onActionFailure?: (failure: PushActionFailure) => void,
): Promise<() => void> {
    const Notifications = await getNotifications();
    const messaging = getMessaging();
    const openedEventConsumer = createNotificationEventConsumer();
    const actionDedupe = createNotificationActionDedupe();
    const actionFailureGate = createPushActionFailureGate(
        onActionFailure,
        AppState.currentState === "active",
    );

    if (Notifications) {
        await ensureNotificationPresentation(Notifications);
    }
    const unsubscribeAuthSession = subscribeAuthSessionEpoch(() => {
        openedEventConsumer.clear();
        actionDedupe.clear();
        actionFailureGate.clearPending();
    });

    const getValidatedMember = async (
        data: Record<string, unknown> | undefined,
    ): Promise<PushNavigationBinding | undefined> =>
        resolveActiveNotificationAccountBinding({
            data,
            getAuthEpoch: getAuthSessionEpoch,
            isAuthSessionActive,
            getCurrentMemberId: async () => (await getAuthMember())?.id,
        });

    const openFromData = async (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        _providerEventId?: string,
    ) => {
        const target = getPushNavigationTargetFromNotificationData(data);
        if (!target) {
            logPushDevelopment("info", "[push] notification has no navigation target", data);
            return;
        }
        const binding = await getValidatedMember(data);
        if (!binding) return;
        if (!isAuthSessionActive(binding.authEpoch)) return;
        // New account-owned payloads must carry the backend logical key. Provider
        // IDs and payload hashes are transport dedupe hints, not authorization.
        if (!consumeNotificationEventAfterValidation(
            openedEventConsumer,
            binding.logicalEventKey,
            true,
        )) return;

        if (target.kind === "scheduleDetail") {
            logPushDevelopment("info", "[push] opening schedule from notification", target.scheduleId);
            openSchedule(target.scheduleId, binding);
            return;
        }

        logPushDevelopment("info", "[push] opening share inbox from notification");
        openShareInbox(binding);
    };

    const markDepartedFromData = async (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        _providerEventId?: string,
    ) => {
        if (!isScheduleNotificationAllowedBySharingPolicy(data)) return;
        const receivedEpoch = getAuthSessionEpoch();
        if (!isAuthSessionActive(receivedEpoch)) return;
        const scheduleId = getScheduleIdFromNotificationData(data);

        if (!scheduleId) {
            logPushDevelopment("warn", "[push] depart-now action has no schedule target", data);
            actionFailureGate.report({
                action: "departNow",
                message: "알림의 일정 정보를 확인하지 못했어요. 앱에서 일정을 열어 출발 상태를 변경해 주세요.",
            });
            return;
        }

        const binding = await getValidatedMember(data);
        if (!binding) {
            if (!shouldReportNotificationFailureForSession(
                receivedEpoch,
                isAuthSessionActive,
            )) return;
            actionFailureGate.report({
                action: "departNow",
                scheduleId,
                message: "이 알림은 현재 로그인한 계정의 알림이 아니에요. 현재 계정에서 일정을 다시 열어 주세요.",
            });
            return;
        }
        const actionKeys = createNotificationActionKeys("departNow", binding);
        try {
            const executed = await executeNotificationActionOnce(
                actionDedupe,
                actionKeys.dedupeKey,
                () => executeNotificationActionForActiveSession(
                    binding.authEpoch,
                    isAuthSessionActive,
                    async () => {
                        const abort = createAuthEpochAbortController(binding.authEpoch);
                        try {
                            return await markScheduleDeparted(scheduleId, {
                                signal: abort.signal,
                                idempotencyKey: actionKeys.idempotencyKey,
                            });
                        } finally {
                            abort.dispose();
                        }
                    },
                ),
                (result) => {
                    if (!isAuthSessionActive(binding.authEpoch)) {
                        throw new Error("AUTH_SESSION_CHANGED");
                    }
                    if (result.status) {
                        setCachedScheduleDepartureStatus(
                            `member:${binding.recipientMemberId}`,
                            result.status,
                        );
                    }
                    emitScheduleDepartureMutation({
                        authEpoch: binding.authEpoch,
                        kind: "departed",
                        scheduleId,
                        item: result.item,
                        status: result.status,
                        refreshing: result.refreshing,
                    });
                    if (!result.status) invalidateScheduleDepartureStatus(scheduleId);
                },
            );
            if (!executed) return;
            logPushDevelopment("info", "[push] schedule marked as departed from notification action", scheduleId);
        } catch (error) {
            logPushDevelopment("warn", "[push] depart-now action failed", error);
            if (isAuthSessionActive(binding.authEpoch)) {
                actionFailureGate.report({
                    action: "departNow",
                    scheduleId,
                    message: "출발 상태를 변경하지 못했어요. 네트워크를 확인한 뒤 일정 화면에서 다시 시도해 주세요.",
                });
            }
        }
    };

    const snoozeFromData = async (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        _providerEventId?: string,
    ) => {
        if (!isScheduleNotificationAllowedBySharingPolicy(data)) return;
        const receivedEpoch = getAuthSessionEpoch();
        if (!isAuthSessionActive(receivedEpoch)) return;
        const scheduleId = getScheduleIdFromNotificationData(data);

        if (!scheduleId) {
            logPushDevelopment("warn", "[push] snooze action has no schedule target", data);
            actionFailureGate.report({
                action: "snooze",
                message: "알림의 일정 정보를 확인하지 못했어요. 앱에서 일정을 열어 알림을 다시 설정해 주세요.",
            });
            return;
        }

        const binding = await getValidatedMember(data);
        if (!binding) {
            if (!shouldReportNotificationFailureForSession(
                receivedEpoch,
                isAuthSessionActive,
            )) return;
            actionFailureGate.report({
                action: "snooze",
                scheduleId,
                message: "이 알림은 현재 로그인한 계정의 알림이 아니에요. 현재 계정에서 일정을 다시 열어 주세요.",
            });
            return;
        }
        const actionKeys = createNotificationActionKeys("snooze", binding);
        try {
            const executed = await executeNotificationActionOnce(
                actionDedupe,
                actionKeys.dedupeKey,
                () => executeNotificationActionForActiveSession(
                    binding.authEpoch,
                    isAuthSessionActive,
                    async () => {
                        const abort = createAuthEpochAbortController(binding.authEpoch);
                        try {
                            return await snoozeScheduleDepartureReminder(scheduleId, {
                                signal: abort.signal,
                                idempotencyKey: actionKeys.idempotencyKey,
                            });
                        } finally {
                            abort.dispose();
                        }
                    },
                ),
                (result) => {
                    if (!isAuthSessionActive(binding.authEpoch)) {
                        throw new Error("AUTH_SESSION_CHANGED");
                    }
                    if (result.status) {
                        setCachedScheduleDepartureStatus(
                            `member:${binding.recipientMemberId}`,
                            result.status,
                        );
                    }
                    emitScheduleDepartureMutation({
                        authEpoch: binding.authEpoch,
                        kind: "snoozed",
                        scheduleId,
                        item: result.item,
                        status: result.status,
                        refreshing: result.refreshing,
                    });
                    if (!result.status) invalidateScheduleDepartureStatus(scheduleId);
                },
            );
            if (!executed) return;
            logPushDevelopment("info", "[push] schedule departure reminder snoozed from notification action", scheduleId);
        } catch (error) {
            logPushDevelopment("warn", "[push] snooze action failed", error);
            if (isAuthSessionActive(binding.authEpoch)) {
                actionFailureGate.report({
                    action: "snooze",
                    scheduleId,
                    message: "알림을 미루지 못했어요. 네트워크를 확인한 뒤 일정 화면에서 다시 시도해 주세요.",
                });
            }
        }
    };

    const handleNotificationResponse = (response: NotificationResponse) => {
        const request = response.notification.request;
        const providerEventId = getExpoNotificationProviderMessageId(response);
        // An action from an already-delivered sharing notification is subject
        // to the same gate as a normal tap and is dropped before dedupe or API use.
        if (!isScheduleNotificationAllowedBySharingPolicy(request.content.data)) {
            return;
        }

        if (response.actionIdentifier === SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER) {
            markDepartedFromData(request.content.data, providerEventId).catch(() => undefined);
            return;
        }

        if (response.actionIdentifier === SCHEDULE_SNOOZE_ACTION_IDENTIFIER) {
            snoozeFromData(request.content.data, providerEventId).catch(() => undefined);
            return;
        }

        openFromData(request.content.data, providerEventId).catch(() => undefined);
    };

    const appStateSubscription = Notifications
        ? AppState.addEventListener("change", (state) => {
            actionFailureGate.onAppStateChange(state);
            if (state !== "active") return;

            // foreground 전환 시점에 놓친 iOS notification response를 한 번 더 확인한다.
            const response = Notifications.getLastNotificationResponse();
            if (!response) return;

            Notifications.clearLastNotificationResponse();
            handleNotificationResponse(response);
        })
        : undefined;
    const unsubscribeOpenLifecycle = await configureNotificationOpenLifecycle({
        addExpoResponseListener: Notifications
            ? (listener) => Notifications.addNotificationResponseReceivedListener(listener)
            : undefined,
        onFirebaseOpened: (listener) => onNotificationOpenedApp(messaging, listener),
        getInitialFirebase: () => getInitialNotification(messaging),
        getLastExpoResponse: Notifications
            ? () => Notifications.getLastNotificationResponse()
            : undefined,
        clearLastExpoResponse: Notifications
            ? () => Notifications.clearLastNotificationResponse()
            : undefined,
    }, {
        handleExpoResponse: handleNotificationResponse,
        handleFirebaseMessage: (message) => {
            openFromData(message.data, message.messageId).catch(() => undefined);
        },
        getExpoEventKey: (response) => getExplicitLogicalNotificationEventKey(
            isScheduleNotificationAllowedBySharingPolicy(
                response.notification.request.content.data,
            )
                ? response.notification.request.content.data
                : undefined,
        ),
        getFirebaseEventKey: (message) => getExplicitLogicalNotificationEventKey(
            isScheduleNotificationAllowedBySharingPolicy(message.data)
                ? message.data
                : undefined,
        ),
        isExpoAction: (response) =>
            response.actionIdentifier === SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER ||
            response.actionIdentifier === SCHEDULE_SNOOZE_ACTION_IDENTIFIER,
    });

    return () => {
        unsubscribeAuthSession();
        actionFailureGate.dispose();
        appStateSubscription?.remove();
        unsubscribeOpenLifecycle();
    };
}

async function showForegroundNotification(
    message: FirebaseMessagingTypes.RemoteMessage,
    Notifications: ExpoNotificationsModule,
): Promise<void> {
    await processForegroundPushForSession({
        message,
        getAuthEpoch: getAuthSessionEpoch,
        isAuthSessionActive,
        getCurrentMemberId: async () => (await getAuthMember())?.id,
        emitReceived: emitAppNotificationReceived,
        refreshCaches: refreshForegroundPushCaches,
        present: (notification, authEpoch) =>
            runNotificationPresentationMutation(async () => {
                if (!isAuthSessionActive(authEpoch)) return;
                await showLocalNotification(Notifications, notification);
            }),
    });
}

async function showLocalNotification(
    Notifications: ExpoNotificationsModule,
    notification: ForegroundPushPresentation,
): Promise<void> {
    await Notifications.scheduleNotificationAsync({
        content: {
            title: notification.title,
            body: notification.body,
            data: notification.data,
            sound: "default",
            categoryIdentifier: getNotificationActionCategoryFromData(notification.data),
        },
        trigger: Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : null,
    });
}

async function ensureNotificationPresentation(Notifications: ExpoNotificationsModule): Promise<void> {
    await ensureDepartNowCategory(Notifications);

    if (Platform.OS !== "android") return;

    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: "일정 알림",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
    });
}

async function ensureDepartNowCategory(Notifications: ExpoNotificationsModule): Promise<void> {
    try {
        // 출발 리마인더에는 사전 알림과 정각 알림 모두에서 출발 완료 액션을 제공한다.
        await Notifications.setNotificationCategoryAsync(
            SCHEDULE_DEPARTURE_ACTION_CATEGORY,
            [
                {
                    identifier: SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER,
                    buttonTitle: "지금 출발 완료",
                    options: {
                        opensAppToForeground: true,
                    },
                },
                {
                    identifier: SCHEDULE_SNOOZE_ACTION_IDENTIFIER,
                    buttonTitle: "5분 뒤 다시 알림",
                    options: {
                        opensAppToForeground: true,
                    },
                },
            ],
            {
                showTitle: true,
                showSubtitle: true,
            },
        );
    } catch (error) {
        logPushDevelopment("warn", "[push] notification action category setup failed", error);
    }
}
