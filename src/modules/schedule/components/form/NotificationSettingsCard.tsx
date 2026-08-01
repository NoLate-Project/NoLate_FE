import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import type { SubscriptionPolicy } from "../../../../api/subscription";
import {
    getDepartureAlarmCapabilities,
    openExactAlarmSettings,
    openFullScreenAlarmSettings,
    scheduleDepartureTestAlarm,
    type DepartureAlarmCapabilities,
} from "../../../notification/departureAlarm";
import { useTheme } from "../../../theme/ThemeContext";
import { formatRouteClock, formatRouteDuration, type RouteInfo } from "../../routeInfo";
import type { ScheduleAlertMode } from "../../types";

type Props = {
    routeReady: boolean;
    enabled: boolean;
    alertMode: ScheduleAlertMode;
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
        "notification" | "exact" | "fullScreen" | "test" | null
    >(null);
    const [alarmFeedback, setAlarmFeedback] = useState<string | null>(null);
    const mountedRef = useRef(false);
    const capabilityRequestRef = useRef(0);
    const quotaReached = policy.usedSmartSchedulesThisMonth >= policy.maxSmartSchedulesPerMonth;
    const canEnable = routeReady && !quotaReached;
    const accentBlue = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const selectedBackground = mode === "dark" ? "rgba(75,157,255,0.18)" : "#EAF2FF";
    const warningColor = mode === "dark" ? "#FFBF69" : "#A85C00";
    const routeMinutes = routeInfo?.totalDurationMinutes;
    const eventStartAt = startAt && !Number.isNaN(startAt.getTime()) ? startAt : undefined;
    const recommendedDepartureAt = eventStartAt && typeof routeMinutes === "number"
        ? new Date(eventStartAt.getTime() - routeMinutes * 60 * 1000)
        : undefined;
    const arrivalAt = eventStartAt;
    const showAlarmControls = enabled && alertMode === "ALARM";

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
                setCapabilityError("알람 권한 상태를 확인하지 못했어요.");
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
            setAlarmFeedback(null);
            return undefined;
        }

        refreshCapabilities().catch(() => undefined);
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") {
                refreshCapabilities().catch(() => undefined);
            }
        });
        return () => {
            subscription.remove();
            capabilityRequestRef.current += 1;
        };
    }, [refreshCapabilities, showAlarmControls]);

    const openAlarmSetting = useCallback(async (
        kind: "notification" | "exact" | "fullScreen",
    ) => {
        setPendingAction(kind);
        setAlarmFeedback(null);
        try {
            const opened = kind === "notification"
                ? await Linking.openSettings().then(() => true)
                : kind === "exact"
                    ? await openExactAlarmSettings()
                    : await openFullScreenAlarmSettings();
            if (!mountedRef.current) return;
            setAlarmFeedback(opened
                ? "설정을 변경한 뒤 앱으로 돌아오면 상태를 자동으로 다시 확인해요."
                : "설정 화면을 열지 못했어요. 기기 설정에서 NoLate 알람 권한을 확인해 주세요.");
        } catch {
            if (!mountedRef.current) return;
            setAlarmFeedback("설정 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.");
        } finally {
            if (mountedRef.current) setPendingAction(null);
        }
    }, []);

    const runTestAlarm = useCallback(async () => {
        setPendingAction("test");
        setAlarmFeedback(null);
        try {
            const result = await scheduleDepartureTestAlarm(10);
            if (!mountedRef.current) return;
            setAlarmFeedback(result.scheduled
                ? "테스트 알람을 예약했어요. 10초 뒤 벨소리를 확인해 주세요."
                : getAlarmMutationFailureMessage(result.reason));
            await refreshCapabilities();
        } catch {
            if (!mountedRef.current) return;
            setAlarmFeedback("테스트 알람을 예약하지 못했어요. 권한을 확인한 뒤 다시 시도해 주세요.");
        } finally {
            if (mountedRef.current) setPendingAction(null);
        }
    }, [refreshCapabilities]);

    const capabilityCopy = getCapabilityCopy(capabilities);
    const testAlarmDisabled =
        capabilityLoading ||
        pendingAction !== null ||
        capabilities?.supported !== true;
    const iosCapabilitySettingsRequired = capabilities
        ? requiresIOSAlarmSettings(capabilities)
        : false;
    const iosSystemAlarmReady = capabilities
        ? isIOSSystemAlarmReady(capabilities)
        : false;
    const iosAlarmKitMode = capabilities
        ? isIOSAlarmKitMode(capabilities)
        : false;
    const iosNotificationDisplayReady = capabilities
        ? isIOSNotificationDisplayReady(capabilities)
        : false;
    const notificationDisplayReady = capabilities?.platform === "ios"
        ? iosNotificationDisplayReady
        : capabilities?.notificationAuthorized === true;
    const iosFallbackStatus = capabilities
        ? getIOSFallbackPermissionStatus(capabilities)
        : null;
    const showAlarmSettingsActions = capabilities?.supported === true && (
        (!notificationDisplayReady && !iosSystemAlarmReady) ||
        iosCapabilitySettingsRequired ||
        (
            capabilities.platform === "android" &&
            (
                !capabilities.exactAlarmAuthorized ||
                !capabilities.fullScreenAuthorized
            )
        )
    );
    const showNotificationSettingsAction = capabilities !== null && (
        (!notificationDisplayReady && !iosSystemAlarmReady) ||
        iosCapabilitySettingsRequired
    );

    return (
        <View style={[styles.container, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }]}>
            <View style={styles.header}>
                <View style={styles.headerText}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>출발 알림</Text>
                    <Text style={[styles.usage, { color: colors.textSecondary }]}>
                        교통 상황을 반영해 최적의 출발 시간을 알려드려요.
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
                <Text style={[styles.notice, { color: colors.textSecondary }]}>이번 달 알림 일정 한도를 사용했어요.</Text>
            ) : null}

            {enabled ? (
                <View style={styles.settings}>
                    <Text style={[styles.label, { color: colors.textSecondary }]}>알림 방식</Text>
                    <View
                        accessibilityRole="radiogroup"
                        accessibilityLabel="출발 알림 방식"
                        style={styles.modeRow}
                    >
                        <Pressable
                            accessibilityRole="radio"
                            accessibilityLabel="일반 알림 모드"
                            accessibilityState={{ checked: alertMode === "STANDARD" }}
                            onPress={() => onAlertModeChange("STANDARD")}
                            style={[
                                styles.modeButton,
                                {
                                    borderColor: alertMode === "STANDARD" ? accentBlue : colors.border,
                                    backgroundColor: alertMode === "STANDARD"
                                        ? selectedBackground
                                        : colors.inputBackground,
                                },
                            ]}
                        >
                            <Text style={[styles.modeTitle, {
                                color: alertMode === "STANDARD" ? accentBlue : colors.textPrimary,
                            }]}>
                                일반 알림
                            </Text>
                            <Text style={[styles.modeDescription, { color: colors.textSecondary }]}>
                                앱 푸시 알림으로 알려드려요.
                            </Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="radio"
                            accessibilityLabel="강력한 알람 모드"
                            accessibilityState={{ checked: alertMode === "ALARM" }}
                            onPress={() => onAlertModeChange("ALARM")}
                            style={[
                                styles.modeButton,
                                {
                                    borderColor: alertMode === "ALARM" ? accentBlue : colors.border,
                                    backgroundColor: alertMode === "ALARM"
                                        ? selectedBackground
                                        : colors.inputBackground,
                                },
                            ]}
                        >
                            <Text style={[styles.modeTitle, {
                                color: alertMode === "ALARM" ? accentBlue : colors.textPrimary,
                            }]}>
                                강력한 알람
                            </Text>
                            <Text style={[styles.modeDescription, { color: colors.textSecondary }]}>
                                지원되는 기기에서는 벨소리처럼 눈에 띄게 알려드려요.
                            </Text>
                        </Pressable>
                    </View>

                    {showAlarmControls ? (
                        <View style={[styles.alarmPanel, { borderColor: colors.border }]}>
                            <View style={styles.alarmPanelHeader}>
                                <View style={styles.alarmPanelCopy}>
                                    <Text style={[styles.alarmStatusTitle, { color: colors.textPrimary }]}>
                                        {capabilityLoading && !capabilities
                                            ? "알람 준비 상태 확인 중"
                                            : capabilityCopy.title}
                                    </Text>
                                    <Text style={[styles.alarmStatusDescription, { color: colors.textSecondary }]}>
                                        {capabilityLoading && !capabilities
                                            ? "기기의 알람·알림 권한을 확인하고 있어요."
                                            : capabilityCopy.description}
                                    </Text>
                                </View>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="알람 권한 상태 새로고침"
                                    disabled={capabilityLoading}
                                    onPress={() => {
                                        refreshCapabilities().catch(() => undefined);
                                    }}
                                    style={[styles.compactButton, { borderColor: colors.border }]}
                                >
                                    <Text style={[styles.compactButtonText, { color: accentBlue }]}>
                                        {capabilityLoading ? "확인 중" : "새로고침"}
                                    </Text>
                                </Pressable>
                            </View>

                            {capabilityError ? (
                                <Text style={[styles.feedback, { color: warningColor }]}>
                                    {capabilityError}
                                </Text>
                            ) : null}

                            {capabilities?.platform === "android" ? (
                                <View style={styles.permissionList}>
                                    <PermissionStatusRow
                                        label="알림 권한"
                                        ready={capabilities.notificationAuthorized}
                                        readyColor={accentBlue}
                                        textColor={colors.textSecondary}
                                        warningColor={warningColor}
                                    />
                                    <PermissionStatusRow
                                        label="정확한 알람"
                                        ready={capabilities.exactAlarmAuthorized}
                                        readyColor={accentBlue}
                                        textColor={colors.textSecondary}
                                        warningColor={warningColor}
                                    />
                                    <PermissionStatusRow
                                        label="전체 화면 표시"
                                        ready={capabilities.fullScreenAuthorized}
                                        readyColor={accentBlue}
                                        textColor={colors.textSecondary}
                                        warningColor={warningColor}
                                    />
                                </View>
                            ) : capabilities?.platform === "ios" ? (
                                <View style={styles.permissionList}>
                                    {iosAlarmKitMode ? (
                                        <>
                                            <PermissionStatusRow
                                                label="iOS 시스템 알람 권한"
                                                ready={iosSystemAlarmReady}
                                                readyColor={accentBlue}
                                                textColor={colors.textSecondary}
                                                warningColor={warningColor}
                                            />
                                            {!iosSystemAlarmReady ? (
                                                <PermissionStatusRow
                                                    label="일반 푸시 알림"
                                                    ready={iosNotificationDisplayReady}
                                                    readyColor={accentBlue}
                                                    textColor={colors.textSecondary}
                                                    warningColor={warningColor}
                                                />
                                            ) : null}
                                        </>
                                    ) : iosFallbackStatus ? (
                                        <>
                                            <PermissionStatusRow
                                                label="알림 표시"
                                                ready={iosFallbackStatus.notificationDisplayReady}
                                                readyColor={accentBlue}
                                                textColor={colors.textSecondary}
                                                warningColor={warningColor}
                                            />
                                            <PermissionStatusRow
                                                label="시간 지정 알림"
                                                ready={iosFallbackStatus.timeSensitiveReady}
                                                readyColor={accentBlue}
                                                textColor={colors.textSecondary}
                                                warningColor={warningColor}
                                            />
                                            <PermissionStatusRow
                                                label="알림 사운드"
                                                ready={iosFallbackStatus.soundReady}
                                                readyColor={accentBlue}
                                                textColor={colors.textSecondary}
                                                warningColor={warningColor}
                                            />
                                        </>
                                    ) : null}
                                </View>
                            ) : null}

                            {capabilities && showAlarmSettingsActions ? (
                                <View style={styles.actionRow}>
                                    {showNotificationSettingsAction ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="앱 알림 설정 열기"
                                            disabled={pendingAction !== null}
                                            onPress={() => {
                                                openAlarmSetting("notification").catch(() => undefined);
                                            }}
                                            style={[styles.actionButton, { borderColor: accentBlue }]}
                                        >
                                            <Text style={[styles.actionButtonText, { color: accentBlue }]}>
                                                {capabilities.platform === "ios"
                                                    ? "iOS 알람 설정"
                                                    : "앱 알림 설정"}
                                            </Text>
                                        </Pressable>
                                    ) : null}
                                    {capabilities.platform === "android" &&
                                    !capabilities.exactAlarmAuthorized ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="정확한 알람 설정 열기"
                                            disabled={pendingAction !== null}
                                            onPress={() => {
                                                openAlarmSetting("exact").catch(() => undefined);
                                            }}
                                            style={[styles.actionButton, { borderColor: accentBlue }]}
                                        >
                                            <Text style={[styles.actionButtonText, { color: accentBlue }]}>
                                                정확한 알람 설정
                                            </Text>
                                        </Pressable>
                                    ) : null}
                                    {capabilities.platform === "android" &&
                                    !capabilities.fullScreenAuthorized ? (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="전체 화면 알람 설정 열기"
                                            disabled={pendingAction !== null}
                                            onPress={() => {
                                                openAlarmSetting("fullScreen").catch(() => undefined);
                                            }}
                                            style={[styles.actionButton, { borderColor: accentBlue }]}
                                        >
                                            <Text style={[styles.actionButtonText, { color: accentBlue }]}>
                                                전체 화면 설정
                                            </Text>
                                        </Pressable>
                                    ) : null}
                                </View>
                            ) : null}

                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="10초 뒤 테스트 알람"
                                disabled={testAlarmDisabled}
                                onPress={() => {
                                    runTestAlarm().catch(() => undefined);
                                }}
                                style={[
                                    styles.testButton,
                                    { backgroundColor: accentBlue },
                                    testAlarmDisabled && styles.disabledButton,
                                ]}
                            >
                                <Text style={styles.testButtonText}>
                                    {pendingAction === "test" ? "예약 중..." : "10초 뒤 테스트 알람"}
                                </Text>
                            </Pressable>

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

                    <View style={[styles.recommendationCard, { borderColor: colors.border }]}>
                        <View style={styles.recommendationCol}>
                            <Text style={[styles.label, { color: colors.textSecondary }]}>추천 출발 시간</Text>
                            <Text style={[styles.recommendationValue, { color: colors.textPrimary }]}>
                                {recommendedDepartureAt ? formatRouteClock(recommendedDepartureAt) : "-"}
                            </Text>
                        </View>
                        <View style={styles.recommendationCol}>
                            <Text style={[styles.label, { color: colors.textSecondary }]}>도착 예정 시간</Text>
                            <Text style={[styles.recommendationValue, { color: colors.textPrimary }]}>
                                {arrivalAt ? formatRouteClock(arrivalAt) : "-"}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.reminderMetaRow}>
                        <Text style={[styles.description, { color: colors.textSecondary }]}>
                            예상 이동시간 {formatRouteDuration(routeMinutes)} · {leadMinutes}분 전부터 확인
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
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 38,
    },
    headerText: { flex: 1, paddingRight: 12 },
    title: { fontSize: 14, fontWeight: "700" },
    usage: { marginTop: 3, fontSize: 11, fontWeight: "600" },
    notice: { marginTop: 10, fontSize: 12 },
    settings: { marginTop: 14 },
    label: { marginBottom: 7, fontSize: 12, fontWeight: "600" },
    description: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
    modeRow: {
        flexDirection: "row",
        gap: 8,
        marginBottom: 12,
    },
    modeButton: {
        flex: 1,
        minHeight: 76,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 11,
        paddingVertical: 10,
    },
    modeTitle: {
        fontSize: 13,
        fontWeight: "900",
    },
    modeDescription: {
        marginTop: 5,
        fontSize: 10,
        lineHeight: 15,
        fontWeight: "600",
    },
    alarmPanel: {
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
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
        minHeight: 38,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 12,
    },
    testButtonText: {
        color: "#FFFFFF",
        fontSize: 12,
        fontWeight: "900",
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
        borderRadius: 10,
        padding: 12,
        flexDirection: "row",
        gap: 14,
    },
    recommendationCol: {
        flex: 1,
    },
    recommendationValue: {
        fontSize: 14,
        fontWeight: "900",
    },
    reminderMetaRow: {
        marginTop: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    useButton: {
        borderWidth: 1,
        borderRadius: 999,
        paddingVertical: 5,
        paddingHorizontal: 10,
    },
    useButtonText: {
        fontSize: 11,
        fontWeight: "800",
    },
});

function PermissionStatusRow({
    label,
    ready,
    readyColor,
    textColor,
    warningColor,
}: {
    label: string;
    ready: boolean;
    readyColor: string;
    textColor: string;
    warningColor: string;
}) {
    return (
        <View
            accessible
            accessibilityLabel={`${label}: ${ready ? "준비됨" : "설정 필요"}`}
            style={styles.permissionRow}
        >
            <Text style={[styles.permissionLabel, { color: textColor }]}>{label}</Text>
            <Text style={[styles.permissionValue, { color: ready ? readyColor : warningColor }]}>
                {ready ? "준비됨" : "설정 필요"}
            </Text>
        </View>
    );
}

function getCapabilityCopy(capabilities: DepartureAlarmCapabilities | null): {
    title: string;
    description: string;
} {
    if (!capabilities) {
        return {
            title: "알람 준비 상태를 확인해 주세요",
            description: "상태를 확인하지 못했어요. 새로고침해 일반 알림과 알람 권한을 확인해 주세요.",
        };
    }
    if (!capabilities.supported) {
        return {
            title: "이 기기에서는 일반 알림으로 동작해요",
            description: "현재 앱 빌드는 강력한 알람을 지원하지 않아 푸시 알림으로 대신 알려드려요.",
        };
    }
    if (capabilities.platform === "android") {
        if (
            capabilities.notificationAuthorized &&
            capabilities.exactAlarmAuthorized &&
            capabilities.fullScreenAuthorized
        ) {
            return {
                title: "강력한 알람 준비 완료",
                description: "정확한 시각에 벨소리와 전체 화면 알람으로 알려드려요.",
            };
        }
        if (!capabilities.notificationAuthorized) {
            return {
                title: "Android 알림 권한이 필요해요",
                description: "알림 권한이 꺼져 있어 알람과 일반 푸시가 표시되지 않을 수 있어요. 앱 알림 설정을 켜 주세요.",
            };
        }
        return {
            title: "알람 권한 설정이 필요해요",
            description: "설정 전에도 일반 푸시 알림은 계속 도착하며, 권한을 켜면 더 강하게 알려드려요.",
        };
    }
    if (capabilities.platform === "ios") {
        if (isIOSSystemAlarmReady(capabilities)) {
            return {
                title: "강력한 알람 준비 완료",
                description: "iOS 시스템 알람 권한이 준비됐어요. 일반 알림 권한과 별개로 알람이 동작해요.",
            };
        }
        if (capabilities.reason === "ALARM_AUTHORIZATION_NOT_DETERMINED") {
            return {
                title: "시스템 알람 권한을 확인해 주세요",
                description: "10초 테스트 알람을 실행하면 iOS 시스템 알람 권한을 요청해요.",
            };
        }
        if (capabilities.reason === "ALARM_AUTHORIZATION_DENIED") {
            if (!isIOSNotificationDisplayReady(capabilities)) {
                return {
                    title: "iOS 알람 권한이 모두 꺼져 있어요",
                    description: "시스템 알람과 일반 알림 권한이 모두 꺼져 있어 출발 알림이 표시되지 않을 수 있어요.",
                };
            }
            return {
                title: "iOS 시스템 알람 권한이 꺼져 있어요",
                description: "시스템 알람 권한을 켜기 전에는 허용된 일반 푸시 알림으로 대신 알려드려요.",
            };
        }
        if (capabilities.reason === "NOTIFICATION_ALERTS_DISABLED") {
            return {
                title: "iOS 앱 알림 표시가 꺼져 있어요",
                description: "앱 알림 설정에서 알림 허용과 배너 표시를 켜 주세요.",
            };
        }
        if (!isIOSNotificationDisplayReady(capabilities)) {
            return {
                title: "iOS 알림 권한이 필요해요",
                description: "앱 알림 설정에서 알림과 사운드를 허용한 뒤 다시 확인해 주세요.",
            };
        }
        if (capabilities.reason === "TIME_SENSITIVE_DISABLED") {
            return {
                title: "iOS 시간 지정 알림이 꺼져 있어요",
                description: "iOS 알람 설정에서 시간 지정 알림을 켜면 출발 시간을 더 눈에 띄게 알려드려요.",
            };
        }
        if (capabilities.reason === "SOUND_DISABLED") {
            return {
                title: "iOS 알림 사운드가 꺼져 있어요",
                description: "iOS 알람 설정에서 사운드를 켜야 출발 알람 소리를 들을 수 있어요.",
            };
        }
        if (capabilities.reason === "TIME_SENSITIVE_FALLBACK") {
            return {
                title: "iOS 사운드 알림으로 동작해요",
                description: "이 기기에서는 시간 지정 사운드 알림으로 출발 시간을 알려드려요.",
            };
        }
        if (capabilities.notificationAuthorized) {
            return {
                title: "iOS 사운드 알림으로 동작해요",
                description: "시간 지정 알림 또는 사운드 설정을 확인하면 더 눈에 띄게 알려드릴 수 있어요.",
            };
        }
    }
    return {
        title: "일반 알림으로 동작해요",
        description: "강력한 알람을 지원하지 않는 플랫폼에서는 푸시 알림으로 대신 알려드려요.",
    };
}

function isIOSSystemAlarmReady(capabilities: DepartureAlarmCapabilities): boolean {
    return capabilities.platform === "ios" &&
        capabilities.exactAlarmAuthorized &&
        capabilities.fullScreenAuthorized;
}

function isIOSAlarmKitMode(capabilities: DepartureAlarmCapabilities): boolean {
    if (capabilities.platform !== "ios") return false;
    if (capabilities.deliveryMode === "alarmKit") return true;
    if (
        capabilities.alarmKitAuthorization === "authorized" ||
        capabilities.alarmKitAuthorization === "denied" ||
        capabilities.alarmKitAuthorization === "notDetermined"
    ) {
        return true;
    }
    return isIOSSystemAlarmReady(capabilities) ||
        capabilities.reason === "ALARM_AUTHORIZATION_NOT_DETERMINED" ||
        capabilities.reason === "ALARM_AUTHORIZATION_DENIED" ||
        capabilities.reason === "ALARM_AUTHORIZATION_UNKNOWN";
}

function isIOSNotificationDisplayReady(capabilities: DepartureAlarmCapabilities): boolean {
    if (
        capabilities.platform !== "ios" ||
        !capabilities.notificationAuthorized ||
        capabilities.reason === "NOTIFICATION_ALERTS_DISABLED"
    ) {
        return false;
    }
    switch (capabilities.notificationAuthorization) {
        case undefined:
        case "authorized":
        case "provisional":
        case "ephemeral":
            return true;
        case "notDetermined":
        case "denied":
        case "unknown":
            return false;
    }
}

function getIOSFallbackPermissionStatus(
    capabilities: DepartureAlarmCapabilities,
): {
    notificationDisplayReady: boolean;
    timeSensitiveReady: boolean;
    soundReady: boolean;
} | null {
    if (capabilities.platform !== "ios" || isIOSAlarmKitMode(capabilities)) {
        return null;
    }

    const timeSensitiveReady = capabilities.timeSensitiveAuthorization === "enabled" ||
        (
            capabilities.timeSensitiveAuthorization === undefined &&
            (
                capabilities.reason === "SOUND_DISABLED" ||
                capabilities.reason === "TIME_SENSITIVE_FALLBACK"
            )
        );
    const soundReady = capabilities.soundAuthorization === "enabled" ||
        (
            capabilities.soundAuthorization === undefined &&
            capabilities.reason === "TIME_SENSITIVE_FALLBACK"
        );
    return {
        notificationDisplayReady: isIOSNotificationDisplayReady(capabilities),
        timeSensitiveReady,
        soundReady,
    };
}

function requiresIOSAlarmSettings(capabilities: DepartureAlarmCapabilities): boolean {
    return !isIOSSystemAlarmReady(capabilities) &&
        capabilities.platform === "ios" && (
        capabilities.reason === "ALARM_AUTHORIZATION_DENIED" ||
        capabilities.reason === "TIME_SENSITIVE_DISABLED" ||
        capabilities.reason === "SOUND_DISABLED"
    );
}

function getAlarmMutationFailureMessage(reason?: string): string {
    switch (reason) {
        case "NOTIFICATION_PERMISSION_REQUIRED":
            return "알림 권한이 꺼져 있어 테스트 알람을 예약하지 못했어요.";
        case "EXACT_ALARM_PERMISSION_REQUIRED":
            return "정확한 알람 권한을 켠 뒤 다시 테스트해 주세요.";
        case "FULL_SCREEN_PERMISSION_REQUIRED":
            return "전체 화면 알람 권한을 켠 뒤 다시 테스트해 주세요.";
        case "NATIVE_MODULE_UNAVAILABLE":
            return "현재 앱 빌드에서는 강력한 알람을 테스트할 수 없어요.";
        default:
            return "테스트 알람을 예약하지 못했어요. 권한 상태를 확인해 주세요.";
    }
}
