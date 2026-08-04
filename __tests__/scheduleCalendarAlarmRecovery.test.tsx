import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";

const mockGetScheduleCalendars = jest.fn();
const mockGetScheduleCalendarMembers = jest.fn();
const mockUpdateScheduleCalendar = jest.fn();
const mockArchiveScheduleCalendar = jest.fn();
const mockLeaveScheduleCalendar = jest.fn();
const mockRecoverDepartureAlarmsAfterMutation = jest.fn();
const mockRouterReplace = jest.fn();
const mockParams = {};
let calendarResponse: ScheduleCalendar[];

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => mockParams,
    useRouter: () => ({
        canGoBack: () => false,
        replace: mockRouterReplace,
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
    updateMyScheduleCalendarPreferences: jest.fn(),
    updateScheduleCalendar: (...args: unknown[]) =>
        mockUpdateScheduleCalendar(...args),
    updateScheduleCalendarMember: jest.fn(),
}));
jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
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
import type { ScheduleCalendar } from "../src/api/scheduleCalendars";

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

describe("schedule calendar departure-alarm recovery", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        calendarResponse = [ownerCalendar];
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
} {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((next) => {
        resolve = next;
    });
    return { promise, resolve };
}
