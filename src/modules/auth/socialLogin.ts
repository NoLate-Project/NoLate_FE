import { getEnv } from "../../api/env";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as KakaoLogin from "@react-native-seoul/kakao-login";
import NaverLogin from "@react-native-seoul/naver-login";

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

export async function loginWithNaverSdk(): Promise<SocialSdkLoginResult> {
    const consumerKey = getEnv("EXPO_PUBLIC_NAVER_CONSUMER_KEY") ?? getEnv("EXPO_PUBLIC_NAVER_LOGIN_CLIENT_ID");
    const consumerSecret = getEnv("EXPO_PUBLIC_NAVER_CONSUMER_SECRET") ?? getEnv("EXPO_PUBLIC_NAVER_LOGIN_CLIENT_SECRET");
    const appName = getEnv("EXPO_PUBLIC_NAVER_APP_NAME") ?? "NoLate";
    const serviceUrlSchemeIOS =
        getEnv("EXPO_PUBLIC_NAVER_SERVICE_URL_SCHEME_IOS") ?? (consumerKey ? `naver${consumerKey}` : undefined);

    if (!consumerKey || !consumerSecret || !serviceUrlSchemeIOS) {
        throw new Error("네이버 로그인을 지금 사용할 수 없어요. 잠시 후 다시 시도해 주세요.");
    }

    const loginConfig = {
        appName,
        consumerKey,
        consumerSecret,
        serviceUrlSchemeIOS,
        disableNaverAppAuthIOS: true,
    };

    NaverLogin.initialize(loginConfig);

    const token = await NaverLogin.login();
    if (token?.isSuccess === false) {
        throw new Error("네이버 로그인을 완료하지 못했어요. 다시 시도해 주세요.");
    }

    const accessToken = stringify(token?.successResponse?.accessToken);

    if (!accessToken) {
        throw new Error("네이버 로그인을 완료하지 못했어요. 다시 시도해 주세요.");
    }

    const profileResult = await NaverLogin.getProfile(accessToken);
    const profile = profileResult?.response ?? profileResult;
    // The server verifies the access token and reads the authoritative profile.
    // Do not block an otherwise valid login just because the optional display
    // name scope was not granted on the device.
    const name = firstString(profile?.name, profile?.nickname, profile?.email) || "사용자";

    return {
        loginType: "NAVER",
        providerToken: accessToken,
        name,
        email: optionalString(profile?.email),
    };
}

export async function logoutFromNaverSdk(): Promise<void> {
    await NaverLogin.logout();
}

export async function unlinkNaverSdk(): Promise<void> {
    await NaverLogin.deleteToken();
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
