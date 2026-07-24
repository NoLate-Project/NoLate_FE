import React from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";

import NotificationPermissionCard, {
    type NotificationPermissionCardProps,
} from "../../../notification/components/NotificationPermissionCard";
import { useTheme } from "../../../theme/ThemeContext";
import { getMinimumTouchTarget } from "../../../../ui/minimumTouchTarget";
import type {
    DepartureLifecyclePresentation,
    DepartureStatusMetadataPresentation,
} from "../../departureStatusPresentation";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

export type DepartureStatusLoadState =
    | "loading"
    | "ready"
    | "legacy"
    | "unavailable"
    | "error";

const MIN_TOUCH_TARGET = getMinimumTouchTarget(Platform.OS);

type Props = {
    lifecycle: DepartureLifecyclePresentation;
    metadata: DepartureStatusMetadataPresentation;
    loadState: DepartureStatusLoadState;
    loadError?: string | null;
    onRetry: () => void;
    permission?: NotificationPermissionCardProps;
    showHero?: boolean;
};

function lifecycleIcon(
    phase: DepartureLifecyclePresentation["phase"],
): React.ComponentProps<typeof Ionicons>["name"] {
    switch (phase) {
        case "ended": return "checkmark-circle-outline";
        case "past": return "warning-outline";
        case "missing": return "help-circle-outline";
        default: return "time-outline";
    }
}

export default function DepartureStatusCard({
    lifecycle,
    metadata,
    loadState,
    loadError,
    onRetry,
    permission,
    showHero = true,
}: Props) {
    const { colors, mode } = useTheme();
    const accent = lifecycle.phase === "imminent"
        ? "#F59E0B"
        : lifecycle.phase === "past"
            ? "#F97316"
            : lifecycle.phase === "ended" || lifecycle.phase === "missing"
                ? colors.textSecondary
                : mode === "dark" ? "#78B4FF" : "#2979FF";
    const freshnessNeedsAttention =
        metadata.freshnessTone !== "fresh" || loadState === "error";

    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>출발 안내</Text>
                {!showHero && loadState === "loading" ? (
                    <ActivityIndicator
                        accessibilityLabel="최신 출발 상태를 불러오고 있어요"
                        size="small"
                        color={accent}
                    />
                ) : null}
            </View>
            <View
                testID="departure-status-card"
                style={[
                    styles.card,
                    {
                        borderColor: colors.border,
                        backgroundColor: colors.inputBackground,
                    },
                ]}
            >
                {showHero ? (
                    <>
                        <View
                            accessible
                            accessibilityLabel={`${lifecycle.label}, ${lifecycle.value}. ${lifecycle.detail}`}
                            style={styles.hero}
                        >
                            <View style={[styles.heroIcon, { backgroundColor: `${accent}1C` }]}>
                                <Ionicons name={lifecycleIcon(lifecycle.phase)} size={20} color={accent} />
                            </View>
                            <View style={styles.heroCopy}>
                                <Text style={[styles.heroLabel, { color: colors.textSecondary }]}>
                                    {lifecycle.label}
                                </Text>
                                <Text
                                    style={[styles.heroValue, { color: colors.textPrimary }]}
                                >
                                    {lifecycle.value}
                                </Text>
                                <Text style={[styles.heroDetail, { color: accent }]}>
                                    {lifecycle.detail}
                                </Text>
                            </View>
                            {loadState === "loading" ? (
                                <ActivityIndicator
                                    accessibilityLabel="최신 출발 상태를 불러오고 있어요"
                                    size="small"
                                    color={accent}
                                />
                            ) : null}
                        </View>

                        <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    </>
                ) : null}

                <View style={styles.badges}>
                    <View style={[styles.badge, { backgroundColor: `${accent}16` }]}>
                        <Text style={[styles.badgeText, { color: accent }]}>
                            {metadata.sourceLabel}
                        </Text>
                    </View>
                    <View
                        style={[
                            styles.badge,
                            {
                                backgroundColor: freshnessNeedsAttention
                                    ? "rgba(249,115,22,0.14)"
                                    : "rgba(34,197,94,0.13)",
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.badgeText,
                                { color: freshnessNeedsAttention ? "#F97316" : "#22A559" },
                            ]}
                        >
                            {metadata.freshnessLabel}
                        </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: colors.background }]}>
                        <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                            {metadata.confidenceLabel}
                        </Text>
                    </View>
                </View>

                <Text style={[styles.eta, { color: colors.textPrimary }]}>{metadata.etaLabel}</Text>
                <Text style={[styles.sourceDetail, { color: colors.textSecondary }]}>
                    {metadata.sourceDetail}
                </Text>

                <View style={styles.metaList}>
                    {[
                        metadata.liveFetchedLabel,
                        metadata.evaluatedLabel,
                        metadata.trafficChangeLabel,
                        metadata.preparationLabel,
                        metadata.nextCheckLabel,
                    ].filter(Boolean).map((label) => (
                        <View key={label} style={styles.metaRow}>
                            <View style={[styles.metaDot, { backgroundColor: colors.textSecondary }]} />
                            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                                {label}
                            </Text>
                        </View>
                    ))}
                </View>

                {metadata.failureLabel ? (
                    <View style={styles.warningRow}>
                        <Ionicons name="warning-outline" size={15} color="#F97316" />
                        <Text style={styles.warningText}>{metadata.failureLabel}</Text>
                    </View>
                ) : null}

                {loadState === "error" ? (
                    <View
                        accessibilityRole="alert"
                        style={[styles.errorRow, { borderTopColor: colors.border }]}
                    >
                        <Text style={[styles.errorText, { color: colors.textSecondary }]}>
                            {loadError ?? "최신 출발 상태를 확인하지 못했어요. 마지막 정보로 표시합니다."}
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="최신 출발 상태 다시 불러오기"
                            onPress={onRetry}
                            style={({ pressed }) => [
                                styles.retryButton,
                                {
                                    minHeight: MIN_TOUCH_TARGET,
                                    borderColor: accent,
                                    opacity: pressed ? 0.55 : 1,
                                },
                            ]}
                        >
                            <Ionicons name="refresh" size={14} color={accent} />
                            <Text style={[styles.retryText, { color: accent }]}>다시 확인</Text>
                        </Pressable>
                    </View>
                ) : null}
            </View>
            {permission ? <NotificationPermissionCard {...permission} /> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        width: "100%",
        gap: 8,
    },
    sectionLabel: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
    },
    sectionHeader: {
        minHeight: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    card: {
        width: "100%",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        padding: 14,
    },
    hero: {
        minHeight: 78,
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
    },
    heroIcon: {
        width: 42,
        height: 42,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    heroCopy: {
        flex: 1,
        minWidth: 0,
    },
    heroLabel: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
    },
    heroValue: {
        marginTop: 1,
        fontSize: 25,
        lineHeight: 30,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
    },
    heroDetail: {
        marginTop: 1,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginVertical: 11,
    },
    badges: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
    },
    badge: {
        minHeight: 24,
        borderRadius: 999,
        paddingHorizontal: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    badgeText: {
        fontSize: 9,
        lineHeight: 13,
        fontWeight: "900",
    },
    eta: {
        marginTop: 10,
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "900",
    },
    sourceDetail: {
        marginTop: 2,
        fontSize: 10,
        lineHeight: 15,
        fontWeight: "600",
    },
    metaList: {
        marginTop: 7,
        gap: 3,
    },
    metaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    metaDot: {
        width: 3,
        height: 3,
        borderRadius: 2,
    },
    metaText: {
        flex: 1,
        fontSize: 10,
        lineHeight: 15,
        fontWeight: "700",
    },
    warningRow: {
        marginTop: 9,
        borderRadius: 10,
        padding: 9,
        backgroundColor: "rgba(249,115,22,0.11)",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 6,
    },
    warningText: {
        flex: 1,
        color: "#F97316",
        fontSize: 10,
        lineHeight: 15,
        fontWeight: "800",
    },
    errorRow: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    errorText: {
        flex: 1,
        fontSize: 10,
        lineHeight: 15,
        fontWeight: "600",
    },
    retryButton: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    retryText: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "900",
    },
});
