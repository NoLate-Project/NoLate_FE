import React from "react";
import { Platform, StyleSheet, View, type ViewProps } from "react-native";

import { useTheme } from "../../../theme/ThemeContext";

type GlassEffectModule = {
    GlassView: React.ComponentType<ViewProps & {
        colorScheme?: "dark" | "light";
        glassEffectStyle?: "clear" | "regular";
        isInteractive?: boolean;
        tintColor?: string;
    }>;
    isGlassEffectAPIAvailable: () => boolean;
    isLiquidGlassAvailable: () => boolean;
};

type Props = ViewProps & {
    interactive?: boolean;
    clear?: boolean;
};

type GlassPalette = {
    background: string;
    fill: string;
    topHighlight: string;
    bottomShade: string;
    nativeTint: string;
};

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

function getGlassPalette(mode: "dark" | "light", clear: boolean): GlassPalette {
    const isDark = mode === "dark";
    const isAndroid = Platform.OS === "android";

    if (isDark) {
        return {
            background: clear
                ? "rgba(29, 31, 37, 0.88)"
                : isAndroid
                    ? "rgba(30, 32, 38, 0.96)"
                    : "rgba(32, 34, 40, 0.92)",
            fill: clear ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.07)",
            topHighlight: "rgba(255, 255, 255, 0.14)",
            bottomShade: "rgba(0, 0, 0, 0.18)",
            nativeTint: clear ? "rgba(36, 38, 44, 0.44)" : "rgba(40, 42, 48, 0.54)",
        };
    }

    return {
        background: clear
            ? "rgba(255, 255, 255, 0.84)"
            : isAndroid
                ? "rgba(255, 255, 255, 0.96)"
                : "rgba(255, 255, 255, 0.90)",
        fill: clear ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.26)",
        topHighlight: "rgba(255, 255, 255, 0.58)",
        bottomShade: "rgba(15, 23, 42, 0.07)",
        nativeTint: clear ? "rgba(255, 255, 255, 0.40)" : "rgba(255, 255, 255, 0.52)",
    };
}

function GlassLayers({ palette }: { palette: GlassPalette }) {
    return (
        <>
            <View
                pointerEvents="none"
                style={[
                    StyleSheet.absoluteFillObject,
                    { backgroundColor: palette.fill },
                ]}
            />
            <View
                pointerEvents="none"
                style={[
                    styles.topHighlight,
                    { backgroundColor: palette.topHighlight },
                ]}
            />
            <View
                pointerEvents="none"
                style={[
                    styles.bottomShade,
                    { backgroundColor: palette.bottomShade },
                ]}
            />
        </>
    );
}

export default function CalendarGlassSurface({
    children,
    interactive = false,
    clear = false,
    style,
    ...viewProps
}: Props) {
    const { mode } = useTheme();
    const nativeGlassAvailable = canUseNativeGlass();
    const glassEffect = nativeGlassAvailable ? loadGlassEffect() : null;
    const palette = getGlassPalette(mode, clear);

    if (nativeGlassAvailable && glassEffect) {
        const { GlassView } = glassEffect;

        return (
            <GlassView
                {...viewProps}
                colorScheme={mode}
                glassEffectStyle={clear ? "clear" : "regular"}
                isInteractive={interactive}
                tintColor={palette.nativeTint}
                style={[
                    styles.surface,
                    style,
                    { backgroundColor: palette.background },
                    styles.clipped,
                ]}
            >
                <GlassLayers palette={palette} />
                {children}
            </GlassView>
        );
    }

    return (
        <View
            {...viewProps}
            style={[
                styles.surface,
                styles.fallbackDepth,
                style,
                { backgroundColor: palette.background },
                styles.clipped,
                Platform.OS === "android" && styles.androidDepth,
            ]}
        >
            <GlassLayers palette={palette} />
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
    fallbackDepth: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 18,
        elevation: 12,
    },
    androidDepth: {
        elevation: 14,
    },
    topHighlight: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "48%",
        opacity: 0.75,
    },
    bottomShade: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "44%",
    },
});
