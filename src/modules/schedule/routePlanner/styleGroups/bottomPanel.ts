import { StyleSheet } from "react-native";

import type { RoutePlannerStyleOptions } from "../styles";

/** 경로 계획 화면의 bottomPanel 영역 정적 스타일을 생성합니다. */
export function createBottomPanelStyles(options: RoutePlannerStyleOptions) {
    const {
        BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT,
        TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT,
    } = options;
    return {
        bottomOverlay: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 0,
        paddingBottom: 0,
    },
        bottomPanelMotion: {
        maxHeight: 620,
    },
        bottomPanel: {
        borderWidth: 1,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        maxHeight: 620,
        overflow: "hidden",
    },
        bottomPanelDetail: {
        height: "100%",
        borderWidth: 0,
        backgroundColor: "#0B0C0F",
    },
        bottomHandleTouchArea: {
        height: BOTTOM_SHEET_HANDLE_TOUCH_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 8,
        paddingBottom: 6,
    },
        bottomHandleTouchAreaDetail: {
        height: TRANSIT_DETAIL_HANDLE_TOUCH_HEIGHT,
        paddingTop: 6,
        paddingBottom: 4,
    },
        bottomHandle: {
        width: 42,
        height: 4,
        borderRadius: 2,
        alignSelf: "center",
        marginTop: 0,
        marginBottom: 0,
    },
        bottomHandleDetail: {
        width: 34,
        height: 3,
        backgroundColor: "rgba(255,255,255,0.16)",
    },
        bottomPanelScroll: {
        flexShrink: 1,
        minHeight: 0,
    },
        bottomPanelScrollContent: {
        paddingHorizontal: 12,
        gap: 10,
    },
        bottomPanelScrollContentDetail: {
        paddingHorizontal: 10,
        gap: 0,
    },
        routeHintCard: {
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 12,
    },
        routeHintText: {
        fontSize: 12,
        fontWeight: "600",
        textAlign: "center",
    },
        modeRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        gap: 8,
    },
        modeChip: {
        minWidth: 72,
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 13,
        alignItems: "center",
        justifyContent: "center",
    },
        routeQualityWarning: {
        marginHorizontal: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 7,
    },
        routeQualityWarningText: {
        flex: 1,
        minWidth: 0,
        fontSize: 12,
        fontWeight: "700",
        lineHeight: 17,
        letterSpacing: 0,
    },
        routeAttributionLink: {
        minHeight: 30,
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 4,
    },
        routeAttributionText: {
        fontSize: 11,
        fontWeight: "600",
        lineHeight: 15,
        letterSpacing: 0,
    },
        alternativeSection: {
        borderWidth: 1,
        borderRadius: 12,
        overflow: "hidden",
    },
        alternativeSectionDetail: {
        borderWidth: 0,
        borderRadius: 0,
        overflow: "visible",
    },
        transitFilterRow: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
        transitFilterRowContent: {
        paddingHorizontal: 12,
        paddingTop: 10,
        gap: 18,
    },
        transitFilterTab: {
        paddingBottom: 10,
        borderBottomWidth: 3,
    },
        transitFilterTabText: {
        fontSize: 14,
        fontWeight: "800",
    },
        transitDepartureRow: {
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 3,
    },
        transitDepartureText: {
        fontSize: 17,
        fontWeight: "800",
    },
        transitDepartureHint: {
        fontSize: 13,
        fontWeight: "600",
        lineHeight: 18,
    },
        alternativeLoadingRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
        alternativeLoadingText: {
        fontSize: 12,
    },
        alternativeErrorText: {
        fontSize: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        textAlign: "center",
    },
        alternativeErrorWrap: {
        alignItems: "center",
        paddingBottom: 12,
    },
        alternativeRetryButton: {
        minHeight: 36,
        borderRadius: 8,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
        alternativeRetryText: {
        fontSize: 13,
        fontWeight: "800",
        lineHeight: 17,
        letterSpacing: 0,
    },
        alternativeEmptyText: {
        fontSize: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    } as const;
}
