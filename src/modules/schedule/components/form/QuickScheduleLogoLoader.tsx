import { createQuickScheduleLogoLoaderStyles } from "./QuickScheduleLogoLoader.styles";
import { Ionicons } from "@expo/vector-icons";
import React, { type ComponentProps, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { Animated, Easing as NativeEasing, Image, Platform, StyleSheet, View, type ImageSourcePropType } from "react-native";
import Reanimated, {
    cancelAnimation,
    Easing,
    ReduceMotion,
    type SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import { useTheme } from "../../../theme/ThemeContext";
import { useSystemReduceMotion } from "../../../performance/useSystemReduceMotion";

const CALENDAR_LOGO_DARK = require("../../../../../assets/curation/calendar-sync-3d-device-dark.png");
const CALENDAR_LOGO_LIGHT = require("../../../../../assets/curation/calendar-sync-3d-device-light.png");
const APP_LOGO_FACE = require("../../../../../assets/curation/nolate-logo.png");
const IOS_STARTUP_LOGO = { uri: "SplashScreenLogo" };
const STARTUP_LOGO_SIZE = 82;

const CYAN = "#67E4FF";
const SECONDARY_PARTICLE = "#9CBFFF";
const SECONDARY_PARTICLE_GLOW = "#78A7FF";
const STAGE_WIDTH = 194;
const STAGE_HEIGHT = 176;
const CENTER_X = STAGE_WIDTH / 2;
const CENTER_Y = 84;
const LOGO_SIZE = 84;
const MASTER_ORBIT_DURATION_MS = 12_800;

export type LogoLoaderVariant = "schedule" | "calendar" | "route" | "share" | "auth";

type Props = {
    accessibilityLabel: string;
    variant?: LogoLoaderVariant;
    settleOnly?: boolean;
    settleDelayMs?: number;
    settleDurationMs?: number;
    hideBeforeSettle?: boolean;
    useAppLogoFace?: boolean;
    appLogoFaceSize?: number;
};

type OrbitSpec = {
    radiusX: number;
    radiusY: number;
    tiltDegrees: number;
    turns: number;
    phase: number;
};

type SatelliteDefinition = {
    id: string;
    name: ComponentProps<typeof Ionicons>["name"];
    color?: string;
    usesDeviceColor?: boolean;
};

const HORIZONTAL_ORBIT: OrbitSpec = {
    radiusX: 84,
    radiusY: 38,
    tiltDegrees: -7,
    turns: 2,
    phase: 0,
};

const VERTICAL_ORBIT: OrbitSpec = {
    radiusX: 54,
    radiusY: 68,
    tiltDegrees: 24,
    turns: -1,
    phase: Math.PI / 2,
};

const SATELLITES: Record<LogoLoaderVariant, SatelliteDefinition[]> = {
    schedule: [
        { id: "sparkles", name: "sparkles", color: "#7DDCFF" },
        { id: "location", name: "location", color: "#78A7FF" },
        { id: "alarm", name: "alarm", color: "#FFD166" },
    ],
    calendar: [
        {
            id: "device",
            name: "phone-portrait-outline",
            usesDeviceColor: true,
        },
        { id: "calendar", name: "calendar-clear-outline", color: "#67E4FF" },
        { id: "synced-calendar", name: "cloud-done-outline", color: "#A9CBFF" },
    ],
    route: [
        { id: "location", name: "location-outline", color: "#67E4FF" },
        { id: "transit", name: "bus-outline", color: "#A9CBFF" },
        { id: "time", name: "time-outline", color: "#FFD166" },
    ],
    share: [
        { id: "person", name: "person-outline", usesDeviceColor: true },
        { id: "link", name: "link-outline", color: "#67E4FF" },
        { id: "accepted", name: "checkmark-circle-outline", color: "#A9CBFF" },
    ],
    auth: [
        { id: "person", name: "person-outline", usesDeviceColor: true },
        { id: "security", name: "shield-checkmark-outline", color: "#67E4FF" },
        { id: "key", name: "key-outline", color: "#A9CBFF" },
    ],
};

export function shouldAnimateLogoOrbit(reduceMotionEnabled: boolean): boolean {
    return !reduceMotionEnabled;
}

/**
 * 실제 완료율을 계산할 수 없는 작업에 사용하는 브랜드 궤도형 로더다.
 * 로고와 연결 서비스는 여러 장의 반투명 레이어로 깊이를 만들고, 움직임은 느린 부유와
 * 궤도 입자에만 제한한다. 따라서 단계 문구는 읽기 쉽고 로더는 배경처럼 차분하게 동작한다.
 */
export default function QuickScheduleLogoLoader({
    accessibilityLabel,
    variant = "schedule",
    settleOnly = false,
    settleDelayMs = 0,
    settleDurationMs = 300,
    hideBeforeSettle = false,
    useAppLogoFace = false,
    appLogoFaceSize = 76,
}: Props) {
    const { mode } = useTheme();
    const reduceMotionEnabled = useSystemReduceMotion();
    const orbitProgress = useSharedValue(settleOnly && reduceMotionEnabled ? 1 : 0);
    const skippedSettle = useRef(false);
    const isDark = mode === "dark";
    const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
    const satellites = SATELLITES[variant];
    const logoSource = useAppLogoFace ? APP_LOGO_FACE : isDark ? CALENDAR_LOGO_DARK : CALENDAR_LOGO_LIGHT;

    useEffect(() => {
        cancelAnimation(orbitProgress);

        if (settleOnly) {
            if (reduceMotionEnabled) skippedSettle.current = true;
            orbitProgress.value = skippedSettle.current ? 1 : 0;
            if (!skippedSettle.current) {
                const settle = withTiming(1, {
                    duration: settleDurationMs,
                    easing: Easing.out(Easing.cubic),
                    reduceMotion: ReduceMotion.System,
                });
                orbitProgress.value = settleDelayMs > 0 ? withDelay(settleDelayMs, settle) : settle;
            }
            return () => cancelAnimation(orbitProgress);
        }
        if (!shouldAnimateLogoOrbit(reduceMotionEnabled)) {
            orbitProgress.value = 0.08;
            return () => cancelAnimation(orbitProgress);
        }

        orbitProgress.value = 0;
        orbitProgress.value = withRepeat(
            withTiming(1, {
                duration: MASTER_ORBIT_DURATION_MS,
                easing: Easing.linear,
            }),
            -1,
            false
        );

        return () => cancelAnimation(orbitProgress);
    }, [orbitProgress, reduceMotionEnabled, settleOnly, settleDelayMs, settleDurationMs]);

    const haloAnimatedStyle = useAnimatedStyle(() => {
        const wave = (Math.sin(orbitProgress.value * Math.PI * 4) + 1) / 2;
        return {
            opacity: 0.38 + wave * 0.12,
            transform: [{ scale: 0.94 + wave * 0.12 }],
        };
    });
    const logoFloatAnimatedStyle = useAnimatedStyle(() => {
        if (settleOnly) {
            const progress = reduceMotionEnabled ? 1 : orbitProgress.value;
            const remaining = 1 - progress;
            return {
                opacity: hideBeforeSettle ? Math.min(1, progress * 8) : 1,
                transform: [
                    { perspective: 480 },
                    { translateY: 7 * remaining },
                    { rotateY: `${-28 * remaining}deg` },
                    { rotateX: `${17 * remaining}deg` },
                    { scale: (useAppLogoFace ? appLogoFaceSize / LOGO_SIZE : 1) * (1 - 0.10 * remaining) },
                ],
            };
        }
        const wave = Math.sin(orbitProgress.value * Math.PI * 4);
        return {
            transform: [
                { translateY: wave * 2.2 },
                { scale: 0.995 + ((wave + 1) / 2) * 0.01 },
            ],
        };
    });
    const horizontalParticleStyle = useOrbitalParticleStyle(orbitProgress, HORIZONTAL_ORBIT);
    const settleReflectionStyle = useAnimatedStyle(() => ({
        opacity: Math.sin(Math.PI * orbitProgress.value) * 0.48,
        transform: [
            { translateX: 156 * orbitProgress.value - 58 },
            { rotate: "23deg" },
        ],
    }));
    const verticalParticleStyle = useOrbitalParticleStyle(orbitProgress, VERTICAL_ORBIT);
    const satelliteTopLeftStyle = useFloatingStyle(orbitProgress, 0);
    const satelliteTopRightStyle = useFloatingStyle(orbitProgress, Math.PI * 0.7);
    const satelliteBottomRightStyle = useFloatingStyle(orbitProgress, Math.PI * 1.35);
    const satelliteMotionStyles = [
        satelliteTopLeftStyle,
        satelliteTopRightStyle,
        satelliteBottomRightStyle,
    ];
    const satellitePositionStyles = [
        styles.satelliteTopLeft,
        styles.satelliteTopRight,
        styles.satelliteBottomRight,
    ];

    return (
        <View
            accessible={!settleOnly}
            accessibilityElementsHidden={settleOnly}
            importantForAccessibility={settleOnly ? "no-hide-descendants" : "auto"}
            accessibilityRole={settleOnly ? undefined : "progressbar"}
            accessibilityLabel={settleOnly ? undefined : accessibilityLabel}
            style={[styles.stage, settleOnly && { height: useAppLogoFace ? 110 : 126 }]}
        >
            {!settleOnly && <>
            <Reanimated.View
                pointerEvents="none"
                testID="quick-schedule-ambient-halo"
                style={[
                    styles.ambientHalo,
                    {
                        backgroundColor: palette.glow,
                        shadowColor: palette.glow,
                        shadowOpacity: palette.haloShadowOpacity,
                        shadowRadius: palette.haloShadowRadius,
                    },
                    haloAnimatedStyle,
                ]}
            />

            <View
                pointerEvents="none"
                testID="quick-schedule-orbit-track-0"
                style={[
                    styles.orbitTrack,
                    styles.horizontalOrbit,
                    { borderColor: palette.ringStrong, shadowColor: palette.glow },
                ]}
            />
            <View
                pointerEvents="none"
                testID="quick-schedule-orbit-track-1"
                style={[
                    styles.orbitTrack,
                    styles.verticalOrbit,
                    { borderColor: palette.ringSoft, shadowColor: palette.glow },
                ]}
            />
            <View
                pointerEvents="none"
                testID="quick-schedule-orbit-track-2"
                style={[
                    styles.orbitTrack,
                    styles.diagonalOrbit,
                    { borderColor: palette.ringFaint, shadowColor: palette.glow },
                ]}
            />

            {satellites.map((satellite, index) => (
                <Reanimated.View
                    key={`${variant}-${satellite.id}`}
                    testID={`quick-schedule-satellite-${index}`}
                    pointerEvents="none"
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                        styles.satelliteFrame,
                        satellitePositionStyles[index],
                        { shadowColor: palette.tileShadow },
                        satelliteMotionStyles[index],
                    ]}
                >
                    <View
                        pointerEvents="none"
                        style={[
                            styles.satelliteDepth,
                            {
                                backgroundColor: palette.tileDepth,
                                borderColor: palette.tileDepthBorder,
                            },
                        ]}
                    />
                    <View
                        style={[
                            styles.satelliteTile,
                            {
                                backgroundColor: palette.tile,
                                borderColor: palette.tileBorder,
                            },
                        ]}
                    >
                        <View
                            style={[
                                styles.satelliteInnerGlow,
                                { backgroundColor: palette.tileInnerGlow },
                            ]}
                        />
                        <View
                            style={[styles.satelliteSheen, { backgroundColor: palette.tileSheen }]}
                        />
                        <Ionicons
                            testID={`quick-schedule-satellite-icon-${index}`}
                            name={satellite.name}
                            size={19}
                            color={satellite.usesDeviceColor
                                ? palette.deviceGlyph
                                : satellite.color}
                        />
                        <View
                            pointerEvents="none"
                            style={[
                                styles.satelliteTopEdge,
                                { backgroundColor: palette.tileTopEdge },
                            ]}
                        />
                    </View>
                </Reanimated.View>
            ))}
            </>}

            <Reanimated.View
                testID="quick-schedule-logo-float-layer"
                pointerEvents="none"
                style={[styles.logoFloatLayer, settleOnly && { top: 18 }, logoFloatAnimatedStyle]}
            >
                <LogoFace
                    palette={palette}
                    source={logoSource}
                    useAppLogoFace={useAppLogoFace}
                    reflection={settleOnly && !reduceMotionEnabled
                        ? <Reanimated.View style={[styles.settleReflection, settleReflectionStyle]} />
                        : undefined}
                />
            </Reanimated.View>

            {!settleOnly && <>
            <Reanimated.View
                testID="quick-schedule-logo-orbit"
                pointerEvents="none"
                style={[
                    styles.particle,
                    styles.horizontalParticle,
                    { backgroundColor: CYAN, shadowColor: CYAN },
                    horizontalParticleStyle,
                ]}
            >
                <View style={styles.particleCore} />
            </Reanimated.View>
            <Reanimated.View
                testID="quick-schedule-logo-orbit-secondary"
                pointerEvents="none"
                style={[
                    styles.particle,
                    styles.verticalParticle,
                    {
                        backgroundColor: SECONDARY_PARTICLE,
                        shadowColor: SECONDARY_PARTICLE_GLOW,
                    },
                    verticalParticleStyle,
                ]}
            >
                <View style={styles.particleCoreSmall} />
            </Reanimated.View>
            </>}
        </View>
    );
}

/** Drive the first-screen motion without a JavaScript timer. */
export function StartupLogoLoader({ delayMs, durationMs }: { delayMs: number; durationMs: number }) {
    const { mode } = useTheme();
    const reduceMotion = useSystemReduceMotion();
    const usesNativeArtwork = Platform.OS === "ios";
    const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
    const skippedMotion = useRef(false);

    useLayoutEffect(() => {
        if (reduceMotion) {
            skippedMotion.current = true;
            progress.setValue(1);
        }
        if (skippedMotion.current) return;

        // Include the initial hold in the frames sent to the native driver.
        const totalDurationMs = delayMs + durationMs;
        const settle = usesNativeArtwork
            ? NativeEasing.inOut(NativeEasing.quad)
            : NativeEasing.out(NativeEasing.cubic);
        const animation = Animated.timing(progress, {
            duration: totalDurationMs,
            easing: elapsed => settle(Math.max(0, (elapsed * totalDurationMs - delayMs) / durationMs)),
            toValue: 1,
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [delayMs, durationMs, progress, reduceMotion, usesNativeArtwork]);

    const reflection = !reduceMotion && (
        <Animated.View style={[styles.settleReflection, {
            opacity: progress.interpolate({
                inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 0.34, 0.48, 0.34, 0],
            }),
            transform: [
                { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-58, 98] }) },
                { rotate: "23deg" },
            ],
        }]} />
    );

    if (usesNativeArtwork) {
        // UIKit and React Native display the same asset at the same size before movement begins.
        const inputRange = [0, 0.45, 1];
        return (
            <Animated.View
                testID="startup-logo-stage"
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[startupStyles.mark, {
                    transform: [
                        { perspective: 480 },
                        { rotateY: progress.interpolate({ inputRange, outputRange: ["0deg", "-16deg", "0deg"] }) },
                        { rotateX: progress.interpolate({ inputRange, outputRange: ["0deg", "10deg", "0deg"] }) },
                        { scale: progress.interpolate({ inputRange, outputRange: [1, 0.96, 1] }) },
                    ],
                }]}
            >
                <Image
                    testID="startup-native-logo"
                    source={IOS_STARTUP_LOGO}
                    resizeMode="contain"
                    fadeDuration={0}
                    accessibilityIgnoresInvertColors
                    style={startupStyles.mark}
                />
                {reflection && <View style={startupStyles.reflectionMask}>{reflection}</View>}
            </Animated.View>
        );
    }

    const inputRange = [0, 1];
    const scale = STARTUP_LOGO_SIZE / LOGO_SIZE;
    return (
        <View
            testID="startup-logo-stage"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.stage, { height: 110 }]}
        >
            <Animated.View
                pointerEvents="none"
                style={[styles.logoFloatLayer, { top: 18, transform: [
                    { perspective: 480 },
                    { translateY: progress.interpolate({ inputRange, outputRange: [7, 0] }) },
                    { rotateY: progress.interpolate({ inputRange, outputRange: ["-28deg", "0deg"] }) },
                    { rotateX: progress.interpolate({ inputRange, outputRange: ["17deg", "0deg"] }) },
                    { scale: progress.interpolate({ inputRange, outputRange: [scale * 0.9, scale] }) },
                ] }]}
            >
                <LogoFace
                    palette={mode === "dark" ? DARK_PALETTE : LIGHT_PALETTE}
                    source={APP_LOGO_FACE}
                    useAppLogoFace
                    reflection={reflection}
                />
            </Animated.View>
        </View>
    );
}

const startupStyles = StyleSheet.create({
    mark: { width: STARTUP_LOGO_SIZE, height: STARTUP_LOGO_SIZE },
    reflectionMask: { position: "absolute", top: 1, left: 3, right: 3, bottom: 5, borderRadius: 24, overflow: "hidden" },
});

function LogoFace({
    palette,
    source,
    useAppLogoFace,
    reflection,
}: {
    palette: typeof DARK_PALETTE;
    source: ImageSourcePropType;
    useAppLogoFace: boolean;
    reflection?: ReactNode;
}) {
    return (
        <>
            <View
                testID="quick-schedule-logo-depth-far"
                style={[
                    styles.logoDepthFar,
                    {
                        backgroundColor: palette.logoDepthFar,
                        borderColor: palette.logoDepthBorder,
                    },
                ]}
            />
            <View
                testID="quick-schedule-logo-depth-near"
                style={[
                    styles.logoDepthNear,
                    {
                        backgroundColor: palette.logoDepthNear,
                        borderColor: palette.logoDepthBorder,
                    },
                ]}
            />
            <View
                testID="quick-schedule-logo-static-layer"
                pointerEvents="none"
                collapsable={false}
                style={[
                    styles.logoStaticLayer,
                    {
                        backgroundColor: palette.logoBase,
                        shadowColor: palette.logoShadow,
                        shadowOpacity: palette.logoShadowOpacity,
                    },
                ]}
            >
                <View style={styles.logoImageMask}>
                    <Image
                        testID="quick-schedule-app-logo"
                        source={source}
                        resizeMode="cover"
                        fadeDuration={0}
                        accessibilityIgnoresInvertColors
                        style={[
                            useAppLogoFace ? styles.appLogoFace : styles.calendarLogoImageCrop,
                            { opacity: useAppLogoFace ? 1 : palette.logoImageOpacity },
                        ]}
                    />
                </View>
                <View
                    testID="quick-schedule-logo-glass-treatment"
                    pointerEvents="none"
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.logoGlassTreatment}
                >
                    {!useAppLogoFace && <View
                        testID="quick-schedule-logo-color-wash"
                        style={[
                            StyleSheet.absoluteFillObject,
                            { backgroundColor: palette.logoWash },
                        ]}
                    />}
                    <View
                        testID="quick-schedule-logo-sheen"
                        style={[styles.logoSheen, { backgroundColor: palette.logoSheen }]}
                    />
                    {reflection}
                    {!useAppLogoFace && <View
                        style={[
                            styles.logoLowerBloom,
                            { backgroundColor: palette.logoLowerBloom },
                        ]}
                    />}
                    <View
                        style={[styles.logoTopEdge, { backgroundColor: palette.logoTopEdge }]}
                    />
                </View>
                <View
                    pointerEvents="none"
                    style={[styles.logoEdge, { borderColor: palette.logoEdge }]}
                />
            </View>
        </>
    );
}

function useOrbitalParticleStyle(progress: SharedValue<number>, orbit: OrbitSpec) {
    return useAnimatedStyle(() => {
        const angle = (progress.value * Math.PI * 2 * orbit.turns) + orbit.phase;
        const tilt = orbit.tiltDegrees * Math.PI / 180;
        const orbitX = orbit.radiusX * Math.cos(angle);
        const orbitY = orbit.radiusY * Math.sin(angle);
        const x = (orbitX * Math.cos(tilt)) - (orbitY * Math.sin(tilt));
        const y = (orbitX * Math.sin(tilt)) + (orbitY * Math.cos(tilt));
        const depth = (Math.sin(angle) + 1) / 2;

        return {
            opacity: 0.58 + depth * 0.42,
            transform: [
                { translateX: x },
                { translateY: y },
                { scale: 0.82 + depth * 0.24 },
            ],
        };
    });
}

function useFloatingStyle(progress: SharedValue<number>, phase: number) {
    return useAnimatedStyle(() => {
        const wave = Math.sin((progress.value * Math.PI * 4) + phase);
        return {
            transform: [
                { translateY: wave * 3 },
                { rotate: `${wave * 0.7}deg` },
                { scale: 0.99 + ((wave + 1) / 2) * 0.02 },
            ],
        };
    });
}

const DARK_PALETTE = {
    glow: "#3B87FF",
    haloShadowOpacity: 0.28,
    haloShadowRadius: 38,
    ringStrong: "rgba(126,211,255,0.30)",
    ringSoft: "rgba(113,158,255,0.22)",
    ringFaint: "rgba(154,190,255,0.13)",
    tile: "rgba(218,231,255,0.16)",
    tileDepth: "rgba(53,78,126,0.34)",
    tileDepthBorder: "rgba(190,215,255,0.13)",
    tileBorder: "rgba(255,255,255,0.24)",
    tileInnerGlow: "rgba(117,169,255,0.10)",
    tileSheen: "rgba(255,255,255,0.22)",
    tileTopEdge: "rgba(255,255,255,0.52)",
    tileShadow: "#000000",
    deviceGlyph: "#F3F6FF",
    logoDepthFar: "rgba(19,48,102,0.92)",
    logoDepthNear: "rgba(38,94,188,0.96)",
    logoDepthBorder: "rgba(151,190,255,0.22)",
    logoBase: "#2E7FEF",
    logoImageOpacity: 1,
    logoWash: "rgba(255,255,255,0.035)",
    logoSheen: "rgba(255,255,255,0.13)",
    logoLowerBloom: "rgba(116,151,255,0.09)",
    logoTopEdge: "rgba(255,255,255,0.58)",
    logoEdge: "rgba(255,255,255,0.50)",
    logoShadow: "#4A8DFF",
    logoShadowOpacity: 0.34,
};

const LIGHT_PALETTE = {
    glow: "#6B9EFF",
    haloShadowOpacity: 0.18,
    haloShadowRadius: 36,
    ringStrong: "rgba(60,139,255,0.25)",
    ringSoft: "rgba(75,131,230,0.18)",
    ringFaint: "rgba(75,131,230,0.11)",
    tile: "rgba(255,255,255,0.72)",
    tileDepth: "rgba(179,203,242,0.36)",
    tileDepthBorder: "rgba(103,145,211,0.13)",
    tileBorder: "rgba(255,255,255,0.92)",
    tileInnerGlow: "rgba(91,143,235,0.07)",
    tileSheen: "rgba(255,255,255,0.88)",
    tileTopEdge: "rgba(255,255,255,0.98)",
    tileShadow: "#5779AA",
    deviceGlyph: "#465066",
    logoDepthFar: "rgba(112,155,226,0.62)",
    logoDepthNear: "rgba(104,160,242,0.78)",
    logoDepthBorder: "rgba(255,255,255,0.72)",
    logoBase: "#74A8F1",
    logoImageOpacity: 0.98,
    logoWash: "rgba(255,255,255,0.07)",
    logoSheen: "rgba(255,255,255,0.18)",
    logoLowerBloom: "rgba(113,131,255,0.08)",
    logoTopEdge: "rgba(255,255,255,0.78)",
    logoEdge: "rgba(255,255,255,0.84)",
    logoShadow: "#729BE1",
    logoShadowOpacity: 0.22,
};

const styles = createQuickScheduleLogoLoaderStyles({
    CENTER_X,
    CENTER_Y,
    LOGO_SIZE,
    STAGE_HEIGHT,
    STAGE_WIDTH,
});
