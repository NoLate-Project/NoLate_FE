import { StyleSheet } from "react-native";

import type { RoutePlannerStyleOptions } from "../styles";

/** 경로 계획 화면의 transitDetail 영역 정적 스타일을 생성합니다. */
export function createTransitDetailStyles(options: RoutePlannerStyleOptions) {
    const {
        TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT,
        TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING,
        TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT,
        TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT,
    } = options;
    return {
        transitDetailActionBar: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 6,
        minHeight: TRANSIT_DETAIL_ACTION_BAR_MIN_HEIGHT,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#303033",
        paddingTop: TRANSIT_DETAIL_ACTION_BAR_TOP_PADDING,
        paddingHorizontal: 14,
        justifyContent: "center",
        backgroundColor: "#090A0D",
    },
        transitOverviewActionBar: { paddingTop: 0 },
        transitCollapsedSummaryRow: {
        minHeight: TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT,
        borderBottomWidth: StyleSheet.hairlineWidth,
        marginBottom: 8,
        alignItems: "stretch",
        gap: 3,
        paddingBottom: 8,
        paddingRight: 24,
    },
        transitCollapsedSummaryChevron: {
        position: "absolute",
        right: 0,
        top: 6,
    },
        transitCollapsedSummaryExpanded: {
        height: "auto",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 2,
        paddingBottom: 8,
    },
        transitCollapsedRouteBar: {
        paddingBottom: 8,
    },
        transitOverviewWalk: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
        transitOverviewWalkText: {
        flex: 1,
        gap: 3,
    },
        transitOverviewWalkDestination: { fontSize: 13, fontWeight: "700", flexShrink: 1 },
        transitOverviewWalkMetric: { fontSize: 13, fontWeight: "600" },
        transitCollapsedArrivalText: {
        flexShrink: 0,
        fontSize: 24,
        fontWeight: "900",
        lineHeight: 30,
    },
        transitCollapsedArrivalExpanded: {
        fontSize: 12.5,
        lineHeight: 16,
    },
        transitCollapsedMetricsText: {
        minWidth: 0,
        textAlign: "left",
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 19,
    },
        transitCollapsedMetricsExpanded: {
        flex: 0,
        textAlign: "left",
        fontSize: 11.5,
        lineHeight: 16,
    },
        transitDetailFooterSummary: {
        gap: 2,
        paddingBottom: 8,
    },
        transitDetailFooterArrival: {
        fontSize: 15,
        fontWeight: "700",
    },
        transitDetailFooterMetrics: {
        fontSize: 12,
        fontWeight: "600",
    },
        transitDetailActionButtonRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
        transitDetailActionButtonStack: {
        flexDirection: "column",
        alignItems: "stretch",
        gap: 8,
    },
        transitDetailActionButtonExpanded: {
        flex: 0,
        height: "auto",
        minHeight: 44,
        paddingVertical: 6,
        borderRadius: 14,
    },
        transitDetailActionTextExpanded: {
        flexShrink: 1,
        textAlign: "center",
    },
        transitDetailSaveButton: {
        flex: 1.18,
        minWidth: 0,
        height: TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT,
        borderRadius: 999,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
    },
        transitDetailSaveButtonDisabled: {
        opacity: 0.48,
    },
        transitDetailActionIcon: {
        width: 29,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
        transitDetailSaveText: {
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 20,
    },
        transitDetailPreviewButton: {
        flex: 0.82,
        minWidth: 0,
        height: TRANSIT_DETAIL_ACTION_BUTTON_HEIGHT,
        borderRadius: 999,
        borderWidth: 1.4,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 7,
        backgroundColor: "rgba(255,255,255,0.035)",
    },
        transitDetailPreviewText: {
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 20,
    },
        transitLegItemCard: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
        transitLegRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 6,
    },
        transitLegKindDot: {
        width: 16,
        height: 16,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
    },
        transitLegKindDotText: {
        color: "#FFFFFF",
        fontSize: 9,
        fontWeight: "800",
        lineHeight: 10,
    },
        transitLegLabel: {
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 16,
    },
        transitLegTextWrap: {
        flex: 1,
        gap: 2,
    },
        transitLegPrimaryRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
        transitLegMeta: {
        fontSize: 11,
        fontWeight: "700",
        flexShrink: 0,
    },
        transitLegFromTo: {
        fontSize: 11,
        fontWeight: "500",
    },
        transitLegAssist: {
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 15,
    },
        transitDeparturePickerModal: {
        flex: 1,
        justifyContent: "flex-end",
    },
        transitDeparturePickerBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.56)",
    },
        transitDeparturePickerSheet: {
        paddingTop: 12,
        paddingHorizontal: 18,
        paddingBottom: 30,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
        transitDeparturePickerHeader: {
        minHeight: 42,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
        transitDeparturePickerTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
        transitDeparturePickerTitle: {
        fontSize: 17,
        fontWeight: "900",
        lineHeight: 22,
    },
        transitDeparturePickerCommand: {
        minWidth: 58,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
    },
        transitDeparturePickerCommandText: {
        fontSize: 14,
        fontWeight: "800",
    },
        transitDeparturePickerApply: {
        borderRadius: 8,
        backgroundColor: "#2F80ED",
    },
        transitDeparturePickerApplyText: {
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: "900",
    },
        transitDepartureNowButton: {
        alignSelf: "center",
        minHeight: 38,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
        transitDepartureNowText: {
        fontSize: 13,
        fontWeight: "800",
    },
    } as const;
}
