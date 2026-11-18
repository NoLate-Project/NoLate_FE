import React from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import apiClient from "../src/api/api";
import QuickScheduleModal from "../src/modules/schedule/components/form/QuickScheduleModal";
import { QuickScheduleModalShell } from "../src/modules/schedule/components/form/QuickScheduleModalShell";
import { getRoutePlannerInitial, setRoutePlannerResult } from "../src/modules/schedule/routePlannerSession";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type { ScheduleCategory, ScheduleParseResult } from "../src/modules/schedule/types";

const mockRouterPush = jest.fn();
let mockPathname = "/schedule";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
    default: () => ({ ...require("react-native").Dimensions.get("window"), fontScale: 1 }),
}));
jest.mock("expo-router", () => ({
    usePathname: () => mockPathname,
    useRouter: () => ({ push: mockRouterPush }),
}));
jest.mock("react-native-safe-area-context", () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@react-native-community/datetimepicker", () => "DateTimePicker");
jest.mock("expo-av", () => ({
    Audio: {
        Recording: { createAsync: jest.fn() },
        RecordingOptionsPresets: { HIGH_QUALITY: {} },
        requestPermissionsAsync: jest.fn(),
        setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    },
}));
jest.mock("../src/modules/schedule/components/form/QuickScheduleLogoLoader", () => "QuickScheduleLogoLoader");
jest.mock("../src/ui/BrandedLoader", () => "BrandedLoader");
jest.mock("../src/api/api", () => ({ __esModule: true, default: { post: jest.fn() } }));

function parsed(overrides: Partial<ScheduleParseResult> = {}): ScheduleParseResult {
    return {
        title: "서울역 약속",
        startAt: "2026-07-17T20:00:00+09:00",
        destination: { name: "서울역" },
        originSource: "REQUIRED",
        originRequired: false,
        parseSource: "RULE",
        aiAttempted: false,
        needsReview: false,
        warnings: [],
        missingFields: [],
        confidence: {
            overall: 0.97,
            level: "HIGH",
            fields: { date: 0.98, time: 0.98, destination: 0.94 },
            reasons: [],
        },
        ...overrides,
    };
}

function parsedWithReadyRoute(overrides: Partial<ScheduleParseResult> = {}): ScheduleParseResult {
    return parsed({
        origin: { name: "집", lat: 37.5, lng: 127 },
        destination: { name: "서울역", lat: 37.55, lng: 126.97 },
        travelMode: "TRANSIT",
        travelMinutes: 30,
        route: {
            routeInfo: {
                id: "route-1",
                originName: "집",
                destinationName: "서울역",
                totalDurationMinutes: 30,
                departureTime: "2026-07-17T10:30:00.000Z",
                arrivalTime: "2026-07-17T11:00:00.000Z",
                timeBasis: "estimated",
                steps: [
                    {
                        id: "bus-1",
                        type: "BUS",
                        title: "버스 이동",
                        coordinates: [
                            { latitude: 37.5, longitude: 127 },
                            { latitude: 37.55, longitude: 126.97 },
                        ],
                    },
                ],
            },
        },
        notificationEnabled: true,
        notificationLeadMinutes: 30,
        alertMode: "STANDARD",
        ...overrides,
    });
}

describe("QuickScheduleModal flow", () => {
    let renderer: ReactTestRenderer | undefined;
    let alertSpy: jest.SpyInstance;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        jest.useFakeTimers();
        jest.mocked(apiClient.post).mockReset();
        mockRouterPush.mockReset();
        mockPathname = "/schedule";
        alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
        alertSpy.mockRestore();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    async function renderAndAnalyze(
        onAnalyze: jest.Mock<Promise<ScheduleParseResult>, [string, unknown?]>,
        onSave: jest.Mock = jest.fn(),
        defaultCategory: ScheduleCategory = {
            id: "category-1",
            title: "일정",
            color: "#246BFE",
        },
        onFeedback: jest.Mock = jest.fn(),
        categories: ScheduleCategory[] = [defaultCategory],
    ) {
        let renderedCategories = categories;
        const renderTree = () => (
            <ThemeProvider>
                <QuickScheduleModal
                    visible
                    defaultDay="2026-07-17"
                    defaultCategory={defaultCategory}
                    categories={renderedCategories}
                    onAnalyze={onAnalyze}
                    onSave={onSave}
                    onFeedback={onFeedback}
                    onClose={jest.fn()}
                />
            </ThemeProvider>
        );
        await act(async () => {
            renderer = TestRenderer.create(renderTree());
        });

        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 문장" })
                .props.onChangeText("7월 17일 오후 8시 서울역 약속");
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" }).props.onPress();
            await Promise.resolve();
        });
        expect(renderer!.root.findAllByProps({ settleOnly: true })).toHaveLength(0);

        return async (nextCategories?: ScheduleCategory[]) => {
            if (nextCategories) renderedCategories = nextCategories;
            await act(async () => {
                renderer!.update(renderTree());
            });
        };
    }

    async function completeRouteFromNotification(rerender: () => Promise<void>) {
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.onPress();
        });

        mockPathname = "/schedule/route-select";
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 경로 설정" }).props.onPress();
        });
        await rerender();

        const sessionId = mockRouterPush.mock.calls.at(-1)?.[0].params.sessionId as string;
        const routeResult = {
            origin: { name: "집", lat: 37.5, lng: 127 },
            destination: { name: "서울역", lat: 37.55, lng: 126.97 },
            travelMode: "TRANSIT",
            travelMinutes: 30,
            departureAt: "2026-07-17T10:30:00.000Z",
            route: {
                routeInfo: {
                    id: "route-1",
                    originName: "집",
                    destinationName: "서울역",
                    totalDurationMinutes: 30,
                    departureTime: "2026-07-17T10:30:00.000Z",
                    arrivalTime: "2026-07-17T11:00:00.000Z",
                    timeBasis: "estimated",
                    steps: [
                        {
                            id: "bus-1",
                            type: "BUS",
                            title: "버스 이동",
                            coordinates: [
                                { latitude: 37.5, longitude: 127 },
                                { latitude: 37.55, longitude: 126.97 },
                            ],
                        },
                    ],
                },
            },
        } satisfies Parameters<typeof setRoutePlannerResult>[1];
        setRoutePlannerResult(sessionId, routeResult);

        mockPathname = "/schedule";
        await rerender();
        return routeResult;
    }

    function findButtonByText(label: string) {
        const button = renderer!.root.findAll(
            node =>
                node.props.accessibilityRole === "button" &&
                typeof node.props.onPress === "function" &&
                node.findAll(child => child.props.children === label).length > 0,
        )[0];

        if (!button) throw new Error(`버튼을 찾지 못했습니다: ${label}`);
        return button;
    }

    test("미리보기의 장소와 알림 행은 각각 편집을 먼저 연다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "장소 수정" }).props.onPress();
        });
        expect(mockRouterPush).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 목적지" })).toBeDefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "경로 찾기" })).toBeDefined();
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "장소만 적용" })).toHaveLength(0);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 미리보기로 돌아가기" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.onPress();
        });
        expect(mockRouterPush).not.toHaveBeenCalled();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 경로 설정" }).props.onPress();
        });
        expect(mockRouterPush).toHaveBeenCalledTimes(1);
        expect(mockRouterPush).toHaveBeenCalledWith({
            pathname: "/schedule/route-select",
            params: { sessionId: expect.stringMatching(/^quick-route-/) },
        });
    });

    test("경로가 있는 장소를 바꾸면 미리보기에서 새 경로를 바로 설정한다", async () => {
        const rerender = await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));
        const previousRoute = await completeRouteFromNotification(rerender);
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 미리보기로 돌아가기" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "장소 수정" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 목적지" }).props.onChangeText("용산역");
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "장소만 적용" }).props.onPress();
        });

        expect(renderer!.root.findAllByProps({ children: "장소가 바뀌어 이전 경로를 해제했어요." }).length).toBeGreaterThan(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.accessibilityValue.text).toBe("없음");
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "새 경로 설정" }).props.onPress();
        });
        expect(mockRouterPush).toHaveBeenCalledTimes(2);
        const sessionId = mockRouterPush.mock.calls.at(-1)?.[0].params.sessionId as string;
        expect(getRoutePlannerInitial(sessionId)).toMatchObject({
            destination: { name: "용산역" },
            route: undefined,
        });

        mockPathname = "/schedule/route-select";
        await rerender();
        setRoutePlannerResult(sessionId, {
            ...previousRoute,
            destination: { name: "용산역", lat: 37.529, lng: 126.964 },
            route: {
                routeInfo: {
                    ...previousRoute.route.routeInfo,
                    id: "route-2",
                    destinationName: "용산역",
                },
            },
        });
        mockPathname = "/schedule";
        await rerender();

        expect(renderer!.root.findAllByProps({ accessibilityLabel: "새 경로 설정" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "장소 수정" }).props.accessibilityValue.text).toBe("용산역");
        expect(renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.accessibilityValue.text).toBe("없음, 알림 미설정");
        expect(renderer!.root.findAllByProps({ children: "일정을 저장하면 새 경로가 반영돼요." }).length).toBeGreaterThan(0);
    });

    test("장소 수정에서 경로 찾기를 취소하면 장소 초안을 복원하고 새 경로에만 반영한다", async () => {
        const initial = parsedWithReadyRoute();
        const rerender = await renderAndAnalyze(jest.fn().mockResolvedValue(initial));
        const openPlace = () => renderer!.root.findByProps({ accessibilityLabel: "장소 수정" }).props.onPress();
        const destination = () => renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 목적지" });
        const openRoute = () => renderer!.root.findByProps({ accessibilityLabel: "경로 찾기" }).props.onPress();

        await act(async () => openPlace());
        await act(async () => destination().props.onChangeText("서울 역"));
        expect(renderer!.root.findByProps({ accessibilityLabel: "경로 변경" })).toBeDefined();
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "장소만 적용" })).toHaveLength(0);

        await act(async () => destination().props.onChangeText("용산역"));
        expect(renderer!.root.findByProps({ accessibilityLabel: "장소만 적용" })).toBeDefined();
        expect(renderer!.root.findAllByProps({ children: "기존 경로와 출발 알림이 해제돼요." }).length).toBeGreaterThan(0);
        await act(async () => openRoute());
        const canceledSession = mockRouterPush.mock.calls.at(-1)?.[0].params.sessionId;
        expect(mockRouterPush).toHaveBeenLastCalledWith({
            pathname: "/schedule/route-select",
            params: { sessionId: canceledSession, entrySource: "quick-schedule-location" },
        });
        expect(getRoutePlannerInitial(canceledSession)).toMatchObject({ destination: { name: "용산역" }, route: undefined });
        mockPathname = "/schedule/route-select";
        await rerender();
        mockPathname = "/schedule";
        await rerender();
        expect(destination().props.value).toBe("용산역");
        await act(async () => renderer!.root.findByProps({ accessibilityLabel: "일정 미리보기로 돌아가기" }).props.onPress());
        expect(renderer!.root.findByProps({ accessibilityLabel: "장소 수정" }).props.accessibilityValue.text).toBe("서울역");
        const previousNotification = renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.accessibilityValue.text;
        expect(previousNotification).not.toContain("없음");

        await act(async () => openPlace());
        await act(async () => renderer!.root.findByProps({ accessibilityLabel: "경로 변경" }).props.onPress());
        const appliedSession = mockRouterPush.mock.calls.at(-1)?.[0].params.sessionId;
        expect(getRoutePlannerInitial(appliedSession)).toMatchObject({ destination: initial.destination, route: initial.route });
        mockPathname = "/schedule/route-select";
        await rerender();
        setRoutePlannerResult(appliedSession, {
            origin: initial.origin,
            destination: { name: "용산역", lat: 37.529, lng: 126.964 },
            travelMode: "TRANSIT",
            travelMinutes: 30,
            departureAt: "2026-07-17T10:30:00.000Z",
            route: initial.route,
        });
        mockPathname = "/schedule";
        await rerender();
        expect(renderer!.root.findByProps({ accessibilityLabel: "장소 수정" }).props.accessibilityValue.text).toBe("용산역");
        expect(renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.accessibilityValue.text).toBe("없음, 알림 미설정");
    });

    test("분석 신뢰도 수치는 숨기고 장소와 알림을 일정 정보로 보여준다", async () => {
        await renderAndAnalyze(
            jest.fn().mockResolvedValue(
                parsed({
                    confidence: {
                        overall: 0.86,
                        level: "MEDIUM",
                        recognition: 0.84,
                        fields: { date: 0.98, time: 0.86, destination: 0.82 },
                        reasons: ["음성 인식 결과를 확인해 주세요."],
                    },
                }),
            ),
        );

        expect(renderer!.root.findAllByProps({ accessibilityRole: "summary" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "장소 수정" })).toBeDefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "알림 수정" })).toBeDefined();
    });

    test("접힌 원문을 펼칠 때만 첫 문장을 스크롤로 드러낸다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));
        const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
        try {
            const root = renderer!.root;
            const scroll = root.findByProps({ testID: "quick-preview-scroll" });
            const toggle = root.findByProps({ testID: "quick-schedule-preview-source-summary" });
            const section = root.findByProps({ testID: "quick-schedule-preview-source-section" });
            act(() => scroll.props.onLayout({ nativeEvent: { layout: { height: 260 } } }));
            act(() => scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 180 } } }));
            act(() => toggle.props.onPress());
            const layout = { nativeEvent: { layout: { y: 400, height: 220 } } };
            act(() => section.props.onLayout(layout));
            expect(scrollTo).toHaveBeenCalledWith({ y: 284, animated: expect.any(Boolean) });
            act(() => section.props.onLayout(layout));
            expect(scrollTo).toHaveBeenCalledTimes(1);
        } finally {
            scrollTo.mockRestore();
        }
    });

    test("분석에 사용한 문장은 펼친 원문에서, 미리보기 항목의 값은 해당 행에서 제공한다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        expect(renderer!.root.findByProps({ accessibilityLabel: "입력 내용 수정" }).props.accessibilityValue).toBeUndefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "제목 수정" }).props.accessibilityValue).toEqual({
            text: "서울역 약속",
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "날짜 수정" }).props.accessibilityValue).toEqual({
            text: "2026년 7월 17일 (금)",
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "시간 수정" }).props.accessibilityValue).toEqual({
            text: "오후 8:00",
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "장소 수정" }).props.accessibilityValue).toEqual({
            text: "서울역",
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.accessibilityValue).toEqual({
            text: "없음",
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "메모 수정" }).props.accessibilityValue).toEqual({
            text: "없음",
        });
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "빠른 일정 입력 수정" })).toHaveLength(0);
        const sourceToggle = renderer!.root.findByProps({ testID: "quick-schedule-preview-source-summary" });
        expect(sourceToggle.props.accessibilityRole).toBe("button");
        expect(sourceToggle.props.accessibilityState).toEqual({ expanded: false });
        expect(renderer!.root.findAllByProps({ testID: "quick-schedule-preview-source-text" })).toHaveLength(0);
        await act(async () => { sourceToggle.props.onPress(); });
        expect(sourceToggle.props.accessibilityState).toEqual({ expanded: true });
        expect(renderer!.root.findByProps({ testID: "quick-schedule-preview-source-text" }).props.children)
            .toBe("7월 17일 오후 8시 서울역 약속");
        await act(async () => { sourceToggle.props.onPress(); });
        expect(sourceToggle.props.accessibilityState).toEqual({ expanded: false });
        expect(renderer!.root.findByProps({ testID: "quick-schedule-preview-edit-button" }).props.accessibilityLabel)
            .toBe("입력 내용 수정");
        const titleAction = renderer!.root.findByProps({ accessibilityLabel: "제목 수정" });
        expect(StyleSheet.flatten(titleAction.props.style({ pressed: false }))).toMatchObject({ minHeight: 44 });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "quick-schedule-preview-title-category-line" }).props.style,
        )).toMatchObject({ minHeight: 44, flexDirection: "row", alignItems: "center" });
        expect(titleAction.findAllByProps({ numberOfLines: 2 }).length).toBeGreaterThan(0);
        for (const field of ["제목", "날짜", "시간", "장소", "알림", "메모"]) {
            const action = renderer!.root.findByProps({ accessibilityLabel: `${field} 수정` });
            expect(action.findAllByProps({ name: "pencil-outline", accessible: false }).length).toBeGreaterThan(0);
        }
        expect(StyleSheet.flatten(renderer!.root.findByProps({ testID: "quick-schedule-preview-date-time" }).props.style))
            .toMatchObject({ flexDirection: "column" });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "quick-schedule-preview-edit-button" }).props.style({ pressed: false }),
        )).toMatchObject({ flex: 1, height: 46 });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "quick-schedule-preview-primary-button" }).props.style({ pressed: false }),
        )).toMatchObject({ flex: 1.22, height: 46 });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "quick-schedule-preview-actions" }).props.style,
        )).toMatchObject({ flexDirection: "row", alignItems: "center", gap: 8 });
        expect(findButtonByText("입력 수정")).toBeDefined();
        expect(findButtonByText("일정 저장")).toBeDefined();
    });

    test("요청한 출발 알림에 경로가 없으면 미리보기에서 경로 필요를 표시한다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed({ notificationEnabled: true, notificationLeadMinutes: 30 })));
        const notification = renderer!.root.findByProps({ accessibilityLabel: "알림 수정" });
        expect(notification.props.accessibilityValue).toEqual({ text: "없음, 경로 설정 필요" });
    });

    test("제목 옆 선택 박스에서 쓰기 가능한 카테고리를 고르고 그대로 저장한다", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const personalCategory: ScheduleCategory = {
            id: "personal",
            title: "개인",
            color: "#34C759",
        };
        const workCategory: ScheduleCategory = {
            id: "work",
            title: "업무",
            color: "#FF9500",
        };
        const sharedEditorCategory: ScheduleCategory = {
            id: "shared-editor",
            title: "프로젝트",
            color: "#AF52DE",
            shared: true,
            sharePermission: "EDITOR",
        };
        const sharedViewerCategory: ScheduleCategory = {
            id: "shared-viewer",
            title: "받은 일정",
            color: "#8E8E93",
            shared: true,
            sharePermission: "VIEWER",
        };

        await renderAndAnalyze(
            jest.fn().mockResolvedValue(parsed()),
            onSave,
            personalCategory,
            jest.fn(),
            [personalCategory, workCategory, sharedEditorCategory, sharedViewerCategory],
        );

        const categoryTrigger = renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 개인" });
        expect(categoryTrigger.props.accessibilityState).toMatchObject({ expanded: false, disabled: false });
        expect(categoryTrigger.props.hitSlop).toEqual({ top: 5, right: 4, bottom: 5, left: 4 });
        expect(StyleSheet.flatten(categoryTrigger.props.style({ pressed: false }))).toMatchObject({
            maxWidth: 128,
            minHeight: 34,
            borderWidth: 1,
        });
        expect(renderer!.root.findAllByProps({ accessibilityRole: "radiogroup" })).toHaveLength(0);

        await act(async () => {
            categoryTrigger.props.onPress();
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 개인" }).props.accessibilityState)
            .toMatchObject({ expanded: true });
        const openPickerSlot = StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "quick-schedule-preview-category-picker-slot" }).props.style,
        );
        expect(openPickerSlot.marginBottom._config.outputRange).toEqual([-12, 0]);
        expect(openPickerSlot.paddingTop._config.outputRange).toEqual([0, 6]);
        expect(renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리" })).toBeDefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "프로젝트 카테고리" })).toBeDefined();
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "받은 일정 카테고리" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "개인 카테고리" }).props.accessibilityState)
            .toMatchObject({ checked: true });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 업무" }).props.accessibilityState)
            .toMatchObject({ expanded: false, disabled: false });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "메모 수정" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 미리보기로 돌아가기" }).props.onPress();
        });
        expect(alertSpy).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 업무" })).toBeDefined();

        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
        });

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ category: workCategory }));
    });

    test("선택한 카테고리가 갱신 목록에서 사라지면 유효한 기본 카테고리로 복구한다", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const personalCategory: ScheduleCategory = {
            id: "personal",
            title: "개인",
            color: "#34C759",
        };
        const workCategory: ScheduleCategory = {
            id: "work",
            title: "업무",
            color: "#FF9500",
        };
        const rerender = await renderAndAnalyze(
            jest.fn().mockResolvedValue(parsed()),
            onSave,
            personalCategory,
            jest.fn(),
            [personalCategory, workCategory],
        );

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 개인" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리" }).props.onPress();
        });
        await rerender([personalCategory]);

        expect(renderer!.root.findAllByProps({ accessibilityLabel: "업무 카테고리" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 개인" })).toBeDefined();

        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
        });
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ category: personalCategory }));
    });

    test("기본 카테고리가 서버 목록에서 사라지면 남아 있는 카테고리로 복구한다", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const personalCategory: ScheduleCategory = {
            id: "personal",
            title: "개인",
            color: "#34C759",
        };
        const workCategory: ScheduleCategory = {
            id: "work",
            title: "업무",
            color: "#FF9500",
        };
        const rerender = await renderAndAnalyze(
            jest.fn().mockResolvedValue(parsed()),
            onSave,
            personalCategory,
            jest.fn(),
            [personalCategory, workCategory],
        );

        await rerender([workCategory]);

        expect(renderer!.root.findAllByProps({ accessibilityLabel: "개인 카테고리" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 업무" })).toBeDefined();

        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
        });
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ category: workCategory }));
    });

    test("열린 상태에서 카테고리가 비면 선택 박스를 닫고 비활성화한다", async () => {
        const personalCategory: ScheduleCategory = {
            id: "personal",
            title: "개인",
            color: "#34C759",
        };
        const rerender = await renderAndAnalyze(
            jest.fn().mockResolvedValue(parsed()),
            jest.fn(),
            personalCategory,
            jest.fn(),
            [personalCategory],
        );

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 개인" }).props.onPress();
        });
        await rerender([]);

        expect(renderer!.root.findAllByProps({ accessibilityLabel: "개인 카테고리" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 없음" }).props.accessibilityState)
            .toMatchObject({ expanded: false, disabled: true });
    });

    test("읽기 전용 기본값은 건너뛰고 첫 쓰기 가능 카테고리를 최초 선택한다", async () => {
        const viewerCategory: ScheduleCategory = {
            id: "viewer",
            title: "받은 일정",
            color: "#8E8E93",
            shared: true,
            sharePermission: "VIEWER",
        };
        const writableCategory: ScheduleCategory = {
            id: "writable",
            title: "내 일정",
            color: "#246BFE",
        };

        await renderAndAnalyze(
            jest.fn().mockResolvedValue(parsed()),
            jest.fn(),
            viewerCategory,
            jest.fn(),
            [viewerCategory, writableCategory],
        );

        expect(renderer!.root.findAllByProps({ accessibilityLabel: "받은 일정 카테고리" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "카테고리 선택, 현재 내 일정" })).toBeDefined();
    });

    test("제목·날짜·시간은 반복 화살표 없이 편집 동작을 제공한다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        expect(renderer!.root.findByProps({ accessibilityLabel: "제목 수정" })).toBeDefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "날짜 수정" })).toBeDefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "시간 수정" })).toBeDefined();
        expect(
            renderer!.root
                .findByProps({ testID: "quick-schedule-preview-date-time" })
                .findAllByProps({ name: "chevron-forward" }),
        ).toHaveLength(0);
        expect(
            renderer!.root
                .findByProps({ testID: "quick-schedule-preview-title-category-line" })
                .findAllByProps({ name: "chevron-forward" }),
        ).toHaveLength(0);
    });

    test("날짜와 시간은 각각 해당 편집기를 연다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "날짜 수정" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ mode: "date" })).toBeDefined();

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 미리보기로 돌아가기" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "시간 수정" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ mode: "time" })).toBeDefined();
    });

    test("빠른 일정의 목표 시각을 수정해 저장하면 같은 ODsay 경로를 조회한다", async () => {
        jest.setSystemTime(new Date("2026-11-15T10:30:00Z"));
        const onSave = jest.fn().mockResolvedValue(undefined);
        const base = parsedWithReadyRoute();
        const { routeInfo } = base.route as { routeInfo: Record<string, unknown> };
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsedWithReadyRoute({
            startAt: "2026-11-22T10:50:00Z",
            route: {
                id: "odsay-subway", mode: "TRANSIT", provider: "odsay", source: "api", minutes: 30,
                transitLegs: [{
                    kind: "SUBWAY", startName: "남영", endName: "서울역", label: "1호선",
                    navigationEvidence: {
                        provider: "odsay", version: 1,
                        subwayIdentifiers: { startID: "133", endID: "132", lanes: [{ sourceIndex: 0, subwayCityCode: "1000", subwayCode: "1" }] },
                        stopOccurrences: [
                            { name: "남영", routingStationID: "133", providerSequence: 0, sourceIndex: 0 },
                            { name: "서울역", routingStationID: "132", providerSequence: 1, sourceIndex: 1 },
                        ],
                    },
                }],
                routeInfo: { ...routeInfo, provider: "odsay", providerTimeBasis: "timetable", timeBasis: "provider_schedule",
                    departureTime: "2026-11-22T10:17:00Z", arrivalTime: "2026-11-22T10:47:00Z",
                    steps: [{ id: "rail", type: "SUBWAY", title: "1호선", durationMinutes: 28 }],
                },
            },
        })), onSave);
        jest.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { preview: {
            departureAt: "2026-11-22T10:11:45Z", arrivalAt: "2026-11-22T10:40:00Z",
            rides: [{ boardingAt: "2026-11-22T10:13:00Z", arrivalAt: "2026-11-22T10:40:00Z" }],
            transferTimings: [],
        } } } });

        await act(async () => renderer!.root.findByProps({ accessibilityLabel: "시간 수정" }).props.onPress());
        await act(async () => renderer!.root.findByProps({ mode: "time" }).props.onChange(
            { type: "set" }, new Date("2026-11-22T10:44:00Z"),
        ));
        await act(async () => renderer!.root.findByProps({ accessibilityLabel: "수정 확인" }).props.onPress());
        await act(async () => findButtonByText("일정 저장").props.onPress());

        expect(apiClient.post).toHaveBeenCalledTimes(1);
        expect(apiClient.post).toHaveBeenCalledWith("/api/routes/transit/timetable-preview", expect.objectContaining({
            targetArrivalAt: "2026-11-22T10:44:00.000Z", orderedStops: [["남영", "서울역"]],
        }), expect.anything());
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            startAt: "2026-11-22T10:44:00.000Z", departAt: "2026-11-22T10:11:45.000Z",
            travelMinutes: 29, notificationEnabled: true, notificationLeadMinutes: 30,
        }));
    });

    test("명시적 종료 시간이 있어도 날짜와 전체 시간 범위를 각각 읽고 편집할 수 있다", async () => {
        await renderAndAnalyze(
            jest.fn().mockResolvedValue(
                parsed({
                    endAt: "2026-07-17T21:00:00+09:00",
                    hasExplicitEndTime: true,
                }),
            ),
        );

        const dateTimeGroup = renderer!.root.findByProps({ testID: "quick-schedule-preview-date-time" });
        const dateButton = renderer!.root.findByProps({ accessibilityLabel: "날짜 수정" });
        const timeButton = renderer!.root.findByProps({ accessibilityLabel: "시간 수정" });

        expect(dateButton.props.accessibilityValue).toEqual({ text: "2026년 7월 17일 (금)" });
        expect(timeButton.props.accessibilityValue).toEqual({ text: "오후 8:00 ~ 오후 9:00" });
        expect(StyleSheet.flatten(dateButton.props.style({ pressed: false })).minHeight).toBe(44);
        expect(StyleSheet.flatten(timeButton.props.style({ pressed: false })).minHeight).toBe(44);
        expect(dateTimeGroup.findAll(node => node.props.children === "·")).toHaveLength(0);
    });

    test("큰 제목을 누르면 같은 모달의 제목 편집기를 연다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "제목 수정" }).props.onPress();
        });

        expect(renderer!.root.findByProps({ placeholder: "제목 입력" }).props.value).toBe("서울역 약속");
        expect(renderer!.root.findByProps({ accessibilityLabel: "일정 미리보기로 돌아가기" })).toBeDefined();
    });

    test("입력 방식 탭을 본문 스크롤 영역 밖에 유지한다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용 수정" }).props.onPress();
        });

        const root = renderer!.root;
        const inputScroll = root.findAllByProps({ testID: "quick-schedule-input-scroll" })[0];
        expect(root.findAllByProps({ accessibilityRole: "tab" }).length).toBeGreaterThanOrEqual(3);
        expect(inputScroll.findAllByProps({ accessibilityRole: "tab" })).toHaveLength(0);
    });

    test("붙여넣은 내용의 공백과 줄바꿈을 미리보기와 입력 복귀에서 보존한다", async () => {
        const analyze = jest.fn().mockResolvedValue(parsed());
        await renderAndAnalyze(analyze);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용 수정" }).props.onPress();
        });

        const input = () => renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 문장" });
        expect(input().props.value).toBe("7월 17일 오후 8시 서울역 약속");

        const pasted = "\n  7월 17일 오후 8시\n서울역 약속  \n";
        await act(async () => { input().props.onChangeText(pasted); });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" }).props.onPress();
        });
        expect(analyze).toHaveBeenLastCalledWith(pasted.trim(), expect.objectContaining({ inputMode: "text" }));
        await act(async () => {
            renderer!.root.findByProps({ testID: "quick-schedule-preview-source-summary" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ testID: "quick-schedule-preview-source-text" }).props.children).toBe(pasted);
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용 수정" }).props.onPress();
        });
        expect(input().props.value).toBe(pasted);
    });

    test("빈 빠른 일정은 확인 없이 닫는다", async () => {
        const onClose = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleModal
                        visible
                        defaultDay="2026-07-17"
                        defaultCategory={{ id: "category-1", title: "일정", color: "#246BFE" }}
                        onAnalyze={jest.fn()}
                        onSave={jest.fn()}
                        onClose={onClose}
                    />
                </ThemeProvider>,
            );
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 등록 닫기" }).props.onPress();
            jest.runAllTimers();
        });

        expect(alertSpy).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("작성 중 X를 누르면 계속 작성하거나 작성을 취소할 수 있다", async () => {
        const onClose = jest.fn();

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleModal
                        visible
                        defaultDay="2026-07-17"
                        defaultCategory={{ id: "category-1", title: "일정", color: "#246BFE" }}
                        onAnalyze={jest.fn()}
                        onSave={jest.fn()}
                        onClose={onClose}
                    />
                </ThemeProvider>,
            );
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 문장" }).props.onChangeText("저녁 약속");
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 등록 닫기" }).props.onPress();
        });

        expect(alertSpy).toHaveBeenCalledWith(
            "작성 중인 일정이 있어요",
            "지금 닫으면 입력한 내용은 저장되지 않아요.",
            expect.arrayContaining([
                expect.objectContaining({ text: "계속 작성", style: "cancel" }),
                expect.objectContaining({ text: "작성 취소", style: "destructive" }),
            ]),
            expect.objectContaining({ cancelable: true }),
        );
        expect(onClose).not.toHaveBeenCalled();

        const continueButton = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(button => button.text === "계속 작성");
        await act(async () => continueButton?.onPress?.());
        expect(renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 문장" }).props.value).toBe("저녁 약속");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 등록 닫기" }).props.onPress();
        });
        const discardButton = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(button => button.text === "작성 취소");
        await act(async () => {
            discardButton?.onPress?.();
            jest.runAllTimers();
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("미리보기 배경을 눌러도 작성 중인 초안을 바로 버리지 않는다", async () => {
        const onClose = jest.fn();
        const renderTree = () => (
            <ThemeProvider>
                <QuickScheduleModal
                    visible
                    defaultDay="2026-07-17"
                    defaultCategory={{ id: "category-1", title: "일정", color: "#246BFE" }}
                    onAnalyze={jest.fn().mockResolvedValue(parsed())}
                    onSave={jest.fn()}
                    onClose={onClose}
                />
            </ThemeProvider>
        );

        await act(async () => {
            renderer = TestRenderer.create(renderTree());
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 문장" }).props.onChangeText("서울역 약속");
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" }).props.onPress();
            await Promise.resolve();
        });
        await act(async () => jest.advanceTimersByTime(230));
        await act(async () => {
            renderer!.root.findByProps({ testID: "quick-schedule-backdrop" }).props.onPress();
        });

        expect(alertSpy).toHaveBeenCalledWith(
            "작성 중인 일정이 있어요",
            "지금 닫으면 입력한 내용은 저장되지 않아요.",
            expect.any(Array),
            expect.objectContaining({ cancelable: true }),
        );
        expect(onClose).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ accessibilityLabel: "제목 수정" })).toBeDefined();
    });

    test("메모를 적용하면 같은 모달의 열린 미리보기에 반영한다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "메모 수정" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ placeholder: "메모 입력" }).props.value).toBe("");
        await act(async () => {
            renderer!.root.findByProps({ placeholder: "메모 입력" }).props.onChangeText("예약자 이름 확인");
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "수정 확인" }).props.onPress();
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "메모 수정" }).props.accessibilityValue).toEqual({
            text: "예약자 이름 확인",
        });
        const memoButton = renderer!.root.findByProps({ accessibilityLabel: "메모 수정" });
        expect(memoButton.findAll(node => node.props.children === "예약자 이름 확인")[0].props.numberOfLines).toBe(2);
    });

    test("일정 만들기 실패 뒤 모달을 닫지 않고 입력 내용을 수정할 수 있다", async () => {
        const onAnalyze = jest.fn().mockRejectedValue(new Error("분석 서버 오류"));
        await renderAndAnalyze(onAnalyze);

        const labels = renderer!.root.findAllByType(Text).map(node => node.props.children);
        expect(labels).toContain("일정을 확인하지 못했어요");
        expect(labels).toContain("7월 17일 오후 8시 서울역 약속");
        expect(renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 입력 수정" })).toBeDefined();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 입력 수정" }).props.onPress();
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 문장" }).props.value).toBe(
            "7월 17일 오후 8시 서울역 약속",
        );
    });

    test("경로 설정을 취소하면 기존 초안의 알림 수정 화면으로 돌아온다", async () => {
        const rerender = await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.onPress();
        });

        mockPathname = "/schedule/route-select";
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 경로 설정" }).props.onPress();
        });

        await rerender();
        mockPathname = "/schedule";
        await rerender();

        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "일정 미리보기로 돌아가기",
            }),
        ).toBeDefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 경로 설정" })).toBeDefined();
    });

    test("경로 설정을 완료하면 적용된 경로의 알림 수정 화면으로 돌아온다", async () => {
        const rerender = await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.onPress();
        });

        mockPathname = "/schedule/route-select";
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 경로 설정" }).props.onPress();
        });
        await rerender();

        const sessionId = mockRouterPush.mock.calls[0][0].params.sessionId as string;
        setRoutePlannerResult(sessionId, {
            origin: { name: "집", lat: 37.5, lng: 127 },
            destination: { name: "서울역", lat: 37.55, lng: 126.97 },
            travelMode: "TRANSIT",
            travelMinutes: 30,
            departureAt: "2026-07-17T10:30:00.000Z",
            route: {
                routeInfo: {
                    id: "route-1",
                    originName: "집",
                    destinationName: "서울역",
                    totalDurationMinutes: 30,
                    departureTime: "2026-07-17T10:30:00.000Z",
                    arrivalTime: "2026-07-17T11:00:00.000Z",
                    timeBasis: "estimated",
                    steps: [
                        {
                            id: "bus-1",
                            type: "BUS",
                            title: "버스 이동",
                            coordinates: [
                                { latitude: 37.5, longitude: 127 },
                                { latitude: 37.55, longitude: 126.97 },
                            ],
                        },
                    ],
                },
            },
        });

        mockPathname = "/schedule";
        await rerender();

        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "일정 미리보기로 돌아가기",
            }),
        ).toBeDefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "수정 확인" })).toBeDefined();
        expect(
            renderer!.root.findAllByProps({
                accessibilityLabel: "빠른 일정 경로 설정",
            }),
        ).toHaveLength(0);
    });

    test("경로 완료 후 출발 알림은 기본 OFF이고 ON하면 1시간이 기본 선택된다", async () => {
        const rerender = await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));
        await completeRouteFromNotification(rerender);

        const notificationSwitch = renderer!.root.findByProps({
            accessibilityLabel: "출발 알림 받기",
        });
        expect(notificationSwitch.props.value).toBe(false);
        expect(renderer!.root.findAllByProps({ accessibilityRole: "radio" })).toHaveLength(0);

        await act(async () => {
            notificationSwitch.props.onValueChange(true);
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "출발 알림 받기" }).props.value).toBe(true);
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "출발 10분 전부터 교통 확인",
            }).props.accessibilityState,
        ).toEqual({ checked: false });
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "출발 30분 전부터 교통 확인",
            }).props.accessibilityState,
        ).toEqual({ checked: false });
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "출발 1시간 전부터 교통 확인",
            }).props.accessibilityState,
        ).toEqual({ checked: true });
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "교통 확인 시작 시점",
            }).props.accessibilityRole,
        ).toBe("radiogroup");
    });

    test("알림 편집 중 경로를 바꿔도 선택한 시점과 알람 방식이 남는다", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const rerender = await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()), onSave);
        const firstRoute = await completeRouteFromNotification(rerender);
        const checkTime = "출발 10분 전부터 교통 확인";
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 알림 받기" }).props.onValueChange(true);
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: checkTime }).props.onPress();
            renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.onPress();
        });
        mockPathname = "/schedule/route-select";
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 경로 변경" }).props.onPress();
        });
        await rerender();
        const sessionId = mockRouterPush.mock.calls.at(-1)?.[0].params.sessionId as string;
        const routeInfo = { ...firstRoute.route.routeInfo, id: "rerouted", totalDurationMinutes: 44 };
        setRoutePlannerResult(sessionId, { ...firstRoute, travelMinutes: 44, route: { routeInfo } });
        mockPathname = "/schedule";
        await rerender();

        expect(renderer!.root.findByProps({ accessibilityLabel: checkTime }).props.accessibilityState).toEqual({ checked: true });
        expect(renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.accessibilityState).toEqual({ checked: true });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "수정 확인" }).props.onPress();
        });
        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
        });
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            travelMinutes: 44,
            notificationEnabled: true,
            notificationLeadMinutes: 10,
            alertMode: "ALARM",
        }));
    });

    test("10분·30분·1시간 라디오는 선택 상태를 하나씩 전환하고 적용값을 저장한다", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const rerender = await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()), onSave);
        await completeRouteFromNotification(rerender);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 알림 받기" }).props.onValueChange(true);
        });

        const radioLabels = ["출발 10분 전부터 교통 확인", "출발 30분 전부터 교통 확인", "출발 1시간 전부터 교통 확인"];
        for (const selectedLabel of radioLabels) {
            await act(async () => {
                renderer!.root.findByProps({ accessibilityLabel: selectedLabel }).props.onPress();
            });

            for (const label of radioLabels) {
                expect(renderer!.root.findByProps({ accessibilityLabel: label }).props.accessibilityState).toEqual({
                    checked: label === selectedLabel,
                });
            }
        }

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 30분 전부터 교통 확인" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "수정 확인" }).props.onPress();
        });
        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
        });

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                notificationEnabled: true,
                notificationLeadMinutes: 30,
                notificationIntervalMinutes: 20,
                alertMode: "STANDARD",
            }),
        );
    });

    test("저장 성공 후 모델 점수와 분리된 품질 피드백을 전송한다", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const onFeedback = jest.fn().mockResolvedValue(undefined);
        await renderAndAnalyze(
            jest.fn().mockResolvedValue(parsed({ analysisId: "analysis-1" })),
            onSave,
            { id: "category-1", title: "일정", color: "#246BFE" },
            onFeedback,
        );

        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(onFeedback).toHaveBeenCalledWith({
            analysisId: "analysis-1",
            outcome: "SAVED",
            date: "UNTOUCHED",
            time: "UNTOUCHED",
            destination: "UNTOUCHED",
            globalConfirmed: false,
        });
    });

    test("출발 알람을 선택해 적용하면 미리보기와 저장 payload에 반영한다", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsedWithReadyRoute()), onSave);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.onPress();
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "푸시 알림 선택" }).props.accessibilityState).toEqual({
            checked: true,
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "푸시 알림 선택" }).props.accessibilityHint).toBe(
            "알림 배너로 알려드려요.",
        );
        expect(renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.accessibilityState).toEqual({
            checked: false,
        });
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "교통 상황이 바뀌면 푸시로 알려드려요" })).toHaveLength(
            0,
        );

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.onPress();
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "푸시 알림 선택" }).props.accessibilityState).toEqual({
            checked: false,
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.accessibilityState).toEqual({
            checked: true,
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.accessibilityHint).toBe(
            "출발 시간에 알람이 울려요.",
        );
        expect(
            renderer!.root.findByProps({
                accessibilityLabel: "교통 상황이 바뀌면 푸시로 알려드려요",
            }),
        ).toBeTruthy();

        await act(async () => {
            renderer!.root.findByProps({ testID: "notification-alarm-sound-row" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ children: "기본 알람음" })).toBeTruthy();
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알람음 선택 닫기" }).props.onPress();
        });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "수정 확인" }).props.onPress();
        });

        expect(renderer!.root.findAll(node => node.props.children === "30분 전 · 출발 알람")).not.toHaveLength(0);

        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
        });

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                notificationEnabled: true,
                notificationLeadMinutes: 30,
                alertMode: "ALARM",
            }),
        );
    });

    test("알람 방식 변경을 취소하면 원래 STANDARD 초안이 유지된다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsedWithReadyRoute()));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.onPress();
        });
        await act(async () => {
            findButtonByText("취소").props.onPress();
        });

        expect(renderer!.root.findAll(node => node.props.children === "30분 전 · 푸시 알림")).not.toHaveLength(0);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "알림 수정" }).props.onPress();
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "푸시 알림 선택" }).props.accessibilityState).toEqual({
            checked: true,
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.accessibilityState).toEqual({
            checked: false,
        });
    });

    test("출발 알림을 OFF로 적용하면 저장 payload에서 알림 설정값을 제거한다", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const rerender = await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()), onSave);
        await completeRouteFromNotification(rerender);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 알림 받기" }).props.onValueChange(true);
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 알람 선택" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "출발 10분 전부터 교통 확인" }).props.onPress();
            renderer!.root.findByProps({ accessibilityLabel: "출발 알림 받기" }).props.onValueChange(false);
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "수정 확인" }).props.onPress();
        });
        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
        });

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                notificationEnabled: false,
                notificationLeadMinutes: undefined,
                notificationIntervalMinutes: undefined,
                alertMode: "STANDARD",
            }),
        );
    });

    test("읽기 전용 공유 카테고리로는 빠른 일정을 저장하지 않는다", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()), onSave, {
            id: "viewer-category",
            title: "받은 일정",
            color: "#34C759",
            shared: true,
            sharePermission: "VIEWER",
        });

        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
        });

        expect(onSave).not.toHaveBeenCalled();
    });

    test("분석 버튼을 빠르게 연속으로 눌러도 파서 요청은 한 번만 보낸다", async () => {
        let resolveAnalysis!: (value: ScheduleParseResult) => void;
        const onAnalyze = jest.fn(
            () =>
                new Promise<ScheduleParseResult>(resolve => {
                    resolveAnalysis = resolve;
                }),
        );

        await act(async () => {
            renderer = TestRenderer.create(
                <ThemeProvider>
                    <QuickScheduleModal
                        visible
                        defaultDay="2026-07-17"
                        defaultCategory={{
                            id: "category-1",
                            title: "일정",
                            color: "#246BFE",
                        }}
                        onAnalyze={onAnalyze}
                        onSave={jest.fn()}
                        onClose={jest.fn()}
                    />
                </ThemeProvider>,
            );
        });
        await act(async () => {
            renderer!.root
                .findByProps({ accessibilityLabel: "빠른 일정 문장" })
                .props.onChangeText("금요일 오후 7시 서울역 약속");
        });

        const analyzeButton = renderer!.root.findByProps({
            accessibilityLabel: "입력 내용으로 일정 미리보기",
        });
        await act(async () => {
            analyzeButton.props.onPress();
            analyzeButton.props.onPress();
            await Promise.resolve();
        });

        expect(onAnalyze).toHaveBeenCalledTimes(1);
        expect(renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 문장" })).toBeDefined();
        await act(async () => jest.advanceTimersByTime(119));
        expect(renderer!.root.findAllByProps({ testID: "quick-schedule-loading" })).toHaveLength(0);
        await act(async () => jest.advanceTimersByTime(1));
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "빠른 일정 문장" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ settleOnly: true, settleDelayMs: 90, settleDurationMs: 320 })).toBeDefined();
        const waitingCardFrame = renderer!.root.findByType(QuickScheduleModalShell).props.cardMotionStyle.__mockFactory();
        await act(async () => {
            resolveAnalysis(parsed());
            await Promise.resolve();
        });
        expect(findButtonByText("일정 저장")).toBeDefined();
        const previewCardFrame = renderer!.root.findByType(QuickScheduleModalShell).props.cardMotionStyle.__mockFactory();
        expect(waitingCardFrame).toMatchObject({
            top: previewCardFrame.top,
            height: previewCardFrame.height,
            width: previewCardFrame.width,
        });
    });

    test("확인 취소는 입력을 유지하고 이전 요청의 늦은 결과를 무시한다", async () => {
        let resolveCancelled!: (result: ScheduleParseResult) => void;
        const onAnalyze = jest.fn()
            .mockImplementationOnce(() => new Promise<ScheduleParseResult>(resolve => { resolveCancelled = resolve; }))
            .mockResolvedValueOnce(parsed({ title: "다시 확인한 일정" }));
        await renderAndAnalyze(onAnalyze);
        await act(async () => jest.advanceTimersByTime(120));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "확인 취소" }).props.onPress();
        });
        expect(Alert.alert).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 문장" }).props.value)
            .toBe("7월 17일 오후 8시 서울역 약속");

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용으로 일정 미리보기" }).props.onPress();
        });
        await act(async () => {
            resolveCancelled(parsed({ title: "취소한 결과" }));
        });

        expect(onAnalyze).toHaveBeenCalledTimes(2);
        expect(renderer!.root.findAllByProps({ children: "취소한 결과" })).toHaveLength(0);
        expect(renderer!.root.findAllByProps({ children: "다시 확인한 일정" }).length).toBeGreaterThan(0);
    });

    test("빠른 분석 응답은 미리보기 이후에도 대기 화면을 띄우지 않는다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));
        await act(async () => jest.advanceTimersByTime(540));
        expect(renderer!.root.findAllByProps({ testID: "quick-schedule-loading" })).toHaveLength(0);
        expect(findButtonByText("일정 저장")).toBeDefined();
    });

    test("저장 실패 후 수정한 장소와 펼친 원문을 유지하고 같은 초안으로 재시도한다", async () => {
        const onSave = jest.fn().mockRejectedValueOnce(new Error("Service unavailable")).mockResolvedValueOnce(undefined);
        const onFeedback = jest.fn(() => { throw new Error("Feedback unavailable"); });
        await renderAndAnalyze(
            jest.fn().mockResolvedValue({ ...parsedWithReadyRoute(), analysisId: "retry-review" }),
            onSave,
            undefined,
            onFeedback,
        );
        const root = renderer!.root;
        await act(async () => root.findByProps({ accessibilityLabel: "장소 수정" }).props.onPress());
        await act(async () => root.findByProps({ accessibilityLabel: "빠른 일정 목적지" }).props.onChangeText("용산역"));
        await act(async () => root.findByProps({ accessibilityLabel: "장소만 적용" }).props.onPress());
        await act(async () => root.findByProps({ testID: "quick-schedule-preview-source-summary" }).props.onPress());
        await act(async () => findButtonByText("일정 저장").props.onPress());

        expect(alertSpy).not.toHaveBeenCalled();
        expect(root.findByProps({ testID: "quick-schedule-save-error" }).props.children).toBe("일정을 저장하지 못했어요.");
        expect(root.findByProps({ accessibilityLabel: "장소 수정" }).props.accessibilityValue.text).toBe("용산역");
        expect(root.findByProps({ testID: "quick-schedule-preview-source-text" }).props.children)
            .toBe("7월 17일 오후 8시 서울역 약속");
        await act(async () => findButtonByText("다시 저장").props.onPress());
        expect(onSave).toHaveBeenCalledTimes(2);
        expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0]);
        expect(onFeedback).toHaveBeenCalledWith(expect.objectContaining({ analysisId: "retry-review", outcome: "SAVED" }));
        expect(findButtonByText("캘린더에서 보기")).toBeDefined();
    });

    test("저장 버튼을 빠르게 연속으로 눌러도 생성 요청은 한 번만 보낸다", async () => {
        let resolveSave!: () => void;
        const onSave = jest.fn(
            () =>
                new Promise<void>(resolve => {
                    resolveSave = resolve;
                }),
        );
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()), onSave);

        const saveButton = findButtonByText("일정 저장");
        await act(async () => {
            saveButton.props.onPress();
            saveButton.props.onPress();
            await Promise.resolve();
        });

        expect(onSave).toHaveBeenCalledTimes(1);
        const saving = renderer!.root.findAllByProps({ testID: "quick-schedule-loading" })[0];
        expect(saving.props.accessibilityLabel).toBe("일정 저장 중. 서울역 약속");
        expect(saving.findByProps({ settleOnly: true, settleDurationMs: 320 })).toBeDefined();
        await act(async () => {
            resolveSave();
            await Promise.resolve();
        });
        expect(renderer!.root.findAllByProps({ testID: "quick-schedule-loading" })).toHaveLength(0);
        expect(findButtonByText("캘린더에서 보기")).toBeDefined();
    });
});
