import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ScheduleItem } from "../../types";
import { useTheme } from "../../../theme/ThemeContext";
import { formatHHmm } from "../../../../../lib/util/data";
import { getTravelModeLabel } from "../../travelMode";
import { getScheduleShareBadgeLabel } from "../../../share/sharePermissionPresentation";

type Props = {
    item: ScheduleItem;
    onPress: () => void;
    isLast?: boolean;
};

function getTimeBlock(item: ScheduleItem) {
    if (item.allDay) {
        return { primary: "종일", secondary: "" };
    }

    const start = formatHHmm(item.startAt);
    if (item.hasEndTime === false) {
        return { primary: start, secondary: "" };
    }

    return {
        primary: start,
        secondary: formatHHmm(item.endAt),
    };
}

// 단일 일정을 Apple Calendar에 가까운 얇은 행 형태로 표시한다.
export default function ScheduleItemCard({ item, onPress, isLast = false }: Props) {
    const { colors, mode } = useTheme();
    const categoryColor = item.category?.color ?? "#555";
    const routeText =
        item.origin?.name && item.destination?.name
            ? `${item.origin.name} → ${item.destination.name}`
            : item.locationName;
    const time = getTimeBlock(item);
    const travelText = typeof item.travelMinutes === "number"
        ? `${getTravelModeLabel(item.travelMode ?? "ETC")} ${item.travelMinutes}분`
        : "";
    const sharePermission = item.sharePermission ?? item.category?.sharePermission;
    const isShared = item.category?.shared === true || Boolean(sharePermission);
    const shareLabel = getScheduleShareBadgeLabel(sharePermission);
    const metaText = [
        item.category?.title,
        routeText,
        travelText,
        item.routeSetupRequired ? "경로 미설정" : undefined,
    ].filter(Boolean).join(" · ");
    const pressedBackground = mode === "dark"
        ? "rgba(255,255,255,0.06)"
        : "rgba(0,0,0,0.045)";

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={[
                time.secondary ? `${time.primary}~${time.secondary}` : time.primary,
                item.title,
                metaText,
                isShared ? shareLabel : undefined,
            ].filter(Boolean).join(", ")}
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: pressedBackground },
            ]}
        >
            <View style={styles.timeColumn}>
                <Text
                    numberOfLines={1}
                    style={[styles.timePrimary, { color: colors.textPrimary }]}
                >
                    {time.primary}
                </Text>
                {time.secondary ? (
                    <Text
                        numberOfLines={1}
                        style={[styles.timeSecondary, { color: colors.textSecondary }]}
                    >
                        {time.secondary}
                    </Text>
                ) : null}
            </View>

            <View style={[styles.categoryRail, { backgroundColor: categoryColor }]} />

            <View
                style={[
                    styles.body,
                    !isLast && [
                        styles.bodyDivider,
                        { borderBottomColor: colors.border },
                    ],
                ]}
            >
                <View style={styles.titleRow}>
                    <Text
                        numberOfLines={1}
                        style={[styles.title, { color: colors.textPrimary }]}
                    >
                        {item.title}
                    </Text>
                    {isShared && (
                        <View style={[styles.sharedBadge, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                            <Ionicons accessible={false} name="people-outline" size={13} color={colors.textSecondary} />
                            <Text style={[styles.sharedBadgeText, { color: colors.textSecondary }]}>
                                {shareLabel}
                            </Text>
                        </View>
                    )}
                    {item.routeSetupRequired && (
                        <View style={[styles.routeBadge, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                            <Ionicons accessible={false} name="navigate-outline" size={13} color={colors.textSecondary} />
                            <Text style={[styles.sharedBadgeText, { color: colors.textSecondary }]}>경로 미설정</Text>
                        </View>
                    )}
                </View>

                {metaText ? (
                    <Text
                        numberOfLines={1}
                        style={[styles.meta, { color: colors.textSecondary }]}
                    >
                        {metaText}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: 72,
        flexDirection: "row",
        alignItems: "stretch",
        borderRadius: 12,
    },
    timeColumn: {
        width: 64,
        paddingTop: 13,
        paddingLeft: 2,
        paddingRight: 10,
        alignItems: "flex-end",
    },
    timePrimary: {
        fontSize: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    timeSecondary: {
        marginTop: 3,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0,
    },
    categoryRail: {
        width: 4,
        marginTop: 14,
        marginBottom: 14,
        borderRadius: 2,
    },
    body: {
        flex: 1,
        minWidth: 0,
        paddingTop: 12,
        paddingBottom: 12,
        paddingLeft: 12,
        paddingRight: 4,
    },
    bodyDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: 17,
        lineHeight: 22,
        fontWeight: "800",
        letterSpacing: 0,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    sharedBadge: {
        height: 23,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        paddingHorizontal: 7,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    routeBadge: {
        height: 23,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        paddingHorizontal: 7,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    sharedBadgeText: {
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0,
    },
    meta: {
        marginTop: 4,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "600",
        letterSpacing: 0,
    },
});
