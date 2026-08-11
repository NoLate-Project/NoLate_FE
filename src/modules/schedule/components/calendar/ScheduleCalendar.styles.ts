import { StyleSheet } from "react-native";

export type ScheduleCalendarStylesOptions = {
    CALENDAR_CONTENT_BOTTOM_PADDING: number;
    CALENDAR_HEADER_SPACING: number;
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING: number;
    WEEKDAY_HEADER_HEIGHT: number;
};

/** 화면 레이아웃 상수를 주입받아 정적 스타일을 한 번 생성합니다. */
export function createScheduleCalendarStyles({
    CALENDAR_CONTENT_BOTTOM_PADDING,
    CALENDAR_HEADER_SPACING,
    DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
    WEEKDAY_HEADER_HEIGHT,
}: ScheduleCalendarStylesOptions) {
    return StyleSheet.create({
    stackList: {
        flex: 1,
    },
    stackListContent: {
        paddingBottom: 24,
    },
    stackMonth: {
        borderBottomWidth: 0,
    },
    stackMonthHeader: {
        paddingHorizontal: 28,
        justifyContent: "center",
    },
    stackMonthTitle: {
        fontSize: 25,
        fontWeight: "900",
        letterSpacing: 0,
    },
    stackMonthGrid: {
        alignSelf: "stretch",
    },
    stackWeekRow: {
        position: "relative",
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    stackDayCell: {
        width: "14.2857%",
    },
    calendar: {
        paddingHorizontal: 12,
        paddingBottom: CALENDAR_CONTENT_BOTTOM_PADDING,
    },
    detailMonthGrid: {
        position: "relative",
        alignSelf: "stretch",
        paddingTop: CALENDAR_HEADER_SPACING,
        paddingHorizontal: DETAIL_MONTH_GRID_HORIZONTAL_PADDING,
        paddingBottom: CALENDAR_CONTENT_BOTTOM_PADDING,
    },
    detailMonthGridRow: {
        position: "relative",
        zIndex: 1,
        flexDirection: "row",
    },
    detailMonthGridHiddenRow: {
        display: "none",
    },
    detailMonthGridCell: {
        width: "14.2857%",
        overflow: "hidden",
    },
    detailMonthGridDay: {
        alignItems: "center",
    },
    detailMonthGridDayCircle: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
    },
    detailMonthGridDayText: {
        letterSpacing: 0,
        textAlign: "center",
    },
    detailMonthGridLunarText: {
        fontWeight: "700",
        letterSpacing: -0.35,
        textAlign: "center",
    },
    detailMonthGridHolidayText: {
        position: "absolute",
        left: 2,
        right: 2,
        fontWeight: "800",
        letterSpacing: -0.25,
        textAlign: "center",
    },
    detailMonthGridMarkers: {
        position: "absolute",
        left: 2,
        right: 2,
        minHeight: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    detailMonthGridDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    detailMonthGridTravelMarker: {
        width: 8,
        height: 8,
    },
    detailMonthGridEventMore: {
        flexShrink: 0,
        fontSize: 7,
        lineHeight: 8,
        fontWeight: "800",
    },
    detailMonthAccessibilityAdjuster: {
        position: "absolute",
        top: 0,
        left: 0,
        width: 1,
        height: 1,
        zIndex: 3,
    },
    detailMonthSelectionGlyph: {
        position: "absolute",
        top: CALENDAR_HEADER_SPACING,
        left: 0,
        zIndex: 2,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    detailMonthSelectionDayText: {
        padding: 0,
        margin: 0,
        borderWidth: 0,
        textAlign: "center",
        fontWeight: "700",
        backgroundColor: "transparent",
    },
    detailMonthSelectionLunarText: {
        padding: 0,
        margin: 0,
        borderWidth: 0,
        textAlign: "center",
        fontWeight: "700",
        letterSpacing: -0.35,
        backgroundColor: "transparent",
    },
    detailMonthPagerViewport: {
        overflow: "hidden",
        width: "100%",
    },
    detailMonthPagerCanvas: {
        position: "relative",
        width: "100%",
    },
    detailMonthPagerPage: {
        width: "100%",
        zIndex: 1,
    },
    detailMonthPagerPageAbsolute: {
        position: "absolute",
        top: 0,
        left: 0,
        transform: [
            { translateX: 0 },
            { translateY: 0 },
        ],
    },
    monthCalendarContainer: {
        flexShrink: 0,
        overflow: "hidden",
    },
    weekdayHeader: {
        height: WEEKDAY_HEADER_HEIGHT,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
    },
    weekdayText: {
        width: "14.2857%",
        textAlign: "center",
        fontSize: 13,
        fontWeight: "600",
        opacity: 0.92,
    },
    listMonthHeader: {
        height: 58,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    listMonthTitle: {
        fontSize: 24,
        fontWeight: "800",
        letterSpacing: 0,
    },
    monthArrow: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    weekContainer: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    weekGrid: {
        flexDirection: "row",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    weekDayCell: {
        width: "14.2857%",
    },
});
}
