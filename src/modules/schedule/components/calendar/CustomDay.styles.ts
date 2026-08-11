import { StyleSheet } from "react-native";

/** CustomDay 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    animatedCell: {
        alignSelf: "stretch",
        overflow: "hidden",
    },
    cell: {
        alignSelf: "stretch",
        height: 58,
        paddingTop: 8,
        alignItems: "center",
    },
    dayCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    dayText: {
        fontSize: 18,
        lineHeight: 20,
        letterSpacing: 0,
        fontWeight: "600",
    },
    lunarText: {
        maxWidth: 38,
        fontSize: 8,
        lineHeight: 9,
        fontWeight: "700",
        letterSpacing: -0.35,
        textAlign: "center",
    },
    holidayText: {
        position: "absolute",
        top: 49,
        left: 2,
        right: 2,
        fontSize: 8.5,
        lineHeight: 10,
        fontWeight: "800",
        letterSpacing: -0.25,
        textAlign: "center",
    },
    periods: {
        alignSelf: "stretch",
        marginTop: 6,
    },
    periodsWithHoliday: {
        marginTop: 11,
    },
    dots: {
        position: "absolute",
        flexDirection: "row",
        justifyContent: "center",
        gap: 3,
    },
    stackEventChips: {
        position: "absolute",
        left: 0,
        right: 0,
        height: 49,
        overflow: "hidden",
    },
    stackEventChip: {
        position: "absolute",
        minWidth: 0,
        height: 16,
        paddingHorizontal: 3,
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
    },
    stackEventIcon: {
        width: 10,
        marginRight: 1,
    },
    stackEventTitle: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 9.5,
        lineHeight: 13,
        fontWeight: "700",
        letterSpacing: -0.1,
    },
    stackEventMore: {
        position: "absolute",
        top: 36,
        left: 2,
        right: 2,
        height: 13,
        paddingHorizontal: 3,
        fontSize: 9,
        lineHeight: 12,
        fontWeight: "700",
    },
    detailMarkers: {
        position: "absolute",
        top: 51,
        left: 2,
        right: 2,
        minHeight: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
    },
    detailMarkersWithHoliday: {
        top: 61,
    },
    detailDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    detailTravelMarker: {
        width: 8,
        height: 8,
    },
    detailEventMore: {
        flexShrink: 0,
        fontSize: 7,
        lineHeight: 8,
        fontWeight: "800",
        letterSpacing: -0.3,
    },
});

export default styles;
