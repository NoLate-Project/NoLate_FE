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

const CALENDAR_LOGO_DARK = require("../../../../../assets/curation/calendar-sync-3d-device-dark.png");
const CALENDAR_LOGO_LIGHT = require("../../../../../assets/curation/calendar-sync-3d-device-light.png");

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
}: Props) {
    const { mode } = useTheme();
    const reduceMotionEnabled = useReducedMotion();
    const orbitProgress = useSharedValue(0);
    const isDark = mode === "dark";
    const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
    const satellites = SATELLITES[variant];
    const logoSource = isDark ? CALENDAR_LOGO_DARK : CALENDAR_LOGO_LIGHT;

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
        const wave = (Math.sin(orbitProgress.value * Math.PI * 4) + 1) / 2;
        return {
            opacity: 0.38 + wave * 0.12,
            transform: [{ scale: 0.94 + wave * 0.12 }],
        };
    });
    const logoFloatAnimatedStyle = useAnimatedStyle(() => {
        const wave = Math.sin(orbitProgress.value * Math.PI * 4);
        return {
            transform: [
                { translateY: wave * 2.2 },
                { scale: 0.995 + ((wave + 1) / 2) * 0.01 },
            ],
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

            <Reanimated.View
                testID="quick-schedule-logo-float-layer"
                pointerEvents="none"
                style={[styles.logoFloatLayer, logoFloatAnimatedStyle]}
            >
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
                            source={logoSource}
                            resizeMode="cover"
                            fadeDuration={0}
                            accessibilityIgnoresInvertColors
                            style={[
                                styles.calendarLogoImageCrop,
                                { opacity: palette.logoImageOpacity },
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
                            style={[
                                styles.logoLowerBloom,
                                { backgroundColor: palette.logoLowerBloom },
                            ]}
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
            </Reanimated.View>

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
        left: CENTER_X - 34,
        top: CENTER_Y - 34,
        width: 68,
        height: 68,
        borderRadius: 34,
        shadowOffset: { width: 0, height: 0 },
    },
    orbitTrack: {
        position: "absolute",
        borderWidth: StyleSheet.hairlineWidth,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.28,
        shadowRadius: 7,
    },
    horizontalOrbit: {
        left: 8,
        top: 42,
        width: 178,
        height: 82,
        borderRadius: 89,
        transform: [{ rotate: "-7deg" }],
    },
    verticalOrbit: {
        left: 38,
        top: 6,
        width: 118,
        height: 154,
        borderRadius: 77,
        transform: [{ rotate: "24deg" }],
    },
    diagonalOrbit: {
        left: 17,
        top: 32,
        width: 160,
        height: 104,
        borderRadius: 80,
        transform: [{ rotate: "54deg" }],
    },
    logoFloatLayer: {
        position: "absolute",
        left: CENTER_X - LOGO_SIZE / 2,
        top: CENTER_Y - LOGO_SIZE / 2,
        width: LOGO_SIZE,
        height: LOGO_SIZE + 9,
        zIndex: 12,
    },
    logoDepthFar: {
        position: "absolute",
        left: 2,
        top: 7,
        width: LOGO_SIZE - 4,
        height: LOGO_SIZE,
        borderRadius: 25,
        borderWidth: StyleSheet.hairlineWidth,
        opacity: 0.72,
    },
    logoDepthNear: {
        position: "absolute",
        left: 1,
        top: 3.5,
        width: LOGO_SIZE - 2,
        height: LOGO_SIZE,
        borderRadius: 25,
        borderWidth: StyleSheet.hairlineWidth,
        opacity: 0.9,
    },
    logoStaticLayer: {
        position: "absolute",
        left: 0,
        top: 0,
        width: LOGO_SIZE,
        height: LOGO_SIZE,
        borderRadius: 25,
        zIndex: 3,
        elevation: 14,
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 26,
    },
    logoImageMask: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 25,
        overflow: "hidden",
    },
    // 1024px 원본에서 중앙 유리 로고 영역만 84px 프레임에 맞춰 보여준다.
    calendarLogoImageCrop: {
        position: "absolute",
        left: -52,
        top: -49,
        width: 184,
        height: 184,
    },
    logoGlassTreatment: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 25,
        overflow: "hidden",
    },
    logoSheen: {
        position: "absolute",
        left: -12,
        top: -12,
        width: 76,
        height: 38,
        borderRadius: 24,
        transform: [{ rotate: "-10deg" }],
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
        left: 19,
        right: 19,
        top: 2,
        height: 1,
        borderRadius: 1,
    },
    logoEdge: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 25,
        borderWidth: StyleSheet.hairlineWidth,
    },
    particle: {
        position: "absolute",
        left: CENTER_X,
        top: CENTER_Y,
        alignItems: "center",
        justifyContent: "center",
        // 입자는 궤도 바깥에서는 보이지만 중앙 로고를 통과할 때는 로고 뒤로 숨는다.
        zIndex: 8,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.95,
        shadowRadius: 8,
    },
    horizontalParticle: {
        width: 8,
        height: 8,
        marginLeft: -4,
        marginTop: -4,
        borderRadius: 4,
    },
    verticalParticle: {
        width: 6,
        height: 6,
        marginLeft: -3,
        marginTop: -3,
        borderRadius: 3,
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
    satelliteFrame: {
        position: "absolute",
        width: 42,
        height: 46,
        zIndex: 18,
        elevation: 10,
        shadowOffset: { width: 0, height: 7 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
    },
    satelliteDepth: {
        position: "absolute",
        left: 2,
        top: 4,
        width: 38,
        height: 40,
        borderRadius: 13,
        borderWidth: StyleSheet.hairlineWidth,
        opacity: 0.76,
    },
    satelliteTile: {
        width: 40,
        height: 40,
        borderRadius: 13,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    satelliteTopLeft: {
        left: 5,
        top: 38,
    },
    satelliteTopRight: {
        right: 7,
        top: 10,
    },
    satelliteBottomRight: {
        right: 10,
        bottom: 5,
    },
    satelliteInnerGlow: {
        ...StyleSheet.absoluteFillObject,
    },
    satelliteSheen: {
        position: "absolute",
        left: -6,
        top: -7,
        width: 42,
        height: 20,
        borderRadius: 13,
        transform: [{ rotate: "-10deg" }],
    },
    satelliteTopEdge: {
        position: "absolute",
        left: 10,
        right: 10,
        top: 1,
        height: StyleSheet.hairlineWidth,
        borderRadius: 1,
    },
});
