import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Reanimated, {
    cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming,
} from "react-native-reanimated";
import { useSystemReduceMotion } from "../modules/performance/useSystemReduceMotion";
import { useTheme } from "../modules/theme/ThemeContext";

type Props = {
    delayMs?: number;
    tone?: "accent" | "inverse";
    size?: "inline" | "compact" | "regular";
};

const indicatorSizes = {
    inline: { width: 18, markWidth: 6, height: 3, duration: 1350 },
    compact: { width: 29, markWidth: 9, height: 3, duration: 1350 },
    regular: { width: 35, markWidth: 11, height: 4, duration: 1450 },
};

/** The surrounding status text or button owns the accessibility announcement. */
export default function LoadingIndicator({ delayMs = 0, tone = "accent", size = "compact" }: Props) {
    const reduceMotion = useSystemReduceMotion();
    const { mode } = useTheme();
    const { width, markWidth, height, duration } = indicatorSizes[size];
    const travel = width - markWidth;
    const position = useSharedValue(0);
    const visibility = useSharedValue(delayMs ? 0 : 1);
    useEffect(() => {
        if (reduceMotion) return;
        position.value = withDelay(delayMs, withRepeat(withTiming(travel, {
            duration,
            easing: Easing.bezier(0.4, 0, 0.6, 1),
        }), -1, true));
        if (delayMs) visibility.value = withDelay(delayMs, withTiming(1, { duration: 100 }));
        return () => {
            cancelAnimation(position);
            cancelAnimation(visibility);
            position.value = 0;
            visibility.value = delayMs ? 0 : 1;
        };
    }, [delayMs, duration, position, reduceMotion, travel, visibility]);
    const trackStyle = useAnimatedStyle(() => ({ opacity: reduceMotion ? 1 : visibility.value }));
    const markStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: reduceMotion ? travel / 2 : position.value }],
    }));
    const isDark = mode === "dark";
    const track = tone === "inverse" ? "rgba(255,255,255,0.38)" : isDark ? "#2F456A" : "#DCE9FC";
    const mark = tone === "inverse" ? "#FFFFFF" : isDark ? "#9BC1FF" : "#2871DD";

    return (
        <Reanimated.View
            testID="loading-indicator"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={[styles.track, { width, height, backgroundColor: track }, trackStyle]}
        >
            <Reanimated.View style={[styles.mark, { width: markWidth, height, backgroundColor: mark }, markStyle]} />
        </Reanimated.View>
    );
}

const styles = StyleSheet.create({
    track: { borderRadius: 2, overflow: "hidden" },
    mark: { borderRadius: 2 },
});
