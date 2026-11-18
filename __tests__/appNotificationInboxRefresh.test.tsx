import React from "react";
import { Animated, AppState, Dimensions, FlatList } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { AppNotificationScreen } from "../app/notifications";
import { getAppNotificationInbox, markAppNotificationRead, type AppNotification } from "../src/api/notification";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import { playNotificationInboxReturn } from "../src/routeSupport/share/notificationInboxReturn";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
let mockIsFocused = true;
const mockRouter = { push: jest.fn() };

jest.mock("@react-navigation/native", () => ({
    useIsFocused: () => mockIsFocused,
    useRoute: () => ({ key: "test-notification-inbox" }),
}));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock("../src/api/notification", () => ({ getAppNotificationInbox: jest.fn(), markAppNotificationRead: jest.fn() }));
jest.mock("../src/modules/performance/ImmediateNavigationTransition", () => ({
    useImmediateNavigationTransition: () => ({ runWithTransitionShell: jest.fn() }),
}));
jest.mock("../src/modules/performance/useSystemReduceMotion", () => ({
    useSystemReduceMotion: () => false,
}));
jest.mock("../src/modules/performance/runAfterScreenTransition", () => ({
    runAfterScreenTransition: (callback: () => void) => {
        void Promise.resolve().then(callback);
        return { cancel: jest.fn() };
    },
}));

function notification(id: number): AppNotification {
    return {
        id, type: "SCHEDULE_SHARE_RECEIVED", scheduleId: id, categoryId: null,
        title: `일정 ${id}`, body: "", data: {}, read: false, readAt: null,
        createdAt: "2026-11-14T12:00:00Z",
    };
}

it("refreshes through the previously loaded page and keeps all rows if its refresh fails", async () => {
    const getInbox = jest.mocked(getAppNotificationInbox);
    getInbox.mockReset()
        .mockResolvedValueOnce({ items: [notification(5), notification(4)], nextCursor: 4, unreadCount: 4 })
        .mockResolvedValueOnce({ items: [notification(3), notification(2)], nextCursor: null, unreadCount: 4 })
        .mockResolvedValueOnce({ items: [notification(6), notification(5)], nextCursor: 5, unreadCount: 5 })
        .mockRejectedValueOnce(new Error("Second page unavailable"))
        .mockResolvedValueOnce({ items: [notification(6), notification(5)], nextCursor: 5, unreadCount: 5 })
        .mockResolvedValueOnce({ items: [notification(4), notification(3)], nextCursor: 3, unreadCount: 5 })
        .mockResolvedValueOnce({ items: [notification(2)], nextCursor: null, unreadCount: 5 });
    let goForeground: () => void = () => { throw new Error("Missing AppState listener"); };
    const appState = jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
        goForeground = () => listener("active");
        return { remove: jest.fn() };
    });
    let view: ReturnType<typeof TestRenderer.create> | undefined;
    const getIds = () => view!.root.findByType(FlatList).props.data.map((item: AppNotification) => item.id);
    try {
        await act(async () => { view = TestRenderer.create(<ThemeProvider><AppNotificationScreen /></ThemeProvider>); });
        const loadMore = view!.root.findAllByProps({ accessibilityLabel: "이전 알림 더 보기" })[0];
        await act(async () => { await loadMore.props.onPress(); });
        expect(getIds()).toEqual([5, 4, 3, 2]);

        await act(async () => { goForeground(); });
        expect(getIds()).toEqual([5, 4, 3, 2]);

        await act(async () => { goForeground(); });
        expect(getIds()).toEqual([6, 5, 4, 3, 2]);
        expect(getInbox.mock.calls.slice(4).map(([query]) => query?.cursorId)).toEqual([undefined, 5, 3]);
    } finally {
        await act(async () => { view?.unmount(); });
        appState.mockRestore();
    }
});

it.each([
    ["Network unavailable", "네트워크 상태를 확인한 뒤 다시 시도해 주세요."],
    ["Request failed with status code 503", null],
])("waits for a successful unread load after %s before showing the empty result", async (error, caption) => {
    const empty = { items: [], nextCursor: null, unreadCount: 0 };
    let finishRetry!: (value: typeof empty) => void;
    jest.mocked(getAppNotificationInbox).mockReset()
        .mockResolvedValueOnce(empty)
        .mockRejectedValueOnce(new Error(error))
        .mockImplementationOnce(() => new Promise(resolve => { finishRetry = resolve; }));
    const getDimensions = Dimensions.get.bind(Dimensions);
    const dimensions = jest.spyOn(Dimensions, "get").mockImplementation(name => ({
        ...getDimensions(name), fontScale: 1,
    }));
    const appState = jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
    let view: ReturnType<typeof TestRenderer.create> | undefined;
    const text = (children: string) => view!.root.findAllByProps({ children }).length;
    try {
        await act(async () => { view = TestRenderer.create(<ThemeProvider><AppNotificationScreen /></ThemeProvider>); });
        const unreadTab = view!.root.findAllByProps({ accessibilityLabel: "읽지 않음" })[0];
        await act(async () => { unreadTab.props.onPress(); });
        expect(text("알림을 불러오지 못했어요.")).toBeGreaterThan(0);
        expect(text(error)).toBe(0);
        if (caption) expect(text(caption)).toBeGreaterThan(0);
        expect(text("읽지 않은 알림이 없어요")).toBe(0);
        const retry = view!.root.findAllByProps({ accessibilityLabel: "다시 시도" })[0];
        await act(async () => { void retry.props.onPress(); });
        expect(view!.root.findAllByProps({ accessibilityLabel: "알림 불러오는 중" }).length).toBeGreaterThan(0);
        expect(text("읽지 않은 알림이 없어요")).toBe(0);
        await act(async () => { finishRetry(empty); });
        expect(text("읽지 않은 알림이 없어요")).toBeGreaterThan(0);
        expect(text("새 알림이 오면 여기에 표시됩니다.")).toBeGreaterThan(0);
    } finally {
        await act(async () => { view?.unmount(); });
        dimensions.mockRestore();
        appState.mockRestore();
    }
});

it("retries the failed read in the inbox without reopening the destination", async () => {
    const getInbox = jest.mocked(getAppNotificationInbox);
    const markRead = jest.mocked(markAppNotificationRead);
    getInbox.mockReset().mockResolvedValue({ items: [notification(5)], nextCursor: null, unreadCount: 1 });
    markRead.mockReset()
        .mockRejectedValueOnce(new Error("Read write unavailable"))
        .mockResolvedValueOnce({ ...notification(5), read: true });
    const getDimensions = Dimensions.get.bind(Dimensions);
    const dimensions = jest.spyOn(Dimensions, "get").mockImplementation(name => ({
        ...getDimensions(name), fontScale: 1,
    }));
    const appState = jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
    let view: ReturnType<typeof TestRenderer.create> | undefined;
    const find = (accessibilityLabel: string) => view!.root.findAllByProps({ accessibilityLabel })[0];
    mockRouter.push.mockClear();
    try {
        await act(async () => { view = TestRenderer.create(<ThemeProvider><AppNotificationScreen /></ThemeProvider>); });
        await act(async () => { find("읽지 않음 1개").props.onPress(); });
        const row = view!.root.findAllByProps({ accessibilityHint: "일정 보기" })[0];
        await act(async () => { row.props.onPress(); });
        expect(markRead).toHaveBeenCalledTimes(1);
        expect(find("읽지 않음 1개")).toBeDefined();
        expect(view!.root.findByType(FlatList).props.maintainVisibleContentPosition).toBeUndefined();
        const retry = find("알림 읽음 처리 다시 시도");
        await act(async () => { retry.props.onPress(); });
        expect(markRead.mock.calls).toEqual([[5], [5]]);
        expect(mockRouter.push).toHaveBeenCalledTimes(1);
        expect(getInbox).toHaveBeenCalledTimes(2);
        expect(find("알림 읽음 처리 다시 시도")).toBeUndefined();
        expect(view!.root.findAllByProps({ children: "읽지 않은 알림이 없어요" }).length).toBeGreaterThan(0);
    } finally {
        await act(async () => { view?.unmount(); });
        dimensions.mockRestore();
        appState.mockRestore();
    }
});

it("plays the inbox return before dispatching the destination's back action", async () => {
    jest.mocked(getAppNotificationInbox).mockReset().mockResolvedValue({
        items: [{ ...notification(5), read: true }], nextCursor: null, unreadCount: 0,
    });
    const animation = { start: jest.fn<void, [((result: { finished: boolean }) => void)?]>(), stop: jest.fn(), reset: jest.fn() };
    const timing = jest.spyOn(Animated, "timing").mockReturnValue(animation);
    const getDimensions = Dimensions.get.bind(Dimensions);
    const dimensions = jest.spyOn(Dimensions, "get").mockImplementation(name => ({
        ...getDimensions(name), fontScale: 1,
    }));
    const appState = jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
    const render = () => <ThemeProvider><AppNotificationScreen /></ThemeProvider>;
    const returnMotions = () => timing.mock.calls.filter(([, config]) => config.duration === 180);
    let view: ReturnType<typeof TestRenderer.create> | undefined;
    mockRouter.push.mockClear();
    try {
        await act(async () => { view = TestRenderer.create(render()); });
        const row = view!.root.findAllByProps({ accessibilityHint: "일정 보기" })[0];
        await act(async () => { row.props.onPress(); });
        expect(mockRouter.push).toHaveBeenCalledWith({
            pathname: "/schedule/[id]", params: {
                id: "5", openRouteDetail: "1", entrySource: "notification-inbox", notificationInboxKey: "test-notification-inbox",
            },
        });
        mockIsFocused = false;
        await act(async () => { view!.update(render()); });
        expect(returnMotions()).toHaveLength(0);

        const finish = jest.fn();
        await act(async () => { playNotificationInboxReturn("test-notification-inbox", finish); });
        expect(returnMotions()).toHaveLength(1);
        expect(finish).not.toHaveBeenCalled();
        act(() => animation.start.mock.lastCall?.[0]?.({ finished: true }));
        expect(finish).toHaveBeenCalledTimes(1);

        mockIsFocused = true;
        await act(async () => { view!.update(render()); });
        expect(returnMotions()).toHaveLength(1);
    } finally {
        mockIsFocused = true;
        await act(async () => { view?.unmount(); });
        timing.mockRestore();
        dimensions.mockRestore();
        appState.mockRestore();
    }
});
