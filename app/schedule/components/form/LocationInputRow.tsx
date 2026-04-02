import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "../../../../src/modules/theme/ThemeContext";
import type { TravelMode } from "../../../../src/modules/schedule/types";
import { getTravelModeLabel } from "../../../../src/modules/schedule/travelMode";

type Props = {
    originValue: string;
    destinationValue: string;
    travelMode?: TravelMode;
    travelMinutes?: number;
    onPress: () => void;
};

export default function LocationInputRow({
    originValue,
    destinationValue,
    travelMode,
    travelMinutes,
    onPress,
}: Props) {
    const { colors } = useTheme();

    const hasRoute = !!originValue || !!destinationValue;
    const routeText =
        hasRoute && originValue && destinationValue
            ? `${originValue} → ${destinationValue}`
            : hasRoute
                ? originValue || destinationValue
                : "지도로 출발지/도착지를 설정하세요";
    const modeText = travelMode ? getTravelModeLabel(travelMode) : "이동수단 미지정";

    return (
        <View style={{ marginBottom: 14 }}>
            <Text style={{ color: colors.textSecondary, marginBottom: 6, fontSize: 13 }}>이동 경로</Text>
            <Pressable
                onPress={onPress}
                style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    backgroundColor: colors.surface2,
                    gap: 4,
                }}
            >
                <Text numberOfLines={1} style={{ color: hasRoute ? colors.textPrimary : colors.textDisabled, fontWeight: "600" }}>
                    {routeText}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                    {modeText}
                    {typeof travelMinutes === "number" ? ` · 예상 ${travelMinutes}분` : ""}
                </Text>
            </Pressable>
        </View>
    );
}
