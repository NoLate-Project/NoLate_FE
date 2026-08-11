import { StyleSheet } from "react-native";

import type { ScheduleDetailStylesOptions } from "../schedule-detail.styles";

/** improved 영역의 정적 스타일을 생성합니다. */
export function createImprovedStyles(options: ScheduleDetailStylesOptions) {
    const {
        IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT,
        SHEET_HANDLE_HEIGHT,
    } = options;
    return StyleSheet.create({
        improvedCompactSummary: {
        minHeight: IMPROVED_COMPACT_SHEET_CONTENT_HEIGHT - SHEET_HANDLE_HEIGHT,
        paddingHorizontal: 1,
    },
        improvedRouteIdentityCompact: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        improvedRouteIdentityMain: {
        flex: 1,
        minWidth: 0,
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        improvedRouteIdentityExpanded: {
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
        improvedExpandedIdentityRow: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
        improvedExpandedCollapseButton: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
        improvedExpandedCollapseButtonFace: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
    },
        improvedRouteIdentityTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
        improvedRouteIdentityMeta: {
        flexShrink: 0,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "600",
        letterSpacing: 0,
    },
        improvedCompactDepartureAction: {
        height: 38,
        paddingHorizontal: 11,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
        improvedCompactDepartureActionText: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
        improvedCompactBody: {
        flex: 1,
        minHeight: 120,
        paddingBottom: 8,
    },
        improvedCompactTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
        improvedCompactTimeCopy: {
        flex: 1,
        minWidth: 0,
    },
        improvedDepartureEyebrow: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
        improvedDepartureTimeRow: {
        minWidth: 0,
        marginTop: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        improvedCompactDepartureTime: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 25,
        lineHeight: 31,
        fontWeight: "900",
        letterSpacing: -0.5,
        fontVariant: ["tabular-nums"],
    },
        improvedExpandedDepartureTime: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 28,
        lineHeight: 34,
        fontWeight: "900",
        letterSpacing: -0.6,
        fontVariant: ["tabular-nums"],
    },
        improvedRemainingChip: {
        minHeight: 25,
        paddingHorizontal: 9,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
    },
        improvedRemainingChipText: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
        letterSpacing: 0,
    },
        improvedArrivalSummary: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "600",
        letterSpacing: 0,
    },
        compactRouteStrip: {
        width: "100%",
        height: 6,
        marginTop: 12,
        borderRadius: 3,
        flexDirection: "row",
        overflow: "hidden",
    },
        compactRouteStripSegment: {
        height: 6,
        minWidth: 3,
        borderRadius: 3,
    },
        compactRouteStripSpacing: {
        marginLeft: 2,
    },
        improvedCompactFacts: {
        marginTop: 8,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "600",
        letterSpacing: 0,
    },
        improvedDepartureSharedRow: {
        marginTop: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
        improvedExpandedHero: {
        paddingBottom: 6,
    },
        improvedExpandedHeroMain: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
        improvedExpandedHeroCopy: {
        flex: 1,
        minWidth: 0,
    },
        improvedExpandedDepartureAction: {
        minWidth: 100,
        height: 44,
        paddingHorizontal: 13,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
        improvedExpandedDepartureActionText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
        improvedRouteFacts: {
        marginTop: 13,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        improvedRouteFactDivider: {
        width: 1,
        height: 11,
    },
        improvedRouteFactText: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    });
}
