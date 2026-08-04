import { Platform } from "react-native";

import * as SecureStore from "../storage/secureStorage";

const PUSH_DEVICE_ID_KEY = "nolate_push_device_id";

let deviceIdPromise: Promise<string> | undefined;

/**
 * Push token registration and device delivery ACKs must identify the same app
 * installation. Keep creation single-flight so the first registration and an
 * incoming background message cannot persist two different ids concurrently.
 */
export function getOrCreatePushDeviceId(): Promise<string> {
    if (deviceIdPromise) return deviceIdPromise;

    const promise = (async () => {
        const existing = await SecureStore.getItemAsync(PUSH_DEVICE_ID_KEY);
        if (existing) return existing;

        const generated = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await SecureStore.setItemAsync(PUSH_DEVICE_ID_KEY, generated);
        return generated;
    })();

    deviceIdPromise = promise;
    promise.catch(() => {
        if (deviceIdPromise === promise) deviceIdPromise = undefined;
    });
    return promise;
}

/** Test-only reset so SecureStore cases do not leak between Jest modules. */
export function resetPushDeviceIdentityForTests(): void {
    if (process.env.NODE_ENV === "test") deviceIdPromise = undefined;
}
