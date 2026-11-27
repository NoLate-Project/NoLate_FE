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
        paddingHorizontal: 16,
        paddingTop: 10,
        gap: 10,
    },
    selectedDayHeading: {
        minHeight: 32,
        paddingHorizontal: 18,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
    },
    selectedDayGroup: {
        overflow: "hidden",
    },
    selectedDayGroupDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 85,
        marginRight: 14,
    },
    agendaFilterBar: {
        minHeight: 48,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    agendaFilterNotice: {
        fontSize: 13,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    agendaFilterPill: {
        minWidth: 90,
        maxWidth: "100%",
        minHeight: 32,
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
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "600",
        letterSpacing: 0,
    },
    monthListContent: {
        paddingHorizontal: 16,
        paddingTop: 12,
        gap: 22,
    },
    stickyMonthListContent: { gap: 0 },
    compactMonthListContent: { paddingTop: 4 },
    stickySectionBody: { marginTop: 8 },
    compactSectionBody: { marginTop: 4 },
    stickySectionSpacing: { marginBottom: 22 },
    compactSectionSpacing: { marginBottom: 8 },
    stickySectionHeader: { borderBottomWidth: StyleSheet.hairlineWidth },
    section: {
        gap: 8,
    },
    unpositionedAgenda: {
        opacity: 0,
    },
    entryHighlight: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 6,
    },
    sectionHeader: {
        minHeight: 29,
        paddingHorizontal: 1,
        paddingBottom: 5,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 9,
    },
    sectionHeading: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "baseline",
        columnGap: 8,
    },
    sectionTitle: {
        flexShrink: 0,
        fontSize: 17,
        lineHeight: 23,
        fontWeight: "700",
        letterSpacing: 0,
    },
    sectionWeekday: {
        flexShrink: 0,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "500",
        letterSpacing: 0,
    },
    continuedSelection: {
        flexShrink: 1,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
    sectionCount: {
        flexShrink: 0,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "500",
        letterSpacing: 0,
    },
    emptyDayMessage: { fontSize: 14, lineHeight: 21, paddingHorizontal: 8, paddingVertical: 14 },
    emptyState: {
        minHeight: 84,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 20,
    },
    loadingState: {
        alignItems: "flex-start",
        justifyContent: "flex-start",
        paddingTop: 4,
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
