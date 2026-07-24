import * as Device from "expo-device";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

import * as SecureStorage from "../storage/secureStorage";

const PUSH_PERMISSION_REQUESTED_KEY = "nolate_push_permission_requested_v1";
export const SCHEDULE_PUSH_CHANNEL_ID = "schedule-push";

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
    ios?: {
        status?: number;
    };
};

export function normalizeNotificationPermissionState(
    permission: PermissionSnapshot,
): NotificationPermissionState {
    // Expo iOS authorization: 2=authorized, 3=provisional, 4=ephemeral.
    if (
        permission.ios?.status === 2 ||
        permission.ios?.status === 3 ||
        permission.ios?.status === 4
    ) {
        return "granted";
    }
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

export function applyAndroidNotificationChannelState(
    globalState: NotificationPermissionState,
    importance?: number | null,
): NotificationPermissionState {
    return globalState === "granted" &&
        importance === 2
        ? "blocked"
        : globalState;
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
    const Notifications = await getNotificationsModule();
    if (!Notifications) return "unavailable";

    return resolveNotificationPermissionState(
        Notifications,
        await Notifications.getPermissionsAsync(),
    );
}

async function resolveNotificationPermissionState(
    Notifications: NonNullable<Awaited<ReturnType<typeof getNotificationsModule>>>,
    permission: PermissionSnapshot,
): Promise<NotificationPermissionState> {
    const globalState = normalizeNotificationPermissionState(permission);
    if (Platform.OS !== "android" || globalState !== "granted") return globalState;

    try {
        const channel = await Notifications.getNotificationChannelAsync?.(
            SCHEDULE_PUSH_CHANNEL_ID,
        );
        // NONE(2) means the user explicitly blocked this channel. A missing
        // channel or unsupported API falls back to the app-wide permission.
        return applyAndroidNotificationChannelState(
            globalState,
            channel?.importance,
        );
    } catch {
        return globalState;
    }
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
    return resolveNotificationPermissionState(Notifications, permission);
}

export async function wasNotificationPermissionRequested(): Promise<boolean> {
    return (await SecureStorage.getItemAsync(PUSH_PERMISSION_REQUESTED_KEY)) === "1";
}

export async function markNotificationPermissionRequested(): Promise<void> {
    await SecureStorage.setItemAsync(PUSH_PERMISSION_REQUESTED_KEY, "1");
}
