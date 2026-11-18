import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Pressable, Text, View } from "react-native";
import { getNativeNoLateAlarmSoundPreference, setNativeNoLateAlarmSoundPreference } from "../../../notification/departureAlarm";
import type { NoLateCustomAlarmAudioSession } from "../../../notification/customAlarmAudio";
import {
    DEFAULT_NOLATE_ALARM_SOUND_ID, getNoLateAlarmSound, getNoLateAlarmSoundPreference,
    setNoLateAlarmSoundPreference, type NoLateAlarmSoundId,
} from "../../../notification/customAlarmSounds";
import { useTheme } from "../../../theme/ThemeContext";
import AlarmSoundPickerSheet from "./AlarmSoundPickerSheet";
import styles from "./NotificationSettingsCard.styles";
import { getNotificationSettingsPalette } from "./notificationSettingsPalette";

const appliedSoundListeners = new Set<(soundId: NoLateAlarmSoundId) => void>();

export default function AlarmSoundSettings({ available, flat, disabled = false }: {
    available: boolean; flat: boolean; disabled?: boolean;
}) {
    const { colors, mode } = useTheme();
    const { accentBlue, subtleAccentBackground } = getNotificationSettingsPalette({ dark: mode === "dark", surface: colors.surface });
    const [selectedSoundId, setSelectedSoundId] = useState<NoLateAlarmSoundId | null>(null);
    const [draftSoundId, setDraftSoundId] = useState<NoLateAlarmSoundId | null>(null);
    const [soundPickerError, setSoundPickerError] = useState<string | null>(null);
    const [previewingSoundId, setPreviewingSoundId] = useState<NoLateAlarmSoundId | null>(null);
    const [soundPickerVisible, setSoundPickerVisible] = useState(false);
    const triggerRef = useRef<React.ComponentRef<typeof Pressable>>(null);
    const restoreTriggerFocusRef = useRef(false);
    const mountedRef = useRef(false);
    const soundPreferenceRequestRef = useRef(0);
    const soundPreviewRequestRef = useRef(0);
    const applyingSoundRef = useRef(false);
    const soundPickerVisibleRef = useRef(false);
    const appStateActiveRef = useRef(true);
    const soundPreviewSessionRef = useRef<NoLateCustomAlarmAudioSession | null>(null);
    const soundPreviewingIdRef = useRef<NoLateAlarmSoundId | null>(null);
    const [pendingAction, setPendingAction] = useState<"soundPreview" | "soundPreference" | null>(null);

    const stopSoundPreview = useCallback(async () => {
        soundPreviewRequestRef.current += 1;
        const session = soundPreviewSessionRef.current;
        soundPreviewSessionRef.current = null;
        soundPreviewingIdRef.current = null;
        if (mountedRef.current) {
            setPreviewingSoundId(null);
            setPendingAction(current => current === "soundPreview" ? null : current);
        }
        await session?.stop().catch(() => undefined);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            appStateActiveRef.current = false;
            soundPickerVisibleRef.current = false;
            soundPreferenceRequestRef.current += 1;
            soundPreviewRequestRef.current += 1;
            const session = soundPreviewSessionRef.current;
            soundPreviewSessionRef.current = null;
            soundPreviewingIdRef.current = null;
            session?.stop().catch(() => undefined);
        };
    }, []);

    useEffect(() => {
        if (!available) return;
        appStateActiveRef.current = AppState.currentState !== "background" && AppState.currentState !== "inactive";
        const subscription = AppState.addEventListener("change", state => {
            appStateActiveRef.current = state === "active";
            if (!appStateActiveRef.current) stopSoundPreview().catch(() => undefined);
        });
        return () => subscription.remove();
    }, [available, stopSoundPreview]);

    useEffect(() => {
        if (available) return;
        soundPreferenceRequestRef.current += 1;
        soundPickerVisibleRef.current = false;
        setSoundPickerVisible(false);
        setPendingAction(current =>
            current === "soundPreference" || current === "soundPreview" ? null : current,
        );
        stopSoundPreview().catch(() => undefined);
    }, [available, stopSoundPreview]);

    useEffect(() => {
        if (!available) return undefined;
        let hasReceivedAppliedSound = false;
        const updateAppliedSound = (soundId: NoLateAlarmSoundId) => {
            hasReceivedAppliedSound = true;
            setSelectedSoundId(soundId);
        };
        appliedSoundListeners.add(updateAppliedSound);
        const requestId = soundPreferenceRequestRef.current + 1;
        soundPreferenceRequestRef.current = requestId;

        Promise.all([
            getNoLateAlarmSoundPreference(),
            typeof getNativeNoLateAlarmSoundPreference === "function"
                ? getNativeNoLateAlarmSoundPreference().catch(() => undefined)
                : Promise.resolve(undefined),
        ]).then(([localSoundId, nativeSoundId]) => {
            if (!mountedRef.current || hasReceivedAppliedSound || requestId !== soundPreferenceRequestRef.current) return;
            const resolvedSoundId = nativeSoundId ?? localSoundId;
            setSelectedSoundId(resolvedSoundId);
            if (nativeSoundId && nativeSoundId !== localSoundId) {
                setNoLateAlarmSoundPreference(nativeSoundId).catch(() => undefined);
            } else if (!nativeSoundId && typeof setNativeNoLateAlarmSoundPreference === "function") {
                setNativeNoLateAlarmSoundPreference(localSoundId).catch(() => false);
            }
        });

        return () => {
            appliedSoundListeners.delete(updateAppliedSound);
            soundPreferenceRequestRef.current += 1;
        };
    }, [available]);

    const toggleSoundPreview = useCallback(async (soundId: NoLateAlarmSoundId) => {
        if (soundPreviewSessionRef.current && soundPreviewingIdRef.current === soundId) {
            await stopSoundPreview();
            return;
        }

        const stopping = stopSoundPreview();
        const requestId = soundPreviewRequestRef.current;
        await stopping;
        if (requestId !== soundPreviewRequestRef.current || !appStateActiveRef.current ||
            !soundPickerVisibleRef.current || applyingSoundRef.current) return;

        setPendingAction("soundPreview");
        setSoundPickerError(null);
        try {
            const { startNoLateCustomAlarmAudio } = require("../../../notification/customAlarmAudio") as typeof import("../../../notification/customAlarmAudio");
            const session = await startNoLateCustomAlarmAudio(soundId, failed => {
                if (!mountedRef.current || requestId !== soundPreviewRequestRef.current) return;
                if (failed) setSoundPickerError("소리를 재생하지 못했어요.");
                void stopSoundPreview();
            });
            if (
                !mountedRef.current ||
                requestId !== soundPreviewRequestRef.current ||
                !appStateActiveRef.current ||
                !soundPickerVisibleRef.current
            ) {
                await session.stop();
                return;
            }
            soundPreviewSessionRef.current = session;
            soundPreviewingIdRef.current = soundId;
            setPreviewingSoundId(soundId);
        } catch {
            if (!mountedRef.current || requestId !== soundPreviewRequestRef.current) return;
            setSoundPickerError("소리를 재생하지 못했어요.");
        } finally {
            if (mountedRef.current && requestId === soundPreviewRequestRef.current) {
                setPendingAction(current => (current === "soundPreview" ? null : current));
            }
        }
    }, [stopSoundPreview]);

    const openSoundPicker = useCallback(() => {
        if (!selectedSoundId) return;
        setDraftSoundId(null);
        setSoundPickerError(null);
        soundPickerVisibleRef.current = true;
        restoreTriggerFocusRef.current = true;
        setSoundPickerVisible(true);
    }, [selectedSoundId]);

    const dismissSoundPicker = useCallback(() => {
        soundPickerVisibleRef.current = false;
        setSoundPickerVisible(false);
        stopSoundPreview().catch(() => undefined);
    }, [stopSoundPreview]);

    const focusSoundTrigger = useCallback(() => {
        if (!restoreTriggerFocusRef.current || soundPickerVisibleRef.current || !triggerRef.current) return;
        restoreTriggerFocusRef.current = false;
        AccessibilityInfo.sendAccessibilityEvent?.(triggerRef.current, "focus");
    }, []);

    const closeSoundPicker = useCallback(() => {
        if (!applyingSoundRef.current) dismissSoundPicker();
    }, [dismissSoundPicker]);

    const applyAlarmSound = useCallback(async () => {
        if (!soundPickerVisibleRef.current || applyingSoundRef.current) return;
        if (!draftSoundId || draftSoundId === selectedSoundId) {
            dismissSoundPicker();
            return;
        }

        applyingSoundRef.current = true;
        const requestId = ++soundPreferenceRequestRef.current;
        setPendingAction("soundPreference");
        setSoundPickerError(null);
        await stopSoundPreview();

        try {
            const nativeSaved = typeof setNativeNoLateAlarmSoundPreference === "function"
                ? await setNativeNoLateAlarmSoundPreference(draftSoundId)
                : false;
            if (!nativeSaved) throw new Error("NATIVE_SOUND_PREFERENCE_UNAVAILABLE");
            await setNoLateAlarmSoundPreference(draftSoundId).catch(() => undefined);
            const shouldDismiss = mountedRef.current && requestId === soundPreferenceRequestRef.current;
            appliedSoundListeners.forEach(update => update(draftSoundId));
            if (shouldDismiss) dismissSoundPicker();
        } catch {
            if (mountedRef.current && requestId === soundPreferenceRequestRef.current) {
                setSoundPickerError("알람음을 바꾸지 못했어요. 다시 시도해 주세요.");
            }
        } finally {
            applyingSoundRef.current = false;
            if (mountedRef.current) {
                setPendingAction(current => current === "soundPreference" ? null : current);
            }
        }
    }, [dismissSoundPicker, draftSoundId, selectedSoundId, stopSoundPreview]);

    const selectedSound = selectedSoundId ? getNoLateAlarmSound(selectedSoundId) : null;
    const soundSummary = selectedSound
        ? `${selectedSound.label} · 무음일 때는 진동만${flat ? "" : " · 모든 출발 알람에 적용"}`
        : "기본 알람음 확인 중";
    const soundAccessibilityLabel = selectedSound
        ? `소리 및 진동, 현재 ${selectedSound.label}${flat ? "" : ", 모든 출발 알람에 적용"}`
        : `소리 및 진동, ${soundSummary}`;
    const soundPreviewDisabled = disabled || !selectedSound || pendingAction !== null;

    return (
        <>
            {available ? (
                <Pressable
                    ref={triggerRef}
                    testID="notification-alarm-sound-row"
                    accessibilityRole="button"
                    accessibilityLabel={soundAccessibilityLabel}
                    accessibilityState={{
                        disabled: soundPreviewDisabled,
                        busy: !selectedSound,
                    }}
                    disabled={soundPreviewDisabled}
                    onPress={openSoundPicker}
                    style={({ pressed }) => [
                        styles.flatTestRow,
                        {
                            borderColor: colors.border,
                            backgroundColor: colors.surface2,
                        },
                        soundPreviewDisabled && styles.disabledButton,
                        pressed && !soundPreviewDisabled && styles.pressedRow,
                    ]}
                >
                    <View style={[styles.flatTestIcon, { backgroundColor: subtleAccentBackground }]}>
                        <Ionicons
                            accessible={false}
                            name="musical-notes-outline"
                            size={18}
                            color={accentBlue}
                        />
                    </View>
                    <View style={styles.flatTestCopy}>
                        <Text style={[styles.flatTestTitle, { color: colors.textPrimary }]}>
                            소리 및 진동
                        </Text>
                        <Text style={[styles.flatTestDescription, { color: colors.textSecondary }]}>
                            {soundSummary}
                        </Text>
                    </View>
                    <Ionicons accessible={false} name="chevron-forward-outline" size={16} color={colors.textSecondary} />
                </Pressable>
            ) : null}
            <AlarmSoundPickerSheet
                visible={soundPickerVisible && available}
                selectedSoundId={draftSoundId ?? selectedSoundId ?? DEFAULT_NOLATE_ALARM_SOUND_ID}
                previewingSoundId={previewingSoundId}
                applying={pendingAction === "soundPreference"}
                previewLoading={pendingAction === "soundPreview"}
                error={soundPickerError}
                isDark={mode === "dark"}
                accentColor={accentBlue}
                backgroundColor={mode === "dark" ? "#1C1E24" : colors.background}
                surfaceColor={mode === "dark" ? "#2B364B" : "#EDF4FF"}
                borderColor={colors.inputBorder}
                textPrimary={colors.textPrimary}
                textSecondary={colors.textSecondary}
                onSelect={setDraftSoundId}
                onPreview={toggleSoundPreview}
                onApply={applyAlarmSound}
                onClose={closeSoundPicker}
                onDismiss={focusSoundTrigger}
            />
        </>
    );
}
