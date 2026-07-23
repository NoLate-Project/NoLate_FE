import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { LegalDocument } from "../../api/legal";
import { useAuth } from "../auth/AuthContext";
import { getPostAuthRoute } from "../onboarding/curationRouting";
import CalendarGlassSurface from "../schedule/components/calendar/CalendarGlassSurface";
import { useTheme } from "../theme/ThemeContext";
import BrandedLoader from "../../ui/BrandedLoader";

type LegalAgreementDocumentScreenProps = {
    fallback: LegalDocument;
    loadDocument: () => Promise<LegalDocument>;
};

export default function LegalAgreementDocumentScreen({
    fallback,
    loadDocument,
}: LegalAgreementDocumentScreenProps) {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors, mode } = useTheme();
    const { isAuthenticated, isCurationCompleted } = useAuth();
    const [document, setDocument] = useState(fallback);
    const [loading, setLoading] = useState(true);
    const [usingFallback, setUsingFallback] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

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
        if (router.canGoBack()) router.back();
        else router.replace(isAuthenticated ? getPostAuthRoute(isCurationCompleted) : "/auth/login");
    };

    return (
        <View style={[styles.root, { backgroundColor: colors.background }]}>
            <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <CalendarGlassSurface
                    interactive
                    variant="toolbar"
                    style={[styles.backSurface, { borderColor: colors.border }]}
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
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                    {document.title}
                </Text>
                <View style={styles.headerSpacer} />
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: Math.max(insets.bottom, 18) + 24 },
                ]}
            >
                <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
                    필수 · 시행일 {document.effectiveDate}
                </Text>
                <Text style={[styles.title, { color: colors.textPrimary }]}>{document.title}</Text>
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

                {document.sections.map((section, sectionIndex) => (
                    <View key={`${section.title}-${sectionIndex}`} style={[styles.section, { borderColor: colors.border }]}>
                        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{section.title}</Text>
                        {section.body.map((paragraph, paragraphIndex) => (
                            <View key={`${paragraphIndex}-${paragraph}`} style={styles.paragraphRow}>
                                <Text style={[styles.bullet, { color: colors.textSecondary }]}>-</Text>
                                <Text style={[styles.paragraph, { color: colors.textSecondary }]}>{paragraph}</Text>
                            </View>
                        ))}
                    </View>
                ))}

                <Text style={[styles.version, { color: colors.textSecondary }]}>문서 버전 {document.version}</Text>
            </ScrollView>
        </View>
    );
}

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
    backSurface: { width: 44, height: 44, borderRadius: 22, borderWidth: 1 },
    backButton: { flex: 1, alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 17, fontWeight: "900" },
    headerSpacer: { width: 44, height: 44 },
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
    paragraphRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
    bullet: { width: 7, fontSize: 13, lineHeight: 21, fontWeight: "900" },
    paragraph: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 21, fontWeight: "700" },
    version: { marginTop: 4, textAlign: "center", fontSize: 11, lineHeight: 16, fontWeight: "700" },
});
