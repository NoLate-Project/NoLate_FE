import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { RoutePointTarget } from "../../routePointSelection";

type MapPickerTargetActionsProps = {
    disabled: boolean;
    onConfirm: (target: RoutePointTarget) => void;
    colors: {
        surface2: string;
        border: string;
        textPrimary: string;
        textDisabled: string;
        accentGreen: string;
        accentRed: string;
    };
};

export default function MapPickerTargetActions({
    disabled,
    onConfirm,
    colors,
}: MapPickerTargetActionsProps) {
    const renderAction = (
        target: RoutePointTarget,
        pinLabel: string,
        buttonLabel: string,
        markerColor: string,
        accessibilityHint: string
    ) => (
        <Pressable
            key={target}
            onPress={() => onConfirm(target)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`선택한 위치를 ${buttonLabel}`}
            accessibilityHint={accessibilityHint}
            accessibilityState={{ disabled }}
            style={({ pressed }) => [
                styles.action,
                {
                    backgroundColor: colors.surface2,
                    borderColor: disabled ? colors.border : markerColor,
                    opacity: disabled ? 0.5 : pressed ? 0.72 : 1,
                },
            ]}
        >
            <View style={[styles.pin, { backgroundColor: markerColor }]}>
                <Text style={styles.pinText}>{pinLabel}</Text>
            </View>
            <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                style={[
                    styles.actionText,
                    { color: disabled ? colors.textDisabled : colors.textPrimary },
                ]}
            >
                {buttonLabel}
            </Text>
        </Pressable>
    );

    return (
        <View style={styles.row}>
            {renderAction(
                "origin",
                "출",
                "출발지로 설정",
                colors.accentGreen,
                "기존 도착지는 유지하고 경로를 다시 계산합니다"
            )}
            {renderAction(
                "destination",
                "도",
                "도착지로 설정",
                colors.accentRed,
                "기존 출발지는 유지하고 경로를 다시 계산합니다"
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        alignItems: "stretch",
        gap: 10,
    },
    action: {
        flex: 1,
        minWidth: 0,
        minHeight: 52,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    pin: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    pinText: {
        color: "#FFFFFF",
        fontSize: 11,
        fontWeight: "900",
        lineHeight: 14,
    },
    actionText: {
        flexShrink: 1,
        fontSize: 14,
        fontWeight: "900",
        lineHeight: 18,
    },
});
