import ImportedTicketSummary from './ImportedTicketSummary';
import ScheduleSharingInformation, { ScheduleDetailReadingRow } from './ScheduleSharingInformation';
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import LoadingIndicator from "../../../../ui/LoadingIndicator";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";

import { useTheme } from "../../../theme/ThemeContext";
import {
    buildPlainScheduleDetailPresentation,
    type PlainScheduleDetailPresentation,
} from "../../plainScheduleDetailPresentation";
import type { ScheduleItem } from "../../types";
import { useSystemReduceMotion } from "../../../performance/useSystemReduceMotion";
import {
    SCHEDULE_EDITOR_EXIT_MS,
    ScheduleDetailEditingContext,
    ScheduleDetailEditResultContext,
} from "../../../../routeSupport/schedule/ScheduleDetailEditorTransition";

export const PLAIN_SCHEDULE_DETAIL_HEADER_BODY_HEIGHT = 60;
export const PLAIN_SCHEDULE_DETAIL_CONTENT_GAP = 14;

const routeConfirmationEntrance = FadeIn.duration(240).reduceMotion(ReduceMotion.System);

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
        confirmed?: boolean;
        onPress: (restoreFocus?: () => void) => void;
        participantContent?: React.ReactNode;
    };
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

type DetailSection = "title" | "time" | "location" | "notification" | "memo";

function changedSections(previous: ScheduleItem, updated: ScheduleItem): DetailSection[] {
    const before = buildPlainScheduleDetailPresentation(previous);
    const after = buildPlainScheduleDetailPresentation(updated);
    const sections: DetailSection[] = [];
    if (before.title !== after.title || before.categoryTitle !== after.categoryTitle
        || before.categoryColor !== after.categoryColor) sections.push("title");
    if (before.dateLabel !== after.dateLabel || before.timeRangeLabel !== after.timeRangeLabel
        || before.durationLabel !== after.durationLabel) sections.push("time");
    if (after.location && before.location !== after.location) sections.push("location");
    if (updated.notificationEnabled && before.notificationLabel !== after.notificationLabel) sections.push("notification");
    if (after.notes && before.notes !== after.notes) sections.push("memo");
    return sections;
}

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
                        maxFontSizeMultiplier={1.75}
                        style={[styles.infoLabel, { color: colors.textSecondary }]}
                    >
                        {label}
                    </Text>
                )}
                <Text
                    numberOfLines={featured || largeText ? undefined : 2}
                    maxFontSizeMultiplier={1.8}
                    lineBreakStrategyIOS="hangul-word"
                    style={[
                        styles.infoValue,
                        { color: featured ? colors.textSecondary : colors.textPrimary },
                    ]}
                >
                    {value}
                </Text>
                {secondaryValue ? (
                    <View style={[styles.infoSecondaryRow, largeText && styles.infoSecondaryRowLarge]}>
                        <Text
                            maxFontSizeMultiplier={1.8}
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
                                    maxFontSizeMultiplier={1.75}
                                    style={[styles.infoBadgeText, { color: colors.textSecondary }]}
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

function ScheduleHero({ presentation, receivedReading }: {
    presentation: PlainScheduleDetailPresentation;
    receivedReading: boolean;
}) {
    const { colors } = useTheme();
    const largeText = useWindowDimensions().fontScale > 1.35;

    return (
        <View style={[styles.hero, receivedReading && styles.receivedHero]}>
            {!receivedReading && <View
                accessible
                accessibilityLabel={`카테고리 ${presentation.categoryTitle}`}
                style={[styles.categoryChip, largeText && styles.categoryChipLarge, { borderColor: colors.border }]}
            >
                <View style={[styles.categoryDot, { backgroundColor: presentation.categoryColor }]} />
                <Text numberOfLines={largeText ? undefined : 1} style={[styles.categoryText, { color: colors.textPrimary }]}>
                    {presentation.categoryTitle}
                </Text>
            </View>}
            <Text
                accessibilityRole="header"
                lineBreakStrategyIOS="hangul-word"
                style={[styles.heroTitle, receivedReading && styles.receivedTitle, { color: colors.textPrimary }]}
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
}: Props) {
    const largeTravelPlanText = useWindowDimensions().fontScale > 1.35;
    const { colors, mode } = useTheme();
    const presentation = useMemo(
        () => buildPlainScheduleDetailPresentation(item),
        [item]
    );
    const accent = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const hasNotification = item.notificationEnabled === true;
    const receivedReading = !largeTravelPlanText && Boolean(item.sharePermission && item.sharePermission !== "OWNER");
    const editing = useContext(ScheduleDetailEditingContext);
    const editResult = useContext(ScheduleDetailEditResultContext);
    const reduceMotion = useSystemReduceMotion();
    const handled = useRef<typeof editResult>(null);
    const scroll = useRef<ScrollView>(null);
    const routeButton = useRef<View>(null);
    const page = useRef<View>(null);
    const sections = useRef<Partial<Record<DetailSection, View | null>>>({});
    const viewport = useRef({ offset: 0, height: 0 });
    const [highlights, setHighlights] = useState<DetailSection[]>([]);
    const glow = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (editing || !editResult || editResult === handled.current || editResult.updated.id !== item.id) {
            setHighlights(current => current.length ? [] : current);
            return;
        }
        const changed = changedSections(editResult.previous, editResult.updated);
        if (!changed.length) {
            handled.current = editResult;
            return;
        }
        let active = true;
        const timer = setTimeout(() => {
            handled.current = editResult;
            const content = page.current;
            const target = sections.current[changed[0]];
            if (target && content && viewport.current.height > 0) {
                target.measureLayout(content, (_x, y, _width, height) => {
                    if (!active) return;
                    const top = y + contentTopInset;
                    const { offset, height: visibleHeight } = viewport.current;
                    const visibleTop = offset + contentTopInset;
                    const visibleBottom = offset + visibleHeight - 12;
                    const fits = height <= visibleHeight - contentTopInset - 12;
                    const bottom = top + (fits ? height : Math.min(44, height));
                    if (top < visibleTop || bottom > visibleBottom) {
                        const nextOffset = top < visibleTop || !fits
                            ? top - contentTopInset
                            : bottom - visibleHeight + 12;
                        scroll.current?.scrollTo({ y: Math.max(0, nextOffset), animated: false });
                    }
                });
            }
            if (reduceMotion) return;
            setHighlights(changed);
            glow.setValue(1);
            Animated.timing(glow, { toValue: 0, duration: 180, useNativeDriver: true, isInteraction: false })
                .start(({ finished }) => { if (active && finished) setHighlights([]); });
        }, reduceMotion ? 0 : SCHEDULE_EDITOR_EXIT_MS);
        return () => {
            active = false;
            clearTimeout(timer);
            glow.stopAnimation();
            glow.setValue(0);
        };
    }, [contentTopInset, editing, editResult, glow, item.id, reduceMotion]);

    const section = (key: DetailSection, content: React.ReactNode) => (
        <View ref={view => { sections.current[key] = view; }} collapsable={false}>
            {content}
            {highlights.includes(key) && (
                <Animated.View
                    testID={`schedule-edit-highlight-${key}`}
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[StyleSheet.absoluteFillObject, { backgroundColor: `${accent}26`, borderRadius: 12, opacity: glow }]}
                />
            )}
        </View>
    );

    return (
        <ScrollView
            testID="plain-schedule-detail"
            ref={scroll}
            onLayout={event => { viewport.current.height = event.nativeEvent.layout.height; }}
            onScroll={event => { viewport.current.offset = event.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
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
            <View ref={page} collapsable={false} testID="plain-schedule-detail-page" style={styles.pageContent}>
                {section("title", <ScheduleHero presentation={presentation} receivedReading={receivedReading} />)}

                {section("time", receivedReading ? (
                    <View testID="plain-schedule-detail-time" accessible
                        accessibilityLabel={`일시 ${presentation.dateLabel} ${presentation.timeRangeLabel}`}
                        style={styles.receivedTime}>
                        <Text style={[styles.receivedDate, { color: colors.textSecondary }]}>{presentation.dateLabel}</Text>
                        <Text style={[styles.receivedTimeRange, { color: colors.textPrimary }]}>{presentation.timeRangeLabel}</Text>
                    </View>
                ) : <View
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
                </View>)}
                {(presentation.location || hasNotification) ? (
                    <View style={!receivedReading && styles.additionalInfo}>
                        {presentation.location ? (
                            section("location", receivedReading ? (
                                <ScheduleDetailReadingRow testID="plain-schedule-detail-location" label="장소" value={presentation.location} />
                            ) : <DetailInfoRow
                                testID="plain-schedule-detail-location"
                                icon="location-outline"
                                label="장소"
                                value={presentation.location}
                                last={!hasNotification}
                            />)
                        ) : null}
                        {hasNotification ? (
                            section("notification", receivedReading ? (
                                <ScheduleDetailReadingRow testID="plain-schedule-detail-notification" label="알림" value={presentation.notificationLabel} />
                            ) : <DetailInfoRow
                                testID="plain-schedule-detail-notification"
                                icon="notifications-outline"
                                label="알림"
                                value={presentation.notificationLabel}
                                last
                            />)
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
                                {travelPlan.confirmed && !largeTravelPlanText ? (
                                    <Reanimated.View entering={routeConfirmationEntrance} testID="plain-schedule-route-confirmed">
                                        <Ionicons name="checkmark-circle-outline" size={18} color={accent} />
                                    </Reanimated.View>
                                ) : (
                                    <Ionicons name="navigate-outline" size={18} color={accent} />
                                )}
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
                                ref={routeButton}
                                onPress={() => travelPlan.onPress(() => {
                                    if (routeButton.current) AccessibilityInfo.sendAccessibilityEvent?.(routeButton.current, "focus");
                                })}
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
                                <View style={styles.travelPlanActionIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                                    {travelPlan.pending ? (
                                        <LoadingIndicator size="inline" tone="inverse" delayMs={150} />
                                    ) : (
                                        <Ionicons name="map-outline" size={16} color="#FFFFFF" />
                                    )}
                                </View>
                                <Text style={styles.travelPlanButtonText}>{travelPlan.actionLabel}</Text>
                            </Pressable>
                        </View>
                        {travelPlan.participantContent}
                    </View>
                ) : null}


                {presentation.notes ? section("memo", receivedReading ? (
                    <ScheduleDetailReadingRow testID="plain-schedule-detail-memo" label="메모" value={presentation.notes} />
                ) : <View
                    testID="plain-schedule-detail-memo"
                    accessible
                    accessibilityLabel={`메모 ${presentation.notes}`}
                    style={styles.memoSection}
                >
                    <View style={[styles.memoDivider, { backgroundColor: colors.border }]} />
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>메모</Text>
                    <Text style={[styles.notesText, { color: colors.textPrimary }]}>{presentation.notes}</Text>
                </View>) : null}
                <ScheduleSharingInformation item={item} inline />
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
    receivedHero: { marginBottom: 10 },
    receivedTitle: { marginTop: 0 },
    receivedTime: { gap: 4, marginBottom: 14 },
    receivedDate: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
    receivedTimeRange: { fontSize: 18, lineHeight: 24, fontWeight: "600", fontVariant: ["tabular-nums"] },
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
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    categoryChipLarge: { maxWidth: '100%', paddingVertical: 4 },
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
    infoValue: {
        marginTop: 2,
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "600",
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
    travelPlanSection: {
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
