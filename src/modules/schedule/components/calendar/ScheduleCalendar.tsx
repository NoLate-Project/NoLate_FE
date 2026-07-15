import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    FlatList,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, DateData } from "react-native-calendars";
import type { SharedValue } from "react-native-reanimated";
import type { ScheduleItem } from "../../types";
import { useTheme } from "../../../theme/ThemeContext";
import { enumerateDaysBetween } from "../../../../../lib/util/data";
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
    animatedDayHeight?: SharedValue<number>;
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

function enumerateScheduleDays(item: ScheduleItem) {
    const start = new Date(item.startAt);
    const end = new Date(item.endAt);
    if (Number.isNaN(start.getTime())) return [];
    if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
        return [toDateString(start.getFullYear(), start.getMonth() + 1, start.getDate())];
    }

    // Calendar ranges are end-exclusive. Subtracting 1ms prevents an event
    // ending exactly at midnight from leaving a marker on the following day.
    return enumerateDaysBetween(item.startAt, new Date(end.getTime() - 1));
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

// 축소형과 스택형은 월이 위아래로 이어지는 목록을, 패널형은 고정 Calendar를 사용한다.
export default function ScheduleCalendar({
    selectedDay,
    focusedMonth,
    items,
    onSelectDay,
    onOpenDay,
    viewMode,
    firstDay,
    scrollRequest,
    onVisibleMonthChange,
    headerOffset = 0,
    transitionMonthKey,
    transitionActive = false,
    animatedDayHeight,
}: Props) {
    const { colors, mode } = useTheme();
    const todayDateString = useMemo(getTodayDateString, []);
    const visibleMonth = normalizeMonthCandidate(transitionMonthKey)
        ?? normalizeMonthCandidate(focusedMonth)
        ?? selectedDay.slice(0, 7);
    const initialDate = selectedDay.startsWith(`${visibleMonth}-`)
        ? selectedDay
        : `${visibleMonth}-01`;
    const stackListRef = useRef<FlatList<StackMonth>>(null);
    const handledStackScrollRequestRef = useRef(scrollRequest);
    const initialStackMonthRef = useRef(
        new Date(`${visibleMonth}-01T00:00:00`)
    );
    const [activeStackMonth, setActiveStackMonth] = useState(visibleMonth);
    const activeStackMonthRef = useRef(activeStackMonth);

    const markedDates = useMemo(() => {
        const dateMap: Record<string, any> = {};
        const dateSingleDay: Record<string, ScheduleItem[]> = {};
        const dateMultiDay: Record<string, any[]> = {};

        items.forEach((item) => {
            const dates = enumerateScheduleDays(item);
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

    const renderDay = useCallback(({ date, state, marking }: CalendarDayComponentProps) => (
        <CustomDay
            date={date}
            state={state}
            marking={marking}
            viewMode={viewMode}
            animatedCellHeight={animatedDayHeight}
            isSelectedDay={date?.dateString === selectedDay}
            onPress={(day) => {
                if (viewMode === "detail") {
                    if (day.dateString === selectedDay) {
                        onOpenDay(day.dateString);
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
        onOpenDay,
        onSelectDay,
        onVisibleMonthChange,
        selectedDay,
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
        const initialMonth = initialStackMonthRef.current;
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
    }, [firstDay, viewMode]);
    const stackMonthLayouts = useMemo(() => {
        let offset = 0;
        return stackMonths.map((month, index) => {
            const layout = { length: month.height, offset, index };
            offset += month.height;
            return layout;
        });
    }, [stackMonths]);
    const stackTargetMonthKey = normalizeMonthCandidate(transitionMonthKey)
        ?? normalizeMonthCandidate(focusedMonth)
        ?? selectedDay.slice(0, 7);
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
        setActiveStackMonth(month.key);
        if (notifyParent) visibleMonthChangeRef.current(month.dateString);
    }, []);

    useEffect(() => {
        if (!isContinuousMonthViewMode(viewMode) || stackTargetMonthIndex < 0) return;

        const targetMonth = stackMonths[stackTargetMonthIndex];
        const shouldAnimate = handledStackScrollRequestRef.current !== scrollRequest;
        handledStackScrollRequestRef.current = scrollRequest;
        updateActiveStackMonth(
            targetMonth,
            !transitionActive && !normalizeMonthCandidate(transitionMonthKey)
        );

        const scrollTimer = setTimeout(() => {
            stackListRef.current?.scrollToOffset({
                offset: Math.max(0, stackMonthLayouts[stackTargetMonthIndex].offset),
                animated: shouldAnimate,
            });
        }, 80);

        return () => clearTimeout(scrollTimer);
    }, [
        scrollRequest,
        stackMonthLayouts,
        stackMonths,
        stackTargetMonthIndex,
        transitionActive,
        transitionMonthKey,
        updateActiveStackMonth,
        viewMode,
    ]);

    const handleStackScroll = useCallback((
        event: NativeSyntheticEvent<NativeScrollEvent>
    ) => {
        const monthSwitchLine = event.nativeEvent.contentOffset.y
            + event.nativeEvent.layoutMeasurement.height * 0.32;
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
                {item.days.map((date, index) => (
                    <View
                        key={date?.dateString ?? `${item.key}-blank-${index}`}
                        style={[
                            styles.stackDayCell,
                            {
                                height: item.dayHeight,
                                borderTopColor: colors.border,
                            },
                        ]}
                    >
                        <CustomDay
                            date={date ?? undefined}
                            state={date?.dateString === todayDateString ? "today" : undefined}
                            marking={date ? markedDates[date.dateString] : undefined}
                            viewMode={viewMode}
                            animatedCellHeight={animatedDayHeight}
                            isSelectedDay={date?.dateString === selectedDay}
                            onPress={(day) => onOpenDay(day.dateString)}
                        />
                    </View>
                ))}
            </View>
        </View>
    ), [
        animatedDayHeight,
        colors.border,
        colors.calendarBackground,
        colors.monthTextColor,
        markedDates,
        onOpenDay,
        selectedDay,
        todayDateString,
        viewMode,
    ]);

    const selectedWeekDays = useMemo(
        () => createWeekDays(selectedDay, firstDay),
        [firstDay, selectedDay]
    );
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
                        paddingTop: Math.max(headerOffset, 0),
                        backgroundColor: colors.calendarBackground,
                    },
                ]}
            >
                <FlatList
                    ref={stackListRef}
                    key={`${mode}-${viewMode}-${firstDay}`}
                    data={stackMonths}
                    extraData={activeStackMonth}
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
            <Calendar
                key={`${mode}-${firstDay}`}
                initialDate={initialDate}
                firstDay={firstDay}
                enableSwipeMonths
                hideArrows
                hideDayNames
                hideExtraDays={false}
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
    stackList: {
        flex: 1,
    },
    stackListContent: {
        paddingBottom: 156,
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
        flexDirection: "row",
        flexWrap: "wrap",
    },
    stackDayCell: {
        width: "14.2857%",
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    calendar: {
        paddingHorizontal: 12,
        paddingBottom: CALENDAR_CONTENT_BOTTOM_PADDING,
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
