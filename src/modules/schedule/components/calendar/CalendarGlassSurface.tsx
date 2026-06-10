import React from "react";
import { Platform, StyleSheet, View, type ViewProps } from "react-native";
import {
    GlassView,
    isGlassEffectAPIAvailable,
    isLiquidGlassAvailable,
} from "expo-glass-effect";

import { useTheme } from "../../../theme/ThemeContext";

type Props = ViewProps & {
    interactive?: boolean;
    clear?: boolean;
};

function canUseNativeGlass() {
    if (Platform.OS !== "ios") return false;

    try {
        return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
    } catch {
        return false;
    }
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
    const fallbackBackground = mode === "dark"
        ? "rgba(44, 44, 46, 0.82)"
        : "rgba(255, 255, 255, 0.72)";

    if (!nativeGlassAvailable) {
        return (
            <View
                {...viewProps}
                style={[
                    styles.fallback,
                    { backgroundColor: fallbackBackground },
                    style,
                ]}
            >
                {children}
            </View>
        );
    }

    return (
        <GlassView
            {...viewProps}
            colorScheme={mode}
            glassEffectStyle={clear ? "clear" : "regular"}
            isInteractive={interactive}
            tintColor={mode === "dark" ? "rgba(32, 32, 34, 0.34)" : "rgba(255, 255, 255, 0.24)"}
            style={style}
        >
            {children}
        </GlassView>
    );
}

const styles = StyleSheet.create({
    fallback: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.14,
        shadowRadius: 18,
        elevation: 10,
    },
});
