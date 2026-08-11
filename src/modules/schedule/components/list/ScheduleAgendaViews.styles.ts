import { StyleSheet } from "react-native";

/** ScheduleAgendaViews 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    agendaPanelSurface: {
        flex: 1,
        minHeight: 0,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        overflow: "hidden",
    },
    panelGestureHandle: {
        flexShrink: 0,
    },
    panelHandleHitArea: {
        width: "100%",
        height: 28,
        alignItems: "center",
        justifyContent: "center",
    },
    panelHandle: {
        width: 32,
        height: 4,
        borderRadius: 2,
    },
    panelHandleDark: {
        backgroundColor: "rgba(235,235,245,0.28)",
    },
    panelHandleLight: {
        backgroundColor: "rgba(60,60,67,0.24)",
    },
    scroll: {
        flex: 1,
        minHeight: 0,
    },
    floatingBarContentEnd: {
        paddingBottom: 24,
    },
    selectedDayContent: {
        paddingHorizontal: 14,
        paddingTop: 6,
        gap: 10,
    },
    selectedDayGroup: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 9,
        overflow: "hidden",
    },
    selectedDayGroupDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 18,
        marginRight: 12,
    },
    agendaFilterBar: {
        height: 44,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    agendaFilterPill: {
        minWidth: 90,
        maxWidth: 190,
        height: 30,
        paddingHorizontal: 11,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 15,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    agendaFilterPillDark: {
        backgroundColor: "rgba(255,255,255,0.055)",
    },
    agendaFilterPillLight: {
        backgroundColor: "rgba(0,0,0,0.035)",
    },
    agendaFilterText: {
        flexShrink: 1,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "700",
        letterSpacing: 0,
    },
    monthListContent: {
        paddingHorizontal: 14,
        paddingTop: 7,
        gap: 13,
    },
    routeSetupNotice: {
        minHeight: 38,
        paddingHorizontal: 9,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    routeSetupNoticeIcon: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,159,10,0.14)",
    },
    routeSetupNoticeTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    routeSetupNoticeAction: {
        flexShrink: 0,
        fontSize: 11.5,
        lineHeight: 16,
        fontWeight: "800",
        letterSpacing: 0,
        color: "#FF9F0A",
    },
    section: {
        gap: 4,
    },
    sectionHeader: {
        minHeight: 29,
        paddingHorizontal: 1,
        paddingBottom: 5,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 9,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sectionHeading: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "baseline",
        gap: 8,
    },
    sectionTitle: {
        flexShrink: 0,
        fontSize: 12.5,
        lineHeight: 17,
        fontWeight: "800",
        letterSpacing: 0,
    },
    sectionWeekday: {
        flex: 1,
        minWidth: 0,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
        letterSpacing: 0,
    },
    sectionCount: {
        flexShrink: 0,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sectionCards: {
        gap: 3,
    },
    emptyState: {
        minHeight: 84,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 20,
    },
    emptyText: {
        textAlign: "center",
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "700",
        letterSpacing: 0,
    },
});

export default styles;
