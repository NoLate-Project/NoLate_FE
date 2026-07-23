import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { type ThemePreference, useTheme } from "./ThemeContext";

type Props = {
    style?: StyleProp<ViewStyle>;
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

export default function ThemeModeSwitch({ style }: Props) {
    const { colors, preference, setPreference } = useTheme();

    return (
        <View
            accessibilityRole="radiogroup"
            accessibilityLabel="화면 테마"
            style={[styles.group, { backgroundColor: colors.surface2, borderColor: colors.border }, style]}
        >
            {OPTIONS.map((option) => {
                const selected = preference === option.value;

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
                            selected && { backgroundColor: colors.selectedDayBg },
                            pressed && styles.pressed,
                        ]}
                    >
                        <Ionicons
                            accessible={false}
                            name={option.icon}
                            size={15}
                            color={selected ? colors.selectedDayText : colors.textSecondary}
                        />
                        <Text
                            numberOfLines={1}
                            style={[
                                styles.label,
                                { color: selected ? colors.selectedDayText : colors.textSecondary },
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
    option: {
        flex: 1,
        minWidth: 0,
        minHeight: 42,
        borderRadius: 13,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingHorizontal: 7,
    },
    label: {
        flexShrink: 1,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "900",
    },
    pressed: {
        opacity: 0.62,
    },
});
