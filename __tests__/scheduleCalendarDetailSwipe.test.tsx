import React from "react";
import { Animated } from "react-native";
import {
    State,
    type PanGestureHandlerProps,
} from "react-native-gesture-handler";
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
    onMonthChange: (month: { dateString: string }) => void;
    onPressArrowLeft: (changeMonth: () => void) => void;
    onPressArrowRight: (changeMonth: () => void) => void;
    dayComponent: (props: { date: MockDateData }) => React.ReactElement<{
        onPress: (day: MockDateData) => void;
    }>;
};

let mockCalendarProps: CalendarMockProps | null = null;

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

jest.mock("react-native-calendars", () => ({
    Calendar: (props: CalendarMockProps) => {
        mockCalendarProps = props;
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

    function getDetailMonthGestureHandlerProps(): PanGestureHandlerProps {
        const handler = renderer?.root.findByProps({
            testID: "detail-month-swipe-handler",
        });
        if (!handler) throw new Error("Detail month native gesture handler was not rendered");
        return handler.props as PanGestureHandlerProps;
    }

    function gestureStateEvent(
        state: number,
        oldState: number,
        translationX: number,
        velocityX = 0
    ) {
        return {
            nativeEvent: {
                state,
                oldState,
                translationX,
                translationY: 0,
                velocityX,
                velocityY: 0,
            },
        } as Parameters<NonNullable<PanGestureHandlerProps["onHandlerStateChange"]>>[0];
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
        flushNextFrame();
        finishNextAnimation();
    }

    test("12월에서 왼쪽으로 넘기면 ACK 뒤 다음 해 1월을 한 번만 반영한다", async () => {
        await renderCalendar("2026-12-31");
        const calendar = getCalendarProps();
        const staleLibraryChangeMonth = jest.fn();

        act(() => calendar.onPressArrowRight(staleLibraryChangeMonth));
        finishNextAnimation();

        expect(staleLibraryChangeMonth).not.toHaveBeenCalled();
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onVisibleMonthChange).toHaveBeenLastCalledWith("2027-01-31");
        expect(onSelectDay).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenLastCalledWith("2027-01-31");
        expect(pendingFrameCallbacks).toHaveLength(0);

        await updateCalendar("2027-01-31");
        act(() => getCalendarProps().onMonthChange({ dateString: "2027-01-31" }));
        expect(pendingFrameCallbacks).toHaveLength(1);
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledTimes(1);

        flushNextFrame();
        finishNextAnimation();
    });

    test("1월에서 오른쪽으로 넘기면 이전 해 12월 말일로 보정한다", async () => {
        await renderCalendar("2026-01-31");
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowLeft(jest.fn()));
        finishNextAnimation();

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

        finishNextAnimation();
        expect(onSelectDay).toHaveBeenLastCalledWith("2026-08-15");
        await acknowledgeControlledMonth("2026-08-15");

        // The queued swipe starts as soon as the first enter animation settles.
        expect(pendingAnimationCallbacks).toHaveLength(1);
        finishNextAnimation();
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

    test("전환 중 반대 방향 스와이프는 첫 전환 뒤 원래 달로 복귀한다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => {
            calendar.onPressArrowRight(jest.fn());
            calendar.onPressArrowLeft(jest.fn());
        });

        finishNextAnimation();
        await acknowledgeControlledMonth("2026-08-15");
        finishNextAnimation();
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
        finishNextAnimation();

        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
        expect(pendingFrameCallbacks).toHaveLength(0);
    });

    test("controlled props commit이 enter ACK이고 늦은 Calendar callback은 중복시키지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowRight(jest.fn()));
        finishNextAnimation();
        await updateCalendar("2026-08-15");

        expect(Animated.parallel).toHaveBeenCalledTimes(1);
        expect(pendingFrameCallbacks).toHaveLength(1);

        act(() => getCalendarProps().onMonthChange({ dateString: "2026-08-15" }));
        expect(pendingFrameCallbacks).toHaveLength(1);
        expect(Animated.parallel).toHaveBeenCalledTimes(1);
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledTimes(1);

        flushNextFrame();
        expect(Animated.parallel).toHaveBeenCalledTimes(2);
        expect(Animated.timing).toHaveBeenNthCalledWith(
            3,
            expect.anything(),
            expect.objectContaining({ isInteraction: false })
        );
        expect(Animated.timing).toHaveBeenNthCalledWith(
            4,
            expect.anything(),
            expect.objectContaining({ isInteraction: false })
        );
        finishNextAnimation();
    });

    test.each([
        { label: "왼쪽", dx: -48, targetDay: "2026-08-15" },
        { label: "오른쪽", dx: 48, targetDay: "2026-06-15" },
    ])(
        "상세형 $label 네이티브 드래그가 월을 한 번만 이동한다",
        async ({ dx, targetDay }) => {
            await renderCalendar("2026-07-15");
            const calendar = getCalendarProps();
            const handler = getDetailMonthGestureHandlerProps();

            expect(calendar.enableSwipeMonths).toBe(false);
            expect(handler.enabled).toBe(true);
            expect(
                (handler.onGestureEvent as unknown as { __isNative?: boolean }).__isNative
            ).toBe(true);
            expect(handler.maxPointers).toBe(1);

            act(() => handler.onHandlerStateChange?.(
                gestureStateEvent(State.BEGAN, State.UNDETERMINED, 0)
            ));
            act(() => handler.onHandlerStateChange?.(
                gestureStateEvent(State.END, State.ACTIVE, dx)
            ));
            finishNextAnimation();

            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onVisibleMonthChange).toHaveBeenLastCalledWith(targetDay);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenLastCalledWith(targetDay);

            await updateCalendar(targetDay);
            expect(pendingFrameCallbacks).toHaveLength(1);

            act(() => getCalendarProps().onMonthChange({ dateString: targetDay }));
            expect(pendingFrameCallbacks).toHaveLength(1);
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);

            flushNextFrame();
            finishNextAnimation();
        }
    );

    test("상세형 짧은 가로 드래그는 월을 바꾸지 않고 원위치로 스냅한다", async () => {
        await renderCalendar("2026-07-15");
        const handler = getDetailMonthGestureHandlerProps();

        act(() => handler.onHandlerStateChange?.(
            gestureStateEvent(State.BEGAN, State.UNDETERMINED, 0)
        ));
        act(() => handler.onHandlerStateChange?.(
            gestureStateEvent(State.END, State.ACTIVE, -20, -100)
        ));

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

    test("상세형의 세로 우세 드래그는 네이티브 가로 제스처가 가로채지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const handler = getDetailMonthGestureHandlerProps();
        const failOffsetY = handler.failOffsetY as [number, number];

        expect(handler.activeOffsetX).toEqual([
            -DETAIL_MONTH_SWIPE_GESTURE.activationDistance,
            DETAIL_MONTH_SWIPE_GESTURE.activationDistance,
        ]);
        expect(failOffsetY[1]).toBeCloseTo(
            DETAIL_MONTH_SWIPE_GESTURE.activationDistance
                / DETAIL_MONTH_SWIPE_GESTURE.directionDominance
        );
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
            finishNextAnimation();
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

    test("ACK 뒤 대기 중 unmount하면 RAF와 늦은 callback을 무효화한다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowRight(jest.fn()));
        finishNextAnimation();
        await updateCalendar("2026-08-15");
        act(() => getCalendarProps().onMonthChange({ dateString: "2026-08-15" }));
        const pendingFrameId = pendingFrameCallbacks[0]?.id;
        expect(pendingFrameId).toBeDefined();

        await act(async () => renderer?.unmount());
        renderer = undefined;
        expect(cancelAnimationFrame).toHaveBeenCalledWith(pendingFrameId);

        flushNextFrame();
        expect(Animated.parallel).toHaveBeenCalledTimes(1);
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
        expect(getDetailMonthGestureHandlerProps().enabled).toBe(false);
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
        finishNextAnimation();

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
        finishNextAnimation();

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
