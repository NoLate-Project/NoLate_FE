import { Platform } from 'react-native';

export type JourneyPushInstallationPort = {
    isSimulator: boolean;
    projectId: string | undefined;
    isRegistered(): boolean;
    register(): Promise<void>;
    apnsToken(): Promise<string | null>;
    sandboxAPNS(token: string): Promise<void>;
    fcmToken(): Promise<string>;
    sha256(value: string): Promise<string>;
};

/** Explicit simulator-only test action. No permission request, account registration or token logs. */
export async function inspectJourneyPushInstallation(port: JourneyPushInstallationPort) {
    if (!__DEV__ || Platform.OS !== 'ios' || !port.isSimulator) throw new Error('APNS_TEST_SIMULATOR_REQUIRED');
    if (port.projectId !== 'nolate-cbdf2') throw new Error('APNS_TEST_PROJECT_MISMATCH');
    const registered = await safeStage(async () => port.isRegistered(), 'APNS_TEST_REGISTRATION_READ_FAILED');
    if (!registered) await safeStage(port.register, 'APNS_TEST_REGISTER_FAILED');
    const apnsToken = await safeStage(port.apnsToken, 'APNS_TEST_APNS_READ_FAILED');
    if (!apnsToken) throw new Error('APNS_TEST_TOKEN_NOT_READY');
    // Register the genuine simulator token's environment; never manufacture a token.
    await safeStage(() => port.sandboxAPNS(apnsToken), 'APNS_TEST_SANDBOX_MAPPING_FAILED');
    const token = await safeStage(port.fcmToken, 'APNS_TEST_FCM_FETCH_FAILED');
    if (!token || token.length > 4096 || /\s/.test(token)
        || [...token].some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)) throw new Error('APNS_TEST_FCM_INVALID');
    const digest = await safeStage(() => port.sha256(token), 'APNS_TEST_HASH_FAILED');
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('APNS_TEST_DIGEST_INVALID');
    // The token is only returned to the in-memory native pilot, never rendered or persisted.
    return { token, digest };
}

export async function loadJourneyPushInstallation() {
    if (!__DEV__ || Platform.OS !== 'ios') throw new Error('APNS_TEST_SIMULATOR_REQUIRED');
    const device = await safeStage(async () => require('expo-device') as typeof import('expo-device'), 'APNS_TEST_DEVICE_MODULE_UNAVAILABLE');
    if (device.isDevice) throw new Error('APNS_TEST_SIMULATOR_REQUIRED');
    // Synchronous lazy requires avoid Metro's network-dependent split bundle fetch during a probe.
    const [messaging, firebase, crypto] = await safeStage(async () => [
        require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging'),
        require('@react-native-firebase/app') as typeof import('@react-native-firebase/app'),
        require('expo-crypto') as typeof import('expo-crypto'),
    ] as const, 'APNS_TEST_MODULE_UNAVAILABLE');
    const instance = await safeStage(async () => messaging.getMessaging(), 'APNS_TEST_FIREBASE_UNAVAILABLE');
    const projectId = await safeStage(async () => firebase.getApp().options.projectId, 'APNS_TEST_FIREBASE_UNAVAILABLE');
    return inspectJourneyPushInstallation({
        isSimulator: true, projectId,
        isRegistered: () => messaging.isDeviceRegisteredForRemoteMessages(instance),
        register: () => messaging.registerDeviceForRemoteMessages(instance),
        apnsToken: () => messaging.getAPNSToken(instance), fcmToken: () => messaging.getToken(instance),
        sandboxAPNS: token => messaging.setAPNSToken(instance, token, 'sandbox'),
        sha256: token => crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, token),
    });
}

async function safeStage<T>(action: () => Promise<T>, code: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([action(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('APNS_TEST_STAGE_TIMEOUT')), 12_000);
        })]);
    } catch (failure) {
        if (failure instanceof Error && failure.message === 'APNS_TEST_STAGE_TIMEOUT') throw failure;
        throw new Error(code);
    } finally { if (timer) clearTimeout(timer); }
}

export function journeyPushInstallationError(error: unknown): string {
    const allowed = ['APNS_TEST_SIMULATOR_REQUIRED', 'APNS_TEST_PROJECT_MISMATCH', 'APNS_TEST_TOKEN_NOT_READY',
        'APNS_TEST_FCM_INVALID', 'APNS_TEST_DIGEST_INVALID', 'APNS_TEST_REGISTER_FAILED', 'APNS_TEST_APNS_READ_FAILED',
        'APNS_TEST_FCM_FETCH_FAILED', 'APNS_TEST_HASH_FAILED', 'APNS_TEST_MODULE_UNAVAILABLE', 'APNS_TEST_FIREBASE_UNAVAILABLE',
        'APNS_TEST_DEVICE_MODULE_UNAVAILABLE', 'APNS_TEST_REGISTRATION_READ_FAILED', 'APNS_TEST_STAGE_TIMEOUT',
        'APNS_TEST_SANDBOX_MAPPING_FAILED'];
    return error instanceof Error && allowed.includes(error.message) ? error.message : 'APNS_TEST_REGISTRATION_UNAVAILABLE';
}
