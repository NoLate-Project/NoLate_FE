import { StyleSheet } from "react-native";

import type { ScheduleDetailStylesOptions } from "../schedule-detail.styles";

/** header 영역의 정적 스타일을 생성합니다. */
export function createHeaderStyles(options: ScheduleDetailStylesOptions) {
    void options;
    return StyleSheet.create({
        topOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        elevation: 0,
    },
        topHeaderSurface: {
        minHeight: 112,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 16,
        paddingBottom: 12,
        overflow: "hidden",
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
        plainPageHeader: {
        minHeight: 0,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        paddingBottom: 10,
    },
        compactRouteHeaderSurface: { minHeight: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 8 },
        compactRouteHeaderTitle: { fontSize: 16, fontWeight: "600" },
        compactRouteHeaderContext: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 4, minHeight: 28 },
        compactRouteHeaderDate: { flexShrink: 0, fontSize: 12, lineHeight: 17 },
        compactRouteHeaderDestination: { flex: 1, minWidth: 0 },
        compactRouteHeaderPlace: { fontSize: 12, lineHeight: 17, textAlign: "right" },
        topHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        topHeaderIconButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
        topHeaderContent: {
        flex: 1,
        minWidth: 0,
    },
        plainTopHeaderContent: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 88,
        right: 88,
        alignItems: "center",
        justifyContent: "center",
    },
        topHeaderTitleRow: {
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
        plainTopHeaderTitleRow: {
        width: "100%",
        justifyContent: "center",
    },
        topHeaderTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 17,
        fontWeight: "900",
        letterSpacing: 0,
    },
        topHeaderTitleLarge: {
        flex: 0,
        marginHorizontal: 4,
        marginTop: 2,
        marginBottom: 4,
    },
        plainTopHeaderTitle: {
        textAlign: "center",
        fontWeight: "700",
    },
        topHeaderActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 0,
    },
        plainTopHeaderActions: {
        marginLeft: "auto",
    },
        topHeaderRouteBar: {
        minHeight: 42,
        marginTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 10,
        paddingHorizontal: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        topHeaderMapStatus: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        topHeaderMapStatusCopy: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        topHeaderMapStatusLarge: {
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        gap: 0,
    },
        topHeaderMapStatusCopyLarge: {
        flex: 0,
    },
        topHeaderMapStatusMark: {
        width: 18,
        height: 18,
        alignItems: "center",
        justifyContent: "center",
    },
        topHeaderMapStatusLabel: {
        flex: 1,
        minWidth: 0,
    },
        topHeaderMapStatusText: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: "600",
    },
        topHeaderMapRetry: {
        minHeight: 44,
        maxWidth: "40%",
        paddingHorizontal: 8,
        justifyContent: "center",
    },
        topHeaderMapRetryLarge: {
        alignSelf: "flex-start",
        maxWidth: "100%",
        marginLeft: 16,
    },
        topHeaderRouteBarMain: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
    },
        topHeaderRouteBarLarge: {
        flexDirection: "column",
        alignItems: "stretch",
        gap: 3,
        paddingTop: 8,
    },
        topHeaderRouteBarMainLarge: {
        flex: 0,
        gap: 8,
    },
        topHeaderRouteBarText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        fontWeight: "900",
        letterSpacing: 0,
    },
        topHeaderTravelPill: {
        maxWidth: 112,
        minHeight: 28,
        alignItems: "center",
        justifyContent: "center",
    },
        topHeaderScrollableContext: {
        flexGrow: 0,
        flexShrink: 1,
    },
        topHeaderTravelPillLarge: {
        maxWidth: "100%",
        alignSelf: "stretch",
        alignItems: "flex-start",
        paddingLeft: 31,
        marginTop: 4,
        flexShrink: 0,
    },
        topHeaderTravelText: {
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 0,
    },
    });
}
