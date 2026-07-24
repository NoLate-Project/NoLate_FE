import {
    registerPushToken,
    type PushPlatform,
} from "../../api/notification";
import {
    isAuthSessionEpochCurrent,
} from "../auth/authSessionEpoch";
import { createAuthEpochAbortController } from "../auth/authEpochAbortController";

export async function registerPushTokenForSession(options: {
    memberId: number;
    deviceId: string;
    platform: PushPlatform;
    token: string;
    authEpoch: number;
    isRegistrationGenerationCurrent: () => boolean;
}): Promise<void> {
    if (
        !options.isRegistrationGenerationCurrent() ||
        !isAuthSessionEpochCurrent(options.authEpoch)
    ) return;

    const abort = createAuthEpochAbortController(options.authEpoch);
    try {
        await registerPushToken({
            memberId: options.memberId,
            deviceId: options.deviceId,
            platform: options.platform,
            token: options.token,
        }, {
            signal: abort.signal,
        });
        if (
            !options.isRegistrationGenerationCurrent() ||
            !isAuthSessionEpochCurrent(options.authEpoch)
        ) {
            throw new Error("AUTH_SESSION_CHANGED");
        }
    } finally {
        abort.dispose();
    }
}
