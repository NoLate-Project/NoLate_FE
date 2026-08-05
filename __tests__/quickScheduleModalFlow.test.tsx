import React from "react";
import { Alert, StyleSheet } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import QuickScheduleModal from "../src/modules/schedule/components/form/QuickScheduleModal";
import { setRoutePlannerResult } from "../src/modules/schedule/routePlannerSession";
import { ThemeProvider } from "../src/modules/theme/ThemeContext";
import type { ScheduleCategory, ScheduleParseResult } from "../src/modules/schedule/types";

const mockRouterPush = jest.fn();
let mockPathname = "/schedule";

jest.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
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
        await act(async () => {
            jest.advanceTimersByTime(230);
        });

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

    test("장소 행은 목적지만 수정하고 알림의 명시적 CTA만 경로 화면을 연다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "장소 수정" }).props.onPress();
        });
        expect(mockRouterPush).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 목적지" })).toBeDefined();

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

    test("분석에 사용한 문장과 열린 미리보기 항목의 현재 값을 제공한다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        expect(renderer!.root.findByProps({ accessibilityLabel: "입력 내용 수정" }).props.accessibilityValue).toEqual({
            text: "7월 17일 오후 8시 서울역 약속",
        });
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
            text: "없음, 경로 설정 필요",
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "메모 수정" }).props.accessibilityValue).toEqual({
            text: "없음",
        });
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "빠른 일정 입력 수정" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "입력 내용 수정" })).toBeDefined();
        expect(
            StyleSheet.flatten(findButtonByText("일정 저장").props.style({ pressed: false })),
        ).toMatchObject({ width: "100%", height: 46 });
    });

    test("쓰기 가능한 카테고리를 모두 보여주고 화면에서 고른 카테고리로 저장한다", async () => {
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

        expect(renderer!.root.findByProps({ accessibilityLabel: "개인 카테고리 선택" }).props.accessibilityState)
            .toMatchObject({ selected: true });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "quick-schedule-preview-title-category-pin" }).props.style,
        )).toMatchObject({
            left: 2,
            top: 11,
            bottom: 11,
            width: 4,
            borderRadius: 2,
            backgroundColor: personalCategory.color,
        });
        expect(renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리 선택" })).toBeDefined();
        expect(renderer!.root.findByProps({ accessibilityLabel: "프로젝트 카테고리 선택" })).toBeDefined();
        expect(renderer!.root.findAllByProps({ accessibilityLabel: "받은 일정 카테고리 선택" })).toHaveLength(0);

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리 선택" }).props.onPress();
        });
        const workChip = renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리 선택" });
        expect(workChip.props.hitSlop).toEqual({ top: 7, bottom: 7 });
        expect(StyleSheet.flatten(workChip.props.style({ pressed: false }))).toMatchObject({ minHeight: 30 });
        expect(renderer!.root.findByProps({ accessibilityLabel: "개인 카테고리 선택" }).props.accessibilityState)
            .toMatchObject({ selected: false });
        expect(renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리 선택" }).props.accessibilityState)
            .toMatchObject({ selected: true });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "quick-schedule-preview-title-category-pin" }).props.style,
        )).toMatchObject({ backgroundColor: workCategory.color });

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "메모 수정" }).props.onPress();
        });
        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "일정 미리보기로 돌아가기" }).props.onPress();
        });
        expect(alertSpy).not.toHaveBeenCalled();
        expect(renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리 선택" }).props.accessibilityState)
            .toMatchObject({ selected: true });

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
            renderer!.root.findByProps({ accessibilityLabel: "업무 카테고리 선택" }).props.onPress();
        });
        await rerender([personalCategory]);

        expect(renderer!.root.findAllByProps({ accessibilityLabel: "업무 카테고리 선택" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "개인 카테고리 선택" }).props.accessibilityState)
            .toMatchObject({ selected: true });
        expect(StyleSheet.flatten(
            renderer!.root.findByProps({ testID: "quick-schedule-preview-title-category-pin" }).props.style,
        )).toMatchObject({ backgroundColor: personalCategory.color });

        await act(async () => {
            findButtonByText("일정 저장").props.onPress();
            await Promise.resolve();
        });
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ category: personalCategory }));
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

        expect(renderer!.root.findAllByProps({ accessibilityLabel: "받은 일정 카테고리 선택" })).toHaveLength(0);
        expect(renderer!.root.findByProps({ accessibilityLabel: "내 일정 카테고리 선택" }).props.accessibilityState)
            .toMatchObject({ selected: true });
    });

    test("제목·날짜·시간은 각각의 편집 이동 표시를 제공한다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        expect(renderer!.root.findByProps({ testID: "quick-schedule-preview-title-chevron" }).props.name).toBe(
            "chevron-forward",
        );
        expect(renderer!.root.findByProps({ testID: "quick-schedule-preview-date-chevron" }).props.name).toBe(
            "chevron-forward",
        );
        expect(renderer!.root.findByProps({ testID: "quick-schedule-preview-time-chevron" }).props.name).toBe(
            "chevron-forward",
        );
        expect(
            renderer!.root
                .findByProps({ testID: "quick-schedule-preview-date-time" })
                .findAllByProps({ name: "chevron-forward" }),
        ).toHaveLength(2);
    });

    test("날짜와 시간은 같은 일시 행에서 각각 해당 편집기를 연다", async () => {
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

    test("명시적 종료 시간이 있으면 날짜와 시간을 독립 버튼인 두 줄로 보여준다", async () => {
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
        expect(dateButton.props.hitSlop).toEqual({ top: 6, bottom: 6, left: 4, right: 4 });
        expect(timeButton.props.hitSlop).toEqual({ top: 6, bottom: 6, left: 4, right: 4 });
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

    test("원문 수정은 분석에 사용한 문장을 보존하고 입력 단계로 돌아간다", async () => {
        await renderAndAnalyze(jest.fn().mockResolvedValue(parsed()));

        await act(async () => {
            renderer!.root.findByProps({ accessibilityLabel: "입력 내용 수정" }).props.onPress();
        });

        expect(renderer!.root.findByProps({ accessibilityLabel: "빠른 일정 문장" }).props.value).toBe(
            "7월 17일 오후 8시 서울역 약속",
        );
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

    test("작성 중 X를 누르면 계속 작성할 수 있고 폐기를 선택해야 닫는다", async () => {
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
            "닫으면 입력한 내용이 사라져요.",
            expect.arrayContaining([
                expect.objectContaining({ text: "계속 작성", style: "cancel" }),
                expect.objectContaining({ text: "입력 버리기", style: "destructive" }),
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
        const discardButton = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find(button => button.text === "입력 버리기");
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
            "닫으면 입력한 내용이 사라져요.",
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
        await act(async () => {
            resolveAnalysis(parsed());
            await Promise.resolve();
        });
        await act(async () => {
            jest.advanceTimersByTime(230);
        });
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
        await act(async () => {
            resolveSave();
            await Promise.resolve();
        });
    });
});
