import React, { useCallback, useMemo, useRef, useState } from "react";
import {
    FlatList,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { Calendar, DateData } from "react-native-calendars";
import type { ScheduleItem } from "../../types";
import { useTheme } from "../../../theme/ThemeContext";
import { enumerateDaysBetween } from "../../../../../lib/util/data";
import CustomDay from "./CustomDay";
import { CALENDAR_DAY_HEIGHTS, type CalendarViewMode } from "./viewMode";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    onSelectDay: (day: string) => void;
    onOpenDay: (day: string) => void;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    scrollRequest: number;
    onVisibleMonthChange: (month: string) => void;
    headerOffset?: number;
    topSafeInset?: number;
};

type CalendarDayComponentProps = {
    date?: DateData;
    state?: string;
    marking?: React.ComponentProps<typeof CustomDay>["marking"];
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const CONTINUOUS_MONTH_RANGE = 24;
const WEEKDAY_HEADER_HEIGHT = 42;
const CONTINUOUS_MONTH_HEADER_HEIGHT = 62;
const CONTINUOUS_MONTH_DIVIDER_HEIGHT = StyleSheet.hairlineWidth;

type ContinuousMonth = {
    key: string;
    year: number;
    month: number;
    dateString: string;
    days: Array<DateData | null>;
    weekCount: number;
    dayHeight: number;
    height: number;
};

function toDateString(year: number, month: number, day = 1) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getTodayDateString() {
    const today = new Date();
    return toDateString(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function createContinuousMonth(
    date: Date,
    firstDay: 0 | 1,
    dayHeight: number
): ContinuousMonth {
    const year = date.getFullYear();
    const monthIndex = date.getMonth();
    const month = monthIndex + 1;
    const dayCount = new Date(year, monthIndex + 1, 0).getDate();
    const leadingBlankCount = (new Date(year, monthIndex, 1).getDay() - firstDay + 7) % 7;
    const weekCount = Math.ceil((leadingBlankCount + dayCount) / 7);
    const totalCellCount = weekCount * 7;
    const days = Array.from({ length: totalCellCount }, (_, index): DateData | null => {
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
    });

    return {
        key: `${year}-${String(month).padStart(2, "0")}`,
        year,
        month,
        dateString: toDateString(year, month),
        days,
        weekCount,
        dayHeight,
        height:
            CONTINUOUS_MONTH_HEADER_HEIGHT
            + WEEKDAY_HEADER_HEIGHT
            + weekCount * dayHeight
            + CONTINUOUS_MONTH_DIVIDER_HEIGHT,
    };
}

function moveMonth(day: string, amount: number) {
    const current = new Date(`${day}T00:00:00`);
    const next = new Date(current.getFullYear(), current.getMonth() + amount, 1);
    const year = next.getFullYear();
    const month = String(next.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}-01`;
}

function moveDay(day: string, amount: number) {
    const next = new Date(`${day}T00:00:00`);
    next.setDate(next.getDate() + amount);
    return toDateString(next.getFullYear(), next.getMonth() + 1, next.getDate());
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

// 일정 목록을 월간 캘린더 UI로 표시한다.
export default function ScheduleCalendar({
    selectedDay,
    items,
    onSelectDay,
    onOpenDay,
    viewMode,
    firstDay,
    scrollRequest,
    onVisibleMonthChange,
    headerOffset = 0,
}: Props) {
    const { colors, mode } = useTheme();
    const calendarListRef = useRef<FlatList<ContinuousMonth>>(null);
    const handledScrollRequestRef = useRef(scrollRequest);
    const initialMonthRef = useRef(new Date(`${selectedDay.slice(0, 7)}-01T00:00:00`));
    const todayDateString = useMemo(getTodayDateString, []);
    const [activeMonth, setActiveMonth] = useState(selectedDay.slice(0, 7));
    const activeMonthRef = useRef(activeMonth);
    const continuousListTopPadding = Math.max(headerOffset, 0);

    // 일정 목록을 캘린더 마킹 데이터로 변환한다.
    const markedDates = useMemo(() => {
        const dateMap: Record<string, any> = {};
        const dateSingleDay: Record<string, ScheduleItem[]> = {};
        const dateMultiDay: Record<string, any[]> = {};

        items.forEach((item) => {
            const dates = enumerateDaysBetween(item.startAt, item.endAt);
            const isMultiDay = dates.length > 1;

            dates.forEach((date) => {
                if (!dateMap[date]) dateMap[date] = {};
                if (!dateMap[date].events) dateMap[date].events = [];
                dateMap[date].events.push({
                    id: item.id,
                    title: item.title,
                    color: item.category.color,
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
                if (!dateSingleDay[date]) dateSingleDay[date] = [];
                dateSingleDay[date].push(item);
            }
        });

        Object.keys(dateMultiDay).forEach((date) => {
            dateMap[date] = { ...dateMap[date], periods: dateMultiDay[date] };
            if (dateSingleDay[date]) {
                dateMap[date].dots = dateSingleDay[date].map((item) => ({
                    color: item.category.color,
                }));
                dateMap[date].marked = true;
                delete dateSingleDay[date];
            }
        });

        Object.keys(dateSingleDay).forEach((date) => {
            dateMap[date] = {
                ...dateMap[date],
                marked: true,
                dots: dateSingleDay[date].map((item) => ({ color: item.category.color })),
            };
        });

        if (dateMap[selectedDay]) {
            dateMap[selectedDay].selected = true;
        } else {
            dateMap[selectedDay] = { selected: true };
        }

        return dateMap;
    }, [items, selectedDay]);

    // 캘린더 라이브러리가 넘겨준 날짜 정보를 앱 전용 날짜 셀로 렌더링한다.
    const renderDay = useCallback(({ date, state, marking }: CalendarDayComponentProps) => (
        <CustomDay
            date={date}
            state={state}
            marking={marking}
            viewMode={viewMode}
            isSelectedDay={date?.dateString === selectedDay}
            onPress={(d) => onOpenDay(d.dateString)}
        />
    ), [onOpenDay, selectedDay, viewMode]);

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
                justifyContent: viewMode === "list" ? "space-between" : "flex-start",
                alignItems: "center",
                paddingHorizontal: viewMode === "list" ? 2 : 16,
                marginTop: viewMode === "list" ? 6 : 14,
                marginBottom: viewMode === "list" ? 10 : 8,
            },
        },
        "stylesheet.calendar-list.main": {
            flatListContainer: {
                flex: 1,
                backgroundColor: colors.calendarBackground,
            },
            container: {
                flex: 1,
                backgroundColor: colors.calendarBackground,
            },
        },
    } as React.ComponentProps<typeof Calendar>["theme"] & Record<string, unknown>;

    const weekdayLabels = useMemo(() => (
        Array.from({ length: 7 }, (_, index) => (
            WEEKDAYS[(firstDay + index) % 7]
        ))
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
    const selectedWeekDays = useMemo(
        () => createWeekDays(selectedDay, firstDay),
        [firstDay, selectedDay]
    );
    const selectedWeekTitle = useMemo(
        () => formatWeekTitle(selectedWeekDays),
        [selectedWeekDays]
    );

    const continuousMonths = useMemo(() => {
        const initialMonth = initialMonthRef.current;
        return Array.from(
            { length: CONTINUOUS_MONTH_RANGE * 2 + 1 },
            (_, index) => createContinuousMonth(
                new Date(
                    initialMonth.getFullYear(),
                    initialMonth.getMonth() + index - CONTINUOUS_MONTH_RANGE,
                    1
                ),
                firstDay,
                CALENDAR_DAY_HEIGHTS[viewMode]
            )
        );
    }, [firstDay, viewMode]);

    const monthLayouts = useMemo(() => {
        let offset = 0;
        return continuousMonths.map((month) => {
            const layout = { length: month.height, offset, index: 0 };
            offset += month.height;
            return layout;
        });
    }, [continuousMonths]);

    const selectedMonthIndex = useMemo(
        () => continuousMonths.findIndex((month) => selectedDay.startsWith(month.key)),
        [continuousMonths, selectedDay]
    );

    const visibleMonthChangeRef = useRef(onVisibleMonthChange);
    visibleMonthChangeRef.current = onVisibleMonthChange;

    const updateActiveMonth = useCallback((month: ContinuousMonth) => {
        if (activeMonthRef.current === month.key) return;

        activeMonthRef.current = month.key;
        setActiveMonth(month.key);
        visibleMonthChangeRef.current(month.dateString);
    }, []);

    useFocusEffect(
        useCallback(() => {
            if (viewMode === "list" || viewMode === "week" || selectedMonthIndex < 0) return;

            const selectedMonth = continuousMonths[selectedMonthIndex];
            const shouldAnimate = handledScrollRequestRef.current !== scrollRequest;
            handledScrollRequestRef.current = scrollRequest;
            updateActiveMonth(selectedMonth);

            const scrollTimer = setTimeout(() => {
                calendarListRef.current?.scrollToOffset({
                    offset: Math.max(0, monthLayouts[selectedMonthIndex].offset),
                    animated: shouldAnimate,
                });
            }, 120);

            return () => clearTimeout(scrollTimer);
        }, [
            continuousMonths,
            monthLayouts,
            scrollRequest,
            selectedMonthIndex,
            updateActiveMonth,
            viewMode,
        ])
    );

    const handleContinuousScroll = useCallback((
        event: NativeSyntheticEvent<NativeScrollEvent>
    ) => {
        const monthSwitchLine = event.nativeEvent.contentOffset.y
            + event.nativeEvent.layoutMeasurement.height * 0.32;
        let activeIndex = 0;

        for (let index = 1; index < monthLayouts.length; index += 1) {
            if (monthLayouts[index].offset > monthSwitchLine) {
                break;
            }
            activeIndex = index;
        }

        const nextActiveMonth = continuousMonths[activeIndex];
        if (nextActiveMonth) updateActiveMonth(nextActiveMonth);
    }, [continuousMonths, monthLayouts, updateActiveMonth]);

    const renderContinuousMonth = useCallback(({ item }: { item: ContinuousMonth }) => (
        <View
            style={[
                styles.continuousMonth,
                {
                    height: item.height,
                    backgroundColor: colors.calendarBackground,
                    borderBottomColor: colors.border,
                },
            ]}
        >
            <View style={styles.continuousMonthHeader}>
                <Text style={[styles.monthTitle, { color: colors.monthTextColor }]}>
                    {item.month}월
                </Text>
            </View>
            {weekdayHeader}
            <View style={styles.monthGrid}>
                {item.days.map((date, index) => (
                    <View
                        key={date?.dateString ?? `${item.key}-blank-${index}`}
                        style={[styles.dayCell, { height: item.dayHeight }]}
                    >
                        <CustomDay
                            date={date ?? undefined}
                            state={date?.dateString === todayDateString ? "today" : undefined}
                            marking={date ? markedDates[date.dateString] : undefined}
                            viewMode={viewMode}
                            isSelectedDay={date?.dateString === selectedDay}
                            onPress={(day) => onOpenDay(day.dateString)}
                        />
                    </View>
                ))}
            </View>
        </View>
    ), [
        colors.border,
        colors.calendarBackground,
        colors.monthTextColor,
        markedDates,
        onOpenDay,
        selectedDay,
        todayDateString,
        weekdayHeader,
        viewMode,
    ]);

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
                        style={styles.monthArrow}
                    >
                        <Ionicons name="chevron-back" size={27} color={colors.arrowColor} />
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
                        style={styles.monthArrow}
                    >
                        <Ionicons name="chevron-forward" size={27} color={colors.arrowColor} />
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
                                viewMode={viewMode}
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

    if (viewMode !== "list") {
        return (
            <View
                style={[
                    styles.calendarList,
                    {
                        paddingTop: continuousListTopPadding,
                        backgroundColor: colors.calendarBackground,
                    },
                ]}
            >
                <FlatList
                    ref={calendarListRef}
                    key={`${mode}-${viewMode}-${firstDay}`}
                    data={continuousMonths}
                    extraData={activeMonth}
                    renderItem={renderContinuousMonth}
                    keyExtractor={(item) => item.key}
                    initialScrollIndex={
                        selectedMonthIndex >= 0 ? selectedMonthIndex : CONTINUOUS_MONTH_RANGE
                    }
                    getItemLayout={(_, index) => ({
                        ...monthLayouts[index],
                        index,
                    })}
                    onScroll={handleContinuousScroll}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={false}
                    style={[styles.calendarList, { backgroundColor: colors.calendarBackground }]}
                    contentContainerStyle={styles.continuousListContent}
                    initialNumToRender={3}
                    maxToRenderPerBatch={4}
                    windowSize={7}
                />
            </View>
        );
    }

    return (
        <View>
            <View style={styles.listMonthHeader}>
                <Pressable
                    onPress={() => onSelectDay(moveMonth(selectedDay, -1))}
                    accessibilityLabel="이전 달"
                    style={styles.monthArrow}
                >
                    <Ionicons name="chevron-back" size={27} color={colors.arrowColor} />
                </Pressable>
                <Text style={[styles.listMonthTitle, { color: colors.monthTextColor }]}>
                    {new Date(`${selectedDay}T00:00:00`).getMonth() + 1}월
                </Text>
                <Pressable
                    onPress={() => onSelectDay(moveMonth(selectedDay, 1))}
                    accessibilityLabel="다음 달"
                    style={styles.monthArrow}
                >
                    <Ionicons name="chevron-forward" size={27} color={colors.arrowColor} />
                </Pressable>
            </View>
            {weekdayHeader}
            <Calendar
                key={`${mode}-${viewMode}-${firstDay}-${selectedDay.slice(0, 7)}-${scrollRequest}`}
                current={selectedDay}
                firstDay={firstDay}
                enableSwipeMonths
                hideArrows
                hideDayNames
                hideExtraDays={false}
                onDayPress={(day: DateData) => onOpenDay(day.dateString)}
                onMonthChange={(month: DateData) => {
                    onVisibleMonthChange(month.dateString);
                    onSelectDay(month.dateString);
                }}
                markedDates={markedDates}
                dayComponent={renderDay}
                renderHeader={() => null}
                style={[styles.calendar, { backgroundColor: colors.calendarBackground }]}
                theme={calendarTheme}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    calendar: {
        paddingHorizontal: 12,
        paddingBottom: 4,
    },
    calendarList: {
        flex: 1,
    },
    continuousListContent: {
        paddingBottom: 156,
    },
    continuousMonth: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    continuousMonthHeader: {
        height: CONTINUOUS_MONTH_HEADER_HEIGHT,
        paddingHorizontal: 28,
        justifyContent: "center",
    },
    monthGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    dayCell: {
        width: "14.2857%",
    },
    monthTitle: {
        fontSize: 27,
        fontWeight: "900",
        letterSpacing: 0,
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
        fontSize: 16.5,
        fontWeight: "900",
        opacity: 0.96,
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
