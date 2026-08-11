import { StyleSheet } from "react-native";

import type { QuickScheduleModalStylesOptions } from "../QuickScheduleModal.styles";

/** edit 영역의 정적 스타일을 생성합니다. */
export function createEditStyles(options: QuickScheduleModalStylesOptions) {
    void options;
    return StyleSheet.create({
        editStep: {
        flex: 1,
        justifyContent: "space-between",
        gap: 12,
    },
        editInput: {
        minHeight: 88,
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
        lineHeight: 22,
        fontWeight: "600",
        textAlignVertical: "top",
    },
        editInputMemo: {
        minHeight: 132,
    },
        locationEditInput: {
        minHeight: 54,
        textAlignVertical: "center",
    },
        routeEditPanel: {
        flex: 1,
        justifyContent: "flex-start",
        paddingTop: 2,
    },
        routeEditNotice: {
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        routeEditNoticeText: {
        flex: 1,
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: "600",
    },
        pickerPanel: {
        borderRadius: 16,
        borderWidth: 1,
        overflow: "hidden",
        paddingBottom: 10,
    },
        editSegmented: {
        height: 36,
        borderRadius: 9,
        padding: 3,
        flexDirection: "row",
        gap: 3,
    },
        editSegment: {
        flex: 1,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
    },
        editSegmentText: {
        fontSize: 12,
        fontWeight: "600",
    },
        dateTimePicker: {
        alignSelf: "stretch",
        height: 180,
    },
        aiHint: {
        marginHorizontal: 12,
        minHeight: 34,
        borderRadius: 12,
        paddingHorizontal: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
        aiHintText: {
        flex: 1,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
    });
}
