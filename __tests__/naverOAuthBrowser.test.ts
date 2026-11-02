import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";

import { getEnv } from "../src/api/env";
import { authorizeNaver, NAVER_APP_RETURN_URL, NAVER_CALLBACK_URL } from "../src/modules/auth/naverOAuth";

jest.mock("../src/api/env", () => ({ getEnv: jest.fn() }));
jest.mock("expo-crypto", () => ({
    randomUUID: jest.fn(),
    digestStringAsync: jest.fn(),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { BASE64: "base64" },
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("expo-linking", () => ({
    parse: (url: string) => {
        const query = Object.fromEntries(url.split("?")[1].split("&").map((part) => {
            const [key, value] = part.split("=");
            return [decodeURIComponent(key), decodeURIComponent(value)];
        }));
        return { scheme: "nolate", hostname: "auth", path: "naver", queryParams: query };
    },
}));

const mockedGetEnv = jest.mocked(getEnv);
const mockedCrypto = jest.mocked(Crypto);
const mockedBrowser = jest.mocked(WebBrowser);

describe("NAVER PKCE browser authorization", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedGetEnv.mockImplementation((key) => key === "EXPO_PUBLIC_NAVER_CONSUMER_KEY" ? "public-id" : undefined);
        mockedCrypto.randomUUID.mockReturnValueOnce("a".repeat(36)).mockReturnValueOnce("b".repeat(36))
            .mockReturnValueOnce("expected-state");
        mockedCrypto.digestStringAsync.mockResolvedValue("YWJjZA==");
        mockedBrowser.openAuthSessionAsync.mockResolvedValue({
            type: "success", url: `${NAVER_APP_RETURN_URL}?code=one-time-code&state=expected-state`,
        });
    });

    test("sends public ID, state, and S256 challenge without a client secret", async () => {
        await expect(authorizeNaver()).resolves.toEqual({
            code: "one-time-code", codeVerifier: "a".repeat(36) + "b".repeat(36),
        });
        const [url, returnUrl] = mockedBrowser.openAuthSessionAsync.mock.calls[0];
        const query = Object.fromEntries(url.split("?")[1].split("&").map((part) => {
            const [key, value] = part.split("=");
            return [decodeURIComponent(key), decodeURIComponent(value)];
        }));
        expect(returnUrl).toBe(NAVER_APP_RETURN_URL);
        expect(query.client_id).toBe("public-id");
        expect(query.redirect_uri).toBe(NAVER_CALLBACK_URL);
        expect(query.code_challenge).toBe("YWJjZA");
        expect(query.state).toBe("expected-state");
        expect(url).not.toContain("secret");
    });

    test("rejects a callback with a mismatched state", async () => {
        mockedBrowser.openAuthSessionAsync.mockResolvedValue({
            type: "success", url: `${NAVER_APP_RETURN_URL}?code=one-time-code&state=attacker`,
        });
        await expect(authorizeNaver()).rejects.toThrow("응답을 확인하지 못했어요");
    });
});
