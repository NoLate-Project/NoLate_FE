import { StyleSheet } from "react-native";

import type { ScheduleIndexStylesOptions } from "../index.styles";

/** dayHeader 영역의 정적 스타일을 생성합니다. */
export function createDayHeaderStyles(options: ScheduleIndexStylesOptions) {
    const {
        DAY_WEEK_STRIP_HEIGHT,
        DAY_WEEK_STRIP_HORIZONTAL_PADDING,
    } = options;
    return StyleSheet.create({
        dayRoot: {
        flex: 1,
        overflow: "hidden",
    },
        dayBodyEntry: {
        flex: 1,
    },
        dayAllDaySectionSpacer: {
        flex: 1,
    },
        dayModeBody: {
        flex: 1,
    },
        dayPagerViewport: {
        flex: 1,
        overflow: "hidden",
    },
        dayPagerPanel: {
        ...StyleSheet.absoluteFillObject,
    },
        daySinglePanel: {
        flex: 1,
    },
        daySinglePanelBody: {
        flex: 1,
    },
        dayWeekStrip: {
        height: DAY_WEEK_STRIP_HEIGHT,
        paddingHorizontal: DAY_WEEK_STRIP_HORIZONTAL_PADDING,
        paddingTop: 9,
        paddingBottom: 1,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "stretch",
        zIndex: 5,
        elevation: 5,
        overflow: "hidden",
    },
        dayWeekStripInner: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "stretch",
    },
        dayWeekCell: {
        flex: 1,
        minHeight: 61,
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
        dayWeekdayLabel: {
        fontSize: 10,
        fontWeight: "600",
        letterSpacing: 0,
        transform: [{ translateY: -4 }],
    },
        dayWeekCircle: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
    },
        dayNavigationSelectionLayer: {
        position: "absolute",
        top: 16,
        width: 34,
        height: 34,
        zIndex: 8,
        elevation: 8,
    },
        dayNavigationSelectionCircle: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 17,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
        dayWeekText: {
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: 0,
    },
        dayWeekDots: {
        height: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
        dayWeekDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
        dayDateTitleBar: {
        height: 36.5,
        borderBottomWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
        dayModeTitleSlot: {
        flexShrink: 0,
        overflow: "hidden",
    },
        dayDateTitleText: {
        fontSize: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
        dayAllDaySection: {
        minHeight: 50,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingVertical: 8,
        paddingLeft: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
        dayAllDayLabel: {
        width: 40,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0,
    },
        dayAllDayItems: {
        paddingRight: 18,
        gap: 8,
        alignItems: "center",
    },
        dayAllDayEmptySpacer: {
        width: 1,
        height: 28,
    },
        dayAllDayEvent: {
        maxWidth: 180,
        minHeight: 34,
        borderRadius: 17,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
        dayAllDayDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
        dayAllDayTitle: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0,
    },
    });
}
