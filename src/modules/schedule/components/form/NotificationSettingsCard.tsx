import React from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import type { SubscriptionPolicy } from "../../../../api/subscription";
import { useTheme } from "../../../theme/ThemeContext";

type Props = {
    routeReady: boolean;
    enabled: boolean;
    leadMinutes: number;
    intervalMinutes: number;
    policy: SubscriptionPolicy;
    onEnabledChange: (enabled: boolean) => void;
    onLeadMinutesChange: (minutes: number) => void;
    onIntervalMinutesChange: (minutes: number) => void;
};

const LEAD_OPTIONS = [30, 60, 90, 120];
const INTERVAL_OPTIONS = [10, 15, 20, 30];

export default function NotificationSettingsCard({
    routeReady,
    enabled,
    leadMinutes,
    intervalMinutes,
    policy,
    onEnabledChange,
    onLeadMinutesChange,
    onIntervalMinutesChange,
}: Props) {
    const { colors } = useTheme();
    const quotaReached = policy.usedSmartSchedulesThisMonth >= policy.maxSmartSchedulesPerMonth;
    const canEnable = routeReady && !quotaReached;

    const renderOptions = (
        options: number[],
        selected: number,
        isAllowed: (minutes: number) => boolean,
        onChange: (minutes: number) => void,
    ) => (
        <View style={styles.optionRow}>
            {options.map((minutes) => {
                const allowed = isAllowed(minutes);
                const active = selected === minutes;
                return (
                    <Pressable
                        key={minutes}
                        disabled={!allowed}
                        onPress={() => onChange(minutes)}
                        style={[
                            styles.option,
                            {
                                borderColor: active ? colors.selectedDayBg : colors.border,
                                backgroundColor: active ? colors.selectedDayBg : colors.surface,
                                opacity: allowed ? 1 : 0.38,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.optionText,
                                { color: active ? colors.selectedDayText : colors.textSecondary },
                            ]}
                        >
                            {minutes}분
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );

    return (
        <View style={[styles.container, { borderColor: colors.border, backgroundColor: colors.surface2 }]}>
            <View style={styles.header}>
                <View style={styles.headerText}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>실시간 출발 알림</Text>
                    <Text style={[styles.usage, { color: colors.textSecondary }]}>
                        {policy.plan === "PREMIUM" ? "프리미엄" : "무료"} · 이번 달{" "}
                        {policy.usedSmartSchedulesThisMonth}/{policy.maxSmartSchedulesPerMonth}
                    </Text>
                </View>
                <Switch
                    value={enabled}
                    disabled={!canEnable && !enabled}
                    onValueChange={onEnabledChange}
                    trackColor={{ false: colors.border, true: colors.selectedDayBg }}
                />
            </View>

            {!routeReady ? (
                <Text style={[styles.notice, { color: colors.textSecondary }]}>경로를 선택하면 설정할 수 있어요.</Text>
            ) : quotaReached && !enabled ? (
                <Text style={[styles.notice, { color: colors.textSecondary }]}>이번 달 알림 일정 한도를 사용했어요.</Text>
            ) : null}

            {enabled ? (
                <View style={styles.settings}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>알림 시작</Text>
                    {renderOptions(
                        LEAD_OPTIONS,
                        leadMinutes,
                        (minutes) => minutes <= policy.maxNotificationLeadMinutes,
                        onLeadMinutesChange,
                    )}

                    <Text style={[styles.label, styles.intervalLabel, { color: colors.textSecondary }]}>재알림 간격</Text>
                    {renderOptions(
                        INTERVAL_OPTIONS,
                        intervalMinutes,
                        (minutes) => minutes >= policy.minNotificationIntervalMinutes,
                        onIntervalMinutesChange,
                    )}
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
    intervalLabel: { marginTop: 12 },
    optionRow: { flexDirection: "row", gap: 7 },
    option: {
        flex: 1,
        minHeight: 36,
        borderWidth: 1,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    optionText: { fontSize: 12, fontWeight: "700" },
});
