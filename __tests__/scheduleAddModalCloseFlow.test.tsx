import React from "react";
import { Alert, Animated, BackHandler, PanResponder, Platform } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ScheduleAddModal from "../src/modules/schedule/components/form/ScheduleAddModal";
import { setRoutePlannerResult } from "../src/modules/schedule/routePlannerSession";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import * as env from "../src/api/env";

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
        default: ({ children, ...props }: any) => (
            mockReact.createElement(MockView, props, children)
        ),
    };
});
jest.mock("../src/modules/map/tmapApi", () => ({ searchAddressByKeyword: jest.fn() }));
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

const mockGetScheduleCalendars = (
    jest.requireMock("../src/api/scheduleCalendars") as {
        getScheduleCalendars: jest.Mock;
    }
).getScheduleCalendars;

const category = { id: "work", title: "업무", color: "#FF3B30" };

describe("ScheduleAddModal close flow", () => {
    let renderer: ReactTestRenderer | undefined;
    let springSpy: jest.SpyInstance;
    let alertSpy: jest.SpyInstance;
    const originalPlatform = Platform.OS;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.spyOn(env, "getEnv").mockReturnValue("true");
        mockPathname = "/schedule";
        mockRouterPush.mockReset();
        mockGetScheduleCalendars.mockClear();
        springSpy = jest.spyOn(Animated, "spring").mockImplementation(() => ({
            start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }),
            stop: jest.fn(),
            reset: jest.fn(),
        }) as unknown as Animated.CompositeAnimation);
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
    }: {
        onClose?: jest.Mock;
        onSubmit?: jest.Mock;
        categories?: typeof category[];
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
                    />
                </ThemeProvider>
            );
            await Promise.resolve();
        });
        return { onClose, onSubmit };
    }

    test("깨끗한 폼의 닫기 버튼은 확인 없이 닫는다", async () => {
        const { onClose } = await renderModal();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 생성 닫기" }).props.onPress();
        });

        expect(alertSpy).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("공유 전역 off에서는 숨겨진 캘린더 selector와 조회도 만들지 않는다", async () => {
        jest.spyOn(env, "getEnv").mockReturnValue("false");

        await renderModal();

        expect(mockGetScheduleCalendars).not.toHaveBeenCalled();
        expect(renderer!.root.findAllByProps({
            accessibilityLabel: "공유 캘린더 관리",
        })).toHaveLength(0);
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
            renderer!.root.findByProps({ accessibilityLabel: "일정 생성 닫기" }).props.onPress();
        });

        expect(onClose).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(
            "작성 중인 일정을 닫을까요?",
            expect.any(String),
            expect.any(Array),
            expect.any(Object)
        );

        const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
        await act(async () => buttons.find((button) => button.text === "버리기")?.onPress?.());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("배경을 눌러 닫을 때도 작성한 초안을 보호한다", async () => {
        const { onClose } = await renderModal();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
            renderer!.root
                .findAll((node) => node.props.accessible === false && typeof node.props.onPress === "function")[0]
                .props.onPress();
        });

        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    test("시트를 아래로 끌어 닫을 때도 원위치한 뒤 초안을 보호한다", async () => {
        let panConfig: Parameters<typeof PanResponder.create>[0] | undefined;
        const createPanResponder = PanResponder.create.bind(PanResponder);
        jest.spyOn(PanResponder, "create").mockImplementation((config) => {
            panConfig = config;
            return createPanResponder(config);
        });
        const { onClose } = await renderModal();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
            renderer!.root.findByProps({ testID: "schedule-add-drag-handle" });
            panConfig?.onPanResponderRelease?.(
                undefined as never,
                { dy: 180, dx: 0, vy: 1 } as never
            );
        });

        expect(alertSpy).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(springSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ toValue: 0 })
        );
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
            renderer!.root.findByProps({ accessibilityLabel: "출발지와 도착지 설정" }).props.onPress();
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
            await renderer!.root.findByProps({ accessibilityLabel: "일정 저장" }).props.onPress();
        });

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
            origin: { name: "집", lat: 37.5, lng: 126.9 },
            destination: { name: "회사", lat: 37.49, lng: 127.02 },
            travelMode: "TRANSIT",
            travelMinutes: 35,
            departAt: "2026-07-17T00:25:00.000Z",
            route: expect.objectContaining({
                id: "updated-route",
                mode: "TRANSIT",
                source: "api",
                pathCoords: [
                    { lat: 37.5, lng: 126.9 },
                    { lat: 37.49, lng: 127.02 },
                ],
            }),
        }));
    });

    test("저장 버튼을 빠르게 연속으로 눌러도 일정 생성 요청은 한 번만 보낸다", async () => {
        let resolveSubmit!: () => void;
        const onSubmit = jest.fn(() => new Promise<void>((resolve) => {
            resolveSubmit = resolve;
        }));
        await renderModal({ onSubmit });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 제목" }).props.onChangeText("저녁 약속");
        });

        const saveButton = renderer!.root.findByProps({ accessibilityLabel: "일정 저장" });
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

        expect(renderer!.root.findByProps({ accessibilityLabel: "시작 시간 오후 5:45" }))
            .toBeDefined();
        jest.useRealTimers();
    });
});
