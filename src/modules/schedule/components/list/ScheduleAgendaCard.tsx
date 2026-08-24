import styles from "./ScheduleAgendaCard.styles";
import React, { useMemo } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { getScheduleShareBadgeLabel } from "../../../share/sharePermissionPresentation";
import { useTheme } from "../../../theme/ThemeContext";
import {
    formatDayTimelineDeparture,
    formatDayTimelineTimeRange,
    getDayTimelineEventMetadata,
} from "../../dayTimelineLayout";
import {
    formatAgendaDetailScheduleTime,
    formatAgendaDetailTimeColumn,
    formatAgendaMultiDayTimeRange,
    getAgendaMultiDaySummary,
} from "../../agendaLayout";
import { getTravelModeLabel } from "../../travelMode";
import type { ScheduleItem, TravelMode } from "../../types";
import ScheduleSwipeActions, {
    type ScheduleSwipeActionCallbacks,
} from "../ScheduleSwipeActions";

export type ScheduleAgendaCardProps = {
    item: ScheduleItem;
    onPress: () => void;
    onLongPress?: () => void;
    swipeActions?: ScheduleSwipeActionCallbacks;
    compact?: boolean;
    groupRow?: boolean;
    showMultiDaySummary?: boolean;
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
    onLongPress,
    swipeActions,
    compact = false,
    groupRow = false,
    showMultiDaySummary = false,
}: ScheduleAgendaCardProps) {
    const { colors, mode } = useTheme();
    const categoryColor = item.category?.color ?? "#8e8e93";
    const isDetailCard = groupRow && showMultiDaySummary;
    const metadata = useMemo(() => getDayTimelineEventMetadata(item), [item]);
    const timeText = useMemo(
        () => item.allDay ? "종일" : formatDayTimelineTimeRange(item),
        [item]
    );
    const departureText = formatDayTimelineDeparture(metadata.departureAt);
    const multiDaySummary = useMemo(
        () => showMultiDaySummary ? getAgendaMultiDaySummary(item) : null,
        [item, showMultiDaySummary]
    );
    const multiDayTimeRange = useMemo(
        () => showMultiDaySummary ? formatAgendaMultiDayTimeRange(item) : null,
        [item, showMultiDaySummary]
    );
    const detailScheduleTime = useMemo(
        () => isDetailCard ? formatAgendaDetailScheduleTime(item) : "",
        [isDetailCard, item]
    );
    const detailTimeColumn = useMemo(
        () => isDetailCard ? formatAgendaDetailTimeColumn(item) : null,
        [isDetailCard, item]
    );
    const detailedRangeText = multiDayTimeRange ?? multiDaySummary?.dateRangeLabel;
    const displayTimeText = multiDayTimeRange ? "" : timeText;
    const travelText = [
        departureText ? `${departureText} 출발` : "",
        metadata.travelMinutes ? `${metadata.travelMinutes}분` : "",
    ].filter(Boolean).join(" · ");
    const iconName = travelIconName(metadata.travelMode);
    const sharePermission = item.sharePermission ?? item.category?.sharePermission;
    const isShared = item.category?.shared === true || Boolean(sharePermission);
    const shareAccessibilityLabel = isShared
        ? getScheduleShareBadgeLabel(sharePermission)
        : undefined;
    const travelModeAccessibilityLabel = metadata.isTravel && metadata.travelMode
        ? `${getTravelModeLabel(metadata.travelMode)} 이동`
        : undefined;
    const timedStayLabel = !item.allDay && multiDayTimeRange
        ? multiDaySummary?.stayLabel
        : undefined;
    const allDayStayLabel = item.allDay ? multiDaySummary?.stayLabel : undefined;
    const detailStayLabel = timedStayLabel ?? allDayStayLabel;
    const detailTravelText = item.routeSetupRequired ? "" : travelText;
    const hasDetailContext = Boolean(
        metadata.location || detailTravelText || item.routeSetupRequired
    );
    const routeStatusColor = mode === "dark" ? "#FF9F0A" : "#B85F00";
    const shareBadgeBackground = mode === "dark"
        ? "rgba(255,255,255,0.035)"
        : "rgba(0,0,0,0.025)";
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
            compact={compact || groupRow}
            containerStyle={[
                styles.swipeContainer,
                compact && styles.swipeContainerCompact,
                groupRow && styles.swipeContainerGroupRow,
            ]}
        >
          <Pressable
            testID={isDetailCard ? "selected-day-agenda-card" : undefined}
            accessibilityRole="button"
            accessibilityLabel={[
                item.title,
                isDetailCard ? detailStayLabel : multiDaySummary?.stayLabel,
                isDetailCard ? detailScheduleTime : detailedRangeText,
                isDetailCard ? undefined : displayTimeText,
                travelModeAccessibilityLabel,
                metadata.location,
                (isDetailCard ? detailTravelText : travelText) || undefined,
                item.routeSetupRequired ? "경로 미설정" : undefined,
                shareAccessibilityLabel,
            ].filter(Boolean).join(", ")}
            accessibilityHint={accessibilityHint}
            accessibilityActions={[
                ...(swipeActions?.onEdit ? [{ name: "edit", label: "수정" }] : []),
                ...(swipeActions?.onDelete ? [{ name: "delete", label: "삭제" }] : []),
            ]}
            onAccessibilityAction={({ nativeEvent }) => {
                if (nativeEvent.actionName === "edit") swipeActions?.onEdit?.();
                if (nativeEvent.actionName === "delete") swipeActions?.onDelete?.();
            }}
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={420}
            style={({ pressed }) => [
                styles.card,
                compact && styles.cardCompact,
                groupRow && styles.groupRow,
                {
                    backgroundColor: groupRow
                        ? pressed
                            ? mode === "dark"
                                ? "rgba(255,255,255,0.075)"
                                : "rgba(0,0,0,0.045)"
                            : "transparent"
                        : mode === "dark"
                            ? colorWithOpacity(categoryColor, compact ? 0.12 : 0.18)
                            : colorWithOpacity(categoryColor, compact ? 0.065 : 0.10),
                    borderColor: groupRow
                        ? "transparent"
                        : colorWithOpacity(
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
                testID={isDetailCard ? "selected-day-agenda-card-rail" : undefined}
                style={[
                    styles.categoryRail,
                    compact && styles.categoryRailCompact,
                    groupRow && styles.categoryRailGroupRow,
                    { backgroundColor: categoryColor },
                ]}
            />

            <View
                testID={isDetailCard ? "selected-day-agenda-card-content" : undefined}
                style={[
                    styles.content,
                    compact && styles.contentCompact,
                    groupRow && styles.contentGroupRow,
                ]}
            >
                <View
                    testID={isDetailCard ? "agenda-card-title-row" : undefined}
                    style={[styles.titleRow, compact && styles.titleRowCompact]}
                >
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
                    {isDetailCard && detailStayLabel ? (
                        <View
                            testID="agenda-multi-day-summary"
                            style={[
                                styles.durationBadge,
                                {
                                    backgroundColor: colorWithOpacity(categoryColor, mode === "dark" ? 0.15 : 0.09),
                                    borderColor: colorWithOpacity(categoryColor, mode === "dark" ? 0.65 : 0.46),
                                },
                            ]}
                        >
                            <Text
                                maxFontSizeMultiplier={1.4}
                                numberOfLines={1}
                                style={[styles.durationBadgeText, { color: categoryColor }]}
                            >
                                {detailStayLabel}
                            </Text>
                        </View>
                    ) : null}
                    {isDetailCard && isShared ? (
                        <View
                            testID="agenda-shared-badge"
                            style={[
                                styles.statusBadge,
                                {
                                    backgroundColor: shareBadgeBackground,
                                    borderColor: colors.border,
                                },
                            ]}
                        >
                            <Ionicons
                                accessible={false}
                                name="people-outline"
                                size={11}
                                color={colors.textSecondary}
                            />
                            <Text
                                maxFontSizeMultiplier={1.4}
                                numberOfLines={1}
                                style={[styles.statusBadgeText, { color: colors.textSecondary }]}
                            >
                                공유
                            </Text>
                        </View>
                    ) : null}
                    {!isDetailCard && item.routeSetupRequired ? (
                        <View style={[styles.routeBadge, { borderColor: colorWithOpacity(categoryColor, 0.38) }]}>
                            <Ionicons accessible={false} name="navigate-outline" size={11} color={categoryColor} />
                            <Text style={[styles.routeBadgeText, { color: categoryColor }]}>경로 미설정</Text>
                        </View>
                    ) : null}
                </View>

                {isDetailCard && hasDetailContext ? (
                    <View
                        testID="agenda-card-context-row"
                        style={styles.detailContextRow}
                    >
                        {metadata.location || detailTravelText ? (
                            <Ionicons
                                accessible={false}
                                name={metadata.location ? "location-outline" : "navigate-outline"}
                                size={13}
                                color={metadata.location ? colors.textSecondary : routeStatusColor}
                            />
                        ) : null}
                        {(metadata.location || detailTravelText) ? (
                            <Text
                                maxFontSizeMultiplier={1.5}
                                numberOfLines={1}
                                style={[styles.detailContextText, { color: colors.textSecondary }]}
                            >
                                {metadata.location ?? ""}
                                {metadata.location && detailTravelText ? " · " : ""}
                                {detailTravelText ? (
                                    <Text
                                        numberOfLines={1}
                                        style={[styles.detailTravelText, { color: categoryColor }]}
                                    >
                                        {detailTravelText}
                                    </Text>
                                ) : null}
                            </Text>
                        ) : null}
                        {item.routeSetupRequired ? (
                            <View
                                testID="agenda-route-required-badge"
                                style={[
                                    styles.routeStatusBadge,
                                    {
                                        backgroundColor: colorWithOpacity(routeStatusColor, mode === "dark" ? 0.09 : 0.06),
                                        borderColor: colorWithOpacity(routeStatusColor, 0.72),
                                    },
                                ]}
                            >
                                <Ionicons
                                    accessible={false}
                                    name="navigate-outline"
                                    size={11}
                                    color={routeStatusColor}
                                />
                                <Text
                                    maxFontSizeMultiplier={1.4}
                                    numberOfLines={1}
                                    style={[styles.routeStatusBadgeText, { color: routeStatusColor }]}
                                >
                                    경로 미설정
                                </Text>
                            </View>
                        ) : null}
                    </View>
                ) : null}

                {!isDetailCard && (multiDaySummary || multiDayTimeRange) ? (
                    <View
                        testID="agenda-multi-day-summary"
                        style={styles.multiDayRow}
                    >
                        <Ionicons
                            accessible={false}
                            name="calendar-outline"
                            size={12}
                            color={categoryColor}
                        />
                        {multiDaySummary ? (
                            <Text
                                maxFontSizeMultiplier={1.5}
                                numberOfLines={1}
                                style={[styles.multiDayStay, { color: categoryColor }]}
                            >
                                {multiDaySummary.stayLabel}
                            </Text>
                        ) : null}
                        {multiDaySummary && detailedRangeText ? (
                            <View
                                accessible={false}
                                style={[
                                    styles.multiDaySeparator,
                                    { backgroundColor: colors.textSecondary },
                                ]}
                            />
                        ) : null}
                        {detailedRangeText ? (
                            <Text
                                maxFontSizeMultiplier={1.5}
                                numberOfLines={2}
                                style={[styles.multiDayRange, { color: colors.textSecondary }]}
                            >
                                {detailedRangeText}
                            </Text>
                        ) : null}
                    </View>
                ) : null}

                {!isDetailCard && (displayTimeText || metadata.location) ? (
                    <View style={[styles.metaRow, compact && styles.metaRowCompact]}>
                        {displayTimeText ? (
                            <Text
                                maxFontSizeMultiplier={1.5}
                                numberOfLines={1}
                                style={[
                                    styles.time,
                                    compact && styles.metaTextCompact,
                                    { color: colors.textSecondary },
                                ]}
                            >
                                {displayTimeText}
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

                {!isDetailCard && metadata.isTravel && travelText ? (
                    <View style={[
                        styles.travelRow,
                        compact && styles.travelRowCompact,
                    ]}>
                        <Ionicons
                            accessible={false}
                            name={iconName}
                            size={compact ? 12 : 13}
                            color={categoryColor}
                        />
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

            {isDetailCard && detailTimeColumn ? (
                <View
                    testID="agenda-card-time-column"
                    style={styles.detailTimeColumn}
                >
                    <Text
                        maxFontSizeMultiplier={1.4}
                        numberOfLines={1}
                        style={[styles.detailTimePrimary, { color: colors.textPrimary }]}
                    >
                        {detailTimeColumn.startLabel}
                    </Text>
                    {detailTimeColumn.endLabel ? (
                        <Text
                            maxFontSizeMultiplier={1.4}
                            numberOfLines={1}
                            style={[styles.detailTimeSecondary, { color: colors.textSecondary }]}
                        >
                            {detailTimeColumn.endLabel}
                        </Text>
                    ) : null}
                </View>
            ) : (
                <View style={[styles.chevronColumn, compact && styles.chevronColumnCompact]}>
                    <Ionicons
                        accessible={false}
                        name="chevron-forward"
                        size={compact ? 14 : 16}
                        color={colors.textSecondary}
                    />
                </View>
            )}
          </Pressable>
        </ScheduleSwipeActions>
    );
}
