import React from "react";
import * as SecureStore from "expo-secure-store";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { logoutMember } from "../src/api/member";
import { AuthProvider, useAuth } from "../src/modules/auth/AuthContext";

jest.mock("expo-secure-store", () => ({
    deleteItemAsync: jest.fn(),
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
}));

jest.mock("../src/api/member", () => ({
    logoutMember: jest.fn(),
}));

const mockedGetItemAsync = jest.mocked(SecureStore.getItemAsync);
const mockedDeleteItemAsync = jest.mocked(SecureStore.deleteItemAsync);
const mockedLogoutMember = jest.mocked(logoutMember);

function AuthState() {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return <Text>loading</Text>;
    }

    return <Text>{isAuthenticated ? "authenticated" : "unauthenticated"}</Text>;
}

function SignOutButton() {
    const { signOut } = useAuth();
    return <Text onPress={signOut}>sign-out</Text>;
}

describe("AuthProvider", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        jest.clearAllMocks();
    });

    it("marks the user as unauthenticated when the access JWT is missing", async () => {
        mockedGetItemAsync.mockResolvedValue(null);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("unauthenticated");
    });

    it("marks the user as authenticated when the access JWT exists", async () => {
        mockedGetItemAsync.mockResolvedValue("access-token");

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("authenticated");
    });

    it("로그아웃하면 서버 토큰 폐기를 시도하고 로컬 토큰을 지운다", async () => {
        mockedGetItemAsync
            .mockResolvedValueOnce("access-token")
            .mockResolvedValueOnce("refresh-token");
        mockedLogoutMember.mockResolvedValue(undefined);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <SignOutButton />
                </AuthProvider>
            );
        });

        await act(async () => {
            await renderer?.root.findByType(Text).props.onPress();
        });

        expect(mockedLogoutMember).toHaveBeenCalledWith({ refreshToken: "refresh-token" });
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_access_token");
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_refresh_token");
    });
});
import { getScheduleIdFromNotificationData } from "../src/modules/notification/pushNavigation";

describe("schedule push navigation payload", () => {
    test("Android와 iOS가 공유하는 문자열 scheduleId를 반환한다", () => {
        expect(getScheduleIdFromNotificationData({ scheduleId: "42" })).toBe("42");
    });

    test("앞뒤 공백을 제거해 동일 일정으로 이동한다", () => {
        expect(getScheduleIdFromNotificationData({ scheduleId: "  42  " })).toBe("42");
    });

    test.each([
        undefined,
        {},
        { scheduleId: "" },
        { scheduleId: "   " },
        { scheduleId: 42 },
        { scheduleId: null },
    ])("잘못된 payload에서는 화면 이동을 하지 않는다: %p", (data) => {
        expect(getScheduleIdFromNotificationData(data as Record<string, unknown> | undefined)).toBeUndefined();
    });
});
