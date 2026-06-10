import React from "react";
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";
import CalendarGlassSurface from "./CalendarGlassSurface";

type Props = {
    visible: boolean;
    year: number;
    selectedDay: string;
    firstDay: 0 | 1;
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
    onChangeYear,
    onSelectMonth,
    onClose,
}: Props) {
    const { colors } = useTheme();
    const selectedDate = new Date(`${selectedDay}T00:00:00`);
    const weekdayLabels = Array.from({ length: 7 }, (_, index) => (
        WEEKDAYS[(firstDay + index) % 7]
    ));

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
            <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
                <View style={styles.header}>
                    <CalendarGlassSurface
                        interactive
                        style={[styles.yearControl, { borderColor: colors.border }]}
                    >
                        <Pressable
                            onPress={() => onChangeYear(year - 1)}
                            accessibilityLabel="이전 연도"
                            style={styles.yearArrow}
                        >
                            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
                        </Pressable>
                        <Text style={[styles.yearTitle, { color: colors.textPrimary }]}>{year}년</Text>
                        <Pressable
                            onPress={() => onChangeYear(year + 1)}
                            accessibilityLabel="다음 연도"
                            style={styles.yearArrow}
                        >
                            <Ionicons name="chevron-forward" size={20} color={colors.textPrimary} />
                        </Pressable>
                    </CalendarGlassSurface>

                    <CalendarGlassSurface
                        interactive
                        style={[styles.closeGlass, { borderColor: colors.border }]}
                    >
                        <Pressable onPress={onClose} style={styles.closeButton}>
                            <Text style={[styles.closeText, { color: colors.textPrimary }]}>완료</Text>
                        </Pressable>
                    </CalendarGlassSurface>
                </View>

                <ScrollView contentContainerStyle={styles.monthGrid}>
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
                                    styles.monthCard,
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
                </ScrollView>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    header: {
        minHeight: 58,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    yearControl: {
        height: 40,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
    },
    yearArrow: {
        width: 38,
        height: 40,
        alignItems: "center",
        justifyContent: "center",
    },
    yearTitle: {
        fontSize: 17,
        fontWeight: "800",
        minWidth: 62,
        textAlign: "center",
    },
    closeGlass: {
        minHeight: 40,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
    },
    closeButton: {
        flex: 1,
        paddingHorizontal: 17,
        alignItems: "center",
        justifyContent: "center",
    },
    closeText: {
        fontSize: 15,
        fontWeight: "700",
    },
    monthGrid: {
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 40,
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        rowGap: 26,
    },
    monthCard: {
        width: "31.5%",
    },
    monthTitle: {
        fontSize: 17,
        fontWeight: "800",
        marginBottom: 8,
    },
    weekRow: {
        flexDirection: "row",
    },
    weekday: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 8,
        fontWeight: "600",
        marginBottom: 3,
    },
    daysGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    dayCell: {
        width: "14.2857%",
        height: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    dayBadge: {
        minWidth: 15,
        height: 15,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    dayText: {
        fontSize: 8,
        fontWeight: "600",
    },
});
