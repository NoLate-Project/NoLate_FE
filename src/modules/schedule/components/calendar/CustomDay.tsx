import React from "react";
import {
    View,
    Text,
    Pressable,
    StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Reanimated, {
    useAnimatedStyle,
    type SharedValue,
} from "react-native-reanimated";
import { useTheme } from "../../../theme/ThemeContext";
import type { TravelMode } from "../../types";
import { CALENDAR_DAY_HEIGHTS, type CalendarViewMode } from "./viewMode";

type Period = {
    startingDay?: boolean;
    endingDay?: boolean;
    color: string;
};

type Dot = {
    color: string;
    travelMode?: TravelMode;
};

type MarkedEvent = {
    id: string;
    title: string;
    color: string;
    startAt: string;
    allDay?: boolean;
    travelMode?: TravelMode;
};

type Marking = {
    periods?: Period[];
    dots?: Dot[];
    selected?: boolean;
    marked?: boolean;
    events?: MarkedEvent[];
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
    animatedCellHeight?: SharedValue<number>;
};

function travelIconName(mode: TravelMode): keyof typeof Ionicons.glyphMap {
    if (mode === "TRANSIT") return "bus-outline";
    if (mode === "CAR") return "car-outline";
    if (mode === "WALK") return "walk-outline";
    if (mode === "BIKE") return "bicycle-outline";
    return "navigate-outline";
}

function colorWithOpacity(color: string, opacity: number) {
    const normalized = color.replace("#", "");
    if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
        const [red, green, blue] = normalized
            .split("")
            .map((value) => Number.parseInt(value + value, 16));
        return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
        const red = Number.parseInt(normalized.slice(0, 2), 16);
        const green = Number.parseInt(normalized.slice(2, 4), 16);
        const blue = Number.parseInt(normalized.slice(4, 6), 16);
        return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
    }
    return color;
}

// 캘린더의 하루 셀을 선택 상태와 일정 마커에 맞춰 렌더링한다.
export default function CustomDay({
    date,
    state,
    marking,
    isSelectedDay,
    onPress,
    viewMode,
    animatedCellHeight,
}: Props) {
    const { colors, mode } = useTheme();
    const cellHeight = CALENDAR_DAY_HEIGHTS[viewMode];
    const [pressedSelection, setPressedSelection] = React.useState(false);
    const animatedCellStyle = useAnimatedStyle(() => ({
        height: animatedCellHeight ? animatedCellHeight.value : cellHeight,
    }), [animatedCellHeight, cellHeight]);

    React.useEffect(() => {
        if (!pressedSelection) return;
        if (isSelectedDay) {
            setPressedSelection(false);
            return;
        }

        const resetTimer = setTimeout(() => setPressedSelection(false), 700);
        return () => clearTimeout(resetTimer);
    }, [isSelectedDay, pressedSelection]);

    if (!date) {
        return (
            <Reanimated.View style={[styles.animatedCell, animatedCellStyle]}>
                <View style={[styles.cell, { height: cellHeight }]} />
            </Reanimated.View>
        );
    }

    const isDisabled = state === "disabled";
    const isToday = state === "today";
    const isSelected = pressedSelection || (isSelectedDay ?? marking?.selected);
    const weekday = new Date(`${date.dateString}T00:00:00`).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const weekendDateColor = mode === "dark"
        ? "rgba(235,235,245,0.52)"
        : "rgba(60,60,67,0.52)";

    const hasPeriods = !!(marking?.periods && marking.periods.length > 0);
    const hasDots = !!(marking?.dots && marking.dots.length > 0);
    const events = marking?.events ?? [];
    const visibleCompactEvents = events.slice(0, 3);
    const compactOverflowCount = Math.max(0, events.length - visibleCompactEvents.length);
    const visibleStackEvents = events.slice(0, 3);
    const stackOverflowCount = Math.max(0, events.length - visibleStackEvents.length);
    const showDots = viewMode === "week" || viewMode === "list";
    const markerTop = viewMode === "list" ? 47 : viewMode === "week" ? 54 : 53;
    const todayAccent = mode === "dark" ? "#ff453a" : "#ff3b30";
    const selectedCircleColor = isToday ? todayAccent : colors.selectedDayBg;
    const selectedTextColor = isToday ? "#ffffff" : colors.selectedDayText;
    const showsFilledCircle = isToday || isSelected;
    const selectedBorderColor = "transparent";
    const defaultTextColor = isDisabled
        ? colors.textPrimary
        : isToday
        ? todayAccent
        : isWeekend
        ? weekendDateColor
        : colors.textPrimary;
    const triggerPress = () => {
        if (isDisabled) return;
        setPressedSelection(true);
        onPress?.(date);
    };

    return (
        <Reanimated.View style={[styles.animatedCell, animatedCellStyle]}>
            <Pressable
                onPress={triggerPress}
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
                        backgroundColor: showsFilledCircle ? selectedCircleColor : "transparent",
                        borderColor: selectedBorderColor,
                    },
                ]}
                accessibilityLabel={isSelected
                    ? `${date.day}일 선택됨`
                    : `${date.day}일`}
            >
                <Text
                    style={[
                        styles.dayText,
                        {
                            fontWeight: isToday || isSelected ? "700" : "600",
                            color: showsFilledCircle
                                ? selectedTextColor
                                : defaultTextColor,
                            opacity: isDisabled ? 0.28 : 1,
                        },
                    ]}
                >
                    {date.day}
                </Text>
            </View>

            {viewMode === "compact" && events.length > 0 && (
                <View
                    testID="compact-event-markers"
                    style={[styles.compactEvents, { top: markerTop }]}
                >
                    {visibleCompactEvents.map((event) => (
                        <View
                            key={event.id}
                            testID="compact-event-bar"
                            style={[styles.compactBar, { backgroundColor: event.color }]}
                        />
                    ))}
                    {compactOverflowCount > 0 && (
                        <Text
                            testID="compact-event-overflow"
                            numberOfLines={1}
                            style={[styles.compactMoreText, { color: colors.textSecondary }]}
                        >
                            +{compactOverflowCount}개
                        </Text>
                    )}
                </View>
            )}

            {viewMode === "stack" && events.length > 0 && (
                <View testID="stack-event-chips" style={styles.stackEventChips}>
                    {visibleStackEvents.map((event) => (
                        <View
                            key={event.id}
                            testID="stack-event-chip"
                            style={[
                                styles.stackEventChip,
                                {
                                    backgroundColor: colorWithOpacity(
                                        event.color,
                                        mode === "dark" ? 0.30 : 0.14
                                    ),
                                },
                            ]}
                        >
                            {event.travelMode ? (
                                <Ionicons
                                    name={travelIconName(event.travelMode)}
                                    size={9}
                                    color={event.color}
                                    style={styles.stackEventIcon}
                                />
                            ) : null}
                            <Text
                                testID="stack-event-title"
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                style={[styles.stackEventTitle, { color: event.color }]}
                            >
                                {event.title}
                            </Text>
                        </View>
                    ))}
                    {stackOverflowCount > 0 && (
                        <Text
                            testID="stack-event-overflow"
                            numberOfLines={1}
                            style={[styles.stackEventMore, { color: colors.textSecondary }]}
                        >
                            +{stackOverflowCount}개
                        </Text>
                    )}
                </View>
            )}

            {viewMode === "detail" && events.length > 0 && (
                <View style={styles.detailMarkers}>
                    {events.slice(0, 3).map((event) => (
                        event.travelMode ? (
                            <Ionicons
                                key={event.id}
                                name={travelIconName(event.travelMode)}
                                size={10}
                                color={event.color}
                                style={styles.detailTravelMarker}
                            />
                        ) : (
                            <View
                                key={event.id}
                                style={[styles.detailDot, { backgroundColor: event.color }]}
                            />
                        )
                    ))}
                </View>
            )}

            {viewMode !== "compact" && viewMode !== "stack" && viewMode !== "detail" && hasPeriods && (
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
                    style={[styles.dots, { top: markerTop + 3 }]}
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
        </Reanimated.View>
    );
}

const styles = StyleSheet.create({
    animatedCell: {
        alignSelf: "stretch",
        overflow: "hidden",
    },
    cell: {
        alignSelf: "stretch",
        height: 58,
        paddingTop: 8,
        alignItems: "center",
    },
    dayCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    dayText: {
        fontSize: 18,
        letterSpacing: 0,
        fontWeight: "600",
    },
    periods: {
        alignSelf: "stretch",
        marginTop: 6,
    },
    dots: {
        position: "absolute",
        flexDirection: "row",
        justifyContent: "center",
        gap: 3,
    },
    compactEvents: {
        position: "absolute",
        left: 0,
        right: 0,
        alignItems: "center",
        gap: 2,
    },
    compactBar: {
        width: 40,
        height: 5,
        borderRadius: 3,
    },
    compactMoreText: {
        width: 40,
        fontSize: 9,
        lineHeight: 11,
        fontWeight: "700",
        textAlign: "center",
    },
    stackEventChips: {
        position: "absolute",
        top: 52,
        left: 2,
        right: 2,
        gap: 2,
        overflow: "hidden",
    },
    stackEventChip: {
        minWidth: 0,
        height: 16,
        paddingHorizontal: 3,
        borderRadius: 5,
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
    },
    stackEventIcon: {
        width: 10,
        marginRight: 1,
    },
    stackEventTitle: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "700",
        letterSpacing: -0.1,
    },
    stackEventMore: {
        height: 13,
        paddingHorizontal: 3,
        fontSize: 9,
        lineHeight: 12,
        fontWeight: "700",
    },
    detailMarkers: {
        position: "absolute",
        top: 51,
        left: 2,
        right: 2,
        minHeight: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    detailDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    detailTravelMarker: {
        width: 10,
        height: 10,
    },
});
