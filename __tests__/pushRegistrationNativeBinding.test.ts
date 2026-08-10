import { Platform } from "react-native";
import {
    AuthorizationStatus,
    requestPermission,
} from "@react-native-firebase/messaging";

import { registerPushToken } from "../src/api/notification";
import {
    activateDepartureReminderAccountForAuthenticatedSession,
} from "../src/modules/notification/departureAlarmSync";
import {
    registerPushAfterLogin,
    subscribePushRegistrationSuccess,
} from "../src/modules/notification/pushRegistration";
import { requestPushNotificationPermission } from "../src/modules/notification/pushPermission";
import {
    isPushRegistrationGenerationCurrent,
} from "../src/modules/notification/pushRegistrationCoordinator";

jest.mock("expo-constants", () => ({
    __esModule: true,
    default: {
        expoConfig: { android: { package: "com.nolate" }, version: "1.2.0" },
        nativeApplicationVersion: "1.2.0",
        nativeBuildVersion: "41",
    },
}));

jest.mock("expo-device", () => ({ isDevice: false }));

jest.mock("@react-native-firebase/messaging", () => ({
    AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
    deleteToken: jest.fn().mockResolvedValue(undefined),
    getAPNSToken: jest.fn(),
    getMessaging: jest.fn(() => ({})),
    getToken: jest.fn().mockResolvedValue("fcm-token-41"),
    isDeviceRegisteredForRemoteMessages: jest.fn(() => true),
    onTokenRefresh: jest.fn(() => jest.fn()),
    registerDeviceForRemoteMessages: jest.fn(),
    requestPermission: jest.fn(),
    setAPNSToken: jest.fn(),
}));

jest.mock("../src/api/notification", () => ({
    registerPushToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/storage/secureStorage", () => ({
    getItemAsync: jest.fn().mockResolvedValue(JSON.stringify({
        platform: "android",
        appId: "com.nolate",
        appVersion: "1.2.0",
        buildVersion: "41",
        apnsToken: null,
        apnsTokenType: null,
    })),
    setItemAsync: jest.fn().mockResolvedValue(undefined),
    deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    activateDepartureReminderAccountForAuthenticatedSession: jest.fn(),
    reconcileDepartureAlarmSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/pushDeviceIdentity", () => ({
    getOrCreatePushDeviceId: jest.fn().mockResolvedValue("device-41"),
}));

jest.mock("../src/modules/notification/pushRegistrationCoordinator", () => ({
    cancelPendingPushRegistration: jest.fn(),
    isPushRegistrationGenerationCurrent: jest.fn(() => true),
    runPushRegistration: jest.fn((_memberId: number, task: (generation: number) => Promise<void>) =>
        task(1)),
}));

jest.mock("../src/modules/notification/pushRegistrationRetry", () => ({
    retryPushRegistration: jest.fn((task: () => Promise<void>) => task()),
}));

describe("push registration native account ordering", () => {
    const originalPlatform = Platform.OS;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
        Object.defineProperty(Platform, "Version", { configurable: true, value: 32 });
        jest.mocked(activateDepartureReminderAccountForAuthenticatedSession)
            .mockResolvedValue(true);
        jest.mocked(isPushRegistrationGenerationCurrent).mockReturnValue(true);
        jest.mocked(registerPushToken).mockResolvedValue(undefined);
    });

    afterAll(() => {
        Object.defineProperty(Platform, "OS", {
            configurable: true,
            value: originalPlatform,
        });
    });

    it("awaits the native account binding before exposing the token to the server", async () => {
        await expect(registerPushAfterLogin(7)).resolves.toBeUndefined();

        expect(activateDepartureReminderAccountForAuthenticatedSession).toHaveBeenCalledWith(7);
        expect(registerPushToken).toHaveBeenCalledWith(expect.objectContaining({
            memberId: 7,
            token: "fcm-token-41",
        }));
        expect(
            jest.mocked(activateDepartureReminderAccountForAuthenticatedSession)
                .mock.invocationCallOrder[0],
        ).toBeLessThan(jest.mocked(registerPushToken).mock.invocationCallOrder[0]);
    });

    it("exposes the Live Activity bootstrap boundary only after FCM registration succeeds", async () => {
        let resolveRegistration: (() => void) | undefined;
        let markRegistrationStarted: (() => void) | undefined;
        const registrationStarted = new Promise<void>((resolve) => {
            markRegistrationStarted = resolve;
        });
        const pendingRegistration = new Promise<void>((resolve) => {
            resolveRegistration = resolve;
        });
        jest.mocked(registerPushToken).mockImplementation(() => {
            markRegistrationStarted?.();
            return pendingRegistration;
        });
        const listener = jest.fn();
        const unsubscribe = subscribePushRegistrationSuccess(listener);

        const request = registerPushAfterLogin(7);
        await registrationStarted;
        expect(registerPushToken).toHaveBeenCalledTimes(1);
        expect(listener).not.toHaveBeenCalled();

        resolveRegistration?.();
        await request;

        expect(listener).toHaveBeenCalledWith(7);
        unsubscribe();
    });

    it("routes a binding failure into registration recovery without registering", async () => {
        jest.mocked(activateDepartureReminderAccountForAuthenticatedSession)
            .mockResolvedValue(false);

        await expect(registerPushAfterLogin(7)).rejects.toThrow(
            "Native departure reminder account binding is unavailable",
        );
        expect(registerPushToken).not.toHaveBeenCalled();
    });

    it("does not open Live Activity sync after logout invalidates an in-flight registration", async () => {
        let resolveRegistration: (() => void) | undefined;
        let markRegistrationStarted: (() => void) | undefined;
        const registrationStarted = new Promise<void>((resolve) => {
            markRegistrationStarted = resolve;
        });
        jest.mocked(registerPushToken).mockImplementation(() => {
            markRegistrationStarted?.();
            return new Promise<void>((resolve) => {
                resolveRegistration = resolve;
            });
        });
        const listener = jest.fn();
        const unsubscribe = subscribePushRegistrationSuccess(listener);

        const request = registerPushAfterLogin(7);
        await registrationStarted;
        jest.mocked(isPushRegistrationGenerationCurrent).mockReturnValue(false);
        resolveRegistration?.();
        await request;

        expect(listener).not.toHaveBeenCalled();
        unsubscribe();
    });

    it("requests iOS display permission even when remote push registration is skipped in Simulator", async () => {
        Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
        jest.mocked(requestPermission).mockResolvedValue(AuthorizationStatus.AUTHORIZED);

        await expect(requestPushNotificationPermission()).resolves.toBe(true);

        expect(requestPermission).toHaveBeenCalledTimes(1);
        expect(registerPushToken).not.toHaveBeenCalled();
    });
});
