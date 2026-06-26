import React, { useEffect, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../../theme/ThemeContext";
import CalendarGlassSurface from "./CalendarGlassSurface";
import CalendarViewModeGlyph from "./CalendarViewModeGlyph";
import { CALENDAR_VIEW_OPTIONS, type CalendarViewMode } from "./viewMode";

type Props = {
    visible: boolean;
    value: CalendarViewMode;
    onClose: () => void;
    onChange: (mode: CalendarViewMode) => void;
};

export default function CalendarViewModeMenu({ visible, value, onClose, onChange }: Props) {
    const { colors } = useTheme();
    const menuProgress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!visible) {
            menuProgress.setValue(0);
            return;
        }

        Animated.timing(menuProgress, {
            toValue: 1,
            duration: 170,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [menuProgress, visible]);

    const menuScale = menuProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.96, 1],
    });
    const menuTranslateY = menuProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [-6, 0],
    });

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Animated.View
                    style={[
                        styles.menu,
                        {
                            opacity: menuProgress,
                            transform: [{ translateY: menuTranslateY }, { scale: menuScale }],
                        },
                    ]}
                >
                    <CalendarGlassSurface
                        clear
                        style={[
                            styles.glass,
                            {
                                borderColor: colors.border,
                                shadowColor: colors.textPrimary,
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
                                        accessibilityRole="button"
                                        accessibilityLabel={`${option.label} 보기`}
                                        onPress={() => {
                                            onChange(option.value);
                                            onClose();
                                        }}
                                        style={({ pressed }) => [
                                            styles.option,
                                            {
                                                opacity: pressed ? 0.62 : 1,
                                                transform: [{ scale: pressed ? 0.98 : 1 }],
                                            },
                                        ]}
                                    >
                                        <View style={styles.check}>
                                            {selected && (
                                                <Ionicons name="checkmark" size={22} color={colors.textPrimary} />
                                            )}
                                        </View>
                                        <View style={styles.glyphSlot}>
                                            <CalendarViewModeGlyph
                                                mode={option.value}
                                                color={colors.textPrimary}
                                                size={27}
                                            />
                                        </View>
                                        <Text style={[styles.optionText, { color: colors.textPrimary }]}>
                                            {option.label}
                                        </Text>
                                    </Pressable>
                                </React.Fragment>
                            );
                        })}
                    </CalendarGlassSurface>
                </Animated.View>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.03)",
    },
    menu: {
        position: "absolute",
        top: 74,
        right: 16,
        width: 252,
    },
    glass: {
        borderWidth: 1,
        borderRadius: 30,
        paddingTop: 10,
        paddingBottom: 11,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.24,
        shadowRadius: 22,
        elevation: 20,
    },
    option: {
        height: 55,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 21,
        paddingRight: 24,
        gap: 13,
    },
    check: {
        width: 23,
        alignItems: "center",
    },
    glyphSlot: {
        width: 30,
        alignItems: "center",
        justifyContent: "center",
    },
    optionText: {
        fontSize: 17,
        fontWeight: "800",
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 44,
        marginRight: 26,
        marginVertical: 7,
    },
});
