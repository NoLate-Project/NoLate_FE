import {
    type FirebaseMessagingTypes,
    getInitialNotification,
    getMessaging,
    onMessage,
    onNotificationOpenedApp,
} from "@react-native-firebase/messaging";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

import { getScheduleIdFromNotificationData } from "./pushNavigation";

const ANDROID_CHANNEL_ID = "schedule-push";

type ExpoNotificationsModule = typeof import("expo-notifications");

let notificationsModule: ExpoNotificationsModule | null | undefined;

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

    if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
            name: "일정 알림",
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
            vibrationPattern: [0, 250, 250, 250],
        });
    }

    return onMessage(getMessaging(), showForegroundNotification);
}

export async function configurePushNavigation(
    openSchedule: (scheduleId: string) => void,
): Promise<() => void> {
    const Notifications = await getNotifications();
    const messaging = getMessaging();
    let lastOpenedMessageId: string | undefined;

    const openFromData = (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        messageId?: string,
    ) => {
        if (messageId && messageId === lastOpenedMessageId) return;

        const scheduleId = getScheduleIdFromNotificationData(data);
        if (!scheduleId) {
            console.warn("[push] notification has no scheduleId", data);
            return;
        }

        lastOpenedMessageId = messageId;
        console.info("[push] opening schedule from notification", scheduleId);
        openSchedule(scheduleId);
    };

    const expoSubscription = Notifications?.addNotificationResponseReceivedListener((response) => {
        const request = response.notification.request;
        openFromData(request.content.data, request.identifier);
    });
    const firebaseUnsubscribe = onNotificationOpenedApp(messaging, (message) => {
        openFromData(message.data, message.messageId);
    });

    const initialMessage = await getInitialNotification(messaging);
    if (initialMessage) {
        openFromData(initialMessage.data, initialMessage.messageId);
    } else if (Notifications) {
        const initialResponse = Notifications.getLastNotificationResponse();
        if (initialResponse) {
            const request = initialResponse.notification.request;
            openFromData(request.content.data, request.identifier);
            Notifications.clearLastNotificationResponse();
        }
    }

    return () => {
        expoSubscription?.remove();
        firebaseUnsubscribe();
    };
}

async function showForegroundNotification(
    message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
    const Notifications = await getNotifications();

    if (!Notifications) {
        return;
    }

    const title = message.notification?.title ?? "NoLate";
    const body = message.notification?.body ?? "새로운 일정 알림이 도착했습니다.";

    await Notifications.scheduleNotificationAsync({
        content: {
            title,
            body,
            data: message.data ?? {},
            sound: "default",
        },
        trigger: Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : null,
    });
}
