import React, { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { AppState, Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import type { SubscriptionPolicy } from "../../../../api/subscription";
import {
    getDepartureAlarmCapabilities,
    getNativeNoLateAlarmSoundPreference,
    openExactAlarmSettings,
    openFullScreenAlarmSettings,
    setNativeNoLateAlarmSoundPreference,
    type DepartureAlarmCapabilities,
} from "../../../notification/departureAlarm";
import type { NoLateCustomAlarmAudioSession } from "../../../notification/customAlarmAudio";
import {
    DEFAULT_NOLATE_ALARM_SOUND_ID,
    getNoLateAlarmSound,
    getNoLateAlarmSoundPreference,
    setNoLateAlarmSoundPreference,
    type NoLateAlarmSoundId,
} from "../../../notification/customAlarmSounds";
import { requestPushNotificationPermission } from "../../../notification/pushPermission";
import { useTheme } from "../../../theme/ThemeContext";
import { formatRouteClock, formatRouteDuration, type RouteInfo } from "../../routeInfo";
import { SCHEDULE_ALERT_MODE_PRESENTATION } from "../../scheduleAlertMode";
import type { ScheduleAlertMode } from "../../types";
import AlarmSoundPickerSheet from "./AlarmSoundPickerSheet";

type Props = {
    variant?: "card" | "flat";
    routeReady: boolean;
    enabled: boolean;
    alertMode: ScheduleAlertMode;
    scheduleId?: string;
    leadMinutes: number;
    intervalMinutes: number;
    routeInfo?: RouteInfo;
    startAt?: Date;
    policy: SubscriptionPolicy;
    onEnabledChange: (enabled: boolean) => void;
    onAlertModeChange: (mode: ScheduleAlertMode) => void;
    onLeadMinutesChange: (minutes: number) => void;
    onIntervalMinutesChange: (minutes: number) => void;
};

export default function NotificationSettingsCard({
    variant = "card",
    routeReady,
    enabled,
    alertMode,
    leadMinutes,
    intervalMinutes,
    routeInfo,
    startAt,
    policy,
    onEnabledChange,
    onAlertModeChange,
    onLeadMinutesChange,
    onIntervalMinutesChange,
}: Props) {
    const { colors, mode } = useTheme();
    const [capabilities, setCapabilities] = useState<DepartureAlarmCapabilities | null>(null);
    const [capabilityLoading, setCapabilityLoading] = useState(false);
    const [capabilityError, setCapabilityError] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<
        | "notification"
        | "notificationPermission"
        | "exact"
        | "fullScreen"
        | "soundPreference"
        | "soundPreview"
        | null
    >(null);
    const [alarmFeedback, setAlarmFeedback] = useState<string | null>(null);
    const [selectedSoundId, setSelectedSoundId] = useState<NoLateAlarmSoundId>(DEFAULT_NOLATE_ALARM_SOUND_ID);
    const [previewingSoundId, setPreviewingSoundId] = useState<NoLateAlarmSoundId | null>(null);
    const [soundPickerVisible, setSoundPickerVisible] = useState(false);
    const mountedRef = useRef(false);
    const capabilityRequestRef = useRef(0);
    const soundPreferenceRequestRef = useRef(0);
    const soundPreviewRequestRef = useRef(0);
    const soundPickerGenerationRef = useRef(0);
    const soundPickerVisibleRef = useRef(false);
    const appStateActiveRef = useRef(true);
    const soundPreviewSessionRef = useRef<NoLateCustomAlarmAudioSession | null>(null);
    const soundPreviewingIdRef = useRef<NoLateAlarmSoundId | null>(null);
    const soundPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quotaReached = policy.usedSmartSchedulesThisMonth >= policy.maxSmartSchedulesPerMonth;
    const canEnable = routeReady && !quotaReached;
    const accentBlue = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const selectedBackground = mode === "dark" ? "rgba(75,157,255,0.18)" : "#EAF2FF";
    const warningColor = mode === "dark" ? "#FFBF69" : "#A85C00";
    const routeMinutes = routeInfo?.totalDurationMinutes;
    const eventStartAt = startAt && !Number.isNaN(startAt.getTime()) ? startAt : undefined;
    const recommendedDepartureAt =
        eventStartAt && typeof routeMinutes === "number"
            ? new Date(eventStartAt.getTime() - routeMinutes * 60 * 1000)
            : undefined;
    const arrivalAt = eventStartAt;
    const showAlarmControls = enabled && alertMode === "ALARM";
    const flat = variant === "flat";

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
            soundPickerGenerationRef.current += 1;
            capabilityRequestRef.current += 1;
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

    const refreshCapabilities = useCallback(async () => {
        const requestId = capabilityRequestRef.current + 1;
        capabilityRequestRef.current = requestId;
        if (mountedRef.current) {
            setCapabilityLoading(true);
            setCapabilityError(null);
        }
        try {
            const next = await getDepartureAlarmCapabilities();
            if (mountedRef.current && capabilityRequestRef.current === requestId) {
                setCapabilities(next);
            }
        } catch {
            if (mountedRef.current && capabilityRequestRef.current === requestId) {
                setCapabilities(null);
                setCapabilityError("출발 알람 상태를 불러오지 못했어요.");
            }
        } finally {
            if (mountedRef.current && capabilityRequestRef.current === requestId) {
                setCapabilityLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (!showAlarmControls) {
            capabilityRequestRef.current += 1;
            soundPreferenceRequestRef.current += 1;
            soundPickerGenerationRef.current += 1;
            soundPickerVisibleRef.current = false;
            setAlarmFeedback(null);
            setSoundPickerVisible(false);
            setPendingAction(current =>
                current === "soundPreference" || current === "soundPreview" ? null : current,
            );
            stopSoundPreview().catch(() => undefined);
            return undefined;
        }

        if (AppState.currentState === "active") appStateActiveRef.current = true;
        if (AppState.currentState === "background" || AppState.currentState === "inactive") {
            appStateActiveRef.current = false;
        }
        refreshCapabilities().catch(() => undefined);
        const subscription = AppState.addEventListener("change", state => {
            appStateActiveRef.current = state === "active";
            if (state === "active") {
                refreshCapabilities().catch(() => undefined);
            } else {
                stopSoundPreview().catch(() => undefined);
            }
        });
        return () => {
            subscription.remove();
            capabilityRequestRef.current += 1;
        };
    }, [refreshCapabilities, showAlarmControls, stopSoundPreview]);

    useEffect(() => {
        if (!showAlarmControls) return undefined;
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
    }, [showAlarmControls]);

    const openAlarmSetting = useCallback(async (kind: "notification" | "exact" | "fullScreen") => {
        setPendingAction(kind);
        setAlarmFeedback(null);
        try {
            const opened =
                kind === "notification"
                    ? await Linking.openSettings().then(() => true)
                    : kind === "exact"
                    ? await openExactAlarmSettings()
                    : await openFullScreenAlarmSettings();
            if (!mountedRef.current) return;
            setAlarmFeedback(opened ? null : "설정 화면을 열지 못했어요. 기기 설정에서 NoLate 알림을 열어 주세요.");
        } catch {
            if (!mountedRef.current) return;
            setAlarmFeedback("설정 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.");
        } finally {
            if (mountedRef.current) setPendingAction(null);
        }
    }, []);

    const toggleSoundPreview = useCallback(async (soundId: NoLateAlarmSoundId) => {
        if (soundPreviewSessionRef.current && soundPreviewingIdRef.current === soundId) {
            await stopSoundPreview();
            return;
        }

        await stopSoundPreview();
        if (!appStateActiveRef.current || !soundPickerVisibleRef.current) return;

        const requestId = soundPreviewRequestRef.current + 1;
        soundPreviewRequestRef.current = requestId;
        setPendingAction("soundPreview");
        setAlarmFeedback(null);
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
            setAlarmFeedback("소리를 재생하지 못했어요.");
        } finally {
            if (mountedRef.current) {
                setPendingAction(current => (current === "soundPreview" ? null : current));
            }
        }
    }, [stopSoundPreview]);

    const selectAlarmSound = useCallback(async (soundId: NoLateAlarmSoundId) => {
        if (soundId === selectedSoundId) {
            await toggleSoundPreview(soundId);
            return;
        }

        const previousSoundId = selectedSoundId;
        const requestId = soundPreferenceRequestRef.current + 1;
        const pickerGeneration = soundPickerGenerationRef.current;
        soundPreferenceRequestRef.current = requestId;
        setSelectedSoundId(soundId);
        setPendingAction("soundPreference");
        setAlarmFeedback(null);
        await stopSoundPreview();

        try {
            const nativeSaved = typeof setNativeNoLateAlarmSoundPreference === "function"
                ? await setNativeNoLateAlarmSoundPreference(soundId)
                : false;
            if (!nativeSaved) throw new Error("NATIVE_SOUND_PREFERENCE_UNAVAILABLE");
            await setNoLateAlarmSoundPreference(soundId).catch(() => undefined);
            if (!mountedRef.current || requestId !== soundPreferenceRequestRef.current) return;
            setPendingAction(null);
            if (
                pickerGeneration === soundPickerGenerationRef.current &&
                soundPickerVisibleRef.current &&
                appStateActiveRef.current
            ) {
                await toggleSoundPreview(soundId);
            }
        } catch {
            if (!mountedRef.current || requestId !== soundPreferenceRequestRef.current) return;
            setSelectedSoundId(previousSoundId);
            setAlarmFeedback("알람음을 바꾸지 못했어요.");
            setPendingAction(null);
        }
    }, [selectedSoundId, stopSoundPreview, toggleSoundPreview]);

    const openSoundPicker = useCallback(() => {
        soundPickerGenerationRef.current += 1;
        soundPickerVisibleRef.current = true;
        setSoundPickerVisible(true);
    }, []);

    const closeSoundPicker = useCallback(() => {
        soundPickerGenerationRef.current += 1;
        soundPickerVisibleRef.current = false;
        setSoundPickerVisible(false);
        stopSoundPreview().catch(() => undefined);
    }, [stopSoundPreview]);

    const requestNotificationPermission = useCallback(async () => {
        setPendingAction("notificationPermission");
        setAlarmFeedback(null);
        try {
            await requestPushNotificationPermission();
            if (!mountedRef.current) return;
            await refreshCapabilities();
        } catch {
            if (!mountedRef.current) return;
            setAlarmFeedback("알림 요청을 열지 못했어요. 잠시 후 다시 시도해 주세요.");
        } finally {
            if (mountedRef.current) setPendingAction(null);
        }
    }, [refreshCapabilities]);

    const customAlarmIssue = getCustomAlarmIssue(capabilities);
    const customAlarmIssueActionPending =
        customAlarmIssue?.action === "requestNotification"
            ? pendingAction === "notificationPermission"
            : customAlarmIssue?.action === "openSetting"
            ? pendingAction === customAlarmIssue.settingKind
            : false;
    const customAlarmUnsupported =
        capabilities !== null && (capabilities.supported !== true || capabilities.platform === "other");
    const soundPreviewDisabled = pendingAction !== null;
    const warningBackground = mode === "dark" ? "rgba(255,191,105,0.12)" : "rgba(168,92,0,0.08)";
    const selectedSound = getNoLateAlarmSound(selectedSoundId);

    useEffect(() => {
        if (!customAlarmUnsupported) return;
        soundPickerGenerationRef.current += 1;
        soundPickerVisibleRef.current = false;
        setSoundPickerVisible(false);
        stopSoundPreview().catch(() => undefined);
    }, [customAlarmUnsupported, stopSoundPreview]);

    return (
        <View
            testID={flat ? "notification-settings-flat" : "notification-settings-card"}
            style={[
                styles.container,
                {
                    borderColor: colors.inputBorder,
                    backgroundColor: colors.inputBackground,
                },
                flat && styles.flatContainer,
            ]}
        >
            <View
                testID="notification-settings-toggle-row"
                style={[
                    styles.header,
                    flat && styles.flatHeader,
                    flat && { borderBottomColor: colors.border },
                ]}
            >
                <View style={styles.headerText}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>출발 알림</Text>
                    <Text style={[styles.usage, { color: colors.textSecondary }]}>
                        {flat ? "교통 상황 반영" : "교통 상황을 반영해 출발 시간을 알려드려요."}
                    </Text>
                </View>
                <Switch
                    accessibilityLabel="출발 알림"
                    accessibilityHint={canEnable || enabled ? undefined : "경로 선택 또는 이용 한도 확인이 필요합니다"}
                    value={enabled}
                    disabled={!canEnable && !enabled}
                    onValueChange={onEnabledChange}
                    trackColor={{ false: colors.border, true: accentBlue }}
                    thumbColor="#FFFFFF"
                />
            </View>

            {!routeReady ? (
                <Text style={[styles.notice, { color: colors.textSecondary }]}>경로를 선택하면 설정할 수 있어요.</Text>
            ) : quotaReached && !enabled ? (
                <Text style={[styles.notice, { color: colors.textSecondary }]}>
                    이번 달 알림 일정 한도를 사용했어요.
                </Text>
            ) : null}

            {enabled ? (
                <View style={styles.settings}>
                    {flat ? (
                        <View
                            testID="notification-flat-summary"
                            style={[
                                styles.flatSummaryCard,
                                {
                                    borderColor: colors.inputBorder,
                                    backgroundColor: colors.inputBackground,
                                },
                            ]}
                        >
                            <View style={styles.flatSummaryMain}>
                                <View style={styles.flatSummaryCopy}>
                                    <Text style={[styles.flatSummaryLabel, { color: colors.textSecondary }]}>
                                        추천 출발 시간
                                    </Text>
                                    <Text style={[styles.flatSummaryTime, { color: colors.textPrimary }]}>
                                        {recommendedDepartureAt ? formatRouteClock(recommendedDepartureAt) : "-"}
                                    </Text>
                                    <Text style={[styles.flatSummaryArrival, { color: colors.textSecondary }]}>
                                        {arrivalAt ? `${formatRouteClock(arrivalAt)} 도착 예정` : "도착 시간 미정"}
                                    </Text>
                                </View>
                                <View style={[styles.flatDurationPill, { backgroundColor: colors.border }]}>
                                    <Text style={[styles.flatDurationText, { color: colors.textSecondary }]}>
                                        {`${formatRouteDuration(routeMinutes)} 소요`}
                                    </Text>
                                </View>
                            </View>
                            <View style={[styles.flatSummaryDivider, { backgroundColor: colors.border }]} />
                            <View
                                testID="notification-alert-mode-picker"
                                accessibilityRole="radiogroup"
                                accessibilityLabel="출발 알림 방식"
                                style={[styles.flatModeControl, { backgroundColor: colors.background }]}
                            >
                                <CompactAlarmModeOption
                                    mode="STANDARD"
                                    selected={alertMode === "STANDARD"}
                                    accentBlue={accentBlue}
                                    selectedBackground={selectedBackground}
                                    textSecondary={colors.textSecondary}
                                    onPress={() => onAlertModeChange("STANDARD")}
                                />
                                <CompactAlarmModeOption
                                    mode="ALARM"
                                    selected={alertMode === "ALARM"}
                                    accentBlue={accentBlue}
                                    selectedBackground={selectedBackground}
                                    textSecondary={colors.textSecondary}
                                    onPress={() => onAlertModeChange("ALARM")}
                                />
                            </View>
                        </View>
                    ) : (
                        <>
                            <View
                                style={[
                                    styles.recommendationCard,
                                    {
                                        borderColor: colors.inputBorder,
                                        backgroundColor: colors.inputBackground,
                                    },
                                ]}
                            >
                            <View style={styles.recommendationCol}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>추천 출발</Text>
                                <Text style={[styles.recommendationValue, { color: colors.textPrimary }]}>
                                    {recommendedDepartureAt ? formatRouteClock(recommendedDepartureAt) : "-"}
                                </Text>
                            </View>
                            <View style={[styles.recommendationDivider, { backgroundColor: colors.border }]} />
                            <View style={styles.recommendationCol}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>도착 예정</Text>
                                <Text style={[styles.recommendationValue, { color: colors.textPrimary }]}>
                                    {arrivalAt ? formatRouteClock(arrivalAt) : "-"}
                                </Text>
                            </View>
                            </View>
                            <View style={styles.reminderMetaRow}>
                            <Text style={[styles.description, styles.reminderMetaText, { color: colors.textSecondary }]}>
                                {`${formatRouteDuration(routeMinutes)} 소요 · ${leadMinutes}분 전부터 ${intervalMinutes}분 간격 확인`}
                            </Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="추천 알림 설정 적용"
                                onPress={() => {
                                    onLeadMinutesChange(Math.min(60, policy.maxNotificationLeadMinutes));
                                    onIntervalMinutesChange(Math.max(intervalMinutes, policy.minEtaRefreshIntervalMinutes));
                                }}
                                style={[styles.useButton, { borderColor: accentBlue }]}
                            >
                                <Text style={[styles.useButtonText, { color: accentBlue }]}>추천 설정 적용</Text>
                            </Pressable>
                        </View>

                        <View
                            style={[styles.modeSection, { borderTopColor: colors.border }]}
                        >
                            <View style={styles.modeHeading}>
                                <Text style={[styles.modeHeadingTitle, { color: colors.textPrimary }]}>알림 방식</Text>
                            </View>
                            <View
                                testID="notification-alert-mode-picker"
                                accessibilityRole="radiogroup"
                                accessibilityLabel="출발 알림 방식"
                                style={[
                                    styles.modeRow,
                                    {
                                        borderColor: colors.inputBorder,
                                        backgroundColor: colors.inputBackground,
                                    },
                                ]}
                            >
                                <AlarmModeOption
                                    mode="STANDARD"
                                    selected={alertMode === "STANDARD"}
                                    accentBlue={accentBlue}
                                    selectedBackground={selectedBackground}
                                    borderColor={colors.inputBorder}
                                    textPrimary={colors.textPrimary}
                                    textSecondary={colors.textSecondary}
                                    onPress={() => onAlertModeChange("STANDARD")}
                                />
                                <AlarmModeOption
                                    mode="ALARM"
                                    selected={alertMode === "ALARM"}
                                    accentBlue={accentBlue}
                                    selectedBackground={selectedBackground}
                                    borderColor={colors.inputBorder}
                                    textPrimary={colors.textPrimary}
                                    textSecondary={colors.textSecondary}
                                    onPress={() => onAlertModeChange("ALARM")}
                                />
                            </View>
                        </View>
                        </>
                    )}

                    {!flat && alertMode === "ALARM" ? (
                        <View
                            accessible
                            accessibilityLabel="교통 상황이 바뀌면 푸시로 알려드려요"
                            style={styles.modeFootnote}
                        >
                            <Ionicons accessible={false} name="notifications-outline" size={16} color={accentBlue} />
                            <Text style={[styles.modeFootnoteText, { color: colors.textSecondary }]}>
                                교통 상황이 바뀌면 푸시로 알려드려요.
                            </Text>
                        </View>
                    ) : null}

                    {showAlarmControls ? (
                        <View testID="notification-alarm-simple-controls" style={styles.flatAlarmPanel}>
                            {customAlarmUnsupported ? (
                                <View
                                    testID="notification-alarm-unavailable"
                                    style={[styles.flatAlarmIssueRow, { backgroundColor: warningBackground }]}
                                >
                                    <View
                                        style={[styles.flatAlarmIssueIcon, { backgroundColor: colors.inputBackground }]}
                                    >
                                        <Ionicons
                                            accessible={false}
                                            name="alert-circle-outline"
                                            size={19}
                                            color={warningColor}
                                        />
                                    </View>
                                    <View style={styles.flatAlarmIssueCopy}>
                                        <Text style={[styles.flatAlarmIssueTitle, { color: colors.textPrimary }]}>
                                            출발 알람을 사용할 수 없어요
                                        </Text>
                                        <Text
                                            style={[styles.flatAlarmIssueDescription, { color: colors.textSecondary }]}
                                        >
                                            푸시 알림으로 바꿔 주세요.
                                        </Text>
                                    </View>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="푸시 알림으로 전환"
                                        hitSlop={8}
                                        onPress={() => onAlertModeChange("STANDARD")}
                                        style={({ pressed }) => [
                                            styles.flatAlarmIssueAction,
                                            pressed && styles.pressedRow,
                                        ]}
                                    >
                                        <Text style={[styles.flatAlarmIssueActionText, { color: accentBlue }]}>
                                            푸시로 전환
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : null}

                            {customAlarmIssue ? (
                                <View
                                    testID="notification-alarm-setting-notice"
                                    style={[
                                        styles.flatAlarmIssueRow,
                                        {
                                            backgroundColor:
                                                customAlarmIssue.tone === "notice"
                                                    ? selectedBackground
                                                    : warningBackground,
                                        },
                                    ]}
                                >
                                    <View
                                        style={[styles.flatAlarmIssueIcon, { backgroundColor: colors.inputBackground }]}
                                    >
                                        <Ionicons
                                            accessible={false}
                                            name={
                                                customAlarmIssue.tone === "notice"
                                                    ? "notifications-outline"
                                                    : "volume-mute-outline"
                                            }
                                            size={19}
                                            color={customAlarmIssue.tone === "notice" ? accentBlue : warningColor}
                                        />
                                    </View>
                                    <View style={styles.flatAlarmIssueCopy}>
                                        <Text style={[styles.flatAlarmIssueTitle, { color: colors.textPrimary }]}>
                                            {customAlarmIssue.title}
                                        </Text>
                                        <Text
                                            style={[styles.flatAlarmIssueDescription, { color: colors.textSecondary }]}
                                        >
                                            {customAlarmIssue.description}
                                        </Text>
                                    </View>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={customAlarmIssue.accessibilityLabel}
                                        accessibilityState={{ busy: customAlarmIssueActionPending }}
                                        hitSlop={8}
                                        disabled={pendingAction !== null}
                                        onPress={() => {
                                            if (customAlarmIssue.action === "requestNotification") {
                                                requestNotificationPermission().catch(() => undefined);
                                            } else {
                                                openAlarmSetting(customAlarmIssue.settingKind).catch(() => undefined);
                                            }
                                        }}
                                        style={({ pressed }) => [
                                            styles.flatAlarmIssueAction,
                                            pressed && pendingAction === null && styles.pressedRow,
                                        ]}
                                    >
                                        <Text style={[styles.flatAlarmIssueActionText, { color: accentBlue }]}>
                                            {customAlarmIssueActionPending
                                                ? customAlarmIssue.action === "requestNotification"
                                                    ? "요청 중"
                                                    : "여는 중"
                                                : customAlarmIssue.actionLabel}
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : null}

                            {capabilityError && !capabilityLoading ? (
                                <View
                                    testID="notification-alarm-load-error"
                                    style={[styles.flatAlarmIssueRow, { backgroundColor: colors.inputBackground }]}
                                >
                                    <View style={[styles.flatAlarmIssueIcon, { backgroundColor: selectedBackground }]}>
                                        <Ionicons
                                            accessible={false}
                                            name="refresh-outline"
                                            size={19}
                                            color={colors.textSecondary}
                                        />
                                    </View>
                                    <View style={styles.flatAlarmIssueCopy}>
                                        <Text style={[styles.flatAlarmIssueTitle, { color: colors.textPrimary }]}>
                                            출발 알람을 확인하지 못했어요
                                        </Text>
                                        <Text
                                            style={[styles.flatAlarmIssueDescription, { color: colors.textSecondary }]}
                                        >
                                            잠시 후 다시 시도해 주세요.
                                        </Text>
                                    </View>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="출발 알람 다시 확인"
                                        hitSlop={8}
                                        disabled={capabilityLoading}
                                        onPress={() => {
                                            refreshCapabilities().catch(() => undefined);
                                        }}
                                        style={({ pressed }) => [
                                            styles.flatAlarmIssueAction,
                                            pressed && styles.pressedRow,
                                        ]}
                                    >
                                        <Text style={[styles.flatAlarmIssueActionText, { color: accentBlue }]}>
                                            다시 시도
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : null}

                            {!customAlarmUnsupported ? (
                                <Pressable
                                    testID="notification-alarm-sound-row"
                                    accessibilityRole="button"
                                    accessibilityLabel={flat
                                        ? `알림음, 현재 ${selectedSound.label}`
                                        : `알람음, 현재 ${selectedSound.label}, 모든 출발 알람에 적용`}
                                    accessibilityState={{
                                        disabled: soundPreviewDisabled,
                                    }}
                                    disabled={soundPreviewDisabled}
                                    onPress={openSoundPicker}
                                    style={({ pressed }) => [
                                        styles.flatTestRow,
                                        {
                                            borderColor: colors.inputBorder,
                                            backgroundColor: colors.inputBackground,
                                        },
                                        soundPreviewDisabled && styles.disabledButton,
                                        pressed && !soundPreviewDisabled && styles.pressedRow,
                                    ]}
                                >
                                    <View style={[styles.flatTestIcon, { backgroundColor: selectedBackground }]}>
                                        <Ionicons
                                            accessible={false}
                                            name="musical-notes-outline"
                                            size={20}
                                            color={accentBlue}
                                        />
                                    </View>
                                    <View style={styles.flatTestCopy}>
                                        <Text style={[styles.flatTestTitle, { color: colors.textPrimary }]}>
                                            {flat ? "알림음" : "알람음"}
                                        </Text>
                                        <Text style={[styles.flatTestDescription, { color: colors.textSecondary }]}>
                                            {flat ? selectedSound.label : `${selectedSound.label} · 모든 출발 알람에 적용`}
                                        </Text>
                                    </View>
                                    <Ionicons accessible={false} name="chevron-forward" size={20} color={colors.textSecondary} />
                                </Pressable>
                            ) : null}

                            {alarmFeedback ? (
                                <Text
                                    accessibilityLiveRegion="polite"
                                    style={[styles.feedback, { color: colors.textSecondary }]}
                                >
                                    {alarmFeedback}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                </View>
            ) : null}
            <AlarmSoundPickerSheet
                visible={soundPickerVisible && !customAlarmUnsupported}
                selectedSoundId={selectedSoundId}
                previewingSoundId={previewingSoundId}
                busy={pendingAction === "soundPreference" || pendingAction === "soundPreview"}
                accentColor={accentBlue}
                backgroundColor={colors.background}
                surfaceColor={mode === "dark" ? "#1C1C1E" : "#F6F6F8"}
                borderColor={colors.inputBorder}
                textPrimary={colors.textPrimary}
                textSecondary={colors.textSecondary}
                onSelect={soundId => {
                    selectAlarmSound(soundId).catch(() => undefined);
                }}
                onClose={closeSoundPicker}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
    },
    flatContainer: {
        borderWidth: 0,
        borderRadius: 0,
        padding: 0,
        marginBottom: 20,
        backgroundColor: "transparent",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 38,
    },
    flatHeader: {
        minHeight: 52,
        borderBottomWidth: 0,
        paddingHorizontal: 0,
        paddingBottom: 8,
    },
    headerText: { flex: 1, paddingRight: 12 },
    title: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
    usage: { marginTop: 3, fontSize: 11.5, lineHeight: 16, fontWeight: "600" },
    notice: { marginTop: 10, fontSize: 12 },
    settings: { marginTop: 14 },
    label: { marginBottom: 7, fontSize: 12, fontWeight: "600" },
    description: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
    modeSection: {
        marginTop: 16,
        paddingTop: 14,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    flatModeSection: {
        marginTop: 22,
        paddingTop: 0,
        borderTopWidth: 0,
    },
    flatSummaryCard: {
        borderWidth: 1,
        borderRadius: 16,
        overflow: "hidden",
    },
    flatSummaryMain: {
        minHeight: 96,
        paddingHorizontal: 13,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    flatSummaryCopy: {
        flex: 1,
        minWidth: 0,
    },
    flatSummaryLabel: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "700",
    },
    flatSummaryTime: {
        marginTop: 2,
        fontSize: 21,
        lineHeight: 27,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
    },
    flatSummaryArrival: {
        marginTop: 2,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    flatDurationPill: {
        minHeight: 28,
        borderRadius: 999,
        paddingHorizontal: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    flatDurationText: {
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "800",
    },
    flatSummaryDivider: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: 13,
    },
    flatModeControl: {
        minHeight: 42,
        margin: 10,
        borderRadius: 12,
        padding: 3,
        flexDirection: "row",
        alignItems: "stretch",
        gap: 3,
    },
    compactModeButton: {
        flex: 1,
        minWidth: 0,
        minHeight: 36,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
    },
    compactModeText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "800",
    },
    flatModePicker: {
        borderWidth: 1,
        borderRadius: 16,
        overflow: "hidden",
    },
    flatModeSummary: {
        minHeight: 82,
        paddingHorizontal: 13,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    flatModeSummaryIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    flatModeSummaryCopy: {
        flex: 1,
        minWidth: 0,
    },
    flatModeSummaryLabel: {
        marginBottom: 2,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: "700",
    },
    flatModeSummaryValue: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "800",
    },
    flatModeSummaryDescription: {
        marginTop: 4,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
    flatModeOptions: {
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    flatModeOption: {
        minHeight: 66,
        paddingHorizontal: 13,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    flatModeOptionIcon: {
        width: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
    },
    flatModeOptionCopy: {
        flex: 1,
        minWidth: 0,
    },
    flatModeOptionTitle: {
        fontSize: 13.5,
        lineHeight: 18,
        fontWeight: "800",
    },
    flatModeOptionDescription: {
        marginTop: 2,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    flatModeDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 55,
    },
    pressedRow: {
        opacity: 0.68,
    },
    modeHeading: {
        marginBottom: 10,
    },
    modeHeadingTitle: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: "900",
    },
    modeRow: {
        borderWidth: 1,
        borderRadius: 16,
        overflow: "hidden",
    },
    modeButton: {
        minHeight: 76,
        paddingHorizontal: 14,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    modeIcon: {
        width: 36,
        height: 36,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
    },
    modeCopy: {
        flex: 1,
        minWidth: 0,
    },
    modeTitleRow: {
        flexDirection: "row",
        alignItems: "center",
    },
    modeTitle: {
        fontSize: 14,
        lineHeight: 19,
        fontWeight: "800",
    },
    modeDescription: {
        marginTop: 3,
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: "600",
    },
    modeFootnote: {
        minHeight: 38,
        paddingHorizontal: 4,
        paddingTop: 10,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 7,
    },
    modeFootnoteText: {
        flex: 1,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
    pushActionPanel: {
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 11,
        marginBottom: 12,
    },
    flatPushOutcome: {
        minHeight: 42,
        marginTop: 10,
        marginBottom: 2,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
    },
    flatPushOutcomeText: {
        flex: 1,
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: "700",
    },
    pushActionHeading: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    pushActionTitle: {
        fontSize: 11.5,
        lineHeight: 16,
        fontWeight: "900",
    },
    pushActionList: {
        marginTop: 8,
        gap: 6,
    },
    pushActionItem: {
        minHeight: 23,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    pushActionLabel: {
        width: 62,
        fontSize: 10.5,
        fontWeight: "700",
    },
    pushActionValue: {
        flex: 1,
        fontSize: 10.5,
        fontWeight: "900",
    },
    alarmPanel: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 13,
        marginBottom: 12,
    },
    flatAlarmPanel: {
        borderWidth: 0,
        borderRadius: 0,
        paddingHorizontal: 0,
        paddingTop: 6,
        paddingBottom: 0,
    },
    flatAlarmIssueRow: {
        minHeight: 68,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    flatAlarmIssueIcon: {
        width: 34,
        height: 34,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
    },
    flatAlarmIssueCopy: {
        flex: 1,
        minWidth: 0,
    },
    flatAlarmIssueTitle: {
        fontSize: 12.5,
        lineHeight: 18,
        fontWeight: "800",
    },
    flatAlarmIssueDescription: {
        marginTop: 2,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    flatAlarmIssueAction: {
        minHeight: 44,
        paddingHorizontal: 4,
        justifyContent: "center",
    },
    flatAlarmIssueActionText: {
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "800",
    },
    alarmPanelHeader: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
    },
    alarmPanelCopy: {
        flex: 1,
    },
    alarmStatusTitle: {
        fontSize: 13,
        fontWeight: "900",
    },
    alarmStatusDescription: {
        marginTop: 4,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
    compactButton: {
        minWidth: 64,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        alignItems: "center",
    },
    compactButtonText: {
        fontSize: 10,
        fontWeight: "800",
    },
    permissionList: {
        marginTop: 10,
        gap: 6,
    },
    permissionRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    permissionLabel: {
        fontSize: 11,
        fontWeight: "600",
    },
    permissionValue: {
        fontSize: 11,
        fontWeight: "800",
    },
    actionRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 11,
    },
    actionButton: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 11,
        paddingVertical: 7,
    },
    actionButtonText: {
        fontSize: 11,
        fontWeight: "800",
    },
    testButton: {
        marginTop: 11,
        minHeight: 44,
        borderWidth: 1,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 12,
    },
    testButtonText: {
        fontSize: 12,
        fontWeight: "900",
    },
    flatTestRow: {
        minHeight: 62,
        marginTop: 4,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    flatTestIcon: {
        width: 36,
        height: 36,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    flatTestCopy: {
        flex: 1,
        minWidth: 0,
    },
    flatTestTitle: {
        fontSize: 12.5,
        lineHeight: 18,
        fontWeight: "800",
    },
    flatTestDescription: {
        marginTop: 2,
        fontSize: 10.5,
        lineHeight: 15,
        fontWeight: "600",
    },
    testHelperRow: {
        marginTop: 8,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 5,
    },
    testHelperText: {
        flex: 1,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "600",
    },
    disabledButton: {
        opacity: 0.45,
    },
    feedback: {
        marginTop: 9,
        fontSize: 11,
        lineHeight: 16,
        fontWeight: "600",
    },
    recommendationCard: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 13,
        flexDirection: "row",
        gap: 14,
    },
    flatRecommendationCard: {
        borderWidth: 0,
        borderRadius: 0,
        padding: 0,
        gap: 10,
        backgroundColor: "transparent",
    },
    recommendationCol: {
        flex: 1,
    },
    flatRecommendationField: {
        minHeight: 76,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 13,
        paddingVertical: 11,
        justifyContent: "center",
    },
    recommendationValue: {
        fontSize: 17,
        lineHeight: 22,
        fontWeight: "900",
    },
    recommendationDivider: {
        width: StyleSheet.hairlineWidth,
    },
    reminderMetaRow: {
        marginTop: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    reminderMetaText: {
        flex: 1,
        minWidth: 0,
    },
    useButton: {
        minHeight: 44,
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 10,
        justifyContent: "center",
    },
    useButtonText: {
        fontSize: 11,
        fontWeight: "800",
    },
});

function CompactAlarmModeOption({
    mode,
    selected,
    accentBlue,
    selectedBackground,
    textSecondary,
    onPress,
}: {
    mode: ScheduleAlertMode;
    selected: boolean;
    accentBlue: string;
    selectedBackground: string;
    textSecondary: string;
    onPress: () => void;
}) {
    const presentation = SCHEDULE_ALERT_MODE_PRESENTATION[mode];

    return (
        <Pressable
            testID={`notification-alert-mode-${mode.toLowerCase()}`}
            accessibilityRole="radio"
            accessibilityLabel={presentation.accessibilityLabel}
            accessibilityHint={presentation.description}
            accessibilityState={{ checked: selected }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.compactModeButton,
                {
                    backgroundColor: selected ? selectedBackground : "transparent",
                    opacity: pressed ? 0.65 : 1,
                },
            ]}
        >
            <Text
                style={[
                    styles.compactModeText,
                    { color: selected ? accentBlue : textSecondary },
                ]}
            >
                {presentation.label}
            </Text>
        </Pressable>
    );
}

function AlarmModeOption({
    mode,
    selected,
    accentBlue,
    selectedBackground,
    borderColor,
    textPrimary,
    textSecondary,
    onPress,
}: {
    mode: ScheduleAlertMode;
    selected: boolean;
    accentBlue: string;
    selectedBackground: string;
    borderColor: string;
    textPrimary: string;
    textSecondary: string;
    onPress: () => void;
}) {
    const presentation = SCHEDULE_ALERT_MODE_PRESENTATION[mode];

    return (
        <Pressable
            testID={`notification-alert-mode-${mode.toLowerCase()}`}
            accessibilityRole="radio"
            accessibilityLabel={presentation.accessibilityLabel}
            accessibilityHint={presentation.description}
            accessibilityState={{ checked: selected }}
            onPress={onPress}
            style={({ pressed }) => [
                styles.modeButton,
                {
                    borderBottomWidth: mode === "STANDARD" ? StyleSheet.hairlineWidth : 0,
                    borderBottomColor: borderColor,
                    backgroundColor: selected ? selectedBackground : "transparent",
                    opacity: pressed ? 0.7 : 1,
                },
            ]}
        >
            <View style={[styles.modeIcon, { backgroundColor: selected ? accentBlue : selectedBackground }]}>
                <Ionicons
                    accessible={false}
                    name={mode === "ALARM" ? "alarm-outline" : "notifications-outline"}
                    size={20}
                    color={selected ? "#FFFFFF" : accentBlue}
                />
            </View>
            <View style={styles.modeCopy}>
                <View style={styles.modeTitleRow}>
                    <Text style={[styles.modeTitle, { color: textPrimary }]}>{presentation.label}</Text>
                </View>
                <Text style={[styles.modeDescription, { color: textSecondary }]}>{presentation.description}</Text>
            </View>
            <Ionicons
                accessible={false}
                name={selected ? "checkmark-circle" : "ellipse-outline"}
                size={21}
                color={selected ? accentBlue : textSecondary}
            />
        </Pressable>
    );
}

type AlarmSettingKind = "notification" | "exact" | "fullScreen";

type CustomAlarmIssue = {
    title: string;
    description: string;
    tone: "notice" | "warning";
    accessibilityLabel: string;
} & (
    | {
          action: "requestNotification";
          actionLabel: "알림 켜기";
      }
    | {
          action: "openSetting";
          actionLabel: "설정 열기";
          settingKind: AlarmSettingKind;
      }
);

function createNotificationRequestIssue(): CustomAlarmIssue {
    return {
        title: "알림을 켜 주세요",
        description: "출발 알람을 받으려면 알림 허용이 필요해요.",
        tone: "notice",
        action: "requestNotification",
        actionLabel: "알림 켜기",
        accessibilityLabel: "알림을 켜 주세요, 알림 켜기",
    };
}

function createSettingsIssue({
    title,
    description,
    settingKind,
}: {
    title: string;
    description: string;
    settingKind: AlarmSettingKind;
}): CustomAlarmIssue {
    return {
        title,
        description,
        tone: "warning",
        action: "openSetting",
        actionLabel: "설정 열기",
        settingKind,
        accessibilityLabel: `${title}, 설정 열기`,
    };
}

function getCustomAlarmIssue(capabilities: DepartureAlarmCapabilities | null): CustomAlarmIssue | null {
    if (!capabilities?.supported) return null;

    if (capabilities.platform === "android") {
        if (!capabilities.notificationAuthorized) {
            return createSettingsIssue({
                title: "알림이 꺼져 있어요",
                description: "출발 알람을 받으려면 앱 알림을 켜 주세요.",
                settingKind: "notification",
            });
        }
        if (!capabilities.exactAlarmAuthorized) {
            return createSettingsIssue({
                title: "예약 시각 알림을 켜 주세요",
                description: "제시간에 울리도록 기기 설정을 확인해 주세요.",
                settingKind: "exact",
            });
        }
        if (!capabilities.fullScreenAuthorized) {
            return createSettingsIssue({
                title: "알람 화면 표시를 켜 주세요",
                description: "잠금 화면에 알람을 띄우려면 켜 주세요.",
                settingKind: "fullScreen",
            });
        }
        return null;
    }

    if (capabilities.platform !== "ios") return null;

    if (capabilities.notificationAuthorization === "notDetermined") {
        return createNotificationRequestIssue();
    }
    if (
        !capabilities.notificationAuthorized ||
        capabilities.notificationAuthorization === "denied" ||
        capabilities.notificationAuthorization === "unknown" ||
        capabilities.reason === "NOTIFICATION_ALERTS_DISABLED"
    ) {
        return createSettingsIssue({
            title: "알림이 꺼져 있어요",
            description: "출발 알람을 받으려면 알림을 켜 주세요.",
            settingKind: "notification",
        });
    }
    if (capabilities.soundAuthorization === "disabled" || capabilities.reason === "SOUND_DISABLED") {
        return createSettingsIssue({
            title: "알림 소리가 꺼져 있어요",
            description: "기기 설정에서 알림 소리를 켜 주세요.",
            settingKind: "notification",
        });
    }
    return null;
}
