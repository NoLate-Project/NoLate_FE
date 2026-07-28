import Constants from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "../storage/secureStorage";
import { PermissionsAndroid, Platform } from "react-native";
import {
    AuthorizationStatus,
    deleteToken,
    type FirebaseMessagingTypes,
    getAPNSToken,
    getMessaging,
    getToken,
    isDeviceRegisteredForRemoteMessages,
    onTokenRefresh,
    registerDeviceForRemoteMessages,
    requestPermission,
    setAPNSToken,
} from "@react-native-firebase/messaging";

import { registerPushToken } from "../../api/notification";
import {
    cancelPendingPushRegistration,
    isPushRegistrationGenerationCurrent,
    runPushRegistration,
} from "./pushRegistrationCoordinator";
import { retryPushRegistration } from "./pushRegistrationRetry";
import { shouldRegisterRemotePush } from "./pushRegistrationDevicePolicy";

const PUSH_DEVICE_ID_KEY = "nolate_push_device_id";
const PUSH_NATIVE_CONTEXT_KEY = "nolate_push_native_context_v2";
const APNS_TOKEN_RETRY_COUNT = 30;
const APNS_TOKEN_RETRY_DELAY_MS = 500;
const PUSH_REGISTRATION_RETRY_DELAYS_MS = [0, 1_500, 4_000] as const;

function logPushDevelopment(message: string, error?: unknown): void {
    if (!__DEV__) return;
    if (error === undefined) {
        console.info(message);
        return;
    }
    console.warn(message, error);
}

async function getOrCreateDeviceId(): Promise<string> {
    const existing = await SecureStore.getItemAsync(PUSH_DEVICE_ID_KEY);
    if (existing) return existing;

    const generated = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await SecureStore.setItemAsync(PUSH_DEVICE_ID_KEY, generated);
    return generated;
}

async function registerToken(memberId: number, token: string): Promise<void> {
    await registerPushToken({
        memberId,
        deviceId: await getOrCreateDeviceId(),
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
        token,
    });
}

async function waitForApnsToken(): Promise<string> {
    const messaging = getMessaging();

    for (let attempt = 0; attempt < APNS_TOKEN_RETRY_COUNT; attempt += 1) {
        const token = await getAPNSToken(messaging);
        if (token) return token;

        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), APNS_TOKEN_RETRY_DELAY_MS);
        });
    }

    throw new Error(
        "APNs device token is unavailable. iOS push registration requires a signed build on a physical device.",
    );
}

function getApnsTokenType(): "prod" | "sandbox" {
    return __DEV__ ? "sandbox" : "prod";
}

function createNativePushContext(apnsToken?: string, apnsTokenType?: string): string {
    return JSON.stringify({
        platform: Platform.OS,
        appId:
            Constants.expoConfig?.ios?.bundleIdentifier ??
            Constants.expoConfig?.android?.package ??
            null,
        appVersion: Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
        buildVersion:
            Constants.nativeBuildVersion ??
            Constants.expoConfig?.ios?.buildNumber ??
            Constants.expoConfig?.android?.versionCode ??
            null,
        apnsToken: apnsToken ?? null,
        apnsTokenType: apnsTokenType ?? null,
    });
}

async function refreshFcmTokenIfNativeContextChanged(
    messaging: FirebaseMessagingTypes.Module,
    nativeContext: string,
): Promise<void> {
    const previousContext = await SecureStore.getItemAsync(PUSH_NATIVE_CONTEXT_KEY);
    if (previousContext === nativeContext) return;

    try {
        await deleteToken(messaging);
        logPushDevelopment("[push] refreshed cached FCM token for native push context");
    } catch (error) {
        logPushDevelopment("[push] cached FCM token refresh failed; continuing with current token", error);
    }
}

export function registerPushAfterLogin(memberId?: number): Promise<void> {
    if (!memberId) return Promise.resolve();
    return runPushRegistration(memberId, (generation) => (
        retryPushRegistration(
            () => performPushRegistration(memberId, generation),
            {
                delaysMs: PUSH_REGISTRATION_RETRY_DELAYS_MS,
                isCurrent: () => isPushRegistrationGenerationCurrent(generation),
            },
        )
    ));
}

async function performPushRegistration(memberId: number, generation: number): Promise<void> {
    if (!memberId) return;
    // expo-constants 18에서 Constants.isDevice가 제거됐다. 제거된 값을 검사하면 undefined가
    // false로 평가되어 실제 iPhone까지 시뮬레이터로 오인하고 모든 토큰 등록을 건너뛴다.
    if (!shouldRegisterRemotePush(Platform.OS, Device.isDevice)) return;

    const messaging = getMessaging();
    let allowed = true;
    let apnsToken: string | undefined;
    let apnsTokenType: "prod" | "sandbox" | undefined;

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
    if (!isPushRegistrationGenerationCurrent(generation)) return;

    if (!isDeviceRegisteredForRemoteMessages(messaging)) {
        await registerDeviceForRemoteMessages(messaging);
    }
    if (!isPushRegistrationGenerationCurrent(generation)) return;

    if (Platform.OS === "ios") {
        // FCM iOS 토큰은 APNs 토큰과 연결된 뒤에만 서버에서 실제 발송할 수 있다.
        apnsToken = await waitForApnsToken();
        apnsTokenType = getApnsTokenType();
        await setAPNSToken(messaging, apnsToken, apnsTokenType);
    }
    if (!isPushRegistrationGenerationCurrent(generation)) return;

    const nativeContext = createNativePushContext(apnsToken, apnsTokenType);
    await refreshFcmTokenIfNativeContextChanged(messaging, nativeContext);

    const token = await getToken(messaging);
    if (!isPushRegistrationGenerationCurrent(generation)) return;

    await registerToken(memberId, token);
    if (!isPushRegistrationGenerationCurrent(generation)) return;
    await SecureStore.setItemAsync(PUSH_NATIVE_CONTEXT_KEY, nativeContext);
}

export function subscribePushTokenRefresh(memberId?: number): () => void {
    if (!memberId) return () => undefined;

    return onTokenRefresh(getMessaging(), (token) => {
        registerToken(memberId, token).catch((error) => {
            logPushDevelopment("[push] refreshed token registration failed", error);
        });
    });
}

export async function clearPushRegistrationAfterLogout(): Promise<void> {
    cancelPendingPushRegistration();
    await SecureStore.deleteItemAsync(PUSH_NATIVE_CONTEXT_KEY);
    if (!shouldRegisterRemotePush(Platform.OS, Device.isDevice)) return;

    try {
        await deleteToken(getMessaging());
    } catch (error) {
        // Server-side logout revokes the member's registered devices. Local token
        // deletion is defense in depth and must never prevent local account cleanup.
        logPushDevelopment("[push] local token cleanup failed", error);
    }
}
