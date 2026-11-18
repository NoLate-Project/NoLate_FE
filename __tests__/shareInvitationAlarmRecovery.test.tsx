import React from "react";
import { Dimensions } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

const mockAcceptShareInvitation = jest.fn();
const mockGetShareInbox = jest.fn();
const mockRecoverDepartureAlarmsAfterMutation = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterDismissTo = jest.fn();
let mockIsAuthenticated = true;
const mockSearchParams: {
    token: string;
    autoAccept?: string;
} = {
    token: "abcdefghijklmnop",
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => mockSearchParams,
    useRouter: () => ({
        replace: mockRouterReplace,
        dismissTo: mockRouterDismissTo,
    }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../src/api/scheduleSharing", () => ({
    acceptShareInvitation: (...args: unknown[]) =>
        mockAcceptShareInvitation(...args),
    getShareInbox: () => mockGetShareInbox(),
}));
jest.mock("../src/modules/auth/AuthContext", () => ({
    useAuth: () => ({
        isAuthenticated: mockIsAuthenticated,
        isCurationCompleted: true,
        isLoading: false,
    }),
}));
jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
}));
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        colors: {
            background: "#fff",
            border: "#ddd",
            surface: "#fff",
            textPrimary: "#111",
            textSecondary: "#555",
        },
        mode: "light",
    }),
}));
jest.mock("../src/ui/BrandedLoader", () => "BrandedLoader");

import ShareInvitationAcceptScreen from "../app/share/[token]";
import { ApiResponseError } from "../src/api/response";

describe("share invitation departure-alarm recovery", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockIsAuthenticated = true;
        mockGetShareInbox.mockResolvedValue({ receivedShares: [] });
        mockSearchParams.token = "abcdefghijklmnop";
        delete mockSearchParams.autoAccept;
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    it("carries the invitation into login only when the recipient chooses to accept it", async () => {
        mockIsAuthenticated = false;
        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
        });

        const press = (label: string) => act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: label }).props.onPress();
        });

        await press("로그인 화면으로 돌아가기");
        expect(mockRouterReplace).toHaveBeenLastCalledWith("/auth/login");

        await press("로그인하고 수락");
        expect(mockRouterReplace).toHaveBeenLastCalledWith({
            pathname: "/auth/login",
            params: { shareToken: "abcdefghijklmnop" },
        });
        expect(mockAcceptShareInvitation).not.toHaveBeenCalled();
    });

    it("awaits one recovery after invitation acceptance succeeds", async () => {
        mockAcceptShareInvitation.mockResolvedValue({
            scheduleTitle: "  팀 디자인 회의  ",
            invitation: {
                id: "1",
                resourceType: "SCHEDULE",
                resourceId: "41",
                ownerMemberId: 7,
                permission: "VIEWER",
                status: "ACCEPTED",
                expiresAt: "2099-01-01T00:00:00Z",
                maxAcceptCount: 1,
                acceptedCount: 1,
            },
            share: {
                id: "2",
                resourceId: "41",
                ownerMemberId: 7,
                targetMemberId: 8,
                permission: "VIEWER",
                status: "ACTIVE",
            },
        });

        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
            await Promise.resolve();
        });
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "공유함에서 보기" })).toHaveLength(0);
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "공유 초대 수락" })
                .props.onPress();
        });

        expect(mockAcceptShareInvitation).toHaveBeenCalledWith("abcdefghijklmnop");
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockAcceptShareInvitation.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
        expect(renderer!.root.findByProps({ accessibilityRole: "header" }).props.children).toBe("팀 디자인 회의");
        expect(mockGetShareInbox).not.toHaveBeenCalled();
        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "공유 초대 수락",
        })).toHaveLength(0);
        await act(async () => renderer!.root.findByProps({ accessibilityLabel: "공유함에서 보기" }).props.onPress());
        expect(mockRouterReplace).toHaveBeenLastCalledWith({
            pathname: "/share/inbox",
            params: { tab: "schedule", focusScheduleId: "41" },
        });
        await act(async () => renderer!.root.findByProps({ accessibilityLabel: "받은 일정 열기" }).props.onPress());
        expect(mockRouterReplace).toHaveBeenLastCalledWith({
            pathname: "/schedule/[id]",
            params: { id: "41" },
        });
    });

    it("opens the calendar membership returned by a calendar invitation", async () => {
        mockAcceptShareInvitation.mockResolvedValue({
            calendarTitle: "  주간 회의  ",
            invitation: {
                id: "1",
                resourceType: "CALENDAR",
                resourceId: "73",
                ownerMemberId: 7,
                permission: "EDITOR",
                status: "ACCEPTED",
                expiresAt: "2099-01-01T00:00:00Z",
                maxAcceptCount: 1,
                acceptedCount: 1,
            },
            share: {
                id: "2",
                resourceId: "73",
                ownerMemberId: 7,
                targetMemberId: 8,
                permission: "EDITOR",
                status: "ACTIVE",
            },
            calendarMembership: {
                id: 2,
                calendarId: 73,
                memberId: 8,
                role: "EDITOR",
                status: "ACTIVE",
                routeReminderEnabled: false,
            },
        });

        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "공유 초대 수락" })
                .props.onPress();
        });
        expect(renderer!.root.findAllByProps({ accessibilityRole: "header", children: "주간 회의" }).length).toBeGreaterThan(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "공유함에서 보기" })).toHaveLength(0);
        expect(mockGetShareInbox).not.toHaveBeenCalled();
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "캘린더 설정 열기" })
                .props.onPress();
        });

        expect(mockRouterReplace).toHaveBeenCalledWith({
            pathname: "/schedule/calendars",
            params: { id: "73", view: "settings" },
        });
    });

    it("falls back to the invitation resource id for older calendar responses", async () => {
        mockGetShareInbox.mockResolvedValue({ receivedShares: [
            { resourceId: "74", resourceType: "SCHEDULE", title: "다른 일정" },
            { resourceId: "74", resourceType: "CALENDAR", title: "러닝 모임" },
        ] });
        mockAcceptShareInvitation.mockResolvedValue({
            invitation: {
                id: "1",
                resourceType: "CALENDAR",
                resourceId: "74",
                ownerMemberId: 7,
                permission: "VIEWER",
                status: "ACCEPTED",
                expiresAt: "2099-01-01T00:00:00Z",
                maxAcceptCount: 1,
                acceptedCount: 1,
            },
            share: {
                id: "2",
                resourceId: "74",
                ownerMemberId: 7,
                targetMemberId: 8,
                permission: "VIEWER",
                contentMode: "SCHEDULE_AND_TRAVEL",
                status: "ACTIVE",
            },
        });

        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
            await Promise.resolve();
        });
        expect(mockGetShareInbox).not.toHaveBeenCalled();
        expect(renderer!.root.findAllByProps({ children: "러닝 모임" })).toHaveLength(0);
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "공유 초대 수락" })
                .props.onPress();
        });
        expect(renderer!.root.findAllByProps({ accessibilityRole: "header", children: "러닝 모임" }).length).toBeGreaterThan(0);
        expect(renderer!.root.findAllByProps({ children: "일정 + 각자 경로" }).length).toBeGreaterThan(0);
        expect(renderer!.root.findAllByProps({ children: "캘린더 정보 보기" }).length).toBeGreaterThan(0);
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "캘린더 정보 보기" })
                .props.onPress();
        });

        expect(mockRouterReplace).toHaveBeenCalledWith({
            pathname: "/schedule/calendars",
            params: { id: "74", view: "calendar" },
        });
    });

    it("does not pass an unsafe calendar id to the calendar screen", async () => {
        mockAcceptShareInvitation.mockResolvedValue({
            invitation: {
                id: "1",
                resourceType: "CALENDAR",
                resourceId: "not-a-calendar",
                ownerMemberId: 7,
                permission: "VIEWER",
                status: "ACCEPTED",
                expiresAt: "2099-01-01T00:00:00Z",
                maxAcceptCount: 1,
                acceptedCount: 1,
            },
            share: {
                id: "2",
                resourceId: "not-a-calendar",
                ownerMemberId: 7,
                targetMemberId: 8,
                permission: "VIEWER",
                status: "ACTIVE",
            },
        });

        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "공유 초대 수락" })
                .props.onPress();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "캘린더 정보 보기" })
                .props.onPress();
        });

        expect(mockRouterReplace).toHaveBeenCalledWith("/schedule/calendars");
    });

    it("does not duplicate recovery while auto-accepting the same invitation", async () => {
        const pendingRecovery = deferred<void>();
        mockSearchParams.autoAccept = "1";
        mockAcceptShareInvitation.mockResolvedValue({
            invitation: {
                id: "1",
                resourceType: "SCHEDULE",
                resourceId: "41",
                ownerMemberId: 7,
                permission: "VIEWER",
                status: "ACCEPTED",
                expiresAt: "2099-01-01T00:00:00Z",
                maxAcceptCount: 1,
                acceptedCount: 1,
            },
            share: {
                id: "2",
                resourceId: "41",
                ownerMemberId: 7,
                targetMemberId: 8,
                permission: "VIEWER",
                status: "ACTIVE",
            },
        });
        mockRecoverDepartureAlarmsAfterMutation.mockReturnValueOnce(
            pendingRecovery.promise,
        );

        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockAcceptShareInvitation).toHaveBeenCalledTimes(1);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);

        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "공유 초대 수락 중" })
                .props.onPress();
        });

        expect(mockAcceptShareInvitation).toHaveBeenCalledTimes(1);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);

        await act(async () => {
            pendingRecovery.resolve();
            await pendingRecovery.promise;
            await Promise.resolve();
        });

        expect(mockAcceptShareInvitation).toHaveBeenCalledWith("abcdefghijklmnop");
        expect(mockAcceptShareInvitation).toHaveBeenCalledTimes(1);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["초대 링크가 만료되었습니다.", "초대 링크가 만료됐어요"],
        ["폐기된 초대 링크입니다.", "초대 링크가 비활성화됐어요"],
        ["초대 링크 수락 가능 횟수를 초과했습니다.", "사용할 수 없는 초대 링크예요"],
    ])("offers a new link and calendar return for %s", async (message, title) => {
        mockAcceptShareInvitation.mockRejectedValue(new Error(message));
        await act(async () => { renderer = TestRenderer.create(<ShareInvitationAcceptScreen />); });
        await act(async () => {
            await renderer!.root.findByProps({ accessibilityLabel: "공유 초대 수락" }).props.onPress();
        });
        expect(renderer!.root.findAllByProps({ accessibilityRole: "header", children: title }).length).toBeGreaterThan(0);
        expect(renderer!.root.findAllByProps({ children: "보낸 사람에게 새 초대 링크를 요청해 주세요." }).length).toBeGreaterThan(0);
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "캘린더로 돌아가기" }).props.onPress();
        });
        expect(mockRouterDismissTo).toHaveBeenCalledWith("/schedule");
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "공유 초대 수락" })).toHaveLength(0);
        expect(mockGetShareInbox).not.toHaveBeenCalled();
    });

    it.each(["invalid", "abcdefghijklmnop"])("offers a fresh link when %s cannot be found", async (token) => {
        mockSearchParams.token = token;
        mockAcceptShareInvitation.mockRejectedValue(new ApiResponseError(
            "일정 공유 초대가 존재하지 않습니다.",
            { errorCode: "S007", status: 404 },
        ));
        await act(async () => { renderer = TestRenderer.create(<ShareInvitationAcceptScreen />); });
        const accept = renderer!.root.findAllByProps({ accessibilityLabel: "공유 초대 수락" })[0];
        if (token === "invalid") {
            expect(accept).toBeUndefined();
            expect(mockAcceptShareInvitation).not.toHaveBeenCalled();
        } else {
            await act(async () => { await accept.props.onPress(); });
            expect(mockAcceptShareInvitation).toHaveBeenCalledWith(token);
        }
        expect(renderer!.root.findAllByProps({
            accessibilityRole: "header", children: "유효하지 않은 초대 링크예요",
        }).length).toBeGreaterThan(0);
        expect(renderer!.root.findAllByProps({ children: "보낸 사람에게 새 초대 링크를 요청해 주세요." }).length).toBeGreaterThan(0);
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "캘린더로 돌아가기" }).props.onPress();
        });
        expect(mockRouterDismissTo).toHaveBeenCalledWith("/schedule");
        expect(mockGetShareInbox).not.toHaveBeenCalled();
    });

    it.each(["accept failed", "로그인 세션이 만료되었어요."])("keeps retry available after %s", async (message) => {
        mockAcceptShareInvitation.mockRejectedValue(new Error(message));
        const getDimensions = Dimensions.get.bind(Dimensions);
        jest.spyOn(Dimensions, "get").mockImplementation(name => ({
            ...getDimensions(name), fontScale: 1,
        }));

        await act(async () => {
            renderer = TestRenderer.create(<ShareInvitationAcceptScreen />);
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "공유 초대 수락" })
                .props.onPress();
        });

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
        const retry = renderer!.root.findByProps({ accessibilityLabel: "다시 시도" });
        expect(retry.props.disabled).toBe(false);
        expect(renderer!.root.findAllByProps({
            accessibilityRole: "header", children: "초대를 수락하지 못했어요",
        }).length).toBeGreaterThan(0);
        expect(renderer!.root.findByProps({
            accessibilityRole: "alert",
        })).toBeTruthy();
        await act(async () => { await retry.props.onPress(); });
        expect(mockAcceptShareInvitation).toHaveBeenCalledTimes(2);
    });

    it("returns to the calendar for a blocked invitation without naming the blocking party", async () => {
        mockAcceptShareInvitation.mockRejectedValue(new ApiResponseError(
            "차단 관계에 있는 회원과는 공유할 수 없습니다.",
            { errorCode: "S011", status: 403 },
        ));
        await act(async () => { renderer = TestRenderer.create(<ShareInvitationAcceptScreen />); });
        await act(async () => {
            await renderer!.root.findByProps({ accessibilityLabel: "공유 초대 수락" }).props.onPress();
        });
        expect(renderer!.root.findAllByProps({ children: "차단 관계에 있는 사용자와는 공유할 수 없어요." }).length).toBeGreaterThan(0);
        expect(renderer!.root.findAllByProps({ children: "캘린더로 돌아가기" }).length).toBeGreaterThan(0);
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "공유 초대 수락" })).toHaveLength(0);
    });
});

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
} {
    let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}
