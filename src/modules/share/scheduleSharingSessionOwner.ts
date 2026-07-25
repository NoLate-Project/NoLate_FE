import {
    getAuthSessionEpoch,
    isAuthSessionActive,
} from "../auth/authSessionEpoch";

let sessionOwner:
    | {
        authEpoch: number;
        memberId: number;
    }
    | undefined;

export function establishScheduleSharingSessionOwner(
    authEpoch: number,
    memberId: number,
): boolean {
    if (
        !Number.isSafeInteger(memberId)
        || memberId <= 0
        || !isAuthSessionActive(authEpoch)
    ) return false;

    sessionOwner = { authEpoch, memberId };
    return true;
}

export function getScheduleSharingSessionOwnerId():
    | number
    | undefined {
    if (
        !sessionOwner
        || sessionOwner.authEpoch !== getAuthSessionEpoch()
        || !isAuthSessionActive(sessionOwner.authEpoch)
    ) return undefined;
    return sessionOwner.memberId;
}

export function clearScheduleSharingSessionOwner(): void {
    sessionOwner = undefined;
}
