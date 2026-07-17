import React, { useEffect } from "react";
import {
    Image,
    StyleSheet,
    Text,
    View,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import Reanimated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import QuickScheduleLogoLoader, {
    type LogoLoaderVariant,
} from "../modules/schedule/components/form/QuickScheduleLogoLoader";
import { useTheme } from "../modules/theme/ThemeContext";

const GLASS_LOGO_DARK = require("../../assets/curation/calendar-sync-3d-device-dark.png");
const GLASS_LOGO_LIGHT = require("../../assets/curation/calendar-sync-3d-device-light.png");

const FULL_WIDTH = 194;
const FULL_HEIGHT = 176;
const SECTION_SCALE = 0.62;
const SECTION_WIDTH = Math.round(FULL_WIDTH * SECTION_SCALE);
const SECTION_HEIGHT = Math.round(FULL_HEIGHT * SECTION_SCALE);
const BUTTON_MARK_SIZE = 28;

export type BrandedLoaderSize = "full" | "section" | "button";
export type BrandedLoaderVariant = LogoLoaderVariant;

type BrandedLoaderProps = {
    accessibilityLabel: string;
    variant?: BrandedLoaderVariant;
    size?: BrandedLoaderSize;
    style?: StyleProp<ViewStyle>;
};

type BrandedLoadingStateProps = BrandedLoaderProps & {
    title?: string;
    caption?: string;
    fill?: boolean;
};

/**
 * 앱 전역에서 같은 브랜드 로딩 언어를 사용하기 위한 공개 컴포넌트다.
 * full과 section은 완성된 궤도 로더를 동일 비율로 축소하고, button은 좁은 제어 영역에
 * 맞게 중앙 유리 로고와 한 개의 궤도 입자만 남겨 레이아웃 변화를 방지한다.
 */
export default function BrandedLoader({
    accessibilityLabel,
    variant = "schedule",
    size = "full",
    style,
}: BrandedLoaderProps) {
    if (size === "button") {
        return (
            <BrandedLoadingMark
                accessibilityLabel={accessibilityLabel}
                style={style}
            />
        );
    }

    const isSection = size === "section";

    return (
        <View
            pointerEvents="none"
            testID={`branded-loader-${size}`}
            style={[
                isSection ? styles.sectionFrame : styles.fullFrame,
                style,
            ]}
        >
            <View
                testID="branded-loader-orbit-stage"
                style={isSection ? styles.sectionStage : undefined}
            >
                <QuickScheduleLogoLoader
                    accessibilityLabel={accessibilityLabel}
                    variant={variant}
                />
            </View>
        </View>
    );
}

/** 전체 화면이나 빈 섹션에서 로더와 상태 문구의 간격을 일관되게 유지한다. */
export function BrandedLoadingState({
    accessibilityLabel,
    variant = "schedule",
    size = "section",
    title,
    caption,
    fill = false,
    style,
}: BrandedLoadingStateProps) {
    const { colors } = useTheme();

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
                <BrandedLoader
                    accessibilityLabel={accessibilityLabel}
                    variant={variant}
                    size={size}
                />
                {title ? (
                    <Text style={[styles.title, { color: colors.textPrimary }]}>
                        {title}
                    </Text>
                ) : null}
                {caption ? (
                    <Text style={[styles.caption, { color: colors.textSecondary }]}>
                        {caption}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

function BrandedLoadingMark({
    accessibilityLabel,
    style,
}: Pick<BrandedLoaderProps, "accessibilityLabel" | "style">) {
    const { mode } = useTheme();
    const reduceMotionEnabled = useReducedMotion();
    const progress = useSharedValue(0);
    const isDark = mode === "dark";
    const logoSource = isDark ? GLASS_LOGO_DARK : GLASS_LOGO_LIGHT;

    useEffect(() => {
        cancelAnimation(progress);

        if (reduceMotionEnabled) {
            progress.value = 0.12;
            return () => cancelAnimation(progress);
        }

        progress.value = 0;
        progress.value = withRepeat(
            withTiming(1, { duration: 1_200, easing: Easing.linear }),
            -1,
            false,
        );

        return () => cancelAnimation(progress);
    }, [progress, reduceMotionEnabled]);

    const orbitStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${progress.value * 360}deg` }],
    }));
    const logoStyle = useAnimatedStyle(() => {
        const wave = (Math.sin(progress.value * Math.PI * 2) + 1) / 2;
        return {
            opacity: 0.92 + wave * 0.08,
            transform: [{ scale: 0.97 + wave * 0.04 }],
        };
    });

    return (
        <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={accessibilityLabel}
            testID="branded-loader-button"
            style={[styles.buttonMark, style]}
        >
            <View
                style={[
                    styles.buttonRing,
                    isDark ? styles.buttonRingDark : styles.buttonRingLight,
                ]}
            />
            <Reanimated.View
                pointerEvents="none"
                style={[styles.buttonOrbit, orbitStyle]}
            >
                <View
                    style={[
                        styles.buttonParticle,
                        isDark ? styles.buttonParticleDark : styles.buttonParticleLight,
                    ]}
                />
            </Reanimated.View>
            <Reanimated.View
                pointerEvents="none"
                style={[styles.buttonLogoMask, logoStyle]}
            >
                <Image
                    testID="branded-loader-button-logo"
                    source={logoSource}
                    resizeMode="cover"
                    fadeDuration={0}
                    accessibilityIgnoresInvertColors
                    style={styles.buttonLogoCrop}
                />
            </Reanimated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    fullFrame: {
        width: FULL_WIDTH,
        height: FULL_HEIGHT,
        alignSelf: "center",
        overflow: "visible",
    },
    sectionFrame: {
        width: SECTION_WIDTH,
        height: SECTION_HEIGHT,
        alignSelf: "center",
        overflow: "visible",
    },
    sectionStage: {
        position: "absolute",
        left: (SECTION_WIDTH - FULL_WIDTH) / 2,
        top: (SECTION_HEIGHT - FULL_HEIGHT) / 2,
        width: FULL_WIDTH,
        height: FULL_HEIGHT,
        transform: [{ scale: SECTION_SCALE }],
    },
    state: {
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 14,
    },
    stateFill: {
        flex: 1,
        alignSelf: "stretch",
    },
    stateContent: {
        alignItems: "center",
        gap: 8,
    },
    title: {
        fontSize: 17,
        fontWeight: "800",
        textAlign: "center",
    },
    caption: {
        maxWidth: 280,
        fontSize: 14,
        fontWeight: "600",
        lineHeight: 20,
        textAlign: "center",
    },
    buttonMark: {
        width: BUTTON_MARK_SIZE,
        height: BUTTON_MARK_SIZE,
        alignItems: "center",
        justifyContent: "center",
    },
    buttonRing: {
        ...StyleSheet.absoluteFillObject,
        margin: 1,
        borderRadius: (BUTTON_MARK_SIZE - 2) / 2,
        borderWidth: StyleSheet.hairlineWidth,
    },
    buttonOrbit: {
        ...StyleSheet.absoluteFillObject,
    },
    buttonRingDark: {
        borderColor: "rgba(126,211,255,0.35)",
    },
    buttonRingLight: {
        borderColor: "rgba(60,139,255,0.28)",
    },
    buttonParticle: {
        position: "absolute",
        left: BUTTON_MARK_SIZE / 2 - 2,
        top: 0,
        width: 4,
        height: 4,
        borderRadius: 2,
        shadowColor: "#67E4FF",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.75,
        shadowRadius: 4,
    },
    buttonParticleDark: {
        backgroundColor: "#67E4FF",
    },
    buttonParticleLight: {
        backgroundColor: "#2F80FF",
    },
    buttonLogoMask: {
        width: 20,
        height: 20,
        borderRadius: 6,
        overflow: "hidden",
    },
    // 1024px 이미지의 중앙 유리 로고만 20px 마크 안에 배치한다.
    buttonLogoCrop: {
        position: "absolute",
        left: -11,
        top: -10.5,
        width: 40,
        height: 40,
    },
});
