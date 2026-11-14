import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NOLATE_ALARM_SOUNDS, type NoLateAlarmSoundId } from "../../../notification/customAlarmSounds";
import { useSystemReduceMotion } from "../../../performance/useSystemReduceMotion";
import { routeColorInk } from "../../routeColorContrast";

type Props = {
    visible: boolean;
    selectedSoundId: NoLateAlarmSoundId;
    previewingSoundId: NoLateAlarmSoundId | null;
    applying: boolean;
    previewLoading: boolean;
    error: string | null;
    accentColor: string;
    backgroundColor: string;
    surfaceColor: string;
    borderColor: string;
    textPrimary: string;
    textSecondary: string;
    onSelect: (soundId: NoLateAlarmSoundId) => void;
    onPreview: (soundId: NoLateAlarmSoundId) => void;
    onApply: () => void;
    onClose: () => void;
};

export default function AlarmSoundPickerSheet({
    visible, selectedSoundId, previewingSoundId, applying, previewLoading, error,
    accentColor, backgroundColor, surfaceColor, borderColor, textPrimary, textSecondary,
    onSelect, onPreview, onApply, onClose,
}: Props) {
    const reduceMotion = useSystemReduceMotion();
    const insets = useSafeAreaInsets();
    const playbackDisabled = applying || previewLoading;
    const selectionBackground = `${accentColor}14`;
    const applyBackground = routeColorInk(backgroundColor) === "#000000" ? "#1E5DC7" : "#ACCCFF";
    const applyInk = routeColorInk(applyBackground);

    return (
        <Modal
            animationType={reduceMotion ? "none" : "slide"}
            onRequestClose={onClose}
            presentationStyle="overFullScreen"
            statusBarTranslucent
            transparent
            visible={visible}
        >
            <View style={styles.overlay}>
                <Pressable
                    accessible={false}
                    importantForAccessibility="no"
                    disabled={applying}
                    onPress={onClose}
                    style={StyleSheet.absoluteFill}
                />
                <View
                    testID="alarm-sound-picker-sheet"
                    accessibilityViewIsModal
                    style={[styles.sheet, { backgroundColor, paddingBottom: Math.max(12, insets.bottom) }]}
                >
                    <View style={[styles.handle, { backgroundColor: textSecondary }]} />
                    <View style={styles.header}>
                        <View style={styles.heading}>
                            <Text accessibilityRole="header" style={[styles.title, { color: textPrimary }]}>
                                기본 알람음
                            </Text>
                            <Text style={[styles.hint, { color: textSecondary }]}>
                                모든 출발 알람에 적용돼요.
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="알람음 선택 닫기"
                            accessibilityState={{ disabled: applying }}
                            disabled={applying}
                            onPress={onClose}
                            style={styles.closeButton}
                        >
                            <Ionicons accessible={false} name="close-outline" size={22} color={textSecondary} />
                        </Pressable>
                    </View>
                    <ScrollView
                        accessibilityLabel="알람음 목록"
                        nestedScrollEnabled
                        style={styles.soundList}
                    >
                        {NOLATE_ALARM_SOUNDS.map((sound, index) => {
                            const selected = sound.id === selectedSoundId;
                            const previewing = sound.id === previewingSoundId;
                            return (
                                <View
                                    key={sound.id}
                                    style={[
                                        styles.soundRow,
                                        index > 0 && { borderTopColor: borderColor, borderTopWidth: StyleSheet.hairlineWidth },
                                        selected && { backgroundColor: selectionBackground },
                                    ]}
                                >
                                    <Pressable
                                        accessibilityRole="radio"
                                        accessibilityLabel={`${sound.label} 알람음`}
                                        accessibilityState={{ checked: selected, disabled: applying }}
                                        disabled={applying}
                                        onPress={() => onSelect(sound.id)}
                                        style={({ pressed }) => [styles.selectButton, pressed && styles.pressed]}
                                    >
                                        <Ionicons
                                            accessible={false}
                                            name={selected ? "radio-button-on-outline" : "radio-button-off-outline"}
                                            size={20}
                                            color={selected ? accentColor : textSecondary}
                                        />
                                        <Text style={[styles.soundName, { color: textPrimary }]}>{sound.label}</Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`${sound.label} ${previewing ? "미리 듣기 중지" : "미리 듣기"}`}
                                        accessibilityState={{ disabled: playbackDisabled }}
                                        disabled={playbackDisabled}
                                        onPress={() => onPreview(sound.id)}
                                        style={({ pressed }) => [styles.previewButton, pressed && styles.pressed]}
                                    >
                                        <View style={[styles.previewIcon, { backgroundColor: previewing ? selectionBackground : surfaceColor }]}>
                                            <Ionicons
                                                accessible={false}
                                                name={previewing ? "stop-outline" : "play-outline"}
                                                size={17}
                                                color={accentColor}
                                            />
                                        </View>
                                    </Pressable>
                                </View>
                            );
                        })}
                    </ScrollView>
                    {error ? (
                        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: textPrimary }]}>
                            {error}
                        </Text>
                    ) : (
                        <Text style={[styles.hint, { color: textSecondary }]}>무음 모드에서는 진동만 울려요.</Text>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="알람음 적용"
                        accessibilityState={{ busy: applying, disabled: applying }}
                        disabled={applying}
                        onPress={onApply}
                        style={({ pressed }) => [styles.applyButton, { backgroundColor: applyBackground }, pressed && styles.pressed]}
                    >
                        {applying ? <ActivityIndicator color={applyInk} /> : (
                            <Text style={[styles.applyLabel, { color: applyInk }]}>적용</Text>
                        )}
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)",
    },
    sheet: {
        maxHeight: "86%", borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 18, paddingTop: 9, gap: 8,
    },
    handle: {
        width: 30, height: 4, borderRadius: 2, opacity: 0.6, alignSelf: "center",
    },
    header: {
        flexDirection: "row", alignItems: "flex-start", gap: 8,
    },
    heading: {
        flex: 1,
    },
    title: {
        fontSize: 21, fontWeight: "700",
    },
    hint: {
        fontSize: 13, lineHeight: 19,
    },
    closeButton: {
        width: 44, height: 44, alignItems: "center", justifyContent: "center",
    },
    soundList: {
        flexShrink: 1, borderRadius: 12,
    },
    soundRow: {
        minHeight: 50, flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 4,
    },
    selectButton: {
        flex: 1, flexDirection: "row", alignItems: "center", alignSelf: "stretch",
        paddingHorizontal: 10, paddingVertical: 8, gap: 10,
    },
    soundName: {
        flex: 1, fontSize: 15, fontWeight: "600",
    },
    previewButton: {
        width: 44, height: 44, alignItems: "center", justifyContent: "center",
    },
    previewIcon: {
        width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center",
    },
    applyButton: {
        minHeight: 46, paddingVertical: 8, borderRadius: 12, alignItems: "center", justifyContent: "center",
    },
    applyLabel: {
        fontSize: 16, fontWeight: "700",
    },
    pressed: {
        opacity: 0.7,
    },
});
