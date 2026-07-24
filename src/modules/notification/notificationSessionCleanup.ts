import * as Device from "expo-device";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

import { isAuthSessionEpochCurrent } from "../auth/authSessionEpoch";
import {
    runNotificationPresentationMutation,
} from "./notificationPresentationCoordinator";

type DeliveredNotificationCleanupApi = {
    dismissAllNotificationsAsync: () => Promise<void>;
    setBadgeCountAsync: (count: number) => Promise<boolean>;
    clearLastNotificationResponse: () => void;
};

async function loadDeliveredNotificationCleanupApi(): Promise<
    DeliveredNotificationCleanupApi | null
> {
    if (Platform.OS === "ios" && !Device.isDevice) return null;
    if (!requireOptionalNativeModule("ExpoPushTokenManager")) return null;

    try {
        return await import("expo-notifications");
    } catch {
        return null;
    }
}

export async function clearDeliveredNotificationsForAuthSession(options: {
    authEpoch: number;
    loadNotifications?: () => Promise<DeliveredNotificationCleanupApi | null>;
}): Promise<boolean> {
    if (!isAuthSessionEpochCurrent(options.authEpoch)) return false;
    const Notifications = await (
        options.loadNotifications ?? loadDeliveredNotificationCleanupApi
    )();
    if (
        !Notifications ||
        !isAuthSessionEpochCurrent(options.authEpoch)
    ) return false;

    return runNotificationPresentationMutation(async () => {
        if (!isAuthSessionEpochCurrent(options.authEpoch)) return false;

        // Start all native cleanup while the logout session still owns the
        // coordinator. A B-session presentation queues behind these promises.
        const nativeCleanups: Promise<unknown>[] = [];
        try {
            nativeCleanups.push(Notifications.dismissAllNotificationsAsync());
        } catch {
            // Best effort: continue clearing the badge and initial response.
        }
        try {
            nativeCleanups.push(Notifications.setBadgeCountAsync(0));
        } catch {
            // Best effort: continue clearing the other notification state.
        }
        try {
            Notifications.clearLastNotificationResponse();
        } catch {
            // Some older native runtimes do not expose this synchronous API.
        }
        await Promise.allSettled(nativeCleanups);
        return true;
    });
}
