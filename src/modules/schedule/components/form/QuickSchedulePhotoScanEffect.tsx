import React, { useEffect, useState, type ReactNode } from "react";
import {
    StyleSheet,
    View,
    type LayoutChangeEvent,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import Reanimated, {
    cancelAnimation,
    Easing,
    interpolate,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import { useTheme } from "../../../theme/ThemeContext";

const SCAN_DURATION_MS = 1_650;
const SCAN_BAND_HEIGHT = 30;
const DEFAULT_RADIUS = 20;

type Props = {
    active: boolean;
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    borderRadius?: number;
    accessibilityLabel?: string;
};

export function shouldAnimatePhotoScan(
    active: boolean,
    reduceMotionEnabled: boolean,
    frameHeight: number
) {
    return active && !reduceMotionEnabled && frameHeight > 0;
}

export function resolvePhotoScanTranslateY(progress: number, frameHeight: number) {
    "worklet";
    const normalizedProgress = Math.max(0, Math.min(1, progress));
    const safeHeight = Math.max(0, frameHeight);

    return -SCAN_BAND_HEIGHT
        + normalizedProgress * (safeHeight + SCAN_BAND_HEIGHT);
}

/**
 * 선택되거나 촬영된 사진 위에서만 동작하는 OCR 후처리 효과다.
 * 자식 이미지를 감싸므로 스캔 밴드가 다른 모달 콘텐츠까지 번지지 않는다.
 */
export default function QuickSchedulePhotoScanEffect({
    active,
    children,
    style,
    borderRadius = DEFAULT_RADIUS,
    accessibilityLabel,
}: Props) {
    const { mode } = useTheme();
    const reduceMotionEnabled = useReducedMotion();
    const [frameHeight, setFrameHeight] = useState(0);
    const scanProgress = useSharedValue(0);
    const isDark = mode === "dark";
    const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

    useEffect(() => {
        cancelAnimation(scanProgress);

        if (!active) {
            scanProgress.value = 0;
            return () => cancelAnimation(scanProgress);
        }

        if (!shouldAnimatePhotoScan(active, reduceMotionEnabled, frameHeight)) {
            // 동작 줄이기에서는 스캔 위치만 고정해 진행 상태를 시각적으로 남긴다.
            scanProgress.value = 0.5;
            return () => cancelAnimation(scanProgress);
        }

        scanProgress.value = 0;
        scanProgress.value = withRepeat(
            withTiming(1, {
                duration: SCAN_DURATION_MS,
                easing: Easing.inOut(Easing.cubic),
            }),
            -1,
            false
        );

        return () => cancelAnimation(scanProgress);
    }, [active, frameHeight, reduceMotionEnabled, scanProgress]);

    const scanBandAnimatedStyle = useAnimatedStyle(() => ({
        opacity: reduceMotionEnabled
            ? 0.72
            : interpolate(scanProgress.value, [0, 0.08, 0.9, 1], [0, 1, 1, 0]),
        transform: [{
            translateY: resolvePhotoScanTranslateY(scanProgress.value, frameHeight),
        }],
    }), [frameHeight, reduceMotionEnabled]);

    const handleLayout = (event: LayoutChangeEvent) => {
        const nextHeight = Math.max(0, event.nativeEvent.layout.height);
        setFrameHeight((currentHeight) => (
            Math.abs(currentHeight - nextHeight) > 0.5 ? nextHeight : currentHeight
        ));
    };

    return (
        <View
            onLayout={handleLayout}
            style={[styles.frame, { borderRadius }, style]}
        >
            {children}

            {active && (
                <View
                    pointerEvents="none"
                    testID="quick-schedule-photo-scan-overlay"
                    accessible={Boolean(accessibilityLabel)}
                    accessibilityRole={accessibilityLabel ? "progressbar" : undefined}
                    accessibilityLabel={accessibilityLabel}
                    accessibilityLiveRegion={accessibilityLabel ? "polite" : undefined}
                    accessibilityState={accessibilityLabel ? { busy: true } : undefined}
                    style={styles.overlay}
                >
                    <View
                        testID="quick-schedule-photo-scan-tint"
                        style={[styles.tint, { backgroundColor: palette.tint }]}
                    />

                    <View style={[styles.focusFrame, { borderColor: palette.frame }]} />

                    <Reanimated.View
                        testID="quick-schedule-photo-scan-band"
                        style={[
                            styles.scanBand,
                            { backgroundColor: palette.band },
                            scanBandAnimatedStyle,
                        ]}
                    >
                        <View style={[styles.scanGlowWide, { backgroundColor: palette.glowWide }]} />
                        <View style={[styles.scanGlowNear, { backgroundColor: palette.glowNear }]} />
                        <View
                            style={[
                                styles.scanLine,
                                {
                                    backgroundColor: palette.line,
                                    shadowColor: palette.line,
                                },
                            ]}
                        />
                    </Reanimated.View>
                </View>
            )}
        </View>
    );
}

const DARK_PALETTE = {
    tint: "rgba(4, 13, 24, 0.20)",
    frame: "rgba(103, 228, 255, 0.42)",
    band: "rgba(56, 164, 255, 0.08)",
    glowWide: "rgba(103, 228, 255, 0.12)",
    glowNear: "rgba(103, 228, 255, 0.28)",
    line: "#8CEBFF",
};

const LIGHT_PALETTE = {
    tint: "rgba(20, 83, 166, 0.07)",
    frame: "rgba(36, 107, 254, 0.36)",
    band: "rgba(36, 107, 254, 0.06)",
    glowWide: "rgba(36, 107, 254, 0.10)",
    glowNear: "rgba(36, 107, 254, 0.22)",
    line: "#5ED7F7",
};

const styles = StyleSheet.create({
    frame: {
        position: "relative",
        overflow: "hidden",
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        overflow: "hidden",
    },
    tint: {
        ...StyleSheet.absoluteFillObject,
    },
    focusFrame: {
        position: "absolute",
        top: 5,
        right: 5,
        bottom: 5,
        left: 5,
        borderRadius: 15,
        borderWidth: StyleSheet.hairlineWidth,
    },
    scanBand: {
        position: "absolute",
        top: 0,
        right: 0,
        left: 0,
        height: SCAN_BAND_HEIGHT,
        justifyContent: "center",
    },
    scanGlowWide: {
        position: "absolute",
        right: 0,
        left: 0,
        height: 18,
    },
    scanGlowNear: {
        position: "absolute",
        right: 0,
        left: 0,
        height: 7,
    },
    scanLine: {
        alignSelf: "stretch",
        height: 1.5,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.85,
        shadowRadius: 6,
    },
});
