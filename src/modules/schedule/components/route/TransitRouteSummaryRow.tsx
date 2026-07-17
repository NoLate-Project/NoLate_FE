import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { TransitRouteProgressSegment } from "../../transitRouteProgress";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

type Props = {
    segments: TransitRouteProgressSegment[];
    isDark?: boolean;
};

function getSegmentAccessibilityLabel(
    segment: TransitRouteProgressSegment,
    index: number,
    segmentCount: number
) {
    if (segment.isRide) {
        const fallbackLabel = segment.kind === "BUS" ? "버스" : "지하철";
        return `${segment.lineLabel ?? fallbackLabel} ${segment.label}`;
    }

    if (segment.kind === "WALK") {
        const isTransfer = index > 0 && index < segmentCount - 1;
        return `${isTransfer ? "환승 도보" : "도보"} ${segment.label}`;
    }

    return segment.label;
}

export function getTransitRouteSummaryAccessibilityLabel(
    segments: TransitRouteProgressSegment[]
) {
    const itinerary = segments.map((segment, index) => (
        getSegmentAccessibilityLabel(segment, index, segments.length)
    )).join(", ");

    return itinerary ? `이동 경로, ${itinerary}` : "이동 경로";
}

/** 축소형 상세 시트에서 경로의 시작·구간 비율·도착만 한 줄로 보여준다. */
export default function TransitRouteSummaryRow({ segments, isDark = false }: Props) {
    if (segments.length === 0) return null;

    const secondaryText = isDark ? "#AEB7C4" : "#64748B";
    const neutralSegment = isDark ? "#697381" : "#AEB8C5";

    return (
        <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={getTransitRouteSummaryAccessibilityLabel(segments)}
            style={styles.root}
        >
            <Text style={[styles.label, { color: secondaryText }]}>이동 경로</Text>
            <Ionicons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name="walk-outline"
                size={13}
                color={secondaryText}
                style={styles.originIcon}
            />
            <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.track}
            >
                {segments.map((segment, index) => (
                    <View
                        key={`compact-route-${segment.key}`}
                        style={[
                            styles.segment,
                            index > 0 && styles.segmentSpacing,
                            {
                                flex: segment.flex,
                                backgroundColor: segment.isRide ? segment.color : neutralSegment,
                            },
                        ]}
                    />
                ))}
            </View>
            <Ionicons
                accessibilityElementsHidden
                importantForAccessibility="no"
                name="location"
                size={13}
                color="#FF4D5A"
                style={styles.destinationIcon}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        width: "100%",
        height: 18,
        flexDirection: "row",
        alignItems: "center",
    },
    label: {
        flexShrink: 0,
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
    originIcon: {
        marginLeft: 7,
        marginRight: 5,
    },
    track: {
        flex: 1,
        minWidth: 0,
        height: 5,
        flexDirection: "row",
        alignItems: "center",
    },
    segment: {
        height: 5,
        minWidth: 3,
        borderRadius: 999,
    },
    segmentSpacing: {
        marginLeft: 2,
    },
    destinationIcon: {
        marginLeft: 5,
    },
});
