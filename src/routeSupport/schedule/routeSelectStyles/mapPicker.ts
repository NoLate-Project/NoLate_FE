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
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        zIndex: 5,
    },
    mapPickerIconButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    mapPickerBackText: {
        fontSize: 34,
        fontWeight: "700",
        lineHeight: 38,
        marginTop: -2,
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
    mapPickerTitle: {
        fontSize: 16,
        fontWeight: "900",
        letterSpacing: 0,
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
    mapPickerInstruction: {
        fontSize: 18,
        fontWeight: "900",
        letterSpacing: 0,
    },
    mapPickerAddressRow: {
        minHeight: 42,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 9,
    },
    mapPickerAddressText: {
        flex: 1,
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 18,
        letterSpacing: 0,
    },
} as const;

export default mapPickerStyles;
