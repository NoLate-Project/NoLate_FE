import { StyleSheet } from "react-native";

import type { QuickScheduleModalStylesOptions } from "../QuickScheduleModal.styles";

/** photo 영역의 정적 스타일을 생성합니다. */
export function createPhotoStyles(options: QuickScheduleModalStylesOptions) {
    const {
        BLUE,
    } = options;
    return StyleSheet.create({
        photoModeContent: {
        marginBottom: 14,
    },
        photoPreviewButton: {
        height: 154,
        backgroundColor: "#101620",
        borderRadius: 18,
        borderWidth: 1,
        overflow: "hidden",
    },
        photoPreviewRecovery: {
        height: 78,
    },
        photoImageStage: {
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1,
    },
        photoScanFrame: {
        alignSelf: "center",
        backgroundColor: "#070B13",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.16)",
    },
        photoScanFrameRecovery: {
        maxHeight: 76,
    },
        photoImage: {
        width: "100%",
        height: "100%",
    },
        photoEmptyPanel: {
        minHeight: 152,
        borderRadius: 15,
        borderWidth: 1,
        borderStyle: "dashed",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 22,
        paddingVertical: 12,
    },
        photoEmptyIcon: {
        width: 38,
        height: 24,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 6,
    },
        photoEmptyTitle: {
        fontSize: 15,
        lineHeight: 20,
        fontWeight: "800",
        textAlign: "center",
    },
        photoEmptyMeta: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "500",
        textAlign: "center",
    },
        photoEmptyAction: {
        minHeight: 44,
        minWidth: 104,
        marginTop: 9,
        borderRadius: 11,
        borderWidth: StyleSheet.hairlineWidth,
        justifyContent: "center",
        paddingHorizontal: 12,
        paddingVertical: 5,
    },
        photoEmptyActionText: {
        fontSize: 13,
        fontWeight: "700",
        textAlign: "center",
    },
        photoActionsRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 2,
        gap: 8,
    },
        photoChangeButton: {
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        flexShrink: 1,
        gap: 8,
        paddingHorizontal: 4,
    },
        photoChangeButtonText: {
        fontSize: 13,
        fontWeight: "700",
        flexShrink: 1,
    },
        photoRemoveButton: {
        width: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
    },
        photoTranscriptWrap: {
        minHeight: 128,
        marginTop: 12,
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 13,
        paddingTop: 12,
        paddingBottom: 12,
    },
        photoTranscriptHeader: {
        minHeight: 38,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
        photoTranscriptLabel: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "800",
    },
        photoReadingPlaceholder: {
        minHeight: 72,
        justifyContent: "center",
        gap: 9,
        marginTop: 10,
        paddingHorizontal: 3,
    },
        truncatedRecognitionText: {
        color: "#F59E0B",
    },
        photoReadingLine: {
        height: 8,
        borderRadius: 4,
        backgroundColor: "rgba(126,145,171,0.14)",
    },
        photoReadingLineLong: {
        width: "92%",
    },
        photoReadingLineMedium: {
        width: "72%",
    },
        photoReadingLineShort: {
        width: "46%",
    },
        photoTranscriptInputWrap: {
        gap: 4,
    },
        photoTranscriptInputLabel: {
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "800",
    },
        photoTranscriptInput: {
        minHeight: 54,
        maxHeight: 92,
        padding: 0,
        marginTop: 5,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "400",
        textAlignVertical: "top",
    },
        photoTranscriptInputLarge: {
        minHeight: 115,
        maxHeight: 190,
    },
        photoRecognitionErrorWrap: {
        marginTop: 10,
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 4,
        borderRadius: 13,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 11,
        paddingTop: 10,
        paddingBottom: 9,
    },
        photoRecognitionErrorTitle: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "800",
    },
        photoRecognitionErrorText: {
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
        photoRecognitionRetry: {
        minHeight: 44,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        marginTop: 4,
        paddingHorizontal: 12,
        backgroundColor: "rgba(36,107,254,0.12)",
    },
        photoRecognitionRetryText: {
        color: BLUE,
        fontSize: 12,
        fontWeight: "800",
    },
        lowConfidenceNotice: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 5,
        marginTop: 5,
        paddingTop: 7,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "rgba(245,158,11,0.32)",
    },
        lowConfidenceNoticeText: {
        flex: 1,
        color: "#D97706",
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "700",
    },
    });
}
