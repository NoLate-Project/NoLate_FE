import React from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import type { SubscriptionPolicy } from "../../../../api/subscription";
import { useTheme } from "../../../theme/ThemeContext";
import { formatRouteClock, formatRouteDuration, type RouteInfo } from "../../routeInfo";

type Props = {
    routeReady: boolean;
    enabled: boolean;
    leadMinutes: number;
    intervalMinutes: number;
    routeInfo?: RouteInfo;
    startAt?: Date;
    policy: SubscriptionPolicy;
    onEnabledChange: (enabled: boolean) => void;
    onLeadMinutesChange: (minutes: number) => void;
    onIntervalMinutesChange: (minutes: number) => void;
};

export default function NotificationSettingsCard({
    routeReady,
    enabled,
    leadMinutes,
    intervalMinutes,
    routeInfo,
    startAt,
    policy,
    onEnabledChange,
    onLeadMinutesChange,
    onIntervalMinutesChange,
}: Props) {
    const { colors, mode } = useTheme();
    const quotaReached = policy.usedSmartSchedulesThisMonth >= policy.maxSmartSchedulesPerMonth;
    const canEnable = routeReady && !quotaReached;
    const accentBlue = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const routeMinutes = routeInfo?.totalDurationMinutes;
    const eventStartAt = startAt && !Number.isNaN(startAt.getTime()) ? startAt : undefined;
    const recommendedDepartureAt = eventStartAt && typeof routeMinutes === "number"
        ? new Date(eventStartAt.getTime() - routeMinutes * 60 * 1000)
        : undefined;
    const arrivalAt = eventStartAt;

    return (
        <View style={[styles.container, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }]}>
            <View style={styles.header}>
                <View style={styles.headerText}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>출발 알림</Text>
                    <Text style={[styles.usage, { color: colors.textSecondary }]}>
                        교통 상황을 반영해 최적의 출발 시간을 알려드려요.
                    </Text>
                </View>
                <Switch
                    accessibilityLabel="출발 알림"
                    accessibilityHint={canEnable || enabled ? undefined : "경로 선택 또는 이용 한도 확인이 필요합니다"}
                    value={enabled}
                    disabled={!canEnable && !enabled}
                    onValueChange={onEnabledChange}
                    trackColor={{ false: colors.border, true: accentBlue }}
                    thumbColor="#FFFFFF"
                />
            </View>

            {!routeReady ? (
                <Text style={[styles.notice, { color: colors.textSecondary }]}>경로를 선택하면 설정할 수 있어요.</Text>
            ) : quotaReached && !enabled ? (
                <Text style={[styles.notice, { color: colors.textSecondary }]}>이번 달 알림 일정 한도를 사용했어요.</Text>
            ) : null}

            {enabled ? (
                <View style={styles.settings}>
                    <View style={[styles.recommendationCard, { borderColor: colors.border }]}>
                        <View style={styles.recommendationCol}>
                            <Text style={[styles.label, { color: colors.textSecondary }]}>추천 출발 시간</Text>
                            <Text style={[styles.recommendationValue, { color: colors.textPrimary }]}>
                                {recommendedDepartureAt ? formatRouteClock(recommendedDepartureAt) : "-"}
                            </Text>
                        </View>
                        <View style={styles.recommendationCol}>
                            <Text style={[styles.label, { color: colors.textSecondary }]}>도착 예정 시간</Text>
                            <Text style={[styles.recommendationValue, { color: colors.textPrimary }]}>
                                {arrivalAt ? formatRouteClock(arrivalAt) : "-"}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.reminderMetaRow}>
                        <Text style={[styles.description, { color: colors.textSecondary }]}>
                            예상 이동시간 {formatRouteDuration(routeMinutes)} · {leadMinutes}분 전부터 확인
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="추천 알림 설정 적용"
                            onPress={() => {
                                onLeadMinutesChange(Math.min(60, policy.maxNotificationLeadMinutes));
                                onIntervalMinutesChange(Math.max(intervalMinutes, policy.minEtaRefreshIntervalMinutes));
                            }}
                            style={[styles.useButton, { borderColor: accentBlue }]}
                        >
                            <Text style={[styles.useButtonText, { color: accentBlue }]}>추천 설정 적용</Text>
                        </Pressable>
                    </View>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 38,
    },
    headerText: { flex: 1, paddingRight: 12 },
    title: { fontSize: 14, fontWeight: "700" },
    usage: { marginTop: 3, fontSize: 11, fontWeight: "600" },
    notice: { marginTop: 10, fontSize: 12 },
    settings: { marginTop: 14 },
    label: { marginBottom: 7, fontSize: 12, fontWeight: "600" },
    description: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
    recommendationCard: {
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        flexDirection: "row",
        gap: 14,
    },
    recommendationCol: {
        flex: 1,
    },
    recommendationValue: {
        fontSize: 14,
        fontWeight: "900",
    },
    reminderMetaRow: {
        marginTop: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    useButton: {
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: 5,
        paddingHorizontal: 10,
    },
    useButtonText: {
        fontSize: 11,
        fontWeight: "800",
    },
});
