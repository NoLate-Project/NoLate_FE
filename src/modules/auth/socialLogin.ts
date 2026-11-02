import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as KakaoLogin from "@react-native-seoul/kakao-login";
import { exchangeNaverCode, revokeNaverAccessToken } from "../../api/member";
import * as SecureStore from "../storage/secureStorage";
import { authorizeNaver } from "./naverOAuth";

const NAVER_ACCESS_TOKEN_KEY = "nolate_naver_oauth_access_token";

export type SocialSdkLoginResult = {
    loginType: "KAKAO" | "NAVER" | "APPLE";
    /** Provider proof that the server must verify before resolving an account. */
    providerToken: string;
    authorizationCode?: string;
    nonce?: string;
    name: string;
    email?: string;
};

export async function loginWithKakaoSdk(): Promise<SocialSdkLoginResult> {
    const kakao = KakaoLogin as any;

    let loginToken: unknown;
    try {
        if (typeof kakao.loginWithKakaoAccount === "function") {
            loginToken = await kakao.loginWithKakaoAccount();
        } else if (typeof kakao.login === "function") {
            loginToken = await kakao.login();
        } else {
            throw new Error("카카오 로그인을 지금 사용할 수 없어요. 잠시 후 다시 시도해 주세요.");
        }
    } catch (error) {
        throw new Error(`카카오 로그인 실패: ${formatSdkError(error)}`);
    }

    const providerToken = stringify((loginToken as { accessToken?: unknown } | null)?.accessToken);
    if (!providerToken) {
        throw new Error("카카오 로그인을 완료하지 못했어요. 다시 시도해 주세요.");
    }

    if (typeof kakao.getProfile !== "function") {
        throw new Error("카카오 계정 정보를 불러오지 못했어요. 다시 시도해 주세요.");
    }

    const profile = await kakao.getProfile();
    return {
        loginType: "KAKAO",
        providerToken,
        name: firstString(profile?.nickname, profile?.name, profile?.properties?.nickname) || "사용자",
        email: optionalString(profile?.email, profile?.kakaoAccount?.email),
    };
}

export async function loginWithNaverOAuth(): Promise<SocialSdkLoginResult> {
    const { code, codeVerifier } = await authorizeNaver();
    const identity = await exchangeNaverCode({ code, codeVerifier });
    if (!identity.accessToken) throw new Error("네이버 로그인을 완료하지 못했어요. 다시 시도해 주세요.");
    await SecureStore.setItemAsync(NAVER_ACCESS_TOKEN_KEY, identity.accessToken);

    return {
        loginType: "NAVER",
        providerToken: identity.accessToken,
        name: firstString(identity.name, identity.email) || "사용자",
        email: optionalString(identity.email),
    };
}

export async function logoutFromNaverOAuth(): Promise<void> {
    await SecureStore.deleteItemAsync(NAVER_ACCESS_TOKEN_KEY);
}

export async function unlinkNaverOAuth(): Promise<void> {
    const accessToken = await SecureStore.getItemAsync(NAVER_ACCESS_TOKEN_KEY);
    try {
        if (accessToken) await revokeNaverAccessToken(accessToken);
    } finally {
        await SecureStore.deleteItemAsync(NAVER_ACCESS_TOKEN_KEY);
    }
}

export async function logoutFromKakaoSdk(): Promise<void> {
    await KakaoLogin.logout();
}

export async function unlinkKakaoSdk(): Promise<void> {
    await KakaoLogin.unlink();
}

export async function loginWithAppleSdk(): Promise<SocialSdkLoginResult> {
    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
        throw new Error("Apple 로그인은 iOS 13 이상 기기에서만 사용할 수 있습니다.");
    }

    const nonce = Crypto.randomUUID();
    const state = Crypto.randomUUID();
    const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce,
        state,
    });

    const providerToken = stringify(credential.identityToken);
    const authorizationCode = stringify(credential.authorizationCode);
    if (!providerToken || !authorizationCode || credential.state !== state) {
        throw new Error("Apple 로그인을 완료하지 못했어요. 다시 시도해 주세요.");
    }

    return {
        loginType: "APPLE",
        providerToken,
        authorizationCode,
        nonce,
        name: appleDisplayName(credential.fullName) || optionalString(credential.email) || "Apple 사용자",
        email: optionalString(credential.email),
    };
}

function stringify(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    return "";
}

function firstString(...values: unknown[]): string {
    for (const value of values) {
        const text = stringify(value);
        if (text) return text;
    }
    return "";
}

function optionalString(...values: unknown[]): string | undefined {
    const text = firstString(...values);
    return text || undefined;
}

function formatSdkError(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string") return error;
    if (typeof error === "object" && error) {
        const record = error as Record<string, unknown>;
        return firstString(record.message, record.errorMessage, record.code, record.errorCode) || JSON.stringify(record);
    }
    return "알 수 없는 오류";
}

function appleDisplayName(fullName: AppleAuthentication.AppleAuthenticationFullName | null): string {
    if (!fullName) return "";

    return firstString(
        [fullName.familyName, fullName.givenName].filter(Boolean).join(""),
        [fullName.givenName, fullName.familyName].filter(Boolean).join(" "),
        fullName.nickname
    );
}
