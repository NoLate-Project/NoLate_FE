import styles from "./NotificationSettingsCard.styles";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { AppState, Linking, Pressable, Switch, Text, View } from "react-native";

import {
    getDepartureAlarmCapabilities,
    openExactAlarmSettings,
    openFullScreenAlarmSettings,
    openNotificationSettings,
    type DepartureAlarmCapabilities,
} from "../../../notification/departureAlarm";
import { requestPushPermissionAndRegisterCurrentDevice } from "../../../notification/pushPermission";
import { useTheme } from "../../../theme/ThemeContext";
import { formatRouteClock, formatRouteDuration, isOdsayTimetableRouteInfo, roundRouteArrivalMinute } from "../../routeInfo";
import AlarmSoundSettings from "./AlarmSoundSettings";
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
    routePlannedArrivalAt,
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
        | null
    >(null);
    const [alarmFeedback, setAlarmFeedback] = useState<string | null>(null);
    const mountedRef = useRef(false);
    const capabilityRequestRef = useRef(0);
    const canEnable = routeReady;
    const {
        accentBlue,
        selectedBackground,
        segmentedTrackBackground,
        segmentedSelectedBackground,
        segmentedUnselectedText,
        inactiveSwitchTrack,
        warningColor,
    } = getNotificationSettingsPalette({ dark: mode === "dark", surface: colors.surface });
    const routeMinutes = routeInfo?.totalDurationMinutes;
    const { recommendedDepartureAt, arrivalAt } = getNotificationRouteTiming(routeInfo, startAt, routePlannedArrivalAt);
    const arrivalText = formatRouteClock(isOdsayTimetableRouteInfo(routeInfo) ? roundRouteArrivalMinute(arrivalAt) : arrivalAt);
    const showAlarmControls = enabled && alertMode === "ALARM";
    const flat = variant === "flat";

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            capabilityRequestRef.current += 1;
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
        refreshCapabilities().catch(() => undefined);
        const subscription = AppState.addEventListener("change", state => {
            if (state === "active") refreshCapabilities().catch(() => undefined);
        });
        return () => {
            subscription.remove();
            capabilityRequestRef.current += 1;
        };
    }, [enabled, refreshCapabilities]);

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
    const warningBackground = mode === "dark" ? "rgba(255,191,105,0.12)" : "rgba(168,92,0,0.08)";

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
                        출발 알림
                    </Text>
                    {!flat ? (
                        <Text style={[styles.usage, { color: colors.textSecondary }]}>
                            교통 상황을 반영해 출발 시간을 알려드려요.
                        </Text>
                    ) : null}
                </View>
                <Switch
                    accessibilityLabel={flat ? "출발 알림 사용" : "출발 알림"}
                    accessibilityHint={canEnable || enabled ? undefined : "경로 선택이 필요합니다"}
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
                                        {arrivalText ? `${arrivalText} 도착 예정` : "도착 시간 미정"}
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
                                    {arrivalText || "-"}
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
                                    onLeadMinutesChange(60);
                                    onIntervalMinutesChange(Math.max(intervalMinutes, 10));
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
                        </View>
                    ) : null}
                    <AlarmSoundSettings
                        available={showAlarmControls && !customAlarmUnsupported}
                        disabled={pendingAction !== null}
                        flat={flat}
                    />
                </View>
            ) : null}
        </View>
    );
}
