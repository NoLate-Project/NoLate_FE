jest.mock("react-native", () => {
    return {
        Platform: { OS: "ios" },
        NativeModules: {
            NoLateShareAuth: {
                getItem: jest.fn(),
                setItem: jest.fn(),
                deleteItem: jest.fn(),
            },
        },
    };
});

jest.mock("../src/modules/storage/secureStorage", () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

import * as LocalStorage from "../src/modules/storage/secureStorage";
import { NativeModules } from "react-native";
import { createAuthEpochAbortController } from "../src/modules/auth/authEpochAbortController";
import {
    registerAuthSessionTransitionBarrier,
} from "../src/modules/auth/authSessionEpoch";

import {
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
    saveRefreshedAuthTokensIfCurrent,
    saveAuthMember,
    saveAuthTokens,
} from "../src/modules/auth/authStorage";
import {
    restoreAuthSessionIfCurrent,
} from "../src/modules/auth/conditionalAuthRestore";

const mockSharedAuth = NativeModules.NoLateShareAuth as {
    getItem: jest.Mock<Promise<string | null>, [string]>;
    setItem: jest.Mock<Promise<boolean>, [string, string]>;
    deleteItem: jest.Mock<Promise<boolean>, [string]>;
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

function installMemoryAuthStores(options: {
    secure?: Record<string, string>;
    shared?: Record<string, string>;
} = {}) {
    const secure = new Map(Object.entries(options.secure ?? {}));
    const shared = new Map(Object.entries(options.shared ?? {}));
    mockSharedAuth.getItem.mockImplementation(async (key) => shared.get(key) ?? null);
    mockSharedAuth.setItem.mockImplementation(async (key, value) => {
        shared.set(key, value);
        return true;
    });
    mockSharedAuth.deleteItem.mockImplementation(async (key) => {
        shared.delete(key);
        return true;
    });
    mockLocalStorage.getItemAsync.mockImplementation(async (key) => secure.get(key) ?? null);
    mockLocalStorage.setItemAsync.mockImplementation(async (key, value) => {
        secure.set(key, value);
    });
    mockLocalStorage.deleteItemAsync.mockImplementation(async (key) => {
        secure.delete(key);
    });
    return { secure, shared };
}

describe("authStorage shared Keychain session", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configureSharedAuthApiBaseUrl("http://127.0.0.1:5522");
        mockSharedAuth.getItem.mockResolvedValue(null);
        mockSharedAuth.setItem.mockResolvedValue(true);
        mockSharedAuth.deleteItem.mockResolvedValue(true);
        mockLocalStorage.getItemAsync.mockResolvedValue(null);
        mockLocalStorage.setItemAsync.mockResolvedValue(undefined);
        mockLocalStorage.deleteItemAsync.mockResolvedValue(undefined);
    });

    test("로그인 토큰과 현재 API 서버를 공유 Keychain에 저장한다", async () => {
        await saveAuthTokens("access-token", "refresh-token");

        expect(mockSharedAuth.setItem).toHaveBeenCalledWith("nolte_access_token", "access-token");
        expect(mockSharedAuth.setItem).toHaveBeenCalledWith("nolte_refresh_token", "refresh-token");
        expect(mockSharedAuth.setItem).toHaveBeenCalledWith(
            "nolate_auth_api_base_url",
            "http://127.0.0.1:5522"
        );
        expect(mockLocalStorage.setItemAsync).toHaveBeenCalledWith("nolte_access_token", "access-token");
        expect(mockLocalStorage.setItemAsync).toHaveBeenCalledWith("nolte_refresh_token", "refresh-token");
    });

    test("공유 Keychain 토큰을 로컬 값보다 우선한다", async () => {
        mockSharedAuth.getItem.mockImplementation(async (key) =>
            key === "nolte_access_token" ? "shared-access" : null
        );
        mockLocalStorage.getItemAsync.mockResolvedValue("local-access");

        await expect(getAccessToken()).resolves.toBe("shared-access");
        expect(mockLocalStorage.getItemAsync).not.toHaveBeenCalledWith("nolte_access_token");
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
        const serialized = JSON.stringify({ id: 7, name: "migration" });
        const stores = installMemoryAuthStores({
            secure: { nolate_auth_member: serialized },
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

        await expect(clearAuthTokens()).resolves.toBeUndefined();

        expect(mockLocalStorage.deleteItemAsync).toHaveBeenCalledWith("nolte_access_token");
        expect(mockLocalStorage.deleteItemAsync).toHaveBeenCalledWith("nolte_refresh_token");
        expect(mockLocalStorage.deleteItemAsync).toHaveBeenCalledWith("nolate_auth_member");
        expect(mockSharedAuth.deleteItem).toHaveBeenCalledWith("nolte_access_token");
        expect(mockSharedAuth.deleteItem).toHaveBeenCalledWith("nolte_refresh_token");
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

        await saveAuthTokens("A-access", "A-refresh");
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

        await saveAuthTokens("A-access", "A-refresh");
        const logoutIntent = await beginAuthLogoutIntent();
        await saveAuthTokens("B-access", "B-refresh");

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

        await saveAuthTokens("A-access", "A-refresh");
        const aEpoch = getAuthSessionEpoch();
        await saveAuthTokens("B-access", "B-refresh");
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

        await saveAuthTokens("A-access", "A-refresh-v1");
        const epoch = getAuthSessionEpoch();
        values.set("nolte_refresh_token", "A-refresh-v2");

        await expect(saveRefreshedAuthTokensIfCurrent({
            accessToken: "late-access",
            refreshToken: "late-refresh",
            expectedEpoch: epoch,
            expectedRefreshToken: "A-refresh-v1",
        })).resolves.toBe(false);
        await expect(getRefreshToken()).resolves.toBe("A-refresh-v2");
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
        const serializedA = JSON.stringify({ id: 1, name: "A" });
        const stores = installMemoryAuthStores({
            secure: { nolate_auth_member: serializedA },
        });
        const staleRead = deferred<string | null>();
        const readStarted = deferred<void>();
        mockLocalStorage.getItemAsync.mockImplementation(async (key) => {
            if (key === "nolate_auth_member") {
                readStarted.resolve();
                return staleRead.promise;
            }
            return stores.secure.get(key) ?? null;
        });

        const oldMemberRead = getAuthMember();
        await readStarted.promise;
        const bTokenSave = saveAuthTokens("B-access", "B-refresh");
        staleRead.resolve(serializedA);

        await expect(oldMemberRead).resolves.toBeNull();
        await bTokenSave;
        await saveAuthMember({ id: 2, name: "B" });

        expect(JSON.parse(stores.secure.get("nolate_auth_member")!)).toMatchObject({ id: 2 });
        expect(JSON.parse(stores.shared.get("nolate_auth_member")!)).toMatchObject({ id: 2 });
    });

    test("invalid member cleanup 중 B 로그인이 오면 cleanup 뒤 B member write가 최종 상태가 된다", async () => {
        const stores = installMemoryAuthStores({
            secure: { nolate_auth_member: "{invalid-A" },
            shared: { nolate_auth_member: "{invalid-A" },
        });
        const cleanupStarted = deferred<void>();
        const releaseCleanup = deferred<void>();
        mockSharedAuth.deleteItem.mockImplementation(async (key) => {
            if (key === "nolate_auth_member") {
                cleanupStarted.resolve();
                await releaseCleanup.promise;
            }
            stores.shared.delete(key);
            return true;
        });

        const oldCleanup = getAuthMember();
        await cleanupStarted.promise;
        const bTokenSave = saveAuthTokens("B-access", "B-refresh");
        releaseCleanup.resolve();

        await expect(oldCleanup).resolves.toBeNull();
        await bTokenSave;
        await saveAuthMember({ id: 2, name: "B" });
        expect(JSON.parse(stores.secure.get("nolate_auth_member")!)).toMatchObject({ id: 2 });
        expect(JSON.parse(stores.shared.get("nolate_auth_member")!)).toMatchObject({ id: 2 });
    });

    test("same-epoch shared member JSON만 손상되면 정상 SecureStore member로 복구한다", async () => {
        const serialized = JSON.stringify({ id: 2, name: "B" });
        const stores = installMemoryAuthStores({
            secure: { nolate_auth_member: serialized },
            shared: { nolate_auth_member: "{invalid" },
        });

        await expect(getAuthMember()).resolves.toMatchObject({ id: 2, name: "B" });
        expect(stores.secure.get("nolate_auth_member")).toBe(serialized);
        expect(stores.shared.get("nolate_auth_member")).toBe(serialized);
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
        await saveAuthTokens("A-access", "A-refresh");
        await saveAuthMember({ id: 1, name: "A" });
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
        await saveAuthTokens("A-access", "A-refresh");
        await saveAuthMember({ id: 1, name: "A" });
        const restoreContext = await captureAuthRestoreContext();
        if (!restoreContext) throw new Error("restore context should exist");

        await saveAuthTokens("B-access", "B-refresh");
        await saveAuthMember({ id: 2, name: "B" });

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

        const bSave = saveAuthTokens("B-access", "B-refresh");
        await Promise.resolve();
        await Promise.resolve();
        expect(stores.secure.get("nolte_access_token")).toBeUndefined();
        expect(stores.secure.get("nolte_refresh_token")).toBeUndefined();

        releaseCleanup.resolve();
        await bSave;
        expect(stores.secure.get("nolte_access_token")).toBe("B-access");
        expect(stores.secure.get("nolte_refresh_token")).toBe("B-refresh");
    });

    test("logout-pending epoch에서 새 A member write를 시작하지 않는다", async () => {
        const stores = installMemoryAuthStores();
        await saveAuthTokens("A-access", "A-refresh");
        await saveAuthMember({ id: 1, name: "A" });
        const exitIntent = await beginAuthLogoutIntent();
        await clearAuthTokensIfCurrent(exitIntent.epoch, {
            notifyListeners: false,
        });

        await saveAuthMember({ id: 1, name: "late A" });

        expect(stores.secure.get("nolate_auth_member")).toBeUndefined();
        expect(stores.shared.get("nolate_auth_member")).toBeUndefined();
    });
});
