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
        transitCollapsedSummaryRow: {
        height: TRANSIT_DETAIL_COLLAPSED_SUMMARY_HEIGHT,
        borderBottomWidth: StyleSheet.hairlineWidth,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
        transitCollapsedArrivalText: {
        flexShrink: 0,
        fontSize: 16,
        fontWeight: "900",
        lineHeight: 22,
    },
        transitCollapsedMetricsText: {
        flex: 1,
        minWidth: 0,
        textAlign: "right",
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 19,
    },
        transitDetailActionButtonRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
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
        confirmBtn: {
        minHeight: 50,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 4,
    },
        confirmText: {
        fontWeight: "700",
        fontSize: 14,
    },
    } as const;
}
