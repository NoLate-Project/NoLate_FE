import * as SecureStore from "expo-secure-store";
import { PermissionsAndroid, Platform } from "react-native";
import {
    AuthorizationStatus,
    getMessaging,
    getToken,
    onTokenRefresh,
    registerDeviceForRemoteMessages,
    requestPermission,
} from "@react-native-firebase/messaging";

import { registerPushToken } from "../../api/notification";

const PUSH_DEVICE_ID_KEY = "nolate_push_device_id";

async function getOrCreateDeviceId(): Promise<string> {
    const existing = await SecureStore.getItemAsync(PUSH_DEVICE_ID_KEY);
    if (existing) return existing;

    const generated = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await SecureStore.setItemAsync(PUSH_DEVICE_ID_KEY, generated);
    return generated;
}

async function registerToken(token: string): Promise<void> {
    await registerPushToken({
        deviceId: await getOrCreateDeviceId(),
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
        token,
    });
}

export async function registerPushAfterLogin(memberId?: number): Promise<void> {
    if (!memberId) return;

    const messaging = getMessaging();
    let allowed = true;

    if (Platform.OS === "android" && Platform.Version >= 33) {
        allowed =
            (await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            )) === PermissionsAndroid.RESULTS.GRANTED;
    } else if (Platform.OS === "ios") {
        const permission = await requestPermission(messaging);
        allowed =
            permission === AuthorizationStatus.AUTHORIZED ||
            permission === AuthorizationStatus.PROVISIONAL;
    }

    if (!allowed) return;

    await registerDeviceForRemoteMessages(messaging);
    await registerToken(await getToken(messaging));
}

export function subscribePushTokenRefresh(memberId?: number): () => void {
    if (!memberId) return () => undefined;

    return onTokenRefresh(getMessaging(), (token) => {
        registerToken(token).catch((error) => {
            console.warn("[push] refreshed token registration failed", error);
        });
    });
}
