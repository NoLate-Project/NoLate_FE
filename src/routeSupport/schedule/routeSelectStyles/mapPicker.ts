import { StyleSheet } from "react-native";

/** 경로 선택 화면의 mapPicker 영역 정적 스타일입니다. */
const mapPickerStyles = {
    mapPickerRoot: {
        flex: 1,
    },
    mapPickerMap: {
        ...StyleSheet.absoluteFillObject,
    },
    mapPickerHeader: {
        position: "absolute",
        left: 16,
        right: 16,
        top: 0,
        gap: 8,
        zIndex: 5,
    },
    mapPickerHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    mapPickerIconButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    mapPickerTitleBox: {
        flex: 1,
        minHeight: 48,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 14,
    },
    mapPickerBottomSheet: {
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 12,
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        paddingTop: 18,
        paddingHorizontal: 16,
        gap: 13,
        zIndex: 5,
    },
    mapPickerStageTitle: {
        fontSize: 16,
        fontWeight: "700",
        textAlign: "center",
        paddingVertical: 6,
    },
    mapPickerOriginPill: {
        alignSelf: "flex-start",
        maxWidth: "82%",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    mapPickerOriginText: {
        flexShrink: 1,
        fontSize: 13,
        fontWeight: "600",
    },
    mapPickerConfirmationSheet: {
        paddingTop: 12,
        gap: 8,
    },
    mapPickerPlace: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    mapPickerPlaceCopy: { flex: 1 },
    mapPickerPlaceDetails: { gap: 3 },
    mapPickerPlaceTitle: { fontSize: 16, fontWeight: "700" },
    mapPickerPlaceAddress: { fontSize: 13, fontWeight: "500" },
    mapPickerConfirm: {
        minHeight: 48,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 8,
        paddingHorizontal: 14,
    },
    mapPickerConfirmText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
} as const;

export default mapPickerStyles;
