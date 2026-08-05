import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

import { loginWithAppleSdk } from "../src/modules/auth/socialLogin";

jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(),
}));

jest.mock("@react-native-seoul/naver-login", () => ({
    __esModule: true,
    default: {},
}));
jest.mock("@react-native-seoul/kakao-login", () => ({}));
jest.mock("expo-crypto", () => ({
    randomUUID: jest.fn(),
}));
jest.mock("expo-apple-authentication", () => ({
    isAvailableAsync: jest.fn(),
    signInAsync: jest.fn(),
    AppleAuthenticationScope: {
        FULL_NAME: 0,
        EMAIL: 1,
    },
    AppleAuthenticationUserDetectionStatus: {
        UNSUPPORTED: 0,
        UNKNOWN: 1,
        LIKELY_REAL: 2,
    },
}));

const mockedAppleAuthentication = jest.mocked(AppleAuthentication);
const mockedRandomUUID = jest.mocked(Crypto.randomUUID);

describe("Apple SDK login", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedAppleAuthentication.isAvailableAsync.mockResolvedValue(true);
        mockedRandomUUID
            .mockReturnValueOnce("login-nonce")
            .mockReturnValueOnce("login-state");
    });

    test("requires a matching state and maps the one-time authorization code", async () => {
        mockedAppleAuthentication.signInAsync.mockResolvedValue({
            user: "apple-user",
            state: "login-state",
            fullName: null,
            email: "apple@example.com",
            realUserStatus: AppleAuthentication.AppleAuthenticationUserDetectionStatus.LIKELY_REAL,
            identityToken: "apple-identity-token",
            authorizationCode: "apple-authorization-code",
        });

        await expect(loginWithAppleSdk()).resolves.toEqual({
            loginType: "APPLE",
            providerToken: "apple-identity-token",
            authorizationCode: "apple-authorization-code",
            nonce: "login-nonce",
            name: "apple@example.com",
            email: "apple@example.com",
        });
        expect(mockedAppleAuthentication.signInAsync).toHaveBeenCalledWith({
            requestedScopes: [
                AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: "login-nonce",
            state: "login-state",
        });
    });

    test.each([
        ["missing authorization code", null, "login-state"],
        ["mismatched state", "apple-authorization-code", "different-state"],
    ])("rejects %s before calling the backend", async (_case, authorizationCode, state) => {
        mockedAppleAuthentication.signInAsync.mockResolvedValue({
            user: "apple-user",
            state,
            fullName: null,
            email: null,
            realUserStatus: AppleAuthentication.AppleAuthenticationUserDetectionStatus.UNKNOWN,
            identityToken: "apple-identity-token",
            authorizationCode,
        });

        await expect(loginWithAppleSdk()).rejects.toThrow(
            "Apple 로그인을 완료하지 못했어요. 다시 시도해 주세요.",
        );
    });
});
