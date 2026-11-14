import { StyleSheet } from "react-native";

import type { ScheduleDetailStylesOptions } from "../schedule-detail.styles";

/** sheetBase 영역의 정적 스타일을 생성합니다. */
export function createSheetBaseStyles(options: ScheduleDetailStylesOptions) {
    const { SHEET_HANDLE_HEIGHT } = options;
    return StyleSheet.create({
        routeSheet: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 28,
        elevation: 28,
    },
        routeSheetSurface: {
        flex: 1,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 20,
        borderTopWidth: 1,
        overflow: "hidden",
    },
        panelOpaqueBackdropDark: {
        backgroundColor: "#171A20",
    },
        panelOpaqueBackdropLight: {
        backgroundColor: "#F8FAFC",
    },
        sheetHandleHitArea: {
        height: SHEET_HANDLE_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
    },
        sheetHandleButton: {
        width: "100%",
        height: SHEET_HANDLE_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
    },
        sheetScroll: { flex: 1 },
        sheetScrollContent: { paddingBottom: 0 },
        sheetContent: { flex: 1 },
        sheetQuickSummaryClip: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1,
        overflow: "hidden",
    },
    });
}
