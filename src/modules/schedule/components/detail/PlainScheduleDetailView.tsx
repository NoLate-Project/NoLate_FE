import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";

import { useTheme } from "../../../theme/ThemeContext";
import {
    buildPlainScheduleDetailPresentation,
    type PlainScheduleDetailPresentation,
} from "../../plainScheduleDetailPresentation";
import type { ScheduleItem } from "../../types";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

type Props = {
    item: ScheduleItem;
    contentTopInset: number;
    contentBottomInset: number;
    travelPlan?: {
        statusLabel: string;
        actionLabel: string;
        pending: boolean;
        onPress: () => void;
        participantContent?: React.ReactNode;
    };
    arrivalObservation?: React.ReactNode;
};

type DetailInfoRowProps = {
    testID: string;
    icon: React.ComponentProps<typeof ExpoIonicons>["name"];
    label: string;
    value: string;
    secondaryValue?: string;
    badge?: string;
    muted?: boolean;
    last?: boolean;
};

function DetailInfoRow({
    testID,
    icon,
    label,
    value,
    secondaryValue,
    badge,
    muted = false,
    last = false,
}: DetailInfoRowProps) {
    const { colors, mode } = useTheme();
    const accent = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const iconBackground = mode === "dark" ? "rgba(75,157,255,0.16)" : "#EAF2FF";

    return (
        <View
            testID={testID}
            accessible
            accessibilityLabel={[label, value, secondaryValue, badge].filter(Boolean).join(" ")}
            style={[
                styles.infoRow,
                !last && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                },
            ]}
        >
            <View
                testID={`${testID}-icon`}
                style={[styles.infoIcon, { backgroundColor: iconBackground }]}
            >
                <Ionicons name={icon} size={17} color={accent} />
            </View>
            <View style={styles.infoCopy}>
                <Text style={[styles.infoKicker, { color: colors.textSecondary }]}>{label}</Text>
                <Text
                    numberOfLines={2}
                    style={[styles.infoValue, { color: muted ? colors.textSecondary : colors.textPrimary }]}
                >
                    {value}
                </Text>
                {secondaryValue ? (
                    <View style={styles.infoSecondaryRow}>
                        <Text style={[styles.infoSecondaryValue, { color: colors.textPrimary }]}>
                            {secondaryValue}
                        </Text>
                        {badge ? (
                            <View style={[styles.infoBadge, { backgroundColor: colors.border }]}>
                                <Text style={[styles.infoBadgeText, { color: colors.textSecondary }]}>{badge}</Text>
                            </View>
                        ) : null}
                    </View>
                ) : null}
            </View>
        </View>
    );
}

function ScheduleHero({ presentation }: { presentation: PlainScheduleDetailPresentation }) {
    const { colors } = useTheme();

    return (
        <View style={styles.hero}>
            <View
                accessible
                accessibilityLabel={`카테고리 ${presentation.categoryTitle}`}
                style={[styles.categoryChip, { borderColor: colors.border }]}
            >
                <View style={[styles.categoryDot, { backgroundColor: presentation.categoryColor }]} />
                <Text numberOfLines={1} style={[styles.categoryText, { color: colors.textPrimary }]}>
                    {presentation.categoryTitle}
                </Text>
            </View>
            <Text
                accessibilityRole="header"
                numberOfLines={3}
                style={[styles.heroTitle, { color: colors.textPrimary }]}
            >
                {presentation.title}
            </Text>
        </View>
    );
}

export default function PlainScheduleDetailView({
    item,
    contentTopInset,
    contentBottomInset,
    travelPlan,
    arrivalObservation,
}: Props) {
    const { colors, mode } = useTheme();
    const presentation = useMemo(
        () => buildPlainScheduleDetailPresentation(item),
        [item]
    );
    const accent = mode === "dark" ? "#4B9DFF" : "#2979FF";

    return (
        <ScrollView
            testID="plain-schedule-detail"
            style={[styles.root, { backgroundColor: colors.background }]}
            contentContainerStyle={[
                styles.content,
                {
                    paddingTop: contentTopInset,
                    paddingBottom: contentBottomInset,
                },
            ]}
            showsVerticalScrollIndicator={false}
        >
            <View testID="plain-schedule-detail-page" style={styles.pageContent}>
                <ScheduleHero presentation={presentation} />

                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>일정 정보</Text>
                <View
                    testID="plain-schedule-detail-info-group"
                    style={[
                        styles.infoGroup,
                        {
                            borderColor: colors.border,
                            backgroundColor: colors.surface2,
                        },
                    ]}
                >
                    <DetailInfoRow
                        testID="plain-schedule-detail-time"
                        icon="calendar-outline"
                        label="일시"
                        value={presentation.dateLabel}
                        secondaryValue={presentation.timeRangeLabel}
                        badge={presentation.durationLabel}
                    />
                    <DetailInfoRow
                        testID="plain-schedule-detail-location"
                        icon="location-outline"
                        label="장소"
                        value={presentation.location ?? "없음"}
                        muted={!presentation.location}
                    />
                    <DetailInfoRow
                        testID="plain-schedule-detail-notification"
                        icon="notifications-outline"
                        label="알림"
                        value={presentation.notificationLabel}
                        muted={presentation.notificationLabel === "없음"}
                        last
                    />
                </View>

                {travelPlan ? (
                    <View style={styles.travelPlanSection}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>이동 계획</Text>
                        <View
                            style={[
                                styles.travelPlanRow,
                                {
                                    borderColor: colors.border,
                                    backgroundColor: colors.surface2,
                                },
                            ]}
                        >
                            <View style={[styles.travelPlanIcon, { backgroundColor: `${accent}1F` }]}>
                                <Ionicons name="navigate-outline" size={18} color={accent} />
                            </View>
                            <View style={styles.travelPlanCopy}>
                                <Text style={[styles.travelPlanTitle, { color: colors.textPrimary }]}>내 이동 경로</Text>
                                <Text
                                    numberOfLines={1}
                                    style={[styles.travelPlanStatus, { color: colors.textSecondary }]}
                                >
                                    {travelPlan.statusLabel}
                                </Text>
                            </View>
                            <Pressable
                                onPress={travelPlan.onPress}
                                disabled={travelPlan.pending}
                                accessibilityRole="button"
                                accessibilityLabel={`내 이동 경로 ${travelPlan.actionLabel}`}
                                accessibilityState={{ busy: travelPlan.pending, disabled: travelPlan.pending }}
                                style={({ pressed }) => [
                                    styles.travelPlanButton,
                                    {
                                        backgroundColor: accent,
                                        opacity: pressed || travelPlan.pending ? 0.62 : 1,
                                    },
                                ]}
                            >
                                {travelPlan.pending ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <Ionicons name="map-outline" size={16} color="#FFFFFF" />
                                )}
                                <Text style={styles.travelPlanButtonText}>{travelPlan.actionLabel}</Text>
                            </Pressable>
                        </View>
                        {travelPlan.participantContent}
                    </View>
                ) : null}

                {arrivalObservation ? (
                    <View style={styles.arrivalObservation}>
                        {arrivalObservation}
                    </View>
                ) : null}

                <View
                    testID="plain-schedule-detail-memo"
                    accessible
                    accessibilityLabel={presentation.notes ? `메모 ${presentation.notes}` : "메모 없음"}
                    style={styles.memoSection}
                >
                    <Text style={[styles.sectionTitle, styles.memoTitle, { color: colors.textPrimary }]}>메모</Text>
                    <View style={[styles.memoDivider, { backgroundColor: colors.border }]} />
                    <Text
                        style={[
                            styles.notesText,
                            { color: presentation.notes ? colors.textPrimary : colors.textSecondary },
                        ]}
                    >
                        {presentation.notes ?? "메모 없음"}
                    </Text>
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 20,
    },
    pageContent: {
        width: "100%",
        maxWidth: 560,
        alignSelf: "center",
    },
    hero: {
        marginBottom: 16,
    },
    heroTitle: {
        marginTop: 8,
        fontSize: 26,
        lineHeight: 32,
        fontWeight: "800",
        letterSpacing: -0.3,
    },
    sectionTitle: {
        marginBottom: 8,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "800",
    },
    label: {
        marginBottom: 6,
        fontSize: 13,
        fontWeight: "800",
    },
    categoryChip: {
        maxWidth: 116,
        minHeight: 28,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 999,
        paddingHorizontal: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    categoryDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    categoryText: {
        flexShrink: 1,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
    },
    infoGroup: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        marginBottom: 16,
        overflow: "hidden",
    },
    infoRow: {
        minHeight: 68,
        paddingHorizontal: 14,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    infoIcon: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    infoCopy: {
        flex: 1,
        minWidth: 0,
    },
    infoKicker: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "600",
    },
    infoValue: {
        marginTop: 2,
        fontSize: 15,
        lineHeight: 20,
        fontWeight: "700",
    },
    infoSecondaryRow: {
        marginTop: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    infoSecondaryValue: {
        flex: 1,
        minWidth: 0,
        fontSize: 18,
        lineHeight: 24,
        fontWeight: "800",
        fontVariant: ["tabular-nums"],
    },
    infoBadge: {
        minHeight: 28,
        borderRadius: 999,
        paddingHorizontal: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    infoBadgeText: {
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "700",
    },
    travelPlanSection: {
        marginBottom: 14,
    },
    arrivalObservation: {
        marginBottom: 14,
    },
    travelPlanRow: {
        minHeight: 64,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        paddingHorizontal: 10,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    travelPlanIcon: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    travelPlanCopy: {
        flex: 1,
        minWidth: 0,
    },
    travelPlanTitle: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "800",
        letterSpacing: 0,
    },
    travelPlanStatus: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    travelPlanButton: {
        minWidth: 76,
        height: 38,
        borderRadius: 8,
        paddingHorizontal: 11,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    travelPlanButtonText: {
        color: "#FFFFFF",
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
    memoSection: {
        minHeight: 82,
    },
    memoTitle: {
        marginBottom: 8,
    },
    memoDivider: {
        height: StyleSheet.hairlineWidth,
    },
    notesText: {
        paddingTop: 12,
        paddingHorizontal: 1,
        fontSize: 13,
        lineHeight: 20,
        fontWeight: "600",
    },
});
