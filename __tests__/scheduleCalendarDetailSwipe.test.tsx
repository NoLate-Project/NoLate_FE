import React from "react";
import {
    Animated,
    PanResponder,
    type GestureResponderEvent,
    type PanResponderGestureState,
} from "react-native";
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

type DetailMonthPanResponderProps = ReturnType<
    typeof PanResponder.create
>["panHandlers"] & { testID?: string };

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
        jest.spyOn(PanResponder, "create").mockImplementation((config) => ({
            panHandlers: {
                onStartShouldSetResponder: config.onStartShouldSetPanResponder,
                onStartShouldSetResponderCapture:
                    config.onStartShouldSetPanResponderCapture,
                onMoveShouldSetResponder: config.onMoveShouldSetPanResponder,
                onMoveShouldSetResponderCapture:
                    config.onMoveShouldSetPanResponderCapture,
                onResponderGrant: config.onPanResponderGrant,
                onResponderMove: config.onPanResponderMove,
                onResponderRelease: config.onPanResponderRelease,
                onResponderTerminate: config.onPanResponderTerminate,
                onResponderTerminationRequest:
                    config.onPanResponderTerminationRequest,
            },
            getInteractionHandle: () => null,
        } as ReturnType<typeof PanResponder.create>));
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
    }

    async function updateCalendar(
        selectedDay: string,
        options?: {
            reduceMotionEnabled?: boolean;
            viewMode?: CalendarViewMode;
            todayFocusTarget?: TodayFocusTarget | null;
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
        await act(async () => {
            renderer?.update(calendarElement());
        });
    }

    function getCalendarProps() {
        if (!mockCalendarProps) throw new Error("Calendar mock was not rendered");
        return mockCalendarProps;
    }

    function getDetailMonthGestureHandlerProps(): DetailMonthPanResponderProps {
        const handler = renderer?.root.findByProps({
            testID: "detail-month-swipe-handler",
        });
        if (!handler) throw new Error("Detail month pan responder was not rendered");
        return handler.props as DetailMonthPanResponderProps;
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

    function responderEvent(touchCount = 1): GestureResponderEvent {
        return {
            nativeEvent: {
                touches: Array.from({ length: touchCount }, () => ({})),
            },
        } as GestureResponderEvent;
    }

    function responderGestureState(
        dx: number,
        vx = 0,
        dy = 0,
        vy = 0
    ): PanResponderGestureState {
        return { dx, dy, vx, vy } as PanResponderGestureState;
    }

    function callPanHandler(
        handler: DetailMonthPanResponderProps,
        name: keyof DetailMonthPanResponderProps,
        event: GestureResponderEvent,
        gestureState: PanResponderGestureState
    ) {
        const callback = handler[name] as unknown as (
            responderEvent: GestureResponderEvent,
            responderState: PanResponderGestureState
        ) => unknown;
        return callback?.(event, gestureState);
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

    async function acknowledgeControlledMonth(targetDay: string) {
        await updateCalendar(targetDay);
        act(() => getCalendarProps().onMonthChange({ dateString: targetDay }));
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

        await updateCalendar("2027-01-31");
        act(() => getCalendarProps().onMonthChange({ dateString: "2027-01-31" }));
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
        expect(pendingFrameCallbacks).toHaveLength(0);

        act(() => getCalendarProps().onMonthChange({ dateString: "2026-08-15" }));
        expect(pendingFrameCallbacks).toHaveLength(0);
        expect(Animated.parallel).not.toHaveBeenCalled();
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledTimes(1);
    });

    test.each([
        {
            label: "왼쪽",
            dx: -48,
            targetDay: "2026-08-15",
            pages: ["2026-07-15", "2026-08-15", "2026-09-15"],
        },
        {
            label: "오른쪽",
            dx: 48,
            targetDay: "2026-06-15",
            pages: ["2026-05-15", "2026-06-15", "2026-07-15"],
        },
    ])(
        "상세형 $label 드래그가 월을 한 번만 이동한다",
        async ({ dx, targetDay, pages }) => {
            await renderCalendar("2026-07-15");
            const calendar = getCalendarProps();
            const handler = getDetailMonthGestureHandlerProps();
            const event = responderEvent();
            const gestureState = responderGestureState(dx);

            expect(calendar.enableSwipeMonths).toBe(false);
            expect(callPanHandler(
                handler, "onMoveShouldSetResponder", event, gestureState
            )).toBe(true);
            act(() => { callPanHandler(handler, "onResponderGrant", event, gestureState); });
            act(() => { callPanHandler(handler, "onResponderMove", event, gestureState); });
            act(() => { callPanHandler(handler, "onResponderRelease", event, gestureState); });

            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onVisibleMonthChange).toHaveBeenLastCalledWith(targetDay);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenLastCalledWith(targetDay);

            await updateCalendar(targetDay);
            expect(pendingFrameCallbacks).toHaveLength(0);
            expect(mockCalendarInitialDates.slice(-3)).toEqual(pages);

            act(() => getCalendarProps().onMonthChange({ dateString: targetDay }));
            expect(pendingFrameCallbacks).toHaveLength(0);
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
        }
    );

    test("상세형 짧은 가로 드래그는 월을 바꾸지 않고 원위치로 스냅한다", async () => {
        await renderCalendar("2026-07-15");
        const handler = getDetailMonthGestureHandlerProps();
        const event = responderEvent();
        const gestureState = responderGestureState(-20, -0.1);

        expect(callPanHandler(
            handler, "onMoveShouldSetResponder", event, gestureState
        )).toBe(true);
        act(() => { callPanHandler(handler, "onResponderGrant", event, gestureState); });
        act(() => { callPanHandler(handler, "onResponderMove", event, gestureState); });
        act(() => { callPanHandler(handler, "onResponderRelease", event, gestureState); });

        expect(Animated.timing).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                toValue: 0,
                duration: DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs,
                useNativeDriver: true,
                isInteraction: false,
            })
        );
        expect(Animated.timing).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                toValue: 1,
                duration: DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs,
                useNativeDriver: true,
                isInteraction: false,
            })
        );
        finishNextAnimation();
        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
    });

    test.each([
        {
            label: "위",
            dy: -52,
            targetDay: "2026-08-15",
            expectedFollowOffset: -DETAIL_MONTH_SWIPE_MOTION.travel,
            pages: ["2026-07-15", "2026-08-15", "2026-09-15"],
        },
        {
            label: "아래",
            dy: 52,
            targetDay: "2026-06-15",
            expectedFollowOffset: DETAIL_MONTH_SWIPE_MOTION.travel,
            pages: ["2026-05-15", "2026-06-15", "2026-07-15"],
        },
    ] as const)(
        "상세형 달력의 $label 스와이프는 $targetDay 월로 한 번만 이동한다",
        async ({ dy, targetDay, expectedFollowOffset, pages }) => {
            await renderCalendar("2026-07-15");
            const handler = getDetailMonthGestureHandlerProps();
            const event = responderEvent();
            const gestureState = responderGestureState(2, 0, dy);
            const motion = getDetailMonthAnimatedValues();

            expect(callPanHandler(
                handler,
                "onMoveShouldSetResponderCapture",
                event,
                gestureState
            )).toBe(true);
            act(() => { callPanHandler(handler, "onResponderGrant", event, gestureState); });
            act(() => { callPanHandler(handler, "onResponderMove", event, gestureState); });
            act(() => { callPanHandler(handler, "onResponderRelease", event, gestureState); });

            expect(motion.translateX.__getValue()).toBe(0);
            expect(motion.translateY.__getValue()).toBe(expectedFollowOffset);
            expect(onVisibleMonthChange).not.toHaveBeenCalled();

            finishNextAnimation();
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onVisibleMonthChange).toHaveBeenLastCalledWith(targetDay);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenLastCalledWith(targetDay);

            await updateCalendar(targetDay);
            act(() => getCalendarProps().onMonthChange({ dateString: targetDay }));
            flushNextFrame();
            finishNextAnimation();

            expect(mockCalendarInitialDates.slice(-3)).toEqual(pages);
        }
    );

    test("날짜 셀의 capture와 bubble 판정 사이에도 세로 월 이동 축을 유지한다", async () => {
        await renderCalendar("2026-07-15");
        const handler = getDetailMonthGestureHandlerProps();
        const event = responderEvent();
        const gestureState = responderGestureState(2, 0, -52, -0.1);

        expect(callPanHandler(
            handler,
            "onStartShouldSetResponderCapture",
            event,
            responderGestureState(0)
        )).toBe(false);
        expect(callPanHandler(
            handler,
            "onMoveShouldSetResponderCapture",
            event,
            gestureState
        )).toBe(true);
        expect(callPanHandler(
            handler,
            "onMoveShouldSetResponder",
            responderEvent(0),
            responderGestureState(0)
        )).toBe(true);

        act(() => {
            callPanHandler(handler, "onResponderGrant", event, gestureState);
            callPanHandler(handler, "onResponderRelease", event, gestureState);
        });

        finishNextAnimation();
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
        expect(onSelectDay).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");
    });

    test("세로 제스처 도중 두 번째 손가락이 추가되면 월 이동을 취소한다", async () => {
        await renderCalendar("2026-07-15");
        const handler = getDetailMonthGestureHandlerProps();
        const event = responderEvent();
        const gestureState = responderGestureState(2, 0, -52, -0.1);

        expect(callPanHandler(
            handler,
            "onMoveShouldSetResponderCapture",
            event,
            gestureState
        )).toBe(true);

        act(() => {
            callPanHandler(handler, "onResponderGrant", event, gestureState);
            callPanHandler(
                handler,
                "onResponderMove",
                responderEvent(2),
                gestureState
            );
            callPanHandler(
                handler,
                "onResponderRelease",
                responderEvent(0),
                gestureState
            );
        });

        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
    });

    test("상세형의 짧은 세로·대각선·멀티터치는 월을 바꾸지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const handler = getDetailMonthGestureHandlerProps();
        const event = responderEvent();
        const shortVerticalGesture = responderGestureState(2, 0, 20);

        expect(callPanHandler(
            handler,
            "onMoveShouldSetResponder",
            event,
            shortVerticalGesture
        )).toBe(true);
        act(() => {
            callPanHandler(handler, "onResponderGrant", event, shortVerticalGesture);
            callPanHandler(handler, "onResponderRelease", event, shortVerticalGesture);
        });

        expect(callPanHandler(
            handler,
            "onMoveShouldSetResponder",
            responderEvent(),
            responderGestureState(8, 0, 8)
        )).toBe(false);
        expect(callPanHandler(
            handler,
            "onMoveShouldSetResponder",
            responderEvent(2),
            responderGestureState(48)
        )).toBe(false);
        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
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
        expect(
            getDetailMonthGestureHandlerProps().onMoveShouldSetResponder
        ).toBeUndefined();
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
