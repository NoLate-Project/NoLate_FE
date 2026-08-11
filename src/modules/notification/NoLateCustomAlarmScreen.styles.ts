import { StyleSheet } from "react-native";

export const BACKGROUND = "#0C203B";
const SURFACE = "rgba(255,255,255,0.11)";
const ACCENT = "#FFFFFF";
export const TEXT_PRIMARY = "#F8FAFF";
export const TEXT_SECONDARY = "#B8C8DE";
export const PRIMARY_BUTTON_FOREGROUND = "#12345A";

/** NoLateCustomAlarmScreen 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: BACKGROUND,
        overflow: "hidden",
    },
    atmosphere: {
        ...StyleSheet.absoluteFillObject,
        experimental_backgroundImage:
            "linear-gradient(180deg, #173A67 0%, #102B4F 38%, #0C203B 68%, #08182C 100%)",
    },
    contentWidth: {
        width: "100%",
        maxWidth: 560,
        flex: 1,
        alignSelf: "center",
        paddingHorizontal: 24,
    },
    topBar: {
        minHeight: 54,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
    },
    iconButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: SURFACE,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.18)",
    },
    contentScroll: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: 24,
        paddingBottom: 36,
    },
    logo: {
        width: 92,
        height: 92,
        borderRadius: 26,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.44)",
        shadowColor: "#6BB5FF",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.28,
        shadowRadius: 24,
        elevation: 8,
    },
    clockRow: {
        marginTop: 34,
        alignItems: "center",
        width: "100%",
    },
    period: {
        color: TEXT_SECONDARY,
        fontSize: 16,
        lineHeight: 22,
        fontWeight: "700",
    },
    currentTime: {
        marginTop: 1,
        color: TEXT_PRIMARY,
        fontSize: 76,
        lineHeight: 84,
        fontWeight: "700",
        letterSpacing: -3.5,
        textAlign: "center",
        fontVariant: ["tabular-nums"],
    },
    headingBlock: {
        marginTop: 22,
        alignItems: "center",
        paddingHorizontal: 12,
    },
    title: {
        color: TEXT_PRIMARY,
        fontSize: 28,
        lineHeight: 36,
        fontWeight: "800",
        letterSpacing: -0.75,
        textAlign: "center",
    },
    errorRow: {
        width: "100%",
        maxWidth: 480,
        minHeight: 42,
        marginTop: 14,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: "rgba(7,19,37,0.48)",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.13)",
    },
    errorText: {
        flex: 1,
        color: "#DCE6F4",
        fontSize: 12,
        lineHeight: 18,
        fontWeight: "600",
    },
    actions: {
        paddingTop: 16,
        gap: 10,
        backgroundColor: "transparent",
    },
    departButton: {
        minHeight: 64,
        borderRadius: 20,
        backgroundColor: ACCENT,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 16,
    },
    primaryButtonText: {
        color: PRIMARY_BUTTON_FOREGROUND,
        fontSize: 17,
        lineHeight: 23,
        fontWeight: "800",
    },
    secondaryActions: {
        flexDirection: "row",
        gap: 10,
    },
    secondaryButton: {
        flex: 1,
        minHeight: 58,
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.18)",
        backgroundColor: SURFACE,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingHorizontal: 12,
    },
    secondaryButtonWide: {
        flex: 1,
    },
    secondaryButtonText: {
        color: TEXT_PRIMARY,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "700",
        textAlign: "center",
    },
    requestedActionButton: {
        borderWidth: 1.5,
        borderColor: "#8BBEFF",
    },
    closeButton: {
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
    },
    closeButtonText: {
        color: TEXT_SECONDARY,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "600",
    },
    pressed: {
        opacity: 0.68,
    },
    disabled: {
        opacity: 0.42,
    },
});

export default styles;
