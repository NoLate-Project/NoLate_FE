import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    getPrivacyPolicy,
    PRIVACY_POLICY_FALLBACK,
    type LegalDocument,
} from "../../src/api/legal";
import CalendarGlassSurface from "../../src/modules/schedule/components/calendar/CalendarGlassSurface";
import { useAuth } from "../../src/modules/auth/AuthContext";
import { getPostAuthRoute } from "../../src/modules/onboarding/curationRouting";
import { useTheme } from "../../src/modules/theme/ThemeContext";
import BrandedLoader from "../../src/ui/BrandedLoader";

export default function PrivacyPolicyScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { isAuthenticated, isCurationCompleted } = useAuth();
    const [document, setDocument] = useState<LegalDocument>(PRIVACY_POLICY_FALLBACK);
    const [loading, setLoading] = useState(true);
    const [usingFallback, setUsingFallback] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [expandedSectionTitles, setExpandedSectionTitles] = useState<Set<string>>(() => new Set());

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setUsingFallback(false);

        getPrivacyPolicy()
            .then((nextDocument) => {
                if (cancelled) return;
                setDocument(nextDocument);
                setUsingFallback(false);
            })
            .catch(() => {
                if (cancelled) return;
                setDocument(PRIVACY_POLICY_FALLBACK);
                setUsingFallback(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    const goBack = () => {
        if (router.canGoBack()) {
            router.back();
            return;
        }

        router.replace(isAuthenticated ? getPostAuthRoute(isCurationCompleted) : "/auth/login");
    };

    const toggleSection = (title: string) => {
        setExpandedSectionTitles((current) => {
            const next = new Set(current);

            if (next.has(title)) {
                next.delete(title);
            } else {
                next.add(title);
            }

            return next;
        });
    };

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />

            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.backGlass, { borderColor: colors.border }]}
                >
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="이전 화면으로 돌아가기"
                        onPress={goBack}
                        style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.55 : 1 }]}
                    >
                        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                    </Pressable>
                </CalendarGlassSurface>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>개인정보처리방침</Text>
                <View style={styles.headerSpacer} />
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 18) + 24 },
                ]}
            >
                <View style={styles.hero}>
                    <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
                        시행일 {document.effectiveDate}
                    </Text>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>
                        {document.title}
                    </Text>
                    <Text style={[styles.summary, { color: colors.textSecondary }]}>
                        {document.summary}
                    </Text>
                    <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                        필요한 항목만 펼쳐서 확인할 수 있어요.
                    </Text>
                </View>

                {loading ? (
                    <View
                        accessible
                        accessibilityRole="progressbar"
                        accessibilityLabel="최신 개인정보처리방침을 확인하고 있어요"
                        accessibilityLiveRegion="polite"
                        style={[styles.loadingBox, { borderColor: colors.border }]}
                    >
                        <View
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            style={styles.loadingContent}
                        >
                            <BrandedLoader
                                size="button"
                                variant="auth"
                                accessibilityLabel="최신 개인정보처리방침을 확인하고 있어요"
                            />
                            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                                최신 방침을 확인하는 중
                            </Text>
                        </View>
                    </View>
                ) : null}

                {usingFallback ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="최신 개인정보처리방침 다시 불러오기"
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
                        <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
                            서버에서 최신 문서를 불러오지 못해 앱에 포함된 방침을 표시합니다. 탭해서 다시 확인할 수 있어요.
                        </Text>
                    </Pressable>
                ) : null}

                {document.sections.map((section, sectionIndex) => {
                    const expanded = expandedSectionTitles.has(section.title);

                    return (
                        <CalendarGlassSurface
                            key={`${section.title}-${sectionIndex}`}
                            variant="card"
                            tone="solidCard"
                            style={[styles.sectionCard, { borderColor: colors.border }]}
                        >
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ expanded }}
                                accessibilityLabel={`${section.title} ${expanded ? "접기" : "펼치기"}`}
                                onPress={() => toggleSection(section.title)}
                                style={({ pressed }) => [
                                    styles.sectionHeader,
                                    { opacity: pressed ? 0.62 : 1 },
                                ]}
                            >
                                <View style={styles.sectionHeading}>
                                    <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                                        {section.title}
                                    </Text>
                                    <Text style={[styles.sectionMeta, { color: colors.textSecondary }]}>
                                        {section.body.length}개 항목
                                    </Text>
                                </View>
                                <View style={[styles.chevronBox, { backgroundColor: colors.surface2 }]}>
                                    <Ionicons
                                        name={expanded ? "chevron-up" : "chevron-down"}
                                        size={18}
                                        color={colors.textPrimary}
                                    />
                                </View>
                            </Pressable>

                            {expanded ? (
                                <View style={styles.paragraphList}>
                                    {section.body.map((paragraph, paragraphIndex) => (
                                        <View key={`${paragraphIndex}-${paragraph}`} style={styles.paragraphRow}>
                                            <Text style={[styles.bullet, { color: colors.textSecondary }]}>-</Text>
                                            <Text style={[styles.paragraphText, { color: colors.textSecondary }]}>
                                                {paragraph}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            ) : null}
                        </CalendarGlassSurface>
                    );
                })}

                <Text
                    style={[styles.footerText, { color: colors.textSecondary }]}
                >
                    문서 버전 {document.version}
                </Text>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        minHeight: 64,
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: "900",
    },
    backGlass: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
    },
    backButton: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    headerSpacer: {
        width: 44,
        height: 44,
    },
    content: {
        paddingHorizontal: 18,
        paddingTop: 16,
        gap: 12,
    },
    hero: {
        gap: 8,
        paddingBottom: 8,
    },
    eyebrow: {
        fontSize: 12,
        fontWeight: "900",
    },
    title: {
        fontSize: 30,
        lineHeight: 37,
        fontWeight: "900",
    },
    summary: {
        fontSize: 14,
        lineHeight: 21,
        fontWeight: "700",
    },
    helperText: {
        fontSize: 12,
        lineHeight: 18,
        fontWeight: "800",
    },
    loadingBox: {
        minHeight: 48,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
    },
    loadingContent: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    loadingText: {
        fontSize: 13,
        fontWeight: "800",
    },
    notice: {
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 13,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    noticeText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 18,
        fontWeight: "700",
    },
    sectionCard: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 0,
        overflow: "hidden",
    },
    sectionHeader: {
        minHeight: 66,
        paddingHorizontal: 16,
        paddingVertical: 13,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    sectionHeading: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    sectionTitle: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: "900",
    },
    sectionMeta: {
        fontSize: 11,
        lineHeight: 15,
        fontWeight: "800",
    },
    chevronBox: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    paragraphList: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "rgba(128,128,128,0.22)",
        paddingHorizontal: 16,
        paddingTop: 13,
        paddingBottom: 15,
        gap: 8,
    },
    paragraphRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 7,
    },
    bullet: {
        width: 8,
        fontSize: 13,
        lineHeight: 20,
        fontWeight: "900",
    },
    paragraphText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 20,
        fontWeight: "700",
    },
    footerText: {
        paddingTop: 6,
        fontSize: 11,
        lineHeight: 17,
        fontWeight: "700",
    },
});
