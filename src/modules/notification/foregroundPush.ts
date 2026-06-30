import {
    type FirebaseMessagingTypes,
    getInitialNotification,
    getMessaging,
    onMessage,
    onNotificationOpenedApp,
} from "@react-native-firebase/messaging";
import type { NotificationResponse } from "expo-notifications";
import { requireOptionalNativeModule } from "expo-modules-core";
import { AppState, Platform } from "react-native";

import { markScheduleDeparted, snoozeScheduleDepartureReminder } from "../../api/schedule";
import {
    getPushNavigationTargetFromNotificationData,
    getScheduleIdFromNotificationData,
} from "./pushNavigation";

const ANDROID_CHANNEL_ID = "schedule-push";
const SCHEDULE_DEPART_NOW_CATEGORY = "schedule_depart_now";
const SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER = "schedule_depart_now_action";
const SCHEDULE_SNOOZE_ACTION_IDENTIFIER = "schedule_snooze_action";

type ExpoNotificationsModule = typeof import("expo-notifications");

let notificationsModule: ExpoNotificationsModule | null | undefined;

type LocalPushNotification = {
    title: string;
    body: string;
    data: Record<string, unknown>;
};

async function getNotifications(): Promise<ExpoNotificationsModule | null> {
    if (notificationsModule !== undefined) {
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
        console.warn("[push] expo-notifications is unavailable in this build", error);
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
): Promise<() => void> {
    const Notifications = await getNotifications();
    const messaging = getMessaging();
    let lastOpenedMessageId: string | undefined;
    let lastDepartNowActionKey: string | undefined;
    let lastSnoozeActionKey: string | undefined;

    if (Notifications) {
        await ensureNotificationPresentation(Notifications);
    }

    const openFromData = (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        messageId?: string,
    ) => {
        // Firebase와 expo-notifications가 같은 터치 이벤트를 각각 전달할 수 있어 messageId로 중복 이동을 막는다.
        if (messageId && messageId === lastOpenedMessageId) return;

        const target = getPushNavigationTargetFromNotificationData(data);
        if (!target) {
            console.info("[push] notification has no navigation target", data);
            return;
        }

        lastOpenedMessageId = messageId;
        console.info("[push] opening schedule from notification", target.scheduleId);
        openSchedule(target.scheduleId);
    };

    const markDepartedFromData = async (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        responseId?: string,
    ) => {
        const scheduleId = getScheduleIdFromNotificationData(data);

        if (!scheduleId) {
            console.warn("[push] depart-now action has no schedule target", data);
            return;
        }

        const actionKey = `${scheduleId}:${responseId ?? ""}`;
        // iOS는 앱 활성화 직후 마지막 응답을 다시 읽을 수 있어 같은 액션의 중복 API 호출을 방지한다.
        if (actionKey === lastDepartNowActionKey) return;
        lastDepartNowActionKey = actionKey;

        try {
            await markScheduleDeparted(scheduleId);
            console.info("[push] schedule marked as departed from notification action", scheduleId);
        } catch (error) {
            console.warn("[push] depart-now action failed", error);
        }
    };

    const snoozeFromData = async (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        responseId?: string,
    ) => {
        const scheduleId = getScheduleIdFromNotificationData(data);

        if (!scheduleId) {
            console.warn("[push] snooze action has no schedule target", data);
            return;
        }

        const actionKey = `${scheduleId}:${responseId ?? ""}`;
        // 동일 알림 응답이 재전달되어도 서버 재예약을 여러 번 밀지 않도록 막는다.
        if (actionKey === lastSnoozeActionKey) return;
        lastSnoozeActionKey = actionKey;

        try {
            await snoozeScheduleDepartureReminder(scheduleId);
            console.info("[push] schedule departure reminder snoozed from notification action", scheduleId);
        } catch (error) {
            console.warn("[push] snooze action failed", error);
        }
    };

    const handleNotificationResponse = (response: NotificationResponse) => {
        const request = response.notification.request;

        if (response.actionIdentifier === SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER) {
            void markDepartedFromData(request.content.data, request.identifier);
            return;
        }

        if (response.actionIdentifier === SCHEDULE_SNOOZE_ACTION_IDENTIFIER) {
            void snoozeFromData(request.content.data, request.identifier);
            return;
        }

        openFromData(request.content.data, request.identifier);
    };

    const expoSubscription = Notifications?.addNotificationResponseReceivedListener(handleNotificationResponse);
    const appStateSubscription = Notifications
        ? AppState.addEventListener("change", (state) => {
            if (state !== "active") return;

            // foreground 전환 시점에 놓친 iOS notification response를 한 번 더 확인한다.
            const response = Notifications.getLastNotificationResponse();
            if (!response) return;

            handleNotificationResponse(response);
            Notifications.clearLastNotificationResponse();
        })
        : undefined;
    const firebaseUnsubscribe = onNotificationOpenedApp(messaging, (message) => {
        openFromData(message.data, message.messageId);
    });

    const initialMessage = await getInitialNotification(messaging);
    if (initialMessage) {
        openFromData(initialMessage.data, initialMessage.messageId);
    } else if (Notifications) {
        const initialResponse = Notifications.getLastNotificationResponse();
        if (initialResponse) {
            handleNotificationResponse(initialResponse);
            Notifications.clearLastNotificationResponse();
        }
    }

    return () => {
        expoSubscription?.remove();
        appStateSubscription?.remove();
        firebaseUnsubscribe();
    };
}

async function showForegroundNotification(
    message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
    const title = message.notification?.title ?? "NoLate";
    const body = message.notification?.body ?? "새로운 일정 알림이 도착했습니다.";

    await showLocalNotification({
        title,
        body,
        data: message.data ?? {},
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
            categoryIdentifier: getDepartNowCategoryIdentifier(notification.data),
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
        // `departNow=true` payload에만 액션 버튼을 붙여 일반 일정 알림과 상세 이동 UX를 분리한다.
        await Notifications.setNotificationCategoryAsync(
            SCHEDULE_DEPART_NOW_CATEGORY,
            [
                {
                    identifier: SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER,
                    buttonTitle: "출발 완료",
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
        console.warn("[push] notification action category setup failed", error);
    }
}

function getDepartNowCategoryIdentifier(data: Record<string, unknown>): string | undefined {
    return data.type === "SCHEDULE_DEPARTURE_REMINDER" && data.departNow === "true"
        ? SCHEDULE_DEPART_NOW_CATEGORY
        : undefined;
}
