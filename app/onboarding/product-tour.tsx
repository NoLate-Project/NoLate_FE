import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Animated,
    Easing,
    Image,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    getProductTourButtonLabel,
    PRODUCT_TOUR_STEPS,
    type ProductTourStep,
} from "../../src/modules/onboarding/productTour";
import { useTheme } from "../../src/modules/theme/ThemeContext";

const BLUE = "#246BFE";

/** 캘린더 큐레이션 다음에 실제 앱 화면으로 핵심 사용 흐름을 소개합니다. */
export default function ProductTourScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    const { colors, mode } = useTheme();
    const [stepIndex, setStepIndex] = useState(0);
    const [transitioning, setTransitioning] = useState(false);
    const reduceMotionRef = useRef(false);
    const stepMotion = useRef(new Animated.Value(1)).current;
    const step = PRODUCT_TOUR_STEPS[stepIndex];
    const isLastStep = stepIndex === PRODUCT_TOUR_STEPS.length - 1;
    const heroHeight = Math.max(238, Math.min(330, height * 0.4));

    useEffect(() => {
        AccessibilityInfo.isReduceMotionEnabled()
            .then(enabled => {
                reduceMotionRef.current = enabled;
            })
            .catch(() => undefined);
    }, []);

    const replaceWithSchedule = () => {
        if (transitioning) return;
        router.replace("/schedule");
    };

    const moveToStep = (nextIndex: number) => {
        if (
            transitioning ||
            nextIndex < 0 ||
            nextIndex >= PRODUCT_TOUR_STEPS.length ||
            nextIndex === stepIndex
        ) return;

        if (reduceMotionRef.current) {
            setStepIndex(nextIndex);
            return;
        }

        setTransitioning(true);
        Animated.timing(stepMotion, {
            toValue: 0,
            duration: 120,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (!finished) {
                setTransitioning(false);
                return;
            }
            setStepIndex(nextIndex);
            stepMotion.setValue(0);
            Animated.timing(stepMotion, {
                toValue: 1,
                duration: 260,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start(() => setTransitioning(false));
        });
    };

    const advance = () => {
        if (isLastStep) {
            replaceWithSchedule();
            return;
        }
        moveToStep(stepIndex + 1);
    };

    return (
        <View
            style={[
                styles.root,
                mode === "dark" ? styles.rootDark : styles.rootLight,
                {
                    paddingTop: insets.top + 8,
                    paddingBottom: Math.max(insets.bottom, 18),
                },
            ]}
        >
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View style={styles.topRow}>
                <View style={styles.topLeft}>
                    {stepIndex > 0 ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="이전 사용법 보기"
                            disabled={transitioning}
                            hitSlop={10}
                            onPress={() => moveToStep(stepIndex - 1)}
                            style={({ pressed }) => [
                                styles.backButton,
                                {
                                    backgroundColor: mode === "dark"
                                        ? "rgba(255,255,255,0.07)"
                                        : "rgba(15,23,42,0.05)",
                                    opacity: pressed ? 0.55 : 1,
                                },
                            ]}
                        >
                            <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
                        </Pressable>
                    ) : (
                        <View style={styles.backPlaceholder} />
                    )}
                    <Text style={[styles.brand, { color: colors.textPrimary }]}>NoLate</Text>
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="사용법 건너뛰고 NoLate 시작하기"
                    disabled={transitioning}
                    hitSlop={10}
                    onPress={replaceWithSchedule}
                    style={({ pressed }) => [styles.skipButton, { opacity: pressed ? 0.5 : 1 }]}
                >
                    <Text style={[styles.skipText, { color: colors.textSecondary }]}>건너뛰기</Text>
                </Pressable>
            </View>

            <Animated.View
                style={[
                    styles.animatedContent,
                    {
                        opacity: stepMotion,
                        transform: [
                            {
                                translateX: stepMotion.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [stepIndex === 0 ? 14 : 20, 0],
                                }),
                            },
                            {
                                translateY: stepMotion.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [8, 0],
                                }),
                            },
                        ],
                    },
                ]}
            >
                <View style={[styles.hero, { height: heroHeight }]}>
                    <ProductTourVisual step={step} mode={mode} />
                </View>

                <View style={styles.copy}>
                    <Text style={styles.label}>{step.label}</Text>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>{step.title}</Text>
                    <Text style={[styles.description, { color: colors.textSecondary }]}>
                        {step.description}
                    </Text>
                </View>
            </Animated.View>

            <View style={styles.footer}>
                <View
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel={`사용법 ${stepIndex + 1}/${PRODUCT_TOUR_STEPS.length}`}
                    style={styles.progress}
                >
                    {PRODUCT_TOUR_STEPS.map((item, index) => (
                        <View
                            key={item.id}
                            style={[
                                styles.progressDot,
                                index === stepIndex
                                    ? styles.progressDotActive
                                    : mode === "dark"
                                    ? styles.progressDotDark
                                    : styles.progressDotLight,
                            ]}
                        />
                    ))}
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={getProductTourButtonLabel(stepIndex)}
                    accessibilityState={{ disabled: transitioning }}
                    disabled={transitioning}
                    onPress={advance}
                    style={({ pressed }) => [
                        styles.primaryButton,
                        { opacity: transitioning ? 0.62 : pressed ? 0.82 : 1 },
                    ]}
                >
                    <Text style={styles.primaryButtonText}>{getProductTourButtonLabel(stepIndex)}</Text>
                    <Ionicons
                        name={isLastStep ? "checkmark" : "arrow-forward"}
                        size={19}
                        color="#FFFFFF"
                    />
                </Pressable>
            </View>
        </View>
    );
}

function ProductTourVisual({
    step,
    mode,
}: {
    step: ProductTourStep;
    mode: "light" | "dark";
}) {
    if (step.id === "quick" && step.inputImages) {
        return (
            <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={step.accessibilityLabel}
                style={styles.quickVisual}
            >
                <View style={[
                    styles.quickScreen,
                    styles.quickInputScreen,
                    mode === "dark" ? styles.visualFrameDark : styles.visualFrameLight,
                ]}>
                    <Image
                        accessible={false}
                        source={step.inputImages[mode]}
                        resizeMode="cover"
                        style={styles.actualScreen}
                    />
                </View>
                <View style={[
                    styles.quickScreen,
                    styles.quickResultScreen,
                    mode === "dark" ? styles.visualFrameDark : styles.visualFrameLight,
                ]}>
                    <Image
                        accessible={false}
                        source={step.images[mode]}
                        resizeMode="cover"
                        style={styles.actualScreen}
                    />
                </View>
                <View style={styles.quickArrow}>
                    <Ionicons accessible={false} name="arrow-forward" size={17} color="#FFFFFF" />
                </View>
            </View>
        );
    }

    return (
        <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={step.accessibilityLabel}
            style={[
                styles.visualFrame,
                mode === "dark" ? styles.visualFrameDark : styles.visualFrameLight,
            ]}
        >
            <Image
                accessible={false}
                source={step.images[mode]}
                resizeMode="cover"
                style={styles.actualScreen}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, paddingHorizontal: 22 },
    rootDark: { backgroundColor: "#0F1115" },
    rootLight: { backgroundColor: "#F8F9FB" },
    topRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    topLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
    backButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
    backPlaceholder: { width: 2, height: 34 },
    brand: { fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
    skipButton: { minHeight: 36, justifyContent: "center", paddingLeft: 14 },
    skipText: { fontSize: 13, fontWeight: "800" },
    animatedContent: { flex: 1, minHeight: 0 },
    hero: { width: "100%", paddingTop: 18, paddingBottom: 12 },
    visualFrame: { flex: 1, overflow: "hidden", borderRadius: 24, borderWidth: StyleSheet.hairlineWidth },
    quickVisual: { flex: 1, position: "relative" },
    quickScreen: {
        position: "absolute",
        width: "79%",
        height: "72%",
        overflow: "hidden",
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        shadowColor: "#000000",
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
    },
    quickInputScreen: { left: 0, top: 0 },
    quickResultScreen: { right: 0, bottom: 0 },
    quickArrow: {
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 36,
        height: 36,
        marginLeft: -18,
        marginTop: -18,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: BLUE,
        shadowColor: "#000000",
        shadowOpacity: 0.18,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 3 },
        elevation: 7,
    },
    copy: { gap: 9, paddingTop: 13 },
    label: { color: BLUE, fontSize: 14, lineHeight: 20, fontWeight: "800" },
    title: { fontSize: 29, lineHeight: 36, fontWeight: "900", letterSpacing: -0.8 },
    description: { maxWidth: 350, fontSize: 14, lineHeight: 21, fontWeight: "500" },
    footer: { paddingTop: 14, gap: 16 },
    progress: { height: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
    progressDot: { height: 7, borderRadius: 4 },
    progressDotActive: { width: 24, backgroundColor: BLUE },
    progressDotDark: { width: 7, backgroundColor: "rgba(255,255,255,0.18)" },
    progressDotLight: { width: 7, backgroundColor: "rgba(15,23,42,0.14)" },
    primaryButton: { minHeight: 54, borderRadius: 17, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: BLUE },
    primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
    visualFrameDark: { backgroundColor: "#161920", borderColor: "rgba(255,255,255,0.09)" },
    visualFrameLight: { backgroundColor: "#FFFFFF", borderColor: "rgba(15,23,42,0.08)" },
    actualScreen: { width: "100%", height: "100%" },
});
