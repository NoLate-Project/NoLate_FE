import { createScheduleCalendarStyles } from "./ScheduleCalendar.styles";
import { useCallback, useMemo } from "react";
import {
    Animated,
    FlatList,
    Pressable,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GestureDetector } from "react-native-gesture-handler";
import { Calendar } from "react-native-calendars";
import Reanimated, { type SharedValue } from "react-native-reanimated";
import type { ScheduleItem } from "../../types";
import type { CalendarDayMetadata } from "../../calendarMetadata";
import type { DetailMonthSwipeDirection } from "../../calendarMotion";
import CustomDay from "./CustomDay";
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
    onDetailMonthPreview?: (day: string) => void;
    onCommitDetailMonth?: (day: string) => void;
    onDetailMonthMotionActiveChange?: (active: boolean) => void;
    detailMonthMotionActive?: SharedValue<boolean>;
    animatedCalendarHeight?: SharedValue<number>;
    animatedDayHeight?: SharedValue<number>;
    detailMonthPageLayouts?: DetailMonthPageLayouts;
    bottomContentInset?: number;
};

import {
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    EMPTY_CALENDAR_DAYS_BY_DATE,
    STACK_MONTH_RANGE,
    WEEKDAY_HEADER_HEIGHT,
    createWeekDays,
    formatWeekTitle,
    getCalendarDaySelectionKey,
    getCalendarMonthOrdinal,
    moveDay,
    resolveDetailMonthPagerLayout,
    type DetailMonthPageLayouts,
    type TodayFocusTarget,
} from "./scheduleCalendarModel";

import { DetailMonthPagerPageFrame } from "./DetailMonthPagerPageFrame";

import { DetailMonthPagerGrid } from "./DetailMonthPagerGrid";
import { DetailMonthPagerSelectionLayer } from "./DetailMonthPagerSelection";
import { useScheduleCalendarState } from "./useScheduleCalendarState";
import { useDetailMonthCommitController } from "./useDetailMonthCommitController";
import { useDetailMonthAnimationController } from "./useDetailMonthAnimationController";
import { useDetailMonthChangeAnimation } from "./useDetailMonthChangeAnimation";
import { useDetailMonthGestureSettling } from "./useDetailMonthGestureSettling";
import { useDetailMonthPanWorklets } from "./useDetailMonthPanWorklets";
import { useDetailMonthPanGesture } from "./useDetailMonthPanGesture";
import { useDetailMonthPagerSynchronization } from "./useDetailMonthPagerSynchronization";
import { useScheduleCalendarPresentation } from "./useScheduleCalendarPresentation";
import { useScheduleCalendarStack } from "./useScheduleCalendarStack";

export {
    getFixedScheduleCalendarHeight,
    type DetailMonthPageLayouts,
    type DetailMonthWeekCount,
    type TodayFocusTarget,
} from "./scheduleCalendarModel";
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
    onDetailMonthPreview,
    onCommitDetailMonth,
    onDetailMonthMotionActiveChange,
    detailMonthMotionActive,
    animatedCalendarHeight,
    animatedDayHeight,
    detailMonthPageLayouts,
    bottomContentInset = 0,
}: Props) {
    const calendarState = useScheduleCalendarState({
        selectedDay,
        focusedMonth,
        calendarDaysByDate,
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
    });
    const {
        colors, mode, todayDateString, detailMonthSelectionLunarTextByDayKey,
        visibleMonth,
        initialDate, initialMonthKey, detailMonthPagerAnchorDay,
        detailMonthPagerSlots, stackListRef, stackListSessionKey,
        detailMonthPageWidth, detailMonthViewportLayoutHeight,
        detailMonthTranslateX, detailMonthTranslateY, detailMonthOpacity,
        detailMonthGestureAxis, detailMonthVisualMonthOrdinal,
        detailMonthPagerWindowStartOrdinal, detailMonthPagerSlotPageHeights,
        detailMonthPagerSlotDayHeights, detailMonthVisualSelectedDayKey,
        detailMonthGestureAnimatedStyle,
    } = calendarState;
    const detailMonthCommitController = useDetailMonthCommitController({
        calendarState,
        selectedDay,
        firstDay,
        headerOffset,
        detailMonthPageLayouts,
    });
    const detailMonthAnimationController =
        useDetailMonthAnimationController({
            calendarState,
            commitController: detailMonthCommitController,
            animatedCalendarHeight,
            animatedDayHeight,
            detailMonthMotionActive,
            onRegisterDetailMonthMotionCancel,
            todayFocusTarget,
        });
    const { handleDetailMonthChange } = detailMonthAnimationController;
    useDetailMonthChangeAnimation({
        calendarState,
        commitController: detailMonthCommitController,
        animationController: detailMonthAnimationController,
        animatedCalendarHeight,
        animatedDayHeight,
        detailMonthMotionActive,
    });
    const detailMonthGestureSettling = useDetailMonthGestureSettling({
        calendarState,
        commitController: detailMonthCommitController,
        headerOffset,
        onRegisterDetailMonthMotionShift,
    });
    const { handleDetailMonthViewportLayout, shiftContinuousDetailMonthPager } =
        detailMonthGestureSettling;
    const detailMonthPanWorklets = useDetailMonthPanWorklets({
        calendarState,
        commitController: detailMonthCommitController,
        gestureSettling: detailMonthGestureSettling,
        detailMonthPageWidth,
        headerOffset,
        reduceMotionEnabled,
        animatedCalendarHeight,
        animatedDayHeight,
        detailMonthMotionActive,
    });
    const detailMonthPanGesture = useDetailMonthPanGesture({
        calendarState,
        commitController: detailMonthCommitController,
        panWorklets: detailMonthPanWorklets,
        viewMode,
        transitionActive,
        todayFocusTarget,
        detailMonthPageWidth,
        animatedCalendarHeight,
        animatedDayHeight,
    });
    useDetailMonthPagerSynchronization({
        calendarState,
        commitController: detailMonthCommitController,
        animationController: detailMonthAnimationController,
        selectedDay,
        visibleMonth,
        viewMode,
        transitionActive,
        transitionMonthKey,
        reduceMotionEnabled,
        todayFocusTarget,
    });
    const calendarPresentation = useScheduleCalendarPresentation({
        calendarState,
        items,
        calendarDaysByDate,
        selectedDay,
        viewMode,
        firstDay,
        transitionActive,
        detailMonthPanGesture,
        commitController: detailMonthCommitController,
        todayFocusTarget,
        animatedDayHeight,
    });
    const {
        calendarEventMarkings,
        markedDates,
        handleCalendarDayPress,
        detailMonthInputGesture,
        renderControlledDay,
        calendarTheme,
        weekdayHeader,
    } = calendarPresentation;
    const calendarStack = useScheduleCalendarStack({
        calendarState,
        calendarPresentation,
        commitController: detailMonthCommitController,
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
    });
    const {
        stackMonths,
        stackMonthLayouts,
        stackTargetMonthIndex,
        handleStackScroll,
        renderStackMonth,
    } = calendarStack;
    const selectedWeekDays = useMemo(
        () => createWeekDays(selectedDay, firstDay),
        [firstDay, selectedDay]
    );
    const resolveDetailMonthPagerPageLayout = useCallback((day: string) => {
        return resolveDetailMonthPagerLayout(
            day,
            detailMonthPageLayouts,
            initialMonthKey,
            firstDay
        );
    }, [detailMonthPageLayouts, firstDay, initialMonthKey]);
    const detailMonthPagerPages = useMemo(() => {
        const accessibleOrdinal = getCalendarMonthOrdinal(
            detailMonthPagerAnchorDay
        );
        const pages = detailMonthPagerSlots.map((slot) => {
            const layout = resolveDetailMonthPagerPageLayout(slot.day);
            const accessiblePosition = slot.monthOrdinal - accessibleOrdinal;
            const positionName = accessiblePosition === 0
                ? "current"
                : accessiblePosition === -1
                    ? "previous"
                    : accessiblePosition === 1
                        ? "next"
                        : accessiblePosition === -2
                            ? "before-previous"
                            : "after-next";
            return {
                ...slot,
                key: `month-${slot.day.slice(0, 7)}`,
                layout,
                current: accessiblePosition === 0,
                accessiblePosition,
                positionName,
            };
        });

        // Preserve the historical centre-five render order used by the
        // transition/test harness while mounting the wider cold window first.
        return pages.sort((left, right) => {
            const leftIsNear = Math.abs(left.accessiblePosition) <= 2;
            const rightIsNear = Math.abs(right.accessiblePosition) <= 2;
            if (leftIsNear !== rightIsNear) return leftIsNear ? 1 : -1;
            return left.monthOrdinal - right.monthOrdinal;
        });
    }, [
        detailMonthPagerAnchorDay,
        detailMonthPagerSlots,
        resolveDetailMonthPagerPageLayout,
    ]);
    const detailMonthPagerCanvasHeight = useMemo(() => Math.max(
        1,
        detailMonthViewportLayoutHeight,
        ...detailMonthPagerPages.map((page) => (
            page.layout
                ? page.layout.calendarHeight - Math.max(0, headerOffset)
                : 0
        ))
    ), [
        detailMonthPagerPages,
        detailMonthViewportLayoutHeight,
        headerOffset,
    ]);
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
                style={[
                    styles.detailMonthPagerViewport,
                    { height: detailMonthPagerCanvasHeight },
                ]}
                onLayout={handleDetailMonthViewportLayout}
            >
                <GestureDetector gesture={detailMonthInputGesture}>
                    <Animated.View
                        testID="detail-month-animated-layer"
                        style={[
                            styles.detailMonthPagerViewport,
                            {
                                height: detailMonthPagerCanvasHeight,
                                opacity: detailMonthOpacity,
                                transform: [
                                    { translateX: detailMonthTranslateX },
                                    { translateY: detailMonthTranslateY },
                                ],
                            },
                        ]}
                    >
                        {viewMode === "detail" && !transitionActive ? (
                            <Reanimated.View
                                testID="detail-month-gesture-layer"
                                style={[
                                    styles.detailMonthPagerCanvas,
                                    detailMonthGestureAnimatedStyle,
                                    {
                                        height: detailMonthPagerCanvasHeight,
                                        backgroundColor:
                                            colors.calendarBackground,
                                    },
                                ]}
                            >
                                <DetailMonthPagerSelectionLayer
                                    pageWidth={detailMonthPageWidth}
                                    firstDay={firstDay}
                                    todayKey={getCalendarDaySelectionKey(
                                        todayDateString
                                    )}
                                    animatedSelectedDayKey={
                                        detailMonthVisualSelectedDayKey
                                    }
                                    visualMonthOrdinal={
                                        detailMonthVisualMonthOrdinal
                                    }
                                    windowStartOrdinal={
                                        detailMonthPagerWindowStartOrdinal
                                    }
                                    slotPageHeights={
                                        detailMonthPagerSlotPageHeights
                                    }
                                    slotDayHeights={
                                        detailMonthPagerSlotDayHeights
                                    }
                                    axis={detailMonthGestureAxis}
                                    selectedDayBackground={
                                        colors.selectedDayBg
                                    }
                                    selectedDayText={colors.selectedDayText}
                                    lunarTextByDayKey={
                                        detailMonthSelectionLunarTextByDayKey
                                    }
                                    initialSelectedDayKey={
                                        getCalendarDaySelectionKey(initialDate)
                                    }
                                    initialVisualMonthOrdinal={
                                        getCalendarMonthOrdinal(
                                            detailMonthPagerAnchorDay
                                        )
                                    }
                                >
                                    {detailMonthPagerPages.map((page) => (
                                        <DetailMonthPagerPageFrame
                                            key={`${page.key}-${mode}-${firstDay}`}
                                            pageOrdinal={page.monthOrdinal}
                                            current={page.current}
                                            pageWidth={detailMonthPageWidth}
                                            axis={detailMonthGestureAxis}
                                            visualMonthOrdinal={
                                                detailMonthVisualMonthOrdinal
                                            }
                                            windowStartOrdinal={
                                                detailMonthPagerWindowStartOrdinal
                                            }
                                            slotPageHeights={
                                                detailMonthPagerSlotPageHeights
                                            }
                                            pageTestID={`detail-month-page-${page.positionName}-${page.day.slice(0, 7)}`}
                                        >
                                            <DetailMonthPagerGrid
                                                day={page.day}
                                                firstDay={firstDay}
                                                markedDates={
                                                    calendarEventMarkings
                                                }
                                                calendarDaysByDate={
                                                    calendarDaysByDate
                                                }
                                                detailCellHeight={
                                                    page.layout?.dayHeight
                                                }
                                                todayDateString={
                                                    todayDateString
                                                }
                                                textPrimary={
                                                    colors.textPrimary
                                                }
                                                textSecondary={
                                                    colors.textSecondary
                                                }
                                                colorMode={mode}
                                                onPress={
                                                    handleCalendarDayPress
                                                }
                                                onShift={
                                                    shiftContinuousDetailMonthPager
                                                }
                                            />
                                        </DetailMonthPagerPageFrame>
                                    ))}
                                </DetailMonthPagerSelectionLayer>
                            </Reanimated.View>
                        ) : (
                            <Calendar
                                key={viewMode === "detail"
                                    ? `detail-transition-${initialDate.slice(0, 7)}-${mode}-${firstDay}`
                                    : `${mode}-${firstDay}`}
                                testID={viewMode === "detail"
                                    ? "detail-month-transition-calendar"
                                    : undefined}
                                initialDate={initialDate}
                                firstDay={firstDay}
                                enableSwipeMonths={viewMode !== "detail"}
                                hideArrows
                                hideDayNames
                                hideExtraDays={false}
                                onPressArrowLeft={viewMode === "detail"
                                    ? () => undefined
                                    : (subtractMonth) => subtractMonth()}
                                onPressArrowRight={viewMode === "detail"
                                    ? () => undefined
                                    : (addMonth) => addMonth()}
                                onMonthChange={viewMode === "detail"
                                    ? undefined
                                    : handleDetailMonthChange}
                                markedDates={markedDates}
                                dayComponent={renderControlledDay}
                                renderHeader={() => null}
                                style={[
                                    styles.calendar,
                                    { backgroundColor: colors.calendarBackground },
                                ]}
                                theme={calendarTheme}
                            />
                        )}
                    </Animated.View>
                </GestureDetector>
            </View>
        </View>
    );
}

const styles = createScheduleCalendarStyles({
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
});
