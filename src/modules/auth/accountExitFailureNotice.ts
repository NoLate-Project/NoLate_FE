import {
    getAuthSessionEpoch,
    isAuthSessionActive,
    isAuthSessionEpochCurrent,
    subscribeAuthSessionEpoch,
} from "./authSessionEpoch";

export type AccountExitFailureNotice = {
    authEpoch: number;
    title?: string;
    message: string;
};

let pendingNotice: AccountExitFailureNotice | undefined;
const listeners = new Set<() => void>();

subscribeAuthSessionEpoch(() => {
    pendingNotice = undefined;
});

export function reportAccountExitFailure(
    notice: AccountExitFailureNotice,
): boolean {
    if (
        !isAuthSessionEpochCurrent(notice.authEpoch) ||
        isAuthSessionActive(notice.authEpoch)
    ) return false;
    pendingNotice = notice;
    listeners.forEach((listener) => listener());
    return true;
}

export function consumeAccountExitFailure():
    AccountExitFailureNotice | undefined {
    const notice = pendingNotice;
    if (
        !notice ||
        notice.authEpoch !== getAuthSessionEpoch() ||
        isAuthSessionActive(notice.authEpoch)
    ) {
        pendingNotice = undefined;
        return undefined;
    }
    pendingNotice = undefined;
    return notice;
}

export function subscribeAccountExitFailure(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
