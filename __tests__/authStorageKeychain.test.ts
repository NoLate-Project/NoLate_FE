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
    getRefreshToken,
    saveAuthTokens,
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
});
