import React from "react";
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
    });

    afterEach(async () => {
        await act(async () => {
            renderer?.unmount();
        });
        renderer = undefined;
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
    ) {
        const renderTree = () => (
            <ThemeProvider>
                <QuickScheduleModal
                    visible
                    defaultDay="2026-07-17"
                    defaultCategory={defaultCategory}
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

        return async () => {
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
            findButtonByText("일정 저장하기").props.onPress();
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
            findButtonByText("일정 저장하기").props.onPress();
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
            findButtonByText("일정 저장하기").props.onPress();
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
            findButtonByText("일정 저장하기").props.onPress();
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
            findButtonByText("일정 저장하기").props.onPress();
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

        const saveButton = findButtonByText("일정 저장하기");
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
