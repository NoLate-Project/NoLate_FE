import { StyleSheet } from "react-native";

import type { ScheduleDetailStylesOptions } from "../schedule-detail.styles";

/** route 영역의 정적 스타일을 생성합니다. */
export function createRouteStyles(options: ScheduleDetailStylesOptions) {
    void options;
    return StyleSheet.create({
        travelPlanList: {
        marginTop: 8,
        paddingTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 2,
    },
        travelPlanRow: {
        minHeight: 52,
        borderRadius: 6,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
        travelPlanAvatar: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
    },
        travelPlanCopy: {
        flex: 1,
        minWidth: 0,
    },
        travelPlanName: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
        travelPlanMeta: {
        marginTop: 2,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
        routeCompanionList: {
        paddingVertical: 4,
    },
        routeCompanionRow: {
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
        routeCompanionMain: {
        flex: 1,
        minWidth: 0,
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 9,
        gap: 10,
    },
        routeCompanionInitial: {
        fontSize: 12,
        fontWeight: "700",
    },
        routeCompanionName: {
        fontSize: 14,
        fontWeight: "700",
    },
        routeCompanionMeta: {
        fontSize: 12,
        marginTop: 2,
        fontWeight: "500",
    },
        routeCompanionAction: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
        inspectedPlanBar: {
        minHeight: 48,
        marginBottom: 8,
        paddingHorizontal: 10,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
        inspectedPlanIdentity: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
        inspectedPlanText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "700",
        letterSpacing: 0,
    },
        inspectedPlanClose: {
        minWidth: 44,
        minHeight: 44,
        flexDirection: "row",
        gap: 5,
        paddingLeft: 4,
        alignItems: "center",
        justifyContent: "center",
    },
        inspectedPlanActionText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "700",
    },
        plainTravelPlanParticipants: {
        marginTop: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
        plainTravelPlanDisclosure: {
        minHeight: 46,
        paddingHorizontal: 4,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
        plainTravelPlanDisclosureTitle: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
        plainTravelPlanDisclosureText: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "900",
        letterSpacing: 0,
    },
        plainTravelPlanDisclosureMeta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
        plainTravelPlanCount: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
        sheetRouteSummary: {
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
        sheetRouteTopRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
        sheetRouteTopRowLarge: {
        flexDirection: "column",
        alignItems: "stretch",
        gap: 6,
    },
        sheetRouteCopy: {
        flex: 1,
        minWidth: 0,
    },
        sheetRouteKickerRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
        sheetRouteLiveDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
        sheetRouteMeta: {
        flexShrink: 1,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
        sheetRouteTitle: {
        marginTop: 2,
        fontSize: 18,
        lineHeight: 23,
        fontWeight: "900",
        letterSpacing: 0,
    },
        sheetRouteDuration: {
        fontSize: 26,
        lineHeight: 30,
        fontWeight: "900",
        letterSpacing: 0,
        fontVariant: ["tabular-nums"],
    },
        sheetRouteActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
        sheetRouteMapButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
        sheetRouteMapButtonLabeled: {
        width: undefined,
        height: undefined,
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 6,
        flexDirection: "row",
        gap: 6,
    },
        sheetRouteMapButtonLabel: {
        fontSize: 13,
        fontWeight: "700",
    },
        routeDetailBaseTimeText: {
        marginTop: 4,
        fontSize: 10,
        fontWeight: "800",
        lineHeight: 14,
    },
        sheetEmptyText: {
        fontSize: 14,
        fontWeight: "800",
        paddingVertical: 20,
        textAlign: "center",
    },
    });
}
