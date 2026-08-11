import { StyleSheet } from "react-native";

import type { ScheduleIndexStylesOptions } from "../index.styles";

/** shell 영역의 정적 스타일을 생성합니다. */
export function createShellStyles(options: ScheduleIndexStylesOptions) {
    const {
        LIQUID_TOOLBAR_BUTTON_SIZE,
        LIQUID_YEAR_PILL_WIDTH,
        STICKY_CALENDAR_HEADER_HEIGHT,
        STICKY_MONTH_HEADER_HEIGHT,
        STICKY_WEEKDAY_HEADER_HEIGHT,
    } = options;
    return StyleSheet.create({
        root: {
        flex: 1,
        overflow: "hidden",
    },
        topMaterialLayer: {
        position: "absolute",
        left: 0,
        right: 0,
        zIndex: 30,
        elevation: 30,
    },
        topMaterialBand: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 34,
    },
        topMaterialBandDark: {
        backgroundColor: "rgba(0,0,0,0.30)",
    },
        topMaterialBandLight: {
        backgroundColor: "rgba(242,242,247,0.50)",
    },
        topFadeBandStrong: {
        position: "absolute",
        top: 18,
        left: 0,
        right: 0,
        height: 54,
    },
        topFadeBandDark: {
        backgroundColor: "rgba(0,0,0,0.11)",
    },
        topFadeBandLight: {
        backgroundColor: "rgba(242,242,247,0.20)",
    },
        topFadeBandSoft: {
        position: "absolute",
        top: 66,
        left: 0,
        right: 0,
        height: 60,
    },
        topFadeBandSoftDark: {
        backgroundColor: "rgba(0,0,0,0.035)",
    },
        topFadeBandSoftLight: {
        backgroundColor: "rgba(242,242,247,0.08)",
    },
        bottomMaterialLayer: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 132,
        zIndex: 4,
        elevation: 4,
    },
        bottomMaterialLayerDark: {
        backgroundColor: "rgba(0,0,0,0.045)",
    },
        bottomMaterialLayerLight: {
        backgroundColor: "rgba(242,242,247,0.07)",
    },
        toolbar: {
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 4,
    },
        toolbarChromeLayer: {
        zIndex: 50,
        elevation: 50,
    },
        yearTapOverlay: {
        position: "absolute",
        left: 16,
        width: LIQUID_YEAR_PILL_WIDTH,
        height: LIQUID_TOOLBAR_BUTTON_SIZE,
        borderRadius: LIQUID_TOOLBAR_BUTTON_SIZE / 2,
        zIndex: 58,
        elevation: 58,
        backgroundColor: "transparent",
    },
        stickyCalendarHeader: {
        position: "absolute",
        left: 0,
        right: 0,
        height: STICKY_CALENDAR_HEADER_HEIGHT,
        zIndex: 41,
        elevation: 41,
        overflow: "hidden",
    },
        stickyHeaderBackdrop: {
        ...StyleSheet.absoluteFillObject,
    },
        stickyHeaderBackdropDark: {
        backgroundColor: "transparent",
    },
        stickyHeaderBackdropLight: {
        backgroundColor: "transparent",
    },
        stickyHeaderBackdropTop: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 42,
    },
        stickyHeaderBackdropTopDark: {
        backgroundColor: "transparent",
    },
        stickyHeaderBackdropTopLight: {
        backgroundColor: "transparent",
    },
        stickyHeaderBackdropBottom: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 58,
    },
        stickyHeaderBackdropBottomDark: {
        backgroundColor: "transparent",
    },
        stickyHeaderBackdropBottomLight: {
        backgroundColor: "transparent",
    },
        stickyMonthHeader: {
        height: STICKY_MONTH_HEADER_HEIGHT,
        paddingHorizontal: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        zIndex: 2,
        elevation: 2,
    },
        stickyMonthTitle: {
        fontSize: 33,
        fontWeight: "700",
        letterSpacing: 0,
        transform: [{ translateY: -1.5 }],
    },
        stickyMonthTitleCurrentDark: {
        color: "#ff453a",
    },
        stickyMonthTitleCurrentLight: {
        color: "#ff3b30",
    },
        stickyWeekdayHeader: {
        height: STICKY_WEEKDAY_HEADER_HEIGHT,
        paddingHorizontal: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        zIndex: 3,
        elevation: 3,
    },
        stickyWeekdayText: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 10,
        fontWeight: "600",
        letterSpacing: 0,
        opacity: 1,
    },
    });
}
