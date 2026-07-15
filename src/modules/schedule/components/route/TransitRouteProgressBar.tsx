import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { TransitRouteProgressSegment } from "../../transitRouteProgress";

type Props = {
    segments: TransitRouteProgressSegment[];
    isDark?: boolean;
    compact?: boolean;
};

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function getSegmentIcon(kind: TransitRouteProgressSegment["kind"]): IoniconName {
    if (kind === "WALK") return "walk";
    if (kind === "BUS") return "bus";
    if (kind === "SUBWAY") return "train";
    return "swap-horizontal";
}

export default function TransitRouteProgressBar({
    segments,
    isDark = false,
    compact = false,
}: Props) {
    if (segments.length === 0) return null;

    return (
        <View
            accessibilityLabel={segments.map((segment) => (
                [segment.lineLabel, segment.label].filter(Boolean).join(" ")
            )).join(", ")}
            style={styles.root}
        >
            <View
                style={[
                    styles.track,
                    compact && styles.trackCompact,
                    compact && {
                        backgroundColor: isDark ? "#4F5760" : "#8B949E",
                    },
                ]}
            >
                {segments.map((segment, index) => {
                    const first = index === 0;
                    const last = index === segments.length - 1;
                    const floatOnTrack = compact && !segment.isRide;
                    const transferSpacer = floatOnTrack && !first && !last;
                    const showLabel = !compact || segment.isRide || first || last;

                    return (
                        <View
                            key={`progress-segment-${segment.key}`}
                            style={[
                                styles.segment,
                                compact && styles.segmentCompact,
                                {
                                    flex: transferSpacer ? 0 : segment.flex,
                                    width: transferSpacer ? 10 : undefined,
                                    minWidth: transferSpacer ? 10 : undefined,
                                    backgroundColor: floatOnTrack ? "transparent" : segment.color,
                                    marginLeft: first ? 0 : compact ? 0 : 3,
                                },
                            ]}
                        >
                            {compact && (segment.isRide || first) && (
                                <View
                                    style={[
                                        styles.iconBadge,
                                        {
                                            backgroundColor: segment.color,
                                            borderColor: isDark ? "rgba(10,11,14,0.9)" : "rgba(255,255,255,0.96)",
                                        },
                                    ]}
                                >
                                    <Ionicons name={getSegmentIcon(segment.kind)} size={15} color="#FFFFFF" />
                                </View>
                            )}
                            {showLabel && (
                                <Text
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.72}
                                    style={[
                                        styles.segmentText,
                                        compact && styles.segmentTextCompact,
                                        compact && first && styles.segmentTextWithIcon,
                                        compact && segment.isRide && styles.segmentTextWithIcon,
                                    ]}
                                >
                                    {segment.label}
                                </Text>
                            )}
                        </View>
                    );
                })}
            </View>

            <View style={[styles.labelRow, compact && styles.labelRowCompact]}>
                {segments.map((segment, index) => {
                    const transferSpacer = compact
                        && !segment.isRide
                        && index > 0
                        && index < segments.length - 1;
                    return (
                        <View
                            key={`progress-label-${segment.key}`}
                            style={[
                                styles.labelCell,
                                {
                                    flex: transferSpacer ? 0 : segment.flex,
                                    width: transferSpacer ? 10 : undefined,
                                    minWidth: transferSpacer ? 10 : undefined,
                                    marginLeft: index === 0 ? 0 : compact ? 0 : 3,
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
                                        compact && styles.labelTextCompact,
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
    track: {
        width: "100%",
        height: 18,
        borderRadius: 999,
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
        marginTop: 1,
    },
    trackCompact: {
        height: 15,
        marginTop: 3,
        overflow: "visible",
    },
    segment: {
        height: "100%",
        minWidth: 22,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
    segmentCompact: {
        minWidth: 12,
        paddingHorizontal: 2,
        overflow: "visible",
    },
    iconBadge: {
        position: "absolute",
        left: -4,
        top: -7,
        width: 29,
        height: 29,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        shadowColor: "#000000",
        shadowOpacity: 0.24,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
        zIndex: 4,
    },
    segmentText: {
        color: "#FFFFFF",
        fontSize: 10,
        fontWeight: "900",
        lineHeight: 12,
        letterSpacing: 0,
    },
    segmentTextCompact: {
        fontSize: 9,
        lineHeight: 11,
    },
    segmentTextWithIcon: {
        marginLeft: 16,
    },
    labelRow: {
        width: "100%",
        minHeight: 13,
        flexDirection: "row",
        alignItems: "flex-start",
        marginTop: 1,
    },
    labelRowCompact: {
        minHeight: 14,
        marginTop: 2,
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
    labelTextCompact: {
        fontSize: 11,
        lineHeight: 14,
    },
});
