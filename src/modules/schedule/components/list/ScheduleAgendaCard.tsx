import React, { useMemo } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../../theme/ThemeContext";
import {
    formatDayTimelineDeparture,
    formatDayTimelineTimeRange,
    getDayTimelineEventMetadata,
} from "../../dayTimelineLayout";
import type { ScheduleItem, TravelMode } from "../../types";

export type ScheduleAgendaCardProps = {
    item: ScheduleItem;
    onPress: () => void;
    compact?: boolean;
};

function travelIconName(mode?: TravelMode): keyof typeof Ionicons.glyphMap {
    if (mode === "TRANSIT") return "bus-outline";
    if (mode === "CAR") return "car-outline";
    if (mode === "WALK") return "walk-outline";
    if (mode === "BIKE") return "bicycle-outline";
    return "navigate-outline";
}

function colorWithOpacity(color: string, opacity: number) {
    const normalized = color.replace("#", "");
    if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
        const [r, g, b] = normalized.split("").map((value) => Number.parseInt(value + value, 16));
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
        const r = Number.parseInt(normalized.slice(0, 2), 16);
        const g = Number.parseInt(normalized.slice(2, 4), 16);
        const b = Number.parseInt(normalized.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    return color;
}

/**
 * Flow-layout schedule card used by the agenda/list views.
 * Unlike the day timeline card, it owns no timeline coordinates or absolute layout.
 */
export default function ScheduleAgendaCard({
    item,
    onPress,
    compact = false,
}: ScheduleAgendaCardProps) {
    const { colors, mode } = useTheme();
    const categoryColor = item.category?.color ?? "#8e8e93";
    const metadata = useMemo(() => getDayTimelineEventMetadata(item), [item]);
    const timeText = useMemo(
        () => item.allDay ? "종일" : formatDayTimelineTimeRange(item),
        [item]
    );
    const departureText = formatDayTimelineDeparture(metadata.departureAt);
    const travelText = [
        departureText ? `${departureText} 출발` : "",
        metadata.travelMinutes ? `${metadata.travelMinutes}분` : "",
    ].filter(Boolean).join(" · ");
    const iconName = travelIconName(metadata.travelMode);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[
                item.title,
                timeText,
                metadata.location,
                item.routeSetupRequired ? "경로 미설정" : undefined,
            ].filter(Boolean).join(", ")}
            onPress={onPress}
            style={({ pressed }) => [
                styles.card,
                compact && styles.cardCompact,
                {
                    backgroundColor: mode === "dark"
                        ? colorWithOpacity(categoryColor, compact ? 0.12 : 0.18)
                        : colorWithOpacity(categoryColor, compact ? 0.065 : 0.10),
                    borderColor: colorWithOpacity(
                        categoryColor,
                        mode === "dark"
                            ? compact ? 0.34 : 0.46
                            : compact ? 0.20 : 0.28
                    ),
                    opacity: pressed ? 0.62 : 1,
                },
            ]}
        >
            <View
                style={[
                    styles.categoryRail,
                    compact && styles.categoryRailCompact,
                    { backgroundColor: categoryColor },
                ]}
            />

            <View style={[styles.content, compact && styles.contentCompact]}>
                <View style={[styles.titleRow, compact && styles.titleRowCompact]}>
                    {metadata.isTravel ? (
                        <Ionicons
                            accessible={false}
                            name={iconName}
                            size={compact ? 14 : 16}
                            color={categoryColor}
                            style={styles.titleIcon}
                        />
                    ) : null}
                    <Text
                        maxFontSizeMultiplier={1.5}
                        numberOfLines={1}
                        style={[
                            styles.title,
                            compact && styles.titleCompact,
                            { color: colors.textPrimary },
                        ]}
                    >
                        {item.title}
                    </Text>
                    {item.routeSetupRequired ? (
                        <View style={[styles.routeBadge, { borderColor: colorWithOpacity(categoryColor, 0.38) }]}>
                            <Ionicons accessible={false} name="navigate-outline" size={11} color={categoryColor} />
                            <Text style={[styles.routeBadgeText, { color: categoryColor }]}>경로 미설정</Text>
                        </View>
                    ) : null}
                </View>

                {(timeText || metadata.location) ? (
                    <View style={[styles.metaRow, compact && styles.metaRowCompact]}>
                        {timeText ? (
                            <Text
                                maxFontSizeMultiplier={1.5}
                                numberOfLines={1}
                                style={[
                                    styles.time,
                                    compact && styles.metaTextCompact,
                                    { color: colors.textSecondary },
                                ]}
                            >
                                {timeText}
                            </Text>
                        ) : null}
                        {metadata.location ? (
                            <Text
                                maxFontSizeMultiplier={1.5}
                                numberOfLines={1}
                                style={[
                                    styles.location,
                                    compact && styles.metaTextCompact,
                                    { color: colors.textSecondary },
                                ]}
                            >
                                {metadata.location}
                            </Text>
                        ) : null}
                    </View>
                ) : null}

                {metadata.isTravel && travelText ? (
                    <View style={[styles.travelRow, compact && styles.travelRowCompact]}>
                        <Ionicons accessible={false} name={iconName} size={compact ? 12 : 13} color={categoryColor} />
                        <Text
                            maxFontSizeMultiplier={1.5}
                            numberOfLines={1}
                            style={[
                                styles.travelText,
                                compact && styles.travelTextCompact,
                                { color: categoryColor },
                            ]}
                        >
                            {travelText}
                        </Text>
                    </View>
                ) : null}
            </View>

            <View style={[styles.chevronColumn, compact && styles.chevronColumnCompact]}>
                <Ionicons
                    accessible={false}
                    name="chevron-forward"
                    size={compact ? 14 : 16}
                    color={colors.textSecondary}
                />
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        minHeight: 62,
        flexDirection: "row",
        alignItems: "stretch",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 9,
        overflow: "hidden",
    },
    cardCompact: {
        minHeight: 58,
        borderRadius: 8,
    },
    categoryRail: {
        width: 3,
        flexShrink: 0,
    },
    categoryRailCompact: {
        width: 2.5,
    },
    content: {
        flex: 1,
        minWidth: 0,
        justifyContent: "center",
        paddingVertical: 9,
        paddingLeft: 11,
        paddingRight: 3,
    },
    contentCompact: {
        paddingVertical: 7,
        paddingLeft: 10,
        paddingRight: 2,
    },
    titleRow: {
        minWidth: 0,
        minHeight: 20,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    titleRowCompact: {
        minHeight: 18,
        gap: 5,
    },
    titleIcon: {
        flexShrink: 0,
    },
    routeBadge: {
        height: 21,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 11,
        paddingHorizontal: 6,
    },
    routeBadgeText: {
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "800",
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        lineHeight: 20,
        fontWeight: "800",
        letterSpacing: 0,
    },
    titleCompact: {
        fontSize: 14,
        lineHeight: 18,
        fontWeight: "700",
    },
    metaRow: {
        minWidth: 0,
        minHeight: 17,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    metaRowCompact: {
        minHeight: 15,
        gap: 9,
    },
    time: {
        flexShrink: 0,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "700",
        letterSpacing: 0,
    },
    location: {
        flex: 1,
        minWidth: 0,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "600",
        letterSpacing: 0,
    },
    metaTextCompact: {
        fontSize: 11.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    travelRow: {
        minWidth: 0,
        minHeight: 17,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    travelRowCompact: {
        minHeight: 15,
        gap: 4,
    },
    travelText: {
        flex: 1,
        minWidth: 0,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    travelTextCompact: {
        fontSize: 11.5,
        lineHeight: 15,
        fontWeight: "700",
    },
    chevronColumn: {
        width: 32,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
    },
    chevronColumnCompact: {
        width: 27,
    },
});
