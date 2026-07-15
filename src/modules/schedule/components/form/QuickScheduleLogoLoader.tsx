import { Ionicons } from "@expo/vector-icons";
import React, { type ComponentProps, useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";
import Reanimated, {
    cancelAnimation,
    Easing,
    type SharedValue,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import { useTheme } from "../../../theme/ThemeContext";

const APP_LOGO = require("../../../../../assets/icon.png");

const CYAN = "#67E4FF";
const SECONDARY_PARTICLE = "#9CBFFF";
const SECONDARY_PARTICLE_GLOW = "#78A7FF";
const STAGE_WIDTH = 168;
const STAGE_HEIGHT = 164;
const CENTER_X = STAGE_WIDTH / 2;
const CENTER_Y = 78;
const LOGO_SIZE = 74;
const MASTER_ORBIT_DURATION_MS = 10_400;

export type LogoLoaderVariant = "schedule" | "calendar";

type Props = {
    accessibilityLabel: string;
    variant?: LogoLoaderVariant;
};

type OrbitSpec = {
    radiusX: number;
    radiusY: number;
    tiltDegrees: number;
    turns: number;
    phase: number;
};

type SatelliteDefinition = {
    name: ComponentProps<typeof Ionicons>["name"];
    color: string;
};

const HORIZONTAL_ORBIT: OrbitSpec = {
    radiusX: 72,
    radiusY: 27,
    tiltDegrees: -8,
    turns: 3,
    phase: 0,
};

const VERTICAL_ORBIT: OrbitSpec = {
    radiusX: 51,
    radiusY: 66,
    tiltDegrees: 24,
    turns: -2,
    phase: Math.PI / 2,
};

const SATELLITES: Record<LogoLoaderVariant, SatelliteDefinition[]> = {
    schedule: [
        { name: "sparkles", color: "#7DDCFF" },
        { name: "location", color: "#78A7FF" },
        { name: "alarm", color: "#FFD166" },
    ],
    calendar: [
        { name: "calendar-clear", color: "#7DDCFF" },
        { name: "phone-portrait", color: "#78A7FF" },
        { name: "cloud", color: "#A9CBFF" },
    ],
};

export function shouldAnimateLogoOrbit(reduceMotionEnabled: boolean): boolean {
    return !reduceMotionEnabled;
}

/**
 * 실제 완료율을 계산할 수 없는 작업에 사용하는 브랜드 궤도형 로더다.
 * 중앙 앱 로고는 고정하고, 모든 동작은 주변 궤도·입자·글라스 위성에만 적용한다.
 */
export default function QuickScheduleLogoLoader({
    accessibilityLabel,
    variant = "schedule",
}: Props) {
    const { mode } = useTheme();
    const reduceMotionEnabled = useReducedMotion();
    const orbitProgress = useSharedValue(0);
    const isDark = mode === "dark";
    const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
    const satellites = SATELLITES[variant];

    useEffect(() => {
        cancelAnimation(orbitProgress);

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
    }, [orbitProgress, reduceMotionEnabled]);

    const haloAnimatedStyle = useAnimatedStyle(() => {
        const wave = (Math.sin(orbitProgress.value * Math.PI * 8) + 1) / 2;
        return {
            opacity: 0.46 + wave * 0.3,
            transform: [{ scale: 0.96 + wave * 0.07 }],
        };
    });
    const horizontalParticleStyle = useOrbitalParticleStyle(orbitProgress, HORIZONTAL_ORBIT);
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
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={accessibilityLabel}
            style={styles.stage}
        >
            <Reanimated.View
                pointerEvents="none"
                testID="quick-schedule-ambient-halo"
                style={[
                    styles.ambientHalo,
                    { backgroundColor: palette.halo, shadowColor: palette.glow },
                    haloAnimatedStyle,
                ]}
            />

            <View
                pointerEvents="none"
                style={[styles.pedestalShadow, { backgroundColor: palette.pedestalShadow }]}
            />
            <View
                pointerEvents="none"
                style={[
                    styles.pedestal,
                    { backgroundColor: palette.pedestal, borderColor: palette.pedestalBorder },
                ]}
            >
                <View style={[styles.pedestalSheen, { backgroundColor: palette.pedestalSheen }]} />
            </View>

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
                    key={`${variant}-${satellite.name}`}
                    testID={`quick-schedule-satellite-${index}`}
                    pointerEvents="none"
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                        styles.satelliteTile,
                        satellitePositionStyles[index],
                        {
                            backgroundColor: palette.tile,
                            borderColor: palette.tileBorder,
                            shadowColor: palette.tileShadow,
                        },
                        satelliteMotionStyles[index],
                    ]}
                >
                    <View style={[styles.satelliteSheen, { backgroundColor: palette.tileSheen }]} />
                    <Ionicons
                        testID={`quick-schedule-satellite-icon-${index}`}
                        name={satellite.name}
                        size={15}
                        color={satellite.color}
                    />
                </Reanimated.View>
            ))}

            <View
                pointerEvents="none"
                style={[styles.coreHalo, { backgroundColor: palette.coreHalo }]}
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
                <Image
                    testID="quick-schedule-app-logo"
                    source={APP_LOGO}
                    resizeMode="cover"
                    style={[styles.logoImage, { opacity: palette.logoImageOpacity }]}
                />
                <View
                    testID="quick-schedule-logo-glass-treatment"
                    pointerEvents="none"
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.logoGlassTreatment}
                >
                    <View
                        testID="quick-schedule-logo-color-wash"
                        style={[
                            StyleSheet.absoluteFillObject,
                            { backgroundColor: palette.logoWash },
                        ]}
                    />
                    <View
                        testID="quick-schedule-logo-sheen"
                        style={[styles.logoSheen, { backgroundColor: palette.logoSheen }]}
                    />
                    <View
                        style={[styles.logoLowerBloom, { backgroundColor: palette.logoLowerBloom }]}
                    />
                    <View
                        style={[styles.logoTopEdge, { backgroundColor: palette.logoTopEdge }]}
                    />
                </View>
                <View
                    pointerEvents="none"
                    style={[styles.logoEdge, { borderColor: palette.logoEdge }]}
                />
            </View>

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
        </View>
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
        const wave = Math.sin((progress.value * Math.PI * 8) + phase);
        return {
            transform: [
                { translateY: wave * 2 },
                { rotate: `${wave * 1.2}deg` },
            ],
        };
    });
}

const DARK_PALETTE = {
    halo: "rgba(36,107,254,0.28)",
    glow: "#2477FF",
    coreHalo: "rgba(36,107,254,0.12)",
    ringStrong: "rgba(103,196,255,0.42)",
    ringSoft: "rgba(83,139,255,0.28)",
    ringFaint: "rgba(144,183,255,0.16)",
    pedestal: "rgba(25,33,50,0.76)",
    pedestalBorder: "rgba(125,175,255,0.18)",
    pedestalSheen: "rgba(255,255,255,0.08)",
    pedestalShadow: "rgba(0,0,0,0.42)",
    tile: "rgba(32,40,58,0.92)",
    tileBorder: "rgba(255,255,255,0.13)",
    tileSheen: "rgba(255,255,255,0.13)",
    tileShadow: "#000000",
    logoBase: "#4F83DD",
    logoImageOpacity: 0.94,
    logoWash: "rgba(255,255,255,0.09)",
    logoSheen: "rgba(255,255,255,0.24)",
    logoLowerBloom: "rgba(120,169,255,0.08)",
    logoTopEdge: "rgba(255,255,255,0.34)",
    logoEdge: "rgba(255,255,255,0.42)",
    logoShadow: "#6D96ED",
    logoShadowOpacity: 0.28,
};

const LIGHT_PALETTE = {
    halo: "rgba(36,107,254,0.15)",
    glow: "#5A8FFF",
    coreHalo: "rgba(36,107,254,0.07)",
    ringStrong: "rgba(63,137,255,0.35)",
    ringSoft: "rgba(83,139,255,0.23)",
    ringFaint: "rgba(75,131,230,0.13)",
    pedestal: "rgba(255,255,255,0.84)",
    pedestalBorder: "rgba(72,132,230,0.14)",
    pedestalSheen: "rgba(255,255,255,0.72)",
    pedestalShadow: "rgba(53,91,160,0.14)",
    tile: "rgba(255,255,255,0.94)",
    tileBorder: "rgba(82,129,205,0.13)",
    tileSheen: "rgba(255,255,255,0.78)",
    tileShadow: "#5779AA",
    logoBase: "#A7C8F7",
    logoImageOpacity: 0.92,
    logoWash: "rgba(255,255,255,0.15)",
    logoSheen: "rgba(255,255,255,0.36)",
    logoLowerBloom: "rgba(126,172,255,0.11)",
    logoTopEdge: "rgba(255,255,255,0.58)",
    logoEdge: "rgba(255,255,255,0.68)",
    logoShadow: "#8FAEE6",
    logoShadowOpacity: 0.22,
};

const styles = StyleSheet.create({
    stage: {
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        alignSelf: "center",
        position: "relative",
        marginBottom: 2,
        overflow: "visible",
    },
    ambientHalo: {
        position: "absolute",
        left: CENTER_X - 57,
        top: CENTER_Y - 57,
        width: 114,
        height: 114,
        borderRadius: 57,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.45,
        shadowRadius: 26,
    },
    coreHalo: {
        position: "absolute",
        left: CENTER_X - 49,
        top: CENTER_Y - 49,
        width: 98,
        height: 98,
        borderRadius: 49,
        zIndex: 8,
    },
    orbitTrack: {
        position: "absolute",
        borderWidth: StyleSheet.hairlineWidth,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.38,
        shadowRadius: 5,
    },
    horizontalOrbit: {
        left: 4,
        top: 47,
        width: 160,
        height: 62,
        borderRadius: 80,
        transform: [{ rotate: "-8deg" }],
    },
    verticalOrbit: {
        left: 32,
        top: 4,
        width: 104,
        height: 148,
        borderRadius: 74,
        transform: [{ rotate: "24deg" }],
    },
    diagonalOrbit: {
        left: 13,
        top: 40,
        width: 142,
        height: 76,
        borderRadius: 71,
        transform: [{ rotate: "54deg" }],
    },
    pedestalShadow: {
        position: "absolute",
        left: 27,
        top: 126,
        width: 114,
        height: 20,
        borderRadius: 57,
        transform: [{ scaleX: 0.9 }],
    },
    pedestal: {
        position: "absolute",
        left: 13,
        top: 116,
        width: 142,
        height: 34,
        borderRadius: 71,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
    },
    pedestalSheen: {
        position: "absolute",
        left: 18,
        right: 18,
        top: 5,
        height: 8,
        borderRadius: 12,
        opacity: 0.7,
    },
    logoStaticLayer: {
        position: "absolute",
        left: CENTER_X - LOGO_SIZE / 2,
        top: CENTER_Y - LOGO_SIZE / 2,
        width: LOGO_SIZE,
        height: LOGO_SIZE,
        borderRadius: 22,
        zIndex: 12,
        elevation: 12,
        shadowOffset: { width: 0, height: 6 },
        shadowRadius: 19,
    },
    logoImage: {
        width: LOGO_SIZE,
        height: LOGO_SIZE,
        borderRadius: 22,
    },
    logoGlassTreatment: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 22,
        overflow: "hidden",
    },
    logoSheen: {
        position: "absolute",
        left: 7,
        top: 5,
        width: 45,
        height: 18,
        borderRadius: 12,
        transform: [{ rotate: "-8deg" }],
    },
    logoLowerBloom: {
        position: "absolute",
        right: -18,
        bottom: -24,
        width: 66,
        height: 58,
        borderRadius: 33,
    },
    logoTopEdge: {
        position: "absolute",
        left: 17,
        right: 17,
        top: 2,
        height: StyleSheet.hairlineWidth,
        borderRadius: 1,
    },
    logoEdge: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 22,
        borderWidth: StyleSheet.hairlineWidth,
    },
    particle: {
        position: "absolute",
        left: CENTER_X,
        top: CENTER_Y,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 16,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.95,
        shadowRadius: 8,
    },
    horizontalParticle: {
        width: 10,
        height: 10,
        marginLeft: -5,
        marginTop: -5,
        borderRadius: 5,
    },
    verticalParticle: {
        width: 7,
        height: 7,
        marginLeft: -3.5,
        marginTop: -3.5,
        borderRadius: 3.5,
    },
    particleCore: {
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: "#FFFFFF",
    },
    particleCoreSmall: {
        width: 3,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: "#FFFFFF",
    },
    satelliteTile: {
        position: "absolute",
        width: 30,
        height: 30,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 18,
        elevation: 8,
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.2,
        shadowRadius: 9,
        overflow: "hidden",
    },
    satelliteTopLeft: {
        left: 8,
        top: 35,
    },
    satelliteTopRight: {
        right: 7,
        top: 17,
    },
    satelliteBottomRight: {
        right: 10,
        bottom: 15,
    },
    satelliteSheen: {
        position: "absolute",
        left: 4,
        right: 4,
        top: 3,
        height: 7,
        borderRadius: 5,
    },
});
