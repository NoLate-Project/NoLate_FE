import { PermissionsAndroid, Platform } from "react-native";
import type { FirebaseMessagingTypes } from "@react-native-firebase/messaging";

type MessagingPermissionApi = {
    AuthorizationStatus: {
        AUTHORIZED: number;
        PROVISIONAL: number;
    };
    getMessaging(): FirebaseMessagingTypes.Module;
    requestPermission(messaging: FirebaseMessagingTypes.Module): Promise<number>;
};

function getMessagingPermissionApi(): MessagingPermissionApi {
    // Avoid initializing the native messaging bridge merely by rendering a
    // form. Load it only after the user explicitly requests notification access.
    return require("@react-native-firebase/messaging") as MessagingPermissionApi;
}

/**
 * Requests only the user-facing notification permission.
 *
 * This intentionally stays separate from remote-token registration so an iOS
 * Simulator can present the local permission prompt even though it cannot
 * obtain an APNs device token.
 */
export async function requestPushNotificationPermission(
    messaging?: FirebaseMessagingTypes.Module,
): Promise<boolean> {
    if (Platform.OS === "android" && Platform.Version >= 33) {
        return (await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        )) === PermissionsAndroid.RESULTS.GRANTED;
    }
    if (Platform.OS === "ios") {
        const api = getMessagingPermissionApi();
        const permission = await api.requestPermission(messaging ?? api.getMessaging());
        return permission === api.AuthorizationStatus.AUTHORIZED ||
            permission === api.AuthorizationStatus.PROVISIONAL;
    }
    return true;
}

/**
 * Handles the explicit, user-initiated permission flow from notification settings.
 *
 * Permission and remote-token registration normally happen during the authenticated
 * app bootstrap. When that bootstrap previously stopped because permission was
 * denied, granting permission in-place must also restart registration; otherwise
 * the UI can look ready while the server still has no token for this device.
 */
export async function requestPushPermissionAndRegisterCurrentDevice(): Promise<boolean> {
    const allowed = await requestPushNotificationPermission();
    if (!allowed) return false;

    // Load these only after the user taps the permission CTA. Importing
    // pushRegistration while rendering the form would initialize the native
    // messaging bridge before it is needed.
    const { getAuthMember } = require("../auth/authStorage") as typeof import("../auth/authStorage");
    const { registerPushAfterLogin } = require("./pushRegistration") as typeof import("./pushRegistration");
    const memberId = (await getAuthMember())?.id;
    if (typeof memberId !== "number" || !Number.isSafeInteger(memberId) || memberId <= 0) {
        throw new Error("Authenticated member is unavailable for push registration.");
    }

    await registerPushAfterLogin(memberId);
    return true;
}
