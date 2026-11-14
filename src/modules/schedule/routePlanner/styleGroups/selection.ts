import { StyleSheet } from "react-native";

/** 경로 계획 화면의 selection 영역 정적 스타일을 생성합니다. */
export function createSelectionStyles() {
    return {
        permissionOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 80,
        elevation: 80,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
    },
        permissionBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.24)",
    },
        permissionPrompt: {
        width: "100%",
        maxWidth: 390,
        borderWidth: 1,
        borderRadius: 30,
        paddingHorizontal: 22,
        paddingTop: 22,
        paddingBottom: 18,
    },
        permissionIconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(33,184,90,0.14)",
        marginBottom: 16,
    },
        permissionTitle: {
        fontSize: 23,
        lineHeight: 29,
        fontWeight: "900",
        letterSpacing: 0,
    },
        permissionBody: {
        marginTop: 10,
        fontSize: 15,
        lineHeight: 22,
        fontWeight: "600",
    },
        permissionActions: {
        marginTop: 22,
        flexDirection: "row",
        gap: 10,
    },
        permissionSecondaryButton: {
        flex: 1,
        height: 52,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.08)",
    },
        permissionPrimaryButton: {
        flex: 1,
        height: 52,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
        permissionSecondaryText: {
        fontSize: 16,
        fontWeight: "800",
    },
        permissionPrimaryText: {
        fontSize: 16,
        fontWeight: "900",
    },
        zoomOverlay: {
        position: "absolute",
        right: 12,
        top: "46%",
        zIndex: 20,
    },
        zoomControlCard: {
        borderWidth: 1,
        borderRadius: 12,
        overflow: "hidden",
    },
        zoomControlBtn: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
        zoomControlText: {
        fontSize: 26,
        fontWeight: "700",
        lineHeight: 30,
        marginTop: -2,
    },
        zoomDivider: {
        height: StyleSheet.hairlineWidth,
        width: "100%",
    },
    } as const;
}
