import styles from "./NotificationSettingsCard.styles";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { AppState, Linking, Pressable, Switch, Text, View } from "react-native";

import {
    getDepartureAlarmCapabilities,
    getNativeNoLateAlarmSoundPreference,
    openExactAlarmSettings,
    openFullScreenAlarmSettings,
    openNotificationSettings,
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
import { requestPushPermissionAndRegisterCurrentDevice } from "../../../notification/pushPermission";
import { useTheme } from "../../../theme/ThemeContext";
import { formatRouteClock, formatRouteDuration } from "../../routeInfo";
import AlarmSoundPickerSheet from "./AlarmSoundPickerSheet";
import { AlarmModeOption, CompactAlarmModeOption } from "./NotificationAlertModeOptions";
import type { NotificationSettingsCardProps as Props } from "./NotificationSettingsCard.types";
import { getCustomAlarmIssue, getNotificationPermissionIssue } from "./notificationAlarmIssues";
import { getNotificationRouteTiming, getNotificationSettingsPalette } from "./notificationSettingsPalette";

/** 출발 알림의 활성화·방식·권한·알람음을 한곳에서 설정하도록 전체 상호작용을 조율합니다. */
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
    const {
        accentBlue,
        selectedBackground,
        segmentedTrackBackground,
        segmentedSelectedBackground,
        segmentedUnselectedText,
        inactiveSwitchTrack,
        subtleAccentBackground,
        warningColor,
    } = getNotificationSettingsPalette({ dark: mode === "dark", surface: colors.surface });
    const routeMinutes = routeInfo?.totalDurationMinutes;
    const { recommendedDepartureAt, arrivalAt } = getNotificationRouteTiming(routeMinutes, startAt);
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
        if (!enabled) {
            capabilityRequestRef.current += 1;
            setCapabilities(null);
            setCapabilityError(null);
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
    }, [enabled, refreshCapabilities, stopSoundPreview]);

    useEffect(() => {
        if (showAlarmControls) return;
        soundPreferenceRequestRef.current += 1;
        soundPickerGenerationRef.current += 1;
        soundPickerVisibleRef.current = false;
        setSoundPickerVisible(false);
        setPendingAction(current =>
            current === "soundPreference" || current === "soundPreview" ? null : current,
        );
        stopSoundPreview().catch(() => undefined);
    }, [showAlarmControls, stopSoundPreview]);

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
                    ? (await openNotificationSettings().catch(() => false)) ||
                        (await Linking.openSettings().then(() => true))
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
            const granted = await requestPushPermissionAndRegisterCurrentDevice();
            if (!mountedRef.current) return;
            await refreshCapabilities();
            if (!granted && mountedRef.current) {
                setAlarmFeedback("알림을 허용해야 출발 알림을 받을 수 있어요.");
            }
        } catch {
            if (!mountedRef.current) return;
            await refreshCapabilities().catch(() => undefined);
            if (!mountedRef.current) return;
            setAlarmFeedback("알림 권한은 확인했지만 기기 등록을 마치지 못했어요. 잠시 후 다시 시도해 주세요.");
        } finally {
            if (mountedRef.current) setPendingAction(null);
        }
    }, [refreshCapabilities]);

    const notificationPermissionIssue = getNotificationPermissionIssue(capabilities);
    const alarmSpecificIssue = showAlarmControls ? getCustomAlarmIssue(capabilities) : null;
    const visibleNotificationIssue = notificationPermissionIssue ?? alarmSpecificIssue;
    const visibleNotificationIssueActionPending =
        visibleNotificationIssue?.action === "requestNotification"
            ? pendingAction === "notificationPermission"
            : visibleNotificationIssue?.action === "openSetting"
            ? pendingAction === visibleNotificationIssue.settingKind
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
                    borderColor: colors.border,
                    backgroundColor: colors.surface2,
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
                    <Text style={[styles.title, { color: colors.textPrimary }]}>
                        {flat ? "알림" : "출발 알림"}
                    </Text>
                    {!flat ? (
                        <Text style={[styles.usage, { color: colors.textSecondary }]}>
                            교통 상황을 반영해 출발 시간을 알려드려요.
                        </Text>
                    ) : null}
                </View>
                <Switch
                    accessibilityLabel={flat ? "출발 알림 사용" : "출발 알림"}
                    accessibilityHint={canEnable || enabled ? undefined : "경로 선택 또는 이용 한도 확인이 필요합니다"}
                    value={enabled}
                    disabled={!canEnable && !enabled}
                    onValueChange={onEnabledChange}
                    trackColor={{ false: inactiveSwitchTrack, true: accentBlue }}
                    thumbColor="#FFFFFF"
                    style={styles.compactSwitch}
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
                                    borderColor: colors.border,
                                    backgroundColor: colors.surface2,
                                },
                            ]}
                        >
                            <View testID="notification-flat-summary-main" style={styles.flatSummaryMain}>
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
                                style={[
                                    styles.flatModeControl,
                                    { backgroundColor: segmentedTrackBackground },
                                ]}
                            >
                                <CompactAlarmModeOption
                                    mode="STANDARD"
                                    selected={alertMode === "STANDARD"}
                                    accentBlue={accentBlue}
                                    selectedBackground={segmentedSelectedBackground}
                                    textSecondary={segmentedUnselectedText}
                                    onPress={() => onAlertModeChange("STANDARD")}
                                />
                                <CompactAlarmModeOption
                                    mode="ALARM"
                                    selected={alertMode === "ALARM"}
                                    accentBlue={accentBlue}
                                    selectedBackground={segmentedSelectedBackground}
                                    textSecondary={segmentedUnselectedText}
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

                    {visibleNotificationIssue ? (
                        <View
                            testID={notificationPermissionIssue
                                ? "notification-permission-notice"
                                : "notification-alarm-setting-notice"}
                            style={[
                                styles.flatAlarmIssueRow,
                                styles.notificationIssueRow,
                                {
                                    backgroundColor:
                                        visibleNotificationIssue.tone === "notice"
                                            ? selectedBackground
                                            : warningBackground,
                                },
                            ]}
                        >
                            <View style={[styles.flatAlarmIssueIcon, { backgroundColor: colors.inputBackground }]}>
                                <Ionicons
                                    accessible={false}
                                    name={
                                        visibleNotificationIssue.tone === "notice"
                                            ? "notifications-outline"
                                            : "volume-mute-outline"
                                    }
                                    size={19}
                                    color={visibleNotificationIssue.tone === "notice" ? accentBlue : warningColor}
                                />
                            </View>
                            <View style={styles.flatAlarmIssueCopy}>
                                <Text style={[styles.flatAlarmIssueTitle, { color: colors.textPrimary }]}>
                                    {visibleNotificationIssue.title}
                                </Text>
                                <Text style={[styles.flatAlarmIssueDescription, { color: colors.textSecondary }]}>
                                    {visibleNotificationIssue.description}
                                </Text>
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={visibleNotificationIssue.accessibilityLabel}
                                accessibilityState={{ busy: visibleNotificationIssueActionPending }}
                                hitSlop={8}
                                disabled={pendingAction !== null}
                                onPress={() => {
                                    if (visibleNotificationIssue.action === "requestNotification") {
                                        requestNotificationPermission().catch(() => undefined);
                                    } else {
                                        openAlarmSetting(visibleNotificationIssue.settingKind).catch(() => undefined);
                                    }
                                }}
                                style={({ pressed }) => [
                                    styles.flatAlarmIssueAction,
                                    pressed && pendingAction === null && styles.pressedRow,
                                ]}
                            >
                                <Text style={[styles.flatAlarmIssueActionText, { color: accentBlue }]}>
                                    {visibleNotificationIssueActionPending
                                        ? visibleNotificationIssue.action === "requestNotification"
                                            ? "요청 중"
                                            : "여는 중"
                                        : visibleNotificationIssue.actionLabel}
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {capabilityError && !capabilityLoading ? (
                        <View
                            testID="notification-permission-load-error"
                            style={[
                                styles.flatAlarmIssueRow,
                                styles.notificationIssueRow,
                                { backgroundColor: colors.inputBackground },
                            ]}
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
                                    알림 권한을 확인하지 못했어요
                                </Text>
                                <Text style={[styles.flatAlarmIssueDescription, { color: colors.textSecondary }]}>
                                    잠시 후 다시 확인해 주세요.
                                </Text>
                            </View>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="알림 권한 다시 확인"
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
                                <Text style={[styles.flatAlarmIssueActionText, { color: accentBlue }]}>다시 확인</Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {alarmFeedback ? (
                        <Text
                            accessibilityLiveRegion="polite"
                            style={[styles.feedback, { color: colors.textSecondary }]}
                        >
                            {alarmFeedback}
                        </Text>
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
                                            {flat ? "알림음" : "알람음"}
                                        </Text>
                                        <Text style={[styles.flatTestDescription, { color: colors.textSecondary }]}>
                                            {flat ? selectedSound.label : `${selectedSound.label} · 모든 출발 알람에 적용`}
                                        </Text>
                                    </View>
                                    <Ionicons accessible={false} name="chevron-forward" size={16} color={colors.textSecondary} />
                                </Pressable>
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
