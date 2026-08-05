import React from "react";
import { Alert, Animated, BackHandler, Dimensions, PanResponder, Platform, StyleSheet } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ScheduleAddModal from "../src/modules/schedule/components/form/ScheduleAddModal";
import { setRoutePlannerResult } from "../src/modules/schedule/routePlannerSession";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";

let mockPathname = "/schedule";
const mockRouterPush = jest.fn();

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("expo-router", () => ({
    usePathname: () => mockPathname,
    useRouter: () => ({ push: mockRouterPush }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@react-native-community/datetimepicker", () => "DateTimePicker");
jest.mock("react-native-calendars", () => ({ Calendar: "Calendar" }));
jest.mock("../src/modules/schedule/components/calendar/CalendarGlassSurface", () => {
    const mockReact = require("react");
    const { View: MockView } = require("react-native");
    return {
        __esModule: true,
        default: ({ children, ...props }: any) => mockReact.createElement(MockView, props, children),
    };
});
jest.mock("../src/modules/map/tmapApi", () => ({
    searchAddressByKeyword: jest.fn(),
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
jest.mock("../src/api/scheduleCalendars", () => ({
    getScheduleCalendars: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/modules/notification/departureAlarm", () => ({
    getDepartureAlarmCapabilities: jest.fn().mockResolvedValue({
        supported: false,
        platform: "ios",
        exactAlarmAuthorized: false,
        fullScreenAuthorized: false,
        notificationAuthorized: false,
        reason: "NATIVE_MODULE_UNAVAILABLE",
    }),
    openExactAlarmSettings: jest.fn().mockResolvedValue(false),
    openFullScreenAlarmSettings: jest.fn().mockResolvedValue(false),
    scheduleDepartureTestAlarm: jest.fn().mockResolvedValue({
        applied: false,
        scheduled: false,
        reason: "NATIVE_MODULE_UNAVAILABLE",
    }),
}));

const category = { id: "work", title: "업무", color: "#FF3B30" };

describe("ScheduleAddModal close flow", () => {
    let renderer: ReactTestRenderer | undefined;
    let springSpy: jest.SpyInstance;
    let alertSpy: jest.SpyInstance;
    const originalPlatform = Platform.OS;

    beforeAll(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        mockPathname = "/schedule";
        mockRouterPush.mockReset();
        springSpy = jest.spyOn(Animated, "spring").mockImplementation(
            () =>
                ({
                    start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }),
                    stop: jest.fn(),
                    reset: jest.fn(),
                } as unknown as Animated.CompositeAnimation),
        );
        alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        springSpy.mockRestore();
        alertSpy.mockRestore();
        Object.defineProperty(Platform, "OS", { value: originalPlatform });
        jest.restoreAllMocks();
    });

    async function renderModal({
        onClose = jest.fn(),
        onSubmit = jest.fn().mockResolvedValue(undefined),
        categories = [category],
        presentation = "sheet",
    }: {
        onClose?: jest.Mock;
        onSubmit?: jest.Mock;
        categories?: (typeof category)[];
        presentation?: "sheet" | "morph";
    } = {}) {
        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <ScheduleAddModal
                        visible
                        onClose={onClose}
                        onSubmit={onSubmit}
                        categories={categories}
                        defaultDay="2026-07-17"
                        presentation={presentation}
                    />
                </ThemeProvider>,
            );
            await Promise.resolve();
        });
        return { onClose, onSubmit };
    }

    test("새 일정의 핵심 입력을 짧고 자연스러운 문구로 보여 준다", async () => {
        await renderModal();

        expect(renderer!.root.findByProps({ children: "새 일정" })).toBeTruthy();
        expect(renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.placeholder)
            .toBe("일정 제목");
        expect(renderer!.root.findByProps({ children: "일시" })).toBeTruthy();
        expect(renderer!.root.findByProps({ children: "출발지·도착지 추가" })).toBeTruthy();
        expect(renderer!.root.findByProps({ children: "경로·출발 알림 설정" })).toBeTruthy();
        expect(renderer!.root.findByProps({ children: "일정 저장" })).toBeTruthy();
        expect(renderer!.root.findAllByProps({ children: "제목을 입력하면 저장할 수 있어요." }))
            .toHaveLength(0);
    });

    test("컴팩트한 그룹 폼의 밀도와 터치 영역을 유지한다", async () => {
        await renderModal({ presentation: "morph" });

        const titleFieldStyle = StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-add-title-field" }).props.style,
        );
        const timeCardStyle = StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-add-time-card" }).props.style,
        );
        const allDaySwitch = renderer!.root.findByProps({ accessibilityLabel: "종일 일정" });
        const switchStyle = StyleSheet.flatten(allDaySwitch.props.style);
        const memoButton = renderer!.root.findByProps({ testID: "schedule-add-memo-collapsed" });
        const memoStyle = StyleSheet.flatten(memoButton.props.style({ pressed: false }));
        const saveStyle = StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-add-save" }).props.style,
        );
        const handleStyle = StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-add-handle" }).props.style,
        );

        expect(titleFieldStyle).toMatchObject({
            minHeight: 56,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: 16,
            backgroundColor: "#f7f7f8",
        });
        expect(timeCardStyle).toMatchObject({
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: 16,
            backgroundColor: "#f7f7f8",
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.placeholderTextColor)
            .toBe("rgba(60,60,67,0.46)");
        expect(switchStyle.transform).toEqual([{ scale: 0.88 }]);
        expect(allDaySwitch.props.hitSlop).toEqual({ top: 8, right: 6, bottom: 8, left: 6 });
        expect(memoStyle).toMatchObject({ minHeight: 52, borderRadius: 16, marginBottom: 14 });
        expect(saveStyle).toMatchObject({ height: 50, borderRadius: 14, backgroundColor: "#ECECF1" });
        expect(handleStyle).toMatchObject({ width: 36, height: 4, opacity: 0.24 });
        expect(renderer!.root.findByProps({ accessibilityLabel: "새 일정 닫기" }).props.hitSlop).toBe(6);
    });

    test("모프 카드는 측정한 내용 높이에 맞춰 떠 있는 카드 크기를 정한다", async () => {
        await renderModal({ presentation: "morph" });

        await act(async () => {
            renderer!.root.findByProps({ testID: "schedule-add-scroll" })
                .props.onContentSizeChange(350, 430);
        });

        const motionStyle = StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-add-card-motion" }).props.style,
        );
        expect(motionStyle.position).toBe("absolute");
        expect(motionStyle.height).toBe(450);
        expect(motionStyle).toMatchObject({
            shadowOpacity: 0.16,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 10 },
            elevation: 16,
        });

        await act(async () => {
            renderer!.root.findByProps({ testID: "schedule-add-scroll" })
                .props.onContentSizeChange(350, 10_000);
        });
        const clampedMotionStyle = StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "schedule-add-card-motion" }).props.style,
        );
        expect(clampedMotionStyle.height).toBe(Dimensions.get("window").height - 28);
    });

    test("종료 시각과 메모를 필요할 때만 펼치고 저장값은 그대로 전달한다", async () => {
        const { onSubmit } = await renderModal();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "종료 시각 설정" })
                .props.onValueChange(true);
            renderer!.root.findByProps({ accessibilityLabel: "메모 추가" }).props.onPress();
        });

        expect(renderer!.root.findAll(node => (
            typeof node.props.accessibilityLabel === "string"
            && node.props.accessibilityLabel.startsWith("종료 날짜 ")
        )).length).toBeGreaterThan(0);
        expect(renderer!.root.findAll(node => (
            typeof node.props.accessibilityLabel === "string"
            && node.props.accessibilityLabel.startsWith("종료 시간 ")
        )).length).toBeGreaterThan(0);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
            renderer!.root.findByProps({ accessibilityLabel: "일정 메모" }).props.onChangeText("창가 자리");
        });
        await act(async () => {
            await renderer!.root.findByProps({ accessibilityLabel: "일정 저장" }).props.onPress();
        });

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ notes: "창가 자리" }));
    });

    test("깨끗한 폼의 닫기 버튼은 확인 없이 닫는다", async () => {
        const { onClose } = await renderModal();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "새 일정 닫기" }).props.onPress();
        });

        expect(alertSpy).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("읽기 전용 공유 카테고리는 새 일정 저장 선택지에서 제외한다", async () => {
        const viewerCategory = {
            ...category,
            id: "shared-viewer",
            shared: true,
            sharePermission: "VIEWER" as const,
        };
        const { onSubmit } = await renderModal({ categories: [viewerCategory] });

        const categoryButton = renderer!.root.findByProps({
            accessibilityLabel: "카테고리 선택, 현재 없음",
        });
        expect(categoryButton.props.accessibilityState.disabled).toBe(true);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("회의");
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "일정 저장" }).props.disabled).toBe(true);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    test("작성한 폼은 닫기 전에 버리기 확인을 거친다", async () => {
        const { onClose } = await renderModal();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
            renderer!.root.findByProps({ accessibilityLabel: "새 일정 닫기" }).props.onPress();
        });

        expect(onClose).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(
            "작성 중인 일정을 닫을까요?",
            expect.any(String),
            expect.any(Array),
            expect.any(Object),
        );

        const buttons = alertSpy.mock.calls[0][2] as Array<{
            text: string;
            onPress?: () => void;
        }>;
        await act(async () => buttons.find(button => button.text === "버리기")?.onPress?.());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("배경을 눌러 닫을 때도 작성한 초안을 보호한다", async () => {
        const { onClose } = await renderModal();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
            renderer!.root
                .findAll(node => node.props.accessible === false && typeof node.props.onPress === "function")[0]
                .props.onPress();
        });

        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    test("시트를 아래로 끌어 닫을 때도 원위치한 뒤 초안을 보호한다", async () => {
        let panConfig: Parameters<typeof PanResponder.create>[0] | undefined;
        const createPanResponder = PanResponder.create.bind(PanResponder);
        jest.spyOn(PanResponder, "create").mockImplementation(config => {
            panConfig = config;
            return createPanResponder(config);
        });
        const { onClose } = await renderModal();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
            renderer!.root.findByProps({ testID: "schedule-add-drag-handle" });
            panConfig?.onPanResponderRelease?.(undefined as never, { dy: 180, dx: 0, vy: 1 } as never);
        });

        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(springSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0 }));
    });

    test("저장 성공은 dirty 확인을 다시 띄우지 않고 닫는다", async () => {
        const { onClose, onSubmit } = await renderModal();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
        });
        await act(async () => {
            await renderer!.root.findByProps({ accessibilityLabel: "일정 저장" }).props.onPress();
        });

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                notificationEnabled: false,
                alertMode: "STANDARD",
            }),
        );
        expect(alertSpy).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("경로 화면을 실제로 다녀온 뒤 새 경로와 출발 시각을 저장 payload에 반영한다", async () => {
        const onClose = jest.fn();
        const onSubmit = jest.fn().mockResolvedValue(undefined);
        const tree = () => (
            <ThemeProvider>
                <ScheduleAddModal
                    visible
                    onClose={onClose}
                    onSubmit={onSubmit}
                    categories={[category]}
                    defaultDay="2026-07-17"
                />
            </ThemeProvider>
        );

        await act(async () => {
            renderer = TestRenderer.create(tree());
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("경로 회의");
            renderer!.root.findByProps({ accessibilityLabel: "출발지와 도착지 추가" }).props.onPress();
            await Promise.resolve();
        });

        const sessionId = mockRouterPush.mock.calls[0]?.[0]?.params?.sessionId as string;
        expect(sessionId).toBeTruthy();

        mockPathname = "/schedule/route-select";
        await act(async () => {
            renderer!.update(tree());
            await Promise.resolve();
        });
        setRoutePlannerResult(sessionId, {
            origin: { name: "집", lat: 37.5, lng: 126.9 },
            destination: { name: "회사", lat: 37.49, lng: 127.02 },
            travelMode: "TRANSIT",
            travelMinutes: 35,
            departureAt: "2026-07-17T00:25:00.000Z",
            route: {
                id: "updated-route",
                mode: "TRANSIT",
                source: "api",
                pathCoords: [
                    { lat: 37.5, lng: 126.9 },
                    { lat: 37.49, lng: 127.02 },
                ],
            },
        });

        mockPathname = "/schedule";
        await act(async () => {
            renderer!.update(tree());
            await Promise.resolve();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 알림" }).props.onValueChange(true);
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.onPress();
            await Promise.resolve();
        });
        await act(async () => {
            await renderer!.root.findByProps({ accessibilityLabel: "일정 저장" }).props.onPress();
        });

        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                origin: { name: "집", lat: 37.5, lng: 126.9 },
                destination: { name: "회사", lat: 37.49, lng: 127.02 },
                travelMode: "TRANSIT",
                travelMinutes: 35,
                departAt: "2026-07-17T00:25:00.000Z",
                notificationEnabled: true,
                alertMode: "ALARM",
                route: expect.objectContaining({
                    id: "updated-route",
                    mode: "TRANSIT",
                    source: "api",
                    pathCoords: [
                        { lat: 37.5, lng: 126.9 },
                        { lat: 37.49, lng: 127.02 },
                    ],
                }),
            }),
        );
    });

    test("저장 버튼을 빠르게 연속으로 눌러도 일정 생성 요청은 한 번만 보낸다", async () => {
        let resolveSubmit!: () => void;
        const onSubmit = jest.fn(
            () =>
                new Promise<void>(resolve => {
                    resolveSubmit = resolve;
                }),
        );
        await renderModal({ onSubmit });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
        });

        const saveButton = renderer!.root.findByProps({
            accessibilityLabel: "일정 저장",
        });
        await act(async () => {
            saveButton.props.onPress();
            saveButton.props.onPress();
            await Promise.resolve();
        });

        expect(onSubmit).toHaveBeenCalledTimes(1);
        await act(async () => {
            resolveSubmit();
            await Promise.resolve();
        });
    });

    test("Android 하드웨어 뒤로가기도 같은 dirty 확인을 사용한다", async () => {
        Object.defineProperty(Platform, "OS", { value: "android" });
        let hardwareBackHandler: (() => boolean) | undefined;
        jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, handler) => {
            hardwareBackHandler = () => handler() === true;
            return { remove: jest.fn() };
        });

        const { onClose } = await renderModal();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
        });

        expect(hardwareBackHandler?.()).toBe(true);
        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    test("오래 켜 둔 앱에서도 폼을 여는 현재 시각을 기본 시작 시각으로 사용한다", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 6, 17, 9, 0));
        const onClose = jest.fn();
        const onSubmit = jest.fn().mockResolvedValue(undefined);
        const tree = (visible: boolean) => (
            <ThemeProvider>
                <ScheduleAddModal
                    visible={visible}
                    onClose={onClose}
                    onSubmit={onSubmit}
                    categories={[category]}
                    defaultDay="2026-07-17"
                />
            </ThemeProvider>
        );

        await act(async () => {
            renderer = TestRenderer.create(tree(false));
            await Promise.resolve();
        });
        jest.setSystemTime(new Date(2026, 6, 17, 17, 15));
        await act(async () => {
            renderer!.update(tree(true));
            await Promise.resolve();
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "시작 시간 오후 5:45" })).toBeDefined();
        jest.useRealTimers();
    });
});
