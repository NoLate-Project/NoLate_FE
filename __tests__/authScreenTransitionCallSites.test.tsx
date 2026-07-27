import React from "react";
import {
    TextInput,
} from "react-native";
import TestRenderer, {
    act,
    type ReactTestRenderer,
} from "react-test-renderer";

import Login from "../app/auth/login";
import SignUp from "../app/auth/signup";
import {
    getSnsRegistrationStatus,
    loginMember,
    signUpMember,
    snsLoginMember,
    snsSignUpMember,
} from "../src/api/member";
import {
    prepareExplicitAuthenticationRequest,
    saveAuthenticatedSession,
} from "../src/modules/auth/authStorage";
import {
    registerAuthSessionTransitionBarrier,
    registerSocialAuthTransitionBarrier,
    waitForAuthSessionTransition,
} from "../src/modules/auth/authSessionEpoch";
import {
    loginWithNaverSdk,
} from "../src/modules/auth/socialLogin";

const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
};
const mockSyncAuthentication = jest.fn().mockResolvedValue(true);

jest.mock("expo-router", () => ({
    useLocalSearchParams: () => ({}),
    useRouter: () => mockRouter,
}));

jest.mock("@react-navigation/native", () => ({
    useIsFocused: () => true,
}));

jest.mock("@expo/vector-icons", () => {
    const { Text: NativeText } = require("react-native");
    return {
        Ionicons: ({ name }: { name: string }) => (
            <NativeText>{name}</NativeText>
        ),
    };
});

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            background: "#fff",
            border: "#ddd",
            inputPlaceholder: "#777",
            surface2: "#f5f5f5",
            textPrimary: "#111",
            textSecondary: "#555",
        },
    }),
}));

jest.mock("../src/modules/auth/components/AuthScreen", () => {
    const {
        Pressable: NativePressable,
        Text: NativeText,
        TextInput: NativeTextInput,
        View: NativeView,
    } = require("react-native");
    return {
        AuthScreen: ({ children }: { children: React.ReactNode }) => (
            <NativeView>{children}</NativeView>
        ),
        AuthInput: ({
            label,
            ...props
        }: {
            label: string;
            value?: string;
            onChangeText?: (value: string) => void;
        }) => (
            <NativeTextInput
                {...props}
                accessibilityLabel={label}
            />
        ),
        AuthPrimaryButton: ({
            disabled,
            label,
            onPress,
        }: {
            disabled?: boolean;
            label: string;
            onPress: () => void;
        }) => (
            <NativePressable
                accessibilityLabel={label}
                disabled={disabled}
                onPress={onPress}
            >
                <NativeText>{label}</NativeText>
            </NativePressable>
        ),
    };
});

jest.mock(
    "../src/modules/auth/components/SignupAgreementPanel",
    () => {
        const {
            Pressable: NativePressable,
            Text: NativeText,
        } = require("react-native");
        return {
            __esModule: true,
            default: ({
                onConfirm,
            }: {
                onConfirm: (consents: {
                    termsVersion: string;
                    privacyCollectionVersion: string;
                }) => void;
            }) => (
                <NativePressable
                    accessibilityLabel="가입 요청 실행"
                    onPress={() => onConfirm({
                        termsVersion: "terms-v1",
                        privacyCollectionVersion: "privacy-v1",
                    })}
                >
                    <NativeText>가입 요청 실행</NativeText>
                </NativePressable>
            ),
        };
    },
);

jest.mock("../src/modules/auth/AuthContext", () => ({
    useAuth: () => ({
        syncAuthentication: mockSyncAuthentication,
    }),
}));

jest.mock("../src/modules/auth/authStorage", () => ({
    captureAuthRestoreContext: jest.fn().mockResolvedValue(undefined),
    clearAuthTokens: jest.fn().mockResolvedValue(true),
    clearRestorableAuthSessionIfCurrent: jest.fn().mockResolvedValue(false),
    getAuthMember: jest.fn().mockResolvedValue(null),
    prepareExplicitAuthenticationRequest: jest.fn(),
    saveAuthenticatedSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/auth/accountExitFailureNotice", () => ({
    consumeAccountExitFailure: jest.fn(),
    subscribeAccountExitFailure: jest.fn(() => () => undefined),
}));

jest.mock("../src/modules/notification/pushRegistration", () => ({
    registerPushAfterLogin: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/api/member", () => ({
    getSnsRegistrationStatus: jest.fn(),
    loginMember: jest.fn(),
    signUpMember: jest.fn(),
    snsLoginMember: jest.fn(),
    snsSignUpMember: jest.fn(),
    tokenLoginMember: jest.fn(),
}));

jest.mock("../src/modules/auth/socialLogin", () => ({
    loginWithAppleSdk: jest.fn(),
    loginWithKakaoSdk: jest.fn(),
    loginWithNaverSdk: jest.fn(),
}));

const mockedLoginMember = jest.mocked(loginMember);
const mockedSignUpMember = jest.mocked(signUpMember);
const mockedSnsLoginMember = jest.mocked(snsLoginMember);
const mockedGetSnsRegistrationStatus =
    jest.mocked(getSnsRegistrationStatus);
const mockedSnsSignUpMember = jest.mocked(snsSignUpMember);
const mockedLoginWithNaverSdk = jest.mocked(loginWithNaverSdk);
const mockedSaveAuthenticatedSession =
    jest.mocked(saveAuthenticatedSession);
const mockedPrepareExplicitAuthenticationRequest =
    jest.mocked(prepareExplicitAuthenticationRequest);

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}

async function flushEffects(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

function findPressable(
    renderer: ReactTestRenderer,
    accessibilityLabel: string,
) {
    return renderer.root.findAll(
        (node) =>
            node.props.accessibilityLabel === accessibilityLabel &&
            typeof node.props.onPress === "function",
    )[0];
}

describe("public auth screen transition call sites", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeEach(() => {
        jest.clearAllMocks();
        mockedPrepareExplicitAuthenticationRequest.mockImplementation(
            () => waitForAuthSessionTransition(),
        );
        mockSyncAuthentication.mockResolvedValue(true);
        mockedGetSnsRegistrationStatus.mockResolvedValue({
            registered: false,
        });
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    test("public email login은 local/withdraw cleanup 전 loginMember를 호출하지 않는다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(<Login />);
        });
        await flushEffects();
        const inputs = renderer!.root.findAllByType(TextInput);
        act(() => {
            inputs.find((node) =>
                node.props.accessibilityLabel === "이메일"
            )?.props.onChangeText("b@example.com");
            inputs.find((node) =>
                node.props.accessibilityLabel === "비밀번호"
            )?.props.onChangeText("Password1!");
        });
        const cleanup = deferred<void>();
        registerAuthSessionTransitionBarrier(cleanup.promise);
        mockedLoginMember.mockImplementation(() => new Promise(() => undefined));

        act(() => {
            findPressable(renderer!, "로그인")?.props.onPress();
        });
        await flushEffects();
        expect(mockedLoginMember).not.toHaveBeenCalled();

        cleanup.resolve();
        await flushEffects();
        expect(mockedLoginMember).toHaveBeenCalledTimes(1);
    });

    test("email login은 token과 normalized member를 한 full-session commit으로 저장한다", async () => {
        mockedLoginMember.mockResolvedValue({
            id: 2,
            name: "B",
            accessToken: "B-access",
            refreshToken: "B-refresh",
            curationCompleted: true,
        });
        await act(async () => {
            renderer = TestRenderer.create(<Login />);
        });
        await flushEffects();
        const inputs = renderer!.root.findAllByType(TextInput);
        act(() => {
            inputs.find((node) =>
                node.props.accessibilityLabel === "이메일"
            )?.props.onChangeText("b@example.com");
            inputs.find((node) =>
                node.props.accessibilityLabel === "비밀번호"
            )?.props.onChangeText("Password1!");
        });

        await act(async () => {
            await findPressable(renderer!, "로그인")?.props.onPress();
        });

        expect(mockedSaveAuthenticatedSession).toHaveBeenCalledTimes(1);
        expect(mockedSaveAuthenticatedSession).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 2,
                accessToken: "B-access",
                refreshToken: "B-refresh",
            }),
        );
        expect(mockRouter.replace).toHaveBeenCalled();
    });

    test("full-session commit 실패면 email login 성공 UI나 private route를 열지 않는다", async () => {
        mockedLoginMember.mockResolvedValue({
            id: 2,
            name: "B",
            accessToken: "B-access",
            refreshToken: "B-refresh",
        });
        mockedSaveAuthenticatedSession.mockRejectedValueOnce(
            new Error("shared member write failed"),
        );
        await act(async () => {
            renderer = TestRenderer.create(<Login />);
        });
        await flushEffects();
        const inputs = renderer!.root.findAllByType(TextInput);
        act(() => {
            inputs.find((node) =>
                node.props.accessibilityLabel === "이메일"
            )?.props.onChangeText("b@example.com");
            inputs.find((node) =>
                node.props.accessibilityLabel === "비밀번호"
            )?.props.onChangeText("Password1!");
        });

        await act(async () => {
            await findPressable(renderer!, "로그인")?.props.onPress();
        });

        expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    test("Naver login은 같은 provider SDK cleanup 전 SDK를 호출하지 않는다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(<Login />);
        });
        await flushEffects();
        const sdkCleanup = deferred<void>();
        registerSocialAuthTransitionBarrier("naver", sdkCleanup.promise);
        mockedLoginWithNaverSdk.mockImplementation(
            () => new Promise(() => undefined),
        );

        act(() => {
            findPressable(renderer!, "네이버로 로그인")?.props.onPress();
        });
        await flushEffects();
        expect(mockedLoginWithNaverSdk).not.toHaveBeenCalled();

        sdkCleanup.resolve();
        await flushEffects();
        expect(mockedLoginWithNaverSdk).toHaveBeenCalledTimes(1);
    });

    test("registered Naver login도 provider 응답 전체를 한 session commit으로 저장한다", async () => {
        mockedLoginWithNaverSdk.mockResolvedValue({
            loginType: "NAVER",
            providerToken: "naver-proof",
            name: "B",
        });
        mockedGetSnsRegistrationStatus.mockResolvedValue({
            registered: true,
        });
        mockedSnsLoginMember.mockResolvedValue({
            id: 2,
            name: "B",
            accessToken: "B-access",
            refreshToken: "B-refresh",
        });
        await act(async () => {
            renderer = TestRenderer.create(<Login />);
        });
        await flushEffects();

        await act(async () => {
            await findPressable(renderer!, "네이버로 로그인")?.props.onPress();
        });

        expect(mockedSaveAuthenticatedSession).toHaveBeenCalledTimes(1);
        expect(mockedSaveAuthenticatedSession).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 2,
                accessToken: "B-access",
                refreshToken: "B-refresh",
            }),
        );
    });

    test("SNS signup network는 pending profile provider cleanup 뒤에만 시작한다", async () => {
        mockedLoginWithNaverSdk.mockResolvedValue({
            loginType: "NAVER",
            providerToken: "naver-proof",
            name: "B",
        });
        await act(async () => {
            renderer = TestRenderer.create(<Login />);
        });
        await flushEffects();
        await act(async () => {
            await findPressable(renderer!, "네이버로 로그인")?.props.onPress();
        });
        const sdkCleanup = deferred<void>();
        registerSocialAuthTransitionBarrier("naver", sdkCleanup.promise);
        mockedSnsSignUpMember.mockImplementation(
            () => new Promise(() => undefined),
        );

        act(() => {
            findPressable(renderer!, "가입 요청 실행")?.props.onPress();
        });
        await flushEffects();
        expect(mockedSnsSignUpMember).not.toHaveBeenCalled();

        sdkCleanup.resolve();
        await flushEffects();
        expect(mockedSnsSignUpMember).toHaveBeenCalledTimes(1);
    });

    test("common signup network는 local cleanup 완료 뒤에만 시작한다", async () => {
        await act(async () => {
            renderer = TestRenderer.create(<SignUp />);
        });
        const inputs = renderer!.root.findAllByType(TextInput);
        act(() => {
            inputs.find((node) =>
                node.props.accessibilityLabel === "이름"
            )?.props.onChangeText("B");
            inputs.find((node) =>
                node.props.accessibilityLabel === "이메일"
            )?.props.onChangeText("b@example.com");
            inputs.find((node) =>
                node.props.accessibilityLabel === "비밀번호"
            )?.props.onChangeText("Password1!");
            inputs.find((node) =>
                node.props.accessibilityLabel === "비밀번호 확인"
            )?.props.onChangeText("Password1!");
        });
        act(() => {
            findPressable(renderer!, "다음")?.props.onPress();
        });
        const cleanup = deferred<void>();
        registerAuthSessionTransitionBarrier(cleanup.promise);
        mockedSignUpMember.mockImplementation(
            () => new Promise(() => undefined),
        );

        act(() => {
            findPressable(renderer!, "가입 요청 실행")?.props.onPress();
        });
        await flushEffects();
        expect(mockedSignUpMember).not.toHaveBeenCalled();

        cleanup.resolve();
        await flushEffects();
        expect(mockedSignUpMember).toHaveBeenCalledTimes(1);
    });

    test("common signup 자동 로그인도 member 전부를 한 session commit으로 저장한다", async () => {
        mockedSignUpMember.mockResolvedValue({
            id: 2,
            name: "B",
        });
        mockedLoginMember.mockResolvedValue({
            id: 2,
            name: "B",
            accessToken: "B-access",
            refreshToken: "B-refresh",
        });
        await act(async () => {
            renderer = TestRenderer.create(<SignUp />);
        });
        const inputs = renderer!.root.findAllByType(TextInput);
        act(() => {
            inputs.find((node) =>
                node.props.accessibilityLabel === "이름"
            )?.props.onChangeText("B");
            inputs.find((node) =>
                node.props.accessibilityLabel === "이메일"
            )?.props.onChangeText("b@example.com");
            inputs.find((node) =>
                node.props.accessibilityLabel === "비밀번호"
            )?.props.onChangeText("Password1!");
            inputs.find((node) =>
                node.props.accessibilityLabel === "비밀번호 확인"
            )?.props.onChangeText("Password1!");
        });
        act(() => {
            findPressable(renderer!, "다음")?.props.onPress();
        });

        await act(async () => {
            await findPressable(renderer!, "가입 요청 실행")?.props.onPress();
        });

        expect(mockedSaveAuthenticatedSession).toHaveBeenCalledTimes(1);
        expect(mockedSaveAuthenticatedSession).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 2,
                accessToken: "B-access",
                refreshToken: "B-refresh",
            }),
        );
    });
});
