import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
    const { colors } = useTheme();

    const hasRoute = !!routeInfo || !!originValue || !!destinationValue;
    const routeText =
        routeInfo
            ? `${routeInfo.originName} → ${routeInfo.destinationName}`
            : hasRoute && originValue && destinationValue
            ? `${originValue} → ${destinationValue}`
            : hasRoute
                ? originValue || destinationValue
                : "출발지·도착지 추가";
    const modeText = travelMode ? getTravelModeLabel(travelMode) : "이동수단 미지정";
    const expectedMinutes = routeInfo?.totalDurationMinutes ?? travelMinutes;
    const routeMeta = typeof expectedMinutes === "number"
        ? `${modeText} · 약 ${formatRouteDuration(expectedMinutes)}`
        : modeText;
    return (
        <View style={styles.section}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>이동 경로</Text>
            <View
                testID="location-input-card"
                style={[
                    styles.card,
                    { borderColor: colors.border, backgroundColor: colors.surface2 },
                ]}
            >
                <View style={styles.contentRow}>
                    <Pressable
                        testID="location-input-pressable"
                        accessibilityRole="button"
                        accessibilityLabel={hasRoute ? `이동 경로 수정, ${routeText}` : "출발지와 도착지 추가"}
                        accessibilityHint="경로 선택 화면을 엽니다"
                        onPress={onPress}
                        style={({ pressed }) => [
                            styles.routeButton,
                            hasRoute && onClear
                                ? styles.routeButtonWithClear
                                : styles.routeButtonWithoutClear,
                            pressed && { backgroundColor: colors.surface },
                        ]}
                    >
                        <View style={styles.textGroup}>
                            <Text numberOfLines={1} style={[styles.routeTitle, { color: colors.textPrimary }]}>
                                {routeText}
                            </Text>
                            {hasRoute ? (
                                <Text style={[styles.routeMeta, { color: colors.textSecondary }]}>
                                    {routeMeta}
                                </Text>
                            ) : (
                                <Text style={[styles.routeMeta, { color: colors.textSecondary }]}>
                                    경로와 출발 알림 설정
                                </Text>
                            )}
                        </View>
                        <View style={styles.chevronIcon}>
                            <Ionicons
                                accessible={false}
                                name="chevron-forward"
                                size={16}
                                color={colors.textSecondary}
                            />
                        </View>
                    </Pressable>
                    {hasRoute && onClear ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="설정한 이동 경로 지우기"
                            hitSlop={{ top: 8, right: 8, bottom: 8, left: 4 }}
                            onPress={onClear}
                            style={styles.clearButton}
                        >
                            <View
                                testID="location-input-clear-surface"
                                style={[
                                    styles.clearIconSurface,
                                    { backgroundColor: colors.surface },
                                ]}
                            >
                                <Ionicons accessible={false} name="close" size={14} color={colors.textSecondary} />
                            </View>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginBottom: 14,
    },
    label: {
        marginBottom: 6,
        fontSize: 12,
        fontWeight: "600",
    },
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        overflow: "hidden",
    },
    contentRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    routeButton: {
        flex: 1,
        minWidth: 0,
        minHeight: 58,
        paddingLeft: 12,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    routeButtonWithClear: {
        paddingRight: 2,
    },
    routeButtonWithoutClear: {
        paddingRight: 10,
    },
    textGroup: {
        flex: 1,
        minWidth: 0,
    },
    routeTitle: {
        fontSize: 14,
        fontWeight: "600",
    },
    routeMeta: {
        marginTop: 3,
        fontSize: 12,
        fontWeight: "500",
    },
    chevronIcon: {
        opacity: 0.7,
    },
    clearButton: {
        width: 44,
        height: 44,
        marginRight: 6,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
    },
    clearIconSurface: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
});
