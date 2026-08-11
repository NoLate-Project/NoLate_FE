import React, { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { Calendar } from "react-native-calendars";
import { runOnJS, type SharedValue } from "react-native-reanimated";
import type { ScheduleItem } from "../../types";
import type { CalendarDayMetadata } from "../../calendarMetadata";
import CustomDay from "./CustomDay";
import {
    createStackCalendarLayout,
    enumerateStackScheduleDays,
} from "./stackCalendarLayout";
import type { CalendarViewMode } from "./viewMode";
import { DETAIL_MONTH_SWIPE_GESTURE } from "../../calendarMotion";
import {
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_BOTTOM_MARGIN,
    CALENDAR_HEADER_SPACING,
    CALENDAR_HEADER_TOP_MARGIN,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
    WEEKDAYS,
    compareMarkedEvents,
    getCalendarDaySelectionKey,
    type CalendarDayComponentProps,
} from "./scheduleCalendarModel";
import {
    DETAIL_MONTH_GRID_CELL_COUNT,
    DETAIL_MONTH_GRID_COLUMN_COUNT,
    DETAIL_MONTH_GRID_ROW_COUNT,
    getDetailMonthPageModel,
} from "./DetailMonthPagerSelection";
import { createScheduleCalendarStyles } from "./ScheduleCalendar.styles";
import type { ScheduleCalendarState } from "./useScheduleCalendarState";
import type { useDetailMonthPanGesture } from "./useDetailMonthPanGesture";
import type { useDetailMonthCommitController } from "./useDetailMonthCommitController";

const styles = createScheduleCalendarStyles({
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
});

type DetailMonthPanGesture = ReturnType<typeof useDetailMonthPanGesture>;
type DetailMonthCommitController = ReturnType<
    typeof useDetailMonthCommitController
>;

type UseScheduleCalendarPresentationParams = {
    calendarState: ScheduleCalendarState;
    items: ScheduleItem[];
    calendarDaysByDate: Readonly<Record<string, CalendarDayMetadata>>;
    selectedDay: string;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    transitionActive: boolean;
    detailMonthPanGesture: DetailMonthPanGesture;
    commitController: DetailMonthCommitController;
    todayFocusTarget?: { day: string } | null;
    animatedDayHeight?: SharedValue<number>;
};

/**
 * 일정 마킹, 날짜 셀 입력 제스처, Calendar 테마와 요일 헤더를 구성한다.
 * 일반 Calendar와 상세 월 커스텀 그리드가 같은 선택·열기 규칙과 메타데이터를
 * 사용하도록 날짜 입력 경계를 한곳에 모은다.
 */
export function useScheduleCalendarPresentation({
    calendarState,
    items,
    calendarDaysByDate,
    selectedDay,
    viewMode,
    firstDay,
    transitionActive,
    detailMonthPanGesture,
    commitController,
    todayFocusTarget,
    animatedDayHeight,
}: UseScheduleCalendarPresentationParams) {
    const {
        colors,
        detailMonthVisualAnchorDayRef,
        detailMonthSettledAnchorDayRef,
        detailMonthPendingControlledDayRef,
        detailMonthPageWidth,
        detailMonthGestureBlocked,
        detailMonthVisualMonthOrdinal,
        detailMonthPagerWindowStartOrdinal,
        detailMonthPagerSlotDayHeights,
        detailMonthVisualSelectedDayKey,
        detailMonthAnimationActiveRef,
        detailMonthLatestSelectedDayRef,
        detailMonthLatestVisibleMonthRef,
        detailMonthLatestViewModeRef,
        startDetailMonthAnimationRef,
        onOpenDayRef,
    } = calendarState;
    const {
        commitDetailMonthControlledState,
        discardDetailMonthContinuousCommit,
    } = commitController;
    const calendarEventMarkings = useMemo(() => {
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

        return dateMap;
    }, [items]);
    const markedDates = useMemo(() => ({
        ...calendarEventMarkings,
        [selectedDay]: {
            ...(calendarEventMarkings[selectedDay] ?? {}),
            selected: true,
        },
    }), [calendarEventMarkings, selectedDay]);
    const stackCalendarLayout = useMemo(
        () => createStackCalendarLayout(items, firstDay),
        [firstDay, items]
    );

    /** 날짜 탭을 현재 보기 모드에 맞춰 상세 월 커밋 또는 일반 일자 열기로 분기한다. */
    const handleCalendarDayPress = useCallback((day: {
        dateString: string;
    }) => {
        if (detailMonthAnimationActiveRef.current) return;
        if (detailMonthLatestViewModeRef.current === "detail") {
            const latestSelectedDay =
                detailMonthLatestSelectedDayRef.current;
            const visualAnchorDay =
                detailMonthVisualAnchorDayRef.current;
            const visualMonth = visualAnchorDay.slice(0, 7);
            const targetMonth = day.dateString.slice(0, 7);
            if (
                day.dateString === latestSelectedDay
                && targetMonth === visualMonth
                && detailMonthPendingControlledDayRef.current === null
            ) {
                onOpenDayRef.current(day.dateString);
                return;
            }
            // A tap supersedes a burst-idle month commit. Otherwise that old
            // timer can commit after this press and move the selection back.
            discardDetailMonthContinuousCommit();
            detailMonthVisualSelectedDayKey.value =
                getCalendarDaySelectionKey(day.dateString);
            if (targetMonth !== visualMonth) {
                // The visual pager can be ahead of controlled props during
                // the idle window. Seed the adjacent-day transition from the
                // page the user actually touched, not the older store month.
                detailMonthLatestSelectedDayRef.current = visualAnchorDay;
                detailMonthLatestVisibleMonthRef.current = visualMonth;
                startDetailMonthAnimationRef.current(
                    targetMonth < visualMonth ? -1 : 1,
                    {
                        targetDay: day.dateString,
                        gestureAxis: "vertical",
                    }
                );
                return;
            }
            detailMonthVisualAnchorDayRef.current = day.dateString;
            detailMonthSettledAnchorDayRef.current = day.dateString;
            detailMonthLatestSelectedDayRef.current = day.dateString;
            detailMonthLatestVisibleMonthRef.current = targetMonth;
            commitDetailMonthControlledState(day.dateString);
            return;
        }
        onOpenDayRef.current(day.dateString);
    }, [
        commitDetailMonthControlledState,
        detailMonthAnimationActiveRef,
        detailMonthLatestSelectedDayRef,
        detailMonthLatestViewModeRef,
        detailMonthLatestVisibleMonthRef,
        detailMonthPendingControlledDayRef,
        detailMonthSettledAnchorDayRef,
        detailMonthVisualAnchorDayRef,
        detailMonthVisualSelectedDayKey,
        discardDetailMonthContinuousCommit,
        onOpenDayRef,
        startDetailMonthAnimationRef,
    ]);
    /** UI 스레드가 전달한 월 순번과 셀 위치를 실제 날짜로 복원해 공통 날짜 탭 흐름으로 보낸다. */
    const handleDetailMonthTapCell = useCallback((
        monthOrdinal: number,
        cellIndex: number
    ) => {
        if (
            !Number.isInteger(monthOrdinal)
            || !Number.isInteger(cellIndex)
            || cellIndex < 0
            || cellIndex >= DETAIL_MONTH_GRID_CELL_COUNT
        ) return;

        const year = Math.floor(monthOrdinal / 12);
        const month = monthOrdinal - year * 12 + 1;
        const monthDay = `${year}-${String(month).padStart(2, "0")}-01`;
        const model = getDetailMonthPageModel(monthDay, firstDay);
        // Four- and five-week months keep hidden rows mounted for stable
        // geometry. Coordinates in those rows are not calendar taps.
        if (cellIndex >= model.weekCount * DETAIL_MONTH_GRID_COLUMN_COUNT) {
            return;
        }
        const date = model.dates[cellIndex];
        if (date) handleCalendarDayPress(date);
    }, [firstDay, handleCalendarDayPress]);
    const detailMonthTapGesture = useMemo(() => Gesture.Tap()
        .enabled(
            viewMode === "detail"
            && !transitionActive
            && !todayFocusTarget
            && detailMonthPageWidth > 0
        )
        .maxDistance(DETAIL_MONTH_SWIPE_GESTURE.activationDistance)
        .withTestId("detail-month-tap-gesture")
        .onEnd((event, success) => {
            "worklet";

            if (!success || detailMonthGestureBlocked.value) return;
            const slotId = detailMonthVisualMonthOrdinal.value
                - detailMonthPagerWindowStartOrdinal.value;
            const slotDayHeights = detailMonthPagerSlotDayHeights.value;
            if (slotId < 0 || slotId >= slotDayHeights.length) return;

            const cellHeight = Math.max(32, slotDayHeights[slotId]);
            const contentWidth = detailMonthPageWidth
                - DETAIL_MONTH_GRID_HORIZONTAL_PADDING * 2;
            const contentX = event.x
                - DETAIL_MONTH_GRID_HORIZONTAL_PADDING;
            const contentY = event.y - CALENDAR_HEADER_SPACING;
            if (
                contentWidth <= 0
                || contentX < 0
                || contentX >= contentWidth
                || contentY < 0
                || contentY
                    >= cellHeight * DETAIL_MONTH_GRID_ROW_COUNT
            ) return;

            const column = Math.floor(
                contentX / (
                    contentWidth / DETAIL_MONTH_GRID_COLUMN_COUNT
                )
            );
            const row = Math.floor(contentY / cellHeight);
            runOnJS(handleDetailMonthTapCell)(
                detailMonthVisualMonthOrdinal.value,
                row * DETAIL_MONTH_GRID_COLUMN_COUNT + column
            );
        }), [
        detailMonthGestureBlocked,
        detailMonthPageWidth,
        detailMonthPagerSlotDayHeights,
        detailMonthPagerWindowStartOrdinal,
        detailMonthVisualMonthOrdinal,
        handleDetailMonthTapCell,
        todayFocusTarget,
        transitionActive,
        viewMode,
    ]);
    const detailMonthInputGesture = useMemo(
        () => Gesture.Exclusive(
            detailMonthPanGesture,
            detailMonthTapGesture
        ),
        [detailMonthPanGesture, detailMonthTapGesture]
    );
    /** 비제어 달력 셀에 일정 표시와 음력 메타데이터를 결합해 렌더링한다. */
    const renderDay = useCallback((
        { date, state, marking }: CalendarDayComponentProps,
        detailCellHeight?: number,
        dayMetadata?: CalendarDayMetadata,
        detailPagerMonthOrdinal?: number
    ) => (
        <CustomDay
            date={date}
            state={state}
            marking={marking}
            dayMetadata={dayMetadata}
            viewMode={viewMode}
            animatedCellHeight={animatedDayHeight}
            animatedSelectedDayKey={
                viewMode === "detail"
                    ? detailMonthVisualSelectedDayKey
                    : undefined
            }
            detailPagerMonthOrdinal={detailPagerMonthOrdinal}
            detailCellHeight={detailCellHeight}
            isSelectedDay={Boolean(marking?.selected)}
            allowDisabledPress={
                viewMode === "detail"
            }
            onPress={handleCalendarDayPress}
        />
    ), [
        animatedDayHeight,
        detailMonthVisualSelectedDayKey,
        handleCalendarDayPress,
        viewMode,
    ]);
    /** 전환 중에도 선택 일자를 명시적으로 주입해 제어형 달력 셀의 표시를 안정화한다. */
    const renderControlledDay = useCallback((
        props: CalendarDayComponentProps,
        detailCellHeight?: number
    ) => renderDay(
        props,
        detailCellHeight,
        props.date
            ? calendarDaysByDate[props.date.dateString]
            : undefined
    ), [calendarDaysByDate, renderDay]);

    const calendarTheme = useMemo(() => ({
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
    } as React.ComponentProps<typeof Calendar>["theme"] & Record<string, unknown>), [
        colors.arrowColor,
        colors.calendarBackground,
        colors.dayHeaderColor,
        colors.monthTextColor,
    ]);

    const weekdayLabels = useMemo(() => (
        Array.from({ length: 7 }, (_, index) => WEEKDAYS[(firstDay + index) % 7])
    ), [firstDay]);
    const weekdayHeader = useMemo(() => (
        <View
            style={[
                styles.weekdayHeader,
                {
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

    return {
        calendarEventMarkings,
        markedDates,
        stackCalendarLayout,
        handleCalendarDayPress,
        handleDetailMonthTapCell,
        detailMonthTapGesture,
        detailMonthInputGesture,
        renderDay,
        renderControlledDay,
        calendarTheme,
        weekdayLabels,
        weekdayHeader,
    };
}
