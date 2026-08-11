import { StyleSheet } from "react-native";

/** schedule-ui-preview 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    full: {
        flex: 1,
    },
    backdrop: {
        flex: 1,
        paddingHorizontal: 20,
    },
    previewLabel: {
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.2,
    },
    detailRoot: {
        flex: 1,
    },
    detailHeader: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
    },
    headerButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    headerActions: {
        marginLeft: "auto",
        flexDirection: "row",
        alignItems: "center",
    },
    headerTitle: {
        position: "absolute",
        left: 88,
        right: 88,
        bottom: 22,
        fontSize: 17,
        fontWeight: "700",
        textAlign: "center",
    },
});

export default styles;
