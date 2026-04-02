import { getEnv } from "../../api/env";
import * as KakaoLogin from "@react-native-seoul/kakao-login";
import * as NaverLoginModule from "@react-native-seoul/naver-login";

const NAVER_DEFAULT_CLIENT_ID = "TsB_osWaCvynK7Hf01md";
const NAVER_DEFAULT_CLIENT_SECRET = "06ZewBwqWx";
const NAVER_DEFAULT_IOS_SCHEME = "naverTsB_osWaCvynK7Hf01md";

export type SocialSdkLoginResult = {
    loginType: "KAKAO" | "NAVER";
    snsId: string;
    name: string;
    email?: string;
};

export async function loginWithKakaoSdk(): Promise<SocialSdkLoginResult> {
    const kakao = KakaoLogin as any;

    if (typeof kakao.login === "function") {
        await kakao.login();
    } else if (typeof kakao.loginWithKakaoAccount === "function") {
        await kakao.loginWithKakaoAccount();
    } else {
        throw new Error("카카오 SDK 로그인 함수(login)가 없습니다.");
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
        name: stringify(profile?.nickname) || stringify(profile?.name) || "사용자",
        email: stringify(profile?.email) || undefined,
    };
}

export async function loginWithNaverSdk(): Promise<SocialSdkLoginResult> {
    const naverModule = NaverLoginModule as any;
    const naverLogin = naverModule.NaverLogin ?? naverModule.default ?? naverModule;
    const getProfile = naverModule.getProfile ?? naverLogin?.getProfile;

    const consumerKey = getEnv("EXPO_PUBLIC_NAVER_CONSUMER_KEY") ?? getEnv("EXPO_PUBLIC_NAVER_CLIENT_ID") ?? NAVER_DEFAULT_CLIENT_ID;
    const consumerSecret = getEnv("EXPO_PUBLIC_NAVER_CONSUMER_SECRET") ?? NAVER_DEFAULT_CLIENT_SECRET;
    const appName = getEnv("EXPO_PUBLIC_NAVER_APP_NAME") ?? "NoLate";
    const serviceUrlSchemeIOS = getEnv("EXPO_PUBLIC_NAVER_SERVICE_URL_SCHEME_IOS") ?? NAVER_DEFAULT_IOS_SCHEME;

    if (!consumerKey || !consumerSecret) {
        throw new Error("네이버 SDK 설정이 없습니다. EXPO_PUBLIC_NAVER_CONSUMER_KEY/SECRET 값을 확인해 주세요.");
    }

    const loginConfig = {
        appName,
        consumerKey,
        consumerSecret,
        serviceUrlSchemeIOS,
        disableNaverAppAuthIOS: false,
    };

    if (typeof naverLogin?.initialize === "function") {
        await naverLogin.initialize(loginConfig);
    }

    const token = await loginWithNaver(naverLogin, loginConfig);
    const accessToken =
        stringify(token?.accessToken) ||
        stringify(token?.successResponse?.accessToken) ||
        stringify(token?.response?.accessToken);

    if (!accessToken) {
        throw new Error("네이버 AccessToken을 가져오지 못했습니다.");
    }

    if (typeof getProfile !== "function") {
        throw new Error("네이버 SDK 프로필 함수(getProfile)가 없습니다.");
    }

    const profileResult = await getProfile(accessToken);
    const profile = profileResult?.response ?? profileResult;
    const snsId = stringify(profile?.id);
    if (!snsId) {
        throw new Error("네이버 사용자 ID를 가져오지 못했습니다.");
    }

    return {
        loginType: "NAVER",
        snsId,
        name: stringify(profile?.name) || stringify(profile?.nickname) || "사용자",
        email: stringify(profile?.email) || undefined,
    };
}

async function loginWithNaver(
    naverLogin: any,
    loginConfig: {
        appName: string;
        consumerKey: string;
        consumerSecret: string;
        serviceUrlSchemeIOS: string;
        disableNaverAppAuthIOS: boolean;
    }
) {
    if (typeof naverLogin?.login !== "function") {
        throw new Error("네이버 SDK 로그인 함수(login)가 없습니다.");
    }

    if (naverLogin.login.length >= 2) {
        return await new Promise((resolve, reject) => {
            naverLogin.login(loginConfig, (err: unknown, token: unknown) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(token);
            });
        });
    }

    return await naverLogin.login();
}

function stringify(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return "";
}
