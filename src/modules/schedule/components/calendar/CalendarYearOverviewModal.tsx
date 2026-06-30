import React from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";

type Props = {
    visible: boolean;
    year: number;
    selectedDay: string;
    firstDay: 0 | 1;
    topInset?: number;
    onChangeYear: (year: number) => void;
    onSelectMonth: (month: number) => void;
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
    const weekdayLabels = Array.from({ length: 7 }, (_, index) => (
        WEEKDAYS[(firstDay + index) % 7]
    ));
    const currentYear = new Date().getFullYear();
    const yearColor = year === currentYear
        ? mode === "dark" ? "#ff453a" : "#ff3b30"
        : colors.textPrimary;

    if (!visible) return null;

    return (
        <View style={[styles.safeArea, { backgroundColor: colors.calendarBackground }]}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingTop: Math.max(topInset + 108, 154),
                        paddingBottom: Math.max(insets.bottom + 112, 138),
                    },
                ]}
            >
                <View style={styles.yearHeader}>
                    <Pressable
                        onPress={() => onChangeYear(year - 1)}
                        accessibilityRole="button"
                        accessibilityLabel="이전 연도"
                        style={({ pressed }) => [
                            styles.yearArrow,
                            { opacity: pressed ? 0.45 : 1 },
                        ]}
                    >
                        <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
                    </Pressable>

                    <Text style={[styles.yearTitle, { color: yearColor }]}>{year}년</Text>

                    <Pressable
                        onPress={() => onChangeYear(year + 1)}
                        accessibilityRole="button"
                        accessibilityLabel="다음 연도"
                        style={({ pressed }) => [
                            styles.yearArrow,
                            { opacity: pressed ? 0.45 : 1 },
                        ]}
                    >
                        <Ionicons name="chevron-forward" size={24} color={colors.textPrimary} />
                    </Pressable>
                </View>

                <View style={styles.monthGrid}>
                    {Array.from({ length: 12 }, (_, index) => {
                        const month = index + 1;
                        const cells = getMonthCells(year, month, firstDay);
                        const isSelectedMonth =
                            selectedDate.getFullYear() === year &&
                            selectedDate.getMonth() + 1 === month;

                        return (
                            <Pressable
                                key={month}
                                onPress={() => onSelectMonth(month)}
                                style={({ pressed }) => [
                                    styles.monthPreview,
                                    { opacity: pressed ? 0.55 : 1 },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.monthTitle,
                                        {
                                            color: isSelectedMonth
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
                                        return (
                                            <View key={cellIndex} style={styles.dayCell}>
                                                {day !== null && (
                                                    <View
                                                        style={[
                                                            styles.dayBadge,
                                                            isSelectedDay && {
                                                                backgroundColor: colors.selectedDayBg,
                                                            },
                                                        ]}
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.dayText,
                                                                {
                                                                    color: isSelectedDay
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
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 24,
    },
    yearHeader: {
        marginBottom: 22,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    yearArrow: {
        width: 42,
        height: 42,
        alignItems: "center",
        justifyContent: "center",
    },
    yearTitle: {
        flex: 1,
        fontSize: 48,
        lineHeight: 54,
        fontWeight: "900",
        textAlign: "center",
        letterSpacing: 0,
    },
    monthGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        rowGap: 30,
    },
    monthPreview: {
        width: "30.5%",
        minHeight: 132,
    },
    monthTitle: {
        fontSize: 17,
        fontWeight: "900",
        marginBottom: 7,
        letterSpacing: 0,
    },
    weekRow: {
        flexDirection: "row",
    },
    weekday: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 7.5,
        fontWeight: "700",
        marginBottom: 3,
    },
    daysGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    dayCell: {
        width: "14.2857%",
        height: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    dayBadge: {
        minWidth: 14,
        height: 14,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
    },
    dayText: {
        fontSize: 7.5,
        fontWeight: "700",
    },
});
