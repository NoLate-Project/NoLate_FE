import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Text } from "react-native";

const mockGetScheduleCalendars = jest.fn();
const mockGetScheduleCalendarMembers = jest.fn();
const mockUpdateScheduleCalendar = jest.fn();
const mockUpdateMyScheduleCalendarPreferences = jest.fn();
const mockArchiveScheduleCalendar = jest.fn();
const mockLeaveScheduleCalendar = jest.fn();
const mockRecoverDepartureAlarmsAfterMutation = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
const mockCloseActiveScene = jest.fn(() => false);
const mockRunWithTransitionShell = jest.fn((_shell: unknown, action: () => void) => action());

jest.mock("../src/modules/performance/ImmediateNavigationTransition", () => ({
    useImmediateNavigationTransition: () => ({
        closeActiveScene: mockCloseActiveScene,
        runWithTransitionShell: mockRunWithTransitionShell,
    }),
}));
const mockParams: { id?: string; view?: string } = {};
let calendarResponse: ScheduleCalendar[];
let mockCachedCalendarResponse: ScheduleCalendar[] | null;
let mockScreenFocused = true;

// Preserve alarm-recovery assertions without importing the native ESM navigator.
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockScreenFocused }));

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => mockParams,
    useRouter: () => ({
        canGoBack: () => false,
        replace: mockRouterReplace,
        push: mockRouterPush,
    }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../src/api/scheduleCalendars", () => ({
    archiveScheduleCalendar: (...args: unknown[]) =>
        mockArchiveScheduleCalendar(...args),
    createScheduleCalendar: jest.fn(),
    getScheduleCalendarMembers: (...args: unknown[]) =>
        mockGetScheduleCalendarMembers(...args),
    getScheduleCalendars: () => mockGetScheduleCalendars(),
    leaveScheduleCalendar: (...args: unknown[]) =>
        mockLeaveScheduleCalendar(...args),
    removeScheduleCalendarMember: jest.fn(),
    transferScheduleCalendarOwnership: jest.fn(),
    updateMyScheduleCalendarPreferences: (...args: unknown[]) =>
        mockUpdateMyScheduleCalendarPreferences(...args),
    updateScheduleCalendar: (...args: unknown[]) =>
        mockUpdateScheduleCalendar(...args),
    updateScheduleCalendarMember: jest.fn(),
}));
jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
}));
jest.mock("../src/modules/schedule/scheduleCalendarMemoryCache", () => ({
    getCachedScheduleCalendars: () => mockCachedCalendarResponse,
}));
jest.mock("../src/modules/schedule/components/share/ShareInvitationSheet", () => "ShareInvitationSheet");
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        colors: {
            background: "#fff",
            border: "#ddd",
            inputBackground: "#fff",
            inputBorder: "#ddd",
            inputPlaceholder: "#777",
            surface: "#fff",
            surface2: "#f5f5f5",
            textPrimary: "#111",
            textSecondary: "#555",
        },
        mode: "light",
    }),
}));
jest.mock("../src/ui/BrandedLoader", () => "BrandedLoader");

import ScheduleCalendarsScreen from "../app/schedule/calendars";
import type {
    ScheduleCalendar,
    ScheduleCalendarMember,
} from "../src/api/scheduleCalendars";

const ownerCalendar: ScheduleCalendar = {
    id: 7,
    title: "가족",
    color: "#2F80FF",
    defaultContentMode: "SCHEDULE_AND_TRAVEL",
    status: "ACTIVE",
    ownerMemberId: 1,
    myRole: "OWNER",
    memberCount: 1,
    routeReminderEnabled: true,
};

const secondOwnerCalendar: ScheduleCalendar = {
    ...ownerCalendar,
    id: 8,
    title: "업무",
    color: "#AF52DE",
};

const familyMember: ScheduleCalendarMember = {
    id: 71,
    calendarId: 7,
    memberId: 1,
    role: "OWNER",
    status: "ACTIVE",
    routeReminderEnabled: true,
    name: "가족 멤버",
};

const workMember: ScheduleCalendarMember = {
    id: 81,
    calendarId: 8,
    memberId: 2,
    role: "OWNER",
    status: "ACTIVE",
    routeReminderEnabled: true,
    name: "업무 멤버",
};

describe("schedule calendar departure-alarm recovery", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockCloseActiveScene.mockReturnValue(false);
        delete mockParams.id;
        delete mockParams.view;
        calendarResponse = [ownerCalendar];
        mockCachedCalendarResponse = null;
        mockScreenFocused = true;
        mockGetScheduleCalendarMembers.mockResolvedValue([]);
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
        jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    async function renderScreen(): Promise<void> {
        const calendarLoad = deferred<ScheduleCalendar[]>();
        mockGetScheduleCalendars.mockReturnValueOnce(calendarLoad.promise);
        await act(() => {
            renderer = TestRenderer.create(<ScheduleCalendarsScreen />);
        });
        await act(async () => {
            calendarLoad.resolve(calendarResponse);
            await calendarLoad.promise;
        });
        for (let attempt = 0; attempt < 6; attempt += 1) {
            await act(async () => {
                await Promise.resolve();
            });
        }
    }

    it.each([false, true])("shows list recovery after a failed load (focused=%s)", async (focused) => {
        if (focused) Object.assign(mockParams, { id: "7", view: "calendar" });
        mockGetScheduleCalendars
            .mockRejectedValueOnce(new Error("503"))
            .mockResolvedValueOnce([ownerCalendar]);
        await act(async () => {
            renderer = TestRenderer.create(<ScheduleCalendarsScreen />);
        });
        const root = renderer!.root;
        const readText = () => root.findAllByType(Text)
            .map(node => React.Children.toArray(node.props.children).join("")).join("\n");
        expect(readText()).toContain("공유 캘린더를 불러오지 못했어요.");
        expect(readText()).not.toContain("공유 캘린더가 없어요");
        expect(readText()).not.toContain("이 공유 캘린더를 열 수 없어요.");
        expect(Alert.alert).not.toHaveBeenCalled();
        expect(mockGetScheduleCalendarMembers).not.toHaveBeenCalled();

        await act(async () => {
            await root.findByProps({ accessibilityLabel: "공유 캘린더 목록 다시 불러오기" }).props.onPress();
        });
        await flushMicrotasks();
        expect(readText()).not.toContain("공유 캘린더를 불러오지 못했어요.");
        expect(readText()).toContain(ownerCalendar.title);
        expect(mockGetScheduleCalendarMembers).toHaveBeenCalledWith(ownerCalendar.id);
    });

    it("keeps the last verified calendar rows visible when refresh fails", async () => {
        await renderScreen();
        mockGetScheduleCalendars.mockRejectedValueOnce(new Error("503"));
        const root = renderer!.root;
        await act(async () => {
            await root.findByProps({ accessibilityLabel: "공유 캘린더 새로고침" }).props.onPress();
        });
        expect(findPressableByText(root, ownerCalendar.title)).toBeDefined();
        expect(root.findByProps({ accessibilityLabel: "공유 캘린더 목록 다시 불러오기" })).toBeDefined();
        expect(root.findAllByProps({ accessibilityLabel: "캘린더 설정 불러오는 중" })).toHaveLength(0);
    });

    it("shows loading for a requested calendar absent from the cached list", async () => {
        Object.assign(mockParams, { id: "7", view: "calendar" });
        mockCachedCalendarResponse = [secondOwnerCalendar];
        const load = deferred<ScheduleCalendar[]>();
        mockGetScheduleCalendars.mockReturnValueOnce(load.promise);
        await act(async () => {
            renderer = TestRenderer.create(<ScheduleCalendarsScreen />);
        });
        const root = renderer!.root;
        expect(root.findByProps({ accessibilityLabel: "캘린더 불러오는 중" })).toBeDefined();
        expect(mockGetScheduleCalendarMembers).not.toHaveBeenCalled();
        await act(async () => load.resolve([ownerCalendar, secondOwnerCalendar]));
        await flushMicrotasks();
        expect(root.findAllByProps({ accessibilityLabel: "캘린더 불러오는 중" })).toHaveLength(0);
        expect(mockGetScheduleCalendarMembers).toHaveBeenCalledWith(ownerCalendar.id);
    });

    it("returns to the previous mounted scene without resetting to the root calendar", async () => {
        mockCloseActiveScene.mockReturnValue(true);
        await renderScreen();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "뒤로 가기" }).props.onPress();
        });
        expect(mockCloseActiveScene).toHaveBeenCalledTimes(1);
        expect(mockRunWithTransitionShell).not.toHaveBeenCalled();
        expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it("falls back to the calendar root when opened directly without router history", async () => {
        await renderScreen();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "뒤로 가기" }).props.onPress();
        });
        expect(mockCloseActiveScene).toHaveBeenCalledTimes(1);
        expect(mockRouterReplace).toHaveBeenCalledWith("/schedule");
    });

    it("keeps the selected calendar as the category screen's return destination", async () => {
        calendarResponse = [ownerCalendar, secondOwnerCalendar];
        await renderScreen();
        const root = renderer!.root;
        await act(async () => findPressableByText(root, "업무").props.onPress());
        await act(async () => {
            root.findByProps({ accessibilityLabel: "업무 카테고리 관리" }).props.onPress();
        });
        expect(mockRouterPush).toHaveBeenCalledWith({
            pathname: "/schedule/categories",
            params: { calendarId: "8", calendarTitle: "업무", returnTo: "calendar-stack" },
        });
    });

    it("uses router history when the calendar manager is already a routed screen", async () => {
        await renderScreen();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "가족 카테고리 관리" }).props.onPress();
        });
        expect(mockRouterPush).toHaveBeenCalledWith({
            pathname: "/schedule/categories",
            params: { calendarId: "7", calendarTitle: "가족", returnTo: "calendar-stack" },
        });
    });

    it("keeps a rename draft per calendar and only saves a changed name", async () => {
        calendarResponse = [ownerCalendar, secondOwnerCalendar];
        mockUpdateScheduleCalendar.mockResolvedValue({ ...ownerCalendar, title: "가족 모임" });
        await renderScreen();
        const root = renderer!.root;
        expect(root.findAllByProps({ accessibilityLabel: "캘린더 이름" })).toHaveLength(0);
        const edit = () => root.findByProps({ accessibilityLabel: "캘린더 이름 수정" });
        const input = () => root.findByProps({ accessibilityLabel: "캘린더 이름" });
        const save = () => root.findByProps({ accessibilityLabel: "캘린더 이름 저장" });
        await act(async () => edit().props.onPress());
        expect(save().props.disabled).toBe(true);
        await act(async () => input().props.onChangeText("  가족 모임  "));
        expect(save().props.disabled).toBe(false);

        await act(async () => findPressableByText(root, "업무").props.onPress());
        expect(root.findAllByProps({ accessibilityLabel: "캘린더 이름" })).toHaveLength(0);
        await act(async () => findPressableByText(root, "가족").props.onPress());
        expect(input().props.value).toBe("  가족 모임  ");
        await act(async () => save().props.onPress());
        expect(mockUpdateScheduleCalendar).toHaveBeenCalledWith(7, { title: "가족 모임" });
        expect(root.findAllByProps({ accessibilityLabel: "캘린더 이름" })).toHaveLength(0);
    });

    it("waits for the calendar manager route to focus before loading its list and members", async () => {
        mockScreenFocused = false;
        mockGetScheduleCalendars.mockResolvedValue([ownerCalendar]);
        await act(async () => {
            renderer = TestRenderer.create(<ScheduleCalendarsScreen />);
        });
        await flushMicrotasks();
        expect(mockGetScheduleCalendars).not.toHaveBeenCalled();
        expect(mockGetScheduleCalendarMembers).not.toHaveBeenCalled();
        await act(async () => {
            mockScreenFocused = true;
            renderer!.update(<ScheduleCalendarsScreen />);
        });
        await flushMicrotasks();
        expect(mockGetScheduleCalendars).toHaveBeenCalledTimes(1);
        expect(mockGetScheduleCalendarMembers).toHaveBeenCalledWith(ownerCalendar.id);
    });

    it("does not issue background calendar or member requests", async () => {
        mockScreenFocused = false;
        mockCachedCalendarResponse = [ownerCalendar];
        mockGetScheduleCalendars.mockResolvedValue([ownerCalendar]);
        await act(async () => {
            renderer = TestRenderer.create(<ScheduleCalendarsScreen />);
        });
        await flushMicrotasks();
        expect(mockGetScheduleCalendars).not.toHaveBeenCalled();
        expect(mockGetScheduleCalendarMembers).not.toHaveBeenCalled();
        expect(Alert.alert).not.toHaveBeenCalled();
    });

    it("validates restored calendar ids before requesting members", async () => {
        mockCachedCalendarResponse = [ownerCalendar];
        const list = deferred<ScheduleCalendar[]>();
        mockGetScheduleCalendars.mockReturnValue(list.promise);
        mockGetScheduleCalendarMembers.mockResolvedValue([workMember]);
        await act(async () => {
            renderer = TestRenderer.create(<ScheduleCalendarsScreen />);
        });
        await flushMicrotasks();
        expect(mockGetScheduleCalendarMembers).not.toHaveBeenCalled();
        await act(async () => {
            list.resolve([secondOwnerCalendar]);
            await list.promise;
        });
        await flushMicrotasks();
        expect(mockGetScheduleCalendarMembers).toHaveBeenCalledWith(secondOwnerCalendar.id);
        expect(mockGetScheduleCalendarMembers).not.toHaveBeenCalledWith(ownerCalendar.id);
        expect(Alert.alert).not.toHaveBeenCalled();
    });

    it("ignores a member failure after blur and revalidates on focus", async () => {
        const members = deferred<ScheduleCalendarMember[]>();
        mockGetScheduleCalendarMembers.mockReturnValue(members.promise);
        await renderScreen();
        expect(mockGetScheduleCalendarMembers).toHaveBeenCalledWith(ownerCalendar.id);
        await act(async () => {
            mockScreenFocused = false;
            renderer!.update(<ScheduleCalendarsScreen />);
        });
        jest.mocked(Alert.alert).mockClear();
        await act(async () => {
            members.reject(new Error("공유 캘린더가 존재하지 않습니다."));
            await members.promise.catch(() => undefined);
        });
        await flushMicrotasks();
        expect(Alert.alert).not.toHaveBeenCalled();
        mockGetScheduleCalendars.mockResolvedValue([ownerCalendar]);
        mockGetScheduleCalendarMembers.mockResolvedValue([familyMember]);
        await act(async () => {
            mockScreenFocused = true;
            renderer!.update(<ScheduleCalendarsScreen />);
        });
        await flushMicrotasks();
        expect(mockGetScheduleCalendarMembers).toHaveBeenCalledTimes(2);
        expect(getRenderedText(renderer!.root)).toContain(familyMember.name);
    });

    it("ignores a calendar-list failure after unmount", async () => {
        const list = deferred<ScheduleCalendar[]>();
        mockGetScheduleCalendars.mockReturnValue(list.promise);
        await act(async () => {
            renderer = TestRenderer.create(<ScheduleCalendarsScreen />);
        });
        await act(async () => renderer!.unmount());
        renderer = undefined;
        await act(async () => {
            list.reject(new Error("offline"));
            await list.promise.catch(() => undefined);
        });
        await flushMicrotasks();
        expect(Alert.alert).not.toHaveBeenCalled();
    });

    it("still reports a current focused member failure", async () => {
        mockGetScheduleCalendarMembers.mockRejectedValue(new Error("active member failure"));
        await renderScreen();
        expect(Alert.alert).toHaveBeenCalledWith("멤버 조회 실패", "active member failure");
    });

    it("recovers once after travel sharing is downgraded", async () => {
        mockUpdateScheduleCalendar.mockResolvedValue({
            ...ownerCalendar,
            defaultContentMode: "SCHEDULE_ONLY",
        });
        await renderScreen();

        const scheduleOnlyOption = findPressableByText(
            renderer!.root,
            "일정만",
            (node) => node.props.accessibilityState?.selected === false,
        );
        await act(async () => {
            await scheduleOnlyOption.props.onPress();
            await Promise.resolve();
        });

        expect(mockUpdateScheduleCalendar).toHaveBeenCalledWith(7, {
            defaultContentMode: "SCHEDULE_ONLY",
        });
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockUpdateScheduleCalendar.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
    });

    it("does not recover when a calendar mode mutation fails", async () => {
        mockUpdateScheduleCalendar.mockRejectedValue(new Error("mode failed"));
        await renderScreen();

        const scheduleOnlyOption = findPressableByText(
            renderer!.root,
            "일정만",
            (node) => node.props.accessibilityState?.selected === false,
        );
        await act(async () => {
            scheduleOnlyOption.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
    });

    it("keeps a saved sharing scope after switching calendars and sends only one pending request", async () => {
        calendarResponse = [ownerCalendar, secondOwnerCalendar];
        const update = deferred<ScheduleCalendar>();
        mockUpdateScheduleCalendar.mockReturnValue(update.promise);
        await renderScreen();

        const chooseScope = () => renderer!.root.findAllByProps({
            accessibilityLabel: "일정만",
        }).find(node => typeof node.props.onPress === "function")!;
        const action = chooseScope().props.onPress;
        await act(async () => { action(); action(); });
        expect(chooseScope().props.accessibilityState).toMatchObject({ disabled: true, busy: true });

        await act(async () => findPressableByText(renderer!.root, secondOwnerCalendar.title).props.onPress());
        await flushMicrotasks();
        await act(async () => {
            update.resolve({ ...ownerCalendar, defaultContentMode: "SCHEDULE_ONLY" });
            await update.promise;
        });
        await flushMicrotasks();
        expect(chooseScope().props.accessibilityState.selected).toBe(false);

        await act(async () => findPressableByText(renderer!.root, ownerCalendar.title).props.onPress());
        await flushMicrotasks();
        expect(chooseScope().props.accessibilityState).toMatchObject({ selected: true, disabled: false });
        expect(mockUpdateScheduleCalendar).toHaveBeenCalledTimes(1);
    });

    it("uses the saved reminder for its calendar after switching during a request", async () => {
        calendarResponse = [{ ...ownerCalendar, myRole: "VIEWER" }, secondOwnerCalendar];
        const update = deferred<ScheduleCalendarMember>();
        mockUpdateMyScheduleCalendarPreferences.mockReturnValue(update.promise);
        await renderScreen();
        const reminder = () => renderer!.root.findAllByProps({ accessibilityLabel: "경로 미설정 알림" })
            .find(node => typeof node.props.onValueChange === "function")!;
        await act(async () => { void reminder().props.onValueChange(false); });
        expect(reminder().props.accessibilityState).toMatchObject({ disabled: true, busy: true });
        await act(async () => findPressableByText(renderer!.root, secondOwnerCalendar.title).props.onPress());
        await flushMicrotasks();
        await act(async () => {
            update.resolve({ ...familyMember, routeReminderEnabled: false });
            await update.promise;
        });
        expect(reminder().props.value).toBe(true);

        await act(async () => findPressableByText(renderer!.root, ownerCalendar.title).props.onPress());
        await flushMicrotasks();
        expect(reminder().props.value).toBe(false);
        expect(mockUpdateMyScheduleCalendarPreferences).toHaveBeenCalledWith(ownerCalendar.id, false);
    });

    it("does not recover when travel sharing is upgraded", async () => {
        calendarResponse = [{
            ...ownerCalendar,
            defaultContentMode: "SCHEDULE_ONLY",
        }];
        mockUpdateScheduleCalendar.mockResolvedValue(ownerCalendar);
        await renderScreen();

        const scheduleAndTravelOptions = renderer!.root.findAll((node) => (
            typeof node.props.onPress === "function"
            && node.props.accessibilityState?.selected === false
            && getRenderedText(node).includes("일정 + 각자 경로")
        ));
        const selectedCalendarOption = scheduleAndTravelOptions[scheduleAndTravelOptions.length - 1];
        expect(selectedCalendarOption).toBeDefined();
        await act(async () => {
            await selectedCalendarOption.props.onPress();
            await Promise.resolve();
        });

        expect(mockUpdateScheduleCalendar).toHaveBeenCalledWith(7, {
            defaultContentMode: "SCHEDULE_AND_TRAVEL",
        });
        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
    });

    it("recovers once after an owner archives a calendar", async () => {
        mockArchiveScheduleCalendar.mockResolvedValue(undefined);
        await renderScreen();

        await act(async () => {
            findPressableByText(renderer!.root, "캘린더 보관").props.onPress();
        });
        const confirmation = jest.mocked(Alert.alert).mock.calls.find(
            ([title]) => title === "캘린더 보관",
        );
        await act(async () => {
            await confirmation?.[2]?.[1]?.onPress?.();
        });

        expect(mockArchiveScheduleCalendar).toHaveBeenCalledWith(7);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
    });

    it("recovers once after a member leaves a calendar", async () => {
        calendarResponse = [{
            ...ownerCalendar,
            myRole: "VIEWER",
        }];
        mockLeaveScheduleCalendar.mockResolvedValue(undefined);
        await renderScreen();

        await act(async () => {
            findPressableByText(renderer!.root, "캘린더 나가기").props.onPress();
        });
        const confirmation = jest.mocked(Alert.alert).mock.calls.find(
            ([title]) => title === "캘린더 나가기",
        );
        await act(async () => {
            await confirmation?.[2]?.[1]?.onPress?.();
        });

        expect(mockLeaveScheduleCalendar).toHaveBeenCalledWith(7);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
    });

    it("does not recover when leaving a calendar fails", async () => {
        calendarResponse = [{
            ...ownerCalendar,
            myRole: "VIEWER",
        }];
        mockLeaveScheduleCalendar.mockRejectedValue(new Error("leave failed"));
        await renderScreen();

        await act(async () => {
            findPressableByText(renderer!.root, "캘린더 나가기").props.onPress();
        });
        const confirmation = jest.mocked(Alert.alert).mock.calls.find(
            ([title]) => title === "캘린더 나가기",
        );
        await act(async () => {
            await confirmation?.[2]?.[1]?.onPress?.();
        });

        expect(mockLeaveScheduleCalendar).toHaveBeenCalledWith(7);
        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
        expect(Alert.alert).toHaveBeenCalledWith(
            "나가기 실패",
            "leave failed",
        );
    });

    it("does not recover when calendar archival fails", async () => {
        mockArchiveScheduleCalendar.mockRejectedValue(new Error("archive failed"));
        await renderScreen();

        await act(async () => {
            findPressableByText(renderer!.root, "캘린더 보관").props.onPress();
        });
        const confirmation = jest.mocked(Alert.alert).mock.calls.find(
            ([title]) => title === "캘린더 보관",
        );
        await act(async () => {
            await confirmation?.[2]?.[1]?.onPress?.();
        });

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
        expect(Alert.alert).toHaveBeenCalledWith(
            "보관 실패",
            "archive failed",
        );
    });

    it("opens the requested invitation calendar instead of a stale cached calendar", async () => {
        mockParams.id = String(secondOwnerCalendar.id);
        mockCachedCalendarResponse = [ownerCalendar];
        calendarResponse = [ownerCalendar, secondOwnerCalendar];
        mockGetScheduleCalendarMembers.mockImplementation((calendarId: number) => (
            Promise.resolve(calendarId === secondOwnerCalendar.id ? [workMember] : [familyMember])
        ));

        await renderScreen();

        const selectedRows = renderer!.root.findAll((node) => (
            typeof node.props.onPress === "function"
            && node.props.accessibilityState?.selected === true
            && getRenderedText(node).includes(secondOwnerCalendar.title)
        ));
        expect(selectedRows).toHaveLength(1);
        expect(getRenderedText(renderer!.root)).toContain(workMember.name);
        expect(getRenderedText(renderer!.root)).not.toContain(familyMember.name);
        expect(mockGetScheduleCalendarMembers).not.toHaveBeenCalledWith(ownerCalendar.id);
        expect(mockGetScheduleCalendarMembers).toHaveBeenCalledWith(secondOwnerCalendar.id);
    });

    it("keeps settings locked to the selected calendar and ignores stale member responses", async () => {
        calendarResponse = [ownerCalendar, secondOwnerCalendar];
        const familyMembersLoad = deferred<ScheduleCalendarMember[]>();
        const workMembersLoad = deferred<ScheduleCalendarMember[]>();
        mockGetScheduleCalendarMembers.mockImplementation((calendarId: number) => (
            calendarId === ownerCalendar.id
                ? familyMembersLoad.promise
                : workMembersLoad.promise
        ));
        mockArchiveScheduleCalendar.mockResolvedValue(undefined);
        await renderScreen();

        await act(async () => {
            findPressableByText(renderer!.root, secondOwnerCalendar.title).props.onPress();
        });

        expect(renderer!.root.findAll((node) => (
            typeof node.props.onPress === "function"
            && getRenderedText(node).includes("캘린더 보관")
        ))).toHaveLength(0);
        expect(renderer!.root.findByProps({
            accessibilityLabel: `${secondOwnerCalendar.title} 설정 불러오는 중`,
        })).toBeDefined();

        await act(async () => {
            workMembersLoad.resolve([workMember]);
            await workMembersLoad.promise;
        });
        await flushMicrotasks();

        expect(getRenderedText(renderer!.root)).toContain(workMember.name);
        expect(getRenderedText(renderer!.root)).not.toContain(familyMember.name);

        await act(async () => {
            familyMembersLoad.resolve([familyMember]);
            await familyMembersLoad.promise;
        });
        await flushMicrotasks();

        expect(getRenderedText(renderer!.root)).toContain(workMember.name);
        expect(getRenderedText(renderer!.root)).not.toContain(familyMember.name);

        await act(async () => {
            findPressableByText(renderer!.root, "캘린더 보관").props.onPress();
        });
        const confirmation = jest.mocked(Alert.alert).mock.calls.find(
            ([title]) => title === "캘린더 보관",
        );
        await act(async () => {
            await confirmation?.[2]?.[1]?.onPress?.();
        });

        expect(mockArchiveScheduleCalendar).toHaveBeenCalledTimes(1);
        expect(mockArchiveScheduleCalendar).toHaveBeenCalledWith(secondOwnerCalendar.id);
    });

    it("rejects a stale detail handler and deduplicates archive confirmation and execution", async () => {
        calendarResponse = [ownerCalendar, secondOwnerCalendar];
        const workMembersLoad = deferred<ScheduleCalendarMember[]>();
        mockGetScheduleCalendarMembers.mockImplementation((calendarId: number) => (
            calendarId === ownerCalendar.id
                ? Promise.resolve([familyMember])
                : workMembersLoad.promise
        ));
        const archiveLoad = deferred<void>();
        mockArchiveScheduleCalendar.mockReturnValue(archiveLoad.promise);
        await renderScreen();

        const staleArchiveHandler = findPressableByText(
            renderer!.root,
            "캘린더 보관",
        ).props.onPress;
        const staleModeHandler = findPressableByText(
            renderer!.root,
            "일정만",
            (node) => node.props.accessibilityState?.selected === false,
        ).props.onPress;
        await act(async () => {
            findPressableByText(renderer!.root, secondOwnerCalendar.title).props.onPress();
        });
        jest.mocked(Alert.alert).mockClear();

        await act(async () => {
            staleArchiveHandler();
            staleModeHandler();
            await Promise.resolve();
        });
        expect(Alert.alert).not.toHaveBeenCalled();
        expect(mockArchiveScheduleCalendar).not.toHaveBeenCalled();
        expect(mockUpdateScheduleCalendar).not.toHaveBeenCalled();

        await act(async () => {
            workMembersLoad.resolve([workMember]);
            await workMembersLoad.promise;
        });
        await flushMicrotasks();

        const currentArchiveButton = findPressableByText(renderer!.root, "캘린더 보관");
        await act(async () => {
            currentArchiveButton.props.onPress();
            currentArchiveButton.props.onPress();
        });
        const confirmations = jest.mocked(Alert.alert).mock.calls.filter(
            ([title]) => title === "캘린더 보관",
        );
        expect(confirmations).toHaveLength(1);

        let firstExecution: Promise<void> | undefined;
        await act(async () => {
            firstExecution = confirmations[0]?.[2]?.[1]?.onPress?.() as Promise<void> | undefined;
            await confirmations[0]?.[2]?.[1]?.onPress?.();
        });
        expect(mockArchiveScheduleCalendar).toHaveBeenCalledTimes(1);
        expect(mockArchiveScheduleCalendar).toHaveBeenCalledWith(secondOwnerCalendar.id);

        await act(async () => {
            archiveLoad.resolve();
            await archiveLoad.promise;
            await firstExecution;
        });
    });
});

function findPressableByText(
    root: ReactTestInstance,
    text: string,
    predicate: (node: ReactTestInstance) => boolean = () => true,
): ReactTestInstance {
    return root.find((node) => (
        typeof node.props.onPress === "function"
        && predicate(node)
        && getRenderedText(node).includes(text)
    ));
}

function getRenderedText(node: ReactTestInstance): string {
    return node.children.map((child) => (
        typeof child === "string" ? child : getRenderedText(child)
    )).join("");
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
} {
    let resolve: (value: T) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}
