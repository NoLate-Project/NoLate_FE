import { StyleSheet } from "react-native";

/** profile 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        minHeight: 64,
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "900",
    },
    backGlass: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
    },
    backButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    headerSpacer: {
        width: 44,
        height: 44,
    },
    content: {
        paddingHorizontal: 18,
        paddingTop: 12,
        gap: 22,
    },
    profileCard: {
        minHeight: 118,
        borderWidth: 1,
        borderRadius: 22,
        paddingHorizontal: 22,
        flexDirection: "row",
        alignItems: "center",
        gap: 18,
    },
    avatar: {
        width: 74,
        height: 74,
        borderRadius: 37,
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
    },
    avatarDark: {
        backgroundColor: "rgba(255,255,255,0.90)",
    },
    avatarLight: {
        backgroundColor: "rgba(0,0,0,0.88)",
    },
    avatarText: {
        fontSize: 28,
        fontWeight: "900",
    },
    avatarTextDark: {
        color: "#000000",
    },
    avatarTextLight: {
        color: "#ffffff",
    },
    profileCardText: {
        flex: 1,
        minWidth: 0,
        gap: 5,
    },
    profileName: {
        fontSize: 22,
        fontWeight: "900",
    },
    profileMeta: {
        fontSize: 13,
        fontWeight: "800",
    },
    profileErrorCard: {
        minHeight: 68,
        borderWidth: 1,
        borderRadius: 18,
        paddingHorizontal: 15,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    profileErrorTextWrap: { flex: 1, minWidth: 0 },
    profileErrorTitle: { fontSize: 13, fontWeight: "900" },
    profileErrorCaption: { marginTop: 3, fontSize: 11, fontWeight: "600", lineHeight: 16 },
    profileErrorRetry: { fontSize: 12, fontWeight: "900" },
    modalRoot: {
        flex: 1,
        justifyContent: "flex-end",
    },
    modalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.48)",
    },
    editSheetScroll: {
        maxHeight: "92%",
        borderTopWidth: 1,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
    },
    editSheetScrollContent: {
        paddingHorizontal: 22,
        paddingTop: 22,
        paddingBottom: 34,
    },
    editSheetHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
    },
    destructiveHeaderText: { flex: 1, minWidth: 0 },
    editSheetTitle: {
        fontSize: 21,
        fontWeight: "900",
    },
    editSheetCaption: {
        marginTop: 4,
        fontSize: 12,
        fontWeight: "700",
    },
    modalCloseButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: "center",
        justifyContent: "center",
    },
    inputLabel: {
        marginTop: 22,
        marginBottom: 8,
        fontSize: 12,
        fontWeight: "900",
    },
    nameInput: {
        height: 52,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 15,
        fontSize: 16,
        fontWeight: "800",
    },
    inputCounter: {
        marginTop: 6,
        textAlign: "right",
        fontSize: 11,
        fontWeight: "700",
    },
    saveButton: {
        height: 52,
        marginTop: 18,
        borderRadius: 15,
        backgroundColor: "#2563eb",
        alignItems: "center",
        justifyContent: "center",
    },
    saveButtonText: {
        color: "#ffffff",
        fontSize: 16,
        fontWeight: "900",
    },
    destructiveButton: {
        height: 52,
        marginTop: 20,
        borderRadius: 15,
        backgroundColor: "#DC2626",
        alignItems: "center",
        justifyContent: "center",
    },
    section: {
        gap: 8,
    },
    sectionTitle: {
        paddingHorizontal: 2,
        fontSize: 12,
        fontWeight: "900",
    },
    accountCard: {
        borderWidth: 1,
        borderRadius: 18,
        paddingHorizontal: 16,
    },
    accountRow: {
        minHeight: 58,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    accountRowDivider: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    accountRowLast: {
        borderBottomWidth: 0,
    },
    accountLabel: {
        fontSize: 11,
        fontWeight: "800",
    },
    accountValue: {
        marginTop: 4,
        fontSize: 15,
        fontWeight: "900",
        lineHeight: 20,
    },
    accountRowMain: {
        flex: 1,
        minWidth: 0,
    },
    accountRowAction: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    accountActionLabel: {
        fontSize: 12,
        fontWeight: "800",
    },
    usageCard: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 16,
    },
    usageHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
    },
    naverBadge: {
        width: 34,
        height: 34,
        borderRadius: 8,
        backgroundColor: "#03A94D",
        alignItems: "center",
        justifyContent: "center",
    },
    naverBadgeText: {
        color: "#FFFFFF",
        fontSize: 18,
        fontWeight: "900",
    },
    usageHeaderText: {
        flex: 1,
        gap: 2,
    },
    usageTitle: {
        fontSize: 14,
        fontWeight: "900",
    },
    usageHint: {
        fontSize: 11,
        fontWeight: "700",
    },
    usageDivider: {
        height: StyleSheet.hairlineWidth,
        marginVertical: 14,
    },
    usageItemTitle: {
        fontSize: 14,
        fontWeight: "900",
    },
    usageItemBody: {
        marginTop: 3,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
    },
    usageItemSpacing: {
        marginTop: 13,
    },
    settingsCard: {
        borderWidth: 1,
        borderRadius: 18,
        minHeight: 72,
        paddingHorizontal: 16,
        paddingVertical: 14,
        alignItems: "stretch",
        gap: 12,
    },
    settingsList: {
        gap: 10,
    },
    legalCard: {
        borderWidth: 1,
        borderRadius: 18,
    },
    legalButton: {
        minHeight: 72,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
    },
    appSettingRowContent: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    appSettingIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    calendarConnectionCard: {
        borderWidth: 1,
        borderRadius: 18,
        overflow: "hidden",
    },
    calendarConnectionContent: {
        padding: 16,
        gap: 13,
    },
    calendarConnectionHeader: {
        minHeight: 46,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    calendarConnectionIcon: {
        width: 38,
        height: 38,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#111111",
    },
    calendarConnectionTitleWrap: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    calendarConnectionTitle: {
        fontSize: 15,
        fontWeight: "900",
    },
    calendarConnectionHint: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
    },
    connectedBadge: {
        borderRadius: 12,
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: "rgba(34,197,94,0.14)",
    },
    connectedBadgeText: {
        color: "#22c55e",
        fontSize: 11,
        fontWeight: "900",
    },
    calendarStats: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 12,
        flexDirection: "row",
        gap: 10,
    },
    calendarStatItem: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    calendarStatValue: {
        fontSize: 15,
        fontWeight: "900",
    },
    calendarStatLabel: {
        fontSize: 11,
        fontWeight: "800",
    },
    syncedCalendarList: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 7,
    },
    syncedCalendarPill: {
        maxWidth: "100%",
        minHeight: 30,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    syncedCalendarPillText: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 12,
        fontWeight: "800",
    },
    calendarConnectionFooter: {
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "700",
    },
    calendarManageButton: {
        minHeight: 46,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    calendarManageButtonText: {
        flex: 1,
        fontSize: 14,
        fontWeight: "800",
    },
    calendarEmptyButton: {
        minHeight: 78,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    settingTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    settingTitle: {
        fontSize: 16,
        fontWeight: "900",
    },
    settingHint: {
        marginTop: 4,
        fontSize: 12,
        fontWeight: "700",
    },
    settingSwitchWrap: {
        width: "100%",
        minHeight: 48,
        justifyContent: "center",
    },
    settingSwitch: {
        width: "100%",
    },
    signOutButton: {
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    signOutGlass: {
        borderWidth: 1,
        borderRadius: 18,
    },
    signOutText: {
        color: "#ef4444",
        fontSize: 15,
        fontWeight: "900",
    },
    withdrawGlass: {
        borderWidth: 1,
        borderRadius: 18,
        marginTop: -12,
    },
    withdrawText: {
        fontSize: 14,
        fontWeight: "800",
    },
});

export default styles;
