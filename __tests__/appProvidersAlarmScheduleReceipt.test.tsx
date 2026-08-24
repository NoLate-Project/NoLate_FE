import React from "react";
import { AppState, Text, type AppStateStatus } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { AppProviders } from "../src/AppProviders";
import { useAuth } from "../src/modules/auth/AuthContext";
import { getAuthMember } from "../src/modules/auth/authStorage";
import {
    activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember,
} from "../src/modules/notification/departureAlarmScheduleReceiptQueue";
import {
    activateForegroundPushPresentationClaimsForAuthenticatedMember,
} from "../src/modules/notification/foregroundPushPresentationClaim";
import {
    activateNativeAlarmFireJournalForAuthenticatedMember,
} from "../src/modules/notification/nativeAlarmFireJournal";
import {
    activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember,
} from "../src/modules/schedule/quickScheduleReliabilityFeedbackQueue";
import {
    registerPushAfterLogin,
    subscribePushTokenRefresh,
} from "../src/modules/notification/pushRegistration";

jest.mock("../src/modules/auth/authStorage", () => ({
    getAuthMember: jest.fn(),
}));

jest.mock("../src/modules/auth/AuthContext", () => ({
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    useAuth: jest.fn(),
}));

jest.mock("../src/modules/theme/ThemeContext", () => ({
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../src/modules/schedule/initialState", () => ({
    createScheduleInitialState: jest.fn(() => ({})),
}));

jest.mock("../src/modules/schedule/store", () => ({
    ScheduleProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../src/modules/widget/NoLateWidgetSync", () => ({
    NoLateWidgetSync: () => null,
}));

jest.mock("../src/modules/notification/pushRegistration", () => ({
    registerPushAfterLogin: jest.fn().mockResolvedValue(undefined),
    subscribePushTokenRefresh: jest.fn(),
}));

jest.mock("../src/modules/notification/pushDeliveryAckQueue", () => ({
    activatePushDeliveryAckQueueForAuthenticatedMember: jest.fn().mockResolvedValue(undefined),
    drainPushDeliveryAckQueue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    reconcileDepartureAlarmSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/nativeAlarmFireJournal", () => ({
    activateNativeAlarmFireJournalForAuthenticatedMember: jest.fn().mockResolvedValue(undefined),
    deactivateNativeAlarmFireJournalRetry: jest.fn(),
}));

jest.mock("../src/modules/notification/departureAlarmScheduleReceiptQueue", () => ({
    activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember: jest
        .fn()
        .mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/foregroundPushPresentationClaim", () => ({
    activateForegroundPushPresentationClaimsForAuthenticatedMember: jest
        .fn()
        .mockResolvedValue(true),
}));

jest.mock("../src/modules/notification/nativeDepartureReminderPresentationJournal", () => ({
    activateNativeDepartureReminderPresentationJournal: jest.fn().mockResolvedValue({
        discovered: 0,
        acknowledged: 0,
        unresolved: 0,
        accountMismatch: 0,
        blocked: false,
    }),
    deactivateNativeDepartureReminderPresentationJournal: jest.fn(),
}));

jest.mock("../src/modules/schedule/scheduleArrivalObservationQueue", () => ({
    activateScheduleArrivalObservationQueueForAuthenticatedMember: jest
        .fn()
        .mockResolvedValue(undefined),
}));

jest.mock("../src/modules/schedule/quickScheduleReliabilityFeedbackQueue", () => ({
    activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember: jest
        .fn()
        .mockResolvedValue(undefined),
}));

jest.mock("../src/modules/schedule/scheduleEtaObservationEngagementQueue", () => ({
    activateScheduleEtaObservationEngagementQueueForAuthenticatedMember: jest
        .fn()
        .mockResolvedValue(undefined),
}));

jest.mock("../src/modules/schedule/quickScheduleReliabilityFeedbackQueue", () => ({
    activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember: jest
        .fn()
        .mockResolvedValue(undefined),
}));

const mockedGetAuthMember = jest.mocked(getAuthMember);
const mockedUseAuth = jest.mocked(useAuth);
const mockedActivateReceiptQueue = jest.mocked(
    activateDepartureAlarmScheduleReceiptQueueForAuthenticatedMember
);
const mockedActivatePresentationClaims = jest.mocked(
    activateForegroundPushPresentationClaimsForAuthenticatedMember
);
const mockedActivateFireJournal = jest.mocked(
    activateNativeAlarmFireJournalForAuthenticatedMember
);
const mockedActivateQuickScheduleFeedback = jest.mocked(
    activateQuickScheduleReliabilityFeedbackQueueForAuthenticatedMember
);
const mockedRegisterPushAfterLogin = jest.mocked(registerPushAfterLogin);
const mockedSubscribePushTokenRefresh = jest.mocked(subscribePushTokenRefresh);

function deferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe("AppProviders alarm schedule receipt bootstrap", () => {
    let renderer: ReactTestRenderer | undefined;
    let appStateListeners: Array<(state: AppStateStatus) => void> = [];
    const removeAppStateListener = jest.fn();
    const unsubscribePushRefresh = jest.fn();

    beforeEach(() => {
        appStateListeners = [];
        mockedUseAuth.mockReturnValue({
            isAuthenticated: true,
            isLoading: false,
        } as ReturnType<typeof useAuth>);
        mockedGetAuthMember.mockResolvedValue({ id: 77 } as Awaited<
            ReturnType<typeof getAuthMember>
        >);
        mockedSubscribePushTokenRefresh.mockReturnValue(unsubscribePushRefresh);
        mockedRegisterPushAfterLogin.mockResolvedValue(undefined);
        jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
            appStateListeners.push(listener);
            return { remove: removeAppStateListener };
        });
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.restoreAllMocks();
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("drains on authenticated cold start and whenever the app becomes active", async () => {
        await act(async () => {
            renderer = TestRenderer.create(
                <AppProviders>
                    <Text>child</Text>
                </AppProviders>
            );
            await Promise.resolve();
        });

        expect(mockedActivateReceiptQueue).toHaveBeenCalledTimes(1);
        expect(mockedActivatePresentationClaims).toHaveBeenCalledTimes(1);
        expect(mockedRegisterPushAfterLogin).toHaveBeenCalledWith(77);
        expect(mockedActivateFireJournal).toHaveBeenCalledTimes(1);
        expect(mockedActivateQuickScheduleFeedback).toHaveBeenCalledTimes(1);
        expect(appStateListeners).toHaveLength(4);

        await act(async () => {
            appStateListeners.forEach((listener) => listener("background"));
            await Promise.resolve();
        });
        expect(mockedActivateReceiptQueue).toHaveBeenCalledTimes(1);
        expect(mockedActivatePresentationClaims).toHaveBeenCalledTimes(1);

        await act(async () => {
            appStateListeners.forEach((listener) => listener("active"));
            await Promise.resolve();
        });
        expect(mockedActivateReceiptQueue).toHaveBeenCalledTimes(2);
        expect(mockedActivateFireJournal).toHaveBeenCalledTimes(2);
        expect(mockedActivateQuickScheduleFeedback).toHaveBeenCalledTimes(2);

        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        expect(removeAppStateListener).toHaveBeenCalledTimes(4);
        expect(unsubscribePushRefresh).toHaveBeenCalledTimes(1);
    });

    it("retries the cached member bootstrap on active after a transient storage failure", async () => {
        mockedGetAuthMember
            .mockRejectedValueOnce(new Error("keychain temporarily unavailable"))
            .mockResolvedValue({ id: 77 } as Awaited<ReturnType<typeof getAuthMember>>);
        jest.spyOn(console, "warn").mockImplementation(() => undefined);

        await act(async () => {
            renderer = TestRenderer.create(
                <AppProviders>
                    <Text>child</Text>
                </AppProviders>
            );
            await Promise.resolve();
        });

        expect(appStateListeners).toHaveLength(4);
        expect(mockedActivateReceiptQueue).toHaveBeenCalledTimes(1);
        expect(mockedActivateFireJournal).toHaveBeenCalledTimes(1);
        expect(mockedSubscribePushTokenRefresh).not.toHaveBeenCalled();

        await act(async () => {
            appStateListeners.forEach((listener) => listener("active"));
            await Promise.resolve();
        });
        expect(mockedActivateReceiptQueue).toHaveBeenCalledTimes(2);
        expect(mockedActivateFireJournal).toHaveBeenCalledTimes(2);
        expect(mockedSubscribePushTokenRefresh).toHaveBeenCalledWith(77);
        expect(mockedRegisterPushAfterLogin).toHaveBeenCalledWith(77);
    });

    it("retries a transient cached-member read while the app stays active", async () => {
        jest.useFakeTimers();
        const initialMemberRead = deferred<Awaited<ReturnType<typeof getAuthMember>>>();
        mockedGetAuthMember
            .mockReturnValueOnce(initialMemberRead.promise)
            .mockResolvedValue({ id: 77 } as Awaited<ReturnType<typeof getAuthMember>>);
        jest.spyOn(console, "warn").mockImplementation(() => undefined);

        await act(async () => {
            renderer = TestRenderer.create(
                <AppProviders>
                    <Text>child</Text>
                </AppProviders>
            );
            await Promise.resolve();
        });
        appStateListeners.forEach((listener) => listener("active"));
        await act(async () => {
            initialMemberRead.reject(new Error("keychain temporarily unavailable"));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockedSubscribePushTokenRefresh).not.toHaveBeenCalled();
        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_500);
        });

        expect(mockedSubscribePushTokenRefresh).toHaveBeenCalledWith(77);
        expect(mockedRegisterPushAfterLogin).toHaveBeenCalledWith(77);
    });

    it("retries exhausted token registration while the app remains active", async () => {
        jest.useFakeTimers();
        const initialRegistration = deferred();
        mockedRegisterPushAfterLogin
            .mockReturnValueOnce(initialRegistration.promise)
            .mockResolvedValueOnce(undefined);
        jest.spyOn(console, "warn").mockImplementation(() => undefined);

        await act(async () => {
            renderer = TestRenderer.create(
                <AppProviders>
                    <Text>child</Text>
                </AppProviders>
            );
            await Promise.resolve();
        });
        appStateListeners.forEach((listener) => listener("active"));

        await act(async () => {
            initialRegistration.reject(new Error("registration retries exhausted"));
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mockedRegisterPushAfterLogin).toHaveBeenCalledTimes(1);

        await act(async () => {
            await jest.advanceTimersByTimeAsync(15_000);
        });
        expect(mockedRegisterPushAfterLogin).toHaveBeenCalledTimes(2);
    });

    it("cancels a pending registration recovery timer on unmount", async () => {
        jest.useFakeTimers();
        const initialRegistration = deferred();
        mockedRegisterPushAfterLogin.mockReturnValueOnce(initialRegistration.promise);
        jest.spyOn(console, "warn").mockImplementation(() => undefined);

        await act(async () => {
            renderer = TestRenderer.create(
                <AppProviders>
                    <Text>child</Text>
                </AppProviders>
            );
            await Promise.resolve();
        });
        appStateListeners.forEach((listener) => listener("active"));
        await act(async () => {
            initialRegistration.reject(new Error("registration retries exhausted"));
            await Promise.resolve();
            await Promise.resolve();
        });

        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        await jest.advanceTimersByTimeAsync(15_000);

        expect(mockedRegisterPushAfterLogin).toHaveBeenCalledTimes(1);
    });
});
