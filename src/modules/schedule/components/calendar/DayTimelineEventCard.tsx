import React, { useMemo, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
    AccessibilityInfo,
    Animated,
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
    type DimensionValue,
} from "react-native";

import { useTheme } from "../../../theme/ThemeContext";
import {
    DAY_TIMELINE_CARD_VERTICAL_PADDING,
    DAY_TIMELINE_EVENT_MAX_FONT_SCALE,
    formatDayTimelineDeparture,
    formatDayTimelineTimeRange,
    getDayTimelineEventMetadata,
    getDayTimelineEventRows,
} from "../../dayTimelineLayout";
import type { ScheduleItem, TravelMode } from "../../types";
import ScheduleSwipeActions, {
    type ScheduleSwipeActionCallbacks,
} from "../ScheduleSwipeActions";
import DayEventReturnHighlight from "./DayEventReturnHighlight";

type Props = {
    item: ScheduleItem;
    top: number;
    height: number;
    left: DimensionValue;
    width: DimensionValue;
    laneCount: number;
    returnHighlightOpacity?: Animated.Value;
    onPress: (restoreFocus: () => void) => void;
    onLongPress?: () => void;
    swipeActions?: ScheduleSwipeActionCallbacks;
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
    returnHighlightOpacity,
    onPress,
    onLongPress,
    swipeActions,
}: Props) {
    const { colors, mode } = useTheme();
    const cardRef = useRef<React.ElementRef<typeof Pressable>>(null);
    const { fontScale } = useWindowDimensions();
    const rows = getDayTimelineEventRows(height, fontScale);
    const categoryColor = item.category?.color ?? "#8e8e93";
    const metadata = useMemo(() => getDayTimelineEventMetadata(item), [item]);
    const fullTimeText = useMemo(() => formatDayTimelineTimeRange(item), [item]);
    const startTime = formatDayTimelineDeparture(item.startAt);
    const timeText = laneCount >= 3 ? startTime : fullTimeText;
    const departureText = formatDayTimelineDeparture(metadata.departureAt);
    const travelText = [
        departureText ? `${departureText} 출발` : "",
        metadata.travelMinutes ? `${metadata.travelMinutes}분` : "",
    ].filter(Boolean).join(" · ");
    const showsTravelRow = metadata.isTravel && Boolean(travelText) && rows.fitsTravel && laneCount < 3;
    const showsLocation = Boolean(metadata.location) && laneCount < 3;
    const accessibilityLabel = [item.title, fullTimeText, metadata.location, travelText].filter(Boolean).join(", ");
    const availableSwipeActionText = [
        swipeActions?.onEdit ? "수정" : "",
        swipeActions?.onDelete ? "삭제" : "",
    ].filter(Boolean).join(" 또는 ");
    const accessibilityHint = availableSwipeActionText
        ? `왼쪽으로 밀면 ${availableSwipeActionText} 작업이 나타납니다.${
            onLongPress ? " 길게 눌러 작업 메뉴를 열 수도 있습니다." : ""
        }`
        : onLongPress
            ? "길게 누르면 수정 또는 삭제 메뉴가 열립니다"
            : undefined;

    return (
        <ScheduleSwipeActions
            itemTitle={item.title}
            onEdit={swipeActions?.onEdit}
            onDelete={swipeActions?.onDelete}
            compact={laneCount > 1 || height < 58}
            containerStyle={[
                styles.frame,
                { top, height, left, width },
            ]}
            childrenContainerStyle={styles.swipeChildren}
        >
          <Pressable
            ref={cardRef}
            testID="day-timeline-event-card"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={accessibilityHint}
            accessibilityActions={[
                ...(swipeActions?.onEdit ? [{ name: "edit", label: "수정" }] : []),
                ...(swipeActions?.onDelete ? [{ name: "delete", label: "삭제" }] : []),
            ]}
            onAccessibilityAction={({ nativeEvent }) => {
                if (nativeEvent.actionName === "edit") swipeActions?.onEdit?.();
                if (nativeEvent.actionName === "delete") swipeActions?.onDelete?.();
            }}
            onPress={() => onPress(() => {
                if (cardRef.current) AccessibilityInfo.sendAccessibilityEvent?.(cardRef.current, "focus");
            })}
            onLongPress={onLongPress}
            delayLongPress={420}
            style={({ pressed }) => [
                styles.card,
                {
                    backgroundColor: mode === "dark"
                        ? colorWithOpacity(categoryColor, 0.18)
                        : colorWithOpacity(categoryColor, 0.10),
                    borderColor: colorWithOpacity(categoryColor, mode === "dark" ? 0.46 : 0.28),
                    opacity: pressed ? 0.62 : 1,
                },
            ]}
        >
            {returnHighlightOpacity && (
                <DayEventReturnHighlight opacity={returnHighlightOpacity} color={colors.textPrimary} />
            )}
            <View style={[styles.accent, { backgroundColor: categoryColor }]} />
            <View style={[styles.content, showsTravelRow && styles.contentWithChevron]}>
                <View style={[styles.titleRow, { height: rows.titleHeight }]}>
                    {metadata.isTravel ? (
                        <Ionicons
                            accessible={false}
                            name={travelIconName(metadata.travelMode)}
                            size={14}
                            color={categoryColor}
                            style={styles.titleIcon}
                        />
                    ) : null}
                    <Text
                        maxFontSizeMultiplier={DAY_TIMELINE_EVENT_MAX_FONT_SCALE}
                        numberOfLines={1}
                        style={[styles.title, { color: colors.textPrimary }]}
                    >
                        {item.title}
                    </Text>
                    {!rows.fitsMetadata && laneCount === 1 && (
                        <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={[styles.inlineTime, { color: colors.textSecondary }]}>
                            {startTime}
                        </Text>
                    )}
                </View>

                {rows.fitsMetadata && <View style={[styles.metaRow, { height: rows.metaHeight }]}>
                    <Text
                        maxFontSizeMultiplier={DAY_TIMELINE_EVENT_MAX_FONT_SCALE}
                        numberOfLines={1}
                        style={[styles.time, { color: colors.textSecondary }]}
                    >
                        {timeText}
                    </Text>
                    {showsLocation ? (
                        <Text
                            maxFontSizeMultiplier={DAY_TIMELINE_EVENT_MAX_FONT_SCALE}
                            numberOfLines={1}
                            style={[styles.location, { color: colors.textSecondary }]}
                        >
                            {metadata.location}
                        </Text>
                    ) : null}
                </View>}

                {showsTravelRow ? (
                    <View style={[styles.travelRow, { height: rows.travelHeight }]}>
                        <Ionicons
                            accessible={false}
                            name={travelIconName(metadata.travelMode)}
                            size={12}
                            color={categoryColor}
                        />
                        <Text
                            maxFontSizeMultiplier={DAY_TIMELINE_EVENT_MAX_FONT_SCALE}
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
                    accessible={false}
                    name="chevron-forward"
                    size={13}
                    color={colors.textSecondary}
                    style={styles.chevron}
                />
            ) : null}
          </Pressable>
        </ScheduleSwipeActions>
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
    frame: {
        position: "absolute",
        borderRadius: 9,
    },
    swipeChildren: {
        flex: 1,
    },
    card: {
        flex: 1,
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
        fontWeight: "800",
        letterSpacing: 0,
    },
    metaRow: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    time: {
        minWidth: 0,
        flexShrink: 1,
        fontSize: 11.5,
        fontWeight: "700",
        letterSpacing: 0,
    },
    inlineTime: {
        flexShrink: 0,
        fontSize: 11.5,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
    },
    location: {
        flex: 1,
        minWidth: 0,
        fontSize: 11.5,
        fontWeight: "600",
        letterSpacing: 0,
    },
    travelRow: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    travelText: {
        flex: 1,
        minWidth: 0,
        fontSize: 11.5,
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
