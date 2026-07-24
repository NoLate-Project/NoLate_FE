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

const SCAN_DURATION_MS = 1_400;
const SCAN_BAND_HEIGHT = 48;
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
            // 동작 줄이기에서는 레이저를 멈춰 두는 대신 정적인 포커스만 남긴다.
            scanProgress.value = 0;
            return () => cancelAnimation(scanProgress);
        }

        scanProgress.value = 0;
        scanProgress.value = withRepeat(
            withTiming(1, {
                duration: SCAN_DURATION_MS,
                easing: Easing.inOut(Easing.cubic),
            }),
            -1,
            true
        );

        return () => cancelAnimation(scanProgress);
    }, [active, frameHeight, reduceMotionEnabled, scanProgress]);

    const scanBandAnimatedStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scanProgress.value, [0, 0.06, 0.94, 1], [0, 1, 1, 0]),
        transform: [{
            translateY: resolvePhotoScanTranslateY(scanProgress.value, frameHeight),
        }],
    }), [frameHeight]);

    const scanRevealAnimatedStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scanProgress.value, [0, 0.18, 1], [0, 0.52, 0.16]),
        transform: [{ scaleY: Math.max(0.001, scanProgress.value) }],
    }), []);

    const focusCornersAnimatedStyle = useAnimatedStyle(() => ({
        opacity: reduceMotionEnabled
            ? 0.78
            : interpolate(scanProgress.value, [0, 0.5, 1], [0.66, 1, 0.66]),
    }), [reduceMotionEnabled]);

    const handleLayout = (event: LayoutChangeEvent) => {
        const nextHeight = Math.max(0, event.nativeEvent.layout.height);
        setFrameHeight((currentHeight) => (
            Math.abs(currentHeight - nextHeight) > 0.5 ? nextHeight : currentHeight
        ));
    };

    return (
        <View
            testID="quick-schedule-photo-scan-frame"
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

                    {!reduceMotionEnabled && (
                        <Reanimated.View
                            testID="quick-schedule-photo-scan-reveal"
                            style={[
                                styles.scanReveal,
                                { backgroundColor: palette.reveal },
                                scanRevealAnimatedStyle,
                            ]}
                        />
                    )}

                    <Reanimated.View
                        testID="quick-schedule-photo-scan-corners"
                        style={[styles.focusCorners, focusCornersAnimatedStyle]}
                    >
                        <View
                            style={[
                                styles.focusCorner,
                                styles.focusCornerTopLeft,
                                { borderColor: palette.frame },
                            ]}
                        />
                        <View
                            style={[
                                styles.focusCorner,
                                styles.focusCornerTopRight,
                                { borderColor: palette.frame },
                            ]}
                        />
                        <View
                            style={[
                                styles.focusCorner,
                                styles.focusCornerBottomLeft,
                                { borderColor: palette.frame },
                            ]}
                        />
                        <View
                            style={[
                                styles.focusCorner,
                                styles.focusCornerBottomRight,
                                { borderColor: palette.frame },
                            ]}
                        />
                    </Reanimated.View>

                    {!reduceMotionEnabled && (
                        <Reanimated.View
                            testID="quick-schedule-photo-scan-band"
                            style={[
                                styles.scanBand,
                                scanBandAnimatedStyle,
                            ]}
                        >
                            <View style={[styles.scanGlowFar, { backgroundColor: palette.glowFar }]} />
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
                            <View style={[styles.scanLineCore, { backgroundColor: palette.lineCore }]} />
                        </Reanimated.View>
                    )}
                </View>
            )}
        </View>
    );
}

const DARK_PALETTE = {
    tint: "rgba(4, 13, 24, 0.12)",
    reveal: "rgba(63, 183, 255, 0.12)",
    frame: "rgba(126, 236, 255, 0.86)",
    glowFar: "rgba(74, 183, 255, 0.06)",
    glowWide: "rgba(96, 215, 255, 0.13)",
    glowNear: "rgba(126, 236, 255, 0.30)",
    line: "#8CEBFF",
    lineCore: "rgba(255,255,255,0.92)",
};

const LIGHT_PALETTE = {
    tint: "rgba(20, 83, 166, 0.045)",
    reveal: "rgba(36, 107, 254, 0.085)",
    frame: "rgba(112, 225, 255, 0.92)",
    glowFar: "rgba(36, 107, 254, 0.05)",
    glowWide: "rgba(54, 155, 255, 0.12)",
    glowNear: "rgba(94, 215, 247, 0.28)",
    line: "#5ED7F7",
    lineCore: "rgba(255,255,255,0.94)",
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
    scanReveal: {
        ...StyleSheet.absoluteFillObject,
        transformOrigin: [0, 0, 0],
    },
    focusCorners: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
    },
    focusCorner: {
        position: "absolute",
        width: 22,
        height: 22,
    },
    focusCornerTopLeft: {
        top: 8,
        left: 8,
        borderTopWidth: 2,
        borderLeftWidth: 2,
        borderTopLeftRadius: 8,
    },
    focusCornerTopRight: {
        top: 8,
        right: 8,
        borderTopWidth: 2,
        borderRightWidth: 2,
        borderTopRightRadius: 8,
    },
    focusCornerBottomLeft: {
        bottom: 8,
        left: 8,
        borderBottomWidth: 2,
        borderLeftWidth: 2,
        borderBottomLeftRadius: 8,
    },
    focusCornerBottomRight: {
        right: 8,
        bottom: 8,
        borderRightWidth: 2,
        borderBottomWidth: 2,
        borderBottomRightRadius: 8,
    },
    scanBand: {
        position: "absolute",
        top: 0,
        right: 0,
        left: 0,
        height: SCAN_BAND_HEIGHT,
        justifyContent: "center",
        zIndex: 1,
    },
    scanGlowFar: {
        position: "absolute",
        top: 2,
        right: 0,
        left: 0,
        height: 44,
        borderRadius: 22,
    },
    scanGlowWide: {
        position: "absolute",
        top: 12,
        right: 0,
        left: 0,
        height: 24,
        borderRadius: 12,
    },
    scanGlowNear: {
        position: "absolute",
        top: 19.5,
        right: 0,
        left: 0,
        height: 9,
        borderRadius: 4.5,
    },
    scanLine: {
        position: "absolute",
        top: 23,
        alignSelf: "stretch",
        right: 0,
        left: 0,
        height: 2,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.85,
        shadowRadius: 8,
    },
    scanLineCore: {
        position: "absolute",
        top: 24,
        right: 0,
        left: 0,
        alignSelf: "stretch",
        height: StyleSheet.hairlineWidth,
    },
});
