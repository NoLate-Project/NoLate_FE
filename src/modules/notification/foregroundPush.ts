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

import { markScheduleDeparted } from "../../api/schedule";
import {
    getPushNavigationTargetFromNotificationData,
    getScheduleIdFromNotificationData,
} from "./pushNavigation";

const ANDROID_CHANNEL_ID = "schedule-push";
const SCHEDULE_DEPART_NOW_CATEGORY = "schedule_depart_now";
const SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER = "schedule_depart_now_action";

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

    if (Notifications) {
        await ensureNotificationPresentation(Notifications);
    }

    const openFromData = (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        messageId?: string,
    ) => {
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
        if (actionKey === lastDepartNowActionKey) return;
        lastDepartNowActionKey = actionKey;

        try {
            await markScheduleDeparted(scheduleId);
            console.info("[push] schedule marked as departed from notification action", scheduleId);
        } catch (error) {
            console.warn("[push] depart-now action failed", error);
        }
    };

    const handleNotificationResponse = (response: NotificationResponse) => {
        const request = response.notification.request;

        if (response.actionIdentifier === SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER) {
            void markDepartedFromData(request.content.data, request.identifier);
            return;
        }

        openFromData(request.content.data, request.identifier);
    };

    const expoSubscription = Notifications?.addNotificationResponseReceivedListener(handleNotificationResponse);
    const appStateSubscription = Notifications
        ? AppState.addEventListener("change", (state) => {
            if (state !== "active") return;

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
        await Notifications.setNotificationCategoryAsync(
            SCHEDULE_DEPART_NOW_CATEGORY,
            [
                {
                    identifier: SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER,
                    buttonTitle: "지금 출발",
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
