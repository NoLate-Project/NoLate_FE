jest.mock("react-native", () => {
    const React = require("react");
    return {
        Platform: { OS: "ios" },
        NativeModules: {
            NoLateShareAuth: {
                getItem: jest.fn(),
                setItem: jest.fn(),
                deleteItem: jest.fn(),
                getAppGroupSessionState: jest.fn(),
                setAppGroupSessionState: jest.fn(),
                setAppGroupSessionStateSync: jest.fn(),
                beginAppGroupSessionTransitionSync: jest.fn(),
                compareAndSetAppGroupSessionStateSync: jest.fn(),
            },
        },
        Text: (props: Record<string, unknown>) =>
            React.createElement("Text", props),
    };
});

jest.mock("../src/modules/storage/secureStorage", () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

jest.mock("expo-crypto", () => ({
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: jest.fn(async (_algorithm, value: string) =>
        `sha256:${value}`
    ),
}));

jest.mock("../src/api/member", () => ({
    getMemberCurationStatus: jest.fn(async () => ({
        curationCompleted: true,
    })),
    logoutMember: jest.fn(async () => undefined),
    tokenLoginMember: jest.fn(),
}));

jest.mock("../src/modules/auth/accountCleanup", () => ({
    clearAccountScopedLocalData: jest.fn(async () => undefined),
}));

import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { NativeModules, Text } from "react-native";

import { AuthProvider, useAuth } from "../src/modules/auth/AuthContext";
import {
    __resetAuthStorageInvalidSessionForTests,
} from "../src/modules/auth/authStorage";
import {
    __resetAuthSessionTransitionsForTests,
    activateAuthSessionIfCurrent,
    beginAuthLoginSession,
    isAuthSessionActive,
    waitForAuthSessionTransition,
} from "../src/modules/auth/authSessionEpoch";
import * as LocalStorage from "../src/modules/storage/secureStorage";

const sharedAuth = NativeModules.NoLateShareAuth as {
    getItem: jest.Mock<Promise<string | null>, [string]>;
    setItem: jest.Mock<Promise<boolean>, [string, string]>;
    deleteItem: jest.Mock<Promise<boolean>, [string]>;
    getAppGroupSessionState: jest.Mock<Promise<string | null>, []>;
    setAppGroupSessionState: jest.Mock<Promise<boolean>, [string]>;
    setAppGroupSessionStateSync: jest.Mock<
        { success: boolean },
        [string]
    >;
    compareAndSetAppGroupSessionStateSync: jest.Mock<
        { success: boolean },
        [string, string]
    >;
    beginAppGroupSessionTransitionSync: jest.Mock<
        { success: boolean },
        [string]
    >;
};
const secureStorage = {
    getItemAsync: jest.mocked(LocalStorage.getItemAsync),
    setItemAsync: jest.mocked(LocalStorage.setItemAsync),
    deleteItemAsync: jest.mocked(LocalStorage.deleteItemAsync),
};

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

function AuthFenceState() {
    const {
        isAuthenticated,
        isLoading,
        accountExitError,
        retryAccountExit,
        signOut,
    } = useAuth();
    if (accountExitError) {
        return <Text onPress={retryAccountExit}>account-exit-blocked</Text>;
    }
    if (isLoading) return <Text>loading</Text>;
    return (
        <>
            <Text>
                {isAuthenticated ? "authenticated" : "unauthenticated"}
            </Text>
            <Text onPress={() => signOut()}>sign-out</Text>
        </>
    );
}

describe("account-exit extension-visible durable fence", () => {
    let renderer: ReactTestRenderer | undefined;
    let secure: Map<string, string>;
    let shared: Map<string, string>;
    let appGroupState: string | null;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(async () => {
        await AsyncStorage.clear();
        __resetAuthSessionTransitionsForTests();
        __resetAuthStorageInvalidSessionForTests();
        jest.clearAllMocks();
        const epoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(epoch);
        const member = JSON.stringify({
            id: 1,
            name: "A",
            curationCompleted: true,
            authSessionIdentity: "sha256:A-refresh",
        });
        secure = new Map([
            ["nolte_access_token", "A-access"],
            ["nolte_refresh_token", "A-refresh"],
            ["nolate_auth_member", member],
        ]);
        shared = new Map(secure);
        appGroupState = "active:sha256:A-refresh";
        secureStorage.getItemAsync.mockImplementation(
            async (key) => secure.get(key) ?? null,
        );
        secureStorage.setItemAsync.mockImplementation(async (key, value) => {
            secure.set(key, value);
        });
        secureStorage.deleteItemAsync.mockImplementation(async (key) => {
            secure.delete(key);
        });
        sharedAuth.getItem.mockImplementation(
            async (key) => shared.get(key) ?? null,
        );
        sharedAuth.setItem.mockImplementation(async (key, value) => {
            shared.set(key, value);
            return true;
        });
        sharedAuth.deleteItem.mockImplementation(async (key) => {
            shared.delete(key);
            return true;
        });
        sharedAuth.getAppGroupSessionState.mockImplementation(
            async () => appGroupState,
        );
        sharedAuth.setAppGroupSessionState.mockImplementation(async (value) => {
            appGroupState = value;
            return true;
        });
        sharedAuth.setAppGroupSessionStateSync.mockImplementation((value) => {
            appGroupState = value;
            return { success: true };
        });
        sharedAuth.compareAndSetAppGroupSessionStateSync.mockReturnValue({
            success: true,
        });
        sharedAuth.beginAppGroupSessionTransitionSync.mockReturnValue({
            success: true,
        });
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    async function renderAuthenticatedProvider() {
        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthFenceState />
                </AuthProvider>,
            );
        });
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "authenticated",
        )).toBe(true);
    }

    test("delayed App Group fence 전에는 signed-out UI를 공개하지 않는다", async () => {
        await renderAuthenticatedProvider();
        const durableFence = deferred<boolean>();
        sharedAuth.setAppGroupSessionStateSync.mockReturnValue({
            success: false,
        });
        sharedAuth.setAppGroupSessionState.mockImplementationOnce(
            async (value) => {
                await durableFence.promise;
                appGroupState = value;
                return true;
            },
        );
        let signOutPromise!: Promise<boolean>;

        act(() => {
            signOutPromise = renderer?.root.findAllByType(Text).find(
                (node) => node.props.children === "sign-out",
            )?.props.onPress();
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(isAuthSessionActive()).toBe(false);
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "loading",
        )).toBe(true);
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(false);
        expect(sharedAuth.setItem).not.toHaveBeenCalledWith(
            "nolate_auth_invalid_session",
            "invalidated",
        );

        durableFence.resolve(true);
        await act(async () => {
            await signOutPromise;
        });
        expect(appGroupState).toBe("invalidated");
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(true);
    });

    test("App Group 실패 뒤 delayed shared Keychain fallback 전에도 account 전환을 공개하지 않는다", async () => {
        await renderAuthenticatedProvider();
        const sharedFence = deferred<void>();
        sharedAuth.setAppGroupSessionStateSync.mockReturnValue({
            success: false,
        });
        sharedAuth.setAppGroupSessionState.mockRejectedValueOnce(
            new Error("app group unavailable"),
        );
        sharedAuth.setItem.mockImplementation(async (key, value) => {
            if (key === "nolate_auth_invalid_session") {
                await sharedFence.promise;
            }
            shared.set(key, value);
            return true;
        });
        let signOutPromise!: Promise<boolean>;

        act(() => {
            signOutPromise = renderer?.root.findAllByType(Text).find(
                (node) => node.props.children === "sign-out",
            )?.props.onPress();
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        // A process kill at this boundary would still find active:A and no
        // shared marker, so the UI/login transition must remain closed.
        expect(appGroupState).toBe("active:sha256:A-refresh");
        expect(shared.get("nolate_auth_invalid_session")).toBeUndefined();
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "loading",
        )).toBe(true);
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(false);

        sharedFence.resolve();
        await act(async () => {
            await signOutPromise;
        });
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(true);
    });

    test("두 extension fence가 실패하면 B gate를 닫고 retry 성공 뒤에만 연다", async () => {
        await renderAuthenticatedProvider();
        sharedAuth.setAppGroupSessionStateSync.mockReturnValue({
            success: false,
        });
        sharedAuth.setAppGroupSessionState.mockRejectedValue(
            new Error("app group unavailable"),
        );
        sharedAuth.setItem.mockImplementation(async (key, value) => {
            if (key === "nolate_auth_invalid_session") {
                throw new Error("shared keychain unavailable");
            }
            shared.set(key, value);
            return true;
        });
        const warning = jest.spyOn(console, "warn").mockImplementation();
        let firstAttempt!: Promise<boolean>;

        act(() => {
            firstAttempt = renderer?.root.findAllByType(Text).find(
                (node) => node.props.children === "sign-out",
            )?.props.onPress();
        });
        await act(async () => {
            await expect(firstAttempt).resolves.toBe(false);
        });

        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "account-exit-blocked",
        )).toBe(true);
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(false);
        const bLoginNetwork = jest.fn();
        await expect(waitForAuthSessionTransition({
            timeoutMs: 20,
        }).then(bLoginNetwork)).rejects.toMatchObject({
            code: "AUTH_SESSION_TRANSITION_PENDING",
        });
        expect(bLoginNetwork).not.toHaveBeenCalled();

        sharedAuth.setAppGroupSessionStateSync.mockImplementation((value) => {
            appGroupState = value;
            return { success: true };
        });
        sharedAuth.setAppGroupSessionState.mockImplementation(async (value) => {
            appGroupState = value;
            return true;
        });
        sharedAuth.setItem.mockImplementation(async (key, value) => {
            shared.set(key, value);
            return true;
        });
        const retryButton = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "account-exit-blocked",
        );
        await act(async () => {
            await retryButton?.props.onPress();
        });

        await expect(waitForAuthSessionTransition({
            timeoutMs: 100,
        }).then(bLoginNetwork)).resolves.toBeUndefined();
        expect(bLoginNetwork).toHaveBeenCalledTimes(1);
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(true);
        warning.mockRestore();
    });
});
