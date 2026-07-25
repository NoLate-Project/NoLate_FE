import React from "react";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    getMemberCurationStatus,
    logoutMember,
    tokenLoginMember,
} from "../src/api/member";
import { AuthProvider, useAuth } from "../src/modules/auth/AuthContext";
import {
    __resetAuthStorageInvalidSessionForTests,
    clearAuthTokens,
    getAccessToken,
    getAuthMember,
    getRefreshToken,
    saveAuthenticatedSession,
} from "../src/modules/auth/authStorage";
import { clearAccountScopedLocalData } from "../src/modules/auth/accountCleanup";
import { ApiResponseError } from "../src/api/response";
import {
    activateAuthSessionIfCurrent,
    beginAuthLoginSession,
    isAuthSessionActive,
    waitForAuthSessionTransition,
    waitForSocialAuthTransition,
} from "../src/modules/auth/authSessionEpoch";

jest.mock("expo-secure-store", () => ({
    deleteItemAsync: jest.fn(),
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
}));

jest.mock("expo-crypto", () => ({
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: jest.fn(async (_algorithm, value: string) =>
        `sha256:${value}`
    ),
}));

jest.mock("../src/api/member", () => ({
    getMemberCurationStatus: jest.fn(),
    logoutMember: jest.fn(),
    tokenLoginMember: jest.fn(),
}));

jest.mock("../src/modules/auth/accountCleanup", () => ({
    clearAccountScopedLocalData: jest.fn().mockResolvedValue(undefined),
}));

const mockedGetItemAsync = jest.mocked(SecureStore.getItemAsync);
const mockedDeleteItemAsync = jest.mocked(SecureStore.deleteItemAsync);
const mockedSetItemAsync = jest.mocked(SecureStore.setItemAsync);
const mockedGetMemberCurationStatus = jest.mocked(getMemberCurationStatus);
const mockedLogoutMember = jest.mocked(logoutMember);
const mockedTokenLoginMember = jest.mocked(tokenLoginMember);
const mockedClearAccountScopedLocalData = jest.mocked(clearAccountScopedLocalData);

function mockStoredSession(curationCompleted = false) {
    mockedGetItemAsync.mockImplementation(async (key) => {
        if (key === "nolte_access_token") return "access-token";
        if (key === "nolte_refresh_token") return "refresh-token";
        if (key === "nolate_auth_member") return JSON.stringify({
            id: 1,
            curationCompleted,
            authSessionIdentity: "sha256:refresh-token",
        });
        return null;
    });
}

function AuthState() {
    const { isAuthenticated, isCurationCompleted, isLoading } = useAuth();

    if (isLoading) {
        return <Text>loading</Text>;
    }

    const label = isAuthenticated
        ? isCurationCompleted ? "authenticated-complete" : "authenticated-incomplete"
        : "unauthenticated";
    return <Text>{label}</Text>;
}

function SignOutButton() {
    const { signOut } = useAuth();
    return <Text onPress={() => signOut()}>sign-out</Text>;
}

function RemoteCleanupSignOutButton({
    cleanup,
    scope = "naver",
}: {
    cleanup: () => Promise<void>;
    scope?: "authentication" | "naver";
}) {
    const { signOut } = useAuth();
    return (
        <Text onPress={() => signOut({
            remoteCleanup: cleanup,
            remoteScope: scope,
        })}>
            remote-cleanup-sign-out
        </Text>
    );
}

function SyncAuthenticationButton() {
    const { syncAuthentication } = useAuth();
    return (
        <Text onPress={() => syncAuthentication()}>
            sync-authentication
        </Text>
    );
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

describe("AuthProvider", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(async () => {
        await AsyncStorage.clear();
        __resetAuthStorageInvalidSessionForTests();
        const epoch = beginAuthLoginSession();
        activateAuthSessionIfCurrent(epoch);
        mockedGetMemberCurationStatus.mockResolvedValue({ curationCompleted: false });
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.clearAllMocks();
    });

    it("marks the user as unauthenticated when the access JWT is missing", async () => {
        mockedGetItemAsync.mockResolvedValue(null);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("unauthenticated");
    });

    it("marks the user as authenticated when the access JWT exists", async () => {
        mockStoredSession(false);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("authenticated-incomplete");
    });

    it("restores a valid refresh session when cached member metadata is missing", async () => {
        const values = new Map<string, string>([
            ["nolte_refresh_token", "refresh-token"],
        ]);
        mockedGetItemAsync.mockImplementation(async (key) =>
            values.get(key) ?? null
        );
        mockedSetItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });
        mockedTokenLoginMember.mockResolvedValue({
            id: 1,
            name: "복구 사용자",
            accessToken: "restored-access",
            refreshToken: "restored-refresh",
            curationCompleted: true,
        });
        mockedGetMemberCurationStatus.mockResolvedValue({ curationCompleted: true });

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(mockedTokenLoginMember).toHaveBeenCalledWith({ refreshToken: "refresh-token" });
        expect(renderer?.root.findByType(Text).props.children).toBe("authenticated-complete");
    });

    it("bootstrap transient tokenLogin failure retries the same prepared refresh in-process", async () => {
        const values = new Map<string, string>([
            ["nolte_refresh_token", "refresh-token"],
        ]);
        mockedGetItemAsync.mockImplementation(async (key) =>
            values.get(key) ?? null
        );
        mockedSetItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });
        mockedDeleteItemAsync.mockImplementation(async (key) => {
            values.delete(key);
        });
        mockedTokenLoginMember
            .mockRejectedValueOnce(new Error("temporary outage"))
            .mockResolvedValueOnce({
                id: 1,
                name: "복구 사용자",
                accessToken: "restored-access",
                refreshToken: "restored-refresh",
                curationCompleted: true,
            });
        mockedGetMemberCurationStatus.mockResolvedValue({
            curationCompleted: true,
        });

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <SyncAuthenticationButton />
                </AuthProvider>,
            );
        });

        expect(mockedTokenLoginMember).toHaveBeenCalledTimes(1);
        expect(values.get("nolte_refresh_token")).toBe("refresh-token");
        expect(mockedDeleteItemAsync).not.toHaveBeenCalledWith(
            "nolte_refresh_token",
        );
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(true);

        const retry = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "sync-authentication",
        );
        await act(async () => {
            await retry?.props.onPress();
        });

        expect(mockedTokenLoginMember).toHaveBeenCalledTimes(2);
        expect(mockedTokenLoginMember).toHaveBeenNthCalledWith(2, {
            refreshToken: "refresh-token",
        });
        expect(values.get("nolte_refresh_token")).toBe("restored-refresh");
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "authenticated-complete",
        )).toBe(true);
    });

    it("bootstrap definitive tokenLogin rejection clears the exact prepared session", async () => {
        const values = new Map<string, string>([
            ["nolte_refresh_token", "refresh-token"],
        ]);
        mockedGetItemAsync.mockImplementation(async (key) =>
            values.get(key) ?? null
        );
        mockedSetItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });
        mockedDeleteItemAsync.mockImplementation(async (key) => {
            values.delete(key);
        });
        mockedTokenLoginMember.mockRejectedValue(
            new ApiResponseError("expired", { status: 401 }),
        );

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>,
            );
        });

        expect(mockedTokenLoginMember).toHaveBeenCalledTimes(1);
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith(
            "nolte_refresh_token",
        );
        expect(values.has("nolte_refresh_token")).toBe(false);
        await expect(getRefreshToken()).resolves.toBeNull();
        expect(renderer?.root.findByType(Text).props.children)
            .toBe("unauthenticated");
    });

    it("uses the server curation state after authentication", async () => {
        mockStoredSession(false);
        mockedGetMemberCurationStatus.mockResolvedValue({ curationCompleted: true });

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("authenticated-complete");
    });

    it("keeps the last completed state while the status API is offline", async () => {
        mockedGetItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_access_token") return "access-token";
            if (key === "nolte_refresh_token") return "refresh-token";
            if (key === "nolate_auth_member") return JSON.stringify({
                id: 1,
                curationCompleted: true,
                authSessionIdentity: "sha256:refresh-token",
            });
            return null;
        });
        mockedGetMemberCurationStatus.mockRejectedValue(new Error("offline"));

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("authenticated-complete");
    });

    it("로그아웃하면 서버 토큰 폐기를 시도하고 로컬 토큰을 지운다", async () => {
        mockedGetItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_access_token") return "access-token";
            if (key === "nolte_refresh_token") return "refresh-token";
            return null;
        });
        mockedLogoutMember.mockResolvedValue(undefined);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <SignOutButton />
                </AuthProvider>
            );
        });

        await act(async () => {
            await renderer?.root.findByType(Text).props.onPress();
        });

        expect(mockedLogoutMember).toHaveBeenCalledWith({ refreshToken: "refresh-token" });
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_access_token");
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_refresh_token");
        expect(mockedClearAccountScopedLocalData).toHaveBeenCalled();
    });

    it.each(["resolve", "reject"] as const)(
        "logoutMember가 %s 대기 중이어도 UI/fence와 local privacy cleanup을 즉시 닫는다",
        async (settlement) => {
            mockStoredSession(true);
            const logoutResponse = deferred<void>();
            mockedLogoutMember.mockReturnValue(logoutResponse.promise);

            await act(async () => {
                renderer = TestRenderer.create(
                    <AuthProvider>
                        <AuthState />
                        <SignOutButton />
                    </AuthProvider>,
                );
            });
            mockedClearAccountScopedLocalData.mockClear();
            let signOutPromise!: Promise<boolean>;
            const button = renderer?.root.findAllByType(Text).find(
                (node) => node.props.children === "sign-out",
            );
            act(() => {
                signOutPromise = button?.props.onPress();
            });
            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(isAuthSessionActive()).toBe(false);
            expect(renderer?.root.findAllByType(Text).some(
                (node) => node.props.children === "unauthenticated",
            )).toBe(true);
            expect(mockedClearAccountScopedLocalData).toHaveBeenCalled();
            expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_access_token");
            expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_refresh_token");
            expect(mockedLogoutMember).toHaveBeenCalledTimes(1);

            if (settlement === "resolve") logoutResponse.resolve();
            else logoutResponse.reject(new Error("offline"));
            await act(async () => {
                await signOutPromise;
            });
            expect(isAuthSessionActive()).toBe(false);
        },
    );

    it("local cleanup 뒤에는 old compare-and-logout 응답을 기다리지 않고 B 인증을 시작한다", async () => {
        mockStoredSession(true);
        const logoutResponse = deferred<void>();
        mockedLogoutMember.mockReturnValue(logoutResponse.promise);
        const bLoginNetwork = jest.fn(async () => "B-session");

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <SignOutButton />
                </AuthProvider>,
            );
        });
        const button = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "sign-out",
        );
        let signOutPromise!: Promise<boolean>;
        act(() => {
            signOutPromise = button?.props.onPress();
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
        const bLogin = waitForAuthSessionTransition({
            timeoutMs: 10_000,
        }).then(bLoginNetwork);
        await expect(bLogin).resolves.toBe("B-session");
        expect(bLoginNetwork).toHaveBeenCalledTimes(1);
        expect(mockedLogoutMember).toHaveBeenCalledWith({
            refreshToken: "refresh-token",
        });

        logoutResponse.resolve();
        await act(async () => {
            await signOutPromise;
        });
    });

    it("social SDK cleanup이 지연돼도 호출 즉시 protected state와 push fence를 닫는다", async () => {
        mockStoredSession(true);
        const cleanup = deferred<void>();
        mockedLogoutMember.mockResolvedValue(undefined);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <RemoteCleanupSignOutButton
                        cleanup={() => cleanup.promise}
                    />
                </AuthProvider>,
            );
        });
        mockedClearAccountScopedLocalData.mockClear();
        const button = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "remote-cleanup-sign-out",
        );
        let signOutPromise!: Promise<boolean>;
        act(() => {
            signOutPromise = button?.props.onPress();
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(isAuthSessionActive()).toBe(false);
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(true);
        expect(mockedClearAccountScopedLocalData).toHaveBeenCalledTimes(1);
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_access_token");
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_refresh_token");
        expect(mockedLogoutMember).not.toHaveBeenCalled();
        const sameProviderLogin = waitForSocialAuthTransition("naver", {
            timeoutMs: 10_000,
        });
        let providerGateSettled = false;
        sameProviderLogin.then(() => {
            providerGateSettled = true;
        });
        await Promise.resolve();
        expect(providerGateSettled).toBe(false);
        await expect(waitForAuthSessionTransition({
            timeoutMs: 1_000,
        })).resolves.toBeUndefined();

        cleanup.resolve();
        await act(async () => {
            await signOutPromise;
        });
        await expect(sameProviderLogin).resolves.toBeUndefined();
        expect(mockedLogoutMember).toHaveBeenCalledWith({
            refreshToken: "refresh-token",
        });
    });

    it.each(["resolve", "reject"] as const)(
        "A withdrawal이 %s된 뒤 시작한 B는 늦은 A server continuation에도 보존된다",
        async (settlement) => {
            const values = new Map<string, string>([
                ["nolte_access_token", "A-access"],
                ["nolte_refresh_token", "A-refresh"],
                ["nolate_auth_member", JSON.stringify({
                    id: 1,
                    name: "A",
                    curationCompleted: true,
                })],
            ]);
            mockedGetItemAsync.mockImplementation(async (key) =>
                values.get(key) ?? null
            );
            mockedSetItemAsync.mockImplementation(async (key, value) => {
                values.set(key, value);
            });
            mockedDeleteItemAsync.mockImplementation(async (key) => {
                values.delete(key);
            });
            const withdrawal = deferred<void>();
            const serverLogout = deferred<void>();
            mockedLogoutMember.mockReturnValue(serverLogout.promise);

            await act(async () => {
                renderer = TestRenderer.create(
                    <AuthProvider>
                        <AuthState />
                        <RemoteCleanupSignOutButton
                            cleanup={() => withdrawal.promise}
                            scope="authentication"
                        />
                    </AuthProvider>,
                );
            });
            let signOutPromise!: Promise<boolean>;
            act(() => {
                signOutPromise = renderer?.root.findAllByType(Text).find(
                    (node) =>
                        node.props.children === "remote-cleanup-sign-out",
                )?.props.onPress();
            });
            const bAuthentication = waitForAuthSessionTransition({
                timeoutMs: 10_000,
            }).then(async () => {
                await saveAuthenticatedSession({
                    id: 2,
                    name: "B",
                    accessToken: "B-access",
                    refreshToken: "B-refresh",
                });
            });
            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });
            expect(values.get("nolte_access_token")).toBeUndefined();

            if (settlement === "resolve") withdrawal.resolve();
            else withdrawal.reject(new Error("withdrawal failed"));
            await act(async () => {
                await bAuthentication;
            });
            expect(values.get("nolte_access_token")).toBe("B-access");
            expect(values.get("nolte_refresh_token")).toBe("B-refresh");

            serverLogout.resolve();
            await act(async () => {
                await signOutPromise;
            });
            expect(values.get("nolte_access_token")).toBe("B-access");
            expect(values.get("nolte_refresh_token")).toBe("B-refresh");
            expect(JSON.parse(values.get("nolate_auth_member")!))
                .toMatchObject({ id: 2, name: "B" });
        },
    );

    it("bootstrap tokenLogin이 storage invalidation 뒤 끝나도 A token/member를 복원하지 않는다", async () => {
        mockedGetItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_refresh_token") return "A-refresh";
            return null;
        });
        const tokenLoginResponse = deferred<{
            id: number;
            accessToken: string;
            refreshToken: string;
        }>();
        mockedTokenLoginMember.mockReturnValue(tokenLoginResponse.promise);

        act(() => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>,
            );
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mockedTokenLoginMember).toHaveBeenCalledTimes(1);

        await act(async () => {
            await clearAuthTokens();
        });
        tokenLoginResponse.resolve({
            id: 1,
            accessToken: "late-A-access",
            refreshToken: "late-A-refresh",
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockedSetItemAsync).not.toHaveBeenCalledWith(
            "nolte_access_token",
            "late-A-access",
        );
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(true);
    });

    it("late definitive A restore가 B session을 조건부 clear 실패 뒤 지우지 않는다", async () => {
        const values = new Map<string, string>([
            ["nolte_refresh_token", "A-refresh"],
        ]);
        mockedGetItemAsync.mockImplementation(async (key) =>
            values.get(key) ?? null
        );
        mockedSetItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });
        mockedDeleteItemAsync.mockImplementation(async (key) => {
            values.delete(key);
        });
        const aRestore = deferred<never>();
        mockedTokenLoginMember.mockReturnValue(aRestore.promise);

        act(() => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <SyncAuthenticationButton />
                </AuthProvider>,
            );
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mockedTokenLoginMember).toHaveBeenCalledTimes(1);

        await saveAuthenticatedSession({
            id: 2,
            name: "B",
            accessToken: "B-access",
            refreshToken: "B-refresh",
        });
        aRestore.reject(new ApiResponseError("expired A", { status: 401 }));
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(await getAccessToken()).toBe("B-access");
        expect(await getRefreshToken()).toBe("B-refresh");
        expect(await getAuthMember()).toMatchObject({ id: 2, name: "B" });
        const syncButton = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "sync-authentication",
        );
        await act(async () => {
            await syncButton?.props.onPress();
        });
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "authenticated-incomplete",
        )).toBe(true);
    });

    it.each([
        "nolte_access_token",
        "nolte_refresh_token",
        "nolate_auth_member",
    ])("logout snapshot에서 %s read가 실패해도 모든 local credential을 삭제한다", async (failingKey) => {
        mockStoredSession(true);
        mockedLogoutMember.mockResolvedValue(undefined);
        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <SignOutButton />
                </AuthProvider>,
            );
        });
        mockedGetItemAsync.mockImplementation(async (key) => {
            if (key === failingKey) throw new Error("secure storage read failed");
            if (key === "nolte_access_token") return "access-token";
            if (key === "nolte_refresh_token") return "refresh-token";
            if (key === "nolate_auth_member") {
                return JSON.stringify({ id: 1, curationCompleted: true });
            }
            return null;
        });

        await act(async () => {
            await renderer?.root.findAllByType(Text).find(
                (node) => node.props.children === "sign-out",
            )?.props.onPress();
        });

        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_access_token");
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_refresh_token");
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolate_auth_member");
        expect(isAuthSessionActive()).toBe(false);
        await expect(waitForAuthSessionTransition({
            timeoutMs: 1_000,
        })).resolves.toBeUndefined();
    });

    it("credential delete 실패는 signOut false와 durable cold-bootstrap 차단으로 보고된다", async () => {
        const values = new Map<string, string>([
            ["nolte_access_token", "A-access"],
            ["nolte_refresh_token", "A-refresh"],
            ["nolate_auth_member", JSON.stringify({ id: 1, name: "A" })],
        ]);
        mockedGetItemAsync.mockImplementation(async (key) =>
            values.get(key) ?? null
        );
        mockedSetItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });
        mockedDeleteItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_refresh_token") {
                throw new Error("refresh deletion failed");
            }
            values.delete(key);
        });
        mockedLogoutMember.mockResolvedValue(undefined);
        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <SignOutButton />
                </AuthProvider>,
            );
        });

        let cleared!: boolean;
        await act(async () => {
            cleared = await renderer?.root.findAllByType(Text).find(
                (node) => node.props.children === "sign-out",
            )?.props.onPress();
        });
        expect(cleared).toBe(false);
        expect(values.get("nolte_refresh_token")).toBe("A-refresh");
        expect(renderer?.root.findAllByType(Text).some(
            (node) => node.props.children === "unauthenticated",
        )).toBe(true);

        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        __resetAuthStorageInvalidSessionForTests();
        mockedTokenLoginMember.mockClear();
        let coldRenderer!: ReactTestRenderer;
        await act(async () => {
            coldRenderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>,
            );
        });
        renderer = coldRenderer;
        expect(mockedTokenLoginMember).not.toHaveBeenCalled();
        expect(coldRenderer.root.findByType(Text).props.children)
            .toBe("unauthenticated");
    });

    it("snapshot read 실패와 cleanup 지연이 겹쳐도 B 인증/저장을 cleanup보다 먼저 열지 않는다", async () => {
        const values = new Map<string, string>([
            ["nolte_access_token", "A-access"],
            ["nolte_refresh_token", "A-refresh"],
            ["nolate_auth_member", JSON.stringify({ id: 1, name: "A" })],
        ]);
        mockedGetItemAsync.mockImplementation(async (key) =>
            values.get(key) ?? null
        );
        mockedSetItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });
        mockedDeleteItemAsync.mockImplementation(async (key) => {
            values.delete(key);
        });
        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <SignOutButton />
                </AuthProvider>,
            );
        });

        const cleanup = deferred<void>();
        mockedClearAccountScopedLocalData.mockReturnValueOnce(cleanup.promise);
        mockedGetItemAsync.mockImplementation(async () => {
            throw new Error("snapshot unavailable");
        });
        const button = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "sign-out",
        );
        let signOutPromise!: Promise<boolean>;
        act(() => {
            signOutPromise = button?.props.onPress();
        });
        const bAuthentication = waitForAuthSessionTransition({
            timeoutMs: 10_000,
        }).then(async () => {
            await saveAuthenticatedSession({
                id: 2,
                name: "B",
                accessToken: "B-access",
                refreshToken: "B-refresh",
            });
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(values.get("nolte_access_token")).toBeUndefined();
        expect(mockedSetItemAsync).not.toHaveBeenCalledWith(
            "nolte_access_token",
            "B-access",
        );

        mockedGetItemAsync.mockImplementation(async (key) =>
            values.get(key) ?? null
        );
        cleanup.resolve();
        await act(async () => {
            await signOutPromise;
            await bAuthentication;
        });
        expect(values.get("nolte_access_token")).toBe("B-access");
        expect(values.get("nolte_refresh_token")).toBe("B-refresh");
        expect(JSON.parse(values.get("nolate_auth_member")!)).toMatchObject({
            id: 2,
        });
    });

    it("인증 인터셉터가 세션을 무효화해도 계정별 캐시를 정리한다", async () => {
        mockStoredSession(true);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });
        mockedClearAccountScopedLocalData.mockClear();

        await act(async () => {
            await clearAuthTokens();
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("unauthenticated");
        expect(mockedClearAccountScopedLocalData).toHaveBeenCalledTimes(1);
    });

    it("로그아웃 뒤 늦게 끝난 이전 인증 조회가 세션을 다시 켜지 않는다", async () => {
        mockStoredSession(true);
        let resolveCurationStatus: ((value: { curationCompleted: boolean }) => void) | undefined;
        mockedGetMemberCurationStatus.mockImplementation(() => new Promise((resolve) => {
            resolveCurationStatus = resolve;
        }));

        act(() => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <SignOutButton />
                </AuthProvider>
            );
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mockedGetMemberCurationStatus).toHaveBeenCalledTimes(1);

        const signOut = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "sign-out",
        );
        await act(async () => {
            await signOut?.props.onPress();
        });
        await act(async () => {
            resolveCurationStatus?.({ curationCompleted: true });
            await Promise.resolve();
        });

        const state = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "unauthenticated",
        );
        expect(state).toBeDefined();
    });
});
import {
    createPendingPushNavigationQueue,
    createScheduleDetailRoute,
    getNotificationActionCategoryFromData,
    getScheduleDetailRouteFromNotificationData,
    getPushNavigationTargetFromNotificationData,
    getScheduleIdFromNotificationData,
    isAccountBoundPushNavigationIntentCurrent,
    isPushNavigationReady,
    SCHEDULE_DEPARTURE_ACTION_CATEGORY,
} from "../src/modules/notification/pushNavigation";
import * as env from "../src/api/env";

describe("schedule push navigation payload", () => {
    beforeEach(() => {
        jest.spyOn(env, "getEnv").mockReturnValue("true");
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("인증과 온보딩이 끝날 때까지 알림 목적지를 보존한 뒤 한 번만 꺼낸다", () => {
        const queue = createPendingPushNavigationQueue();
        const intent = {
            target: { kind: "scheduleDetail" as const, scheduleId: "42" },
            logicalEventKey: "logical:event-a",
            recipientMemberId: 1,
            validationEpoch: 7,
        };
        queue.defer(intent);

        expect(queue.consumeIfReady({
            isLoading: true,
            isAuthenticated: false,
            isCurationCompleted: false,
        })).toBeUndefined();
        expect(queue.peek()).toEqual(intent);
        expect(queue.consumeIfReady({
            isLoading: false,
            isAuthenticated: true,
            isCurationCompleted: false,
        })).toBeUndefined();
        expect(queue.consumeIfReady({
            isLoading: false,
            isAuthenticated: true,
            isCurationCompleted: true,
        })).toEqual(intent);
        expect(queue.peek()).toBeUndefined();
    });

    test("auth session cleanup은 navigator-ready 대기 intent를 즉시 비운다", () => {
        const queue = createPendingPushNavigationQueue();
        queue.defer({
            target: { kind: "scheduleDetail", scheduleId: "42" },
            logicalEventKey: "logical:event-a",
            recipientMemberId: 1,
            validationEpoch: 7,
        });

        queue.clear();

        expect(queue.peek()).toBeUndefined();
        expect(queue.consumeIfReady({
            isLoading: false,
            isAuthenticated: true,
            isCurationCompleted: true,
        })).toBeUndefined();
    });

    test("대기 중 A 알림 intent는 B 계정 전환 뒤 실행 시점 검증을 통과하지 못한다", () => {
        const intent = {
            target: { kind: "scheduleDetail" as const, scheduleId: "42" },
            logicalEventKey: "logical:event-a",
            recipientMemberId: 1,
            validationEpoch: 7,
        };
        expect(isAccountBoundPushNavigationIntentCurrent(intent, {
            authEpoch: 7,
            memberId: 1,
        })).toBe(true);
        expect(isAccountBoundPushNavigationIntentCurrent(intent, {
            authEpoch: 8,
            memberId: 2,
        })).toBe(false);
        expect(isAccountBoundPushNavigationIntentCurrent(intent, {
            authEpoch: 7,
            memberId: 2,
        })).toBe(false);
    });

    test("보호된 화면은 인증·온보딩 완료 상태에서만 푸시 이동 준비가 된다", () => {
        expect(isPushNavigationReady({
            isLoading: false,
            isAuthenticated: true,
            isCurationCompleted: true,
        })).toBe(true);
        expect(isPushNavigationReady({
            isLoading: false,
            isAuthenticated: false,
            isCurationCompleted: true,
        })).toBe(false);
    });

    test("Android와 iOS가 공유하는 문자열 scheduleId를 반환한다", () => {
        expect(getScheduleIdFromNotificationData({ scheduleId: "42" })).toBe("42");
    });

    test("앞뒤 공백을 제거해 동일 일정으로 이동한다", () => {
        expect(getScheduleIdFromNotificationData({ scheduleId: "  42  " })).toBe("42");
    });

    test.each([
        undefined,
        {},
        { scheduleId: "" },
        { scheduleId: "   " },
        { scheduleId: "0" },
        { scheduleId: "-1" },
        { scheduleId: 42 },
        { scheduleId: null },
    ])("잘못된 payload에서는 화면 이동을 하지 않는다: %p", (data) => {
        expect(getScheduleIdFromNotificationData(data as Record<string, unknown> | undefined)).toBeUndefined();
    });

    test.each([
        "SCHEDULE_TRAFFIC",
        "SCHEDULE_DEPARTURE_REMINDER",
        "SCHEDULE_DETAIL",
        "SCHEDULE_SHARE_RECEIVED",
        "SCHEDULE_PARTICIPANT_DEPARTED",
        "SCHEDULE_DEPARTURE_NUDGE",
        "ROUTE_SETUP_REMINDER",
        undefined,
    ])("일정 상세 이동 payload를 해석한다: %p", (type) => {
        expect(getPushNavigationTargetFromNotificationData({ type, scheduleId: "42" })).toEqual({
            kind: "scheduleDetail",
            scheduleId: "42",
        });
    });

    test.each([
        { type: "CATEGORY_SHARE_RECEIVED", categoryId: "7" },
        { type: "CALENDAR_SHARE_RECEIVED", calendarId: "9" },
    ])("카테고리와 캘린더 공유 알림은 공유함으로 이동한다: %p", (data) => {
        expect(getPushNavigationTargetFromNotificationData({
            ...data,
        })).toEqual({
            kind: "shareInbox",
        });
    });

    test.each([
        { type: "PUSH_SCENARIO_TOKEN_CHECK" },
        { type: "UNKNOWN", scheduleId: "42" },
        { type: "SCHEDULE_TRAFFIC", scheduleId: "0" },
        { type: "SCHEDULE_DETAIL" },
    ])("이동 대상이 아닌 payload는 무시한다: %p", (data) => {
        expect(getPushNavigationTargetFromNotificationData(data)).toBeUndefined();
    });

    test("일정 상세 route를 생성한다", () => {
        expect(createScheduleDetailRoute("42")).toEqual({
            pathname: "/schedule/[id]",
            params: { id: "42" },
        });
    });

    test("알림 payload에서 일정 상세 route를 생성한다", () => {
        expect(getScheduleDetailRouteFromNotificationData({
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "42",
        })).toEqual({
            pathname: "/schedule/[id]",
            params: { id: "42" },
        });
    });

    test.each([
        { type: "SCHEDULE_DEPARTURE_REMINDER", scheduleId: "42", departNow: "false" },
        { type: "SCHEDULE_DEPARTURE_REMINDER", scheduleId: "42", departNow: "true" },
    ])("출발 리마인더에는 알림 액션 카테고리를 붙인다: %p", (data) => {
        expect(getNotificationActionCategoryFromData(data)).toBe(SCHEDULE_DEPARTURE_ACTION_CATEGORY);
    });

    test.each([
        { type: "SCHEDULE_TRAFFIC", scheduleId: "42" },
        { type: "SCHEDULE_PARTICIPANT_DEPARTED", scheduleId: "42" },
        { type: "SCHEDULE_DEPARTURE_NUDGE", scheduleId: "42" },
        { type: "SCHEDULE_DEPARTURE_REMINDER", scheduleId: "0" },
        { type: "SCHEDULE_DEPARTURE_REMINDER" },
    ])("출발 리마인더가 아니면 알림 액션 카테고리를 붙이지 않는다: %p", (data) => {
        expect(getNotificationActionCategoryFromData(data)).toBeUndefined();
    });
});
