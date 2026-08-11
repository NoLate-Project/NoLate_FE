import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
} from "react";
import {
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Text,
    View,
} from "react-native";
import CustomDay from "./CustomDay";
import StackWeekEventLabels from "./StackWeekEventLabels";
import type { CalendarDayMetadata } from "../../calendarMetadata";
import {
    CALENDAR_DAY_HEIGHTS,
    isContinuousMonthViewMode,
    type CalendarViewMode,
} from "./viewMode";
import {
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    STACK_MONTH_HEADER_HEIGHT,
    STACK_MONTH_RANGE,
    WEEKDAY_HEADER_HEIGHT,
    createStackMonth,
    normalizeMonthCandidate,
    type StackMonth,
    type TodayFocusTarget,
} from "./scheduleCalendarModel";
import { createScheduleCalendarStyles } from "./ScheduleCalendar.styles";
import type { ScheduleCalendarState } from "./useScheduleCalendarState";
import type { useScheduleCalendarPresentation } from "./useScheduleCalendarPresentation";
import type { useDetailMonthCommitController } from "./useDetailMonthCommitController";

const styles = createScheduleCalendarStyles({
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
});

type CalendarPresentation = ReturnType<
    typeof useScheduleCalendarPresentation
>;
type DetailMonthCommitController = ReturnType<
    typeof useDetailMonthCommitController
>;

type UseScheduleCalendarStackParams = {
    calendarState: ScheduleCalendarState;
    calendarPresentation: CalendarPresentation;
    commitController: DetailMonthCommitController;
    calendarDaysByDate: Readonly<Record<string, CalendarDayMetadata>>;
    selectedDay: string;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    scrollRequest: number;
    transitionActive: boolean;
    transitionMonthKey?: string;
    onVisibleMonthChange: (month: string) => void;
    onOpenDay: (day: string) => void;
    todayFocusTarget?: TodayFocusTarget | null;
};

/**
 * 연속 스택 월 목록의 유한 데이터 창, 스크롤 위치 보정, 월별 그리드 렌더링을 관리한다.
 * 외부 점프 요청과 사용자 스크롤을 구분해 현재 월 콜백이 중복 발생하지 않도록 한다.
 */
export function useScheduleCalendarStack({
    calendarState,
    calendarPresentation,
    commitController,
    calendarDaysByDate,
    selectedDay,
    viewMode,
    firstDay,
    scrollRequest,
    transitionActive,
    transitionMonthKey,
    onVisibleMonthChange,
    onOpenDay,
    todayFocusTarget,
}: UseScheduleCalendarStackParams) {
    const {
        colors,
        todayDateString,
        stackTargetMonthKey,
        stackListRef,
        handledStackScrollRequestRef,
        internallyReportedStackMonthRef,
        positionedStackListSessionRef,
        positionedStackTargetMonthRef,
        stackListAnchorMonth,
        stackListSessionKey,
        activeStackMonthRef,
    } = calendarState;
    const {
        markedDates,
        stackCalendarLayout,
    } = calendarPresentation;
    const { acknowledgeTodayFocusTarget } = commitController;
    const stackMonths = useMemo(() => {
        const initialMonth = stackListAnchorMonth;
        const anchorMonthKey = `${initialMonth.getFullYear()}-${String(
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
                    monthKey === anchorMonthKey ? 0 : STACK_MONTH_HEADER_HEIGHT
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

    /** 현재 스택 월을 갱신하고 사용자 스크롤에서 발생한 변경만 부모에 보고한다. */
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
    }, [activeStackMonthRef, internallyReportedStackMonthRef]);

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
        handledStackScrollRequestRef,
        internallyReportedStackMonthRef,
        positionedStackListSessionRef,
        positionedStackTargetMonthRef,
        scrollRequest,
        stackListRef,
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

    /** 스크롤 뷰포트 중심과 가장 가까운 월을 찾아 활성 월을 연속적으로 추적한다. */
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

    /** 월 헤더·요일·일정 라벨을 포함한 연속 스택의 한 달 구간을 렌더링한다. */
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

    return {
        stackMonths,
        stackMonthLayouts,
        stackTargetMonthIndex,
        handleStackScroll,
        renderStackMonth,
    };
}
