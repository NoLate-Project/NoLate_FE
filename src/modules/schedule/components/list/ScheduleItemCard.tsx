import React from "react";
import { Pressable, Text, View } from "react-native";
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
                borderRadius: 14,
                overflow: "hidden",
                flexDirection: "row",
            })}
        >
            <View
                style={{
                    width: 4,
                    backgroundColor: categoryColor,
                    borderTopLeftRadius: 14,
                    borderBottomLeftRadius: 14,
                }}
            />

            <View style={{ flex: 1, padding: 14 }}>
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
                            fontSize: 15,
                            fontWeight: "600",
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
                    {formatHHmm(item.startAt)} – {formatHHmm(item.endAt)}
                </Text>

                {routeText ? (
                    <Text
                        style={{ marginTop: 3, color: colors.textSecondary, fontSize: 12, opacity: 0.7 }}
                        numberOfLines={1}
                    >
                        📍 {routeText}
                    </Text>
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
