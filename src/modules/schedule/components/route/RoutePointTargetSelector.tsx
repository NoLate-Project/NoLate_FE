import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { RoutePointTarget } from "../../routePointSelection";

type RoutePointTargetSelectorProps = {
    activeTarget: RoutePointTarget;
    originText: string;
    destinationText: string;
    onSelectTarget: (target: RoutePointTarget) => void;
    colors: {
        surface: string;
        surface2: string;
        border: string;
        textPrimary: string;
        textSecondary: string;
        accentBlue: string;
        accentGreen: string;
        accentRed: string;
    };
};

export default function RoutePointTargetSelector({
    activeTarget,
    originText,
    destinationText,
    onSelectTarget,
    colors,
}: RoutePointTargetSelectorProps) {
    const renderTarget = (
        target: RoutePointTarget,
        label: string,
        text: string,
        markerColor: string
    ) => {
        const selected = activeTarget === target;
        return (
            <Pressable
                key={target}
                onPress={() => onSelectTarget(target)}
                accessibilityRole="button"
                accessibilityLabel={`${label} 선택 화면으로 전환, 현재 ${text || "미지정"}`}
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                    styles.targetButton,
                    {
                        backgroundColor: selected ? colors.surface : colors.surface2,
                        borderColor: selected ? colors.accentBlue : colors.border,
                    },
                    pressed && styles.pressed,
                ]}
            >
                <View style={[styles.dot, { borderColor: markerColor }]} />
                <View style={styles.copy}>
                    <Text style={[styles.label, { color: selected ? colors.accentBlue : colors.textSecondary }]}>
                        {label}
                    </Text>
                    <Text numberOfLines={1} style={[styles.value, { color: colors.textPrimary }]}>
                        {text || `${label} 미지정`}
                    </Text>
                </View>
                {selected && <Text style={[styles.selectedText, { color: colors.accentBlue }]}>선택 중</Text>}
            </Pressable>
        );
    };

    return (
        <View style={styles.container}>
            {renderTarget("origin", "출발지", originText, colors.accentGreen)}
            {renderTarget("destination", "도착지", destinationText, colors.accentRed)}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 16,
        marginBottom: 10,
    },
    targetButton: {
        flex: 1,
        minWidth: 0,
        minHeight: 54,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 11,
        paddingVertical: 7,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 999,
        borderWidth: 2,
    },
    copy: {
        flex: 1,
        minWidth: 0,
    },
    label: {
        fontSize: 10,
        fontWeight: "800",
        lineHeight: 13,
    },
    value: {
        marginTop: 1,
        fontSize: 12,
        fontWeight: "900",
        lineHeight: 16,
    },
    selectedText: {
        fontSize: 9,
        fontWeight: "900",
        lineHeight: 12,
    },
    pressed: {
        opacity: 0.72,
    },
});
