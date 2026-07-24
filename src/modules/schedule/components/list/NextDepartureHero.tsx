import React from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "../../../theme/ThemeContext";
import type { NextDepartureHeroModel } from "../../nextDeparture";

type NextDepartureHeroProps = {
    model: NextDepartureHeroModel | null;
    loading: boolean;
    connectionIssue: "offline" | "error" | null;
    onPressSchedule: (id: string) => void;
    onPressRetry: () => void;
};

function getAccentColor(model: NextDepartureHeroModel): string {
    switch (model.phase) {
        case "PAST":
        case "ENDED":
            return "#FF453A";
        case "DUE":
        case "SOON":
            return "#FF9F0A";
        case "NO_ETA":
            return "#8E8E93";
        default:
            return "#32D74B";
    }
}

function NextDepartureEmptyState({
    loading,
    connectionIssue,
    onPressRetry,
}: Pick<NextDepartureHeroProps, "loading" | "connectionIssue" | "onPressRetry">) {
    const { colors, mode } = useTheme();
    const retryable = !loading && connectionIssue !== null;
    const title = loading
        ? "다음 출발을 확인하고 있어요"
        : connectionIssue === "offline"
            ? "오프라인이라 다음 출발을 확인할 수 없어요"
            : connectionIssue === "error"
                ? "다음 출발을 불러오지 못했어요"
                : "예정된 다음 출발이 없어요";
    const description = loading
        ? "저장된 일정과 이동 정보를 확인합니다"
        : retryable
            ? "네트워크 연결을 확인한 뒤 다시 시도해 주세요"
            : "이동 경로가 있는 일정이 생기면 여기에 표시됩니다";

    return (
        <Pressable
            testID="next-departure-empty"
            accessibilityRole={retryable ? "button" : undefined}
            accessibilityLabel={retryable ? `${title}. 다시 조회` : title}
            accessibilityHint={retryable ? "다음 출발 정보를 다시 불러옵니다" : undefined}
            disabled={!retryable}
            onPress={retryable ? onPressRetry : undefined}
            style={({ pressed }) => [
                styles.emptyCard,
                {
                    backgroundColor: mode === "dark"
                        ? "rgba(255,255,255,0.055)"
                        : "rgba(0,0,0,0.035)",
                    borderColor: colors.border,
                    opacity: pressed ? 0.68 : 1,
                },
            ]}
        >
            <View
                style={[
                    styles.emptyIcon,
                    mode === "dark" ? styles.emptyIconDark : styles.emptyIconLight,
                ]}
            >
                {loading ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                    <Ionicons
                        accessible={false}
                        name={retryable ? "cloud-offline-outline" : "navigate-outline"}
                        size={18}
                        color={colors.textSecondary}
                    />
                )}
            </View>
            <View style={styles.emptyCopy}>
                <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
                    {title}
                </Text>
                <Text style={[styles.emptyDescription, { color: colors.textSecondary }]}>
                    {description}
                </Text>
            </View>
            {retryable ? (
                <Ionicons
                    accessible={false}
                    name="refresh-outline"
                    size={18}
                    color={colors.textSecondary}
                />
            ) : null}
        </Pressable>
    );
}

export default function NextDepartureHero({
    model,
    loading,
    connectionIssue,
    onPressSchedule,
    onPressRetry,
}: NextDepartureHeroProps) {
    const { colors, mode } = useTheme();

    if (!model) {
        return (
            <NextDepartureEmptyState
                loading={loading}
                connectionIssue={connectionIssue}
                onPressRetry={onPressRetry}
            />
        );
    }

    const accent = getAccentColor(model);
    const confidenceIsLow = model.departureStatus?.confidence === "LOW";

    return (
        <Pressable
            testID="next-departure-hero"
            accessibilityRole="button"
            accessibilityLabel={model.accessibilityLabel}
            accessibilityHint="일정 상세에서 경로와 기존 출발 액션을 확인합니다"
            onPress={() => onPressSchedule(model.item.id)}
            style={({ pressed }) => [
                styles.card,
                {
                    backgroundColor: mode === "dark"
                        ? "rgba(28,28,30,0.96)"
                        : "rgba(247,247,248,0.98)",
                    borderColor: mode === "dark"
                        ? "rgba(255,255,255,0.11)"
                        : "rgba(60,60,67,0.12)",
                    opacity: pressed ? 0.72 : 1,
                    transform: [{ scale: pressed ? 0.992 : 1 }],
                },
            ]}
        >
            <View pointerEvents="none" style={[styles.accentRail, { backgroundColor: accent }]} />

            <View style={styles.headerRow}>
                <View style={styles.eyebrowRow}>
                    <Ionicons
                        accessible={false}
                        name="navigate"
                        size={13}
                        color={accent}
                    />
                    <Text style={[styles.eyebrow, { color: accent }]}>다음 출발</Text>
                </View>
                <View
                    style={[
                        styles.etaBadge,
                        mode === "dark" ? styles.etaBadgeDark : styles.etaBadgeLight,
                    ]}
                >
                    <View style={[styles.etaDot, { backgroundColor: accent }]} />
                    <Text
                        numberOfLines={1}
                        style={[styles.etaBadgeText, { color: colors.textSecondary }]}
                    >
                        {model.etaLabel}
                    </Text>
                </View>
            </View>

            <View style={styles.departureRow}>
                <View style={styles.departureTimeColumn}>
                    <Text
                        style={[styles.departureCaption, { color: colors.textSecondary }]}
                    >
                        추천 출발
                    </Text>
                    <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.76}
                        style={[styles.departureTime, { color: colors.textPrimary }]}
                    >
                        {model.departureClockLabel}
                    </Text>
                </View>
                <View style={styles.remainingColumn}>
                    <Text
                        accessibilityLiveRegion="polite"
                        numberOfLines={2}
                        style={[styles.remainingText, { color: accent }]}
                    >
                        {model.remainingLabel}
                    </Text>
                    {model.trafficChangeLabel ? (
                        <Text
                            numberOfLines={1}
                            style={[styles.trafficText, { color: colors.textSecondary }]}
                        >
                            {model.trafficChangeLabel}
                        </Text>
                    ) : null}
                </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.scheduleRow}>
                <View style={styles.scheduleCopy}>
                    <Text
                        numberOfLines={1}
                        style={[styles.scheduleTitle, { color: colors.textPrimary }]}
                    >
                        {model.item.title}
                    </Text>
                    <View style={styles.destinationRow}>
                        <Ionicons
                            accessible={false}
                            name="location-outline"
                            size={14}
                            color={colors.textSecondary}
                        />
                        <Text
                            numberOfLines={1}
                            style={[styles.destinationText, { color: colors.textSecondary }]}
                        >
                            {model.destinationLabel}
                        </Text>
                        <Text style={[styles.metaSeparator, { color: colors.textDisabled }]}>
                            ·
                        </Text>
                        <Text
                            numberOfLines={1}
                            style={[styles.travelText, { color: colors.textSecondary }]}
                        >
                            {model.travelLabel}
                        </Text>
                    </View>
                </View>
                {confidenceIsLow ? (
                    <Text style={[styles.referenceText, { color: colors.textSecondary }]}>
                        참고용
                    </Text>
                ) : null}
                <Ionicons
                    accessible={false}
                    name="chevron-forward"
                    size={16}
                    color={colors.textSecondary}
                />
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        minHeight: 178,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 20,
        paddingHorizontal: 17,
        paddingTop: 15,
        paddingBottom: 14,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 4,
    },
    accentRail: {
        position: "absolute",
        top: 16,
        bottom: 16,
        left: 0,
        width: 3,
        borderTopRightRadius: 2,
        borderBottomRightRadius: 2,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    eyebrowRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
    eyebrow: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "900",
        letterSpacing: 0.2,
    },
    etaBadge: {
        maxWidth: "62%",
        minHeight: 24,
        borderRadius: 12,
        paddingHorizontal: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    etaBadgeDark: {
        backgroundColor: "rgba(255,255,255,0.07)",
    },
    etaBadgeLight: {
        backgroundColor: "rgba(0,0,0,0.045)",
    },
    etaDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    etaBadgeText: {
        flexShrink: 1,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    departureRow: {
        minHeight: 72,
        paddingTop: 11,
        paddingBottom: 9,
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 14,
    },
    departureTimeColumn: {
        flex: 1,
        minWidth: 0,
    },
    departureCaption: {
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    departureTime: {
        marginTop: 1,
        fontSize: 29,
        lineHeight: 35,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
        letterSpacing: -0.5,
    },
    remainingColumn: {
        flexShrink: 1,
        maxWidth: "46%",
        alignItems: "flex-end",
        paddingBottom: 2,
    },
    remainingText: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "900",
        textAlign: "right",
        letterSpacing: 0,
    },
    trafficText: {
        marginTop: 2,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "700",
        textAlign: "right",
    },
    divider: {
        height: StyleSheet.hairlineWidth,
    },
    scheduleRow: {
        minHeight: 48,
        paddingTop: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    scheduleCopy: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    scheduleTitle: {
        fontSize: 15,
        lineHeight: 19,
        fontWeight: "800",
        letterSpacing: 0,
    },
    destinationRow: {
        flexDirection: "row",
        alignItems: "center",
        minWidth: 0,
        gap: 4,
    },
    destinationText: {
        flexShrink: 1,
        fontSize: 11.5,
        lineHeight: 16,
        fontWeight: "700",
    },
    metaSeparator: {
        fontSize: 11,
        lineHeight: 15,
    },
    travelText: {
        flexShrink: 0,
        fontSize: 11.5,
        lineHeight: 16,
        fontWeight: "700",
    },
    referenceText: {
        flexShrink: 0,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
    },
    emptyCard: {
        minHeight: 78,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 13,
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
    },
    emptyIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
    },
    emptyIconDark: {
        backgroundColor: "rgba(142,142,147,0.16)",
    },
    emptyIconLight: {
        backgroundColor: "rgba(142,142,147,0.12)",
    },
    emptyCopy: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    emptyTitle: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "800",
    },
    emptyDescription: {
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
});
