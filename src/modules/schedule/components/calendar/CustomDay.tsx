import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../../../theme/ThemeContext";
import type { CalendarViewMode } from "./viewMode";

type Period = {
    startingDay?: boolean;
    endingDay?: boolean;
    color: string;
};

type Dot = {
    color: string;
};

type Marking = {
    periods?: Period[];
    dots?: Dot[];
    selected?: boolean;
    marked?: boolean;
    events?: Array<{ id: string; title: string; color: string }>;
};

type CalendarDate = {
    day: number;
    month: number;
    year: number;
    dateString: string;
    timestamp: number;
};

type Props = {
    date?: CalendarDate;
    state?: string;
    marking?: Marking;
    isSelectedDay?: boolean;
    onPress?: (date: CalendarDate) => void;
    viewMode: CalendarViewMode;
};

function colorWithOpacity(color: string, opacity: number) {
    const normalized = color.replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
        const r = Number.parseInt(normalized.slice(0, 2), 16);
        const g = Number.parseInt(normalized.slice(2, 4), 16);
        const b = Number.parseInt(normalized.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    return color;
}

// 캘린더의 하루 셀을 선택 상태와 일정 마커에 맞춰 렌더링한다.
export default function CustomDay({ date, state, marking, isSelectedDay, onPress, viewMode }: Props) {
    const { colors, mode } = useTheme();
    const cellHeight = viewMode === "list" ? 58 : 78;

    if (!date) {
        return <View style={[styles.cell, { height: cellHeight }]} />;
    }

    const isDisabled = state === "disabled";
    const isToday = state === "today";
    const isSelected = isSelectedDay ?? marking?.selected;

    const hasPeriods = !!(marking?.periods && marking.periods.length > 0);
    const hasDots = !!(marking?.dots && marking.dots.length > 0);
    const events = marking?.events ?? [];
    const showDots = viewMode === "compact" || viewMode === "list";

    return (
        <Pressable
            onPress={() => !isDisabled && onPress?.(date)}
            disabled={isDisabled}
            style={({ pressed }) => [
                styles.cell,
                { height: cellHeight },
                { opacity: pressed ? 0.55 : 1 },
            ]}
        >
            <View
                style={[
                    styles.dayCircle,
                    {
                    backgroundColor: isSelected ? colors.selectedDayBg : "transparent",
                    },
                ]}
            >
                <Text
                    style={[
                        styles.dayText,
                        {
                        fontWeight: isToday || isSelected ? "700" : "400",
                        color: isSelected
                            ? colors.selectedDayText
                            : isDisabled
                            ? colors.textDisabled
                            : isToday
                            ? mode === "dark" ? "#ff453a" : "#ff3b30"
                            : colors.textPrimary,
                        },
                    ]}
                >
                    {date.day}
                </Text>
            </View>

            {viewMode === "stack" && events.length > 0 && (
                <View style={styles.stackEvents}>
                    {events.slice(0, 3).map((event) => (
                        <View
                            key={event.id}
                            style={[styles.stackBar, { backgroundColor: event.color }]}
                        />
                    ))}
                </View>
            )}

            {viewMode === "detail" && events.length > 0 && (
                <View style={styles.detailEvents}>
                    {events.slice(0, 2).map((event) => (
                        <View
                            key={event.id}
                            style={[
                                styles.detailEvent,
                                {
                                    backgroundColor: colorWithOpacity(event.color, 0.2),
                                    borderLeftColor: event.color,
                                },
                            ]}
                        >
                            <View style={styles.detailTitleClip}>
                                <Text
                                    numberOfLines={1}
                                    style={[styles.detailEventText, { color: event.color }]}
                                >
                                    {event.title.slice(0, 5)}
                                </Text>
                                {event.title.length > 5 && (
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.detailBlurTail,
                                            {
                                                color: event.color,
                                                textShadowColor: event.color,
                                            },
                                        ]}
                                    >
                                        {event.title.slice(5, 8)}
                                    </Text>
                                )}
                            </View>
                        </View>
                    ))}
                    {events.length > 2 && (
                        <Text style={[styles.detailMoreText, { color: colors.textSecondary }]}>
                            +{events.length - 2}개
                        </Text>
                    )}
                </View>
            )}

            {viewMode !== "stack" && viewMode !== "detail" && hasPeriods && (
                <View style={styles.periods}>
                    {marking!.periods!.slice(0, 2).map((period, index) => (
                        <View
                            key={index}
                            style={{
                                height: 3,
                                backgroundColor: period.color,
                                marginBottom: 1,
                                borderTopLeftRadius: period.startingDay ? 2 : 0,
                                borderBottomLeftRadius: period.startingDay ? 2 : 0,
                                borderTopRightRadius: period.endingDay ? 2 : 0,
                                borderBottomRightRadius: period.endingDay ? 2 : 0,
                                marginLeft: period.startingDay ? 4 : 0,
                                marginRight: period.endingDay ? 4 : 0,
                            }}
                        />
                    ))}
                </View>
            )}

            {showDots && hasDots && (
                <View
                    style={styles.dots}
                >
                    {marking!.dots!.slice(0, 3).map((dot, index) => (
                        <View
                            key={index}
                            style={{
                                width: 5,
                                height: 5,
                                borderRadius: 3,
                                backgroundColor: dot.color,
                            }}
                        />
                    ))}
                </View>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    cell: {
        alignSelf: "stretch",
        height: 58,
        paddingTop: 5,
        alignItems: "center",
    },
    dayCircle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    dayText: {
        fontSize: 16,
        letterSpacing: -0.2,
    },
    periods: {
        alignSelf: "stretch",
        marginTop: 2,
    },
    dots: {
        position: "absolute",
        bottom: 3,
        flexDirection: "row",
        justifyContent: "center",
        gap: 3,
    },
    stackEvents: {
        position: "absolute",
        left: 4,
        right: 4,
        bottom: 8,
        gap: 2,
    },
    stackBar: {
        height: 4,
        borderRadius: 2,
    },
    detailEvents: {
        alignSelf: "stretch",
        paddingHorizontal: 2,
        paddingTop: 1,
        gap: 2,
    },
    detailEvent: {
        height: 19,
        borderRadius: 5,
        borderLeftWidth: 3,
        paddingLeft: 3,
        paddingRight: 1,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    detailTitleClip: {
        alignSelf: "stretch",
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
    },
    detailEventText: {
        flexShrink: 0,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "700",
    },
    detailBlurTail: {
        marginLeft: -1,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "700",
        opacity: 0.2,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 4,
    },
    detailMoreText: {
        paddingLeft: 4,
        fontSize: 9,
        fontWeight: "700",
    },
});
