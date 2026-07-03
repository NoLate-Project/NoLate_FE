import React from "react";
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
    onChangeYear: (year: number) => void;
    onSelectMonth: (year: number, month: number) => void;
    onClose: () => void;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function getMonthCells(year: number, month: number, firstDay: 0 | 1) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthFirstDay = new Date(year, month - 1, 1).getDay();
    const leadingCount = (monthFirstDay - firstDay + 7) % 7;

    return Array.from({ length: 42 }, (_, index) => {
        const day = index - leadingCount + 1;
        return day > 0 && day <= daysInMonth ? day : null;
    });
}

export default function CalendarYearOverviewModal({
    visible,
    year,
    selectedDay,
    firstDay,
    topInset = 0,
    onChangeYear,
    onSelectMonth,
}: Props) {
    const { colors, mode } = useTheme();
    const insets = useSafeAreaInsets();
    const selectedDate = new Date(`${selectedDay}T00:00:00`);
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const todayDate = today.getDate();
    const weekdayLabels = Array.from({ length: 7 }, (_, index) => (
        WEEKDAYS[(firstDay + index) % 7]
    ));
    const currentYear = todayYear;
    const accentColor = mode === "dark" ? "#ff453a" : "#ff3b30";
    const visibleYears = [year, year + 1, year + 2];

    if (!visible) return null;

    return (
        <View style={[styles.safeArea, { backgroundColor: colors.calendarBackground }]}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingTop: Math.max(topInset + 88, 124),
                        paddingBottom: Math.max(insets.bottom + 118, 148),
                    },
                ]}
            >
                {visibleYears.map((sectionYear) => {
                    const sectionYearColor = sectionYear === currentYear
                        ? accentColor
                        : colors.textPrimary;

                    return (
                        <View key={sectionYear} style={styles.yearSection}>
                            <View style={styles.yearHeader}>
                                <Text style={[styles.yearTitle, { color: sectionYearColor }]}>
                                    {sectionYear}년
                                </Text>
                            </View>

                            <View style={styles.monthGrid}>
                                {Array.from({ length: 12 }, (_, index) => {
                                    const month = index + 1;
                                    const cells = getMonthCells(sectionYear, month, firstDay);
                                    const isSelectedMonth =
                                        selectedDate.getFullYear() === sectionYear &&
                                        selectedDate.getMonth() + 1 === month;
                                    const isCurrentMonth =
                                        todayYear === sectionYear &&
                                        todayMonth === month;

                                    return (
                                        <Pressable
                                            key={`${sectionYear}-${month}`}
                                            onPress={() => {
                                                onChangeYear(sectionYear);
                                                onSelectMonth(sectionYear, month);
                                            }}
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

                                            <View style={styles.weekRow}>
                                                {weekdayLabels.map((label, weekdayIndex) => (
                                                    <Text
                                                        key={`${label}-${weekdayIndex}`}
                                                        style={[styles.weekday, { color: colors.textSecondary }]}
                                                    >
                                                        {label}
                                                    </Text>
                                                ))}
                                            </View>

                                            <View style={styles.daysGrid}>
                                                {cells.map((day, cellIndex) => {
                                                    const isSelectedDay =
                                                        isSelectedMonth && day === selectedDate.getDate();
                                                    const isToday =
                                                        sectionYear === todayYear &&
                                                        month === todayMonth &&
                                                        day === todayDate;
                                                    return (
                                                        <View key={cellIndex} style={styles.dayCell}>
                                                            {day !== null && (
                                                                <View
                                                                    style={[
                                                                        styles.dayBadge,
                                                                        (isSelectedDay || isToday) && {
                                                                            backgroundColor: isToday
                                                                                ? accentColor
                                                                                : colors.selectedDayBg,
                                                                        },
                                                                    ]}
                                                                >
                                                                    <Text
                                                                        style={[
                                                                            styles.dayText,
                                                                            {
                                                                                color: isSelectedDay || isToday
                                                                                    ? colors.selectedDayText
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

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 18,
    },
    yearSection: {
        marginBottom: 44,
    },
    yearHeader: {
        marginBottom: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-start",
    },
    yearTitle: {
        fontSize: 46,
        lineHeight: 52,
        fontWeight: "900",
        letterSpacing: 0,
    },
    monthGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        rowGap: 28,
    },
    monthPreview: {
        width: "31%",
        minHeight: 124,
    },
    monthTitle: {
        fontSize: 16,
        fontWeight: "900",
        marginBottom: 6,
        letterSpacing: 0,
    },
    weekRow: {
        flexDirection: "row",
    },
    weekday: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 7,
        fontWeight: "700",
        marginBottom: 3,
    },
    daysGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    dayCell: {
        width: "14.2857%",
        height: 13,
        alignItems: "center",
        justifyContent: "center",
    },
    dayBadge: {
        minWidth: 13,
        height: 13,
        borderRadius: 6.5,
        alignItems: "center",
        justifyContent: "center",
    },
    dayText: {
        fontSize: 7,
        fontWeight: "700",
    },
});
