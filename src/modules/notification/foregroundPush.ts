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
import { ApiResponseError } from "../../api/response";
import { getAuthMember } from "../auth/authStorage";
import { clearCalendarScheduleCache } from "../schedule/calendarScheduleCache";
import { emitScheduleMutation } from "../schedule/scheduleMutationEvents";
import {
    getNotificationActionCategoryFromData,
    getPushNavigationTargetFromNotificationData,
    getScheduleIdFromNotificationData,
    SCHEDULE_DEPARTURE_ACTION_CATEGORY,
} from "./pushNavigation";
import {
    createPushActionFailureGate,
    type PushActionFailure,
} from "./pushActionFailureGate";
import { emitAppNotificationReceived } from "./appNotificationEvents";
import {
    handleDepartureAlarmSyncData,
} from "./departureAlarmSync";
import { recoverDepartureAlarmsAfterMutation } from "./departureAlarmMutationRecovery";
import { isDepartureAlarmSyncData } from "./departureAlarmContract";
import { acknowledgePushDelivery } from "./pushDeliveryAck";
import { recordNativeAlarmNotificationResponseFire } from "./departureAlarm";

export type { PushActionFailure } from "./pushActionFailureGate";

const ANDROID_CHANNEL_ID = "schedule-push";
const SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER = "schedule_depart_now_action";
const SCHEDULE_SNOOZE_ACTION_IDENTIFIER = "schedule_snooze_action";
const DEFAULT_PUSH_ACTION_IDENTIFIER = "DEFAULT";

class PermanentNotificationInteractionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PermanentNotificationInteractionError";
    }
}

function isRetryableNotificationInteractionError(error: unknown): boolean {
    if (error instanceof PermanentNotificationInteractionError) return false;
    if (!(error instanceof ApiResponseError)) return true;
    const status = error.status;
    if (status === 401 || status === 408 || status === 429) return true;
    return status === undefined || status < 400 || status >= 500;
}

type ExpoNotificationsModule = typeof import("expo-notifications");

let notificationsModule: ExpoNotificationsModule | null | undefined;

/** Test-only injection avoids loading native expo-notifications in Jest. */
export function setForegroundNotificationsModuleForTests(
    module: ExpoNotificationsModule | null | undefined,
): void {
    if (process.env.NODE_ENV === "test") notificationsModule = module;
}

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

function acknowledgePushInteraction(
    data: Record<string, unknown> | undefined,
    providerMessageId: string | undefined,
    actionIdentifier: string,
): void {
    // A notification response proves the device received and presented the
    // notification even if an OS-owned background delivery callback was not
    // available. ACKs are idempotent per logical event and stage.
    Promise.all([
        acknowledgePushDelivery(data, "RECEIVED", { providerMessageId }),
        acknowledgePushDelivery(data, "PRESENTED", { providerMessageId }),
        acknowledgePushDelivery(data, "ACTIONED", {
            providerMessageId,
            actionIdentifier,
        }),
    ]).catch(() => undefined);
}

export async function completeDepartureFromNotificationAction(
    scheduleId: string,
): Promise<void> {
    await markScheduleDeparted(scheduleId);
    await recoverDepartureAlarmsAfterMutation();
}

async function queueDepartureFromNotificationAction(
    scheduleId: string,
    data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
): Promise<string> {
    const memberId = (await getAuthMember())?.id;
    if (!Number.isSafeInteger(memberId) || (memberId ?? 0) <= 0) {
        throw new Error("Authenticated member is unavailable.");
    }
    const recipientMemberIdText = typeof data?.recipientMemberId === "string"
        ? data.recipientMemberId
        : undefined;
    if (!recipientMemberIdText || !/^[1-9]\d*$/.test(recipientMemberIdText)) {
        throw new PermanentNotificationInteractionError(
            "Notification recipient identity is unavailable."
        );
    }
    const recipientMemberId = Number(recipientMemberIdText);
    if (!Number.isSafeInteger(recipientMemberId) || recipientMemberId !== memberId) {
        throw new PermanentNotificationInteractionError(
            "Notification belongs to another account."
        );
    }
    const generationText = typeof data?.alarmGeneration === "string"
        ? data.alarmGeneration
        : undefined;
    const generation = generationText && /^(0|[1-9]\d*)$/.test(generationText)
        ? Number(generationText)
        : 0;
    const rawActionEventKey = typeof data?.actionEventKey === "string"
        ? data.actionEventKey
        : typeof data?.logicalEventKey === "string"
            ? data.logicalEventKey
            : undefined;
    const actionEventKey = rawActionEventKey && (
        /^key:[a-f0-9]{64}$/.test(rawActionEventKey) ||
        /^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawActionEventKey)
    ) ? rawActionEventKey : undefined;
    if (!actionEventKey) {
        throw new PermanentNotificationInteractionError(
            "Notification action identity is invalid."
        );
    }
    const { enqueueStandardDepartureAction } = require(
        "./nativeDepartureActionJournal"
    ) as typeof import("./nativeDepartureActionJournal");
    const queued = await enqueueStandardDepartureAction({
        scheduleId,
        recipientMemberId,
        generation: Number.isSafeInteger(generation) ? generation : 0,
        ...(typeof data?.alarmId === "string" ? { alarmId: data.alarmId } : {}),
        ...(typeof data?.occurrenceId === "string" ? { occurrenceId: data.occurrenceId } : {}),
        actionEventKey,
        requiresRouteNavigation: false,
    });
    if (!queued) throw new Error("Native departure action journal is unavailable.");
    // Durable enqueue is the interaction success boundary. Network/auth recovery continues
    // independently and native deletion occurs only after the idempotent API succeeds.
    const { activateNativeDepartureActionJournalForAuthenticatedMember } = require(
        "./nativeDepartureActionJournal"
    ) as typeof import("./nativeDepartureActionJournal");
    activateNativeDepartureActionJournalForAuthenticatedMember().catch(() => undefined);
    return actionEventKey;
}

export async function snoozeDepartureFromNotificationAction(
    scheduleId: string,
): Promise<void> {
    await snoozeScheduleDepartureReminder(scheduleId);
    await recoverDepartureAlarmsAfterMutation();
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

    if (Notifications) {
        await ensureNotificationPresentation(Notifications);
    }

    // Silent alarm sync depends only on Firebase Messaging. Register this
    // listener even when expo-notifications is unavailable (for example an iOS
    // simulator or a build without ExpoPushTokenManager).
    return onMessage(getMessaging(), handleForegroundPushMessage);
}

export async function configurePushNavigation(
    openSchedule: (scheduleId: string) => void,
    openShareInbox: () => void,
    onActionFailure?: (failure: PushActionFailure) => void,
): Promise<() => void> {
    const Notifications = await getNotifications();
    const messaging = getMessaging();
    let lastOpenedMessageId: string | undefined;
    let lastDepartNowActionKey: string | undefined;
    let lastSnoozeActionKey: string | undefined;
    const actionFailureGate = createPushActionFailureGate(
        onActionFailure,
        AppState.currentState === "active",
    );

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
            logPushDevelopment("info", "[push] notification has no navigation target", data);
            return;
        }

        lastOpenedMessageId = messageId;
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
        responseId?: string,
    ): Promise<boolean> => {
        const scheduleId = getScheduleIdFromNotificationData(data);

        if (!scheduleId) {
            logPushDevelopment("warn", "[push] depart-now action has no schedule target", data);
            actionFailureGate.report({
                action: "departNow",
                message: "알림의 일정 정보를 확인하지 못했어요. 앱에서 일정을 열어 출발 상태를 변경해 주세요.",
            });
            return true;
        }

        const candidateActionKey = typeof data?.actionEventKey === "string"
            ? data.actionEventKey
            : typeof data?.logicalEventKey === "string"
                ? data.logicalEventKey
                : undefined;
        // iOS는 앱 활성화 직후 마지막 응답을 다시 읽을 수 있다. Only a successfully
        // persisted canonical key advances this process-local optimization.
        if (candidateActionKey && candidateActionKey === lastDepartNowActionKey) return true;

        try {
            lastDepartNowActionKey = await queueDepartureFromNotificationAction(scheduleId, data);
            logPushDevelopment("info", "[push] departure action durably queued", scheduleId);
            return true;
        } catch (error) {
            logPushDevelopment("warn", "[push] depart-now action failed", error);
            actionFailureGate.report({
                action: "departNow",
                scheduleId,
                message: "출발 상태를 변경하지 못했어요. 네트워크를 확인한 뒤 일정 화면에서 다시 시도해 주세요.",
            });
            return !isRetryableNotificationInteractionError(error);
        }
    };

    const snoozeFromData = async (
        data?: Record<string, unknown> | FirebaseMessagingTypes.RemoteMessage["data"],
        responseId?: string,
    ): Promise<boolean> => {
        const scheduleId = getScheduleIdFromNotificationData(data);

        if (!scheduleId) {
            logPushDevelopment("warn", "[push] snooze action has no schedule target", data);
            actionFailureGate.report({
                action: "snooze",
                message: "알림의 일정 정보를 확인하지 못했어요. 앱에서 일정을 열어 알림을 다시 설정해 주세요.",
            });
            return true;
        }

        const memberId = (await getAuthMember())?.id;
        const recipientMemberIdText = typeof data?.recipientMemberId === "string"
            ? data.recipientMemberId
            : undefined;
        const recipientMemberId = recipientMemberIdText && /^[1-9]\d*$/.test(recipientMemberIdText)
            ? Number(recipientMemberIdText)
            : undefined;
        const rawActionEventKey = typeof data?.actionEventKey === "string"
            ? data.actionEventKey
            : typeof data?.logicalEventKey === "string"
                ? data.logicalEventKey
                : undefined;
        const actionEventKey = rawActionEventKey && (
            /^key:[a-f0-9]{64}$/.test(rawActionEventKey) ||
            /^event:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawActionEventKey)
        ) ? rawActionEventKey : undefined;
        if (!Number.isSafeInteger(memberId) || (memberId ?? 0) <= 0) {
            actionFailureGate.report({
                action: "snooze",
                scheduleId,
                message: "로그인 정보를 확인하지 못했어요. 잠시 후 알림 동작을 다시 시도해 주세요.",
            });
            return false;
        }
        if (
            !Number.isSafeInteger(recipientMemberId) ||
            recipientMemberId !== memberId ||
            !actionEventKey
        ) {
            actionFailureGate.report({
                action: "snooze",
                scheduleId,
                message: "이 알림의 계정 또는 요청 정보를 확인하지 못했어요. 일정 화면에서 다시 설정해 주세요.",
            });
            return true;
        }
        const actionKey = `${recipientMemberId}:${actionEventKey}`;
        // 동일 알림 응답이 재전달되어도 서버 재예약을 여러 번 밀지 않도록 막는다.
        if (actionKey === lastSnoozeActionKey) return true;

        try {
            await snoozeScheduleDepartureReminder(scheduleId, actionEventKey, recipientMemberId);
            await recoverDepartureAlarmsAfterMutation();
            lastSnoozeActionKey = actionKey;
            logPushDevelopment("info", "[push] schedule departure reminder snoozed from notification action", scheduleId);
            return true;
        } catch (error) {
            logPushDevelopment("warn", "[push] snooze action failed", error);
            actionFailureGate.report({
                action: "snooze",
                scheduleId,
                message: "알림을 미루지 못했어요. 네트워크를 확인한 뒤 일정 화면에서 다시 시도해 주세요.",
            });
            return !isRetryableNotificationInteractionError(error);
        }
    };

    const handleNotificationResponse = async (response: NotificationResponse): Promise<boolean> => {
        const request = response.notification.request;

        const continueInteraction = async (): Promise<boolean> => {
            if (response.actionIdentifier === SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER) {
                return markDepartedFromData(request.content.data, request.identifier);
            }

            if (response.actionIdentifier === SCHEDULE_SNOOZE_ACTION_IDENTIFIER) {
                return snoozeFromData(request.content.data, request.identifier);
            }

            openFromData(request.content.data, request.identifier);
            return true;
        };

        const responseDate = response.notification.date;
        const occurredAtMilliseconds = Number.isSafeInteger(responseDate) && responseDate >= 0
            ? responseDate
            : Date.now();
        const fireCommit = recordNativeAlarmNotificationResponseFire(
            request.content.data,
            occurredAtMilliseconds,
        );
        if (!fireCommit) {
            // Expo also reports ordinary visible remote-push interactions. Only those belong to
            // push_delivery: a canonical local time-sensitive alarm response is measured through
            // the native fire journal and must not reuse its control-plane logicalEventKey as a
            // fabricated RECEIVED/PRESENTED/ACTIONED push delivery.
            acknowledgePushInteraction(
                request.content.data,
                undefined,
                response.actionIdentifier,
            );
            return continueInteraction();
        }

        // Native time-sensitive responses can disappear from Notification Center immediately.
        // Commit fire evidence and tombstone the handled occurrence before action/navigation or
        // recovery can replay it. Ordinary remote visible pushes never enter this branch.
        let fireCommitFailed = false;
        try {
            const recorded = await fireCommit;
            if (recorded) {
                const { activateNativeAlarmFireJournalForAuthenticatedMember } = require(
                    "./nativeAlarmFireJournal"
                ) as typeof import("./nativeAlarmFireJournal");
                activateNativeAlarmFireJournalForAuthenticatedMember().catch(() => undefined);
            }
        } catch (error) {
            fireCommitFailed = true;
            logPushDevelopment("warn", "[alarm-fired] response evidence commit failed", error);
        }
        const shouldClearAfterInteraction = await continueInteraction();
        // Continue the user's requested action even when measurement persistence fails, but keep
        // the OS replay record. A later native `false` is benign (the earlier commit/tombstone may
        // already exist); a rejected bridge call means durability is unknown and must be retried.
        return !fireCommitFailed && shouldClearAfterInteraction;
    };

    const expoSubscription = Notifications?.addNotificationResponseReceivedListener((response) => {
        handleNotificationResponse(response).catch(() => undefined);
    });
    const appStateSubscription = Notifications
        ? AppState.addEventListener("change", (state) => {
            actionFailureGate.onAppStateChange(state);
            if (state !== "active") return;

            // foreground 전환 시점에 놓친 iOS notification response를 한 번 더 확인한다.
            const response = Notifications.getLastNotificationResponse();
            if (!response) return;

            // Preserve the OS replay record across the crash window. Native fire evidence and any
            // durable depart/snooze work must settle before the last response is acknowledged.
            handleNotificationResponse(response)
                .then((shouldClear) => {
                    if (shouldClear) Notifications.clearLastNotificationResponse();
                })
                .catch(() => undefined);
        })
        : undefined;
    const firebaseUnsubscribe = onNotificationOpenedApp(messaging, (message) => {
        acknowledgePushInteraction(
            message.data,
            message.messageId,
            DEFAULT_PUSH_ACTION_IDENTIFIER,
        );
        openFromData(message.data, message.messageId);
    });

    const initialMessage = await getInitialNotification(messaging);
    if (initialMessage) {
        acknowledgePushInteraction(
            initialMessage.data,
            initialMessage.messageId,
            DEFAULT_PUSH_ACTION_IDENTIFIER,
        );
        openFromData(initialMessage.data, initialMessage.messageId);
    } else if (Notifications) {
        const initialResponse = Notifications.getLastNotificationResponse();
        if (initialResponse) {
            const shouldClear = await handleNotificationResponse(initialResponse)
                .catch(() => false);
            if (shouldClear) Notifications.clearLastNotificationResponse();
        }
    }

    return () => {
        actionFailureGate.dispose();
        expoSubscription?.remove();
        appStateSubscription?.remove();
        firebaseUnsubscribe();
    };
}

export async function handleForegroundPushMessage(
    message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
    acknowledgePushDelivery(message.data, "RECEIVED", {
        providerMessageId: message.messageId,
    }).catch(() => undefined);

    if (isDepartureAlarmSyncData(message.data)) {
        // Alarm sync is a silent control-plane payload. Even malformed commands
        // are consumed here and must never become a local banner or inbox event.
        await handleDepartureAlarmSyncData(message.data);
        return;
    }

    const title = message.notification?.title ?? "NoLate";
    const body = message.notification?.body ?? "새로운 일정 알림이 도착했습니다.";

    // 서버는 push 공급자 호출 전에 앱 알림을 저장한다. 수신 직후 배지 구독자에게
    // 다시 조회하도록 알려 포그라운드 화면에서도 놓친 알림 개수가 즉시 보이게 한다.
    emitAppNotificationReceived();
    if (isScheduleVisibilityChange(message.data)) {
        clearCalendarScheduleCache();
        emitScheduleMutation();
    }

    const presented = await showLocalNotification({
        title,
        body,
        data: message.data ?? {},
    });
    if (presented) {
        acknowledgePushDelivery(message.data, "PRESENTED", {
            providerMessageId: message.messageId,
        }).catch(() => undefined);
    }
}

function isScheduleVisibilityChange(
    data?: FirebaseMessagingTypes.RemoteMessage["data"],
): boolean {
    const type = data?.type;
    return type === "SCHEDULE_SHARE_RECEIVED" ||
        type === "CATEGORY_SHARE_RECEIVED" ||
        type === "CALENDAR_SHARE_RECEIVED" ||
        type === "SCHEDULE_CACHE_INVALIDATED";
}

async function showLocalNotification(notification: LocalPushNotification): Promise<boolean> {
    const Notifications = await getNotifications();

    if (!Notifications) {
        return false;
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
    return true;
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
