import { StyleSheet } from "react-native";

import type { QuickScheduleModalStylesOptions } from "../QuickScheduleModal.styles";

/** actions 영역의 정적 스타일을 생성합니다. */
export function createActionsStyles(options: QuickScheduleModalStylesOptions) {
    const {
        BLUE,
    } = options;
    return StyleSheet.create({
        editButtons: {
        flexDirection: "row",
        gap: 8,
    },
        editSecondaryButton: {
        height: 46,
        borderRadius: 14,
    },
        editPrimaryButton: {
        height: 46,
        borderRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 3,
    },
        savedSummary: {
        alignSelf: "stretch",
        borderRadius: 18,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 5,
        marginVertical: 4,
    },
        savedTitle: {
        fontSize: 15,
        fontWeight: "900",
    },
        savedMeta: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
    },
        savedButtonStack: {
        alignSelf: "stretch",
        gap: 8,
        marginTop: 18,
    },
        submitButton: {
        height: 50,
        borderRadius: 13,
        backgroundColor: BLUE,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
    },
        submitText: {
        color: "#fff",
        fontSize: 15,
        fontWeight: "800",
    },
    });
}
