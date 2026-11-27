import BrandedLoader from "../../ui/BrandedLoader";
import styles, {
    BACKGROUND,
    PRIMARY_BUTTON_FOREGROUND,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
} from "./NoLateCustomAlarmScreen.styles";
import Reanimated, { Keyframe, ReduceMotion } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    AppState,
    Image,
    Pressable,
    ScrollView,
    StatusBar,
    Text,
    Vibration,
    View,
    useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { startNoLateCustomAlarmAudio, type NoLateCustomAlarmAudioSession } from "./customAlarmAudio";
import { getNoLateAlarmSoundPreference } from "./customAlarmSounds";
import {
    canCompleteNoLateCustomAlarmDeparture,
    formatNoLateAlarmTime,
    type NoLateCustomAlarmPresentation,
} from "./customAlarmPresentation";

const alarmMarkIn = new Keyframe({
    0: { transform: [{ scale: 1 }] },
    26: { transform: [{ scale: 1.05 }] },
    50: { transform: [{ scale: 1 }] },
    76: { transform: [{ scale: 1.05 }] },
    100: { transform: [{ scale: 1 }] },
}).duration(1800).reduceMotion(ReduceMotion.System);

const completionMarkIn = new Keyframe({
    0: { opacity: 0, transform: [{ perspective: 480 }, { rotateX: "-24deg" }, { scale: 0.84 }] },
    100: { opacity: 1, transform: [{ perspective: 480 }, { rotateX: "0deg" }, { scale: 1 }] },
}).duration(280).reduceMotion(ReduceMotion.System);

type AlarmAction = "close" | "route" | "depart" | null;

export type NoLateCustomAlarmDepartureCompletionResult =
    | { status: "completed" }
    | {
          status: "rejected";
          reason: "invalid-presentation" | "capability-unavailable";
      };

let activeVibrationOwner: symbol | null = null;

type Props = {
    presentation: NoLateCustomAlarmPresentation;
    onClose: () => void | Promise<void>;
    onOpenRoute: (scheduleId: string) => void | Promise<void>;
    onCompleteDeparture: (scheduleId: string) => Promise<NoLateCustomAlarmDepartureCompletionResult>;
};

function KeepNoLateAlarmAwake() {
    useKeepAwake("NoLateCustomAlarm");
    return null;
}

export default function NoLateCustomAlarmScreen({ presentation, onClose, onOpenRoute, onCompleteDeparture }: Props) {
    const insets = useSafeAreaInsets();
    const largeText = useWindowDimensions().fontScale > 1.35;
    const audioSessionRef = useRef<NoLateCustomAlarmAudioSession | null>(null);
    const playbackAllowedRef = useRef(false);
    const mountedRef = useRef(false);
    const mutedRef = useRef(false);
    const actionPendingRef = useRef(false);
    const stoppedRef = useRef(false);
    const focusedRef = useRef(false);
    const appActiveRef = useRef(isInitialAlarmAppStateActive(AppState.currentState));
    const startRequestedRef = useRef(false);
    const lifecycleGenerationRef = useRef(0);
    const vibrationOwnerRef = useRef(Symbol("NoLateCustomAlarmVibration"));
    const [muted, setMuted] = useState(false);
    const [stopped, setStopped] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [audioLoading, setAudioLoading] = useState(presentation.hasValidAlarmIdentity);
    const [alarmEngaged, setAlarmEngaged] = useState(false);
    const [pendingAction, setPendingAction] = useState<AlarmAction>(null);
    const [currentTime, setCurrentTime] = useState(() => new Date());
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [departureFailed, setDepartureFailed] = useState(false);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 30_000);
        return () => clearInterval(timer);
    }, []);

    const stopVibration = useCallback(() => {
        stopOwnedAlarmVibration(vibrationOwnerRef.current);
    }, []);

    const stopPlayback = useCallback(
        async () => {
            playbackAllowedRef.current = false;
            startRequestedRef.current = false;
            stoppedRef.current = true;
            lifecycleGenerationRef.current += 1;
            stopVibration();
            const session = audioSessionRef.current;
            audioSessionRef.current = null;
            if (mountedRef.current) {
                setAudioLoading(false);
                setAlarmEngaged(false);
                setStopped(true);
            }
            await session?.stop().catch(() => undefined);
        },
        [stopVibration],
    );

    const beginPlayback = useCallback(() => {
        if (
            !presentation.hasValidAlarmIdentity ||
            stoppedRef.current ||
            startRequestedRef.current ||
            !mountedRef.current ||
            !focusedRef.current ||
            !appActiveRef.current
        )
            return;

        const generation = ++lifecycleGenerationRef.current;
        startRequestedRef.current = true;
        playbackAllowedRef.current = true;
        setAudioLoading(true);
        setAlarmEngaged(true);
        startOwnedAlarmVibration(vibrationOwnerRef.current);

        getNoLateAlarmSoundPreference()
            .then(soundId => {
                if (
                    !mountedRef.current ||
                    !playbackAllowedRef.current ||
                    generation !== lifecycleGenerationRef.current
                ) {
                    return null;
                }
                return startNoLateCustomAlarmAudio(soundId);
            })
            .then(async session => {
                if (!session) {
                    if (generation === lifecycleGenerationRef.current) startRequestedRef.current = false;
                    return;
                }
                if (
                    !mountedRef.current ||
                    !playbackAllowedRef.current ||
                    generation !== lifecycleGenerationRef.current
                ) {
                    await session.stop();
                    return;
                }
                audioSessionRef.current = session;
                startRequestedRef.current = false;
                if (mutedRef.current) await session.setMuted(true);
                if (mountedRef.current && generation === lifecycleGenerationRef.current) {
                    setAudioLoading(false);
                }
            })
            .catch(() => {
                if (!mountedRef.current || generation !== lifecycleGenerationRef.current) return;
                startRequestedRef.current = false;
                setAudioLoading(false);
                setErrorMessage("소리를 재생하지 못했어요.");
            });
    }, [presentation.hasValidAlarmIdentity]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            playbackAllowedRef.current = false;
            startRequestedRef.current = false;
            lifecycleGenerationRef.current += 1;
            const session = audioSessionRef.current;
            audioSessionRef.current = null;
            stopVibration();
            session?.stop().catch(() => undefined);
        };
    }, [stopVibration]);

    useFocusEffect(
        useCallback(() => {
            focusedRef.current = true;
            appActiveRef.current = isInitialAlarmAppStateActive(AppState.currentState);
            beginPlayback();

            return () => {
                focusedRef.current = false;
                stopPlayback().catch(() => undefined);
            };
        }, [beginPlayback, stopPlayback]),
    );

    useEffect(() => {
        const subscription = AppState.addEventListener("change", state => {
            appActiveRef.current = state === "active";
            if (state === "active") {
                beginPlayback();
                return;
            }
            stopPlayback().catch(() => undefined);
        });
        return () => subscription.remove();
    }, [beginPlayback, stopPlayback]);

    const toggleMute = useCallback(async () => {
        if (stopped || actionPendingRef.current) return;
        const nextMuted = !mutedRef.current;
        mutedRef.current = nextMuted;
        setMuted(nextMuted);
        try {
            await audioSessionRef.current?.setMuted(nextMuted);
            if (mountedRef.current) setErrorMessage(null);
        } catch {
            if (mountedRef.current) setErrorMessage("소리 상태를 변경하지 못했어요.");
        }
    }, [stopped]);

    const close = useCallback(async () => {
        if (actionPendingRef.current) return;
        actionPendingRef.current = true;
        setPendingAction("close");
        await stopPlayback();
        try {
            await onClose();
        } catch {
            actionPendingRef.current = false;
            if (mountedRef.current) {
                setErrorMessage("알림 화면을 닫지 못했어요. 다시 시도해 주세요.");
                setPendingAction(null);
            }
        }
    }, [onClose, stopPlayback]);

    const openRoute = useCallback(async () => {
        if (!presentation.scheduleId || actionPendingRef.current) return;
        actionPendingRef.current = true;
        setPendingAction("route");
        setErrorMessage(null);
        await stopPlayback();
        try {
            await onOpenRoute(presentation.scheduleId);
        } catch {
            actionPendingRef.current = false;
            if (!mountedRef.current) return;
            setErrorMessage("경로를 열지 못했어요. 일정 화면에서 다시 확인해 주세요.");
            setPendingAction(null);
        }
    }, [onOpenRoute, presentation.scheduleId, stopPlayback]);

    const completeDeparture = useCallback(async () => {
        if (!canCompleteNoLateCustomAlarmDeparture(presentation) || actionPendingRef.current || completed) return;
        actionPendingRef.current = true;
        setPendingAction("depart");
        setErrorMessage(null);
        setDepartureFailed(false);
        await stopPlayback();
        try {
            const result = await onCompleteDeparture(presentation.scheduleId);
            if (!mountedRef.current) return;
            if (result.status !== "completed") {
                setDepartureFailed(true);
                setErrorMessage("출발 완료를 기록하지 못했어요. 잠시 후 다시 시도해 주세요.");
                return;
            }
            setCompleted(true);
        } catch {
            if (!mountedRef.current) return;
            setDepartureFailed(true);
            setErrorMessage("출발 완료를 기록하지 못했어요. 잠시 후 다시 시도해 주세요.");
        } finally {
            actionPendingRef.current = false;
            if (mountedRef.current) setPendingAction(null);
        }
    }, [completed, onCompleteDeparture, presentation, stopPlayback]);

    const departDisabled = !presentation.canCompleteDeparture || completed || pendingAction !== null;
    const routeDisabled = !presentation.canOpenRoute || pendingAction !== null;
    const formattedTime = formatNoLateAlarmTime(currentTime);
    const [period, clockTime] = formattedTime.split(" ");
    const showDepartureAction = !presentation.isPreview && presentation.canCompleteDeparture;
    const showRouteAction = presentation.canOpenRoute;
    const alarmStatus = stopped ? "알람을 껐어요"
        : presentation.isPreview ? "출발 알람 미리보기"
        : muted ? "소리를 껐어요 · 진동으로 알리는 중"
        : audioLoading ? "알람을 준비하고 있어요"
        : "출발 알람이 울리고 있어요";
    const unavailable = !presentation.hasValidAlarmIdentity;
    const showsPlayback = !completed && !unavailable;
    const heading = (
        <View style={styles.headingBlock}>
            <Text testID="nolate-custom-alarm-schedule-title" accessibilityRole="header"
                style={styles.title}>{presentation.title}</Text>
            <Text accessibilityLiveRegion="polite" style={styles.statusText}>{alarmStatus}</Text>
        </View>
    );

    return (
        <View testID="nolate-custom-alarm-screen" style={styles.screen}>
            <View
                testID="nolate-custom-alarm-atmosphere"
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={styles.atmosphere}
            />
            {presentation.hasValidAlarmIdentity && alarmEngaged && !stopped ? <KeepNoLateAlarmAwake /> : null}
            <StatusBar barStyle="light-content" backgroundColor={BACKGROUND} />
            <View style={[styles.contentWidth, { paddingTop: Math.max(insets.top, 14) }]}>
                <View style={styles.topBar}>
                    {showsPlayback && <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={stopped ? "알람이 꺼짐" : muted ? "소리 모드로 전환" : "무음 모드로 전환"}
                        accessibilityHint={stopped
                            ? undefined
                            : muted
                            ? "현재 진동만 울립니다. 소리 모드에서는 벨소리와 진동이 함께 울립니다."
                            : "현재 벨소리와 진동이 함께 울립니다. 무음 모드에서는 진동만 울립니다."}
                        accessibilityValue={stopped
                            ? { text: "꺼짐" }
                            : { text: muted ? "진동만" : "벨소리와 진동" }}
                        accessibilityState={{ disabled: stopped || pendingAction !== null }}
                        disabled={stopped || pendingAction !== null}
                        onPress={() => {
                            toggleMute().catch(() => undefined);
                        }}
                        style={({ pressed }) => [
                            styles.iconButton,
                            (stopped || pendingAction !== null) && styles.disabled,
                            pressed && styles.pressed,
                        ]}
                    >
                        {audioLoading && !stopped ? (
                            <BrandedLoader size="inline" accessibilityLabel="알람 소리 준비 중" />
                        ) : (
                            <Ionicons
                                accessible={false}
                                name={stopped || muted ? "volume-mute-outline" : "volume-high-outline"}
                                size={22}
                                color={TEXT_PRIMARY}
                            />
                        )}
                    </Pressable>}
                </View>

                <ScrollView
                    bounces={false}
                    style={styles.contentScroll}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {unavailable ? (
                        <View accessibilityRole="alert" style={styles.stateContent}>
                            <View style={styles.unavailableMark}>
                                <Ionicons accessible={false} name="notifications-off-outline" size={30} color={TEXT_SECONDARY} />
                            </View>
                            <Text accessibilityRole="header" style={styles.title}>알람을 열 수 없어요</Text>
                            <Text style={styles.stateDetail}>일정에서 출발 시각과 경로를 확인해 주세요.</Text>
                        </View>
                    ) : completed ? (
                        <View style={styles.stateContent}>
                            <Reanimated.View entering={completionMarkIn} style={styles.completionMark}>
                                <Ionicons accessible={false} name="checkmark-outline" size={36} color="#0A5A43" />
                            </Reanimated.View>
                            <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>출발을 기록했어요</Text>
                            <Text style={styles.stateDetail}>{presentation.title}</Text>
                        </View>
                    ) : (
                        <>
                            {largeText && heading}
                            <View style={styles.logoFrame}>
                                {!stopped && !muted && <Reanimated.View pointerEvents="none" entering={alarmMarkIn} style={styles.alarmRing} />}
                                <Image accessible accessibilityLabel="NoLate" source={require("../../../assets/icon.png")} style={styles.logo} />
                            </View>
                            <View accessible accessibilityLabel={`현재 시각 ${formattedTime}`} style={styles.clockRow}>
                                <Text style={styles.period}>현재 시각 · {period}</Text>
                                <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.currentTime}>{clockTime}</Text>
                            </View>
                            {!largeText && heading}
                        </>
                    )}
                </ScrollView>

                <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                    {errorMessage ? (
                        <View
                            testID="nolate-custom-alarm-error"
                            accessibilityLiveRegion="polite"
                            accessibilityRole="alert"
                            style={styles.errorRow}
                        >
                            <Ionicons
                                accessible={false}
                                name="alert-circle-outline"
                                size={18}
                                color={TEXT_SECONDARY}
                            />
                            <Text style={styles.errorText}>{errorMessage}</Text>
                        </View>
                    ) : null}
                    {unavailable || completed ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={completed && showRouteAction ? "경로 보기" : "알람 화면 닫기"}
                            accessibilityState={{ busy: pendingAction === "route", disabled: pendingAction !== null }}
                            disabled={pendingAction !== null}
                            onPress={() => void (completed && showRouteAction ? openRoute() : close())}
                            style={({ pressed }) => [styles.departButton, pressed && styles.pressed]}
                        >
                            {completed && showRouteAction && (pendingAction === "route"
                                ? <BrandedLoader startup size="inline" accessibilityLabel="경로 여는 중" />
                                : <Ionicons accessible={false} name="map-outline" size={21} color={PRIMARY_BUTTON_FOREGROUND} />)}
                            <Text style={styles.primaryButtonText}>{completed && showRouteAction ? "경로 보기" : "닫기"}</Text>
                        </Pressable>
                    ) : showDepartureAction ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={departureFailed ? "출발 기록 다시 시도" : "지금 출발 완료"}
                            accessibilityHint="현재 일정에 출발 완료를 기록합니다"
                            accessibilityState={{ disabled: departDisabled }}
                            disabled={departDisabled}
                            onPress={() => {
                                completeDeparture().catch(() => undefined);
                            }}
                            style={({ pressed }) => [
                                styles.departButton,
                                presentation.requestedAction === "confirmDeparture" &&
                                    !departDisabled &&
                                    styles.requestedActionButton,
                                departDisabled && styles.disabled,
                                pressed && styles.pressed,
                            ]}
                        >
                            {pendingAction === "depart" ? (
                                <BrandedLoader size="inline" accessibilityLabel="출발 기록 중" />
                            ) : (
                                <Ionicons
                                    accessible={false}
                                    name={departureFailed ? "refresh-outline" : "walk-outline"}
                                    size={22}
                                    color={PRIMARY_BUTTON_FOREGROUND}
                                />
                            )}
                            <Text style={styles.primaryButtonText}>
                                {departureFailed ? "다시 시도" : "출발했어요"}
                            </Text>
                        </Pressable>
                    ) : (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={stopped ? "알람 꺼짐" : "알람 끄기"}
                            accessibilityState={{
                                disabled: stopped || pendingAction !== null,
                            }}
                            disabled={stopped || pendingAction !== null}
                            onPress={() => {
                                stopPlayback().catch(() => undefined);
                            }}
                            style={({ pressed }) => [
                                styles.departButton,
                                (stopped || pendingAction !== null) && styles.disabled,
                                pressed && styles.pressed,
                            ]}
                        >
                            <Ionicons accessible={false} name="stop-outline" size={20} color={PRIMARY_BUTTON_FOREGROUND} />
                            <Text style={styles.primaryButtonText}>{stopped ? "알람 꺼짐" : "알람 끄기"}</Text>
                        </Pressable>
                    )}

                    {showsPlayback && (showRouteAction || showDepartureAction) ? (
                        <View style={[styles.secondaryActions, largeText && styles.secondaryActionsLarge]}>
                            {showRouteAction ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="경로 보기"
                                    accessibilityHint={
                                        presentation.canOpenRoute
                                            ? "일정의 경로 상세 화면을 엽니다"
                                            : "연결된 경로 정보가 없습니다"
                                    }
                                    accessibilityState={{ busy: pendingAction === "route", disabled: routeDisabled }}
                                    disabled={routeDisabled}
                                    onPress={() => {
                                        openRoute().catch(() => undefined);
                                    }}
                                    style={({ pressed }) => [
                                        styles.secondaryButton,
                                        !showDepartureAction && styles.secondaryButtonWide,
                                        presentation.requestedAction === "route" &&
                                            !routeDisabled &&
                                            styles.requestedActionButton,
                                        routeDisabled && styles.disabled,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    {pendingAction === "route" ? (
                                        <BrandedLoader startup size="inline" accessibilityLabel="경로 여는 중" />
                                    ) : (
                                        <Ionicons accessible={false} name="map-outline" size={21} color={TEXT_PRIMARY} />
                                    )}
                                    <Text style={styles.secondaryButtonText}>경로 보기</Text>
                                </Pressable>
                            ) : null}

                            {showDepartureAction ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={stopped ? "알람 꺼짐" : "알람 끄기"}
                                    accessibilityState={{
                                        disabled: stopped || pendingAction !== null,
                                    }}
                                    disabled={stopped || pendingAction !== null}
                                    onPress={() => {
                                        stopPlayback().catch(() => undefined);
                                    }}
                                    style={({ pressed }) => [
                                        styles.secondaryButton,
                                        (stopped || pendingAction !== null) && styles.disabled,
                                        pressed && styles.pressed,
                                    ]}
                                >
                                    <Ionicons accessible={false} name="stop-outline" size={20} color={TEXT_PRIMARY} />
                                    <Text style={styles.secondaryButtonText}>
                                        {stopped ? "알람 꺼짐" : "알람 끄기"}
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ) : null}

                    {!unavailable && (!completed || showRouteAction) && <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="알람 화면 닫기"
                        disabled={pendingAction !== null}
                        onPress={() => {
                            close().catch(() => undefined);
                        }}
                        style={({ pressed }) => [
                            styles.closeButton,
                            pendingAction !== null && styles.disabled,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text style={styles.closeButtonText}>닫기</Text>
                    </Pressable>}
                </View>
            </View>
        </View>
    );
}

const ALARM_VIBRATION_PATTERN = [0, 700, 450, 700, 450];

function startOwnedAlarmVibration(owner: symbol): void {
    if (activeVibrationOwner !== null && activeVibrationOwner !== owner) {
        try {
            Vibration.cancel();
        } catch {
            // A previous native vibration may already be gone.
        }
    }

    activeVibrationOwner = owner;
    try {
        Vibration.vibrate(ALARM_VIBRATION_PATTERN, true);
    } catch {
        if (activeVibrationOwner === owner) activeVibrationOwner = null;
    }
}

function stopOwnedAlarmVibration(owner: symbol): void {
    if (activeVibrationOwner !== owner) return;
    activeVibrationOwner = null;
    try {
        Vibration.cancel();
    } catch {
        // Native haptics can be unavailable during teardown; audio/actions must still finish.
    }
}

function isInitialAlarmAppStateActive(state: string | null | undefined): boolean {
    // React Native can briefly expose null during a notification cold start. Focus still
    // proves that this route is visible; explicit inactive/background events below remain
    // authoritative and immediately stop playback.
    return state === null || state === undefined || state === "active";
}
