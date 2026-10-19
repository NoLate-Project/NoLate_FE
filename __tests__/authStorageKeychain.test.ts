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

import {
    clearAuthTokens,
    configureSharedAuthApiBaseUrl,
    getAccessToken,
    getAuthMember,
    getRefreshToken,
    getAuthCredentialRevision,
    saveRefreshedAuthTokens,
    saveAuthMember,
    resetAuthStorageMemoryCacheForTests,
    saveAuthTokens,
    subscribeAuthInvalidation,
} from "../src/modules/auth/authStorage";

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

beforeEach(() => {
    mockSharedAuth.setItem.mockResolvedValue(true);
    mockSharedAuth.deleteItem.mockResolvedValue(true);
    mockLocalStorage.setItemAsync.mockResolvedValue(undefined);
    mockLocalStorage.deleteItemAsync.mockResolvedValue(undefined);
});
test("late refresh cannot overwrite logout or a different account", async () => {
    resetAuthStorageMemoryCacheForTests();
    const old = getAuthCredentialRevision();
    await saveAuthMember({ id: 8 });
    await expect(saveRefreshedAuthTokens(old, "old-access", "old-refresh")).resolves.toBe(false);
    const beforeLogout = getAuthCredentialRevision();
    await clearAuthTokens({ notifyListeners: false });
    await expect(saveRefreshedAuthTokens(beforeLogout, "old-access", "old-refresh")).resolves.toBe(false);
    await expect(getAccessToken()).resolves.toBeNull();
});
test("logout deletion follows an already-started credential write", async () => {
    resetAuthStorageMemoryCacheForTests();
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    mockLocalStorage.setItemAsync.mockImplementationOnce(() => gate);
    const old = getAuthCredentialRevision();
    const refresh = saveRefreshedAuthTokens(old, "late-access", "late-refresh");
    await Promise.resolve(); // start durable write
    const logout = clearAuthTokens({ notifyListeners: false });
    release();
    await expect(refresh).resolves.toBe(false);
    await logout;
    await expect(getAccessToken()).resolves.toBeNull();
    expect(mockLocalStorage.deleteItemAsync).toHaveBeenCalledWith("nolte_access_token");
});
test("old logout cannot delete a login saved during listener cleanup", async () => {
    resetAuthStorageMemoryCacheForTests();
    let release!: () => void;
    const wait = new Promise<void>(done => { release = done; });
    const detach = subscribeAuthInvalidation(() => wait);
    try {
        const logout = clearAuthTokens();
        await saveAuthTokens("new-login-access", "new-login-refresh");
        release(); await logout;
        await expect(getAccessToken()).resolves.toBe("new-login-access");
    } finally { detach(); release(); }
});
test("same-member profile edits do not discard a single-use refresh rotation", async () => {
    resetAuthStorageMemoryCacheForTests();
    await saveAuthMember({ id: 7, name: "fixture" });
    const revision = getAuthCredentialRevision();
    await saveAuthMember({ id: 7, name: "updated" });
    await expect(saveRefreshedAuthTokens(revision, "rotated-access", "rotated-refresh")).resolves.toBe(true);
});

describe("authStorage shared Keychain session", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resetAuthStorageMemoryCacheForTests();
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

    test("인증 부트스트랩 뒤 토큰 조회는 Keychain 결과를 재사용한다", async () => {
        mockSharedAuth.getItem.mockImplementation(async (key) =>
            key === "nolte_access_token" ? "shared-access" : null
        );

        await expect(getAccessToken()).resolves.toBe("shared-access");
        await expect(getAccessToken()).resolves.toBe("shared-access");

        expect(mockSharedAuth.getItem).toHaveBeenCalledTimes(1);
        expect(mockLocalStorage.getItemAsync).not.toHaveBeenCalledWith("nolte_access_token");
    });

    test("동시에 요청한 회원 정보는 한 번의 Keychain 조회를 공유한다", async () => {
        const member = JSON.stringify({
            id: 7,
            name: "테스터",
            curationCompleted: true,
        });
        mockSharedAuth.getItem.mockImplementation(async (key) =>
            key === "nolate_auth_member" ? member : null
        );

        await expect(Promise.all([getAuthMember(), getAuthMember()])).resolves.toEqual([
            { id: 7, name: "테스터", curationCompleted: true },
            { id: 7, name: "테스터", curationCompleted: true },
        ]);
        await expect(getAuthMember()).resolves.toEqual({
            id: 7,
            name: "테스터",
            curationCompleted: true,
        });

        expect(mockSharedAuth.getItem).toHaveBeenCalledTimes(1);
        expect(mockLocalStorage.getItemAsync).toHaveBeenCalledTimes(1);
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

    test("계정 cleanup listener를 credential 삭제 전에 완료한다", async () => {
        const calls: string[] = [];
        const unsubscribe = subscribeAuthInvalidation(async () => {
            calls.push("cleanup");
        });
        mockLocalStorage.deleteItemAsync.mockImplementation(async () => {
            calls.push("delete");
        });

        try {
            await clearAuthTokens();
        } finally {
            unsubscribe();
        }

        expect(calls[0]).toBe("cleanup");
        expect(calls).toContain("delete");
    });

    test("필수 account cleanup 실패 시 credential을 삭제하지 않는다", async () => {
        const cleanupError = new Error("native alarm purge failed");
        const unsubscribe = subscribeAuthInvalidation(async () => {
            throw cleanupError;
        });

        try {
            await expect(clearAuthTokens()).rejects.toBe(cleanupError);
        } finally {
            unsubscribe();
        }

        expect(mockLocalStorage.deleteItemAsync).not.toHaveBeenCalled();
        expect(mockSharedAuth.deleteItem).not.toHaveBeenCalled();
    });
});
