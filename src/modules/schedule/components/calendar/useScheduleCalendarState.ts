import { useMemo, useRef, useState } from "react";
import { Animated, FlatList, useWindowDimensions } from "react-native";
import {
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";
import {
    formatLunarCalendarDay,
    type CalendarDayMetadata,
} from "../../calendarMetadata";
import { useTheme } from "../../../theme/ThemeContext";
import {
    DETAIL_MONTH_SWIPE_MOTION,
    type DetailMonthSwipeDirection,
} from "../../calendarMotion";
import {
    CALENDAR_DAY_HEIGHTS,
    isContinuousMonthViewMode,
    type CalendarViewMode,
} from "./viewMode";
import type { StackMonth } from "./scheduleCalendarModel";
import {
    DETAIL_MONTH_PAGER_POSITIONS,
    DETAIL_MONTH_PAGER_RADIUS,
    EMPTY_CALENDAR_DAYS_BY_DATE,
    STACK_MONTH_RANGE,
    createDetailMonthPagerSlots,
    getCalendarDaySelectionKey,
    getCalendarMonthOrdinal,
    getMonthDistance,
    getTodayDateString,
    normalizeMonthCandidate,
    resolveDetailMonthAnchor,
    type DetailMonthAnimationPhase,
    type DetailMonthAnimationOptions,
    type DetailMonthPageLayouts,
    type DetailMonthPendingCommand,
    type TodayFocusTarget,
} from "./scheduleCalendarModel";

type UseScheduleCalendarStateParams = {
    selectedDay: string;
    focusedMonth?: string;
    calendarDaysByDate?: Readonly<Record<string, CalendarDayMetadata>>;
    onSelectDay: (day: string) => void;
    onOpenDay: (day: string) => void;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    scrollRequest: number;
    onVisibleMonthChange: (month: string) => void;
    transitionMonthKey?: string;
    transitionActive: boolean;
    reduceMotionEnabled: boolean;
    todayFocusTarget?: TodayFocusTarget | null;
    onTodayFocusReady?: (day: string) => void;
    onDetailMonthPreview?: (day: string) => void;
    onCommitDetailMonth?: (day: string) => void;
    onDetailMonthMotionActiveChange?: (active: boolean) => void;
    detailMonthPageLayouts?: DetailMonthPageLayouts;
};

/**
 * 달력의 월 페이저·스택 목록·제스처 애니메이션이 공유하는 상태와 ref를 생성한다.
 * 제어형 props의 최신 값을 ref로 동기화해 UI 스레드 애니메이션 콜백이 오래된
 * 선택 날짜나 콜백을 참조하지 않도록 한다.
 */
export function useScheduleCalendarState({
    selectedDay,
    focusedMonth,
    calendarDaysByDate = EMPTY_CALENDAR_DAYS_BY_DATE,
    onSelectDay,
    onOpenDay,
    viewMode,
    firstDay,
    scrollRequest,
    onVisibleMonthChange,
    transitionMonthKey,
    transitionActive,
    reduceMotionEnabled,
    todayFocusTarget,
    onTodayFocusReady,
    onDetailMonthPreview,
    onCommitDetailMonth,
    onDetailMonthMotionActiveChange,
    detailMonthPageLayouts,
}: UseScheduleCalendarStateParams) {
    const { colors, mode } = useTheme();
    // 상위 화면은 분 단위로 다시 렌더링된다. 값을 mount 시점에 고정하면
    // 자정을 지난 뒤 주간 보기의 '오늘' 표시가 전날에 남는다.
    const todayDateString = getTodayDateString();
    const detailMonthSelectionLunarTextByDayKey = useMemo(() => {
        const lunarTextByDayKey: Record<number, string> = {};
        Object.entries(calendarDaysByDate).forEach(([day, metadata]) => {
            const lunarText = formatLunarCalendarDay(metadata);
            if (!lunarText) return;

            const dayKey = getCalendarDaySelectionKey(day);
            if (dayKey > 0) lunarTextByDayKey[dayKey] = lunarText;
        });
        return lunarTextByDayKey;
    }, [calendarDaysByDate]);
    const visibleMonth = normalizeMonthCandidate(transitionMonthKey)
        ?? normalizeMonthCandidate(focusedMonth)
        ?? selectedDay.slice(0, 7);
    const stackTargetMonthKey = normalizeMonthCandidate(transitionMonthKey)
        ?? normalizeMonthCandidate(focusedMonth)
        ?? selectedDay.slice(0, 7);
    const initialDate = resolveDetailMonthAnchor(selectedDay, visibleMonth);
    const initialMonthKey = initialDate.slice(0, 7);
    const [detailMonthPagerAnchorDay, setDetailMonthPagerAnchorDay] = useState(
        initialDate
    );
    const [detailMonthPagerHandoffDay, setDetailMonthPagerHandoffDay] = useState<
        string | null
    >(null);
    const [detailMonthPagerSlots, setDetailMonthPagerSlots] = useState(
        () => createDetailMonthPagerSlots(initialDate)
    );
    const detailMonthPagerSlotsRef = useRef(detailMonthPagerSlots);
    const detailMonthVisualAnchorDayRef = useRef(initialDate);
    const detailMonthSettledAnchorDayRef = useRef(initialDate);
    const detailMonthContinuousSettleCountRef = useRef(0);
    const detailMonthPendingControlledDayRef = useRef<string | null>(null);
    const detailMonthContinuousCommitTimerRef = useRef<
        ReturnType<typeof setTimeout> | null
    >(null);
    const detailMonthContinuousCommitTimerTokenRef = useRef<object | null>(
        null
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
    const { width: windowWidth } = useWindowDimensions();
    const [detailMonthViewportWidth, setDetailMonthViewportWidth] = useState(
        windowWidth
    );
    const [
        detailMonthViewportLayoutHeight,
        setDetailMonthViewportLayoutHeight,
    ] = useState<number>(DETAIL_MONTH_SWIPE_MOTION.travel);
    const detailMonthPageWidth = detailMonthViewportWidth > 0
        ? detailMonthViewportWidth
        : windowWidth;
    const detailMonthViewportHeight = useSharedValue<number>(
        DETAIL_MONTH_SWIPE_MOTION.travel
    );
    const detailMonthGesturePageHeight = useSharedValue<number>(
        DETAIL_MONTH_SWIPE_MOTION.travel
    );
    const detailMonthGesturePreviousPageHeight = useSharedValue<number>(
        DETAIL_MONTH_SWIPE_MOTION.travel
    );
    const detailMonthGestureSourceCalendarHeight = useSharedValue(0);
    const detailMonthGestureSourceDayHeight = useSharedValue(0);
    const detailMonthTranslateX = useRef(new Animated.Value(0)).current;
    const detailMonthTranslateY = useRef(new Animated.Value(0)).current;
    const detailMonthOpacity = useRef(new Animated.Value(1)).current;
    const detailMonthGestureTranslateX = useSharedValue(0);
    const detailMonthGestureTranslateY = useSharedValue(0);
    const detailMonthGestureBaseTranslateX = useSharedValue(0);
    const detailMonthGestureBaseTranslateY = useSharedValue(0);
    const detailMonthGestureOpacity = useSharedValue(1);
    const detailMonthGestureAxis = useSharedValue<0 | 1 | 2>(0);
    const detailMonthGestureCommitted = useSharedValue(false);
    const detailMonthGestureBlocked = useSharedValue(false);
    const detailMonthGestureRejected = useSharedValue(false);
    const detailMonthGestureStartedBlocked = useSharedValue(false);
    const detailMonthGestureAdoptionReady = useSharedValue(false);
    const detailMonthGestureAdoptedPresentation = useSharedValue(false);
    const detailMonthGestureSettleGeneration = useSharedValue(0);
    const detailMonthGestureActiveSettleDirection =
        useSharedValue<-1 | 0 | 1>(0);
    const detailMonthGestureActiveSettleAxis =
        useSharedValue<0 | 1 | 2>(0);
    const detailMonthGestureActiveSettleTargetOffset = useSharedValue(0);
    const detailMonthGestureQueuedDirection = useSharedValue<-1 | 0 | 1>(0);
    const detailMonthGestureQueuedAxis = useSharedValue<0 | 1 | 2>(0);
    const detailMonthVisualMonthOrdinal = useSharedValue(
        getCalendarMonthOrdinal(initialDate)
    );
    const detailMonthPagerWindowStartOrdinal = useSharedValue(
        getCalendarMonthOrdinal(initialDate) - DETAIL_MONTH_PAGER_RADIUS
    );
    const detailMonthPagerSlotCalendarHeights = useSharedValue<number[]>(
        DETAIL_MONTH_PAGER_POSITIONS.map(
            () => DETAIL_MONTH_SWIPE_MOTION.travel
        )
    );
    const detailMonthPagerSlotPageHeights = useSharedValue<number[]>(
        DETAIL_MONTH_PAGER_POSITIONS.map(
            () => DETAIL_MONTH_SWIPE_MOTION.travel
        )
    );
    const detailMonthPagerSlotDayHeights = useSharedValue<number[]>(
        DETAIL_MONTH_PAGER_POSITIONS.map(
            () => CALENDAR_DAY_HEIGHTS.detail
        )
    );
    const detailMonthVisualSelectedDayKey = useSharedValue(
        getCalendarDaySelectionKey(initialDate)
    );
    const detailMonthContinuousCommitPending = useSharedValue(false);
    const detailMonthContinuousCommitGeneration = useSharedValue(0);
    const detailMonthGestureAnimatedStyle = useAnimatedStyle(() => ({
        opacity: detailMonthGestureOpacity.value,
        transform: [
            { translateX: detailMonthGestureTranslateX.value },
            { translateY: detailMonthGestureTranslateY.value },
        ],
    }));
    const detailMonthAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
    const detailMonthAnimationFrameRef = useRef<number | null>(null);
    const detailMonthPagerHandoffFrameRef = useRef<number | null>(null);
    const detailMonthPagerRebaseFrameRef = useRef<number | null>(null);
    const detailMonthPagerRebasePendingRef = useRef<string | null>(null);
    const detailMonthCommitWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const detailMonthDeadlineWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const detailMonthAnimationActiveRef = useRef(false);
    const detailMonthAnimationPhaseRef = useRef<DetailMonthAnimationPhase>("idle");
    const detailMonthAnimationGenerationRef = useRef(0);
    const detailMonthAnimationSourceDayRef = useRef<string | null>(null);
    const detailMonthAnimationExpectedDayRef = useRef<string | null>(null);
    const detailMonthPreviewedDayRef = useRef<string | null>(null);
    const detailMonthSuppressedCommitRef = useRef<string | null>(null);
    const detailMonthAnimationPendingCommandsRef = useRef<
        DetailMonthPendingCommand[]
    >([]);
    const detailMonthAnimationEnterDurationRef = useRef(0);
    const detailMonthAnimationStartedAtRef = useRef(0);
    const detailMonthAnimationReduceMotionRef = useRef(reduceMotionEnabled);
    const detailMonthAnimationUsesPagerRef = useRef(false);
    const detailMonthAnimationUsesGestureLayerRef = useRef(false);
    const detailMonthAnimationAxisRef = useRef<"horizontal" | "vertical">(
        "horizontal"
    );
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
        direction: DetailMonthSwipeDirection,
        options?: DetailMonthAnimationOptions
    ) => void>(() => undefined);
    const onSelectDayRef = useRef(onSelectDay);
    const onOpenDayRef = useRef(onOpenDay);
    const onVisibleMonthChangeRef = useRef(onVisibleMonthChange);
    const onDetailMonthPreviewRef = useRef(onDetailMonthPreview);
    const onCommitDetailMonthRef = useRef(onCommitDetailMonth);
    const onDetailMonthMotionActiveChangeRef = useRef(
        onDetailMonthMotionActiveChange
    );
    const detailMonthMotionOwnershipActiveRef = useRef(false);
    const detailMonthPageLayoutsRef = useRef(detailMonthPageLayouts);

    detailMonthLatestSelectedDayRef.current = selectedDay;
    detailMonthLatestVisibleMonthRef.current = visibleMonth;
    detailMonthLatestViewModeRef.current = viewMode;
    detailMonthLatestReduceMotionRef.current = reduceMotionEnabled;
    detailMonthLatestTransitionActiveRef.current = transitionActive;
    todayFocusTargetRef.current = todayFocusTarget;
    onTodayFocusReadyRef.current = onTodayFocusReady;
    onSelectDayRef.current = onSelectDay;
    onOpenDayRef.current = onOpenDay;
    onVisibleMonthChangeRef.current = onVisibleMonthChange;
    onDetailMonthPreviewRef.current = onDetailMonthPreview;
    onCommitDetailMonthRef.current = onCommitDetailMonth;
    onDetailMonthMotionActiveChangeRef.current =
        onDetailMonthMotionActiveChange;
    detailMonthPageLayoutsRef.current = detailMonthPageLayouts;



    return {
        colors,
        mode,
        todayDateString,
        detailMonthSelectionLunarTextByDayKey,
        visibleMonth,
        stackTargetMonthKey,
        initialDate,
        initialMonthKey,
        detailMonthPagerAnchorDay,
        setDetailMonthPagerAnchorDay,
        detailMonthPagerHandoffDay,
        setDetailMonthPagerHandoffDay,
        detailMonthPagerSlots,
        setDetailMonthPagerSlots,
        detailMonthPagerSlotsRef,
        detailMonthVisualAnchorDayRef,
        detailMonthSettledAnchorDayRef,
        detailMonthContinuousSettleCountRef,
        detailMonthPendingControlledDayRef,
        detailMonthContinuousCommitTimerRef,
        detailMonthContinuousCommitTimerTokenRef,
        stackListRef,
        handledStackScrollRequestRef,
        internallyReportedStackMonthRef,
        positionedStackListSessionRef,
        positionedStackTargetMonthRef,
        stackListBaseKey,
        stackListSessionRef,
        stackTargetOutsideRange,
        stackListAnchorMonth,
        stackListAnchorKey,
        stackListSessionKey,
        activeStackMonthRef,
        windowWidth,
        detailMonthViewportWidth,
        setDetailMonthViewportWidth,
        detailMonthViewportLayoutHeight,
        setDetailMonthViewportLayoutHeight,
        detailMonthPageWidth,
        detailMonthViewportHeight,
        detailMonthGesturePageHeight,
        detailMonthGesturePreviousPageHeight,
        detailMonthGestureSourceCalendarHeight,
        detailMonthGestureSourceDayHeight,
        detailMonthTranslateX,
        detailMonthTranslateY,
        detailMonthOpacity,
        detailMonthGestureTranslateX,
        detailMonthGestureTranslateY,
        detailMonthGestureBaseTranslateX,
        detailMonthGestureBaseTranslateY,
        detailMonthGestureOpacity,
        detailMonthGestureAxis,
        detailMonthGestureCommitted,
        detailMonthGestureBlocked,
        detailMonthGestureRejected,
        detailMonthGestureStartedBlocked,
        detailMonthGestureAdoptionReady,
        detailMonthGestureAdoptedPresentation,
        detailMonthGestureSettleGeneration,
        detailMonthGestureActiveSettleDirection,
        detailMonthGestureActiveSettleAxis,
        detailMonthGestureActiveSettleTargetOffset,
        detailMonthGestureQueuedDirection,
        detailMonthGestureQueuedAxis,
        detailMonthVisualMonthOrdinal,
        detailMonthPagerWindowStartOrdinal,
        detailMonthPagerSlotCalendarHeights,
        detailMonthPagerSlotPageHeights,
        detailMonthPagerSlotDayHeights,
        detailMonthVisualSelectedDayKey,
        detailMonthContinuousCommitPending,
        detailMonthContinuousCommitGeneration,
        detailMonthGestureAnimatedStyle,
        detailMonthAnimationRef,
        detailMonthAnimationFrameRef,
        detailMonthPagerHandoffFrameRef,
        detailMonthPagerRebaseFrameRef,
        detailMonthPagerRebasePendingRef,
        detailMonthCommitWatchdogRef,
        detailMonthDeadlineWatchdogRef,
        detailMonthAnimationActiveRef,
        detailMonthAnimationPhaseRef,
        detailMonthAnimationGenerationRef,
        detailMonthAnimationSourceDayRef,
        detailMonthAnimationExpectedDayRef,
        detailMonthPreviewedDayRef,
        detailMonthSuppressedCommitRef,
        detailMonthAnimationPendingCommandsRef,
        detailMonthAnimationEnterDurationRef,
        detailMonthAnimationStartedAtRef,
        detailMonthAnimationReduceMotionRef,
        detailMonthAnimationUsesPagerRef,
        detailMonthAnimationUsesGestureLayerRef,
        detailMonthAnimationAxisRef,
        detailMonthGestureResetAnimationRef,
        detailMonthLatestSelectedDayRef,
        detailMonthLatestVisibleMonthRef,
        detailMonthLatestViewModeRef,
        detailMonthLatestReduceMotionRef,
        detailMonthLatestTransitionActiveRef,
        todayFocusTargetRef,
        acknowledgedTodayFocusTargetRef,
        onTodayFocusReadyRef,
        startDetailMonthAnimationRef,
        onSelectDayRef,
        onOpenDayRef,
        onVisibleMonthChangeRef,
        onDetailMonthPreviewRef,
        onCommitDetailMonthRef,
        onDetailMonthMotionActiveChangeRef,
        detailMonthMotionOwnershipActiveRef,
        detailMonthPageLayoutsRef,
    };
}

export type ScheduleCalendarState = ReturnType<typeof useScheduleCalendarState>;
