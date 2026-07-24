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
    getNotificationActionCategoryFromData,
    getPushNavigationTargetFromNotificationData,
    getScheduleIdFromNotificationData,
    SCHEDULE_DEPARTURE_ACTION_CATEGORY,
} from "./pushNavigation";
import {
    createCanonicalNotificationEventKey,
    createNotificationEventConsumer,
    getExpoNotificationProviderMessageId,
    withCanonicalNotificationEventKey,
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

export type { PushActionFailure } from "./pushActionFailureGate";

const ANDROID_CHANNEL_ID = "schedule-push";
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

type LocalPushNotification = {
    title: string;
    body: string;
    data: Record<string, unknown>;
};

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

    return onMessage(getMessaging(), showForegroundNotification);
}

export async function configurePushNavigation(
    openSchedule: (scheduleId: string) => void,
    openShareInbox: () => void,
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

    const openFromData = (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        providerEventId?: string,
    ) => {
        const eventKey = createCanonicalNotificationEventKey(data, providerEventId);
        // Expo request identifier와 FCM messageId가 달라도 payload 기반 canonical key로
        // 동일 사용자 터치를 한 번만 소비한다.
        if (!openedEventConsumer.consume(eventKey)) return;

        const target = getPushNavigationTargetFromNotificationData(data);
        if (!target) {
            logPushDevelopment("info", "[push] notification has no navigation target", data);
            return;
        }

        if (target.kind === "scheduleDetail") {
            logPushDevelopment("info", "[push] opening schedule from notification", target.scheduleId);
            openSchedule(target.scheduleId);
            return;
        }

        logPushDevelopment("info", "[push] opening share inbox from notification");
        openShareInbox();
    };

    const markDepartedFromData = async (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        providerEventId?: string,
    ) => {
        const scheduleId = getScheduleIdFromNotificationData(data);

        if (!scheduleId) {
            logPushDevelopment("warn", "[push] depart-now action has no schedule target", data);
            actionFailureGate.report({
                action: "departNow",
                message: "알림의 일정 정보를 확인하지 못했어요. 앱에서 일정을 열어 출발 상태를 변경해 주세요.",
            });
            return;
        }

        const eventKey = createCanonicalNotificationEventKey(data, providerEventId)
            ?? `schedule:${scheduleId}`;
        try {
            const executed = await executeNotificationActionOnce(
                actionDedupe,
                `departNow:${eventKey}`,
                () => markScheduleDeparted(scheduleId),
                () => refreshForegroundPushCaches({
                    type: "SCHEDULE_PARTICIPANT_DEPARTED",
                    scheduleId,
                }),
            );
            if (!executed) return;
            logPushDevelopment("info", "[push] schedule marked as departed from notification action", scheduleId);
        } catch (error) {
            logPushDevelopment("warn", "[push] depart-now action failed", error);
            actionFailureGate.report({
                action: "departNow",
                scheduleId,
                message: "출발 상태를 변경하지 못했어요. 네트워크를 확인한 뒤 일정 화면에서 다시 시도해 주세요.",
            });
        }
    };

    const snoozeFromData = async (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        providerEventId?: string,
    ) => {
        const scheduleId = getScheduleIdFromNotificationData(data);

        if (!scheduleId) {
            logPushDevelopment("warn", "[push] snooze action has no schedule target", data);
            actionFailureGate.report({
                action: "snooze",
                message: "알림의 일정 정보를 확인하지 못했어요. 앱에서 일정을 열어 알림을 다시 설정해 주세요.",
            });
            return;
        }

        const eventKey = createCanonicalNotificationEventKey(data, providerEventId)
            ?? `schedule:${scheduleId}`;
        try {
            const executed = await executeNotificationActionOnce(
                actionDedupe,
                `snooze:${eventKey}`,
                () => snoozeScheduleDepartureReminder(scheduleId),
                () => refreshForegroundPushCaches({
                    type: "SCHEDULE_DEPARTURE_REMINDER",
                    scheduleId,
                }),
            );
            if (!executed) return;
            logPushDevelopment("info", "[push] schedule departure reminder snoozed from notification action", scheduleId);
        } catch (error) {
            logPushDevelopment("warn", "[push] snooze action failed", error);
            actionFailureGate.report({
                action: "snooze",
                scheduleId,
                message: "알림을 미루지 못했어요. 네트워크를 확인한 뒤 일정 화면에서 다시 시도해 주세요.",
            });
        }
    };

    const handleNotificationResponse = (response: NotificationResponse) => {
        const request = response.notification.request;
        const providerEventId = getExpoNotificationProviderMessageId(response);

        if (response.actionIdentifier === SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER) {
            markDepartedFromData(request.content.data, providerEventId).catch(() => undefined);
            return;
        }

        if (response.actionIdentifier === SCHEDULE_SNOOZE_ACTION_IDENTIFIER) {
            snoozeFromData(request.content.data, providerEventId).catch(() => undefined);
            return;
        }

        openFromData(request.content.data, providerEventId);
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
            openFromData(message.data, message.messageId);
        },
    });

    return () => {
        actionFailureGate.dispose();
        appStateSubscription?.remove();
        unsubscribeOpenLifecycle();
    };
}

async function showForegroundNotification(
    message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
    const title = message.notification?.title ?? "NoLate";
    const body = message.notification?.body ?? "새로운 일정 알림이 도착했습니다.";

    // 서버는 push 공급자 호출 전에 앱 알림을 저장한다. 수신 직후 배지 구독자에게
    // 다시 조회하도록 알려 포그라운드 화면에서도 놓친 알림 개수가 즉시 보이게 한다.
    emitAppNotificationReceived();
    refreshForegroundPushCaches(message.data);

    await showLocalNotification({
        title,
        body,
        data: withCanonicalNotificationEventKey(
            message.data ?? {},
            message.messageId,
        ),
    });
}

async function showLocalNotification(notification: LocalPushNotification): Promise<void> {
    const Notifications = await getNotifications();

    if (!Notifications) {
        return;
    }

    await ensureNotificationPresentation(Notifications);

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
