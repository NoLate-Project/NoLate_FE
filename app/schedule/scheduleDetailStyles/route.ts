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
        inspectedPlanBar: {
        minHeight: 34,
        marginBottom: 10,
        paddingBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
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
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "900",
        letterSpacing: 0,
    },
        inspectedPlanClose: {
        width: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
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
        sheetRouteCopy: {
        flex: 1,
        minWidth: 0,
    },
        sheetRouteKickerRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
        sheetRouteTitleRow: {
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
        sheetRouteLiveDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
        sheetRouteLiveDotActive: {
        backgroundColor: "#22C55E",
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
        sheetRouteTitleInline: {
        marginTop: 0,
        fontSize: 16,
        lineHeight: 22,
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
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: "center",
        justifyContent: "center",
    },
        routeProgressSection: {
        marginTop: 12,
    },
        routeDetailHeader: {
        minHeight: 38,
        marginTop: 12,
        paddingHorizontal: 2,
        paddingBottom: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
        routeDetailSectionTitle: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "900",
        letterSpacing: 0,
    },
        routeDetailBaseTimeText: {
        flexShrink: 1,
        fontSize: 10,
        fontWeight: "800",
        lineHeight: 14,
        textAlign: "right",
    },
        sheetEmptyText: {
        fontSize: 14,
        fontWeight: "800",
        paddingVertical: 20,
        textAlign: "center",
    },
    });
}
