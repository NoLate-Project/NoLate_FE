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
    floatingBarContentEnd: {
        paddingBottom: 24,
    },
    yearSection: {
        marginBottom: 44,
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
    monthGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        rowGap: 20,
    },
    monthPreview: {
        width: "31%",
        minHeight: 130,
    },
    monthTitle: {
        fontSize: 20,
        fontWeight: "700",
        marginBottom: 1,
        letterSpacing: 0,
    },
    daysGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
    },
    dayCell: {
        width: "14.2857%",
        height: 17.3333,
        alignItems: "center",
        justifyContent: "center",
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
    dayText: {
        fontSize: 10,
        fontWeight: "600",
    },
    scheduleDensityBadge: {
        borderRadius: 2,
    },
    scheduleDensityTextStrong: {
        fontWeight: "700",
    },
});

export default styles;
