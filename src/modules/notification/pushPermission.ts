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
