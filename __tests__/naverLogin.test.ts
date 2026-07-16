import NaverLogin from "@react-native-seoul/naver-login";

import { getEnv } from "../src/api/env";
import {
    loginWithNaverSdk,
    logoutFromNaverSdk,
    unlinkNaverSdk,
} from "../src/modules/auth/socialLogin";

jest.mock("../src/api/env", () => ({
    getEnv: jest.fn(),
}));

jest.mock("@react-native-seoul/naver-login", () => ({
    __esModule: true,
    default: {
        initialize: jest.fn(),
        login: jest.fn(),
        getProfile: jest.fn(),
        logout: jest.fn(),
        deleteToken: jest.fn(),
    },
}));

jest.mock("@react-native-seoul/kakao-login", () => ({}));
jest.mock("expo-apple-authentication", () => ({}));

const mockedGetEnv = jest.mocked(getEnv);
const mockedNaverLogin = NaverLogin as jest.Mocked<typeof NaverLogin>;

describe("Naver SDK login", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedGetEnv.mockImplementation((key) => ({
            EXPO_PUBLIC_NAVER_CONSUMER_KEY: "client-id",
            EXPO_PUBLIC_NAVER_CONSUMER_SECRET: "client-secret",
            EXPO_PUBLIC_NAVER_SERVICE_URL_SCHEME_IOS: "nolate-naver",
            EXPO_PUBLIC_NAVER_APP_NAME: "NoLate",
        }[key]));
        mockedNaverLogin.login.mockResolvedValue({
            isSuccess: true,
            successResponse: {
                accessToken: "naver-access",
                refreshToken: "naver-refresh",
                expiresAtUnixSecondString: "9999999999",
                tokenType: "bearer",
            },
        });
    });

    test("initializes SDK, logs in without callback parameters, and maps name/email", async () => {
        mockedNaverLogin.getProfile.mockResolvedValue({
            resultcode: "00",
            message: "success",
            response: {
                id: "naver-user-id",
                name: "네이버 회원",
                email: "naver@example.com",
                profile_image: null,
                birthday: null,
                age: null,
                birthyear: null,
                gender: null,
                mobile: null,
                mobile_e164: null,
                nickname: null,
            },
        });

        await expect(loginWithNaverSdk()).resolves.toEqual({
            loginType: "NAVER",
            snsId: "naver-user-id",
            name: "네이버 회원",
            email: "naver@example.com",
        });

        expect(mockedNaverLogin.initialize).toHaveBeenCalledWith({
            appName: "NoLate",
            consumerKey: "client-id",
            consumerSecret: "client-secret",
            serviceUrlSchemeIOS: "nolate-naver",
            disableNaverAppAuthIOS: true,
        });
        expect(mockedNaverLogin.login).toHaveBeenCalledWith();
        expect(mockedNaverLogin.getProfile).toHaveBeenCalledWith("naver-access");
    });

    test("rejects a profile without the required member name", async () => {
        mockedNaverLogin.getProfile.mockResolvedValue({
            resultcode: "00",
            message: "success",
            response: {
                id: "naver-user-id",
                name: "",
                email: "naver@example.com",
                profile_image: null,
                birthday: null,
                age: null,
                birthyear: null,
                gender: null,
                mobile: null,
                mobile_e164: null,
                nickname: "별명",
            },
        });

        await expect(loginWithNaverSdk()).rejects.toThrow("필수 제공 정보인 회원이름");
    });

    test("logs out and unlinks through the native SDK", async () => {
        await logoutFromNaverSdk();
        await unlinkNaverSdk();

        expect(mockedNaverLogin.logout).toHaveBeenCalledTimes(1);
        expect(mockedNaverLogin.deleteToken).toHaveBeenCalledTimes(1);
    });
});
