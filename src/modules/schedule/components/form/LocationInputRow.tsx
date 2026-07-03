import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../theme/ThemeContext";
import type { TravelMode } from "../../types";
import { getTravelModeLabel } from "../../travelMode";
import { formatRouteDuration, type RouteInfo } from "../../routeInfo";

type Props = {
    originValue: string;
    destinationValue: string;
    travelMode?: TravelMode;
    travelMinutes?: number;
    routeInfo?: RouteInfo;
    onPress: () => void;
    onClear?: () => void;
};

// 일정 폼에서 이동 경로 입력 상태를 한 줄 카드로 보여준다.
export default function LocationInputRow({
    originValue,
    destinationValue,
    travelMode,
    travelMinutes,
    routeInfo,
    onPress,
    onClear,
}: Props) {
    const { colors, mode } = useTheme();

    const hasRoute = !!routeInfo || !!originValue || !!destinationValue;
    const routeText =
        routeInfo
            ? `${routeInfo.originName} → ${routeInfo.destinationName}`
            : hasRoute && originValue && destinationValue
            ? `${originValue} → ${destinationValue}`
            : hasRoute
                ? originValue || destinationValue
                : "출발지 / 도착지 설정";
    const modeText = travelMode ? getTravelModeLabel(travelMode) : "이동수단 미지정";
    const expectedMinutes = routeInfo?.totalDurationMinutes ?? travelMinutes;
    const accentBlue = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const cardBg = mode === "dark" ? "rgba(17,18,22,0.82)" : colors.inputBackground;
    const iconButtonBg = mode === "dark" ? "rgba(255,255,255,0.07)" : "rgba(41,121,255,0.08)";

    return (
        <View style={{ marginBottom: 14 }}>
            <Text style={{ color: colors.textSecondary, marginBottom: 6, fontSize: 13, fontWeight: "600" }}>이동 경로</Text>
            <Pressable
                onPress={onPress}
                style={{
                    borderWidth: 1,
                    borderColor: colors.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    backgroundColor: cardBg,
                    gap: 4,
                }}
            >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View
                        style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: hasRoute ? "rgba(41,121,255,0.14)" : "rgba(255,255,255,0.055)",
                        }}
                    >
                        <Ionicons
                            name={hasRoute ? "navigate-outline" : "location-outline"}
                            size={17}
                            color={hasRoute ? accentBlue : colors.textSecondary}
                        />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: hasRoute ? colors.textPrimary : colors.inputPlaceholder, fontWeight: "800" }}>
                            {routeText}
                        </Text>
                        {hasRoute ? (
                            <Text style={{ color: accentBlue, fontSize: 12, marginTop: 2, fontWeight: "800" }}>
                                {typeof expectedMinutes === "number"
                                    ? `예상 이동시간 ${formatRouteDuration(expectedMinutes)}`
                                    : modeText}
                            </Text>
                        ) : (
                            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                                경로를 설정하면 예상 이동시간을 보여드려요.
                            </Text>
                        )}
                    </View>
                    {hasRoute ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View
                                style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 15,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: iconButtonBg,
                                }}
                            >
                                <Ionicons name="pencil" size={15} color={colors.textPrimary} />
                            </View>
                            {!!onClear && (
                                <Pressable
                                    hitSlop={8}
                                    onPress={(event) => {
                                        event.stopPropagation();
                                        onClear();
                                    }}
                                    style={{
                                        width: 30,
                                        height: 30,
                                        borderRadius: 15,
                                        alignItems: "center",
                                        justifyContent: "center",
                                        backgroundColor: iconButtonBg,
                                    }}
                                >
                                    <Ionicons name="close" size={17} color={colors.textSecondary} />
                                </Pressable>
                            )}
                        </View>
                    ) : (
                        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                    )}
                </View>
            </Pressable>
        </View>
    );
}
