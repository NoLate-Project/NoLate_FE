import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View, type ViewProps } from "react-native";

import { useTheme } from "../../../theme/ThemeContext";

type GlassEffectModule = {
    GlassContainer: React.ComponentType<ViewProps & {
        spacing?: number;
    }>;
    GlassView: React.ComponentType<ViewProps & {
        colorScheme?: "dark" | "light";
        glassEffectStyle?: "clear" | "regular";
        isInteractive?: boolean;
        tintColor?: string;
    }>;
    isGlassEffectAPIAvailable: () => boolean;
    isLiquidGlassAvailable: () => boolean;
};

export type LiquidGlassVariant =
    | "toolbar"
    | "popover"
    | "sheet"
    | "card"
    | "mapCard"
    | "alert"
    | "bottomBar";

type Props = ViewProps & {
    interactive?: boolean;
    clear?: boolean;
    prominent?: boolean;
    variant?: LiquidGlassVariant;
    tone?: "default" | "flat" | "softGlass" | "menuLiquid" | "solidCard";
    glow?: boolean;
};

type ContainerProps = ViewProps & {
    spacing?: number;
};

type GlassPalette = {
    background: string;
    nativeTint?: string;
    highlight: string;
    stroke: string;
    glow: string;
    contrast: string;
    sheen: string;
};

export const liquidGlassTokens = {
    cornerRadiusSmall: 14,
    cornerRadiusMedium: 22,
    cornerRadiusLarge: 28,
    cornerRadiusSheet: 30,
    padding: 14,
    pressedScale: 0.96,
    spring: {
        damping: 22,
        stiffness: 230,
        mass: 0.9,
    },
    quickSpring: {
        damping: 18,
        stiffness: 260,
        mass: 0.82,
    },
} as const;

function loadGlassEffect(): GlassEffectModule | null {
    try {
        return require("expo-glass-effect") as GlassEffectModule;
    } catch {
        return null;
    }
}

function canUseNativeGlass() {
    if (Platform.OS !== "ios") return false;

    try {
        const glassEffect = loadGlassEffect();
        return Boolean(
            glassEffect?.isGlassEffectAPIAvailable() &&
            glassEffect.isLiquidGlassAvailable()
        );
    } catch {
        return false;
    }
}

function getGlassPalette(
    mode: "dark" | "light",
    clear: boolean,
    prominent: boolean,
    variant: LiquidGlassVariant,
    reduceTransparency: boolean
): GlassPalette {
    const isDark = mode === "dark";
    const isAndroid = Platform.OS === "android";
    const stronger = prominent || variant === "sheet" || variant === "mapCard" || variant === "alert";
    const airy = clear || variant === "toolbar" || variant === "bottomBar" || variant === "popover";

    if (isDark) {
        const background = reduceTransparency
            ? "rgba(17, 18, 22, 0.98)"
            : variant === "bottomBar"
                ? "rgba(32, 34, 40, 0.40)"
            : variant === "toolbar" || variant === "popover"
                ? "rgba(24, 25, 30, 0.41)"
            : stronger
                ? "rgba(18, 19, 24, 0.74)"
                : airy
                    ? isAndroid
                        ? "rgba(24, 25, 30, 0.94)"
                        : "rgba(22, 23, 28, 0.50)"
                    : isAndroid
                        ? "rgba(28, 29, 35, 0.96)"
                        : "rgba(28, 29, 35, 0.65)";
        return {
            background,
            nativeTint: stronger ? "rgba(255, 255, 255, 0.059)" : "rgba(255, 255, 255, 0.032)",
            highlight: variant === "bottomBar" ? "rgba(255,255,255,0.27)" : "rgba(255,255,255,0.18)",
            stroke: variant === "bottomBar" ? "rgba(255,255,255,0.27)" : "rgba(255,255,255,0.20)",
            glow: variant === "mapCard" ? "rgba(47,128,255,0.18)" : "rgba(255,255,255,0.09)",
            contrast: stronger ? "rgba(0,0,0,0.135)" : "rgba(0,0,0,0.050)",
            sheen: variant === "bottomBar" ? "rgba(255,255,255,0.074)" : "rgba(255,255,255,0.058)",
        };
    }

    const background = reduceTransparency
        ? "rgba(255, 255, 255, 0.98)"
            : variant === "bottomBar"
            ? "rgba(255, 255, 255, 0.59)"
        : variant === "toolbar" || variant === "popover"
            ? "rgba(255, 255, 255, 0.45)"
        : stronger
            ? "rgba(255, 255, 255, 0.77)"
            : airy
                ? isAndroid
                    ? "rgba(255, 255, 255, 0.94)"
                    : "rgba(255, 255, 255, 0.52)"
                : isAndroid
                    ? "rgba(255, 255, 255, 0.96)"
                    : "rgba(255, 255, 255, 0.65)";
    return {
        background,
        nativeTint: variant === "bottomBar"
            ? "rgba(255, 255, 255, 0.16)"
            : stronger ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.072)",
        highlight: variant === "bottomBar" ? "rgba(255,255,255,0.77)" : "rgba(255,255,255,0.68)",
        stroke: variant === "bottomBar" ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.56)",
        glow: variant === "mapCard" ? "rgba(47,128,255,0.108)" : "rgba(255,255,255,0.20)",
        contrast: variant === "bottomBar" ? "rgba(255,255,255,0.099)" : "rgba(255,255,255,0.072)",
        sheen: variant === "bottomBar" ? "rgba(255,255,255,0.216)" : "rgba(255,255,255,0.252)",
    };
}

export default function CalendarGlassSurface({
    children,
    interactive = false,
    clear = false,
    prominent = false,
    variant = "card",
    tone = "default",
    glow = false,
    style,
    ...viewProps
}: Props) {
    const { mode } = useTheme();
    const [reduceTransparency, setReduceTransparency] = useState(false);
    const nativeGlassAvailable = canUseNativeGlass();
    const glassEffect = nativeGlassAvailable ? loadGlassEffect() : null;
    const palette = getGlassPalette(mode, clear, prominent, variant, reduceTransparency);
    const isFlatTone = tone === "flat";
    const isSoftGlassTone = tone === "softGlass";
    const isMenuLiquidTone = tone === "menuLiquid";
    const isSolidCardTone = tone === "solidCard";
    const usesTonedSurface = isFlatTone || isSoftGlassTone || isMenuLiquidTone || isSolidCardTone;
    const menuLiquidNativeTint = mode === "dark"
        ? "rgba(8, 9, 14, 0.76)"
        : "rgba(255, 255, 255, 0.76)";

    useEffect(() => {
        let mounted = true;
        AccessibilityInfo.isReduceTransparencyEnabled()
            .then((enabled) => {
                if (mounted) setReduceTransparency(enabled);
            })
            .catch(() => undefined);

        const subscription = AccessibilityInfo.addEventListener?.(
            "reduceTransparencyChanged",
            setReduceTransparency
        );

        return () => {
            mounted = false;
            subscription?.remove?.();
        };
    }, []);

    if (nativeGlassAvailable && glassEffect) {
        const { GlassView } = glassEffect;

        return (
            <GlassView
                {...viewProps}
                colorScheme={mode}
                glassEffectStyle="regular"
                isInteractive={interactive}
                tintColor={isMenuLiquidTone ? menuLiquidNativeTint : palette.nativeTint}
                style={[
                    styles.surface,
                    styles.clipped,
                    styles.nativeDepth,
                    variant === "bottomBar" && styles.bottomBarDepth,
                    variant === "mapCard" && styles.mapDepth,
                    style,
                    isMenuLiquidTone && (
                        mode === "dark" ? styles.menuLiquidSurfaceDark : styles.menuLiquidSurfaceLight
                    ),
                    isSolidCardTone && (
                        mode === "dark" ? styles.solidCardSurfaceDark : styles.solidCardSurfaceLight
                    ),
                ]}
            >
                {!isSolidCardTone && (prominent || reduceTransparency) && (
                    <View
                        pointerEvents="none"
                        style={[
                            StyleSheet.absoluteFillObject,
                            isFlatTone && styles.prominentFillFlat,
                            isSoftGlassTone && styles.prominentFillSoftGlass,
                            isMenuLiquidTone && styles.prominentFillMenuLiquid,
                            { backgroundColor: palette.background },
                        ]}
                    />
                )}
                {!isSolidCardTone && (
                    <View
                        pointerEvents="none"
                        style={[
                            StyleSheet.absoluteFillObject,
                            styles.contrastLayer,
                            usesTonedSurface && (
                                isMenuLiquidTone
                                    ? styles.contrastLayerMenuLiquid
                                    : isSoftGlassTone
                                        ? styles.contrastLayerSoftGlass
                                        : styles.contrastLayerFlat
                            ),
                            { backgroundColor: palette.contrast },
                        ]}
                    />
                )}
                {!isSolidCardTone && (glow || variant === "mapCard") && (
                    <View
                        pointerEvents="none"
                        style={[
                            StyleSheet.absoluteFillObject,
                            styles.glow,
                            { backgroundColor: palette.glow },
                        ]}
                    />
                )}
                {!isSolidCardTone && !isFlatTone && !isMenuLiquidTone && (
                    <View
                        pointerEvents="none"
                        style={[
                            styles.sheenLayer,
                            isSoftGlassTone && styles.sheenLayerSoftGlass,
                            { backgroundColor: palette.sheen },
                        ]}
                    />
                )}
                {children}
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        styles.topHighlight,
                        usesTonedSurface && (
                            isMenuLiquidTone
                                ? styles.topHighlightMenuLiquid
                                : isSolidCardTone
                                    ? styles.topHighlightSolidCard
                                    : isSoftGlassTone
                                    ? styles.topHighlightSoftGlass
                                    : styles.topHighlightFlat
                        ),
                        { borderTopColor: palette.highlight },
                    ]}
                />
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        styles.innerStroke,
                        { borderColor: palette.stroke },
                    ]}
                />
            </GlassView>
        );
    }

    return (
        <View
            {...viewProps}
            style={[
                styles.surface,
                styles.fallbackDepth,
                variant === "bottomBar" && styles.bottomBarDepth,
                variant === "mapCard" && styles.mapDepth,
                style,
                { backgroundColor: palette.background },
                isMenuLiquidTone && (
                    mode === "dark" ? styles.menuLiquidSurfaceDark : styles.menuLiquidSurfaceLight
                ),
                isSolidCardTone && (
                    mode === "dark" ? styles.solidCardSurfaceDark : styles.solidCardSurfaceLight
                ),
                styles.clipped,
                Platform.OS === "android" && styles.androidDepth,
            ]}
        >
            {!isSolidCardTone && prominent && (
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        styles.prominentFill,
                        isFlatTone && styles.prominentFillFlat,
                        isSoftGlassTone && styles.prominentFillSoftGlass,
                        isMenuLiquidTone && styles.prominentFillMenuLiquid,
                        mode === "dark"
                            ? styles.prominentFillDark
                            : styles.prominentFillLight,
                    ]}
                />
            )}
            {!isSolidCardTone && (
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        styles.contrastLayer,
                        usesTonedSurface && (
                            isMenuLiquidTone
                                ? styles.contrastLayerMenuLiquid
                                : isSoftGlassTone
                                    ? styles.contrastLayerSoftGlass
                                    : styles.contrastLayerFlat
                        ),
                        { backgroundColor: palette.contrast },
                    ]}
                />
            )}
            {!isSolidCardTone && (glow || variant === "mapCard") && (
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        styles.glow,
                        { backgroundColor: palette.glow },
                    ]}
                />
            )}
            {!isSolidCardTone && !isFlatTone && !isMenuLiquidTone && (
                <View
                    pointerEvents="none"
                    style={[
                        styles.sheenLayer,
                        isSoftGlassTone && styles.sheenLayerSoftGlass,
                        { backgroundColor: palette.sheen },
                    ]}
                />
            )}
            {children}
            <View
                pointerEvents="none"
                style={[
                    StyleSheet.absoluteFillObject,
                    styles.topHighlight,
                    usesTonedSurface && (
                        isMenuLiquidTone
                            ? styles.topHighlightMenuLiquid
                            : isSolidCardTone
                                ? styles.topHighlightSolidCard
                                : isSoftGlassTone
                                ? styles.topHighlightSoftGlass
                                : styles.topHighlightFlat
                    ),
                    { borderTopColor: palette.highlight },
                ]}
            />
            <View
                pointerEvents="none"
                style={[
                    StyleSheet.absoluteFillObject,
                    styles.innerStroke,
                    { borderColor: palette.stroke },
                ]}
            />
        </View>
    );
}

export function CalendarGlassContainer({
    children,
    spacing = 0,
    style,
    ...viewProps
}: ContainerProps) {
    const nativeGlassAvailable = canUseNativeGlass();
    const glassEffect = nativeGlassAvailable ? loadGlassEffect() : null;

    if (nativeGlassAvailable && glassEffect) {
        const { GlassContainer } = glassEffect;

        return (
            <GlassContainer {...viewProps} spacing={spacing} style={style}>
                {children}
            </GlassContainer>
        );
    }

    return (
        <View {...viewProps} style={style}>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    surface: {
        position: "relative",
    },
    clipped: {
        overflow: "hidden",
    },
    menuLiquidSurfaceDark: {
        backgroundColor: "rgba(8, 9, 14, 0.79)",
    },
    menuLiquidSurfaceLight: {
        backgroundColor: "rgba(255, 255, 255, 0.79)",
    },
    solidCardSurfaceDark: {
        backgroundColor: "rgba(28, 29, 33, 0.86)",
    },
    solidCardSurfaceLight: {
        backgroundColor: "rgba(255, 255, 255, 0.84)",
    },
    innerStroke: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.20)",
    },
    topHighlight: {
        borderTopWidth: StyleSheet.hairlineWidth,
        opacity: 0.74,
    },
    topHighlightFlat: {
        opacity: 0.18,
    },
    topHighlightSoftGlass: {
        opacity: 0.34,
    },
    topHighlightMenuLiquid: {
        opacity: 0.27,
    },
    topHighlightSolidCard: {
        opacity: 0.22,
    },
    glow: {
        opacity: 0.65,
    },
    contrastLayer: {
        opacity: 0.83,
    },
    contrastLayerFlat: {
        opacity: 0.28,
    },
    contrastLayerSoftGlass: {
        opacity: 0.41,
    },
    contrastLayerMenuLiquid: {
        opacity: 0.86,
    },
    sheenLayer: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "42%",
        opacity: 0.65,
    },
    sheenLayerSoftGlass: {
        height: "26%",
        opacity: 0.18,
    },
    prominentFill: {
        opacity: 0.81,
    },
    prominentFillFlat: {
        opacity: 0.48,
    },
    prominentFillSoftGlass: {
        opacity: 0.56,
    },
    prominentFillMenuLiquid: {
        opacity: 0.86,
    },
    prominentFillDark: {
        backgroundColor: "rgba(14,15,18,0.76)",
    },
    prominentFillLight: {
        backgroundColor: "rgba(255,255,255,0.82)",
    },
    fallbackDepth: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 12,
    },
    nativeDepth: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 7 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
    },
    bottomBarDepth: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.13,
        shadowRadius: 18,
        elevation: 16,
    },
    mapDepth: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 0.30,
        shadowRadius: 30,
        elevation: 24,
    },
    androidDepth: {
        elevation: 14,
    },
});
