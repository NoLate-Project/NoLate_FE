import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { useTheme } from "../../../theme/ThemeContext";
import ThemeModeSwitch, { type OutlinedSelectionColors } from "../../../theme/ThemeModeSwitch";

type Props = {
    firstDay: 0 | 1;
    onChangeFirstDay: (firstDay: 0 | 1) => void;
    largeText: boolean;
    reduceMotionEnabled: boolean;
    outlinedSelection?: OutlinedSelectionColors;
};

const weekStarts = [
    { value: 0, label: "일요일" },
    { value: 1, label: "월요일" },
] as const;

const settingsEntry = FadeIn.duration(160).reduceMotion(ReduceMotion.System);

export default function CalendarViewSettings({
    firstDay,
    onChangeFirstDay,
    largeText,
    reduceMotionEnabled,
    outlinedSelection,
}: Props) {
    const { colors } = useTheme();

    return (
        <ScrollView contentContainerStyle={styles.content}>
            <Animated.View entering={reduceMotionEnabled ? undefined : settingsEntry} style={styles.sections}>
                <View style={styles.section}>
                    <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.label, { color: colors.textPrimary }]}>
                        주 시작 요일
                    </Text>
                    <View accessibilityRole="radiogroup" style={[
                        styles.segment,
                        outlinedSelection ? styles.outlinedSegment : { backgroundColor: colors.surface2, borderColor: colors.border },
                    ]}>
                        {weekStarts.map((option) => {
                            const selected = option.value === firstDay;
                            const labelColor = outlinedSelection
                                ? selected ? outlinedSelection.color : colors.textPrimary
                                : selected ? colors.selectedDayText : colors.textSecondary;
                            return (
                                <Pressable
                                    key={option.value}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected }}
                                    accessibilityLabel={`한 주의 시작 ${option.label}`}
                                    onPress={() => onChangeFirstDay(option.value)}
                                    style={({ pressed }) => [
                                        styles.option,
                                        outlinedSelection
                                            ? [styles.outlinedOption, {
                                                backgroundColor: selected ? outlinedSelection.backgroundColor : colors.surface2,
                                                borderColor: selected ? outlinedSelection.borderColor : colors.border,
                                            }]
                                            : selected && { backgroundColor: colors.selectedDayBg },
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Text maxFontSizeMultiplier={2} style={[styles.optionLabel, { color: labelColor }]}>
                                        {option.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
                <View style={[styles.section, !outlinedSelection && styles.divider, { borderTopColor: colors.border }]}>
                    <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[styles.label, { color: colors.textPrimary }]}>
                        화면 테마
                    </Text>
                    <ThemeModeSwitch stacked={largeText} outlinedSelection={outlinedSelection} />
                </View>
            </Animated.View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: { paddingBottom: 8 },
    sections: { gap: 18 },
    section: { gap: 8 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
    label: { fontSize: 16, fontWeight: "700" },
    segment: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        flexDirection: "row",
        padding: 3,
        gap: 3,
    },
    outlinedSegment: { minHeight: 48, borderWidth: 0, padding: 0, gap: 6 },
    option: {
        minHeight: 44,
        minWidth: 0,
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 13,
        paddingVertical: 7,
        paddingHorizontal: 4,
    },
    optionLabel: { fontSize: 14, fontWeight: "800", textAlign: "center" },
    outlinedOption: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
    pressed: { opacity: 0.62 },
});
