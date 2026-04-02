import React from "react";
import { Pressable, Text, View } from "react-native";
import type { ScheduleItem } from "../../../../src/modules/schedule/types";
import { useTheme } from "../../../../src/modules/theme/ThemeContext";
import { formatHHmm } from "../../../../lib/util/data";
import { getTravelModeLabel } from "../../../../src/modules/schedule/travelMode";

type Props = {
    item: ScheduleItem;
    onPress: () => void;
};

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
            {/* 카테고리 컬러 바 */}
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
