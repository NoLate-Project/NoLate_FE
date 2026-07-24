import {
    getValidatedNotificationAccountBinding,
} from "./notificationAccountBinding";
import { withCanonicalNotificationEventKey } from "./notificationEventKey";

export type ForegroundPushMessage = {
    data?: Record<string, unknown>;
    messageId?: string;
    notification?: {
        title?: string;
        body?: string;
    };
};

export type ForegroundPushPresentation = {
    title: string;
    body: string;
    data: Record<string, unknown>;
};

export async function processForegroundPushForSession(options: {
    message: ForegroundPushMessage;
    getAuthEpoch: () => number;
    isAuthEpochCurrent: (epoch: number) => boolean;
    getCurrentMemberId: () => Promise<number | undefined>;
    emitReceived: () => void;
    refreshCaches: (data?: Record<string, unknown>) => void;
    present: (
        notification: ForegroundPushPresentation,
        authEpoch: number,
    ) => Promise<void>;
}): Promise<boolean> {
    const authEpoch = options.getAuthEpoch();
    const memberId = await options.getCurrentMemberId();
    if (!options.isAuthEpochCurrent(authEpoch)) return false;

    const binding = getValidatedNotificationAccountBinding({
        data: options.message.data,
        currentMemberId: memberId,
    });
    if (!binding || !options.isAuthEpochCurrent(authEpoch)) return false;

    const presentation = {
        title: options.message.notification?.title ?? "NoLate",
        body:
            options.message.notification?.body ??
            "새로운 일정 알림이 도착했습니다.",
        data: withCanonicalNotificationEventKey(
            options.message.data ?? {},
            options.message.messageId,
        ),
    };

    // There is deliberately no await between the final session check and these
    // side effects. A stale account payload must not be presented, counted, or
    // allowed to invalidate the current account's caches.
    if (!options.isAuthEpochCurrent(authEpoch)) return false;
    options.emitReceived();
    options.refreshCaches(options.message.data);
    await options.present(presentation, authEpoch);
    return true;
}
