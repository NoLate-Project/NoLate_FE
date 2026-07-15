import React, { useMemo } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
    Pressable,
    StyleSheet,
    Text,
    View,
    type DimensionValue,
} from "react-native";

import { useTheme } from "../../../theme/ThemeContext";
import {
    DAY_TIMELINE_MIN_TRAVEL_EVENT_HEIGHT,
    DAY_TIMELINE_CARD_VERTICAL_PADDING,
    DAY_TIMELINE_META_LINE_HEIGHT,
    DAY_TIMELINE_TITLE_LINE_HEIGHT,
    DAY_TIMELINE_TRAVEL_LINE_HEIGHT,
    formatDayTimelineClock,
    formatDayTimelineDeparture,
    formatDayTimelineTimeRange,
    getDayTimelineEventMetadata,
} from "../../dayTimelineLayout";
import type { ScheduleItem, TravelMode } from "../../types";

type Props = {
    item: ScheduleItem;
    top: number;
    height: number;
    left: DimensionValue;
    width: DimensionValue;
    laneCount: number;
    onPress: () => void;
};

function travelIconName(mode?: TravelMode): keyof typeof Ionicons.glyphMap {
    if (mode === "TRANSIT") return "bus-outline";
    if (mode === "CAR") return "car-outline";
    if (mode === "WALK") return "walk-outline";
    if (mode === "BIKE") return "bicycle-outline";
    return "navigate-outline";
}

export default function DayTimelineEventCard({
    item,
    top,
    height,
    left,
    width,
    laneCount,
    onPress,
}: Props) {
    const { colors, mode } = useTheme();
    const categoryColor = item.category?.color ?? "#8e8e93";
    const metadata = useMemo(() => getDayTimelineEventMetadata(item), [item]);
    const fullTimeText = useMemo(() => formatDayTimelineTimeRange(item), [item]);
    const timeText = laneCount >= 3 ? formatDayTimelineClock(item.startAt) : fullTimeText;
    const departureText = formatDayTimelineDeparture(metadata.departureAt);
    const travelText = [
        departureText ? `${departureText} 출발` : "",
        metadata.travelMinutes ? `${metadata.travelMinutes}분` : "",
    ].filter(Boolean).join(" · ");
    const showsTravelRow = metadata.isTravel
        && height >= DAY_TIMELINE_MIN_TRAVEL_EVENT_HEIGHT
        && laneCount < 3;
    const showsLocation = Boolean(metadata.location) && laneCount < 3;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${fullTimeText}`}
            onPress={onPress}
            style={({ pressed }) => [
                styles.card,
                {
                    top,
                    height,
                    left,
                    width,
                    backgroundColor: mode === "dark"
                        ? colorWithOpacity(categoryColor, 0.18)
                        : colorWithOpacity(categoryColor, 0.10),
                    borderColor: colorWithOpacity(categoryColor, mode === "dark" ? 0.46 : 0.28),
                    opacity: pressed ? 0.62 : 1,
                },
            ]}
        >
            <View style={[styles.accent, { backgroundColor: categoryColor }]} />
            <View style={[styles.content, showsTravelRow && styles.contentWithChevron]}>
                <View style={styles.titleRow}>
                    {metadata.isTravel ? (
                        <Ionicons
                            name={travelIconName(metadata.travelMode)}
                            size={14}
                            color={categoryColor}
                            style={styles.titleIcon}
                        />
                    ) : null}
                    <Text
                        maxFontSizeMultiplier={1.1}
                        numberOfLines={1}
                        style={[styles.title, { color: colors.textPrimary }]}
                    >
                        {item.title}
                    </Text>
                </View>

                <View style={styles.metaRow}>
                    <Text
                        maxFontSizeMultiplier={1.1}
                        numberOfLines={1}
                        style={[styles.time, { color: colors.textSecondary }]}
                    >
                        {timeText}
                    </Text>
                    {showsLocation ? (
                        <Text
                            maxFontSizeMultiplier={1.1}
                            numberOfLines={1}
                            style={[styles.location, { color: colors.textSecondary }]}
                        >
                            {metadata.location}
                        </Text>
                    ) : null}
                </View>

                {showsTravelRow && travelText ? (
                    <View style={styles.travelRow}>
                        <Ionicons
                            name={travelIconName(metadata.travelMode)}
                            size={12}
                            color={categoryColor}
                        />
                        <Text
                            maxFontSizeMultiplier={1.1}
                            numberOfLines={1}
                            style={[styles.travelText, { color: categoryColor }]}
                        >
                            {travelText}
                        </Text>
                    </View>
                ) : null}
            </View>
            {showsTravelRow ? (
                <Ionicons
                    name="chevron-forward"
                    size={13}
                    color={colors.textSecondary}
                    style={styles.chevron}
                />
            ) : null}
        </Pressable>
    );
}

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

const styles = StyleSheet.create({
    card: {
        position: "absolute",
        borderRadius: 9,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
        paddingHorizontal: 9,
        paddingVertical: DAY_TIMELINE_CARD_VERTICAL_PADDING,
    },
    accent: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: 3,
    },
    content: {
        flex: 1,
        minWidth: 0,
        paddingLeft: 2,
        justifyContent: "center",
    },
    contentWithChevron: {
        paddingRight: 14,
    },
    titleRow: {
        minWidth: 0,
        height: DAY_TIMELINE_TITLE_LINE_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    titleIcon: {
        flexShrink: 0,
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 13.5,
        lineHeight: DAY_TIMELINE_TITLE_LINE_HEIGHT,
        fontWeight: "800",
        letterSpacing: 0,
    },
    metaRow: {
        minWidth: 0,
        height: DAY_TIMELINE_META_LINE_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    time: {
        minWidth: 0,
        flexShrink: 1,
        fontSize: 11.5,
        lineHeight: DAY_TIMELINE_META_LINE_HEIGHT,
        fontWeight: "700",
        letterSpacing: 0,
    },
    location: {
        flex: 1,
        minWidth: 0,
        fontSize: 11.5,
        lineHeight: DAY_TIMELINE_META_LINE_HEIGHT,
        fontWeight: "600",
        letterSpacing: 0,
    },
    travelRow: {
        minWidth: 0,
        height: DAY_TIMELINE_TRAVEL_LINE_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    travelText: {
        flex: 1,
        minWidth: 0,
        fontSize: 11.5,
        lineHeight: DAY_TIMELINE_TRAVEL_LINE_HEIGHT,
        fontWeight: "800",
        letterSpacing: 0,
    },
    chevron: {
        position: "absolute",
        right: 7,
        top: "50%",
        marginTop: -6.5,
    },
});
