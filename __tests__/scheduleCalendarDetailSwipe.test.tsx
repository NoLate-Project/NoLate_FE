import React from "react";
import { Animated, StyleSheet, Text } from "react-native";
import TestRenderer, {
    act,
    type ReactTestRenderer,
} from "react-test-renderer";
import type { SharedValue } from "react-native-reanimated";

import ScheduleCalendar from "../src/modules/schedule/components/calendar/ScheduleCalendar";
import type {
    DetailMonthPageLayouts,
    TodayFocusTarget,
} from "../src/modules/schedule/components/calendar/ScheduleCalendar";
import type { CalendarViewMode } from "../src/modules/schedule/components/calendar/viewMode";
import {
    DETAIL_MONTH_SWIPE_GESTURE,
    DETAIL_MONTH_SWIPE_MOTION,
    getDetailMonthSwipeSettleDuration,
} from "../src/modules/schedule/calendarMotion";
import { shiftCalendarMonth } from "../src/modules/schedule/calendarNavigation";

type MockDateData = {
    year: number;
    month: number;
    day: number;
    dateString: string;
    timestamp: number;
};

type CalendarMockProps = {
    enableSwipeMonths: boolean;
    current?: string;
    initialDate?: string;
    markedDates?: Record<string, {
        selected?: boolean;
    }>;
    onMonthChange?: (month: { dateString: string }) => void;
    onPressArrowLeft: (changeMonth: () => void) => void;
    onPressArrowRight: (changeMonth: () => void) => void;
    dayComponent: (props: {
        date: MockDateData;
        state?: string;
        marking?: {
            selected?: boolean;
        };
    }) => React.ReactElement<{
        allowDisabledPress?: boolean;
        animatedSelectedDayKey?: SharedValue<number>;
        detailCellHeight?: number;
        isSelectedDay?: boolean;
        onPress: (day: MockDateData) => void;
    }>;
    testID?: string;
};

type MockPanGestureEvent = {
    translationX: number;
    translationY: number;
    velocityX: number;
    velocityY: number;
};

type MockTapGestureEvent = {
    x: number;
    y: number;
    absoluteX: number;
    absoluteY: number;
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
    maxDistance?: number;
    maxDuration?: number;
    maxPointers?: number;
    cancelsTouchesInView?: boolean;
    testID?: string;
};

type DetailMonthGestureMock = {
    callbacks: DetailMonthGestureCallbacks;
    config: DetailMonthGestureConfig;
};

type DetailMonthTapGestureMock = {
    callbacks: {
        onEnd?: (event: MockTapGestureEvent, success: boolean) => void;
    };
    config: DetailMonthGestureConfig;
};

type DetailMonthHeightFixture = {
    animatedCalendarHeight: SharedValue<number>;
    animatedDayHeight: SharedValue<number>;
    motionActive: SharedValue<boolean>;
    pageLayouts: DetailMonthPageLayouts;
};

let mockCalendarProps: CalendarMockProps | null = null;
let mockCalendarInitialDates: string[] = [];
let mockCalendarPropsByInitialDate = new Map<string, CalendarMockProps>();
let mockCustomDayRenderCount = 0;
const DETAIL_MONTH_TEST_VIEWPORT_WIDTH = 320;
const DETAIL_MONTH_TEST_VIEWPORT_HEIGHT = 420;
const DETAIL_MONTH_TEST_PAGE_LAYOUTS: DetailMonthPageLayouts = {
    previous: {
        calendarHeight: 360,
        dayHeight: 52,
    },
    current: {
        calendarHeight: DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
        dayHeight: 60,
    },
    next: {
        calendarHeight: 500,
        dayHeight: 68,
    },
};
const FOCUSED_MONTH_TEST_PAGE_LAYOUTS: DetailMonthPageLayouts = {
    previous: {
        month: "2026-09",
        calendarHeight: 370,
        dayHeight: 49,
    },
    current: {
        month: "2026-10",
        calendarHeight: 430,
        dayHeight: 61,
    },
    next: {
        month: "2026-11",
        calendarHeight: 490,
        dayHeight: 73,
    },
};
const WEEK_COUNT_TEST_PAGE_LAYOUTS: DetailMonthPageLayouts = {
    byWeekCount: {
        4: {
            calendarHeight: 304,
            dayHeight: 44,
        },
        5: {
            calendarHeight: 390,
            dayHeight: 55,
        },
        6: {
            calendarHeight: 492,
            dayHeight: 66,
        },
    },
    previous: FOCUSED_MONTH_TEST_PAGE_LAYOUTS.previous,
    current: FOCUSED_MONTH_TEST_PAGE_LAYOUTS.current,
    next: FOCUSED_MONTH_TEST_PAGE_LAYOUTS.next,
};
const EMPTY_SCHEDULE_ITEMS: React.ComponentProps<
    typeof ScheduleCalendar
>["items"] = [];
let mockThemeMode: "light" | "dark" = "light";

jest.mock("@expo/vector-icons", () => ({
    Ionicons: () => null,
}));

jest.mock("react-native-calendars", () => ({
    Calendar: (props: CalendarMockProps) => {
        const renderedDate = props.current ?? props.initialDate;
        if (!renderedDate) {
            throw new Error("Calendar mock requires current or initialDate");
        }
        mockCalendarInitialDates.push(renderedDate);
        mockCalendarPropsByInitialDate.set(renderedDate, props);
        if (props.onMonthChange) {
            mockCalendarProps = props;
        }
        return null;
    },
}));

jest.mock("../src/modules/schedule/components/calendar/CustomDay", () => () => {
    mockCustomDayRenderCount += 1;
    return null;
});

jest.mock("../src/modules/theme/ThemeContext", () => ({
    useTheme: () => ({
        mode: mockThemeMode,
        colors: {
            arrowColor: "#111111",
            border: "#dddddd",
            calendarBackground: "#ffffff",
            dayHeaderColor: "#555555",
            monthTextColor: "#111111",
            textPrimary: "#000000",
            textSecondary: "#6e6e73",
            selectedDayBg: "#000000",
            selectedDayText: "#ffffff",
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
    let onDetailMonthPreview: jest.Mock;
    let pendingAnimationCallbacks: AnimationEndCallback[];
    let pendingFrameCallbacks: Array<{ id: number; callback: FrameCallback }>;
    let nextFrameId: number;
    let renderedDay: string;
    let renderedFocusedMonth: string;
    let renderedReduceMotion: boolean;
    let renderedViewMode: CalendarViewMode;
    let renderedTodayFocusTarget: TodayFocusTarget | null;
    let renderedTransitionActive: boolean;
    let renderedTransitionMonthKey: string | undefined;
    let onTodayFocusReady: jest.Mock;
    let onRegisterDetailMonthMotionCancel: jest.Mock | undefined;
    let onRegisterDetailMonthMotionShift: jest.Mock | undefined;
    let renderedHeightFixture: DetailMonthHeightFixture | null;
    let renderedHeaderOffset: number;
    let renderedOnCommitDetailMonth: jest.Mock | undefined;
    let renderedFirstDay: 0 | 1;
    let renderedItems: React.ComponentProps<typeof ScheduleCalendar>["items"];
    let renderedCalendarDaysByDate: NonNullable<React.ComponentProps<
        typeof ScheduleCalendar
    >["calendarDaysByDate"]>;
    let registeredDetailMonthMotionShift:
        | ((direction: -1 | 1) => void)
        | null;

    beforeAll(() => {
        (
            globalThis as typeof globalThis & {
                IS_REACT_ACT_ENVIRONMENT: boolean;
            }
        ).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        mockThemeMode = "light";
        mockCalendarProps = null;
        mockCalendarInitialDates = [];
        mockCalendarPropsByInitialDate = new Map();
        mockCustomDayRenderCount = 0;
        onOpenDay = jest.fn();
        onSelectDay = jest.fn();
        onVisibleMonthChange = jest.fn();
        onDetailMonthPreview = jest.fn();
        pendingAnimationCallbacks = [];
        pendingFrameCallbacks = [];
        nextFrameId = 1;
        renderedDay = "2026-07-15";
        renderedFocusedMonth = renderedDay;
        renderedReduceMotion = false;
        renderedViewMode = "detail";
        renderedTodayFocusTarget = null;
        renderedTransitionActive = false;
        renderedTransitionMonthKey = undefined;
        onTodayFocusReady = jest.fn();
        onRegisterDetailMonthMotionCancel = undefined;
        onRegisterDetailMonthMotionShift = undefined;
        renderedHeightFixture = null;
        renderedHeaderOffset = 0;
        renderedOnCommitDetailMonth = undefined;
        renderedFirstDay = 0;
        renderedItems = EMPTY_SCHEDULE_ITEMS;
        renderedCalendarDaysByDate = {};
        registeredDetailMonthMotionShift = null;
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
                focusedMonth={renderedFocusedMonth}
                items={renderedItems}
                calendarDaysByDate={renderedCalendarDaysByDate}
                onSelectDay={onSelectDay}
                onOpenDay={onOpenDay}
                viewMode={renderedViewMode}
                firstDay={renderedFirstDay}
                scrollRequest={0}
                onVisibleMonthChange={onVisibleMonthChange}
                onDetailMonthPreview={onDetailMonthPreview}
                onCommitDetailMonth={renderedOnCommitDetailMonth}
                reduceMotionEnabled={renderedReduceMotion}
                todayFocusTarget={renderedTodayFocusTarget}
                onTodayFocusReady={onTodayFocusReady}
                onRegisterDetailMonthMotionCancel={onRegisterDetailMonthMotionCancel}
                onRegisterDetailMonthMotionShift={(shift) => {
                    registeredDetailMonthMotionShift = shift;
                    onRegisterDetailMonthMotionShift?.(shift);
                }}
                transitionActive={renderedTransitionActive}
                transitionMonthKey={renderedTransitionMonthKey}
                animatedCalendarHeight={
                    renderedHeightFixture?.animatedCalendarHeight
                }
                animatedDayHeight={renderedHeightFixture?.animatedDayHeight}
                detailMonthPageLayouts={renderedHeightFixture?.pageLayouts}
                detailMonthMotionActive={
                    renderedHeightFixture?.motionActive
                }
                headerOffset={renderedHeaderOffset}
            />
        );
    }

    async function renderCalendar(
        selectedDay: string,
        reduceMotionEnabled = false,
        viewMode: CalendarViewMode = "detail",
        heightFixture: DetailMonthHeightFixture | null = null,
        focusedMonth: string = selectedDay,
        firstDay: 0 | 1 = 0
    ) {
        renderedDay = selectedDay;
        renderedFocusedMonth = focusedMonth;
        renderedReduceMotion = reduceMotionEnabled;
        renderedViewMode = viewMode;
        renderedHeightFixture = heightFixture;
        renderedFirstDay = firstDay;
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
                        width: DETAIL_MONTH_TEST_VIEWPORT_WIDTH,
                        height: DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
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
            focusedMonth?: string;
        }
    ) {
        renderedDay = selectedDay;
        renderedFocusedMonth = options?.focusedMonth ?? selectedDay;
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
        const currentPage = renderer?.root.findAll((node) => {
            const testID = node.props.testID;
            if (
                typeof testID !== "string"
                || !/^detail-month-page-(?:(?:current|previous|next)-)?\d{4}-\d{2}$/.test(
                    testID
                )
            ) return false;

            const style = getPagerPageStyle(testID);
            return style.translateX === 0 && style.translateY === 0;
        })[0];
        const currentMonth = currentPage?.props.testID.slice(-7);
        if (currentMonth) {
            const currentCalendar = [...mockCalendarPropsByInitialDate.entries()]
                .find(([day]) => day.startsWith(currentMonth))?.[1];
            if (currentCalendar) return currentCalendar;
            if (registeredDetailMonthMotionShift) {
                return {
                    enableSwipeMonths: false,
                    onPressArrowLeft: () => {
                        registeredDetailMonthMotionShift?.(-1);
                    },
                    onPressArrowRight: () => {
                        registeredDetailMonthMotionShift?.(1);
                    },
                    dayComponent: ({ date }: { date: MockDateData }) => ({
                        props: getDetailMonthDayProps(
                            `${currentMonth}-01`,
                            date.dateString
                        ),
                    }),
                } as unknown as CalendarMockProps;
            }
        }
        if (mockCalendarProps) return mockCalendarProps;

        const latestDate = mockCalendarInitialDates.at(-1);
        const latestCalendar = latestDate
            ? mockCalendarPropsByInitialDate.get(latestDate)
            : undefined;
        if (latestCalendar) return latestCalendar;
        throw new Error("Calendar mock was not rendered");
    }

    function createDetailMonthHeightFixture(
        pageLayouts: DetailMonthPageLayouts = DETAIL_MONTH_TEST_PAGE_LAYOUTS
    ): DetailMonthHeightFixture {
        return {
            animatedCalendarHeight: {
                value: pageLayouts.current.calendarHeight,
            } as SharedValue<number>,
            animatedDayHeight: {
                value: pageLayouts.current.dayHeight,
            } as SharedValue<number>,
            motionActive: {
                value: false,
            } as SharedValue<boolean>,
            pageLayouts,
        };
    }

    function getDetailMonthPageCellHeight(initialDate: string) {
        return getDetailMonthDayProps(initialDate).detailCellHeight;
    }

    function getDetailMonthDayProps(
        initialDate: string,
        renderedDate: string = initialDate
    ) {
        const monthKey = initialDate.slice(0, 7);
        const grid = renderer?.root.findByProps({
            testID: `detail-month-grid-${monthKey}`,
        });
        if (!grid) throw new Error(`${monthKey} detail grid was not rendered`);
        const cell = grid.findByProps({
            testID: `detail-month-cell-${monthKey}-${renderedDate}`,
        });
        const visualPage = renderer?.root.findAll((node) => (
            typeof node.props.testID === "string"
            && /^detail-month-page-/.test(node.props.testID)
            && node.props.animatedProps?.__mockFactory?.().pointerEvents
                === "auto"
        ))[0];
        const visualMonth = visualPage?.props.testID.match(
            /\d{4}-\d{2}$/
        )?.[0];
        const getMonthOrdinal = (month: string) => {
            const [year, monthNumber] = month.split("-").map(Number);
            return year * 12 + monthNumber - 1;
        };
        const relativePosition = visualMonth
            ? getMonthOrdinal(monthKey) - getMonthOrdinal(visualMonth)
            : 0;
        const selectionPosition = relativePosition === -1
            ? "previous"
            : relativePosition === 1
                ? "next"
                : "current";
        const selectionDay = renderer?.root.findByProps({
            testID: `detail-month-selection-day-${selectionPosition}`,
        });
        if (!selectionDay) {
            throw new Error("Current detail selection glyph was not rendered");
        }
        const animatedSelectedDayKey = {} as SharedValue<number>;
        Object.defineProperty(animatedSelectedDayKey, "value", {
            configurable: true,
            get: () => {
                const animatedProps = selectionDay.props.animatedProps as {
                    __mockFactory?: () => { text: string };
                    text?: string;
                };
                const text = animatedProps.__mockFactory?.().text
                    ?? animatedProps.text
                    ?? "0";
                return Number(monthKey.replace("-", "")) * 100
                    + Number(text);
            },
        });
        const cellStyle = typeof cell.props.style === "function"
            ? cell.props.style({ pressed: false })
            : cell.props.style;
        const flattenedCellStyle = StyleSheet.flatten(cellStyle);

        return {
            allowDisabledPress: true,
            animatedSelectedDayKey,
            detailCellHeight: flattenedCellStyle.height as number,
            isSelectedDay: Boolean(
                cell.props.accessibilityState?.selected
            ),
            onPress: (_day?: MockDateData) => cell.props.onPress(),
        };
    }

    function expectDetailMonthPageCellHeights() {
        expect(getDetailMonthPageCellHeight("2026-06-15")).toBe(
            DETAIL_MONTH_TEST_PAGE_LAYOUTS.previous.dayHeight
        );
        expect(getDetailMonthPageCellHeight("2026-07-15")).toBe(
            DETAIL_MONTH_TEST_PAGE_LAYOUTS.current.dayHeight
        );
        expect(getDetailMonthPageCellHeight("2026-08-15")).toBe(
            DETAIL_MONTH_TEST_PAGE_LAYOUTS.next.dayHeight
        );
    }

    function getDetailMonthGrid(month: string) {
        const grid = renderer?.root.findByProps({
            testID: `detail-month-grid-${month.slice(0, 7)}`,
        });
        if (!grid) throw new Error(`${month} detail grid was not rendered`);
        return grid;
    }

    type DetailMonthSelectionPosition = "previous" | "current" | "next";

    function getDetailMonthSelectionStyle(
        position: DetailMonthSelectionPosition
    ) {
        const overlay = renderer?.root.findByProps({
            testID: `detail-month-selection-${position}`,
        });
        if (!overlay) throw new Error(`${position} selection was not rendered`);
        const animatedStyle = overlay.props.style[2] as {
            __mockFactory?: () => {
                opacity: number;
                width: number;
                height: number;
                transform: [
                    { translateX: number },
                    { translateY: number },
                ];
            };
        };
        if (!animatedStyle.__mockFactory) {
            throw new Error("Selection animated style factory was not exposed");
        }
        return animatedStyle.__mockFactory();
    }

    function getDetailMonthSelectionText(
        position: DetailMonthSelectionPosition
    ) {
        const selection = renderer?.root.findByProps({
            testID: `detail-month-selection-day-${position}`,
        });
        if (!selection) {
            throw new Error(`${position} selection day was not rendered`);
        }
        const animatedProps = selection.props.animatedProps as {
            __mockFactory?: () => {
                text: string;
                accessibilityLabel: string;
                accessible: boolean;
                accessibilityElementsHidden: boolean;
                importantForAccessibility: "yes" | "no-hide-descendants";
            };
            text?: string;
        };
        return animatedProps.__mockFactory?.().text
            ?? animatedProps.text
            ?? "";
    }

    function getDetailMonthSelectionLunarText(
        position: DetailMonthSelectionPosition
    ) {
        const selection = renderer?.root.findByProps({
            testID: `detail-month-selection-lunar-${position}`,
        });
        if (!selection) {
            throw new Error(`${position} selection lunar text was not rendered`);
        }
        const animatedProps = selection.props.animatedProps as {
            __mockFactory?: () => { text: string };
            text?: string;
        };
        return animatedProps.__mockFactory?.().text
            ?? animatedProps.text
            ?? "";
    }

    function getDetailMonthSelectionTextStyle(
        position: DetailMonthSelectionPosition,
        lunar = false
    ) {
        const selection = renderer?.root.findByProps({
            testID: lunar
                ? `detail-month-selection-lunar-${position}`
                : `detail-month-selection-day-${position}`,
        });
        if (!selection) throw new Error(`${position} text was not rendered`);
        const animatedStyle = selection.props.style[2] as {
            __mockFactory?: () => {
                opacity?: number;
                width: number;
                height: number;
                fontSize: number;
                lineHeight: number;
            };
        };
        if (!animatedStyle.__mockFactory) {
            throw new Error("Selection text style factory was not exposed");
        }
        return animatedStyle.__mockFactory();
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

    function getDetailMonthTapGesture(): DetailMonthTapGestureMock {
        const detector = renderer?.root.findByProps({
            testID: "detail-month-pan-gesture",
        });
        if (!detector) throw new Error("Detail month gesture detector was not rendered");
        const gestures = detector.props.mockGestures as Array<{
            __mockCallbacks: DetailMonthTapGestureMock["callbacks"];
            __mockConfig: DetailMonthGestureConfig;
        }> | undefined;
        const tap = gestures?.find((gesture) => (
            gesture.__mockConfig.testID === "detail-month-tap-gesture"
        ));
        if (!tap) throw new Error("Detail month tap gesture was not rendered");
        return {
            callbacks: tap.__mockCallbacks,
            config: tap.__mockConfig,
        };
    }

    function tapDetailMonthAt(x: number, y: number) {
        const tap = getDetailMonthTapGesture();
        act(() => tap.callbacks.onEnd?.({
            x,
            y,
            absoluteX: x,
            absoluteY: y,
        }, true));
    }

    function getDetailMonthCellCenter(
        pageMonth: string,
        renderedDate: string
    ) {
        const [year, month] = pageMonth.split("-").map(Number);
        const [dateYear, dateMonth, date] = renderedDate
            .split("-").map(Number);
        const leadingDayCount = (
            new Date(year, month - 1, 1).getDay()
            - renderedFirstDay
            + 7
        ) % 7;
        const firstVisibleDate = Date.UTC(year, month - 1, 1)
            - leadingDayCount * 24 * 60 * 60 * 1_000;
        const targetDate = Date.UTC(dateYear, dateMonth - 1, date);
        const cellIndex = Math.round(
            (targetDate - firstVisibleDate) / (24 * 60 * 60 * 1_000)
        );
        const column = cellIndex % 7;
        const row = Math.floor(cellIndex / 7);
        const cellWidth = (
            DETAIL_MONTH_TEST_VIEWPORT_WIDTH - 12 * 2
        ) / 7;
        const cellHeight = getDetailMonthDayProps(
            `${pageMonth}-01`,
            renderedDate
        ).detailCellHeight;
        return {
            x: 12 + (column + 0.5) * cellWidth,
            y: 22 + (row + 0.5) * cellHeight,
            cellHeight,
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
        const page = findDetailMonthPage(testID);
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

    function getPagerPageInteractionProps(testIDOrMonth: string) {
        const page = findDetailMonthPage(testIDOrMonth);
        if (!page) {
            throw new Error(`${testIDOrMonth} pager page was not rendered`);
        }
        type PagerAnimatedProps = {
            __mockFactory?: () => {
                pointerEvents: "box-only" | "none";
                accessibilityElementsHidden: boolean;
                "aria-hidden": boolean;
                importantForAccessibility: "auto" | "no-hide-descendants";
            };
        };
        const animatedProps = page.props.animatedProps as PagerAnimatedProps;
        if (typeof animatedProps?.__mockFactory !== "function") {
            throw new Error("Pager animated props factory was not exposed");
        }
        return animatedProps.__mockFactory();
    }

    function findDetailMonthPage(testIDOrMonth: string) {
        const exact = renderer?.root.findAllByProps({
            testID: testIDOrMonth,
        })[0];
        if (exact) return exact;

        const month = testIDOrMonth.match(/\d{4}-\d{2}$/)?.[0];
        if (!month) return undefined;
        return renderer?.root.findAll((node) => {
            const testID = node.props.testID;
            return typeof testID === "string"
                && /^detail-month-page-/.test(testID)
                && testID.endsWith(month);
        })[0];
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

    function getMonthPresentationOffset(month: string) {
        const page = findDetailMonthPage(month);
        if (!page) throw new Error(`${month} pager page was not rendered`);

        const pageOffset = getPagerPageStyle(page.props.testID);
        const gestureOffset = getDetailMonthGestureLayerOffset();
        return {
            translateX: pageOffset.translateX + gestureOffset.translateX,
            translateY: pageOffset.translateY + gestureOffset.translateY,
        };
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

    function mockNextCallbackTimingPresentation(
        presentationOffset: number
    ) {
        const { withTiming } = getReanimatedMocks();
        const baseImplementation = withTiming.getMockImplementation();
        if (!baseImplementation) {
            throw new Error("withTiming mock implementation is missing");
        }
        let intercepted = false;
        withTiming.mockImplementation((
            target: number,
            config: unknown,
            callback?: (finished?: boolean) => void
        ) => {
            const result = baseImplementation(target, config, callback);
            if (!intercepted && callback) {
                intercepted = true;
                withTiming.mockImplementation(baseImplementation);
                return presentationOffset;
            }
            return result;
        });
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
        expect(mockCalendarInitialDates).toEqual([]);
        expect(renderer?.root.findByProps({
            testID: "detail-month-grid-2026-08",
        })).toBeDefined();
    });

    async function acknowledgeControlledMonth(
        targetDay: string,
        _settledEndpoint?: {
            translateX: number;
            translateY: number;
        }
    ) {
        await updateCalendar(targetDay);
        expect(pendingFrameCallbacks).toHaveLength(0);
        expect(getDetailMonthGestureLayerOffset()).toEqual({
            translateX: 0,
            translateY: 0,
        });
        expect(findDetailMonthPage(targetDay.slice(0, 7))).toBeDefined();
    }

    test("12월에서 왼쪽으로 넘기면 다음 해 1월을 한 번만 반영한다", async () => {
        await renderCalendar("2026-12-31");
        const calendar = getCalendarProps();
        const staleLibraryChangeMonth = jest.fn();

        act(() => calendar.onPressArrowRight(staleLibraryChangeMonth));

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

        await acknowledgeControlledMonth("2026-07-15");

        expect(onSelectDay.mock.calls.map(([day]) => day)).toEqual([
            "2026-08-15",
            "2026-07-15",
        ]);
    });

    test("programmatic shift 뒤 외부 월 이동은 이전 target을 재생하지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowRight(jest.fn()));
        await updateCalendar("2026-10-15");

        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
        expect(onSelectDay).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");
        expect(pendingFrameCallbacks).toHaveLength(0);
    });

    test("controlled props commit과 늦은 Calendar callback은 순환 shift를 중복시키지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowRight(jest.fn()));
        await acknowledgeControlledMonth("2026-08-15");
        expect(pendingFrameCallbacks).toHaveLength(0);
        expect(Animated.parallel).not.toHaveBeenCalled();
        expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledTimes(1);
    });

    test("pager endpoint는 React Calendar 교체 없이 UI 위치를 즉시 반영한다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        const { gesture } = startGesture();
        const swipe = panGestureEvent(-52, 2);
        mockCalendarInitialDates = [];

        updateGesture(gesture, swipe);
        endGesture(gesture, swipe);
        act(() => reanimated.__flushTimingCallbacks());
        expect(mockCalendarInitialDates).toEqual([]);
        expect(getPagerPageInteractionProps("2026-08")).toMatchObject({
            pointerEvents: "box-only",
            accessibilityElementsHidden: false,
            "aria-hidden": false,
            importantForAccessibility: "auto",
        });
        expect(getPagerPageInteractionProps("2026-07")).toMatchObject({
            pointerEvents: "none",
            accessibilityElementsHidden: true,
            "aria-hidden": true,
            importantForAccessibility: "no-hide-descendants",
        });
        expect(pendingFrameCallbacks).toHaveLength(0);
        expect(getDetailMonthGestureLayerOffset()).toEqual({
            translateX: 0,
            translateY: 0,
        });
        reanimated.__setTimingCallbacksDeferred(false);
    });

    test("stable detail pager는 Calendar와 CustomDay 없이 53개의 고정 42-cell grid를 mount한다", async () => {
        await renderCalendar("2026-07-15");

        expect(mockCalendarInitialDates).toEqual([]);
        expect(mockCustomDayRenderCount).toBe(0);
        const grids = renderer?.root.findAll((node) => (
            (node.type as unknown) === "View"
            && typeof node.props.testID === "string"
            && /^detail-month-grid-\d{4}-\d{2}$/.test(node.props.testID)
        )) ?? [];
        expect(grids).toHaveLength(53);
        grids.forEach((grid) => {
            const month = grid.props.testID.slice(-7);
            const cells = grid.findAll((node) => (
                typeof node.props.style === "function"
                && typeof node.props.testID === "string"
                && node.props.testID.startsWith(
                    `detail-month-cell-${month}-`
                )
            ));
            expect(cells).toHaveLength(42);
        });
    });

    test("stable pager는 Pan 우선 Exclusive Tap으로 물리 날짜 입력을 독점한다", async () => {
        await renderCalendar("2026-07-15");

        const detector = renderer?.root.findByProps({
            testID: "detail-month-pan-gesture",
        });
        expect(detector?.props.mockGestureComposition).toBe("exclusive");
        expect(detector?.props.mockGestures.map((gesture: {
            __mockConfig: DetailMonthGestureConfig;
        }) => gesture.__mockConfig.testID)).toEqual([
            "detail-month-pan-gesture",
            "detail-month-tap-gesture",
        ]);
        expect(getPagerPageInteractionProps("2026-07")).toMatchObject({
            pointerEvents: "box-only",
            accessibilityElementsHidden: false,
        });
        expect(getPagerPageInteractionProps("2026-06")).toMatchObject({
            pointerEvents: "none",
            accessibilityElementsHidden: true,
        });
        expect(getDetailMonthTapGesture().config.maxDistance).toBe(
            DETAIL_MONTH_SWIPE_GESTURE.activationDistance
        );
    });

    test("parent Tap 좌표는 current day와 leading overflow day를 정확히 해석한다", async () => {
        renderedOnCommitDetailMonth = jest.fn();
        await renderCalendar("2026-07-15");

        const july20 = getDetailMonthCellCenter("2026-07", "2026-07-20");
        tapDetailMonthAt(july20.x, july20.y);

        expect(getDetailMonthSelectionText("current")).toBe("20");
        expect(renderedOnCommitDetailMonth).toHaveBeenLastCalledWith(
            "2026-07-20"
        );

        renderedOnCommitDetailMonth.mockClear();
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        try {
            const june30 = getDetailMonthCellCenter(
                "2026-07",
                "2026-06-30"
            );
            tapDetailMonthAt(june30.x, june30.y);

            expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
                "2026-06-30"
            );
            expect(getDetailMonthGestureLayerOffset().translateY)
                .toBeGreaterThan(0);
            expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("overflow day 전환은 ACK rebase 뒤 target month를 원점에 유지한다", async () => {
        renderedOnCommitDetailMonth = jest.fn();
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        try {
            await renderCalendar("2026-07-31");
            const august1 = getDetailMonthCellCenter(
                "2026-07",
                "2026-08-01"
            );

            tapDetailMonthAt(august1.x, august1.y);
            expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
                "2026-08-01"
            );
            expect(getMonthPresentationOffset("2026-08")).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();

            act(() => reanimated.__flushTimingCallbacks());
            reanimated.__setTimingCallbacksDeferred(false);
            expect(pendingFrameCallbacks).toHaveLength(1);
            flushNextFrame();
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(1);
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledWith(
                "2026-08-01"
            );

            await updateCalendar("2026-08-01");
            expect(pendingFrameCallbacks).toHaveLength(1);
            flushNextFrame();
            expect(pendingFrameCallbacks).toHaveLength(1);
            flushNextFrame();

            expect(getMonthPresentationOffset("2026-08")).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(getMonthPresentationOffset("2026-07").translateX)
                .toBeLessThan(0);
            expect(getPagerPageInteractionProps("2026-08"))
                .toMatchObject({ pointerEvents: "box-only" });
            expect(getDetailMonthSelectionText("current")).toBe("1");
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("focused month가 selection보다 앞서도 UI shifted day가 stale JS anchor를 이긴다", async () => {
        jest.useFakeTimers();
        renderedOnCommitDetailMonth = jest.fn();
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        reanimated.__setRunOnJSCallbacksDeferred(true);
        try {
            await renderCalendar(
                "2026-07-31",
                false,
                "detail",
                null,
                "2026-08-01"
            );
            expect(getDetailMonthSelectionText("current")).toBe("31");

            const swipeUp = panGestureEvent(0, -52);
            const { gesture } = startGesture();
            updateGesture(gesture, swipeUp);
            endGesture(gesture, swipeUp);
            expect(getDetailMonthSelectionText("current")).toBe("30");

            act(() => reanimated.__flushTimingCallbacks());
            expect(getMonthPresentationOffset("2026-09")).toEqual({
                translateX: 0,
                translateY: 0,
            });
            act(() => reanimated.__flushRunOnJSCallbacks());
            expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
                "2026-09-30"
            );

            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs
                );
            });
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(1);
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledWith(
                "2026-09-30"
            );
        } finally {
            reanimated.__setRunOnJSCallbacksDeferred(false);
            reanimated.__setTimingCallbacksDeferred(false);
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    test("parent Tap은 grid padding과 hidden row 좌표를 무시한다", async () => {
        renderedOnCommitDetailMonth = jest.fn();
        const heightFixture = createDetailMonthHeightFixture(
            WEEK_COUNT_TEST_PAGE_LAYOUTS
        );
        await renderCalendar(
            "2026-02-15",
            false,
            "detail",
            heightFixture,
            "2026-02-15",
            1
        );
        const february15 = getDetailMonthCellCenter(
            "2026-02",
            "2026-02-15"
        );

        tapDetailMonthAt(6, february15.y);
        tapDetailMonthAt(
            february15.x,
            22 + 5.5 * february15.cellHeight
        );

        expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
        expect(getDetailMonthSelectionText("current")).toBe("15");
    });

    test("box-only page 안의 Pressable은 접근성 activation으로 계속 날짜를 선택한다", async () => {
        renderedOnCommitDetailMonth = jest.fn();
        await renderCalendar("2026-07-15");
        const july20Cell = renderer?.root.findByProps({
            testID: "detail-month-cell-2026-07-2026-07-20",
        });

        expect(july20Cell?.props).toMatchObject({
            accessibilityRole: "button",
            accessibilityState: { disabled: false },
        });
        expect(july20Cell?.props.accessibilityLabel).toContain(
            "2026년 7월 20일"
        );
        act(() => july20Cell?.props.onPress());

        expect(renderedOnCommitDetailMonth).toHaveBeenCalledWith(
            "2026-07-20"
        );
        expect(getDetailMonthSelectionText("current")).toBe("20");
    });

    test("4·5·6주 grid는 42-cell model을 유지하면서 남는 row의 터치와 접근성을 제거한다", async () => {
        const heightFixture = createDetailMonthHeightFixture(
            WEEK_COUNT_TEST_PAGE_LAYOUTS
        );
        await renderCalendar(
            "2026-10-01",
            false,
            "detail",
            heightFixture
        );

        ([
            { month: "2026-02", weekCount: 4 },
            { month: "2026-07", weekCount: 5 },
            { month: "2026-08", weekCount: 6 },
        ] as const).forEach(({ month, weekCount }) => {
            const grid = getDetailMonthGrid(month);
            expect(grid.props.accessible).toBe(false);
            expect(grid.findByProps({
                testID: `detail-month-adjuster-${month}`,
            }).props).toMatchObject({
                accessible: true,
                accessibilityRole: "adjustable",
            });
            const rows = Array.from({ length: 6 }, (_, rowIndex) => (
                grid.findByProps({
                    testID: `detail-month-grid-row-${month}-${rowIndex}`,
                })
            ));
            const cells = grid.findAll((node) => (
                typeof node.props.style === "function"
                && typeof node.props.testID === "string"
                && node.props.testID.startsWith(
                    `detail-month-cell-${month}-`
                )
            ));
            expect(cells).toHaveLength(42);
            rows.forEach((row, rowIndex) => {
                const hidden = rowIndex >= weekCount;
                expect(StyleSheet.flatten(row.props.style).display).toBe(
                    hidden ? "none" : undefined
                );
                expect(row.props.pointerEvents).toBe(
                    hidden ? "none" : "auto"
                );
                expect(row.props.accessibilityElementsHidden).toBe(hidden);
                expect(row.props.importantForAccessibility).toBe(
                    hidden ? "no-hide-descendants" : "auto"
                );
            });

            const gridStyle = StyleSheet.flatten(grid.props.style);
            const rowHeight = StyleSheet.flatten(rows[0].props.style).height;
            expect(
                gridStyle.paddingTop
                + weekCount * rowHeight
                + gridStyle.paddingBottom
            ).toBe(22 + weekCount * rowHeight + 4);
        });
    });

    test("Monday-first 5주 grid는 앞달 날짜부터 채우고 extra day를 흐리지만 누를 수 있다", async () => {
        const heightFixture = createDetailMonthHeightFixture(
            WEEK_COUNT_TEST_PAGE_LAYOUTS
        );
        await renderCalendar(
            "2026-02-15",
            false,
            "detail",
            heightFixture,
            "2026-02-15",
            1
        );

        const grid = getDetailMonthGrid("2026-02");
        const firstExtraCell = grid.findByProps({
            testID: "detail-month-cell-2026-02-2026-01-26",
        });
        const dateText = firstExtraCell.findAllByType(Text)[0];
        expect(StyleSheet.flatten(dateText.props.style).opacity).toBe(0.28);
        expect(firstExtraCell.props.accessibilityState.disabled).toBe(false);
        expect(StyleSheet.flatten(grid.findByProps({
            testID: "detail-month-grid-row-2026-02-4",
        }).props.style).display).toBeUndefined();
        expect(StyleSheet.flatten(grid.findByProps({
            testID: "detail-month-grid-row-2026-02-5",
        }).props.style).display).toBe("none");
    });

    test("전역 3-glyph selection은 31일을 순차 월말 보정하고 현재 날짜 접근성을 즉시 갱신한다", async () => {
        onRegisterDetailMonthMotionShift = jest.fn();
        await renderCalendar("2026-01-31");
        const registeredShift =
            onRegisterDetailMonthMotionShift.mock.calls[0]?.[0];
        expect(registeredShift).toEqual(expect.any(Function));
        expect(renderer?.root.findAll((node) => (
            (node.type as unknown) === "View"
            && /^detail-month-selection-(previous|current|next)$/.test(
                node.props.testID ?? ""
            )
        ))).toHaveLength(3);
        expect(renderer?.root.findAll((node) => (
            (node.type as unknown) === "TextInput"
            && /^detail-month-selection-day-(previous|current|next)$/.test(
                node.props.testID ?? ""
            )
        ))).toHaveLength(3);
        expect(renderer?.root.findAll((node) => (
            (node.type as unknown) === "TextInput"
            && /^detail-month-selection-lunar-(previous|current|next)$/.test(
                node.props.testID ?? ""
            )
        ))).toHaveLength(3);
        const selectedAccessibilityGlyphs = renderer?.root.findAll((node) => (
            (node.type as unknown) === "TextInput"
            && node.props.accessibilityState?.selected === true
        )) ?? [];
        expect(selectedAccessibilityGlyphs).toHaveLength(1);
        expect(selectedAccessibilityGlyphs[0].props.testID).toBe(
            "detail-month-selection-day-current"
        );
        expect(renderer?.root.findAll((node) => (
            /^detail-month-cell-/.test(node.props.testID ?? "")
            && node.props.accessibilityState?.selected === true
        ))).toHaveLength(0);
        expect(getDetailMonthSelectionText("current")).toBe("31");
        expect(getDetailMonthSelectionText("next")).toBe("28");

        act(() => registeredShift(1));
        expect(getDetailMonthSelectionText("current")).toBe("28");
        expect(getDetailMonthSelectionText("next")).toBe("28");
        const februarySelectionProps = renderer?.root.findByProps({
            testID: "detail-month-selection-day-current",
        }).props.animatedProps.__mockFactory();
        expect(februarySelectionProps).toMatchObject({
            accessibilityLabel: "2026년 2월 28일, 선택됨",
            accessible: true,
            accessibilityElementsHidden: false,
            importantForAccessibility: "yes",
        });

        act(() => registeredShift(1));
        expect(getDetailMonthSelectionText("current")).toBe("28");
        expect(onSelectDay).toHaveBeenLastCalledWith("2026-03-28");
    });

    test("전역 selection glyph는 pager와 함께 가로·세로 인접 월 좌표를 바꾼다", async () => {
        const heightFixture = createDetailMonthHeightFixture();
        await renderCalendar("2026-07-15", false, "detail", heightFixture);

        const horizontalCurrent = getDetailMonthSelectionStyle("current");
        const horizontalNext = getDetailMonthSelectionStyle("next");
        expect(
            horizontalNext.transform[0].translateX
            - horizontalCurrent.transform[0].translateX
        ).toBeGreaterThan(200);

        const { gesture } = startGesture();
        updateGesture(gesture, panGestureEvent(0, -52));

        const verticalCurrent = getDetailMonthSelectionStyle("current");
        const verticalNext = getDetailMonthSelectionStyle("next");
        expect(Math.abs(
            verticalNext.transform[0].translateX
            - verticalCurrent.transform[0].translateX
        )).toBeLessThan(Math.abs(
            horizontalNext.transform[0].translateX
            - horizontalCurrent.transform[0].translateX
        ));
        expect(
            verticalNext.transform[1].translateY
            - verticalCurrent.transform[1].translateY
        ).toBeGreaterThan(100);

        cancelGesture(gesture);
    });

    test("전역 selection은 고정 pager 끝에서 범위 밖 glyph를 숨긴다", async () => {
        onRegisterDetailMonthMotionShift = jest.fn();
        await renderCalendar("2026-07-15");
        const registeredShift =
            onRegisterDetailMonthMotionShift.mock.calls[0]?.[0];
        expect(registeredShift).toEqual(expect.any(Function));

        Array.from({ length: 26 }).forEach(() => {
            act(() => registeredShift(1));
        });
        expect(getDetailMonthSelectionStyle("current").opacity).toBe(1);
        expect(getDetailMonthSelectionStyle("next").opacity).toBe(0);
        expect(getDetailMonthSelectionText("next")).toBe("");

        const previewCountAtEdge = onDetailMonthPreview.mock.calls.length;
        act(() => registeredShift(1));
        expect(onDetailMonthPreview).toHaveBeenCalledTimes(
            previewCountAtEdge
        );
        expect(getDetailMonthSelectionText("next")).toBe("");
    });

    test.each([
        ["light", "#2979FF"],
        ["dark", "#4B9DFF"],
    ] as const)("오늘 선택은 overlay를 숨기고 %s 모드 NoLate 파란 원형을 유지한다", async (mode, expectedColor) => {
        mockThemeMode = mode;
        const now = new Date();
        const today = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0"),
        ].join("-");
        await renderCalendar(today);
        const month = today.slice(0, 7);

        expect(getDetailMonthSelectionStyle("current").opacity).toBe(0);
        const todaySelectionProps = renderer?.root.findByProps({
            testID: "detail-month-selection-day-current",
        }).props.animatedProps.__mockFactory();
        expect(todaySelectionProps).toMatchObject({
            accessibilityLabel: expect.stringContaining(
                `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일, 선택됨, 오늘`
            ),
            accessible: true,
        });
        const cell = getDetailMonthGrid(month).findByProps({
            testID: `detail-month-cell-${month}-${today}`,
        });
        expect(cell.props.accessibilityState.selected).toBeUndefined();
        expect(cell.props.accessibilityLabel).not.toContain("선택됨");
        const circle = cell.findByProps({ testID: "calendar-day-circle" });
        expect(StyleSheet.flatten(circle.props.style).backgroundColor).toBe(
            expectedColor
        );
    });

    test("detail grid는 음력·공휴일과 정렬된 일정 marker/overflow를 유지한다", async () => {
        renderedCalendarDaysByDate = {
            "2026-07-20": {
                date: "2026-07-20",
                lunarMonth: 6,
                lunarDay: 7,
                holidays: [{ name: "테스트 공휴일", type: "PUBLIC" }],
            },
        };
        renderedItems = Array.from({ length: 4 }, (_, index) => ({
            id: `event-${index}`,
            title: `일정 ${index}`,
            startAt: `2026-07-20T${String(9 + index).padStart(2, "0")}:00:00`,
            endAt: `2026-07-20T${String(10 + index).padStart(2, "0")}:00:00`,
            travelMode: index === 0 ? "TRANSIT" as const : undefined,
            category: {
                id: "category",
                title: "기본",
                color: `#00000${index}`,
            },
        }));
        await renderCalendar("2026-07-20");

        const cell = getDetailMonthGrid("2026-07").findByProps({
            testID: "detail-month-cell-2026-07-2026-07-20",
        });
        expect(cell.findByProps({ testID: "calendar-lunar-date" })
            .props.children).toBe("음 6.7");
        expect(cell.findByProps({ testID: "calendar-holiday-name" })
            .props.children).toBe("테스트 공휴일");
        expect(cell.findByProps({ testID: "detail-event-markers" }))
            .toBeDefined();
        expect(cell.findByProps({ testID: "detail-event-overflow" })
            .props.children.join("")).toBe("+1개");
        expect(getDetailMonthSelectionText("current")).toBe("20");
        expect(getDetailMonthSelectionLunarText("current")).toBe("음 6.7");

        const grid = getDetailMonthGrid("2026-07");
        const currentPage = findDetailMonthPage("2026-07");
        const selectionGlyph = renderer?.root.findByProps({
            testID: "detail-month-selection-current",
        });
        const selectionDay = renderer?.root.findByProps({
            testID: "detail-month-selection-day-current",
        });
        const selectionLunar = renderer?.root.findByProps({
            testID: "detail-month-selection-lunar-current",
        });
        const gestureLayer = renderer?.root.findByProps({
            testID: "detail-month-gesture-layer",
        });
        const orderedTestIDs = gestureLayer?.findAll((node) => (
            typeof node.props.testID === "string"
        )).map((node) => node.props.testID) ?? [];
        const glyphStyle = getDetailMonthSelectionStyle("current");
        const dayStyle = getDetailMonthSelectionTextStyle("current");
        const lunarStyle = getDetailMonthSelectionTextStyle("current", true);
        expect(StyleSheet.flatten(grid.props.style).backgroundColor)
            .toBeUndefined();
        expect(StyleSheet.flatten(currentPage?.props.style).zIndex).toBe(1);
        expect(StyleSheet.flatten(selectionGlyph?.props.style)).toMatchObject({
            zIndex: 2,
            backgroundColor: "#000000",
            alignItems: "center",
            justifyContent: "center",
        });
        expect(orderedTestIDs.lastIndexOf(
            "detail-month-selection-current"
        )).toBeGreaterThan(orderedTestIDs.lastIndexOf(
            currentPage?.props.testID
        ));
        expect(StyleSheet.flatten(selectionDay?.props.style).color).toBe(
            "#ffffff"
        );
        expect(StyleSheet.flatten(selectionLunar?.props.style).color).toBe(
            "#ffffff"
        );
        expect(dayStyle.height).toBeGreaterThan(lunarStyle.height);
        expect(dayStyle.height + lunarStyle.height).toBeLessThanOrEqual(
            glyphStyle.height
        );
        expect(dayStyle.width).toBe(glyphStyle.width);
        expect(lunarStyle.width).toBeLessThanOrEqual(glyphStyle.width);
        expect(selectionDay?.props.animatedProps.__mockFactory())
            .toMatchObject({
                accessibilityLabel:
                    "2026년 7월 20일, 선택됨, 음 6.7",
                accessible: true,
            });
    });

    test("가로·세로 pager grid는 월별 고정 detail cell height를 사용한다", async () => {
        const heightFixture = createDetailMonthHeightFixture();
        await renderCalendar("2026-07-15", false, "detail", heightFixture);

        expectDetailMonthPageCellHeights();
    });

    test("같은 달의 날짜 선택은 grid를 다시 렌더하지 않고 current glyph 접근성만 갱신한다", async () => {
        const heightFixture = createDetailMonthHeightFixture();
        await renderCalendar("2026-07-15", false, "detail", heightFixture);
        const initialDates = [
            "2026-05-15",
            "2026-06-15",
            "2026-07-15",
            "2026-08-15",
            "2026-09-15",
        ];
        const previousGridProps = initialDates.map((initialDate) => (
            renderer?.root.findByProps({
                testID: `detail-month-grid-${initialDate.slice(0, 7)}`,
            }).props
        ));
        expect(getDetailMonthDayProps(
            "2026-07-15"
        ).isSelectedDay).toBe(false);
        expect(getDetailMonthDayProps(
            "2026-07-15",
            "2026-07-20"
        ).isSelectedDay).toBe(false);
        expect(getDetailMonthSelectionText("current")).toBe("15");
        mockCalendarInitialDates = [];

        await updateCalendar("2026-07-20", {
            focusedMonth: "2026-07-20",
        });

        expect(mockCalendarInitialDates).toEqual([]);
        expect(getDetailMonthDayProps(
            "2026-07-15"
        ).isSelectedDay).toBe(false);
        expect(getDetailMonthDayProps(
            "2026-07-15",
            "2026-07-20"
        ).isSelectedDay).toBe(false);
        expect(getDetailMonthSelectionText("current")).toBe("20");
        expect(renderer?.root.findByProps({
            testID: "detail-month-selection-day-current",
        }).props.animatedProps.__mockFactory()).toMatchObject({
            accessibilityLabel: "2026년 7월 20일, 선택됨",
            accessible: true,
        });
        initialDates.forEach((initialDate, index) => {
            const nextGridProps = renderer?.root.findByProps({
                testID: `detail-month-grid-${initialDate.slice(0, 7)}`,
            }).props;
            expect(nextGridProps).toBe(previousGridProps[index]);
        });
        expectDetailMonthPageCellHeights();
    });

    test("외부 same-month 선택 뒤 다음 swipe는 새 일자를 유지한다", async () => {
        onRegisterDetailMonthMotionShift = jest.fn();
        await renderCalendar("2026-07-15");
        const registeredShift =
            onRegisterDetailMonthMotionShift.mock.calls[0]?.[0];
        expect(registeredShift).toEqual(expect.any(Function));

        await updateCalendar("2026-07-20", {
            focusedMonth: "2026-07-20",
        });
        act(() => registeredShift(1));

        expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
            "2026-08-20"
        );
        expect(onSelectDay).toHaveBeenLastCalledWith("2026-08-20");
        expect(
            getDetailMonthDayProps(
                "2026-08-15",
                "2026-08-20"
            ).animatedSelectedDayKey?.value
        ).toBe(20260820);
    });

    test("24회 순방향·역방향 burst는 Calendar를 다시 render하지 않고 선택을 즉시 따라간다", async () => {
        jest.useFakeTimers();
        renderedOnCommitDetailMonth = jest.fn();
        onRegisterDetailMonthMotionShift = jest.fn();
        try {
            await renderCalendar("2026-07-15");
            const registeredShift =
                onRegisterDetailMonthMotionShift.mock.calls[0]?.[0];
            expect(registeredShift).toEqual(expect.any(Function));
            mockCalendarInitialDates = [];
            const gridPropsBeforeBurst = (renderer?.root.findAll((node) => (
                (node.type as unknown) === "View"
                && typeof node.props.testID === "string"
                && /^detail-month-grid-\d{4}-\d{2}$/.test(
                    node.props.testID
                )
            )) ?? []).map((grid) => grid.props);

            const forwardDays = Array.from(
                { length: 24 },
                (_, index) => shiftCalendarMonth("2026-07-15", index + 1)
            );
            forwardDays.forEach((expectedDay) => {
                act(() => registeredShift(1));
                expect(
                    getDetailMonthDayProps(expectedDay)
                        .animatedSelectedDayKey?.value
                ).toBe(Number(expectedDay.replaceAll("-", "")));
                expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
            });

            const backwardDays = Array.from(
                { length: 24 },
                (_, index) => shiftCalendarMonth("2026-07-15", 23 - index)
            );
            backwardDays.forEach((expectedDay) => {
                act(() => registeredShift(-1));
                expect(
                    getDetailMonthDayProps(expectedDay)
                        .animatedSelectedDayKey?.value
                ).toBe(Number(expectedDay.replaceAll("-", "")));
                expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
            });

            // A settle must only rotate UI-thread presentation state. React
            // grid pages stay mounted and untouched for the whole burst.
            expect(mockCalendarInitialDates).toEqual([]);
            const gridPropsAfterBurst = (renderer?.root.findAll((node) => (
                (node.type as unknown) === "View"
                && typeof node.props.testID === "string"
                && /^detail-month-grid-\d{4}-\d{2}$/.test(
                    node.props.testID
                )
            )) ?? []).map((grid) => grid.props);
            expect(gridPropsAfterBurst).toHaveLength(53);
            gridPropsAfterBurst.forEach((props, index) => {
                expect(props).toBe(gridPropsBeforeBurst[index]);
            });
            expect(getMonthPresentationOffset("2026-07")).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(
                getDetailMonthDayProps("2026-07-15")
                    .animatedSelectedDayKey?.value
            ).toBe(20260715);

            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs - 1
                );
            });
            expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
            act(() => jest.advanceTimersByTime(1));
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(1);
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledWith(
                "2026-07-15"
            );
        } finally {
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    test("focused month가 selected day와 달라도 month metadata로 5-slot layout을 정확히 매핑한다", async () => {
        const heightFixture = createDetailMonthHeightFixture(
            FOCUSED_MONTH_TEST_PAGE_LAYOUTS
        );
        await renderCalendar(
            "2026-07-31",
            false,
            "detail",
            heightFixture,
            "2026-10-01"
        );

        expect(mockCalendarInitialDates).toEqual([]);
        ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]
            .forEach((month) => {
                expect(renderer?.root.findByProps({
                    testID: `detail-month-grid-${month}`,
                })).toBeDefined();
            });
        expect(getDetailMonthPageCellHeight("2026-09-01")).toBe(
            FOCUSED_MONTH_TEST_PAGE_LAYOUTS.previous.dayHeight
        );
        expect(getDetailMonthPageCellHeight("2026-10-01")).toBe(
            FOCUSED_MONTH_TEST_PAGE_LAYOUTS.current.dayHeight
        );
        expect(getDetailMonthPageCellHeight("2026-11-01")).toBe(
            FOCUSED_MONTH_TEST_PAGE_LAYOUTS.next.dayHeight
        );
    });

    test("month metadata가 없는 legacy layout도 focused initialDate 중심으로 매핑한다", async () => {
        const heightFixture = createDetailMonthHeightFixture(
            DETAIL_MONTH_TEST_PAGE_LAYOUTS
        );
        await renderCalendar(
            "2026-07-31",
            false,
            "detail",
            heightFixture,
            "2026-10-01"
        );

        expect(getDetailMonthPageCellHeight("2026-09-01")).toBe(
            DETAIL_MONTH_TEST_PAGE_LAYOUTS.previous.dayHeight
        );
        expect(getDetailMonthPageCellHeight("2026-10-01")).toBe(
            DETAIL_MONTH_TEST_PAGE_LAYOUTS.current.dayHeight
        );
        expect(getDetailMonthPageCellHeight("2026-11-01")).toBe(
            DETAIL_MONTH_TEST_PAGE_LAYOUTS.next.dayHeight
        );
    });

    test("±2 밖 4·5·6주 월도 week-count layout으로 안정적으로 매핑한다", async () => {
        const heightFixture = createDetailMonthHeightFixture(
            WEEK_COUNT_TEST_PAGE_LAYOUTS
        );
        await renderCalendar(
            "2026-10-01",
            false,
            "detail",
            heightFixture,
            "2026-10-01"
        );

        // 2026-02 is a four-week Sunday-first month and sits eight months
        // before the controlled anchor, well outside the parent's legacy ±2 map.
        expect(getDetailMonthPageCellHeight("2026-02-01")).toBe(
            WEEK_COUNT_TEST_PAGE_LAYOUTS.byWeekCount?.[4]?.dayHeight
        );
        expect(getDetailMonthPageCellHeight("2026-07-01")).toBe(
            WEEK_COUNT_TEST_PAGE_LAYOUTS.byWeekCount?.[5]?.dayHeight
        );
        expect(getDetailMonthPageCellHeight("2026-08-01")).toBe(
            WEEK_COUNT_TEST_PAGE_LAYOUTS.byWeekCount?.[6]?.dayHeight
        );
        expect(getDetailMonthPageCellHeight("2026-10-01")).toBe(
            WEEK_COUNT_TEST_PAGE_LAYOUTS.byWeekCount?.[5]?.dayHeight
        );
    });

    test.each([
        {
            label: "위",
            translationY: -DETAIL_MONTH_TEST_VIEWPORT_HEIGHT / 2,
            targetLayout: DETAIL_MONTH_TEST_PAGE_LAYOUTS.next,
        },
        {
            label: "아래",
            translationY: DETAIL_MONTH_TEST_VIEWPORT_HEIGHT / 2,
            targetLayout: DETAIL_MONTH_TEST_PAGE_LAYOUTS.previous,
        },
    ])(
        "세로 $label 50% drag는 page cell geometry를 고정하고 outer height만 보간한다",
        async ({ translationY, targetLayout }) => {
            const heightFixture = createDetailMonthHeightFixture();
            await renderCalendar("2026-07-15", false, "detail", heightFixture);
            const { gesture } = startGesture();

            updateGesture(
                gesture,
                panGestureEvent(0, translationY)
            );

            const sourceHeight =
                DETAIL_MONTH_TEST_PAGE_LAYOUTS.current.calendarHeight;
            const pageDistance = translationY > 0
                ? DETAIL_MONTH_TEST_PAGE_LAYOUTS.previous.calendarHeight
                : DETAIL_MONTH_TEST_VIEWPORT_HEIGHT;
            const progress = Math.min(
                1,
                Math.abs(translationY) / pageDistance
            );
            expect(heightFixture.animatedCalendarHeight.value).toBeCloseTo(
                sourceHeight
                    + (
                        targetLayout.calendarHeight - sourceHeight
                    ) * progress
            );
            expect(heightFixture.motionActive.value).toBe(true);
            expectDetailMonthPageCellHeights();
        }
    );

    test.each([
        {
            label: "위",
            translationY: -DETAIL_MONTH_TEST_VIEWPORT_HEIGHT / 2,
        },
        {
            label: "아래",
            translationY: DETAIL_MONTH_TEST_VIEWPORT_HEIGHT / 2,
        },
    ])(
        "세로 $label drag cancel은 outer height를 source로 복구한다",
        async ({ translationY }) => {
            const heightFixture = createDetailMonthHeightFixture();
            await renderCalendar("2026-07-15", false, "detail", heightFixture);
            const { gesture } = startGesture();

            updateGesture(
                gesture,
                panGestureEvent(0, translationY)
            );
            cancelGesture(gesture);

            expect(heightFixture.animatedCalendarHeight.value).toBe(
                DETAIL_MONTH_TEST_PAGE_LAYOUTS.current.calendarHeight
            );
            expect(heightFixture.motionActive.value).toBe(false);
            expectDetailMonthPageCellHeights();
        }
    );

    test.each([
        {
            label: "위",
            event: panGestureEvent(
                0,
                -DETAIL_MONTH_TEST_VIEWPORT_HEIGHT / 2
            ),
            targetLayout: DETAIL_MONTH_TEST_PAGE_LAYOUTS.next,
        },
        {
            label: "아래",
            event: panGestureEvent(
                0,
                DETAIL_MONTH_TEST_VIEWPORT_HEIGHT / 2
            ),
            targetLayout: DETAIL_MONTH_TEST_PAGE_LAYOUTS.previous,
        },
    ])(
        "세로 $label release settle은 outer height를 target으로 마무리한다",
        async ({ event, targetLayout }) => {
            const heightFixture = createDetailMonthHeightFixture();
            await renderCalendar("2026-07-15", false, "detail", heightFixture);
            const { gesture } = startGesture();

            updateGesture(gesture, event);
            endGesture(gesture, event);

            expect(heightFixture.animatedCalendarHeight.value).toBe(
                targetLayout.calendarHeight
            );
            expectDetailMonthPageCellHeights();
        }
    );

    test.each([
        {
            label: "위",
            event: panGestureEvent(0, -170),
            adjacentPageTestID: "detail-month-page-next-2026-08",
            adjacentOffset: 340,
            settleOffset: -340,
            targetLayout: DETAIL_MONTH_TEST_PAGE_LAYOUTS.next,
        },
        {
            label: "아래",
            event: panGestureEvent(0, 140),
            adjacentPageTestID: "detail-month-page-previous-2026-06",
            adjacentOffset: -280,
            settleOffset: 280,
            targetLayout: DETAIL_MONTH_TEST_PAGE_LAYOUTS.previous,
        },
    ])(
        "세로 $label pager는 sticky header를 제외한 인접 page 높이를 사용한다",
        async ({
            event,
            adjacentPageTestID,
            adjacentOffset,
            settleOffset,
            targetLayout,
        }) => {
            renderedHeaderOffset = 80;
            const heightFixture = createDetailMonthHeightFixture();
            await renderCalendar(
                "2026-07-15",
                false,
                "detail",
                heightFixture
            );
            const reanimated = getReanimatedMocks();
            const { gesture } = startGesture();

            updateGesture(gesture, event);
            expect(getPagerPageStyle(adjacentPageTestID).translateY).toBe(
                adjacentOffset
            );
            expect(heightFixture.animatedCalendarHeight.value).toBeCloseTo(
                (
                    DETAIL_MONTH_TEST_PAGE_LAYOUTS.current.calendarHeight
                    + targetLayout.calendarHeight
                ) / 2
            );

            const callsBeforeEnd = reanimated.withTiming.mock.calls.length;
            endGesture(gesture, event);
            const pageDistance = Math.abs(settleOffset);
            const settleCall = reanimated.withTiming.mock.calls
                .slice(callsBeforeEnd)
                .find(([target]) => target === settleOffset);
            expect(settleCall?.[1]).toMatchObject({
                duration: getDetailMonthSwipeSettleDuration(
                    pageDistance / 2,
                    0,
                    pageDistance
                ),
            });
        }
    );

    test.each([
        {
            label: "왼쪽",
            event: panGestureEvent(-52, 2),
            targetDay: "2026-08-15",
            adjacentPageTestID: "detail-month-page-next-2026-08",
            adjacentPageOffset: DETAIL_MONTH_TEST_VIEWPORT_WIDTH,
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
            adjacentPageTestID: "detail-month-page-previous-2026-06",
            adjacentPageOffset: -DETAIL_MONTH_TEST_VIEWPORT_WIDTH,
            pages: [
                "2026-06-15",
                "2026-05-15",
                "2026-07-15",
            ],
        },
    ])(
        "상세형 $label 드래그는 불투명한 가로 pager를 따라가고 settle 뒤 한 번만 commit한다",
        async ({
            event,
            targetDay,
            adjacentPageTestID,
            adjacentPageOffset,
            pages,
        }) => {
            await renderCalendar("2026-07-15");
            const reanimated = getReanimatedMocks();
            reanimated.__setTimingCallbacksDeferred(true);
            const calendar = getCalendarProps();
            try {
                const { gesture } = startGesture();

                expect(calendar.enableSwipeMonths).toBe(false);
                expect(gesture.config).toMatchObject({
                    enabled: true,
                    minDistance: DETAIL_MONTH_SWIPE_GESTURE.activationDistance,
                    maxPointers: 1,
                    cancelsTouchesInView: true,
                });

                updateGesture(gesture, event);
                expect(getDetailMonthGestureLayerOffset()).toEqual({
                    translateX: event.translationX,
                    translateY: 0,
                });
                expect(getDetailMonthGestureLayerOpacity()).toBe(1);
                expect(getPagerPageStyle(
                    "detail-month-page-current-2026-07"
                ).opacity).toBe(1);
                expect(getPagerPageStyle(adjacentPageTestID)).toMatchObject({
                    opacity: 1,
                    translateX: adjacentPageOffset,
                    translateY: 0,
                });

                endGesture(gesture, event);

                expect(reanimated.__getPendingTimingCallbackCount()).toBe(1);
                expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
                expect(onVisibleMonthChange).toHaveBeenLastCalledWith(targetDay);
                expect(onSelectDay).toHaveBeenCalledTimes(1);
                expect(onSelectDay).toHaveBeenLastCalledWith(targetDay);

                act(() => reanimated.__flushTimingCallbacks());
                expect(getDetailMonthGestureLayerOffset()).toEqual({
                    translateX: 0,
                    translateY: 0,
                });
                for (const pageDay of pages) {
                    expect(findDetailMonthPage(
                        pageDay.slice(0, 7)
                    )).toBeDefined();
                }
                expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
                expect(onVisibleMonthChange).toHaveBeenLastCalledWith(targetDay);
                expect(onSelectDay).toHaveBeenCalledTimes(1);
                expect(onSelectDay).toHaveBeenLastCalledWith(targetDay);

                await updateCalendar(targetDay);
                expect(pendingFrameCallbacks).toHaveLength(0);
                expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
                expect(onSelectDay).toHaveBeenCalledTimes(1);
            } finally {
                reanimated.__setTimingCallbacksDeferred(false);
            }
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
                translateX: -DETAIL_MONTH_TEST_VIEWPORT_WIDTH,
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
            ).opacity).toBe(1);
            expect(getPagerPageStyle(
                "detail-month-page-next-2026-08"
            )).toMatchObject({
                opacity: 1,
                translateX: 0,
                translateY: DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
            });

            endGesture(gesture, swipeUp);
            expect(onDetailMonthPreview).toHaveBeenCalledWith("2026-08-15");
            expect(
                onDetailMonthPreview.mock.invocationCallOrder[0]
            ).toBeLessThan(onVisibleMonthChange.mock.invocationCallOrder[0]);
            expect(
                onDetailMonthPreview.mock.invocationCallOrder[0]
            ).toBeLessThan(onSelectDay.mock.invocationCallOrder[0]);
            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
            expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");
            expect(motion.translateY.__getValue()).toBe(0);
            expect(motion.opacity.__getValue()).toBe(1);
            expect(reanimated.__getPendingTimingCallbackCount()).toBe(1);

            act(() => reanimated.__flushTimingCallbacks());
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
            expect(onSelectDay).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");
            // The slot positions and canvas origin rotate together on the UI
            // thread, so no controlled/Fabric handoff is observable.
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(getDetailMonthGestureLayerOpacity()).toBe(1);

            await acknowledgeControlledMonth("2026-08-15", {
                translateX: 0,
                translateY: -DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
            });

            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(getDetailMonthGestureLayerOpacity()).toBe(1);
            expect(motion.translateY.__getValue()).toBe(0);
            expect(motion.opacity.__getValue()).toBe(1);
            expect(findDetailMonthPage("2026-08")).toBeDefined();
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);

            const secondGesture = startGesture();
            expect(secondGesture.stateManager.fail).not.toHaveBeenCalled();
            updateGesture(secondGesture.gesture, swipeUp);
            endGesture(secondGesture.gesture, swipeUp);
            act(() => reanimated.__flushTimingCallbacks());
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(2);
            expect(onVisibleMonthChange).toHaveBeenLastCalledWith(
                "2026-09-15"
            );
            expect(onSelectDay).toHaveBeenCalledTimes(2);
            expect(onSelectDay).toHaveBeenLastCalledWith("2026-09-15");
            expect(onDetailMonthPreview).toHaveBeenCalledTimes(2);
            expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
                "2026-09-15"
            );
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("취소된 release는 상단 pill의 월을 미리 바꾸지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const { gesture } = startGesture();
        const shortDrag = panGestureEvent(-6, 1);

        updateGesture(gesture, shortDrag);
        endGesture(gesture, shortDrag);

        expect(onDetailMonthPreview).not.toHaveBeenCalled();
        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(onSelectDay).not.toHaveBeenCalled();
    });

    test("native pill preview 오류가 authoritative 월 commit을 막지 않는다", async () => {
        onDetailMonthPreview.mockImplementation(() => {
            throw new Error("preview unavailable");
        });
        await renderCalendar("2026-07-15");
        const { gesture } = startGesture();
        const swipeLeft = panGestureEvent(-52, 2);

        updateGesture(gesture, swipeLeft);
        endGesture(gesture, swipeLeft);

        expect(onDetailMonthPreview).toHaveBeenCalledWith("2026-08-15");
        expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-08-15");
        expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");
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
            expect(getDetailMonthGestureLayerOpacity()).toBe(1);
            expect(getPagerPageStyle(
                "detail-month-page-current-2026-08"
            ).opacity).toBe(1);
            expect(getPagerPageStyle(
                "detail-month-page-previous-2026-07"
            )).toMatchObject({
                opacity: 1,
                translateX: 0,
                translateY: -DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
            });

            endGesture(gesture, swipeDown);
            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-07-15");
            expect(onSelectDay).toHaveBeenCalledWith("2026-07-15");

            act(() => reanimated.__flushTimingCallbacks());
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onVisibleMonthChange).toHaveBeenCalledWith("2026-07-15");
            expect(onSelectDay).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledWith("2026-07-15");
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 0,
            });

            await acknowledgeControlledMonth("2026-07-15", {
                translateX: 0,
                translateY: DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
            });
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(findDetailMonthPage("2026-07")).toBeDefined();
            expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
            expect(onSelectDay).toHaveBeenCalledTimes(1);
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test.each([
        {
            label: "전달",
            targetDate: {
                year: 2026,
                month: 6,
                day: 30,
                dateString: "2026-06-30",
                timestamp: new Date(2026, 5, 30).getTime(),
            },
            targetPageTestID: "detail-month-page-previous-2026-06",
            targetOffsetY: DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
        },
        {
            label: "다음 달",
            targetDate: {
                year: 2026,
                month: 8,
                day: 1,
                dateString: "2026-08-01",
                timestamp: new Date(2026, 7, 1).getTime(),
            },
            targetPageTestID: "detail-month-page-next-2026-08",
            targetOffsetY: -DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
        },
    ])(
        "$label extra day를 누르면 해당 날짜로 불투명한 세로 pager focus를 요청한다",
        async ({
            targetDate,
            targetPageTestID,
            targetOffsetY,
        }) => {
            await renderCalendar("2026-07-15");
            const reanimated = getReanimatedMocks();
            reanimated.__setTimingCallbacksDeferred(true);

            try {
                const renderedDayComponent = getCalendarProps().dayComponent({
                    date: targetDate,
                    state: "disabled",
                });

                expect(renderedDayComponent.props.allowDisabledPress).toBe(true);
                act(() => renderedDayComponent.props.onPress(targetDate));

                expect(getDetailMonthGestureLayerOffset()).toEqual({
                    translateX: 0,
                    translateY: targetOffsetY,
                });
                expect(getDetailMonthGestureLayerOpacity()).toBe(1);
                expect(getPagerPageStyle(
                    "detail-month-page-current-2026-07"
                ).opacity).toBe(1);
                expect(getPagerPageStyle(targetPageTestID).opacity).toBe(1);
                expect(reanimated.__getPendingTimingCallbackCount()).toBe(1);
                expect(onVisibleMonthChange).not.toHaveBeenCalled();
                expect(onSelectDay).not.toHaveBeenCalled();

                act(() => reanimated.__flushTimingCallbacks());
                expect(pendingFrameCallbacks).toHaveLength(1);
                expect(onVisibleMonthChange).not.toHaveBeenCalled();
                expect(onSelectDay).not.toHaveBeenCalled();

                flushNextFrame();
                expect(onVisibleMonthChange).toHaveBeenCalledTimes(1);
                expect(onVisibleMonthChange).toHaveBeenCalledWith(
                    targetDate.dateString
                );
                expect(onSelectDay).toHaveBeenCalledTimes(1);
                expect(onSelectDay).toHaveBeenCalledWith(targetDate.dateString);
            } finally {
                reanimated.__setTimingCallbacksDeferred(false);
            }
        }
    );


    test("세로 cancel은 불투명한 인접 pager를 유지한 채 원점으로 복귀한다", async () => {
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
                translateY: -DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
            });
            expect(getPagerPageStyle(
                "detail-month-page-next-2026-08"
            ).opacity).toBe(1);

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
                opacity: 1,
                translateX: 0,
                translateY: DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
            });
            expect(getPreviousPagerPageOffset()).toEqual({
                translateX: 0,
                translateY: -DETAIL_MONTH_TEST_VIEWPORT_HEIGHT,
            });

            act(() => reanimated.__flushTimingCallbacks());
            expect(getPreviousPagerPageOffset()).toEqual({
                translateX: -DETAIL_MONTH_TEST_VIEWPORT_WIDTH,
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
            DETAIL_MONTH_TEST_VIEWPORT_WIDTH,
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

    test.each([
        {
            label: "가로 같은 방향",
            firstSwipe: panGestureEvent(-52, 2),
            interruptedOffset: -180,
            residualOffset: { translateX: 140, translateY: 0 },
            secondSwipe: panGestureEvent(-340, 2),
            liveOffset: { translateX: -200, translateY: 0 },
            presentationDelta: { translateX: -340, translateY: 0 },
            finalDay: "2026-09-15",
            finalMonth: "2026-09",
        },
        {
            label: "가로 반대 방향",
            firstSwipe: panGestureEvent(-52, 2),
            interruptedOffset: -180,
            residualOffset: { translateX: 140, translateY: 0 },
            secondSwipe: panGestureEvent(60, 2),
            liveOffset: { translateX: 200, translateY: 0 },
            presentationDelta: { translateX: 60, translateY: 0 },
            finalDay: "2026-07-15",
            finalMonth: "2026-07",
        },
        {
            label: "세로 같은 방향",
            firstSwipe: panGestureEvent(2, -52),
            interruptedOffset: -230,
            residualOffset: { translateX: 0, translateY: 190 },
            secondSwipe: panGestureEvent(2, -440),
            liveOffset: { translateX: 0, translateY: -250 },
            presentationDelta: { translateX: 0, translateY: -440 },
            finalDay: "2026-09-15",
            finalMonth: "2026-09",
        },
        {
            label: "세로 반대 방향",
            firstSwipe: panGestureEvent(2, -52),
            interruptedOffset: -230,
            residualOffset: { translateX: 0, translateY: 190 },
            secondSwipe: panGestureEvent(2, 40),
            liveOffset: { translateX: 0, translateY: 230 },
            presentationDelta: { translateX: 0, translateY: 40 },
            finalDay: "2026-07-15",
            finalMonth: "2026-07",
        },
    ])(
        "$label retouch는 settle의 현재 화면 위치에서 바로 이어진다",
        async ({
            firstSwipe,
            interruptedOffset,
            residualOffset,
            secondSwipe,
            liveOffset,
            presentationDelta,
            finalDay,
            finalMonth,
        }) => {
            await renderCalendar("2026-07-15");
            const reanimated = getReanimatedMocks();
            reanimated.__setTimingCallbacksDeferred(true);
            try {
                const { gesture: firstGesture } = startGesture();
                updateGesture(firstGesture, firstSwipe);
                mockNextCallbackTimingPresentation(interruptedOffset);
                endGesture(firstGesture, firstSwipe);
                expect(onSelectDay).toHaveBeenLastCalledWith("2026-08-15");
                const julyBeforeRetouch =
                    getMonthPresentationOffset("2026-07");
                const augustBeforeRetouch =
                    getMonthPresentationOffset("2026-08");

                const cancelCallsBeforeRetouch =
                    reanimated.cancelAnimation.mock.calls.length;
                const timingCallsBeforeRetouch =
                    reanimated.withTiming.mock.calls.length;
                const retouch = startGesture();

                expect(retouch.stateManager.fail).not.toHaveBeenCalled();
                expect(reanimated.cancelAnimation.mock.calls.length)
                    .toBeGreaterThan(cancelCallsBeforeRetouch);
                expect(getDetailMonthGestureLayerOffset()).toEqual(
                    residualOffset
                );
                expect(getMonthPresentationOffset("2026-07")).toEqual(
                    julyBeforeRetouch
                );
                expect(getMonthPresentationOffset("2026-08")).toEqual(
                    augustBeforeRetouch
                );
                // A late cancelled callback is now stale and cannot promote
                // or complete the page a second time.
                act(() => reanimated.__flushTimingCallbacks(false));
                expect(getDetailMonthGestureLayerOffset()).toEqual(
                    residualOffset
                );

                updateGesture(retouch.gesture, secondSwipe);
                expect(getDetailMonthGestureLayerOffset()).toEqual(liveOffset);
                expect(getMonthPresentationOffset("2026-07")).toEqual({
                    translateX: julyBeforeRetouch.translateX
                        + presentationDelta.translateX,
                    translateY: julyBeforeRetouch.translateY
                        + presentationDelta.translateY,
                });
                expect(getMonthPresentationOffset("2026-08")).toEqual({
                    translateX: augustBeforeRetouch.translateX
                        + presentationDelta.translateX,
                    translateY: augustBeforeRetouch.translateY
                        + presentationDelta.translateY,
                });

                endGesture(retouch.gesture, secondSwipe);
                expect(reanimated.withTiming.mock.calls.length)
                    .toBeGreaterThan(timingCallsBeforeRetouch);
                expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
                    finalDay
                );
                expect(onSelectDay).toHaveBeenLastCalledWith(finalDay);
                act(() => reanimated.__flushTimingCallbacks());
                expect(findDetailMonthPage(finalMonth)).toBeDefined();
                expect(pendingFrameCallbacks).toHaveLength(0);
            } finally {
                reanimated.__setTimingCallbacksDeferred(false);
            }
        }
    );

    test("실앱 controlled commit은 연속 swipe의 마지막 달만 idle 뒤 반영한다", async () => {
        jest.useFakeTimers();
        renderedOnCommitDetailMonth = jest.fn();
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        try {
            await renderCalendar("2026-07-15");
            const swipe = panGestureEvent(-52, 2);
            const { gesture: firstGesture } = startGesture();

            updateGesture(firstGesture, swipe);
            mockNextCallbackTimingPresentation(-180);
            endGesture(firstGesture, swipe);
            expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
                "2026-08-15"
            );
            expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
            expect(
                getDetailMonthDayProps(
                    "2026-08-15"
                ).animatedSelectedDayKey?.value
            ).toBe(20260815);

            const retouch = startGesture();
            act(() => reanimated.__flushTimingCallbacks(false));
            const nextSwipe = panGestureEvent(-340, 2);
            updateGesture(retouch.gesture, nextSwipe);
            endGesture(retouch.gesture, nextSwipe);
            act(() => reanimated.__flushTimingCallbacks());

            expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
                "2026-09-15"
            );
            expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs - 1
                );
            });
            expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
            act(() => jest.advanceTimersByTime(1));
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(1);
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledWith(
                "2026-09-15"
            );
            expect(onVisibleMonthChange).not.toHaveBeenCalled();
            expect(onSelectDay).not.toHaveBeenCalled();
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    test("월 Pan 뒤 source boundary date는 선택되지 않고 보존한 일자로 commit한다", async () => {
        jest.useFakeTimers();
        renderedOnCommitDetailMonth = jest.fn();
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        reanimated.__setRunOnJSCallbacksDeferred(true);
        try {
            await renderCalendar("2027-04-02");
            const swipe = panGestureEvent(2, 220);
            const { gesture } = startGesture();

            updateGesture(gesture, swipe);
            endGesture(gesture, swipe);
            act(() => reanimated.__flushTimingCallbacks());
            expect(getMonthPresentationOffset("2027-03")).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(getDetailMonthSelectionText("current")).toBe("2");
            expect(reanimated.__getPendingRunOnJSCallbackCount())
                .toBeGreaterThan(0);
            expect(getPagerPageInteractionProps("2027-03"))
                .toMatchObject({ pointerEvents: "box-only" });
            expect(getPagerPageInteractionProps("2027-04"))
                .toMatchObject({ pointerEvents: "none" });
            expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
            expect(getDetailMonthSelectionText("current")).toBe("2");

            act(() => reanimated.__flushRunOnJSCallbacks());

            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs
                );
            });
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(1);
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledWith(
                "2027-03-02"
            );
        } finally {
            reanimated.__setRunOnJSCallbacksDeferred(false);
            reanimated.__setTimingCallbacksDeferred(false);
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    test("이전 idle ACK는 이미 다음 달로 간 visual pager를 되감지 않는다", async () => {
        jest.useFakeTimers();
        renderedOnCommitDetailMonth = jest.fn();
        try {
            await renderCalendar("2026-07-15");
            const shift = registeredDetailMonthMotionShift;
            expect(shift).toEqual(expect.any(Function));

            act(() => shift?.(1));
            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs
                );
            });
            expect(renderedOnCommitDetailMonth).toHaveBeenLastCalledWith(
                "2026-08-15"
            );

            // The user can begin the next gesture while React is still
            // committing the prior transition lane.
            act(() => shift?.(1));
            expect(getMonthPresentationOffset("2026-09")).toEqual({
                translateX: 0,
                translateY: 0,
            });

            await updateCalendar("2026-08-15", {
                focusedMonth: "2026-08-15",
            });
            expect(getMonthPresentationOffset("2026-09")).toEqual({
                translateX: 0,
                translateY: 0,
            });
            expect(getDetailMonthSelectionText("current")).toBe("15");

            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs
                );
            });
            expect(renderedOnCommitDetailMonth).toHaveBeenLastCalledWith(
                "2026-09-15"
            );
            await updateCalendar("2026-09-15", {
                focusedMonth: "2026-09-15",
            });
            expect(getMonthPresentationOffset("2026-09")).toEqual({
                translateX: 0,
                translateY: 0,
            });
        } finally {
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    test("취소돼 큐에 남은 idle callback은 최신 controlled commit을 지우지 않는다", async () => {
        jest.useFakeTimers();
        const timeoutSpy = jest.spyOn(globalThis, "setTimeout");
        renderedOnCommitDetailMonth = jest.fn((day: string) => {
            renderedDay = day;
            renderedFocusedMonth = day;
            renderer?.update(calendarElement());
        });
        try {
            await renderCalendar("2026-10-09");
            const shift = registeredDetailMonthMotionShift;
            expect(shift).toEqual(expect.any(Function));

            act(() => shift?.(1));
            act(() => shift?.(1));
            act(() => shift?.(1));
            const staleFlush = timeoutSpy.mock.calls
                .filter(([, delay]) => (
                    delay
                    === DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs
                ))
                .at(-1)?.[0];
            expect(staleFlush).toEqual(expect.any(Function));

            act(() => shift?.(1));
            expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
                "2027-02-09"
            );
            expect(getDetailMonthSelectionText("current")).toBe("9");
            expect(renderedDay).toBe("2026-10-09");

            // clearTimeout cannot retract a callback that has already moved
            // to the JS task queue. Model that stale January callback after
            // February's replacement timer has been reserved.
            act(() => {
                if (typeof staleFlush === "function") staleFlush();
            });
            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs
                );
            });

            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(1);
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledWith(
                "2027-02-09"
            );
            expect(renderedDay).toBe("2027-02-09");
            expect(renderedFocusedMonth).toBe("2027-02-09");
        } finally {
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    test("idle 대기 중 touch-down은 commit을 멈추고 손을 뗀 뒤 다시 예약한다", async () => {
        jest.useFakeTimers();
        renderedOnCommitDetailMonth = jest.fn();
        onRegisterDetailMonthMotionShift = jest.fn();
        try {
            await renderCalendar("2026-07-15");
            const registeredShift =
                onRegisterDetailMonthMotionShift.mock.calls[0]?.[0];
            expect(registeredShift).toEqual(expect.any(Function));

            act(() => registeredShift(1));
            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs - 20
                );
            });
            const touch = startGesture();
            act(() => jest.advanceTimersByTime(1_000));
            expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();

            endGesture(touch.gesture, panGestureEvent());
            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs - 1
                );
            });
            expect(renderedOnCommitDetailMonth).not.toHaveBeenCalled();
            act(() => jest.advanceTimersByTime(1));
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(1);
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledWith(
                "2026-08-15"
            );
        } finally {
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    test("swipe 뒤 날짜 탭은 이전 idle commit을 폐기하고 다음 달에도 탭한 일자를 보존한다", async () => {
        jest.useFakeTimers();
        renderedOnCommitDetailMonth = jest.fn();
        onRegisterDetailMonthMotionShift = jest.fn();
        try {
            await renderCalendar("2026-07-15");
            const registeredShift =
                onRegisterDetailMonthMotionShift.mock.calls[0]?.[0];
            expect(registeredShift).toEqual(expect.any(Function));

            act(() => registeredShift(1));
            const august20 = getDetailMonthDayProps(
                "2026-08-15",
                "2026-08-20"
            );
            expect(august20.animatedSelectedDayKey?.value).toBe(20260815);

            act(() => august20.onPress({
                year: 2026,
                month: 8,
                day: 20,
                dateString: "2026-08-20",
                timestamp: new Date(2026, 7, 20).getTime(),
            }));
            expect(august20.animatedSelectedDayKey?.value).toBe(20260820);
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(1);
            expect(renderedOnCommitDetailMonth).toHaveBeenLastCalledWith(
                "2026-08-20"
            );

            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs * 2
                );
            });
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(1);

            act(() => registeredShift(1));
            act(() => {
                jest.advanceTimersByTime(
                    DETAIL_MONTH_SWIPE_MOTION.continuousCommitIdleMs
                );
            });
            expect(renderedOnCommitDetailMonth).toHaveBeenCalledTimes(2);
            expect(renderedOnCommitDetailMonth).toHaveBeenLastCalledWith(
                "2026-09-20"
            );
        } finally {
            jest.clearAllTimers();
            jest.useRealTimers();
        }
    });

    test("retouch 후 짧게 놓으면 승격된 현재 달로 복귀하고 추가 commit하지 않는다", async () => {
        await renderCalendar("2026-07-15");
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        try {
            const firstSwipe = panGestureEvent(-52, 2);
            const { gesture: firstGesture } = startGesture();
            updateGesture(firstGesture, firstSwipe);
            mockNextCallbackTimingPresentation(-180);
            endGesture(firstGesture, firstSwipe);

            const retouch = startGesture();
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 140,
                translateY: 0,
            });
            act(() => reanimated.__flushTimingCallbacks(false));
            const shortContinuation = panGestureEvent(-10, 0);
            updateGesture(retouch.gesture, shortContinuation);
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 130,
                translateY: 0,
            });

            const previewCountBeforeRelease =
                onDetailMonthPreview.mock.calls.length;
            endGesture(retouch.gesture, shortContinuation);

            expect(onDetailMonthPreview).toHaveBeenCalledTimes(
                previewCountBeforeRelease
            );
            expect(onDetailMonthPreview).toHaveBeenLastCalledWith(
                "2026-08-15"
            );
            expect(onSelectDay).toHaveBeenLastCalledWith("2026-08-15");
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 0,
            });
            act(() => reanimated.__flushTimingCallbacks());
            expect(findDetailMonthPage("2026-08")).toBeDefined();
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });

    test("세로 retouch는 중간 월 높이도 끊김 없이 보존한다", async () => {
        const heightFixture = createDetailMonthHeightFixture();
        await renderCalendar(
            "2026-07-15",
            false,
            "detail",
            heightFixture
        );
        const reanimated = getReanimatedMocks();
        reanimated.__setTimingCallbacksDeferred(true);
        try {
            const firstSwipe = panGestureEvent(2, -52);
            const { gesture: firstGesture } = startGesture();
            updateGesture(firstGesture, firstSwipe);
            mockNextCallbackTimingPresentation(-230);
            endGesture(firstGesture, firstSwipe);

            const interruptedCalendarHeight = 420
                + (500 - 420) * (230 / 420);
            const interruptedDayHeight = 60
                + (68 - 60) * (230 / 420);
            heightFixture.animatedCalendarHeight.value =
                interruptedCalendarHeight;
            heightFixture.animatedDayHeight.value = interruptedDayHeight;

            const retouch = startGesture();
            expect(heightFixture.animatedCalendarHeight.value).toBeCloseTo(
                interruptedCalendarHeight
            );
            expect(heightFixture.animatedDayHeight.value).toBeCloseTo(
                interruptedDayHeight
            );
            act(() => reanimated.__flushTimingCallbacks(false));
            expect(heightFixture.animatedCalendarHeight.value).toBeCloseTo(
                interruptedCalendarHeight
            );
            expect(heightFixture.animatedDayHeight.value).toBeCloseTo(
                interruptedDayHeight
            );

            const continuation = panGestureEvent(2, -52);
            updateGesture(retouch.gesture, continuation);
            expect(getDetailMonthGestureLayerOffset()).toEqual({
                translateX: 0,
                translateY: 138,
            });
            expect(heightFixture.animatedCalendarHeight.value).toBeCloseTo(
                500 + (420 - 500) * (138 / 420)
            );
            expect(heightFixture.animatedDayHeight.value).toBeCloseTo(
                68 + (60 - 68) * (138 / 420)
            );

            endGesture(retouch.gesture, continuation);
            act(() => reanimated.__flushTimingCallbacks());
        } finally {
            reanimated.__setTimingCallbacksDeferred(false);
        }
    });


    test("순환 pager의 화면 밖 날짜 page는 터치와 접근성에서 제외한다", async () => {
        await renderCalendar("2026-07-15");
        expect(getPagerPageInteractionProps("2026-07")).toMatchObject({
            pointerEvents: "box-only",
            accessibilityElementsHidden: false,
            "aria-hidden": false,
            importantForAccessibility: "auto",
        });
        expect(getPagerPageInteractionProps("2026-06")).toMatchObject({
            pointerEvents: "none",
            accessibilityElementsHidden: true,
            "aria-hidden": true,
            importantForAccessibility: "no-hide-descendants",
        });
    });

    test("동작 줄이기에서는 이동 없이 순환 target을 즉시 반영한다", async () => {
        await renderCalendar("2026-07-15", true);
        const calendar = getCalendarProps();

        act(() => calendar.onPressArrowRight(jest.fn()));

        expect(Animated.timing).not.toHaveBeenCalled();
        expect(onSelectDay).toHaveBeenCalledWith("2026-08-15");
        expect(getDetailMonthGestureLayerOffset()).toEqual({
            translateX: 0,
            translateY: 0,
        });
        expect(findDetailMonthPage("2026-08")).toBeDefined();
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
        "%s 다른 달 Today target은 committed month 확인 뒤 ready를 알린다",
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
            if (viewMode === "detail") {
                expect(pendingFrameCallbacks).toHaveLength(1);
                flushNextFrame();
            } else {
                expect(pendingFrameCallbacks).toHaveLength(0);
                act(() => getCalendarProps().onMonthChange?.({
                    dateString: "2026-08-01",
                }));
                act(() => getCalendarProps().onMonthChange?.({
                    dateString: "2026-08-16",
                }));
            }

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
        const registeredCancel = onRegisterDetailMonthMotionCancel.mock.calls[0]?.[0];

        expect(registeredCancel).toEqual(expect.any(Function));
        const { gesture } = startGesture();
        updateGesture(gesture, panGestureEvent(-52, 2));
        act(() => registeredCancel());

        expect(onSelectDay).not.toHaveBeenCalled();
        expect(onVisibleMonthChange).not.toHaveBeenCalled();
        expect(getDetailMonthGestureLayerOffset()).toEqual({
            translateX: 0,
            translateY: 0,
        });
        expect(pendingFrameCallbacks).toHaveLength(0);

        await act(async () => renderer?.unmount());
        renderer = undefined;
        expect(onRegisterDetailMonthMotionCancel).toHaveBeenLastCalledWith(null);
    });

    test("등록한 shift callback도 순환 pager target을 즉시 반영한다", async () => {
        onRegisterDetailMonthMotionShift = jest.fn();
        await renderCalendar("2026-07-15");
        const registeredShift = onRegisterDetailMonthMotionShift.mock.calls[0]?.[0];

        expect(registeredShift).toEqual(expect.any(Function));
        act(() => registeredShift(1));

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
