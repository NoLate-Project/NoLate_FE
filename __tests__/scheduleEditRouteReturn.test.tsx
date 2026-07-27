import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ScheduleEditScreen from "../src/modules/schedule/screens/ScheduleEditScreen";
import { setRoutePlannerResult } from "../src/modules/schedule/routePlannerSession";
import * as env from "../src/api/env";

const mockCategory = { id: "work", title: "업무", color: "#FF3B30" };
const mockOriginalRoute = {
    id: "transit-old",
    mode: "TRANSIT" as const,
    minutes: 36,
    pathCoords: [
        { lat: 37.5, lng: 126.9 },
        { lat: 37.51, lng: 127.02 },
    ],
    routeInfo: {
        id: "transit-old-info",
        originName: "집",
        destinationName: "회사",
        totalDurationMinutes: 36,
        departureTime: "2026-07-20T10:24:00.000Z",
        arrivalTime: "2026-07-20T11:00:00.000Z",
        timeBasis: "estimated" as const,
        steps: [],
    },
};
const mockItem = {
    id: "1",
    title: "경로 수정 회의",
    startAt: "2026-07-20T11:00:00.000Z",
    endAt: "2026-07-20T12:00:00.000Z",
    hasEndTime: true,
    allDay: false,
    category: mockCategory,
    calendarId: 77,
    calendarContentModeOverride: "SCHEDULE_AND_TRAVEL" as const,
    origin: { name: "집", lat: 37.5, lng: 126.9 },
    destination: { name: "회사", lat: 37.51, lng: 127.02 },
    travelMode: "TRANSIT" as const,
    travelMinutes: 36,
    departAt: "2026-07-20T10:24:00.000Z",
    route: mockOriginalRoute,
};
const mockState = {
    selectedDay: "2026-07-20",
    categories: [mockCategory],
    itemsById: { "1": mockItem },
    loading: false,
    error: null,
};

let mockPathname = "/schedule/1";
const mockRouterPush = jest.fn();
const mockRouterSetParams = jest.fn();
const mockDispatch = jest.fn();
const mockGetSchedule = jest.fn();
const mockUpdateSchedule = jest.fn();

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => ({ id: "1" }),
    usePathname: () => mockPathname,
    useRouter: () => ({
        push: mockRouterPush,
        setParams: mockRouterSetParams,
    }),
}));
jest.mock("@react-navigation/native", () => ({
    useNavigation: () => ({ dispatch: jest.fn() }),
    usePreventRemove: jest.fn(),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@react-native-community/datetimepicker", () => "DateTimePicker");
jest.mock("react-native-calendars", () => ({ Calendar: "Calendar" }));
jest.mock("../src/api/scheduleCalendars", () => ({
    getScheduleCalendars: jest.fn().mockResolvedValue([]),
}));
const mockGetScheduleCalendars = (
    jest.requireMock("../src/api/scheduleCalendars") as {
        getScheduleCalendars: jest.Mock;
    }
).getScheduleCalendars;
jest.mock("../src/modules/schedule/store", () => ({
    useScheduleStore: () => ({
        state: mockState,
        dispatch: mockDispatch,
    }),
}));
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({ colors: {}, mode: "light" }),
}));
jest.mock("../src/api/schedule", () => ({
    getSchedule: (...args: unknown[]) => mockGetSchedule(...args),
    updateSchedule: (...args: unknown[]) => mockUpdateSchedule(...args),
    deleteSchedule: jest.fn(),
}));
jest.mock("../src/api/scheduleCategories", () => ({
    getScheduleCategoriesFromApi: jest.fn().mockResolvedValue([mockCategory]),
}));
jest.mock("../src/api/subscription", () => ({
    FREE_SUBSCRIPTION_POLICY: {
        maxNotificationLeadMinutes: 60,
        minEtaRefreshIntervalMinutes: 20,
    },
    getMySubscriptionPolicy: jest.fn().mockResolvedValue({
        maxNotificationLeadMinutes: 60,
        minEtaRefreshIntervalMinutes: 20,
    }),
}));
jest.mock("../src/modules/schedule/components/form/CategorySelectBox", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return () => mockReact.createElement(MockView);
});
jest.mock("../src/modules/schedule/components/form/LocationInputRow", () => {
    const mockReact = require("react");
    const { Pressable: MockPressable } = require("react-native");
    return ({ onPress }: { onPress: () => void }) => mockReact.createElement(MockPressable, {
        accessibilityLabel: "이동 경로 수정",
        onPress,
    });
});
jest.mock("../src/modules/schedule/components/form/NotificationSettingsCard", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return () => mockReact.createElement(MockView);
});
jest.mock("../src/modules/schedule/components/form/CategoryLoadErrorBanner", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return () => mockReact.createElement(MockView);
});
jest.mock("../src/modules/schedule/components/calendar/CalendarGlassSurface", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return ({ children }: { children?: React.ReactNode }) => mockReact.createElement(MockView, null, children);
});
jest.mock("../src/ui/BrandedLoader", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return { BrandedLoadingState: () => mockReact.createElement(MockView) };
});

describe("ScheduleEditScreen route return", () => {
    let renderer: ReactTestRenderer | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.spyOn(env, "getEnv").mockReturnValue("true");
        mockPathname = "/schedule/1";
        mockRouterPush.mockReset();
        mockRouterSetParams.mockReset();
        mockDispatch.mockReset();
        mockGetSchedule.mockReset();
        mockUpdateSchedule.mockReset();
        mockGetScheduleCalendars.mockClear();
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    test("공유 전역 off에서는 수정 화면도 공유 캘린더를 조회하지 않는다", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue(undefined);
        mockGetSchedule.mockImplementation(() => new Promise(() => undefined));
        mockUpdateSchedule.mockImplementation(async (_id, payload) => ({
            ...mockItem,
            ...payload,
        }));

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
        });

        expect(mockGetScheduleCalendars).not.toHaveBeenCalled();
        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "공유 캘린더 관리",
        })).toHaveLength(0);

        await act(async () => {
            await renderer!.root.findByProps({
                accessibilityLabel: "일정 수정 저장",
            }).props.onPress();
        });
        expect(mockUpdateSchedule).toHaveBeenCalledWith(
            "1",
            expect.objectContaining({
                calendarId: 77,
                calendarContentModeOverride: "SCHEDULE_AND_TRAVEL",
            }),
        );
    });

    test("느린 상세 재조회와 무관하게 경로 변경 직후 저장할 수 있다", async () => {
        // 최초 상세 조회는 경로 화면에서 돌아온 뒤까지 끝나지 않는 상황을 재현한다.
        mockGetSchedule.mockImplementation(() => new Promise(() => undefined));
        mockUpdateSchedule.mockImplementation(async (_id, payload) => ({
            ...mockItem,
            ...payload,
        }));
        const tree = () => <ScheduleEditScreen />;

        await act(async () => {
            renderer = TestRenderer.create(tree());
            await Promise.resolve();
        });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "이동 경로 수정" }).props.onPress();
            await Promise.resolve();
        });
        const sessionId = mockRouterPush.mock.calls[0]?.[0]?.params?.sessionId as string;
        expect(sessionId).toBeTruthy();

        mockPathname = "/schedule/route-select";
        await act(async () => {
            renderer!.update(tree());
            await Promise.resolve();
        });

        const nextRoute = {
            id: "car-new",
            mode: "CAR" as const,
            minutes: 24,
            pathCoords: [
                { lat: 37.5, lng: 126.9 },
                { lat: 37.51, lng: 127.02 },
            ],
            routeInfo: {
                id: "car-new-info",
                originName: "집",
                destinationName: "회사",
                totalDurationMinutes: 24,
                departureTime: "2026-07-20T10:36:00.000Z",
                arrivalTime: "2026-07-20T11:00:00.000Z",
                timeBasis: "estimated" as const,
                steps: [],
            },
        };
        setRoutePlannerResult(sessionId, {
            origin: mockItem.origin,
            destination: mockItem.destination,
            travelMode: "CAR",
            travelMinutes: 24,
            departureAt: "2026-07-20T10:36:00.000Z",
            route: nextRoute,
        });

        mockPathname = "/schedule/1";
        await act(async () => {
            renderer!.update(tree());
            await Promise.resolve();
        });

        const saveButton = renderer!.root.findByProps({ accessibilityLabel: "일정 수정 저장" });
        expect(saveButton.props.disabled).toBe(false);
        expect(mockGetSchedule).toHaveBeenCalledTimes(1);

        await act(async () => {
            await saveButton.props.onPress();
        });

        expect(mockUpdateSchedule).toHaveBeenCalledWith("1", expect.objectContaining({
            travelMode: "CAR",
            travelMinutes: 24,
            departAt: "2026-07-20T10:36:00.000Z",
            route: nextRoute,
        }));
    });
});
