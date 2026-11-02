import { exchangeNaverCode, revokeNaverAccessToken } from "../src/api/member";
import * as SecureStore from "../src/modules/storage/secureStorage";
import { authorizeNaver } from "../src/modules/auth/naverOAuth";
import {
    loginWithNaverOAuth,
    logoutFromNaverOAuth,
    unlinkNaverOAuth,
} from "../src/modules/auth/socialLogin";

jest.mock("../src/api/member", () => ({
    exchangeNaverCode: jest.fn(),
    revokeNaverAccessToken: jest.fn(),
}));
jest.mock("../src/modules/auth/naverOAuth", () => ({ authorizeNaver: jest.fn() }));
jest.mock("../src/modules/storage/secureStorage", () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));
jest.mock("@react-native-seoul/kakao-login", () => ({}));
jest.mock("expo-apple-authentication", () => ({}));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "test-nonce") }));

const mockedAuthorize = jest.mocked(authorizeNaver);
const mockedExchange = jest.mocked(exchangeNaverCode);
const mockedRevoke = jest.mocked(revokeNaverAccessToken);
const mockedStore = jest.mocked(SecureStore);

describe("NAVER server OAuth login", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedAuthorize.mockResolvedValue({ code: "authorization-code", codeVerifier: "v".repeat(64) });
        mockedExchange.mockResolvedValue({
            accessToken: "naver-access",
            name: "네이버 회원",
            email: "naver@example.com",
        });
    });

    test("exchanges the PKCE code on the server and stores only the access token", async () => {
        await expect(loginWithNaverOAuth()).resolves.toEqual({
            loginType: "NAVER",
            providerToken: "naver-access",
            name: "네이버 회원",
            email: "naver@example.com",
        });
        expect(mockedExchange).toHaveBeenCalledWith({
            code: "authorization-code",
            codeVerifier: "v".repeat(64),
        });
        expect(mockedStore.setItemAsync).toHaveBeenCalledWith(
            "nolate_naver_oauth_access_token", "naver-access"
        );
    });

    test("uses a safe fallback if optional profile fields are missing", async () => {
        mockedExchange.mockResolvedValue({ accessToken: "naver-access", name: null, email: null });
        await expect(loginWithNaverOAuth()).resolves.toMatchObject({ name: "사용자" });
    });

    test("rejects an empty provider token", async () => {
        mockedExchange.mockResolvedValue({ accessToken: "" });
        await expect(loginWithNaverOAuth()).rejects.toThrow("네이버 로그인을 완료하지 못했어요");
        expect(mockedStore.setItemAsync).not.toHaveBeenCalled();
    });

    test("logout clears local provider token and unlink revokes it through the server", async () => {
        mockedStore.getItemAsync.mockResolvedValue("naver-access");
        await logoutFromNaverOAuth();
        await unlinkNaverOAuth();
        expect(mockedRevoke).toHaveBeenCalledWith("naver-access");
        expect(mockedStore.deleteItemAsync).toHaveBeenCalledTimes(2);
    });
});
