import React, { useEffect, useState } from "react";
import { Image, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import QuickScheduleLogoLoader, {
    StartupLogoLoader,
    type LogoLoaderVariant,
} from "../modules/schedule/components/form/QuickScheduleLogoLoader";
import { useTheme } from "../modules/theme/ThemeContext";
import { useSystemReduceMotion } from "../modules/performance/useSystemReduceMotion";
import LoadingIndicator from "./LoadingIndicator";

const APP_LOGO = require("../../assets/curation/nolate-logo.png");
const GLASS_LOGO_DARK = require("../../assets/curation/calendar-sync-3d-device-dark.png");
const GLASS_LOGO_LIGHT = require("../../assets/curation/calendar-sync-3d-device-light.png");
const LOADER_DELAY_MS = 150;

export type BrandedLoaderSize = "full" | "section" | "button";
export type BrandedLoaderVariant = LogoLoaderVariant;

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
    tone,
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
            {size === "full" && startup ? (
                <StartupLogoLoader delayMs={LOADER_DELAY_MS} durationMs={320} />
            ) : size === "full" ? (
                <QuickScheduleLogoLoader
                    accessibilityLabel={accessibilityLabel}
                    settleOnly
                    settleDelayMs={LOADER_DELAY_MS}
                    settleDurationMs={320}
                    hideBeforeSettle
                    useAppLogoFace
                    appLogoFaceSize={82}
                />
            ) : size === "section" ? (
                <SectionLoadingMark />
            ) : settleMark ? (
                <SettlingLoadingMark />
            ) : (
                <LoadingIndicator delayMs={LOADER_DELAY_MS} tone={tone} />
            )}
        </View>
    );
}

function SettlingLoadingMark() {
    const { mode } = useTheme();
    const reduceMotion = useSystemReduceMotion();
    const progress = useSharedValue(reduceMotion ? 1 : 0);
    useEffect(() => {
        if (reduceMotion) {
            progress.value = 1;
            return;
        }

        progress.value = 0;
        progress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
        return () => cancelAnimation(progress);
    }, [progress, reduceMotion]);

    const logoStyle = useAnimatedStyle(() => {
        const remaining = 1 - progress.value;
        return {
            transform: [
                { perspective: 160 },
                { rotateX: `${remaining * 12}deg` },
                { rotateY: `${remaining * -18}deg` },
                { scale: 1 - remaining * 0.06 },
            ],
        };
    });

    return (
        <Reanimated.View style={[styles.settleLogoMask, logoStyle]}>
            <Image
                testID="branded-loader-settle-logo"
                source={mode === "dark" ? GLASS_LOGO_DARK : GLASS_LOGO_LIGHT}
                accessible={false}
                accessibilityIgnoresInvertColors
                resizeMode="cover"
                fadeDuration={0}
                style={styles.settleLogoCrop}
            />
        </Reanimated.View>
    );
}

function SectionLoadingMark() {
    const reduceMotion = useSystemReduceMotion();
    const [revealed, setRevealed] = useState(false);
    useEffect(() => {
        if (revealed) return;
        const timer = setTimeout(() => setRevealed(true), LOADER_DELAY_MS);
        return () => clearTimeout(timer);
    }, [revealed]);
    return (
        <>
            <Image
                source={APP_LOGO}
                accessibilityIgnoresInvertColors
                accessible={false}
                resizeMode="contain"
                fadeDuration={0}
                style={[styles.sectionLogo, { opacity: revealed || reduceMotion ? 1 : 0 }]}
            />
            <LoadingIndicator delayMs={LOADER_DELAY_MS} />
        </>
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
    settleLogoMask: { width: 20, height: 20, borderRadius: 6, overflow: "hidden" },
    settleLogoCrop: { position: "absolute", left: -11, top: -10.5, width: 40, height: 40 },
    sectionLogo: { width: 34, height: 34, borderRadius: 8 },
    state: { alignItems: "center", justifyContent: "center", paddingVertical: 14 },
    stateFill: { flex: 1, alignSelf: "stretch" },
    stateContent: { alignItems: "center", gap: 8 },
    title: { fontSize: 17, fontWeight: "800", textAlign: "center" },
    startupTitle: { position: "absolute", top: "100%", marginTop: 20, width: 280 },
    caption: { maxWidth: 280, fontSize: 14, fontWeight: "600", lineHeight: 20, textAlign: "center" },
});
