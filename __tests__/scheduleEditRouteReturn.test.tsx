import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Alert, StyleSheet, Switch } from "react-native";

import ScheduleEditScreen from "../src/modules/schedule/screens/ScheduleEditScreen";
import {
    getRoutePlannerInitial,
    setRoutePlannerResult,
} from "../src/modules/schedule/routePlannerSession";
import type { ScheduleItem, ScheduleTravelPlan } from "../src/modules/schedule/types";

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
const mockItem: ScheduleItem = {
    id: "1",
    title: "경로 수정 회의",
    startAt: "2026-07-20T11:00:00.000Z",
    endAt: "2026-07-20T12:00:00.000Z",
    hasEndTime: true,
    allDay: false,
    category: mockCategory,
    origin: { name: "집", lat: 37.5, lng: 126.9 },
    destination: { name: "회사", lat: 37.51, lng: 127.02 },
    travelMode: "TRANSIT" as const,
    travelMinutes: 36,
    departAt: "2026-07-20T10:24:00.000Z",
    route: mockOriginalRoute,
    notificationEnabled: false,
    alertMode: "ALARM" as const,
};
const mockState = {
    selectedDay: "2026-07-20",
    categories: [mockCategory],
    itemsById: { "1": mockItem } as Record<string, ScheduleItem>,
    loading: false,
    error: null,
};

let mockPathname = "/schedule/1";
let mockRouteParams: { id: string; preview?: string } = { id: "1" };
const mockRouterPush = jest.fn();
const mockRouterSetParams = jest.fn();
const mockRouterReplace = jest.fn();
const mockDispatch = jest.fn();
const mockGetSchedule = jest.fn();
const mockUpdateSchedule = jest.fn();
const mockDeleteSchedule = jest.fn();
const mockUpsertMyScheduleTravelPlan = jest.fn();
const mockRecoverDepartureAlarmsAfterMutation = jest.fn();

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    useLocalSearchParams: () => mockRouteParams,
    usePathname: () => mockPathname,
    useRouter: () => ({
        push: mockRouterPush,
        replace: mockRouterReplace,
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
jest.mock("../src/modules/schedule/store", () => ({
    useScheduleStore: () => ({
        state: mockState,
        dispatch: mockDispatch,
    }),
}));
jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            background: "#FFFFFF",
            surface: "#FFFFFF",
            surface2: "#F7F7F8",
            border: "#E6E6EA",
            textPrimary: "#000000",
            textSecondary: "#6E6E73",
            inputPlaceholder: "#AEAEB2",
            selectedDayBg: "#000000",
        },
    }),
}));
jest.mock("../src/api/schedule", () => ({
    getSchedule: (...args: unknown[]) => mockGetSchedule(...args),
    updateSchedule: (...args: unknown[]) => mockUpdateSchedule(...args),
    deleteSchedule: (...args: unknown[]) => mockDeleteSchedule(...args),
}));
jest.mock("../src/api/scheduleTravelPlans", () => ({
    upsertMyScheduleTravelPlan: (...args: unknown[]) =>
        mockUpsertMyScheduleTravelPlan(...args),
}));
jest.mock("../src/modules/notification/departureAlarmMutationRecovery", () => ({
    recoverDepartureAlarmsAfterMutation: () =>
        mockRecoverDepartureAlarmsAfterMutation(),
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
    const { Pressable: MockPressable, View: MockView } = require("react-native");
    return ({
        expanded,
        hideTrigger,
        onChange,
        onExpandedChange,
    }: {
        expanded?: boolean;
        hideTrigger?: boolean;
        onChange: (categoryId: string) => void;
        onExpandedChange?: (expanded: boolean) => void;
    }) => mockReact.createElement(
        MockView,
        { testID: "mock-category-options", expanded, hideTrigger },
        expanded
            ? mockReact.createElement(MockPressable, {
                accessibilityLabel: "업무 카테고리 항목",
                onPress: () => {
                    onChange("work");
                    onExpandedChange?.(false);
                },
            })
            : null,
    );
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
    const { Pressable: MockPressable } = require("react-native");
    return ({
        variant,
        onEnabledChange,
        onAlertModeChange,
    }: {
        variant?: "card" | "flat";
        onEnabledChange: (enabled: boolean) => void;
        onAlertModeChange: (mode: "ALARM") => void;
    }) => mockReact.createElement(MockPressable, {
        testID: "mock-notification-settings",
        variant,
        accessibilityLabel: "강력한 알람 설정 테스트",
        onPress: () => {
            onEnabledChange(true);
            onAlertModeChange("ALARM");
        },
    });
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
        mockPathname = "/schedule/1";
        mockRouteParams = { id: "1" };
        mockState.itemsById["1"] = mockItem;
        mockRouterPush.mockReset();
        mockRouterSetParams.mockReset();
        mockRouterReplace.mockReset();
        mockDispatch.mockReset();
        mockGetSchedule.mockReset();
        mockUpdateSchedule.mockReset();
        mockDeleteSchedule.mockReset();
        mockUpsertMyScheduleTravelPlan.mockReset();
        mockRecoverDepartureAlarmsAfterMutation.mockReset();
        mockRecoverDepartureAlarmsAfterMutation.mockResolvedValue(undefined);
        jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    test("개발용 시뮬레이터 미리보기에서는 서버 상세 재조회를 건너뛴다", async () => {
        mockRouteParams = { id: "1", preview: "1" };

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
        });

        expect(mockGetSchedule).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ testID: "schedule-edit-page" })).toBeTruthy();
    });

    test("전체 페이지에서 일시를 한 그룹으로 묶고 알림 설정을 flat 변형으로 보여준다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });

        const navigation = renderer!.root.findByProps({ testID: "schedule-edit-navigation" });
        expect(navigation.findByProps({ accessibilityLabel: "일정 수정 저장" })).toBeTruthy();
        expect(StyleSheet.flatten(
            navigation.findByProps({ children: "일정 수정" }).props.style,
        )).toMatchObject({
            fontSize: 18,
            lineHeight: 24,
            fontWeight: "700",
        });
        expect(navigation.findAllByProps({ accessibilityLabel: "일정 삭제" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ children: "일정 정보" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ children: "시간 없이 날짜로만 일정을 표시해요." })).toHaveLength(0);
        expect(renderer!.root.findByProps({ testID: "schedule-edit-datetime-card" })).toBeTruthy();
        expect(renderer!.root.findByProps({ testID: "schedule-edit-start-row" })).toBeTruthy();
        expect(renderer!.root.findByProps({ testID: "schedule-edit-end-row" })).toBeTruthy();
        expect(renderer!.root.findByProps({ testID: "schedule-edit-end-row" })
            .findAllByProps({ name: "chevron-forward" })).toHaveLength(1);
        expect(renderer!.root.findByProps({ accessibilityLabel: "종료 시간" })).toBeTruthy();
        expect(renderer!.root.findByProps({ testID: "schedule-edit-delete-action" })).toBeTruthy();
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-edit-page" }).props.style,
        )).toMatchObject({
            width: "100%",
            maxWidth: 560,
            alignSelf: "center",
            paddingTop: 6,
        });
        expect(renderer!.root.findByProps({
            testID: "mock-notification-settings",
        }).props.variant).toBe("flat");
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.style,
        )).toMatchObject({
            fontSize: 16,
            lineHeight: 22,
            fontWeight: "600",
        });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-edit-start-row" }).props.style,
        )).toMatchObject({ minHeight: 58 });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ accessibilityLabel: "일정 메모" }).props.style,
        )).toMatchObject({
            minHeight: 76,
            fontSize: 15,
            lineHeight: 21,
            fontWeight: "400",
        });
        renderer!.root.findAllByType(Switch).forEach((toggle) => {
            expect(StyleSheet.flatten(toggle.props.style)).toMatchObject({
                transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }],
            });
        });
    });

    test("제목과 메모는 포커스된 입력 필드만 흰 면과 강조 테두리로 구분한다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });

        const titleInput = renderer!.root.findByProps({ accessibilityLabel: "일정 제목" });
        await act(async () => titleInput.props.onFocus());
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-edit-title-field" }).props.style,
        )).toMatchObject({
            borderWidth: 1,
            borderColor: "#2979FF",
            backgroundColor: "#FFFFFF",
        });

        await act(async () => titleInput.props.onBlur());
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-edit-title-field" }).props.style,
        )).toMatchObject({
            borderWidth: StyleSheet.hairlineWidth,
            backgroundColor: "#F7F7F8",
        });

        const notesInput = renderer!.root.findByProps({ accessibilityLabel: "일정 메모" });
        await act(async () => notesInput.props.onFocus());
        expect(StyleSheet.flatten(notesInput.props.style)).toMatchObject({
            borderWidth: 1,
            borderColor: "#2979FF",
            backgroundColor: "#FFFFFF",
        });
    });

    test("평탄한 상단 뒤로 버튼도 수정 중에는 변경사항 폐기 확인을 유지한다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" })
                .props.onChangeText("변경한 제목");
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 수정 닫기" })
                .props.onPress();
        });

        expect(Alert.alert).toHaveBeenCalledWith(
            "저장하지 않고 나갈까요?",
            "수정한 내용이 저장되지 않아요.",
            expect.any(Array),
        );
        expect(mockRouterSetParams).not.toHaveBeenCalled();
    });

    test("카테고리 칩을 닫아도 같은 목록을 유지해 닫힘 애니메이션을 끝까지 실행한다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });

        const picker = renderer!.root.findByProps({ testID: "mock-category-options" });
        expect(picker.props).toMatchObject({
            expanded: false,
            hideTrigger: true,
        });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 업무" }).props.onPress();
        });

        expect(picker.props).toMatchObject({
            expanded: true,
            hideTrigger: true,
        });
        expect(renderer!.root.findByProps({
            testID: "schedule-edit-category-dismiss-layer",
        })).toBeTruthy();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 업무" }).props.onPress();
        });

        expect(renderer!.root.findByProps({ testID: "mock-category-options" })).toBe(picker);
        expect(picker.props.expanded).toBe(false);
        expect(renderer!.root.findAllByProps({
            testID: "schedule-edit-category-dismiss-layer",
        })).toHaveLength(0);
    });

    test("빠른 반복 탭과 바깥 탭 뒤에도 카테고리 열림 상태가 일관된다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });

        const categoryChip = renderer!.root.findByProps({
            accessibilityLabel: "카테고리 선택, 현재 업무",
        });

        await act(async () => categoryChip.props.onPress());
        await act(async () => categoryChip.props.onPress());
        await act(async () => categoryChip.props.onPress());

        expect(renderer!.root.findByProps({ testID: "mock-category-options" }).props.expanded).toBe(true);

        await act(async () => {
            renderer!.root.findByProps({
                testID: "schedule-edit-category-dismiss-layer",
            }).props.onPress();
        });
        expect(renderer!.root.findByProps({ testID: "mock-category-options" }).props.expanded).toBe(false);

        await act(async () => categoryChip.props.onPress());
        expect(renderer!.root.findByProps({ testID: "mock-category-options" }).props.expanded).toBe(true);
    });

    test("카테고리를 고르면 목록을 유지한 채 닫고 바깥 탭 영역을 제거한다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 업무" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리 항목" }).props.onPress();
        });

        expect(renderer!.root.findByProps({ testID: "mock-category-options" }).props.expanded).toBe(false);
        expect(renderer!.root.findAllByProps({
            testID: "schedule-edit-category-dismiss-layer",
        })).toHaveLength(0);
    });

    test("이동 경로를 열 때 현재 출발지·도착지·수단·소요시간·출발시각·경로를 세션에 보존한다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "이동 경로 수정" }).props.onPress();
        });

        const pushedRoute = mockRouterPush.mock.calls[0]?.[0];
        const sessionId = pushedRoute?.params?.sessionId as string;
        expect(pushedRoute).toEqual({
            pathname: "/schedule/route-select",
            params: { sessionId },
        });
        expect(getRoutePlannerInitial(sessionId)).toEqual({
            origin: mockItem.origin,
            destination: mockItem.destination,
            travelMode: "TRANSIT",
            travelMinutes: 36,
            locationName: "집 → 회사",
            targetArrivalAt: mockItem.startAt,
            departureAt: mockItem.departAt,
            route: mockOriginalRoute,
        });
    });

    test("경로 선택을 취소해도 기존 경로와 출발 알림 초안을 그대로 저장한다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);
        mockUpdateSchedule.mockImplementation(async (_id, payload) => ({
            ...mockItem,
            ...payload,
        }));
        const tree = () => <ScheduleEditScreen />;

        await act(async () => {
            renderer = TestRenderer.create(tree());
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "강력한 알람 설정 테스트" })
                .props.onPress();
            renderer!.root.findByProps({ accessibilityLabel: "이동 경로 수정" }).props.onPress();
        });

        mockPathname = "/schedule/route-select";
        await act(async () => {
            renderer!.update(tree());
            await Promise.resolve();
        });

        // 결과를 쓰지 않고 헤더/제스처/시스템 뒤로가기로 편집 화면에 복귀한 경우다.
        mockPathname = "/schedule/1";
        await act(async () => {
            renderer!.update(tree());
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "일정 수정 저장" })
                .props.onPress();
        });

        expect(mockUpdateSchedule).toHaveBeenCalledWith("1", expect.objectContaining({
            origin: mockItem.origin,
            destination: mockItem.destination,
            travelMode: "TRANSIT",
            travelMinutes: 36,
            departAt: mockItem.departAt,
            route: mockOriginalRoute,
            notificationEnabled: true,
            notificationLeadMinutes: 60,
            notificationIntervalMinutes: 20,
            alertMode: "ALARM",
        }));
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
            renderer!.root
                .findByProps({ accessibilityLabel: "강력한 알람 설정 테스트" })
                .props.onPress();
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
            notificationEnabled: true,
            notificationLeadMinutes: 60,
            notificationIntervalMinutes: 20,
            alertMode: "ALARM",
        }));
        expect(mockUpsertMyScheduleTravelPlan).not.toHaveBeenCalled();
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockUpdateSchedule.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
    });

    test("저장된 ALARM 값도 출발 알림이 꺼져 있으면 STANDARD로 전송한다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);
        mockUpdateSchedule.mockImplementation(async (_id, payload) => ({
            ...mockItem,
            ...payload,
        }));

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });

        const saveButton = renderer!.root.findByProps({ accessibilityLabel: "일정 수정 저장" });
        expect(saveButton.props.disabled).toBe(false);
        await act(async () => {
            await saveButton.props.onPress();
        });

        expect(mockUpdateSchedule).toHaveBeenCalledWith("1", expect.objectContaining({
            notificationEnabled: false,
            alertMode: "STANDARD",
        }));
        expect(mockUpsertMyScheduleTravelPlan).not.toHaveBeenCalled();
    });

    test("공유 일정은 공용 수정 후 ALARM 개인 이동계획을 저장하고 응답을 병합한 뒤 닫는다", async () => {
        const sharedItem: ScheduleItem = {
            ...mockItem,
            sharePermission: "EDITOR",
            notificationEnabled: false,
            alertMode: "STANDARD",
        };
        const commonUpdated: ScheduleItem = {
            ...sharedItem,
            title: "공용 저장 완료",
        };
        const savedPlan: ScheduleTravelPlan = {
            scheduleId: 1,
            memberId: 22,
            status: "READY",
            origin: sharedItem.origin,
            destination: sharedItem.destination,
            travelMode: "TRANSIT",
            travelMinutes: 36,
            departAt: "2026-07-20T10:24:00.000Z",
            route: mockOriginalRoute,
            notificationEnabled: true,
            notificationLeadMinutes: 60,
            notificationIntervalMinutes: 20,
            alertMode: "ALARM",
        };
        mockState.itemsById["1"] = sharedItem;
        mockGetSchedule.mockResolvedValue(sharedItem);
        mockUpdateSchedule.mockResolvedValue(commonUpdated);
        mockUpsertMyScheduleTravelPlan.mockResolvedValue(savedPlan);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "강력한 알람 설정 테스트" })
                .props.onPress();
        });

        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "일정 수정 저장" })
                .props.onPress();
        });

        expect(mockUpdateSchedule).toHaveBeenCalledTimes(1);
        expect(mockUpsertMyScheduleTravelPlan).toHaveBeenCalledWith("1", {
            travelMinutes: 36,
            departAt: "2026-07-20T10:24:00.000Z",
            travelMode: "TRANSIT",
            origin: sharedItem.origin,
            route: mockOriginalRoute,
            notificationEnabled: true,
            notificationLeadMinutes: 60,
            notificationIntervalMinutes: 20,
            alertMode: "ALARM",
        });
        expect(mockUpdateSchedule.mock.invocationCallOrder[0])
            .toBeLessThan(mockUpsertMyScheduleTravelPlan.mock.invocationCallOrder[0]);
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockUpsertMyScheduleTravelPlan.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
        expect(mockDispatch).toHaveBeenCalledWith({
            type: "UPDATE_ITEM",
            item: expect.objectContaining({
                title: "공용 저장 완료",
                origin: savedPlan.origin,
                route: savedPlan.route,
                notificationEnabled: true,
                alertMode: "ALARM",
                myTravelPlan: savedPlan,
            }),
        });
        expect(mockRouterSetParams).toHaveBeenCalledWith({ mode: undefined });
    });

    test("공유 일정의 출발 알림이 꺼져 있으면 개인 계획에도 STANDARD를 저장한다", async () => {
        const sharedItem: ScheduleItem = {
            ...mockItem,
            sharePermission: "OWNER",
            notificationEnabled: false,
            alertMode: "ALARM",
        };
        const commonUpdated: ScheduleItem = {
            ...sharedItem,
            notificationEnabled: false,
            alertMode: "STANDARD",
        };
        mockState.itemsById["1"] = sharedItem;
        mockGetSchedule.mockResolvedValue(sharedItem);
        mockUpdateSchedule.mockResolvedValue(commonUpdated);
        mockUpsertMyScheduleTravelPlan.mockResolvedValue({
            scheduleId: 1,
            memberId: 22,
            status: "READY",
            origin: sharedItem.origin,
            destination: sharedItem.destination,
            travelMode: sharedItem.travelMode,
            travelMinutes: sharedItem.travelMinutes,
            departAt: sharedItem.departAt,
            route: sharedItem.route,
            notificationEnabled: false,
            alertMode: "STANDARD",
        });

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "일정 수정 저장" })
                .props.onPress();
        });

        expect(mockUpsertMyScheduleTravelPlan).toHaveBeenCalledWith("1", expect.objectContaining({
            notificationEnabled: false,
            notificationLeadMinutes: undefined,
            notificationIntervalMinutes: undefined,
            alertMode: "STANDARD",
        }));
        expect(mockRouterSetParams).toHaveBeenCalledWith({ mode: undefined });
    });

    test("공유 일정의 개인 계획 저장만 실패하면 공용 응답을 보존하고 화면을 열어 둔다", async () => {
        const sharedItem: ScheduleItem = {
            ...mockItem,
            sharePermission: "EDITOR",
            notificationEnabled: false,
            alertMode: "STANDARD",
        };
        const commonUpdated: ScheduleItem = {
            ...sharedItem,
            title: "공용 저장 완료",
        };
        const refreshed: ScheduleItem = {
            ...commonUpdated,
            travelPlanStatus: "STALE",
        };
        mockState.itemsById["1"] = sharedItem;
        mockGetSchedule
            .mockResolvedValueOnce(sharedItem)
            .mockResolvedValueOnce(refreshed);
        mockUpdateSchedule.mockResolvedValue(commonUpdated);
        mockUpsertMyScheduleTravelPlan.mockRejectedValue(
            new Error("개인 계획 서버 오류"),
        );

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "강력한 알람 설정 테스트" })
                .props.onPress();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "일정 수정 저장" })
                .props.onPress();
        });

        expect(mockDispatch).toHaveBeenCalledWith({
            type: "UPDATE_ITEM",
            item: commonUpdated,
        });
        expect(mockGetSchedule).toHaveBeenCalledTimes(2);
        expect(mockDispatch).toHaveBeenCalledWith({
            type: "UPDATE_ITEM",
            item: refreshed,
        });
        expect(mockRouterSetParams).not.toHaveBeenCalled();
        expect(Alert.alert).toHaveBeenCalledWith(
            "일정은 저장했어요",
            "출발 알림은 저장하지 못했어요. 다시 저장해 주세요.",
        );
        expect(Alert.alert).not.toHaveBeenCalledWith(
            "일정 수정 실패",
            expect.anything(),
        );
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
    });

    test("공유 일정의 경로가 완전하지 않으면 개인 계획 API를 호출하지 않고 서버 응답을 사용한다", async () => {
        const incompleteSharedItem: ScheduleItem = {
            ...mockItem,
            sharePermission: "EDITOR",
            origin: undefined,
            travelMinutes: undefined,
            departAt: undefined,
            route: undefined,
            notificationEnabled: true,
            alertMode: "ALARM",
        };
        const serverUpdated: ScheduleItem = {
            ...incompleteSharedItem,
            notificationEnabled: false,
            alertMode: "STANDARD",
            routeSetupRequired: true,
        };
        mockState.itemsById["1"] = incompleteSharedItem;
        mockGetSchedule.mockResolvedValue(incompleteSharedItem);
        mockUpdateSchedule.mockResolvedValue(serverUpdated);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "일정 수정 저장" })
                .props.onPress();
        });

        expect(mockUpdateSchedule).toHaveBeenCalledWith("1", expect.objectContaining({
            notificationEnabled: false,
            alertMode: "STANDARD",
        }));
        expect(mockUpsertMyScheduleTravelPlan).not.toHaveBeenCalled();
        expect(mockDispatch).toHaveBeenCalledWith({
            type: "UPDATE_ITEM",
            item: serverUpdated,
        });
        expect(mockRouterSetParams).toHaveBeenCalledWith({ mode: undefined });
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
    });

    test("공용 일정 저장이 실패하면 알람 recovery를 실행하지 않는다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);
        mockUpdateSchedule.mockRejectedValue(new Error("공용 저장 실패"));

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root
                .findByProps({ accessibilityLabel: "일정 수정 저장" })
                .props.onPress();
        });

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
        expect(Alert.alert).toHaveBeenCalledWith(
            "일정 수정 실패",
            "공용 저장 실패",
        );
    });

    test("일정 삭제 성공 후 recovery를 한 번 실행하고 이동한다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);
        mockDeleteSchedule.mockResolvedValue(undefined);

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "일정 삭제" })
                .props.onPress();
        });

        const confirmation = jest.mocked(Alert.alert).mock.calls.find(
            ([title]) => title === "일정을 삭제할까요?",
        );
        const destructiveAction = confirmation?.[2]?.[1];
        await act(async () => {
            await destructiveAction?.onPress?.();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });

        expect(mockDeleteSchedule).toHaveBeenCalledWith("1");
        expect(mockRecoverDepartureAlarmsAfterMutation).toHaveBeenCalledTimes(1);
        expect(mockDeleteSchedule.mock.invocationCallOrder[0])
            .toBeLessThan(mockRecoverDepartureAlarmsAfterMutation.mock.invocationCallOrder[0]);
        expect(mockRouterReplace).toHaveBeenCalledWith("/schedule");
    });

    test("일정 삭제 실패 시 recovery를 실행하지 않는다", async () => {
        mockGetSchedule.mockResolvedValue(mockItem);
        mockDeleteSchedule.mockRejectedValue(new Error("삭제 서버 오류"));

        await act(async () => {
            renderer = TestRenderer.create(<ScheduleEditScreen />);
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "일정 삭제" })
                .props.onPress();
        });

        const confirmation = jest.mocked(Alert.alert).mock.calls.find(
            ([title]) => title === "일정을 삭제할까요?",
        );
        const destructiveAction = confirmation?.[2]?.[1];
        await act(async () => {
            await destructiveAction?.onPress?.();
        });

        expect(mockRecoverDepartureAlarmsAfterMutation).not.toHaveBeenCalled();
        expect(Alert.alert).toHaveBeenCalledWith(
            "일정 삭제 실패",
            "삭제 서버 오류",
        );
    });
});
