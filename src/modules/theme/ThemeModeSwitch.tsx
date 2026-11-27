import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { type ThemePreference, useTheme } from "./ThemeContext";

export type OutlinedSelectionColors = {
    backgroundColor: string;
    borderColor: string;
    color: string;
};

type Props = {
    style?: StyleProp<ViewStyle>;
    stacked?: boolean;
    showIcons?: boolean;
    outlinedSelection?: OutlinedSelectionColors;
};

const OPTIONS: Array<{
    value: ThemePreference;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    hint: string;
}> = [
    {
        value: "system",
        label: "시스템",
        icon: "phone-portrait-outline",
        hint: "기기의 화면 모드 설정을 따릅니다",
    },
    {
        value: "light",
        label: "라이트",
        icon: "sunny-outline",
        hint: "앱을 항상 밝은 화면으로 표시합니다",
    },
    {
        value: "dark",
        label: "다크",
        icon: "moon-outline",
        hint: "앱을 항상 어두운 화면으로 표시합니다",
    },
];

export default function ThemeModeSwitch({ style, stacked = false, showIcons = true, outlinedSelection }: Props) {
    const { colors, preference, setPreference } = useTheme();

    return (
        <View
            accessibilityRole="radiogroup"
            accessibilityLabel="화면 테마"
            style={[
                styles.group,
                outlinedSelection ? styles.outlinedGroup : { backgroundColor: colors.surface2, borderColor: colors.border },
                stacked && styles.groupStacked,
                style,
            ]}
        >
            {OPTIONS.map((option) => {
                const selected = preference === option.value;
                const labelColor = outlinedSelection
                    ? selected ? outlinedSelection.color : colors.textPrimary
                    : selected ? colors.selectedDayText : colors.textSecondary;

                return (
                    <Pressable
                        key={option.value}
                        testID={`theme-preference-${option.value}`}
                        accessible
                        role="radio"
                        accessibilityRole="radio"
                        accessibilityLabel={`${option.label} 테마`}
                        accessibilityHint={option.hint}
                        accessibilityState={{ selected }}
                        onPress={() => setPreference(option.value)}
                        style={({ pressed }) => [
                            styles.option,
                            stacked && styles.optionStacked,
                            outlinedSelection
                                ? [styles.outlinedOption, {
                                    backgroundColor: selected ? outlinedSelection.backgroundColor : colors.surface2,
                                    borderColor: selected ? outlinedSelection.borderColor : colors.border,
                                }]
                                : selected && { backgroundColor: colors.selectedDayBg },
                            pressed && styles.pressed,
                        ]}
                    >
                        {showIcons && !outlinedSelection && <Ionicons
                            accessible={false}
                            name={option.icon}
                            size={15}
                            color={labelColor}
                        />}
                        <Text
                            numberOfLines={stacked ? undefined : 1}
                            maxFontSizeMultiplier={stacked ? 2 : undefined}
                            style={[
                                styles.label,
                                stacked && styles.labelStacked,
                                outlinedSelection && styles.outlinedLabel,
                                { color: labelColor },
                            ]}
                        >
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    group: {
        minHeight: 48,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        padding: 3,
        flexDirection: "row",
        gap: 3,
    },
    groupStacked: { flexDirection: "column" },
    outlinedGroup: { borderWidth: 0, padding: 0, gap: 6 },
    option: {
        flex: 1,
        minWidth: 0,
        minHeight: 44,
        borderRadius: 13,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingHorizontal: 7,
    },
    optionStacked: {
        flex: 0,
        justifyContent: "flex-start",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    outlinedOption: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
    label: {
        flexShrink: 1,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "900",
    },
    labelStacked: { fontSize: 14, lineHeight: undefined },
    outlinedLabel: { fontSize: 14, lineHeight: 19, fontWeight: "800" },
    pressed: {
        opacity: 0.62,
    },
});
