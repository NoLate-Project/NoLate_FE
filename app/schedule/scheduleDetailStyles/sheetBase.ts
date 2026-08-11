import { StyleSheet } from "react-native";

import type { ScheduleDetailStylesOptions } from "../schedule-detail.styles";

/** sheetBase 영역의 정적 스타일을 생성합니다. */
export function createSheetBaseStyles(options: ScheduleDetailStylesOptions) {
    void options;
    return StyleSheet.create({
        routeSheet: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 28,
        elevation: 28,
    },
        routeSheetGlass: {
        flex: 1,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 20,
        borderTopWidth: 1,
        overflow: "hidden",
    },
        panelOpaqueBackdrop: {
        opacity: 1,
    },
        panelOpaqueBackdropDark: {
        backgroundColor: "#171A20",
    },
        panelOpaqueBackdropLight: {
        backgroundColor: "#F8FAFC",
    },
        sheetHandleHitArea: {
        height: 32,
        alignItems: "center",
        justifyContent: "center",
    },
        sheetHandle: {
        width: 34,
        height: 4,
        borderRadius: 999,
    },
        sheetScroll: { flex: 1 },
        sheetScrollContent: { paddingBottom: 0 },
        sheetQuickSummaryClip: {
        overflow: "hidden",
    },
    });
}
