import Constants from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "../storage/secureStorage";
import { PermissionsAndroid, Platform } from "react-native";
import {
    AuthorizationStatus,
    deleteToken,
    getAPNSToken,
    getMessaging,
    getToken,
    hasPermission,
    isDeviceRegisteredForRemoteMessages,
    onTokenRefresh,
    registerDeviceForRemoteMessages,
    requestPermission,
    setAPNSToken,
} from "@react-native-firebase/messaging";

import {
    cancelPendingPushRegistration,
    isPushRegistrationGenerationCurrent,
    runPushRegistration,
} from "./pushRegistrationCoordinator";
import { retryPushRegistration } from "./pushRegistrationRetry";
import { shouldRegisterRemotePush } from "./pushRegistrationDevicePolicy";
import {
    markNotificationPermissionRequested,
    shouldAutomaticallyRequestNotificationPermission,
    wasNotificationPermissionRequested,
} from "./notificationPermission";
import {
    getAuthSessionEpoch,
    isAuthSessionEpochCurrent,
} from "../auth/authSessionEpoch";
import { registerPushTokenForSession } from "./pushRegistrationSession";
import {
    clearPushNativeTokenState,
    getPushTokenForNativeContext,
    writePushNativeContext,
} from "./pushNativeTokenLifecycle";

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

async function registerToken(
    memberId: number,
    token: string,
    generation: number,
    authEpoch: number,
): Promise<void> {
    if (
        !isPushRegistrationGenerationCurrent(generation) ||
        !isAuthSessionEpochCurrent(authEpoch)
    ) return;
    const deviceId = await getOrCreateDeviceId();
    if (
        !isPushRegistrationGenerationCurrent(generation) ||
        !isAuthSessionEpochCurrent(authEpoch)
    ) return;

    await registerPushTokenForSession({
        memberId,
        deviceId,
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
        token,
        authEpoch,
        isRegistrationGenerationCurrent: () =>
            isPushRegistrationGenerationCurrent(generation),
    });
}

function isPushRegistrationSessionCurrent(
    generation: number,
    authEpoch: number,
): boolean {
    return (
        isPushRegistrationGenerationCurrent(generation) &&
        isAuthSessionEpochCurrent(authEpoch)
    );
}

async function waitForApnsToken(
    generation: number,
    authEpoch: number,
): Promise<string | undefined> {
    const messaging = getMessaging();

    for (let attempt = 0; attempt < APNS_TOKEN_RETRY_COUNT; attempt += 1) {
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) {
            return undefined;
        }
        const token = await getAPNSToken(messaging);
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) {
            return undefined;
        }
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

export function registerPushAfterLogin(memberId?: number): Promise<void> {
    if (!memberId) return Promise.resolve();
    const authEpoch = getAuthSessionEpoch();
    return runPushRegistration(memberId, (generation) => (
        retryPushRegistration(
            () => performPushRegistration(memberId, generation, authEpoch),
            {
                delaysMs: PUSH_REGISTRATION_RETRY_DELAYS_MS,
                isCurrent: () =>
                    isPushRegistrationGenerationCurrent(generation) &&
                    isAuthSessionEpochCurrent(authEpoch),
            },
        )
    ));
}

async function performPushRegistration(
    memberId: number,
    generation: number,
    authEpoch: number,
): Promise<void> {
    if (!memberId) return;
    if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
    // expo-constants 18에서 Constants.isDevice가 제거됐다. 제거된 값을 검사하면 undefined가
    // false로 평가되어 실제 iPhone까지 시뮬레이터로 오인하고 모든 토큰 등록을 건너뛴다.
    if (!shouldRegisterRemotePush(Platform.OS, Device.isDevice)) return;

    const messaging = getMessaging();
    let allowed = true;
    let apnsToken: string | undefined;
    let apnsTokenType: "prod" | "sandbox" | undefined;

    if (Platform.OS === "android" && Platform.Version >= 33) {
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
        allowed = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
        if (!allowed && shouldAutomaticallyRequestNotificationPermission(
            "undetermined",
            await wasNotificationPermissionRequested(),
        )) {
            if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
            const result = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            );
            if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
            await markNotificationPermissionRequested();
            if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
            allowed = result === PermissionsAndroid.RESULTS.GRANTED;
        }
    } else if (Platform.OS === "ios") {
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
        let permission = await hasPermission(messaging);
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
        if (
            permission === AuthorizationStatus.NOT_DETERMINED &&
            shouldAutomaticallyRequestNotificationPermission(
                "undetermined",
                await wasNotificationPermissionRequested(),
            )
        ) {
            if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
            permission = await requestPermission(messaging);
            if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
            await markNotificationPermissionRequested();
            if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
        }
        allowed =
            permission === AuthorizationStatus.AUTHORIZED ||
            permission === AuthorizationStatus.PROVISIONAL ||
            permission === AuthorizationStatus.EPHEMERAL;
    }

    if (!allowed) return;
    if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;

    if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
    if (!isDeviceRegisteredForRemoteMessages(messaging)) {
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
        await registerDeviceForRemoteMessages(messaging);
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
    }
    if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;

    if (Platform.OS === "ios") {
        // FCM iOS 토큰은 APNs 토큰과 연결된 뒤에만 서버에서 실제 발송할 수 있다.
        apnsToken = await waitForApnsToken(generation, authEpoch);
        if (!apnsToken) return;
        apnsTokenType = getApnsTokenType();
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
        await setAPNSToken(messaging, apnsToken, apnsTokenType);
        if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;
    }
    if (!isPushRegistrationSessionCurrent(generation, authEpoch)) return;

    const nativeContext = createNativePushContext(apnsToken, apnsTokenType);
    const fence = {
        isCurrent: () =>
            isPushRegistrationSessionCurrent(generation, authEpoch),
    };
    const token = await getPushTokenForNativeContext({
        nativeContext,
        fence,
        readContext: () => SecureStore.getItemAsync(PUSH_NATIVE_CONTEXT_KEY),
        deleteToken: () => deleteToken(messaging),
        getToken: () => getToken(messaging),
        onDeleteError: (error) => {
            logPushDevelopment(
                "[push] cached FCM token refresh failed; continuing with current token",
                error,
            );
        },
    });
    if (!token || !fence.isCurrent()) return;

    await registerToken(memberId, token, generation, authEpoch);
    if (!fence.isCurrent()) return;
    await writePushNativeContext({
        nativeContext,
        fence,
        writeContext: (value) =>
            SecureStore.setItemAsync(PUSH_NATIVE_CONTEXT_KEY, value),
    });
}

export function subscribePushTokenRefresh(memberId?: number): () => void {
    if (!memberId) return () => undefined;
    const subscriptionAuthEpoch = getAuthSessionEpoch();

    return onTokenRefresh(getMessaging(), (token) => {
        if (!isAuthSessionEpochCurrent(subscriptionAuthEpoch)) return;
        runPushRegistration(memberId, (generation) => (
            registerToken(memberId, token, generation, subscriptionAuthEpoch)
        ), { replaceExisting: true }).catch((error) => {
            logPushDevelopment("[push] refreshed token registration failed", error);
        });
    });
}

export async function clearPushRegistrationAfterLogout(): Promise<void> {
    cancelPendingPushRegistration();
    const shouldDeleteNativeToken =
        shouldRegisterRemotePush(Platform.OS, Device.isDevice);
    await clearPushNativeTokenState({
        deleteContext: () =>
            SecureStore.deleteItemAsync(PUSH_NATIVE_CONTEXT_KEY),
        deleteToken: shouldDeleteNativeToken
            ? () => deleteToken(getMessaging())
            : undefined,
        onDeleteTokenError: (error) => {
            // Server-side logout revokes the member's registered devices. Local token
            // deletion is defense in depth and must never prevent local account cleanup.
            logPushDevelopment("[push] local token cleanup failed", error);
        },
    });
}
