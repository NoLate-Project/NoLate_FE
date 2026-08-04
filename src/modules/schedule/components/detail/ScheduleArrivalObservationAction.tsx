import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    AppState,
    Dimensions,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { Ionicons as ExpoIonicons } from "@expo/vector-icons";
import Constants from "expo-constants";

import {
    activateScheduleArrivalObservationQueueForAuthenticatedMember,
    recordScheduleArrivalDurably,
} from "../../scheduleArrivalObservationQueue";
import {
    type ScheduleArrivalObservationCapture,
    type ScheduleEtaObservationEngagementEvent,
} from "../../../../api/schedule";
import {
    recordScheduleEtaObservationEngagementDurably,
} from "../../scheduleEtaObservationEngagementQueue";
import { useTheme } from "../../../theme/ThemeContext";

function Ionicons(props: React.ComponentProps<typeof ExpoIonicons>) {
    return <ExpoIonicons {...props} accessible={false} importantForAccessibility="no" />;
}

type Props = {
    scheduleId: string;
    myDepartedAt?: string;
    compact?: boolean;
};

const USER_NOW_PRECISION_SECONDS = 30;

function normalizeClientCohort(value: string | number | null | undefined): string | undefined {
    if (value === null || value === undefined) return undefined;
    const normalized = String(value).trim();
    return /^[A-Za-z0-9._+-]{1,64}$/.test(normalized) ? normalized : undefined;
}

const CLIENT_APP_VERSION = normalizeClientCohort(
    Constants.nativeApplicationVersion ?? Constants.expoConfig?.version,
);
const CLIENT_BUILD_VERSION = normalizeClientCohort(
    Constants.nativeBuildVersion ??
        Constants.expoConfig?.ios?.buildNumber ??
        Constants.expoConfig?.android?.versionCode,
);

const VIEWPORT_EXPOSURE_MIN_FRACTION = 0.5;
const VIEWPORT_CHECK_INTERVAL_MS = 750;
const EXPOSURE_RETRY_DELAY_MS = 15_000;

type Rect = { x: number; y: number; width: number; height: number };
type Viewport = { width: number; height: number };

export function hasMeaningfulViewportExposure(rect: Rect, viewport: Viewport): boolean {
    if (rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
        return false;
    }
    const visibleWidth = Math.max(
        0,
        Math.min(rect.x + rect.width, viewport.width) - Math.max(rect.x, 0),
    );
    const visibleHeight = Math.max(
        0,
        Math.min(rect.y + rect.height, viewport.height) - Math.max(rect.y, 0),
    );
    return (visibleWidth * visibleHeight) / (rect.width * rect.height) >=
        VIEWPORT_EXPOSURE_MIN_FRACTION;
}

function engagementCapture(
    event: ScheduleEtaObservationEngagementEvent,
    uxVariant: string,
) {
    return {
        event,
        ...(CLIENT_APP_VERSION ? { clientAppVersion: CLIENT_APP_VERSION } : {}),
        ...(CLIENT_BUILD_VERSION ? { clientBuildVersion: CLIENT_BUILD_VERSION } : {}),
        uxVariant,
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
}

function hasExplicitDeparture(value?: string): boolean {
    return typeof value === "string" && value.trim().length > 0;
}

export default function ScheduleArrivalObservationAction({
    scheduleId,
    myDepartedAt,
    compact = false,
}: Props) {
    const { colors, mode } = useTheme();
    const accent = mode === "dark" ? "#4B9DFF" : "#2979FF";
    const pendingRef = useRef(false);
    const arrivalAttemptRef = useRef<ScheduleArrivalObservationCapture | undefined>(undefined);
    const cardRef = useRef<View>(null);
    const exposureCapturedScheduleRef = useRef<string | undefined>(undefined);
    const exposureInFlightScheduleRef = useRef<string | undefined>(undefined);
    const exposureRetryAtRef = useRef(0);
    const mountedRef = useRef(true);
    const currentScheduleIdRef = useRef(scheduleId);
    const [pending, setPending] = useState(false);
    const [recordedAt, setRecordedAt] = useState<string>();

    currentScheduleIdRef.current = scheduleId;

    useEffect(() => {
        pendingRef.current = false;
        arrivalAttemptRef.current = undefined;
        exposureCapturedScheduleRef.current = undefined;
        exposureInFlightScheduleRef.current = undefined;
        exposureRetryAtRef.current = 0;
        setPending(false);
        setRecordedAt(undefined);
    }, [scheduleId]);

    useEffect(() => {
        mountedRef.current = true;
        activateScheduleArrivalObservationQueueForAuthenticatedMember().catch(() => undefined);
        return () => {
            mountedRef.current = false;
            pendingRef.current = false;
        };
    }, []);

    const uxVariant = compact ? "arrival-card-compact-v1" : "arrival-card-v1";
    const captureExposureIfVisible = useCallback(() => {
        const appState = AppState.currentState;
        if (
            !hasExplicitDeparture(myDepartedAt) ||
            exposureCapturedScheduleRef.current === scheduleId ||
            exposureInFlightScheduleRef.current === scheduleId ||
            Date.now() < exposureRetryAtRef.current ||
            (typeof appState === "string" && appState !== "active")
        ) return;
        cardRef.current?.measureInWindow((x, y, width, height) => {
            if (
                !mountedRef.current ||
                currentScheduleIdRef.current !== scheduleId ||
                !hasMeaningfulViewportExposure(
                    { x, y, width, height },
                    Dimensions.get("window"),
                )
            ) return;
            exposureInFlightScheduleRef.current = scheduleId;
            recordScheduleEtaObservationEngagementDurably(
                scheduleId,
                engagementCapture("EXPOSED", uxVariant),
            ).then((result) => {
                if (!mountedRef.current || currentScheduleIdRef.current !== scheduleId) return;
                if (result === "sent" || result === "queued") {
                    exposureCapturedScheduleRef.current = scheduleId;
                } else {
                    exposureRetryAtRef.current = Date.now() + EXPOSURE_RETRY_DELAY_MS;
                }
            }).catch(() => {
                exposureRetryAtRef.current = Date.now() + EXPOSURE_RETRY_DELAY_MS;
            }).finally(() => {
                if (exposureInFlightScheduleRef.current === scheduleId) {
                    exposureInFlightScheduleRef.current = undefined;
                }
            });
        });
    }, [myDepartedAt, scheduleId, uxVariant]);

    useEffect(() => {
        if (!hasExplicitDeparture(myDepartedAt)) return undefined;
        captureExposureIfVisible();
        const interval = setInterval(captureExposureIfVisible, VIEWPORT_CHECK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [captureExposureIfVisible, myDepartedAt]);

    const recordArrival = useCallback(async (capture: ScheduleArrivalObservationCapture) => {
        if (
            currentScheduleIdRef.current !== scheduleId ||
            pendingRef.current ||
            recordedAt ||
            !hasExplicitDeparture(myDepartedAt)
        ) return;

        const requestedScheduleId = scheduleId;
        pendingRef.current = true;
        setPending(true);
        try {
            const result = await recordScheduleArrivalDurably(
                requestedScheduleId,
                capture,
            );
            if (!mountedRef.current || currentScheduleIdRef.current !== requestedScheduleId) return;

            if (result === "rejected") {
                throw new Error("도착 기록을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
            }

            setRecordedAt(capture.arrivedAt);
            Alert.alert(
                result === "sent" ? "도착이 기록됐어요" : "도착 시각을 보관했어요",
                result === "sent"
                    ? capture.observationSource === "USER_ADJUSTED"
                        ? "위치 정보 없이 5분 전 시각을 도착 시각으로 기록했습니다."
                        : "위치 정보 없이 지금 시각을 도착 시각으로 기록했습니다."
                    : "연결되면 같은 도착 시각으로 자동 전송합니다.",
            );
        } catch (error) {
            if (!mountedRef.current || currentScheduleIdRef.current !== requestedScheduleId) return;
            Alert.alert("도착 기록 실패", errorMessage(error));
        } finally {
            if (mountedRef.current && currentScheduleIdRef.current === requestedScheduleId) {
                pendingRef.current = false;
                setPending(false);
            }
        }
    }, [myDepartedAt, recordedAt, scheduleId]);

    const captureAndRecord = useCallback((adjustmentSeconds?: number) => {
        if (
            currentScheduleIdRef.current !== scheduleId ||
            pendingRef.current ||
            recordedAt ||
            !hasExplicitDeparture(myDepartedAt)
        ) return;

        const existing = arrivalAttemptRef.current;
        const now = new Date();
        const capture = existing ?? (adjustmentSeconds === undefined
            ? {
                arrivedAt: now.toISOString(),
                observationSource: "USER_NOW" as const,
                // This is tap-time uncertainty, not verified arrival precision. The server keeps
                // every USER_NOW report diagnostic-only regardless of this client value.
                precisionSeconds: USER_NOW_PRECISION_SECONDS,
                ...(CLIENT_APP_VERSION ? { clientAppVersion: CLIENT_APP_VERSION } : {}),
                ...(CLIENT_BUILD_VERSION ? { clientBuildVersion: CLIENT_BUILD_VERSION } : {}),
            }
            : {
                arrivedAt: new Date(now.getTime() - adjustmentSeconds * 1_000).toISOString(),
                observationSource: "USER_ADJUSTED" as const,
                // A fixed "5 minutes ago" recall bucket is not one-minute ground truth. Preserve
                // it for diagnosis, but report the full bucket uncertainty so the server's
                // 120-second accuracy gate excludes it from the core cohort.
                precisionSeconds: adjustmentSeconds,
                adjustmentSeconds,
                ...(CLIENT_APP_VERSION ? { clientAppVersion: CLIENT_APP_VERSION } : {}),
                ...(CLIENT_BUILD_VERSION ? { clientBuildVersion: CLIENT_BUILD_VERSION } : {}),
            });
        // Freeze the complete quality provenance, not only the timestamp. A retry cannot silently
        // turn a first USER_ADJUSTED sample into USER_NOW or change its uncertainty.
        arrivalAttemptRef.current = capture;
        recordArrival(capture).catch(() => undefined);
    }, [myDepartedAt, recordArrival, recordedAt, scheduleId]);

    const confirmArrival = useCallback(() => {
        if (pendingRef.current || recordedAt || !hasExplicitDeparture(myDepartedAt)) return;

        recordScheduleEtaObservationEngagementDurably(
            scheduleId,
            engagementCapture("PROMPT_OPENED", uxVariant),
        ).catch(() => undefined);

        Alert.alert(
            "도착을 기록할까요?",
            "위치 정보는 수집하지 않습니다. 지금 또는 5분 전 시각을 참고용 자기 보고로 기록하며, 검증된 ETA 정확도 표본에는 포함하지 않습니다.",
            [
                { text: "취소", style: "cancel" },
                {
                    text: "5분 전",
                    onPress: () => captureAndRecord(5 * 60),
                },
                {
                    text: "도착 기록",
                    onPress: () => captureAndRecord(),
                },
            ],
        );
    }, [captureAndRecord, myDepartedAt, recordedAt, scheduleId, uxVariant]);

    if (!hasExplicitDeparture(myDepartedAt)) return null;

    return (
        <View
            ref={cardRef}
            collapsable={false}
            testID="schedule-arrival-observation-card"
            onLayout={captureExposureIfVisible}
            style={[
                styles.card,
                compact && styles.compactCard,
                {
                    borderColor: colors.border,
                    backgroundColor: colors.inputBackground,
                },
            ]}
        >
            <View style={styles.copy}>
                <View style={styles.titleRow}>
                    <Ionicons
                        name={recordedAt ? "checkmark-circle" : "flag-outline"}
                        size={16}
                        color={recordedAt ? "#22C55E" : accent}
                    />
                    <Text style={[styles.title, { color: colors.textPrimary }]}>실제 도착</Text>
                </View>
                <Text
                    numberOfLines={compact ? 1 : 2}
                    style={[styles.hint, { color: colors.textSecondary }]}
                >
                    {recordedAt
                        ? "참고용 자기 보고 도착 시각이 저장됐어요."
                        : "위치 추적 없이 참고용 도착 시각만 기록해요."}
                </Text>
            </View>
            <Pressable
                onPress={confirmArrival}
                disabled={pending || Boolean(recordedAt)}
                accessibilityRole="button"
                accessibilityLabel={recordedAt ? "도착 기록 완료" : "현재 시각으로 도착 기록"}
                accessibilityState={{
                    busy: pending,
                    disabled: pending || Boolean(recordedAt),
                }}
                style={({ pressed }) => [
                    styles.button,
                    {
                        backgroundColor: recordedAt ? colors.border : accent,
                        opacity: pressed || pending ? 0.62 : 1,
                    },
                ]}
            >
                {pending ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                    <Ionicons
                        name={recordedAt ? "checkmark" : "flag"}
                        size={15}
                        color={recordedAt ? colors.textSecondary : "#FFFFFF"}
                    />
                )}
                <Text
                    style={[
                        styles.buttonText,
                        recordedAt ? styles.buttonTextRecorded : styles.buttonTextActive,
                    ]}
                >
                    {recordedAt ? "기록 완료" : "도착 기록"}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        minHeight: 64,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    compactCard: {
        marginTop: 9,
        minHeight: 58,
        borderRadius: 10,
        paddingVertical: 8,
    },
    copy: {
        flex: 1,
        minWidth: 0,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    title: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "900",
    },
    hint: {
        marginTop: 2,
        fontSize: 10,
        lineHeight: 14,
        fontWeight: "600",
    },
    button: {
        minWidth: 92,
        height: 38,
        borderRadius: 10,
        paddingHorizontal: 11,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
    },
    buttonText: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "900",
    },
    buttonTextActive: {
        color: "#FFFFFF",
    },
    buttonTextRecorded: {
        color: "#8E8E93",
    },
});
