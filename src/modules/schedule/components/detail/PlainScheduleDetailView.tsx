import ImportedTicketSummary from './ImportedTicketSummary';
import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";

import { useTheme } from "../../../theme/ThemeContext";
import {
    buildPlainScheduleDetailPresentation,
    type PlainScheduleDetailPresentation,
} from "../../plainScheduleDetailPresentation";
import type { ScheduleItem } from "../../types";

export const PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT = 60;
export const PLAIN_SCHEDULE_DETAIL_CONTENT_GAP = 14;

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
    featured?: boolean;
    last?: boolean;
};

function DetailInfoRow({
    testID,
    icon,
    label,
    value,
    secondaryValue,
    badge,
    featured = false,
    last = false,
}: DetailInfoRowProps) {
    const { colors, mode } = useTheme();
    const largeText = useWindowDimensions().fontScale > 1.35;
    const accent = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const iconBackground = mode === "dark"
        ? "rgba(75,157,255,0.12)"
        : "rgba(41,121,255,0.08)";

    return (
        <View
            testID={testID}
            accessible
            accessibilityLabel={[label, value, secondaryValue, badge].filter(Boolean).join(" ")}
            style={[styles.infoRow, featured && styles.featuredInfoRow]}
        >
            <View
                testID={`${testID}-icon`}
                style={[styles.infoIcon, featured && { backgroundColor: iconBackground }]}
            >
                <Ionicons name={icon} size={18} color={featured ? accent : colors.textSecondary} />
            </View>
            <View style={styles.infoCopy}>
                {!featured && (
                    <Text
                        allowFontScaling={!largeText}
                        style={[styles.infoLabel, largeText && styles.largeInfoLabel, { color: colors.textSecondary }]}
                    >
                        {label}
                    </Text>
                )}
                <Text
                    numberOfLines={largeText ? undefined : 2}
                    allowFontScaling={!largeText}
                    lineBreakStrategyIOS="hangul-word"
                    style={[
                        styles.infoValue,
                        largeText && styles.scaledInfoValue,
                        { color: featured ? colors.textSecondary : colors.textPrimary },
                    ]}
                >
                    {value}
                </Text>
                {secondaryValue ? (
                    <View style={[styles.infoSecondaryRow, largeText && styles.infoSecondaryRowLarge]}>
                        <Text
                            allowFontScaling={!largeText}
                            lineBreakStrategyIOS="hangul-word"
                            style={[
                                styles.infoSecondaryValue,
                                largeText && styles.infoSecondaryValueLarge,
                                { color: colors.textPrimary },
                            ]}
                        >
                            {secondaryValue}
                        </Text>
                        {badge ? (
                            <View style={[styles.infoBadge, { backgroundColor: colors.border }]}>
                                <Text
                                    allowFontScaling={!largeText}
                                    style={[styles.infoBadgeText, largeText && styles.scaledBadgeText, { color: colors.textSecondary }]}
                                >
                                    {badge}
                                </Text>
                            </View>
                        ) : null}
                    </View>
                ) : null}
            </View>
            {!last ? (
                <View
                    pointerEvents="none"
                    testID={`${testID}-divider`}
                    style={[styles.infoDivider, { backgroundColor: colors.border }]}
                />
            ) : null}
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
                lineBreakStrategyIOS="hangul-word"
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
    const largeTravelPlanText = useWindowDimensions().fontScale > 1.35;
    const { colors, mode } = useTheme();
    const presentation = useMemo(
        () => buildPlainScheduleDetailPresentation(item),
        [item]
    );
    const accent = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const hasNotification = item.notificationEnabled === true;

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
                        featured
                        last
                    />
                </View>
                {(presentation.location || hasNotification) ? (
                    <View style={styles.additionalInfo}>
                        {presentation.location ? (
                            <DetailInfoRow
                                testID="plain-schedule-detail-location"
                                icon="location-outline"
                                label="장소"
                                value={presentation.location}
                                last={!hasNotification}
                            />
                        ) : null}
                        {hasNotification ? (
                            <DetailInfoRow
                                testID="plain-schedule-detail-notification"
                                icon="notifications-outline"
                                label="알림"
                                value={presentation.notificationLabel}
                                last
                            />
                        ) : null}
                    </View>
                ) : null}

                <ImportedTicketSummary route={item.route} />

                {travelPlan ? (
                    <View style={styles.travelPlanSection}>
                        <Text style={[styles.label, { color: colors.textSecondary }]}>이동 계획</Text>
                        <View
                            style={[
                                styles.travelPlanRow,
                                largeTravelPlanText && styles.travelPlanRowLarge,
                                {
                                    borderColor: colors.border,
                                    backgroundColor: colors.surface2,
                                },
                            ]}
                        >
                            <View style={[styles.travelPlanIcon, { backgroundColor: `${accent}1F` }]}>
                                <Ionicons name="navigate-outline" size={18} color={accent} />
                            </View>
                            <View style={[styles.travelPlanCopy, largeTravelPlanText && styles.travelPlanCopyLarge]}>
                                <Text style={[styles.travelPlanTitle, { color: colors.textPrimary }]}>내 이동 경로</Text>
                                <Text
                                    accessibilityLiveRegion="polite"
                                    lineBreakStrategyIOS="hangul-word"
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
                                    largeTravelPlanText && styles.travelPlanButtonLarge,
                                    {
                                        backgroundColor: accent,
                                        opacity: pressed || travelPlan.pending ? 0.62 : 1,
                                    },
                                ]}
                            >
                                {travelPlan.pending ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" style={styles.travelPlanActionIcon} />
                                ) : (
                                    <View style={styles.travelPlanActionIcon}>
                                        <Ionicons name="map-outline" size={16} color="#FFFFFF" />
                                    </View>
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

                {presentation.notes ? <View
                    testID="plain-schedule-detail-memo"
                    accessible
                    accessibilityLabel={`메모 ${presentation.notes}`}
                    style={styles.memoSection}
                >
                    <View style={[styles.memoDivider, { backgroundColor: colors.border }]} />
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>메모</Text>
                    <Text style={[styles.notesText, { color: colors.textPrimary }]}>{presentation.notes}</Text>
                </View> : null}
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
        marginBottom: 18,
    },
    heroTitle: {
        marginTop: 8,
        fontSize: 24,
        lineHeight: 30,
        fontWeight: "700",
        letterSpacing: -0.3,
    },
    sectionTitle: {
        marginBottom: 8,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "600",
    },
    label: {
        marginBottom: 6,
        fontSize: 13,
        fontWeight: "700",
    },
    categoryChip: {
        alignSelf: "flex-start",
        maxWidth: 116,
        minHeight: 26,
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
        fontWeight: "600",
    },
    infoGroup: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        marginBottom: 14,
        overflow: "hidden",
    },
    additionalInfo: {
        marginBottom: 14,
    },
    infoRow: {
        position: "relative",
        minHeight: 54,
        paddingHorizontal: 0,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    featuredInfoRow: {
        minHeight: 70,
        paddingHorizontal: 14,
        paddingVertical: 13,
    },
    infoDivider: {
        position: "absolute",
        left: 40,
        right: 0,
        bottom: 0,
        height: StyleSheet.hairlineWidth,
    },
    infoIcon: {
        width: 30,
        height: 30,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    infoCopy: {
        flex: 1,
        minWidth: 0,
    },
    infoLabel: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "600",
    },
    largeInfoLabel: {
        fontSize: 20,
        lineHeight: 26,
    },
    infoValue: {
        marginTop: 2,
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "600",
    },
    scaledInfoValue: {
        fontSize: 25,
        lineHeight: 34,
    },
    infoSecondaryRow: {
        marginTop: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    infoSecondaryRowLarge: {
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 6,
    },
    infoSecondaryValue: {
        flex: 1,
        minWidth: 0,
        fontSize: 19,
        lineHeight: 25,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
    },
    infoSecondaryValueLarge: {
        flex: 0,
        maxWidth: "100%",
        fontSize: 34,
        lineHeight: 42,
    },
    infoBadge: {
        minHeight: 24,
        paddingVertical: 3,
        borderRadius: 999,
        paddingHorizontal: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    infoBadgeText: {
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    scaledBadgeText: {
        fontSize: 18,
        lineHeight: 24,
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
    travelPlanRowLarge: {
        flexWrap: "wrap",
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
    travelPlanCopyLarge: {
        flexBasis: "75%",
    },
    travelPlanTitle: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "700",
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
        minHeight: 44,
        borderRadius: 8,
        paddingHorizontal: 11,
        paddingVertical: 7,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    travelPlanButtonLarge: {
        marginLeft: 46,
    },
    travelPlanActionIcon: {
        width: 20,
        height: 20,
        alignItems: "center",
        justifyContent: "center",
    },
    travelPlanButtonText: {
        color: "#FFFFFF",
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    memoSection: {
        paddingBottom: 12,
    },
    memoDivider: {
        height: StyleSheet.hairlineWidth,
        marginBottom: 12,
    },
    notesText: {
        fontSize: 14,
        lineHeight: 21,
        fontWeight: "500",
    },
});
