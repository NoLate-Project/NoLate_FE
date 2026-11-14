import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { LegalDocument } from "../../api/legal";
import { useAuth } from "../auth/AuthContext";
import { getPostAuthRoute } from "../onboarding/curationRouting";
import { useTheme } from "../theme/ThemeContext";
import BrandedLoader from "../../ui/BrandedLoader";
import { useScreenFirstPaintPerformance } from "../performance/useScreenFirstPaintPerformance";
import { useImmediateNavigationTransition } from "../performance/ImmediateNavigationTransition";

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
    const { closeActiveScene } = useImmediateNavigationTransition();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { isAuthenticated, isCurationCompleted } = useAuth();
    const [document, setDocument] = useState(fallback);
    const [loading, setLoading] = useState(true);
    const [usingFallback, setUsingFallback] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    const [contentsOpen, setContentsOpen] = useState(false);
    const [expandedSection, setExpandedSection] = useState<number>();
    const scrollRef = useRef<ScrollView>(null);
    const contentRef = useRef<View>(null);
    const activeSectionRef = useRef<number | undefined>(undefined);
    const sections = useRef(new Map<number, View>());

    const scrollToSection = (index: number) => {
        const content = contentRef.current;
        const section = sections.current.get(index);
        if (!content || !section) return;
        section.measureLayout(content, (_left, top) => {
            scrollRef.current?.scrollTo({ y: Math.max(top - 8, 0), animated: false });
        }, () => undefined);
    };

    const selectSection = (index: number) => {
        setContentsOpen(false);
        activeSectionRef.current = index;
        if (collapsibleSections) setExpandedSection(index);
        requestAnimationFrame(() => scrollToSection(index));
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
        if (closeActiveScene()) return;
        if (router.canGoBack()) router.back();
        else router.replace(isAuthenticated ? getPostAuthRoute(isCurationCompleted) : "/auth/login");
    };

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="이전 화면으로 돌아가기"
                        onPress={goBack}
                        style={({ pressed }) => [styles.backButton, { backgroundColor: colors.surface2, opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
                    </Pressable>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                    {document.title}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: contentsOpen }}
                    accessibilityLabel="문서 목차"
                    onPress={() => setContentsOpen(open => !open)}
                    style={styles.contentsButton}
                >
                    <Text style={[styles.contentsLabel, { color: colors.textPrimary }]}>목차</Text>
                    <Ionicons name={contentsOpen ? "chevron-up-outline" : "chevron-down-outline"} size={14} color={colors.textSecondary} />
                </Pressable>
            </View>

            {contentsOpen && (
                <Animated.View entering={sectionIn} exiting={sectionOut} style={[styles.contents, { borderColor: colors.border }]}>
                    <ScrollView keyboardShouldPersistTaps="handled">
                        {document.sections.map((section, index) => (
                            <Pressable key={index} accessibilityRole="button" onPress={() => selectSection(index)} style={styles.contentsRow}>
                                <Text style={[styles.contentsLabel, { color: colors.textPrimary }]}>{section.title}</Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                </Animated.View>
            )}
            <ScrollView
                ref={scrollRef}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 18) + 24 },
                ]}
            >
                <View ref={contentRef} collapsable={false} style={styles.document}>
                <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
                    시행일 {document.effectiveDate} · 버전 {document.version}
                </Text>
                <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{document.title}</Text>
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
                    const expanded = !collapsibleSections || expandedSection === index;
                    return (
                        <View
                            key={`${section.title}-${index}`}
                            ref={view => {
                                if (view) sections.current.set(index, view);
                                else sections.current.delete(index);
                            }}
                            collapsable={false}
                            onLayout={() => {
                                if (activeSectionRef.current === index) {
                                    activeSectionRef.current = undefined;
                                    scrollToSection(index);
                                }
                            }}
                            style={[styles.section, { borderColor: colors.border }]}
                        >
                            {collapsibleSections ? (
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityState={{ expanded }}
                                    accessibilityLabel={section.title}
                                    testID={`legal-article-${index}`}
                                    onPress={() => setExpandedSection(expanded ? undefined : index)}
                                    style={styles.sectionButton}
                                >
                                    <Text style={[styles.sectionTitle, styles.sectionButtonTitle, { color: colors.textPrimary }]}>{section.title}</Text>
                                    <Ionicons name={expanded ? "chevron-up-outline" : "chevron-down-outline"} size={16} color={colors.textSecondary} />
                                </Pressable>
                            ) : <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>{section.title}</Text>}
                            {expanded && (
                                <Animated.View entering={collapsibleSections ? sectionIn : undefined} style={styles.paragraphs}>
                                    {section.body.map((paragraph, paragraphIndex) => (
                                        <Text key={paragraphIndex} style={[styles.paragraph, { color: colors.textSecondary }]}>{paragraph}</Text>
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
const sectionOut = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

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
    headerTitle: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 17, fontWeight: "900" },
    contentsButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8 },
    contentsLabel: { fontSize: 14, fontWeight: "600" },
    contents: { maxHeight: "35%", paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth },
    contentsRow: { minHeight: 44, justifyContent: "center", paddingVertical: 8 },
    document: { gap: 12 },
    content: { paddingHorizontal: 18, paddingTop: 18, gap: 12 },
    eyebrow: { fontSize: 12, lineHeight: 17, fontWeight: "900" },
    title: { fontSize: 28, lineHeight: 35, fontWeight: "900" },
    summary: { fontSize: 14, lineHeight: 21, fontWeight: "700", marginBottom: 4 },
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
    paragraphs: { gap: 8 },
    paragraph: { fontSize: 15, lineHeight: 23 },
});
