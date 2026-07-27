import React from "react";
import { Animated } from "react-native";
import TestRenderer, {
    act,
    type ReactTestRenderer,
} from "react-test-renderer";

import ScheduleCalendar from "../src/modules/schedule/components/calendar/ScheduleCalendar";
import type { TodayFocusTarget } from "../src/modules/schedule/components/calendar/ScheduleCalendar";
import type { CalendarViewMode } from "../src/modules/schedule/components/calendar/viewMode";
import {
    DETAIL_MONTH_SWIPE_GESTURE,
    DETAIL_MONTH_SWIPE_MOTION,
    getDetailMonthSwipeSettleDuration,
} from "../src/modules/schedule/calendarMotion";

type MockDateData = {
    year: number;
    month: number;
    day: number;
    dateString: string;
    timestamp: number;
};

type CalendarMockProps = {
    enableSwipeMonths: boolean;
    initialDate: string;
    onMonthChange?: (month: { dateString: string }) => void;
    onPressArrowLeft: (changeMonth: () => void) => void;
    onPressArrowRight: (changeMonth: () => void) => void;
    dayComponent: (props: { date: MockDateData }) => React.ReactElement<{
        onPress: (day: MockDateData) => void;
    }>;
    testID?: string;
};

type ActiveCalendarMockProps = CalendarMockProps & Required<
    Pick<CalendarMockProps, "onMonthChange">
>;

type MockPanGestureEvent = {
    translationX: number;
    translationY: number;
    velocityX: number;
    velocityY: number;
};

type MockGestureStateManager = {
    fail: jest.Mock;
};

type DetailMonthGestureCallbacks = {
    onTouchesDown?: (
        event: { numberOfTouches: number },
        stateManager: MockGestureStateManager
    ) => void;
    onBegin?: () => void;
    onUpdate?: (event: MockPanGestureEvent) => void;
    onEnd?: (event: MockPanGestureEvent) => void;
    onFinalize?: () => void;
};

type DetailMonthGestureConfig = {
    enabled?: boolean;
    minDistance?: number;
    maxPointers?: number;
    cancelsTouchesInView?: boolean;
    testID?: string;
};

type DetailMonthGestureMock = {
    callbacks: DetailMonthGestureCallbacks;
    config: DetailMonthGestureConfig;
};

let mockCalendarProps: ActiveCalendarMockProps | null = null;
let mockCalendarInitialDates: string[] = [];

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

jest.mock("react-native-calendars", () => ({
    Calendar: (props: CalendarMockProps) => {
        mockCalendarInitialDates.push(props.initialDate);
        if (props.onMonthChange) {
            mockCalendarProps = props as ActiveCalendarMockProps;
        }
        return null;
    },
}));

jest.mock("../src/modules/schedule/components/calendar/CustomDay", () => () => null);

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: "light",
        colors: {
            arrowColor: "#111111",
            border: "#dddddd",
            calendarBackground: "#ffffff",
            dayHeaderColor: "#555555",
            monthTextColor: "#111111",
        },
    }),
}));

type AnimationEndCallback = (result: { finished: boolean }) => void;
type FrameCallback = (time: number) => void;

describe("ScheduleCalendar detail month swipe motion", () => {
    let renderer: ReactTestRenderer | undefined;
    let onOpenDay: jest.Mock;
    let onSelectDay: jest.Mock;
    let onVisibleMonthChange: jest.Mock;
    let pendingAnimationCallbacks: AnimationEndCallback[];
    let pendingFrameCallbacks: Array<{ id: number; callback: FrameCallback }>;
    let nextFrameId: number;
    let renderedDay: string;
    let renderedReduceMotion: boolean;
    let renderedViewMode: CalendarViewMode;
    let renderedTodayFocusTarget: TodayFocusTarget | null;
    let renderedTransitionActive: boolean;
    let renderedTransitionMonthKey: string | undefined;
    let onTodayFocusReady: jest.Mock;
    let onRegisterDetailMonthMotionCancel: jest.Mock | undefined;
    let onRegisterDetailMonthMotionShift: jest.Mock | undefined;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        mockCalendarProps = null;
        mockCalendarInitialDates = [];
        onOpenDay = jest.fn();
        onSelectDay = jest.fn();
        onVisibleMonthChange = jest.fn();
        pendingAnimationCallbacks = [];
        pendingFrameCallbacks = [];
        nextFrameId = 1;
        renderedDay = "2026-07-15";
        renderedReduceMotion = false;
        renderedViewMode = "detail";
        renderedTodayFocusTarget = null;
        renderedTransitionActive = false;
        renderedTransitionMonthKey = undefined;
        onTodayFocusReady = jest.fn();
        onRegisterDetailMonthMotionCancel = undefined;
        onRegisterDetailMonthMotionShift = undefined;
        const createAnimation = (): Animated.CompositeAnimation => ({
            start: (callback) => {
                if (callback) pendingAnimationCallbacks.push(callback);
            },
            stop: jest.fn(),
            reset: jest.fn(),
        });

        jest.spyOn(Animated, "timing").mockImplementation(() => createAnimation());
        jest.spyOn(Animated, "parallel").mockImplementation(() => createAnimation());
        const reanimated = jest.requireMock("react-native-reanimated") as {
            __resetTimingCallbacks: () => void;
            cancelAnimation: jest.Mock;
            withTiming: jest.Mock;
        };
        reanimated.__resetTimingCallbacks();
        reanimated.cancelAnimation.mockClear();
        reanimated.withTiming.mockClear();
        jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
            const id = nextFrameId;
            nextFrameId += 1;
            pendingFrameCallbacks.push({ id, callback });
            return id;
        });
        jest.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await act(async () => renderer?.unmount());
        renderer = undefined;
        jest.restoreAllMocks();
    });

    function calendarElement() {
        return (
            <ScheduleCalendar
                selectedDay={renderedDay}
                focusedMonth={renderedDay}
                items={[]}
                onSelectDay={onSelectDay}
                onOpenDay={onOpenDay}
                viewMode={renderedViewMode}
                firstDay={0}
                scrollRequest={0}
                onVisibleMonthChange={onVisibleMonthChange}
                reduceMotionEnabled={renderedReduceMotion}
                todayFocusTarget={renderedTodayFocusTarget}
                onTodayFocusReady={onTodayFocusReady}
                onRegisterDetailMonthMotionCancel={onRegisterDetailMonthMotionCancel}
                onRegisterDetailMonthMotionShift={onRegisterDetailMonthMotionShift}
                transitionActive={renderedTransitionActive}
                transitionMonthKey={renderedTransitionMonthKey}
            />
        );
    }

    async function renderCalendar(
        selectedDay: string,
        reduceMotionEnabled = false,
        viewMode: CalendarViewMode = "detail"
    ) {
        renderedDay = selectedDay;
        renderedReduceMotion = reduceMotionEnabled;
        renderedViewMode = viewMode;
        await act(async () => {
            renderer = TestRenderer.create(calendarElement());
        });
        if (viewMode === "detail") {
            if (!renderer) throw new Error("Calendar renderer was not created");
            const viewport = renderer.root.findByProps({
                testID: "detail-month-swipe-handler",
            });
            act(() => viewport.props.onLayout({
                nativeEvent: {
                    layout: {
                        width: 320,
                        height: 420,
                        x: 0,
                        y: 0,
                    },
                },
            }));
        }
    }

    async function updateCalendar(
        selectedDay: string,
        options?: {
            reduceMotionEnabled?: boolean;
            viewMode?: CalendarViewMode;
            todayFocusTarget?: TodayFocusTarget | null;
            transitionActive?: boolean;
            transitionMonthKey?: string;
        }
    ) {
        renderedDay = selectedDay;
        if (options?.reduceMotionEnabled !== undefined) {
            renderedReduceMotion = options.reduceMotionEnabled;
        }
        if (options?.viewMode !== undefined) {
            renderedViewMode = options.viewMode;
        }
        if (options && "todayFocusTarget" in options) {
            renderedTodayFocusTarget = options.todayFocusTarget ?? null;
        }
        if (options?.transitionActive !== undefined) {
            renderedTransitionActive = options.transitionActive;
        }
        if (options && "transitionMonthKey" in options) {
            renderedTransitionMonthKey = options.transitionMonthKey;
        }
        await act(async () => {
            renderer?.update(calendarElement());
        });
    }

    function getCalendarProps() {
        if (!mockCalendarProps) throw new Error("Calendar mock was not rendered");
        return mockCalendarProps;
    }

    function getDetailMonthGesture(): DetailMonthGestureMock {
        const detector = renderer?.root.findByProps({
            testID: "detail-month-pan-gesture",
        });
        if (!detector) throw new Error("Detail month pan gesture was not rendered");
        return {
            callbacks: detector.props
                .mockGestureCallbacks as DetailMonthGestureCallbacks,
            config: detector.props.mockGestureConfig as DetailMonthGestureConfig,
        };
    }

    function getDetailMonthAnimatedValues() {
        const layer = renderer?.root.findByProps({
            testID: "detail-month-animated-layer",
        });
        if (!layer) throw new Error("Detail month animated layer was not rendered");
        type InspectableAnimatedValue = Animated.Value & {
            __getValue: () => number;
        };
        const style = layer.props.style[1] as {
            opacity: InspectableAnimatedValue;
            transform: [
                { translateX: InspectableAnimatedValue },
                { translateY: InspectableAnimatedValue },
            ];
        };
        return {
            opacity: style.opacity,
            translateX: style.transform[0].translateX,
            translateY: style.transform[1].translateY,
        };
    }

    function getPagerPageStyle(testID: string) {
        const page = renderer?.root.findByProps({ testID });
        if (!page) throw new Error(`${testID} pager page was not rendered`);
        type PagerPositionStyle = {
            __mockFactory?: () => PagerPositionStyle;
            opacity?: number;
            transform: [
                { translateX: number },
                { translateY: number },
            ];
        };
        const animatedStyle = page.props.style[2] as PagerPositionStyle;
        if (typeof animatedStyle?.__mockFactory !== "function") {
            throw new Error("Pager animated style factory was not exposed");
        }
        const currentStyle = animatedStyle.__mockFactory();
        return {
            opacity: currentStyle.opacity,
            translateX: currentStyle.transform[0].translateX,
            translateY: currentStyle.transform[1].translateY,
        };
    }

    function getPreviousPagerPageOffset() {
        const style = getPagerPageStyle(
            "detail-month-page-previous-2026-06"
        );
        return {
            translateX: style.translateX,
            translateY: style.translateY,
        };
    }

    function getDetailMonthGestureLayerOffset() {
        const layer = renderer?.root.findByProps({
            testID: "detail-month-gesture-layer",
        });
        if (!layer) throw new Error("Detail month gesture layer was not rendered");
        type GestureLayerStyle = {
            __mockFactory?: () => GestureLayerStyle;
            transform: [
                { translateX: number },
                { translateY: number },
            ];
        };
        const animatedStyle = layer.props.style[1] as GestureLayerStyle;
        if (typeof animatedStyle?.__mockFactory !== "function") {
            throw new Error("Gesture layer animated style factory was not exposed");
        }
        const currentStyle = animatedStyle.__mockFactory();
        return {
            translateX: currentStyle.transform[0].translateX,
            translateY: currentStyle.transform[1].translateY,
        };
    }

    function getDetailMonthGestureLayerOpacity() {
        const layer = renderer?.root.findByProps({
            testID: "detail-month-gesture-layer",
        });
        if (!layer) throw new Error("Detail month gesture layer was not rendered");
        type GestureLayerStyle = {
            __mockFactory?: () => { opacity: number };
        };
        const animatedStyle = layer.props.style[1] as GestureLayerStyle;
        if (typeof animatedStyle?.__mockFactory !== "function") {
            throw new Error("Gesture layer animated style factory was not exposed");
        }
        return animatedStyle.__mockFactory().opacity;
    }

    function panGestureEvent(
        translationX = 0,
        translationY = 0,
        velocityX = 0,
        velocityY = 0
    ): MockPanGestureEvent {
        return {
            translationX,
            translationY,
            velocityX,
            velocityY,
        };
    }

    function startGesture(
        gesture = getDetailMonthGesture(),
        numberOfTouches = 1
    ) {
        const stateManager: MockGestureStateManager = { fail: jest.fn() };
        act(() => gesture.callbacks.onTouchesDown?.(
            { numberOfTouches },
            stateManager
        ));
        if (!stateManager.fail.mock.calls.length) {
            act(() => gesture.callbacks.onBegin?.());
        }
        return { gesture, stateManager };
    }

    function updateGesture(
        gesture: DetailMonthGestureMock,
        event: MockPanGestureEvent
    ) {
        act(() => gesture.callbacks.onUpdate?.(event));
    }

    function endGesture(
        gesture: DetailMonthGestureMock,
        event: MockPanGestureEvent
    ) {
        act(() => {
            gesture.callbacks.onEnd?.(event);
            gesture.callbacks.onFinalize?.();
        });
    }

    function cancelGesture(gesture: DetailMonthGestureMock) {
        act(() => gesture.callbacks.onFinalize?.());
    }

    function getReanimatedMocks() {
        return jest.requireMock("react-native-reanimated") as {
            __flushTimingCallbacks: (finished?: boolean) => void;
            __flushRunOnJSCallbacks: () => void;
            __getPendingTimingCallbackCount: () => number;
            __getPendingRunOnJSCallbackCount: () => number;
            __setTimingCallbacksDeferred: (deferred: boolean) => void;
            __setRunOnJSCallbacksDeferred: (deferred: boolean) => void;
            cancelAnimation: jest.Mock;
            withTiming: jest.Mock;
        };
    }

    function finishNextAnimation(finished = true) {
        const callback = pendingAnimationCallbacks.shift();
        if (!callback) throw new Error("No pending animation callback");
        act(() => callback({ finished }));
    }

    function flushNextFrame() {
        const frame = pendingFrameCallbacks.shift();
        if (!frame) throw new Error("No pending frame callback");
        act(() => frame.callback(0));
        return frame.id;
    }

    test("depth 전환 중에는 target Calendar 하나만 렌더해 pager remount를 피한다", async () => {
        await renderCalendar("2026-07-15");
        mockCalendarInitialDates = [];

        await updateCalendar("2026-08-15", {
            transitionActive: true,
            transitionMonthKey: "month-2026-08",
        });

        expect(mockCalendarInitialDates).toEqual(["2026-08-15"]);
        expect(renderer?.root.findByProps({
            testID: "detail-month-transition-calendar",
        })).toBeDefined();

        mockCalendarInitialDates = [];
        await updateCalendar("2026-08-15", {
            transitionActive: false,
            transitionMonthKey: undefined,
        });
        expect(mockCalendarInitialDates.slice(-3)).toEqual([
            "2026-08-15",
            "2026-07-15",
            "2026-09-15",
        ]);
    });

    async function acknowledgeControlledMonth(targetDay: string) {
        await updateCalendar(targetDay);
        expect(pendingFrameCallbacks).toHaveLength(1);
        act(() => getCalendarProps().onMonthChange({ dateString: targetDay }));
        // The controlled month chrome paints first. The pager's duplicate
        // centre-page handoff/rebase intentionally runs later. Two additional
        // frames keep target duplicates mounted until the JS shared-value
        // reset is guaranteed to have reached the UI thread.
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
    }

    test("12월에서 왼쪽으로 넘기면 ACK 뒤 다음 해 1월을 한 번만 반영한다", async () => {
        await renderCalendar("2026-12-31");
        const calendar = getCalendarProps();
        const staleLibraryChangeMonth = jest.fn();

        act(() => calendar.onPressArrowRight(staleLibraryChangeMonth));
        flushNextFrame();

        expect(staleLibraryChangeMonth).not.toHaveBeenCalled();
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onVisibleMonthChange).toHaveBeenLastCalledWith("2027-01-31");
        expect(onSelectDay).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenLastCalledWith("2027-01-31");
        expect(pendingFrameCallbacks).toHaveLength(0);

        await acknowledgeControlledMonth("2027-01-31");
        expect(pendingFrameCallbacks).toHaveLength(0);
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledTimes(1);
    });

    test("1월에서 오른쪽으로 넘기면 이전 해 12월 말일로 보정한다", async () => {
        await renderCalendar("2026-01-31");
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowLeft(jest.fn()));
        flushNextFrame();

        expect(onVisibleMonthChange).toHaveBeenLastCalledWith("2025-12-31");
        expect(onSelectDay).toHaveBeenLastCalledWith("2025-12-31");
        await acknowledgeControlledMonth("2025-12-31");
    });

    test("같은 방향 연속 스와이프를 큐에 쌓아 두 달 모두 이동한다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => {
            calendar.onPressArrowRight(jest.fn());
            calendar.onPressArrowRight(jest.fn());
        });

        flushNextFrame();
        expect(onSelectDay).toHaveBeenLastCalledWith("2026-08-15");
        await acknowledgeControlledMonth("2026-08-15");

        // The queued page starts as soon as the first controlled commit settles.
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
        expect(onSelectDay).toHaveBeenLastCalledWith("2026-09-15");
        await acknowledgeControlledMonth("2026-09-15");

        expect(onSelectDay.mock.calls.map(([day]) => day)).toEqual([
            "2026-08-15",
            "2026-09-15",
        ]);
        expect(onVisibleMonthChange.mock.calls.map(([day]) => day)).toEqual([
            "2026-08-15",
            "2026-09-15",
        ]);
    });

    test("연속 버튼 전환은 미리 렌더한 pager를 사용해 grid를 숨기지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();
        const motion = getDetailMonthAnimatedValues();

        act(() => {
            calendar.onPressArrowRight(jest.fn());
            calendar.onPressArrowRight(jest.fn());
        });

        flushNextFrame();
        expect(motion.opacity.__getValue()).toBe(1);

        await acknowledgeControlledMonth("2026-08-15");
        flushNextFrame();
        expect(motion.opacity.__getValue()).toBe(1);

        await acknowledgeControlledMonth("2026-09-15");
        expect(motion.opacity.__getValue()).toBe(1);
        expect(motion.translateX.__getValue()).toBe(0);
    });

    test("전환 중 반대 방향 스와이프는 첫 전환 뒤 원래 달로 복귀한다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => {
            calendar.onPressArrowRight(jest.fn());
            calendar.onPressArrowLeft(jest.fn());
        });

        flushNextFrame();
        await acknowledgeControlledMonth("2026-08-15");
        flushNextFrame();
        await acknowledgeControlledMonth("2026-07-15");

        expect(onSelectDay.mock.calls.map(([day]) => day)).toEqual([
            "2026-08-15",
            "2026-07-15",
        ]);
    });

    test("exit 중 외부 월 이동은 이전 generation의 commit을 취소한다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowRight(jest.fn()));
        await updateCalendar("2026-10-15");
        flushNextFrame();

        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
        expect(pendingFrameCallbacks).toHaveLength(0);
    });

    test("controlled props commit이 pager anchor를 교체하고 늦은 Calendar callback은 중복시키지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowRight(jest.fn()));
        flushNextFrame();
        await updateCalendar("2026-08-15");

        expect(Animated.parallel).not.toHaveBeenCalled();
        expect(pendingFrameCallbacks).toHaveLength(1);

        act(() => getCalendarProps().onMonthChange({ dateString: "2026-08-15" }));
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
        expect(pendingFrameCallbacks).toHaveLength(0);
        expect(Animated.parallel).not.toHaveBeenCalled();
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledTimes(1);
    });

    test("pager rebase 중 UI reset 전후에는 세 슬롯 모두 target month를 유지한다", async () => {
        await renderCalendar("2026-07-15");
        const { gesture } = startGesture();
        const swipe = panGestureEvent(-52, 2);

        updateGesture(gesture, swipe);
        endGesture(gesture, swipe);
        await updateCalendar("2026-08-15");
        act(() => getCalendarProps().onMonthChange({
            dateString: "2026-08-15",
        }));

        flushNextFrame();
        expect(mockCalendarInitialDates.slice(-3)).toEqual([
            "2026-08-15",
            "2026-08-15",
            "2026-08-15",
        ]);

        flushNextFrame();
        expect(mockCalendarInitialDates.slice(-3)).toEqual([
            "2026-08-15",
            "2026-08-15",
            "2026-08-15",
        ]);

        flushNextFrame();
        expect(mockCalendarInitialDates.slice(-3)).toEqual([
            "2026-08-15",
            "2026-07-15",
            "2026-09-15",
        ]);
        expect(pendingFrameCallbacks).toHaveLength(0);
    });

    test.each([
        {
            label: "왼쪽",
            event: panGestureEvent(-52, 2),
            targetDay: "2026-08-15",
            pages: [
                "2026-08-15",
                "2026-07-15",
                "2026-09-15",
            ],
        },
        {
            label: "오른쪽",
            event: panGestureEvent(52, 2),
            targetDay: "2026-06-15",
            pages: [
                "2026-06-15",
                "2026-05-15",
                "2026-07-15",
            ],
        },
    ])(
        "상세형 $label 드래그가 가로 3-page pager로 월을 한 번만 이동한다",
        async ({ event, targetDay, pages }) => {
            await renderCalendar("2026-07-15");
            const calendar = getCalendarProps();
            const { gesture } = startGesture();

            expect(calendar.enableSwipeMonths).toBe(false);
            expect(gesture.config).toMatchObject({
                enabled: true,
                minDistance: DETAIL_MONTH_SWIPE_GESTURE.activationDistance,
                maxPointers: 1,
                cancelsTouchesInView: true,
            });

            updateGesture(gesture, event);
            endGesture(gesture, event);

            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onVisibleMonthChange).toHaveBeenLastCalledWith(targetDay);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenLastCalledWith(targetDay);

            await updateCalendar(targetDay);
            expect(pendingFrameCallbacks).toHaveLength(1);
            act(() => getCalendarProps().onMonthChange({ dateString: targetDay }));
            expect(pendingFrameCallbacks).toHaveLength(1);
            flushNextFrame();
            expect(mockCalendarInitialDates.slice(-3)).toEqual([
                targetDay,
                targetDay,
                targetDay,
            ]);
            expect(pendingFrameCallbacks).toHaveLength(1);
            flushNextFrame();
            expect(mockCalendarInitialDates.slice(-3)).toEqual([
                targetDay,
                targetDay,
                targetDay,
            ]);
            expect(pendingFrameCallbacks).toHaveLength(1);
            flushNextFrame();
            expect(mockCalendarInitialDates.slice(-3)).toEqual(pages);

            expect(pendingFrameCallbacks).toHaveLength(0);
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
        }
    );

    test("valid 세로 release는 고정 page pager로 이어지고 월을 한 번만 commit한다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        const motion = getDetailMonthAnimatedValues();
        try {
            const { gesture } = startGesture();
            const swipeUp = panGestureEvent(2, -52);

            expect(getPreviousPagerPageOffset()).toEqual({
                translateX: -320,
                translateY: 0,
            });
            updateGesture(gesture, swipeUp);
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: -52,
            });
            expect(getDetailMonthGestureLayerOpacity()).toBe(1);
            expect(getPagerPageStyle(
                "detail-month-page-current-2026-07"
            ).opacity).toBeCloseTo(
                1 - 52 / DETAIL_MONTH_SWIPE_MOTION.travel
            );
            expect(getPagerPageStyle(
                "detail-month-page-next-2026-08"
            )).toMatchObject({
                translateX: 0,
                translateY: DETAIL_MONTH_SWIPE_MOTION.travel,
            });
            expect(getPagerPageStyle(
                "detail-month-page-next-2026-08"
            ).opacity).toBeCloseTo(
                52 / DETAIL_MONTH_SWIPE_MOTION.travel
            );

            endGesture(gesture, swipeUp);
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
            expect(onSelectDay).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");
            expect(motion.translateY.__getValue()).toBe(0);
            expect(motion.opacity.__getValue()).toBe(1);
            expect(reanimated.__getPendingTimingCallbackCount()).toBe(1);

            act(() => reanimated.__flushTimingCallbacks());
            // The source page must stay at the outgoing endpoint until the
            // controlled target is mounted. Rebasing it in the opposite
            // direction here caused the
            // visible reverse bounce captured on the simulator.
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: -DETAIL_MONTH_SWIPE_MOTION.travel,
            });
            expect(getDetailMonthGestureLayerOpacity()).toBe(1);

            await acknowledgeControlledMonth("2026-08-15");

            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(getDetailMonthGestureLayerOpacity()).toBe(1);
            expect(motion.translateY.__getValue()).toBe(0);
            expect(motion.opacity.__getValue()).toBe(1);
            expect(renderer?.root.findByProps({
                testID: "detail-month-page-current-2026-08",
            })).toBeDefined();
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("세로 아래 release도 이전 월 pager를 향해 대칭 이동하고 되튀지 않는다", async () => {
        await renderCalendar("2026-08-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);

        try {
            const { gesture } = startGesture();
            const swipeDown = panGestureEvent(2, 52);

            updateGesture(gesture, swipeDown);
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 52,
            });
            expect(getPagerPageStyle(
                "detail-month-page-current-2026-08"
            ).opacity).toBeCloseTo(
                1 - 52 / DETAIL_MONTH_SWIPE_MOTION.travel
            );
            expect(getPagerPageStyle(
                "detail-month-page-previous-2026-07"
            )).toMatchObject({
                translateX: 0,
                translateY: -DETAIL_MONTH_SWIPE_MOTION.travel,
            });
            expect(getPagerPageStyle(
                "detail-month-page-previous-2026-07"
            ).opacity).toBeCloseTo(
                52 / DETAIL_MONTH_SWIPE_MOTION.travel
            );

            endGesture(gesture, swipeDown);
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-07-15");
            expect(onSelectDay).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledWith("2026-07-15");

            act(() => reanimated.__flushTimingCallbacks());
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: DETAIL_MONTH_SWIPE_MOTION.travel,
            });

            await acknowledgeControlledMonth("2026-07-15");
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(renderer?.root.findByProps({
                testID: "detail-month-page-current-2026-07",
            })).toBeDefined();
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("성공 settle이 native에서 중단돼도 pager 잠금을 풀어 재시도할 수 있다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);

        try {
            const { gesture } = startGesture();
            const interruptedSwipe = panGestureEvent(-52, 2);

            updateGesture(gesture, interruptedSwipe);
            endGesture(gesture, interruptedSwipe);
            expect(reanimated.__getPendingTimingCallbackCount()).toBe(1);
            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
            expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");

            // Run the cancellation callback without deferring the recovery
            // timing it starts.
            reanimated.__setTimingCallbacksDeferred(false);
            act(() => reanimated.__flushTimingCallbacks(false));
            onVisibleMonthChange.mockClear();
            onSelectDay.mockClear();

            const retry = startGesture();
            expect(retry.stateManager.fail).not.toHaveBeenCalled();
            updateGesture(retry.gesture, interruptedSwipe);
            endGesture(retry.gesture, interruptedSwipe);

            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
            expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("controlled ACK 뒤 native settle이 중단되면 target month로 pager를 rebase한다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);

        try {
            const { gesture } = startGesture();
            const interruptedSwipe = panGestureEvent(-52, 2);

            updateGesture(gesture, interruptedSwipe);
            endGesture(gesture, interruptedSwipe);
            await updateCalendar("2026-08-15");

            reanimated.__setTimingCallbacksDeferred(false);
            act(() => reanimated.__flushTimingCallbacks(false));

            expect(renderer?.root.findByProps({
                testID: "detail-month-page-current-2026-08",
            })).toBeDefined();
            expect(() => renderer?.root.findByProps({
                testID: "detail-month-page-current-2026-07",
            })).toThrow();
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("중단 cancel의 JS ACK 전에는 재터치를 막고 rebase 뒤 잠금을 푼다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);

        try {
            const { gesture } = startGesture();
            const interruptedSwipe = panGestureEvent(-52, 2);

            updateGesture(gesture, interruptedSwipe);
            endGesture(gesture, interruptedSwipe);
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
            await updateCalendar("2026-08-15");

            reanimated.__setRunOnJSCallbacksDeferred(true);
            reanimated.__setTimingCallbacksDeferred(false);
            act(() => reanimated.__flushTimingCallbacks(false));
            expect(reanimated.__getPendingRunOnJSCallbackCount()).toBe(1);

            const blockedRetry = startGesture();
            expect(blockedRetry.stateManager.fail).toHaveBeenCalledTimes(1);
            cancelGesture(blockedRetry.gesture);
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);

            act(() => reanimated.__flushRunOnJSCallbacks());
            expect(renderer?.root.findByProps({
                testID: "detail-month-page-current-2026-08",
            })).toBeDefined();
            expect(() => renderer?.root.findByProps({
                testID: "detail-month-page-current-2026-07",
            })).toThrow();

            const retryAfterRebase = startGesture();
            expect(retryAfterRebase.stateManager.fail).not.toHaveBeenCalled();
            cancelGesture(retryAfterRebase.gesture);
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
            reanimated.__setRunOnJSCallbacksDeferred(false);
            act(() => reanimated.__flushRunOnJSCallbacks());
        }
    });

    test("비동기로 도착한 JS settle 시작 신호가 UI release animation을 취소하지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        reanimated.__setRunOnJSCallbacksDeferred(true);

        try {
            const { gesture } = startGesture();
            const swipe = panGestureEvent(-52, 2);

            updateGesture(gesture, swipe);
            endGesture(gesture, swipe);
            expect(reanimated.__getPendingTimingCallbackCount()).toBe(1);
            expect(reanimated.__getPendingRunOnJSCallbackCount()).toBe(1);
            expect(onVisibleMonthChange).not.toHaveBeenCalled();
            expect(onSelectDay).not.toHaveBeenCalled();

            const cancelCallsBeforeJSStart =
                reanimated.cancelAnimation.mock.calls.length;
            act(() => reanimated.__flushRunOnJSCallbacks());

            expect(reanimated.cancelAnimation).toHaveBeenCalledTimes(
                cancelCallsBeforeJSStart
            );
            expect(reanimated.__getPendingTimingCallbackCount()).toBe(1);
            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
            expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");

            await updateCalendar("2026-08-15");
            reanimated.__setRunOnJSCallbacksDeferred(false);
            act(() => reanimated.__flushTimingCallbacks());
            expect(pendingFrameCallbacks).toHaveLength(1);
            flushNextFrame();
            flushNextFrame();
            flushNextFrame();

            expect(renderer?.root.findByProps({
                testID: "detail-month-page-current-2026-08",
            })).toBeDefined();
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
            reanimated.__setRunOnJSCallbacksDeferred(false);
            act(() => reanimated.__flushRunOnJSCallbacks());
        }
    });

    test("settle 상한 뒤 Fabric rebase가 늦어도 target page를 화면에 고정한다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        jest.useFakeTimers();

        try {
            const { gesture } = startGesture();
            const swipe = panGestureEvent(-52, 2);

            updateGesture(gesture, swipe);
            endGesture(gesture, swipe);
            await updateCalendar("2026-08-15");
            act(() => reanimated.__flushTimingCallbacks());

            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: -320,
                translateY: 0,
            });
            expect(pendingFrameCallbacks).toHaveLength(1);

            act(() => jest.advanceTimersByTime(1_000));
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: -320,
                translateY: 0,
            });
            expect(pendingFrameCallbacks).toHaveLength(1);

            flushNextFrame();
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(renderer?.root.findByProps({
                testID: "detail-month-page-current-2026-08",
            })).toBeDefined();
            expect(pendingFrameCallbacks).toHaveLength(1);
            flushNextFrame();
            expect(pendingFrameCallbacks).toHaveLength(1);
            flushNextFrame();
            expect(pendingFrameCallbacks).toHaveLength(0);
        } finally {
            jest.useRealTimers();
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("세로 cancel은 인접 pager를 교차 표시한 뒤 원점으로 복귀한다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);

        try {
            const { gesture } = startGesture();
            updateGesture(gesture, panGestureEvent(2, -64));
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: -64,
            });
            expect(getPreviousPagerPageOffset()).toEqual({
                translateX: 0,
                translateY: -DETAIL_MONTH_SWIPE_MOTION.travel,
            });
            expect(getPagerPageStyle(
                "detail-month-page-next-2026-08"
            ).opacity).toBeCloseTo(
                64 / DETAIL_MONTH_SWIPE_MOTION.travel
            );

            cancelGesture(gesture);
            expect(reanimated.__getPendingTimingCallbackCount()).toBe(1);
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(getPagerPageStyle(
                "detail-month-page-current-2026-07"
            ).opacity).toBe(1);
            expect(getPagerPageStyle(
                "detail-month-page-next-2026-08"
            )).toMatchObject({
                opacity: 0,
                translateX: 0,
                translateY: DETAIL_MONTH_SWIPE_MOTION.travel,
            });
            expect(getPreviousPagerPageOffset()).toEqual({
                translateX: 0,
                translateY: -DETAIL_MONTH_SWIPE_MOTION.travel,
            });

            act(() => reanimated.__flushTimingCallbacks());
            expect(getPreviousPagerPageOffset()).toEqual({
                translateX: -320,
                translateY: 0,
            });
            expect(onVisibleMonthChange).not.toHaveBeenCalled();
            expect(onSelectDay).not.toHaveBeenCalled();
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("activation update 직후 끝나는 빠른 flick도 release 위치에서 다음 달로 이어진다", async () => {
        await renderCalendar("2026-07-15");
        const { gesture } = startGesture();
        const flick = panGestureEvent(
            -(DETAIL_MONTH_SWIPE_GESTURE.activationDistance + 1),
            0,
            -1_200,
            0
        );

        // Gesture Handler가 활성화한 첫 update 뒤 추가 move 없이 바로 end한다.
        updateGesture(gesture, flick);
        endGesture(gesture, flick);

        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
        expect(onSelectDay).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");
    });

    test("상세형 짧은 가로 드래그는 손가락 위치에서 원점으로 복귀한다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        const { gesture } = startGesture();
        const drag = panGestureEvent(-20, 0, -100, 0);
        const callCountBeforeEnd = reanimated.withTiming.mock.calls.length;
        const cancelDuration = getDetailMonthSwipeSettleDuration(
            20,
            0,
            320,
            DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs
        );

        updateGesture(gesture, drag);
        endGesture(gesture, drag);

        expect(reanimated.withTiming.mock.calls.slice(callCountBeforeEnd)).toEqual([
            [
                0,
                expect.objectContaining({ duration: cancelDuration }),
                expect.any(Function),
            ],
            [
                0,
                expect.objectContaining({ duration: cancelDuration }),
                undefined,
            ],
            [1, expect.objectContaining({ duration: cancelDuration })],
        ]);
        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
    });

    test("활성 제스처가 취소되면 현재 offset을 원점으로 되돌리고 commit하지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        const { gesture } = startGesture();
        updateGesture(gesture, panGestureEvent(-64, 2));
        const callCountBeforeCancel = reanimated.withTiming.mock.calls.length;

        cancelGesture(gesture);

        expect(reanimated.withTiming.mock.calls.slice(callCountBeforeCancel))
            .toEqual([
                [
                    0,
                    expect.objectContaining({ duration: expect.any(Number) }),
                    expect.any(Function),
                ],
                [
                    0,
                    expect.objectContaining({ duration: expect.any(Number) }),
                    undefined,
                ],
                [1, expect.objectContaining({ duration: expect.any(Number) })],
            ]);
        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
    });

    test("세로 제스처 도중 두 번째 손가락이 닿으면 recognizer를 실패시키고 취소한다", async () => {
        await renderCalendar("2026-07-15");
        const { gesture } = startGesture();
        updateGesture(gesture, panGestureEvent(2, -52));
        const stateManager: MockGestureStateManager = { fail: jest.fn() };

        act(() => gesture.callbacks.onTouchesDown?.(
            { numberOfTouches: 2 },
            stateManager
        ));
        cancelGesture(gesture);

        expect(gesture.config.maxPointers).toBe(1);
        expect(stateManager.fail).toHaveBeenCalledTimes(1);
        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
    });

    test.each([
        {
            label: "짧은 세로",
            event: panGestureEvent(2, 20),
        },
        {
            label: "축이 정해지지 않은 대각선",
            event: panGestureEvent(12, 12),
        },
    ])("$label 드래그는 월을 바꾸지 않는다", async ({ event }) => {
        await renderCalendar("2026-07-15");
        const { gesture } = startGesture();

        updateGesture(gesture, event);
        endGesture(gesture, event);

        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
    });

    test("settle 중 blocked 재터치는 진행 중인 pager를 reset하지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        const { gesture: firstGesture } = startGesture();
        const swipe = panGestureEvent(-52, 2);

        updateGesture(firstGesture, swipe);
        endGesture(firstGesture, swipe);
        expect(onSelectDay).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");

        const timingCallsBeforeRetouch = reanimated.withTiming.mock.calls.length;
        const cancelCallsBeforeRetouch =
            reanimated.cancelAnimation.mock.calls.length;
        const blockedGesture = getDetailMonthGesture();
        const stateManager: MockGestureStateManager = { fail: jest.fn() };

        act(() => blockedGesture.callbacks.onTouchesDown?.(
            { numberOfTouches: 1 },
            stateManager
        ));
        cancelGesture(blockedGesture);

        expect(stateManager.fail).toHaveBeenCalledTimes(1);
        expect(reanimated.withTiming).toHaveBeenCalledTimes(
            timingCallsBeforeRetouch
        );
        expect(reanimated.cancelAnimation).toHaveBeenCalledTimes(
            cancelCallsBeforeRetouch
        );
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledTimes(1);

        await updateCalendar("2026-08-15");
        act(() => getCalendarProps().onMonthChange({
            dateString: "2026-08-15",
        }));
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledTimes(1);
    });

    test("월 commit ACK가 오지 않으면 watchdog이 투명 상태를 복구한다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();
        const targetDate: MockDateData = {
            year: 2026,
            month: 7,
            day: 20,
            dateString: "2026-07-20",
            timestamp: new Date(2026, 6, 20).getTime(),
        };
        const renderedDayComponent = calendar.dayComponent({ date: targetDate });
        jest.useFakeTimers();

        try {
            act(() => calendar.onPressArrowRight(jest.fn()));
            flushNextFrame();
            onSelectDay.mockClear();
            onVisibleMonthChange.mockClear();

            act(() => jest.advanceTimersByTime(
                DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs
            ));
            act(() => renderedDayComponent.props.onPress(targetDate));

            expect(onSelectDay).toHaveBeenCalledWith("2026-07-20");
            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-07-20");
            expect(pendingFrameCallbacks).toHaveLength(0);

            act(() => calendar.onMonthChange({ dateString: "2026-08-15" }));
            expect(onSelectDay).not.toHaveBeenCalledWith("2026-08-15");
            expect(onVisibleMonthChange).not.toHaveBeenCalledWith("2026-08-15");
        } finally {
            jest.useRealTimers();
        }
    });

    test("pager ACK 뒤에는 RAF를 남기지 않고 unmount한다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowRight(jest.fn()));
        flushNextFrame();
        await updateCalendar("2026-08-15");
        act(() => getCalendarProps().onMonthChange({ dateString: "2026-08-15" }));
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
        expect(pendingFrameCallbacks).toHaveLength(1);
        flushNextFrame();
        expect(pendingFrameCallbacks).toHaveLength(0);

        await act(async () => renderer?.unmount());
        renderer = undefined;
        expect(Animated.parallel).not.toHaveBeenCalled();
    });

    test("전환 중에는 투명한 이전 달의 날짜 탭을 무시한다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();
        const targetDate: MockDateData = {
            year: 2026,
            month: 7,
            day: 20,
            dateString: "2026-07-20",
            timestamp: new Date(2026, 6, 20).getTime(),
        };
        const renderedDayComponent = calendar.dayComponent({ date: targetDate });

        act(() => calendar.onPressArrowRight(jest.fn()));
        act(() => renderedDayComponent.props.onPress(targetDate));

        expect(onSelectDay).not.toHaveBeenCalled();
        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onOpenDay).not.toHaveBeenCalled();
    });

    test("동작 줄이기에서는 이동 없이 짧은 fade만 사용한다", async () => {
        await renderCalendar("2026-07-15", true);
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowRight(jest.fn()));

        expect(Animated.timing).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({
                toValue: 0,
                duration: 24,
                useNativeDriver: true,
                isInteraction: false,
            })
        );

        finishNextAnimation();
        await updateCalendar("2026-08-15");
        act(() => getCalendarProps().onMonthChange({ dateString: "2026-08-15" }));
        flushNextFrame();

        expect(Animated.timing).toHaveBeenNthCalledWith(
            3,
            expect.anything(),
            expect.objectContaining({
                toValue: 0,
                duration: 40,
                useNativeDriver: true,
                isInteraction: false,
            })
        );
        finishNextAnimation();
    });

    test("상세형이 아닌 고정 달력은 기존 라이브러리 월 이동을 유지한다", async () => {
        await renderCalendar("2026-07-15", false, "list");
        const calendar = getCalendarProps();
        const libraryChangeMonth = jest.fn();

        expect(calendar.enableSwipeMonths).toBe(true);
        expect(getDetailMonthGesture().config.enabled).toBe(false);
        act(() => calendar.onPressArrowRight(libraryChangeMonth));

        expect(libraryChangeMonth).toHaveBeenCalledTimes(1);
        expect(Animated.parallel).not.toHaveBeenCalled();
    });

    test.each(["detail", "list"] as const)(
        "%s 같은 달 Today target은 committed props 다음 RAF에서 ACK한다",
        async (viewMode) => {
            await renderCalendar("2026-07-15", false, viewMode);
            const target: TodayFocusTarget = {
                day: "2026-07-16",
                requiresMonthChange: false,
            };

            await updateCalendar(target.day, {
                todayFocusTarget: target,
                viewMode,
            });

            expect(onTodayFocusReady).not.toHaveBeenCalled();
            expect(pendingFrameCallbacks).toHaveLength(1);

            flushNextFrame();
            expect(onTodayFocusReady).toHaveBeenCalledTimes(1);
            expect(onTodayFocusReady).toHaveBeenCalledWith(target.day);
            expect(onVisibleMonthChange).not.toHaveBeenCalled();
            expect(onSelectDay).not.toHaveBeenCalled();
        }
    );

    test.each(["detail", "list"] as const)(
        "%s 다른 달 Today target은 Calendar month commit ACK를 기다린다",
        async (viewMode) => {
            await renderCalendar("2026-07-15", false, viewMode);
            const target: TodayFocusTarget = {
                day: "2026-08-16",
                requiresMonthChange: true,
            };

            await updateCalendar(target.day, {
                todayFocusTarget: target,
                viewMode,
            });

            expect(onTodayFocusReady).not.toHaveBeenCalled();
            expect(pendingFrameCallbacks).toHaveLength(0);

            act(() => getCalendarProps().onMonthChange({ dateString: "2026-08-01" }));
            act(() => getCalendarProps().onMonthChange({ dateString: "2026-08-16" }));

            expect(onTodayFocusReady).toHaveBeenCalledTimes(1);
            expect(onTodayFocusReady).toHaveBeenCalledWith(target.day);
            expect(onVisibleMonthChange).not.toHaveBeenCalled();
            expect(onSelectDay).not.toHaveBeenCalled();
        }
    );

    test("week Today target은 committed props 다음 RAF에서 ACK한다", async () => {
        await renderCalendar("2026-07-15", false, "week");
        const target: TodayFocusTarget = {
            day: "2026-08-16",
            requiresMonthChange: true,
        };

        await updateCalendar(target.day, {
            todayFocusTarget: target,
            viewMode: "week",
        });

        expect(onTodayFocusReady).not.toHaveBeenCalled();
        flushNextFrame();
        expect(onTodayFocusReady).toHaveBeenCalledWith(target.day);
    });

    test("등록한 cancel은 진행 중인 detail month motion을 즉시 무효화한다", async () => {
        onRegisterDetailMonthMotionCancel = jest.fn();
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();
        const registeredCancel = onRegisterDetailMonthMotionCancel.mock.calls[0]?.[0];

        expect(registeredCancel).toEqual(expect.any(Function));
        act(() => calendar.onPressArrowRight(jest.fn()));
        act(() => registeredCancel());
        flushNextFrame();

        expect(onSelectDay).not.toHaveBeenCalled();
        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(pendingFrameCallbacks).toHaveLength(0);

        await act(async () => renderer?.unmount());
        renderer = undefined;
        expect(onRegisterDetailMonthMotionCancel).toHaveBeenLastCalledWith(null);
    });

    test("등록한 shift callback도 상세형 월 전환 state machine을 공유한다", async () => {
        onRegisterDetailMonthMotionShift = jest.fn();
        await renderCalendar("2026-07-15");
        const registeredShift = onRegisterDetailMonthMotionShift.mock.calls[0]?.[0];

        expect(registeredShift).toEqual(expect.any(Function));
        act(() => registeredShift(1));
        flushNextFrame();

        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
        expect(onSelectDay).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");

        await acknowledgeControlledMonth("2026-08-15");

        await act(async () => renderer?.unmount());
        renderer = undefined;
        expect(onRegisterDetailMonthMotionShift).toHaveBeenLastCalledWith(null);
    });
});
