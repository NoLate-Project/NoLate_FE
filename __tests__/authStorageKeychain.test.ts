jest.mock("react-native", () => {
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

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalStorage from "../src/modules/storage/secureStorage";
import { NativeModules } from "react-native";
import { createAuthEpochAbortController } from "../src/modules/auth/authEpochAbortController";
import {
    __resetAuthSessionTransitionsForTests,
    registerAuthSessionTransitionBarrier,
    waitForAuthSessionTransition,
} from "../src/modules/auth/authSessionEpoch";

import {
    __resetAuthStorageInvalidSessionForTests,
    beginAuthLogoutIntent,
    captureAuthRestoreContext,
    clearAuthTokens,
    clearAuthTokensIfCurrent,
    clearRestorableAuthSessionIfCurrent,
    configureSharedAuthApiBaseUrl,
    getAccessToken,
    getAuthMember,
    getAuthSessionEpoch,
    getRefreshToken,
    isAuthRefreshContextCurrent,
    prepareExplicitAuthenticationRequest,
    saveAuthenticatedSession,
    saveRefreshedAuthTokensIfCurrent,
    saveAuthCurationCompletedForSession,
    subscribeAuthInvalidation,
} from "../src/modules/auth/authStorage";
import {
    restoreAuthSessionIfCurrent,
} from "../src/modules/auth/conditionalAuthRestore";

const mockSharedAuth = NativeModules.NoLateShareAuth as {
    getItem: jest.Mock<Promise<string | null>, [string]>;
    setItem: jest.Mock<Promise<boolean>, [string, string]>;
    deleteItem: jest.Mock<Promise<boolean>, [string]>;
    getAppGroupSessionState: jest.Mock<Promise<string | null>, []>;
    setAppGroupSessionState: jest.Mock<Promise<boolean>, [string]>;
    setAppGroupSessionStateSync: jest.Mock<
        {
            success: boolean;
            status?: "success" | "mismatch" | "partial" | "failure";
            mismatch?: boolean;
            currentValue?: string | null;
            rollbackSucceeded?: boolean;
        },
        [string]
    >;
    beginAppGroupSessionTransitionSync: jest.Mock<
        {
            success: boolean;
            status?: "success" | "mismatch" | "partial" | "failure";
            mismatch?: boolean;
            currentValue?: string | null;
            rollbackSucceeded?: boolean;
        },
        [string]
    >;
    compareAndSetAppGroupSessionStateSync: jest.Mock<
        {
            success: boolean;
            status?: "success" | "mismatch" | "partial" | "failure";
            mismatch?: boolean;
            currentValue?: string | null;
            rollbackSucceeded?: boolean;
        },
        [string, string]
    >;
};

const mockLocalStorage = {
    getItemAsync: jest.mocked(LocalStorage.getItemAsync),
    setItemAsync: jest.mocked(LocalStorage.setItemAsync),
    deleteItemAsync: jest.mocked(LocalStorage.deleteItemAsync),
};

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

async function saveTestSession(
    accessToken: string,
    refreshToken: string,
    member: { id: number; name?: string; curationCompleted?: boolean },
) {
    await saveAuthenticatedSession({
        ...member,
        accessToken,
        refreshToken,
    });
}

function installMemoryAuthStores(options: {
    secure?: Record<string, string>;
    shared?: Record<string, string>;
} = {}) {
    const secure = new Map(Object.entries(options.secure ?? {}));
    const shared = new Map(Object.entries(options.shared ?? {}));
    let appGroupSessionState: string | null = null;
    mockSharedAuth.getItem.mockImplementation(async (key) => shared.get(key) ?? null);
    mockSharedAuth.setItem.mockImplementation(async (key, value) => {
        shared.set(key, value);
        return true;
    });
    mockSharedAuth.deleteItem.mockImplementation(async (key) => {
        shared.delete(key);
        return true;
    });
    mockSharedAuth.getAppGroupSessionState.mockImplementation(
        async () => appGroupSessionState,
    );
    mockSharedAuth.setAppGroupSessionState.mockImplementation(
        async (value) => {
            appGroupSessionState = value;
            return true;
        },
    );
    mockSharedAuth.setAppGroupSessionStateSync.mockImplementation((value) => {
        appGroupSessionState = value;
        return { success: true };
    });
    mockSharedAuth.beginAppGroupSessionTransitionSync.mockImplementation(
        (stagingValue) => {
            if (
                appGroupSessionState?.startsWith("staging:") ||
                appGroupSessionState?.startsWith("publishing:")
            ) {
                return {
                    success: false,
                    status: "mismatch",
                    mismatch: true,
                    currentValue: appGroupSessionState,
                };
            }
            appGroupSessionState = stagingValue;
            return { success: true, status: "success" };
        },
    );
    mockSharedAuth.compareAndSetAppGroupSessionStateSync.mockImplementation(
        (expectedValue, value) => {
            if (appGroupSessionState !== expectedValue) {
                return { success: false, mismatch: true };
            }
            appGroupSessionState = value;
            return { success: true };
        },
    );
    mockLocalStorage.getItemAsync.mockImplementation(async (key) => secure.get(key) ?? null);
    mockLocalStorage.setItemAsync.mockImplementation(async (key, value) => {
        secure.set(key, value);
    });
    mockLocalStorage.deleteItemAsync.mockImplementation(async (key) => {
        secure.delete(key);
    });
    return {
        secure,
        shared,
        get appGroupSessionState() {
            return appGroupSessionState;
        },
        setAppGroupSessionState(value: string | null) {
            appGroupSessionState = value;
        },
    };
}

describe("authStorage shared Keychain session", () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        __resetAuthSessionTransitionsForTests();
        __resetAuthStorageInvalidSessionForTests();
        jest.clearAllMocks();
        configureSharedAuthApiBaseUrl("http://127.0.0.1:5522");
        mockSharedAuth.getItem.mockResolvedValue(null);
        mockSharedAuth.setItem.mockResolvedValue(true);
        mockSharedAuth.deleteItem.mockResolvedValue(true);
        mockSharedAuth.getAppGroupSessionState.mockResolvedValue(null);
        mockSharedAuth.setAppGroupSessionState.mockResolvedValue(true);
        mockSharedAuth.setAppGroupSessionStateSync.mockReturnValue({
            success: true,
        });
        mockSharedAuth.beginAppGroupSessionTransitionSync.mockReturnValue({
            success: true,
            status: "success",
        });
        mockSharedAuth.compareAndSetAppGroupSessionStateSync.mockReturnValue({
            success: true,
        });
        mockLocalStorage.getItemAsync.mockResolvedValue(null);
        mockLocalStorage.setItemAsync.mockResolvedValue(undefined);
        mockLocalStorage.deleteItemAsync.mockResolvedValue(undefined);
    });

    test("cold BOOTSTRAPPING session은 remote curation을 조건부 저장해 다음 offline bootstrap에 유지한다", async () => {
        const serializedMember = JSON.stringify({
            id: 1,
            name: "A",
            curationCompleted: false,
            authSessionIdentity: "sha256:A-refresh",
        });
        const stores = installMemoryAuthStores({
            secure: {
                nolte_refresh_token: "A-refresh",
                nolate_auth_member: serializedMember,
            },
            shared: {
                nolte_refresh_token: "A-refresh",
                nolate_auth_member: serializedMember,
            },
        });
        const bootstrapEpoch = getAuthSessionEpoch();

        await expect(saveAuthCurationCompletedForSession({
            curationCompleted: true,
            expectedEpoch: bootstrapEpoch,
            expectedRefreshToken: "A-refresh",
            expectedMemberId: 1,
        })).resolves.toBe(true);

        expect(JSON.parse(stores.secure.get("nolate_auth_member")!))
            .toMatchObject({ id: 1, curationCompleted: true });
        expect(JSON.parse(stores.shared.get("nolate_auth_member")!))
            .toMatchObject({ id: 1, curationCompleted: true });
        await expect(getAuthMember()).resolves.toMatchObject({
            id: 1,
            curationCompleted: true,
        });
    });

    test("로그인 토큰과 현재 API 서버를 공유 Keychain에 저장한다", async () => {
        installMemoryAuthStores();
        await saveTestSession(
            "access-token",
            "refresh-token",
            { id: 1, name: "member" },
        );

        expect(mockSharedAuth.setItem).toHaveBeenCalledWith("nolte_access_token", "access-token");
        expect(mockSharedAuth.setItem).toHaveBeenCalledWith("nolte_refresh_token", "refresh-token");
        expect(mockSharedAuth.setItem).toHaveBeenCalledWith(
            "nolate_auth_api_base_url",
            "http://127.0.0.1:5522"
        );
        expect(mockLocalStorage.setItemAsync).toHaveBeenCalledWith("nolte_access_token", "access-token");
        expect(mockLocalStorage.setItemAsync).toHaveBeenCalledWith("nolte_refresh_token", "refresh-token");
    });

    test("SecureStore와 공유 Keychain token이 다르면 한쪽을 우선하지 않는다", async () => {
        mockSharedAuth.getItem.mockImplementation(async (key) =>
            key === "nolte_access_token" ? "shared-access" : null
        );
        mockLocalStorage.getItemAsync.mockResolvedValue("local-access");

        await expect(getAccessToken()).resolves.toBeNull();
        expect(mockLocalStorage.getItemAsync).toHaveBeenCalledWith("nolte_access_token");
    });

    test("기존 로컬 토큰을 공유 Keychain으로 이관한다", async () => {
        mockLocalStorage.getItemAsync.mockImplementation(async (key) =>
            key === "nolte_refresh_token" ? "legacy-refresh" : null
        );

        await expect(getRefreshToken()).resolves.toBe("legacy-refresh");
        expect(mockSharedAuth.setItem).toHaveBeenCalledWith("nolte_refresh_token", "legacy-refresh");
        expect(mockSharedAuth.setItem).toHaveBeenCalledWith(
            "nolate_auth_api_base_url",
            "http://127.0.0.1:5522"
        );
    });

    test("same-epoch member migration은 기존처럼 shared Keychain을 정상 보정한다", async () => {
        const serialized = JSON.stringify({
            id: 7,
            name: "migration",
            authSessionIdentity: "sha256:legacy-refresh",
        });
        const stores = installMemoryAuthStores({
            secure: {
                nolte_refresh_token: "legacy-refresh",
                nolate_auth_member: serialized,
            },
            shared: {
                nolte_refresh_token: "legacy-refresh",
            },
        });

        await expect(getAuthMember()).resolves.toEqual({ id: 7, name: "migration" });
        expect(stores.shared.get("nolate_auth_member")).toBe(serialized);
    });

    test("로그아웃 시 공유 토큰과 API 서버 정보를 모두 지운다", async () => {
        await clearAuthTokens();

        expect(mockSharedAuth.deleteItem).toHaveBeenCalledWith("nolte_access_token");
        expect(mockSharedAuth.deleteItem).toHaveBeenCalledWith("nolte_refresh_token");
        expect(mockSharedAuth.deleteItem).toHaveBeenCalledWith("nolate_auth_member");
        expect(mockSharedAuth.deleteItem).toHaveBeenCalledWith("nolate_auth_api_base_url");
    });

    test("한 저장소의 삭제가 실패해도 나머지 인증 정보 삭제를 모두 시도한다", async () => {
        mockLocalStorage.deleteItemAsync.mockRejectedValueOnce(new Error("keychain unavailable"));

        await expect(clearAuthTokens()).resolves.toBe(false);

        expect(mockLocalStorage.deleteItemAsync).toHaveBeenCalledWith("nolte_access_token");
        expect(mockLocalStorage.deleteItemAsync).toHaveBeenCalledWith("nolte_refresh_token");
        expect(mockLocalStorage.deleteItemAsync).toHaveBeenCalledWith("nolate_auth_member");
        expect(mockSharedAuth.deleteItem).toHaveBeenCalledWith("nolte_access_token");
        expect(mockSharedAuth.deleteItem).toHaveBeenCalledWith("nolte_refresh_token");
    });

    test.each([
        ["secure", "nolte_access_token"],
        ["secure", "nolte_refresh_token"],
        ["secure", "nolate_auth_member"],
        ["shared", "nolte_access_token"],
        ["shared", "nolte_refresh_token"],
        ["shared", "nolate_auth_member"],
    ] as const)(
        "%s %s 삭제 실패 뒤 cold bootstrap은 남은 A credential을 복원하지 않고 B login만 marker를 해제한다",
        async (storeKind, failingKey) => {
            const stores = installMemoryAuthStores({
                secure: {
                    nolte_access_token: "A-access",
                    nolte_refresh_token: "A-refresh",
                    nolate_auth_member: JSON.stringify({ id: 1, name: "A" }),
                },
                shared: {
                    nolte_access_token: "A-access",
                    nolte_refresh_token: "A-refresh",
                    nolate_auth_member: JSON.stringify({ id: 1, name: "A" }),
                },
            });
            if (storeKind === "secure") {
                mockLocalStorage.deleteItemAsync.mockImplementation(async (key) => {
                    if (key === failingKey) {
                        throw new Error("secure deletion unavailable");
                    }
                    stores.secure.delete(key);
                });
            } else {
                mockSharedAuth.deleteItem.mockImplementation(async (key) => {
                    if (key === failingKey) return false;
                    stores.shared.delete(key);
                    return true;
                });
            }

            await expect(clearAuthTokens({
                notifyListeners: false,
            })).resolves.toBe(false);
            expect(
                storeKind === "secure"
                    ? stores.secure.get(failingKey)
                    : stores.shared.get(failingKey),
            ).toBeDefined();

            // Simulate a fresh JS process: only the durable marker remains.
            __resetAuthStorageInvalidSessionForTests();
            const tokenLogin = jest.fn();
            const refreshToken = await getRefreshToken();
            if (refreshToken) tokenLogin(refreshToken);
            expect(refreshToken).toBeNull();
            expect(await getAccessToken()).toBeNull();
            expect(await getAuthMember()).toBeNull();
            expect(tokenLogin).not.toHaveBeenCalled();

            await saveTestSession(
                "B-access",
                "B-refresh",
                { id: 2, name: "B" },
            );
            expect(await getAccessToken()).toBe("B-access");
            expect(await getRefreshToken()).toBe("B-refresh");
            expect(await getAuthMember()).toMatchObject({ id: 2, name: "B" });
        },
    );

    test("SecureStore marker write가 실패해도 다른 durable marker가 stale credential restore를 차단한다", async () => {
        const stores = installMemoryAuthStores({
            secure: { nolte_refresh_token: "A-refresh" },
            shared: { nolte_refresh_token: "A-refresh" },
        });
        mockLocalStorage.setItemAsync.mockImplementation(async (key, value) => {
            if (key === "nolate_auth_invalid_session") {
                throw new Error("secure marker unavailable");
            }
            stores.secure.set(key, value);
        });
        mockLocalStorage.deleteItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_refresh_token") {
                throw new Error("stale refresh remains");
            }
            stores.secure.delete(key);
        });

        await expect(clearAuthTokens({
            notifyListeners: false,
        })).resolves.toBe(false);
        expect(stores.secure.get("nolte_refresh_token")).toBe("A-refresh");
        __resetAuthStorageInvalidSessionForTests();
        expect(await getRefreshToken()).toBeNull();
    });

    test("B shared credential 저장이 일부 실패하면 marker를 유지하고 완전한 재시도 뒤에만 연다", async () => {
        const stores = installMemoryAuthStores({
            secure: { nolte_refresh_token: "A-refresh" },
            shared: { nolte_refresh_token: "A-refresh" },
        });
        await expect(clearAuthTokens({
            notifyListeners: false,
        })).resolves.toBe(true);
        mockSharedAuth.setItem.mockImplementation(async (key, value) => {
            if (
                key === "nolte_refresh_token" &&
                value === "B-refresh"
            ) throw new Error("shared refresh write failed");
            stores.shared.set(key, value);
            return true;
        });

        await expect(saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        )).rejects.toThrow("shared refresh write failed");
        __resetAuthStorageInvalidSessionForTests();
        expect(await getAccessToken()).toBeNull();
        expect(await getRefreshToken()).toBeNull();

        mockSharedAuth.setItem.mockImplementation(async (key, value) => {
            stores.shared.set(key, value);
            return true;
        });
        await saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        );
        expect(await getRefreshToken()).toBe("B-refresh");
        expect(await getAuthMember()).toMatchObject({ id: 2, name: "B" });
    });

    test("B marker 삭제가 일부 실패하면 새 token이 있어도 session을 열지 않는다", async () => {
        const stores = installMemoryAuthStores();
        await expect(clearAuthTokens({
            notifyListeners: false,
        })).resolves.toBe(true);
        mockSharedAuth.deleteItem.mockImplementation(async (key) => {
            if (key === "nolate_auth_invalid_session") return false;
            stores.shared.delete(key);
            return true;
        });

        await expect(saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        )).rejects.toThrow("공유 Keychain 삭제 실패");
        __resetAuthStorageInvalidSessionForTests();
        expect(await getRefreshToken()).toBeNull();
    });

    test.each([
        ["secure", "nolte_access_token"],
        ["secure", "nolte_refresh_token"],
        ["secure", "nolate_auth_member"],
        ["shared", "nolte_access_token"],
        ["shared", "nolte_refresh_token"],
        ["shared", "nolate_auth_member"],
    ] as const)(
        "fresh login의 %s %s strict write 실패는 staging marker를 유지하고 partial session을 노출하지 않는다",
        async (storeKind, failingKey) => {
            const stores = installMemoryAuthStores();
            if (storeKind === "secure") {
                mockLocalStorage.setItemAsync.mockImplementation(
                    async (key, value) => {
                        if (key === failingKey) {
                            throw new Error("secure session write failed");
                        }
                        stores.secure.set(key, value);
                    },
                );
            } else {
                mockSharedAuth.setItem.mockImplementation(
                    async (key, value) => {
                        if (key === failingKey) {
                            throw new Error("shared session write failed");
                        }
                        stores.shared.set(key, value);
                        return true;
                    },
                );
            }

            await expect(saveTestSession(
                "B-access",
                "B-refresh",
                { id: 2, name: "B" },
            )).rejects.toThrow(/session write failed/);

            expect(await AsyncStorage.getItem("nolate_auth_invalid_session"))
                .toBe("invalidated");
            expect(stores.appGroupSessionState).toBe("invalidated");
            __resetAuthStorageInvalidSessionForTests();
            const tokenLogin = jest.fn();
            const refreshToken = await getRefreshToken();
            if (refreshToken) tokenLogin(refreshToken);
            expect(refreshToken).toBeNull();
            expect(await getAccessToken()).toBeNull();
            expect(await getAuthMember()).toBeNull();
            expect(tokenLogin).not.toHaveBeenCalled();
        },
    );

    test.each(["secure", "shared"] as const)(
        "A %s member delete 실패 뒤 B member commit도 실패하면 B token+A member를 cold bootstrap이 결합하지 않는다",
        async (storeKind) => {
            const staleMember = JSON.stringify({
                id: 1,
                name: "A",
                authSessionIdentity: "sha256:A-refresh",
            });
            const stores = installMemoryAuthStores({
                secure: {
                    nolte_access_token: "A-access",
                    nolte_refresh_token: "A-refresh",
                    nolate_auth_member: staleMember,
                },
                shared: {
                    nolte_access_token: "A-access",
                    nolte_refresh_token: "A-refresh",
                    nolate_auth_member: staleMember,
                },
            });
            if (storeKind === "secure") {
                mockLocalStorage.deleteItemAsync.mockImplementation(
                    async (key) => {
                        if (key === "nolate_auth_member") {
                            throw new Error("A secure member delete failed");
                        }
                        stores.secure.delete(key);
                    },
                );
            } else {
                mockSharedAuth.deleteItem.mockImplementation(async (key) => {
                    if (key === "nolate_auth_member") return false;
                    stores.shared.delete(key);
                    return true;
                });
            }
            await expect(clearAuthTokens({
                notifyListeners: false,
            })).resolves.toBe(false);

            if (storeKind === "secure") {
                mockLocalStorage.setItemAsync.mockImplementation(
                    async (key, value) => {
                        if (key === "nolate_auth_member") {
                            throw new Error("B secure member write failed");
                        }
                        stores.secure.set(key, value);
                    },
                );
            } else {
                mockSharedAuth.setItem.mockImplementation(
                    async (key, value) => {
                        if (key === "nolate_auth_member") {
                            throw new Error("B shared member write failed");
                        }
                        stores.shared.set(key, value);
                        return true;
                    },
                );
            }
            await expect(saveTestSession(
                "B-access",
                "B-refresh",
                { id: 2, name: "B" },
            )).rejects.toThrow(/B .* member write failed/);

            __resetAuthStorageInvalidSessionForTests();
            const tokenLogin = jest.fn();
            const refreshToken = await getRefreshToken();
            if (refreshToken) tokenLogin(refreshToken);
            expect(refreshToken).toBeNull();
            expect(await getAuthMember()).toBeNull();
            expect(tokenLogin).not.toHaveBeenCalled();
            expect(
                storeKind === "secure"
                    ? stores.secure.get("nolate_auth_member")
                    : stores.shared.get("nolate_auth_member"),
            ).toBe(staleMember);
        },
    );

    test("token write와 member write 사이 process-kill 지점에서도 staging marker가 cold bootstrap을 차단한다", async () => {
        const stores = installMemoryAuthStores();
        const memberWriteStarted = deferred<void>();
        const failMemberWrite = deferred<void>();
        mockLocalStorage.setItemAsync.mockImplementation(async (key, value) => {
            if (key === "nolate_auth_member") {
                memberWriteStarted.resolve();
                await failMemberWrite.promise;
                throw new Error("simulated process interruption");
            }
            stores.secure.set(key, value);
        });

        const commit = saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        );
        await memberWriteStarted.promise;

        expect(stores.secure.get("nolte_access_token")).toBe("B-access");
        expect(stores.secure.get("nolte_refresh_token")).toBe("B-refresh");
        expect(stores.secure.get("nolate_auth_member")).toBeUndefined();
        expect(await AsyncStorage.getItem("nolate_auth_invalid_session"))
            .toBe("invalidated");
        expect(stores.appGroupSessionState).toMatch(
            /^publishing:\d+:sha256:B-refresh$/,
        );

        failMemberWrite.resolve();
        await expect(commit).rejects.toThrow("simulated process interruption");
        __resetAuthStorageInvalidSessionForTests();
        expect(await getRefreshToken()).toBeNull();
    });

    test("완전한 token+member commit 뒤에만 marker를 해제하고 App Group generation을 공개한다", async () => {
        const stores = installMemoryAuthStores();

        await saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        );

        expect(stores.secure.get("nolate_auth_invalid_session")).toBeUndefined();
        expect(stores.shared.get("nolate_auth_invalid_session")).toBeUndefined();
        expect(await AsyncStorage.getItem("nolate_auth_invalid_session"))
            .toBeNull();
        expect(stores.appGroupSessionState)
            .toBe("active:sha256:B-refresh");
        expect(JSON.parse(stores.secure.get("nolate_auth_member")!))
            .toMatchObject({
                id: 2,
                authSessionIdentity: "sha256:B-refresh",
            });
        expect(await getAuthMember()).toMatchObject({ id: 2, name: "B" });
    });

    test("CAS mismatch의 newer active B와 credential을 A 실패 정리가 손상하지 않는다", async () => {
        const stores = installMemoryAuthStores();
        const bMember = JSON.stringify({
            id: 2,
            name: "B",
            authSessionIdentity: "sha256:B-refresh",
        });
        mockSharedAuth.compareAndSetAppGroupSessionStateSync.mockImplementation(
            (expectedValue, nextValue) => {
                if (!nextValue.startsWith("publishing:")) {
                    throw new Error(
                        `unexpected final CAS ${expectedValue} -> ${nextValue}`,
                    );
                }
                // Model B becoming active after A acquired staging but before
                // A reserves credential publication. A must stop before any A
                // access/refresh/member row can overwrite B.
                stores.secure.set("nolte_access_token", "B-access");
                stores.secure.set("nolte_refresh_token", "B-refresh");
                stores.secure.set("nolate_auth_member", bMember);
                stores.shared.set("nolte_access_token", "B-access");
                stores.shared.set("nolte_refresh_token", "B-refresh");
                stores.shared.set("nolate_auth_member", bMember);
                stores.setAppGroupSessionState("active:sha256:B-refresh");
                return {
                    success: false,
                    status: "mismatch",
                    mismatch: true,
                    currentValue: "active:sha256:B-refresh",
                };
            },
        );
        mockSharedAuth.setAppGroupSessionStateSync.mockClear();

        await expect(saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        )).rejects.toThrow(
            "공유 확장 인증 세션이 더 새로운 세대로 변경되었습니다.",
        );

        expect(stores.appGroupSessionState)
            .toBe("active:sha256:B-refresh");
        expect(stores.secure.get("nolte_access_token")).toBe("B-access");
        expect(stores.secure.get("nolte_refresh_token")).toBe("B-refresh");
        expect(stores.secure.get("nolate_auth_member")).toBe(bMember);
        expect(stores.shared.get("nolte_access_token")).toBe("B-access");
        expect(stores.shared.get("nolte_refresh_token")).toBe("B-refresh");
        expect(stores.shared.get("nolate_auth_member")).toBe(bMember);
        expect(mockSharedAuth.setAppGroupSessionStateSync)
            .not.toHaveBeenCalled();
        expect(mockLocalStorage.setItemAsync).not.toHaveBeenCalledWith(
            "nolte_access_token",
            "A-access",
        );
        expect(mockSharedAuth.setItem).not.toHaveBeenCalledWith(
            "nolte_refresh_token",
            "A-refresh",
        );
    });

    test("A commit marker 제거 중 logout intent가 끼면 staging을 active로 공개하지 않는다", async () => {
        const stores = installMemoryAuthStores();
        const markerDeleteStarted = deferred<void>();
        const releaseMarkerDelete = deferred<void>();
        let delayedMarkerDelete = false;
        mockSharedAuth.deleteItem.mockImplementation(async (key) => {
            if (
                key === "nolate_auth_invalid_session" &&
                !delayedMarkerDelete
            ) {
                delayedMarkerDelete = true;
                markerDeleteStarted.resolve();
                await releaseMarkerDelete.promise;
            }
            stores.shared.delete(key);
            return true;
        });

        const lateACommit = saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        await markerDeleteStarted.promise;
        expect(stores.appGroupSessionState).toMatch(
            /^publishing:\d+:sha256:A-refresh$/,
        );

        const logoutIntent = beginAuthLogoutIntent();
        expect(stores.appGroupSessionState).toBe("invalidated");
        releaseMarkerDelete.resolve();

        await expect(lateACommit).rejects.toThrow(
            "인증 세션 소유권이 변경되었습니다.",
        );
        await expect(logoutIntent).resolves.toMatchObject({
            accessToken: null,
            refreshToken: null,
        });
        expect(
            mockSharedAuth.compareAndSetAppGroupSessionStateSync,
        ).toHaveBeenCalledTimes(1);
        expect(
            mockSharedAuth.compareAndSetAppGroupSessionStateSync,
        ).not.toHaveBeenCalledWith(
            expect.stringMatching(/^publishing:/),
            expect.stringMatching(/^active:/),
        );
        expect(stores.appGroupSessionState).toBe("invalidated");
        expect(stores.secure.get("nolte_access_token")).toBeUndefined();
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
    });

    test("native CAS partial active 실패와 credential delete 실패가 겹쳐도 extension은 invalidated다", async () => {
        const stores = installMemoryAuthStores();
        mockSharedAuth.compareAndSetAppGroupSessionStateSync.mockImplementation(
            (_expectedValue, activeValue) => {
                stores.setAppGroupSessionState(activeValue);
                return {
                    success: false,
                    status: "partial",
                    rollbackSucceeded: false,
                };
            },
        );
        mockLocalStorage.deleteItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_refresh_token") {
                throw new Error("secure refresh delete unavailable");
            }
            stores.secure.delete(key);
        });

        await expect(saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        )).rejects.toThrow("공유 확장 인증 세션 공개에 실패했습니다.");

        expect(stores.secure.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.appGroupSessionState).toBe("invalidated");
        __resetAuthStorageInvalidSessionForTests();
        expect(await getRefreshToken()).toBeNull();
        expect(await getAuthMember()).toBeNull();
    });

    test("credential 기록 뒤 publication mismatch는 예약 전 mismatch로 오인하지 않고 fail-closed 정리한다", async () => {
        const stores = installMemoryAuthStores();
        mockSharedAuth.compareAndSetAppGroupSessionStateSync.mockImplementation(
            (_expectedValue, nextValue) => {
                if (nextValue.startsWith("publishing:")) {
                    stores.setAppGroupSessionState(nextValue);
                    return { success: true, status: "success" };
                }
                stores.setAppGroupSessionState("active:unexpected-writer");
                return {
                    success: false,
                    status: "mismatch",
                    mismatch: true,
                    currentValue: "active:unexpected-writer",
                };
            },
        );

        await expect(saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        )).rejects.toThrow(
            "공유 확장 인증 세션이 더 새로운 세대로 변경되었습니다.",
        );

        expect(stores.appGroupSessionState).toBe("invalidated");
        expect(stores.secure.get("nolte_access_token")).toBeUndefined();
        expect(stores.secure.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.secure.get("nolate_auth_member")).toBeUndefined();
        expect(stores.shared.get("nolte_access_token")).toBeUndefined();
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.shared.get("nolate_auth_member")).toBeUndefined();
    });

    test("logout은 App Group durable fence를 먼저 기다리고 실패할 때 shared marker로 fallback한다", async () => {
        installMemoryAuthStores();
        mockSharedAuth.setAppGroupSessionStateSync.mockReturnValue({
            success: false,
        });
        const appGroupWrite = deferred<boolean>();
        mockSharedAuth.setAppGroupSessionState.mockReturnValueOnce(
            appGroupWrite.promise,
        );
        mockSharedAuth.setItem.mockClear();

        const delayedIntent = beginAuthLogoutIntent();
        let settled = false;
        delayedIntent.finally(() => {
            settled = true;
        }).catch(() => undefined);
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(mockSharedAuth.setItem).not.toHaveBeenCalledWith(
            "nolate_auth_invalid_session",
            "invalidated",
        );

        appGroupWrite.resolve(true);
        await expect(delayedIntent).resolves.toBeDefined();

        mockSharedAuth.setAppGroupSessionStateSync.mockReturnValue({
            success: false,
        });
        mockSharedAuth.setAppGroupSessionState.mockRejectedValue(
            new Error("app group unavailable"),
        );
        mockSharedAuth.setItem.mockResolvedValue(true);
        mockSharedAuth.setItem.mockClear();
        await expect(beginAuthLogoutIntent()).resolves.toBeDefined();
        expect(mockSharedAuth.setItem).toHaveBeenCalledWith(
            "nolate_auth_invalid_session",
            "invalidated",
        );
    });

    test("공용 clear의 extension fence 실패는 B network를 막고 같은 프로세스 retry로 복구한다", async () => {
        const stores = installMemoryAuthStores();
        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        mockSharedAuth.setAppGroupSessionStateSync.mockReturnValue({
            success: false,
        });
        mockSharedAuth.setAppGroupSessionState.mockRejectedValue(
            new Error("app group unavailable"),
        );
        mockSharedAuth.setItem.mockImplementation(async (key, value) => {
            if (key === "nolate_auth_invalid_session") {
                throw new Error("shared marker unavailable");
            }
            stores.shared.set(key, value);
            return true;
        });
        mockSharedAuth.deleteItem.mockImplementation(async (key) => {
            if (key === "nolte_refresh_token") {
                throw new Error("shared A refresh delete unavailable");
            }
            stores.shared.delete(key);
            return true;
        });

        await expect(clearAuthTokens()).resolves.toBe(false);
        expect(stores.appGroupSessionState)
            .toBe("active:sha256:A-refresh");
        expect(stores.shared.get("nolte_refresh_token")).toBe("A-refresh");

        const bNetwork = jest.fn(async () => "B-session");
        await expect(
            prepareExplicitAuthenticationRequest().then(bNetwork),
        ).rejects.toThrow("공유 확장");
        expect(bNetwork).not.toHaveBeenCalled();

        mockSharedAuth.setAppGroupSessionStateSync.mockImplementation(
            (value) => {
                stores.setAppGroupSessionState(value);
                return { success: true };
            },
        );
        mockSharedAuth.setAppGroupSessionState.mockImplementation(
            async (value) => {
                stores.setAppGroupSessionState(value);
                return true;
            },
        );
        mockSharedAuth.setItem.mockImplementation(async (key, value) => {
            stores.shared.set(key, value);
            return true;
        });
        mockSharedAuth.deleteItem.mockImplementation(async (key) => {
            stores.shared.delete(key);
            return true;
        });

        await expect(
            prepareExplicitAuthenticationRequest().then(bNetwork),
        ).resolves.toBe("B-session");
        expect(bNetwork).toHaveBeenCalledTimes(1);
        expect(stores.appGroupSessionState).toBe("invalidated");
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
    });

    test("명시적 B 인증 network 전에 old active A를 durable invalidated로 전환한다", async () => {
        const stores = installMemoryAuthStores();
        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        const response = deferred<void>();
        const bNetwork = jest.fn(async () => {
            expect(stores.appGroupSessionState).toBe("invalidated");
            expect(
                stores.shared.get("nolate_auth_invalid_session"),
            ).toBe("invalidated");
            await response.promise;
            return "B-response";
        });

        const request = prepareExplicitAuthenticationRequest()
            .then(bNetwork);
        while (bNetwork.mock.calls.length === 0) await Promise.resolve();

        // A process kill here can leave old credentials, but both main app and
        // extension observe the durable invalidation before B's response.
        __resetAuthStorageInvalidSessionForTests();
        expect(await getRefreshToken()).toBeNull();
        response.resolve();
        await expect(request).resolves.toBe("B-response");
    });

    test("App Group staging marker write 실패는 credential write 전에 fresh login을 fail closed한다", async () => {
        const stores = installMemoryAuthStores();
        mockSharedAuth.beginAppGroupSessionTransitionSync.mockReturnValue({
            success: false,
            status: "failure",
        });

        await expect(saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        )).rejects.toThrow("공유 확장 인증 세션 공개에 실패했습니다.");

        expect(mockSharedAuth.setItem).not.toHaveBeenCalledWith(
            "nolte_access_token",
            "B-access",
        );
        expect(stores.secure.get("nolte_access_token")).toBeUndefined();
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
        __resetAuthStorageInvalidSessionForTests();
        expect(await getRefreshToken()).toBeNull();
    });

    test("App Group marker read 오류도 main bootstrap token/member repair를 fail closed한다", async () => {
        const stores = installMemoryAuthStores({
            secure: {
                nolte_refresh_token: "A-refresh",
                nolate_auth_member: JSON.stringify({
                    id: 1,
                    name: "A",
                    authSessionIdentity: "sha256:A-refresh",
                }),
            },
        });
        mockSharedAuth.getAppGroupSessionState.mockRejectedValue(
            new Error("app group read unavailable"),
        );

        expect(await getRefreshToken()).toBeNull();
        expect(await getAuthMember()).toBeNull();
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
    });

    test("marker removal 중 남은 App Group staging만으로도 cold bootstrap을 차단한다", async () => {
        const member = JSON.stringify({
            id: 1,
            name: "A",
            authSessionIdentity: "sha256:A-refresh",
        });
        const stores = installMemoryAuthStores({
            secure: {
                nolte_access_token: "A-access",
                nolte_refresh_token: "A-refresh",
                nolate_auth_member: member,
            },
            shared: {
                nolte_access_token: "A-access",
                nolte_refresh_token: "A-refresh",
                nolate_auth_member: member,
            },
        });
        stores.setAppGroupSessionState(
            "staging:99:sha256:A-refresh",
        );

        __resetAuthStorageInvalidSessionForTests();
        expect(await getAccessToken()).toBeNull();
        expect(await getRefreshToken()).toBeNull();
        expect(await getAuthMember()).toBeNull();
    });

    test("Secure B member와 shared A member 불일치는 fail closed하고 어느 쪽도 역보정하지 않는다", async () => {
        const secureMember = JSON.stringify({
            id: 2,
            name: "B",
            authSessionIdentity: "sha256:B-refresh",
        });
        const sharedMember = JSON.stringify({
            id: 1,
            name: "A",
            authSessionIdentity: "sha256:A-refresh",
        });
        const stores = installMemoryAuthStores({
            secure: {
                nolte_refresh_token: "B-refresh",
                nolate_auth_member: secureMember,
            },
            shared: {
                nolte_refresh_token: "B-refresh",
                nolate_auth_member: sharedMember,
            },
        });

        expect(await getAuthMember()).toBeNull();
        expect(stores.secure.get("nolate_auth_member")).toBe(secureMember);
        expect(stores.shared.get("nolate_auth_member")).toBe(sharedMember);
    });

    test("durable marker 조회 실패도 fail-closed로 token/member repair를 막는다", async () => {
        const stores = installMemoryAuthStores({
            secure: {
                nolte_refresh_token: "A-refresh",
                nolate_auth_member: JSON.stringify({ id: 1, name: "A" }),
            },
        });
        mockLocalStorage.getItemAsync.mockImplementation(async (key) => {
            if (key === "nolate_auth_invalid_session") {
                throw new Error("marker read unavailable");
            }
            return stores.secure.get(key) ?? null;
        });

        expect(await getRefreshToken()).toBeNull();
        expect(await getAuthMember()).toBeNull();
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.shared.get("nolate_auth_member")).toBeUndefined();
    });

    test("logout 뒤 늦은 A refresh가 token을 부활시키지 않는다", async () => {
        const values = new Map<string, string>();
        mockSharedAuth.getItem.mockImplementation(async (key) => values.get(key) ?? null);
        mockSharedAuth.setItem.mockImplementation(async (key, value) => {
            values.set(key, value);
            return true;
        });
        mockSharedAuth.deleteItem.mockImplementation(async (key) => {
            values.delete(key);
            return true;
        });
        mockLocalStorage.getItemAsync.mockImplementation(async (key) => values.get(key) ?? null);
        mockLocalStorage.setItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });
        mockLocalStorage.deleteItemAsync.mockImplementation(async (key) => {
            values.delete(key);
        });

        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        const epoch = getAuthSessionEpoch();
        await clearAuthTokens();
        await expect(saveRefreshedAuthTokensIfCurrent({
            accessToken: "late-A-access",
            refreshToken: "rotated-A-refresh",
            expectedEpoch: epoch,
            expectedRefreshToken: "A-refresh",
        })).resolves.toBe(false);
        await expect(getRefreshToken()).resolves.toBeNull();
    });

    test("logout 의도는 서버 요청 전에 진행 중 refresh/mutation AbortSignal을 즉시 취소한다", async () => {
        const controller = createAuthEpochAbortController(getAuthSessionEpoch());
        expect(controller.signal.aborted).toBe(false);
        const intentPromise = beginAuthLogoutIntent();
        expect(controller.signal.aborted).toBe(true);
        const intent = await intentPromise;
        await clearAuthTokensIfCurrent(intent.epoch, { notifyListeners: false });
        controller.dispose();
    });

    test("느린 A logout cleanup은 뒤에 시작한 B 로그인의 token을 지우지 않는다", async () => {
        const values = new Map<string, string>();
        mockSharedAuth.getItem.mockImplementation(async (key) => values.get(key) ?? null);
        mockSharedAuth.setItem.mockImplementation(async (key, value) => {
            values.set(key, value);
            return true;
        });
        mockSharedAuth.deleteItem.mockImplementation(async (key) => {
            values.delete(key);
            return true;
        });
        mockLocalStorage.getItemAsync.mockImplementation(async (key) => values.get(key) ?? null);
        mockLocalStorage.setItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });
        mockLocalStorage.deleteItemAsync.mockImplementation(async (key) => {
            values.delete(key);
        });

        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        const logoutIntent = await beginAuthLogoutIntent();
        await saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        );

        await expect(clearAuthTokensIfCurrent(
            logoutIntent.epoch,
            { notifyListeners: false },
        )).resolves.toBe(false);
        await expect(getAccessToken()).resolves.toBe("B-access");
        await expect(getRefreshToken()).resolves.toBe("B-refresh");
    });

    test("B 로그인과 A refresh 응답 경합에서 B token을 보존한다", async () => {
        const values = new Map<string, string>();
        mockSharedAuth.getItem.mockImplementation(async (key) => values.get(key) ?? null);
        mockSharedAuth.setItem.mockImplementation(async (key, value) => {
            values.set(key, value);
            return true;
        });
        mockSharedAuth.deleteItem.mockImplementation(async (key) => {
            values.delete(key);
            return true;
        });
        mockLocalStorage.getItemAsync.mockImplementation(async (key) => values.get(key) ?? null);
        mockLocalStorage.setItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });
        mockLocalStorage.deleteItemAsync.mockImplementation(async (key) => {
            values.delete(key);
        });

        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        const aEpoch = getAuthSessionEpoch();
        await saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        );
        await expect(saveRefreshedAuthTokensIfCurrent({
            accessToken: "late-A-access",
            refreshToken: "rotated-A-refresh",
            expectedEpoch: aEpoch,
            expectedRefreshToken: "A-refresh",
        })).resolves.toBe(false);
        await expect(getAccessToken()).resolves.toBe("B-access");
        await expect(getRefreshToken()).resolves.toBe("B-refresh");
        // A의 늦은 definitive failure도 이 false guard 때문에 B session을 clear하지 않는다.
        await expect(isAuthRefreshContextCurrent({
            expectedEpoch: aEpoch,
            expectedRefreshToken: "A-refresh",
        })).resolves.toBe(false);
    });

    test("refresh 시작 token identity가 rotation으로 바뀌면 늦은 응답을 저장하지 않는다", async () => {
        const values = new Map<string, string>();
        mockSharedAuth.getItem.mockImplementation(async (key) => values.get(key) ?? null);
        mockSharedAuth.setItem.mockImplementation(async (key, value) => {
            values.set(key, value);
            return true;
        });
        mockLocalStorage.getItemAsync.mockImplementation(async (key) => values.get(key) ?? null);
        mockLocalStorage.setItemAsync.mockImplementation(async (key, value) => {
            values.set(key, value);
        });

        await saveTestSession(
            "A-access",
            "A-refresh-v1",
            { id: 1, name: "A" },
        );
        const epoch = getAuthSessionEpoch();
        values.set("nolte_refresh_token", "A-refresh-v2");

        await expect(saveRefreshedAuthTokensIfCurrent({
            accessToken: "late-access",
            refreshToken: "late-refresh",
            expectedEpoch: epoch,
            expectedRefreshToken: "A-refresh-v1",
        })).resolves.toBe(false);
        // Secure/shared stores changed outside the session commit and the member
        // record still belongs to v1, so the mixed state is not restorable.
        await expect(getAuthMember()).resolves.toBeNull();
    });

    test("old token read 중 logout이면 repair보다 clear가 뒤에서 실행되어 token과 API base가 부활하지 않는다", async () => {
        const stores = installMemoryAuthStores({
            secure: { nolte_refresh_token: "A-refresh" },
        });
        const staleRead = deferred<string | null>();
        const readStarted = deferred<void>();
        mockLocalStorage.getItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_refresh_token") {
                readStarted.resolve();
                return staleRead.promise;
            }
            return stores.secure.get(key) ?? null;
        });

        const oldRead = getRefreshToken();
        await readStarted.promise;
        const logout = clearAuthTokens({ notifyListeners: false });
        staleRead.resolve("A-refresh");

        await expect(oldRead).resolves.toBeNull();
        await logout;
        expect(stores.secure.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.shared.get("nolate_auth_api_base_url")).toBeUndefined();
        expect(mockSharedAuth.setItem).not.toHaveBeenCalledWith(
            "nolte_refresh_token",
            "A-refresh",
        );
    });

    test("repair write 도중 logout이면 queued clear가 마지막에 실행되어 shared extension token을 비운다", async () => {
        const stores = installMemoryAuthStores({
            secure: { nolte_refresh_token: "A-refresh" },
        });
        const repairStarted = deferred<void>();
        const releaseRepair = deferred<void>();
        mockSharedAuth.setItem.mockImplementation(async (key, value) => {
            if (key === "nolte_refresh_token") {
                repairStarted.resolve();
                await releaseRepair.promise;
            }
            stores.shared.set(key, value);
            return true;
        });

        const oldRead = getRefreshToken();
        await repairStarted.promise;
        const logout = clearAuthTokens({ notifyListeners: false });
        releaseRepair.resolve();

        await expect(oldRead).resolves.toBeNull();
        await logout;
        expect(stores.secure.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.shared.get("nolate_auth_api_base_url")).toBeUndefined();
    });

    test("old member repair 뒤 B 로그인이 시작되면 A member를 복사하지 않고 B member를 보존한다", async () => {
        const serializedA = JSON.stringify({
            id: 1,
            name: "A",
            authSessionIdentity: "sha256:A-refresh",
        });
        const stores = installMemoryAuthStores({
            secure: {
                nolte_refresh_token: "A-refresh",
                nolate_auth_member: serializedA,
            },
        });
        const staleRead = deferred<string | null>();
        const readStarted = deferred<void>();
        let shouldDelayMemberRead = true;
        mockLocalStorage.getItemAsync.mockImplementation(async (key) => {
            if (key === "nolate_auth_member" && shouldDelayMemberRead) {
                shouldDelayMemberRead = false;
                readStarted.resolve();
                return staleRead.promise;
            }
            return stores.secure.get(key) ?? null;
        });

        const oldMemberRead = getAuthMember();
        await readStarted.promise;
        const bTokenSave = saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        );
        staleRead.resolve(serializedA);

        await expect(oldMemberRead).resolves.toBeNull();
        await bTokenSave;

        expect(JSON.parse(stores.secure.get("nolate_auth_member")!)).toMatchObject({ id: 2 });
        expect(JSON.parse(stores.shared.get("nolate_auth_member")!)).toMatchObject({ id: 2 });
    });

    test("invalid member read 중 B 로그인이 오면 B full commit이 최종 상태가 된다", async () => {
        const stores = installMemoryAuthStores({
            secure: {
                nolte_refresh_token: "A-refresh",
                nolate_auth_member: "{invalid-A",
            },
            shared: {
                nolte_refresh_token: "A-refresh",
                nolate_auth_member: "{invalid-A",
            },
        });
        const readStarted = deferred<void>();
        const releaseRead = deferred<void>();
        mockSharedAuth.getItem.mockImplementation(async (key) => {
            if (key === "nolate_auth_member") {
                readStarted.resolve();
                await releaseRead.promise;
            }
            return stores.shared.get(key) ?? null;
        });

        const oldCleanup = getAuthMember();
        await readStarted.promise;
        const bTokenSave = saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        );
        releaseRead.resolve();

        await expect(oldCleanup).resolves.toBeNull();
        await bTokenSave;
        expect(JSON.parse(stores.secure.get("nolate_auth_member")!)).toMatchObject({ id: 2 });
        expect(JSON.parse(stores.shared.get("nolate_auth_member")!)).toMatchObject({ id: 2 });
    });

    test("same-epoch shared member JSON이 다르면 SecureStore를 역복사하지 않고 fail closed한다", async () => {
        const serialized = JSON.stringify({
            id: 2,
            name: "B",
            authSessionIdentity: "sha256:B-refresh",
        });
        const stores = installMemoryAuthStores({
            secure: {
                nolte_refresh_token: "B-refresh",
                nolate_auth_member: serialized,
            },
            shared: {
                nolte_refresh_token: "B-refresh",
                nolate_auth_member: "{invalid",
            },
        });

        await expect(getAuthMember()).resolves.toBeNull();
        expect(stores.secure.get("nolate_auth_member")).toBe(serialized);
        expect(stores.shared.get("nolate_auth_member")).toBe("{invalid");
    });

    test("logout과 경합한 app bootstrap은 old refresh token으로 A tokenLogin 복원을 시작하지 않는다", async () => {
        const stores = installMemoryAuthStores({
            secure: { nolte_refresh_token: "A-refresh" },
        });
        const staleRead = deferred<string | null>();
        const readStarted = deferred<void>();
        mockLocalStorage.getItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_refresh_token") {
                readStarted.resolve();
                return staleRead.promise;
            }
            return stores.secure.get(key) ?? null;
        });
        const tokenLogin = jest.fn();
        const bootstrap = Promise.all([
            getRefreshToken(),
            getAuthMember(),
        ]).then(([refreshToken, member]) => {
            if (refreshToken && !member) tokenLogin(refreshToken);
        });

        await readStarted.promise;
        const logout = clearAuthTokens({ notifyListeners: false });
        staleRead.resolve("A-refresh");

        await bootstrap;
        await logout;
        expect(tokenLogin).not.toHaveBeenCalled();
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
    });

    test.each([
        "AuthContext bootstrap",
        "login automatic restore",
        "profile legacy-member repair",
    ])("%s writer는 invalidation 뒤 늦은 A tokenLogin 응답을 저장하지 않는다", async () => {
        const stores = installMemoryAuthStores();
        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        const restoreContext = await captureAuthRestoreContext();
        if (!restoreContext) throw new Error("restore context should exist");

        const tokenLoginResponse = deferred<{
            id: number;
            name: string;
            accessToken: string;
            refreshToken: string;
        }>();
        const restore = restoreAuthSessionIfCurrent({
            context: restoreContext,
            tokenLogin: () => tokenLoginResponse.promise,
        });

        const deletionStarted = deferred<void>();
        const releaseDeletion = deferred<void>();
        mockLocalStorage.deleteItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_access_token") {
                deletionStarted.resolve();
                await releaseDeletion.promise;
            }
            stores.secure.delete(key);
        });
        const invalidation = clearAuthTokens({ notifyListeners: false });
        await deletionStarted.promise;
        tokenLoginResponse.resolve({
            id: 1,
            name: "late A",
            accessToken: "late-A-access",
            refreshToken: "late-A-refresh",
        });
        releaseDeletion.resolve();

        await expect(restore).resolves.toBeUndefined();
        await invalidation;
        expect(stores.secure.get("nolte_access_token")).toBeUndefined();
        expect(stores.secure.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.secure.get("nolate_auth_member")).toBeUndefined();
        expect(stores.shared.get("nolte_access_token")).toBeUndefined();
        expect(stores.shared.get("nolte_refresh_token")).toBeUndefined();
        expect(stores.shared.get("nolate_auth_member")).toBeUndefined();
    });

    test("late definitive restore failure는 새 B session을 clear하지 않는다", async () => {
        const stores = installMemoryAuthStores();
        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        const restoreContext = await captureAuthRestoreContext();
        if (!restoreContext) throw new Error("restore context should exist");

        await saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        );

        const cleared = await clearRestorableAuthSessionIfCurrent(
            restoreContext,
            { notifyListeners: false },
        );
        expect(cleared).toBe(false);
        expect(stores.secure.get("nolte_access_token")).toBe("B-access");
        expect(stores.secure.get("nolte_refresh_token")).toBe("B-refresh");
        expect(JSON.parse(stores.secure.get("nolate_auth_member")!)).toMatchObject({
            id: 2,
        });
    });

    test("B login storage write는 A account-local cleanup barrier가 끝난 뒤 시작한다", async () => {
        const stores = installMemoryAuthStores();
        const releaseCleanup = deferred<void>();
        registerAuthSessionTransitionBarrier(releaseCleanup.promise);

        const bSave = saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B" },
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(stores.secure.get("nolte_access_token")).toBeUndefined();
        expect(stores.secure.get("nolte_refresh_token")).toBeUndefined();

        releaseCleanup.resolve();
        await bSave;
        expect(stores.secure.get("nolte_access_token")).toBe("B-access");
        expect(stores.secure.get("nolte_refresh_token")).toBe("B-refresh");
    });

    test("A bootstrap curation write가 지연된 사이 B switch면 A 결과를 폐기하고 B member를 보존한다", async () => {
        const stores = installMemoryAuthStores();
        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A", curationCompleted: false },
        );
        const aEpoch = getAuthSessionEpoch();
        const sharedMemberRead = deferred<string | null>();
        const readStarted = deferred<void>();
        let shouldDelayMemberRead = true;
        mockSharedAuth.getItem.mockImplementation(async (key) => {
            if (key === "nolate_auth_member" && shouldDelayMemberRead) {
                shouldDelayMemberRead = false;
                readStarted.resolve();
                return sharedMemberRead.promise;
            }
            return stores.shared.get(key) ?? null;
        });

        const lateAWrite = saveAuthCurationCompletedForSession({
            curationCompleted: true,
            expectedEpoch: aEpoch,
            expectedRefreshToken: "A-refresh",
            expectedMemberId: 1,
        });
        await readStarted.promise;
        const bTokenSave = saveTestSession(
            "B-access",
            "B-refresh",
            { id: 2, name: "B", curationCompleted: false },
        );
        sharedMemberRead.resolve(JSON.stringify({
            id: 1,
            name: "A",
            curationCompleted: false,
        }));

        await expect(lateAWrite).resolves.toBe(false);
        await bTokenSave;
        expect(JSON.parse(stores.secure.get("nolate_auth_member")!))
            .toMatchObject({ id: 2, curationCompleted: false });
        expect(JSON.parse(stores.shared.get("nolate_auth_member")!))
            .toMatchObject({ id: 2, curationCompleted: false });
    });

    test("logout-pending epoch에서 늦은 A restore session commit을 시작하지 않는다", async () => {
        const stores = installMemoryAuthStores();
        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        const restoreContext = await captureAuthRestoreContext();
        if (!restoreContext) throw new Error("restore context should exist");
        const exitIntent = await beginAuthLogoutIntent();
        await clearAuthTokensIfCurrent(exitIntent.epoch, {
            notifyListeners: false,
        });

        await expect(restoreAuthSessionIfCurrent({
            context: restoreContext,
            tokenLogin: async () => ({
                id: 1,
                name: "late A",
                accessToken: "late-A-access",
                refreshToken: "late-A-refresh",
            }),
        })).resolves.toBeUndefined();

        expect(stores.secure.get("nolate_auth_member")).toBeUndefined();
        expect(stores.shared.get("nolate_auth_member")).toBeUndefined();
    });

    test("generic clearAuthTokens는 실제 invalidation listener cleanup 완료까지 B 인증 gate를 닫는다", async () => {
        installMemoryAuthStores();
        await saveTestSession(
            "A-access",
            "A-refresh",
            { id: 1, name: "A" },
        );
        const listenerCleanup = deferred<void>();
        const unsubscribe = subscribeAuthInvalidation(
            () => listenerCleanup.promise,
        );
        const bAuthenticationNetwork = jest.fn(async () => "B-session");

        const clear = clearAuthTokens();
        const bAuthentication = waitForAuthSessionTransition({
            timeoutMs: 10_000,
        }).then(bAuthenticationNetwork);
        await Promise.resolve();
        await Promise.resolve();
        expect(bAuthenticationNetwork).not.toHaveBeenCalled();

        listenerCleanup.resolve();
        await clear;
        await expect(bAuthentication).resolves.toBe("B-session");
        expect(bAuthenticationNetwork).toHaveBeenCalledTimes(1);
        unsubscribe();
    });
});
