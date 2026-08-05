import Constants from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "../storage/secureStorage";
import { Platform } from "react-native";
import {
    deleteToken,
    type FirebaseMessagingTypes,
    getAPNSToken,
    getMessaging,
    getToken,
    isDeviceRegisteredForRemoteMessages,
    onTokenRefresh,
    registerDeviceForRemoteMessages,
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
import { requestPushNotificationPermission } from "./pushPermission";
import {
    activateDepartureReminderAccountForAuthenticatedSession,
    reconcileDepartureAlarmSnapshot,
} from "./departureAlarmSync";
import { getOrCreatePushDeviceId } from "./pushDeviceIdentity";
import { createLatestPushTokenRetryCoordinator } from "./pushTokenRefreshRetry";

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

async function registerToken(
    memberId: number,
    token: string,
    isCurrent: () => boolean = () => true,
): Promise<void> {
    if (!isCurrent()) return;
    if (!(await activateDepartureReminderAccountForAuthenticatedSession(memberId))) {
        throw new Error("Native departure reminder account binding is unavailable.");
    }
    if (!isCurrent()) return;
    await registerPushToken({
        memberId,
        deviceId: await getOrCreatePushDeviceId(),
        platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
        token,
        deliveryAckCapabilityVersion: 1,
    });
    // A successful token registration is a durable point at which missed
    // data-only commands can be recovered from the authoritative snapshot.
    await reconcileDepartureAlarmSnapshot(memberId).catch((error) => {
        // Token registration has already succeeded. Snapshot recovery is
        // best-effort and must not turn that success into a registration retry.
        logPushDevelopment("[alarm-sync] post-registration snapshot failed", error);
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
    let apnsToken: string | undefined;
    let apnsTokenType: "prod" | "sandbox" | undefined;

    const allowed = await requestPushNotificationPermission(messaging);

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

    await registerToken(
        memberId,
        token,
        () => isPushRegistrationGenerationCurrent(generation),
    );
    if (!isPushRegistrationGenerationCurrent(generation)) return;
    await SecureStore.setItemAsync(PUSH_NATIVE_CONTEXT_KEY, nativeContext);
}

export function subscribePushTokenRefresh(memberId?: number): () => void {
    if (!memberId) return () => undefined;

    const coordinator = createLatestPushTokenRetryCoordinator({
        register: (token) => registerToken(memberId, token),
        onError: (error) => {
            logPushDevelopment("[push] refreshed token registration failed after retries", error);
        },
    });
    const unsubscribeNative = onTokenRefresh(getMessaging(), (token) => {
        coordinator.enqueue(token).catch((error) => {
            logPushDevelopment("[push] refreshed token retry coordinator failed", error);
        });
    });
    return () => {
        coordinator.stop();
        unsubscribeNative();
    };
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
