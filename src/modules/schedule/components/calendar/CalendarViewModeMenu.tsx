import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../../theme/ThemeContext";
import { CALENDAR_VIEW_OPTIONS, type CalendarViewMode } from "./viewMode";

type Props = {
    visible: boolean;
    value: CalendarViewMode;
    onClose: () => void;
    onChange: (mode: CalendarViewMode) => void;
};

export default function CalendarViewModeMenu({ visible, value, onClose, onChange }: Props) {
    const { colors, mode } = useTheme();
    const panelBackground = mode === "dark" ? "#1c1c1e" : colors.surface;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <View
                    style={[
                        styles.menu,
                        {
                            backgroundColor: panelBackground,
                            borderColor: colors.border,
                        },
                    ]}
                >
                    {CALENDAR_VIEW_OPTIONS.map((option, index) => {
                        const selected = option.value === value;
                        return (
                            <React.Fragment key={option.value}>
                                {index === CALENDAR_VIEW_OPTIONS.length - 1 && (
                                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                                )}
                                <Pressable
                                    onPress={() => {
                                        onChange(option.value);
                                        onClose();
                                    }}
                                    style={({ pressed }) => [
                                        styles.option,
                                        { opacity: pressed ? 0.55 : 1 },
                                    ]}
                                >
                                    <View style={styles.check}>
                                        {selected && (
                                            <Ionicons name="checkmark" size={22} color={colors.textPrimary} />
                                        )}
                                    </View>
                                    <Ionicons name={option.icon} size={25} color={colors.textPrimary} />
                                    <Text style={[styles.optionText, { color: colors.textPrimary }]}>
                                        {option.label}
                                    </Text>
                                </Pressable>
                            </React.Fragment>
                        );
                    })}
                </View>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.18)",
    },
    menu: {
        position: "absolute",
        top: 82,
        right: 16,
        width: 238,
        borderWidth: 1,
        borderRadius: 24,
        paddingVertical: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.28,
        shadowRadius: 24,
        elevation: 20,
    },
    option: {
        minHeight: 58,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        gap: 13,
    },
    check: {
        width: 24,
        alignItems: "center",
    },
    optionText: {
        fontSize: 17,
        fontWeight: "700",
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: 16,
        marginVertical: 5,
    },
});
