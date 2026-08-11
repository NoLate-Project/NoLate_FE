import { StyleSheet } from "react-native";

import type { QuickScheduleModalStylesOptions } from "../QuickScheduleModal.styles";

/** shellInput 영역의 정적 스타일을 생성합니다. */
export function createShellInputStyles(options: QuickScheduleModalStylesOptions) {
    const {
        EXPANDED_CARD_RADIUS,
    } = options;
    return StyleSheet.create({
        screen: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 80,
        elevation: 80,
    },
        screenContent: {
        flex: 1,
    },
        backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
        cardMotion: {
        position: "absolute",
        transformOrigin: [0, 0, 0],
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.16,
        shadowRadius: 22,
        elevation: 16,
    },
        cardClip: {
        width: "100%",
        height: "100%",
        borderRadius: EXPANDED_CARD_RADIUS,
        overflow: "hidden",
    },
        card: {
        width: "100%",
        height: "100%",
        borderWidth: 1,
        zIndex: 1,
    },
        content: {
        flex: 1,
        transformOrigin: [0, 0, 0],
        paddingHorizontal: 18,
        paddingTop: 24,
        paddingBottom: 15,
    },
        closeButton: {
        position: "absolute",
        top: 16,
        right: 16,
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
    },
        closeButtonPressable: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
    },
        handoffBody: {
        flex: 1,
    },
        inputStep: {
        flex: 1,
        minHeight: 0,
    },
        inputStepScroll: {
        flex: 1,
        minHeight: 0,
    },
        inputStepScrollContent: {
        paddingBottom: 10,
    },
        contentRevealCurtain: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
    },
        backButton: {
        position: "absolute",
        left: 0,
        top: -4,
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2,
    },
        header: {
        alignItems: "flex-start",
        paddingRight: 42,
        marginBottom: 16,
    },
        headerCentered: {
        alignItems: "center",
        paddingHorizontal: 36,
    },
        flowHeader: {
        marginBottom: 12,
    },
        title: {
        fontSize: 20,
        lineHeight: 25,
        fontWeight: "800",
        letterSpacing: -0.3,
    },
        flowHeaderTitle: {
        fontSize: 19,
        lineHeight: 24,
        fontWeight: "700",
        letterSpacing: -0.2,
    },
        headerDescription: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "500",
    },
        modeSelector: {
        height: 44,
        borderRadius: 13,
        borderWidth: 1,
        alignSelf: "stretch",
        flexDirection: "row",
        padding: 3,
        marginBottom: 16,
        overflow: "hidden",
    },
        modeSelectorIndicator: {
        position: "absolute",
        top: 3,
        bottom: 3,
        left: 0,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
    },
        modeButton: {
        flex: 1,
        minWidth: 0,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: 8,
        zIndex: 1,
    },
        modeButtonSelected: {
        shadowColor: "transparent",
    },
        modeText: {
        fontSize: 13,
        fontWeight: "700",
    },
        textModeContent: {
        marginBottom: 16,
    },
        sectionHeader: {
        marginBottom: 9,
    },
        sectionTitle: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "800",
    },
        sectionDescription: {
        marginTop: 2,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "500",
    },
        inputWrap: {
        minHeight: 142,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingTop: 13,
        paddingBottom: 29,
    },
        input: {
        flex: 1,
        minHeight: 96,
        fontSize: 15,
        lineHeight: 22,
        fontWeight: "400",
        textAlignVertical: "top",
        padding: 0,
    },
        counterPill: {
        position: "absolute",
        right: 14,
        bottom: 10,
    },
        counter: {
        fontSize: 11,
        fontWeight: "600",
    },
    });
}
