import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
    NOLATE_ALARM_SOUNDS,
    type NoLateAlarmSoundId,
} from "../../../notification/customAlarmSounds";

type Props = {
    visible: boolean;
    selectedSoundId: NoLateAlarmSoundId;
    previewingSoundId: NoLateAlarmSoundId | null;
    busy: boolean;
    accentColor: string;
    backgroundColor: string;
    surfaceColor: string;
    borderColor: string;
    textPrimary: string;
    textSecondary: string;
    onSelect: (soundId: NoLateAlarmSoundId) => void;
    onClose: () => void;
};

export default function AlarmSoundPickerSheet({
    visible,
    selectedSoundId,
    previewingSoundId,
    busy,
    accentColor,
    backgroundColor,
    surfaceColor,
    borderColor,
    textPrimary,
    textSecondary,
    onSelect,
    onClose,
}: Props) {
    return (
        <Modal
            animationType="slide"
            onRequestClose={onClose}
            presentationStyle="overFullScreen"
            statusBarTranslucent
            transparent
            visible={visible}
        >
            <View style={styles.overlay}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="알람음 선택 닫기"
                    onPress={onClose}
                    style={StyleSheet.absoluteFill}
                />
                <View
                    testID="alarm-sound-picker-sheet"
                    accessibilityViewIsModal
                    style={[styles.sheet, { backgroundColor }]}
                >
                    <View style={styles.header}>
                        <Text accessibilityRole="header" style={[styles.title, { color: textPrimary }]}>
                            알람음
                        </Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="알람음 선택 완료"
                            hitSlop={8}
                            onPress={onClose}
                            style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
                        >
                            <Text style={[styles.doneText, { color: accentColor }]}>완료</Text>
                        </Pressable>
                    </View>

                    <View
                        accessibilityRole="radiogroup"
                        accessibilityLabel="알람음 목록"
                        style={[styles.soundList, { borderColor, backgroundColor: surfaceColor }]}
                    >
                        {NOLATE_ALARM_SOUNDS.map((sound, index) => {
                            const selected = sound.id === selectedSoundId;
                            const previewing = sound.id === previewingSoundId;
                            let accessibilityHint = "선택하고 미리 듣습니다";
                            if (selected) accessibilityHint = "미리 듣습니다";
                            if (previewing) accessibilityHint = "미리 듣기를 중지합니다";
                            let trailingIcon: React.ComponentProps<typeof Ionicons>["name"] =
                                "play-circle-outline";
                            if (selected) trailingIcon = "checkmark-circle";
                            if (previewing) trailingIcon = "stop-circle";
                            return (
                                <Pressable
                                    key={sound.id}
                                    accessibilityRole="radio"
                                    accessibilityLabel={`${sound.label} 알람음`}
                                    accessibilityHint={accessibilityHint}
                                    accessibilityState={{ checked: selected, disabled: busy }}
                                    disabled={busy}
                                    onPress={() => onSelect(sound.id)}
                                    style={({ pressed }) => [
                                        styles.soundRow,
                                        index > 0 && {
                                            borderTopColor: borderColor,
                                            borderTopWidth: StyleSheet.hairlineWidth,
                                        },
                                        pressed && !busy && styles.pressed,
                                        busy && styles.disabled,
                                    ]}
                                >
                                    <View
                                        style={[
                                            styles.soundIcon,
                                            { backgroundColor: selected ? accentColor : backgroundColor },
                                        ]}
                                    >
                                        <Ionicons
                                            accessible={false}
                                            name={sound.id === "BELL" ? "notifications-outline" : "musical-notes-outline"}
                                            size={19}
                                            color={selected ? "#FFFFFF" : textSecondary}
                                        />
                                    </View>
                                    <Text style={[styles.soundName, { color: textPrimary }]}>{sound.label}</Text>
                                    {busy && selected ? (
                                        <ActivityIndicator color={accentColor} size="small" />
                                    ) : (
                                        <Ionicons
                                            accessible={false}
                                            name={trailingIcon}
                                            size={24}
                                            color={selected || previewing ? accentColor : textSecondary}
                                        />
                                    )}
                                </Pressable>
                            );
                        })}
                    </View>
                    <Text style={[styles.hint, { color: textSecondary }]}>모든 출발 알람에 적용</Text>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: "flex-end",
        backgroundColor: "rgba(0,0,0,0.42)",
    },
    sheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 28,
    },
    header: {
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    title: {
        fontSize: 20,
        lineHeight: 26,
        fontWeight: "800",
    },
    doneButton: {
        minWidth: 44,
        minHeight: 44,
        alignItems: "flex-end",
        justifyContent: "center",
    },
    doneText: {
        fontSize: 15,
        lineHeight: 20,
        fontWeight: "700",
    },
    soundList: {
        marginTop: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 16,
        overflow: "hidden",
    },
    soundRow: {
        minHeight: 66,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    soundIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    soundName: {
        flex: 1,
        fontSize: 15,
        lineHeight: 21,
        fontWeight: "700",
    },
    hint: {
        marginTop: 10,
        paddingHorizontal: 4,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "500",
    },
    pressed: {
        opacity: 0.68,
    },
    disabled: {
        opacity: 0.5,
    },
});
