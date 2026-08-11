import { StyleSheet } from "react-native";

import type { RoutePlannerStyleOptions } from "../styles";

/** 경로 계획 화면의 routeSummary 영역 정적 스타일을 생성합니다. */
export function createRouteSummaryStyles(options: RoutePlannerStyleOptions) {
    void options;
    return {
        selectedRouteSection: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 7,
    },
        selectedRouteSectionDetail: {
        paddingHorizontal: 6,
        paddingTop: 0,
        paddingBottom: 0,
        gap: 6,
    },
        transitAlternativeCard: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 13,
        paddingVertical: 12,
        gap: 9,
    },
        transitReferenceSummaryCard: {
        paddingHorizontal: 0,
        paddingTop: 5,
        paddingBottom: 3,
        gap: 4,
    },
        transitReferenceSummaryCardDetail: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.08)",
        paddingTop: 0,
        paddingBottom: 4,
        gap: 4,
        backgroundColor: "transparent",
    },
        transitDetailHeroSummary: {
        gap: 2,
        paddingTop: 0,
        paddingBottom: 0,
    },
        transitDetailHeroDuration: {
        fontSize: 34,
        fontWeight: "900",
        lineHeight: 39,
        letterSpacing: 0,
    },
        transitDetailHeroMetaText: {
        fontSize: 14,
        fontWeight: "800",
        lineHeight: 19,
    },
        selectedRouteDetailCard: {
        gap: 10,
    },
        selectedRouteSummaryHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 8,
    },
        selectedRouteDurationBlock: {
        alignItems: "flex-start",
        gap: 2,
    },
        selectedRouteDurationBlockCompact: {
        flexDirection: "row",
        alignItems: "baseline",
        gap: 7,
    },
        selectedRouteOptimalText: {
        fontSize: 12,
        fontWeight: "900",
        lineHeight: 16,
    },
        selectedRouteOptimalTextCompact: {
        fontSize: 12,
        lineHeight: 15,
    },
        selectedRouteSummaryText: {
        fontSize: 16,
        fontWeight: "800",
        lineHeight: 22,
    },
        transitReferenceMetaText: {
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 17,
    },
        transitReferenceMetaTextCompact: {
        fontSize: 13,
        lineHeight: 17,
        color: "#AEB4BF",
    },
        transitDetailBaseTimeRow: {
        borderTopWidth: StyleSheet.hairlineWidth,
        marginTop: 6,
        paddingTop: 6,
    },
        transitDetailBaseTimeRowCompact: {
        marginTop: 8,
        paddingTop: 9,
    },
        transitDetailBaseTimeText: {
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 18,
    },
        selectedRouteBodyText: {
        fontSize: 12,
        fontWeight: "600",
        lineHeight: 18,
    },
        selectedRouteLegSection: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 10,
    },
        selectedRouteSectionTitle: {
        fontSize: 15,
        fontWeight: "900",
        lineHeight: 20,
    },
        selectedRouteLegItemCard: {
        paddingHorizontal: 10,
        paddingVertical: 9,
    },
        transitDurationLarge: {
        fontSize: 24,
        fontWeight: "900",
        lineHeight: 30,
        letterSpacing: 0,
    },
        transitDurationLargeCompact: {
        fontSize: 22,
        lineHeight: 27,
    },
        alternativeRouteLabel: {
        fontSize: 12,
        fontWeight: "800",
    },
        transitModeChipRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 5,
    },
        transitModeChip: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 2,
    },
        transitModeChipText: {
        fontSize: 11,
        fontWeight: "700",
    },
        transitMetricTagRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
    },
        transitMetricTag: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
        transitMetricTagText: {
        fontSize: 11,
        fontWeight: "700",
    },
        transitLegList: {
        gap: 5,
    },
        transitReferenceTimeline: {
        paddingTop: 4,
        paddingBottom: 8,
    },
        transitReferenceTimelineDetail: {
        paddingTop: 6,
        paddingBottom: 0,
    },
    } as const;
}
