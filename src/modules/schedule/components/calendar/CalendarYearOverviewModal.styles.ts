import { StyleSheet } from "react-native";

/** CalendarYearOverviewModal 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 24,
    },
    contentThreeColumns: {
        paddingHorizontal: 16,
    },
    floatingBarContentEnd: {
        paddingBottom: 24,
    },
    yearSection: {
        marginBottom: 44,
    },
    yearSectionThreeColumns: {
        marginBottom: 24,
    },
    yearHeader: {
        marginBottom: 13,
        paddingBottom: 2,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-start",
    },
    yearTitle: {
        fontSize: 34,
        lineHeight: 40,
        fontWeight: "700",
        letterSpacing: 0,
    },
    yearTitleThreeColumns: {
        fontSize: 28,
        lineHeight: 34,
    },
    monthGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        rowGap: 20,
    },
    monthGridThreeColumns: {
        rowGap: 6,
    },
    monthPreview: {
        width: "31%",
        minHeight: 130,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingBottom: 6,
    },
    monthPreviewThreeColumns: {
        minHeight: 120,
        paddingHorizontal: 3,
        paddingTop: 3,
    },
    selectedMonth: { borderRadius: 8 },
    standardMonth: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "transparent",
    },
    standardSelectedMonth: { borderRadius: 12 },
    monthPreviewWide: {
        width: "48%",
    },
    monthTitle: {
        fontSize: 20,
        fontWeight: "700",
        marginBottom: 1,
        letterSpacing: 0,
    },
    monthTitleThreeColumns: {
        fontSize: 16,
        marginBottom: 4,
    },
    daysGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    dayCell: {
        width: "14.2857%",
        height: 15,
        alignItems: "center",
        justifyContent: "center",
    },
    dayCellWide: {
        height: 23,
    },
    dayBadge: {
        minWidth: 15,
        height: 15,
        borderRadius: 7.5,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "transparent",
        alignItems: "center",
        justifyContent: "center",
    },
    dayBadgeWide: {
        minWidth: 18,
        height: 21,
        borderRadius: 10.5,
    },
    selectedMarkerFill: { ...StyleSheet.absoluteFillObject, borderRadius: 99 },
    standardDayBadge: { borderRadius: 4 },
    standardTodaySelectedOutline: {
        ...StyleSheet.absoluteFillObject,
        margin: -1.5,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 5,
    },
    dayText: {
        fontSize: 10,
        fontWeight: "600",
    },
    standardDayText: {
        fontVariant: ["tabular-nums"],
        fontWeight: "500",
    },
    standardMarkedDayText: { fontWeight: "800" },
    scheduleDensityBadge: {
        borderRadius: 2,
    },
    scheduleDensityTextStrong: {
        fontWeight: "700",
    },
});

export default styles;
