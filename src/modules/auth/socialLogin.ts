import { getEnv } from "../../api/env";
import * as AppleAuthentication from "expo-apple-authentication";
import * as KakaoLogin from "@react-native-seoul/kakao-login";
import NaverLogin from "@react-native-seoul/naver-login";

export type SocialSdkLoginResult = {
    loginType: "KAKAO" | "NAVER" | "APPLE";
    snsId: string;
    name: string;
    email?: string;
};

export async function loginWithKakaoSdk(): Promise<SocialSdkLoginResult> {
    const kakao = KakaoLogin as any;

    try {
        if (typeof kakao.loginWithKakaoAccount === "function") {
            await kakao.loginWithKakaoAccount();
        } else if (typeof kakao.login === "function") {
            await kakao.login();
        } else {
            throw new Error("카카오 SDK 로그인 함수(login)가 없습니다.");
        }
    } catch (error) {
        throw new Error(`카카오 로그인 실패: ${formatSdkError(error)}`);
    }

    if (typeof kakao.getProfile !== "function") {
        throw new Error("카카오 SDK 프로필 함수(getProfile)가 없습니다.");
    }

    const profile = await kakao.getProfile();
    const snsId = stringify(profile?.id);
    if (!snsId) {
        throw new Error("카카오 사용자 ID를 가져오지 못했습니다.");
    }

    return {
        loginType: "KAKAO",
        snsId,
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
        throw new Error("네이버 로그인 설정이 없습니다. EXPO_PUBLIC_NAVER_CONSUMER_KEY/SECRET 값은 네아로 앱 키로 설정해 주세요.");
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
        const failureMessage = stringify(token?.failureResponse?.message);
        throw new Error(failureMessage ? `네이버 로그인 실패: ${failureMessage}` : "네이버 로그인에 실패했습니다.");
    }

    const accessToken = stringify(token?.successResponse?.accessToken);

    if (!accessToken) {
        throw new Error("네이버 AccessToken을 가져오지 못했습니다.");
    }

    const profileResult = await NaverLogin.getProfile(accessToken);
    const profile = profileResult?.response ?? profileResult;
    const snsId = stringify(profile?.id);
    if (!snsId) {
        throw new Error("네이버 사용자 ID를 가져오지 못했습니다.");
    }

    const name = firstString(profile?.name);
    if (!name) {
        throw new Error("필수 제공 정보인 회원이름을 가져오지 못했습니다. 네이버 동의 화면에서 회원이름 제공에 동의해 주세요.");
    }

    return {
        loginType: "NAVER",
        snsId,
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

export async function loginWithAppleSdk(): Promise<SocialSdkLoginResult> {
    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
        throw new Error("Apple 로그인은 iOS 13 이상 기기에서만 사용할 수 있습니다.");
    }

    const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
    });

    const snsId = stringify(credential.user);
    if (!snsId) {
        throw new Error("Apple 사용자 ID를 가져오지 못했습니다.");
    }

    return {
        loginType: "APPLE",
        snsId,
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
