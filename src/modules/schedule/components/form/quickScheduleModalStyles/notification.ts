import { StyleSheet } from "react-native";

import type { QuickScheduleModalStylesOptions } from "../QuickScheduleModal.styles";

/** notification 영역의 정적 스타일을 생성합니다. */
export function createNotificationStyles(options: QuickScheduleModalStylesOptions) {
    void options;
    return StyleSheet.create({
        notificationEditor: {
        flex: 1,
        minHeight: 0,
    },
        notificationEditorContent: {
        gap: 9,
        paddingBottom: 2,
    },
        notificationHero: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
    },
        notificationDepartureTime: {
        fontSize: 30,
        lineHeight: 37,
        fontWeight: "800",
        fontVariant: ["tabular-nums"],
    },
        notificationDepartureTimeLarge: {
        fontSize: 19,
        lineHeight: 24,
    },
        notificationRouteSummary: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 5,
    },
        notificationRouteMetric: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 10,
    },
        notificationRouteMetricLarge: {
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
    },
        notificationRouteMetricLabel: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "600",
    },
        notificationRouteMetricValue: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "700",
    },
        notificationControlCard: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
    },
        notificationToggleRow: {
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
        notificationToggleTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 13.5,
        lineHeight: 18,
        fontWeight: "700",
    },
        notificationToggleBody: {
        marginTop: 2,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "500",
    },
        notificationLeadSection: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
        notificationLeadHeading: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
        notificationLeadHeadingLarge: {
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 3,
    },
        notificationLeadTitle: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "700",
    },
        notificationLeadCaption: {
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "600",
    },
        notificationOptions: {
        marginTop: 8,
        flexDirection: "row",
        gap: 7,
    },
        notificationOptionsLarge: {
        flexDirection: "column",
    },
        notificationChip: {
        flex: 1,
        minWidth: 0,
        minHeight: 40,
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: "row",
        gap: 4,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 6,
    },
        notificationChipLarge: {
        flex: 0,
        minHeight: 44,
        justifyContent: "flex-start",
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
        notificationChipText: {
        fontSize: 12,
        fontWeight: "700",
    },
        notificationModeSection: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
        notificationModeOptions: {
        marginTop: 8,
        gap: 7,
    },
        notificationModeButton: {
        minWidth: 0,
        minHeight: 76,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
        notificationModeIcon: {
        width: 34,
        height: 34,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
    },
        notificationModeCopy: {
        flex: 1,
        minWidth: 0,
    },
        notificationModeText: {
        fontSize: 11.5,
        fontWeight: "700",
    },
        notificationModeDescription: {
        marginTop: 3,
        fontSize: 9.5,
        lineHeight: 14,
        fontWeight: "600",
    },
        notificationModeNote: {
        marginTop: 8,
        paddingHorizontal: 2,
        paddingVertical: 5,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 7,
    },
        notificationModeNoteText: {
        flex: 1,
        fontSize: 9.5,
        lineHeight: 14,
        fontWeight: "600",
    },
        notificationOffState: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        minHeight: 34,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
        notificationOffText: {
        flex: 1,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
        notificationRouteRequired: {
        paddingTop: 14,
        paddingBottom: 12,
        gap: 10,
    },
        notificationRouteIcon: {
        width: 44,
        height: 44,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 4,
    },
        notificationRouteTitle: {
        fontSize: 17,
        lineHeight: 23,
        fontWeight: "800",
    },
        notificationRouteBody: {
        fontSize: 13,
        lineHeight: 19,
        fontWeight: "500",
    },
    });
}
