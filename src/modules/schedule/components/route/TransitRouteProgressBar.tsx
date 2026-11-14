import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import {
    getTransitRouteSegmentAccessibilityLabel,
    isRouteTransferWalk,
    type TransitRouteProgressSegment,
} from "../../transitRouteProgress";
import { routeColorForWhiteIcon, routeColorInk } from "../../routeColorContrast";
import { transitModeLabel } from "../../../map/transitModes";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

type Props = {
    segments: TransitRouteProgressSegment[];
    isDark?: boolean;
    compact?: boolean;
    trackOnly?: boolean;
    labelledSummary?: boolean;
    alignedSummary?: boolean;
    focusedSegmentIndex?: number;
    reduceFocusMotion?: boolean;
    showTrackOnlyFocusLabel?: boolean;
};

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
const ROUTE_MARKER_CAPTION_SIZE = 11;
const ROUTE_MARKER_CAPTION_PADDING = 3;
const ROUTE_MARKER_CONNECTOR_GAP = 13;

function routeMarkerCaptionWidth(label: string, fontScale: number): number {
    // Reserve enough room for an unbroken label before distributing the extra width by duration.
    const longestWord = Math.max(...label.split(/\s+/u).map(word =>
        Array.from(word).reduce((width, character) =>
            width + (/^[\x20-\x7e]$/u.test(character) ? 0.64 : 1), 0),
    ));
    return Math.ceil(longestWord * ROUTE_MARKER_CAPTION_SIZE * fontScale)
        + ROUTE_MARKER_CAPTION_PADDING * 2;
}

function getSegmentIcon(kind: TransitRouteProgressSegment["kind"]): IoniconName {
    if (kind === "WALK") return "walk-outline";
    if (kind === "BUS" || kind === "EXPRESS_BUS" || kind === "INTERCITY_BUS" || kind === "COACH") return "bus-outline";
    if (kind === "SUBWAY" || kind === "TRAIN") return "train-outline";
    if (kind === "TRANSFER") return "swap-horizontal-outline";
    return "navigate-outline";
}

function getAccessibilityLabel(segments: TransitRouteProgressSegment[]): string {
    return segments.map((segment) => (
        [segment.lineLabel, segment.label].filter(Boolean).join(" ")
    )).join(", ");
}

export default function TransitRouteProgressBar({
    segments,
    isDark = false,
    compact = false,
    trackOnly = false,
    labelledSummary = false,
    alignedSummary = false,
    focusedSegmentIndex,
    reduceFocusMotion,
    showTrackOnlyFocusLabel = true,
}: Props) {
    const initialReduceMotion = useReducedMotion();
    const { width: windowWidth, fontScale } = useWindowDimensions();
    const [summaryWidth, setSummaryWidth] = useState(0);
    const largeSummaryLabels = fontScale > 1.35;
    const reduceMotionEnabled = reduceFocusMotion ?? initialReduceMotion;
    const focusProgress = useRef(new Animated.Value(focusedSegmentIndex === undefined ? 0 : 1)).current;
    const previousFocusedSegmentIndex = useRef(focusedSegmentIndex);
    useEffect(() => {
        if (previousFocusedSegmentIndex.current === focusedSegmentIndex) {
            if (reduceMotionEnabled) {
                focusProgress.stopAnimation();
                focusProgress.setValue(focusedSegmentIndex === undefined ? 0 : 1);
            }
            return;
        }
        previousFocusedSegmentIndex.current = focusedSegmentIndex;
        focusProgress.stopAnimation();
        if (focusedSegmentIndex === undefined || reduceMotionEnabled) {
            focusProgress.setValue(focusedSegmentIndex === undefined ? 0 : 1);
            return;
        }
        focusProgress.setValue(0);
        const animation = Animated.timing(focusProgress, {
            toValue: 1,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [focusProgress, focusedSegmentIndex, reduceMotionEnabled]);

    const focusedSegmentMotion = (index: number) => index === focusedSegmentIndex && compact
        ? {
            zIndex: 3,
            elevation: 3,
            shadowColor: "#182230",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.2,
            shadowRadius: 3,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? "#FFFFFF" : "#27364A",
            ...(!segments[index].isRide && {
                backgroundColor: isDark ? "rgba(255,255,255,0.22)" : "rgba(41,121,255,0.16)",
            }),
            transform: reduceMotionEnabled ? [{ translateY: 0 }, { scaleY: 1 }] : [
                { translateY: focusProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
                { scaleY: focusProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) },
            ],
        }
        : undefined;

    if (segments.length === 0) return null;

    if (labelledSummary) {
        const ink = isDark ? "#F4F6F8" : "#243142";
        const secondaryInk = isDark ? "#B3BECC" : "#53647A";
        const walkingColor = isDark ? "#687588" : "#ACB8C6";
        const availableWidth = Math.max(1, summaryWidth || windowWidth - 48);
        const minimumCellWidth = alignedSummary ? Math.max(
            Math.ceil(36 * Math.max(1, Math.min(fontScale, 2))),
            ...segments.map(segment => Math.max(
                routeMarkerCaptionWidth(segment.label, fontScale),
                routeMarkerCaptionWidth(segment.isRide ? segment.lineLabel ?? transitModeLabel(segment.kind) : "", fontScale),
            )),
        ) : 36;
        const capacity = Math.max(1, Math.floor(availableWidth / minimumCellWidth));
        const rowCount = Math.ceil(segments.length / capacity);
        const cellsPerRow = Math.ceil(segments.length / rowCount);
        const captionWidth = Math.min(minimumCellWidth, availableWidth / cellsPerRow);
        const markerCenter = captionWidth / 2;
        const proportionate = rowCount === 1 && !largeSummaryLabels;
        const totalWeight = segments.reduce((total, segment) => total + segment.flex, 0);
        const spareWidth = Math.max(0, availableWidth - segments.length * minimumCellWidth);
        const rows = alignedSummary
            ? Array.from({ length: rowCount }, (_, row) =>
                segments.slice(row * cellsPerRow, (row + 1) * cellsPerRow))
            : [];
        return (
            <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={segments.map((_, index) =>
                    getTransitRouteSegmentAccessibilityLabel(segments, index)
                ).join(", ")}
                style={styles.labelledSummary}
                onLayout={alignedSummary ? event => setSummaryWidth(event.nativeEvent.layout.width) : undefined}
            >
                {alignedSummary ? rows.map((row, rowIndex) => (
                    <View key={row[0].key} style={styles.routeMarkerRow}>
                        {row.map((segment, column) => {
                            const index = rowIndex * cellsPerRow + column;
                            const color = routeColorForWhiteIcon(segment.color);
                            const selected = index === focusedSegmentIndex;
                            const iconKind = isRouteTransferWalk(segments, index) ? "TRANSFER" : segment.kind;
                            const continuation = column === row.length - 1 && index < segments.length - 1;
                            const lastInRow = column === row.length - 1;
                            const width = proportionate && totalWeight > 0
                                ? (minimumCellWidth + spareWidth * segment.flex / totalWeight) / availableWidth
                                : 1 / cellsPerRow;
                            return (
                                <View
                                    key={segment.key}
                                    testID={`route-summary-stop-${segment.key}`}
                                    style={[styles.routeMarkerCell, { width: `${width * 100}%` }]}
                                >
                                    <View style={[
                                        styles.routeMarkerConnector,
                                        {
                                            backgroundColor: segment.isRide ? segment.color : walkingColor,
                                            left: markerCenter + ROUTE_MARKER_CONNECTOR_GAP,
                                            right: lastInRow
                                                ? (continuation ? 16 : 2)
                                                : ROUTE_MARKER_CONNECTOR_GAP - markerCenter,
                                        },
                                    ]} />
                                    <View style={[
                                        styles.routeMarker,
                                        !segment.isRide && styles.routeMarkerNeutral,
                                        {
                                            backgroundColor: segment.isRide ? color : isDark ? "#465365" : "#58677A",
                                            marginLeft: Math.max(0, markerCenter - (segment.isRide ? 10 : 9)),
                                        },
                                    ]}>
                                        <Ionicons name={getSegmentIcon(iconKind)} size={13} color="#FFFFFF" />
                                        {selected && (
                                            <Animated.View pointerEvents="none" style={[styles.routeMarkerFocus, {
                                                borderColor: isDark ? "#FFFFFF" : "#18283B",
                                                opacity: reduceMotionEnabled ? 1 : focusProgress,
                                                transform: [{ scale: reduceMotionEnabled ? 1 : focusProgress.interpolate({
                                                    inputRange: [0, 1], outputRange: [0.85, 1],
                                                }) }],
                                            }]} />
                                        )}
                                    </View>
                                    {continuation && (
                                        <View style={styles.routeMarkerContinuation}>
                                            <Ionicons name="return-down-back-outline" size={13} color={secondaryInk} />
                                        </View>
                                    )}
                                    <View style={[styles.routeMarkerCaption, { width: captionWidth }]}>
                                        <Text lineBreakStrategyIOS="hangul-word" style={[styles.routeMarkerTime, { color: ink }]}>{segment.label}</Text>
                                        {segment.isRide && (
                                            <Text lineBreakStrategyIOS="hangul-word" style={[styles.routeMarkerLabel, { color: secondaryInk }]}>
                                                {segment.lineLabel ?? transitModeLabel(segment.kind)}
                                            </Text>
                                        )}
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )) : <>
                <View style={styles.labelledTrack}>
                    {segments.map((segment, index) => (
                        <View
                            key={segment.key}
                            style={[
                                styles.labelledSegment,
                                {
                                    backgroundColor: segment.isRide ? segment.color : walkingColor,
                                    flex: segment.flex,
                                },
                            ]}
                        >
                            {index === focusedSegmentIndex && (
                                <Animated.View
                                    pointerEvents="none"
                                    style={[
                                        styles.labelledSegmentFocus,
                                        {
                                            borderColor: isDark ? "#FFFFFF" : "#18283B",
                                            opacity: reduceMotionEnabled ? 1 : focusProgress.interpolate({
                                                inputRange: [0, 1], outputRange: [0.35, 1],
                                            }),
                                        },
                                    ]}
                                />
                            )}
                        </View>
                    ))}
                </View>
                <View style={styles.summaryLegs}>
                    {segments.map((segment, index) => segment.isRide ? (
                        <View
                            key={segment.key}
                            testID={`route-summary-leg-${segment.key}`}
                            style={[styles.summaryLeg, largeSummaryLabels && styles.summaryLegLarge]}
                        >
                            {index === focusedSegmentIndex && (
                                <Animated.View
                                    pointerEvents="none"
                                    style={[
                                        styles.summaryLegSelection,
                                        {
                                            backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(28,57,92,0.09)",
                                            opacity: reduceMotionEnabled ? 1 : focusProgress,
                                        },
                                    ]}
                                />
                            )}
                            <View style={[styles.summaryLegMarker, { backgroundColor: routeColorForWhiteIcon(segment.color) }]}>
                                <Ionicons name={getSegmentIcon(segment.kind)} size={16} color="#FFFFFF" />
                            </View>
                            <Text maxFontSizeMultiplier={1.65} style={[styles.summaryLegText, { color: ink }]}>
                                {largeSummaryLabels
                                    ? `${segment.lineLabel ?? transitModeLabel(segment.kind)} ${segment.label}`
                                    : segment.lineLabel ?? transitModeLabel(segment.kind)}
                                {!largeSummaryLabels && (
                                    <Text style={[styles.summaryLegDuration, { color: secondaryInk }]}> {segment.label}</Text>
                                )}
                            </Text>
                        </View>
                    ) : null)}
                </View>
                </>}
            </View>
        );
    }

    if (trackOnly) {
        const selectedSegment = focusedSegmentIndex === undefined ? undefined : segments[focusedSegmentIndex];
        return (
            <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={segments.map((segment) =>
                    `${segment.lineLabel ?? transitModeLabel(segment.kind)} ${segment.label}`
                ).join(", ")}
                style={styles.trackOnlySummary}
            >
                <View style={[styles.track, styles.summaryTrack, styles.trackOnlyRail]}>
                    {segments.map((segment, index) => (
                        <Animated.View key={segment.key} style={[
                            styles.segment,
                            styles.summarySegment,
                            { backgroundColor: segment.color, flex: segment.flex },
                            focusedSegmentMotion(index),
                        ]} />
                    ))}
                </View>
                {selectedSegment && showTrackOnlyFocusLabel && (
                    <Text maxFontSizeMultiplier={1.65} style={[
                        styles.summaryLegText,
                        { color: isDark ? "#F4F6F8" : "#243142" },
                    ]}>
                        {selectedSegment.lineLabel ?? transitModeLabel(selectedSegment.kind)} {selectedSegment.label}
                    </Text>
                )}
            </View>
        );
    }

    if (compact) {
        const trackBackground = isDark ? "#4F5760" : "#EEF3F8";
        const trackBorder = isDark ? "rgba(255,255,255,0.04)" : "#DDE6F0";
        const trackText = isDark ? "#FFFFFF" : "#667085";
        const neutralIconBackground = isDark ? "#9CA3AF" : "#A6B0BD";
        const iconBorder = isDark ? "rgba(10,11,14,0.9)" : "#FFFFFF";
        const iconShadowOpacity = isDark ? 0.24 : 0.12;

        return (
            <View
                accessible
                accessibilityRole="text"
                accessibilityLabel={getAccessibilityLabel(segments)}
                style={styles.root}
            >
                <View
                    style={[
                        styles.registrationTrack,
                        {
                            backgroundColor: trackBackground,
                            borderColor: trackBorder,
                        },
                    ]}
                >
                    {segments.map((segment, index) => {
                        const first = index === 0;
                        const last = index === segments.length - 1;
                        const floatOnTrack = !segment.isRide;
                        const transferSpacer = floatOnTrack && !first && !last;
                        const showLabel = segment.isRide || first || last;
                        const edgeWalkSegment = segment.kind === "WALK" && (first || last);
                        const pinDuration = showLabel
                            && (segment.isRide || edgeWalkSegment)
                            && segment.minutes <= 4;
                        const segmentDisplayColor = segment.isRide
                            ? segment.color
                            : neutralIconBackground;

                        return (
                            <Animated.View
                                key={`progress-segment-${segment.key}`}
                                style={[
                                    styles.registrationSegment,
                                    {
                                        flex: transferSpacer ? 0 : segment.flex,
                                        width: transferSpacer ? 10 : undefined,
                                        minWidth: transferSpacer
                                            ? 10
                                            : segment.isRide
                                                ? 44
                                                : edgeWalkSegment
                                                    ? 52
                                                    : 18,
                                        backgroundColor: floatOnTrack ? "transparent" : segmentDisplayColor,
                                    },
                                    focusedSegmentMotion(index),
                                ]}
                            >
                                {(segment.isRide || first) && (
                                    <View
                                        style={[
                                            styles.registrationIconBadge,
                                            {
                                                backgroundColor: routeColorForWhiteIcon(segmentDisplayColor),
                                                borderColor: iconBorder,
                                                shadowOpacity: iconShadowOpacity,
                                            },
                                        ]}
                                    >
                                        <Ionicons name={getSegmentIcon(segment.kind)} size={15} color="#FFFFFF" />
                                    </View>
                                )}
                                {showLabel && (
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.registrationDurationText,
                                            pinDuration && styles.registrationPinnedDurationText,
                                            segment.isRide && styles.registrationRideDurationText,
                                            first && styles.registrationLeadingDurationText,
                                            last && styles.registrationTrailingDurationText,
                                            { color: segment.isRide ? routeColorInk(segmentDisplayColor) : trackText },
                                        ]}
                                    >
                                        {segment.label}
                                    </Text>
                                )}
                            </Animated.View>
                        );
                    })}
                </View>

                <View style={styles.registrationLineLabelRow}>
                    {segments.map((segment, index) => {
                        const transferSpacer = !segment.isRide
                            && index > 0
                            && index < segments.length - 1;
                        return (
                            <View
                                key={`progress-label-${segment.key}`}
                                style={[
                                    styles.registrationLineLabelCell,
                                    {
                                        flex: transferSpacer ? 0 : segment.flex,
                                        width: transferSpacer ? 10 : undefined,
                                        minWidth: transferSpacer ? 10 : undefined,
                                    },
                                ]}
                            >
                                {!!segment.lineLabel && (
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.registrationLineLabelText,
                                            { color: segment.color },
                                            index === focusedSegmentIndex && styles.registrationFocusedLineLabel,
                                        ]}
                                    >
                                        {segment.lineLabel}
                                    </Text>
                                )}
                            </View>
                        );
                    })}
                </View>
            </View>
        );
    }

    return (
        <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={getAccessibilityLabel(segments)}
            style={styles.root}
        >
            <View style={styles.track}>
                {segments.map((segment, index) => {
                    const first = index === 0;

                    return (
                        <View
                            key={`progress-segment-${segment.key}`}
                            style={[
                                styles.segment,
                                {
                                    flex: segment.flex,
                                    backgroundColor: segment.color,
                                    marginLeft: first ? 0 : 3,
                                },
                            ]}
                        >
                            <Text
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.72}
                                style={styles.segmentText}
                            >
                                {segment.label}
                            </Text>
                        </View>
                    );
                })}
            </View>

            <View style={styles.labelRow}>
                {segments.map((segment, index) => {
                    return (
                        <View
                            key={`progress-label-${segment.key}`}
                            style={[
                                styles.labelCell,
                                {
                                    flex: segment.flex,
                                    marginLeft: index === 0 ? 0 : 3,
                                },
                            ]}
                        >
                            {!!segment.lineLabel && (
                                <Text
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.72}
                                    style={[
                                        styles.labelText,
                                        { color: segment.color },
                                    ]}
                                >
                                    {segment.lineLabel}
                                </Text>
                            )}
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    labelledSummary: { width: "100%", marginTop: 12, gap: 9 },
    routeMarkerRow: { flexDirection: "row" },
    routeMarkerCell: { flexShrink: 1, minWidth: 0, alignItems: "flex-start" },
    routeMarkerConnector: { position: "absolute", top: 9, height: 2, borderRadius: 1 },
    routeMarkerContinuation: { position: "absolute", top: 3, right: 4 },
    routeMarker: {
        width: 20, height: 20, borderRadius: 10,
        alignItems: "center", justifyContent: "center", marginBottom: 4,
    },
    routeMarkerNeutral: { width: 18, height: 18, borderRadius: 9, marginTop: 1, marginBottom: 5 },
    routeMarkerCaption: { paddingHorizontal: ROUTE_MARKER_CAPTION_PADDING },
    routeMarkerFocus: { ...StyleSheet.absoluteFillObject, borderWidth: 1.5, borderRadius: 10 },
    routeMarkerLabel: { fontSize: ROUTE_MARKER_CAPTION_SIZE, fontWeight: "700", textAlign: "center" },
    routeMarkerTime: { fontSize: ROUTE_MARKER_CAPTION_SIZE, fontWeight: "600", fontVariant: ["tabular-nums"], textAlign: "center" },
    trackOnlySummary: { width: "100%", gap: 6 },
    labelledTrack: {
        height: 6,
        borderRadius: 3,
        flexDirection: "row",
        overflow: "hidden",
        gap: 2,
    },
    labelledSegment: { height: "100%", minWidth: 2 },
    labelledSegmentFocus: { ...StyleSheet.absoluteFillObject, borderWidth: 1.5, borderRadius: 1 },
    trackOnlyRail: { overflow: "visible" },
    summaryLegs: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 8 },
    summaryLeg: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
    summaryLegLarge: { width: "100%" },
    summaryLegSelection: {
        position: "absolute", top: -2, bottom: -2, left: -3, right: -4, borderRadius: 8,
    },
    summaryLegMarker: {
        width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
    summaryLegText: { flexShrink: 1, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
    summaryLegDuration: { fontWeight: "500" },
    summaryTrack: {
        height: 6,
        gap: 2,
    },
    summarySegment: {
        minWidth: 2,
        paddingHorizontal: 0,
    },
    root: {
        width: "100%",
    },
    registrationTrack: {
        width: "100%",
        height: 16,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "visible",
        marginTop: 7,
    },
    registrationSegment: {
        height: "100%",
        minWidth: 12,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 2,
        borderRadius: 999,
        overflow: "visible",
    },
    registrationIconBadge: {
        position: "absolute",
        left: -2,
        top: -8,
        width: 30,
        height: 30,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        shadowColor: "#000000",
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
        zIndex: 4,
    },
    registrationDurationText: {
        maxWidth: "100%",
        fontSize: 10,
        fontWeight: "900",
        lineHeight: 12,
        letterSpacing: 0,
        textAlign: "center",
    },
    registrationPinnedDurationText: {
        position: "absolute",
        left: 0,
        top: 2,
        minWidth: 30,
        maxWidth: 42,
        paddingHorizontal: 2,
        zIndex: 6,
    },
    registrationRideDurationText: {
        marginLeft: 24,
        paddingRight: 3,
    },
    registrationLeadingDurationText: {
        marginLeft: 32,
        paddingRight: 2,
    },
    registrationTrailingDurationText: {
        marginLeft: 12,
    },
    registrationLineLabelRow: {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-start",
        minHeight: 14,
        marginTop: 2,
    },
    registrationLineLabelCell: {
        minWidth: 12,
        alignItems: "center",
    },
    registrationLineLabelText: {
        fontSize: 11,
        fontWeight: "900",
        lineHeight: 14,
        letterSpacing: 0,
    },
    registrationFocusedLineLabel: { textDecorationLine: "underline" },
    track: {
        width: "100%",
        height: 18,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
        marginTop: 1,
    },
    segment: {
        height: "100%",
        minWidth: 22,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    segmentText: {
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: "900",
        lineHeight: 12,
        letterSpacing: 0,
    },
    labelRow: {
        width: "100%",
        minHeight: 13,
        flexDirection: "row",
        alignItems: "flex-start",
        marginTop: 1,
    },
    labelCell: {
        minWidth: 22,
        alignItems: "center",
    },
    labelText: {
        fontSize: 10,
        fontWeight: "900",
        lineHeight: 12,
        letterSpacing: 0,
    },
});
