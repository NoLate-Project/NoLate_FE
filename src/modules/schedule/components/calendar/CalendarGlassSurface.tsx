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
    tone?: "default" | "flat" | "softGlass" | "menuLiquid";
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
                ? "rgba(32, 34, 40, 0.44)"
            : variant === "toolbar" || variant === "popover"
                ? "rgba(24, 25, 30, 0.46)"
            : stronger
                ? "rgba(18, 19, 24, 0.82)"
                : airy
                    ? isAndroid
                        ? "rgba(24, 25, 30, 0.94)"
                        : "rgba(22, 23, 28, 0.56)"
                    : isAndroid
                        ? "rgba(28, 29, 35, 0.96)"
                        : "rgba(28, 29, 35, 0.72)";
        return {
            background,
            nativeTint: stronger ? "rgba(255, 255, 255, 0.065)" : "rgba(255, 255, 255, 0.035)",
            highlight: variant === "bottomBar" ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.20)",
            stroke: variant === "bottomBar" ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.22)",
            glow: variant === "mapCard" ? "rgba(47,128,255,0.20)" : "rgba(255,255,255,0.10)",
            contrast: stronger ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.055)",
            sheen: variant === "bottomBar" ? "rgba(255,255,255,0.082)" : "rgba(255,255,255,0.064)",
        };
    }

    const background = reduceTransparency
        ? "rgba(255, 255, 255, 0.98)"
            : variant === "bottomBar"
            ? "rgba(255, 255, 255, 0.66)"
        : variant === "toolbar" || variant === "popover"
            ? "rgba(255, 255, 255, 0.50)"
        : stronger
            ? "rgba(255, 255, 255, 0.86)"
            : airy
                ? isAndroid
                    ? "rgba(255, 255, 255, 0.94)"
                    : "rgba(255, 255, 255, 0.58)"
                : isAndroid
                    ? "rgba(255, 255, 255, 0.96)"
                    : "rgba(255, 255, 255, 0.72)";
    return {
        background,
        nativeTint: variant === "bottomBar"
            ? "rgba(255, 255, 255, 0.18)"
            : stronger ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.08)",
        highlight: variant === "bottomBar" ? "rgba(255,255,255,0.86)" : "rgba(255,255,255,0.76)",
        stroke: variant === "bottomBar" ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.62)",
        glow: variant === "mapCard" ? "rgba(47,128,255,0.12)" : "rgba(255,255,255,0.22)",
        contrast: variant === "bottomBar" ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.08)",
        sheen: variant === "bottomBar" ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.28)",
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
    const usesTonedSurface = isFlatTone || isSoftGlassTone || isMenuLiquidTone;
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
                ]}
            >
                {(prominent || reduceTransparency) && (
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
                {(glow || variant === "mapCard") && (
                    <View
                        pointerEvents="none"
                        style={[
                            StyleSheet.absoluteFillObject,
                            styles.glow,
                            { backgroundColor: palette.glow },
                        ]}
                    />
                )}
                {!isFlatTone && !isMenuLiquidTone && (
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
                styles.clipped,
                Platform.OS === "android" && styles.androidDepth,
            ]}
        >
            {prominent && (
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
            {(glow || variant === "mapCard") && (
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFillObject,
                        styles.glow,
                        { backgroundColor: palette.glow },
                    ]}
                />
            )}
            {!isFlatTone && !isMenuLiquidTone && (
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
        backgroundColor: "rgba(8, 9, 14, 0.88)",
    },
    menuLiquidSurfaceLight: {
        backgroundColor: "rgba(255, 255, 255, 0.88)",
    },
    innerStroke: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.20)",
    },
    topHighlight: {
        borderTopWidth: StyleSheet.hairlineWidth,
        opacity: 0.82,
    },
    topHighlightFlat: {
        opacity: 0.18,
    },
    topHighlightSoftGlass: {
        opacity: 0.38,
    },
    topHighlightMenuLiquid: {
        opacity: 0.30,
    },
    glow: {
        opacity: 0.72,
    },
    contrastLayer: {
        opacity: 0.92,
    },
    contrastLayerFlat: {
        opacity: 0.28,
    },
    contrastLayerSoftGlass: {
        opacity: 0.46,
    },
    contrastLayerMenuLiquid: {
        opacity: 0.96,
    },
    sheenLayer: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "42%",
        opacity: 0.72,
    },
    sheenLayerSoftGlass: {
        height: "26%",
        opacity: 0.18,
    },
    prominentFill: {
        opacity: 0.9,
    },
    prominentFillFlat: {
        opacity: 0.48,
    },
    prominentFillSoftGlass: {
        opacity: 0.62,
    },
    prominentFillMenuLiquid: {
        opacity: 0.96,
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
