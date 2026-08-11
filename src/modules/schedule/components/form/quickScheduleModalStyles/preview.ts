import { StyleSheet } from "react-native";

import type { QuickScheduleModalStylesOptions } from "../QuickScheduleModal.styles";

/** preview 영역의 정적 스타일을 생성합니다. */
export function createPreviewStyles(options: QuickScheduleModalStylesOptions) {
    const {
        BLUE,
    } = options;
    return StyleSheet.create({
        previewStep: {
        flex: 1,
        minHeight: 0,
    },
        previewScroll: {
        flex: 1,
        minHeight: 0,
    },
        previewScrollContent: {
        paddingBottom: 4,
    },
        previewSourceStrip: {
        minHeight: 46,
        borderBottomWidth: StyleSheet.hairlineWidth,
        justifyContent: "center",
        paddingHorizontal: 2,
        paddingVertical: 5,
    },
        previewSourceCopy: {
        flex: 1,
        minWidth: 0,
    },
        previewSourceLabel: {
        marginBottom: 3,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "500",
    },
        previewSourceValue: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "500",
    },
        previewTitleRow: {
        minHeight: 54,
        justifyContent: "center",
        paddingHorizontal: 2,
    },
        previewLabel: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "500",
        marginBottom: 2,
    },
        previewTitleValueRow: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexWrap: "nowrap",
    },
        previewTitleMetaRow: {
        minHeight: 17,
        marginBottom: 2,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
        previewTitleMetaLabel: {
        marginBottom: 0,
    },
        previewTitleControlRow: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        previewTitleAction: {
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        justifyContent: "center",
    },
        previewCategoryInlineChip: {
        maxWidth: 128,
        minHeight: 34,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
    },
        previewCategoryInlineDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        flexShrink: 0,
    },
        previewCategoryInlineText: {
        maxWidth: 72,
        flexShrink: 1,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "600",
    },
        previewCategoryInlineChevron: {
        width: 13,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
    },
        previewTitleValue: {
        flex: 1,
        minWidth: 0,
        fontSize: 18,
        lineHeight: 23,
        fontWeight: "700",
        letterSpacing: -0.35,
    },
        previewInfoRow: {
        minHeight: 54,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 2,
        paddingVertical: 6,
    },
        previewPlaceRow: {
        borderTopWidth: StyleSheet.hairlineWidth,
    },
        previewInfoIcon: {
        width: 26,
        height: 26,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
        previewInfoCopy: {
        flex: 1,
        minWidth: 0,
    },
        previewDateTimeValue: {
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        columnGap: 4,
    },
        previewDateTimeValueStacked: {
        minHeight: 64,
        flexDirection: "column",
        alignItems: "flex-start",
        flexWrap: "nowrap",
        rowGap: 0,
    },
        previewInlineField: {
        minHeight: 44,
        flexShrink: 1,
        justifyContent: "center",
    },
        previewInlineFieldStacked: {
        minHeight: 32,
    },
        previewInlineContent: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 5,
    },
        previewInlineValue: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "600",
        flexShrink: 1,
    },
        previewDateTimeSeparator: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "600",
    },
        previewInfoValueRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
    },
        previewInfoValue: {
        fontSize: 14.5,
        lineHeight: 20,
        fontWeight: "600",
        flexShrink: 1,
    },
        previewOptional: {
        minHeight: 92,
        marginHorizontal: 2,
        marginTop: 2,
        paddingTop: 2,
        borderTopWidth: StyleSheet.hairlineWidth,
        flexDirection: "column",
        alignItems: "stretch",
    },
        previewOptionalItem: {
        width: "100%",
        minWidth: 0,
        minHeight: 44,
        paddingVertical: 5,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
        previewOptionalItemTrailing: {
        minHeight: 48,
    },
        previewOptionalDivider: {
        width: "100%",
        height: StyleSheet.hairlineWidth,
    },
        previewOptionalCopy: {
        flex: 1,
        minWidth: 0,
    },
        previewOptionalValueRow: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 5,
    },
        previewOptionalValue: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "600",
        flexShrink: 1,
    },
        warningBadge: {
        borderRadius: 7,
        paddingHorizontal: 6,
        paddingVertical: 2.5,
    },
        warningBadgeText: {
        fontSize: 9.5,
        fontWeight: "900",
    },
        previewButtons: {
        paddingTop: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
        previewSecondaryButton: {
        flex: 1,
        height: 46,
        borderRadius: 14,
    },
        previewPrimaryButton: {
        flex: 1.22,
        height: 46,
        borderRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 3,
    },
        previewPrimaryButtonText: {
        fontWeight: "700",
    },
        secondaryButton: {
        flex: 1,
        height: 44,
        borderRadius: 15,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
        secondaryButtonText: {
        fontSize: 14,
        fontWeight: "700",
    },
        primaryButton: {
        flex: 1.22,
        height: 44,
        borderRadius: 15,
        backgroundColor: BLUE,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: BLUE,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 18,
    },
        primaryButtonText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "700",
    },
    });
}
