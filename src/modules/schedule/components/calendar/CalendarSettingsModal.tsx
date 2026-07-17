import React from "react";
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../theme/ThemeContext";
import ThemeModeSwitch from "../../../theme/ThemeModeSwitch";
import CalendarGlassSurface from "./CalendarGlassSurface";

type Props = {
    visible: boolean;
    firstDay: 0 | 1;
    onChangeFirstDay: (firstDay: 0 | 1) => void;
    onClose: () => void;
};

export default function CalendarSettingsModal({
    visible,
    firstDay,
    onChangeFirstDay,
    onClose,
}: Props) {
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View style={styles.backdrop}>
                <Pressable
                    accessible={false}
                    style={StyleSheet.absoluteFill}
                    onPress={onClose}
                />
                <View style={styles.panelHitArea}>
                    <CalendarGlassSurface
                        style={[
                            styles.panel,
                            {
                                borderColor: colors.border,
                                paddingBottom: Math.max(insets.bottom, 14) + 20,
                            },
                        ]}
                    >
                        <View style={styles.titleRow}>
                            <Text style={[styles.title, { color: colors.textPrimary }]}>캘린더 설정</Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="캘린더 설정 닫기"
                                onPress={onClose}
                                style={styles.closeButton}
                            >
                                <Ionicons accessible={false} name="close" size={22} color={colors.textSecondary} />
                            </Pressable>
                        </View>

                        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                            한 주의 시작
                        </Text>
                        <View
                            accessibilityRole="radiogroup"
                            style={[styles.segment, { backgroundColor: colors.surface2 }]}
                        >
                            {([
                                { value: 0 as const, label: "일요일" },
                                { value: 1 as const, label: "월요일" },
                            ]).map((option) => {
                                const selected = option.value === firstDay;
                                return (
                                    <Pressable
                                        key={option.value}
                                        accessible
                                        role="radio"
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected }}
                                        accessibilityLabel={`한 주의 시작 ${option.label}`}
                                        onPress={() => onChangeFirstDay(option.value)}
                                        style={[
                                            styles.segmentButton,
                                            selected && { backgroundColor: colors.surface },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.segmentText,
                                                {
                                                    color: selected
                                                        ? colors.textPrimary
                                                        : colors.textSecondary,
                                                },
                                            ]}
                                        >
                                            {option.label}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        <View
                            style={[styles.settingRow, { borderTopColor: colors.border }]}
                        >
                            <View>
                                <Text
                                    style={[styles.settingTitle, { color: colors.textPrimary }]}
                                >
                                    화면 테마
                                </Text>
                                <Text
                                    style={[styles.settingHint, { color: colors.textSecondary }]}
                                >
                                    시스템 설정을 따르거나 밝기를 선택하세요
                                </Text>
                            </View>
                            <ThemeModeSwitch />
                        </View>
                    </CalendarGlassSurface>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.34)",
        justifyContent: "flex-end",
    },
    panelHitArea: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        overflow: "hidden",
    },
    panel: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 20,
        paddingTop: 18,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 22,
    },
    title: {
        fontSize: 22,
        fontWeight: "800",
    },
    closeButton: {
        width: 34,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
    },
    sectionLabel: {
        fontSize: 13,
        fontWeight: "600",
        marginBottom: 8,
    },
    segment: {
        height: 44,
        borderRadius: 12,
        padding: 3,
        flexDirection: "row",
    },
    segmentButton: {
        flex: 1,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    segmentText: {
        fontSize: 14,
        fontWeight: "700",
    },
    settingRow: {
        marginTop: 22,
        paddingTop: 18,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 12,
    },
    settingTitle: {
        fontSize: 16,
        fontWeight: "700",
    },
    settingHint: {
        marginTop: 3,
        fontSize: 12,
    },
});
