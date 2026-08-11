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
        notificationHeroHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
        notificationHeroIcon: {
        width: 40,
        height: 40,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
        notificationHeroText: {
        flex: 1,
        minWidth: 0,
    },
        notificationHeroTitle: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "700",
    },
        notificationHeroBody: {
        marginTop: 2,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "600",
    },
        notificationRouteSummary: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
    },
        notificationRouteMetric: {
        flex: 1,
        alignItems: "center",
    },
        notificationRouteMetricLabel: {
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "600",
    },
        notificationRouteMetricValue: {
        marginTop: 2,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "700",
    },
        notificationRouteMetricDivider: {
        width: StyleSheet.hairlineWidth,
        height: 28,
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
        notificationToggleText: {
        flex: 1,
        minWidth: 0,
    },
        notificationToggleTitle: {
        fontSize: 13.5,
        lineHeight: 18,
        fontWeight: "700",
    },
        notificationToggleBody: {
        marginTop: 2,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "600",
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
        notificationBehaviorNote: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 7,
        paddingHorizontal: 4,
    },
        notificationBehaviorText: {
        flex: 1,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
        notificationBehaviorStrong: {
        fontWeight: "700",
    },
        notificationRouteRequired: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 8,
        gap: 8,
    },
        notificationRouteIcon: {
        width: 58,
        height: 58,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 2,
    },
        notificationRouteTitle: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: "700",
        textAlign: "center",
    },
        notificationRouteBody: {
        maxWidth: 270,
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: "600",
        textAlign: "center",
    },
        notificationFeatureList: {
        alignSelf: "stretch",
        marginTop: 5,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
    },
        notificationFeatureRow: {
        minHeight: 37,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
        notificationFeatureDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 26,
    },
        notificationFeatureText: {
        flex: 1,
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "600",
    },
        notificationOptionalNotice: {
        minHeight: 22,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
        notificationOptionalText: {
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    });
}
