import {
    getValidatedNotificationAccountBinding,
    type ValidatedNotificationAccountBinding,
} from "./notificationAccountBinding";

export type ActiveNotificationAccountBinding =
    ValidatedNotificationAccountBinding & {
        authEpoch: number;
    };

export async function resolveActiveNotificationAccountBinding(options: {
    data?: Record<string, unknown>;
    getAuthEpoch: () => number;
    isAuthSessionActive: (epoch: number) => boolean;
    getCurrentMemberId: () => Promise<number | undefined>;
}): Promise<ActiveNotificationAccountBinding | undefined> {
    const authEpoch = options.getAuthEpoch();
    if (!options.isAuthSessionActive(authEpoch)) return undefined;
    const currentMemberId = await options.getCurrentMemberId();
    if (!options.isAuthSessionActive(authEpoch)) return undefined;
    const binding = getValidatedNotificationAccountBinding({
        data: options.data,
        currentMemberId,
    });
    if (!binding || !options.isAuthSessionActive(authEpoch)) return undefined;
    return { ...binding, authEpoch };
}

export async function executeNotificationActionForActiveSession<TResult>(
    authEpoch: number,
    isAuthSessionActive: (epoch: number) => boolean,
    action: () => Promise<TResult>,
): Promise<TResult> {
    if (!isAuthSessionActive(authEpoch)) {
        throw new Error("AUTH_SESSION_INACTIVE");
    }
    const result = await action();
    if (!isAuthSessionActive(authEpoch)) {
        throw new Error("AUTH_SESSION_CHANGED");
    }
    return result;
}

export function shouldReportNotificationFailureForSession(
    receivedEpoch: number,
    isAuthSessionActive: (epoch: number) => boolean,
): boolean {
    return isAuthSessionActive(receivedEpoch);
}
