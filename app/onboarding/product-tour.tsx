import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Animated,
    Easing,
    Image,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSystemReduceMotion } from "../../src/modules/performance/useSystemReduceMotion";

import {
    getProductTourButtonLabel,
    PRODUCT_TOUR_STEPS,
    type ProductTourStep,
} from "../../src/modules/onboarding/productTour";
import { useTheme } from "../../src/modules/theme/ThemeContext";

const BLUE = "#1959DB";
const EXAMPLE_TITLE = "강남역에서 점심 약속";

export default function ProductTourScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const reduceMotion = useSystemReduceMotion();
    const [stepIndex, setStepIndex] = useState(0);
    const [transitioning, setTransitioning] = useState(false);
    const stepMotion = useRef(new Animated.Value(1)).current;
    const direction = useRef(1);
    const offsets = useRef<number[]>([]);
    const seenExamples = useRef(new Set<ProductTourStep["id"]>());
    const step = PRODUCT_TOUR_STEPS[stepIndex];
    const lastStep = stepIndex === PRODUCT_TOUR_STEPS.length - 1;
    const stepLabel = `사용법 ${stepIndex + 1}/${PRODUCT_TOUR_STEPS.length}`;

    const accent = mode === "dark" ? "#9ABEFF" : BLUE;
    const playExample = !seenExamples.current.has(step.id);

    useEffect(() => {
        seenExamples.current.add(step.id);
    }, [step.id]);

    useLayoutEffect(() => {
        if (!transitioning) return;
        if (reduceMotion) {
            stepMotion.setValue(1);
            setTransitioning(false);
            return;
        }
        const animation = Animated.timing(stepMotion, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
            isInteraction: false,
        });
        animation.start(({ finished }) => {
            if (finished) setTransitioning(false);
        });
        return () => animation.stop();
    }, [reduceMotion, stepIndex, stepMotion, transitioning]);

    const moveToStep = (nextIndex: number) => {
        if (transitioning || nextIndex < 0 || nextIndex >= PRODUCT_TOUR_STEPS.length) return;
        direction.current = nextIndex > stepIndex ? 1 : -1;
        stepMotion.setValue(reduceMotion ? 1 : 0);
        setTransitioning(!reduceMotion);
        setStepIndex(nextIndex);
    };

    const openCalendar = () => router.replace("/schedule");
    return (
        <View style={[
            styles.root,
            {
                backgroundColor: mode === "dark" ? "#101217" : "#F8F9FB",
                paddingTop: insets.top + 8,
                paddingBottom: Math.max(insets.bottom, 16),
            },
        ]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={styles.topRow}>
                <View style={styles.brandGroup}>
                    {stepIndex > 0 ? (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="이전 사용법 보기"
                            disabled={transitioning}
                            onPress={() => moveToStep(stepIndex - 1)}
                            style={styles.back}
                        >
                            <Ionicons name="chevron-back-outline" size={21} color={colors.textPrimary} />
                        </Pressable>
                    ) : null}
                    <Text maxFontSizeMultiplier={1.5} style={[styles.brand, { color: colors.textPrimary }]}>NoLate 사용법</Text>
                </View>
                <View style={styles.topTrailing}>
                    {!lastStep && (
                        <Pressable accessibilityRole="button" accessibilityLabel="사용법 건너뛰고 NoLate 시작하기" onPress={openCalendar} style={styles.skip}>
                            <Text maxFontSizeMultiplier={1.5} style={[styles.skipText, { color: colors.textSecondary }]}>건너뛰기</Text>
                        </Pressable>
                    )}
                </View>
            </View>

            <View style={styles.progress}>
                <View style={styles.progressLabels}>
                    <Text style={[styles.stepCount, { color: accent }]}>{lastStep ? "출발 준비" : "빠른 일정"}</Text>
                    <Text accessibilityLabel={stepLabel} maxFontSizeMultiplier={1.5} style={[styles.stepCount, { color: colors.textSecondary }]}>
                        {stepIndex + 1} / {PRODUCT_TOUR_STEPS.length}
                    </Text>
                </View>
                <View style={styles.progressTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {PRODUCT_TOUR_STEPS.map((item, index) => (
                        <View key={item.id} style={[styles.progressSegment, { backgroundColor: index <= stepIndex ? accent : colors.border }]} />
                    ))}
                </View>
            </View>

            <Animated.View style={[
                styles.body,
                {
                    opacity: stepMotion,
                    transform: [{ translateX: stepMotion.interpolate({
                        inputRange: [0, 1],
                        outputRange: [direction.current * 18, 0],
                    }) }],
                },
            ]}>
                <TourPage
                    key={step.id}
                    step={step}
                    initialScrollY={offsets.current[stepIndex] ?? 0}
                    saveScrollY={y => { offsets.current[stepIndex] = y; }}
                    reduceMotion={reduceMotion}
                    playExample={playExample}
                />
            </Animated.View>

            <View style={styles.footer}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={getProductTourButtonLabel(stepIndex)}
                    accessibilityState={{ disabled: transitioning }}
                    disabled={transitioning}
                    onPress={lastStep ? openCalendar : () => moveToStep(stepIndex + 1)}
                    style={({ pressed }) => [styles.primary, { opacity: pressed ? 0.82 : 1 }]}
                >
                    <Text maxFontSizeMultiplier={1.85} style={styles.primaryText}>{getProductTourButtonLabel(stepIndex)}</Text>
                    <Ionicons name={lastStep ? "checkmark-outline" : "arrow-forward-outline"} size={19} color="#FFFFFF" />
                </Pressable>
            </View>
        </View>
    );
}

const inputMethods = [
    { icon: "text-outline", label: "텍스트" },
    { icon: "image-outline", label: "사진" },
    { icon: "mic-outline", label: "음성" },
] as const;

const routeLegs = [
    { label: "도보", minutes: 5, icon: "walk-outline", color: "#65748A" },
    { label: "4호선", minutes: 20, icon: "train-outline", color: "#067CBA" },
    { label: "환승", minutes: 3, icon: "swap-horizontal-outline", color: "#65748A" },
    { label: "2호선", minutes: 6, icon: "train-outline", color: "#087E4C" },
    { label: "도보", minutes: 2, icon: "walk-outline", color: "#65748A" },
] as const;

function TourPage({ step, initialScrollY, saveScrollY, reduceMotion, playExample }: {
    step: ProductTourStep;
    initialScrollY: number;
    saveScrollY: (y: number) => void;
    reduceMotion: boolean;
    playExample: boolean;
}) {
    const { colors, mode } = useTheme();
    const { fontScale, width } = useWindowDimensions();
    const offset = useRef({ x: 0, y: initialScrollY }).current;
    const heading = useRef<Text>(null);
    const accent = mode === "dark" ? "#9ABEFF" : BLUE;
    const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
    const [replay, setReplay] = useState(0);
    const autoPlay = useRef(playExample).current;
    const exampleMotion = useRef(new Animated.Value(playExample && !reduceMotion ? 0 : 1)).current;
    const quick = step.id === "quick";
    const mapWidth = Math.min(480, Math.max(1, width - 44));
    const mapHeight = mapWidth * 216 / 1206;

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            if (heading.current) AccessibilityInfo.sendAccessibilityEvent?.(heading.current, "focus");
        });
        return () => cancelAnimationFrame(frame);
    }, [step.id]);

    useEffect(() => {
        if (reduceMotion || (!autoPlay && replay === 0)) {
            exampleMotion.setValue(1);
            return;
        }
        exampleMotion.setValue(0);
        const animation = Animated.timing(exampleMotion, {
            toValue: 1,
            duration: quick ? 300 : 340,
            easing: Easing.linear,
            useNativeDriver: true,
            isInteraction: false,
        });
        animation.start();
        return () => animation.stop();
    }, [autoPlay, exampleMotion, quick, reduceMotion, replay]);

    return (
        <ScrollView
            testID={`product-tour-page-${step.id}`}
            contentOffset={offset}
            onScroll={event => saveScrollY(Math.max(0, event.nativeEvent.contentOffset.y))}
            scrollEventThrottle={16}
            contentContainerStyle={styles.page}
            showsVerticalScrollIndicator={fontScale > 1.45}
        >
            <View style={styles.copy}>
                <Text ref={heading} accessible accessibilityRole="header" maxFontSizeMultiplier={2}
                    lineBreakStrategyIOS="hangul-word" style={[styles.title, { color: colors.textPrimary }]}>
                    {step.title}
                </Text>
                <Text maxFontSizeMultiplier={1.9} lineBreakStrategyIOS="hangul-word" style={[styles.description, { color: colors.textSecondary }]}>
                    {step.description}
                </Text>
            </View>
            <View style={styles.example}>
                <View style={styles.exampleHeading}>
                    <Text maxFontSizeMultiplier={1.75} style={[styles.exampleLabel, { color: colors.textSecondary }]}>{quick ? "입력 예시" : "경로 예시"}</Text>
                    {!reduceMotion && (
                        <Pressable accessibilityRole="button" accessibilityLabel="예시 다시 보기" onPress={() => setReplay(value => value + 1)} style={styles.replay}>
                            <Ionicons accessible={false} name="refresh-outline" size={17} color={accent} />
                            <Text maxFontSizeMultiplier={1.75} style={[styles.replayText, { color: accent }]}>예시 다시 보기</Text>
                        </Pressable>
                    )}
                </View>
                {quick ? (
                    <>
                        <View style={[card, styles.inputCard]}>
                            <View style={[styles.methods, { backgroundColor: colors.surface2 }]}>
                                {inputMethods.map(({ icon, label }, index) => (
                                    <View key={label} style={[styles.method, index === 0 && { backgroundColor: colors.surface }]}>
                                        <Ionicons accessible={false} name={icon} size={16} color={index === 0 ? accent : colors.textSecondary} />
                                        <Text maxFontSizeMultiplier={1.65} style={[styles.methodText, { color: index === 0 ? accent : colors.textSecondary }]}>{label}</Text>
                                    </View>
                                ))}
                            </View>
                            <Text maxFontSizeMultiplier={1.9} style={[styles.exampleDetail, { color: colors.textPrimary }]}>
                                8월 8일 낮 12시 <Text style={[styles.match, { color: accent }]}>{EXAMPLE_TITLE}</Text>, 서울역에서 출발
                            </Text>
                        </View>
                        <Ionicons accessible={false} name="arrow-down-outline" size={18} color={accent} style={styles.exampleArrow} />
                        <Animated.View style={[card, styles.previewCard, {
                            opacity: exampleMotion.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.35, 1] }),
                            transform: [
                                { perspective: 640 },
                                { rotateX: exampleMotion.interpolate({ inputRange: [0, 1], outputRange: ["-12deg", "0deg"] }) },
                                { translateY: exampleMotion.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
                            ],
                        }]}>
                            <Text style={[styles.exampleLabel, { color: accent }]}>일정 미리보기</Text>
                            <Text maxFontSizeMultiplier={2} style={[styles.exampleText, { color: accent }]}>{EXAMPLE_TITLE}</Text>
                            <Text maxFontSizeMultiplier={1.9} style={[styles.exampleDetail, { color: colors.textPrimary }]}>
                                <Text style={{ color: colors.textSecondary }}>일시  </Text>8월 8일 · 12:00–13:00
                            </Text>
                            <Text maxFontSizeMultiplier={1.9} style={[styles.exampleDetail, { color: colors.textPrimary }]}>
                                <Text style={{ color: colors.textSecondary }}>장소  </Text>강남역
                            </Text>
                        </Animated.View>
                    </>
                ) : (
                    <View style={[card, styles.routeCard]}>
                        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                            style={[styles.routeImageFrame, { height: mapHeight }]}>
                            <Image source={step.images[mode]} resizeMode="cover"
                                style={{
                                    position: "absolute",
                                    width: mapWidth,
                                    height: mapWidth * 1050 / 1206,
                                    top: -mapWidth * 338 / 1206,
                                }} />
                        </View>
                        <View style={styles.routeCopy}>
                            <Text maxFontSizeMultiplier={1.9} style={[styles.exampleDetail, { color: colors.textPrimary }]}>서울역 → 강남역</Text>
                            <Text style={[styles.exampleLabel, { color: accent }]}>예상 출발</Text>
                            <View style={styles.departureHeading}>
                                <Text accessibilityLabel="오전 11시 24분" maxFontSizeMultiplier={2} style={[styles.departureTime, { color: colors.textPrimary }]}>11:24</Text>
                                <Text maxFontSizeMultiplier={1.65} style={[styles.remaining, { color: accent, backgroundColor: colors.surface2 }]}>18분 남음</Text>
                            </View>
                            <Text maxFontSizeMultiplier={1.9} style={[styles.exampleDetail, { color: colors.textSecondary }]}>12:00 도착 기준 · 36분 이동</Text>
                            <View accessible accessibilityLabel={routeLegs.map(leg => `${leg.label} ${leg.minutes}분`).join(", ")} style={styles.routeRail}>
                                {routeLegs.map((leg, index) => {
                                    const start = (index * 40) / 340;
                                    const end = start + 180 / 340;
                                    const legOpacity = exampleMotion.interpolate({
                                        inputRange: start === 0 ? [0, end, 1] : [0, start, end, 1],
                                        outputRange: start === 0 ? [0, 1, 1] : [0, 0, 1, 1],
                                    });
                                    return (
                                        <Animated.View key={index} importantForAccessibility="no-hide-descendants"
                                            style={[styles.leg, { opacity: legOpacity, flexGrow: leg.minutes }]}>
                                            <View style={styles.legLine}>
                                                <View style={[styles.legMarker, { backgroundColor: leg.color }]}>
                                                    <Ionicons accessible={false} name={leg.icon} size={13} color="#FFFFFF" />
                                                </View>
                                                <View style={[styles.legRule, { backgroundColor: leg.color }]} />
                                            </View>
                                            <Text maxFontSizeMultiplier={1.65} style={[styles.legLabel, { color: colors.textSecondary }]}>{leg.label}</Text>
                                            <Text maxFontSizeMultiplier={1.65} style={[styles.legMinutes, { color: colors.textPrimary }]}>{leg.minutes}분</Text>
                                        </Animated.View>
                                    );
                                })}
                            </View>
                            <Text maxFontSizeMultiplier={1.8} style={[styles.exampleDetail, { color: colors.textSecondary }]}>환승 1회 · 1,500원</Text>
                        </View>
                    </View>
                )}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, paddingHorizontal: 22 },
    topRow: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    brandGroup: { flex: 1, paddingHorizontal: 72, flexDirection: "row", alignItems: "center", justifyContent: "center" },
    back: { position: "absolute", left: 0, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    brand: { fontSize: 17, fontWeight: "800", textAlign: "center", flexShrink: 1 },
    stepCount: { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
    topTrailing: { position: "absolute", right: 0 },
    skip: { minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
    skipText: { fontSize: 13, fontWeight: "600" },
    progress: { gap: 7, paddingVertical: 7 },
    progressLabels: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    progressTrack: { flexDirection: "row", gap: 4 },
    progressSegment: { height: 3, borderRadius: 2, flex: 1 },
    body: { flex: 1, minHeight: 0 },
    page: { width: "100%", maxWidth: 480, alignSelf: "center", paddingTop: 14, paddingBottom: 20, gap: 10 },
    copy: { gap: 8 },
    title: { fontSize: 25, fontWeight: "800", letterSpacing: -0.65 },
    description: { fontSize: 15, fontWeight: "500" },
    example: { gap: 8 },
    exampleHeading: { minHeight: 44, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 },
    replay: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6 },
    replayText: { flexShrink: 1, fontSize: 13, fontWeight: "700" },
    card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
    inputCard: { padding: 12, gap: 8 },
    previewCard: { padding: 13, gap: 5 },
    methods: { flexDirection: "row", flexWrap: "wrap", borderRadius: 10, padding: 3, gap: 3 },
    method: { flexGrow: 1, minHeight: 34, paddingHorizontal: 4, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
    methodText: { fontSize: 12, fontWeight: "700" },
    match: { fontWeight: "800" },
    exampleLabel: { fontSize: 13, fontWeight: "700" },
    exampleText: { fontSize: 18, fontWeight: "800" },
    exampleDetail: { fontSize: 14, fontWeight: "500" },
    exampleArrow: { alignSelf: "center" },
    routeCard: { overflow: "hidden" },
    routeImageFrame: { overflow: "hidden" },
    routeCopy: { padding: 13, gap: 5 },
    departureHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 },
    departureTime: { fontSize: 33, fontWeight: "800", fontVariant: ["tabular-nums"] },
    remaining: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 7, fontSize: 12, fontWeight: "700" },
    routeRail: { flexDirection: "row", justifyContent: "space-between", gap: 4, paddingVertical: 9 },
    leg: { flexBasis: 0, minWidth: 44, gap: 3 },
    legLine: { flexDirection: "row", alignItems: "center", gap: 3 },
    legMarker: { width: 21, height: 21, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    legRule: { height: 2, flex: 1, borderRadius: 1 },
    legLabel: { fontSize: 11, fontWeight: "600" },
    legMinutes: { fontSize: 12, fontWeight: "800" },
    footer: { paddingTop: 9 },
    primary: { minHeight: 54, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: BLUE },
    primaryText: { flexShrink: 1, color: "#FFFFFF", fontSize: 16, fontWeight: "700", textAlign: "center" },
});
