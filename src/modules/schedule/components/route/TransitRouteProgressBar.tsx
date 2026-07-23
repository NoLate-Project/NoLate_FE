import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { TransitRouteProgressSegment } from "../../transitRouteProgress";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

type ProgressSegment = Omit<TransitRouteProgressSegment, "kind"> & {
    kind: TransitRouteProgressSegment["kind"] | "TRANSFER";
};

type Props = {
    segments: ProgressSegment[];
    isDark?: boolean;
    compact?: boolean;
};

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function getSegmentIcon(kind: ProgressSegment["kind"]): IoniconName {
    if (kind === "WALK") return "walk";
    if (kind === "BUS") return "bus";
    if (kind === "SUBWAY") return "train";
    if (kind === "TRANSFER") return "swap-horizontal";
    return "navigate-outline";
}

function getAccessibilityLabel(segments: ProgressSegment[]): string {
    return segments.map((segment) => (
        [segment.lineLabel, segment.label].filter(Boolean).join(" ")
    )).join(", ");
}

export default function TransitRouteProgressBar({
    segments,
    isDark = false,
    compact = false,
}: Props) {
    if (segments.length === 0) return null;

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
                            <View
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
                                ]}
                            >
                                {(segment.isRide || first) && (
                                    <View
                                        style={[
                                            styles.registrationIconBadge,
                                            {
                                                backgroundColor: segmentDisplayColor,
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
                                            { color: segment.isRide ? "#FFFFFF" : trackText },
                                        ]}
                                    >
                                        {segment.label}
                                    </Text>
                                )}
                            </View>
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
