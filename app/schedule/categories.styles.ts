import { StyleSheet } from "react-native";

/** categories 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        minHeight: 60,
        paddingHorizontal: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    headerButtonGhost: {
        width: 44,
        height: 44,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "800",
        letterSpacing: 0,
    },
    content: {
        paddingHorizontal: 20,
        gap: 16,
    },
    card: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 16,
        gap: 12,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: "800",
        letterSpacing: 0,
    },
    input: {
        height: 46,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 13,
        fontSize: 15,
        fontWeight: "600",
        letterSpacing: 0,
    },
    colorRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
    },
    colorButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
    },
    colorSwatch: {
        width: 28,
        height: 28,
        borderRadius: 14,
    },
    disabledControl: {
        opacity: 0.4,
    },
    primaryButton: {
        height: 46,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    primaryButtonText: {
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0,
    },
    listHeader: {
        minHeight: 28,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    categoryCard: {
        borderWidth: 1,
        borderRadius: 16,
        overflow: "hidden",
    },
    categoryRow: {
        minHeight: 62,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    categoryInfo: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    categoryDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
    },
    categoryTitle: {
        flex: 1,
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: 0,
    },
    categoryTitleWrap: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    categoryTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    categoryAssist: {
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 0,
    },
    sharedBadge: {
        height: 24,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    sharedBadgeText: {
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 0,
    },
    rowActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
    },
    iconAction: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    editBody: {
        padding: 14,
        gap: 12,
    },
    editActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    secondaryButton: {
        flex: 1,
        height: 42,
        borderWidth: 1,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    secondaryButtonText: {
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0,
    },
    editSaveButton: {
        flex: 1,
        height: 42,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    emptyCard: {
        minHeight: 132,
        borderWidth: 1,
        borderRadius: 16,
        padding: 20,
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
    },
    emptyTitle: {
        fontSize: 15,
        fontWeight: "800",
    },
    emptyCaption: {
        fontSize: 12,
        fontWeight: "600",
        textAlign: "center",
    },
});

export default styles;
