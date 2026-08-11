import {
    type FirebaseMessagingTypes,
    getInitialNotification,
    getMessaging,
    onMessage,
    onNotificationOpenedApp,
} from "@react-native-firebase/messaging";
import * as Device from "expo-device";
import type { Notification, NotificationResponse } from "expo-notifications";
import { requireOptionalNativeModule } from "expo-modules-core";
import { AppState, Platform } from "react-native";

import { snoozeScheduleDepartureReminder } from "../../api/schedule";
import { getAuthMember } from "../auth/authStorage";
import {
    getPushNavigationTargetFromNotificationData,
    getScheduleIdFromNotificationData,
} from "./pushNavigation";
import {
    createPushActionFailureGate,
    type PushActionFailure,
} from "./pushActionFailureGate";
import { acknowledgePushDelivery } from "./pushDeliveryAck";
import { isSamePushNotificationIdentity } from "./pushNotificationIdentity";
import { recordNativeAlarmNotificationResponseFire } from "./departureAlarm";
import {
    getNoLateCustomAlarmNavigationTarget,
    type NoLateCustomAlarmNavigationTarget,
} from "./customAlarmNavigation";
import {
    consumeNoLateCustomAlarmCapability,
    issueNoLateCustomAlarmCapability,
} from "./customAlarmCapability";
import { isNotificationEtaEventFresh } from "./notificationEventExpiry";
import { recoverDepartureAlarmsAfterMutation } from "./departureAlarmMutationRecovery";
import {
    ensureNotificationPresentation,
    handleForegroundPushMessageWithNotifications,
} from "./foregroundPushMessage";

export type { PushActionFailure } from "./pushActionFailureGate";
import {
    customAlarmOccurrenceDedupeKey,
    defaultNotificationPresentationBehavior,
    isCanonicalCustomAlarmNotificationIdentifier,
    settleCustomAlarmOpenOutcomeWithinPresentationDeadline,
    suppressedNotificationPresentationBehavior,
    type NoLateCustomAlarmOpenOutcome,
} from "./customAlarmOpenPresentation";
import {
    isRetryableNotificationInteractionError,
    queueDepartureFromNotificationAction,
} from "./notificationDepartureActions";

export type { NoLateCustomAlarmOpenOutcome } from "./customAlarmOpenPresentation";
export {
    completeDepartureFromNotificationAction,
    snoozeDepartureFromNotificationAction,
} from "./notificationDepartureActions";
type NoLateCustomAlarmOpenOrigin = "foreground" | "interaction";

const SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER = "schedule_depart_now_action";
const SCHEDULE_SNOOZE_ACTION_IDENTIFIER = "schedule_snooze_action";
const DEFAULT_PUSH_ACTION_IDENTIFIER = "DEFAULT";

type ExpoNotificationsModule = typeof import("expo-notifications");
type CustomAlarmNotificationsEmitter = Pick<
    typeof import("expo-notifications/build/NotificationsEmitter"),
    | "addNotificationReceivedListener"
    | "addNotificationResponseReceivedListener"
    | "getLastNotificationResponse"
    | "clearLastNotificationResponse"
> & Partial<Pick<
    typeof import("expo-notifications/build/NotificationsHandler"),
    "setNotificationHandler"
>>;

let notificationsModule: ExpoNotificationsModule | null | undefined;
let customAlarmNotificationsModule: CustomAlarmNotificationsEmitter | null | undefined;

/** Test-only injection avoids loading native expo-notifications in Jest. */
export function setForegroundNotificationsModuleForTests(
    module: ExpoNotificationsModule | null | undefined,
): void {
    if (process.env.NODE_ENV === "test") {
        notificationsModule = module;
        customAlarmNotificationsModule = module;
    }
}

/** Test-only injection for the local-notification path used on iOS Simulator. */
export function setCustomAlarmNotificationsModuleForTests(
    module: CustomAlarmNotificationsEmitter | null | undefined,
): void {
    if (process.env.NODE_ENV === "test") customAlarmNotificationsModule = module;
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
            handleNotification: async () => defaultNotificationPresentationBehavior(),
        });

        notificationsModule = Notifications;
        if (customAlarmNotificationsModule === undefined) {
            customAlarmNotificationsModule = Notifications;
        }
    } catch (error) {
        logPushDevelopment("warn", "[push] expo-notifications is unavailable in this build", error);
        notificationsModule = null;
    }

    return notificationsModule;
}

async function getLocalNotificationsForCustomAlarm(): Promise<
    CustomAlarmNotificationsEmitter | null
> {
    if (customAlarmNotificationsModule !== undefined) {
        return customAlarmNotificationsModule;
    }
    if (process.env.NODE_ENV === "test") return null;

    // Local UNNotifications work on iOS Simulator even though APNs token registration does not.
    // Import listener/handler-only paths without requiring ExpoPushTokenManager. The handler lets
    // NoLate own foreground alarm audio on Simulator builds as well as signed physical devices.
    try {
        const [Emitter, Handler] = await Promise.all([
            import("expo-notifications/build/NotificationsEmitter"),
            import("expo-notifications/build/NotificationsHandler"),
        ]);
        customAlarmNotificationsModule = {
            ...Emitter,
            setNotificationHandler: Handler.setNotificationHandler,
        };
    } catch (error) {
        logPushDevelopment(
            "warn",
            "[custom-alarm] local notification listeners are unavailable in this build",
            error,
        );
        customAlarmNotificationsModule = null;
    }
    return customAlarmNotificationsModule;
}

export async function configureForegroundPush(): Promise<() => void> {
    const Notifications = await getNotifications();

    if (Notifications) {
        await ensureNotificationPresentation(Notifications, logPushDevelopment);
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
    openCustomAlarm?: (
        target: NoLateCustomAlarmNavigationTarget,
    ) => NoLateCustomAlarmOpenOutcome | void,
): Promise<() => void> {
    const Notifications = await getNotifications();
    const CustomAlarmNotifications = await getLocalNotificationsForCustomAlarm();
    const messaging = getMessaging();
    let lastOpenedMessageId: string | undefined;
    let lastDepartNowActionKey: string | undefined;
    let lastSnoozeActionKey: string | undefined;
    const actionFailureGate = createPushActionFailureGate(
        onActionFailure,
        AppState.currentState === "active",
    );
    const customAlarmOpenClaims = new Map<
        string,
        { claimedAt: number; outcome: Exclude<NoLateCustomAlarmOpenOutcome, "deferred"> }
    >();
    const customAlarmOpenInFlight = new Map<
        string,
        Promise<NoLateCustomAlarmOpenOutcome>
    >();
    // Keep OS-owned occurrences for this configuration's full lifetime. Native bridge work can
    // settle arbitrarily late, so expiring this guard by time could start in-app audio after the
    // fallback notification has already alerted the user.
    const customAlarmForegroundFallbackClaims = new Set<string>();

    const openCustomAlarmOnce = (
        target: NoLateCustomAlarmNavigationTarget,
        origin: NoLateCustomAlarmOpenOrigin,
    ): Promise<NoLateCustomAlarmOpenOutcome> => {
        if (!openCustomAlarm || !target.notificationIdentifier) {
            return Promise.resolve("deferred");
        }

        const now = Date.now();
        for (const [key, claim] of customAlarmOpenClaims) {
            if (now - claim.claimedAt > CUSTOM_ALARM_OPEN_DEDUPE_MS) {
                customAlarmOpenClaims.delete(key);
            }
        }
        const key = customAlarmOccurrenceDedupeKey(target);
        const hasForegroundFallback = customAlarmForegroundFallbackClaims.has(key);
        const existingClaim = customAlarmOpenClaims.get(key);
        if (existingClaim) return Promise.resolve(existingClaim.outcome);
        if (origin === "foreground" && hasForegroundFallback) {
            return Promise.resolve("deferred");
        }
        const existingInFlight = customAlarmOpenInFlight.get(key);
        if (existingInFlight && !(origin === "interaction" && hasForegroundFallback)) {
            return existingInFlight;
        }

        const openPromise = (async (): Promise<NoLateCustomAlarmOpenOutcome> => {
            if (!target.isPreview) {
                try {
                    const member = await getAuthMember();
                    if (!member?.id) return "deferred";
                    if (member.id !== target.recipientMemberId) return "rejected";
                } catch {
                    return "deferred";
                }
            }
            // Expo discards a foreground notification when its presentation handler misses the
            // deadline. Once the OS fallback has won that race, a late SecureStore/native result
            // must not also open an in-app alarm and start a second sound loop.
            if (
                origin === "foreground" &&
                customAlarmForegroundFallbackClaims.has(key)
            ) return "deferred";

            let capabilityId: string | undefined;
            try {
                const authorizedTarget = issueNoLateCustomAlarmCapability(target);
                capabilityId = authorizedTarget.capabilityId;
                const requestedOutcome = openCustomAlarm(authorizedTarget);
                const outcome = requestedOutcome ?? "opened";
                if (outcome === "deferred") {
                    consumeNoLateCustomAlarmCapability(capabilityId);
                } else {
                    customAlarmOpenClaims.set(key, {
                        claimedAt: Date.now(),
                        outcome,
                    });
                }
                return outcome;
            } catch (error) {
                if (capabilityId) consumeNoLateCustomAlarmCapability(capabilityId);
                logPushDevelopment("warn", "[custom-alarm] navigation callback failed", error);
                return "deferred";
            }
        })();
        customAlarmOpenInFlight.set(key, openPromise);
        openPromise.finally(() => {
            if (customAlarmOpenInFlight.get(key) === openPromise) {
                customAlarmOpenInFlight.delete(key);
            }
        }).catch(() => undefined);
        return openPromise;
    };

    if (Notifications) {
        await ensureNotificationPresentation(Notifications);
    }

    const customAlarmTargetFromRequest = (
        request: NotificationResponse["notification"]["request"],
        actionIdentifier?: string,
    ): NoLateCustomAlarmNavigationTarget | undefined => {
        const target = getNoLateCustomAlarmNavigationTarget(
            request.content.data,
            actionIdentifier,
        );
        if (!target || !isCanonicalCustomAlarmNotificationIdentifier(
            request.identifier,
            target.isPreview,
        )) return undefined;
        return { ...target, notificationIdentifier: request.identifier };
    };

    const commitForegroundCustomAlarmFire = async (
        notification: Notification,
    ): Promise<void> => {
        const target = customAlarmTargetFromRequest(notification.request);
        if (!target || target.isPreview) return;
        const notificationDate = notification.date;
        const occurredAtMilliseconds = Number.isSafeInteger(notificationDate) && notificationDate >= 0
            ? notificationDate
            : Date.now();
        const commit = recordNativeAlarmNotificationResponseFire(
            notification.request.content.data,
            occurredAtMilliseconds,
        );
        if (!commit) return;
        try {
            if (await commit) {
                const { activateNativeAlarmFireJournalForAuthenticatedMember } = require(
                    "./nativeAlarmFireJournal"
                ) as typeof import("./nativeAlarmFireJournal");
                activateNativeAlarmFireJournalForAuthenticatedMember().catch(() => undefined);
            }
        } catch (error) {
            logPushDevelopment("warn", "[custom-alarm] foreground fire commit failed", error);
        }
    };

    const notificationHandler = Notifications ?? CustomAlarmNotifications;
    notificationHandler?.setNotificationHandler?.({
        handleNotification: async (notification) => {
            const target = customAlarmTargetFromRequest(notification.request);
            if (!target) return defaultNotificationPresentationBehavior();
            const key = customAlarmOccurrenceDedupeKey(target);
            const foregroundWork = commitForegroundCustomAlarmFire(notification)
                .then(() => openCustomAlarmOnce(target, "foreground"));
            const outcome = await settleCustomAlarmOpenOutcomeWithinPresentationDeadline(
                foregroundWork,
                () => {
                    const completedClaim = customAlarmOpenClaims.get(key);
                    if (completedClaim) return completedClaim.outcome;
                    customAlarmForegroundFallbackClaims.add(key);
                    return "deferred";
                },
            );
            if (outcome === "deferred") {
                customAlarmForegroundFallbackClaims.add(key);
            }
            return outcome === "deferred"
                ? defaultNotificationPresentationBehavior()
                : suppressedNotificationPresentationBehavior();
        },
    });

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
        _responseId?: string,
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
        if (!isNotificationEtaEventFresh(data, Date.now())) {
            logPushDevelopment("warn", "[push] ignored expired depart-now action", data);
            actionFailureGate.report({
                action: "departNow",
                scheduleId,
                message: "이 출발 알림의 유효 시간이 지났어요. 일정 화면에서 현재 상태를 확인해 주세요.",
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
        _responseId?: string,
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
        if (!isNotificationEtaEventFresh(data, Date.now())) {
            logPushDevelopment("warn", "[push] ignored expired snooze action", data);
            actionFailureGate.report({
                action: "snooze",
                scheduleId,
                message: "이 출발 알림의 유효 시간이 지났어요. 일정 화면에서 현재 알림을 확인해 주세요.",
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
                message: "알림 정보를 확인하지 못했어요. 일정 화면에서 다시 설정해 주세요.",
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
        const customAlarmTarget = customAlarmTargetFromRequest(
            request,
            response.actionIdentifier,
        );

        const continueInteraction = async (): Promise<boolean> => {
            if (customAlarmTarget) {
                // Both custom-alarm actions enter NoLate's confirmation UI. In particular, the
                // button titled "지금 출발 완료" must never reuse the direct mutation branch below.
                const outcome = await openCustomAlarmOnce(customAlarmTarget, "interaction");
                return outcome !== "deferred";
            }

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
            if (!customAlarmTarget) {
                acknowledgePushInteraction(
                    request.content.data,
                    undefined,
                    response.actionIdentifier,
                );
            }
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

    let customAlarmReceivedSubscription: ReturnType<
        CustomAlarmNotificationsEmitter["addNotificationReceivedListener"]
    > | undefined;
    try {
        customAlarmReceivedSubscription =
            CustomAlarmNotifications?.addNotificationReceivedListener?.((notification) => {
                const target = customAlarmTargetFromRequest(notification.request);
                if (!target) return;
                commitForegroundCustomAlarmFire(notification)
                    .then(() => openCustomAlarmOnce(target, "foreground"))
                    .catch((error) => {
                        logPushDevelopment(
                            "warn",
                            "[custom-alarm] foreground notification handling failed",
                            error,
                        );
                    });
            });
    } catch (error) {
        logPushDevelopment("warn", "[custom-alarm] received listener setup failed", error);
    }
    const expoSubscription = Notifications?.addNotificationResponseReceivedListener((response) => {
        handleNotificationResponse(response).catch(() => undefined);
    });
    let localCustomAlarmResponseSubscription: ReturnType<
        CustomAlarmNotificationsEmitter["addNotificationResponseReceivedListener"]
    > | undefined;
    if (CustomAlarmNotifications && CustomAlarmNotifications !== Notifications) {
        try {
            localCustomAlarmResponseSubscription =
                CustomAlarmNotifications.addNotificationResponseReceivedListener?.((response) => {
                const request = response.notification.request;
                if (!customAlarmTargetFromRequest(request, response.actionIdentifier)) return;
                handleNotificationResponse(response).catch(() => undefined);
                });
        } catch (error) {
            logPushDevelopment("warn", "[custom-alarm] response listener setup failed", error);
        }
    }
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
    const initialResponse = Notifications?.getLastNotificationResponse();
    const hasExplicitInitialResponse = initialResponse && (
        initialResponse.actionIdentifier === SCHEDULE_DEPART_NOW_ACTION_IDENTIFIER ||
        initialResponse.actionIdentifier === SCHEDULE_SNOOZE_ACTION_IDENTIFIER ||
        customAlarmTargetFromRequest(
            initialResponse.notification.request,
            initialResponse.actionIdentifier,
        ) !== undefined
    );
    const shouldPrioritizeInitialResponse = hasExplicitInitialResponse && (
        !initialMessage || isSamePushNotificationIdentity(
            {
                data: initialMessage.data,
                providerMessageId: initialMessage.messageId,
            },
            {
                data: initialResponse.notification.request.content.data,
                providerMessageId: initialResponse.notification.request.identifier,
            },
        )
    );
    if (hasExplicitInitialResponse && initialMessage && !shouldPrioritizeInitialResponse) {
        // The OS can retain an older Expo response after a crash. It must not intercept a newer
        // Firebase notification tap, and retaining it would replay that stale action on next active.
        Notifications?.clearLastNotificationResponse();
    }
    if (shouldPrioritizeInitialResponse) {
        // On an iOS cold start RNFirebase can expose the same notification as a default open while
        // Expo retains the actual action identifier. The explicit action is the stronger signal;
        // processing Firebase first would silently turn "출발 완료" into navigation only.
        const shouldClear = await handleNotificationResponse(initialResponse)
            .catch(() => false);
        if (shouldClear) Notifications?.clearLastNotificationResponse();
    } else if (initialMessage) {
        acknowledgePushInteraction(
            initialMessage.data,
            initialMessage.messageId,
            DEFAULT_PUSH_ACTION_IDENTIFIER,
        );
        openFromData(initialMessage.data, initialMessage.messageId);
    } else if (initialResponse) {
        const shouldClear = await handleNotificationResponse(initialResponse)
                .catch(() => false);
        if (shouldClear) Notifications?.clearLastNotificationResponse();
    }
    if (CustomAlarmNotifications && CustomAlarmNotifications !== Notifications) {
        try {
            const initialCustomAlarmResponse =
                CustomAlarmNotifications.getLastNotificationResponse?.();
            if (initialCustomAlarmResponse && customAlarmTargetFromRequest(
                initialCustomAlarmResponse.notification.request,
                initialCustomAlarmResponse.actionIdentifier,
            )) {
                const shouldClear = await handleNotificationResponse(initialCustomAlarmResponse)
                    .catch(() => false);
                if (shouldClear) {
                    CustomAlarmNotifications.clearLastNotificationResponse?.();
                }
            }
        } catch (error) {
            logPushDevelopment("warn", "[custom-alarm] initial response lookup failed", error);
        }
    }

    return () => {
        actionFailureGate.dispose();
        customAlarmReceivedSubscription?.remove();
        expoSubscription?.remove();
        localCustomAlarmResponseSubscription?.remove();
        appStateSubscription?.remove();
        firebaseUnsubscribe();
    };
}

const CUSTOM_ALARM_OPEN_DEDUPE_MS = 30_000;
/** 외부 호출자가 알림 모듈 상태를 몰라도 포그라운드 메시지를 동일한 런타임으로 처리하게 합니다. */
export async function handleForegroundPushMessage(
    message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
    await handleForegroundPushMessageWithNotifications(message, getNotifications, logPushDevelopment);
}
