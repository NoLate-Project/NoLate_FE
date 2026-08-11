import type { FirebaseMessagingTypes } from "@react-native-firebase/messaging";
import { Platform } from "react-native";

import { clearCalendarScheduleCache } from "../schedule/calendarScheduleCache";
import { emitScheduleMutation } from "../schedule/scheduleMutationEvents";
import { emitAppNotificationReceived } from "./appNotificationEvents";
import { isDepartureAlarmSyncData } from "./departureAlarmContract";
import {
    handleDepartureAlarmSyncData,
    presentForegroundDepartureReminderForAuthenticatedSession,
} from "./departureAlarmSync";
import { presentForegroundPushOnce } from "./foregroundPushPresentationClaim";
import { activateNativeDepartureReminderPresentationJournal } from "./nativeDepartureReminderPresentationJournal";
import { acknowledgePushDelivery } from "./pushDeliveryAck";
import {
    getNotificationActionCategoryFromData,
    SCHEDULE_DEPARTURE_ACTION_CATEGORY,
} from "./pushNavigation";

type ExpoNotificationsModule = typeof import("expo-notifications");
type NotificationsResolver = () => Promise<ExpoNotificationsModule | null>;
type PushLogger = (level: "info" | "warn", message: string, detail?: unknown) => void;

type LocalPushNotification = {
    title: string;
    body: string;
    data: Record<string, unknown>;
};

const ANDROID_CHANNEL_ID = "schedule-push";
const SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER = "schedule_depart_now_action";
const SCHEDULE_SNOOZE_ACTION_IDENTIFIER = "schedule_snooze_action";

/** 포그라운드 FCM을 동기화 명령, 앱 데이터 변경, 네이티브 표시, 로컬 표시 순서로 처리합니다. */
export async function handleForegroundPushMessageWithNotifications(
    message: FirebaseMessagingTypes.RemoteMessage,
    getNotifications: NotificationsResolver,
    logPushDevelopment?: PushLogger,
): Promise<void> {
    acknowledgePushDelivery(message.data, "RECEIVED", {
        providerMessageId: message.messageId,
    }).catch(() => undefined);

    if (isDepartureAlarmSyncData(message.data)) {
        await handleDepartureAlarmSyncData(message.data);
        return;
    }

    const title = message.notification?.title ??
        exactForegroundPresentationText(message.data?.nolateNotificationTitle, 100) ??
        "NoLate";
    const body = message.notification?.body ??
        exactForegroundPresentationText(message.data?.nolateNotificationBody, 500) ??
        "새로운 일정 알림이 도착했습니다.";

    emitAppNotificationReceived();
    if (isScheduleVisibilityChange(message.data)) {
        clearCalendarScheduleCache();
        emitScheduleMutation();
    }

    const nativeDeparturePresentation = await presentForegroundDepartureReminderForAuthenticatedSession(
        message.data,
        message.messageId,
    );
    if (nativeDeparturePresentation === "rejected") return;
    if (nativeDeparturePresentation === "presented" || nativeDeparturePresentation === "duplicate") {
        activateNativeDepartureReminderPresentationJournal().catch(() => undefined);
        return;
    }

    const presentationResult = await presentForegroundPushOnce(
        message.data,
        message.messageId,
        (notificationIdentifier) => showLocalNotification(
            { title, body, data: message.data ?? {} },
            notificationIdentifier,
            getNotifications,
            logPushDevelopment,
        ),
    );
    if (presentationResult === "presented") {
        acknowledgePushDelivery(message.data, "PRESENTED", {
            providerMessageId: message.messageId,
        }).catch(() => undefined);
    }
}

/** 서버 제공 표시 문구가 공백·제어 문자·길이 제한을 통과할 때만 원문을 반환합니다. */
function exactForegroundPresentationText(value: unknown, maximumLength: number): string | undefined {
    if (typeof value !== "string") return undefined;
    return value === value.trim() && value.length > 0 && value.length <= maximumLength &&
        !/[\u0000-\u001f\u007f]/.test(value)
        ? value
        : undefined;
}

/** 푸시 데이터가 현재 캘린더 일정 캐시를 무효화해야 하는 공유·변경 이벤트인지 판별합니다. */
function isScheduleVisibilityChange(data?: FirebaseMessagingTypes.RemoteMessage["data"]): boolean {
    const type = data?.type;
    return type === "SCHEDULE_SHARE_RECEIVED" ||
        type === "CATEGORY_SHARE_RECEIVED" ||
        type === "CALENDAR_SHARE_RECEIVED" ||
        type === "SCHEDULE_CACHE_INVALIDATED";
}

/** 검증된 제목·본문을 플랫폼 채널과 액션 카테고리가 지정된 로컬 알림으로 표시합니다. */
async function showLocalNotification(
    notification: LocalPushNotification,
    identifier: string,
    getNotifications: NotificationsResolver,
    logPushDevelopment?: PushLogger,
): Promise<boolean> {
    const Notifications = await getNotifications();
    if (!Notifications) return false;
    await ensureNotificationPresentation(Notifications, logPushDevelopment);
    await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
            title: notification.title,
            body: notification.body,
            data: notification.data,
            sound: "default",
            categoryIdentifier: getNotificationActionCategoryFromData(notification.data),
        },
        trigger: Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : null,
    });
    return true;
}

/** 포그라운드 표시 전에 액션 카테고리와 Android 고중요도 채널을 멱등하게 준비합니다. */
export async function ensureNotificationPresentation(
    Notifications: ExpoNotificationsModule,
    logPushDevelopment?: PushLogger,
): Promise<void> {
    await ensureDepartNowCategory(Notifications, logPushDevelopment);
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: "일정 알림",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
    });
}

/** Android 출발 리마인더에 출발 완료와 5분 미루기 액션을 등록하며 iOS 네이티브 등록과의 충돌을 피합니다. */
async function ensureDepartNowCategory(
    Notifications: ExpoNotificationsModule,
    logPushDevelopment?: PushLogger,
): Promise<void> {
    if (Platform.OS === "ios") return;
    try {
        await Notifications.setNotificationCategoryAsync(
            SCHEDULE_DEPARTURE_ACTION_CATEGORY,
            [
                {
                    identifier: SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER,
                    buttonTitle: "출발 완료",
                    options: { opensAppToForeground: true },
                },
                {
                    identifier: SCHEDULE_SNOOZE_ACTION_IDENTIFIER,
                    buttonTitle: "5분 뒤 다시 알림",
                    options: { opensAppToForeground: true },
                },
            ],
            { showTitle: true, showSubtitle: true },
        );
    } catch (error) {
        logPushDevelopment?.("warn", "[push] notification action category setup failed", error);
    }
}
