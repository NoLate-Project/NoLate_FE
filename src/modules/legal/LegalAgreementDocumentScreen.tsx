import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, BackHandler, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { LegalDocument } from "../../api/legal";
import { useAuth } from "../auth/AuthContext";
import { getPostAuthRoute } from "../onboarding/curationRouting";
import { useTheme } from "../theme/ThemeContext";
import BrandedLoader from "../../ui/BrandedLoader";
import { useScreenFirstPaintPerformance } from "../performance/useScreenFirstPaintPerformance";
import { useImmediateNavigationTransition } from "../performance/ImmediateNavigationTransition";
import { usePreMountedSceneActivity } from "../performance/preMountedSceneActivity";
import { useSystemReduceMotion } from "../performance/useSystemReduceMotion";

type LegalAgreementDocumentScreenProps = {
    fallback: LegalDocument;
    loadDocument: () => Promise<LegalDocument>;
    route: string;
    collapsibleSections?: boolean;
};

export default function LegalAgreementDocumentScreen({
    fallback,
    loadDocument,
    route,
    collapsibleSections = false,
}: LegalAgreementDocumentScreenProps) {
    useScreenFirstPaintPerformance(route);
    const router = useRouter();
    const routeFocused = useIsFocused();
    const sceneActive = usePreMountedSceneActivity();
    const visible = sceneActive ?? routeFocused;
    const { closeActiveScene } = useImmediateNavigationTransition();
    const insets = useSafeAreaInsets();
    const { fontScale } = useWindowDimensions();
    const reduceMotion = useSystemReduceMotion();
    const animateSectionJump = !reduceMotion && fontScale <= 1.35;
    const { colors, mode } = useTheme();
    const { isAuthenticated, isCurationCompleted } = useAuth();
    const [document, setDocument] = useState(fallback);
    const [loading, setLoading] = useState(true);
    const [usingFallback, setUsingFallback] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    const [contentsOpen, setContentsOpen] = useState(false);
    const [headerHeight, setHeaderHeight] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(0);
    const [selectedSection, setSelectedSection] = useState<number>();
    const [expandedSections, setExpandedSections] = useState<ReadonlySet<number>>(() => new Set());
    const [highlightedSection, setHighlightedSection] = useState<number>();
    const scrollRef = useRef<ScrollView>(null);
    const contentsScrollRef = useRef<ScrollView>(null);
    const contentsButtonRef = useRef<View>(null);
    const contentsRowRef = useRef<View>(null);
    const contentsFocusFrame = useRef<number | undefined>(undefined);
    const [compactTitleVisible, setCompactTitleVisible] = useState(false);
    const titleBottom = useRef(Number.POSITIVE_INFINITY);
    const pendingSection = useRef<number | undefined>(undefined);
    const scrollOffset = useRef(0);
    const activeSectionJump = useRef<{ index: number; offset: number } | undefined>(undefined);
    const sectionScrollFrame = useRef<number | undefined>(undefined);
    const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const sectionTitles = useRef(new Map<number, View | Text>());
    const sectionOffsets = useRef(new Map<number, number>());
    const accent = mode === "dark" ? "#A4C8FF" : "#235FB9";
    const accentSurface = mode === "dark" ? "#253653" : "#EDF4FF";

    const finishSectionJump = useCallback((index: number) => {
        activeSectionJump.current = undefined;
        const target = sectionTitles.current.get(index);
        if (target) AccessibilityInfo.sendAccessibilityEvent(target, "focus");
        setHighlightedSection(index);
        if (highlightTimer.current !== undefined) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlightedSection(undefined), 900);
    }, []);

    const scrollToPendingSection = useCallback(() => {
        if (pendingSection.current === undefined) return;
        if (sectionScrollFrame.current !== undefined) cancelAnimationFrame(sectionScrollFrame.current);
        sectionScrollFrame.current = requestAnimationFrame(() => {
            sectionScrollFrame.current = undefined;
            const index = pendingSection.current;
            if (index === undefined) return;
            const top = sectionOffsets.current.get(index);
            if (top === undefined) return;
            pendingSection.current = undefined;
            const offset = Math.max(styles.content.paddingTop + top - 8, 0);
            const animated = animateSectionJump && Math.abs(offset - scrollOffset.current) > 1;
            if (animated) activeSectionJump.current = { index, offset };
            scrollRef.current?.scrollTo({ y: offset, animated });
            if (!animated) finishSectionJump(index);
        });
    }, [animateSectionJump, finishSectionJump]);

    useLayoutEffect(() => {
        if (!contentsOpen) scrollToPendingSection();
    }, [contentsOpen, expandedSections, scrollToPendingSection]);

    useEffect(() => () => {
        if (sectionScrollFrame.current !== undefined) cancelAnimationFrame(sectionScrollFrame.current);
        if (contentsFocusFrame.current !== undefined) cancelAnimationFrame(contentsFocusFrame.current);
        if (highlightTimer.current !== undefined) clearTimeout(highlightTimer.current);
    }, []);

    const focusContentsRow = (offset: number) => {
        if (contentsFocusFrame.current !== undefined) cancelAnimationFrame(contentsFocusFrame.current);
        contentsFocusFrame.current = requestAnimationFrame(() => {
            contentsFocusFrame.current = undefined;
            contentsScrollRef.current?.scrollTo({ y: offset, animated: false });
            if (contentsRowRef.current) AccessibilityInfo.sendAccessibilityEvent(contentsRowRef.current, "focus");
        });
    };

    const dismissContents = useCallback(() => {
        setContentsOpen(false);
        if (contentsFocusFrame.current !== undefined) cancelAnimationFrame(contentsFocusFrame.current);
        contentsFocusFrame.current = requestAnimationFrame(() => {
            contentsFocusFrame.current = undefined;
            if (contentsButtonRef.current) AccessibilityInfo.sendAccessibilityEvent(contentsButtonRef.current, "focus");
        });
    }, []);

    useEffect(() => {
        if (!visible || !contentsOpen) return;
        const back = BackHandler.addEventListener("hardwareBackPress", () => {
            dismissContents();
            return true;
        });
        return () => back.remove();
    }, [contentsOpen, dismissContents, visible]);

    const selectSection = (index: number) => {
        activeSectionJump.current = undefined;
        setContentsOpen(false);
        setSelectedSection(index);
        pendingSection.current = index;
        if (collapsibleSections) setExpandedSections(current => current.has(index) ? current : new Set([...current, index]));
    };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setUsingFallback(false);

        loadDocument()
            .then((latest) => {
                if (!cancelled) {
                    setDocument(latest);
                    setUsingFallback(false);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setDocument(fallback);
                    setUsingFallback(true);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [fallback, loadDocument, reloadKey]);

    const goBack = () => {
        if (contentsOpen) {
            dismissContents();
            return;
        }
        activeSectionJump.current = undefined;
        if (closeActiveScene()) return;
        if (router.canGoBack()) router.back();
        else router.replace(isAuthenticated ? getPostAuthRoute(isCurationCompleted) : "/auth/login");
    };

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}
                style={[styles.header, { paddingTop: insets.top + 8 }]}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="이전 화면으로 돌아가기"
                        onPress={goBack}
                        style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons accessible={false} importantForAccessibility="no" name="chevron-back-outline" size={22} color={colors.textPrimary} />
                    </Pressable>
                <View style={styles.headerTitleSlot}>
                    {compactTitleVisible && (
                        <Animated.Text testID="legal-compact-title" entering={compactTitleIn} exiting={compactTitleOut}
                            accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                            style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                            {document.title}
                        </Animated.Text>
                    )}
                </View>
                <Pressable
                    ref={contentsButtonRef}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: contentsOpen }}
                    accessibilityLabel="문서 목차"
                    onPress={contentsOpen ? dismissContents : () => {
                        activeSectionJump.current = undefined;
                        setContentsOpen(true);
                    }}
                    style={({ pressed }) => [styles.contentsButton,
                        (contentsOpen || pressed) && { backgroundColor: accentSurface }]}
                >
                    <Ionicons accessible={false} importantForAccessibility="no" name="list-outline" size={18} color={accent} />
                    <Text style={[styles.contentsLabel, { color: accent }]}>목차</Text>
                </Pressable>
            </View>

            {contentsOpen && (
                <View pointerEvents="box-none" style={[styles.contentsOverlay, { top: headerHeight }]}>
                <Pressable accessible={false} importantForAccessibility="no" onPress={dismissContents} style={StyleSheet.absoluteFill} />
                <Animated.View entering={sectionIn} onAccessibilityEscape={dismissContents}
                    style={[styles.contents, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <Text accessibilityRole="header" style={[styles.contentsCount, { color: colors.textSecondary }]}>
                        {document.sections.length}개 조항
                    </Text>
                    <ScrollView ref={contentsScrollRef} keyboardShouldPersistTaps="handled">
                        {document.sections.map((section, index) => {
                            const selected = selectedSection === index;
                            const focusOnOpen = index === (selectedSection ?? 0);
                            return (
                                <Pressable key={index} testID={`legal-contents-${index}`} accessibilityRole="button"
                                    ref={focusOnOpen ? contentsRowRef : undefined}
                                    onLayout={focusOnOpen ? event => focusContentsRow(event.nativeEvent.layout.y) : undefined}
                                    accessibilityState={{ selected }}
                                    onPress={() => selectSection(index)}
                                    style={({ pressed }) => [styles.contentsRow, (pressed || selected) && { backgroundColor: accentSurface }]}>
                                    <Text style={[styles.contentsLabel, { color: selected ? accent : colors.textPrimary }]}>{section.title}</Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </Animated.View>
                </View>
            )}
            <ScrollView
                ref={scrollRef}
                onLayout={event => setViewportHeight(event.nativeEvent.layout.height)}
                accessibilityElementsHidden={contentsOpen}
                importantForAccessibility={contentsOpen ? "no-hide-descendants" : "auto"}
                scrollEventThrottle={16}
                onScrollBeginDrag={() => { activeSectionJump.current = undefined; }}
                onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
                    const { y } = contentOffset;
                    scrollOffset.current = y;
                    setCompactTitleVisible(y >= titleBottom.current);
                    const jump = activeSectionJump.current;
                    if (jump) {
                        const reachableOffset = Math.min(jump.offset, Math.max(0, contentSize.height - layoutMeasurement.height));
                        if (Math.abs(y - reachableOffset) <= 1) finishSectionJump(jump.index);
                    }
                }}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 18) + 24 },
                ]}
            >
                <View style={styles.document}>
                <View accessible accessibilityLabel={`시행일 ${document.effectiveDate}, 버전 ${document.version}`} style={styles.metadata}>
                    <Text style={[styles.effectiveDate, { color: colors.textSecondary }]}>시행일 {document.effectiveDate}</Text>
                    <Text style={[styles.version, { color: colors.textSecondary, backgroundColor: colors.surface2 }]}>
                        v{document.version}
                    </Text>
                </View>
                <Text testID="legal-document-title" accessibilityRole="header"
                    onLayout={event => {
                        const { y, height } = event.nativeEvent.layout;
                        titleBottom.current = styles.content.paddingTop + y + height;
                    }}
                    style={[styles.title, { color: colors.textPrimary }]}>{document.title}</Text>
                <Text style={[styles.summary, { color: colors.textSecondary }]}>{document.summary}</Text>

                {loading ? (
                    <View
                        accessible
                        accessibilityRole="progressbar"
                        accessibilityLabel={`최신 ${document.title} 확인 중`}
                        accessibilityLiveRegion="polite"
                        style={[styles.loading, { borderColor: colors.border }]}
                    >
                        <View
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            style={styles.loadingContent}
                        >
                            <BrandedLoader size="button" variant="auth" accessibilityLabel="최신 문서 확인 중" />
                            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>최신 문서 확인 중</Text>
                        </View>
                    </View>
                ) : null}

                {usingFallback ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`최신 ${document.title} 다시 불러오기`}
                        accessibilityLiveRegion="polite"
                        onPress={() => setReloadKey((current) => current + 1)}
                        style={({ pressed }) => [
                            styles.notice,
                            {
                                backgroundColor: colors.surface2,
                                borderColor: colors.border,
                                opacity: pressed ? 0.62 : 1,
                            },
                        ]}
                    >
                        <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                        <Text
                            style={[styles.noticeText, { color: colors.textSecondary }]}
                        >
                            최신 문서를 불러오지 못해 앱에 포함된 문서를 표시합니다. 탭해서 다시 확인할 수 있어요.
                        </Text>
                    </Pressable>
                ) : null}

                {document.sections.map((section, index) => {
                    const expanded = !collapsibleSections || expandedSections.has(index);
                    const highlight = highlightedSection === index ? { backgroundColor: accentSurface } : undefined;
                    return (
                        <View
                            key={`${section.title}-${index}`}
                            onLayout={event => {
                                sectionOffsets.current.set(index, event.nativeEvent.layout.y);
                                if (pendingSection.current === index) scrollToPendingSection();
                            }}
                            style={[
                                styles.section,
                                { borderColor: colors.border },
                                // Allow even a short final article to align below the fixed header.
                                index === document.sections.length - 1 && selectedSection !== undefined
                                    ? { minHeight: Math.max(0, viewportHeight - Math.max(insets.bottom, 18) - 16) }
                                    : undefined,
                            ]}
                        >
                            {collapsibleSections ? (
                                <Pressable
                                    ref={view => {
                                        if (view) sectionTitles.current.set(index, view);
                                        else sectionTitles.current.delete(index);
                                    }}
                                    accessibilityRole="button"
                                    accessibilityState={{ expanded }}
                                    accessibilityLabel={`${section.title}, ${section.body.length}개 항목`}
                                    testID={`legal-article-${index}`}
                                    onPress={() => setExpandedSections(current => {
                                        const next = new Set(current);
                                        if (next.has(index)) next.delete(index);
                                        else next.add(index);
                                        return next;
                                    })}
                                    style={[styles.sectionButton, highlight]}
                                >
                                    <View style={styles.sectionButtonTitle}>
                                        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{section.title}</Text>
                                        <Text style={[styles.sectionCount, { color: colors.textSecondary }]}>{section.body.length}개 항목</Text>
                                    </View>
                                    <Ionicons accessible={false} importantForAccessibility="no" name={expanded ? "chevron-up-outline" : "chevron-down-outline"} size={16} color={colors.textSecondary} />
                                </Pressable>
                            ) : (
                                <Text testID={`legal-article-${index}`} ref={view => {
                                    if (view) sectionTitles.current.set(index, view);
                                    else sectionTitles.current.delete(index);
                                }} accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }, highlight]}>{section.title}</Text>
                            )}
                            {expanded && (
                                <Animated.View entering={collapsibleSections ? sectionIn : undefined} style={styles.paragraphs}>
                                    {section.body.map((paragraph, paragraphIndex) => (
                                        <Text key={paragraphIndex} style={[styles.paragraph, { color: colors.textPrimary }]}>{paragraph}</Text>
                                    ))}
                                </Animated.View>
                            )}
                        </View>
                    );
                })}
                </View>
            </ScrollView>
        </View>
    );
}

const sectionIn = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const compactTitleIn = FadeIn.duration(140).reduceMotion(ReduceMotion.System);
const compactTitleOut = FadeOut.duration(140).reduceMotion(ReduceMotion.System);

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: {
        minHeight: 64,
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    headerTitleSlot: { flex: 1, minWidth: 0 },
    headerTitle: { textAlign: "center", fontSize: 17, fontWeight: "900" },
    contentsButton: { minHeight: 44, borderRadius: 9, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8 },
    contentsLabel: { fontSize: 14, fontWeight: "600" },
    contentsOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
    contents: {
        maxHeight: "58%", marginHorizontal: 12, paddingHorizontal: 9, paddingVertical: 7,
        borderWidth: StyleSheet.hairlineWidth, borderRadius: 13,
        shadowColor: "#15243A", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 14,
        elevation: 4,
    },
    contentsCount: { paddingHorizontal: 8, paddingVertical: 5, fontSize: 12, fontWeight: "700" },
    contentsRow: { minHeight: 44, justifyContent: "center", paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8 },
    document: { gap: 12 },
    content: { paddingHorizontal: 18, paddingTop: 18, gap: 12 },
    metadata: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" },
    effectiveDate: { fontSize: 12, lineHeight: 17, fontWeight: "500" },
    version: { fontSize: 11, lineHeight: 16, fontWeight: "600", borderRadius: 5, paddingVertical: 3, paddingHorizontal: 6 },
    title: { fontSize: 26, lineHeight: 34, fontWeight: "800" },
    summary: { fontSize: 14, lineHeight: 22, fontWeight: "500", marginBottom: 4 },
    loading: {
        minHeight: 48,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    loadingContent: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    loadingText: { fontSize: 12, fontWeight: "800" },
    notice: {
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 13,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    noticeText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: "700" },
    section: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 16, gap: 9 },
    sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: "900" },
    sectionButton: { minHeight: 44, gap: 12, flexDirection: "row", alignItems: "center" },
    sectionButtonTitle: { flex: 1 },
    sectionCount: { fontSize: 12, lineHeight: 17, marginTop: 2 },
    paragraphs: { gap: 8 },
    paragraph: { fontSize: 15, lineHeight: 23 },
});
