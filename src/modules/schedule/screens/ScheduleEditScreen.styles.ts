import { StyleSheet } from "react-native";

/** ScheduleEditScreen 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    editRoot: {
        flex: 1,
    },
    editLoadingRoot: {
        flex: 1,
    },
    editErrorRoot: {
        flex: 1,
        padding: 20,
    },
    editBody: {
        flex: 1,
    },
    topHeader: {
        paddingHorizontal: 20,
        zIndex: 2,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingBottom: 36,
    },
    pageContent: {
        width: "100%",
        maxWidth: 560,
        alignSelf: "center",
    },
    formPageContent: {
        paddingTop: 6,
    },
    categoryDismissLayer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },
    categorySection: {
        position: "relative",
        zIndex: 2,
    },
    navigationHeader: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
    },
    navigationBackButton: {
        width: 44,
        height: 44,
        marginLeft: -12,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    navigationTitle: {
        flex: 1,
        minWidth: 0,
        fontSize: 18,
        lineHeight: 24,
        fontWeight: "700",
    },
    navigationSaveButton: {
        width: 64,
        height: 44,
        marginRight: -8,
        alignItems: "flex-end",
        justifyContent: "center",
    },
    navigationSaveText: {
        fontSize: 15,
        lineHeight: 20,
        fontWeight: "700",
    },
    label:        { marginBottom: 6, fontSize: 12, lineHeight: 17, fontWeight: "600" },
    dateTimeCard: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        marginBottom: 14,
        overflow: "hidden",
    },
    dateTimeToggleRow: {
        minHeight: 48,
        paddingHorizontal: 13,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    dateTimeValueRow: {
        minHeight: 58,
        paddingLeft: 4,
        paddingRight: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    dateTimeDateAction: {
        flex: 1,
        minWidth: 0,
        minHeight: 50,
        borderRadius: 12,
        paddingHorizontal: 9,
        paddingVertical: 8,
        justifyContent: "center",
    },
    dateTimeRowTitle: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "600",
    },
    dateTimeDateText: {
        marginTop: 2,
        fontSize: 11.5,
        lineHeight: 16,
        fontWeight: "600",
    },
    dateTimeClockAction: {
        minHeight: 44,
        borderRadius: 12,
        paddingHorizontal: 7,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 3,
    },
    dateTimeClockText: {
        fontSize: 15,
        lineHeight: 20,
        fontWeight: "600",
        fontVariant: ["tabular-nums"],
    },
    dateTimeEndClockAction: {
        paddingHorizontal: 4,
    },
    dateTimeEndControls: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    dateTimeDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 13,
    },
    toggleSwitch: {
        alignSelf: "center",
        transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }],
    },
    input: {
        borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12, marginBottom: 14,
    },
    notesInput: {
        minHeight: 76,
        fontSize: 15,
        lineHeight: 21,
        fontWeight: "400",
        textAlignVertical: "top",
    },
    titleInputWrap: {
        minHeight: 44,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        paddingLeft: 12,
        paddingRight: 8,
        marginBottom: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    titleInput: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 11,
        fontSize: 16,
        lineHeight: 22,
        fontWeight: "600",
    },
    categoryInlineChip: {
        maxWidth: 128,
        minHeight: 34,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    categoryInlineDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    categoryInlineText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: "600",
    },
    categoryInlineChevron: {
        width: 13,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    pickerContainer: {
        borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden",
    },
    deleteAction: {
        minHeight: 48,
        marginTop: 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
    },
    deleteActionText: {
        color: "#D9393E",
        fontSize: 14,
        fontWeight: "700",
    },
});

export default styles;
