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
                : "출발지와 도착지 추가";
    const modeText = travelMode ? getTravelModeLabel(travelMode) : "이동수단 미지정";
    const expectedMinutes = routeInfo?.totalDurationMinutes ?? travelMinutes;
    const routeMeta = typeof expectedMinutes === "number"
        ? `${modeText} · 약 ${formatRouteDuration(expectedMinutes)}`
        : modeText;
    const accentBlue = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const cardBg = mode === "dark" ? "rgba(17,18,22,0.82)" : colors.inputBackground;

    return (
        <View style={{ marginBottom: 14 }}>
            <Text style={{ color: colors.textSecondary, marginBottom: 6, fontSize: 13, fontWeight: "600" }}>이동 경로</Text>
            <View
                style={{
                    borderWidth: 1,
                    borderColor: colors.inputBorder,
                    borderRadius: 16,
                    backgroundColor: cardBg,
                    overflow: "hidden",
                }}
            >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={hasRoute ? `이동 경로 수정, ${routeText}` : "출발지와 도착지 추가"}
                        accessibilityHint="경로 선택 화면을 엽니다"
                        onPress={onPress}
                        style={{
                            flex: 1,
                            minWidth: 0,
                            minHeight: 52,
                            paddingLeft: 12,
                            paddingRight: hasRoute && onClear ? 2 : 12,
                            paddingVertical: 11,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 10,
                        }}
                    >
                        <View
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: 14,
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "transparent",
                            }}
                        >
                            <Ionicons
                                accessible={false}
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
                                    {routeMeta}
                                </Text>
                            ) : (
                                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                                    경로를 추가하면 출발 알림을 설정할 수 있어요.
                                </Text>
                            )}
                        </View>
                        <Ionicons accessible={false} name="chevron-forward" size={18} color={colors.textSecondary} />
                    </Pressable>
                    {hasRoute && onClear ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="설정한 이동 경로 지우기"
                            hitSlop={{ top: 8, right: 8, bottom: 8, left: 4 }}
                            onPress={onClear}
                            style={{
                                width: 44,
                                height: 44,
                                marginRight: 6,
                                borderRadius: 22,
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: "transparent",
                            }}
                        >
                            <Ionicons accessible={false} name="close-circle" size={21} color={colors.textSecondary} />
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </View>
    );
}
