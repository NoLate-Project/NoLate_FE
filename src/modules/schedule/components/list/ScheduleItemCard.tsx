import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ScheduleItem } from "../../types";
import { useTheme } from "../../../theme/ThemeContext";
import { formatHHmm } from "../../../../../lib/util/data";
import { getTravelModeLabel } from "../../travelMode";

type Props = {
    item: ScheduleItem;
    onPress: () => void;
};

// 단일 일정의 시간, 카테고리, 이동 경로 요약을 카드로 표시한다.
export default function ScheduleItemCard({ item, onPress }: Props) {
    const { colors } = useTheme();
    const categoryColor = item.category?.color ?? "#555";
    const routeText =
        item.origin?.name && item.destination?.name
            ? `${item.origin.name} → ${item.destination.name}`
            : item.locationName;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => ({
                backgroundColor: pressed ? colors.surface2 : colors.surface,
                borderRadius: 18,
                overflow: "hidden",
                flexDirection: "row",
            })}
        >
            <View
                style={{
                    width: 4,
                    backgroundColor: categoryColor,
                    borderTopLeftRadius: 18,
                    borderBottomLeftRadius: 18,
                }}
            />

            <View style={{ flex: 1, paddingVertical: 15, paddingHorizontal: 14 }}>
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <Text
                        numberOfLines={1}
                        style={{
                            fontSize: 16,
                            fontWeight: "700",
                            color: colors.textPrimary,
                            flex: 1,
                            marginRight: 8,
                        }}
                    >
                        {item.title}
                    </Text>

                    <View
                        style={{
                            paddingVertical: 3,
                            paddingHorizontal: 9,
                            borderRadius: 20,
                            backgroundColor: colors.surface2,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 11,
                                fontWeight: "500",
                                color: colors.textSecondary,
                            }}
                        >
                            {item.category?.title ?? "기타"}
                        </Text>
                    </View>
                </View>

                <Text style={{ marginTop: 5, color: colors.textSecondary, fontSize: 13 }}>
                    {item.hasEndTime === false
                        ? formatHHmm(item.startAt)
                        : `${formatHHmm(item.startAt)} – ${formatHHmm(item.endAt)}`}
                </Text>

                {routeText ? (
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, gap: 4 }}>
                        <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                        <Text
                            style={{ flex: 1, color: colors.textSecondary, fontSize: 12, opacity: 0.8 }}
                            numberOfLines={1}
                        >
                            {routeText}
                        </Text>
                    </View>
                ) : null}

                {!!item.travelMode && (
                    <Text style={{ marginTop: 3, color: colors.textSecondary, fontSize: 12, opacity: 0.7 }}>
                        {getTravelModeLabel(item.travelMode)}
                        {typeof item.travelMinutes === "number" ? ` · ${item.travelMinutes}분` : ""}
                    </Text>
                )}
            </View>
        </Pressable>
    );
}
