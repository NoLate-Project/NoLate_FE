import BrandedLoader from "../../../../ui/BrandedLoader";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
    isDark: boolean;
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
    onDismiss: () => void;
};

function PlaybackIndicator({ color, reduceMotion }: { color: string; reduceMotion: boolean }) {
    const level = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (reduceMotion) return;
        const pulse = Animated.loop(Animated.sequence([
            Animated.timing(level, { toValue: 1, duration: 420, useNativeDriver: true, isInteraction: false }),
            Animated.timing(level, { toValue: 0, duration: 420, useNativeDriver: true, isInteraction: false }),
        ]));
        pulse.start();
        return () => pulse.stop();
    }, [level, reduceMotion]);

    return (
        <View testID="alarm-sound-playing-indicator" pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.playbackIndicator}>
            {[5, 11, 8].map((height, index) => (
                <Animated.View key={height} style={[
                    styles.playbackBar,
                    { backgroundColor: color, height },
                    !reduceMotion && { transform: [{ scaleY: level.interpolate({
                        inputRange: [0, 1], outputRange: index === 1 ? [1, 0.4] : [0.4, 1],
                    }) }] },
                ]} />
            ))}
        </View>
    );
}

export default function AlarmSoundPickerSheet({
    visible, selectedSoundId, previewingSoundId, applying, previewLoading, error, isDark,
    accentColor, backgroundColor, surfaceColor, borderColor, textPrimary, textSecondary,
    onSelect, onPreview, onApply, onClose, onDismiss,
}: Props) {
    const reduceMotion = useSystemReduceMotion();
    const insets = useSafeAreaInsets();
    const headingRef = useRef<Text>(null);
    const [presented, setPresented] = useState(visible);
    const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
    const shown = useRef(false);
    const wasPresented = useRef(false);
    const playbackDisabled = applying || previewLoading;
    const selectionBackground = `${accentColor}14`;
    const applyBackground = isDark ? "#ACCCFF" : "#1E5DC7";
    const applyInk = routeColorInk(applyBackground);

    useEffect(() => {
        if (visible) {
            setPresented(true);
            if (reduceMotion) {
                progress.stopAnimation();
                progress.setValue(1);
            }
            return;
        }
        if (!presented || reduceMotion || !shown.current) {
            shown.current = false;
            progress.stopAnimation();
            progress.setValue(0);
            setPresented(false);
            return;
        }
        const exit = Animated.timing(progress, {
            toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true, isInteraction: false,
        });
        exit.start(({ finished }) => {
            if (finished) {
                shown.current = false;
                setPresented(false);
            }
        });
        return () => exit.stop();
    }, [presented, progress, reduceMotion, visible]);

    useEffect(() => {
        if (Platform.OS !== "android") return;
        if (presented) {
            wasPresented.current = true;
        } else if (wasPresented.current) {
            wasPresented.current = false;
            const frame = requestAnimationFrame(onDismiss);
            return () => cancelAnimationFrame(frame);
        }
    }, [onDismiss, presented]);

    const showSheet = () => {
        if (!visible) return;
        shown.current = true;
        const focusHeading = () => {
            if (headingRef.current) AccessibilityInfo.sendAccessibilityEvent?.(headingRef.current, "focus");
        };
        if (reduceMotion) {
            progress.setValue(1);
            focusHeading();
            return;
        }
        Animated.timing(progress, {
            toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false,
        }).start(({ finished }) => { if (finished) focusHeading(); });
    };

    return (
        <Modal
            animationType="none"
            onRequestClose={onClose}
            onDismiss={onDismiss}
            onShow={showSheet}
            presentationStyle="overFullScreen"
            statusBarTranslucent
            transparent
            visible={presented}
        >
            <View style={styles.overlay}>
                <Animated.View pointerEvents="none" accessible={false}
                    style={[styles.backdrop, { opacity: progress }]} />
                <Pressable
                    accessible={false}
                    importantForAccessibility="no"
                    disabled={applying || !visible}
                    onPress={onClose}
                    style={StyleSheet.absoluteFill}
                />
                <Animated.View
                    testID="alarm-sound-picker-sheet"
                    accessibilityViewIsModal
                    pointerEvents={visible ? "auto" : "none"}
                    accessibilityElementsHidden={!visible}
                    importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
                    onAccessibilityEscape={onClose}
                    style={[styles.sheet, {
                        backgroundColor,
                        paddingBottom: Math.max(12, insets.bottom),
                        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }],
                        opacity: progress,
                    }]}
                >
                    <View style={[styles.handle, { backgroundColor: textSecondary }]} />
                    <View style={styles.header}>
                        <View style={styles.heading}>
                            <Text ref={headingRef} accessibilityRole="header" style={[styles.title, { color: textPrimary }]}>
                                기본 알람음
                            </Text>
                            <Text lineBreakStrategyIOS="hangul-word" style={[styles.hint, { color: textSecondary }]}>
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
                                        selected && [styles.selectedSound, { backgroundColor: selectionBackground }],
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
                                    {previewing && <PlaybackIndicator color={accentColor} reduceMotion={reduceMotion} />}
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`${sound.label} ${previewing ? "미리 듣기 중지" : "미리 듣기"}`}
                                        accessibilityState={{ disabled: playbackDisabled, selected: previewing }}
                                        disabled={playbackDisabled}
                                        onPress={() => onPreview(sound.id)}
                                        style={({ pressed }) => [styles.previewButton, pressed && styles.pressed]}
                                    >
                                        <View style={[styles.previewIcon, { backgroundColor: surfaceColor }]}>
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
                        style={({ pressed }) => [styles.applyButton, { backgroundColor: applying ? selectionBackground : applyBackground }, pressed && styles.pressed]}
                    >
                        {applying ? <BrandedLoader startup size="inline" accessibilityLabel="알람 소리 적용 중" /> : (
                            <Text style={[styles.applyLabel, { color: applyInk }]}>적용</Text>
                        )}
                    </Pressable>
                </Animated.View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1, justifyContent: "flex-end",
    },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.42)" },
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
        fontSize: 13,
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
    selectedSound: { borderRadius: 10 },
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
    playbackIndicator: { flexDirection: "row", alignItems: "center", gap: 2, marginEnd: 2 },
    playbackBar: { width: 2, borderRadius: 1 },
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
