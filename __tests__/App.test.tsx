import React from "react";
import * as SecureStore from "expo-secure-store";
import { Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import {
    getMemberCurationStatus,
    logoutMember,
    tokenLoginMember,
} from "../src/api/member";
import { AuthProvider, useAuth } from "../src/modules/auth/AuthContext";
import {
    clearAuthTokens,
    resetAuthStorageMemoryCacheForTests,
} from "../src/modules/auth/authStorage";
import { clearAccountScopedLocalData } from "../src/modules/auth/accountCleanup";
import {
    isDepartureAlarmAccountCleanupPending,
} from "../src/modules/notification/departureAlarmSync";

jest.mock("expo-secure-store", () => ({
    deleteItemAsync: jest.fn(),
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
}));

jest.mock("../src/api/member", () => ({
    getMemberCurationStatus: jest.fn(),
    logoutMember: jest.fn(),
    tokenLoginMember: jest.fn(),
}));

jest.mock("../src/modules/auth/accountCleanup", () => ({
    clearAccountScopedLocalData: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/modules/notification/departureAlarmSync", () => ({
    isDepartureAlarmAccountCleanupPending: jest.fn().mockResolvedValue(false),
}));

const mockedGetItemAsync = jest.mocked(SecureStore.getItemAsync);
const mockedDeleteItemAsync = jest.mocked(SecureStore.deleteItemAsync);
const mockedGetMemberCurationStatus = jest.mocked(getMemberCurationStatus);
const mockedLogoutMember = jest.mocked(logoutMember);
const mockedTokenLoginMember = jest.mocked(tokenLoginMember);
const mockedClearAccountScopedLocalData = jest.mocked(clearAccountScopedLocalData);
const mockedAlarmCleanupPending = jest.mocked(isDepartureAlarmAccountCleanupPending);

function mockStoredSession(curationCompleted = false) {
    mockedGetItemAsync.mockImplementation(async (key) => {
        if (key === "nolte_access_token") return "access-token";
        if (key === "nolte_refresh_token") return "refresh-token";
        if (key === "nolate_auth_member") return JSON.stringify({
            id: 1,
            curationCompleted,
        });
        return null;
    });
}

function AuthState() {
    const { isAuthenticated, isCurationCompleted, isLoading } = useAuth();

    if (isLoading) {
        return <Text>loading</Text>;
    }

    const label = isAuthenticated
        ? isCurationCompleted ? "authenticated-complete" : "authenticated-incomplete"
        : "unauthenticated";
    return <Text>{label}</Text>;
}

function SignOutButton() {
    const { signOut } = useAuth();
    return <Text onPress={signOut}>sign-out</Text>;
}

function FallbackSignOutButton() {
    const { signOut } = useAuth();
    return <Text onPress={signOut}>fallback-sign-out</Text>;
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

    beforeEach(() => {
        resetAuthStorageMemoryCacheForTests();
        mockedGetMemberCurationStatus.mockResolvedValue({ curationCompleted: false });
        mockedAlarmCleanupPending.mockResolvedValue(false);
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        resetAuthStorageMemoryCacheForTests();
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
        mockStoredSession(false);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("authenticated-incomplete");
    });

    it("finishes a crash-marked logout instead of restoring stale credentials", async () => {
        mockStoredSession(false);
        mockedAlarmCleanupPending.mockResolvedValue(true);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("unauthenticated");
        expect(mockedClearAccountScopedLocalData).toHaveBeenCalled();
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_access_token");
        expect(mockedDeleteItemAsync).toHaveBeenCalledWith("nolte_refresh_token");
    });

    it("restores a valid refresh session when cached member metadata is missing", async () => {
        mockedGetItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_refresh_token") return "refresh-token";
            return null;
        });
        mockedTokenLoginMember.mockResolvedValue({
            id: 1,
            name: "복구 사용자",
            accessToken: "restored-access",
            refreshToken: "restored-refresh",
            curationCompleted: true,
        });
        mockedGetMemberCurationStatus.mockResolvedValue({ curationCompleted: true });

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(mockedTokenLoginMember).toHaveBeenCalledWith({ refreshToken: "refresh-token" });
        expect(renderer?.root.findByType(Text).props.children).toBe("authenticated-complete");
    });

    it("uses the server curation state after authentication", async () => {
        mockStoredSession(false);
        mockedGetMemberCurationStatus.mockResolvedValue({ curationCompleted: true });

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("authenticated-complete");
    });

    it("keeps the last completed state while the status API is offline", async () => {
        mockedGetItemAsync.mockImplementation(async (key) => {
            if (key === "nolte_access_token") return "access-token";
            if (key === "nolte_refresh_token") return "refresh-token";
            if (key === "nolate_auth_member") return JSON.stringify({
                id: 1,
                curationCompleted: true,
            });
            return null;
        });
        mockedGetMemberCurationStatus.mockRejectedValue(new Error("offline"));

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("authenticated-complete");
    });

    it("로그아웃하면 서버 토큰 폐기를 시도하고 로컬 토큰을 지운다", async () => {
        mockStoredSession(false);
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
        expect(mockedClearAccountScopedLocalData).toHaveBeenCalled();
    });

    it("인증 인터셉터가 세션을 무효화해도 계정별 캐시를 정리한다", async () => {
        mockStoredSession(true);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                </AuthProvider>
            );
        });
        mockedClearAccountScopedLocalData.mockClear();

        await act(async () => {
            await clearAuthTokens();
        });

        expect(renderer?.root.findByType(Text).props.children).toBe("unauthenticated");
        expect(mockedClearAccountScopedLocalData).toHaveBeenCalledTimes(1);
    });

    it("로그아웃 뒤 늦게 끝난 이전 인증 조회가 세션을 다시 켜지 않는다", async () => {
        mockStoredSession(true);
        let resolveCurationStatus: ((value: { curationCompleted: boolean }) => void) | undefined;
        mockedGetMemberCurationStatus.mockImplementation(() => new Promise((resolve) => {
            resolveCurationStatus = resolve;
        }));

        act(() => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <SignOutButton />
                </AuthProvider>
            );
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(mockedGetMemberCurationStatus).toHaveBeenCalledTimes(1);

        const signOut = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "sign-out",
        );
        await act(async () => {
            await signOut?.props.onPress();
        });
        await act(async () => {
            resolveCurationStatus?.({ curationCompleted: true });
            await Promise.resolve();
        });

        const state = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "unauthenticated",
        );
        expect(state).toBeDefined();
    });

    it("purges account alarms before requesting remote logout", async () => {
        mockStoredSession(false);

        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider>
                    <AuthState />
                    <SignOutButton />
                </AuthProvider>
            );
        });
        const signOut = renderer?.root.findAllByType(Text).find(
            (node) => node.props.children === "sign-out",
        );

        await act(async () => {
            await signOut?.props.onPress();
        });

        expect(mockedClearAccountScopedLocalData.mock.invocationCallOrder[0])
            .toBeLessThan(mockedLogoutMember.mock.invocationCallOrder[0]);
    });

    it("fallback sign-out retains credentials when required alarm purge fails", async () => {
        mockedClearAccountScopedLocalData.mockRejectedValueOnce(
            new Error("native alarm purge failed"),
        );
        act(() => {
            renderer = TestRenderer.create(<FallbackSignOutButton />);
        });
        const signOut = renderer?.root.findByType(Text);

        await expect(signOut?.props.onPress()).rejects.toThrow("native alarm purge failed");
        expect(mockedDeleteItemAsync).not.toHaveBeenCalled();
    });
});
import {
    createPendingPushNavigationQueue,
    createScheduleDetailRoute,
    getNotificationActionCategoryFromData,
    getScheduleDetailRouteFromNotificationData,
    getPushNavigationTargetFromNotificationData,
    getScheduleIdFromNotificationData,
    isPushNavigationReady,
    SCHEDULE_DEPARTURE_ACTION_CATEGORY,
} from "../src/modules/notification/pushNavigation";

describe("schedule push navigation payload", () => {
    test("인증과 온보딩이 끝날 때까지 알림 목적지를 보존한 뒤 한 번만 꺼낸다", () => {
        const queue = createPendingPushNavigationQueue();
        const target = { kind: "scheduleDetail" as const, scheduleId: "42" };
        queue.defer(target);

        expect(queue.consumeIfReady({
            isLoading: true,
            isAuthenticated: false,
            isCurationCompleted: false,
        })).toBeUndefined();
        expect(queue.peek()).toEqual(target);
        expect(queue.consumeIfReady({
            isLoading: false,
            isAuthenticated: true,
            isCurationCompleted: false,
        })).toBeUndefined();
        expect(queue.consumeIfReady({
            isLoading: false,
            isAuthenticated: true,
            isCurationCompleted: true,
        })).toEqual(target);
        expect(queue.peek()).toBeUndefined();
    });

    test("보호된 화면은 인증·온보딩 완료 상태에서만 푸시 이동 준비가 된다", () => {
        expect(isPushNavigationReady({
            isLoading: false,
            isAuthenticated: true,
            isCurationCompleted: true,
        })).toBe(true);
        expect(isPushNavigationReady({
            isLoading: false,
            isAuthenticated: false,
            isCurationCompleted: true,
        })).toBe(false);
    });

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
        { scheduleId: "0" },
        { scheduleId: "-1" },
        { scheduleId: 42 },
        { scheduleId: null },
    ])("잘못된 payload에서는 화면 이동을 하지 않는다: %p", (data) => {
        expect(getScheduleIdFromNotificationData(data as Record<string, unknown> | undefined)).toBeUndefined();
    });

    test.each([
        "SCHEDULE_TRAFFIC",
        "SCHEDULE_DEPARTURE_REMINDER",
        "SCHEDULE_DETAIL",
        "SCHEDULE_SHARE_RECEIVED",
        "SCHEDULE_PARTICIPANT_DEPARTED",
        "SCHEDULE_DEPARTURE_NUDGE",
        "ROUTE_SETUP_REMINDER",
        undefined,
    ])("일정 상세 이동 payload를 해석한다: %p", (type) => {
        expect(getPushNavigationTargetFromNotificationData({ type, scheduleId: "42" })).toEqual({
            kind: "scheduleDetail",
            scheduleId: "42",
        });
    });

    test.each([
        { type: "CATEGORY_SHARE_RECEIVED", categoryId: "7" },
        { type: "CALENDAR_SHARE_RECEIVED", calendarId: "9" },
    ])("카테고리와 캘린더 공유 알림은 공유함으로 이동한다: %p", (data) => {
        expect(getPushNavigationTargetFromNotificationData({
            ...data,
        })).toEqual({
            kind: "shareInbox",
        });
    });

    test.each([
        { type: "PUSH_SCENARIO_TOKEN_CHECK" },
        { type: "UNKNOWN", scheduleId: "42" },
        { type: "SCHEDULE_TRAFFIC", scheduleId: "0" },
        { type: "SCHEDULE_DETAIL" },
    ])("이동 대상이 아닌 payload는 무시한다: %p", (data) => {
        expect(getPushNavigationTargetFromNotificationData(data)).toBeUndefined();
    });

    test("일정 상세 route를 생성한다", () => {
        expect(createScheduleDetailRoute("42")).toEqual({
            pathname: "/schedule/[id]",
            params: { id: "42", openRouteDetail: "1" },
        });
    });

    test("알림 payload에서 일정 상세 route를 생성한다", () => {
        expect(getScheduleDetailRouteFromNotificationData({
            type: "SCHEDULE_DEPARTURE_REMINDER",
            scheduleId: "42",
        })).toEqual({
            pathname: "/schedule/[id]",
            params: { id: "42", openRouteDetail: "1" },
        });
    });

    test.each([
        { type: "SCHEDULE_DEPARTURE_REMINDER", scheduleId: "42", departNow: "false" },
        { type: "SCHEDULE_DEPARTURE_REMINDER", scheduleId: "42", departNow: "true" },
    ])("출발 리마인더에는 알림 액션 카테고리를 붙인다: %p", (data) => {
        expect(getNotificationActionCategoryFromData(data)).toBe(SCHEDULE_DEPARTURE_ACTION_CATEGORY);
    });

    test.each([
        { type: "SCHEDULE_TRAFFIC", scheduleId: "42" },
        { type: "SCHEDULE_PARTICIPANT_DEPARTED", scheduleId: "42" },
        { type: "SCHEDULE_DEPARTURE_NUDGE", scheduleId: "42" },
        { type: "SCHEDULE_DEPARTURE_REMINDER", scheduleId: "0" },
        { type: "SCHEDULE_DEPARTURE_REMINDER" },
    ])("출발 리마인더가 아니면 알림 액션 카테고리를 붙이지 않는다: %p", (data) => {
        expect(getNotificationActionCategoryFromData(data)).toBeUndefined();
    });
});
