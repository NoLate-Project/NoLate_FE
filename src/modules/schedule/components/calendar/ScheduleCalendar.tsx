import React, { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, CalendarList, DateData } from "react-native-calendars";
import type { ScheduleItem } from "../../types";
import { useTheme } from "../../../theme/ThemeContext";
import { enumerateDaysBetween } from "../../../../../lib/util/data";
import CustomDay from "./CustomDay";
import type { CalendarViewMode } from "./viewMode";

type Props = {
    selectedDay: string;
    items: ScheduleItem[];
    onSelectDay: (day: string) => void;
    viewMode: CalendarViewMode;
    firstDay: 0 | 1;
    onVisibleMonthChange: (month: string) => void;
};

type CalendarDayComponentProps = {
    date?: DateData;
    state?: string;
    marking?: React.ComponentProps<typeof CustomDay>["marking"];
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const CONTINUOUS_CALENDAR_HEIGHT = 560;

function formatMonthTitle(date?: { toString?: (format: string) => string }) {
    return date?.toString?.("M월") ?? "";
}

function moveMonth(day: string, amount: number) {
    const current = new Date(`${day}T00:00:00`);
    const next = new Date(current.getFullYear(), current.getMonth() + amount, 1);
    const year = next.getFullYear();
    const month = String(next.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}-01`;
}

// 일정 목록을 월간 캘린더 UI로 표시한다.
export default function ScheduleCalendar({
    selectedDay,
    items,
    onSelectDay,
    viewMode,
    firstDay,
    onVisibleMonthChange,
}: Props) {
    const { colors, mode } = useTheme();

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
            onPress={(d) => onSelectDay(d.dateString)}
        />
    ), [onSelectDay, selectedDay, viewMode]);

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

    const renderMonthHeader = (date?: { toString?: (format: string) => string }) => (
        <Text style={[styles.monthTitle, { color: colors.monthTextColor }]}>
            {formatMonthTitle(date)}
        </Text>
    );

    const weekdayLabels = Array.from({ length: 7 }, (_, index) => (
        WEEKDAYS[(firstDay + index) % 7]
    ));
    const weekdayHeader = (
        <View
            style={[
                styles.weekdayHeader,
                {
                    backgroundColor: colors.calendarBackground,
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
    );

    if (viewMode !== "list") {
        return (
            <View style={styles.calendarList}>
                {weekdayHeader}
                <CalendarList
                    key={`${mode}-${viewMode}-${firstDay}`}
                    current={selectedDay}
                    pastScrollRange={24}
                    futureScrollRange={24}
                    calendarHeight={CONTINUOUS_CALENDAR_HEIGHT}
                    firstDay={firstDay}
                    horizontal={false}
                    pagingEnabled={false}
                    showScrollIndicator={false}
                    hideArrows
                    hideDayNames
                    hideExtraDays
                    markedDates={markedDates}
                    dayComponent={renderDay}
                    onDayPress={(day: DateData) => onSelectDay(day.dateString)}
                    onVisibleMonthsChange={(months) => {
                        const month = months[0];
                        if (month) onVisibleMonthChange(month.dateString);
                    }}
                    renderHeader={renderMonthHeader}
                    theme={calendarTheme}
                    style={[
                        styles.calendarList,
                        { backgroundColor: colors.calendarBackground },
                    ]}
                    calendarStyle={StyleSheet.flatten([
                        styles.continuousCalendar,
                        {
                            backgroundColor: colors.calendarBackground,
                            borderBottomColor: colors.border,
                        },
                    ])}
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
                key={`${mode}-${viewMode}-${firstDay}`}
                current={selectedDay}
                firstDay={firstDay}
                enableSwipeMonths
                hideArrows
                hideDayNames
                hideExtraDays={false}
                onDayPress={(day: DateData) => onSelectDay(day.dateString)}
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
    continuousCalendar: {
        paddingHorizontal: 12,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    monthTitle: {
        fontSize: 22,
        fontWeight: "800",
        letterSpacing: -0.5,
    },
    weekdayHeader: {
        height: 34,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
    },
    weekdayText: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 13,
        fontWeight: "700",
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
        letterSpacing: -0.6,
    },
    monthArrow: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
});
