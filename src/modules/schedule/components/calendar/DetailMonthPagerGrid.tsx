import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";
import type { DateData } from "react-native-calendars";

import {
    formatLunarCalendarDay,
    type CalendarDayMetadata,
} from "../../calendarMetadata";
import { getCalendarTodayAccent } from "./calendarTodayAccent";
import {
    DETAIL_MONTH_EVENT_MARKER_LIMIT,
    DETAIL_MONTH_GRID_COLUMN_COUNT,
    DETAIL_MONTH_GRID_ROW_COUNT,
    getDetailMonthCellGeometry,
    getDetailMonthPageModel,
    getDetailMonthTravelIconName,
    type DetailMonthCellGeometry,
    type DetailMonthPageModel,
    type DetailMonthPagerGridProps,
} from "./DetailMonthPagerSelection";
import {
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
    type CalendarDayComponentProps,
} from "./scheduleCalendarModel";
import { createScheduleCalendarStyles } from "./ScheduleCalendar.styles";
import { CALENDAR_DAY_HEIGHTS } from "./viewMode";

export type DetailMonthGridCellProps = {
    model: DetailMonthPageModel;
    date: DateData;
    cellHeight: number;
    geometry: DetailMonthCellGeometry;
    marking?: CalendarDayComponentProps["marking"];
    metadata?: CalendarDayMetadata;
    todayDateString: string;
    textPrimary: string;
    textSecondary: string;
    colorMode: "dark" | "light";
    onPress: (day: DateData) => void;
};

/** 상세 월의 날짜 한 칸에 오늘·공휴일·음력·일정 표식을 조합하고 접근성 설명을 제공한다. */
export function DetailMonthGridCell({
    model,
    date,
    cellHeight,
    geometry,
    marking,
    metadata,
    todayDateString,
    textPrimary,
    textSecondary,
    colorMode,
    onPress,
}: DetailMonthGridCellProps) {
    const isDisabled = date.dateString.slice(0, 7) !== model.monthKey;
    const isToday = date.dateString === todayDateString;
    const weekday = new Date(
        date.year,
        date.month - 1,
        date.day
    ).getDay();
    const isSunday = weekday === 0;
    const isWeekend = isSunday || weekday === 6;
    const holidayNames = (metadata?.holidays ?? []).map(
        (holiday) => holiday.name
    );
    const hasHoliday = holidayNames.length > 0;
    const lunarText = formatLunarCalendarDay(metadata);
    const events = marking?.events ?? [];
    const markerEvents = events.slice(0, DETAIL_MONTH_EVENT_MARKER_LIMIT);
    const overflowCount = Math.max(
        0,
        events.length - DETAIL_MONTH_EVENT_MARKER_LIMIT
    );
    const todayAccent = getCalendarTodayAccent(colorMode);
    const holidayAccent = colorMode === "dark" ? "#ff6961" : "#d92d20";
    const weekendDateColor = colorMode === "dark"
        ? "rgba(235,235,245,0.52)"
        : "rgba(60,60,67,0.52)";
    const dateTextColor = isToday
        ? "#ffffff"
        : hasHoliday || isSunday
            ? holidayAccent
            : isWeekend
                ? weekendDateColor
                : textPrimary;
    const holidayTop = geometry.circleTop + geometry.circleSize + 1;
    const markerTop = Math.min(
        cellHeight - 8,
        geometry.circleTop
            + geometry.circleSize
            + (hasHoliday ? geometry.holidayLineHeight + 2 : 3)
    );
    const accessibilityLabel = [
        `${date.year}년 ${date.month}월 ${date.day}일`,
        isToday ? "오늘" : undefined,
        lunarText ?? undefined,
        hasHoliday ? `공휴일 ${holidayNames.join(", ")}` : undefined,
        events.length > 0 ? `${events.length}개의 일정` : "일정 없음",
    ].filter(Boolean).join(", ");

    return (
        <Pressable
            testID={`detail-month-cell-${model.monthKey}-${date.dateString}`}
            onPress={() => onPress(date)}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{
                disabled: false,
            }}
            style={({ pressed }) => [
                styles.detailMonthGridCell,
                styles.detailMonthGridDay,
                { height: cellHeight, opacity: pressed ? 0.55 : 1 },
            ]}
        >
                <View
                    testID="calendar-day-circle"
                    style={[
                        styles.detailMonthGridDayCircle,
                        {
                            width: geometry.circleSize,
                            height: geometry.circleSize,
                            borderRadius: geometry.circleSize / 2,
                            marginTop: geometry.circleTop,
                            backgroundColor: isToday
                                ? todayAccent
                                : "transparent",
                        },
                    ]}
                >
                    <Text
                        style={[
                            styles.detailMonthGridDayText,
                            {
                                color: dateTextColor,
                                fontSize: geometry.dayFontSize,
                                lineHeight: geometry.dayLineHeight,
                                fontWeight: isToday ? "700" : "600",
                                opacity: isDisabled ? 0.28 : 1,
                            },
                        ]}
                    >
                        {date.day}
                    </Text>
                    {lunarText ? (
                        <Text
                            testID="calendar-lunar-date"
                            numberOfLines={1}
                            style={[
                                styles.detailMonthGridLunarText,
                                {
                                    color: hasHoliday || isSunday
                                        ? isToday ? "#ffffff" : holidayAccent
                                        : isToday ? "#ffffff" : textSecondary,
                                    maxWidth: geometry.lunarMaxWidth,
                                    fontSize: geometry.lunarFontSize,
                                    lineHeight: geometry.lunarLineHeight,
                                    opacity: isDisabled ? 0.28 : 0.88,
                                },
                            ]}
                        >
                            {lunarText}
                        </Text>
                    ) : null}
                </View>

                {hasHoliday ? (
                    <Text
                        testID="calendar-holiday-name"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={[
                            styles.detailMonthGridHolidayText,
                            {
                                top: holidayTop,
                                color: holidayAccent,
                                fontSize: geometry.holidayFontSize,
                                lineHeight: geometry.holidayLineHeight,
                                opacity: isDisabled ? 0.28 : 1,
                            },
                        ]}
                    >
                        {holidayNames.join(" · ")}
                    </Text>
                ) : null}

                {events.length > 0 ? (
                    <View
                        testID="detail-event-markers"
                        style={[
                            styles.detailMonthGridMarkers,
                            { top: markerTop },
                        ]}
                    >
                        {markerEvents.map((event) => event.travelMode ? (
                            <Ionicons
                                accessible={false}
                                key={event.id}
                                name={getDetailMonthTravelIconName(
                                    event.travelMode
                                )}
                                size={8}
                                color={event.color}
                                style={styles.detailMonthGridTravelMarker}
                            />
                        ) : (
                            <View
                                key={event.id}
                                style={[
                                    styles.detailMonthGridDot,
                                    { backgroundColor: event.color },
                                ]}
                            />
                        ))}
                        {overflowCount > 0 ? (
                            <Text
                                accessible={false}
                                testID="detail-event-overflow"
                                numberOfLines={1}
                                style={[
                                    styles.detailMonthGridEventMore,
                                    { color: textSecondary },
                                ]}
                            >
                                +{overflowCount}개
                            </Text>
                        ) : null}
                    </View>
                ) : null}
        </Pressable>
    );
}

/** 월 격자에 실제로 보이는 날짜 데이터만 비교해 불필요한 전체 월 재렌더링을 막는다. */
export function areDetailMonthPagerGridPropsEqual(
    previous: DetailMonthPagerGridProps,
    next: DetailMonthPagerGridProps
): boolean {
    if (
        previous.day !== next.day
        || previous.firstDay !== next.firstDay
        || previous.detailCellHeight !== next.detailCellHeight
        || previous.todayDateString !== next.todayDateString
        || previous.textPrimary !== next.textPrimary
        || previous.textSecondary !== next.textSecondary
        || previous.colorMode !== next.colorMode
        || previous.onPress !== next.onPress
        || previous.onShift !== next.onShift
    ) return false;

    if (
        previous.markedDates === next.markedDates
        && previous.calendarDaysByDate === next.calendarDaysByDate
    ) return true;

    return getDetailMonthPageModel(next.day, next.firstDay).dates.every(
        ({ dateString }) => (
            previous.markedDates?.[dateString]
                === next.markedDates?.[dateString]
            && previous.calendarDaysByDate[dateString]
                === next.calendarDaysByDate[dateString]
        )
    );
}

/** 상세 월 한 페이지의 6주 날짜 격자를 그리며 숨겨진 주 행과 접근성 월 이동 동작을 함께 관리한다. */
export const DetailMonthPagerGrid = React.memo(
    function DetailMonthPagerGrid({
        day,
        firstDay,
        markedDates,
        calendarDaysByDate,
        detailCellHeight,
        todayDateString,
        textPrimary,
        textSecondary,
        colorMode,
        onPress,
        onShift,
    }: DetailMonthPagerGridProps) {
        const model = getDetailMonthPageModel(day, firstDay);
        const cellHeight = Math.max(
            32,
            detailCellHeight ?? CALENDAR_DAY_HEIGHTS.detail
        );
        const geometry = getDetailMonthCellGeometry(cellHeight);
        return (
            <View
                testID={`detail-month-grid-${model.monthKey}`}
                accessible={false}
                style={styles.detailMonthGrid}
            >
                {Array.from(
                    { length: DETAIL_MONTH_GRID_ROW_COUNT },
                    (_, rowIndex) => (
                        <View
                            key={`${model.monthKey}-row-${rowIndex}`}
                            testID={`detail-month-grid-row-${model.monthKey}-${rowIndex}`}
                            accessibilityElementsHidden={
                                rowIndex >= model.weekCount
                            }
                            aria-hidden={rowIndex >= model.weekCount}
                            importantForAccessibility={
                                rowIndex >= model.weekCount
                                    ? "no-hide-descendants"
                                    : "auto"
                            }
                            pointerEvents={
                                rowIndex >= model.weekCount ? "none" : "auto"
                            }
                            style={[
                                styles.detailMonthGridRow,
                                { height: cellHeight },
                                rowIndex >= model.weekCount
                                    ? styles.detailMonthGridHiddenRow
                                    : undefined,
                            ]}
                        >
                            {model.dates.slice(
                                rowIndex * DETAIL_MONTH_GRID_COLUMN_COUNT,
                                (rowIndex + 1)
                                    * DETAIL_MONTH_GRID_COLUMN_COUNT
                            ).map((date) => (
                                <DetailMonthGridCell
                                    key={`${model.monthKey}-${date.dateString}`}
                                    model={model}
                                    date={date}
                                    cellHeight={cellHeight}
                                    geometry={geometry}
                                    marking={markedDates?.[date.dateString]}
                                    metadata={
                                        calendarDaysByDate[date.dateString]
                                    }
                                    todayDateString={todayDateString}
                                    textPrimary={textPrimary}
                                    textSecondary={textSecondary}
                                    colorMode={colorMode}
                                    onPress={onPress}
                                />
                            ))}
                        </View>
                    )
                )}
                <View
                    testID={`detail-month-adjuster-${model.monthKey}`}
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel={`${model.monthKey} 월 이동`}
                    accessibilityActions={[
                        { name: "decrement", label: "이전 달" },
                        { name: "increment", label: "다음 달" },
                    ]}
                    onAccessibilityAction={(event) => {
                        if (event.nativeEvent.actionName === "decrement") {
                            onShift(-1);
                        } else if (
                            event.nativeEvent.actionName === "increment"
                        ) {
                            onShift(1);
                        }
                    }}
                    style={styles.detailMonthAccessibilityAdjuster}
                />
            </View>
        );
    },
    areDetailMonthPagerGridPropsEqual
);

const styles = createScheduleCalendarStyles({
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
});
