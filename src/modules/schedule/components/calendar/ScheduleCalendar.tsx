import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    Animated,
    Easing,
    FlatList,
    type GestureResponderEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    PanResponder,
    type PanResponderGestureState,
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, DateData } from "react-native-calendars";
import Reanimated, {
    cancelAnimation as cancelReanimatedAnimation,
    Easing as ReanimatedEasing,
    runOnJS,
    type SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from "react-native-reanimated";
import type { ScheduleItem } from "../../types";
import type { CalendarDayMetadata } from "../../calendarMetadata";
import { useTheme } from "../../../theme/ThemeContext";
import {
    CALENDAR_INTERACTION_BUDGET_MS,
    DETAIL_MONTH_SWIPE_GESTURE,
    DETAIL_MONTH_SWIPE_MOTION,
    getDetailMonthSwipeFollowOffset,
    getDetailMonthSwipeFollowOpacity,
    getDetailMonthSwipeGestureDirection,
    getDetailMonthSwipeOffsets,
    shouldClaimDetailMonthSwipeGesture,
    type DetailMonthSwipeDirection,
} from "../../calendarMotion";
import { shiftCalendarMonth } from "../../calendarNavigation";
import CustomDay from "./CustomDay";
import StackWeekEventLabels from "./StackWeekEventLabels";
import {
    createStackCalendarLayout,
    enumerateStackScheduleDays,
} from "./stackCalendarLayout";
import {
    CALENDAR_DAY_HEIGHTS,
    isContinuousMonthViewMode,
    type CalendarViewMode,
} from "./viewMode";

type Props = {
    selectedDay: string;
    focusedMonth?: string;
    items: ScheduleItem[];
    calendarDaysByDate?: Readonly<Record<string, CalendarDayMetadata>>;
    onSelectDay: (day: string) => void;
    onOpenDay: (day: string) => void;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    scrollRequest: number;
    onVisibleMonthChange: (month: string) => void;
    headerOffset?: number;
    transitionMonthKey?: string;
    transitionActive?: boolean;
    transitionContext?: "idle" | "yearToMonth" | "monthToDay" | "dayToMonth";
    reduceMotionEnabled?: boolean;
    todayFocusTarget?: TodayFocusTarget | null;
    onTodayFocusReady?: (day: string) => void;
    onRegisterDetailMonthMotionCancel?: (
        cancel: (() => void) | null
    ) => void;
    onRegisterDetailMonthMotionShift?: (
        shift: ((direction: DetailMonthSwipeDirection) => void) | null
    ) => void;
    animatedDayHeight?: SharedValue<number>;
    bottomContentInset?: number;
};

export type TodayFocusTarget = {
    day: string;
    requiresMonthChange: boolean;
};

type CalendarDayComponentProps = {
    date?: DateData;
    state?: string;
    marking?: React.ComponentProps<typeof CustomDay>["marking"];
};

type CalendarMarkedEvent = NonNullable<
    NonNullable<CalendarDayComponentProps["marking"]>["events"]
>[number];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const STACK_MONTH_RANGE = 60;
const WEEKDAY_HEADER_HEIGHT = 42;
const STACK_MONTH_HEADER_HEIGHT = 52;
const STACK_MONTH_DIVIDER_HEIGHT = StyleSheet.hairlineWidth;
const CALENDAR_HEADER_TOP_MARGIN = 14;
const CALENDAR_HEADER_BOTTOM_MARGIN = 8;
const CALENDAR_HEADER_SPACING =
    CALENDAR_HEADER_TOP_MARGIN + CALENDAR_HEADER_BOTTOM_MARGIN;
const CALENDAR_CONTENT_BOTTOM_PADDING = 4;
const TRANSITION_MONTH_PREFIX = "month-";
const DETAIL_MONTH_SWIPE_EASING = Easing.bezier(
    ...DETAIL_MONTH_SWIPE_MOTION.bezier
);
const DETAIL_MONTH_SWIPE_QUEUE_LIMIT = 6;
const EMPTY_CALENDAR_DAYS_BY_DATE: Readonly<Record<string, CalendarDayMetadata>> = {};

type DetailMonthAnimationPhase = "idle" | "exit" | "awaitingCommit" | "enter";

type DetailMonthAnimationOptions = {
    gestureOffset?: number;
    gestureVelocityX?: number;
    gestureAxis?: "horizontal" | "vertical";
    targetDay?: string;
};

type FixedCalendarHeightOptions = {
    viewMode: CalendarViewMode;
    month: string;
    firstDay: 0 | 1;
    headerOffset: number;
};

type StackMonth = {
    key: string;
    year: number;
    month: number;
    dateString: string;
    days: Array<DateData | null>;
    dayHeight: number;
    headerHeight: number;
    height: number;
};

function getMonthWeekCount(month: string, firstDay: 0 | 1): number {
    const [yearText, monthText] = month.slice(0, 7).split("-");
    const year = Number(yearText);
    const monthNumber = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return 6;

    const monthIndex = monthNumber - 1;
    const leadingBlankCount = (
        new Date(year, monthIndex, 1).getDay() - firstDay + 7
    ) % 7;
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    return Math.ceil((leadingBlankCount + dayCount) / 7);
}

/** 패널형 월간 달력의 높이를 실제 Calendar 레이아웃과 동일하게 계산한다. */
export function getFixedScheduleCalendarHeight({
    viewMode,
    month,
    firstDay,
    headerOffset,
}: FixedCalendarHeightOptions): number | null {
    if (viewMode !== "detail" && viewMode !== "list" && viewMode !== "week") {
        return null;
    }

    if (viewMode === "week") {
        return 58 + WEEKDAY_HEADER_HEIGHT + CALENDAR_DAY_HEIGHTS.week;
    }

    return headerOffset
        + CALENDAR_HEADER_SPACING
        + getMonthWeekCount(month, firstDay) * CALENDAR_DAY_HEIGHTS[viewMode]
        + CALENDAR_CONTENT_BOTTOM_PADDING;
}

function normalizeMonthCandidate(value: string | null | undefined): string | null {
    if (!value) return null;

    const trimmed = value.startsWith(TRANSITION_MONTH_PREFIX)
        ? value.slice(TRANSITION_MONTH_PREFIX.length)
        : value;
    const candidate = trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed;

    return /^\d{4}-\d{2}$/.test(candidate) ? candidate : null;
}

function getMonthDistance(from: Date, toMonth: string): number {
    const [yearText, monthText] = toMonth.split("-");
    const toYear = Number(yearText);
    const toMonthIndex = Number(monthText) - 1;

    return (toYear - from.getFullYear()) * 12
        + toMonthIndex
        - from.getMonth();
}

function resolveDetailMonthAnchor(selectedDay: string, visibleMonth: string): string {
    return selectedDay.startsWith(`${visibleMonth}-`)
        ? selectedDay
        : `${visibleMonth}-01`;
}

function toDateString(year: number, month: number, day = 1) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function createStackMonth(
    date: Date,
    firstDay: 0 | 1,
    dayHeight: number,
    headerHeight: number
): StackMonth {
    const year = date.getFullYear();
    const monthIndex = date.getMonth();
    const month = monthIndex + 1;
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    const leadingBlankCount = (
        new Date(year, monthIndex, 1).getDay() - firstDay + 7
    ) % 7;
    const weekCount = Math.ceil((leadingBlankCount + dayCount) / 7);
    const totalCellCount = weekCount * 7;
    const days = Array.from(
        { length: totalCellCount },
        (_, index): DateData | null => {
            const day = index - leadingBlankCount + 1;
            if (day < 1 || day > dayCount) return null;

            const current = new Date(year, monthIndex, day);
            return {
                year,
                month,
                day,
                dateString: toDateString(year, month, day),
                timestamp: current.getTime(),
            };
        }
    );
    return {
        key: `${year}-${String(month).padStart(2, "0")}`,
        year,
        month,
        dateString: toDateString(year, month),
        days,
        dayHeight,
        headerHeight,
        height:
            headerHeight
            + weekCount * dayHeight
            + STACK_MONTH_DIVIDER_HEIGHT,
    };
}

function getTodayDateString() {
    const today = new Date();
    return toDateString(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function moveDay(day: string, amount: number) {
    const next = new Date(`${day}T00:00:00`);
    next.setDate(next.getDate() + amount);
    return toDateString(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

function compareMarkedEvents(left: CalendarMarkedEvent, right: CalendarMarkedEvent) {
    if (Boolean(left.allDay) !== Boolean(right.allDay)) {
        return left.allDay ? -1 : 1;
    }

    const leftStart = new Date(left.startAt).getTime();
    const rightStart = new Date(right.startAt).getTime();
    if (Number.isFinite(leftStart) && Number.isFinite(rightStart) && leftStart !== rightStart) {
        return leftStart - rightStart;
    }

    return left.title.localeCompare(right.title, "ko");
}

function createWeekDays(day: string, firstDay: 0 | 1) {
    const selected = new Date(`${day}T00:00:00`);
    const diff = (selected.getDay() - firstDay + 7) % 7;
    const start = new Date(selected);
    start.setDate(selected.getDate() - diff);

    return Array.from({ length: 7 }, (_, index): DateData => {
        const current = new Date(start);
        current.setDate(start.getDate() + index);
        return {
            year: current.getFullYear(),
            month: current.getMonth() + 1,
            day: current.getDate(),
            dateString: toDateString(
                current.getFullYear(),
                current.getMonth() + 1,
                current.getDate()
            ),
            timestamp: current.getTime(),
        };
    });
}

function formatWeekTitle(days: DateData[]) {
    const first = days[0];
    const last = days[days.length - 1];

    if (first.month === last.month) {
        return `${first.month}월 ${first.day}-${last.day}일`;
    }
    return `${first.month}월 ${first.day}일-${last.month}월 ${last.day}일`;
}

// 스택형은 월이 위아래로 이어지는 목록을, 패널형은 고정 Calendar를 사용한다.
export default function ScheduleCalendar({
    selectedDay,
    focusedMonth,
    items,
    calendarDaysByDate = EMPTY_CALENDAR_DAYS_BY_DATE,
    onSelectDay,
    onOpenDay,
    viewMode,
    firstDay,
    scrollRequest,
    onVisibleMonthChange,
    headerOffset = 0,
    transitionMonthKey,
    transitionActive = false,
    reduceMotionEnabled = false,
    todayFocusTarget,
    onTodayFocusReady,
    onRegisterDetailMonthMotionCancel,
    onRegisterDetailMonthMotionShift,
    animatedDayHeight,
    bottomContentInset = 0,
}: Props) {
    const { colors, mode } = useTheme();
    // 상위 화면은 분 단위로 다시 렌더링된다. 값을 mount 시점에 고정하면
    // 자정을 지난 뒤 주간 보기의 '오늘' 표시가 전날에 남는다.
    const todayDateString = getTodayDateString();
    const visibleMonth = normalizeMonthCandidate(transitionMonthKey)
        ?? normalizeMonthCandidate(focusedMonth)
        ?? selectedDay.slice(0, 7);
    const stackTargetMonthKey = normalizeMonthCandidate(transitionMonthKey)
        ?? normalizeMonthCandidate(focusedMonth)
        ?? selectedDay.slice(0, 7);
    const initialDate = selectedDay.startsWith(`${visibleMonth}-`)
        ? selectedDay
        : `${visibleMonth}-01`;
    const [detailMonthPagerAnchorDay, setDetailMonthPagerAnchorDay] = useState(
        initialDate
    );
    const stackListRef = useRef<FlatList<StackMonth>>(null);
    const handledStackScrollRequestRef = useRef(scrollRequest);
    const internallyReportedStackMonthRef = useRef<string | null>(null);
    const positionedStackListSessionRef = useRef<string | null>(null);
    const positionedStackTargetMonthRef = useRef<string | null>(null);
    const stackListBaseKey = isContinuousMonthViewMode(viewMode)
        ? `${mode}-${viewMode}-${firstDay}`
        : null;
    const stackListSessionRef = useRef({
        key: stackListBaseKey,
        anchorMonth: new Date(`${visibleMonth}-01T00:00:00`),
    });
    const stackTargetOutsideRange = stackListBaseKey !== null
        && Math.abs(getMonthDistance(
            stackListSessionRef.current.anchorMonth,
            stackTargetMonthKey
        )) > STACK_MONTH_RANGE;
    if (
        stackListSessionRef.current.key !== stackListBaseKey
        || stackTargetOutsideRange
    ) {
        // The stack list is rebuilt when its presentation changes. Anchor the
        // new list to the month currently on screen, not the month that was
        // visible when ScheduleCalendar first mounted in another mode. Also
        // rebase when an explicit jump falls outside the finite list window.
        stackListSessionRef.current = {
            key: stackListBaseKey,
            anchorMonth: new Date(`${stackTargetMonthKey}-01T00:00:00`),
        };
    }
    const stackListAnchorMonth = stackListSessionRef.current.anchorMonth;
    const stackListAnchorKey = `${stackListAnchorMonth.getFullYear()}-${String(
        stackListAnchorMonth.getMonth() + 1
    ).padStart(2, "0")}`;
    const stackListSessionKey = stackListBaseKey === null
        ? null
        : `${stackListBaseKey}-${stackListAnchorKey}`;
    const activeStackMonthRef = useRef(visibleMonth);
    const { width: detailMonthPageWidth } = useWindowDimensions();
    const detailMonthTranslateX = useRef(new Animated.Value(0)).current;
    const detailMonthTranslateY = useRef(new Animated.Value(0)).current;
    const detailMonthOpacity = useRef(new Animated.Value(1)).current;
    const detailMonthGestureTranslateX = useSharedValue(0);
    const detailMonthGestureTranslateY = useSharedValue(0);
    const detailMonthGestureOpacity = useSharedValue(1);
    const detailMonthGestureAnimatedStyle = useAnimatedStyle(() => ({
        opacity: detailMonthGestureOpacity.value,
        transform: [
            {
                translateX:
                    -detailMonthPageWidth + detailMonthGestureTranslateX.value,
            },
            { translateY: detailMonthGestureTranslateY.value },
        ],
    }), [detailMonthPageWidth]);
    const detailMonthAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
    const detailMonthAnimationFrameRef = useRef<number | null>(null);
    const detailMonthCommitWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const detailMonthDeadlineWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const detailMonthAnimationActiveRef = useRef(false);
    const detailMonthAnimationPhaseRef = useRef<DetailMonthAnimationPhase>("idle");
    const detailMonthAnimationGenerationRef = useRef(0);
    const detailMonthAnimationSourceDayRef = useRef<string | null>(null);
    const detailMonthAnimationExpectedDayRef = useRef<string | null>(null);
    const detailMonthSuppressedCommitRef = useRef<string | null>(null);
    const detailMonthAnimationPendingDeltaRef = useRef(0);
    const detailMonthAnimationEnterDurationRef = useRef(0);
    const detailMonthAnimationStartedAtRef = useRef(0);
    const detailMonthAnimationReduceMotionRef = useRef(reduceMotionEnabled);
    const detailMonthAnimationUsesPagerRef = useRef(false);
    const detailMonthAnimationAxisRef = useRef<"horizontal" | "vertical">(
        "horizontal"
    );
    const detailMonthGestureActiveRef = useRef(false);
    const detailMonthGestureAxisRef = useRef<"horizontal" | "vertical" | null>(null);
    const detailMonthGestureResetAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
    const detailMonthLatestSelectedDayRef = useRef(selectedDay);
    const detailMonthLatestVisibleMonthRef = useRef(visibleMonth);
    const detailMonthLatestViewModeRef = useRef(viewMode);
    const detailMonthLatestReduceMotionRef = useRef(reduceMotionEnabled);
    const detailMonthLatestTransitionActiveRef = useRef(transitionActive);
    const todayFocusTargetRef = useRef(todayFocusTarget);
    const acknowledgedTodayFocusTargetRef = useRef<TodayFocusTarget | null>(null);
    const onTodayFocusReadyRef = useRef(onTodayFocusReady);
    const startDetailMonthAnimationRef = useRef<(
        direction: DetailMonthSwipeDirection
    ) => void>(() => undefined);

    detailMonthLatestSelectedDayRef.current = selectedDay;
    detailMonthLatestVisibleMonthRef.current = visibleMonth;
    detailMonthLatestViewModeRef.current = viewMode;
    detailMonthLatestReduceMotionRef.current = reduceMotionEnabled;
    detailMonthLatestTransitionActiveRef.current = transitionActive;
    todayFocusTargetRef.current = todayFocusTarget;
    onTodayFocusReadyRef.current = onTodayFocusReady;

    const acknowledgeTodayFocusTarget = useCallback((day: string) => {
        const target = todayFocusTargetRef.current;
        if (
            !target ||
            target.day !== day ||
            acknowledgedTodayFocusTargetRef.current === target
        ) return;

        acknowledgedTodayFocusTargetRef.current = target;
        onTodayFocusReadyRef.current?.(target.day);
    }, []);

    const invalidateDetailMonthAnimation = useCallback((clearPending = true) => {
        detailMonthAnimationGenerationRef.current += 1;
        const activeAnimation = detailMonthAnimationRef.current;
        const activeGestureResetAnimation = detailMonthGestureResetAnimationRef.current;
        const activeFrame = detailMonthAnimationFrameRef.current;
        const activeWatchdog = detailMonthCommitWatchdogRef.current;
        const activeDeadlineWatchdog = detailMonthDeadlineWatchdogRef.current;
        const expectedMonth = detailMonthAnimationExpectedDayRef.current?.slice(0, 7);
        if (expectedMonth) detailMonthSuppressedCommitRef.current = expectedMonth;
        detailMonthAnimationRef.current = null;
        detailMonthAnimationFrameRef.current = null;
        detailMonthCommitWatchdogRef.current = null;
        detailMonthDeadlineWatchdogRef.current = null;
        detailMonthGestureResetAnimationRef.current = null;
        detailMonthGestureActiveRef.current = false;
        detailMonthGestureAxisRef.current = null;
        detailMonthAnimationPhaseRef.current = "idle";
        detailMonthAnimationSourceDayRef.current = null;
        detailMonthAnimationExpectedDayRef.current = null;
        detailMonthAnimationActiveRef.current = false;
        detailMonthAnimationUsesPagerRef.current = false;
        detailMonthAnimationAxisRef.current = "horizontal";
        detailMonthAnimationStartedAtRef.current = 0;
        if (clearPending) detailMonthAnimationPendingDeltaRef.current = 0;

        if (activeFrame !== null) cancelAnimationFrame(activeFrame);
        if (activeWatchdog !== null) clearTimeout(activeWatchdog);
        if (activeDeadlineWatchdog !== null) clearTimeout(activeDeadlineWatchdog);
        activeAnimation?.stop();
        activeGestureResetAnimation?.stop();
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
        detailMonthGestureTranslateX.value = 0;
        detailMonthGestureTranslateY.value = 0;
        detailMonthGestureOpacity.value = 1;
        detailMonthTranslateX.stopAnimation();
        detailMonthTranslateY.stopAnimation();
        detailMonthOpacity.stopAnimation();
        detailMonthTranslateX.setValue(0);
        detailMonthTranslateY.setValue(0);
        detailMonthOpacity.setValue(1);
    }, [
        detailMonthOpacity,
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthTranslateX,
        detailMonthTranslateY,
    ]);

    const cancelDetailMonthMotion = useCallback(() => {
        invalidateDetailMonthAnimation(true);
    }, [invalidateDetailMonthAnimation]);

    const resetDetailMonthGesture = useCallback(() => {
        detailMonthGestureActiveRef.current = false;
        detailMonthGestureAxisRef.current = null;
        detailMonthGestureResetAnimationRef.current?.stop();
        detailMonthGestureResetAnimationRef.current = null;
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);

        if (detailMonthLatestReduceMotionRef.current) {
            detailMonthGestureTranslateX.value = 0;
            detailMonthGestureTranslateY.value = 0;
            detailMonthGestureOpacity.value = 1;
            detailMonthTranslateX.setValue(0);
            detailMonthTranslateY.setValue(0);
            detailMonthOpacity.setValue(1);
            return;
        }

        detailMonthGestureTranslateX.value = withTiming(0, {
            duration: DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs,
            easing: ReanimatedEasing.bezier(...DETAIL_MONTH_SWIPE_MOTION.bezier),
        });
        detailMonthGestureTranslateY.value = withTiming(0, {
            duration: DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs,
            easing: ReanimatedEasing.bezier(...DETAIL_MONTH_SWIPE_MOTION.bezier),
        });
        detailMonthGestureOpacity.value = withTiming(1, {
            duration: DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs,
            easing: ReanimatedEasing.bezier(...DETAIL_MONTH_SWIPE_MOTION.bezier),
        });

        const resetAnimation = Animated.parallel([
            Animated.timing(detailMonthTranslateX, {
                toValue: 0,
                duration: DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(detailMonthTranslateY, {
                toValue: 0,
                duration: DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(detailMonthOpacity, {
                toValue: 1,
                duration: DETAIL_MONTH_SWIPE_GESTURE.cancelDurationMs,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
        ]);
        detailMonthGestureResetAnimationRef.current = resetAnimation;
        resetAnimation.start(() => {
            if (detailMonthGestureResetAnimationRef.current === resetAnimation) {
                detailMonthGestureResetAnimationRef.current = null;
            }
        });
    }, [
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthOpacity,
        detailMonthTranslateX,
        detailMonthTranslateY,
    ]);

    useLayoutEffect(() => {
        if (!onRegisterDetailMonthMotionCancel) return undefined;

        onRegisterDetailMonthMotionCancel(cancelDetailMonthMotion);
        return () => onRegisterDetailMonthMotionCancel(null);
    }, [cancelDetailMonthMotion, onRegisterDetailMonthMotionCancel]);

    useEffect(() => {
        if (!todayFocusTarget) acknowledgedTodayFocusTargetRef.current = null;
    }, [todayFocusTarget]);

    useEffect(() => (
        () => invalidateDetailMonthAnimation(true)
    ), [invalidateDetailMonthAnimation]);

    const completeDetailMonthAnimation = useCallback((generation: number) => {
        if (generation !== detailMonthAnimationGenerationRef.current) return;

        const pendingDelta = detailMonthAnimationPendingDeltaRef.current;
        invalidateDetailMonthAnimation(false);
        if (
            pendingDelta === 0 ||
            detailMonthLatestViewModeRef.current !== "detail"
        ) {
            if (detailMonthLatestViewModeRef.current !== "detail") {
                detailMonthAnimationPendingDeltaRef.current = 0;
            }
            return;
        }

        const nextDirection: DetailMonthSwipeDirection = pendingDelta < 0 ? -1 : 1;
        detailMonthAnimationPendingDeltaRef.current -= nextDirection;
        startDetailMonthAnimationRef.current(nextDirection);
    }, [invalidateDetailMonthAnimation]);

    const startDetailMonthEnterAnimation = useCallback((generation: number) => {
        if (
            generation !== detailMonthAnimationGenerationRef.current ||
            detailMonthAnimationPhaseRef.current !== "awaitingCommit"
        ) return;

        if (detailMonthCommitWatchdogRef.current !== null) {
            clearTimeout(detailMonthCommitWatchdogRef.current);
            detailMonthCommitWatchdogRef.current = null;
        }
        detailMonthAnimationPhaseRef.current = "enter";
        detailMonthAnimationFrameRef.current = requestAnimationFrame(() => {
            detailMonthAnimationFrameRef.current = null;
            if (
                generation !== detailMonthAnimationGenerationRef.current ||
                detailMonthAnimationPhaseRef.current !== "enter"
            ) return;

            const elapsedMs = Math.max(
                0,
                Date.now() - detailMonthAnimationStartedAtRef.current
            );
            const remainingBudgetMs = Math.max(
                0,
                CALENDAR_INTERACTION_BUDGET_MS - elapsedMs
                    - DETAIL_MONTH_SWIPE_MOTION.commitFrameBudgetMs / 2
            );
            const enterDurationMs = Math.min(
                detailMonthAnimationEnterDurationRef.current,
                remainingBudgetMs
            );
            const detailMonthActiveTranslation =
                detailMonthAnimationAxisRef.current === "vertical"
                    ? detailMonthTranslateY
                    : detailMonthTranslateX;
            if (enterDurationMs === 0) {
                detailMonthTranslateX.setValue(0);
                detailMonthTranslateY.setValue(0);
                detailMonthOpacity.setValue(1);
                completeDetailMonthAnimation(generation);
                return;
            }

            const enterAnimation = Animated.parallel([
                Animated.timing(detailMonthActiveTranslation, {
                    toValue: 0,
                    duration: enterDurationMs,
                    easing: DETAIL_MONTH_SWIPE_EASING,
                    useNativeDriver: true,
                    isInteraction: false,
                }),
                Animated.timing(detailMonthOpacity, {
                    toValue: 1,
                    duration: enterDurationMs,
                    easing: DETAIL_MONTH_SWIPE_EASING,
                    useNativeDriver: true,
                    isInteraction: false,
                }),
            ]);
            detailMonthAnimationRef.current = enterAnimation;
            enterAnimation.start(({ finished }) => {
                if (detailMonthAnimationRef.current === enterAnimation) {
                    detailMonthAnimationRef.current = null;
                }
                if (generation !== detailMonthAnimationGenerationRef.current) return;
                if (!finished) {
                    invalidateDetailMonthAnimation(true);
                    return;
                }
                completeDetailMonthAnimation(generation);
            });
        });
    }, [
        completeDetailMonthAnimation,
        detailMonthOpacity,
        detailMonthTranslateX,
        detailMonthTranslateY,
        invalidateDetailMonthAnimation,
    ]);

    const handleDetailMonthChange = useCallback((month: DateData) => {
        const incomingMonth = month.dateString.slice(0, 7);
        const todayTarget = todayFocusTargetRef.current;
        if (
            todayTarget?.requiresMonthChange &&
            incomingMonth === todayTarget.day.slice(0, 7)
        ) {
            acknowledgeTodayFocusTarget(todayTarget.day);
        }
        const suppressedCommit = detailMonthSuppressedCommitRef.current;
        if (suppressedCommit) {
            detailMonthSuppressedCommitRef.current = null;
            if (incomingMonth === suppressedCommit) return;
        }
        if (detailMonthAnimationActiveRef.current) {
            const phase = detailMonthAnimationPhaseRef.current;
            const sourceMonth = detailMonthAnimationSourceDayRef.current?.slice(0, 7);
            const expectedMonth = detailMonthAnimationExpectedDayRef.current?.slice(0, 7);

            if (phase === "awaitingCommit" && incomingMonth === expectedMonth) {
                startDetailMonthEnterAnimation(
                    detailMonthAnimationGenerationRef.current
                );
                return;
            }

            // The controlled initialDate update can emit the source month once
            // more while the target commit is pending. Neither source nor the
            // expected target should be forwarded back to the parent twice.
            if (incomingMonth === sourceMonth || incomingMonth === expectedMonth) {
                return;
            }

            invalidateDetailMonthAnimation(true);
        }

        onVisibleMonthChange(month.dateString);
        onSelectDay(month.dateString);
    }, [
        acknowledgeTodayFocusTarget,
        invalidateDetailMonthAnimation,
        onSelectDay,
        onVisibleMonthChange,
        startDetailMonthEnterAnimation,
    ]);

    const commitDetailMonthPagerSwipe = useCallback((
        generation: number,
        targetDay: string
    ) => {
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || detailMonthAnimationPhaseRef.current !== "exit"
            || !detailMonthAnimationUsesPagerRef.current
        ) return;

        detailMonthAnimationPhaseRef.current = "awaitingCommit";
        detailMonthAnimationExpectedDayRef.current = targetDay;
        detailMonthCommitWatchdogRef.current = setTimeout(() => {
            detailMonthCommitWatchdogRef.current = null;
            if (
                generation !== detailMonthAnimationGenerationRef.current
                || detailMonthAnimationPhaseRef.current !== "awaitingCommit"
            ) return;
            invalidateDetailMonthAnimation(true);
        }, DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
        onVisibleMonthChange(targetDay);
        onSelectDay(targetDay);
    }, [invalidateDetailMonthAnimation, onSelectDay, onVisibleMonthChange]);

    const scheduleDetailMonthPagerCommit = useCallback((
        generation: number,
        targetDay: string
    ) => {
        if (
            generation !== detailMonthAnimationGenerationRef.current
            || detailMonthAnimationPhaseRef.current !== "exit"
            || !detailMonthAnimationUsesPagerRef.current
        ) return;

        detailMonthAnimationFrameRef.current = requestAnimationFrame(() => {
            detailMonthAnimationFrameRef.current = null;
            commitDetailMonthPagerSwipe(generation, targetDay);
        });
    }, [commitDetailMonthPagerSwipe]);

    const animateDetailMonthChange = useCallback((
        direction: DetailMonthSwipeDirection,
        options: DetailMonthAnimationOptions = {}
    ) => {
        if (
            detailMonthLatestViewModeRef.current !== "detail" ||
            detailMonthLatestTransitionActiveRef.current
        ) {
            resetDetailMonthGesture();
            return;
        }
        const normalizedDirection: DetailMonthSwipeDirection = direction < 0 ? -1 : 1;
        if (detailMonthAnimationActiveRef.current) {
            detailMonthAnimationPendingDeltaRef.current = Math.max(
                -DETAIL_MONTH_SWIPE_QUEUE_LIMIT,
                Math.min(
                    DETAIL_MONTH_SWIPE_QUEUE_LIMIT,
                    detailMonthAnimationPendingDeltaRef.current + normalizedDirection
                )
            );
            return;
        }

        const sourceDay = resolveDetailMonthAnchor(
            detailMonthLatestSelectedDayRef.current,
            detailMonthLatestVisibleMonthRef.current
        );
        const targetDay = options.targetDay
            ?? shiftCalendarMonth(sourceDay, normalizedDirection);
        const reduceMotion = detailMonthLatestReduceMotionRef.current;
        const generation = detailMonthAnimationGenerationRef.current + 1;
        detailMonthGestureActiveRef.current = false;
        detailMonthGestureResetAnimationRef.current?.stop();
        detailMonthGestureResetAnimationRef.current = null;
        detailMonthAnimationGenerationRef.current = generation;
        detailMonthAnimationActiveRef.current = true;
        detailMonthAnimationUsesPagerRef.current = false;
        const gestureAxis = options.gestureAxis ?? "horizontal";
        detailMonthAnimationAxisRef.current = gestureAxis;
        detailMonthAnimationPhaseRef.current = "exit";
        detailMonthAnimationSourceDayRef.current = sourceDay;
        detailMonthAnimationExpectedDayRef.current = null;
        detailMonthAnimationReduceMotionRef.current = reduceMotion;
        detailMonthAnimationStartedAtRef.current = Date.now();
        const isHorizontalPagerTransition = gestureAxis === "horizontal"
            && detailMonthPageWidth > 0;
        const isGestureTransition = options.gestureOffset !== undefined;
        const travel = reduceMotion
            ? DETAIL_MONTH_SWIPE_MOTION.reduceMotionTravel
            : DETAIL_MONTH_SWIPE_MOTION.travel;
        const exitDuration = reduceMotion
            ? DETAIL_MONTH_SWIPE_MOTION.reduceMotionExitDurationMs
            : DETAIL_MONTH_SWIPE_MOTION.exitDurationMs;
        detailMonthAnimationEnterDurationRef.current = reduceMotion
            ? DETAIL_MONTH_SWIPE_MOTION.reduceMotionEnterDurationMs
            : DETAIL_MONTH_SWIPE_MOTION.enterDurationMs;
        const offsets = getDetailMonthSwipeOffsets(normalizedDirection, travel);

        if (isHorizontalPagerTransition && !reduceMotion) {
            detailMonthAnimationUsesPagerRef.current = true;
            detailMonthDeadlineWatchdogRef.current = setTimeout(() => {
                detailMonthDeadlineWatchdogRef.current = null;
                if (generation !== detailMonthAnimationGenerationRef.current) return;
                invalidateDetailMonthAnimation(true);
            }, CALENDAR_INTERACTION_BUDGET_MS
                + DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
            cancelReanimatedAnimation(detailMonthGestureTranslateX);
            cancelReanimatedAnimation(detailMonthGestureTranslateY);
            cancelReanimatedAnimation(detailMonthGestureOpacity);
            detailMonthGestureTranslateY.value = 0;
            detailMonthGestureOpacity.value = 1;
            if (!isGestureTransition) {
                detailMonthTranslateX.setValue(0);
                detailMonthTranslateY.setValue(0);
                detailMonthOpacity.setValue(1);
                detailMonthGestureTranslateX.value = withTiming(
                    -normalizedDirection * detailMonthPageWidth,
                    {
                        duration: CALENDAR_INTERACTION_BUDGET_MS,
                        easing: ReanimatedEasing.bezier(
                            ...DETAIL_MONTH_SWIPE_MOTION.bezier
                        ),
                    },
                    (finished) => {
                        if (finished) {
                            runOnJS(scheduleDetailMonthPagerCommit)(
                                generation,
                                targetDay
                            );
                        }
                    }
                );
                return;
            }
            const rawReleaseVelocity = (options.gestureVelocityX ?? 0) * 1000;
            const releaseVelocity = Math.sign(rawReleaseVelocity)
                === -normalizedDirection
                ? rawReleaseVelocity
                : 0;
            detailMonthGestureTranslateX.value = withSpring(
                -normalizedDirection * detailMonthPageWidth,
                {
                    damping: 30,
                    stiffness: 280,
                    mass: 0.9,
                    velocity: releaseVelocity,
                    overshootClamping: true,
                    energyThreshold: 0.01,
                },
                (finished) => {
                    if (finished) {
                        runOnJS(commitDetailMonthPagerSwipe)(generation, targetDay);
                    }
                }
            );
            return;
        }

        const detailMonthActiveTranslation = gestureAxis === "vertical"
            ? detailMonthTranslateY
            : detailMonthTranslateX;
        const detailMonthInactiveTranslation = gestureAxis === "vertical"
            ? detailMonthTranslateX
            : detailMonthTranslateY;
        detailMonthActiveTranslation.setValue(options.gestureOffset ?? 0);
        detailMonthInactiveTranslation.setValue(0);
        detailMonthOpacity.setValue(1);
        cancelReanimatedAnimation(detailMonthGestureTranslateX);
        cancelReanimatedAnimation(detailMonthGestureTranslateY);
        cancelReanimatedAnimation(detailMonthGestureOpacity);
        detailMonthGestureTranslateX.value = 0;
        detailMonthGestureTranslateY.value = 0;
        detailMonthGestureOpacity.value = 1;
        detailMonthDeadlineWatchdogRef.current = setTimeout(() => {
            detailMonthDeadlineWatchdogRef.current = null;
            if (generation !== detailMonthAnimationGenerationRef.current) return;
            invalidateDetailMonthAnimation(true);
        }, CALENDAR_INTERACTION_BUDGET_MS);
        const exitAnimation = Animated.parallel([
            Animated.timing(detailMonthActiveTranslation, {
                toValue: offsets.outgoing,
                duration: exitDuration,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
            Animated.timing(detailMonthOpacity, {
                toValue: DETAIL_MONTH_SWIPE_MOTION.buttonOpacityFloor,
                duration: exitDuration,
                easing: DETAIL_MONTH_SWIPE_EASING,
                useNativeDriver: true,
                isInteraction: false,
            }),
        ]);
        detailMonthAnimationRef.current = exitAnimation;
        exitAnimation.start(({ finished }) => {
            if (detailMonthAnimationRef.current === exitAnimation) {
                detailMonthAnimationRef.current = null;
            }
            if (generation !== detailMonthAnimationGenerationRef.current) return;
            if (!finished) {
                invalidateDetailMonthAnimation(true);
                return;
            }

            const currentAnchor = resolveDetailMonthAnchor(
                detailMonthLatestSelectedDayRef.current,
                detailMonthLatestVisibleMonthRef.current
            );
            if (
                detailMonthLatestViewModeRef.current !== "detail" ||
                detailMonthLatestReduceMotionRef.current !== reduceMotion ||
                currentAnchor !== sourceDay
            ) {
                invalidateDetailMonthAnimation(true);
                return;
            }

            detailMonthAnimationPhaseRef.current = "awaitingCommit";
            detailMonthAnimationExpectedDayRef.current = targetDay;
            detailMonthActiveTranslation.setValue(offsets.incoming);
            detailMonthOpacity.setValue(
                DETAIL_MONTH_SWIPE_MOTION.buttonOpacityFloor
            );
            detailMonthCommitWatchdogRef.current = setTimeout(() => {
                detailMonthCommitWatchdogRef.current = null;
                if (
                    generation !== detailMonthAnimationGenerationRef.current ||
                    detailMonthAnimationPhaseRef.current !== "awaitingCommit"
                ) return;
                invalidateDetailMonthAnimation(true);
            }, DETAIL_MONTH_SWIPE_MOTION.commitWatchdogMs);
            onVisibleMonthChange(targetDay);
            onSelectDay(targetDay);
        });
    }, [
        detailMonthOpacity,
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthPageWidth,
        commitDetailMonthPagerSwipe,
        invalidateDetailMonthAnimation,
        onSelectDay,
        onVisibleMonthChange,
        resetDetailMonthGesture,
        scheduleDetailMonthPagerCommit,
    ]);

    startDetailMonthAnimationRef.current = animateDetailMonthChange;

    useLayoutEffect(() => {
        if (!onRegisterDetailMonthMotionShift) return undefined;

        onRegisterDetailMonthMotionShift(animateDetailMonthChange);
        return () => onRegisterDetailMonthMotionShift(null);
    }, [animateDetailMonthChange, onRegisterDetailMonthMotionShift]);

    const applyDetailMonthGestureOffset = useCallback((
        translation: number,
        axis: "horizontal" | "vertical"
    ) => {
        const offset = getDetailMonthSwipeFollowOffset(
            translation,
            detailMonthLatestReduceMotionRef.current,
            axis === "horizontal"
                ? DETAIL_MONTH_SWIPE_GESTURE.maxFollowTravel
                : DETAIL_MONTH_SWIPE_MOTION.travel
        );
        detailMonthGestureTranslateX.value = axis === "horizontal" ? offset : 0;
        detailMonthGestureTranslateY.value = axis === "vertical" ? offset : 0;
        detailMonthGestureOpacity.value = getDetailMonthSwipeFollowOpacity(
            offset,
            axis === "horizontal"
                ? DETAIL_MONTH_SWIPE_GESTURE.maxFollowTravel
                : DETAIL_MONTH_SWIPE_MOTION.travel
        );
        return offset;
    }, [
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
    ]);

    const detailMonthPanResponder = useMemo(() => {
        let gestureInvalidatedByMultitouch = false;
        const hasMultipleTouches = (
            event: GestureResponderEvent,
            gestureState?: PanResponderGestureState
        ) => {
            const reportedTouchCount = event.nativeEvent.touches?.length ?? 0;
            const activeTouchCount = reportedTouchCount > 0
                ? reportedTouchCount
                : (gestureState?.numberActiveTouches ?? 0);
            return activeTouchCount > 1;
        };
        const shouldClaimGesture = (
            event: GestureResponderEvent,
            gestureState: PanResponderGestureState
        ) => {
            if (hasMultipleTouches(event, gestureState)) {
                gestureInvalidatedByMultitouch = true;
                detailMonthGestureAxisRef.current = null;
                detailMonthGestureActiveRef.current = false;
                return false;
            }
            if (gestureInvalidatedByMultitouch) return false;
            if (detailMonthGestureAxisRef.current) return true;

            const canClaimGesture = detailMonthLatestViewModeRef.current === "detail"
                && !detailMonthLatestTransitionActiveRef.current
                && !detailMonthAnimationActiveRef.current
                && !todayFocusTargetRef.current;
            if (!canClaimGesture) {
                return false;
            }

            if (shouldClaimDetailMonthSwipeGesture(
                gestureState.dx,
                gestureState.dy
            )) {
                detailMonthGestureAxisRef.current = "horizontal";
                return true;
            }

            if (shouldClaimDetailMonthSwipeGesture(
                gestureState.dy,
                gestureState.dx
            )) {
                detailMonthGestureAxisRef.current = "vertical";
                return true;
            }

            return false;
        };
        const prepareGesture = (
            event: GestureResponderEvent,
            gestureState: PanResponderGestureState
        ) => {
            gestureInvalidatedByMultitouch = hasMultipleTouches(
                event,
                gestureState
            );
            detailMonthGestureActiveRef.current = false;
            detailMonthGestureAxisRef.current = null;
            return false;
        };
        const cancelGesture = () => {
            gestureInvalidatedByMultitouch = false;
            resetDetailMonthGesture();
        };

        return PanResponder.create({
            onStartShouldSetPanResponder: prepareGesture,
            onStartShouldSetPanResponderCapture: prepareGesture,
            onMoveShouldSetPanResponder: shouldClaimGesture,
            onMoveShouldSetPanResponderCapture: shouldClaimGesture,
            onPanResponderGrant: (event, gestureState) => {
                if (
                    gestureInvalidatedByMultitouch
                    || hasMultipleTouches(event, gestureState)
                ) {
                    gestureInvalidatedByMultitouch = true;
                    resetDetailMonthGesture();
                    return;
                }
                if (!detailMonthGestureAxisRef.current) {
                    detailMonthGestureActiveRef.current = false;
                    return;
                }
                detailMonthGestureResetAnimationRef.current?.stop();
                detailMonthGestureResetAnimationRef.current = null;
                cancelReanimatedAnimation(detailMonthGestureTranslateX);
                cancelReanimatedAnimation(detailMonthGestureTranslateY);
                cancelReanimatedAnimation(detailMonthGestureOpacity);
                detailMonthGestureActiveRef.current = true;
                detailMonthTranslateX.stopAnimation();
                detailMonthTranslateY.stopAnimation();
                detailMonthOpacity.stopAnimation();
            },
            onPanResponderMove: (event, gestureState) => {
                if (hasMultipleTouches(event, gestureState)) {
                    gestureInvalidatedByMultitouch = true;
                    resetDetailMonthGesture();
                    return;
                }
                if (gestureInvalidatedByMultitouch) return;
                if (!detailMonthGestureActiveRef.current) return;
                const gestureAxis = detailMonthGestureAxisRef.current;
                if (!gestureAxis) return;
                applyDetailMonthGestureOffset(
                    gestureAxis === "horizontal"
                        ? gestureState.dx
                        : gestureState.dy,
                    gestureAxis
                );
            },
            onPanResponderRelease: (event, gestureState) => {
                if (
                    gestureInvalidatedByMultitouch
                    || hasMultipleTouches(event, gestureState)
                ) {
                    gestureInvalidatedByMultitouch = false;
                    resetDetailMonthGesture();
                    return;
                }
                const gestureAxis = detailMonthGestureAxisRef.current;
                detailMonthGestureAxisRef.current = null;
                if (!gestureAxis || !detailMonthGestureActiveRef.current) return;

                const translation = gestureAxis === "horizontal"
                    ? gestureState.dx
                    : gestureState.dy;
                const velocity = gestureAxis === "horizontal"
                    ? gestureState.vx
                    : gestureState.vy;
                const gestureOffset = applyDetailMonthGestureOffset(
                    translation,
                    gestureAxis
                );
                const direction = getDetailMonthSwipeGestureDirection(
                    translation,
                    velocity
                );
                if (!direction) {
                    resetDetailMonthGesture();
                    return;
                }

                animateDetailMonthChange(direction, {
                    gestureOffset,
                    gestureVelocityX: gestureAxis === "horizontal"
                        ? gestureState.vx
                        : undefined,
                    gestureAxis,
                });
            },
            onPanResponderReject: cancelGesture,
            onPanResponderTerminate: cancelGesture,
            onPanResponderTerminationRequest: () => false,
            onShouldBlockNativeResponder: () => true,
        });
    }, [
        applyDetailMonthGestureOffset,
        animateDetailMonthChange,
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthOpacity,
        detailMonthTranslateX,
        detailMonthTranslateY,
        resetDetailMonthGesture,
    ]);

    useLayoutEffect(() => {
        if (!detailMonthAnimationActiveRef.current) return;

        const phase = detailMonthAnimationPhaseRef.current;
        const sourceDay = detailMonthAnimationSourceDayRef.current;
        const expectedDay = detailMonthAnimationExpectedDayRef.current;
        const currentAnchor = resolveDetailMonthAnchor(selectedDay, visibleMonth);
        const matchesControlledTransition = phase === "exit"
            ? currentAnchor === sourceDay
            : phase === "awaitingCommit"
                ? currentAnchor === sourceDay || currentAnchor === expectedDay
                : phase === "enter"
                    ? currentAnchor === expectedDay
                    : false;

        if (
            transitionActive ||
            viewMode !== "detail" ||
            detailMonthAnimationReduceMotionRef.current !== reduceMotionEnabled ||
            !matchesControlledTransition
        ) {
            invalidateDetailMonthAnimation(true);
            return;
        }

        // The controlled props are the authoritative commit ACK. Starting the
        // enter phase here avoids waiting on react-native-calendars' later
        // onMonthChange effect and keeps the release-to-settle path under 200ms.
        if (phase === "awaitingCommit" && currentAnchor === expectedDay) {
            if (detailMonthAnimationUsesPagerRef.current) {
                cancelReanimatedAnimation(detailMonthGestureTranslateX);
                detailMonthGestureTranslateX.value = 0;
                detailMonthGestureOpacity.value = 1;
                setDetailMonthPagerAnchorDay(expectedDay);
                completeDetailMonthAnimation(
                    detailMonthAnimationGenerationRef.current
                );
                return;
            }
            startDetailMonthEnterAnimation(
                detailMonthAnimationGenerationRef.current
            );
        }
    }, [
        completeDetailMonthAnimation,
        detailMonthGestureOpacity,
        detailMonthGestureTranslateX,
        invalidateDetailMonthAnimation,
        reduceMotionEnabled,
        selectedDay,
        startDetailMonthEnterAnimation,
        transitionActive,
        viewMode,
        visibleMonth,
    ]);

    useLayoutEffect(() => {
        if (detailMonthAnimationUsesPagerRef.current) return;
        setDetailMonthPagerAnchorDay((current) => (
            current === initialDate ? current : initialDate
        ));
    }, [initialDate]);

    useEffect(() => {
        const target = todayFocusTarget;
        if (!target || selectedDay !== target.day) return undefined;

        const targetMonth = target.day.slice(0, 7);
        const isCommittedWeek = viewMode === "week";
        const isCommittedSameMonthCalendar = (
            (viewMode === "detail" || viewMode === "list") &&
            !target.requiresMonthChange &&
            visibleMonth === targetMonth
        );
        if (!isCommittedWeek && !isCommittedSameMonthCalendar) return undefined;

        const readyFrame = requestAnimationFrame(() => {
            acknowledgeTodayFocusTarget(target.day);
        });
        return () => cancelAnimationFrame(readyFrame);
    }, [
        acknowledgeTodayFocusTarget,
        selectedDay,
        todayFocusTarget,
        viewMode,
        visibleMonth,
    ]);

    const markedDates = useMemo(() => {
        const dateMap: Record<string, any> = {};
        const dateSingleDay: Record<string, ScheduleItem[]> = {};
        const dateMultiDay: Record<string, any[]> = {};

        items.forEach((item) => {
            const dates = enumerateStackScheduleDays(item);
            const isMultiDay = dates.length > 1;

            dates.forEach((date) => {
                if (!dateMap[date]) dateMap[date] = {};
                if (!dateMap[date].events) dateMap[date].events = [];
                dateMap[date].events.push({
                    id: item.id,
                    title: item.title,
                    color: item.category.color,
                    startAt: item.startAt,
                    allDay: item.allDay,
                    travelMode: item.travelMode
                        ?? (item.travelMinutes || item.departAt || item.route ? "ETC" : undefined),
                });
            });

            if (isMultiDay) {
                dates.forEach((date, index) => {
                    if (!dateMultiDay[date]) dateMultiDay[date] = [];
                    dateMultiDay[date].push({
                        startingDay: index === 0,
                        endingDay: index === dates.length - 1,
                        color: item.category.color,
                    });
                });
            } else {
                const date = dates[0];
                if (!date) return;
                if (!dateSingleDay[date]) dateSingleDay[date] = [];
                dateSingleDay[date].push(item);
            }
        });

        Object.keys(dateMultiDay).forEach((date) => {
            dateMap[date] = { ...dateMap[date], periods: dateMultiDay[date] };
            if (dateSingleDay[date]) {
                dateMap[date].dots = dateSingleDay[date].map((item) => ({
                    color: item.category.color,
                    travelMode: item.travelMode,
                }));
                dateMap[date].marked = true;
                delete dateSingleDay[date];
            }
        });

        Object.keys(dateSingleDay).forEach((date) => {
            dateMap[date] = {
                ...dateMap[date],
                marked: true,
                dots: dateSingleDay[date].map((item) => ({
                    color: item.category.color,
                    travelMode: item.travelMode,
                })),
            };
        });

        Object.values(dateMap).forEach((marking) => {
            marking.events?.sort(compareMarkedEvents);
        });

        dateMap[selectedDay] = {
            ...(dateMap[selectedDay] ?? {}),
            selected: true,
        };
        return dateMap;
    }, [items, selectedDay]);
    const stackCalendarLayout = useMemo(
        () => createStackCalendarLayout(items, firstDay),
        [firstDay, items]
    );

    const renderDay = useCallback(({ date, state, marking }: CalendarDayComponentProps) => (
        <CustomDay
            date={date}
            state={state}
            marking={marking}
            dayMetadata={date ? calendarDaysByDate[date.dateString] : undefined}
            viewMode={viewMode}
            animatedCellHeight={animatedDayHeight}
            isSelectedDay={date?.dateString === selectedDay}
            onPress={(day) => {
                if (detailMonthAnimationActiveRef.current) return;
                if (viewMode === "detail") {
                    if (day.dateString === selectedDay) {
                        onOpenDay(day.dateString);
                        return;
                    }
                    const targetMonth = day.dateString.slice(0, 7);
                    if (targetMonth !== visibleMonth) {
                        animateDetailMonthChange(
                            targetMonth < visibleMonth ? -1 : 1,
                            { targetDay: day.dateString }
                        );
                        return;
                    }
                    onSelectDay(day.dateString);
                    onVisibleMonthChange(day.dateString);
                    return;
                }
                onOpenDay(day.dateString);
            }}
        />
    ), [
        animatedDayHeight,
        animateDetailMonthChange,
        calendarDaysByDate,
        onOpenDay,
        onSelectDay,
        onVisibleMonthChange,
        selectedDay,
        visibleMonth,
        viewMode,
    ]);

    const calendarTheme = {
        weekVerticalMargin: 0,
        backgroundColor: colors.calendarBackground,
        calendarBackground: colors.calendarBackground,
        textSectionTitleColor: colors.dayHeaderColor,
        arrowColor: colors.arrowColor,
        monthTextColor: colors.monthTextColor,
        textMonthFontWeight: "800",
        textMonthFontSize: 22,
        textDayHeaderFontWeight: "600",
        textDayHeaderFontSize: 13,
        "stylesheet.calendar.header": {
            header: {
                flexDirection: "row",
                justifyContent: "flex-start",
                alignItems: "center",
                paddingHorizontal: 16,
                marginTop: CALENDAR_HEADER_TOP_MARGIN,
                marginBottom: CALENDAR_HEADER_BOTTOM_MARGIN,
            },
        },
    } as React.ComponentProps<typeof Calendar>["theme"] & Record<string, unknown>;

    const weekdayLabels = useMemo(() => (
        Array.from({ length: 7 }, (_, index) => WEEKDAYS[(firstDay + index) % 7])
    ), [firstDay]);
    const weekdayHeader = useMemo(() => (
        <View
            style={[
                styles.weekdayHeader,
                {
                    backgroundColor: "transparent",
                    borderBottomColor: colors.border,
                },
            ]}
        >
            {weekdayLabels.map((label, index) => (
                <Text
                    key={`${label}-${index}`}
                    style={[styles.weekdayText, { color: colors.dayHeaderColor }]}
                >
                    {label}
                </Text>
            ))}
        </View>
    ), [colors.border, colors.dayHeaderColor, weekdayLabels]);

    const stackMonths = useMemo(() => {
        const initialMonth = stackListAnchorMonth;
        const initialMonthKey = `${initialMonth.getFullYear()}-${String(
            initialMonth.getMonth() + 1
        ).padStart(2, "0")}`;

        return Array.from(
            { length: STACK_MONTH_RANGE * 2 + 1 },
            (_, index) => {
                const monthDate = new Date(
                    initialMonth.getFullYear(),
                    initialMonth.getMonth() + index - STACK_MONTH_RANGE,
                    1
                );
                const monthKey = `${monthDate.getFullYear()}-${String(
                    monthDate.getMonth() + 1
                ).padStart(2, "0")}`;

                return createStackMonth(
                    monthDate,
                    firstDay,
                    CALENDAR_DAY_HEIGHTS[viewMode],
                    monthKey === initialMonthKey ? 0 : STACK_MONTH_HEADER_HEIGHT
                );
            }
        );
    }, [firstDay, stackListAnchorMonth, viewMode]);
    const stackMonthLayouts = useMemo(() => {
        let offset = 0;
        return stackMonths.map((month, index) => {
            const layout = { length: month.height, offset, index };
            offset += month.height;
            return layout;
        });
    }, [stackMonths]);
    const stackTargetMonthIndex = useMemo(
        () => stackMonths.findIndex((month) => month.key === stackTargetMonthKey),
        [stackMonths, stackTargetMonthKey]
    );
    const visibleMonthChangeRef = useRef(onVisibleMonthChange);
    visibleMonthChangeRef.current = onVisibleMonthChange;

    const updateActiveStackMonth = useCallback((
        month: StackMonth,
        notifyParent = true
    ) => {
        if (activeStackMonthRef.current === month.key) return;

        activeStackMonthRef.current = month.key;
        if (notifyParent) {
            // focusedMonth is controlled by the parent. Tag this update so the
            // echoed prop is not mistaken for a new programmatic navigation.
            internallyReportedStackMonthRef.current = month.key;
            visibleMonthChangeRef.current(month.dateString);
        }
    }, []);

    useEffect(() => {
        if (!isContinuousMonthViewMode(viewMode) || stackTargetMonthIndex < 0) {
            positionedStackListSessionRef.current = null;
            positionedStackTargetMonthRef.current = null;
            internallyReportedStackMonthRef.current = null;
            return;
        }

        const targetMonth = stackMonths[stackTargetMonthIndex];
        const isNewListSession =
            positionedStackListSessionRef.current !== stackListSessionKey;
        const hasExplicitScrollRequest =
            handledStackScrollRequestRef.current !== scrollRequest;
        const hasNewTargetMonth =
            positionedStackTargetMonthRef.current !== targetMonth.key;
        const hasTransitionTarget = Boolean(
            normalizeMonthCandidate(transitionMonthKey)
        );
        const isControlledScrollEcho =
            internallyReportedStackMonthRef.current === targetMonth.key
            && !isNewListSession
            && !hasExplicitScrollRequest
            && !hasTransitionTarget
            && !todayFocusTarget;

        positionedStackListSessionRef.current = stackListSessionKey;
        handledStackScrollRequestRef.current = scrollRequest;

        if (isControlledScrollEcho) {
            // Natural scrolling already put the list at the correct offset.
            // Re-scrolling here created the visible month-boundary snap.
            internallyReportedStackMonthRef.current = null;
            positionedStackTargetMonthRef.current = targetMonth.key;
            return;
        }

        if (
            !isNewListSession
            && !hasExplicitScrollRequest
            && !hasTransitionTarget
            && !todayFocusTarget
            && !hasNewTargetMonth
        ) {
            // Schedule refreshes can change dynamic week/month heights. Let
            // FlatList preserve its visible anchor instead of snapping the
            // user back to the beginning of the active month.
            return;
        }

        internallyReportedStackMonthRef.current = null;
        positionedStackTargetMonthRef.current = targetMonth.key;
        updateActiveStackMonth(
            targetMonth,
            !transitionActive && !normalizeMonthCandidate(transitionMonthKey)
        );

        const scrollFrame = requestAnimationFrame(() => {
            const stackList = stackListRef.current;
            if (!stackList) return;

            stackList.scrollToOffset({
                // The sticky header already names the target month. Skip the
                // inline section title for programmatic jumps so it is not
                // duplicated directly beneath the sticky title.
                offset: Math.max(
                    0,
                    stackMonthLayouts[stackTargetMonthIndex].offset
                        + targetMonth.headerHeight
                ),
                animated: false,
            });
            if (todayFocusTarget?.day.slice(0, 7) === targetMonth.key) {
                acknowledgeTodayFocusTarget(todayFocusTarget.day);
            }
        });

        return () => cancelAnimationFrame(scrollFrame);
    }, [
        acknowledgeTodayFocusTarget,
        scrollRequest,
        stackMonthLayouts,
        stackMonths,
        stackListSessionKey,
        stackTargetMonthIndex,
        transitionActive,
        transitionMonthKey,
        todayFocusTarget,
        updateActiveStackMonth,
        viewMode,
    ]);

    const handleStackScroll = useCallback((
        event: NativeSyntheticEvent<NativeScrollEvent>
    ) => {
        const viewportHeight = event.nativeEvent.layoutMeasurement.height;
        const contentOffsetY = event.nativeEvent.contentOffset.y;
        if (
            !Number.isFinite(viewportHeight)
            || viewportHeight <= 0
            || !Number.isFinite(contentOffsetY)
        ) {
            // FlatList can emit an initial scroll event before its viewport is
            // measured. At a month boundary its fractional offset may then sit
            // just before the target item, incorrectly reporting the prior month.
            return;
        }

        const monthSwitchLine = contentOffsetY + viewportHeight * 0.32;
        let activeIndex = 0;

        for (let index = 1; index < stackMonthLayouts.length; index += 1) {
            if (stackMonthLayouts[index].offset > monthSwitchLine) break;
            activeIndex = index;
        }

        const nextActiveMonth = stackMonths[activeIndex];
        if (nextActiveMonth) {
            updateActiveStackMonth(nextActiveMonth, !transitionActive);
        }
    }, [
        stackMonthLayouts,
        stackMonths,
        transitionActive,
        updateActiveStackMonth,
    ]);

    const renderStackMonth = useCallback(({ item }: { item: StackMonth }) => (
        <View
            style={[
                styles.stackMonth,
                {
                    height: item.height,
                    backgroundColor: colors.calendarBackground,
                    borderBottomColor: colors.border,
                },
            ]}
        >
            {item.headerHeight > 0 && (
                <View style={[styles.stackMonthHeader, { height: item.headerHeight }]}>
                    <Text style={[styles.stackMonthTitle, { color: colors.monthTextColor }]}>
                        {item.month}월
                    </Text>
                </View>
            )}
            <View style={styles.stackMonthGrid}>
                {Array.from(
                    { length: Math.ceil(item.days.length / 7) },
                    (_, weekIndex) => {
                        const weekDays = item.days.slice(
                            weekIndex * 7,
                            weekIndex * 7 + 7
                        );
                        const stackEventTop = weekDays.some((weekDate) => (
                            weekDate
                            && (calendarDaysByDate[weekDate.dateString]
                                ?.holidays?.length ?? 0) > 0
                        )) ? 62 : 52;

                        return (
                            <View
                                key={`${item.key}-week-${weekIndex}`}
                                style={[
                                    styles.stackWeekRow,
                                    {
                                        height: item.dayHeight,
                                        borderTopColor: colors.border,
                                    },
                                ]}
                            >
                                {weekDays.map((date, dayIndex) => (
                                    <View
                                        key={date?.dateString
                                            ?? `${item.key}-blank-${weekIndex}-${dayIndex}`}
                                        style={[
                                            styles.stackDayCell,
                                            { height: item.dayHeight },
                                        ]}
                                    >
                                        <CustomDay
                                            date={date ?? undefined}
                                            state={date?.dateString === todayDateString
                                                ? "today"
                                                : undefined}
                                            marking={date
                                                ? markedDates[date.dateString]
                                                : undefined}
                                            dayMetadata={date
                                                ? calendarDaysByDate[date.dateString]
                                                : undefined}
                                            viewMode="stack"
                                            stackPresentation={date
                                                ? stackCalendarLayout.byDate[date.dateString]
                                                : undefined}
                                            stackEventTop={stackEventTop}
                                            hideStackEventLabels
                                            isSelectedDay={date?.dateString === selectedDay}
                                            onPress={(day) => onOpenDay(day.dateString)}
                                        />
                                    </View>
                                ))}
                                <StackWeekEventLabels
                                    days={weekDays.map((date) => date?.dateString ?? null)}
                                    layout={stackCalendarLayout}
                                    eventTop={stackEventTop}
                                />
                            </View>
                        );
                    }
                )}
            </View>
        </View>
    ), [
        colors.border,
        colors.calendarBackground,
        colors.monthTextColor,
        calendarDaysByDate,
        markedDates,
        onOpenDay,
        selectedDay,
        stackCalendarLayout,
        todayDateString,
    ]);

    const selectedWeekDays = useMemo(
        () => createWeekDays(selectedDay, firstDay),
        [firstDay, selectedDay]
    );
    const detailMonthPagerDays = useMemo(() => [
        shiftCalendarMonth(detailMonthPagerAnchorDay, -1),
        detailMonthPagerAnchorDay,
        shiftCalendarMonth(detailMonthPagerAnchorDay, 1),
    ], [detailMonthPagerAnchorDay]);
    const selectedWeekTitle = useMemo(
        () => formatWeekTitle(selectedWeekDays),
        [selectedWeekDays]
    );

    if (isContinuousMonthViewMode(viewMode)) {
        return (
            <View
                style={[
                    styles.stackList,
                    {
                        paddingBottom: Math.max(0, bottomContentInset),
                        paddingTop: Math.max(headerOffset, 0),
                        backgroundColor: colors.calendarBackground,
                    },
                ]}
            >
                <FlatList
                    ref={stackListRef}
                    key={stackListSessionKey ?? `${mode}-${viewMode}-${firstDay}`}
                    data={stackMonths}
                    renderItem={renderStackMonth}
                    keyExtractor={(item) => item.key}
                    initialScrollIndex={
                        stackTargetMonthIndex >= 0
                            ? stackTargetMonthIndex
                            : STACK_MONTH_RANGE
                    }
                    getItemLayout={(_, index) => stackMonthLayouts[index]}
                    onScroll={handleStackScroll}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={false}
                    maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
                    style={styles.stackList}
                    contentContainerStyle={styles.stackListContent}
                    initialNumToRender={3}
                    maxToRenderPerBatch={4}
                    windowSize={7}
                />
            </View>
        );
    }

    if (viewMode === "week") {
        return (
            <View style={[styles.weekContainer, { backgroundColor: colors.calendarBackground }]}>
                <View style={styles.listMonthHeader}>
                    <Pressable
                        onPress={() => {
                            const nextDay = moveDay(selectedDay, -7);
                            onSelectDay(nextDay);
                            onVisibleMonthChange(nextDay);
                        }}
                        accessibilityLabel="이전 주"
                        accessibilityRole="button"
                        style={styles.monthArrow}
                    >
                        <Ionicons accessible={false} name="chevron-back" size={27} color={colors.arrowColor} />
                    </Pressable>
                    <Text style={[styles.listMonthTitle, { color: colors.monthTextColor }]}>
                        {selectedWeekTitle}
                    </Text>
                    <Pressable
                        onPress={() => {
                            const nextDay = moveDay(selectedDay, 7);
                            onSelectDay(nextDay);
                            onVisibleMonthChange(nextDay);
                        }}
                        accessibilityLabel="다음 주"
                        accessibilityRole="button"
                        style={styles.monthArrow}
                    >
                        <Ionicons accessible={false} name="chevron-forward" size={27} color={colors.arrowColor} />
                    </Pressable>
                </View>
                {weekdayHeader}
                <View style={[styles.weekGrid, { borderBottomColor: colors.border }]}>
                    {selectedWeekDays.map((date) => (
                        <View
                            key={date.dateString}
                            style={[styles.weekDayCell, { height: CALENDAR_DAY_HEIGHTS.week }]}
                        >
                            <CustomDay
                                date={date}
                                state={date.dateString === todayDateString ? "today" : undefined}
                                marking={markedDates[date.dateString]}
                                dayMetadata={calendarDaysByDate[date.dateString]}
                                viewMode={viewMode}
                                animatedCellHeight={animatedDayHeight}
                                isSelectedDay={date.dateString === selectedDay}
                                onPress={(day) => {
                                    onVisibleMonthChange(day.dateString);
                                    onOpenDay(day.dateString);
                                }}
                            />
                        </View>
                    ))}
                </View>
            </View>
        );
    }

    return (
        <View
            style={[
                styles.monthCalendarContainer,
                {
                    backgroundColor: colors.calendarBackground,
                    paddingTop: Math.max(headerOffset, 0),
                },
            ]}
        >
            <View
                testID="detail-month-swipe-handler"
                {...(viewMode === "detail"
                    ? detailMonthPanResponder.panHandlers
                    : {})}
                style={styles.detailMonthPagerViewport}
            >
                <Animated.View
                    testID="detail-month-animated-layer"
                    style={[styles.detailMonthPagerViewport, {
                        opacity: detailMonthOpacity,
                        transform: [
                            { translateX: detailMonthTranslateX },
                            { translateY: detailMonthTranslateY },
                        ],
                    }]}
                >
                    {viewMode === "detail" ? (
                        <Reanimated.View
                            testID="detail-month-gesture-layer"
                            style={[
                                styles.detailMonthPagerRow,
                                { width: detailMonthPageWidth * 3 },
                                detailMonthGestureAnimatedStyle,
                            ]}
                        >
                            {detailMonthPagerDays.map((pageDay, index) => (
                                <View
                                    key={`${mode}-${firstDay}-${pageDay.slice(0, 7)}`}
                                    pointerEvents={index === 1 ? "auto" : "none"}
                                    accessibilityElementsHidden={index !== 1}
                                    importantForAccessibility={
                                        index === 1 ? "auto" : "no-hide-descendants"
                                    }
                                    style={[
                                        styles.detailMonthPagerPage,
                                        { width: detailMonthPageWidth },
                                    ]}
                                >
                                    <Calendar
                                        testID={index === 1
                                            ? "detail-month-current-calendar"
                                            : undefined}
                                        initialDate={pageDay}
                                        firstDay={firstDay}
                                        enableSwipeMonths={false}
                                        hideArrows
                                        hideDayNames
                                        hideExtraDays={false}
                                        onPressArrowLeft={index === 1
                                            ? () => animateDetailMonthChange(-1)
                                            : () => undefined}
                                        onPressArrowRight={index === 1
                                            ? () => animateDetailMonthChange(1)
                                            : () => undefined}
                                        onMonthChange={
                                            index === 1
                                                ? handleDetailMonthChange
                                                : undefined
                                        }
                                        markedDates={markedDates}
                                        dayComponent={renderDay}
                                        renderHeader={() => null}
                                        style={[
                                            styles.calendar,
                                            { backgroundColor: colors.calendarBackground },
                                        ]}
                                        theme={calendarTheme}
                                    />
                                </View>
                            ))}
                        </Reanimated.View>
                    ) : (
                        <Calendar
                            key={`${mode}-${firstDay}`}
                            initialDate={initialDate}
                            firstDay={firstDay}
                            enableSwipeMonths
                            hideArrows
                            hideDayNames
                            hideExtraDays={false}
                            onPressArrowLeft={(subtractMonth) => subtractMonth()}
                            onPressArrowRight={(addMonth) => addMonth()}
                            onMonthChange={handleDetailMonthChange}
                            markedDates={markedDates}
                            dayComponent={renderDay}
                            renderHeader={() => null}
                            style={[
                                styles.calendar,
                                { backgroundColor: colors.calendarBackground },
                            ]}
                            theme={calendarTheme}
                        />
                    )}
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    stackList: {
        flex: 1,
    },
    stackListContent: {
        paddingBottom: 24,
    },
    stackMonth: {
        borderBottomWidth: 0,
    },
    stackMonthHeader: {
        paddingHorizontal: 28,
        justifyContent: "center",
    },
    stackMonthTitle: {
        fontSize: 25,
        fontWeight: "900",
        letterSpacing: 0,
    },
    stackMonthGrid: {
        alignSelf: "stretch",
    },
    stackWeekRow: {
        position: "relative",
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    stackDayCell: {
        width: "14.2857%",
    },
    calendar: {
        paddingHorizontal: 12,
        paddingBottom: CALENDAR_CONTENT_BOTTOM_PADDING,
    },
    detailMonthPagerViewport: {
        overflow: "hidden",
        width: "100%",
    },
    detailMonthPagerRow: {
        flexDirection: "row",
    },
    detailMonthPagerPage: {
        flexShrink: 0,
    },
    monthCalendarContainer: {
        flexShrink: 0,
        overflow: "hidden",
    },
    weekdayHeader: {
        height: WEEKDAY_HEADER_HEIGHT,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
    },
    weekdayText: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 13,
        fontWeight: "600",
        opacity: 0.92,
    },
    listMonthHeader: {
        height: 58,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    listMonthTitle: {
        fontSize: 24,
        fontWeight: "800",
        letterSpacing: 0,
    },
    monthArrow: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    weekContainer: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    weekGrid: {
        flexDirection: "row",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    weekDayCell: {
        width: "14.2857%",
    },
});
