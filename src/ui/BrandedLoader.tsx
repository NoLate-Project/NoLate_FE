import React from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../modules/theme/ThemeContext";
import NoLateLoadingMark from "./NoLateLoadingMark";

export type BrandedLoaderSize = "full" | "section" | "button" | "inline";
export type BrandedLoaderVariant = "schedule" | "calendar" | "route" | "share" | "auth";

type BrandedLoaderProps = {
    accessibilityLabel: string;
    variant?: BrandedLoaderVariant;
    size?: BrandedLoaderSize;
    style?: StyleProp<ViewStyle>;
    tone?: "accent" | "inverse";
    settleMark?: boolean;
    startup?: boolean;
};

type BrandedLoadingStateProps = BrandedLoaderProps & {
    title?: string;
    caption?: string;
    fill?: boolean;
};

/** Keep the footprint stable while a request is pending. */
export default function BrandedLoader({
    accessibilityLabel,
    size = "full",
    style,
    settleMark = false,
    startup = false,
}: BrandedLoaderProps) {
    return (
        <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={accessibilityLabel}
            pointerEvents="none"
            testID={`branded-loader-${size}`}
            style={[styles.frame, size === "button" && (settleMark ? styles.settleButton : styles.button), style]}
        >
            <NoLateLoadingMark size={size === "full" ? 82 : size === "section" ? 34 : 20} startup={startup} />
        </View>
    );
}

/** A single accessible status groups the mark and any explanatory text. */
export function BrandedLoadingState({
    accessibilityLabel,
    size = "section",
    title,
    caption,
    fill = false,
    style,
    tone,
    startup,
}: BrandedLoadingStateProps) {
    const { colors } = useTheme();
    const centerStartupLogo = startup && Platform.OS === "ios" && fill && size === "full";

    return (
        <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={accessibilityLabel}
            accessibilityLiveRegion="polite"
            testID="branded-loading-state"
            style={[styles.state, fill && styles.stateFill, style]}
        >
            <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                testID="branded-loading-state-content"
                style={styles.stateContent}
            >
                <BrandedLoader accessibilityLabel={accessibilityLabel} size={size} tone={tone} startup={startup} />
                {title ? <Text style={[styles.title, centerStartupLogo && styles.startupTitle, { color: colors.textPrimary }]}>{title}</Text> : null}
                {caption ? <Text style={[styles.caption, { color: colors.textSecondary }]}>{caption}</Text> : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    frame: { alignSelf: "center", alignItems: "center", justifyContent: "center", gap: 8 },
    button: { width: 29, height: 28 },
    settleButton: { width: 28, height: 28 },
    state: { alignItems: "center", justifyContent: "center", paddingVertical: 14 },
    stateFill: { flex: 1, alignSelf: "stretch" },
    stateContent: { alignItems: "center", gap: 8 },
    title: { fontSize: 17, fontWeight: "800", textAlign: "center" },
    startupTitle: { position: "absolute", top: "100%", marginTop: 20, width: 280 },
    caption: { maxWidth: 280, fontSize: 14, fontWeight: "600", lineHeight: 20, textAlign: "center" },
});
