import {
    getTrackingPermissionsAsync,
    PermissionStatus,
    requestTrackingPermissionsAsync,
} from "expo-tracking-transparency";
import { AppState, Platform } from "react-native";

let authorizationRequest: Promise<PermissionStatus> | undefined;

function waitUntilAppIsActive(): Promise<void> {
    if (AppState.currentState === "active") return Promise.resolve();

    return new Promise((resolve) => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (state !== "active") return;
            subscription.remove();
            resolve();
        });
    });
}

async function settleTrackingAuthorization(): Promise<PermissionStatus> {
    if (Platform.OS !== "ios") return PermissionStatus.GRANTED;

    // iOS only presents ATT while the main application is active. Calling while another
    // lifecycle state is current can consume the request without showing the system sheet.
    await waitUntilAppIsActive();

    const current = await getTrackingPermissionsAsync();
    if (current.status !== PermissionStatus.UNDETERMINED) return current.status;

    const requested = await requestTrackingPermissionsAsync();
    if (requested.status === PermissionStatus.UNDETERMINED) {
        throw new Error("ATT authorization request completed without a user decision");
    }
    return requested.status;
}

/**
 * Resolves the one-time iOS ATT decision before any tracking-capable SDK starts.
 * Concurrent startup callers share one request so system permission sheets stay serialized.
 */
export function ensureAppTrackingTransparencyResolved(): Promise<PermissionStatus> {
    if (authorizationRequest) return authorizationRequest;

    const request = settleTrackingAuthorization().finally(() => {
        if (authorizationRequest === request) authorizationRequest = undefined;
    });
    authorizationRequest = request;
    return request;
}

export function resetAppTrackingTransparencyForTests(): void {
    authorizationRequest = undefined;
}
