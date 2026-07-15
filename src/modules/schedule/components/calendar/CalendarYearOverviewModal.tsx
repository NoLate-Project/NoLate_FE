import React, { useRef } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";

type Props = {
    visible: boolean;
    year: number;
    selectedDay: string;
    firstDay: 0 | 1;
    topInset?: number;
    todayRequest?: number;
    reduceMotionEnabled?: boolean;
    onSelectMonth: (year: number, month: number) => void;
};

function getMonthCells(year: number, month: number, firstDay: 0 | 1) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthFirstDay = new Date(year, month - 1, 1).getDay();
    const leadingCount = (monthFirstDay - firstDay + 7) % 7;

    return Array.from({ length: 42 }, (_, index) => {
        const day = index - leadingCount + 1;
        return day > 0 && day <= daysInMonth ? day : null;
    });
}

function CalendarYearOverviewModal({
    visible,
    year,
    selectedDay,
    firstDay,
    topInset = 0,
    todayRequest = 0,
    reduceMotionEnabled = false,
    onSelectMonth,
}: Props) {
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const selectedDate = new Date(`${selectedDay}T00:00:00`);
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const todayDate = today.getDate();
    const currentYear = todayYear;
    const accentColor = mode === "dark" ? "#ff453a" : "#ff3b30";
    const visibleYears = Array.from(new Set([year, year + 1, year + 2, currentYear]))
        .sort((left, right) => left - right);
    const scrollRef = useRef<ScrollView>(null);
    const yearOffsetsRef = useRef<Record<number, number>>({});
    const handledTodayRequestRef = useRef(todayRequest);
    const contentTopPadding = Math.max(topInset + 63, 103);

    React.useEffect(() => {
        if (!visible || handledTodayRequestRef.current === todayRequest) return;
        handledTodayRequestRef.current = todayRequest;

        const scrollToToday = () => {
            const yearOffset = yearOffsetsRef.current[todayYear];
            if (!Number.isFinite(yearOffset)) return;

            scrollRef.current?.scrollTo({
                y: Math.max(0, yearOffset - contentTopPadding),
                animated: !reduceMotionEnabled,
            });
        };

        const firstFrame = requestAnimationFrame(() => {
            requestAnimationFrame(scrollToToday);
        });
        return () => cancelAnimationFrame(firstFrame);
    }, [
        contentTopPadding,
        reduceMotionEnabled,
        todayRequest,
        todayYear,
        visible,
    ]);

    return (
        <View style={[styles.safeArea, { backgroundColor: colors.calendarBackground }]}>
            <ScrollView
                ref={scrollRef}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingTop: contentTopPadding,
                        paddingBottom: Math.max(insets.bottom + 118, 148),
                    },
                ]}
            >
                {visibleYears.map((sectionYear) => {
                    const sectionYearColor = sectionYear === currentYear
                        ? accentColor
                        : colors.textPrimary;

                    return (
                        <View
                            key={sectionYear}
                            style={styles.yearSection}
                            onLayout={(event) => {
                                yearOffsetsRef.current[sectionYear] = event.nativeEvent.layout.y;
                            }}
                        >
                            <View style={[styles.yearHeader, { borderBottomColor: colors.border }]}>
                                <Text style={[styles.yearTitle, { color: sectionYearColor }]}>
                                    {sectionYear}년
                                </Text>
                            </View>

                            <View style={styles.monthGrid}>
                                {Array.from({ length: 12 }, (_, index) => {
                                    const month = index + 1;
                                    const monthKey = `${sectionYear}-${month}`;
                                    const cells = getMonthCells(sectionYear, month, firstDay);
                                    const isSelectedMonth =
                                        selectedDate.getFullYear() === sectionYear &&
                                        selectedDate.getMonth() + 1 === month;
                                    const isCurrentMonth =
                                        todayYear === sectionYear &&
                                        todayMonth === month;

                                    return (
                                        <Pressable
                                            key={monthKey}
                                            onPress={() => onSelectMonth(sectionYear, month)}
                                            style={({ pressed }) => [
                                                styles.monthPreview,
                                                { opacity: pressed ? 0.55 : 1 },
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.monthTitle,
                                                    {
                                                        color: isCurrentMonth
                                                            ? accentColor
                                                            : isSelectedMonth
                                                                ? colors.selectedDayBg
                                                                : colors.textPrimary,
                                                    },
                                                ]}
                                            >
                                                {month}월
                                            </Text>

                                            <View style={styles.daysGrid}>
                                                {cells.map((day, cellIndex) => {
                                                    const isSelectedDay =
                                                        isSelectedMonth && day === selectedDate.getDate();
                                                    const isToday =
                                                        sectionYear === todayYear &&
                                                        month === todayMonth &&
                                                        day === todayDate;
                                                    const badgeFill = isToday
                                                        ? accentColor
                                                        : isSelectedDay
                                                            ? colors.selectedDayBg
                                                            : "transparent";
                                                    const badgeTextColor = isToday
                                                        ? "#ffffff"
                                                        : isSelectedDay
                                                            ? colors.selectedDayText
                                                            : colors.textPrimary;
                                                    return (
                                                        <View key={cellIndex} style={styles.dayCell}>
                                                            {day !== null && (
                                                                <View
                                                                    style={[
                                                                        styles.dayBadge,
                                                                        (isSelectedDay || isToday) && {
                                                                            backgroundColor: badgeFill,
                                                                            borderColor: "transparent",
                                                                        },
                                                                    ]}
                                                                >
                                                                    <Text
                                                                        style={[
                                                                            styles.dayText,
                                                                            {
                                                                                color: isSelectedDay || isToday
                                                                                    ? badgeTextColor
                                                                                    : colors.textPrimary,
                                                                            },
                                                                        ]}
                                                                    >
                                                                        {day}
                                                                    </Text>
                                                                </View>
                                                            )}
                                                        </View>
                                                    );
                                                })}
                                            </View>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                    );
                })}
            </ScrollView>
        </View>
    );
}

export default React.memo(CalendarYearOverviewModal);

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 24,
    },
    yearSection: {
        marginBottom: 44,
    },
    yearHeader: {
        marginBottom: 13,
        paddingBottom: 2,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-start",
    },
    yearTitle: {
        fontSize: 34,
        lineHeight: 40,
        fontWeight: "700",
        letterSpacing: 0,
    },
    monthGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        rowGap: 20,
    },
    monthPreview: {
        width: "31%",
        minHeight: 130,
    },
    monthTitle: {
        fontSize: 20,
        fontWeight: "700",
        marginBottom: 1,
        letterSpacing: 0,
    },
    daysGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    dayCell: {
        width: "14.2857%",
        height: 17.3333,
        alignItems: "center",
        justifyContent: "center",
    },
    dayBadge: {
        minWidth: 15,
        height: 15,
        borderRadius: 7.5,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
    },
    dayText: {
        fontSize: 10,
        fontWeight: "600",
    },
});
