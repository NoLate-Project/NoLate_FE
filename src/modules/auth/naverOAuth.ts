import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { getEnv } from "../../api/env";

export const NAVER_CALLBACK_URL = "https://nolate.jinuk.dev/api/member/auth/naver/callback";
export const NAVER_APP_RETURN_URL = "nolate://auth/naver";

/** Browser authorization uses a one-time PKCE verifier; no client secret is shipped in the app. */
export async function authorizeNaver(): Promise<{ code: string; codeVerifier: string }> {
    const clientId = getEnv("EXPO_PUBLIC_NAVER_CONSUMER_KEY") ?? getEnv("EXPO_PUBLIC_NAVER_LOGIN_CLIENT_ID");
    if (!clientId) throw new Error("네이버 로그인을 지금 사용할 수 없어요. 잠시 후 다시 시도해 주세요.");

    const codeVerifier = (Crypto.randomUUID() + Crypto.randomUUID()).replace(/-/g, "");
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, codeVerifier, {
        encoding: Crypto.CryptoEncoding.BASE64,
    });
    const codeChallenge = digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const state = Crypto.randomUUID();
    const query = [
        ["response_type", "code"],
        ["client_id", clientId],
        ["redirect_uri", NAVER_CALLBACK_URL],
        ["scope", "openid"],
        ["state", state],
        ["code_challenge", codeChallenge],
        ["code_challenge_method", "S256"],
    ].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    const authorizeUrl = `https://nid.naver.com/oauth2/authorize?${query}`;

    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, NAVER_APP_RETURN_URL);
    if (result.type !== "success") throw new Error("네이버 로그인을 취소했어요.");

    const callback = Linking.parse(result.url);
    const callbackState = callback.queryParams?.state;
    const code = callback.queryParams?.code;
    if (callback.scheme !== "nolate" || callback.hostname !== "auth" || callback.path !== "naver" ||
        callbackState !== state || callback.queryParams?.error !== undefined) {
        throw new Error("네이버 로그인 응답을 확인하지 못했어요. 다시 시도해 주세요.");
    }
    if (typeof code !== "string" || !code) throw new Error("네이버 로그인 응답을 확인하지 못했어요. 다시 시도해 주세요.");
    return { code, codeVerifier };
}
