import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
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

export default function AlarmSoundSettings({ available, flat, disabled = false }: {
    available: boolean; flat: boolean; disabled?: boolean;
}) {
    const { colors, mode } = useTheme();
    const { accentBlue, subtleAccentBackground } = getNotificationSettingsPalette({ dark: mode === "dark", surface: colors.surface });
    const [selectedSoundId, setSelectedSoundId] = useState<NoLateAlarmSoundId>(DEFAULT_NOLATE_ALARM_SOUND_ID);
    const [draftSoundId, setDraftSoundId] = useState<NoLateAlarmSoundId | null>(null);
    const [soundPickerError, setSoundPickerError] = useState<string | null>(null);
    const [previewingSoundId, setPreviewingSoundId] = useState<NoLateAlarmSoundId | null>(null);
    const [soundPickerVisible, setSoundPickerVisible] = useState(false);
    const mountedRef = useRef(false);
    const soundPreferenceRequestRef = useRef(0);
    const soundPreviewRequestRef = useRef(0);
    const applyingSoundRef = useRef(false);
    const soundPickerVisibleRef = useRef(false);
    const appStateActiveRef = useRef(true);
    const soundPreviewSessionRef = useRef<NoLateCustomAlarmAudioSession | null>(null);
    const soundPreviewingIdRef = useRef<NoLateAlarmSoundId | null>(null);
    const soundPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [pendingAction, setPendingAction] = useState<"soundPreview" | "soundPreference" | null>(null);

    const stopSoundPreview = useCallback(async () => {
        soundPreviewRequestRef.current += 1;
        if (soundPreviewTimerRef.current) {
            clearTimeout(soundPreviewTimerRef.current);
            soundPreviewTimerRef.current = null;
        }
        const session = soundPreviewSessionRef.current;
        soundPreviewSessionRef.current = null;
        soundPreviewingIdRef.current = null;
        if (mountedRef.current) setPreviewingSoundId(null);
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
            if (soundPreviewTimerRef.current) clearTimeout(soundPreviewTimerRef.current);
            soundPreviewTimerRef.current = null;
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
        const requestId = soundPreferenceRequestRef.current + 1;
        soundPreferenceRequestRef.current = requestId;

        Promise.all([
            getNoLateAlarmSoundPreference(),
            typeof getNativeNoLateAlarmSoundPreference === "function"
                ? getNativeNoLateAlarmSoundPreference().catch(() => undefined)
                : Promise.resolve(undefined),
        ]).then(([localSoundId, nativeSoundId]) => {
            if (!mountedRef.current || requestId !== soundPreferenceRequestRef.current) return;
            const resolvedSoundId = nativeSoundId ?? localSoundId;
            setSelectedSoundId(resolvedSoundId);
            if (nativeSoundId && nativeSoundId !== localSoundId) {
                setNoLateAlarmSoundPreference(nativeSoundId).catch(() => undefined);
            } else if (!nativeSoundId && typeof setNativeNoLateAlarmSoundPreference === "function") {
                setNativeNoLateAlarmSoundPreference(localSoundId).catch(() => false);
            }
        });

        return () => {
            soundPreferenceRequestRef.current += 1;
        };
    }, [available]);

    const toggleSoundPreview = useCallback(async (soundId: NoLateAlarmSoundId) => {
        if (soundPreviewSessionRef.current && soundPreviewingIdRef.current === soundId) {
            await stopSoundPreview();
            return;
        }

        await stopSoundPreview();
        if (!appStateActiveRef.current || !soundPickerVisibleRef.current || applyingSoundRef.current) return;

        const requestId = soundPreviewRequestRef.current + 1;
        soundPreviewRequestRef.current = requestId;
        setPendingAction("soundPreview");
        setSoundPickerError(null);
        try {
            const { startNoLateCustomAlarmAudio } = require("../../../notification/customAlarmAudio") as typeof import("../../../notification/customAlarmAudio");
            const session = await startNoLateCustomAlarmAudio(soundId);
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
            soundPreviewTimerRef.current = setTimeout(() => {
                stopSoundPreview().catch(() => undefined);
            }, 10_000);
        } catch {
            if (!mountedRef.current || requestId !== soundPreviewRequestRef.current) return;
            setSoundPickerError("소리를 재생하지 못했어요.");
        } finally {
            if (mountedRef.current) {
                setPendingAction(current => (current === "soundPreview" ? null : current));
            }
        }
    }, [stopSoundPreview]);

    const openSoundPicker = useCallback(() => {
        setDraftSoundId(null);
        setSoundPickerError(null);
        soundPickerVisibleRef.current = true;
        setSoundPickerVisible(true);
    }, []);

    const dismissSoundPicker = useCallback(() => {
        soundPickerVisibleRef.current = false;
        setSoundPickerVisible(false);
        stopSoundPreview().catch(() => undefined);
    }, [stopSoundPreview]);

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
            if (!mountedRef.current || requestId !== soundPreferenceRequestRef.current) return;
            setSelectedSoundId(draftSoundId);
            dismissSoundPicker();
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

    const selectedSound = getNoLateAlarmSound(selectedSoundId);
    const soundPreviewDisabled = disabled || pendingAction !== null;

    return (
        <>
            {available ? (
                <Pressable
                    testID="notification-alarm-sound-row"
                    accessibilityRole="button"
                    accessibilityLabel={flat
                        ? `소리 및 진동, 현재 ${selectedSound.label}`
                        : `소리 및 진동, 현재 ${selectedSound.label}, 모든 출발 알람에 적용`}
                    accessibilityState={{
                        disabled: soundPreviewDisabled,
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
                            {flat
                                ? `${selectedSound.label} · 무음일 때는 진동만`
                                : `${selectedSound.label} · 무음일 때는 진동만 · 모든 출발 알람에 적용`}
                        </Text>
                    </View>
                    <Ionicons accessible={false} name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
            ) : null}
            <AlarmSoundPickerSheet
                visible={soundPickerVisible && available}
                selectedSoundId={draftSoundId ?? selectedSoundId}
                previewingSoundId={previewingSoundId}
                applying={pendingAction === "soundPreference"}
                previewLoading={pendingAction === "soundPreview"}
                error={soundPickerError}
                accentColor={accentBlue}
                backgroundColor={colors.background}
                surfaceColor={mode === "dark" ? "#1C1C1E" : "#F6F6F8"}
                borderColor={colors.inputBorder}
                textPrimary={colors.textPrimary}
                textSecondary={colors.textSecondary}
                onSelect={setDraftSoundId}
                onPreview={toggleSoundPreview}
                onApply={applyAlarmSound}
                onClose={closeSoundPicker}
            />
        </>
    );
}
