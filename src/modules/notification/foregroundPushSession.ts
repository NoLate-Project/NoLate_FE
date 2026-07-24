import {
    resolveActiveNotificationAccountBinding,
} from "./notificationSessionFence";
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
    isAuthSessionActive: (epoch: number) => boolean;
    getCurrentMemberId: () => Promise<number | undefined>;
    emitReceived: () => void;
    refreshCaches: (data?: Record<string, unknown>) => void;
    present: (
        notification: ForegroundPushPresentation,
        authEpoch: number,
    ) => Promise<void>;
}): Promise<boolean> {
    const binding = await resolveActiveNotificationAccountBinding({
        data: options.message.data,
        getAuthEpoch: options.getAuthEpoch,
        isAuthSessionActive: options.isAuthSessionActive,
        getCurrentMemberId: options.getCurrentMemberId,
    });
    if (!binding) return false;

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
    if (!options.isAuthSessionActive(binding.authEpoch)) return false;
    options.emitReceived();
    options.refreshCaches(options.message.data);
    await options.present(presentation, binding.authEpoch);
    return true;
}
