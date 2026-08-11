import { StyleSheet } from "react-native";

/** TmapMapView 화면의 정적 시각 규칙입니다. 화면 로직과 독립적으로 조정할 수 있도록 분리했습니다. */
const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    webview: {
        flex: 1,
        backgroundColor: "transparent",
    },
    fallback: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
    },
    fallbackText: {
        textAlign: "center",
        fontSize: 12,
        lineHeight: 18,
    },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    loadingText: {
        fontSize: 12,
        lineHeight: 18,
        fontWeight: "700",
    },
    errorOverlay: {
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 12,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: "rgba(17, 24, 39, 0.86)",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    errorOverlayCopy: {
        flex: 1,
        minWidth: 0,
    },
    errorOverlayTitle: {
        color: "#FFFFFF",
        fontWeight: "700",
        fontSize: 12,
        marginBottom: 4,
    },
    errorOverlayText: {
        color: "rgba(255, 255, 255, 0.88)",
        fontSize: 11,
        lineHeight: 15,
    },
    errorRetryButton: {
        minHeight: 36,
        borderRadius: 9,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#2979FF",
    },
    errorRetryText: {
        color: "#FFFFFF",
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
    },
});

export default styles;
