import * as Device from "expo-device";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

import * as SecureStorage from "../storage/secureStorage";

const PUSH_PERMISSION_REQUESTED_KEY = "nolate_push_permission_requested_v1";

export type NotificationPermissionState =
    | "granted"
    | "undetermined"
    | "denied"
    | "blocked"
    | "unavailable";

type PermissionSnapshot = {
    status?: string;
    granted?: boolean;
    canAskAgain?: boolean;
};

export function normalizeNotificationPermissionState(
    permission: PermissionSnapshot,
): NotificationPermissionState {
    if (permission.granted || permission.status === "granted") return "granted";
    if (permission.status === "undetermined") return "undetermined";
    if (permission.status === "denied") {
        return permission.canAskAgain === false ? "blocked" : "denied";
    }
    return "unavailable";
}

export function shouldAutomaticallyRequestNotificationPermission(
    state: NotificationPermissionState,
    wasRequested: boolean,
): boolean {
    return state === "undetermined" && !wasRequested;
}

async function getNotificationsModule() {
    if (Platform.OS === "ios" && !Device.isDevice) return null;
    if (!requireOptionalNativeModule("ExpoPushTokenManager")) return null;

    try {
        return await import("expo-notifications");
    } catch {
        return null;
    }
}

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
    if (Platform.OS === "android" && Number(Platform.Version) < 33) {
        return "granted";
    }

    const Notifications = await getNotificationsModule();
    if (!Notifications) return "unavailable";

    return normalizeNotificationPermissionState(
        await Notifications.getPermissionsAsync(),
    );
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return "unavailable";

    const permission = await Notifications.requestPermissionsAsync({
        ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
        },
    });
    await markNotificationPermissionRequested();
    return normalizeNotificationPermissionState(permission);
}

export async function wasNotificationPermissionRequested(): Promise<boolean> {
    return (await SecureStorage.getItemAsync(PUSH_PERMISSION_REQUESTED_KEY)) === "1";
}

export async function markNotificationPermissionRequested(): Promise<void> {
    await SecureStorage.setItemAsync(PUSH_PERMISSION_REQUESTED_KEY, "1");
}
